/* Human-Led Agent Lab — entry point: routing, nav, boot */
import { qs, qsa, checkHealth } from "./shared.js";
import { renderInvestigatePage, renderStepper, doInvestigate } from "./investigate.js";
import { renderActionPointsPage } from "./action-points.js";
import { renderRunsPage } from "./runs.js";
import { renderApprovalsPage } from "./approvals.js";
import { renderDashboardPage } from "./dashboard.js";
import { renderTracesPage } from "./traces.js";
import { renderEvalsPage } from "./evals.js";
import { renderSettingsPage } from "./settings.js";
import {
  hasValidSession, showLoginScreen, hideLoginScreen, initLoginForm,
  currentTenantIds, currentUsername, logout, restoreBrowserSession,
} from "./auth.js";

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
  if (renderer) renderer();
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
