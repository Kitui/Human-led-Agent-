# CorrelAct WebMCP investigation hub

## What was implemented

A single `/investigation/` workspace that exposes all three read-only WebMCP evidence tools together, plus the proposal tool that turns correlated evidence into one reviewable action:

- Support `get_case`
- CRM `get_customer`
- Billing `get_invoice`
- `submit_action_point`

## Where it lives

- Human workspace: `frontend/investigation/index.html`
- Workspace behavior: `frontend/js/investigation.js`
- Styling: `frontend/investigation.css`
- Source-tool registrations: `frontend/js/webmcp/support-tools.js`, `frontend/js/webmcp/crm-tools.js`, `frontend/js/webmcp/billing-tools.js`

## Relevant code

`frontend/js/investigation.js` imports the three existing source integrations and registers them together:

```javascript
const results = await Promise.all([
  registerSupportWebMcpTools(),
  registerCrmWebMcpTools(),
  registerBillingWebMcpTools(),
]);
```

The page itself does not run an AI diagnosis. Its manual "Load evidence" action calls the same three source functions in parallel so a human can inspect exactly what a browser agent would see before trusting its correlation.

## Function

This turns three isolated read tools into one investigation surface. With `/investigation/` open, a WebMCP-capable browser agent discovers all three structured tools plus `submit_action_point`, and decides which to call from a single natural-language request.

Reference prompt (NorthStar / ACME):

> Investigate the ACME renewal issue for the NorthStar organization. Use Support, CRM, and Billing tools to gather evidence and determine the most likely cause. Then use submit_action_point to persist one focused recommended action for human review. Do not execute any external write action.

Expected evidence chain:

1. Support establishes the customer-reported problem.
2. CRM confirms the account and renewal state.
3. Billing identifies the invoice discrepancy and renewal hold.
4. The browser agent correlates the three results into a recommendation and calls `submit_action_point`.

`submit_action_point` persists the proposal (evidence, recommendation, priority, target team, and the bound execution capability) as a run in `AWAITING_APPROVAL`. It performs no external write itself — see [`docs/unified-controlled-execution.md`](unified-controlled-execution.md) for what happens after a human approves it, and [`docs/judge-testing.md`](judge-testing.md) for the full guided test.
