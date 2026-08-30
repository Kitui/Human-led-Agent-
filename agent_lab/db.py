import os
from collections.abc import AsyncGenerator, Iterable
from datetime import datetime, timezone

import bcrypt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from .db_models import Base, CustomerORM, TenantORM, TenantSettingsORM, UserORM
from .tenant_settings import DEFAULT_SETTINGS


def normalize_database_url(database_url: str) -> str:
    """Return a SQLAlchemy asyncpg-compatible PostgreSQL URL.

    Render exposes managed Postgres connection strings as ``postgresql://...``
    while this application uses SQLAlchemy's async engine with ``asyncpg``.
    Local/CI URLs that already declare ``postgresql+asyncpg`` remain unchanged.
    """

    if database_url.startswith("postgresql+asyncpg://"):
        return database_url
    if database_url.startswith("postgresql://"):
        return database_url.replace("postgresql://", "postgresql+asyncpg://", 1)
    if database_url.startswith("postgres://"):
        return database_url.replace("postgres://", "postgresql+asyncpg://", 1)
    return database_url


DATABASE_URL = normalize_database_url(
    os.getenv(
        "DATABASE_URL",
        "postgresql+asyncpg://agent_lab:agent_lab@localhost:5544/agent_lab",
    )
)

engine = create_async_engine(DATABASE_URL)
async_session_maker = async_sessionmaker(engine, expire_on_commit=False)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with async_session_maker() as session:
        yield session


async def init_db() -> None:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    # Keep the demo usable on existing databases as well as fresh installs:
    # create_all adds the customers table and this seed fills only missing
    # reference rows without overwriting customer data already persisted.
    await seed_default_customers()


# Demo identities are intentionally non-secret, but passwords are never
# embedded in deployable application code. Startup only creates these users
# when ENABLE_DEMO_USERS=true and all three passwords are supplied via env.
DEMO_USER_SPECS = [
    ("red_user", "DEMO_RED_PASSWORD", ["tenant_red"]),
    ("green_user", "DEMO_GREEN_PASSWORD", ["tenant_green"]),
    ("admin_user", "DEMO_ADMIN_PASSWORD", ["tenant_red", "tenant_green"]),
]
DEMO_USERNAMES = tuple(username for username, _env_name, _tenant_ids in DEMO_USER_SPECS)


def demo_users_enabled() -> bool:
    return os.getenv("ENABLE_DEMO_USERS", "false").strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
    }


def configured_demo_users() -> list[tuple[str, str, list[str]]]:
    """Return explicitly configured demo users, or an empty list when demo
    mode is disabled. Enabling demo mode without strong passwords fails fast
    instead of silently falling back to known credentials."""

    if not demo_users_enabled():
        return []

    users: list[tuple[str, str, list[str]]] = []
    for username, password_env, tenant_ids in DEMO_USER_SPECS:
        password = os.getenv(password_env, "")
        if len(password) < 16:
            raise RuntimeError(
                f"{password_env} must be set to at least 16 characters "
                "when ENABLE_DEMO_USERS=true."
            )
        users.append((username, password, tenant_ids))
    return users


async def seed_demo_users(
    users: Iterable[tuple[str, str, list[str]]] | None = None,
) -> None:
    """Manage demo accounts safely.

    Normal application startup calls this with ``users=None``:
    - demo mode disabled (default): remove legacy demo usernames if present;
    - demo mode enabled: require env-provided passwords and create/rotate them.

    Tests may pass an explicit iterable so test credentials never become
    application defaults.
    """

    explicit_users = users is not None
    resolved_users = list(users) if explicit_users else configured_demo_users()

    async with async_session_maker() as session:
        if not explicit_users and not demo_users_enabled():
            changed = False
            for username in DEMO_USERNAMES:
                existing = await session.get(UserORM, username)
                if existing is not None:
                    await session.delete(existing)
                    changed = True
            if changed:
                await session.commit()
            return

        for username, password, tenant_ids in resolved_users:
            password_bytes = password.encode("utf-8")
            existing = await session.get(UserORM, username)
            if existing is None:
                password_hash = bcrypt.hashpw(password_bytes, bcrypt.gensalt()).decode("utf-8")
                session.add(
                    UserORM(
                        username=username,
                        password_hash=password_hash,
                        tenant_ids=tenant_ids,
                    )
                )
                continue

            # Demo mode may be intentionally enabled with newly rotated
            # passwords. Keep the stored grants/password aligned with env.
            if not bcrypt.checkpw(password_bytes, existing.password_hash.encode("utf-8")):
                existing.password_hash = bcrypt.hashpw(password_bytes, bcrypt.gensalt()).decode("utf-8")
            existing.tenant_ids = tenant_ids

        await session.commit()


# Default tenants for this demo/reference dataset.
DEFAULT_TENANTS = [
    ("tenant_red", "Production"),
    ("tenant_green", "Production"),
]


async def seed_default_tenants() -> None:
    async with async_session_maker() as session:
        existing = await session.execute(select(TenantORM.slug))
        if existing.first() is not None:
            return
        now = datetime.now(timezone.utc)
        for slug, environment in DEFAULT_TENANTS:
            session.add(TenantORM(slug=slug, environment=environment, is_active=True, created_at=now))
        await session.commit()


DEFAULT_CUSTOMERS = [
    {
        "customer_id": "tenant_red:acme",
        "tenant_id": "tenant_red",
        "name": "ACME",
        "normalized_name": "ACME",
        "plan": "Enterprise",
        "account_status": "active",
        "renewal_value": 120000,
        "renewal_status": "blocked",
        "billing_status": "invoice_dispute",
    },
    {
        "customer_id": "tenant_green:greenmart",
        "tenant_id": "tenant_green",
        "name": "GreenMart",
        "normalized_name": "GREENMART",
        "plan": "Business",
        "account_status": "active",
        "renewal_value": 25000,
        "renewal_status": "normal",
        "billing_status": "clear",
    },
]


async def seed_default_customers() -> None:
    """Seed only missing demo customer rows; never overwrite persisted data."""

    async with async_session_maker() as session:
        now = datetime.now(timezone.utc)
        changed = False
        for values in DEFAULT_CUSTOMERS:
            existing = await session.get(CustomerORM, values["customer_id"])
            if existing is not None:
                continue
            session.add(CustomerORM(**values, created_at=now, updated_at=now))
            changed = True
        if changed:
            await session.commit()


async def seed_default_tenant_settings() -> None:
    """Eagerly seed default settings for the reference tenants."""

    async with async_session_maker() as session:
        existing = await session.execute(select(TenantSettingsORM.tenant_slug))
        if existing.first() is not None:
            return
        for slug, _environment in DEFAULT_TENANTS:
            session.add(TenantSettingsORM(tenant_slug=slug, **DEFAULT_SETTINGS))
        await session.commit()
