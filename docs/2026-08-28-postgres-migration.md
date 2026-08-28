# Moving from in-memory storage to a real database

## What problem this solves

Before today, everything the app "remembered" — investigation runs, eval results — lived in plain Python variables. That meant every time the server restarted, all of it vanished. This was fine for quick experiments, but it also meant there was nowhere real to store login accounts for the upcoming feature that lets people log in and only see their own tenant's data.

## What we built

- **A real PostgreSQL database**, running in Docker on this machine (`docker-compose.yml`). It uses the `pgvector/pgvector` image specifically so that a *future* feature — searching by meaning instead of exact match — won't need any extra setup when we get to it. We are not using that "search by meaning" part yet, just the regular database part.
- **Three tables**: one for investigation runs, one for the history of eval-suite runs, and one for user accounts (usernames + safely-scrambled passwords + which tenants each person can see). The user table isn't used by anything yet — it's built and ready for the login feature, which is next.
- **Three demo accounts** were automatically created the first time the app started: `red_user` (can only see tenant_red), `green_user` (can only see tenant_green), and `admin_user` (can see both). Their passwords are `red-pass-123`, `green-pass-123`, and `admin-pass-123` — fine for a demo lab, not for anything real.
- Every part of the app that used to read/write those Python variables (investigating an issue, approving/rejecting it, running the eval suite) now reads/writes the real database instead. The actual behavior — what the agent does, what gets approved, how retries work — did not change at all; only *where the data is kept* changed.

## What's different for you day-to-day

- You now need to run `docker compose up -d` once before starting the app or running the tests. This starts the database in the background; you can leave it running.
- Restarting the server no longer loses anything — a run you started 10 minutes ago is still there after a restart.
- Running the test suite (`pytest`) now talks to a real (temporary, auto-cleaned-up) database instead of nothing at all — this is closer to how real software gets tested, but it does mean the database needs to be running first.

## Two real snags hit while setting this up (and how they were fixed)

1. **A leftover, stale database folder.** Docker had kept a data folder from something that existed on this machine before today's `docker-compose.yml` was written, with different login details baked in. We deleted it and let Docker create a fresh one — safe, since it was just local, disposable dev data.
2. **Port 5432 was already taken.** It turned out this machine already has a *separate, native* PostgreSQL program running directly on Windows (unrelated to this project, probably for something else you have installed) using the database's normal "front door" port. Rather than touch that other program, this project's database was moved to use port 5544 instead, so the two don't collide.
3. (Minor, no fix needed) One of my own test commands accidentally sent a real request to the AI twice due to a scripting mistake on my end (a `||` fallback that shouldn't have triggered) — cost one small extra real API call. No app bug, just me being sloppy with a throwaway shell command.

## What's verified working

- The database starts cleanly and the app connects to it.
- `pytest` passes (5 out of 5).
- A real investigation was run through the API, confirmed to be saved in the database, and was still there after fully restarting the server.
- Approving a run that needed a human decision correctly ran the follow-up action and saved the result.
- The eval suite ran for real (3/3 passed) and its history is now saved for real too — and, just like before, the practice runs used to test the AI don't clutter the main "runs" you'd see for real customer issues.

## What's next

The login/tenancy feature (already planned, on hold until this landed) can now be built directly on top of the `users` table created here — nothing further needs to change on the database side for that to happen.
