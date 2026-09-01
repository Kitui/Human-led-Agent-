/* CorrelAct — visual login shell only.
 * Authentication remains owned by auth.js and the existing FastAPI endpoints.
 * This module deliberately preserves the DOM ids auth.js depends on. */

const criticalBootStyle = document.createElement("style");
criticalBootStyle.dataset.correlactLoginBoot = "true";
criticalBootStyle.textContent = `
  html.correlact-login-booting,
  html.correlact-login-booting body { background:#06111f !important; }
  html.correlact-login-booting #login-screen { visibility:hidden !important; background:#06111f !important; }
`;
document.head.appendChild(criticalBootStyle);
document.documentElement.classList.add("correlact-login-booting");

function ensureLoginPolishStyles() {
  let link = document.querySelector('link[data-correlact-fixes]');
  if (link) return link;
  link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "/correlact-fixes.css?v=20260901d";
  link.dataset.correlactFixes = "true";
  document.head.appendChild(link);
  return link;
}

function stylesheetReady(link) {
  if (!link || link.sheet) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => resolve();
    link.addEventListener("load", done, { once: true });
    link.addEventListener("error", done, { once: true });
  });
}

function imageReady(image) {
  if (!image) return Promise.resolve();
  if (image.complete && image.naturalWidth > 0) {
    return typeof image.decode === "function" ? image.decode().catch(() => {}) : Promise.resolve();
  }
  return new Promise((resolve) => {
    const done = async () => {
      if (image.naturalWidth > 0 && typeof image.decode === "function") {
        try { await image.decode(); } catch (_) { /* load event is sufficient */ }
      }
      resolve();
    };
    image.addEventListener("load", done, { once: true });
    image.addEventListener("error", done, { once: true });
  });
}

function revealStableLogin(screen, polishLink) {
  const styleLinks = [
    document.querySelector('link[data-correlact-ui]'),
    document.querySelector('link[data-correlact-layout]'),
    document.querySelector('link[data-correlact-theme]'),
    polishLink,
  ].filter(Boolean);
  const logoImage = screen.querySelector(".login-brand img");

  let revealed = false;
  const reveal = () => {
    if (revealed) return;
    revealed = true;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        document.documentElement.classList.remove("correlact-login-booting");
        screen.classList.add("correlact-login-ready");
      });
    });
  };

  Promise.all([
    ...styleLinks.map(stylesheetReady),
    imageReady(logoImage),
  ]).then(reveal);
  window.setTimeout(reveal, 2500);
}

export function renderLoginShell() {
  const screen = document.querySelector("#login-screen");
  if (!screen || screen.dataset.correlactLogin === "ready") return;

  const polishLink = ensureLoginPolishStyles();
  screen.dataset.correlactLogin = "ready";
  screen.classList.add("correlact-login");
  screen.innerHTML = `
    <div class="correlact-login-shell">
      <section class="login-story" aria-label="About CorrelAct">
        <div class="login-brand">
          <img src="/assets/correlact-logo.png?v=20260901d" alt="CorrelAct — Investigate, Correlate, Act" width="240" height="135" />
        </div>

        <div class="login-story-rule"></div>
        <h1>
          <span>Human-led</span>
          <span>operational intelligence</span>
        </h1>
        <p class="login-story-copy">CorrelAct helps operations teams uncover issues, connect evidence, and move forward with confidence while keeping consequential work under human control.</p>

        <div class="login-principles">
          <article class="login-principle">
            <span class="login-principle-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/></svg>
            </span>
            <strong>Issue Discovery</strong>
            <p>Identify the operational cause with clear evidence.</p>
          </article>
          <article class="login-principle">
            <span class="login-principle-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="7" r="2"/><circle cx="19" cy="12" r="2"/><path d="m7 11 3.2-2.4M13.8 8.5 17 11"/></svg>
            </span>
            <strong>Connected Evidence</strong>
            <p>Unify signals and surface what matters most.</p>
          </article>
          <article class="login-principle">
            <span class="login-principle-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="m13 2-8 12h7l-1 8 8-12h-7z"/></svg>
            </span>
            <strong>Governed Execution</strong>
            <p>Move forward within approved authority and oversight.</p>
          </article>
        </div>
      </section>

      <section class="login-panel" aria-labelledby="login-title">
        <h2 id="login-title">Welcome back</h2>
        <p class="login-panel-subtitle">Sign in to continue to CorrelAct</p>
        <form id="login-form">
          <div class="login-field">
            <label for="login-username">Email address</label>
            <div class="login-input-wrap">
              <span class="login-input-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m4 7 8 6 8-6"/></svg></span>
              <input type="text" id="login-username" autocomplete="username" placeholder="you@organization.com" required />
            </div>
          </div>
          <div class="login-field">
            <label for="login-password">Password</label>
            <div class="login-input-wrap">
              <span class="login-input-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg></span>
              <input type="password" id="login-password" autocomplete="current-password" placeholder="Enter your password" required />
              <button type="button" class="password-toggle" id="login-password-toggle" aria-label="Show password" aria-pressed="false">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"/><circle cx="12" cy="12" r="2.5"/></svg>
              </button>
            </div>
          </div>
          <p class="banner hidden" id="login-error" role="alert"></p>
          <button type="submit" class="btn btn-primary" id="login-submit-btn">Sign in</button>
        </form>
        <p class="login-security-note">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M12 3 5 6v5c0 4.5 3 8 7 9 4-1 7-4.5 7-9V6l-7-3Z"/><path d="m9.5 12 2 2 3.5-3.5"/></svg>
          Organization-scoped access · Human-controlled execution · Auditable
        </p>
      </section>
    </div>`;

  revealStableLogin(screen, polishLink);

  const toggle = document.querySelector("#login-password-toggle");
  const password = document.querySelector("#login-password");
  toggle?.addEventListener("click", () => {
    const show = password.type === "password";
    password.type = show ? "text" : "password";
    toggle.setAttribute("aria-pressed", String(show));
    toggle.setAttribute("aria-label", show ? "Hide password" : "Show password");
  });
}
