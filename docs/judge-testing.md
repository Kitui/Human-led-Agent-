# Judge Testing Flow

CorrelAct is designed to be tested with a WebMCP-capable browser agent. The primary path for challenge judging is ChatGPT's in-app browser. The Model Context Tool Inspector is optional and exists only as a manual developer/debug verification path.

## Before testing

The public project/demo page is `/`. Sign in to the secured CorrelAct product at `/app` using the challenge demo credentials supplied with the submission. Authentication is shared across the CorrelAct workspaces through the same browser session, so remain signed in while moving between Investigation, Approvals, Tasks, CRM, Support, and Billing.

The primary demo path uses:

- Organization: **NorthStar**
- User: `user@northstar.com`
- Customer: **ACME**

The second isolated organization is **Neptune**, with `user@neptune.com` and the GreenMart reference customer. `admin@correlact.com` can access both organizations. Passwords are supplied separately with the challenge test credentials and are not stored in this repository.

## Recommended live test

### 1. Investigate

Open `/investigation/` in the same WebMCP-capable browser session and use:

```text
Investigate the ACME renewal issue for the NorthStar organization. Use Support, CRM, and Billing tools to gather evidence and determine the most likely cause. Then use submit_action_point to persist one focused recommended action for human review. Bind create_task as the execution capability. You may submit the proposal, but do not execute any external write action.
```

Expected WebMCP tools:

- `get_case`
- `get_customer`
- `get_invoice`
- `submit_action_point`

Expected outcome: one Proposed Action persisted in `awaiting_approval`; no external task has been created.

### 2. Human review

Open CorrelAct `/app`, go to Approvals, inspect the evidence and the exact approved execution capability, then approve the Proposed Action.

Expected outcome: the run stops at `approved`. Approval authorizes exactly the reviewed capability but does not itself perform a write.

### 3. Controlled task execution

Open `/tasks/` in the same WebMCP-capable browser session and use the full approved run ID:

```text
Execute the already-approved ACME task for run RUN_ID in the NorthStar organization. Use create_task. Do not alter the approved action or create any additional work.
```

Expected WebMCP tool:

- `create_task`

Expected outcome: exactly one GitHub issue is created from the previously approved scope and the run becomes `completed`. Repeating the same execution returns the completed result rather than creating another issue.

## Second controlled-write proof

CorrelAct also supports a distinct write capability, `update_crm_status`, through the **same** approve-then-execute state machine. This demonstrates that the governance boundary is reusable rather than hardcoded to GitHub task creation.

For a fresh ACME run whose CRM evidence shows `renewal_status = blocked`, ask the browser agent during Investigation to submit a proposal with this exact execution scope:

```text
execution.type = update_crm_status
execution.crm_expected_status = blocked
execution.crm_target_status = escalation_open
```

Before approval, the Approvals workspace shows the reviewer:

```text
Execution Capability: update_crm_status
Approved Execution Scope: renewal_status: blocked → escalation_open
```

Approval still performs **no CRM mutation**. After approval, open `/tasks/` and ask:

```text
Execute the already-approved CRM status update for run RUN_ID in the NorthStar organization using update_crm_status. Do not change the approved customer or status transition.
```

Expected outcome:

- only the approved CRM transition is eligible for that run;
- ACME changes from `renewal_status = blocked` to `renewal_status = escalation_open`;
- the run becomes `completed`;
- a repeated invocation does not apply a second mutation;
- cross-organization, mismatched-customer, stale-state, or unapproved execution is rejected.

The key architecture demonstrated by the two write paths is:

```text
                     HUMAN APPROVAL
                           ↓
              Shared controlled-execution gate
              organization · evidence · state
                    idempotency · audit
                     ↙                 ↘
             create_task       update_crm_status
                 ↓                     ↓
           GitHub Issue          Demo CRM record
```

**Same governed boundary. Different consequential action. The agent receives only the capability the human approved.**

## Manual verification

The Model Context Tool Inspector can be used to inspect registrations, schemas, tool inputs, and tool results, but it is not a dependency of the CorrelAct experience.
