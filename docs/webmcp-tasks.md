# WebMCP Tasks Workspace

Correlact now separates the human decision from the consequential write.

## Flow

```text
Investigation Hub
  get_case
  get_customer
  get_invoice
  submit_action_point
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

`POST /runs/{run_id}/approve` detects WebMCP-submitted Action Points and persists them as `approved` without executing an external write.

`POST /webmcp/tasks` then verifies:

- the signed-in user owns the tenant;
- the run belongs to that tenant;
- the run originated from `submit_action_point`;
- the run status is `approved`;
- the supplied customer matches the CRM evidence attached to the approved run.

Only then does `agent_lab/webmcp_tasks.py` call the existing durable GitHub task adapter with the approved Action Point's target team, priority, and recommended action.

The same idempotency formula used by the existing execution workflow is retained, and `ExecutedActionORM` remains the durable exactly-once boundary.

## Evidence vs execution outcome

The Approvals page now treats `EVIDENCE` trace events from Support, CRM, and Billing as decision evidence. A later `create_task` result is displayed as execution outcome, not as evidence supporting the original approval.

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
