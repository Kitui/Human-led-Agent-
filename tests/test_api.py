async def test_health(client):
    response = await client.get("/health")

    assert response.status_code == 200
    assert response.json()["status"] == "ok"


async def test_invalid_tenant_is_rejected_before_agent_call(client, auth_headers):
    headers = await auth_headers("admin_user", "admin-pass-123")

    response = await client.post(
        "/investigate",
        json={
            "tenant_id": "tenant_unknown",
            "issue": "ACME renewal is blocked.",
        },
        headers=headers,
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "Invalid tenant."


async def test_list_runs_returns_a_list(client, auth_headers):
    headers = await auth_headers("admin_user", "admin-pass-123")

    response = await client.get("/runs", headers=headers)

    assert response.status_code == 200
    assert isinstance(response.json(), list)


async def test_list_runs_rejects_invalid_status(client, auth_headers):
    headers = await auth_headers("admin_user", "admin-pass-123")

    response = await client.get("/runs", params={"status": "not_a_status"}, headers=headers)

    assert response.status_code == 422


async def test_crm_customer_lookup_requires_auth(client):
    response = await client.get(
        "/crm/customers/ACME",
        params={"tenant_id": "tenant_red"},
    )

    assert response.status_code == 401


async def test_crm_customer_lookup_returns_authorized_customer(client, auth_headers):
    headers = await auth_headers("red_user", "red-pass-123")

    response = await client.get(
        "/crm/customers/ACME",
        params={"tenant_id": "tenant_red"},
        headers=headers,
    )

    assert response.status_code == 200
    body = response.json()
    assert body["found"] is True
    assert body["customer"]["name"] == "ACME"
    assert body["customer"]["tenant_id"] == "tenant_red"
    assert body["customer"]["renewal_status"] == "blocked"


async def test_crm_customer_lookup_enforces_tenant_scope(client, auth_headers):
    headers = await auth_headers("red_user", "red-pass-123")

    response = await client.get(
        "/crm/customers/GreenMart",
        params={"tenant_id": "tenant_green"},
        headers=headers,
    )

    assert response.status_code == 403
    assert response.json()["detail"] == "Not authorized for this tenant."


async def test_crm_customer_lookup_does_not_return_cross_tenant_data(client, auth_headers):
    headers = await auth_headers("red_user", "red-pass-123")

    response = await client.get(
        "/crm/customers/GreenMart",
        params={"tenant_id": "tenant_red"},
        headers=headers,
    )

    assert response.status_code == 403
    assert response.json()["detail"] == "Customer is not available in this tenant."
