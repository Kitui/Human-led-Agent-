# Real per-tenant General Settings + Model & Prompt (backend)

## What problem this solves

The mockup you shared showed a "General Settings" and "Model & Prompt" card full of knobs — max steps, retry limits, which AI model to use, a custom prompt, response language, and more. Before this, none of that existed as real settings anywhere; things like "how many retries" and "how many steps before giving up" were just fixed numbers buried in the Python code, the same for every tenant, with no way to see or change them.

## What we built

Every tenant now has its own real, saved settings, and — this is the important part — changing them actually changes what happens when that tenant investigates an issue:

- **Max Steps per Run** — if you lower this, a run that would normally need a human approval step now correctly fails once it hits the limit, instead of ignoring the setting.
- **Retry Limit** — controls how many times the execution step retries after a failure, per tenant, instead of a fixed number for everyone.
- **Default Model** — you can now point a tenant at a specific AI model. Verified this is real by intentionally setting a fake model name — the very next request failed exactly as it should, proving the setting is actually being sent through, not just stored and ignored.
- **Max Concurrent Runs** — if a tenant tries to run more investigations at once than this allows, the extra ones are turned away immediately (before touching the AI at all), instead of just letting everything through.
- **Log Level** — controls how much detail this tenant's activity prints to the server console.
- **Default Language** — if you set this to something other than English, the AI is instructed to respond in that language. Verified this for real: set it to French, and the investigation summary and recommended action came back written in French.
- **Environment Name** — a real, saved, editable label for your own reference. Honest callout: it doesn't change any behavior, same as the existing "Production/Staging/Sandbox" category tenants already have.
- **Default Time Zone** — real and saved, but doesn't yet change how dates are *displayed* anywhere — that's frontend work for a later phase, not silently pretended to work already.

## About "Prompt Version" specifically

The mockup implied a full history of prompt edits with version numbers like "v2.1.3." Building that for real — a whole editable version history with rollback — is a much bigger feature on its own, out of proportion for this pass. Instead, we built something smaller but genuinely real: each tenant can set one custom replacement for the AI's base instructions, and a real version number goes up by exactly 1 every time that text actually changes (never a made-up "2.1.3"-style number). A toggle ("Auto-update to latest") decides whether the tenant uses their custom version or always follows the default. Verified this for real too: set a distinctive override, watched it take effect fully (the AI followed it exactly), then flipped the toggle and watched the tenant snap right back to normal default behavior, even though the custom version was still saved underneath.

## What's still not done in this pass

- The Security tab (SSO, MFA, IP Allowlist, API Key Rotation) — all of it stays a "Coming soon" placeholder, as agreed. SSO in particular can't be made real at all without a real outside identity provider, which this lab doesn't have and can't reasonably add.
- No Settings *screen* changes yet — everything above is real on the backend (you can already see and change it by calling the API directly), but the actual Settings page in the browser doesn't have inputs for any of this yet. That's the next, separate piece of work.
- Applying "Default Time Zone" to how dates are shown, anywhere in the app, is also deferred to that same next phase.

## What's verified working

- All 32 automated tests pass (17 from before + 15 new ones).
- Manually verified live, end to end, against the real running server: `max_steps` correctly failing a run at the limit, `max_concurrent_runs` correctly rejecting a second simultaneous request, `default_language` genuinely changing the AI's response language, the prompt override and its auto-update toggle both working exactly as designed, and `default_model` being genuinely sent through (proven by deliberately breaking it with a fake model name and watching it fail).
- Ran into the same kind of thing as before: my own manual testing left real, changed data sitting in the local development database, which briefly confused the automated tests when I ran them afterward. Not a bug — just the database being shared between manual poking and automated testing. Reset it to a clean copy before finishing, and everything passed.

## What's next

A follow-up PR to actually add these fields to the Settings screen in the browser, plus applying "Default Time Zone" to real date displays. After that: Approval Policy and Observability are the remaining phases from the original mockup.
