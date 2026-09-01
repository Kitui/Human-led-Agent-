from datetime import datetime, timezone

from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from .customers import normalize_customer_name
from .db_models import CustomerORM, ExecutedActionORM


ALLOWED_CRM_TRANSITIONS = {
    ("blocked", "escalation_open"),
    ("normal", "follow_up_required"),
}


async def get_or_create_crm_status_update(
    db: AsyncSession,
    *,
    idempotency_key: str,
    tenant_id: str,
    customer_name: str,
    expected_status: str,
    target_status: str,
) -> tuple[dict, bool]:
    """Apply one approved CRM renewal-status transition exactly once.

    The durable ExecutedAction row gives cross-process idempotency while a
    row-level lock serializes competing updates to the same customer record.
    The approved expected status is checked again immediately before mutation,
    so stale approvals cannot silently overwrite newer CRM state.
    """

    if (expected_status, target_status) not in ALLOWED_CRM_TRANSITIONS:
        raise ValueError("CRM status transition is not allowed.")

    await db.execute(
        text("SELECT pg_advisory_xact_lock(hashtext(:idempotency_key))"),
        {"idempotency_key": idempotency_key},
    )

    existing = await db.get(ExecutedActionORM, idempotency_key)
    if existing is not None:
        return dict(existing.result), False

    normalized_name = normalize_customer_name(customer_name)
    customer = await db.scalar(
        select(CustomerORM)
        .where(
            CustomerORM.tenant_id == tenant_id,
            CustomerORM.normalized_name == normalized_name,
        )
        .with_for_update()
    )
    if customer is None:
        raise ValueError("Customer is not available in the approved organization.")

    current_status = customer.renewal_status
    if current_status not in {expected_status, target_status}:
        raise ValueError(
            "CRM renewal status changed after approval; a fresh review is required."
        )

    changed_now = current_status != target_status
    if changed_now:
        customer.renewal_status = target_status
        customer.updated_at = datetime.now(timezone.utc)

    request = {
        "tenant_id": tenant_id,
        "customer_name": customer.name,
        "field": "renewal_status",
        "expected_status": expected_status,
        "target_status": target_status,
        "provider": "correlact_demo_crm",
    }
    result = {
        "updated": changed_now,
        "provider": "correlact_demo_crm",
        "customer": customer.name,
        "tenant_id": tenant_id,
        "field": "renewal_status",
        "before": current_status,
        "after": target_status,
        "idempotency_key": idempotency_key,
    }

    db.add(
        ExecutedActionORM(
            idempotency_key=idempotency_key,
            tool_name="update_crm_status",
            request=request,
            result=result,
            created_at=datetime.now(timezone.utc),
        )
    )

    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        existing = await db.get(ExecutedActionORM, idempotency_key)
        if existing is None:
            raise
        return dict(existing.result), False

    return result, changed_now
