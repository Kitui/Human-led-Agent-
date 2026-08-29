# Fixed: cross-tenant admin access + a browser cache leak between logins

## What problem this solves

An external code review of this project found two real gaps. Both were confirmed against the actual code before fixing anything.

## 1. A user could manage another tenant's settings

Every workflow-related endpoint (starting an investigation, viewing/approving/rejecting a run) already checked that the tenant you were asking about was one you actually belong to. The tenant-administration endpoints didn't:

- `PATCH /tenants/{slug}` (activate/deactivate a tenant)
- `GET /tenants/{slug}/settings`
- `PATCH /tenants/{slug}/settings`

only checked that you were logged in — not that `{slug}` was one of your tenants. In practice, `red_user` (who should only ever touch `tenant_red`) could call `PATCH /tenants/tenant_green/settings` and it would succeed.

**Fixed**: all three now check tenant membership the same way every other endpoint already did, returning 403 if you don't belong to that tenant. A nonexistent tenant still correctly returns 404 rather than being masked as a 403.

**Left as-is, deliberately**: listing tenants (`GET /tenants`) and creating one (`POST /tenants`) stay open to any logged-in user. There's no admin-role system in this lab yet — scoping the list to "tenants you belong to" would make a tenant invisible to the very person who just created it, since nothing grants tenant access after creation. The actual problem was one user changing another's settings, not seeing tenant names exist, so that's what got fixed.

**Frontend**: the Tenant Management table (Settings page) now greys out the Activate/Deactivate button for any tenant you don't have access to, with a tooltip explaining why — instead of showing a button that would just fail.

## 2. A previous user's run data could linger in the browser after switching accounts

The app caches recently-seen runs in the browser (`localStorage`) so pages load quickly. That cache was never cleared when a different user logged in on the same browser — so if `red_user` used the app and then `green_user` logged in afterward without the page being fully reset, `green_user` could momentarily see `red_user`'s cached run data blended in. The backend itself was never at risk here — every real request was still correctly authorized — but the browser-side cache undermined that.

**Fixed**: the cache is now cleared at every login and logout. Since `GET /runs` is real and persisted in PostgreSQL now (it wasn't when this cache was first built), a fresh fetch on login is fast and always correct — there's no need to preserve a user's cached runs across separate login sessions.

## What's verified working

- All 36 backend tests pass (32 existing + 4 new, covering: `red_user` gets 403 on all three tenant-admin endpoints for `tenant_green`; `admin_user`, who legitimately has both tenants, still works normally).
- Tested by hand in a real browser: logged in as `red_user`, confirmed the run-history cache starts empty, confirmed `tenant_green`'s row in Tenant Management is disabled with an explanatory tooltip, confirmed a direct API call against `tenant_green`'s settings returns 403; logged out and back in as `green_user`, confirmed the cache was empty immediately and no `tenant_red` data ever appeared.

## What's next

This closes the two concrete leaks the review found. A real admin/role system (so tenant creation and listing can be properly scoped too) is still a known, larger gap — same category as the "no RBAC" limitation already noted elsewhere in this project.
