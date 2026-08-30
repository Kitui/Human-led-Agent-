# Evals charts: equal height for real, by making the charts fill it

## What changed

Reverted the previous "let each card size to its own content" approach — the three chart cards are the same height again, as originally wanted. The difference from before: rather than relying on default grid stretch (which just adds blank space below a fixed-size chart when a card gets stretched taller than its content), each card is now a flex column and its chart area flexes to fill whatever height the row gives it. The stretched height is no longer wasted — the chart itself grows into it.

The "Pass / Fail by Category" chart keeps a minimum height based on how many real categories exist (so bars never get cramped illegibly thin), but is free to grow taller to match its neighbors, which is exactly what happens since it's naturally the tallest of the three.

## What's verified working

- All 52 backend tests pass (frontend-only change).
- Real browser check: all three chart cards measure the same height (402px in testing), each chart canvas fills its own card with no blank space or squeezed content, no console errors.
