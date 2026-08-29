/* Human-Led Agent Lab — Action Points page: a kanban board of the action
 * points investigations have produced, grouped by real status.
 *
 * The mockup this page is built from has five columns (Drafted, Awaiting
 * Approval, Approved, Executing, Completed) and a few controls this
 * backend has no matching capability for:
 *  - "Drafted" isn't a real status (agent_lab/models.py's RunStatus) --
 *    investigations go straight to Awaiting Approval or Completed. The
 *    column stays in place but always empty, with an honest note instead
 *    of invented cards.
 *  - "+ New Action Point" (and each column's "+ Add Action Point") imply
 *    manual creation, but action points are only ever produced by an
 *    investigation. Disabled, with a tooltip explaining why.
 *  - "Move to Next Stage" implies a manual per-stage advance, but
 *    approving a run already runs it through to completion in one step
 *    (see agent_lab/workflow.py's approve_run()). Disabled, same reason.
 * Rejected/failed runs have no column in this mockup, so they simply
 * don't appear on this board -- they're still visible on Runs/Approvals.
 */
import {
  qs, qsa, escapeHtml, fmtTime, shortRunId, priorityBadge, api, showBanner,
  upsertHistory, getAllKnownRuns, deriveEvidence, formatDateInput, startOfDay,
} from "./shared.js";
import { currentTenantIds } from "./auth.js";

const COLUMN_DEFS = [
  { key: "drafted", label: "Drafted", tag: "Draft" },
  { key: "awaiting_approval", label: "Awaiting Approval", tag: "Requires approval" },
  { key: "approved", label: "Approved", tag: "Approved" },
  { key: "executing", label: "Executing", tag: "In Progress" },
  { key: "completed", label: "Completed", tag: "Completed" },
];

const apState = {
  runs: [],
  search: "",
  tenant: "all",
  status: "all",
  priority: "all",
  dateFrom: "",
  dateTo: "",
  selectedRunId: null,
};

let apDatePicker = null;
let apWired = false;

function initDatePicker() {
  if (apDatePicker) return;
  const clearBtn = qs("#ap-date-clear");
  apDatePicker = flatpickr("#ap-date-range", {
    mode: "range",
    dateFormat: "Y-m-d",
    altInput: true,
    altFormat: "M j, Y",
    locale: { rangeSeparator: " – " },
    onChange: (selectedDates) => {
      if (selectedDates.length === 2) {
        apState.dateFrom = formatDateInput(selectedDates[0]);
        apState.dateTo = formatDateInput(selectedDates[1]);
      } else if (selectedDates.length === 0) {
        apState.dateFrom = "";
        apState.dateTo = "";
      } else {
        return;
      }
      clearBtn.hidden = !(apState.dateFrom && apState.dateTo);
      renderActionPointsBody();
    },
  });
  clearBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    apDatePicker.clear();
    apState.dateFrom = "";
    apState.dateTo = "";
    clearBtn.hidden = true;
    renderActionPointsBody();
  });
}

function initFilters() {
  qs("#ap-tenant-filter").innerHTML =
    `<option value="all">All Tenants</option>` +
    currentTenantIds().map((t) => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join("");

  qs("#ap-search").addEventListener("input", (e) => { apState.search = e.target.value.trim().toLowerCase(); renderActionPointsBody(); });
  qs("#ap-tenant-filter").addEventListener("change", (e) => { apState.tenant = e.target.value; renderActionPointsBody(); });
  qs("#ap-status-filter").addEventListener("change", (e) => { apState.status = e.target.value; renderActionPointsBody(); });
  qs("#ap-priority-filter").addEventListener("change", (e) => { apState.priority = e.target.value; renderActionPointsBody(); });
  qs("#ap-refresh-btn").addEventListener("click", async () => {
    apState.runs = await getAllKnownRuns();
    renderActionPointsBody();
  });
}

function trendHtml(current, previous, label) {
  if (previous === 0 && current === 0) return `<span class="stat-trend flat">No data yet</span>`;
  if (previous === 0) return `<span class="stat-trend flat">No prior data to compare</span>`;
  const pct = ((current - previous) / previous) * 100;
  const dir = pct >= 0 ? "up" : "down";
  const arrow = pct >= 0 ? "↗" : "↘";
  return `<span class="stat-trend ${dir}">${arrow} ${Math.abs(pct).toFixed(1)}% ${label}</span>`;
}

function computeActionPointStats(runs) {
  const withActionPoint = runs.filter((r) => r.action_point);
  const now = Date.now();
  const last7Start = now - 7 * 86400000;
  const prev7Start = now - 14 * 86400000;
  const createdAt = (r) => (r.created_at ? new Date(r.created_at).getTime() : null);
  const inLast7 = (list) => list.filter((r) => createdAt(r) >= last7Start).length;
  const inPrev7 = (list) => list.filter((r) => createdAt(r) >= prev7Start && createdAt(r) < last7Start).length;

  const awaiting = withActionPoint.filter((r) => r.status === "awaiting_approval");
  const inProgress = withActionPoint.filter((r) => r.status === "approved" || r.status === "executing");

  const todayStart = startOfDay(now);
  const yesterdayStart = todayStart - 86400000;
  const updatedAt = (r) => (r.updated_at ? new Date(r.updated_at).getTime() : null);
  const isCompleted = (r) => r.status === "completed";
  const completedToday = withActionPoint.filter((r) => isCompleted(r) && updatedAt(r) >= todayStart).length;
  const completedYesterday = withActionPoint.filter((r) => isCompleted(r) && updatedAt(r) >= yesterdayStart && updatedAt(r) < todayStart).length;

  return {
    total: withActionPoint.length, totalLast7: inLast7(withActionPoint), totalPrev7: inPrev7(withActionPoint),
    awaiting: awaiting.length, awaitingLast7: inLast7(awaiting), awaitingPrev7: inPrev7(awaiting),
    inProgress: inProgress.length, inProgressLast7: inLast7(inProgress), inProgressPrev7: inPrev7(inProgress),
    completedToday, completedYesterday,
  };
}

function renderActionPointStats(runs) {
  const s = computeActionPointStats(runs);
  qs("#action-points-stats").innerHTML = `
    <div class="stat-card">
      <div class="stat-icon blue"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M9 9h6M9 13h6M9 17h3"/></svg></div>
      <div class="stat-body">
        <div class="stat-label">Total Action Points</div>
        <div class="stat-value">${s.total.toLocaleString()}</div>
        ${trendHtml(s.totalLast7, s.totalPrev7, "vs last 7 days")}
      </div>
    </div>
    <div class="stat-card">
      <div class="stat-icon orange"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg></div>
      <div class="stat-body">
        <div class="stat-label">Awaiting Approval</div>
        <div class="stat-value">${s.awaiting}</div>
        ${trendHtml(s.awaitingLast7, s.awaitingPrev7, "vs last 7 days")}
      </div>
    </div>
    <div class="stat-card">
      <div class="stat-icon purple"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v4"/><path d="m5.6 5.6 2.8 2.8"/><path d="m18.4 5.6-2.8 2.8"/><circle cx="12" cy="15" r="6"/></svg></div>
      <div class="stat-body">
        <div class="stat-label">In Progress</div>
        <div class="stat-value">${s.inProgress}</div>
        ${trendHtml(s.inProgressLast7, s.inProgressPrev7, "vs last 7 days")}
      </div>
    </div>
    <div class="stat-card">
      <div class="stat-icon green"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="m8.5 12 2.5 2.5 4.5-5"/></svg></div>
      <div class="stat-body">
        <div class="stat-label">Completed Today</div>
        <div class="stat-value">${s.completedToday}</div>
        ${trendHtml(s.completedToday, s.completedYesterday, "vs yesterday")}
      </div>
    </div>
  `;
}

function passesFilters(run) {
  const st = apState;
  if (st.tenant !== "all" && run.tenant_id !== st.tenant) return false;
  if (st.status !== "all" && run.status !== st.status) return false;
  const ap = run.action_point;
  if (st.priority !== "all" && (!ap || ap.priority !== st.priority)) return false;
  if (st.search) {
    const haystack = `${ap ? ap.title : ""} ${ap ? ap.summary : ""} ${run.issue || ""}`.toLowerCase();
    if (!haystack.includes(st.search)) return false;
  }
  if (st.dateFrom && st.dateTo) {
    const created = run.created_at ? new Date(run.created_at).getTime() : null;
    const from = new Date(st.dateFrom).getTime();
    const to = new Date(st.dateTo).getTime() + 86400000;
    if (created === null || created < from || created >= to) return false;
  }
  return true;
}

function groupByColumn(runs) {
  const groups = { drafted: [], awaiting_approval: [], approved: [], executing: [], completed: [] };
  runs.filter((r) => r.action_point).filter(passesFilters).forEach((r) => {
    if (groups[r.status]) groups[r.status].push(r);
  });
  return groups;
}

function renderActionPointCard(run, columnTag) {
  const ap = run.action_point;
  return `
    <div class="kanban-card" data-run-id="${escapeHtml(run.run_id)}">
      <div class="kanban-card-title">${escapeHtml(ap.title)}</div>
      <div class="kanban-card-meta">${priorityBadge(ap.priority)} <span class="badge badge-confidence">Conf: ${ap.confidence.toFixed(2)}</span></div>
      <div class="kanban-card-meta">Tenant: ${escapeHtml(run.tenant_id)}</div>
      <div class="kanban-card-meta">Run: ${escapeHtml(shortRunId(run.run_id))}</div>
      <div class="kanban-card-meta">Created: ${fmtTime(run.created_at)}</div>
      <div class="kanban-card-tags">
        <span class="pill-tag">${escapeHtml(columnTag)}</span>
        <span class="pill-tag">${escapeHtml(ap.issue_type)}</span>
      </div>
    </div>
  `;
}

function renderKanbanBoard(runs) {
  const groups = groupByColumn(runs);
  qs("#kanban-board").innerHTML = COLUMN_DEFS.map((col) => {
    const items = groups[col.key];
    const body = col.key === "drafted"
      ? `<p class="empty-note">This system doesn't have a separate drafting stage — investigations go straight to Awaiting Approval or Completed.</p>`
      : items.length
        ? `<div class="kanban-card-list">${items.map((r) => renderActionPointCard(r, col.tag)).join("")}</div>`
        : `<p class="empty-note">No action points here.</p>`;
    return `
      <div class="kanban-column">
        <div class="kanban-column-head"><span>${escapeHtml(col.label)}</span><span class="kanban-column-count">${items.length}</span></div>
        ${body}
        <button class="btn btn-outline kanban-add-btn" disabled title="Action points are only created by an investigation, never added manually.">+ Add Action Point</button>
      </div>
    `;
  }).join("");

  qsa("[data-run-id]", qs("#kanban-board")).forEach((card) => {
    card.addEventListener("click", () => {
      apState.selectedRunId = card.dataset.runId;
      renderDetailPanel();
    });
  });
}

async function submitApprove(runId) {
  const btn = qs("#action-point-approve-btn");
  if (btn) btn.disabled = true;
  try {
    const run = await api(`/runs/${runId}/approve`, { method: "POST", body: JSON.stringify({ comment: null }) });
    upsertHistory(run);
    apState.runs = await getAllKnownRuns();
    renderActionPointsBody();
  } catch (err) {
    showBanner(`Approval failed: ${err.message}`);
    if (btn) btn.disabled = false;
  }
}

function renderDetailPanel() {
  const grid = qs("#action-points-grid");
  const card = qs("#action-point-detail-card");
  const run = apState.runs.find((r) => r.run_id === apState.selectedRunId);

  if (!run || !run.action_point) {
    card.hidden = true;
    grid.classList.remove("has-detail");
    return;
  }

  card.hidden = false;
  grid.classList.add("has-detail");

  const ap = run.action_point;
  const evidence = deriveEvidence(run);
  const isPending = run.status === "awaiting_approval";

  card.innerHTML = `
    <div class="detail-head">
      <div>
        <p class="reviewing-label">${isPending ? "Reviewing" : "Viewing"}</p>
        <h2 class="reviewing-id">${escapeHtml(ap.title)}</h2>
      </div>
      <button class="detail-close-btn" id="action-point-detail-close">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="M6 6l12 12"/></svg>
      </button>
    </div>

    <div class="detail-section" style="margin-top:14px;">
      <div class="ap-grid" style="margin-bottom:0;">
        <div class="ap-field full"><span class="label">Summary</span><span class="value">${escapeHtml(ap.summary)}</span></div>
        <div class="ap-field full"><span class="label">Recommended Action</span><span class="value">${escapeHtml(ap.recommended_action)}</span></div>
        <div class="ap-field"><span class="label">Target Team</span><span class="value">${escapeHtml(ap.target_team || "—")}</span></div>
        <div class="ap-field"><span class="label">Confidence</span><span class="value"><span class="badge badge-confidence">${ap.confidence.toFixed(2)}</span></span></div>
        <div class="ap-field"><span class="label">Requires Human Approval</span><span class="value"><span class="badge ${ap.requires_human_approval ? "badge-yes" : "badge-no"}">${ap.requires_human_approval ? "Yes" : "No"}</span></span></div>
        <div class="ap-field"><span class="label">Priority</span><span class="value">${priorityBadge(ap.priority)}</span></div>
        <div class="ap-field"><span class="label">Tenant</span><span class="value">${escapeHtml(run.tenant_id)}</span></div>
        <div class="ap-field"><span class="label">Created</span><span class="value">${fmtTime(run.created_at)}</span></div>
        <div class="ap-field"><span class="label">Run ID</span><span class="value">${escapeHtml(shortRunId(run.run_id))}</span></div>
      </div>
    </div>

    <div class="detail-section">
      <div class="detail-section-title">Evidence</div>
      ${evidence.length
        ? `<ul class="evidence-list">${evidence.map((b) => `<li>${escapeHtml(b)}</li>`).join("")}</ul>`
        : `<p class="empty-note" style="margin:0;">No MCP tool evidence recorded for this run yet.</p>`}
    </div>

    <div class="detail-section ap-outline-actions">
      <button class="btn btn-outline-success" id="action-point-approve-btn" ${isPending ? "" : "disabled"} ${isPending ? "" : 'title="Only runs awaiting approval can be approved."'}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
        <span>Approve</span>
      </button>
      <button class="btn btn-outline" id="action-point-next-stage-btn" disabled title="Approving a run already runs it to completion in one step — there's no separate manual stage-advance action.">
        <span>Move to Next Stage</span>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m13 6 6 6-6 6"/></svg>
      </button>
    </div>
  `;

  qs("#action-point-detail-close").addEventListener("click", () => {
    apState.selectedRunId = null;
    renderDetailPanel();
  });
  if (isPending) {
    qs("#action-point-approve-btn").addEventListener("click", () => submitApprove(run.run_id));
  }
}

function renderActionPointsBody() {
  renderActionPointStats(apState.runs);
  renderKanbanBoard(apState.runs);
  renderDetailPanel();
}

export async function renderActionPointsPage() {
  if (!apWired) {
    initFilters();
    initDatePicker();
    apWired = true;
  }
  apState.runs = await getAllKnownRuns();
  renderActionPointsBody();
}
