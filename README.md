# Human-Led Agent Lab — FastAPI Edition

A human-led AI orchestration lab with structured Action Points, guardrails, MCP tool access, human approval, retries, durable idempotency, tracing, evals, CI, and a FastAPI interface.

## Architecture

```text
Client / Dashboard / Swagger
       ↓
     FastAPI
       ↓
   workflow.py  ──────────→ PostgreSQL
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
agent_lab/          Application package: agent, API, workflow, DB, MCP, tools
frontend/           Static dashboard UI served by FastAPI
evals/              Live AI quality-gate runner
scripts/            Manual smoke-test utilities
tests/              Pytest unit/integration/security tests
docker-compose.yml  Local PostgreSQL
requirements.txt    Exact direct dependency pins
requirements.lock   Fully resolved CI/deployment dependency snapshot
LICENSE              MIT license
```

## Dependency reproducibility

Direct dependencies are pinned to exact versions in `requirements.txt`. CI and deployment use `requirements.lock`, which records the full resolved Python 3.12 environment that passed the test and live-eval gate.

For the most reproducible installation:

```powershell
pip install -r requirements.lock
pip check
```

When dependencies are intentionally upgraded, update the direct pins, regenerate/review the lock, and rerun both pytest and the live eval suite before merging.

## Run locally

Start PostgreSQL:

```powershell
docker compose up -d
```

Activate your virtual environment and install the locked dependencies:

```powershell
pip install -r requirements.lock
```

Create `.env` locally from `.env.example`:

```text
OPENAI_API_KEY=your_key_here
DATABASE_URL=postgresql+asyncpg://agent_lab:agent_lab@localhost:5544/agent_lab
JWT_SECRET_KEY=use_a_random_secret_at_least_32_characters
TASK_GITHUB_TOKEN=your_fine_grained_github_token
TASK_GITHUB_REPOSITORY=owner/repository
TASK_GITHUB_API_URL=https://api.github.com

ENABLE_DEMO_USERS=false
```

`TASK_GITHUB_TOKEN` should be a fine-grained GitHub token with Issues read/write access to the repository configured in `TASK_GITHUB_REPOSITORY`. Never commit the real token.

### Optional local/demo login accounts

Known demo passwords are **not** embedded in application code and demo accounts are **disabled by default**.

To intentionally enable the three learning/demo identities, set your own passwords:

```text
ENABLE_DEMO_USERS=true
DEMO_RED_PASSWORD=choose_a_strong_password_16_chars_or_more
DEMO_GREEN_PASSWORD=choose_a_strong_password_16_chars_or_more
DEMO_ADMIN_PASSWORD=choose_a_strong_password_16_chars_or_more
```

The identities and grants are:

- `red_user` → `tenant_red`
- `green_user` → `tenant_green`
- `admin_user` → both reference tenants

When `ENABLE_DEMO_USERS=false`, application startup does not create those accounts and removes legacy copies of those demo usernames from an existing database. This prevents an upgraded deployment from retaining the old fixed-password accounts.

Start the API:

```powershell
uvicorn agent_lab.api:app --reload
```

The API serves both the dashboard and Swagger UI:

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
  "username": "your_user",
  "password": "your_password"
}
```

Returns an `access_token` JWT and the tenants the account may act on. Send it as `Authorization: Bearer <access_token>` on authenticated requests.

### 3. Investigate

`POST /investigate`

```json
{
  "tenant_id": "tenant_red",
  "issue": "ACME says their invoice amount is wrong and their renewal is blocked."
}
```

`tenant_id` must be one of the tenants assigned to the authenticated user or the API returns `403`.

The investigator's `get_customer` MCP tool does not own customer data. It calls `agent_lab/customers.py`, which resolves the tenant-owned record from the PostgreSQL `customers` table.

Tenant behavior is explicit:

- correct tenant + known customer → customer data
- known customer owned by another tenant → `ACCESS_DENIED`
- unknown customer → `NOT_FOUND`

### 4. Review and approve/reject

`POST /runs/{run_id}/approve`

Approval executes only the previously proposed Action Point. The execution agent then calls `create_task`, which creates a real GitHub Issue in `TASK_GITHUB_REPOSITORY`.

Reject with:

`POST /runs/{run_id}/reject`

### 5. Read current state

`GET /runs/{run_id}`

### 6. List runs

`GET /runs` supports optional `status` and `tenant_id` filters. Results are restricted to tenants the authenticated user may access.

## Customer data and MCP

`agent_lab/mcp_server.py` defines the agent-facing `get_customer(customer_name, tenant_id)` tool. The tool opens a database session and delegates lookup to `agent_lab/customers.py`.

The `customers` table stores tenant ownership, normalized identity, plan, account status, renewal value/status, billing status, and timestamps.

A unique `(tenant_id, normalized_name)` constraint prevents duplicate customer identities inside a tenant while allowing the same customer name in separate tenants.

ACME and GreenMart are reference/demo customer records persisted in PostgreSQL, not hardcoded MCP responses. They can therefore change without modifying agent or MCP code.

## GitHub task execution and idempotency

Every approved write receives a deterministic workflow idempotency key. `create_task` obtains a PostgreSQL advisory lock and checks the local `executed_actions` table. If no local execution exists, the GitHub adapter reconciles against an issue carrying the same hidden marker:

```text
<!-- human-led-agent-idempotency:<key> -->
```

Only when neither PostgreSQL nor GitHub already contains that action does the adapter create a new issue. This protects against ordinary retries, concurrent same-key attempts, process restarts, and lost HTTP responses after GitHub accepted the write.

## Evaluation gate

The live suite covers operational judgment, approval policy, customer evidence, tenant isolation, prompt/credential attacks, guardrail behavior, and invalid tenants. CI keeps a 90% minimum quality gate in addition to deterministic pytest coverage.

Run it manually with:

```powershell
python evals/evals.py
```

## CLI and MCP smoke test

```powershell
python -m agent_lab.app
python scripts/mcp_test.py
```

## Data storage

Workflow runs, customer records, eval history, user accounts, tenants, tenant settings, and successful write-tool executions are stored in PostgreSQL. `customers` is the investigator's persistent read source; `executed_actions` stores approved write results and GitHub reconciliation metadata.

## License

This project is licensed under the MIT License. See `LICENSE`.
