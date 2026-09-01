import os
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

from fastapi import Body, Depends, FastAPI, HTTPException, Query, Request, Response
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from dotenv import load_dotenv

load_dotenv()

from .auth import (
    ACCESS_TOKEN_EXPIRE,
    SESSION_COOKIE_NAME,
    authenticate_user,
    create_access_token,
    get_current_user,
)
from .customers import lookup_customer
from .db import get_db, init_db, seed_default_tenant_settings, seed_default_tenants, seed_demo_users
from .db_models import WorkflowRunORM, workflow_run_to_columns
from .evals_runner import list_eval_runs, run_eval_suite
from .models import (
    ActionPoint,
    ApprovedExecution,
    AuthenticatedUser,
    EvalSuiteRun,
    LoginResponse,
    RunStatus,
    Tenant,
    TenantSettings,
    TraceEvent,
    WorkflowRun,
)
from .tenant_settings import get_or_create_settings, update_settings
from .tenants import (
    DuplicateTenantError,
    TenantNotFoundError,
    create_tenant,
    is_valid_active_tenant,
    list_tenants,
    set_tenant_active,
    tenant_exists,
)
from .webmcp_tasks import (
    approve_webmcp_action_point,
    execute_webmcp_approved_task,
    is_webmcp_action_point,
)
from .workflow import (
    GuardrailBlockedError,
    InvalidRunStateError,
    InvalidTenantError,
    RunNotFoundError,
    TooManyConcurrentRunsError,
    approve_run,
    get_run,
    investigate_issue,
    list_runs,
    reject_run,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    await seed_demo_users()
    await seed_default_tenants()
    await seed_default_tenant_settings()
    yield


app = FastAPI(
    title="Human-Led Agent Lab API",
    version="1.0.0",
    description=(
        "FastAPI layer for a human-led agent workflow: investigate, "
        "review an Action Point, approve/reject, then execute."
    ),
    lifespan=lifespan,
)

FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"

PLATFORM_ADMIN_USERNAME = os.getenv(
    "CORRELACT_PLATFORM_ADMIN_USERNAME",
    "admin@correlact.com",
).strip().casefold()


def _is_platform_admin(user: AuthenticatedUser) -> bool:
    """Return whether this authenticated identity owns platform-level controls.

    The demo currently has one canonical platform administrator. Keeping the
    username configurable avoids coupling authorization to a secret or to the
    user's organization grants, while preserving the existing user table shape.
    """
    return user.username.strip().casefold() == PLATFORM_ADMIN_USERNAME


def _require_platform_admin(user: AuthenticatedUser) -> None:
    if not _is_platform_admin(user):
        raise HTTPException(
            status_code=403,
            detail="Platform administrator access required.",
        )


class LoginRequest(BaseModel):
    username: str
    password: str


class InvestigationRequest(BaseModel):
    tenant_id: str = Field(examples=["NorthStar"])
    issue: str = Field(
        min_length=1,
        max_length=2000,
        examples=[
            "ACME says their invoice amount is wrong and their renewal is blocked."
        ],
    )


class WebMcpEvidenceRequest(BaseModel):
    source: Literal["support", "crm", "billing"]
    reference: str = Field(min_length=1, max_length=120)
    finding: str = Field(min_length=1, max_length=700)


class WebMcpApprovedExecutionRequest(BaseModel):
    type: Literal["create_task", "update_crm_status"]
    crm_expected_status: Literal["blocked", "normal"] | None = None
    crm_target_status: Literal["escalation_open", "follow_up_required"] | None = None


class WebMcpActionPointRequest(BaseModel):
    tenant_id: str = Field(min_length=1, max_length=60)
    issue: str = Field(min_length=1, max_length=2000)
    title: str = Field(min_length=1, max_length=200)
    issue_type: str = Field(min_length=1, max_length=120)
    summary: str = Field(min_length=1, max_length=2000)
    priority: Literal["low", "medium", "high", "critical"]
    recommended_action: str = Field(min_length=1, max_length=2000)
    confidence: float = Field(ge=0.0, le=1.0)
    target_team: str = Field(min_length=1, max_length=120)
    execution: WebMcpApprovedExecutionRequest | None = None
    evidence: list[WebMcpEvidenceRequest] = Field(min_length=1, max_length=8)


class WebMcpApprovedTaskRequest(BaseModel):
    run_id: str = Field(min_length=1, max_length=120)
    tenant_id: str = Field(min_length=1, max_length=60)
    customer_name: str = Field(min_length=1, max_length=120)


class ReviewDecisionRequest(BaseModel):
    comment: str | None = Field(default=None, max_length=1000)


class TenantCreateRequest(BaseModel):
    slug: str = Field(min_length=1, max_length=60, examples=["Atlas"])
    environment: Literal["Production", "Staging", "Sandbox"] = "Production"


class TenantUpdateRequest(BaseModel):
    is_active: bool


class TenantSettingsUpdateRequest(BaseModel):
    environment_name: str | None = None
    log_level: Literal["Debug", "Info", "Warning", "Error"] | None = None
    default_language: str | None = None
    default_timezone: str | None = None
    max_concurrent_runs: int | None = Field(default=None, ge=1)
    max_steps: int | None = Field(default=None, ge=1)
    retry_limit: int | None = Field(default=None, ge=1)
    default_model: str | None = None
    system_prompt_override: str | None = None
    auto_update_prompt: bool | None = None
    # prompt_version is server-managed (auto-incremented only when
    # system_prompt_override actually changes) -- never accepted here.


def _request_is_https(request: Request) -> bool:
    forwarded_proto = request.headers.get("x-forwarded-proto", "").split(",", 1)[0].strip().lower()
    return forwarded_proto == "https" or request.url.scheme == "https"


def _set_browser_session_cookie(response: Response, token: str, request: Request) -> None:
    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=token,
        max_age=int(ACCESS_TOKEN_EXPIRE.total_seconds()),
        httponly=True,
        secure=_request_is_https(request),
        samesite="lax",
        path="/",
    )


def _clear_browser_session_cookie(response: Response, request: Request) -> None:
    response.delete_cookie(
        key=SESSION_COOKIE_NAME,
        path="/",
        secure=_request_is_https(request),
        httponly=True,
        samesite="lax",
    )


@app.get("/", include_in_schema=False)
async def public_landing() -> FileResponse:
    """Public project page used for previews, discovery, and challenge review."""
    return FileResponse(FRONTEND_DIR / "landing.html")


@app.get("/app", include_in_schema=False)
async def secured_app_shell() -> FileResponse:
    """Serve the authenticated CorrelAct application shell.

    Authentication remains enforced by the existing session/API boundary; this
    route only separates the public project preview from the secured product UI.
    """
    return FileResponse(FRONTEND_DIR / "index.html")


@app.get("/health")
async def health() -> dict:
    return {
        "status": "ok",
        "service": "human-led-agent-lab",
        "version": app.version,
    }


@app.post("/auth/login", response_model=LoginResponse)
async def login(
    request: LoginRequest,
    response: Response,
    http_request: Request,
    db: AsyncSession = Depends(get_db),
) -> LoginResponse:
    user = await authenticate_user(db, request.username, request.password)
    if user is None:
        raise HTTPException(status_code=401, detail="Invalid username or password.")

    token = create_access_token(user)
    _set_browser_session_cookie(response, token, http_request)
    return LoginResponse(access_token=token, tenant_ids=user.tenant_ids)


@app.get("/auth/session")
async def read_browser_session(
    response: Response,
    http_request: Request,
    current_user: AuthenticatedUser = Depends(get_current_user),
) -> dict:
    """Restore a browser tab from the shared HttpOnly login cookie.

    A fresh bearer token is returned only to preserve the existing frontend
    API wrapper while the cookie is what allows separate tabs/workspaces to
    discover the same authenticated browser session.
    """
    token = create_access_token(current_user)
    _set_browser_session_cookie(response, token, http_request)
    return {
        "username": current_user.username,
        "tenant_ids": current_user.tenant_ids,
        "access_token": token,
        "token_type": "bearer",
    }


@app.post("/auth/logout")
async def logout_browser(response: Response, http_request: Request) -> dict:
    _clear_browser_session_cookie(response, http_request)
    return {"status": "ok"}


@app.get("/crm/customers/{customer_name}")
async def read_crm_customer(
    customer_name: str,
    tenant_id: str = Query(..., min_length=1),
    current_user: AuthenticatedUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Read-only CRM surface used by the human UI and WebMCP get_customer tool."""
    if tenant_id not in current_user.tenant_ids:
        raise HTTPException(status_code=403, detail="Not authorized for this tenant.")
    if not await is_valid_active_tenant(db, tenant_id):
        raise HTTPException(status_code=400, detail="Invalid tenant.")

    result = await lookup_customer(
        db,
        customer_name=customer_name,
        tenant_id=tenant_id,
    )
    if result.found:
        return result.to_dict()
    if result.error == "ACCESS_DENIED":
        raise HTTPException(
            status_code=403,
            detail="Customer is not available in this tenant.",
        )
    raise HTTPException(status_code=404, detail="Customer not found.")


@app.post("/webmcp/action-points", response_model=WorkflowRun)
async def submit_webmcp_action_point(
    request: WebMcpActionPointRequest,
    current_user: AuthenticatedUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> WorkflowRun:
    """Persist a browser-agent proposal for human review without executing it."""
    tenant_id = request.tenant_id.strip()
    if not await is_valid_active_tenant(db, tenant_id):
        raise HTTPException(status_code=400, detail="Invalid tenant.")
    if tenant_id not in current_user.tenant_ids:
        raise HTTPException(status_code=403, detail="Not authorized for this tenant.")

    requested_execution = request.execution or WebMcpApprovedExecutionRequest(type="create_task")
    if requested_execution.type == "update_crm_status":
        if not requested_execution.crm_expected_status or not requested_execution.crm_target_status:
            raise HTTPException(
                status_code=422,
                detail="CRM status execution requires the exact expected and target renewal statuses before approval.",
            )
        allowed_transition = (
            requested_execution.crm_expected_status,
            requested_execution.crm_target_status,
        ) in {
            ("blocked", "escalation_open"),
            ("normal", "follow_up_required"),
        }
        if not allowed_transition:
            raise HTTPException(status_code=422, detail="CRM status transition is not allowed.")
    elif requested_execution.crm_expected_status or requested_execution.crm_target_status:
        raise HTTPException(
            status_code=422,
            detail="CRM status fields may only be supplied for update_crm_status.",
        )

    approved_execution = ApprovedExecution(**requested_execution.model_dump())
    settings = await get_or_create_settings(db, tenant_id)
    now = datetime.now(timezone.utc)
    action_point = ActionPoint(
        title=request.title.strip(),
        issue_type=request.issue_type.strip(),
        summary=request.summary.strip(),
        priority=request.priority,
        recommended_action=request.recommended_action.strip(),
        confidence=request.confidence,
        requires_human_approval=True,
        target_team=request.target_team.strip(),
        execution=approved_execution,
    )

    trace = [
        TraceEvent(
            timestamp=now,
            kind="execution",
            label="WebMCP Action Point submitted",
            detail=(
                f"Browser agent proposal persisted for human review with {approved_execution.type} "
                "as the bound execution capability. No consequential action was executed."
            ),
            tag="HUMAN_REVIEW",
        )
    ]
    trace.extend(
        TraceEvent(
            timestamp=now,
            kind="mcp",
            label=f"WebMCP {evidence.source} evidence attached",
            detail=f"{evidence.reference}: {evidence.finding}",
            tag="EVIDENCE",
        )
        for evidence in request.evidence
    )

    run = WorkflowRun(
        run_id=str(uuid.uuid4()),
        tenant_id=tenant_id,
        issue=request.issue.strip(),
        status=RunStatus.AWAITING_APPROVAL,
        step_count=1,
        max_steps=settings.max_steps,
        action_point=action_point,
        trace=trace,
        created_at=now,
        updated_at=now,
    )

    db.add(WorkflowRunORM(**workflow_run_to_columns(run)))
    await db.commit()
    return run


@app.post("/webmcp/tasks", response_model=WorkflowRun)
async def execute_webmcp_task(
    request: WebMcpApprovedTaskRequest,
    current_user: AuthenticatedUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> WorkflowRun:
    """Compatibility controlled-execution endpoint.

    The approved Action Point, not the browser payload, selects which backend
    adapter executes. Existing create_task clients keep the same endpoint while
    update_crm_status reuses the identical authorization and idempotency gate.
    """
    tenant_id = request.tenant_id.strip()
    if tenant_id not in current_user.tenant_ids:
        raise HTTPException(status_code=403, detail="Not authorized for this tenant.")

    try:
        run = await get_run(db, request.run_id)
    except RunNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Run not found.") from exc

    if run.tenant_id != tenant_id:
        raise HTTPException(status_code=403, detail="Run does not belong to this tenant.")

    try:
        return await execute_webmcp_approved_task(
            db,
            request.run_id,
            request.customer_name,
        )
    except RunNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Run not found.") from exc
    except InvalidRunStateError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.post("/investigate", response_model=WorkflowRun)
async def investigate(
    request: InvestigationRequest,
    current_user: AuthenticatedUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> WorkflowRun:
    if not await is_valid_active_tenant(db, request.tenant_id):
        raise HTTPException(status_code=400, detail="Invalid tenant.")
    if request.tenant_id not in current_user.tenant_ids:
        raise HTTPException(status_code=403, detail="Not authorized for this tenant.")

    try:
        return await investigate_issue(
            tenant_id=request.tenant_id,
            issue=request.issue,
            db=db,
        )
    except InvalidTenantError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except GuardrailBlockedError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except TooManyConcurrentRunsError as exc:
        raise HTTPException(status_code=429, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.get("/runs", response_model=list[WorkflowRun])
async def read_runs(
    status: RunStatus | None = Query(default=None),
    tenant_id: str | None = Query(default=None),
    current_user: AuthenticatedUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[WorkflowRun]:
    if tenant_id is not None:
        if tenant_id not in current_user.tenant_ids:
            raise HTTPException(status_code=403, detail="Not authorized for this tenant.")
        return await list_runs(db, status=status, tenant_id=tenant_id)

    runs = await list_runs(db, status=status)
    return [run for run in runs if run.tenant_id in current_user.tenant_ids]


@app.get("/runs/{run_id}", response_model=WorkflowRun)
async def read_run(
    run_id: str,
    current_user: AuthenticatedUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> WorkflowRun:
    try:
        run = await get_run(db, run_id)
    except RunNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Run not found.") from exc

    if run.tenant_id not in current_user.tenant_ids:
        raise HTTPException(status_code=403, detail="Not authorized for this tenant.")

    return run


@app.post("/runs/{run_id}/approve", response_model=WorkflowRun)
async def approve(
    run_id: str,
    request: ReviewDecisionRequest | None = Body(default=None),
    current_user: AuthenticatedUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> WorkflowRun:
    try:
        run = await get_run(db, run_id)
    except RunNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Run not found.") from exc

    if run.tenant_id not in current_user.tenant_ids:
        raise HTTPException(status_code=403, detail="Not authorized for this tenant.")

    try:
        if is_webmcp_action_point(run):
            return await approve_webmcp_action_point(
                db,
                run_id,
                comment=request.comment if request else None,
            )
        return await approve_run(db, run_id, comment=request.comment if request else None)
    except RunNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Run not found.") from exc
    except InvalidRunStateError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@app.post("/runs/{run_id}/reject", response_model=WorkflowRun)
async def reject(
    run_id: str,
    request: ReviewDecisionRequest | None = Body(default=None),
    current_user: AuthenticatedUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> WorkflowRun:
    try:
        run = await get_run(db, run_id)
    except RunNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Run not found.") from exc

    if run.tenant_id not in current_user.tenant_ids:
        raise HTTPException(status_code=403, detail="Not authorized for this tenant.")

    try:
        return await reject_run(db, run_id, comment=request.comment if request else None)
    except RunNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Run not found.") from exc
    except InvalidRunStateError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@app.post("/evals/run", response_model=EvalSuiteRun)
async def run_evals(
    current_user: AuthenticatedUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> EvalSuiteRun:
    """Run the real live eval suite and persist its score history.

    This is not triggered automatically from the UI because every suite run
    makes real model calls and therefore has a real OpenAI API cost.
    """
    return await run_eval_suite(db)


@app.get("/evals/runs", response_model=list[EvalSuiteRun])
async def read_eval_runs(
    current_user: AuthenticatedUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[EvalSuiteRun]:
    return await list_eval_runs(db)


@app.get("/tenants", response_model=list[Tenant])
async def read_tenants(
    current_user: AuthenticatedUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[Tenant]:
    tenants = await list_tenants(db)
    if _is_platform_admin(current_user):
        return tenants

    allowed = set(current_user.tenant_ids)
    return [tenant for tenant in tenants if tenant.slug in allowed]


@app.post("/tenants", response_model=Tenant)
async def create_tenant_route(
    request: TenantCreateRequest,
    current_user: AuthenticatedUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Tenant:
    _require_platform_admin(current_user)
    try:
        return await create_tenant(db, request.slug, request.environment)
    except DuplicateTenantError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@app.patch("/tenants/{slug}", response_model=Tenant)
async def update_tenant_route(
    slug: str,
    request: TenantUpdateRequest,
    current_user: AuthenticatedUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Tenant:
    if not await tenant_exists(db, slug):
        raise HTTPException(status_code=404, detail="Tenant not found.")
    _require_platform_admin(current_user)

    try:
        return await set_tenant_active(db, slug, request.is_active)
    except TenantNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Tenant not found.") from exc


@app.get("/tenants/{slug}/settings", response_model=TenantSettings)
async def read_tenant_settings(
    slug: str,
    current_user: AuthenticatedUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> TenantSettings:
    if not await tenant_exists(db, slug):
        raise HTTPException(status_code=404, detail="Tenant not found.")
    if slug not in current_user.tenant_ids and not _is_platform_admin(current_user):
        raise HTTPException(status_code=403, detail="Not authorized for this tenant.")

    try:
        return await get_or_create_settings(db, slug)
    except TenantNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Tenant not found.") from exc


@app.patch("/tenants/{slug}/settings", response_model=TenantSettings)
async def update_tenant_settings_route(
    slug: str,
    request: TenantSettingsUpdateRequest,
    current_user: AuthenticatedUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> TenantSettings:
    if not await tenant_exists(db, slug):
        raise HTTPException(status_code=404, detail="Tenant not found.")
    if slug not in current_user.tenant_ids and not _is_platform_admin(current_user):
        raise HTTPException(status_code=403, detail="Not authorized for this tenant.")

    try:
        return await update_settings(db, slug, **request.model_dump(exclude_unset=True))
    except TenantNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Tenant not found.") from exc


# Mounted last so it never shadows the API routes above — Starlette matches
# routes in registration order. The explicit public root and /app routes above
# therefore win, while shared frontend assets still resolve from this mount.
app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")