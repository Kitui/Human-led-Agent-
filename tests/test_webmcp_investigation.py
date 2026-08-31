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


def test_investigation_hub_registers_all_three_webmcp_sources():
    source = (ROOT / "frontend" / "js" / "investigation.js").read_text(encoding="utf-8")

    assert "registerSupportWebMcpTools" in source
    assert "registerCrmWebMcpTools" in source
    assert "registerBillingWebMcpTools" in source
    assert "registeredCount === 3" in source
    assert "fetchCase(customerName, tenantId)" in source
    assert "fetchCustomer(customerName, tenantId)" in source
    assert "fetchInvoice(customerName, tenantId)" in source
