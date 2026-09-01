import hashlib
import logging
import os
import sys
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

from agents import Runner
from agents.mcp import MCPServerStdio
from agents.tool import ToolOriginType
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .agent import build_execution_agent, build_investigator_agent, resolve_investigator_instructions
from .db_models import WorkflowRunORM, workflow_run_to_columns
from .execution import execute_with_retry
from .guardrails import validate_input
from .models import ActionPoint, RunStatus, TenantSettings, TraceEvent, WorkflowRun
from .tenant_settings import get_or_create_settings
from .tenants import is_valid_active_tenant


logger = logging.getLogger(__name__)
# No explicit `level=` here -- that would raise the ROOT logger's level and
# leak verbosity into every third-party library (asyncio, uvicorn, etc.).
# _apply_log_level() below sets OUR two named loggers' own levels instead,
# which is honored independently of root's level; this basicConfig call
# only exists to attach a formatted handler so those messages have
# somewhere to actually print.
logging.basicConfig(format="[%(name)s] %(message)s")

_LOG_LEVELS = {
    "Debug": logging.DEBUG,
    "Info": logging.INFO,
    "Warning": logging.WARNING,
    "Error": logging.ERROR,
}


def _apply_log_level(log_level: str) -> None:
    """Set this process's workflow/execution loggers to the tenant's
    configured level, for the duration of this request. Known limitation:
    a single process-wide logger level, not scoped per-request -- accepted
    for this single-process lab (same tradeoff class as _in_flight_runs
    below)."""

    level = _LOG_LEVELS.get(log_level, logging.INFO)
    logger.setLevel(level)
    logging.getLogger("agent_lab.execution").setLevel(level)


class InvalidTenantError(ValueError):
    pass


class GuardrailBlockedError(ValueError):
    pass


class RunNotFoundError(KeyError):
    pass


class InvalidRunStateError(RuntimeError):
    pass


class TooManyConcurrentRunsError(RuntimeError):
    pass


# In-memory only -- resets on restart, not shared across app instances.
# Acceptable for this single-process lab; see tenant-settings plan.
_in_flight_runs: dict[str, int] = {}

# Synthetic-QA fallback for the eval-suite path (persist=False, db=None) --
# never touches the DB, exactly mirroring how the tenant-existence check
# below is already skipped for that path.
_EVAL_DEFAULT_SETTINGS = TenantSettings(tenant_slug="")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _touch(run: WorkflowRun) -> None:
    run.updated_at = _now()


def _new_workflow_run(tenant_id: str, issue: str, settings: TenantSettings) -> WorkflowRun:
    """Construct a fresh WorkflowRun using this tenant's configured
    max_steps. Kept as a tiny pure helper (no I/O) so the max_steps wiring
    is unit-testable without a DB or a real agent call."""

    return WorkflowRun(run_id=str(uuid.uuid4()), tenant_id=tenant_id, issue=issue, max_steps=settings.max_steps)


async def _persist(db: AsyncSession, orm_row: WorkflowRunORM, run: WorkflowRun) -> None:
    """Write the current in-memory state of `run` onto its database row."""

    for column, value in workflow_run_to_columns(run).items():
        setattr(orm_row, column, value)
    await db.commit()


def _summarize_tool_output(output) -> str:
    """MCP tool results arrive wrapped as {"type": "text", "text": "<json>"}; unwrap
    that for a readable trace detail instead of showing the raw Python dict repr."""

    if isinstance(output, dict) and output.get("type") == "text" and isinstance(output.get("text"), str):
        return output["text"][:300]
    return str(output)[:300]


def _tool_call_trace_events(new_items) -> list[TraceEvent]:
    """Turn the tool-call items an agent run already produced into trace events.

    Reads directly from `RunResult.new_items` (ToolCallItem / ToolCallOutputItem).
    Nothing here is invented — a run only ever reports the MCP/function tools it
    actually called.
    """

    events: list[TraceEvent] = []
    tool_name_by_call_id: dict[str, str] = {}

    for item in new_items:
        item_type = getattr(item, "type", None)

        if item_type == "tool_call_item":
            tool_name = item.tool_name or "tool"
            if item.call_id:
                tool_name_by_call_id[item.call_id] = tool_name

            is_mcp = bool(item.tool_origin and item.tool_origin.type == ToolOriginType.MCP)
            events.append(
                TraceEvent(
                    timestamp=_now(),
                    kind="mcp",
                    label=f"MCP {tool_name} called" if is_mcp else f"Tool {tool_name} called",
                    tag="MCP" if is_mcp else "TOOL",
                )
            )

        elif item_type == "tool_call_output_item":
            tool_name = tool_name_by_call_id.get(item.call_id, "tool")
            events.append(
                TraceEvent(
                    timestamp=_now(),
                    kind="mcp",
                    label=f"{tool_name} result received",
                    detail=_summarize_tool_output(item.output),
                )
            )

    return events


def _enforce_critical_requires_approval(action_point: ActionPoint) -> None:
    """Deterministic safety net, not left to the model's judgment: a
    critical-priority action point always requires human approval,
    regardless of what the agent itself decided. Eval history showed the
    model occasionally judging a critical case as not needing approval --
    this invariant is too important to depend on prompt adherence alone."""
    if action_point.priority == "critical":
        action_point.requires_human_approval = True


def _accumulate_metrics(run: WorkflowRun, result) -> None:
    """Add this agent run's real usage counters (from the SDK's own
    RunResult) to the run's running totals. Never estimated."""

    run.metrics.model_calls += len(result.raw_responses)
    run.metrics.total_tokens += sum(r.usage.total_tokens for r in result.raw_responses)
    run.metrics.tool_calls += sum(
        1 for item in result.new_items if getattr(item, "type", None) == "tool_call_item"
    )


async def get_run(db: AsyncSession, run_id: str) -> WorkflowRun:
    orm_row = await db.get(WorkflowRunORM, run_id)
    if orm_row is None:
        raise RunNotFoundError(run_id)
    return WorkflowRun.model_validate(orm_row, from_attributes=True)


async def list_runs(
    db: AsyncSession,
    status: RunStatus | None = None,
    tenant_id: str | None = None,
) -> list[WorkflowRun]:
    """Return tracked runs, most recently created first."""

    stmt = select(WorkflowRunORM).order_by(WorkflowRunORM.created_at.desc())

    if status is not None:
        stmt = stmt.where(WorkflowRunORM.status == status.value)

    if tenant_id is not None:
        stmt = stmt.where(WorkflowRunORM.tenant_id == tenant_id)

    result = await db.execute(stmt)
    return [WorkflowRun.model_validate(row, from_attributes=True) for row in result.scalars().all()]


async def investigate_issue(
    tenant_id: str,
    issue: str,
    *,
    db: AsyncSession | None = None,
    persist: bool = True,
) -> WorkflowRun:
    """Run the read-only investigation phase and return an Action Point."""

    if persist and db is None:
        raise ValueError("db is required when persist=True")

    tenant_id = tenant_id.strip()
    issue = issue.strip()

    # Eval cases (agent_lab/eval_cases.py) call this with persist=False and no
    # db -- synthetic, pre-validated QA inputs never subject to real tenant
    # rules, so skip the DB-backed check entirely rather than requiring a db
    # just to satisfy it.
    if db is not None and not await is_valid_active_tenant(db, tenant_id):
        raise InvalidTenantError("Invalid tenant.")

    if not issue:
        raise ValueError("Issue cannot be empty.")

    settings = await get_or_create_settings(db, tenant_id) if db is not None else _EVAL_DEFAULT_SETTINGS
    _apply_log_level(settings.log_level)

    if db is not None:
        in_flight = _in_flight_runs.get(tenant_id, 0)
        if in_flight >= settings.max_concurrent_runs:
            raise TooManyConcurrentRunsError(
                f"Tenant '{tenant_id}' has reached its max_concurrent_runs limit ({settings.max_concurrent_runs})."
            )
        _in_flight_runs[tenant_id] = in_flight + 1

    try:
        guardrail_result = await validate_input(issue)
        if guardrail_result.blocked:
            raise GuardrailBlockedError(guardrail_result.reason)

        run = _new_workflow_run(tenant_id, issue, settings)

        run.trace.append(
            TraceEvent(
                timestamp=_now(),
                kind="guardrail",
                label="Guardrail checked",
                tag="PASS",
                detail=guardrail_result.reason,
            )
        )

        started = time.perf_counter()

        run.status = RunStatus.INVESTIGATING
        run.step_count += 1
        _touch(run)

        # Persisted here, before the slow agent call, so a crash mid-investigation
        # still leaves a visible "investigating" row instead of losing it silently.
        orm_row: WorkflowRunORM | None = None
        if persist:
            orm_row = WorkflowRunORM(**workflow_run_to_columns(run))
            db.add(orm_row)
            await db.commit()

        current_dir = Path(__file__).parent

        logger.info(f"[RUN ID] {run.run_id}")
        logger.info(f"[STATE] {run.status}")
        logger.debug("[TRACE] Starting MCP-powered investigation")

        async with MCPServerStdio(
            name="Customer Operations MCP",
            params={
                "command": sys.executable,
                "args": [str(current_dir / "mcp_server.py")],
                # MCP stdio uses a restricted default child environment. Pass
                # our runtime environment explicitly so DATABASE_URL and other
                # deployment configuration reach the database-backed MCP tool.
                "env": os.environ.copy(),
            },
        ) as mcp_server:
            instructions = resolve_investigator_instructions(settings)
            investigator_with_mcp = build_investigator_agent(
                mcp_server, instructions, model=settings.default_model or None
            )

            investigation_input = f"""
Current Tenant:
{tenant_id}

Operational Issue:
{issue}

When calling get_customer,
you MUST pass the current tenant_id exactly.
"""

            result = await Runner.run(
                investigator_with_mcp,
                investigation_input,
            )

        logger.debug("[TRACE] Investigation completed")

        run.trace.extend(_tool_call_trace_events(result.new_items))
        _accumulate_metrics(run, result)

        run.action_point = result.final_output
        _enforce_critical_requires_approval(run.action_point)
        run.duration_seconds = time.perf_counter() - started

        if run.action_point.requires_human_approval:
            run.status = RunStatus.AWAITING_APPROVAL
            run.step_count += 1
        else:
            run.status = RunStatus.COMPLETED
        _touch(run)

        run.trace.append(
            TraceEvent(
                timestamp=_now(),
                kind="execution",
                label="Action point generated",
                detail=(
                    f"Priority: {run.action_point.priority}. "
                    f"Requires human approval: {run.action_point.requires_human_approval}."
                ),
            )
        )

        if persist:
            await _persist(db, orm_row, run)

        logger.info(f"[STATE] {run.status}")
        return run
    finally:
        if db is not None:
            _in_flight_runs[tenant_id] = _in_flight_runs.get(tenant_id, 1) - 1


async def approve_run(db: AsyncSession, run_id: str, comment: str | None = None) -> WorkflowRun:
    """Approve an Action Point and execute exactly the approved action.

    This single-step approve-and-execute path is CorrelAct's original CLI
    behavior (see agent_lab/app.py) and remains only for that standalone,
    non-networked entry point. It is not reachable through the public API:
    every Action Point that reaches AWAITING_APPROVAL has
    requires_human_approval=True (see investigate_issue), so
    api.py's POST /runs/{run_id}/approve always routes to
    webmcp_tasks.approve_webmcp_action_point instead, which records approval
    without executing and requires a separate WebMCP create_task /
    update_crm_status call. That two-phase model, not this function, is
    CorrelAct's actual approval boundary.
    """

    orm_row = await db.get(WorkflowRunORM, run_id)
    if orm_row is None:
        raise RunNotFoundError(run_id)
    run = WorkflowRun.model_validate(orm_row, from_attributes=True)

    settings = await get_or_create_settings(db, run.tenant_id)
    _apply_log_level(settings.log_level)

    # Safe repeated read of a completed run. Do not execute again.
    if run.status == RunStatus.COMPLETED:
        return run

    if run.status != RunStatus.AWAITING_APPROVAL:
        raise InvalidRunStateError(
            f"Run cannot be approved from state '{run.status.value}'."
        )

    if run.action_point is None:
        raise InvalidRunStateError("Run has no Action Point to approve.")

    if comment:
        run.review_comment = comment
        run.trace.append(
            TraceEvent(
                timestamp=_now(),
                kind="execution",
                label="Reviewer comment added",
                detail=comment[:300],
            )
        )

    run.status = RunStatus.APPROVED
    _touch(run)
    logger.info(f"[STATE] {run.status}")

    if run.step_count >= run.max_steps:
        run.status = RunStatus.FAILED
        run.error = "Maximum workflow steps reached."
        _touch(run)
        await _persist(db, orm_row, run)
        return run

    run.status = RunStatus.EXECUTING
    run.step_count += 1
    _touch(run)
    logger.info(f"[STATE] {run.status}")
    logger.debug("[TRACE] Starting execution agent")

    run.trace.append(
        TraceEvent(
            timestamp=_now(),
            kind="execution",
            label="Execution approved by human reviewer",
        )
    )

    action_point = run.action_point

    action_string = (
        f"{run.run_id}|"
        f"{action_point.title}|"
        f"{action_point.priority}|"
        f"{action_point.recommended_action}|"
        f"{action_point.target_team}"
    )

    idempotency_key = hashlib.sha256(
        action_string.encode()
    ).hexdigest()

    run.idempotency_key = idempotency_key

    logger.debug(f"[IDEMPOTENCY KEY] {idempotency_key[:12]}...")

    execution_input = f"""
The following Action Point has been approved by a human.

Customer issue:
{run.issue}

Approved Action Point:

Title:
{action_point.title}

Priority:
{action_point.priority}

Recommended Action:
{action_point.recommended_action}

Target Team:
{action_point.target_team}

Idempotency Key:
{idempotency_key}

Execute exactly this approved action using create_task.

You MUST pass the provided idempotency key to create_task.
Do not create additional actions.
Do not change the scope of the approved action.
"""

    await _persist(db, orm_row, run)

    started = time.perf_counter()

    try:
        execution_result = await execute_with_retry(
            build_execution_agent(settings.default_model or None),
            execution_input,
            max_retries=settings.retry_limit,
        )
    except Exception as exc:
        run.status = RunStatus.FAILED
        run.error = str(exc)
        run.duration_seconds = time.perf_counter() - started
        _touch(run)
        run.trace.append(
            TraceEvent(
                timestamp=_now(),
                kind="error",
                label="Execution failed",
                detail=str(exc)[:300],
            )
        )
        logger.info(f"[STATE] {run.status}")
        await _persist(db, orm_row, run)
        return run

    run.trace.extend(_tool_call_trace_events(execution_result.new_items))
    _accumulate_metrics(run, execution_result)

    run.execution_result = str(execution_result.final_output)
    run.status = RunStatus.COMPLETED
    run.duration_seconds = time.perf_counter() - started
    _touch(run)

    run.trace.append(
        TraceEvent(
            timestamp=_now(),
            kind="execution",
            label="Execution completed",
            detail=run.execution_result[:300],
        )
    )

    logger.debug("[TRACE] Execution completed")
    logger.info(f"[STATE] {run.status}")

    await _persist(db, orm_row, run)

    return run


async def reject_run(db: AsyncSession, run_id: str, comment: str | None = None) -> WorkflowRun:
    orm_row = await db.get(WorkflowRunORM, run_id)
    if orm_row is None:
        raise RunNotFoundError(run_id)
    run = WorkflowRun.model_validate(orm_row, from_attributes=True)

    if run.status != RunStatus.AWAITING_APPROVAL:
        raise InvalidRunStateError(
            f"Run cannot be rejected from state '{run.status.value}'."
        )

    if comment:
        run.review_comment = comment
        run.trace.append(
            TraceEvent(
                timestamp=_now(),
                kind="execution",
                label="Reviewer comment added",
                detail=comment[:300],
            )
        )

    run.status = RunStatus.REJECTED
    _touch(run)
    run.trace.append(
        TraceEvent(
            timestamp=_now(),
            kind="execution",
            label="Rejected by human reviewer",
        )
    )
    logger.info(f"[STATE] {run.status}")
    await _persist(db, orm_row, run)
    return run