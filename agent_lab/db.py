import os
from collections.abc import AsyncGenerator
from datetime import datetime, timezone

import bcrypt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from .db_models import Base, TenantORM, UserORM

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql+asyncpg://agent_lab:agent_lab@localhost:5544/agent_lab",
)

engine = create_async_engine(DATABASE_URL)
async_session_maker = async_sessionmaker(engine, expire_on_commit=False)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with async_session_maker() as session:
        yield session


async def init_db() -> None:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


# Learning/demo accounts only, seeded once into the real `users` table.
# Shaped to match the tenant grants the (separate, not-yet-built) auth
# feature will check: red_user/green_user each see one tenant, admin_user
# sees both.
DEMO_USERS = [
    ("red_user", "red-pass-123", ["tenant_red"]),
    ("green_user", "green-pass-123", ["tenant_green"]),
    ("admin_user", "admin-pass-123", ["tenant_red", "tenant_green"]),
]


async def seed_demo_users() -> None:
    async with async_session_maker() as session:
        existing = await session.execute(select(UserORM.username))
        if existing.first() is not None:
            return
        for username, password, tenant_ids in DEMO_USERS:
            password_hash = bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")
            session.add(UserORM(username=username, password_hash=password_hash, tenant_ids=tenant_ids))
        await session.commit()


# Default tenants for this demo -- mirrors DEMO_USERS' seed-once pattern.
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
