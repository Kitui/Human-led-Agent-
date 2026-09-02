from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from .models import EvalSuiteRun, WorkflowRun


class Base(DeclarativeBase):
    pass


class WorkflowRunORM(Base):
    __tablename__ = "workflow_runs"

    run_id: Mapped[str] = mapped_column(String, primary_key=True)
    tenant_id: Mapped[str] = mapped_column(String, index=True)
    issue: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String, index=True)
    step_count: Mapped[int] = mapped_column(Integer)
    max_steps: Mapped[int] = mapped_column(Integer)
    action_point: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    execution_result: Mapped[str | None] = mapped_column(Text, nullable=True)
    idempotency_key: Mapped[str | None] = mapped_column(String, nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    duration_seconds: Mapped[float | None] = mapped_column(Float, nullable=True)
    trace: Mapped[list] = mapped_column(JSONB, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    review_comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    metrics: Mapped[dict] = mapped_column(JSONB, default=dict)


class ExecutedActionORM(Base):
    """Durable idempotency record for write-tool execution.

    The idempotency key is the primary key, so only the first successful
    execution can create a record. Retries and later process instances read
    the saved result instead of repeating the external action.
    """

    __tablename__ = "executed_actions"

    idempotency_key: Mapped[str] = mapped_column(String, primary_key=True)
    tool_name: Mapped[str] = mapped_column(String, index=True)
    request: Mapped[dict] = mapped_column(JSONB)
    result: Mapped[dict] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)


class CustomerORM(Base):
    """Tenant-owned customer record exposed to agents through MCP.

    `normalized_name` gives the service a deterministic lookup key while the
    original `name` preserves display casing. The unique constraint allows the
    same customer name to exist in different tenants without mixing records.
    """

    __tablename__ = "customers"
    __table_args__ = (
        UniqueConstraint("tenant_id", "normalized_name", name="uq_customer_tenant_name"),
    )

    customer_id: Mapped[str] = mapped_column(String, primary_key=True)
    tenant_id: Mapped[str] = mapped_column(String, index=True)
    name: Mapped[str] = mapped_column(String)
    normalized_name: Mapped[str] = mapped_column(String, index=True)
    plan: Mapped[str] = mapped_column(String)
    account_status: Mapped[str] = mapped_column(String)
    renewal_value: Mapped[int] = mapped_column(Integer)
    renewal_status: Mapped[str] = mapped_column(String)
    billing_status: Mapped[str] = mapped_column(String)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class EvalSuiteRunORM(Base):
    __tablename__ = "eval_suite_runs"

    run_id: Mapped[str] = mapped_column(String, primary_key=True)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    duration_seconds: Mapped[float] = mapped_column(Float)
    cases: Mapped[list] = mapped_column(JSONB)
    passed_count: Mapped[int] = mapped_column(Integer)
    total_count: Mapped[int] = mapped_column(Integer)
    score: Mapped[float] = mapped_column(Float)
    threshold: Mapped[float] = mapped_column(Float)
    result: Mapped[str] = mapped_column(String)


class UserORM(Base):
    """Backs auth.py's authenticate_user()/get_current_user(). No Pydantic
    counterpart in models.py -- never returned to API callers directly."""

    __tablename__ = "users"

    username: Mapped[str] = mapped_column(String, primary_key=True)
    password_hash: Mapped[str] = mapped_column(String)
    tenant_ids: Mapped[list[str]] = mapped_column(ARRAY(String))


class TenantORM(Base):
    __tablename__ = "tenants"

    slug: Mapped[str] = mapped_column(String, primary_key=True)
    environment: Mapped[str] = mapped_column(String)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class TenantSettingsORM(Base):
    """Per-tenant configuration backing the Settings page's "General
    Settings" and "Model & Prompt" cards. Keyed on tenant_slug (matches
    TenantORM.slug) -- no FK constraint, consistent with the rest of this
    schema. A tenant with no row yet is provisioned by
    tenant_settings.get_or_create_settings() (or eagerly at seed time, see
    db.py) with defaults that match this codebase's hardcoded pre-this-PR
    behavior exactly, so adding a row never changes existing behavior."""

    __tablename__ = "tenant_settings"

    tenant_slug: Mapped[str] = mapped_column(String, primary_key=True)

    # General Settings card
    environment_name: Mapped[str] = mapped_column(String, default="")
    log_level: Mapped[str] = mapped_column(String, default="Info")
    default_language: Mapped[str] = mapped_column(String, default="English (US)")
    default_timezone: Mapped[str] = mapped_column(String, default="UTC")  # stored only; no display wiring yet
    max_concurrent_runs: Mapped[int] = mapped_column(Integer, default=20)
    max_steps: Mapped[int] = mapped_column(Integer, default=5)
    retry_limit: Mapped[int] = mapped_column(Integer, default=3)

    # Model & Prompt card
    default_model: Mapped[str | None] = mapped_column(String, nullable=True, default=None)
    system_prompt_override: Mapped[str | None] = mapped_column(Text, nullable=True, default=None)
    prompt_version: Mapped[int] = mapped_column(Integer, default=1)
    auto_update_prompt: Mapped[bool] = mapped_column(Boolean, default=True)


def workflow_run_to_columns(run: WorkflowRun) -> dict:
    """Domain -> ORM column values (write path only; the read path needs no
    mapping code -- WorkflowRun.model_validate(orm_row, from_attributes=True)
    handles it since column names match Pydantic field names exactly).
    Needed because: (1) status is a str Enum, store .value not the member;
    (2) nested Pydantic objects contain datetimes, so dump with mode="json"
    so JSONB gets ISO strings, not raw datetime objects it can't serialize."""

    return {
        "run_id": run.run_id,
        "tenant_id": run.tenant_id,
        "issue": run.issue,
        "status": run.status.value,
        "step_count": run.step_count,
        "max_steps": run.max_steps,
        "action_point": run.action_point.model_dump(mode="json") if run.action_point else None,
        "execution_result": run.execution_result,
        "idempotency_key": run.idempotency_key,
        "error": run.error,
        "duration_seconds": run.duration_seconds,
        "trace": [e.model_dump(mode="json") for e in run.trace],
        "created_at": run.created_at,
        "updated_at": run.updated_at,
        "review_comment": run.review_comment,
        "metrics": run.metrics.model_dump(mode="json"),
    }


def eval_suite_run_to_columns(suite: EvalSuiteRun) -> dict:
    return {
        "run_id": suite.run_id,
        "started_at": suite.started_at,
        "duration_seconds": suite.duration_seconds,
        "cases": [c.model_dump(mode="json") for c in suite.cases],
        "passed_count": suite.passed_count,
        "total_count": suite.total_count,
        "score": suite.score,
        "threshold": suite.threshold,
        "result": suite.result,
    }
