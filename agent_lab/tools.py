from agents import function_tool
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from .db import async_session_maker
from .db_models import ExecutedActionORM
from .github_tasks import GitHubTaskClient


async def _get_or_create_task(
    db: AsyncSession,
    *,
    idempotency_key: str,
    customer_name: str,
    team: str,
    description: str,
    priority: str,
    task_client: GitHubTaskClient,
) -> tuple[dict, bool]:
    """Return the durable external task result for an idempotency key.

    A PostgreSQL advisory lock serializes concurrent attempts using the same
    key before any GitHub write happens. PostgreSQL remains the local source
    of truth; GitHub carries the same key in the issue body so a retry can
    reconcile an external success that happened just before a lost response
    or process crash.
    """

    # Serialize this specific action across PostgreSQL connections/workers.
    # The lock is transaction-scoped and releases automatically on commit,
    # rollback, or connection loss.
    await db.execute(
        text("SELECT pg_advisory_xact_lock(hashtext(:idempotency_key))"),
        {"idempotency_key": idempotency_key},
    )

    existing = await db.get(ExecutedActionORM, idempotency_key)
    if existing is not None:
        return dict(existing.result), False

    request = {
        "customer_name": customer_name,
        "team": team,
        "description": description,
        "priority": priority,
        "provider": "github",
    }

    result, created_now = await task_client.create_or_get_issue(
        idempotency_key=idempotency_key,
        customer_name=customer_name,
        team=team,
        description=description,
        priority=priority,
    )

    db.add(
        ExecutedActionORM(
            idempotency_key=idempotency_key,
            tool_name="create_task",
            request=request,
            result=result,
            created_at=__import__("datetime").datetime.now(__import__("datetime").timezone.utc),
        )
    )

    try:
        # Persist the external result before returning it to the agent. If the
        # process fails before this commit, the next attempt will reconcile
        # against GitHub using the embedded idempotency marker.
        await db.commit()
    except IntegrityError:
        # Defensive fallback. The advisory lock should already serialize
        # same-key writes, but the primary key remains the final DB boundary.
        await db.rollback()
        existing = await db.get(ExecutedActionORM, idempotency_key)
        if existing is None:
            raise
        return dict(existing.result), False

    return result, created_now


@function_tool(failure_error_function=None)
async def create_task(
    idempotency_key: str,
    customer_name: str,
    team: str,
    description: str,
    priority: str,
) -> dict:
    """Create an approved task as a real GitHub Issue exactly once."""

    task_client = GitHubTaskClient.from_env()

    async with async_session_maker() as db:
        result, created_now = await _get_or_create_task(
            db,
            idempotency_key=idempotency_key,
            customer_name=customer_name,
            team=team,
            description=description,
            priority=priority,
            task_client=task_client,
        )

    if not created_now:
        print("\n[IDEMPOTENCY CHECK]")
        print(f"Action already exists as {result['task_id']}.")
        print(f"Issue: {result['issue_url']}")
        return result

    print("\n[WRITE TOOL EXECUTED]")
    print(f"Task ID: {result['task_id']}")
    print(f"GitHub Issue: {result['issue_url']}")
    print(f"Customer: {customer_name}")
    print(f"Team: {team}")
    print(f"Priority: {priority}")
    print(f"Description: {description}")

    return result
