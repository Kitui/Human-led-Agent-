# Correlact WebMCP investigation hub

## What was implemented

A clean `/investigation/` workspace that exposes all three read-only WebMCP evidence tools on one active page:

- Support `get_case`
- CRM `get_customer`
- Billing `get_invoice`

## Where it lives

- Human workspace: `frontend/investigation/index.html`
- Workspace behavior: `frontend/js/investigation.js`
- Styling: `frontend/investigation.css`
- Existing source-tool registrations:
  - `frontend/js/webmcp/support-tools.js`
  - `frontend/js/webmcp/crm-tools.js`
  - `frontend/js/webmcp/billing-tools.js`

## Relevant code

`frontend/js/investigation.js` imports the three existing source integrations and registers them together:

```javascript
const results = await Promise.all([
  registerSupportWebMcpTools(),
  registerCrmWebMcpTools(),
  registerBillingWebMcpTools(),
]);
```

The page itself does not create an AI diagnosis. Its manual `Load evidence` action only calls the same three source functions in parallel so a human can verify the evidence the browser agent receives.

## Function

This turns the isolated WebMCP source demonstrations into one investigation surface. With `/investigation/` active, a WebMCP-aware browser agent can discover all three structured tools and decide which to call from one natural-language request.

Reference challenge prompt:

> Investigate the ACME renewal issue in tenant_red. Use all relevant tools, correlate the evidence, explain the root cause, and recommend the next action. Do not execute a write.

Expected evidence chain:

1. Support establishes the customer-reported problem.
2. CRM confirms the account and renewal state.
3. Billing identifies the invoice discrepancy and renewal hold.
4. The browser agent correlates those source results into a diagnosis and recommendation.

The next implementation step is to persist the agent's proposed Action Point into the existing human approval workflow without allowing the browser agent to execute the consequential write directly.
