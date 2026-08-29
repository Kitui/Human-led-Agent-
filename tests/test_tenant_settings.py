import logging

import pytest

from agent_lab import workflow
from agent_lab.agent import (
    build_execution_agent,
    build_investigator_agent,
    resolve_investigator_instructions,
    resolve_system_prompt,
    SYSTEM_PROMPT,
)
from agent_lab.models import TenantSettings
from agent_lab.tenant_settings import update_settings
from agent_lab.workflow import TooManyConcurrentRunsError, _apply_log_level, investigate_issue


# --- HTTP-level: defaults, persistence, prompt_version ---

async def test_default_settings_match_hardcoded_behavior(client, auth_headers):
    headers = await auth_headers("admin_user", "admin-pass-123")

    response = await client.get("/tenants/tenant_red/settings", headers=headers)

    assert response.status_code == 200
    body = response.json()
    assert body["max_steps"] == 5
    assert body["retry_limit"] == 3
    assert body["default_model"] is None
    assert body["log_level"] == "Info"
    assert body["default_language"] == "English (US)"
    assert body["default_timezone"] == "UTC"
    assert body["max_concurrent_runs"] == 20
    assert body["system_prompt_override"] is None
    assert body["prompt_version"] == 1
    assert body["auto_update_prompt"] is True


async def test_updating_settings_persists_and_is_reflected_in_a_subsequent_get(client, auth_headers):
    headers = await auth_headers("admin_user", "admin-pass-123")

    patch_response = await client.patch(
        "/tenants/tenant_green/settings",
        json={"max_steps": 2, "log_level": "Debug"},
        headers=headers,
    )
    assert patch_response.status_code == 200
    assert patch_response.json()["max_steps"] == 2
    assert patch_response.json()["log_level"] == "Debug"
    # untouched field stays at default -- proves partial-update semantics
    assert patch_response.json()["retry_limit"] == 3

    get_response = await client.get("/tenants/tenant_green/settings", headers=headers)
    assert get_response.json()["max_steps"] == 2


async def test_settings_for_unknown_tenant_is_404(client, auth_headers):
    headers = await auth_headers("admin_user", "admin-pass-123")

    response = await client.get("/tenants/tenant_unknown/settings", headers=headers)

    assert response.status_code == 404


async def test_prompt_version_increments_only_when_override_text_changes(client, auth_headers):
    headers = await auth_headers("admin_user", "admin-pass-123")

    first = await client.patch(
        "/tenants/tenant_red/settings", json={"system_prompt_override": "Be terse."}, headers=headers,
    )
    assert first.json()["prompt_version"] == 2

    same_again = await client.patch(
        "/tenants/tenant_red/settings", json={"system_prompt_override": "Be terse."}, headers=headers,
    )
    assert same_again.json()["prompt_version"] == 2  # no bump -- unchanged text

    changed = await client.patch(
        "/tenants/tenant_red/settings", json={"system_prompt_override": "Be verbose."}, headers=headers,
    )
    assert changed.json()["prompt_version"] == 3


# --- Pure-function level: prompt override / auto-update / language ---
# No DB, no agent call -- these are isolated functions from agent.py.

def test_auto_update_prompt_true_ignores_override():
    settings = TenantSettings(tenant_slug="t", auto_update_prompt=True, system_prompt_override="Custom.")
    assert resolve_system_prompt(settings) == SYSTEM_PROMPT


def test_auto_update_prompt_false_uses_override():
    settings = TenantSettings(tenant_slug="t", auto_update_prompt=False, system_prompt_override="Custom.")
    assert resolve_system_prompt(settings) == "Custom."


def test_auto_update_prompt_false_with_no_override_falls_back_to_default():
    settings = TenantSettings(tenant_slug="t", auto_update_prompt=False, system_prompt_override=None)
    assert resolve_system_prompt(settings) == SYSTEM_PROMPT


def test_default_language_appends_no_instruction():
    settings = TenantSettings(tenant_slug="t", default_language="English (US)")
    assert resolve_investigator_instructions(settings) == SYSTEM_PROMPT


def test_non_default_language_appends_instruction():
    settings = TenantSettings(tenant_slug="t", default_language="French")
    result = resolve_investigator_instructions(settings)
    assert result.startswith(SYSTEM_PROMPT)
    assert "Respond to the human in French." in result


# --- max_steps wiring: pure helper, no DB/agent call ---

def test_new_workflow_run_uses_settings_max_steps():
    settings = TenantSettings(tenant_slug="t", max_steps=1)
    run = workflow._new_workflow_run("tenant_red", "issue text", settings)
    assert run.max_steps == 1


# --- default_model wiring into the agent factories ---

def test_build_execution_agent_applies_model():
    assert build_execution_agent("gpt-4o-mini").model == "gpt-4o-mini"
    assert build_execution_agent(None).model is None


def test_build_investigator_agent_applies_model():
    agent = build_investigator_agent(mcp_server=None, instructions="x", model="gpt-4o-mini")
    assert agent.model == "gpt-4o-mini"


# --- log_level wiring ---

def test_apply_log_level_sets_workflow_and_execution_loggers():
    _apply_log_level("Debug")
    assert logging.getLogger("agent_lab.workflow").level == logging.DEBUG
    assert logging.getLogger("agent_lab.execution").level == logging.DEBUG
    _apply_log_level("Error")
    assert logging.getLogger("agent_lab.workflow").level == logging.ERROR
    assert logging.getLogger("agent_lab.execution").level == logging.ERROR


# --- max_concurrent_runs: real logic, rejected before any agent/guardrail call ---

async def test_investigate_rejects_over_max_concurrent_runs(client, auth_headers):
    headers = await auth_headers("admin_user", "admin-pass-123")

    limit_response = await client.patch(
        "/tenants/tenant_red/settings", json={"max_concurrent_runs": 1}, headers=headers,
    )
    assert limit_response.status_code == 200

    # Simulate one run already in flight -- this is the exact module-level
    # state the real concurrency-guard code reads, not a mock.
    workflow._in_flight_runs["tenant_red"] = 1
    try:
        response = await client.post(
            "/investigate",
            json={"tenant_id": "tenant_red", "issue": "ACME renewal is blocked."},
            headers=headers,
        )
        assert response.status_code == 429
    finally:
        workflow._in_flight_runs.pop("tenant_red", None)


async def test_investigate_issue_raises_too_many_concurrent_runs_directly(db_session):
    await update_settings(db_session, "tenant_green", max_concurrent_runs=1)
    workflow._in_flight_runs["tenant_green"] = 1
    try:
        with pytest.raises(TooManyConcurrentRunsError):
            await investigate_issue(tenant_id="tenant_green", issue="x", db=db_session)
    finally:
        workflow._in_flight_runs.pop("tenant_green", None)
