# Evals page: fixed chart whitespace, paginated Recent Eval Suites

## Chart whitespace — two separate causes, both fixed

1. **Card stretching.** The three chart cards sit in one CSS grid row, which by default stretches every card in a row to match the tallest one. "Pass / Fail by Judgment Check" and "Pass / Fail by Category" both end with a "Total" row of text; "Eval Score Over Time" doesn't, so it was being stretched to match its neighbors' height with nothing to fill the extra space — showing as blank white area below the chart. Scoped a CSS rule to just this row (`align-items: start`) so each chart card now sizes to its own real content instead of being force-stretched. This doesn't touch the shared grid class other pages (like Settings) use, so nothing else changed.
2. **Wasted vertical range.** Eval scores cluster near the top (mostly 93–100%), but the y-axis always spanned the full 0–100%, so the actual line only ever occupied a thin strip at the top of the chart with a large empty gap below it. The y-axis now fits itself to the real data range (rounded down to the nearest 5, with a little padding, never below 0%) with a finer step size for a narrower range — so the line's real variation fills the chart instead of being squeezed into a sliver at the top.

The "Pass / Fail by Judgment Check" chart wasn't touched on the whitespace-via-scale front — it's a 100%-stacked bar chart, so its bars always span the full 0–100% by definition; there was nothing to fit there.

## Recent Eval Suites: paginated, 7 rows per page

Reused the exact pagination component already used on the Runs page (`.page-btn`/`.pagination-controls`, prev/next plus numbered pages with a `…` gap for long lists) — fixed at 7 rows per page rather than a configurable page size, since that's what was asked for. "Failed Cases / Regressions" sits in the same grid row and already matches its height automatically via the grid's default stretch behavior (unaffected by the change above, which is scoped to a different row).

## What's verified working

- All 52 backend tests pass (frontend-only change).
- Real browser check: chart cards now size independently instead of matching a stretched height; the score chart's y-axis is confirmed data-fitted (e.g. starting at 85% instead of 0%) with visible mid-range variation; the suites table shows exactly 7 rows with working pagination across multiple pages; the Failed Cases card's height still matches the suites card's height.
