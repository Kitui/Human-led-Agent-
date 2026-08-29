"""Run the live eval suite and persist score history for the Evals page."""

import json
import time
import uuid
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .db_models import EvalSuiteRunORM, eval_suite_run_to_columns
from .eval_cases import EVAL_CASES, MINIMUM_SCORE
from .models import EvalCaseResult, EvalSuiteRun, WorkflowRun
from .workflow import GuardrailBlockedError, InvalidTenantError, investigate_issue


def _tool_result_from_run(run: WorkflowRun) -> str | None:
    result_event = next(
        (e for e in run.trace if e.kind == "mcp" and e.label == "get_customer result received"),
        None,
    )
    if result_event is None or not result_event.detail:
        return None

    try:
        parsed = json.loads(result_event.detail)
    except (ValueError, TypeError):
        return "UNPARSEABLE"

    if parsed.get("found") is True:
        return "FOUND"

    error = parsed.get("error")
    if error in {"ACCESS_DENIED", "NOT_FOUND"}:
        return error
    return "UNPARSEABLE"


def _tool_call_correct(
    run: WorkflowRun,
    *,
    expects_tool_call: bool,
    expected_tool_result: str | None,
) -> tuple[bool, str | None]:
    """Evaluate both required and forbidden customer-tool behavior."""

    call_event = next(
        (e for e in run.trace if e.kind == "mcp" and e.label == "MCP get_customer called"),
        None,
    )
    actual_tool_result = _tool_result_from_run(run)

    if not expects_tool_call:
        return call_event is None, actual_tool_result

    if call_event is None:
        return False, actual_tool_result

    if expected_tool_result is None:
        return actual_tool_result == "FOUND", actual_tool_result

    return actual_tool_result == expected_tool_result, actual_tool_result


def _base_result(case: dict, **overrides) -> EvalCaseResult:
    values = {
        "name": case["name"],
        "category": case["category"],
        "tenant_id": case["tenant_id"],
        "input": case["input"],
        "expected_outcome": case.get("expected_outcome", "action_point"),
        "expected_priority": case.get("expected_priority"),
        "expected_approval": case.get("expected_approval"),
        "expects_tool_call": case.get("expects_tool_call", False),
        "expected_tool_result": case.get("expected_tool_result"),
        "passed": False,
    }
    values.update(overrides)
    return EvalCaseResult(**values)


def _evaluate_action_point(case: dict, run: WorkflowRun) -> EvalCaseResult:
    action_point = run.action_point
    actual_priority = action_point.priority if action_point else None
    actual_approval = action_point.requires_human_approval if action_point else None
    expected_priority = case.get("expected_priority")
    expected_approval = case.get("expected_approval")
    expected_tool_result = case.get("expected_tool_result")
    expects_tool_call = case.get("expects_tool_call", False)

    tool_call_correct, actual_tool_result = _tool_call_correct(
        run,
        expects_tool_call=expects_tool_call,
        expected_tool_result=expected_tool_result,
    )

    expected_outcome = case.get("expected_outcome", "action_point")
    priority_correct = expected_priority is None or actual_priority == expected_priority
    approval_correct = expected_approval is None or actual_approval == expected_approval

    passed = (
        expected_outcome == "action_point"
        and action_point is not None
        and priority_correct
        and approval_correct
        and tool_call_correct
    )

    error = None
    if expected_outcome != "action_point":
        error = f"Expected {expected_outcome}, but workflow produced an Action Point."

    return _base_result(
        case,
        actual_outcome="action_point",
        actual_priority=actual_priority,
        actual_approval=actual_approval,
        actual_tool_result=actual_tool_result,
        tool_call_correct=tool_call_correct,
        passed=passed,
        error=error,
    )


async def run_eval_suite(db: AsyncSession) -> EvalSuiteRun:
    started = time.perf_counter()
    started_at = datetime.now(timezone.utc)
    results: list[EvalCaseResult] = []

    for case in EVAL_CASES:
        expected_outcome = case.get("expected_outcome", "action_point")

        try:
            # Pass the real DB session even with persist=False. This keeps eval
            # runs out of workflow history while still exercising tenant
            # validation, tenant settings, PostgreSQL-backed MCP data, and the
            # same orchestration path used by the application.
            run = await investigate_issue(
                tenant_id=case["tenant_id"],
                issue=case["input"],
                db=db,
                persist=False,
            )
            results.append(_evaluate_action_point(case, run))

        except GuardrailBlockedError as exc:
            passed = expected_outcome == "guardrail_block"
            results.append(
                _base_result(
                    case,
                    actual_outcome="guardrail_block",
                    passed=passed,
                    error=None if passed else f"Unexpected guardrail block: {exc}",
                )
            )

        except InvalidTenantError as exc:
            passed = expected_outcome == "invalid_tenant"
            results.append(
                _base_result(
                    case,
                    actual_outcome="invalid_tenant",
                    passed=passed,
                    error=None if passed else f"Unexpected invalid tenant stop: {exc}",
                )
            )

        except Exception as exc:
            results.append(
                _base_result(
                    case,
                    actual_outcome="error",
                    passed=False,
                    error=str(exc),
                )
            )

    passed_count = sum(1 for r in results if r.passed)
    total_count = len(results)
    score = (passed_count / total_count * 100) if total_count else 0.0

    suite_run = EvalSuiteRun(
        run_id=str(uuid.uuid4()),
        started_at=started_at,
        duration_seconds=time.perf_counter() - started,
        cases=results,
        passed_count=passed_count,
        total_count=total_count,
        score=score,
        threshold=MINIMUM_SCORE,
        result="passed" if score >= MINIMUM_SCORE else "failed",
    )

    db.add(EvalSuiteRunORM(**eval_suite_run_to_columns(suite_run)))
    await db.commit()
    return suite_run


async def list_eval_runs(db: AsyncSession) -> list[EvalSuiteRun]:
    """Most recently run suite first."""
    result = await db.execute(select(EvalSuiteRunORM).order_by(EvalSuiteRunORM.started_at.desc()))
    return [EvalSuiteRun.model_validate(row, from_attributes=True) for row in result.scalars().all()]
