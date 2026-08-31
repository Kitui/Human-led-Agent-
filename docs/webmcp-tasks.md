# WebMCP Tasks Workspace

Correlact separates the human decision from the consequential write for every Action Point that requires approval.

## Unified flow

```text
Main Correlact Investigate OR WebMCP Investigation Hub
        ↓
Action Point
        ↓
awaiting_approval
        ↓
Human approves in Correlact
        ↓
approved
        ↓
Tasks Workspace /tasks/
  create_task
        ↓
GitHub Issue created exactly once
        ↓
completed
```

The investigation mechanisms remain different. The main Correlact page uses the backend investigator with MCP `get_customer`; the WebMCP Investigation Hub exposes `get_case`, `get_customer`, `get_invoice`, and `submit_action_point` to a browser agent. Both now converge on the same approval and execution boundary.

## WebMCP tool

`frontend/js/webmcp/task-tools.js` registers:

```javascript
await document.modelContext.registerTool({
  name: "create_task",
  annotations: { readOnlyHint: false },
  // ...
});
```

The tool accepts only:

- `run_id`
- `tenant_id`
- `customer_name`

It does **not** accept a new description, priority, or target team. Those values come from the Action Point the human already approved.

## Server enforcement

`POST /runs/{run_id}/approve` persists every human-review Action Point as `approved` without executing an external write.

`POST /webmcp/tasks` then verifies:

- the signed-in user owns the tenant;
- the run belongs to that tenant;
- the run status is `approved` (or returns the existing result if already `completed`);
- the supplied customer matches CRM evidence bound to the approved run.

Customer evidence comes from:

- explicit `WebMCP crm evidence attached` traces for WebMCP-submitted runs; or
- the persisted `get_customer result received` MCP trace for main Correlact investigations.

Only then does `agent_lab/webmcp_tasks.py` call the existing durable GitHub task adapter with the approved Action Point's target team, priority, and recommended action.

The same idempotency formula is retained, and `ExecutedActionORM` remains the durable exactly-once boundary.

## Evidence vs execution outcome

The Approvals page keeps investigation evidence separate from the later `create_task` execution result. The external GitHub task is an outcome of the approved decision, not evidence used to justify the decision.

## Challenge demo

1. On `/investigation/`, ask the browser agent to investigate ACME and submit one Action Point.
2. In Correlact Approvals, approve that Action Point.
3. Open `/tasks/` in the WebMCP Inspector.
4. Ask:

```text
Execute the already-approved task for run RUN_ID in tenant_red for ACME.
Use create_task. Do not alter the approved action or create any additional work.
```

Expected result: the browser agent calls `create_task`, Correlact verifies the prior human approval, one GitHub Issue is created, and the run becomes `completed`.

## Product flow test

The same execution behavior now applies when a user begins from Correlact's main Investigate page:

1. enter the issue in Correlact and run the investigation;
2. approve the generated Action Point;
3. verify the run stops at `approved` and no GitHub issue exists yet;
4. open `/tasks/` and execute the approved task;
5. verify one GitHub issue is created and the run becomes `completed`.
