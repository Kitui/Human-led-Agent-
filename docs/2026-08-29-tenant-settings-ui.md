# Settings screen for General Settings + Model & Prompt

## What problem this solves

The last phase made General Settings and Model & Prompt real on the backend — you could already change them by calling the API directly, but there was nothing to click in the actual dashboard. This phase adds that: real forms in the Settings page, replacing the Model & Prompt tab's "Coming soon" placeholder and adding a new card under General.

## What we built

- **A "General Settings" card** (Environment Name, Log Level, Default Language, Default Time Zone, Max Concurrent Runs, Max Steps per Run, Retry Limit) with its own Save button.
- **A real "Model & Prompt" card** (Default Model, a read-only version badge, a System Prompt Override box, and a working on/off toggle for "Auto-update to latest prompt version") with its own independent Save button.
- **Both cards follow whichever tenant is picked in the top-left dropdown** — the same one used for investigating issues — so switching tenants there now also switches which tenant's settings you're looking at, instantly, without a page reload. Each card clearly labels which tenant it's currently editing.
- **A real toggle switch**, built from scratch since nothing like it existed in this app before.

## Two real bugs found and fixed while testing this

1. **The toggle switch didn't work at all.** The visible on/off slider was sitting visually on top of the actual clickable checkbox underneath it, so clicking it did nothing — for anyone, not just the automated test. Fixed by making sure the real (invisible) checkbox is the thing that actually receives the click.
2. **A validation error showed up as the literal text "[object Object]"** instead of a real message (e.g. when saving an invalid number). The cause: this app's own custom error messages are always plain text, but FastAPI's automatic validation errors come back in a different, structured format, and the code that displays errors only knew how to handle the plain-text kind. Fixed so any error from the API — of either shape — now shows a real, readable message. This fix applies everywhere in the app that shows API errors, not just this new screen.

## What's verified working

- All 32 backend tests still pass unchanged (this was a frontend-only change).
- Tested by hand, end to end, in a real browser against the real server: both cards load real values for the selected tenant, each card saves independently without touching the other, changes survive a full page refresh, switching tenants in the topbar instantly reloads both cards with that tenant's real values, the prompt-version counter goes up only when the override text genuinely changes (not on every save), the toggle correctly keeps your saved override in place even while it's turned off, and an invalid save (like clearing a required number field) now shows a clear, readable error instead of breaking silently or showing garbage text.
- Blank text fields (like Environment Name) save as empty text, while blank Default Model / Prompt Override save as "not set" — confirmed both behave correctly and don't get confused with each other.

## What's next

Approval Policy and Observability are the remaining "make it real" phases from the original mockup.
