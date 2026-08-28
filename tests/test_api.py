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
