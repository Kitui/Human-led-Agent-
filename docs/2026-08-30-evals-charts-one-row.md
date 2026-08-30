# Evals page: all three charts in one row, Judgment Check as a column chart

## What changed

- "Eval Score Over Time," "Pass / Fail by Judgment Check," and "Pass / Fail by Category" now sit side by side in a single row instead of a 2-column row plus a separate full-width row below.
- "Pass / Fail by Judgment Check" is now a vertical stacked column chart (three columns: Priority Classification, Approval Behavior, Tool Use) instead of horizontal bars, at the requester's preference.
- "Pass / Fail by Category" stays horizontal, since it can have several rows (one per real category) and reads better that way.

## How it was built

Reused the existing `.settings-row.settings-row-3col` grid utility (already used by the Settings page) for the three-column layout instead of adding new CSS. The shared `renderPassFailBarChart()` helper now takes a `horizontal` option controlling `indexAxis` and which axis carries the 0–100% scale versus the category labels — one function backs both chart orientations.

## What's verified working

- All 49 backend tests pass (frontend-only change).
- Real browser check: all three charts render in one row, the Judgment Check chart is confirmed rendering with `indexAxis: "x"` (vertical columns), and no console errors.
