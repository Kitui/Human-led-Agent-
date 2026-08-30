# Made "critical issues require approval" a code guarantee, not a prompt suggestion

## What was wrong

After the earlier tool-call fix, CI's live eval suite kept failing on the same case ("critical customer data exposure") — but on a *different* dimension each time. First the agent occasionally called a tool it shouldn't; after fixing that, it started occasionally deciding the case didn't need human approval, even though a critical-severity data exposure clearly should. Chasing each dimension one prompt tweak at a time was whack-a-mole: the underlying issue is that `MINIMUM_SCORE = 98.0` with 15 cases tolerates **zero** misses (14/15 is already only 93.3%), so any single instance of normal LLM output variance on any case, on any dimension, fails the whole suite. The suite's own comment claiming it "can tolerate at most one isolated miss" was also just wrong at this threshold — fixed to say so honestly.

## The fix

Rather than relying entirely on the prompt to get this right every single time, `agent_lab/workflow.py` now enforces it deterministically: right after the agent produces an Action Point, a small function (`_enforce_critical_requires_approval`) forces `requires_human_approval = True` whenever `priority == "critical"`, overriding whatever the model itself decided. This removes an important safety invariant from the category of things that depend on the model reliably following instructions, and makes it a guarantee instead.

## What's verified working

- All 52 backend tests pass (49 existing + 3 new, directly unit-testing the new function against critical/non-critical and already-correct/incorrect inputs — no live agent call needed).
- The full live eval suite (`evals/evals.py`) passed 15/15 (100%) across 3 separate runs.
