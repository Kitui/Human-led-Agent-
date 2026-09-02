# WebMCP Implementation Notes

CorrelAct exposes six WebMCP tools across five browser workspaces. This page is the index; each tool has its own implementation note with the exact registration code, reference data, and the demo scenario it supports.

| Tool | Kind | Workspace | Note |
| --- | --- | --- | --- |
| `get_case` | Read | Support | [`docs/webmcp-support.md`](webmcp-support.md) |
| `get_customer` | Read | CRM | this page |
| `get_invoice` | Read | Billing | [`docs/webmcp-billing.md`](webmcp-billing.md) |
| `submit_action_point` | Propose | Investigation | [`docs/webmcp-investigation.md`](webmcp-investigation.md) |
| `create_task` | Constrained write | Tasks | [`docs/webmcp-tasks.md`](webmcp-tasks.md) |
| `update_crm_status` | Constrained write | Tasks | [`docs/webmcp-tasks.md`](webmcp-tasks.md) |

For how the two write tools share one human-approval gate, see [`docs/unified-controlled-execution.md`](unified-controlled-execution.md). For the full judge test protocol, see [`docs/judge-testing.md`](judge-testing.md).

## `get_customer` — the first tool

CRM was the first WebMCP-enabled workspace built for this challenge, and its registration is the simplest illustration of the pattern every other tool follows.

### Where it is implemented

- `frontend/crm/index.html` — human-facing CRM workspace.
- `frontend/js/webmcp/crm-tools.js` — WebMCP registration and execution code.
- `frontend/js/crm.js` — the ordinary human search UI.
- `agent_lab/api.py` — the authenticated CRM read endpoint.
- `tests/test_api.py` — auth and organization-isolation coverage.

### The line that makes it WebMCP

```javascript
await document.modelContext.registerTool({
  name: "get_customer",
  // schema + execute callback
});
```

That tells a WebMCP-capable browser that this page exposes a structured tool named `get_customer`.

### What the tool does

The agent supplies `customer_name` and `tenant_id`. The page calls the same secured FastAPI endpoint the human CRM search uses, and the backend reads real PostgreSQL customer data. WebMCP does not bypass authentication or organization scope — the user must already be signed in, and the backend remains the final authorization boundary regardless of what the browser claims.

### Why this matters

Without WebMCP, an agent would need to open the CRM page, locate the search input, type the customer name, submit the form, and parse the result out of rendered HTML. With WebMCP, the agent calls `get_customer` directly and gets structured data back.

This tool is intentionally read-only. The two consequential write tools (`create_task`, `update_crm_status`) live behind the human-approval boundary described in [`docs/unified-controlled-execution.md`](unified-controlled-execution.md).
