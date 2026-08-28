import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from agent_lab.api import app


@pytest_asyncio.fixture
async def client():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac


async def test_health(client):
    response = await client.get("/health")

    assert response.status_code == 200
    assert response.json()["status"] == "ok"


async def test_invalid_tenant_is_rejected_before_agent_call(client):
    response = await client.post(
        "/investigate",
        json={
            "tenant_id": "tenant_unknown",
            "issue": "ACME renewal is blocked.",
        },
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "Invalid tenant."


async def test_list_runs_returns_a_list(client):
    response = await client.get("/runs")

    assert response.status_code == 200
    assert isinstance(response.json(), list)


async def test_list_runs_rejects_invalid_status(client):
    response = await client.get("/runs", params={"status": "not_a_status"})

    assert response.status_code == 422
