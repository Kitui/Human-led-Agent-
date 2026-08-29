# Human-Led Agent Lab — FastAPI Edition

A small human-led AI orchestration lab with structured Action Points, guardrails, MCP tool access, human approval, retries, durable idempotency, tracing, evals, CI, and a FastAPI interface.

## Architecture

```text
Client / Swagger UI
       ↓
     FastAPI
       ↓
   workflow.py  ──────────→  PostgreSQL
       ↓                    (runs, evals, users,
Guardrail                    tenants, settings,
       ↓                     executed actions)
Investigator Agent → MCP → get_customer
       ↓
Structured Action Point
       ↓
Human approve / reject
       ↓
Execution Agent → create_task
       ↓
PostgreSQL idempotency record
       ↓
Retry-safe result
```

The CLI still works through `agent_lab/app.py`, but both the CLI and FastAPI now call the same reusable workflow functions.

## Project layout

```text
agent_lab/       Application package (agent, api, workflow, db, db_models, guardrails, tools, ...)
frontend/        Static dashboard UI (plain HTML/CSS/JS), served by the API
evals/           AI quality-gate eval suite (run in CI)
scripts/         Standalone manual smoke-test scripts (MCP)
tests/           Pytest unit/integration tests
docker-compose.yml   Local PostgreSQL (pgvector/pgvector image)
```

## Run locally

Start PostgreSQL (required before anything else — the app and the test
suite both need it):

```powershell
docker compose up -d
```

Activate your virtual environment, then install dependencies:

```powershell
pip install -r requirements.txt
```

Create `.env` locally and add your API key, database URL, and a JWT signing secret:

```text
OPENAI_API_KEY=your_key_here
DATABASE_URL=postgresql+asyncpg://agent_lab:agent_lab@localhost:5544/agent_lab
JWT_SECRET_KEY=any_long_random_string
```

Start the API:

```powershell
uvicorn agent_lab.api:app --reload
```

The API also serves the dashboard UI (from `frontend/`) directly, so once it's running:

```text
http://127.0.0.1:8000/         Dashboard UI
http://127.0.0.1:8000/docs     Swagger UI
```

## API flow

### 1. Health check

`GET /health` — no login required.

### 2. Log in

`POST /auth/login`

```json
{
  "username": "red_user",
  "password": "red-pass-123"
}
```

Returns a `access_token` (JWT) and the tenants this account may act on
(`tenant_ids`). Send it as `Authorization: Bearer <access_token>` on every
request below. Three demo accounts are seeded automatically on first
startup: `red_user` / `red-pass-123` (tenant_red only), `green_user` /
`green-pass-123` (tenant_green only), and `admin_user` / `admin-pass-123`
(both tenants).

### 3. Investigate

`POST /investigate`

```json
{
  "tenant_id": "tenant_red",
  "issue": "ACME says their invoice amount is wrong and their renewal is blocked."
}
```

`tenant_id` must be one of the tenants your logged-in account is allowed to
use, or the API returns `403`. Copy the returned `run_id`.

### 4. Approve

`POST /runs/{run_id}/approve`

This executes only the previously proposed Action Point.

Or reject it with:

`POST /runs/{run_id}/reject`

### 5. Read current state

`GET /runs/{run_id}`

### 6. List runs

`GET /runs` (optional `status` / `tenant_id` query filters) — used by the dashboard UI's Runs, Approvals, and Dashboard pages. Only returns runs for tenants your account can access.

## CLI

The old terminal experience remains available:

```powershell
python -m agent_lab.app
```

## Data storage

Workflow runs, eval history, user accounts, tenants, tenant settings, and successful write-tool executions are stored in PostgreSQL (see `docker-compose.yml`, `agent_lab/db.py`, `agent_lab/db_models.py`). Successful `create_task` results are committed to `executed_actions` before returning to the agent, so a retry after a lost response — or after an application restart — reuses the saved result instead of creating the action again.

On first startup, 3 demo accounts are seeded into the `users` table (`red_user` / `green_user` / `admin_user`, see `agent_lab/db.py`); log in with them via `POST /auth/login` (see API flow above).
