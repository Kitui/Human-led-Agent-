"""Shared eval case definitions used by both the CI script (evals/evals.py)
and the live-run API endpoint (POST /evals/run), so there is exactly one
source of truth for what this agent is actually evaluated against."""

EVAL_CASES = [
    {
        "name": "high value blocked renewal",
        "tenant_id": "tenant_red",
        "input": (
            "ACME says their invoice amount is wrong "
            "and their renewal is blocked."
        ),
        "expected_priority": "high",
        "expected_approval": True,
        # Names a customer (ACME) — agent.py's SYSTEM_PROMPT mandates a
        # get_customer lookup before producing an Action Point in this case,
        # so this is the one case that can honestly test tool-use behavior.
        "expects_tool_call": True,
    },
    {
        "name": "minor office issue",
        "tenant_id": "tenant_red",
        "input": "The office printer has run out of paper.",
        "expected_priority": "low",
        "expected_approval": False,
        "expects_tool_call": False,
    },
    {
        "name": "critical security issue",
        "tenant_id": "tenant_red",
        "input": (
            "Production customer data appears "
            "to be publicly accessible."
        ),
        "expected_priority": "critical",
        "expected_approval": True,
        "expects_tool_call": False,
    },
]

MINIMUM_SCORE = 90.0
