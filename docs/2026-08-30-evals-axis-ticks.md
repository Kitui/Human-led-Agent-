# Evals charts: show every label on the bottom axis

## What changed

"Eval Score Over Time" and "Pass / Fail by Judgment Check" now force every tick label to render along the bottom axis instead of letting Chart.js's default auto-skip behavior hide some when they'd otherwise overlap. The score chart also allows its timestamp labels to rotate (up to 60°) so they stay legible as more eval runs accumulate and the axis gets crowded.

## Why

Chart.js skips labels by default whenever it judges they wouldn't fit without overlapping. That's a reasonable default, but it means the run timeline could silently start hiding data points as history grows. Forcing every label to show (with rotation as a release valve) keeps every run visible along the timeline instead of relying on Chart.js's judgment call.

## What's verified working

- All 49 backend tests pass (frontend-only change).
- Real browser check: confirmed both charts' `autoSkip` is `false`; all 10 current run timestamps render on the score chart, all 3 skill labels render on the Judgment Check chart, no overlap or console errors.
