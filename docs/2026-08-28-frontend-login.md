# Adding a real login screen to the dashboard

## What problem this solves

The backend already required a login (from the previous phase), but the actual dashboard web page had no idea — it never showed a login form and never sent a login token with its requests. Anyone opening the dashboard would have seen every API call fail. It also still let you freely pick either tenant from a dropdown, even though the backend was already enforcing "you can only use tenants you're allowed to."

## What we built

- **A real login screen.** The dashboard now opens to a sign-in form (username + password) instead of the app itself. Nothing behind it is reachable until you log in successfully.
- **The login token now actually gets used.** Every request the dashboard makes now carries your login token automatically, in one central place — you don't see this happening, but it's what makes the rest of the app work again.
- **The tenant dropdown now reflects reality.** Instead of always offering both demo tenants, it only shows the ones *your* account is actually allowed to use — one option for `red_user`/`green_user`, both for `admin_user`.
- **A working logout.** Clicking your avatar in the top-right logs you out and takes you back to the sign-in screen.
- **Session handling that matches how logins actually work.** Your login is remembered if you refresh the page, but forgotten if you close the browser tab — a reasonable middle ground for something that's a temporary credential, not permanent data. If your login ever stops being valid partway through using the app (expired, or otherwise rejected), the app notices automatically and drops you back to the sign-in screen instead of quietly breaking.
- **The Settings page now tells the truth** — it shows who you're actually logged in as and which tenants your account can see, instead of a hardcoded list that was true for everyone regardless of login.

## What's verified working

Tested against the real running backend, in a real browser, covering every case from the plan:
- A fresh visit shows only the login screen — nothing else is reachable.
- Logging in as each of the three demo accounts shows the correct, restricted tenant list for that account (`red_user` → tenant_red only, `green_user` → tenant_green only, `admin_user` → both), and each can actually investigate an issue for a tenant it's allowed to use.
- A wrong password shows an error message on the form itself, without reloading the page.
- Trying to act on a tenant you're not allowed to (even by bypassing the dropdown directly) is still correctly blocked by the backend with no way around it from the frontend.
- Logging out clears everything and returns to the sign-in screen.
- Refreshing the page keeps you logged in; closing and reopening the tab does not.
- If your login token becomes invalid, the very next thing the app tries to do fails, and the app automatically resets itself back to a clean sign-in screen rather than getting stuck in a broken state.

## What's next

With this, the full login/tenancy feature is complete end-to-end — backend and frontend both enforce it, and there's nothing further planned for this specific feature right now.
