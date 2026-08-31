# CorrelAct

**Human-led operational investigation and controlled execution through WebMCP.**

CorrelAct helps an agent correlate evidence across operational systems, propose one focused next action, and execute consequential work only after a human has explicitly approved it. The product combines browser-native WebMCP tools, tenant isolation, human approval, durable idempotency, traces, evaluation gates, and a FastAPI/PostgreSQL backend.

## Why CorrelAct

Operational issues rarely live in one system. A renewal problem may begin as a Support case, depend on CRM account context, and ultimately be explained by Billing evidence. CorrelAct lets a browser agent inspect those sources through typed, constrained WebMCP capabilities rather than relying on copied context or unrestricted automation.

The trust model is deliberately asymmetric:

```text
Read evidence freely within the authenticated tenant
                    ↓
          Correlate and investigate
                    ↓
        Propose one focused action
                    ↓
             HUMAN REVIEW
              ↙          ↘
          Reject         Approve
            ↓               ↓
       No external      Execution becomes
          write         eligible in Tasks
                            ↓
                     create_task
                            ↓
                   Protected backend
                            ↓
                     GitHub Issue
                            ↓
                  Auditable completion
```

**Approval does not execute.** It only changes the run into an approved state. The external write happens later through the protected Tasks execution boundary.

## WebMCP Challenge work

CorrelAct existed as a human-led agent lab before the challenge period. The browser-native WebMCP product layer was built during the WebMCP Challenge window beginning August 25, 2026.

Challenge work includes:

- Support workspace with the read-only `get_case` WebMCP tool.
- CRM workspace with the read-only `get_customer` WebMCP tool.
- Billing workspace with the read-only `get_invoice` WebMCP tool.
- Investigation workspace that exposes the three evidence sources together.
- `submit_action_point`, which persists one evidence-grounded proposal for human review without performing an external write.
- Tasks workspace with `create_task`, which can execute only an already-approved CorrelAct action.
- Server-enforced tenant and customer matching across browser-agent execution.
- Durable idempotency so repeated execution requests create one external task.
- Shared authenticated browser sessions across CorrelAct workspaces.
- Immediate Tasks workspace refresh after successful WebMCP execution.
- Responsive CorrelAct design system, traces, audit presentation, and challenge-focused regression coverage.

The existing internal field and tool name `action_point` / `submit_action_point` are retained as compatibility contracts. The product-facing language is **Actions** and **Proposed Action**.

## Browser workspaces

| Workspace | Human experience | WebMCP capability | Authority |
| --- | --- | --- | --- |
| **Support** | Inspect customer case evidence | `get_case` | Read only |
| **CRM** | Inspect account and renewal context | `get_customer` | Read only |
| **Billing** | Inspect invoice/dispute evidence | `get_invoice` | Read only |
| **Investigation** | Verify evidence across systems | all three reads + `submit_action_point` | Read + propose |
| **Approvals** | Human reviews the proposed action | — | Human decision |
| **Tasks** | Execute approved work | `create_task` | Constrained write |
| **Traces** | Inspect investigation and execution history | — | Audit/read |

The browser layer is not a bypass around the backend. WebMCP tools call the same protected application boundaries used by CorrelAct, and the backend remains authoritative for tenant ownership, approval state, customer scope, idempotency, and execution eligibility.

## Architecture

```text
ChatGPT / WebMCP-capable browser agent
                    ↓
        CorrelAct browser workspaces
        ↙             ↓             ↘
    Support          CRM          Billing
    get_case    get_customer    get_invoice
        ↘             ↓             ↙
              Investigation
                    ↓
          submit_action_point
                    ↓
               FastAPI
                    ↓
              PostgreSQL
         (runs, evidence state,
        users, tenants, settings,
          executed actions)
                    ↓
             Human approval
                    ↓
             Approved run
                    ↓
      Tasks / WebMCP create_task
                    ↓
      Protected execution boundary
                    ↓
             GitHub Issues API
                    ↓
      Durable idempotency record
```

The underlying agent workflow and API use the same reusable backend functions, so browser-agent execution does not create a parallel security model.

## Product run states

```text
NEW
 ↓
INVESTIGATING
 ↓
AWAITING_APPROVAL
 ↙             ↘
REJECTED      APPROVED
                 ↓
             EXECUTING
                 ↓
             COMPLETED
```

A run cannot legitimately jump from investigation to external execution. Consequential writes require the approved state first.

## Project layout

```text
agent_lab/          Application package: agent, API, workflow, DB, MCP, tools
frontend/           CorrelAct UI and WebMCP browser workspaces
evals/              Live AI quality-gate runner
scripts/            Smoke tests and public-release security audit
tests/              Pytest unit/integration/security/UI contract tests
.github/workflows/  CI and Azure deployment pipelines
docker-compose.yml  Local PostgreSQL
requirements.txt    Exact direct dependency pins
requirements.lock   Fully resolved CI/deployment dependency snapshot
LICENSE              MIT license
```

## Security and trust boundaries

CorrelAct is designed so browser-agent convenience does not weaken server-side controls.

- **Authentication:** protected routes require an authenticated CorrelAct session.
- **Tenant isolation:** tenant access is checked server-side before investigation or execution.
- **Customer matching:** an approved run cannot be replayed against a different customer.
- **Human approval:** proposal and execution are separate phases.
- **Constrained execution:** `create_task` cannot rewrite the approved action, priority, target team, or scope.
- **Idempotency:** the same approved action cannot create duplicate external tasks through ordinary retries or repeated browser-agent calls.
- **Auditability:** runs, traces, approval state, and execution results remain visible in CorrelAct.
- **Public-release audit:** CI scans reachable git history for high-confidence credential material before build/test/eval gates proceed.

## GitHub task execution and idempotency

Every approved write receives a deterministic workflow idempotency key. `create_task` obtains a PostgreSQL advisory lock and checks the local `executed_actions` table. If no local execution exists, the GitHub adapter reconciles against an issue carrying the same hidden marker:

```text
<!-- human-led-agent-idempotency:<key> -->
```

The marker name is an internal compatibility artifact from the original lab and does not change the CorrelAct product identity.

Only when neither PostgreSQL nor GitHub already contains that action does the adapter create a new issue. This protects against retries, concurrent same-key attempts, process restarts, and lost HTTP responses after GitHub accepted the write.

## Run locally

Start PostgreSQL:

```powershell
docker compose up -d
```

Install the locked dependencies:

```powershell
pip install -r requirements.lock
pip check
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

`TASK_GITHUB_TOKEN` should be a fine-grained GitHub token with Issues read/write access to the configured repository. Never commit a real token.

### Optional demo identities

Demo passwords are not embedded in deployable application code and demo accounts are disabled by default.

To intentionally enable the reference identities, provide your own strong passwords:

```text
ENABLE_DEMO_USERS=true
DEMO_RED_PASSWORD=choose_a_strong_password_16_chars_or_more
DEMO_GREEN_PASSWORD=choose_a_strong_password_16_chars_or_more
DEMO_ADMIN_PASSWORD=choose_a_strong_password_16_chars_or_more
```

Reference grants:

- `red_user` → `tenant_red`
- `green_user` → `tenant_green`
- `admin_user` → both reference tenants

When `ENABLE_DEMO_USERS=false`, startup does not create those accounts and removes legacy copies of the demo usernames from an existing database. When demo mode is enabled, passwords must be supplied through environment configuration and existing demo hashes are rotated to those configured values.

Start CorrelAct:

```powershell
uvicorn agent_lab.api:app --reload
```

Local surfaces:

```text
http://127.0.0.1:8000/                CorrelAct
http://127.0.0.1:8000/investigation/  WebMCP Investigation workspace
http://127.0.0.1:8000/support/        Support evidence workspace
http://127.0.0.1:8000/crm/            CRM evidence workspace
http://127.0.0.1:8000/billing/        Billing evidence workspace
http://127.0.0.1:8000/tasks/          Approved execution workspace
http://127.0.0.1:8000/docs            Swagger UI
```

## API flow

### 1. Health

`GET /health` — no login required.

### 2. Authenticate

`POST /auth/login`

```json
{
  "username": "your_user",
  "password": "your_password"
}
```

The session identifies the tenants the account may access.

### 3. Investigate

`POST /investigate`

```json
{
  "tenant_id": "tenant_red",
  "issue": "ACME says their invoice amount is wrong and their renewal is blocked."
}
```

`tenant_id` must belong to the authenticated user or the API rejects the request before the investigation runs.

### 4. Human review

Approve:

`POST /runs/{run_id}/approve`

Reject:

`POST /runs/{run_id}/reject`

**Approving a run does not create the GitHub task.** It only records the human decision and moves the run to `APPROVED`.

### 5. Execute approved work

The approved run can then be executed through the Tasks workspace / `create_task` WebMCP capability. The protected backend verifies approval state, tenant, customer, and idempotency before any external write occurs.

### 6. Inspect state

`GET /runs/{run_id}`

`GET /runs` supports optional `status` and `tenant_id` filters and only returns runs within the authenticated tenant scope.

## Customer data and MCP

`agent_lab/mcp_server.py` defines the agent-facing `get_customer(customer_name, tenant_id)` capability. It opens a database session and delegates lookup to `agent_lab/customers.py`; it does not own customer records itself.

The `customers` table stores tenant ownership, normalized identity, plan, account status, renewal value/status, billing status, and timestamps. A unique `(tenant_id, normalized_name)` constraint prevents duplicate customer identities inside one tenant while allowing the same customer name in separate tenants.

ACME and GreenMart are reference records persisted in PostgreSQL rather than hardcoded MCP responses.

## Evaluation and CI

The live AI suite covers operational judgment, approval policy, customer evidence, tenant isolation, prompt/credential attacks, guardrail behavior, and invalid tenants. CI also runs deterministic unit/integration tests, builds the production container, and performs the public-release history audit.

Run the live evaluation suite manually with:

```powershell
python evals/evals.py
```

Run deterministic tests with:

```powershell
pytest
```

## Dependency reproducibility

Direct dependencies are pinned to exact versions in `requirements.txt`. CI and deployment use `requirements.lock`, which records the resolved Python 3.12 environment that passed tests and the live-eval gate.

For the reproducible installation used by CI:

```powershell
pip install -r requirements.lock
pip check
```

## CLI and MCP smoke test

The original lab CLI remains available as a compatibility/development surface:

```powershell
python -m agent_lab.app
python scripts/mcp_test.py
```

## Data storage

Workflow runs, customer records, eval history, user accounts, tenants, tenant settings, and successful write-tool executions are stored in PostgreSQL. `customers` is an investigation read source; `executed_actions` stores approved write results and GitHub reconciliation metadata.

## License

CorrelAct is licensed under the MIT License. See `LICENSE`.
