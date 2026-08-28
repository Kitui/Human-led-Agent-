# Real tenant management (first of the "make Settings real" phases)

## What problem this solves

You shared a mockup of a full Settings page, and asked me to build it for real (except Security, which just gets a "Coming soon" card). That mockup showed a lot that had no real backend behind it at all — fake internal service URLs, security toggles like SSO/MFA that don't exist, a "tenant_blue" that was never real, and status lights claiming things were "Healthy" with nothing actually checking them. Rather than build a page that just *looks* right, we agreed to build the pieces for real, one at a time, and start with the most foundational one: **tenants themselves**, which today are just two hardcoded names buried in Python code (`tenant_red`, `tenant_green`) with no way to see, add, or turn one off.

## What we built

- **Tenants are now real database rows**, not a hardcoded list. Each one has a name, an environment label (Production/Staging/Sandbox), and an Active/Inactive status.
- **A real Tenant Management screen** (Settings → General tab): shows every tenant that exists, lets you add a new one, and lets you deactivate (or reactivate) any of them — all without reloading the page.
- **Deactivating a tenant actually matters.** If a tenant is turned off, trying to investigate an issue for it is rejected immediately, the same way an issue for a completely made-up tenant already was — before any AI call is even attempted, so it doesn't waste anything.
- **The rest of the Settings page now has an honest shell.** Model & Prompt, Approval Policy, Integrations, and Observability each show a plain "Coming soon" card — no fake toggles, no invented data. Security gets the same treatment permanently, since no real security feature is planned for this lab.

## An important, deliberate limitation (not a bug)

Adding a tenant in Settings does **not** give any logged-in user permission to actually use it. The tenant dropdown at the top of the app (the one you use when investigating an issue) is driven entirely by what your *account* is allowed to see — a separate thing from "which tenants exist in the system." Granting a person access to a tenant is its own feature, not built yet. I tested this explicitly: after adding `tenant_blue`, it showed up correctly in the management table, but never appeared in anyone's tenant dropdown, exactly as expected.

Also worth knowing: there's no "admin" concept in this app yet, so right now *any* logged-in user can add or deactivate a tenant, not just a designated administrator. That's a known simplification for this phase, flagged directly in the code, not an oversight.

## What's verified working

- All 17 automated tests pass (12 from before + 5 new ones covering listing, creating, duplicate-name rejection, deactivating, and the "deactivated tenant blocks investigation" rule).
- Tested by hand in a real browser end to end: listing the two starting tenants, adding a new one and watching it appear immediately, deactivating a tenant and watching an investigation against it get correctly blocked, reactivating it and confirming it works again, and clicking through all 6 Settings tabs to confirm the placeholders show up cleanly with no errors.
- Found and fixed one real bug during testing: the tab-switching buttons initially did nothing when clicked. The cause was a naming collision — the sidebar's "Settings" link and the actual Settings page both happened to share an identifying attribute, and the code was accidentally grabbing the sidebar link instead of the page. Fixed by pointing at the page more precisely.
- Along the way, my own manual testing left some real test data (a tenant literally named `tenant_blue`) sitting in the local development database, which briefly collided with the automated tests using that same name. Not an application bug — just a reminder that manual browser testing and the automated test suite share the same local database. I reset the local database to a clean slate before finishing, so nothing is left over from my testing.

## What's next

This unblocks the next phases already discussed: Model & Prompt, Approval Policy, and Observability, each becoming real, per-tenant settings in their own turn.
