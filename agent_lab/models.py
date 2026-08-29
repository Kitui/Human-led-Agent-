from datetime import datetime, timezone
from enum import Enum
from typing import Literal

from pydantic import BaseModel, Field


class RunStatus(str, Enum):
    NEW = "new"
    INVESTIGATING = "investigating"
    AWAITING_APPROVAL = "awaiting_approval"
    APPROVED = "approved"
    EXECUTING = "executing"
    COMPLETED = "completed"
    REJECTED = "rejected"
    FAILED = "failed"


class AgentRun(BaseModel):
    status: RunStatus = RunStatus.NEW
    step_count: int = 0
    max_steps: int = 5


class ActionPoint(BaseModel):
    title: str
    issue_type: str
    summary: str
    priority: Literal["low", "medium", "high", "critical"]
    recommended_action: str
    confidence: float = Field(ge=0.0, le=1.0)
    requires_human_approval: bool
    target_team: str | None = None


class TraceEvent(BaseModel):
    """A single observed step in a run: a guardrail check, an MCP tool call, or an
    execution milestone. Populated from data the agent run already produces —
    never fabricated."""

    timestamp: datetime
    kind: Literal["guardrail", "mcp", "execution", "error"]
    label: str
    detail: str | None = None
    tag: str | None = None


class RunMetrics(BaseModel):
    """Real usage counters accumulated from the agent SDK's own RunResult
    objects (raw_responses / usage / new_items) — never estimated."""

    model_calls: int = 0
    tool_calls: int = 0
    total_tokens: int = 0


class WorkflowRun(AgentRun):
    run_id: str
    tenant_id: str
    issue: str
    action_point: ActionPoint | None = None
    execution_result: str | None = None
    idempotency_key: str | None = None
    error: str | None = None
    duration_seconds: float | None = None
    trace: list[TraceEvent] = Field(default_factory=list)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    review_comment: str | None = None
    metrics: RunMetrics = Field(default_factory=RunMetrics)


class EvalCaseResult(BaseModel):
    """Real outcome of running one eval case against the live investigator
    agent — nothing here is simulated."""

    name: str
    tenant_id: str
    input: str
    expected_priority: str
    actual_priority: str | None = None
    expected_approval: bool
    actual_approval: bool | None = None
    expects_tool_call: bool = False
    tool_call_correct: bool | None = None
    passed: bool
    error: str | None = None


class EvalSuiteRun(BaseModel):
    """One real execution of the eval suite (agent_lab/eval_cases.py)."""

    run_id: str
    started_at: datetime
    duration_seconds: float
    cases: list[EvalCaseResult]
    passed_count: int
    total_count: int
    score: float
    threshold: float
    result: Literal["passed", "failed"]


class AuthenticatedUser(BaseModel):
    username: str
    tenant_ids: list[str]


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    tenant_ids: list[str]


class Tenant(BaseModel):
    slug: str
    environment: Literal["Production", "Staging", "Sandbox"]
    is_active: bool
    created_at: datetime


class TenantSettings(BaseModel):
    tenant_slug: str
    environment_name: str = ""
    log_level: Literal["Debug", "Info", "Warning", "Error"] = "Info"
    default_language: str = "English (US)"
    default_timezone: str = "UTC"
    max_concurrent_runs: int = 20
    max_steps: int = 5
    retry_limit: int = 3
    default_model: str | None = None
    system_prompt_override: str | None = None
    prompt_version: int = 1
    auto_update_prompt: bool = True
