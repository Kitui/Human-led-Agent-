"""Runs the real eval suite (agent_lab/eval_cases.py) against the live
investigator agent and keeps a real history of past runs (eval_suite_runs
table), so the Evals dashboard can show real score-over-time and real
regressions instead of simulated ones."""

import json
import time
import uuid
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .db_models import EvalSuiteRunORM, eval_suite_run_to_columns
from .eval_cases import EVAL_CASES, MINIMUM_SCORE
from .models import EvalCaseResult, EvalSuiteRun, WorkflowRun
from .workflow import investigate_issue


def _tool_use_correct(run: WorkflowRun, expects_tool_call: bool) -> bool | None:
    """Real check: did the run's own trace show a successful get_customer
    call? Returns None (not applicable) for cases that never claimed a
    customer lookup was required."""

    if not expects_tool_call:
        return None

    call_event = next(
        (e for e in run.trace if e.kind == "mcp" and e.label == "MCP get_customer called"),
        None,
    )
    if call_event is None:
        return False

    result_event = next(
        (e for e in run.trace if e.kind == "mcp" and e.label == "get_customer result received"),
        None,
    )
    if result_event is None or not result_event.detail:
        return False

    try:
        parsed = json.loads(result_event.detail)
    except (ValueError, TypeError):
        return False

    return bool(parsed.get("found"))


async def run_eval_suite(db: AsyncSession) -> EvalSuiteRun:
    started = time.perf_counter()
    started_at = datetime.now(timezone.utc)
    results: list[EvalCaseResult] = []

    for case in EVAL_CASES:
        try:
            # Eval cases are synthetic QA inputs, not real customer issues —
            # persist=False keeps them out of the workflow_runs table (and so
            # out of the user-facing Runs/Approvals/Dashboard views) while
            # still capturing everything needed for the Evals dashboard below.
            run = await investigate_issue(
                tenant_id=case["tenant_id"],
                issue=case["input"],
                persist=False,
            )

            action_point = run.action_point
            actual_priority = action_point.priority if action_point else None
            actual_approval = action_point.requires_human_approval if action_point else None
            expects_tool_call = case.get("expects_tool_call", False)
            tool_call_correct = _tool_use_correct(run, expects_tool_call)
            passed = (
                actual_priority == case["expected_priority"]
                and actual_approval == case["expected_approval"]
                and tool_call_correct is not False
            )
            results.append(
                EvalCaseResult(
                    name=case["name"],
                    tenant_id=case["tenant_id"],
                    input=case["input"],
                    expected_priority=case["expected_priority"],
                    actual_priority=actual_priority,
                    expected_approval=case["expected_approval"],
                    actual_approval=actual_approval,
                    expects_tool_call=expects_tool_call,
                    tool_call_correct=tool_call_correct,
                    passed=passed,
                )
            )
        except Exception as exc:
            results.append(
                EvalCaseResult(
                    name=case["name"],
                    tenant_id=case["tenant_id"],
                    input=case["input"],
                    expected_priority=case["expected_priority"],
                    expected_approval=case["expected_approval"],
                    expects_tool_call=case.get("expects_tool_call", False),
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
