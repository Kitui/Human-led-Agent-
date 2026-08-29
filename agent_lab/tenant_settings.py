"""Per-tenant configurable settings (General Settings + Model & Prompt
cards), backed by the real `tenant_settings` table. Mirrors tenants.py's
style. Defaults below match today's hardcoded pre-this-PR behavior exactly,
so a freshly-created row changes nothing for a tenant that never touches
its settings."""

from sqlalchemy.ext.asyncio import AsyncSession

from .db_models import TenantORM, TenantSettingsORM
from .models import TenantSettings
from .tenants import TenantNotFoundError

DEFAULT_SETTINGS = dict(
    environment_name="",
    log_level="Info",
    default_language="English (US)",
    default_timezone="UTC",
    max_concurrent_runs=20,
    max_steps=5,
    retry_limit=3,
    default_model=None,
    system_prompt_override=None,
    prompt_version=1,
    auto_update_prompt=True,
)


async def get_or_create_settings(db: AsyncSession, tenant_slug: str) -> TenantSettings:
    if await db.get(TenantORM, tenant_slug) is None:
        raise TenantNotFoundError(tenant_slug)

    orm_row = await db.get(TenantSettingsORM, tenant_slug)
    if orm_row is None:
        # Lazy fallback for tenants created after startup (not in
        # DEFAULT_TENANTS, so db.py's eager seed never covered them).
        orm_row = TenantSettingsORM(tenant_slug=tenant_slug, **DEFAULT_SETTINGS)
        db.add(orm_row)
        await db.commit()

    return TenantSettings.model_validate(orm_row, from_attributes=True)


async def update_settings(db: AsyncSession, tenant_slug: str, **fields) -> TenantSettings:
    """Partial update. `fields` should come from a Pydantic model dumped with
    exclude_unset=True (see api.py) -- only keys actually present in the
    request are applied, so e.g. omitting default_model leaves it alone,
    while explicitly sending default_model: null clears it."""

    if await db.get(TenantORM, tenant_slug) is None:
        raise TenantNotFoundError(tenant_slug)

    orm_row = await db.get(TenantSettingsORM, tenant_slug)
    if orm_row is None:
        orm_row = TenantSettingsORM(tenant_slug=tenant_slug, **DEFAULT_SETTINGS)
        db.add(orm_row)

    # Real, monotonic version bump -- only when the override text actually
    # changes, never a fabricated semantic string.
    if "system_prompt_override" in fields and fields["system_prompt_override"] != orm_row.system_prompt_override:
        orm_row.prompt_version += 1

    for key, value in fields.items():
        setattr(orm_row, key, value)

    await db.commit()
    return TenantSettings.model_validate(orm_row, from_attributes=True)
