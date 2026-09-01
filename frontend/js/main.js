/* CorrelAct — entry point: routing, navigation, branding, and boot */
import { qs, qsa, checkHealth } from "./shared.js";
import { renderInvestigatePage, renderStepper, doInvestigate } from "./investigate.js";
import { renderActionPointsPage } from "./action-points.js";
import { renderRunsPage } from "./runs.js";
import { renderApprovalsPage } from "./approvals.js";
import { renderDashboardPage } from "./dashboard.js";
import { renderTracesPage } from "./traces.js";
import { renderEvalsPage } from "./evals.js";
import { renderSettingsPage } from "./settings.js";
import { enhanceSettingsPage } from "./settings-ux.js";
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

function applyCorrelActBranding() {
  document.title = "CorrelAct";

  const brand = qs(".brand");
  if (brand) brand.textContent = "CorrelAct";

  const logo = qs(".logo");
  if (logo) {
    logo.setAttribute("aria-label", "CorrelAct");
    logo.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <circle cx="6" cy="12" r="2.4"/>
        <circle cx="18" cy="6" r="2.4"/>
        <circle cx="18" cy="18" r="2.4"/>
        <path d="m8.2 10.9 7.5-3.8"/>
        <path d="m8.2 13.1 7.5 3.8"/>
      </svg>`;
  }

  const loginTitle = qs("#login-screen .modal-title");
  if (loginTitle) loginTitle.textContent = "Sign in to CorrelAct";
  const loginMessage = qs("#login-screen .modal-message");
  if (loginMessage) loginMessage.textContent = "Sign in to your CorrelAct workspace to continue.";

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
     represent enforced/read-only capabilities rather than editable values.
     Decorate immediately (the card shells are created synchronously) and once
     more after async status data has finished loading. */
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

/* ---------------- tenant dropdown ---------------- */
function initTenantSelect() {
  const wrap = qs("#tenant-select");
  const menu = qs("#tenant-menu");
  const tenants = currentTenantIds();
  menu.innerHTML = tenants.map((t) => `<button data-tenant="${t}">${t}</button>`).join("");
  qs("#tenant-select-label").textContent = tenants[0] || "";
  wrap.addEventListener("click", (e) => {
    if (e.target.closest("button")) return;
    wrap.classList.toggle("open");
  });
  qsa("button", menu).forEach((btn) => {
    btn.addEventListener("click", () => {
      qs("#tenant-select-label").textContent = btn.dataset.tenant;
      wrap.classList.remove("open");
      navigateTo(currentPage()); // re-render the visible page for the new tenant
    });
  });
  document.addEventListener("click", (e) => {
    if (!wrap.contains(e.target)) wrap.classList.remove("open");
  });
}

/* ---------------- avatar / logout ---------------- */
function initAvatar() {
  const username = currentUsername() || "?";
  qs("#avatar-badge").textContent = username.slice(0, 2).toUpperCase();
  const wrap = qs("#avatar-wrap");
  wrap.title = `Log out (${username})`;
  wrap.addEventListener("click", logout);
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
  await checkHealth(); // resolve apiVersion before the first page render needs it
  initRouter();
  setInterval(checkHealth, 15000);
}

/* ---------------- boot ---------------- */
document.addEventListener("DOMContentLoaded", async () => {
  applyCorrelActBranding();
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
