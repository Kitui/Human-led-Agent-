import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]

if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

# Tests need a real PostgreSQL database reachable at DATABASE_URL (see
# .env.example) -- run `docker compose up -d` once before running pytest.

import pytest_asyncio
from dotenv import load_dotenv
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

load_dotenv()

from agent_lab.api import app
from agent_lab.db import engine, get_db, seed_default_tenants, seed_demo_users
from agent_lab.db_models import Base


@pytest_asyncio.fixture(scope="session", autouse=True)
async def _schema():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    # CI starts a brand-new, empty Postgres and never runs the app's
    # lifespan (that's what normally seeds demo users/tenants) -- seed here
    # so tests have real users and tenants to work with. No-ops if either
    # already exist (e.g. a local dev database that's already been seeded).
    await seed_demo_users()
    await seed_default_tenants()


@pytest_asyncio.fixture(autouse=True)
async def db_session(_schema):
    """Runs every test inside its own transaction, rolled back afterward, so
    tests never leave data behind for the next test (or the next pytest run)."""

    connection = await engine.connect()
    transaction = await connection.begin()
    session = AsyncSession(bind=connection, expire_on_commit=False)

    async def override_get_db():
        yield session

    app.dependency_overrides[get_db] = override_get_db
    yield session
    app.dependency_overrides.pop(get_db, None)
    await session.close()
    await transaction.rollback()
    await connection.close()


@pytest_asyncio.fixture
async def client():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac


@pytest_asyncio.fixture
async def auth_headers(client):
    async def _headers(username: str, password: str) -> dict[str, str]:
        response = await client.post("/auth/login", json={"username": username, "password": password})
        token = response.json()["access_token"]
        return {"Authorization": f"Bearer {token}"}

    return _headers
