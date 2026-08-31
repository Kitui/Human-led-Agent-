# Billing WebMCP workspace

## What was implemented

A second WebMCP-enabled business workspace at `/billing/` exposing the read-only `get_invoice` tool.

## Where it lives

- Human workspace: `frontend/billing/index.html`
- Workspace behavior: `frontend/js/billing.js`
- WebMCP registration: `frontend/js/webmcp/billing-tools.js`
- Styling: `frontend/billing.css`

## WebMCP registration

The core registration is:

```javascript
await document.modelContext.registerTool({
  name: "get_invoice",
  // input schema omitted here
  annotations: { readOnlyHint: true },
  execute: async ({ customer_name, tenant_id }) => {
    const result = await fetchInvoice(customer_name, tenant_id);
    return { source: "billing", tool: "get_invoice", ...result };
  },
});
```

This tells a WebMCP-aware browser that the Billing page exposes a structured invoice lookup function. The human UI and the WebMCP tool use the same `fetchInvoice()` function and enforce the signed-in tenant boundary before returning reference billing evidence.

## Reference scenario

For `ACME` in `tenant_red`, the Billing workspace provides challenge reference evidence showing:

- contract amount: USD 120,000
- billed amount: USD 126,000
- variance: USD 6,000
- invoice status: disputed
- dispute status: open
- renewal hold: true

The intended cross-workspace demo is:

1. CRM `get_customer` establishes that ACME is active, its renewal is blocked, and billing is in invoice dispute.
2. Billing `get_invoice` explains the underlying invoice discrepancy and renewal hold.
3. The agent correlates both sources before proposing an Action Point.

The Billing dataset is explicitly a deterministic challenge reference dataset. It is not presented as a production billing integration.
