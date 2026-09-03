<div align="center">

# CorrelAct

**Human-led operational intelligence, built on WebMCP.**

CorrelAct lets a browser-native AI agent read evidence across CRM, Billing, and Support, correlate it into one proposed action, and execute consequential work *only* after a human has explicitly approved exactly that action.

[![CI](https://github.com/Kitui/CorrelAct/actions/workflows/ci.yml/badge.svg)](https://github.com/Kitui/CorrelAct/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Python 3.12](https://img.shields.io/badge/python-3.12-3776AB?logo=python&logoColor=white)](requirements.txt)
[![FastAPI](https://img.shields.io/badge/FastAPI-async-009688?logo=fastapi&logoColor=white)](agent_lab/api.py)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-async-4169E1?logo=postgresql&logoColor=white)](docker-compose.yml)
[![Built for the OpenAI WebMCP Challenge](https://img.shields.io/badge/OpenAI-WebMCP%20Challenge-EF2B32)](docs/webmcp.md)

<br />

<img src="docs/screenshots/dashboard.png" alt="CorrelAct dashboard showing run volume, status breakdown, and human-reviewed execution activity" width="860" />

</div>

<br />

## Table of contents

- [The problem](#the-problem)
- [How CorrelAct works](#how-correlact-works)
- [Two governed write paths, one gate](#two-governed-write-paths-one-gate)
- [Dynamic Agent Authority](#dynamic-agent-authority)
- [WebMCP tools](#webmcp-tools)
- [Browser workspaces](#browser-workspaces)
- [Architecture](#architecture)
- [Security and trust boundaries](#security-and-trust-boundaries)
- [Live demo](#live-demo)
- [Run it locally](#run-it-locally)
- [API flow](#api-flow)
- [Testing and CI](#testing-and-ci)
- [Project layout](#project-layout)
- [License](#license)

## The problem

Operational issues rarely live in one system. A renewal problem might start as a Support case, depend on CRM account context, and ultimately be explained by a Billing dispute. Today, closing that loop with an AI agent usually means one of two bad options: give the agent standing write access to production systems and hope its judgment holds up every time, or keep it read-only and force a human to do all the actual work by hand.

CorrelAct is built on the premise that neither is necessary. A browser-native agent can be **fully autonomous while investigating** — reading evidence, correlating sources, forming a recommendation — and **fully constrained while acting**, because the write it's ultimately allowed to make is decided by a human before the agent ever touches anything consequential.

## How CorrelAct works

The trust model is deliberately asymmetric: wide open for reading, narrow and human-gated for writing.

```mermaid
flowchart TD
    A["Read evidence freely\n(CRM · Billing · Support)"] --> B[Correlate across sources]
    B --> C["Propose exactly one action\nsubmit_action_point"]
    C --> D{Human review}
    D -- Reject --> E["No external write\never occurs"]
    D -- Approve --> F["Run becomes APPROVED\n(authorized, not executed)"]
    F --> G["Exactly one execution capability\nbecomes available"]
    G --> H["Constrained execution\ncreate_task or update_crm_status"]
    H --> I["Idempotent, audited outcome"]

    style D fill:#ef2b32,color:#fff,stroke:#ef2b32
    style F fill:#0c192a,color:#fff,stroke:#22344a
    style H fill:#0c192a,color:#fff,stroke:#22344a
```

**Approval does not execute.** It only moves a run into an approved state and unlocks the one execution capability a human reviewed. The write itself happens later, through a protected backend boundary that re-verifies organization, customer, approval state, and idempotency — independent of anything the browser agent claims.

## Two governed write paths, one gate

Most agent demos show a single write action. CorrelAct deliberately implements **two independent, differently-shaped consequential actions** — creating an external task and mutating a CRM record — to prove the governance boundary is a reusable architectural pattern, not a special case hardcoded around one integration.

| | `create_task` | `update_crm_status` |
| --- | --- | --- |
| Effect | Creates a GitHub issue from the approved scope | Applies one allow-listed CRM renewal-status transition |
| Approved scope frozen at review time | Title, priority, target team, customer | `expected_status → target_status`, customer |
| Idempotency | PostgreSQL advisory lock + durable marker reconciled against GitHub | PostgreSQL advisory lock + durable execution record |
| Rejects | Unapproved, cross-organization, mismatched-customer, wrong-capability runs | Unapproved, cross-organization, mismatched-customer, stale-state, disallowed-transition runs |

Both routes end at the same reviewer screen before anything happens — the human sees the *exact* execution capability and the *exact* scope before it can ever run:

<img src="docs/screenshots/approvals-detail.png" alt="Approvals detail panel showing Execution Capability: update_crm_status and Approved Execution Scope: renewal_status blocked to escalation_open" width="760" />

```mermaid
flowchart LR
    A[HUMAN APPROVAL] --> B["Shared controlled-execution gate\norganization · evidence · state · idempotency · audit"]
    B --> C[create_task]
    B --> D[update_crm_status]
    C --> E[GitHub Issue]
    D --> F[CRM record]
```

Same governed boundary. Different consequential action. The agent receives only the capability the human approved — see [`docs/judge-testing.md`](docs/judge-testing.md) for the full step-by-step proof of both paths.

## Dynamic Agent Authority

The Tasks workspace doesn't just *block* an unapproved write at the backend — it doesn't even **advertise** the tool to the browser agent until there's human-approved work for it to act on. Registration is computed live from the set of currently-approved, currently-executable runs for the signed-in organization.

<img src="docs/screenshots/tasks-authority.png" alt="Tasks workspace showing the Dynamic Agent Authority panel: read evidence, propose action, execute — with create_task registered only while approved work exists" width="760" />

If there's no approved work, `create_task` and `update_crm_status` simply don't exist in that page's WebMCP tool list — there's nothing for a compromised or confused agent to even attempt.

## WebMCP tools

| Tool | Kind | Workspace | What it does |
| --- | --- | --- | --- |
| `get_case` | Read | Support | Reads a customer support case: status, priority, escalation state, assigned team |
| `get_customer` | Read | CRM | Reads a customer account: plan, renewal status/value, billing status |
| `get_invoice` | Read | Billing | Reads an invoice: amounts, variance, dispute state, renewal hold |
| `submit_action_point` | Propose | Investigation | Persists one evidence-grounded proposal for human review — performs no external write |
| `create_task` | Constrained write | Tasks | Executes one already-approved `create_task` run |
| `update_crm_status` | Constrained write | Tasks | Executes one already-approved `update_crm_status` run |

Every tool is a thin, typed wrapper (`document.modelContext.registerTool`) around the same protected FastAPI endpoints the human UI calls. WebMCP is a *capability surface*, not a bypass — there is no parallel security model for agent-originated requests.

## Browser workspaces

| Workspace | Human experience | WebMCP capability | Authority |
| --- | --- | --- | --- |
| **Support** | Inspect customer case evidence | `get_case` | Read only |
| **CRM** | Inspect account and renewal context | `get_customer` | Read only |
| **Billing** | Inspect invoice and dispute evidence | `get_invoice` | Read only |
| **Investigation** | Verify evidence across all three systems | all reads + `submit_action_point` | Read + propose |
| **Approvals** | Human reviews the proposed action and its exact execution capability | — | Human decision |
| **Tasks** | Execute approved work, nothing else | `create_task`, `update_crm_status` | Constrained write |
| **Traces** | Inspect the full investigation → approval → execution timeline | — | Audit / read |

<img src="docs/screenshots/crm.png" alt="CRM workspace side-by-side human search form and the get_customer WebMCP tool it exposes" width="760" />

<img src="docs/screenshots/investigate.png" alt="Investigate workspace with the issue-description form and investigation workflow stepper" width="760" />

## Architecture

```mermaid
flowchart TD
    Agent["ChatGPT / WebMCP-capable browser agent"]
    Agent --> Support["Support\nget_case"]
    Agent --> CRM["CRM\nget_customer"]
    Agent --> Billing["Billing\nget_invoice"]
    Support --> Inv[Investigation workspace]
    CRM --> Inv
    Billing --> Inv
    Inv --> Submit["submit_action_point"]
    Submit --> API[FastAPI]
    API --> DB[("PostgreSQL\nruns · evidence · users\norganizations · executed actions")]
    DB --> Approval[Human approval]
    Approval --> Approved[Run: APPROVED]
    Approved --> Tasks["Tasks workspace\ncreate_task / update_crm_status"]
    Tasks --> Boundary[Protected execution boundary]
    Boundary --> GH[GitHub Issues API]
    Boundary --> CRMWrite[CRM record]
    Boundary --> Idem["Durable idempotency record"]
```

The agent workflow (CLI/API investigator) and the browser-agent WebMCP path converge on the same backend functions — see [`docs/unified-controlled-execution.md`](docs/unified-controlled-execution.md). Browser-agent execution never creates a parallel, weaker security model.

### Run states

```mermaid
stateDiagram-v2
    [*] --> NEW
    NEW --> INVESTIGATING
    INVESTIGATING --> AWAITING_APPROVAL
    AWAITING_APPROVAL --> REJECTED
    AWAITING_APPROVAL --> APPROVED
    APPROVED --> EXECUTING
    EXECUTING --> COMPLETED
    REJECTED --> [*]
    COMPLETED --> [*]
```

A run cannot legitimately skip from investigation to external execution — consequential writes require the `APPROVED` state first, and `APPROVED` is not itself a write.

## Security and trust boundaries

- **Authentication** — every protected route requires an authenticated CorrelAct session.
- **Organization isolation** — access is checked server-side before investigation or execution, never inferred from client-supplied context.
- **Customer matching** — an approved run cannot be replayed against a different customer.
- **Human approval** — proposal and execution are separate phases; approving does not execute.
- **Constrained execution** — neither write tool can rewrite the approved scope, priority, target, or customer.
- **Idempotency** — a PostgreSQL advisory lock plus a durable execution record means retries and repeated agent calls cannot duplicate a write.
- **Dynamic tool exposure** — a write tool is only registered in the browser while matching approved work exists for that organization.
- **Auditability** — every run's evidence, trace, approval decision, and execution result stays visible in CorrelAct.
- **Public-release history audit** — CI scans reachable git history for high-confidence credential material before build, test, or eval gates proceed.
- **WCAG AA color contrast** and a full accessibility pass across both the light and dark themes.

150+ automated tests (unit, integration, security, and browser/UI contract tests) plus a 15-case live AI evaluation suite (operational judgment, approval policy, organization isolation, prompt/credential attacks, guardrail behavior) run in CI on every change — see [Testing and CI](#testing-and-ci).

## Live demo

A live deployment runs on Azure Container Apps. Demo credentials for the two reference organizations (**NorthStar** / ACME and **Neptune** / GreenMart) are provided with the challenge submission rather than committed to this repository — see [`docs/judge-testing.md`](docs/judge-testing.md) for the exact recommended test script, including the second controlled-write proof.

<img src="docs/screenshots/login.png" alt="CorrelAct sign-in screen with Issue Discovery, Connected Evidence, and Governed Execution highlights" width="760" />

## Run it locally

Start PostgreSQL:

```powershell
docker compose up -d
```

Install the locked dependencies:

```powershell
pip install -r requirements.lock
pip check
```

Create `.env` from `.env.example`:

```text
OPENAI_API_KEY=your_key_here
DATABASE_URL=postgresql+asyncpg://agent_lab:agent_lab@localhost:5544/agent_lab
JWT_SECRET_KEY=use_a_random_secret_at_least_32_characters
TASK_GITHUB_TOKEN=your_fine_grained_github_token
TASK_GITHUB_REPOSITORY=owner/repository
TASK_GITHUB_API_URL=https://api.github.com

ENABLE_DEMO_USERS=false
```

`TASK_GITHUB_TOKEN` should be a fine-grained token with Issues read/write access to the configured repository only. Never commit a real token.

To enable the reference demo identities locally, set your own strong passwords (16+ characters):

```text
ENABLE_DEMO_USERS=true
DEMO_NORTHSTAR_PASSWORD=choose_a_strong_password_16_chars_or_more
DEMO_NEPTUNE_PASSWORD=choose_a_strong_password_16_chars_or_more
DEMO_ADMIN_PASSWORD=choose_a_strong_password_16_chars_or_more
```

This grants `user@northstar.com` → NorthStar/ACME, `user@neptune.com` → Neptune/GreenMart, and `admin@correlact.com` → both organizations. When demo mode is off, startup removes any existing demo accounts instead of creating them.

Start CorrelAct:

```powershell
uvicorn agent_lab.api:app --reload
```

| Surface | URL |
| --- | --- |
| CorrelAct | `http://127.0.0.1:8000/` |
| Investigation workspace | `http://127.0.0.1:8000/investigation/` |
| Support workspace | `http://127.0.0.1:8000/support/` |
| CRM workspace | `http://127.0.0.1:8000/crm/` |
| Billing workspace | `http://127.0.0.1:8000/billing/` |
| Tasks workspace | `http://127.0.0.1:8000/tasks/` |
| Swagger UI | `http://127.0.0.1:8000/docs` |

## API flow

1. **`GET /health`** — no auth required.
2. **`POST /auth/login`** with `{"username": "...", "password": "..."}` — the returned session identifies which organizations the account may access.
3. **`POST /investigate`** with `{"tenant_id": "NorthStar", "issue": "..."}` — `tenant_id` must belong to the authenticated user or the request is rejected before the agent runs.
4. **Human review** — `POST /runs/{run_id}/approve` or `/reject`. Approving does **not** create the GitHub task or mutate the CRM; it only records the decision and moves the run to `APPROVED`.
5. **Execute** — the Tasks workspace's `create_task` or `update_crm_status` WebMCP tool. The backend independently verifies approval state, organization, customer, and idempotency before any external write.
6. **Inspect** — `GET /runs/{run_id}`, or `GET /runs` with optional `status`/`tenant_id` filters, scoped to the authenticated organization.

## Testing and CI

```powershell
pytest                  # unit, integration, security, and UI-contract tests
python evals/evals.py   # live 15-case AI quality-gate suite
npx playwright test tests/browser --reporter=line   # browser/UI behavior
```

CI (`.github/workflows/ci.yml`) runs, in order: a full git-history credential audit, the Docker production build, the pytest suite, an isolated database for the Playwright browser suite, and the live eval suite gated at a 98% pass threshold. Deployment (`.github/workflows/deploy-azure.yml`) only triggers after CI succeeds on `main`.

## Project layout

```text
agent_lab/          Application package: agent, API, workflow, DB, MCP, tools
frontend/           CorrelAct UI and WebMCP browser workspaces
evals/              Live AI quality-gate runner
scripts/            Smoke tests and the public-release security audit
tests/              Pytest unit/integration/security/UI contract tests
docs/               Design notes, screenshots, and the judge testing guide
.github/workflows/  CI and Azure deployment pipelines
docker-compose.yml  Local PostgreSQL
requirements.txt    Exact direct dependency pins
requirements.lock   Fully resolved CI/deployment dependency snapshot
```

## License

CorrelAct is licensed under the MIT License. See [`LICENSE`](LICENSE).
