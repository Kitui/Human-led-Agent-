# Unified Controlled Execution

Correlact now uses one human-control model for Action Points created from either user-facing investigation path.

## Main Correlact Investigate

```text
User enters issue in Correlact
        ↓
POST /investigate
        ↓
Backend investigator + MCP get_customer
        ↓
Action Point
        ↓
awaiting_approval
        ↓
Human approves
        ↓
approved
        ↓
STOP — no external write yet
        ↓
/tasks/
        ↓
WebMCP create_task
        ↓
GitHub Issue
        ↓
completed
```

## WebMCP Investigation Hub

```text
get_case + get_customer + get_invoice
        ↓
Browser-agent correlation
        ↓
submit_action_point
        ↓
awaiting_approval
        ↓
Human approves
        ↓
approved
        ↓
/tasks/
        ↓
WebMCP create_task
        ↓
GitHub Issue
        ↓
completed
```

The investigation mechanisms are still different: the main Correlact page uses the existing backend OpenAI investigator and MCP customer tool, while `/investigation/` is the browser-agent/WebMCP challenge surface. Their approval and consequential execution semantics are now the same.

## What changed

`agent_lab/webmcp_tasks.py` is now the controlled approval/execution boundary for all Action Points that require human approval. The existing `api.py` compatibility predicate routes both kinds of Action Point into the approval-only function.

A human approval now means **authorized**, not **already executed**. The run remains `approved` until `/tasks/` invokes `create_task`.

The Tasks workspace lists all approved Correlact Action Points, not only WebMCP-submitted ones.

## Customer scope binding

The execution request still accepts only:

- `run_id`
- `tenant_id`
- `customer_name`

The server binds `customer_name` to investigation evidence:

- WebMCP runs: explicit `WebMCP crm evidence attached` trace.
- Main Correlact runs: persisted `get_customer result received` MCP trace.

The browser cannot replace the approved description, priority, target team, or customer with a different scope.

## Safety properties retained

- human approval required before the write;
- tenant boundary enforced;
- customer evidence mismatch rejected;
- approved action scope loaded server-side;
- durable idempotency prevents duplicate GitHub issues;
- evidence remains separate from execution outcome.
