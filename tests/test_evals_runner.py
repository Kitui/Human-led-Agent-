import json
from datetime import datetime, timezone

from agent_lab.evals_runner import _evaluate_action_point, _tool_result_from_run
from agent_lab.models import ActionPoint, EvalSuiteRun, TraceEvent, WorkflowRun


def test_eval_suite_run_tolerates_cases_persisted_before_category_existed():
    """Regression test: eval-suite runs persisted before the `category` field
    was added to EvalCaseResult have no `category` key in their stored JSON.
    GET /evals/runs must still load that old history instead of 500ing."""
    old_case = {
        "name": "an old case",
        "tenant_id": "NorthStar",
        "input": "some issue",
        "expected_outcome": "action_point",
        "passed": True,
    }
    run = EvalSuiteRun.model_validate({
        "run_id": "old-run",
        "started_at": datetime.now(timezone.utc),
        "duration_seconds": 1.0,
        "cases": [old_case],
        "passed_count": 1,
        "total_count": 1,
        "score": 100.0,
        "threshold": 90.0,
        "result": "passed",
    })
    assert run.cases[0].category == "Uncategorized"


def _run(*, trace=None) -> WorkflowRun:
    return WorkflowRun(
        run_id="eval-test-run",
        tenant_id="NorthStar",
        issue="test issue",
        action_point=ActionPoint(
            title="Test action",
            issue_type="Test",
            summary="Test summary",
            priority="high",
            recommended_action="Review the issue.",
            confidence=0.95,
            requires_human_approval=True,
            target_team="Operations",
        ),
        trace=trace or [],
    )


def _mcp_trace(payload: dict) -> list[TraceEvent]:
    now = datetime.now(timezone.utc)
    return [
        TraceEvent(
            timestamp=now,
            kind="mcp",
            label="MCP get_customer called",
            tag="MCP",
        ),
        TraceEvent(
            timestamp=now,
            kind="mcp",
            label="get_customer result received",
            detail=json.dumps(payload),
        ),
    ]


def test_eval_parses_found_customer_tool_result():
    run = _run(trace=_mcp_trace({"found": True, "customer": {"name": "ACME"}}))

    assert _tool_result_from_run(run) == "FOUND"

    result = _evaluate_action_point(
        {
            "name": "customer found",
            "category": "Customer Evidence",
            "tenant_id": "NorthStar",
            "input": "Investigate ACME.",
            "expected_outcome": "action_point",
            "expected_priority": "high",
            "expected_approval": True,
            "expects_tool_call": True,
            "expected_tool_result": "FOUND",
        },
        run,
    )

    assert result.passed is True
    assert result.tool_call_correct is True
    assert result.actual_tool_result == "FOUND"


def test_eval_parses_cross_organization_denial():
    run = _run(trace=_mcp_trace({"found": False, "error": "ACCESS_DENIED"}))

    result = _evaluate_action_point(
        {
            "name": "cross organization",
            "category": "Tenant Controls",
            "tenant_id": "NorthStar",
            "input": "Investigate GreenMart.",
            "expected_outcome": "action_point",
            "expects_tool_call": True,
            "expected_tool_result": "ACCESS_DENIED",
        },
        run,
    )

    assert result.passed is True
    assert result.actual_tool_result == "ACCESS_DENIED"


def test_eval_fails_unnecessary_customer_tool_call():
    run = _run(trace=_mcp_trace({"found": False, "error": "NOT_FOUND"}))

    result = _evaluate_action_point(
        {
            "name": "no customer expected",
            "category": "Operational Judgment",
            "tenant_id": "NorthStar",
            "input": "The printer is out of paper.",
            "expected_outcome": "action_point",
            "expected_priority": "high",
            "expected_approval": True,
            "expects_tool_call": False,
        },
        run,
    )

    assert result.passed is False
    assert result.tool_call_correct is False
