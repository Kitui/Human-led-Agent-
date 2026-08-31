import os
from collections.abc import AsyncGenerator, Iterable
from datetime import datetime, timezone
from typing import Any

import bcrypt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from .db_models import (
    Base,
    CustomerORM,
    EvalSuiteRunORM,
    ExecutedActionORM,
    TenantORM,
    TenantSettingsORM,
    UserORM,
    WorkflowRunORM,
)
from .tenant_settings import DEFAULT_SETTINGS

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql+asyncpg://agent_lab:agent_lab@localhost:5544/agent_lab",
)

engine = create_async_engine(DATABASE_URL)
async_session_maker = async_sessionmaker(engine, expire_on_commit=False)


# Canonical CorrelAct demo organizations. These replace the early learning
# labels tenant_red / tenant_green while preserving the data that already
# belongs to those organizations in deployed databases.
LEGACY_TENANT_MAP = {
    "tenant_red": "NorthStar",
    "tenant_green": "Neptune",
}

LEGACY_DEMO_USER_MAP = {
    "red_user": "user@northstar.com",
    "green_user": "user@neptune.com",
    "admin_user": "admin@correlact.com",
}

TENANT_SETTINGS_FIELDS = (
    "environment_name",
    "log_level",
    "default_language",
    "default_timezone",
    "max_concurrent_runs",
    "max_steps",
    "retry_limit",
    "default_model",
    "system_prompt_override",
    "prompt_version",
    "auto_update_prompt",
)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with async_session_maker() as session:
        yield session


def _remap_tenant_ids(tenant_ids: Iterable[str]) -> list[str]:
    """Replace legacy tenant ids while preserving order and removing duplicates."""

    remapped: list[str] = []
    for tenant_id in tenant_ids:
        canonical = LEGACY_TENANT_MAP.get(tenant_id, tenant_id)
        if canonical not in remapped:
            remapped.append(canonical)
    return remapped


def _remap_identity_references(value: Any) -> Any:
    """Recursively rewrite structured historical references to legacy ids.

    Workflow traces and stored eval/execution payloads can contain tenant or
    demo-user identifiers inside JSONB. Rewriting those references keeps the
    audit surfaces aligned with the migrated relational ownership columns.
    Free-form issue text is intentionally left untouched by the caller.
    """

    if isinstance(value, dict):
        return {key: _remap_identity_references(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_remap_identity_references(item) for item in value]
    if isinstance(value, tuple):
        return tuple(_remap_identity_references(item) for item in value)
    if isinstance(value, str):
        remapped = value
        for legacy, canonical in LEGACY_TENANT_MAP.items():
            remapped = remapped.replace(legacy, canonical)
        for legacy, canonical in LEGACY_DEMO_USER_MAP.items():
            remapped = remapped.replace(legacy, canonical)
        return remapped
    return value


async def _migrate_legacy_demo_identity(session: AsyncSession) -> bool:
    """Migrate the original learning identities in-place.

    This is deliberately data-preserving rather than a reseed. Existing
    tenants, users, customers, workflow runs, tenant settings, traces,
    execution records, and stored eval payloads are moved to the canonical
    NorthStar / Neptune identities. The routine is idempotent and also handles
    a partially migrated database where old and new rows temporarily coexist.
    """

    changed = False

    for legacy_slug, canonical_slug in LEGACY_TENANT_MAP.items():
        legacy_tenant = await session.get(TenantORM, legacy_slug)
        canonical_tenant = await session.get(TenantORM, canonical_slug)

        if legacy_tenant is not None:
            if canonical_tenant is None:
                canonical_tenant = TenantORM(
                    slug=canonical_slug,
                    environment=legacy_tenant.environment,
                    is_active=legacy_tenant.is_active,
                    created_at=legacy_tenant.created_at,
                )
                session.add(canonical_tenant)
                await session.flush()
            else:
                # The legacy row is the authoritative pre-migration state.
                canonical_tenant.environment = legacy_tenant.environment
                canonical_tenant.is_active = legacy_tenant.is_active
                canonical_tenant.created_at = legacy_tenant.created_at
            changed = True

        legacy_settings = await session.get(TenantSettingsORM, legacy_slug)
        canonical_settings = await session.get(TenantSettingsORM, canonical_slug)
        if legacy_settings is not None:
            if canonical_settings is None:
                canonical_settings = TenantSettingsORM(
                    tenant_slug=canonical_slug,
                    **{
                        field: getattr(legacy_settings, field)
                        for field in TENANT_SETTINGS_FIELDS
                    },
                )
                session.add(canonical_settings)
            else:
                for field in TENANT_SETTINGS_FIELDS:
                    setattr(canonical_settings, field, getattr(legacy_settings, field))
            await session.delete(legacy_settings)
            changed = True

        customer_result = await session.execute(
            select(CustomerORM).where(CustomerORM.tenant_id == legacy_slug)
        )
        for legacy_customer in customer_result.scalars().all():
            canonical_customer = (
                await session.execute(
                    select(CustomerORM).where(
                        CustomerORM.tenant_id == canonical_slug,
                        CustomerORM.normalized_name == legacy_customer.normalized_name,
                    )
                )
            ).scalar_one_or_none()

            canonical_customer_id = legacy_customer.customer_id
            prefix = f"{legacy_slug}:"
            if canonical_customer_id.startswith(prefix):
                canonical_customer_id = (
                    f"{canonical_slug}:{canonical_customer_id[len(prefix):]}"
                )

            if canonical_customer is None:
                id_conflict = await session.get(CustomerORM, canonical_customer_id)
                if id_conflict is not None and id_conflict is not legacy_customer:
                    raise RuntimeError(
                        "Cannot migrate legacy customer identity because the "
                        f"target id '{canonical_customer_id}' already belongs "
                        "to another customer."
                    )
                legacy_customer.customer_id = canonical_customer_id
                legacy_customer.tenant_id = canonical_slug
            else:
                # A partial prior migration may have seeded the target row.
                # Preserve the original customer's business/reference values.
                canonical_customer.name = legacy_customer.name
                canonical_customer.normalized_name = legacy_customer.normalized_name
                canonical_customer.plan = legacy_customer.plan
                canonical_customer.account_status = legacy_customer.account_status
                canonical_customer.renewal_value = legacy_customer.renewal_value
                canonical_customer.renewal_status = legacy_customer.renewal_status
                canonical_customer.billing_status = legacy_customer.billing_status
                canonical_customer.created_at = legacy_customer.created_at
                canonical_customer.updated_at = legacy_customer.updated_at
                await session.delete(legacy_customer)
            changed = True

        run_result = await session.execute(
            select(WorkflowRunORM).where(WorkflowRunORM.tenant_id == legacy_slug)
        )
        for run in run_result.scalars().all():
            run.tenant_id = canonical_slug
            run.action_point = _remap_identity_references(run.action_point)
            run.trace = _remap_identity_references(run.trace)
            run.metrics = _remap_identity_references(run.metrics)
            changed = True

        if legacy_tenant is not None:
            await session.delete(legacy_tenant)
            changed = True

    # Remap tenant grants on every user, not only the three demo identities.
    user_result = await session.execute(select(UserORM))
    for user in user_result.scalars().all():
        remapped_grants = _remap_tenant_ids(user.tenant_ids or [])
        if remapped_grants != list(user.tenant_ids or []):
            user.tenant_ids = remapped_grants
            changed = True

    # Rename the original demo usernames while preserving their password hash.
    for legacy_username, canonical_username in LEGACY_DEMO_USER_MAP.items():
        legacy_user = await session.get(UserORM, legacy_username)
        if legacy_user is None:
            continue

        canonical_user = await session.get(UserORM, canonical_username)
        if canonical_user is None:
            canonical_user = UserORM(
                username=canonical_username,
                password_hash=legacy_user.password_hash,
                tenant_ids=_remap_tenant_ids(legacy_user.tenant_ids or []),
            )
            session.add(canonical_user)
        else:
            canonical_user.tenant_ids = _remap_tenant_ids(
                list(canonical_user.tenant_ids or [])
                + list(legacy_user.tenant_ids or [])
            )
        await session.delete(legacy_user)
        changed = True

    # Structured audit/eval records are not tenant-keyed relationally, so
    # update any embedded legacy identity references explicitly.
    execution_result = await session.execute(select(ExecutedActionORM))
    for action in execution_result.scalars().all():
        request = _remap_identity_references(action.request)
        result = _remap_identity_references(action.result)
        if request != action.request:
            action.request = request
            changed = True
        if result != action.result:
            action.result = result
            changed = True

    eval_result = await session.execute(select(EvalSuiteRunORM))
    for suite in eval_result.scalars().all():
        cases = _remap_identity_references(suite.cases)
        if cases != suite.cases:
            suite.cases = cases
            changed = True

    return changed


async def migrate_legacy_demo_identity() -> bool:
    """Commit the idempotent legacy identity migration in its own session."""

    async with async_session_maker() as session:
        changed = await _migrate_legacy_demo_identity(session)
        if changed:
            await session.commit()
        return changed


async def init_db() -> None:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    # This MUST happen before any canonical reference seeding. Otherwise a
    # deployment could create duplicate NorthStar/Neptune reference rows and
    # lose the clean one-to-one migration from tenant_red/tenant_green.
    await migrate_legacy_demo_identity()
    await seed_default_customers()


# Demo identities are intentionally non-secret, but passwords are never
# embedded in deployable application code. Startup only creates these users
# when ENABLE_DEMO_USERS=true and all three passwords are supplied via env.
# The legacy password variable names remain temporary fallbacks so the Azure
# release can deploy this migration before the Key Vault rotation is applied.
DEMO_USER_SPECS = [
    (
        "user@northstar.com",
        "DEMO_NORTHSTAR_PASSWORD",
        "DEMO_RED_PASSWORD",
        ["NorthStar"],
    ),
    (
        "user@neptune.com",
        "DEMO_NEPTUNE_PASSWORD",
        "DEMO_GREEN_PASSWORD",
        ["Neptune"],
    ),
    (
        "admin@correlact.com",
        "DEMO_ADMIN_PASSWORD",
        None,
        ["NorthStar", "Neptune"],
    ),
]
DEMO_USERNAMES = tuple(
    username for username, _env_name, _legacy_env_name, _tenant_ids in DEMO_USER_SPECS
)
ALL_DEMO_USERNAMES = tuple(dict.fromkeys((*DEMO_USERNAMES, *LEGACY_DEMO_USER_MAP.keys())))


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
    for username, password_env, legacy_password_env, tenant_ids in DEMO_USER_SPECS:
        password = os.getenv(password_env, "")
        if not password and legacy_password_env:
            password = os.getenv(legacy_password_env, "")
        if len(password) < 16:
            fallback = (
                f" (legacy fallback: {legacy_password_env})"
                if legacy_password_env
                else ""
            )
            raise RuntimeError(
                f"{password_env}{fallback} must be set to at least 16 "
                "characters when ENABLE_DEMO_USERS=true."
            )
        users.append((username, password, tenant_ids))
    return users


async def seed_demo_users(
    users: Iterable[tuple[str, str, list[str]]] | None = None,
) -> None:
    """Manage demo accounts safely.

    Normal application startup calls this with ``users=None``:
    - demo mode disabled (default): remove legacy/current demo usernames;
    - demo mode enabled: require env-provided passwords and create/rotate them.

    Tests may pass an explicit iterable so test credentials never become
    application defaults.
    """

    explicit_users = users is not None
    resolved_users = list(users) if explicit_users else configured_demo_users()

    async with async_session_maker() as session:
        if not explicit_users and not demo_users_enabled():
            changed = False
            for username in ALL_DEMO_USERNAMES:
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
                password_hash = bcrypt.hashpw(
                    password_bytes,
                    bcrypt.gensalt(),
                ).decode("utf-8")
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
            if not bcrypt.checkpw(
                password_bytes,
                existing.password_hash.encode("utf-8"),
            ):
                existing.password_hash = bcrypt.hashpw(
                    password_bytes,
                    bcrypt.gensalt(),
                ).decode("utf-8")
            existing.tenant_ids = tenant_ids

        await session.commit()


# Default organizations for this demo/reference dataset.
DEFAULT_TENANTS = [
    ("NorthStar", "Production"),
    ("Neptune", "Production"),
]


async def seed_default_tenants() -> None:
    async with async_session_maker() as session:
        now = datetime.now(timezone.utc)
        changed = False
        for slug, environment in DEFAULT_TENANTS:
            existing = await session.get(TenantORM, slug)
            if existing is not None:
                continue
            session.add(
                TenantORM(
                    slug=slug,
                    environment=environment,
                    is_active=True,
                    created_at=now,
                )
            )
            changed = True
        if changed:
            await session.commit()


DEFAULT_CUSTOMERS = [
    {
        "customer_id": "NorthStar:acme",
        "tenant_id": "NorthStar",
        "name": "ACME",
        "normalized_name": "ACME",
        "plan": "Enterprise",
        "account_status": "active",
        "renewal_value": 120000,
        "renewal_status": "blocked",
        "billing_status": "invoice_dispute",
    },
    {
        "customer_id": "Neptune:greenmart",
        "tenant_id": "Neptune",
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
            session.add(
                CustomerORM(
                    **values,
                    created_at=now,
                    updated_at=now,
                )
            )
            changed = True
        if changed:
            await session.commit()


async def seed_default_tenant_settings() -> None:
    """Eagerly seed default settings for the reference organizations."""

    async with async_session_maker() as session:
        changed = False
        for slug, _environment in DEFAULT_TENANTS:
            existing = await session.get(TenantSettingsORM, slug)
            if existing is not None:
                continue
            session.add(
                TenantSettingsORM(
                    tenant_slug=slug,
                    **DEFAULT_SETTINGS,
                )
            )
            changed = True
        if changed:
            await session.commit()
