from agent_lab.db_models import ExecutedActionORM
from agent_lab.tools import _get_or_create_task


async def test_task_idempotency_is_persisted_in_postgres(db_session):
    key = "test-durable-idempotency-001"

    first, first_created = await _get_or_create_task(
        db_session,
        idempotency_key=key,
        customer_name="ACME",
        team="Billing",
        description="Resolve the invoice dispute.",
        priority="high",
    )

    assert first_created is True
    assert first["created"] is True
    assert first["task_id"].startswith("TASK-")

    stored = await db_session.get(ExecutedActionORM, key)
    assert stored is not None
    assert stored.tool_name == "create_task"
    assert stored.request["customer_name"] == "ACME"
    assert stored.request["description"] == "Resolve the invoice dispute."
    assert stored.result == first

    second, second_created = await _get_or_create_task(
        db_session,
        idempotency_key=key,
        customer_name="ACME",
        team="Billing",
        description="Resolve the invoice dispute.",
        priority="high",
    )

    assert second_created is False
    assert second == first
    assert second["task_id"] == first["task_id"]


async def test_different_idempotency_keys_create_different_task_records(db_session):
    first, first_created = await _get_or_create_task(
        db_session,
        idempotency_key="test-durable-idempotency-a",
        customer_name="ACME",
        team="Billing",
        description="First approved action.",
        priority="high",
    )
    second, second_created = await _get_or_create_task(
        db_session,
        idempotency_key="test-durable-idempotency-b",
        customer_name="ACME",
        team="Billing",
        description="Second approved action.",
        priority="high",
    )

    assert first_created is True
    assert second_created is True
    assert first["task_id"] != second["task_id"]
    assert await db_session.get(ExecutedActionORM, first["idempotency_key"]) is not None
    assert await db_session.get(ExecutedActionORM, second["idempotency_key"]) is not None
