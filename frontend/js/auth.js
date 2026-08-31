/* CorrelAct — login screen + shared browser session bootstrap */
import {
  API_BASE,
  qs,
  api,
  getAuthSession,
  setAuthSession,
  clearAuthSession,
} from "./shared.js";

export function hasValidSession() {
  return !!getAuthSession();
}

export function currentUsername() {
  const s = getAuthSession();
  return s ? s.username : null;
}

export function currentTenantIds() {
  const s = getAuthSession();
  return s ? s.tenantIds : [];
}

export async function restoreBrowserSession() {
  const existing = getAuthSession();
  const headers = { "Content-Type": "application/json" };

  // Existing tabs created before the cookie-session fix still have a bearer
  // token in sessionStorage. Sending it once here upgrades that tab into the
  // shared browser cookie session without asking the user to sign in again.
  if (existing?.accessToken) {
    headers.Authorization = `Bearer ${existing.accessToken}`;
  }

  try {
    const response = await fetch(`${API_BASE}/auth/session`, {
      method: "GET",
      headers,
      credentials: "same-origin",
    });
    if (!response.ok) {
      if (response.status === 401) clearAuthSession();
      return false;
    }

    const body = await response.json();
    setAuthSession({
      accessToken: body.access_token,
      tenantIds: body.tenant_ids,
      username: body.username,
    });
    return true;
  } catch (_) {
    return !!existing;
  }
}

export async function logout() {
  try {
    await fetch(`${API_BASE}/auth/logout`, {
      method: "POST",
      credentials: "same-origin",
    });
  } catch (_) {
    // Local state is still cleared even when the network is unavailable.
  }
  clearAuthSession();
  location.reload();
}

export function showLoginScreen() {
  qs("#app-root").classList.add("hidden");
  qs("#login-screen").classList.remove("hidden");
  qs("#login-username").focus();
}

export function hideLoginScreen() {
  qs("#login-screen").classList.add("hidden");
  qs("#app-root").classList.remove("hidden");
}

export function initLoginForm(onLoginSuccess) {
  const form = qs("#login-form");
  const errorEl = qs("#login-error");
  const submitBtn = qs("#login-submit-btn");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const username = qs("#login-username").value.trim();
    const password = qs("#login-password").value;
    if (!username || !password) return;

    errorEl.classList.add("hidden");
    submitBtn.disabled = true;
    submitBtn.textContent = "Signing in…";
    try {
      const body = await api("/auth/login", {
        method: "POST",
        body: JSON.stringify({ username, password }),
      });
      setAuthSession({ accessToken: body.access_token, tenantIds: body.tenant_ids, username });
      form.reset();
      hideLoginScreen();
      onLoginSuccess();
    } catch (err) {
      errorEl.textContent = err.message || "Login failed.";
      errorEl.classList.remove("hidden");
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "Sign in";
    }
  });
}