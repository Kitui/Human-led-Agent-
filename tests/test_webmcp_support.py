from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


async def test_clean_support_workspace_url(client):
    response = await client.get("/support/", follow_redirects=True)

    assert response.status_code == 200
    assert "Support Workspace" in response.text
    assert "/support.css" in response.text
    assert "/js/support.js" in response.text
    assert "get_case" in response.text


def test_support_webmcp_tool_is_declared_read_only():
    source = (ROOT / "frontend" / "js" / "webmcp" / "support-tools.js").read_text(encoding="utf-8")

    assert "document.modelContext.registerTool" in source
    assert 'name: "get_case"' in source
    assert "readOnlyHint: true" in source
    assert 'required: ["customer_name", "tenant_id"]' in source
    assert 'source: "support"' in source
    assert 'case_id: "CASE-ACME-8841"' in source
