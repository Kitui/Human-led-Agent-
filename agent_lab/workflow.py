import hashlib
import sys
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

from agents import Agent, Runner
from agents.mcp import MCPServerStdio
from agents.tool import ToolOriginType
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .agent import SYSTEM_PROMPT
from .db_models import WorkflowRunORM, workflow_run_to_columns
from .execution import execute_with_retry
from .guardrails import validate_input
from .models import ActionPoint, RunStatus, TraceEvent, WorkflowRun


VALID_TENANTS = {
    "tenant_red",
    "tenant_green",
}


class InvalidTenantError(ValueError):
    pass


class GuardrailBlockedError(ValueError):
    pass


class RunNotFoundError(KeyError):
    pass


class InvalidRunStateError(RuntimeError):
    pass


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _touch(run: WorkflowRun) -> None:
    run.updated_at = _now()


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

    if tenant_id not in VALID_TENANTS:
        raise InvalidTenantError("Invalid tenant.")

    if not issue:
        raise ValueError("Issue cannot be empty.")

    guardrail_result = await validate_input(issue)
    if guardrail_result.blocked:
        raise GuardrailBlockedError(guardrail_result.reason)

    run = WorkflowRun(
        run_id=str(uuid.uuid4()),
        tenant_id=tenant_id,
        issue=issue,
    )

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

    print(f"[RUN ID] {run.run_id}")
    print(f"[STATE] {run.status}")
    print("[TRACE] Starting MCP-powered investigation")

    async with MCPServerStdio(
        name="Customer Operations MCP",
        params={
            "command": sys.executable,
            "args": [str(current_dir / "mcp_server.py")],
        },
    ) as mcp_server:
        investigator_with_mcp = Agent(
            name="Operations Investigator",
            instructions=SYSTEM_PROMPT,
            output_type=ActionPoint,
            mcp_servers=[mcp_server],
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

    print("[TRACE] Investigation completed")

    run.trace.extend(_tool_call_trace_events(result.new_items))
    _accumulate_metrics(run, result)

    run.action_point = result.final_output
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

    print(f"[STATE] {run.status}")
    return run


async def approve_run(db: AsyncSession, run_id: str, comment: str | None = None) -> WorkflowRun:
    """Approve an Action Point and execute exactly the approved action."""

    orm_row = await db.get(WorkflowRunORM, run_id)
    if orm_row is None:
        raise RunNotFoundError(run_id)
    run = WorkflowRun.model_validate(orm_row, from_attributes=True)

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
    print(f"[STATE] {run.status}")

    if run.step_count >= run.max_steps:
        run.status = RunStatus.FAILED
        run.error = "Maximum workflow steps reached."
        _touch(run)
        await _persist(db, orm_row, run)
        return run

    run.status = RunStatus.EXECUTING
    run.step_count += 1
    _touch(run)
    print(f"[STATE] {run.status}")
    print("[TRACE] Starting execution agent")

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

    print(f"[IDEMPOTENCY KEY] {idempotency_key[:12]}...")

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
            execution_input,
            max_retries=3,
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
        print(f"[STATE] {run.status}")
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

    print("[TRACE] Execution completed")
    print(f"[STATE] {run.status}")

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
    print(f"[STATE] {run.status}")
    await _persist(db, orm_row, run)
    return run
