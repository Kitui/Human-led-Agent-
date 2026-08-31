import json
import uuid
from datetime import datetime, timezone
from pathlib import Path

from agent_lab.db_models import WorkflowRunORM, workflow_run_to_columns
from agent_lab.models import ActionPoint, RunStatus, TraceEvent, WorkflowRun


ROOT = Path(__file__).resolve().parents[1]


async def _persist_main_investigate_run(db_session) -> WorkflowRun:
    now = datetime.now(timezone.utc)
    run = WorkflowRun(
        run_id=str(uuid.uuid4()),
        tenant_id="NorthStar",
        issue="ACME says their invoice amount is wrong and renewal is blocked.",
        status=RunStatus.AWAITING_APPROVAL,
        step_count=2,
        max_steps=5,
        action_point=ActionPoint(
            title="Resolve ACME renewal block",
            issue_type="Billing and renewal",
            summary="ACME is active but its renewal is blocked by an invoice dispute.",
            priority="high",
            recommended_action="Create a Revenue Support task to resolve the ACME invoice dispute before renewal.",
            confidence=0.98,
            requires_human_approval=True,
            target_team="Revenue Support",
        ),
        trace=[
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
                detail=json.dumps(
                    {
                        "found": True,
                        "customer": {
                            "name": "ACME",
                            "tenant_id": "NorthStar",
                            "plan": "Enterprise",
                            "account_status": "active",
                            "renewal_value": 120000,
                            "renewal_status": "blocked",
                            "billing_status": "invoice_dispute",
                        },
                    }
                ),
            ),
            TraceEvent(
                timestamp=now,
                kind="execution",
                label="Action point generated",
                detail="Priority: high. Requires human approval: True.",
            ),
        ],
        created_at=now,
        updated_at=now,
    )
    db_session.add(WorkflowRunORM(**workflow_run_to_columns(run)))
    await db_session.commit()
    return run


async def test_main_investigate_approval_stops_before_external_execution(
    client,
    auth_headers,
    db_session,
):
    headers = await auth_headers("user@northstar.com", "northstar-test-pass")
    run = await _persist_main_investigate_run(db_session)

    response = await client.post(
        f"/runs/{run.run_id}/approve",
        json={"comment": "Approved for controlled execution."},
        headers=headers,
    )

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "approved"
    assert body["execution_result"] is None
    assert body["idempotency_key"] is None
    assert any(
        event["label"] == "Execution approved by human reviewer"
        and event["tag"] == "HUMAN_APPROVAL"
        for event in body["trace"]
    )

    queue = await client.get(
        "/runs",
        params={"status": "approved", "tenant_id": "NorthStar"},
        headers=headers,
    )
    assert queue.status_code == 200
    assert any(item["run_id"] == run.run_id for item in queue.json())


async def test_main_investigate_approved_run_uses_same_customer_boundary_and_task_path(
    client,
    auth_headers,
    db_session,
    monkeypatch,
):
    headers = await auth_headers("user@northstar.com", "northstar-test-pass")
    run = await _persist_main_investigate_run(db_session)

    approved = await client.post(
        f"/runs/{run.run_id}/approve",
        json={},
        headers=headers,
    )
    assert approved.status_code == 200
    assert approved.json()["status"] == "approved"

    mismatch = await client.post(
        "/webmcp/tasks",
        json={
            "run_id": run.run_id,
            "tenant_id": "NorthStar",
            "customer_name": "GreenMart",
        },
        headers=headers,
    )
    assert mismatch.status_code == 422
    assert "does not match the CRM evidence" in mismatch.json()["detail"]

    calls = []

    async def fake_get_or_create_task(db, **kwargs):
        calls.append(kwargs)
        return (
            {
                "created": True,
                "provider": "github",
                "task_id": "GH-200",
                "issue_number": 200,
                "issue_url": "https://github.com/Kitui/Human-led-Agent-/issues/200",
                "repository": "Kitui/Human-led-Agent-",
                "customer": kwargs["customer_name"],
                "team": kwargs["team"],
                "priority": kwargs["priority"],
                "idempotency_key": kwargs["idempotency_key"],
            },
            True,
        )

    monkeypatch.setattr(
        "agent_lab.webmcp_tasks._get_or_create_task",
        fake_get_or_create_task,
    )
    monkeypatch.setattr(
        "agent_lab.webmcp_tasks.GitHubTaskClient.from_env",
        lambda: object(),
    )

    payload = {
        "run_id": run.run_id,
        "tenant_id": "NorthStar",
        "customer_name": "ACME",
    }
    executed = await client.post("/webmcp/tasks", json=payload, headers=headers)

    assert executed.status_code == 200
    body = executed.json()
    assert body["status"] == "completed"
    assert "GitHub Issue #200" in body["execution_result"]
    assert len(calls) == 1
    assert calls[0]["customer_name"] == "ACME"
    assert calls[0]["team"] == "Revenue Support"
    assert calls[0]["priority"] == "high"
    assert calls[0]["description"] == run.action_point.recommended_action

    repeated = await client.post("/webmcp/tasks", json=payload, headers=headers)
    assert repeated.status_code == 200
    assert repeated.json()["status"] == "completed"
    assert len(calls) == 1


def test_main_investigate_frontend_routes_approved_runs_to_tasks_workspace():
    investigate_source = (ROOT / "frontend" / "js" / "investigate.js").read_text(
        encoding="utf-8"
    )
    tasks_source = (ROOT / "frontend" / "js" / "tasks.js").read_text(
        encoding="utf-8"
    )

    approve_section = investigate_source.split("async function doApprove", 1)[1].split(
        "async function doReject",
        1,
    )[0]
    assert 'renderStepper("approved")' in approve_section
    assert 'renderStepper("executing")' not in approve_section
    assert "Open Tasks Workspace" in investigate_source

    assert "renderRuns(runs)" in tasks_source
    assert "Human-approved Correlact Action Points" not in tasks_source
    assert "const webmcpRuns = runs.filter" not in tasks_source
