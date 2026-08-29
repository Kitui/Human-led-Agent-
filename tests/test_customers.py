from sqlalchemy import select

from agent_lab.customers import lookup_customer
from agent_lab.db_models import CustomerORM


async def test_customer_lookup_reads_persisted_acme_record(db_session):
    result = await lookup_customer(
        db_session,
        customer_name="acme",
        tenant_id="tenant_red",
    )

    assert result.found is True
    assert result.error is None
    assert result.customer["name"] == "ACME"
    assert result.customer["plan"] == "Enterprise"
    assert result.customer["renewal_value"] == 120000
    assert result.customer["renewal_status"] == "blocked"
    assert result.customer["billing_status"] == "invoice_dispute"


async def test_cross_tenant_customer_lookup_returns_access_denied(db_session):
    result = await lookup_customer(
        db_session,
        customer_name="GreenMart",
        tenant_id="tenant_red",
    )

    assert result.to_dict() == {"found": False, "error": "ACCESS_DENIED"}


async def test_unknown_customer_lookup_returns_not_found(db_session):
    result = await lookup_customer(
        db_session,
        customer_name="Unknown Customer",
        tenant_id="tenant_red",
    )

    assert result.to_dict() == {"found": False, "error": "NOT_FOUND"}


async def test_customer_lookup_reflects_database_changes_not_hardcoded_data(db_session):
    acme = await db_session.scalar(
        select(CustomerORM).where(
            CustomerORM.tenant_id == "tenant_red",
            CustomerORM.normalized_name == "ACME",
        )
    )
    assert acme is not None

    acme.billing_status = "resolved"
    acme.renewal_status = "normal"
    await db_session.flush()

    result = await lookup_customer(
        db_session,
        customer_name="  Acme  ",
        tenant_id="tenant_red",
    )

    assert result.found is True
    assert result.customer["billing_status"] == "resolved"
    assert result.customer["renewal_status"] == "normal"
