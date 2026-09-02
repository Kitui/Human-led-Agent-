/* CorrelAct — entry point: routing, navigation, branding, and boot */
import { qs, qsa, checkHealth, clearHistory, escapeHtml } from "./shared.js";
import { renderInvestigatePage, renderStepper, doInvestigate } from "./investigate.js";
import { renderActionPointsPage } from "./action-points.js";
import { renderRunsPage } from "./runs.js";
import { renderApprovalsPage } from "./approvals.js";
import { renderDashboardPage } from "./dashboard.js";
import { renderTracesPage } from "./traces.js";
import { renderEvalsPage } from "./evals.js";
import { renderSettingsPage } from "./settings.js";
import { enhanceSettingsPage } from "./settings-ux.js";
import { renderLoginShell } from "./login-view.js";
import {
  hasValidSession, showLoginScreen, hideLoginScreen, initLoginForm,
  currentTenantIds, currentUsername, logout, restoreBrowserSession,
} from "./auth.js";

/* Load the shared design-system override after styles.css. Keeping it as a
 * separate layer lets the standalone WebMCP workspaces use the same visual
 * language without coupling their page-specific CSS to this SPA. */
if (!document.querySelector('link[data-correlact-ui]')) {
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "/correlact-ui.css";
  link.dataset.correlactUi = "true";
  document.head.appendChild(link);
}

/* Layout fixes live after the base design layer. */
if (!document.querySelector('link[data-correlact-layout]')) {
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "/correlact-layout.css";
  link.dataset.correlactLayout = "true";
  document.head.appendChild(link);
}

/* The challenge theme is intentionally a final cascade layer. It changes
 * palette/branding without changing the authentication or workflow model. */
if (!document.querySelector('link[data-correlact-theme]')) {
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "/correlact-theme.css";
  link.dataset.correlactTheme = "true";
  document.head.appendChild(link);
}

/* Organization scope is a UI context, but the data boundary must follow it.
 * Some page modules call GET /runs through different helpers, so apply the
 * selected organization in one place before any request leaves the SPA.
 * Protected backend authorization remains authoritative. */
const nativeFetch = window.fetch.bind(window);
window.fetch = function correlactScopedFetch(input, init = {}) {
  const method = String(init.method || "GET").toUpperCase();
  const selected = document.querySelector("#tenant-select-label")?.textContent?.trim();

  if (method === "GET" && selected && (typeof input === "string" || input instanceof URL)) {
    try {
      const url = new URL(String(input), window.location.origin);
      if (url.origin === window.location.origin && url.pathname === "/runs" && !url.searchParams.has("tenant_id")) {
        url.searchParams.set("tenant_id", selected);
        const nextInput = String(input).startsWith("http") ? url.toString() : `${url.pathname}${url.search}`;
        return nativeFetch(nextInput, init);
      }
    } catch (_) {
      /* Fall through to the original request for non-URL inputs. */
    }
  }

  return nativeFetch(input, init);
};

function applyCorrelActBranding() {
  document.title = "CorrelAct";

  const brand = qs(".brand");
  if (brand) {
    brand.textContent = "";
    brand.setAttribute("aria-hidden", "true");
  }

  const logo = qs(".logo");
  if (logo) {
    logo.classList.add("correlact-wordmark");
    logo.setAttribute("aria-label", "CorrelAct");
    logo.innerHTML = '<img src="/assets/correlact-logo.png?v=20260901d" alt="" width="240" height="135" />';
  }

  const dashboardSubtitle = qs('[data-page="dashboard"] .subtitle');
  if (dashboardSubtitle) {
    dashboardSubtitle.textContent = "Monitor investigations, approvals, execution, and system quality across CorrelAct.";
  }

  const investigateSubtitle = qs('[data-page="investigate"] .subtitle');
  if (investigateSubtitle) {
    investigateSubtitle.textContent = "Describe an operational issue. CorrelAct gathers evidence and proposes a controlled next action.";
  }

  const actionsNav = qs('.nav-item[data-page="action-points"] span:last-child');
  if (actionsNav) actionsNav.textContent = "Actions";
  const actionsPage = qs('[data-page="action-points"]');
  if (actionsPage) {
    const heading = qs(".page-head h1", actionsPage);
    const subtitle = qs(".page-head .subtitle", actionsPage);
    const search = qs("#ap-search", actionsPage);
    const newButtonLabel = qs("#ap-new-btn span", actionsPage);
    const newButton = qs("#ap-new-btn", actionsPage);
    if (heading) heading.textContent = "Actions";
    if (subtitle) subtitle.textContent = "Track, review, and progress evidence-grounded actions proposed by CorrelAct.";
    if (search) search.placeholder = "Search actions…";
    if (newButtonLabel) newButtonLabel.textContent = "+ New Action";
    if (newButton) newButton.title = "Actions are created by an investigation — see the Investigate workspace.";
  }

  const runsSearch = qs("#runs-search");
  if (runsSearch) runsSearch.placeholder = "Search runs by ID, issue, or proposed action…";

  const approvalsSubtitle = qs('[data-page="approvals"] .subtitle');
  if (approvalsSubtitle) {
    approvalsSubtitle.textContent = "Review CorrelAct-recommended actions before any consequential execution is allowed.";
  }
}

/* ---------------- routing / nav ---------------- */
const PAGE_RENDERERS = {
  investigate: renderInvestigatePage,
  "action-points": renderActionPointsPage,
  runs: renderRunsPage,
  approvals: renderApprovalsPage,
  dashboard: renderDashboardPage,
  traces: renderTracesPage,
  evals: renderEvalsPage,
  settings: renderSettingsPage,
};

function navigateTo(page) {
  qsa(".page").forEach((el) => el.classList.toggle("active", el.dataset.page === page));
  qsa(".nav-item").forEach((el) => el.classList.toggle("active", el.dataset.page === page));
  const renderer = PAGE_RENDERERS[page];
  const renderResult = renderer ? renderer() : null;

  /* Settings has a separate interaction layer because most completion cards
     represent enforced/read-only capabilities rather than editable values. */
  if (page === "settings") {
    enhanceSettingsPage();
    Promise.resolve(renderResult).then(enhanceSettingsPage).catch(() => {});
  }
}

const VALID_PAGES = ["dashboard", "investigate", "action-points", "runs", "approvals", "traces", "evals", "settings"];

function currentPage() {
  const page = (location.hash || "#investigate").slice(1);
  return VALID_PAGES.includes(page) ? page : "investigate";
}

function initRouter() {
  const go = () => navigateTo(currentPage());
  window.addEventListener("hashchange", go);
  go();
}

/* ---------------- organization dropdown ---------------- */
const ACTIVE_ORGANIZATION_KEY = "correlact_active_organization";

function rememberedOrganization(allowed) {
  let remembered = null;
  try { remembered = sessionStorage.getItem(ACTIVE_ORGANIZATION_KEY); } catch (_) { /* ignore */ }
  return allowed.includes(remembered) ? remembered : (allowed[0] || "");
}

function rememberOrganization(organization) {
  try { sessionStorage.setItem(ACTIVE_ORGANIZATION_KEY, organization); } catch (_) { /* ignore */ }
}

function initTenantSelect() {
  const wrap = qs("#tenant-select");
  const menu = qs("#tenant-menu");
  const tenants = currentTenantIds();
  const selected = rememberedOrganization(tenants);

  menu.innerHTML = tenants.map((t) => `<button data-tenant="${escapeHtml(t)}">${escapeHtml(t)}</button>`).join("");
  qs("#tenant-select-label").textContent = selected;
  document.documentElement.dataset.correlactOrganization = selected;

  const setOpen = (open) => {
    wrap.classList.toggle("open", open);
    wrap.setAttribute("aria-expanded", String(open));
  };

  wrap.addEventListener("click", (e) => {
    if (e.target.closest("button")) return;
    setOpen(!wrap.classList.contains("open"));
  });

  wrap.addEventListener("keydown", (e) => {
    if (e.target !== wrap) return; // let focused menu buttons handle their own Enter/Space
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setOpen(!wrap.classList.contains("open"));
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  });

  qsa("button", menu).forEach((btn) => {
    btn.addEventListener("click", () => {
      const next = btn.dataset.tenant;
      const previous = qs("#tenant-select-label").textContent.trim();
      qs("#tenant-select-label").textContent = next;
      document.documentElement.dataset.correlactOrganization = next;
      rememberOrganization(next);
      setOpen(false);

      if (next !== previous) {
        /* The local history is only an optimistic cache. Server state remains
         authoritative, so dropping it here prevents a prior organization's
         runs from surviving a scope change while the new scoped query loads. */
        clearHistory();
      }
      navigateTo(currentPage());
    });
  });

  document.addEventListener("click", (e) => {
    if (!wrap.contains(e.target)) setOpen(false);
  });
}

/* ---------------- avatar / logout ---------------- */
function initAvatar() {
  const username = currentUsername() || "?";
  qs("#avatar-badge").textContent = username.slice(0, 2).toUpperCase();
  qs("#avatar-menu-username").textContent = username;

  const wrap = qs("#avatar-wrap");
  const setOpen = (open) => {
    wrap.classList.toggle("open", open);
    wrap.setAttribute("aria-expanded", String(open));
  };

  wrap.addEventListener("click", (e) => {
    if (e.target.closest("button")) return;
    setOpen(!wrap.classList.contains("open"));
  });

  wrap.addEventListener("keydown", (e) => {
    if (e.target !== wrap) return; // let the focused Log out button handle its own Enter/Space
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setOpen(!wrap.classList.contains("open"));
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  });

  qs("#logout-btn").addEventListener("click", logout);

  document.addEventListener("click", (e) => {
    if (!wrap.contains(e.target)) setOpen(false);
  });
}

/* ---------------- misc UI wiring ---------------- */
function initMisc() {
  qs("#investigate-btn").addEventListener("click", doInvestigate);

  const textarea = qs("#issue-input");
  const charCount = qs("#char-count");
  const updateCount = () => { charCount.textContent = textarea.value.length; };
  textarea.addEventListener("input", updateCount);
  updateCount();

  qs("#collapse-btn").addEventListener("click", () => {
    qs("#sidebar").classList.toggle("collapsed");
  });
}

/* ---------------- app start (post-login / restored session) ---------------- */
async function startApp() {
  initTenantSelect();
  initAvatar();
  renderStepper("new");
  await checkHealth();
  initRouter();
  setInterval(checkHealth, 15000);
}

/* ---------------- boot ---------------- */
document.addEventListener("DOMContentLoaded", async () => {
  applyCorrelActBranding();
  renderLoginShell();
  initMisc();
  initLoginForm(startApp);

  // Always attempt shared-cookie restoration. Existing pre-fix tabs can use
  // their sessionStorage bearer once to establish the shared cookie; new tabs
  // can then restore directly from that cookie.
  await restoreBrowserSession();

  if (hasValidSession()) {
    hideLoginScreen();
    startApp();
  } else {
    showLoginScreen();
  }
});
