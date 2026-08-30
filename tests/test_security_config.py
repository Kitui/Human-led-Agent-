import pytest

from agent_lab.auth import _secret_key
from agent_lab.db import configured_demo_users, demo_users_enabled


def test_demo_users_are_disabled_by_default(monkeypatch):
    monkeypatch.delenv("ENABLE_DEMO_USERS", raising=False)
    monkeypatch.delenv("DEMO_RED_PASSWORD", raising=False)
    monkeypatch.delenv("DEMO_GREEN_PASSWORD", raising=False)
    monkeypatch.delenv("DEMO_ADMIN_PASSWORD", raising=False)

    assert demo_users_enabled() is False
    assert configured_demo_users() == []


def test_enabled_demo_users_require_strong_env_passwords(monkeypatch):
    monkeypatch.setenv("ENABLE_DEMO_USERS", "true")
    monkeypatch.setenv("DEMO_RED_PASSWORD", "too-short")
    monkeypatch.setenv("DEMO_GREEN_PASSWORD", "green-password-long-enough")
    monkeypatch.setenv("DEMO_ADMIN_PASSWORD", "admin-password-long-enough")

    with pytest.raises(RuntimeError, match="DEMO_RED_PASSWORD"):
        configured_demo_users()


def test_enabled_demo_users_use_only_env_supplied_passwords(monkeypatch):
    monkeypatch.setenv("ENABLE_DEMO_USERS", "true")
    monkeypatch.setenv("DEMO_RED_PASSWORD", "red-password-strong-001")
    monkeypatch.setenv("DEMO_GREEN_PASSWORD", "green-password-strong-001")
    monkeypatch.setenv("DEMO_ADMIN_PASSWORD", "admin-password-strong-001")

    users = configured_demo_users()

    assert users == [
        ("red_user", "red-password-strong-001", ["tenant_red"]),
        ("green_user", "green-password-strong-001", ["tenant_green"]),
        ("admin_user", "admin-password-strong-001", ["tenant_red", "tenant_green"]),
    ]


def test_jwt_secret_rejects_short_value(monkeypatch):
    monkeypatch.setenv("JWT_SECRET_KEY", "short-secret")

    with pytest.raises(RuntimeError, match="at least 32 bytes"):
        _secret_key()


def test_jwt_secret_accepts_32_plus_bytes(monkeypatch):
    expected = "x" * 32
    monkeypatch.setenv("JWT_SECRET_KEY", expected)

    assert _secret_key() == expected
