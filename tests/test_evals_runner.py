import json
from datetime import datetime, timezone

from agent_lab.evals_runner import _evaluate_action_point, _tool_result_from_run
from agent_lab.models import ActionPoint, TraceEvent, WorkflowRun


def _run(*, trace=None) -> WorkflowRun:
    return WorkflowRun(
        run_id="eval-test-run",
        tenant_id="tenant_red",
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
            "tenant_id": "tenant_red",
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


def test_eval_parses_cross_tenant_denial():
    run = _run(trace=_mcp_trace({"found": False, "error": "ACCESS_DENIED"}))

    result = _evaluate_action_point(
        {
            "name": "cross tenant",
            "category": "Tenant Controls",
            "tenant_id": "tenant_red",
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
            "tenant_id": "tenant_red",
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
