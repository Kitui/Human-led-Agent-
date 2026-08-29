async def test_list_tenants_includes_seeded_defaults(client, auth_headers):
    headers = await auth_headers("admin_user", "admin-pass-123")

    response = await client.get("/tenants", headers=headers)

    assert response.status_code == 200
    slugs = {t["slug"] for t in response.json()}
    assert {"tenant_red", "tenant_green"}.issubset(slugs)


async def test_create_tenant_appears_in_the_list(client, auth_headers):
    headers = await auth_headers("admin_user", "admin-pass-123")

    create_response = await client.post(
        "/tenants",
        json={"slug": "tenant_blue", "environment": "Staging"},
        headers=headers,
    )
    assert create_response.status_code == 200
    body = create_response.json()
    assert body["slug"] == "tenant_blue"
    assert body["environment"] == "Staging"
    assert body["is_active"] is True

    list_response = await client.get("/tenants", headers=headers)
    slugs = {t["slug"] for t in list_response.json()}
    assert "tenant_blue" in slugs


async def test_creating_a_duplicate_tenant_slug_fails(client, auth_headers):
    headers = await auth_headers("admin_user", "admin-pass-123")

    response = await client.post(
        "/tenants",
        json={"slug": "tenant_red", "environment": "Production"},
        headers=headers,
    )

    assert response.status_code == 409


async def test_deactivating_a_tenant_updates_its_status(client, auth_headers):
    headers = await auth_headers("admin_user", "admin-pass-123")

    response = await client.patch(
        "/tenants/tenant_red",
        json={"is_active": False},
        headers=headers,
    )

    assert response.status_code == 200
    assert response.json()["is_active"] is False


async def test_deactivating_another_users_tenant_is_forbidden(client, auth_headers):
    headers = await auth_headers("red_user", "red-pass-123")

    response = await client.patch(
        "/tenants/tenant_green",
        json={"is_active": False},
        headers=headers,
    )

    assert response.status_code == 403


async def test_reading_another_users_tenant_settings_is_forbidden(client, auth_headers):
    headers = await auth_headers("red_user", "red-pass-123")

    response = await client.get("/tenants/tenant_green/settings", headers=headers)

    assert response.status_code == 403


async def test_updating_another_users_tenant_settings_is_forbidden(client, auth_headers):
    headers = await auth_headers("red_user", "red-pass-123")

    response = await client.patch(
        "/tenants/tenant_green/settings",
        json={"max_steps": 10},
        headers=headers,
    )

    assert response.status_code == 403


async def test_admin_user_can_still_manage_both_seeded_tenants(client, auth_headers):
    headers = await auth_headers("admin_user", "admin-pass-123")

    settings_response = await client.get("/tenants/tenant_green/settings", headers=headers)
    assert settings_response.status_code == 200

    update_response = await client.patch(
        "/tenants/tenant_green/settings",
        json={"max_steps": 8},
        headers=headers,
    )
    assert update_response.status_code == 200
    assert update_response.json()["max_steps"] == 8


async def test_investigate_rejects_a_deactivated_tenant_before_agent_call(client, auth_headers):
    headers = await auth_headers("admin_user", "admin-pass-123")

    deactivate_response = await client.patch(
        "/tenants/tenant_red",
        json={"is_active": False},
        headers=headers,
    )
    assert deactivate_response.status_code == 200

    response = await client.post(
        "/investigate",
        json={"tenant_id": "tenant_red", "issue": "ACME renewal is blocked."},
        headers=headers,
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "Invalid tenant."
