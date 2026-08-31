from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def _action_point_payload(tenant_id="tenant_red"):
    return {
        "tenant_id": tenant_id,
        "issue": "ACME renewal is blocked after an invoice dispute.",
        "title": "Correct ACME disputed invoice before renewal",
        "issue_type": "Billing and renewal",
        "summary": "Support, CRM, and Billing evidence shows a USD 6,000 invoice variance created an open dispute and renewal hold.",
        "priority": "high",
        "recommended_action": "Correct INV-ACME-2026-08 to the contracted USD 120,000 amount and resolve the dispute before renewal proceeds.",
        "confidence": 0.99,
        "target_team": "Billing Operations",
        "evidence": [
            {
                "source": "support",
                "reference": "CASE-ACME-8841",
                "finding": "Customer reports the invoice amount is wrong and renewal is blocked.",
            },
            {
                "source": "crm",
                "reference": "ACME",
                "finding": "Account is active; billing is invoice_dispute and renewal is blocked.",
            },
            {
                "source": "billing",
                "reference": "INV-ACME-2026-08",
                "finding": "Billed amount is USD 126,000 vs USD 120,000 contract; dispute is open and renewal_hold is true.",
            },
        ],
    }


async def _submit_webmcp_action_point(client, headers):
    response = await client.post(
        "/webmcp/action-points",
        json=_action_point_payload(),
        headers=headers,
    )
    assert response.status_code == 200
    return response.json()


async def test_clean_tasks_workspace_url(client):
    response = await client.get("/tasks/", follow_redirects=True)

    assert response.status_code == 200
    assert "Tasks Workspace" in response.text
    assert "create_task" in response.text
    assert "/tasks.css" in response.text
    assert "/js/tasks.js" in response.text


def test_tasks_workspace_registers_write_tool_and_calls_controlled_backend():
    source = (ROOT / "frontend" / "js" / "webmcp" / "task-tools.js").read_text(encoding="utf-8")

    assert 'name: "create_task"' in source
    assert "readOnlyHint: false" in source
    assert 'api("/webmcp/tasks"' in source
    assert "already been approved by a human" in source
    assert 'required: ["run_id", "tenant_id", "customer_name"]' in source


def test_tasks_workspace_refreshes_after_webmcp_execution():
    tool_source = (ROOT / "frontend" / "js" / "webmcp" / "task-tools.js").read_text(encoding="utf-8")
    workspace_source = (ROOT / "frontend" / "js" / "tasks.js").read_text(encoding="utf-8")

    assert 'export const TASK_EXECUTED_EVENT = "correlact:task-executed"' in tool_source
    assert "notifyTaskExecuted(result);" in tool_source
    assert "window.dispatchEvent(new CustomEvent(TASK_EXECUTED_EVENT" in tool_source
    assert "window.addEventListener(TASK_EXECUTED_EVENT" in workspace_source
    assert "showExecutionSuccess(event.detail);" in workspace_source
    assert "await loadApprovedRuns();" in workspace_source


def test_approval_evidence_excludes_task_execution_results():
    source = (ROOT / "frontend" / "js" / "approvals.js").read_text(encoding="utf-8")

    assert 'event.tag === "EVIDENCE"' in source
    assert "if (parsed.created) return" in source
    assert '"approved", "completed"' in source
    assert "Waiting for WebMCP create_task" in source


async def test_webmcp_action_point_approval_defers_external_execution(client, auth_headers):
    headers = await auth_headers("red_user", "red-pass-123")
    submitted = await _submit_webmcp_action_point(client, headers)

    response = await client.post(
        f"/runs/{submitted['run_id']}/approve",
        json={"comment": "Approved for controlled task creation."},
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


async def test_webmcp_create_task_rejects_unapproved_run(client, auth_headers):
    headers = await auth_headers("red_user", "red-pass-123")
    submitted = await _submit_webmcp_action_point(client, headers)

    response = await client.post(
        "/webmcp/tasks",
        json={
            "run_id": submitted["run_id"],
            "tenant_id": "tenant_red",
            "customer_name": "ACME",
        },
        headers=headers,
    )

    assert response.status_code == 409
    assert "Human approval is required first" in response.json()["detail"]


async def test_webmcp_create_task_enforces_customer_evidence_boundary(client, auth_headers):
    headers = await auth_headers("red_user", "red-pass-123")
    submitted = await _submit_webmcp_action_point(client, headers)
    await client.post(f"/runs/{submitted['run_id']}/approve", json={}, headers=headers)

    response = await client.post(
        "/webmcp/tasks",
        json={
            "run_id": submitted["run_id"],
            "tenant_id": "tenant_red",
            "customer_name": "GreenMart",
        },
        headers=headers,
    )

    assert response.status_code == 422
    assert "does not match the CRM evidence" in response.json()["detail"]


async def test_webmcp_create_task_executes_approved_scope_once(client, auth_headers, monkeypatch):
    headers = await auth_headers("red_user", "red-pass-123")
    submitted = await _submit_webmcp_action_point(client, headers)
    approved = await client.post(f"/runs/{submitted['run_id']}/approve", json={}, headers=headers)
    assert approved.status_code == 200
    assert approved.json()["status"] == "approved"

    calls = []

    async def fake_get_or_create_task(db, **kwargs):
        calls.append(kwargs)
        return (
            {
                "created": True,
                "provider": "github",
                "task_id": "GH-101",
                "issue_number": 101,
                "issue_url": "https://github.com/Kitui/Human-led-Agent-/issues/101",
                "repository": "Kitui/Human-led-Agent-",
                "customer": kwargs["customer_name"],
                "team": kwargs["team"],
                "priority": kwargs["priority"],
                "idempotency_key": kwargs["idempotency_key"],
            },
            True,
        )

    monkeypatch.setattr("agent_lab.webmcp_tasks._get_or_create_task", fake_get_or_create_task)
    monkeypatch.setattr("agent_lab.webmcp_tasks.GitHubTaskClient.from_env", lambda: object())

    payload = {
        "run_id": submitted["run_id"],
        "tenant_id": "tenant_red",
        "customer_name": "ACME",
    }
    response = await client.post("/webmcp/tasks", json=payload, headers=headers)

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "completed"
    assert body["idempotency_key"]
    assert "GitHub Issue #101" in body["execution_result"]
    assert len(calls) == 1
    assert calls[0]["customer_name"] == "ACME"
    assert calls[0]["team"] == "Billing Operations"
    assert calls[0]["priority"] == "high"
    assert calls[0]["description"] == submitted["action_point"]["recommended_action"]
    assert any(event["tag"] == "WEBMCP_WRITE" for event in body["trace"])
    assert any(event["tag"] == "EXECUTION_RESULT" for event in body["trace"])

    repeated = await client.post("/webmcp/tasks", json=payload, headers=headers)
    assert repeated.status_code == 200
    assert repeated.json()["status"] == "completed"
    assert len(calls) == 1
