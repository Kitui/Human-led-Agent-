import hashlib
import json
import re
import time
from datetime import datetime, timezone

from sqlalchemy.ext.asyncio import AsyncSession

from .crm_actions import get_or_create_crm_status_update
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
    """Compatibility hook used by api.py for controlled approval routing."""
    return bool(run.action_point and run.action_point.requires_human_approval)


def approved_customer_reference(run: WorkflowRun) -> str | None:
    """Return the customer identity bound by investigation evidence."""
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

        match = re.search(r"[\"']name[\"']\s*:\s*[\"']([^\"']+)[\"']", detail)
        if match:
            return match.group(1).strip()

    return None


def approved_execution_type(run: WorkflowRun) -> str:
    """Return the write capability bound to the approved Action Point.

    Action Points created before multi-action execution existed have no
    execution object. They remain create_task so persisted runs keep their
    original behavior.
    """
    if run.action_point and run.action_point.execution:
        return run.action_point.execution.type
    return "create_task"


def _approved_action_idempotency_key(run: WorkflowRun) -> str:
    action_point = run.action_point
    if action_point is None:
        raise InvalidRunStateError("Run has no Action Point to execute.")
    execution_json = json.dumps(
        action_point.execution.model_dump(mode="json") if action_point.execution else {"type": "create_task"},
        sort_keys=True,
        separators=(",", ":"),
    )
    action_string = (
        f"{run.run_id}|"
        f"{action_point.title}|"
        f"{action_point.priority}|"
        f"{action_point.recommended_action}|"
        f"{action_point.target_team}|"
        f"{execution_json}"
    )
    return hashlib.sha256(action_string.encode()).hexdigest()


async def approve_webmcp_action_point(
    db: AsyncSession,
    run_id: str,
    comment: str | None = None,
) -> WorkflowRun:
    """Authorize an Action Point without performing any consequential write."""
    orm_row = await db.get(WorkflowRunORM, run_id)
    if orm_row is None:
        raise RunNotFoundError(run_id)
    run = WorkflowRun.model_validate(orm_row, from_attributes=True)

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

    execution_type = approved_execution_type(run)
    run.status = RunStatus.APPROVED
    run.updated_at = _now()
    run.trace.append(
        TraceEvent(
            timestamp=run.updated_at,
            kind="execution",
            label="Execution approved by human reviewer",
            detail=(
                f"Approved exactly one controlled {execution_type} execution. "
                "No consequential action has executed yet."
            ),
            tag="HUMAN_APPROVAL",
        )
    )
    await _persist(db, orm_row, run)
    return run


async def execute_webmcp_approved_action(
    db: AsyncSession,
    run_id: str,
    customer_name: str,
    *,
    expected_execution_type: str | None = None,
) -> WorkflowRun:
    """Execute the single capability bound to an already-approved Action Point.

    Every write adapter reuses this state/evidence/idempotency boundary. The
    browser tool selects only the run; it cannot alter the approved action,
    status transition, priority, target team, organization, or customer.
    """
    orm_row = await db.get(WorkflowRunORM, run_id)
    if orm_row is None:
        raise RunNotFoundError(run_id)
    run = WorkflowRun.model_validate(orm_row, from_attributes=True)

    if run.status not in (RunStatus.APPROVED, RunStatus.COMPLETED):
        raise InvalidRunStateError(
            f"Run cannot execute a WebMCP action from state '{run.status.value}'. Human approval is required first."
        )
    if run.action_point is None:
        raise InvalidRunStateError("Run has no approved Action Point to execute.")

    actual_execution_type = approved_execution_type(run)
    if expected_execution_type is not None and actual_execution_type != expected_execution_type:
        raise InvalidRunStateError(
            f"Approved run authorizes {actual_execution_type}, not {expected_execution_type}."
        )

    customer_name = customer_name.strip()
    if not customer_name:
        raise ValueError("customer_name is required.")

    evidence_customer = approved_customer_reference(run)
    if not evidence_customer:
        raise InvalidRunStateError(
            "Approved action has no CRM customer evidence to bind the execution scope."
        )
    if evidence_customer.casefold() != customer_name.casefold():
        raise ValueError("customer_name does not match the CRM evidence attached to this approved run.")

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
            label=f"WebMCP approved {actual_execution_type} execution started",
            detail=(
                f"Executing exactly the human-approved Action Point through {actual_execution_type}. "
                "The tool cannot alter the approved scope."
            ),
            tag="WEBMCP_WRITE",
        )
    )
    await _persist(db, orm_row, run)

    started = time.perf_counter()
    try:
        if actual_execution_type == "create_task":
            result, _ = await _get_or_create_task(
                db,
                idempotency_key=idempotency_key,
                customer_name=customer_name,
                team=action_point.target_team or "Operations",
                description=action_point.recommended_action,
                priority=action_point.priority,
                task_client=GitHubTaskClient.from_env(),
            )
            run.execution_result = (
                f"Execution succeeded. Created GitHub Issue #{result['issue_number']} "
                f"for {action_point.target_team or 'Operations'}."
            )
        elif actual_execution_type == "update_crm_status":
            execution = action_point.execution
            if (
                execution is None
                or not execution.crm_expected_status
                or not execution.crm_target_status
            ):
                raise InvalidRunStateError(
                    "Approved CRM execution is missing its reviewed status transition."
                )
            result, _ = await get_or_create_crm_status_update(
                db,
                idempotency_key=idempotency_key,
                tenant_id=run.tenant_id,
                customer_name=customer_name,
                expected_status=execution.crm_expected_status,
                target_status=execution.crm_target_status,
            )
            run.execution_result = (
                f"Execution succeeded. Updated CRM renewal status for {customer_name} "
                f"from {result['before']} to {result['after']}."
            )
        else:
            raise InvalidRunStateError(
                f"Unsupported approved execution type '{actual_execution_type}'."
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
                label=f"WebMCP {actual_execution_type} failed",
                detail=str(exc)[:300],
            )
        )
        await _persist(db, orm_row, run)
        return run

    run.status = RunStatus.COMPLETED
    run.duration_seconds = time.perf_counter() - started
    run.updated_at = _now()
    run.trace.append(
        TraceEvent(
            timestamp=run.updated_at,
            kind="mcp",
            label=f"WebMCP {actual_execution_type} result received",
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


async def execute_webmcp_approved_task(
    db: AsyncSession,
    run_id: str,
    customer_name: str,
) -> WorkflowRun:
    """Entrypoint used by /webmcp/tasks. Only executes create_task-approved runs.

    /webmcp/crm-status is the separate, independently-enforced route for
    update_crm_status so each controlled-execution tool is backed by its own
    backend check, not only by the browser's own pre-check of the approved
    run's execution type.
    """
    return await execute_webmcp_approved_action(
        db,
        run_id,
        customer_name,
        expected_execution_type="create_task",
    )


async def execute_webmcp_approved_crm_status(
    db: AsyncSession,
    run_id: str,
    customer_name: str,
) -> WorkflowRun:
    return await execute_webmcp_approved_action(
        db,
        run_id,
        customer_name,
        expected_execution_type="update_crm_status",
    )
