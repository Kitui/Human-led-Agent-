# New "Action Points" page (kanban board)

## What problem this solves

Investigations produce "action points" — proposed fixes waiting for a human decision — but until now the only way to see them was a flat table on the Approvals page. This adds a dedicated kanban-style board (from a new mockup) that groups action points by stage, sitting in the sidebar right after Investigate.

## What we built

- **A 5-column board**: Drafted, Awaiting Approval, Approved, Executing, Completed. Cards show the real title, priority, confidence, tenant, run ID, and created time for each action point.
- **4 real stat cards** up top (Total Action Points, Awaiting Approval, In Progress, Completed Today), computed the same way the Dashboard's stat cards already are — nothing here is invented.
- **A detail panel** that opens when you click a card: summary, recommended action, target team, confidence, whether it requires human approval, and the evidence list pulled from the run's real tool-call results — same as the Approvals page's detail view. An "Approve" button is real and calls the same approval endpoint used everywhere else in the app.
- **Filters**: search, tenant, status, priority, and a date range, plus a refresh button.

## Being honest about what isn't real yet

The mockup this was built from has a few things this backend genuinely can't do:

- **"Drafted" isn't a real stage.** This system's investigations go straight to Awaiting Approval or Completed — there's no separate drafting step. The column stays in place (matching the mockup's layout) but is always empty, with a note explaining why, rather than showing invented cards.
- **"+ New Action Point" and each column's "+ Add Action Point"** are disabled. Action points are only ever produced by running an investigation — there's no way to create one by hand, and pretending otherwise would be misleading.
- **"Move to Next Stage" is disabled.** Approving a run already carries it through to completion in one step — there's no separate manual "advance to the next stage" action to wire up.

All three are visible, in the same place the mockup puts them, just clearly inert with a tooltip explaining why — the same treatment already used for Settings' not-yet-built sections.

## A couple of small real bugs found and fixed along the way

1. **The date-range "clear" button was visible when it shouldn't be**, on this new page and (it turns out) on the existing Runs page too — a pre-existing bug this work happened to surface. A CSS rule was overriding the browser's default "hidden means hidden" behavior. Fixed app-wide.
2. **The kanban board could overflow underneath the detail panel** instead of shrinking to fit next to it, cutting off the last column's text. Fixed with a one-line CSS grid sizing correction.

## What's verified working

- All 32 backend tests still pass unchanged (frontend-only change).
- Tested end to end against the real backend: ran two real investigations, watched them appear as real cards in Awaiting Approval with correct stat counts, opened the detail panel and confirmed every field and the evidence list matched the real run data, approved one from this new page and watched it move to Completed with the counts updating live, and confirmed every disabled control is genuinely inert with an explanatory tooltip.

## What's next

Approval Policy, Integrations, Observability, and Security (from the Settings work) are still the main "make it real" gaps. This page's Drafted/Approved/Executing columns will only ever show real data if this system's workflow changes to introduce those as genuine, longer-lived stages.
