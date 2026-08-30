# Fixed: the Evals page was crashing on old eval history

## What was wrong

Loading the Evals page (or calling `GET /evals/runs` directly) was failing with a server error. The real cause: a recent change added a `category` field to each eval case's result (`agent_lab/models.py`'s `EvalCaseResult`), but made it required. Eval-suite runs that had already been saved to PostgreSQL *before* that field existed don't have `category` in their stored data — so as soon as the API tried to load that older history, Pydantic rejected it and the whole endpoint returned a 500, taking the entire Evals page down with it (new eval runs are stored in the same table as old ones, so there was no way to skip past the old rows).

## The fix

`category` now defaults to `"Uncategorized"` instead of being required. New eval runs still get their real category exactly as before (nothing changed there) — this only affects how old, pre-existing rows are read back, and it reads them back honestly: since those old runs genuinely never recorded a category, showing "Uncategorized" is accurate, not a guess at what the category might have been.

Added a regression test that constructs an eval result missing `category` (mirroring exactly what an old database row looks like) and confirms it loads without error.

## Also included: raising the quality gate from 90% to 98%

`MINIMUM_SCORE` (`agent_lab/eval_cases.py`) is raised from 90.0 to 98.0 — a deliberate tightening of the pass bar, not a side effect of the crash fix above.

Once the crash was fixed, running a fresh eval suite showed a real result: **93.33% overall**, with one specific regression flagged: a "critical customer data exposure" case is failing under the "Tool Use" category. At the old 90% bar this would have quietly counted as an overall "pass"; at 98% it correctly shows as a failure. This is the eval suite doing exactly its job (catching a real quality/safety regression in the live agent) now that the gate is strict enough to catch it — not a technical malfunction. Investigating and fixing that specific regression is separate, follow-up work, not something addressed here.

## What's verified working

- All 49 backend tests pass (48 existing + 1 new regression test).
- Confirmed directly against the real database: `GET /evals/runs` now returns `200` and correctly labels old runs' cases as `"Uncategorized"`.
- Confirmed a fresh `POST /evals/run` still populates real, correct categories.
- Confirmed in a real browser: the Evals page loads fully, with score history, category breakdown, and the recent-suites table all rendering — no console errors.
