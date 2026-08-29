from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .db_models import CustomerORM


class CustomerLookupResult:
    def __init__(self, *, found: bool, customer: dict | None = None, error: str | None = None):
        self.found = found
        self.customer = customer
        self.error = error

    def to_dict(self) -> dict:
        if not self.found:
            return {"found": False, "error": self.error}
        return {"found": True, "customer": self.customer}


def normalize_customer_name(customer_name: str) -> str:
    return " ".join(customer_name.strip().upper().split())


def customer_to_dict(customer: CustomerORM) -> dict:
    return {
        "name": customer.name,
        "tenant_id": customer.tenant_id,
        "plan": customer.plan,
        "account_status": customer.account_status,
        "renewal_value": customer.renewal_value,
        "renewal_status": customer.renewal_status,
        "billing_status": customer.billing_status,
    }


async def lookup_customer(
    db: AsyncSession,
    *,
    customer_name: str,
    tenant_id: str,
) -> CustomerLookupResult:
    """Resolve a customer while preserving tenant-isolation semantics.

    We first try the requested tenant. If no tenant-owned row exists, a second
    existence check determines whether the name belongs to another tenant
    (`ACCESS_DENIED`) or is genuinely unknown (`NOT_FOUND`). No other tenant's
    customer data is ever returned.
    """

    normalized_name = normalize_customer_name(customer_name)
    if not normalized_name:
        return CustomerLookupResult(found=False, error="NOT_FOUND")

    tenant_match = await db.scalar(
        select(CustomerORM).where(
            CustomerORM.tenant_id == tenant_id,
            CustomerORM.normalized_name == normalized_name,
        )
    )
    if tenant_match is not None:
        return CustomerLookupResult(
            found=True,
            customer=customer_to_dict(tenant_match),
        )

    exists_elsewhere = await db.scalar(
        select(CustomerORM.customer_id).where(
            CustomerORM.normalized_name == normalized_name
        ).limit(1)
    )
    if exists_elsewhere is not None:
        return CustomerLookupResult(found=False, error="ACCESS_DENIED")

    return CustomerLookupResult(found=False, error="NOT_FOUND")
