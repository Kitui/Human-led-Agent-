from datetime import datetime, timezone

from agent_lab.db import _migrate_legacy_demo_identity
from agent_lab.db_models import (
    CustomerORM,
    EvalSuiteRunORM,
    ExecutedActionORM,
    TenantORM,
    TenantSettingsORM,
    UserORM,
    WorkflowRunORM,
)
from agent_lab.tenant_settings import DEFAULT_SETTINGS


async def test_legacy_demo_identity_migrates_existing_records_in_place(db_session):
    """The public-release rename must preserve history, not reseed over it."""

    now = datetime.now(timezone.utc)

    # Remove the canonical NorthStar demo user inside this test transaction so
    # the migration has to create it from the legacy user and preserve the hash.
    canonical_user = await db_session.get(UserORM, "user@northstar.com")
    if canonical_user is not None:
        await db_session.delete(canonical_user)
        await db_session.flush()

    legacy_tenant = TenantORM(
        slug="tenant_red",
        environment="Sandbox",
        is_active=False,
        created_at=now,
    )
    db_session.add(legacy_tenant)

    legacy_settings_values = dict(DEFAULT_SETTINGS)
    legacy_settings_values["max_steps"] = 9
    legacy_settings_values["environment_name"] = "Legacy NorthStar"
    db_session.add(
        TenantSettingsORM(
            tenant_slug="tenant_red",
            **legacy_settings_values,
        )
    )

    db_session.add(
        UserORM(
            username="red_user",
            password_hash="legacy-password-hash",
            tenant_ids=["tenant_red"],
        )
    )

    db_session.add(
        CustomerORM(
            customer_id="tenant_red:migration-customer",
            tenant_id="tenant_red",
            name="Migration Customer",
            normalized_name="MIGRATION CUSTOMER",
            plan="Enterprise",
            account_status="active",
            renewal_value=42000,
            renewal_status="blocked",
            billing_status="invoice_dispute",
            created_at=now,
            updated_at=now,
        )
    )

    run_id = "identity-migration-run"
    db_session.add(
        WorkflowRunORM(
            run_id=run_id,
            tenant_id="tenant_red",
            issue="Preserve this historical run exactly as an audit record.",
            status="completed",
            step_count=2,
            max_steps=5,
            action_point={
                "summary": "Historical proposal for tenant_red",
                "reviewer": "red_user",
            },
            execution_result="Historical execution result",
            idempotency_key=None,
            error=None,
            duration_seconds=1.5,
            trace=[
                {
                    "kind": "execution",
                    "label": "Legacy identity reference",
                    "detail": "tenant_red reviewed by red_user",
                }
            ],
            created_at=now,
            updated_at=now,
            review_comment=None,
            metrics={"organization": "tenant_red"},
        )
    )

    action_key = "identity-migration-action"
    db_session.add(
        ExecutedActionORM(
            idempotency_key=action_key,
            tool_name="create_task",
            request={"tenant_id": "tenant_red", "requested_by": "red_user"},
            result={"owner": "tenant_red"},
            created_at=now,
        )
    )

    eval_run_id = "identity-migration-eval"
    db_session.add(
        EvalSuiteRunORM(
            run_id=eval_run_id,
            started_at=now,
            duration_seconds=1.0,
            cases=[{"tenant_id": "tenant_red", "user": "red_user"}],
            passed_count=1,
            total_count=1,
            score=100.0,
            threshold=98.0,
            result="passed",
        )
    )

    await db_session.flush()

    changed = await _migrate_legacy_demo_identity(db_session)
    await db_session.flush()

    assert changed is True

    # Legacy identities disappear; canonical organizations/users carry the
    # original state instead of fresh defaults.
    assert await db_session.get(TenantORM, "tenant_red") is None
    northstar = await db_session.get(TenantORM, "NorthStar")
    assert northstar is not None
    assert northstar.environment == "Sandbox"
    assert northstar.is_active is False

    assert await db_session.get(TenantSettingsORM, "tenant_red") is None
    settings = await db_session.get(TenantSettingsORM, "NorthStar")
    assert settings is not None
    assert settings.max_steps == 9
    assert settings.environment_name == "Legacy NorthStar"

    assert await db_session.get(UserORM, "red_user") is None
    user = await db_session.get(UserORM, "user@northstar.com")
    assert user is not None
    assert user.password_hash == "legacy-password-hash"
    assert user.tenant_ids == ["NorthStar"]

    assert await db_session.get(CustomerORM, "tenant_red:migration-customer") is None
    customer = await db_session.get(CustomerORM, "NorthStar:migration-customer")
    assert customer is not None
    assert customer.tenant_id == "NorthStar"
    assert customer.name == "Migration Customer"
    assert customer.renewal_value == 42000

    run = await db_session.get(WorkflowRunORM, run_id)
    assert run is not None
    assert run.tenant_id == "NorthStar"
    assert run.issue == "Preserve this historical run exactly as an audit record."
    assert run.action_point["summary"] == "Historical proposal for NorthStar"
    assert run.action_point["reviewer"] == "user@northstar.com"
    assert run.trace[0]["detail"] == "NorthStar reviewed by user@northstar.com"
    assert run.metrics["organization"] == "NorthStar"

    action = await db_session.get(ExecutedActionORM, action_key)
    assert action.request["tenant_id"] == "NorthStar"
    assert action.request["requested_by"] == "user@northstar.com"
    assert action.result["owner"] == "NorthStar"

    eval_run = await db_session.get(EvalSuiteRunORM, eval_run_id)
    assert eval_run.cases == [
        {"tenant_id": "NorthStar", "user": "user@northstar.com"}
    ]

    # A second startup must be a no-op. This makes the migration safe across
    # Container App restarts and future deployments.
    changed_again = await _migrate_legacy_demo_identity(db_session)
    await db_session.flush()
    assert changed_again is False
