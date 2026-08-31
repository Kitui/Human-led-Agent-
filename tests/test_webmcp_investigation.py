from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


async def test_clean_investigation_workspace_url(client):
    response = await client.get("/investigation/", follow_redirects=True)

    assert response.status_code == 200
    assert "Investigation Hub" in response.text
    assert "/investigation.css" in response.text
    assert "/js/investigation.js" in response.text
    assert "get_case" in response.text
    assert "get_customer" in response.text
    assert "get_invoice" in response.text
    assert "submit_action_point" in response.text


def test_investigation_hub_registers_all_four_webmcp_tools():
    source = (ROOT / "frontend" / "js" / "investigation.js").read_text(encoding="utf-8")

    assert "registerSupportWebMcpTools" in source
    assert "registerCrmWebMcpTools" in source
    assert "registerBillingWebMcpTools" in source
    assert "registerActionPointWebMcpTool" in source
    assert "registeredCount === 4" in source
    assert "fetchCase(customerName, tenantId)" in source
    assert "fetchCustomer(customerName, tenantId)" in source
    assert "fetchInvoice(customerName, tenantId)" in source


def test_submit_action_point_tool_is_review_only_not_external_execution():
    source = (ROOT / "frontend" / "js" / "webmcp" / "action-point-tools.js").read_text(encoding="utf-8")

    assert 'name: "submit_action_point"' in source
    assert "readOnlyHint: false" in source
    assert 'api("/webmcp/action-points"' in source
    assert "human_approval_required: true" in source
    assert "does not execute any external action" in source


def _action_point_payload(tenant_id="tenant_red"):
    return {
        "tenant_id": tenant_id,
        "issue": "ACME renewal is blocked after an invoice dispute.",
        "title": "Correct ACME disputed invoice before renewal",
        "issue_type": "Billing and renewal",
        "summary": "Support, CRM, and Billing evidence shows a USD 6,000 invoice variance created an open dispute and renewal hold.",
        "priority": "high",
        "recommended_action": "Create a Billing Operations task to correct INV-ACME-2026-08 to the contracted USD 120,000 amount and resolve the dispute before renewal proceeds.",
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


async def test_webmcp_action_point_submission_requires_auth(client):
    response = await client.post("/webmcp/action-points", json=_action_point_payload())

    assert response.status_code == 401


async def test_webmcp_action_point_submission_enforces_tenant_scope(client, auth_headers):
    headers = await auth_headers("red_user", "red-pass-123")

    response = await client.post(
        "/webmcp/action-points",
        json=_action_point_payload("tenant_green"),
        headers=headers,
    )

    assert response.status_code == 403
    assert response.json()["detail"] == "Not authorized for this tenant."


async def test_webmcp_action_point_is_persisted_awaiting_human_approval(client, auth_headers):
    headers = await auth_headers("red_user", "red-pass-123")

    response = await client.post(
        "/webmcp/action-points",
        json=_action_point_payload(),
        headers=headers,
    )

    assert response.status_code == 200
    body = response.json()
    assert body["tenant_id"] == "tenant_red"
    assert body["status"] == "awaiting_approval"
    assert body["action_point"]["requires_human_approval"] is True
    assert body["action_point"]["priority"] == "high"
    assert body["action_point"]["target_team"] == "Billing Operations"
    assert any(event["label"] == "WebMCP Action Point submitted" for event in body["trace"])
    assert sum(event["tag"] == "EVIDENCE" for event in body["trace"]) == 3

    run_response = await client.get(f"/runs/{body['run_id']}", headers=headers)
    assert run_response.status_code == 200
    assert run_response.json()["status"] == "awaiting_approval"
