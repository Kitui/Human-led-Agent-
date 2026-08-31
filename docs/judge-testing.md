# Judge Testing Flow

Correlact is designed to be tested with a WebMCP-capable browser agent. The primary path for challenge judging is ChatGPT's in-app browser. The Model Context Tool Inspector is optional and exists only as a manual developer/debug verification path.

## Recommended live test

### 1. Investigate

Open `/investigation/` in a WebMCP-capable browser agent and use:

```text
Investigate the ACME renewal issue for tenant_red. Use Support, CRM, and Billing tools to gather evidence and determine the most likely cause. Then use submit_action_point to persist one focused recommended action for human review. You may submit the proposal, but do not execute any external write action.
```

Expected WebMCP tools:

- `get_case`
- `get_customer`
- `get_invoice`
- `submit_action_point`

Expected outcome: one Action Point persisted in `awaiting_approval`; no external task has been created.

### 2. Human review

Open Correlact `/`, go to Approvals, inspect the evidence, and approve the Action Point.

Expected outcome: the run stops at `approved`. Approval authorizes execution but does not itself create a GitHub issue.

### 3. Controlled execution

Open `/tasks/` in a WebMCP-capable browser agent and use the full approved run ID:

```text
Execute the already-approved ACME task for run RUN_ID in tenant_red. Use create_task. Do not alter the approved action or create any additional work.
```

Expected WebMCP tool:

- `create_task`

Expected outcome: exactly one GitHub issue is created from the previously approved scope and the run becomes `completed`.

## Manual verification

The Model Context Tool Inspector can be used to inspect registrations, schemas, tool inputs, and tool results, but it is not a dependency of the Correlact experience.
