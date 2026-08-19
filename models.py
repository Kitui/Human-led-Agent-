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