import hashlib
import json
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
    return any(event.label == "WebMCP Action Point submitted" for event in run.trace)


def _crm_evidence_reference(run: WorkflowRun) -> str | None:
    for event in run.trace:
        if event.tag != "EVIDENCE" or event.label != "WebMCP crm evidence attached" or not event.detail:
            continue
        reference, separator, _ = event.detail.partition(":")
        if separator and reference.strip():
            return reference.strip()
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
    """Approve a WebMCP proposal but deliberately defer external execution.

    The approved run stays in APPROVED until a WebMCP-aware browser agent (or
    the Tasks human UI) calls the separate create_task capability. This keeps
    the human decision and the consequential write as two auditable steps.
    """
    orm_row = await db.get(WorkflowRunORM, run_id)
    if orm_row is None:
        raise RunNotFoundError(run_id)
    run = WorkflowRun.model_validate(orm_row, from_attributes=True)

    # Preserve the existing approve endpoint's idempotent behavior for a run
    # that has already moved beyond the human decision.
    if run.status in (RunStatus.APPROVED, RunStatus.COMPLETED):
        return run
    if run.status != RunStatus.AWAITING_APPROVAL:
        raise InvalidRunStateError(
            f"Run cannot be approved from state '{run.status.value}'."
        )
    if run.action_point is None:
        raise InvalidRunStateError("Run has no Action Point to approve.")
    if not is_webmcp_action_point(run):
        raise InvalidRunStateError("Run is not a WebMCP-submitted Action Point.")

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
            detail="Approved for WebMCP task execution. No external action has executed yet.",
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
    """Execute exactly one already-approved Action Point through the task adapter."""
    orm_row = await db.get(WorkflowRunORM, run_id)
    if orm_row is None:
        raise RunNotFoundError(run_id)
    run = WorkflowRun.model_validate(orm_row, from_attributes=True)

    if run.status == RunStatus.COMPLETED:
        return run
    if run.status != RunStatus.APPROVED:
        raise InvalidRunStateError(
            f"Run cannot execute a WebMCP task from state '{run.status.value}'. Human approval is required first."
        )
    if run.action_point is None:
        raise InvalidRunStateError("Run has no approved Action Point to execute.")
    if not is_webmcp_action_point(run):
        raise InvalidRunStateError("Run is not a WebMCP-submitted Action Point.")

    customer_name = customer_name.strip()
    if not customer_name:
        raise ValueError("customer_name is required.")

    evidence_customer = _crm_evidence_reference(run)
    if not evidence_customer:
        raise InvalidRunStateError(
            "Approved WebMCP task has no CRM evidence reference to bind the customer scope."
        )
    if evidence_customer.casefold() != customer_name.casefold():
        raise ValueError("customer_name does not match the CRM evidence attached to this approved run.")

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
