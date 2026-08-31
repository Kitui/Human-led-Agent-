# Judge Testing Flow

CorrelAct is designed to be tested with a WebMCP-capable browser agent. The primary path for challenge judging is ChatGPT's in-app browser. The Model Context Tool Inspector is optional and exists only as a manual developer/debug verification path.

## Before testing

Sign in to CorrelAct at `/` using the challenge demo credentials supplied with the submission. Authentication is shared across the CorrelAct workspaces through the same browser session, so remain signed in while moving between Investigation, Approvals, and Tasks.

The primary demo path uses:

- Organization: **NorthStar**
- User: `user@northstar.com`
- Customer: **ACME**

The second isolated organization is **Neptune**, with `user@neptune.com` and the GreenMart reference customer. `admin@correlact.com` can access both organizations. Passwords are supplied separately with the challenge test credentials and are not stored in this repository.

## Recommended live test

### 1. Investigate

Open `/investigation/` in the same WebMCP-capable browser session and use:

```text
Investigate the ACME renewal issue for the NorthStar organization. Use Support, CRM, and Billing tools to gather evidence and determine the most likely cause. Then use submit_action_point to persist one focused recommended action for human review. You may submit the proposal, but do not execute any external write action.
```

Expected WebMCP tools:

- `get_case`
- `get_customer`
- `get_invoice`
- `submit_action_point`

Expected outcome: one Proposed Action persisted in `awaiting_approval`; no external task has been created.

### 2. Human review

Open CorrelAct `/`, go to Approvals, inspect the evidence, and approve the Proposed Action.

Expected outcome: the run stops at `approved`. Approval authorizes execution but does not itself create a GitHub issue.

### 3. Controlled execution

Open `/tasks/` in the same WebMCP-capable browser session and use the full approved run ID:

```text
Execute the already-approved ACME task for run RUN_ID in the NorthStar organization. Use create_task. Do not alter the approved action or create any additional work.
```

Expected WebMCP tool:

- `create_task`

Expected outcome: exactly one GitHub issue is created from the previously approved scope and the run becomes `completed`.

## Manual verification

The Model Context Tool Inspector can be used to inspect registrations, schemas, tool inputs, and tool results, but it is not a dependency of the CorrelAct experience.
