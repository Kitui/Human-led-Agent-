# WebMCP Implementation Notes

## Step 10.1 — CRM `get_customer`

### What we implemented

A read-only CRM workspace that exposes `get_customer` as a WebMCP tool.

### Where it is implemented

- `frontend/crm/index.html` — human-facing CRM workspace.
- `frontend/js/webmcp/crm-tools.js` — WebMCP registration and execution code.
- `frontend/js/crm.js` — normal human search UI.
- `agent_lab/api.py` — authenticated CRM read endpoint.
- `tests/test_api.py` — auth and tenant-isolation coverage.

### The line that makes it WebMCP

The key implementation is:

```javascript
await document.modelContext.registerTool({
  name: "get_customer",
  // schema + execute callback
});
```

That tells a WebMCP-aware browser that this website has a structured tool named `get_customer`.

### What the tool does

The agent supplies `customer_name` and `tenant_id`. The page calls the same secured FastAPI endpoint used by the human CRM search, and the backend reads the existing PostgreSQL customer data through `lookup_customer`.

WebMCP does not bypass authentication or tenancy. The user must already be signed in and the backend remains the final authorization boundary.

### Why this matters

Without WebMCP, an agent would need to inspect the CRM page, locate the search input, type the customer, submit the form, and read the result from the rendered UI. With WebMCP, the agent can call `get_customer` directly.

This first tool is intentionally read-only. Consequential write tools will be added later behind the human-approval boundary.
