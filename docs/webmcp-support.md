# Support WebMCP workspace

## What was implemented

A third WebMCP-enabled business workspace at `/support/` exposing the read-only `get_case` tool.

## Where it lives

- Human workspace: `frontend/support/index.html`
- Workspace behavior: `frontend/js/support.js`
- WebMCP registration: `frontend/js/webmcp/support-tools.js`
- Styling: `frontend/support.css`

## WebMCP registration

The core registration is:

```javascript
await document.modelContext.registerTool({
  name: "get_case",
  annotations: { readOnlyHint: true },
  execute: async ({ customer_name, tenant_id }) => {
    const result = await fetchCase(customer_name, tenant_id);
    return { source: "support", tool: "get_case", ...result };
  },
});
```

This tells a WebMCP-aware browser that the Support page exposes a structured customer-case lookup function. The human UI and WebMCP tool use the same `fetchCase()` function and enforce the signed-in tenant boundary before returning challenge reference evidence.

## Reference scenario

For `ACME` in `tenant_red`, Support provides the customer-reported symptom:

- case: `CASE-ACME-8841`
- priority: high
- status: open
- category: billing and renewal
- escalation: escalated
- customer message: invoice amount is wrong and renewal is blocked

The intended investigation chain is now:

1. Support `get_case` establishes what ACME reported.
2. CRM `get_customer` confirms the account is active, billing is in invoice dispute, and renewal is blocked.
3. Billing `get_invoice` identifies the USD 6,000 invoice variance, open dispute, and renewal hold.
4. Correlact correlates the three evidence sources before proposing an Action Point.

The Support dataset is a deterministic challenge reference dataset, not a production support-system integration.
