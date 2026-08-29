import random
import uuid
from datetime import datetime, timezone

from agents import function_tool
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from .db import async_session_maker
from .db_models import ExecutedActionORM


async def _get_or_create_task(
    db: AsyncSession,
    *,
    idempotency_key: str,
    customer_name: str,
    team: str,
    description: str,
    priority: str,
) -> tuple[dict, bool]:
    """Return the durable result for an idempotency key.

    The boolean is True only when this call created the task record. A retry
    gets the previously committed result and must not perform the write again.
    The primary-key constraint also protects against two workers racing on the
    same key: the loser rolls back its insert and reads the winner's result.
    """

    existing = await db.get(ExecutedActionORM, idempotency_key)
    if existing is not None:
        return dict(existing.result), False

    request = {
        "customer_name": customer_name,
        "team": team,
        "description": description,
        "priority": priority,
    }
    result = {
        "created": True,
        "task_id": f"TASK-{uuid.uuid4().hex[:8].upper()}",
        "customer": customer_name,
        "team": team,
        "priority": priority,
        "idempotency_key": idempotency_key,
    }

    db.add(
        ExecutedActionORM(
            idempotency_key=idempotency_key,
            tool_name="create_task",
            request=request,
            result=result,
            created_at=datetime.now(timezone.utc),
        )
    )

    try:
        # Commit the successful write BEFORE returning to the agent. If the
        # response is lost after this point, a retry can recover this result
        # from PostgreSQL instead of creating a duplicate task.
        await db.commit()
    except IntegrityError:
        # Another worker may have committed the same key between our initial
        # lookup and insert. Treat that exactly like an ordinary retry.
        await db.rollback()
        existing = await db.get(ExecutedActionORM, idempotency_key)
        if existing is None:
            raise
        return dict(existing.result), False

    return result, True


@function_tool(failure_error_function=None)
async def create_task(
    idempotency_key: str,
    customer_name: str,
    team: str,
    description: str,
    priority: str,
) -> dict:
    """Create a task exactly once for the supplied idempotency key."""

    async with async_session_maker() as db:
        result, created_now = await _get_or_create_task(
            db,
            idempotency_key=idempotency_key,
            customer_name=customer_name,
            team=team,
            description=description,
            priority=priority,
        )

    if not created_now:
        print("\n[IDEMPOTENCY CHECK]")
        print(f"Action already completed as {result['task_id']}.")
        return result

    print("\n[WRITE TOOL EXECUTED]")
    print(f"Task ID: {result['task_id']}")
    print(f"Customer: {customer_name}")
    print(f"Team: {team}")
    print(f"Priority: {priority}")
    print(f"Description: {description}")

    # Simulate response loss AFTER the durable record has committed. The
    # retry will read that record and return the same task instead of writing
    # again, even if this process has restarted in between attempts.
    if random.random() < 0.5:
        raise RuntimeError("Task created, but response was lost")

    return result
