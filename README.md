# Human-Led Agent Lab — FastAPI Edition

A small human-led AI orchestration lab with structured Action Points, guardrails, MCP tool access, human approval, retries, durable idempotency, tracing, evals, CI, and a FastAPI interface.

## Architecture

```text
Client / Swagger UI
       ↓
     FastAPI
       ↓
   workflow.py  ──────────→  PostgreSQL
       ↓                    (runs, customers, evals,
Guardrail                    users, tenants, settings,
       ↓                     executed actions)
Investigator Agent
       ↓
      MCP → get_customer
       ↓
Customer service
       ↓
PostgreSQL customers
       ↓
Structured Action Point
       ↓
Human approve / reject
       ↓
Execution Agent → create_task
       ↓
GitHub Issues API
       ↓
PostgreSQL idempotency record
       ↓
Retry-safe result
```

The CLI still works through `agent_lab/app.py`, but both the CLI and FastAPI call the same reusable workflow functions.

## Project layout

```text
agent_lab/       Application package (agent, API, workflow, DB, customer service, MCP, GitHub adapter, ...)
frontend/        Static dashboard UI (plain HTML/CSS/JS), served by the API
evals/           AI quality-gate eval suite (run in CI)
scripts/         Standalone manual smoke-test scripts (MCP)
tests/           Pytest unit/integration tests
docker-compose.yml   Local PostgreSQL (pgvector/pgvector image)
```

## Run locally

Start PostgreSQL:

```powershell
docker compose up -d
```

Activate your virtual environment and install dependencies:

```powershell
pip install -r requirements.txt
```

Create `.env` locally:

```text
OPENAI_API_KEY=your_key_here
DATABASE_URL=postgresql+asyncpg://agent_lab:agent_lab@localhost:5544/agent_lab
JWT_SECRET_KEY=any_long_random_string
TASK_GITHUB_TOKEN=your_fine_grained_github_token
TASK_GITHUB_REPOSITORY=owner/repository
TASK_GITHUB_API_URL=https://api.github.com
```

`TASK_GITHUB_TOKEN` should be a fine-grained GitHub token with Issues read/write access to the repository configured in `TASK_GITHUB_REPOSITORY`. Never commit the real token.

Start the API:

```powershell
uvicorn agent_lab.api:app --reload
```

The API also serves the dashboard UI:

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

Returns an `access_token` (JWT) and the tenants this account may act on (`tenant_ids`). Send it as `Authorization: Bearer <access_token>` on authenticated requests. Three demo accounts are seeded automatically on first startup: `red_user` / `red-pass-123` (tenant_red only), `green_user` / `green-pass-123` (tenant_green only), and `admin_user` / `admin-pass-123` (both tenants).

### 3. Investigate

`POST /investigate`

```json
{
  "tenant_id": "tenant_red",
  "issue": "ACME says their invoice amount is wrong and their renewal is blocked."
}
```

`tenant_id` must be one of the tenants your logged-in account is allowed to use, or the API returns `403`. Copy the returned `run_id`.

The investigator's `get_customer` MCP tool no longer reads a Python dictionary. It calls `agent_lab/customers.py`, which resolves the tenant-owned record from the PostgreSQL `customers` table. The demo ACME and GreenMart rows are seeded into that table only when missing and can be changed in PostgreSQL without changing agent or MCP code.

Tenant behavior remains explicit:

- correct tenant + known customer → customer data
- known customer owned by another tenant → `ACCESS_DENIED`
- unknown customer → `NOT_FOUND`

### 4. Approve

`POST /runs/{run_id}/approve`

Approval executes only the previously proposed Action Point. The execution agent calls `create_task`, which creates a real GitHub Issue in `TASK_GITHUB_REPOSITORY`.

Reject with:

`POST /runs/{run_id}/reject`

### 5. Read current state

`GET /runs/{run_id}`

### 6. List runs

`GET /runs` (optional `status` / `tenant_id` query filters) — used by the dashboard UI's Runs, Approvals, and Dashboard pages. Only returns runs for tenants your account can access.

## Customer data and MCP

`agent_lab/mcp_server.py` defines the agent-facing `get_customer(customer_name, tenant_id)` tool. It owns no customer records itself. The tool opens a database session and delegates lookup to `agent_lab/customers.py`.

The `customers` table stores:

- tenant ownership
- display and normalized customer name
- plan
- account status
- renewal value and status
- billing status
- created/updated timestamps

A unique `(tenant_id, normalized_name)` constraint prevents duplicate customer identities inside a tenant while still allowing different tenants to have customers with the same name.

ACME and GreenMart remain reference/demo records, but they now live in PostgreSQL and are seeded idempotently. This means the data can evolve independently of the MCP server and investigator prompt.

## GitHub task execution and idempotency

Every approved write receives a deterministic workflow idempotency key. `create_task` first obtains a PostgreSQL advisory lock for that key and checks the local `executed_actions` table. If no local record exists, the GitHub adapter checks the target repository for an issue carrying the same hidden marker:

```text
<!-- human-led-agent-idempotency:<key> -->
```

Only when neither PostgreSQL nor GitHub already contains that action does the adapter create a new issue. This protects against ordinary retries, concurrent same-key attempts, process restarts, and the case where GitHub created the issue but the HTTP response was lost before the application could persist the result.

The stored execution result includes the GitHub provider, repository, issue number, issue URL, task ID (`GH-<issue number>`), customer, team, priority, and idempotency key.

## CLI

```powershell
python -m agent_lab.app
```

The standalone MCP smoke test can also be run with:

```powershell
python scripts/mcp_test.py
```

Both entry points initialize the database before starting the MCP-backed investigation path.

## Data storage

Workflow runs, customer records, eval history, user accounts, tenants, tenant settings, and successful write-tool executions are stored in PostgreSQL. `customers` is the investigator's persistent read source; `executed_actions` stores approved write results and their GitHub reconciliation metadata.
