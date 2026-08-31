async def test_login_succeeds_with_correct_credentials(client):
    response = await client.post(
        "/auth/login",
        json={"username": "red_user", "password": "red-pass-123"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["token_type"] == "bearer"
    assert body["tenant_ids"] == ["tenant_red"]
    assert body["access_token"]


async def test_login_sets_shared_browser_cookie(client):
    response = await client.post(
        "/auth/login",
        json={"username": "red_user", "password": "red-pass-123"},
    )

    cookie = response.headers.get("set-cookie", "")
    assert "hlal_session=" in cookie
    assert "HttpOnly" in cookie
    assert "SameSite=lax" in cookie
    assert "Path=/" in cookie


async def test_browser_session_can_restore_without_bearer_header(client):
    login_response = await client.post(
        "/auth/login",
        json={"username": "red_user", "password": "red-pass-123"},
    )
    assert login_response.status_code == 200

    response = await client.get("/auth/session")

    assert response.status_code == 200
    body = response.json()
    assert body["username"] == "red_user"
    assert body["tenant_ids"] == ["tenant_red"]
    assert body["access_token"]


async def test_logout_clears_shared_browser_cookie(client):
    login_response = await client.post(
        "/auth/login",
        json={"username": "red_user", "password": "red-pass-123"},
    )
    assert login_response.status_code == 200

    logout_response = await client.post("/auth/logout")
    assert logout_response.status_code == 200
    assert logout_response.json()["status"] == "ok"

    response = await client.get("/auth/session")
    assert response.status_code == 401


async def test_login_fails_with_wrong_password(client):
    response = await client.post(
        "/auth/login",
        json={"username": "red_user", "password": "wrong-password"},
    )

    assert response.status_code == 401


async def test_login_fails_with_unknown_username(client):
    response = await client.post(
        "/auth/login",
        json={"username": "nobody", "password": "whatever"},
    )

    assert response.status_code == 401


async def test_investigate_requires_authentication(client):
    response = await client.post(
        "/investigate",
        json={"tenant_id": "tenant_red", "issue": "ACME renewal is blocked."},
    )

    assert response.status_code == 401


async def test_list_runs_requires_authentication(client):
    response = await client.get("/runs")

    assert response.status_code == 401


async def test_approve_requires_authentication(client):
    response = await client.post("/runs/some-run-id/approve")

    assert response.status_code == 401


async def test_user_cannot_investigate_a_tenant_they_are_not_assigned_to(client, auth_headers):
    headers = await auth_headers("red_user", "red-pass-123")

    response = await client.post(
        "/investigate",
        json={"tenant_id": "tenant_green", "issue": "ACME renewal is blocked."},
        headers=headers,
    )

    assert response.status_code == 403
