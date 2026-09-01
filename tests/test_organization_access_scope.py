from datetime import datetime, timezone
from pathlib import Path
import shutil
import subprocess

import pytest

from agent_lab.models import EvalSuiteRun


ROOT = Path(__file__).resolve().parents[1]
SETTINGS_JS = ROOT / "frontend" / "js" / "settings.js"


async def test_northstar_user_only_lists_northstar(client, auth_headers):
    headers = await auth_headers("user@northstar.com", "northstar-test-pass")

    response = await client.get("/tenants", headers=headers)

    assert response.status_code == 200
    assert [tenant["slug"] for tenant in response.json()] == ["NorthStar"]


async def test_neptune_user_only_lists_neptune(client, auth_headers):
    headers = await auth_headers("user@neptune.com", "neptune-test-pass")

    response = await client.get("/tenants", headers=headers)

    assert response.status_code == 200
    assert [tenant["slug"] for tenant in response.json()] == ["Neptune"]


async def test_organization_user_cannot_create_organization(client, auth_headers):
    headers = await auth_headers("user@northstar.com", "northstar-test-pass")

    response = await client.post(
        "/tenants",
        json={"slug": "Atlas", "environment": "Production"},
        headers=headers,
    )

    assert response.status_code == 403
    assert response.json()["detail"] == "Platform administrator access required."


async def test_organization_user_cannot_deactivate_own_organization(client, auth_headers):
    headers = await auth_headers("user@northstar.com", "northstar-test-pass")

    response = await client.patch(
        "/tenants/NorthStar",
        json={"is_active": False},
        headers=headers,
    )

    assert response.status_code == 403
    assert response.json()["detail"] == "Platform administrator access required."


async def test_organization_user_cannot_update_own_organization_settings(client, auth_headers):
    """The model, system prompt, and runtime limits configured here affect
    every user of the organization, including the shared public demo
    accounts, so even a member of the organization cannot write to its own
    settings -- only the platform administrator can."""
    headers = await auth_headers("user@northstar.com", "northstar-test-pass")

    response = await client.patch(
        "/tenants/NorthStar/settings",
        json={"max_steps": 10},
        headers=headers,
    )

    assert response.status_code == 403
    assert response.json()["detail"] == "Platform administrator access required."


async def test_organization_user_cannot_run_live_evals(client, auth_headers):
    """POST /evals/run makes 15 real, paid OpenAI calls per invocation, so it
    must be platform-admin-only -- this endpoint had zero test coverage of
    that gate before this test existed."""
    headers = await auth_headers("user@northstar.com", "northstar-test-pass")

    response = await client.post("/evals/run", headers=headers)

    assert response.status_code == 403
    assert response.json()["detail"] == "Platform administrator access required."


async def test_platform_admin_can_run_live_evals(client, auth_headers, monkeypatch):
    """Confirms the admin gate actually lets the admin through to
    run_eval_suite. run_eval_suite itself is mocked so this unit test never
    makes a real, paid OpenAI call -- the live suite is exercised for real by
    the separate `python evals/evals.py` CI step."""
    headers = await auth_headers("admin@correlact.com", "correlact-admin-test-pass")

    calls = []

    async def fake_run_eval_suite(db):
        calls.append(db)
        return EvalSuiteRun(
            run_id="fake-eval-run",
            started_at=datetime.now(timezone.utc),
            duration_seconds=0.01,
            cases=[],
            passed_count=0,
            total_count=0,
            score=0.0,
            threshold=98.0,
            result="passed",
        )

    monkeypatch.setattr("agent_lab.api.run_eval_suite", fake_run_eval_suite)

    response = await client.post("/evals/run", headers=headers)

    assert response.status_code == 200
    assert response.json()["run_id"] == "fake-eval-run"
    assert len(calls) == 1


async def test_platform_admin_lists_and_manages_all_organizations(client, auth_headers):
    headers = await auth_headers("admin@correlact.com", "correlact-admin-test-pass")

    list_response = await client.get("/tenants", headers=headers)
    assert list_response.status_code == 200
    assert {tenant["slug"] for tenant in list_response.json()} >= {"NorthStar", "Neptune"}

    create_response = await client.post(
        "/tenants",
        json={"slug": "Atlas", "environment": "Sandbox"},
        headers=headers,
    )
    assert create_response.status_code == 200
    assert create_response.json()["slug"] == "Atlas"

    settings_response = await client.get("/tenants/Atlas/settings", headers=headers)
    assert settings_response.status_code == 200


def test_settings_ui_hides_platform_controls_for_org_users():
    source = SETTINGS_JS.read_text(encoding="utf-8")

    assert "isPlatformAdmin" in source
    assert 'addButton.classList.toggle("hidden", !admin)' in source
    assert 'if (!isPlatformAdmin()) return;' in source
    assert 'heading.textContent = admin ? "Organization Management" : "Organization Access"' in source
    assert "Organization-scoped access." in source
    assert "operational-item" in source
    assert "settings-access-note" in source


def test_platform_admin_check_is_defined_once_and_shared():
    """evals.js and settings.js used to each define their own copy of
    PLATFORM_ADMIN_USERNAME and an admin-comparison function -- a real risk
    of silent divergence if the admin account is ever renamed. Both now
    import a single shared isPlatformAdmin() from shared.js."""
    shared_source = (ROOT / "frontend" / "js" / "shared.js").read_text(encoding="utf-8")
    evals_source = (ROOT / "frontend" / "js" / "evals.js").read_text(encoding="utf-8")
    settings_source = SETTINGS_JS.read_text(encoding="utf-8")

    assert 'export const PLATFORM_ADMIN_USERNAME = "admin@correlact.com";' in shared_source
    assert "export function isPlatformAdmin()" in shared_source
    assert "PLATFORM_ADMIN_USERNAME" not in evals_source
    assert "PLATFORM_ADMIN_USERNAME" not in settings_source
    assert "isPlatformAdmin" in evals_source
    assert "isPlatformAdmin" in settings_source


def test_settings_forms_are_read_only_for_non_admin_organization_users():
    """The General Settings and Model & Prompt save buttons must be disabled
    client-side for non-admins so they never hit the backend's 403 -- mirrors
    the same pattern already used for the live eval run button."""
    source = SETTINGS_JS.read_text(encoding="utf-8")

    assert "function applySettingsFormAdminAccess()" in source
    assert '#settings-general-save-btn' in source
    assert '#settings-model-save-btn' in source
    assert "btn.disabled = !admin" in source
    assert "Platform administrator access required to change organization settings." in source
    assert "applySettingsFormAdminAccess();" in source

    index_html = (ROOT / "frontend" / "index.html").read_text(encoding="utf-8")
    assert 'id="settings-forms-access-note"' in index_html


def test_settings_javascript_parses_after_scope_and_ux_update():
    node = shutil.which("node")
    if node is None:
        pytest.skip("node is not installed")

    subprocess.run(
        [node, "--check", str(SETTINGS_JS)],
        check=True,
        capture_output=True,
        text=True,
    )
