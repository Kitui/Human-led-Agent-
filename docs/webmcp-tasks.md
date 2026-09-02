# WebMCP Tasks workspace

CorrelAct separates the human decision from the consequential write for every Proposed Action that requires approval. The Tasks workspace (`/tasks/`) is where that write finally happens — and only there.

## Unified flow

```text
Investigation (backend investigator OR /investigation/ WebMCP hub)
        ↓
Proposed Action (action_point)
        ↓
AWAITING_APPROVAL
        ↓
Human approves in CorrelAct
        ↓
APPROVED — authorized, not yet executed
        ↓
Tasks workspace /tasks/
  create_task  OR  update_crm_status
        ↓
GitHub Issue  OR  CRM renewal_status mutation, exactly once
        ↓
COMPLETED
```

The investigation mechanisms differ — the main CorrelAct Investigate page uses the backend OpenAI investigator with the `get_customer` MCP tool, while `/investigation/` is the browser-agent WebMCP surface exposing `get_case`, `get_customer`, `get_invoice`, and `submit_action_point`. Both converge on the same approval and execution boundary described below and in [`docs/unified-controlled-execution.md`](unified-controlled-execution.md).

## Two WebMCP tools, one workspace

`frontend/js/webmcp/task-tools.js` registers whichever tools currently have matching approved work for the signed-in organization — never both unconditionally:

```javascript
await document.modelContext.registerTool({
  name: "create_task",
  annotations: { readOnlyHint: false },
  // ...
});

await document.modelContext.registerTool({
  name: "update_crm_status",
  annotations: { readOnlyHint: false },
  // ...
});
```

Both tools accept only:

- `run_id`
- `tenant_id`
- `customer_name`

Neither accepts a new description, priority, target team, or status transition. Those values were frozen inside the Proposed Action at the moment a human approved it.

## Server enforcement

`POST /runs/{run_id}/approve` moves a run to `APPROVED` without executing anything external — see `agent_lab/webmcp_tasks.py`'s `approve_webmcp_action_point`.

Execution is split into two independently-enforced routes so a browser bug or a compromised client can't dispatch the wrong write by calling the wrong endpoint:

| Route | Tool | Rejects requests where |
| --- | --- | --- |
| `POST /webmcp/tasks` | `create_task` | the approved run's execution type isn't `create_task` |
| `POST /webmcp/crm-status` | `update_crm_status` | the approved run's execution type isn't `update_crm_status` |

Both routes call the same shared function, `execute_webmcp_approved_action()`, which independently verifies:

- the run is `APPROVED` (or already `COMPLETED`, in which case the prior result is returned — the write cannot repeat);
- the caller's organization matches the run's;
- the supplied `customer_name` matches the CRM evidence bound to the approved run (`approved_customer_reference()`);
- for `update_crm_status`, the customer's *current* `renewal_status` still matches the approved transition's expected status — a stale approval cannot silently overwrite newer CRM state (`agent_lab/crm_actions.py`).

Customer evidence comes from an explicit `WebMCP crm evidence attached` trace for WebMCP-submitted runs, or the persisted `get_customer result received` MCP trace for main CorrelAct investigations.

Only after every check passes does the adapter run: `_get_or_create_task()` for `create_task` (the durable GitHub adapter), or `get_or_create_crm_status_update()` for `update_crm_status` (a PostgreSQL advisory lock plus a durable `ExecutedActionORM` row). Both are keyed by the same deterministic idempotency formula, so a repeated invocation of either tool returns the original result instead of repeating the write.

## Evidence vs. execution outcome

The Approvals page keeps investigation evidence separate from the later execution result. The GitHub issue or CRM mutation is an *outcome* of the approved decision, not evidence used to justify it.

## Demo scripts

See [`docs/judge-testing.md`](judge-testing.md) for the full guided protocol (Path A for `create_task`, Path B for `update_crm_status`) using ChatGPT's in-app browser or another WebMCP-capable browser agent — the primary judging path. The Model Context Tool Inspector is an optional manual/debug tool, not required to exercise CorrelAct.
