from agent_lab.db_models import ExecutedActionORM
from agent_lab.tools import _get_or_create_task


class FakeTaskClient:
    def __init__(self):
        self.calls = []

    async def create_or_get_issue(
        self,
        *,
        idempotency_key: str,
        customer_name: str,
        team: str,
        description: str,
        priority: str,
    ) -> tuple[dict, bool]:
        self.calls.append(idempotency_key)
        number = len(self.calls) + 100
        return (
            {
                "created": True,
                "provider": "github",
                "task_id": f"GH-{number}",
                "issue_number": number,
                "issue_url": f"https://github.com/example/tasks/issues/{number}",
                "repository": "example/tasks",
                "customer": customer_name,
                "team": team,
                "priority": priority,
                "idempotency_key": idempotency_key,
            },
            True,
        )


async def test_task_idempotency_is_persisted_in_postgres(db_session):
    key = "test-durable-idempotency-001"
    task_client = FakeTaskClient()

    first, first_created = await _get_or_create_task(
        db_session,
        idempotency_key=key,
        customer_name="ACME",
        team="Billing",
        description="Resolve the invoice dispute.",
        priority="high",
        task_client=task_client,
    )

    assert first_created is True
    assert first["created"] is True
    assert first["provider"] == "github"
    assert first["task_id"] == "GH-101"

    stored = await db_session.get(ExecutedActionORM, key)
    assert stored is not None
    assert stored.tool_name == "create_task"
    assert stored.request["customer_name"] == "ACME"
    assert stored.request["description"] == "Resolve the invoice dispute."
    assert stored.request["provider"] == "github"
    assert stored.result == first

    second, second_created = await _get_or_create_task(
        db_session,
        idempotency_key=key,
        customer_name="ACME",
        team="Billing",
        description="Resolve the invoice dispute.",
        priority="high",
        task_client=task_client,
    )

    assert second_created is False
    assert second == first
    assert second["task_id"] == first["task_id"]
    assert task_client.calls == [key]


async def test_different_idempotency_keys_create_different_external_tasks(db_session):
    task_client = FakeTaskClient()

    first, first_created = await _get_or_create_task(
        db_session,
        idempotency_key="test-durable-idempotency-a",
        customer_name="ACME",
        team="Billing",
        description="First approved action.",
        priority="high",
        task_client=task_client,
    )
    second, second_created = await _get_or_create_task(
        db_session,
        idempotency_key="test-durable-idempotency-b",
        customer_name="ACME",
        team="Billing",
        description="Second approved action.",
        priority="high",
        task_client=task_client,
    )

    assert first_created is True
    assert second_created is True
    assert first["task_id"] != second["task_id"]
    assert task_client.calls == ["test-durable-idempotency-a", "test-durable-idempotency-b"]
    assert await db_session.get(ExecutedActionORM, first["idempotency_key"]) is not None
    assert await db_session.get(ExecutedActionORM, second["idempotency_key"]) is not None
