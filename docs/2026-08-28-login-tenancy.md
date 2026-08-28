# Adding real logins and tenant permissions

## What problem this solves

Before this, anyone calling the API could type any tenant name they liked (`tenant_red` or `tenant_green`) and the server would just believe them. There was no concept of "who is asking" at all — no login, no accounts, nothing stopping someone from reading or acting on a tenant's data they had no business touching. The only real check was "is this a tenant that exists," never "are you allowed to use it."

## What we built

- **A login endpoint** (`POST /auth/login`). You send a username and password; if they're correct, you get back a signed token (a JWT) proving who you are and which tenants you're allowed to act on.
- **Every other part of the API now checks that token** instead of trusting whatever tenant name is typed into a request:
  - Investigating an issue for a tenant you're not allowed to see now fails immediately (before the AI even gets involved), instead of quietly running.
  - The list of runs you see is automatically filtered down to only the tenants you're allowed to see.
  - Approving or rejecting a run checks that it belongs to one of your tenants *before* anything happens — not after.
  - Running the eval suite still just requires being logged in (it's not tied to a specific tenant, but it does cost real AI usage, so it shouldn't be callable by just anyone).
  - The health check (`/health`) is the one thing that stays open to everyone, which is normal — it doesn't reveal or touch any real data.
- **Three demo accounts** already exist (they were created automatically when the database was set up last time) — `red_user` and `green_user` can each only see their own tenant, and `admin_user` can see both. Nothing new needed to be created for this; the login feature just started actually *using* that table.

## What's different for you

- Every API call except `/health` and `/auth/login` itself now needs an `Authorization: Bearer <token>` header, or it's rejected with a 401 ("not logged in"). The README's example flow now shows the login step first.
- If you try to act on a tenant your account isn't allowed to use, you'll get a 403 ("not authorized"), even if that tenant genuinely exists.

## What's verified working

- All 12 automated tests pass (5 existing + 7 new ones covering login success/failure and tenant permission checks).
- Manually tested end-to-end against the real server: logging in, investigating an allowed tenant (works), investigating a disallowed-but-real tenant (blocked with 403, no AI call made), investigating a fake tenant (400), calling any endpoint with no login (401), and logging in as the two-tenant `admin_user` account to confirm it really can act on both.
- Found and fixed two real gaps along the way:
  1. The automated tests run against a completely fresh, empty database (especially in CI), and nothing was seeding the demo login accounts into it — the app only does that seeding when the real server starts up, which tests never do. Fixed by seeding once at the start of a test run.
  2. After opening the PR, CI actually failed: the signing secret the login feature needs (`JWT_SECRET_KEY`) was never given to the CI environment, so every test that touched a login failed with a clear "environment variable is not set" error. Fixed by adding a fixed, harmless placeholder value to the CI config — it only needs to be *some* value for CI's own self-contained test run, not a real secret (unlike the real `OPENAI_API_KEY`, which stays a genuine credential).

## What's next

This was backend-only, on purpose. The dashboard (the actual web page) doesn't have a login screen yet and doesn't send this token — that's the next, separate piece of work. Until then, the dashboard's own calls to the API will start failing with 401 once this is deployed, since it was never asked to log in. This is expected and will be fixed by the frontend phase.

This work is on branch `feature/login-tenancy`, going out as a pull request rather than a direct push to `main`.
