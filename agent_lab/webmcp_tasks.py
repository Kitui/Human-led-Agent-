import hashlib
import json
import re
import time
from datetime import datetime, timezone

from sqlalchemy.ext.asyncio import AsyncSession

from .db_models import WorkflowRunORM, workflow_run_to_columns
from .github_tasks import GitHubTaskClient
from .models import RunStatus, TraceEvent, WorkflowRun
from .tools import _get_or_create_task
from .workflow import InvalidRunStateError, RunNotFoundError


def _now() -> datetime:
    return datetime.now(timezone.utc)


async def _persist(db: AsyncSession, orm_row: WorkflowRunORM, run: WorkflowRun) -> None:
    for column, value in workflow_run_to_columns(run).items():
        setattr(orm_row, column, value)
    await db.commit()


def is_webmcp_action_point(run: WorkflowRun) -> bool:
    """Compatibility hook used by api.py for controlled approval routing.

    The function name predates unified execution. Correlact now sends every
    Action Point that requires human approval through the same approval-only
    path, whether it originated in the main Investigate page or the WebMCP
    Investigation Hub.
    """
    return bool(run.action_point and run.action_point.requires_human_approval)


def approved_customer_reference(run: WorkflowRun) -> str | None:
    """Return the customer identity bound by investigation evidence.

    WebMCP submissions attach an explicit CRM EVIDENCE trace. Main Correlact
    investigations predate that trace shape, so they bind to the real
    get_customer result already persisted in their MCP trace. No customer is
    inferred from the issue text or from a browser-supplied value.
    """
    for event in run.trace:
        if event.tag != "EVIDENCE" or not event.detail:
            continue
        if event.label not in {
            "WebMCP crm evidence attached",
            "CRM customer evidence attached",
        }:
            continue
        reference, separator, _ = event.detail.partition(":")
        if separator and reference.strip():
            return reference.strip()

    for event in run.trace:
        if event.label != "get_customer result received" or not event.detail:
            continue

        detail = event.detail.strip()
        try:
            parsed = json.loads(detail)
        except (TypeError, ValueError):
            parsed = None

        if isinstance(parsed, dict):
            customer = parsed.get("customer")
            if parsed.get("found") and isinstance(customer, dict):
                name = customer.get("name")
                if isinstance(name, str) and name.strip():
                    return name.strip()

        # Defensive compatibility for old traces that may contain a Python
        # representation or a truncated JSON result. The customer name occurs
        # near the beginning of get_customer output, before trace truncation.
        match = re.search(r"[\"']name[\"']\s*:\s*[\"']([^\"']+)[\"']", detail)
        if match:
            return match.group(1).strip()

    return None


def _approved_action_idempotency_key(run: WorkflowRun) -> str:
    action_point = run.action_point
    if action_point is None:
        raise InvalidRunStateError("Run has no Action Point to execute.")
    action_string = (
        f"{run.run_id}|"
        f"{action_point.title}|"
        f"{action_point.priority}|"
        f"{action_point.recommended_action}|"
        f"{action_point.target_team}"
    )
    return hashlib.sha256(action_string.encode()).hexdigest()


async def approve_webmcp_action_point(
    db: AsyncSession,
    run_id: str,
    comment: str | None = None,
) -> WorkflowRun:
    """Authorize an Action Point without performing its external write.

    Kept under its original function name for API compatibility. Both normal
    Correlact investigations and WebMCP-submitted proposals now stop in
    APPROVED. A separate call to the Tasks WebMCP create_task capability is
    required for consequential execution.
    """
    orm_row = await db.get(WorkflowRunORM, run_id)
    if orm_row is None:
        raise RunNotFoundError(run_id)
    run = WorkflowRun.model_validate(orm_row, from_attributes=True)

    # Preserve the approve endpoint's idempotent behavior after the decision.
    if run.status in (RunStatus.APPROVED, RunStatus.COMPLETED):
        return run
    if run.status != RunStatus.AWAITING_APPROVAL:
        raise InvalidRunStateError(
            f"Run cannot be approved from state '{run.status.value}'."
        )
    if run.action_point is None:
        raise InvalidRunStateError("Run has no Action Point to approve.")
    if not run.action_point.requires_human_approval:
        raise InvalidRunStateError("Run does not require human approval.")

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
    run.updated_at = _now()
    run.trace.append(
        TraceEvent(
            timestamp=run.updated_at,
            kind="execution",
            label="Execution approved by human reviewer",
            detail="Approved for controlled task execution. No external action has executed yet.",
            tag="HUMAN_APPROVAL",
        )
    )
    await _persist(db, orm_row, run)
    return run


async def execute_webmcp_approved_task(
    db: AsyncSession,
    run_id: str,
    customer_name: str,
) -> WorkflowRun:
    """Execute exactly one already-approved Correlact Action Point.

    The consequential write is still reached through the WebMCP create_task
    surface, but the approved run may originate from either Correlact's main
    Investigate page or the WebMCP Investigation Hub.
    """
    orm_row = await db.get(WorkflowRunORM, run_id)
    if orm_row is None:
        raise RunNotFoundError(run_id)
    run = WorkflowRun.model_validate(orm_row, from_attributes=True)

    if run.status not in (RunStatus.APPROVED, RunStatus.COMPLETED):
        raise InvalidRunStateError(
            f"Run cannot execute a WebMCP task from state '{run.status.value}'. Human approval is required first."
        )
    if run.action_point is None:
        raise InvalidRunStateError("Run has no approved Action Point to execute.")

    customer_name = customer_name.strip()
    if not customer_name:
        raise ValueError("customer_name is required.")

    evidence_customer = approved_customer_reference(run)
    if not evidence_customer:
        raise InvalidRunStateError(
            "Approved task has no CRM customer evidence to bind the execution scope."
        )
    if evidence_customer.casefold() != customer_name.casefold():
        raise ValueError("customer_name does not match the CRM evidence attached to this approved run.")

    # A repeated call returns the already-completed run and never writes again.
    if run.status == RunStatus.COMPLETED:
        return run

    if run.step_count >= run.max_steps:
        run.status = RunStatus.FAILED
        run.error = "Maximum workflow steps reached."
        run.updated_at = _now()
        await _persist(db, orm_row, run)
        return run

    action_point = run.action_point
    idempotency_key = _approved_action_idempotency_key(run)
    run.idempotency_key = idempotency_key
    run.status = RunStatus.EXECUTING
    run.step_count += 1
    run.updated_at = _now()
    run.trace.append(
        TraceEvent(
            timestamp=run.updated_at,
            kind="execution",
            label="WebMCP approved task execution started",
            detail="Executing exactly the human-approved Action Point through create_task.",
            tag="WEBMCP_WRITE",
        )
    )
    await _persist(db, orm_row, run)

    started = time.perf_counter()
    try:
        result, _ = await _get_or_create_task(
            db,
            idempotency_key=idempotency_key,
            customer_name=customer_name,
            team=action_point.target_team or "Operations",
            description=action_point.recommended_action,
            priority=action_point.priority,
            task_client=GitHubTaskClient.from_env(),
        )
    except Exception as exc:
        run.status = RunStatus.FAILED
        run.error = str(exc)
        run.duration_seconds = time.perf_counter() - started
        run.updated_at = _now()
        run.trace.append(
            TraceEvent(
                timestamp=run.updated_at,
                kind="error",
                label="WebMCP create_task failed",
                detail=str(exc)[:300],
            )
        )
        await _persist(db, orm_row, run)
        return run

    run.execution_result = (
        f"Execution succeeded. Created GitHub Issue #{result['issue_number']} "
        f"for {action_point.target_team or 'Operations'}."
    )
    run.status = RunStatus.COMPLETED
    run.duration_seconds = time.perf_counter() - started
    run.updated_at = _now()
    run.trace.append(
        TraceEvent(
            timestamp=run.updated_at,
            kind="mcp",
            label="WebMCP create_task result received",
            detail=json.dumps(result, separators=(",", ":"))[:2000],
            tag="EXECUTION_RESULT",
        )
    )
    run.trace.append(
        TraceEvent(
            timestamp=run.updated_at,
            kind="execution",
            label="Execution completed",
            detail=run.execution_result,
        )
    )
    await _persist(db, orm_row, run)
    return run
