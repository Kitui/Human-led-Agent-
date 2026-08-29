# Added: a Pass/Fail chart for the real eval categories

## What this adds

A new "Pass / Fail by Category" chart on the Evals page, showing how each of the real eval-case topic categories (Customer Evidence, Human Approval, Operational Judgment, Security Guardrails, Tenant Controls — plus "Uncategorized" for the handful of runs from before categories existed) has performed across all recorded eval history. Each case counts once, using its own overall pass/fail result — a more direct "which topics is the agent weak on" view than the existing "Pass / Fail by Judgment Check" chart, which instead checks three fixed skills every case is scored on regardless of topic.

## Why both charts exist

They answer genuinely different questions:
- **Pass / Fail by Judgment Check** (existing): of all the checks ever run, how often did the agent get the priority right, the approval decision right, and tool use right — three fixed rows, always.
- **Pass / Fail by Category** (new): of all the cases ever run, grouped by what real-world topic they're testing, how many passed outright — as many rows as there are real categories, growing if `eval_cases.py` ever adds a new one.

## What's verified working

- All 49 backend tests pass (frontend-only change).
- Real browser check: the new chart renders as a Chart.js horizontal bar chart with all 6 real category labels (5 defined categories + "Uncategorized" for pre-existing history), correct pass/fail percentages and hover tooltips, and a total row — no console errors.
