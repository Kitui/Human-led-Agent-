# Settings page rebuilt to match the mockup exactly

## What problem this solves

We checked the live Settings page against the original mockup screenshot and found a real mismatch: the mockup is one continuous scrollable page showing every section at once, but what we'd built used tabs that hide everything except the one you clicked. Four of those tabs were also just a single line of "Coming soon" text, instead of the mockup's real-looking (but not-yet-functional) fields. This phase rebuilds the page to match the mockup's actual structure.

## What we built

- **One continuous page**, laid out in the same three rows as the mockup: General Settings + a new Environment Status card, then Model & Prompt / Approval Policy / Integrations, then Observability / Security / Tenant Management. Nothing is hidden — you see all of it by scrolling, exactly like the mockup.
- **The tab bar still works**, but now it's a jump-to-section shortcut: clicking a tab smoothly scrolls the page to that card and highlights the tab, instead of switching between hidden panels.
- **A new Environment Status card**. Only the "API" row is a real, live signal (the same health check the topbar uses) — MCP Server, Guardrails, and Evals are honestly labeled "Not monitored" rather than a fabricated "Healthy", since no such monitoring exists yet. "Environment" shows the real value for whichever tenant is selected; "Region" and "Last Updated" say "Not tracked" rather than inventing a value, since the backend doesn't record either one.
- **Approval Policy, Integrations, Observability, and Security now show the mockup's actual fields** (the toggles, inputs, and labels) instead of one line of placeholder text — each with a small "Coming soon" badge in the header. Every control in these four cards is disabled and left empty rather than pre-filled with the mockup's example numbers, because showing fake values (like a made-up "30 day" retention setting) would be exactly the kind of fabricated data this app has avoided everywhere else.
- **Removed the old "Logged in as / API base URL / Valid tenants" debug card** — it wasn't part of the mockup, and the goal this phase was matching it exactly.

## What's verified working

- All 32 backend tests still pass unchanged (this was a frontend-only change).
- Tested by hand, end to end, in a real browser: the full page renders in the mockup's order with no tab clicks needed; each tab button scrolls to and highlights the right section; General Settings and Model & Prompt still save independently and correctly, unaffected by the restructure; Environment Status shows real API health and updates its Environment value immediately when you switch tenants in the topbar; every "Coming soon" card's controls are genuinely disabled and empty; no console errors on page load or reload.

## What's next

Approval Policy, Integrations, Observability, and Security are now laid out correctly but still need real backend work before they can do anything — that's the remaining "make it real" work from the original mockup.
