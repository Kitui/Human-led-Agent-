from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Body, Depends, FastAPI, HTTPException, Query
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from dotenv import load_dotenv

load_dotenv()

from .auth import authenticate_user, create_access_token, get_current_user
from .db import get_db, init_db, seed_demo_users
from .evals_runner import list_eval_runs, run_eval_suite
from .models import AuthenticatedUser, EvalSuiteRun, LoginResponse, RunStatus, WorkflowRun
from .workflow import (
    VALID_TENANTS,
    GuardrailBlockedError,
    InvalidRunStateError,
    InvalidTenantError,
    RunNotFoundError,
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


@app.post("/investigate", response_model=WorkflowRun)
async def investigate(
    request: InvestigationRequest,
    current_user: AuthenticatedUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> WorkflowRun:
    if request.tenant_id not in VALID_TENANTS:
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
    """Actually runs the real eval suite against the live investigator agent
    (3 real /investigate calls) and records the result. Not triggered
    automatically — only when a client explicitly calls this, since each
    call has a real OpenAI API cost."""
    return await run_eval_suite(db)


@app.get("/evals/runs", response_model=list[EvalSuiteRun])
async def read_eval_runs(
    current_user: AuthenticatedUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[EvalSuiteRun]:
    return await list_eval_runs(db)


# Mounted last so it never shadows the API routes above — Starlette matches
# routes in registration order, so unmatched paths (e.g. "/", "/app.js")
# fall through to serving the static frontend, while "/health", "/runs", etc.
# are always resolved by the routes declared first.
FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"
app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")
