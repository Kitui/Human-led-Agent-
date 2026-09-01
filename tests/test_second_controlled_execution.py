from sqlalchemy import func, select

from agent_lab.db_models import ExecutedActionORM


def crm_action_payload(*, tenant_id="NorthStar", customer="ACME"):
    return {
        "tenant_id": tenant_id,
        "issue": f"{customer} renewal requires a governed CRM escalation.",
        "title": f"Escalate {customer} renewal in CRM",
        "issue_type": "Renewal follow-up",
        "summary": "CRM evidence shows the renewal is blocked and needs an explicit escalation status before follow-up.",
        "priority": "high",
        "recommended_action": "Update the CRM renewal status from blocked to escalation_open so the approved follow-up is visible to the account team.",
        "confidence": 0.99,
        "target_team": "Account Management",
        "execution": {
            "type": "update_crm_status",
            "crm_expected_status": "blocked",
            "crm_target_status": "escalation_open",
        },
        "evidence": [
            {
                "source": "crm",
                "reference": customer,
                "finding": "Account is active and renewal_status is blocked.",
            }
        ],
    }


async def _northstar_headers(auth_headers):
    return await auth_headers("user@northstar.com", "northstar-test-pass")


async def _submit_crm_action(client, headers):
    response = await client.post(
        "/webmcp/action-points",
        json=crm_action_payload(),
        headers=headers,
    )
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "awaiting_approval"
    assert body["action_point"]["execution"] == {
        "type": "update_crm_status",
        "crm_expected_status": "blocked",
        "crm_target_status": "escalation_open",
    }
    return body


async def _crm_customer(client, headers, name="ACME", tenant_id="NorthStar"):
    response = await client.get(
        f"/crm/customers/{name}?tenant_id={tenant_id}",
        headers=headers,
    )
    assert response.status_code == 200
    return response.json()["customer"]


async def test_crm_write_is_blocked_until_human_approval(client, auth_headers):
    headers = await _northstar_headers(auth_headers)
    submitted = await _submit_crm_action(client, headers)

    before = await _crm_customer(client, headers)
    assert before["renewal_status"] == "blocked"

    response = await client.post(
        "/webmcp/tasks",
        json={
            "run_id": submitted["run_id"],
            "tenant_id": "NorthStar",
            "customer_name": "ACME",
        },
        headers=headers,
    )

    assert response.status_code == 409
    assert "Human approval is required first" in response.json()["detail"]
    after = await _crm_customer(client, headers)
    assert after["renewal_status"] == "blocked"


async def test_approval_alone_does_not_mutate_crm(client, auth_headers):
    headers = await _northstar_headers(auth_headers)
    submitted = await _submit_crm_action(client, headers)

    approved = await client.post(
        f"/runs/{submitted['run_id']}/approve",
        json={"comment": "Approved only for the exact CRM transition shown."},
        headers=headers,
    )
    assert approved.status_code == 200
    body = approved.json()
    assert body["status"] == "approved"
    assert body["execution_result"] is None
    assert "update_crm_status" in next(
        event["detail"]
        for event in body["trace"]
        if event["tag"] == "HUMAN_APPROVAL"
    )

    customer = await _crm_customer(client, headers)
    assert customer["renewal_status"] == "blocked"


async def test_approved_crm_write_mutates_once_and_is_idempotent(
    client,
    auth_headers,
    db_session,
):
    headers = await _northstar_headers(auth_headers)
    submitted = await _submit_crm_action(client, headers)
    approved = await client.post(
        f"/runs/{submitted['run_id']}/approve",
        json={},
        headers=headers,
    )
    assert approved.status_code == 200

    payload = {
        "run_id": submitted["run_id"],
        "tenant_id": "NorthStar",
        "customer_name": "ACME",
    }
    executed = await client.post("/webmcp/tasks", json=payload, headers=headers)
    assert executed.status_code == 200
    body = executed.json()
    assert body["status"] == "completed"
    assert body["idempotency_key"]
    assert "blocked to escalation_open" in body["execution_result"]
    assert any(
        event["label"] == "WebMCP update_crm_status result received"
        and event["tag"] == "EXECUTION_RESULT"
        for event in body["trace"]
    )

    customer = await _crm_customer(client, headers)
    assert customer["renewal_status"] == "escalation_open"

    count = await db_session.scalar(
        select(func.count())
        .select_from(ExecutedActionORM)
        .where(ExecutedActionORM.idempotency_key == body["idempotency_key"])
    )
    assert count == 1

    repeated = await client.post("/webmcp/tasks", json=payload, headers=headers)
    assert repeated.status_code == 200
    assert repeated.json()["idempotency_key"] == body["idempotency_key"]
    customer_again = await _crm_customer(client, headers)
    assert customer_again["renewal_status"] == "escalation_open"

    count_again = await db_session.scalar(
        select(func.count())
        .select_from(ExecutedActionORM)
        .where(ExecutedActionORM.idempotency_key == body["idempotency_key"])
    )
    assert count_again == 1


async def test_crm_write_rejects_cross_organization_and_mismatched_customer(
    client,
    auth_headers,
):
    northstar = await _northstar_headers(auth_headers)
    submitted = await _submit_crm_action(client, northstar)
    await client.post(
        f"/runs/{submitted['run_id']}/approve",
        json={},
        headers=northstar,
    )

    neptune = await auth_headers("user@neptune.com", "neptune-test-pass")
    cross_org = await client.post(
        "/webmcp/tasks",
        json={
            "run_id": submitted["run_id"],
            "tenant_id": "NorthStar",
            "customer_name": "ACME",
        },
        headers=neptune,
    )
    assert cross_org.status_code == 403

    wrong_customer = await client.post(
        "/webmcp/tasks",
        json={
            "run_id": submitted["run_id"],
            "tenant_id": "NorthStar",
            "customer_name": "GreenMart",
        },
        headers=northstar,
    )
    assert wrong_customer.status_code == 422
    assert "does not match the CRM evidence" in wrong_customer.json()["detail"]


async def test_crm_transition_must_be_frozen_and_allowlisted_before_review(
    client,
    auth_headers,
):
    headers = await _northstar_headers(auth_headers)
    payload = crm_action_payload()
    payload["execution"]["crm_target_status"] = "follow_up_required"

    response = await client.post(
        "/webmcp/action-points",
        json=payload,
        headers=headers,
    )

    assert response.status_code == 422
    assert response.json()["detail"] == "CRM status transition is not allowed."


def test_webmcp_surface_registers_two_distinct_controlled_write_tools():
    from pathlib import Path

    root = Path(__file__).resolve().parents[1]
    task_tools = (root / "frontend" / "js" / "webmcp" / "task-tools.js").read_text(encoding="utf-8")
    action_tools = (root / "frontend" / "js" / "webmcp" / "action-point-tools.js").read_text(encoding="utf-8")
    tasks_ui = (root / "frontend" / "js" / "tasks.js").read_text(encoding="utf-8")

    assert 'name: "create_task"' in task_tools
    assert 'name: "update_crm_status"' in task_tools
    assert "executeApprovedCrmStatus" in task_tools
    assert "approvedRun" in task_tools and "actualType !== expectedType" in task_tools
    assert 'enum: ["create_task", "update_crm_status"]' in action_tools
    assert "crm_expected_status" in action_tools
    assert "crm_target_status" in action_tools
    assert "executionTypes" in tasks_ui
    assert "update_crm_status" in tasks_ui
