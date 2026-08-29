# Fixed a fabricated number on the Evals page, and switched its bar chart to Chart.js

## What was wrong

The "Number of Test Cases" card on the Evals page always said "3 categories" — but that was a literal hardcoded string in the code, not a real count. It never changed no matter how many actual categories existed. This app's eval cases (`agent_lab/eval_cases.py`) actually define 5 distinct topic categories (Customer Evidence, Human Approval, Operational Judgment, Security Guardrails, Tenant Controls) — the "3" was left over from an earlier, much smaller version of the eval suite and never updated, and appears to have been confused with an unrelated chart on the same page that does have exactly 3 rows.

The "Pass / Fail by Category" chart just below it was also hand-built out of styled `<div>`s instead of using the charting library (Chart.js) already used everywhere else on this page and the Dashboard.

## The fix

- "Number of Test Cases" now shows the real number of distinct categories present in the latest eval run, computed from the actual case data — not a hardcoded guess.
- "Pass / Fail by Category" is now a real Chart.js horizontal bar chart (matching the "Eval Score Over Time" chart on the same page and the Dashboard's charts), with a proper legend and hover tooltips showing exact counts, instead of custom-styled divs.
- Cleaned up the now-unused CSS for the old hand-rolled bars.
- Updated a stale comment at the top of `evals.js` that still said "3 real cases" (the suite has 15 now) and clarified that "category" means two different things on this page: each case's real topic label, and the three fixed judgment dimensions the breakdown chart checks (priority, approval decision, tool use) — worth spelling out since mixing these two up is exactly what caused the original bug.

## What's verified working

- All 49 backend tests pass (frontend-only change).
- Real browser check: the category count now correctly reads "5 categories," the breakdown renders as a real Chart.js bar chart, and no console errors appear.
