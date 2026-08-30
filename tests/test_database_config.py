from agent_lab.db import normalize_database_url


def test_asyncpg_url_is_preserved() -> None:
    url = "postgresql+asyncpg://user:pass@localhost:5432/app"
    assert normalize_database_url(url) == url


def test_render_postgresql_url_uses_asyncpg_driver() -> None:
    url = "postgresql://user:pass@internal-host:5432/app"
    assert normalize_database_url(url) == (
        "postgresql+asyncpg://user:pass@internal-host:5432/app"
    )


def test_legacy_postgres_url_uses_asyncpg_driver() -> None:
    url = "postgres://user:pass@internal-host:5432/app"
    assert normalize_database_url(url) == (
        "postgresql+asyncpg://user:pass@internal-host:5432/app"
    )
