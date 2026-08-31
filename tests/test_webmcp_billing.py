from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


async def test_clean_billing_workspace_url(client):
    response = await client.get("/billing/", follow_redirects=True)

    assert response.status_code == 200
    assert "Billing Workspace" in response.text
    assert "/billing.css" in response.text
    assert "/js/billing.js" in response.text
    assert "get_invoice" in response.text


def test_billing_webmcp_tool_is_declared_read_only():
    source = (
        ROOT / "frontend" / "js" / "webmcp" / "billing-tools.js"
    ).read_text(encoding="utf-8")

    assert "document.modelContext.registerTool" in source
    assert 'name: "get_invoice"' in source
    assert "readOnlyHint: true" in source
    assert 'required: ["customer_name", "tenant_id"]' in source
    assert 'source: "billing"' in source
    assert 'tenant_id: "NorthStar"' in source
    assert 'tenant_id: "Neptune"' in source
    assert "tenant_red" not in source
    assert "tenant_green" not in source
