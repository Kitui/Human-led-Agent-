"""Tenant existence and lifecycle (list / create / activate / deactivate),
backed by the real `tenants` table. Replaces the old hardcoded
VALID_TENANTS set that used to live in workflow.py."""

from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .db_models import TenantORM
from .models import Tenant


class DuplicateTenantError(ValueError):
    pass


class TenantNotFoundError(KeyError):
    pass


async def list_tenants(db: AsyncSession) -> list[Tenant]:
    result = await db.execute(select(TenantORM).order_by(TenantORM.created_at.desc()))
    return [Tenant.model_validate(row, from_attributes=True) for row in result.scalars().all()]


async def create_tenant(db: AsyncSession, slug: str, environment: str) -> Tenant:
    slug = slug.strip()
    existing = await db.get(TenantORM, slug)
    if existing is not None:
        raise DuplicateTenantError(f"Tenant '{slug}' already exists.")

    orm_row = TenantORM(
        slug=slug,
        environment=environment,
        is_active=True,
        created_at=datetime.now(timezone.utc),
    )
    db.add(orm_row)
    await db.commit()
    return Tenant.model_validate(orm_row, from_attributes=True)


async def set_tenant_active(db: AsyncSession, slug: str, is_active: bool) -> Tenant:
    orm_row = await db.get(TenantORM, slug)
    if orm_row is None:
        raise TenantNotFoundError(slug)

    orm_row.is_active = is_active
    await db.commit()
    return Tenant.model_validate(orm_row, from_attributes=True)


async def is_valid_active_tenant(db: AsyncSession, slug: str) -> bool:
    orm_row = await db.get(TenantORM, slug)
    return orm_row is not None and orm_row.is_active


async def tenant_exists(db: AsyncSession, slug: str) -> bool:
    return await db.get(TenantORM, slug) is not None
