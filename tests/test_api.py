async def test_health(client):
    response = await client.get("/health")

    assert response.status_code == 200
    assert response.json()["status"] == "ok"


async def test_clean_crm_workspace_url(client):
    response = await client.get("/crm/", follow_redirects=True)

    assert response.status_code == 200
    assert "CRM Workspace" in response.text
    assert "/crm.css" in response.text
    assert "/js/crm.js" in response.text


async def test_invalid_organization_is_rejected_before_agent_call(client, auth_headers):
    headers = await auth_headers("admin@correlact.com", "correlact-admin-test-pass")

    response = await client.post(
        "/investigate",
        json={
            "tenant_id": "organization_unknown",
            "issue": "ACME renewal is blocked.",
        },
        headers=headers,
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "Invalid tenant."


async def test_list_runs_returns_a_list(client, auth_headers):
    headers = await auth_headers("admin@correlact.com", "correlact-admin-test-pass")

    response = await client.get("/runs", headers=headers)

    assert response.status_code == 200
    assert isinstance(response.json(), list)


async def test_list_runs_rejects_invalid_status(client, auth_headers):
    headers = await auth_headers("admin@correlact.com", "correlact-admin-test-pass")

    response = await client.get(
        "/runs",
        params={"status": "not_a_status"},
        headers=headers,
    )

    assert response.status_code == 422


async def test_crm_customer_lookup_requires_auth(client):
    response = await client.get(
        "/crm/customers/ACME",
        params={"tenant_id": "NorthStar"},
    )

    assert response.status_code == 401


async def test_crm_customer_lookup_returns_authorized_customer(client, auth_headers):
    headers = await auth_headers("user@northstar.com", "northstar-test-pass")

    response = await client.get(
        "/crm/customers/ACME",
        params={"tenant_id": "NorthStar"},
        headers=headers,
    )

    assert response.status_code == 200
    body = response.json()
    assert body["found"] is True
    assert body["customer"]["name"] == "ACME"
    assert body["customer"]["tenant_id"] == "NorthStar"
    assert body["customer"]["renewal_status"] == "blocked"


async def test_crm_customer_lookup_enforces_organization_scope(client, auth_headers):
    headers = await auth_headers("user@northstar.com", "northstar-test-pass")

    response = await client.get(
        "/crm/customers/GreenMart",
        params={"tenant_id": "Neptune"},
        headers=headers,
    )

    assert response.status_code == 403
    assert response.json()["detail"] == "Not authorized for this tenant."


async def test_crm_customer_lookup_does_not_return_cross_organization_data(
    client,
    auth_headers,
):
    headers = await auth_headers("user@northstar.com", "northstar-test-pass")

    response = await client.get(
        "/crm/customers/GreenMart",
        params={"tenant_id": "NorthStar"},
        headers=headers,
    )

    assert response.status_code == 403
    assert response.json()["detail"] == "Customer is not available in this tenant."
