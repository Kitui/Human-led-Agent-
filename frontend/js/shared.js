/* Human-Led Agent Lab — shared utilities
 *
 * DOM helpers, formatting, badges, the fetch wrapper, the local run-history
 * cache, and other state used by more than one page module. Page-specific
 * code lives in investigate.js / runs.js / approvals.js / dashboard.js /
 * traces.js / evals.js; main.js wires up routing and boot.
 *
 * Assumes this file is served from the same origin as the FastAPI app
 * (see backend proposal: mounting /frontend as static files). If you're
 * opening index.html directly during development, set window.API_BASE
 * before this script loads, e.g. via a <script>window.API_BASE="http://127.0.0.1:8000"</script>
 * tag — that will hit CORS unless the backend change adding CORS/static
 * hosting has been applied.
 */
export const API_BASE = window.API_BASE || "";
const HISTORY_KEY = "hlal_runs_history";

export const STATUS_COLORS = {
  new: "#9CA3AF",
  investigating: "#60A5FA",
  awaiting_approval: "#F59E0B",
  approved: "#F59E0B",
  executing: "#F59E0B",
  completed: "#16A34A",
  rejected: "#DC2626",
  failed: "#6B7280",
};

export const AGENT_NAME = "Operations Investigator"; // agent_lab/agent.py: investigator_agent.name

/* ---------------- dom ---------------- */
export function qs(sel, root) { return (root || document).querySelector(sel); }
export function qsa(sel, root) { return Array.from((root || document).querySelectorAll(sel)); }

/* ---------------- formatting ---------------- */
export function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}

export function fmtTime(ts) {
  const d = ts instanceof Date ? ts : new Date(ts);
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function shortRunId(runId) {
  if (!runId) return "";
  return "run_" + runId.replace(/-/g, "").slice(0, 8);
}

export function fmtDuration(seconds) {
  if (typeof seconds !== "number") return "—";
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

export function titleCase(s) {
  return String(s || "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function slugify(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
}

export function startOfDay(ts) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function formatDateInput(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function cssVar(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

export function deltaFromYesterdayHtml(today, yesterday, formatValue) {
  if (yesterday === null || yesterday === undefined) {
    return `<span class="stat-trend flat">No prior data</span>`;
  }
  const diff = today - yesterday;
  const dir = diff > 0 ? "up" : diff < 0 ? "down" : "flat";
  const sign = diff > 0 ? "+" : diff < 0 ? "-" : "";
  return `<span class="stat-trend ${dir}">${sign}${formatValue(Math.abs(diff))} from yesterday</span>`;
}

/* ---------------- badges / icons ---------------- */
export function priorityBadge(priority) {
  if (!priority) return "";
  const cls = { low: "badge-low", medium: "badge-medium", high: "badge-high", critical: "badge-critical" }[priority] || "badge-medium";
  return `<span class="badge ${cls}">${escapeHtml(priority[0].toUpperCase() + priority.slice(1))}</span>`;
}

export function statusBadge(status) {
  const s = (status || "").toLowerCase();
  return `<span class="badge badge-status-${s}">${escapeHtml((status || "").toUpperCase())}</span>`;
}

export function traceIconClass(kind) {
  return { guardrail: "success", mcp: "", execution: "warn", error: "danger", client: "" }[kind] || "";
}
export function traceIconSvg(kind) {
  const icons = {
    guardrail: '<path d="M12 3 5 6v5c0 4.5 3 8 7 9 4-1 7-4.5 7-9V6l-7-3Z"/><path d="m9.5 12 2 2 3.5-3.5"/>',
    mcp: '<path d="M9 2v6M15 2v6M9 22v-6M15 22v-6"/><rect x="6" y="8" width="12" height="8" rx="2"/>',
    execution: '<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3"/>',
    error: '<circle cx="12" cy="12" r="9"/><path d="M12 8v5"/><path d="M12 16h.01"/>',
    client: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
  };
  return icons[kind] || icons.client;
}

/* ---------------- network ---------------- */
export async function api(path, opts) {
  const res = await fetch(API_BASE + path, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  let body = null;
  try { body = await res.json(); } catch (_) { /* no body */ }
  if (!res.ok) {
    const detail = body && body.detail ? body.detail : res.statusText;
    const err = new Error(detail);
    err.status = res.status;
    throw err;
  }
  return body;
}

export let apiVersion = null;

export async function checkHealth() {
  const dotEl = qs("#api-status");
  const textEl = qs("#api-status-text");
  try {
    const body = await api("/health");
    if (body && body.version) apiVersion = body.version;
    dotEl.classList.remove("offline");
    textEl.textContent = "API Connected";
  } catch (_) {
    dotEl.classList.add("offline");
    textEl.textContent = "API Offline";
  }
}

/* ---------------- UI helpers ---------------- */
export function showBanner(message) {
  const el = qs("#banner");
  el.textContent = message;
  el.classList.remove("hidden");
  clearTimeout(showBanner._t);
  showBanner._t = setTimeout(() => el.classList.add("hidden"), 6000);
}

/* Floating-card confirmation dialog — replaces window.confirm() so the
 * prompt matches the app's design instead of the browser's native chrome. */
export function showConfirmModal(message, opts) {
  opts = opts || {};
  const okLabel = opts.okLabel || "OK";
  const cancelLabel = opts.cancelLabel || "Cancel";

  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML = `
      <div class="modal-card">
        ${opts.title ? `<h3 class="modal-title">${escapeHtml(opts.title)}</h3>` : ""}
        <p class="modal-message">${escapeHtml(message)}</p>
        <div class="modal-actions">
          <button class="btn btn-outline" id="modal-cancel-btn">${escapeHtml(cancelLabel)}</button>
          <button class="btn btn-primary" id="modal-ok-btn">${escapeHtml(okLabel)}</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    qs("#modal-ok-btn", overlay).focus();

    function escHandler(e) {
      if (e.key === "Escape") settle(false);
    }
    function settle(result) {
      document.removeEventListener("keydown", escHandler);
      overlay.remove();
      resolve(result);
    }

    qs("#modal-cancel-btn", overlay).addEventListener("click", () => settle(false));
    qs("#modal-ok-btn", overlay).addEventListener("click", () => settle(true));
    overlay.addEventListener("click", (e) => { if (e.target === overlay) settle(false); });
    document.addEventListener("keydown", escHandler);
  });
}

/* ---------------- local run history (client-side cache) ----------------
 * The backend does not yet expose a "list all runs" endpoint, so Recent
 * Runs / Runs / Approvals / Dashboard are populated from a local cache of
 * runs this browser has seen, persisted to localStorage. If a GET /runs
 * endpoint becomes available (see backend proposal), it is preferred and
 * used to refresh this cache automatically.
 */
export function loadHistory() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY)) || []; }
  catch (_) { return []; }
}
export function saveHistory(list) {
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(list)); } catch (_) { /* ignore quota errors */ }
}
export function upsertHistory(run) {
  const list = loadHistory();
  const now = Date.now();
  const idx = list.findIndex((r) => r.run_id === run.run_id);
  if (idx === -1) {
    list.unshift({ ...run, _createdAt: now, _updatedAt: now, _clientTrace: run._clientTrace || [] });
  } else {
    list[idx] = { ...list[idx], ...run, _updatedAt: now, _clientTrace: run._clientTrace || list[idx]._clientTrace || [] };
    list.unshift(list.splice(idx, 1)[0]);
  }
  saveHistory(list);
  return list;
}
export function addClientTraceEvent(runId, event) {
  const list = loadHistory();
  const idx = list.findIndex((r) => r.run_id === runId);
  if (idx === -1) return;
  list[idx]._clientTrace = list[idx]._clientTrace || [];
  list[idx]._clientTrace.push({ ...event, timestamp: Date.now() });
  list[idx]._updatedAt = Date.now();
  saveHistory(list);
}

export async function fetchRunsList() {
  try {
    const runs = await api("/runs");
    if (Array.isArray(runs)) return runs;
    return null;
  } catch (_) {
    return null; // endpoint not available yet — caller falls back to local history
  }
}

export async function getAllKnownRuns() {
  const remote = await fetchRunsList();
  if (remote) {
    remote.forEach((r) => upsertHistory(r));
  }
  return loadHistory();
}

/* ---------------- shared runs-table link binding ----------------
 * Several pages render a table of runs with a clickable run-id link.
 * Callers pass in what "opening" a run means for them (normally
 * openRunInInvestigate from investigate.js) to avoid a circular import
 * between this module and the page modules.
 */
export function bindRunLinks(container, onOpen) {
  qsa(".run-id-link", container).forEach((a) => {
    a.addEventListener("click", () => onOpen(a.dataset.runId));
  });
}

/* ---------------- cross-page navigation flag ----------------
 * Runs page's "View Trace" quick action jumps to the Traces page and
 * should land on that specific run. Exposed as functions (not a plain
 * exported `let`) since ES module bindings are read-only from importing
 * modules — only this module may reassign the underlying variable.
 */
let pendingTraceRunId = null;
export function setPendingTraceRunId(runId) {
  pendingTraceRunId = runId;
}
export function consumePendingTraceRunId() {
  const id = pendingTraceRunId;
  pendingTraceRunId = null;
  return id;
}
