import pytest

from agent_lab.auth import _secret_key
from agent_lab.db import configured_demo_users, demo_users_enabled


def _clear_demo_password_env(monkeypatch):
    for name in (
        "DEMO_NORTHSTAR_PASSWORD",
        "DEMO_NEPTUNE_PASSWORD",
        "DEMO_RED_PASSWORD",
        "DEMO_GREEN_PASSWORD",
        "DEMO_ADMIN_PASSWORD",
    ):
        monkeypatch.delenv(name, raising=False)


def test_demo_users_are_disabled_by_default(monkeypatch):
    monkeypatch.delenv("ENABLE_DEMO_USERS", raising=False)
    _clear_demo_password_env(monkeypatch)

    assert demo_users_enabled() is False
    assert configured_demo_users() == []


def test_enabled_demo_users_require_strong_env_passwords(monkeypatch):
    _clear_demo_password_env(monkeypatch)
    monkeypatch.setenv("ENABLE_DEMO_USERS", "true")
    monkeypatch.setenv("DEMO_NORTHSTAR_PASSWORD", "too-short")
    monkeypatch.setenv("DEMO_NEPTUNE_PASSWORD", "neptune-password-long-enough")
    monkeypatch.setenv("DEMO_ADMIN_PASSWORD", "admin-password-long-enough")

    with pytest.raises(RuntimeError, match="DEMO_NORTHSTAR_PASSWORD"):
        configured_demo_users()


def test_enabled_demo_users_use_only_env_supplied_passwords(monkeypatch):
    _clear_demo_password_env(monkeypatch)
    monkeypatch.setenv("ENABLE_DEMO_USERS", "true")
    monkeypatch.setenv("DEMO_NORTHSTAR_PASSWORD", "northstar-password-strong-001")
    monkeypatch.setenv("DEMO_NEPTUNE_PASSWORD", "neptune-password-strong-001")
    monkeypatch.setenv("DEMO_ADMIN_PASSWORD", "admin-password-strong-001")

    users = configured_demo_users()

    assert users == [
        (
            "user@northstar.com",
            "northstar-password-strong-001",
            ["NorthStar"],
        ),
        (
            "user@neptune.com",
            "neptune-password-strong-001",
            ["Neptune"],
        ),
        (
            "admin@correlact.com",
            "admin-password-strong-001",
            ["NorthStar", "Neptune"],
        ),
    ]


def test_legacy_password_env_names_are_temporary_migration_fallbacks(monkeypatch):
    _clear_demo_password_env(monkeypatch)
    monkeypatch.setenv("ENABLE_DEMO_USERS", "true")
    monkeypatch.setenv("DEMO_RED_PASSWORD", "legacy-northstar-strong-001")
    monkeypatch.setenv("DEMO_GREEN_PASSWORD", "legacy-neptune-strong-001")
    monkeypatch.setenv("DEMO_ADMIN_PASSWORD", "admin-password-strong-001")

    users = configured_demo_users()

    assert users[0] == (
        "user@northstar.com",
        "legacy-northstar-strong-001",
        ["NorthStar"],
    )
    assert users[1] == (
        "user@neptune.com",
        "legacy-neptune-strong-001",
        ["Neptune"],
    )


def test_preferred_password_env_names_override_legacy_fallbacks(monkeypatch):
    _clear_demo_password_env(monkeypatch)
    monkeypatch.setenv("ENABLE_DEMO_USERS", "true")
    monkeypatch.setenv("DEMO_NORTHSTAR_PASSWORD", "preferred-northstar-strong-001")
    monkeypatch.setenv("DEMO_RED_PASSWORD", "legacy-northstar-strong-001")
    monkeypatch.setenv("DEMO_NEPTUNE_PASSWORD", "preferred-neptune-strong-001")
    monkeypatch.setenv("DEMO_GREEN_PASSWORD", "legacy-neptune-strong-001")
    monkeypatch.setenv("DEMO_ADMIN_PASSWORD", "admin-password-strong-001")

    users = configured_demo_users()

    assert users[0][1] == "preferred-northstar-strong-001"
    assert users[1][1] == "preferred-neptune-strong-001"


def test_jwt_secret_rejects_short_value(monkeypatch):
    monkeypatch.setenv("JWT_SECRET_KEY", "short-secret")

    with pytest.raises(RuntimeError, match="at least 32 bytes"):
        _secret_key()


def test_jwt_secret_accepts_32_plus_bytes(monkeypatch):
    expected = "x" * 32
    monkeypatch.setenv("JWT_SECRET_KEY", expected)

    assert _secret_key() == expected
