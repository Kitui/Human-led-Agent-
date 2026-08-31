from contextlib import asynccontextmanager
from pathlib import Path
from typing import Literal

from fastapi import Body, Depends, FastAPI, HTTPException, Query
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from dotenv import load_dotenv

load_dotenv()

from .auth import authenticate_user, create_access_token, get_current_user
from .customers import lookup_customer
from .db import get_db, init_db, seed_default_tenant_settings, seed_default_tenants, seed_demo_users
from .evals_runner import list_eval_runs, run_eval_suite
from .models import AuthenticatedUser, EvalSuiteRun, LoginResponse, RunStatus, Tenant, TenantSettings, WorkflowRun
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


class LoginRequest(BaseModel):
    username: str
    password: str


class InvestigationRequest(BaseModel):
    tenant_id: str = Field(examples=["tenant_red"])
    issue: str = Field(
        min_length=1,
        max_length=2000,
        examples=[
            "ACME says their invoice amount is wrong and their renewal is blocked."
        ],
    )


class ReviewDecisionRequest(BaseModel):
    comment: str | None = Field(default=None, max_length=1000)


class TenantCreateRequest(BaseModel):
    slug: str = Field(min_length=1, max_length=60, examples=["tenant_blue"])
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


@app.get("/health")
async def health() -> dict:
    return {
        "status": "ok",
        "service": "human-led-agent-lab",
        "version": app.version,
    }


@app.post("/auth/login", response_model=LoginResponse)
async def login(request: LoginRequest, db: AsyncSession = Depends(get_db)) -> LoginResponse:
    user = await authenticate_user(db, request.username, request.password)
    if user is None:
        raise HTTPException(status_code=401, detail="Invalid username or password.")
    return LoginResponse(access_token=create_access_token(user), tenant_ids=user.tenant_ids)


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
    # Deliberately not scoped to current_user.tenant_ids: unlike GET /runs,
    # this lab has no role system to grant a user access to a tenant they
    # didn't create, so scoping this list would make a newly-created tenant
    # invisible to its own creator. Listing/creating tenants stays open to
    # any logged-in user; PATCHing an existing tenant's active state or
    # settings is scoped below -- that's the actual boundary that matters.
    current_user: AuthenticatedUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[Tenant]:
    return await list_tenants(db)


@app.post("/tenants", response_model=Tenant)
async def create_tenant_route(
    request: TenantCreateRequest,
    current_user: AuthenticatedUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Tenant:
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
    # Existence checked before authorization (matches GET /runs/{id} etc.):
    # a nonexistent tenant is a 404 even for a caller who'd also be
    # unauthorized for it, rather than always masking it as a 403.
    if not await tenant_exists(db, slug):
        raise HTTPException(status_code=404, detail="Tenant not found.")
    if slug not in current_user.tenant_ids:
        raise HTTPException(status_code=403, detail="Not authorized for this tenant.")

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
    if slug not in current_user.tenant_ids:
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
    if slug not in current_user.tenant_ids:
        raise HTTPException(status_code=403, detail="Not authorized for this tenant.")

    try:
        return await update_settings(db, slug, **request.model_dump(exclude_unset=True))
    except TenantNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Tenant not found.") from exc


# Mounted last so it never shadows the API routes above — Starlette matches
# routes in registration order, so unmatched paths (e.g. "/", "/app.js")
# fall through to serving the static frontend, while "/health", "/runs", etc.
# are always resolved by the routes declared first.
FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"
app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")
