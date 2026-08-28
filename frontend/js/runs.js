/* Human-Led Agent Lab — Runs page: filter / sort / paginate / detail */
import {
  qs, qsa, escapeHtml, fmtTime, shortRunId, priorityBadge, statusBadge,
  titleCase, slugify, STATUS_COLORS, formatDateInput, apiVersion,
  bindRunLinks, setPendingTraceRunId, getAllKnownRuns,
} from "./shared.js";
import { openRunInInvestigate } from "./investigate.js";

const RUNS_PRIMARY_STATUSES = ["awaiting_approval", "investigating", "completed"];
const RUNS_MORE_STATUSES = ["new", "approved", "executing", "rejected", "failed"];

const runsPageState = {
  runs: [],
  search: "",
  statuses: new Set(), // empty = All
  priority: "all",
  dateFrom: "",
  dateTo: "",
  sortDir: "desc", // by created_at
  page: 1,
  pageSize: 10,
  selectedRunId: null,
};

let runsDatePicker = null;

function initRunsDatePicker() {
  // The filter bar's DOM node persists across page visits (it isn't
  // re-rendered), so only create the flatpickr instance once.
  if (runsDatePicker) return;

  const clearBtn = qs("#runs-date-clear");

  runsDatePicker = flatpickr("#runs-date-range", {
    mode: "range",
    dateFormat: "Y-m-d",
    altInput: true,
    altFormat: "M j, Y",
    locale: { rangeSeparator: " – " },
    onChange: (selectedDates) => {
      if (selectedDates.length === 2) {
        runsPageState.dateFrom = formatDateInput(selectedDates[0]);
        runsPageState.dateTo = formatDateInput(selectedDates[1]);
      } else if (selectedDates.length === 0) {
        runsPageState.dateFrom = "";
        runsPageState.dateTo = "";
      } else {
        return; // only one endpoint picked so far — wait for the range to complete
      }
      clearBtn.hidden = !(runsPageState.dateFrom && runsPageState.dateTo);
      runsPageState.page = 1;
      renderRunsPageBody();
    },
  });

  clearBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    runsDatePicker.clear();
    runsPageState.dateFrom = "";
    runsPageState.dateTo = "";
    clearBtn.hidden = true;
    runsPageState.page = 1;
    renderRunsPageBody();
  });

  // Let a click anywhere in the field (not just the exact input pixel) open the calendar.
  qs(".date-range-wrap").addEventListener("click", (e) => {
    if (e.target.closest(".date-clear-btn")) return;
    runsDatePicker.open();
  });
}

function fmtDurationHMS(seconds) {
  if (typeof seconds !== "number") return "—";
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return [h, m, s].map((n) => String(n).padStart(2, "0")).join(":");
}

function filteredSortedRuns() {
  const st = runsPageState;
  const q = st.search.trim().toLowerCase();
  const fromTs = st.dateFrom ? new Date(st.dateFrom).getTime() : null;
  const toTs = st.dateTo ? new Date(st.dateTo).getTime() + 86400000 : null; // inclusive end of day

  let runs = st.runs.filter((r) => {
    if (st.statuses.size > 0 && !st.statuses.has((r.status || "").toLowerCase())) return false;
    if (st.priority !== "all" && (!r.action_point || r.action_point.priority !== st.priority)) return false;

    const created = r.created_at ? new Date(r.created_at).getTime() : null;
    if (fromTs !== null && (created === null || created < fromTs)) return false;
    if (toTs !== null && (created === null || created >= toTs)) return false;

    if (q) {
      const haystack = [
        r.run_id,
        r.issue,
        r.action_point ? r.action_point.title : "",
      ].join(" ").toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });

  runs = runs.slice().sort((a, b) => {
    const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
    const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
    return st.sortDir === "desc" ? tb - ta : ta - tb;
  });

  return runs;
}

function renderStatusChips() {
  const container = qs("#runs-status-chips");
  const st = runsPageState;

  const primaryChips = [
    `<button class="chip ${st.statuses.size === 0 ? "active" : ""}" data-all="1">All</button>`,
    ...RUNS_PRIMARY_STATUSES.map((s) => `
      <button class="chip ${st.statuses.has(s) ? "active" : ""}" data-status="${s}">
        <span class="status-dot" style="color:${STATUS_COLORS[s] || "#9CA3AF"}"></span>${escapeHtml(titleCase(s))}
      </button>
    `),
  ].join("");

  const moreActiveCount = RUNS_MORE_STATUSES.filter((s) => st.statuses.has(s)).length;
  const moreMenu = `
    <div class="chip-more-wrap" id="runs-more-wrap">
      <button class="chip" id="runs-more-btn">+${RUNS_MORE_STATUSES.length}${moreActiveCount ? ` (${moreActiveCount})` : ""} more ▾</button>
      <div class="chip-more-menu">
        ${RUNS_MORE_STATUSES.map((s) => `
          <label><input type="checkbox" data-status-more="${s}" ${st.statuses.has(s) ? "checked" : ""}/> ${escapeHtml(titleCase(s))}</label>
        `).join("")}
      </div>
    </div>
  `;

  container.innerHTML = primaryChips + moreMenu;

  qs('[data-all="1"]', container).addEventListener("click", () => {
    st.statuses.clear();
    st.page = 1;
    renderRunsPageBody();
  });
  qsa("[data-status]", container).forEach((btn) => {
    btn.addEventListener("click", () => {
      const s = btn.dataset.status;
      if (st.statuses.has(s)) st.statuses.delete(s);
      else st.statuses.add(s);
      st.page = 1;
      renderRunsPageBody();
    });
  });
  const moreWrap = qs("#runs-more-wrap", container);
  qs("#runs-more-btn", container).addEventListener("click", (e) => {
    e.stopPropagation();
    moreWrap.classList.toggle("open");
  });
  qsa("[data-status-more]", container).forEach((cb) => {
    cb.addEventListener("change", () => {
      const s = cb.dataset.statusMore;
      if (cb.checked) st.statuses.add(s);
      else st.statuses.delete(s);
      st.page = 1;
      renderRunsPageBody();
    });
  });
  document.addEventListener("click", (e) => {
    if (!moreWrap.contains(e.target)) moreWrap.classList.remove("open");
  }, { once: true });
}

function runsFullTableHtml(pageRuns) {
  if (pageRuns.length === 0) {
    return `<p class="empty-note">No runs match these filters.</p>`;
  }
  const st = runsPageState;
  const sortArrow = st.sortDir === "desc"
    ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="m19 12-7 7-7-7"/></svg>'
    : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5"/><path d="m5 12 7-7 7 7"/></svg>';

  const rows = pageRuns.map((r) => `
    <tr class="${r.run_id === st.selectedRunId ? "row-selected" : ""}" data-row-run-id="${escapeHtml(r.run_id)}">
      <td><a class="run-id-link" data-run-id="${escapeHtml(r.run_id)}">${escapeHtml(shortRunId(r.run_id))}</a></td>
      <td>${escapeHtml(r.tenant_id)}</td>
      <td>${statusBadge(r.status)}</td>
      <td>${r.action_point ? priorityBadge(r.action_point.priority) : "—"}</td>
      <td class="issue-summary-cell">${escapeHtml(r.issue || "—")}</td>
      <td>${r.created_at ? fmtTime(r.created_at) : "—"}</td>
      <td>${r.updated_at ? fmtTime(r.updated_at) : "—"}</td>
      <td>${fmtDurationHMS(r.duration_seconds)}</td>
      <td><button class="row-menu-btn" title="More">⋯</button></td>
    </tr>
  `).join("");

  return `
    <div class="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Run ID</th><th>Tenant</th><th>Status</th><th>Priority</th><th>Issue Summary</th>
            <th><span class="sortable-th" id="runs-sort-created">Created At ${sortArrow}</span></th>
            <th>Updated At</th><th>Duration</th><th>Actions</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

function renderPagination(totalCount) {
  const st = runsPageState;
  const totalPages = Math.max(1, Math.ceil(totalCount / st.pageSize));
  if (st.page > totalPages) st.page = totalPages;

  const start = totalCount === 0 ? 0 : (st.page - 1) * st.pageSize + 1;
  const end = Math.min(totalCount, st.page * st.pageSize);
  qs("#runs-count-label").textContent = `Showing ${start}-${end} of ${totalCount} run${totalCount === 1 ? "" : "s"}`;

  const pageNumbers = [];
  for (let p = 1; p <= totalPages; p++) pageNumbers.push(p);
  const visible = pageNumbers.filter((p) => p === 1 || p === totalPages || Math.abs(p - st.page) <= 1);

  let lastShown = 0;
  const numberButtons = visible.map((p) => {
    const gap = p - lastShown > 1 ? `<span class="page-btn" style="border:none;">…</span>` : "";
    lastShown = p;
    return `${gap}<button class="page-btn ${p === st.page ? "active" : ""}" data-page="${p}">${p}</button>`;
  }).join("");

  qs("#runs-pagination").innerHTML = `
    <div class="pagination-controls">
      <button class="page-btn" id="runs-page-prev" ${st.page <= 1 ? "disabled" : ""}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>
      </button>
      ${numberButtons}
      <button class="page-btn" id="runs-page-next" ${st.page >= totalPages ? "disabled" : ""}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>
      </button>
    </div>
    <div class="rows-per-page">
      <span>Rows per page</span>
      <select id="runs-page-size">
        ${[10, 25, 50].map((n) => `<option value="${n}" ${n === st.pageSize ? "selected" : ""}>${n}</option>`).join("")}
      </select>
    </div>
  `;

  qs("#runs-page-prev").addEventListener("click", () => { runsPageState.page--; renderRunsPageBody(); });
  qs("#runs-page-next").addEventListener("click", () => { runsPageState.page++; renderRunsPageBody(); });
  qsa("[data-page]", qs("#runs-pagination")).forEach((btn) => {
    btn.addEventListener("click", () => { runsPageState.page = Number(btn.dataset.page); renderRunsPageBody(); });
  });
  qs("#runs-page-size").addEventListener("change", (e) => {
    runsPageState.pageSize = Number(e.target.value);
    runsPageState.page = 1;
    renderRunsPageBody();
  });
}

function renderRunDetailPanel() {
  const grid = qs("#runs-page-grid");
  const card = qs("#run-detail-card");
  const st = runsPageState;
  const run = st.runs.find((r) => r.run_id === st.selectedRunId);

  if (!run) {
    card.hidden = true;
    grid.classList.remove("has-detail");
    return;
  }

  card.hidden = false;
  grid.classList.add("has-detail");

  const ap = run.action_point;
  const status = (run.status || "").toLowerCase();
  const isAwaiting = status === "awaiting_approval";

  card.innerHTML = `
    <div class="detail-head">
      <h2>${escapeHtml(shortRunId(run.run_id))}</h2>
      <button class="detail-close-btn" id="detail-close-btn">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="M6 6l12 12"/></svg>
      </button>
    </div>
    <div class="detail-badges">
      ${statusBadge(run.status)}
      ${ap ? priorityBadge(ap.priority) : ""}
    </div>

    <div class="detail-section" style="margin-top:0;padding-top:0;border-top:none;">
      <div class="detail-section-title">Run Details</div>
      <div class="detail-field-row"><span class="d-label">Tenant</span><span class="d-value">${escapeHtml(run.tenant_id)}</span></div>
      <div class="detail-field-row"><span class="d-label">Workflow</span><span class="d-value" style="font-family:monospace;font-size:11.5px;">${ap ? escapeHtml(slugify(ap.title)) : "—"}</span></div>
      <div class="detail-field-row"><span class="d-label">Created At</span><span class="d-value">${run.created_at ? fmtTime(run.created_at) : "—"}</span></div>
      <div class="detail-field-row"><span class="d-label">Updated At</span><span class="d-value">${run.updated_at ? fmtTime(run.updated_at) : "—"}</span></div>
      <div class="detail-field-row"><span class="d-label">Duration</span><span class="d-value">${fmtDurationHMS(run.duration_seconds)}</span></div>
      <div class="detail-field-row"><span class="d-label">Initiated By</span><span class="d-value">API request</span></div>
      <div class="detail-field-row"><span class="d-label">Run Type</span><span class="d-value">Automated</span></div>
      <div class="detail-field-row"><span class="d-label">Run Version</span><span class="d-value">${apiVersion ? escapeHtml(apiVersion) : "—"}</span></div>
      <div class="detail-field-row"><span class="d-label">Workflow Step</span><span class="d-value">${run.step_count} / ${run.max_steps}</span></div>
      <div class="detail-field-row"><span class="d-label">Idempotency Key</span><span class="d-value" style="font-family:monospace;font-size:11.5px;">${run.idempotency_key ? escapeHtml(run.idempotency_key.slice(0, 12)) + "…" : "Not yet assigned"}</span></div>
    </div>

    <div class="detail-section">
      <div class="detail-section-title">Issue</div>
      <p class="detail-issue-text">${escapeHtml(run.issue)}</p>
      <a href="#" class="link-sm" id="detail-view-issue">View full issue
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17 17 7"/><path d="M7 7h10v10"/></svg>
      </a>
    </div>

    ${ap ? `
    <div class="detail-section">
      <div class="detail-section-title">Linked Action Point</div>
      <div class="detail-field-row"><span class="d-label">Title</span><span class="d-value">${escapeHtml(ap.title)}</span></div>
      <div class="detail-field-row"><span class="d-label">Type</span><span class="d-value">${escapeHtml(ap.issue_type)}</span></div>
      <div class="detail-field-row"><span class="d-label">Priority</span><span class="d-value">${priorityBadge(ap.priority)}</span></div>
      <div class="detail-field-row"><span class="d-label">Confidence</span><span class="d-value"><span class="badge badge-confidence">${ap.confidence.toFixed(2)}</span></span></div>
      <div class="detail-field-row"><span class="d-label">Requires Human Approval</span><span class="d-value"><span class="badge ${ap.requires_human_approval ? "badge-yes" : "badge-no"}">${ap.requires_human_approval ? "Yes" : "No"}</span></span></div>
      <a href="#" class="link-sm" id="detail-view-action-point">View action point
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17 17 7"/><path d="M7 7h10v10"/></svg>
      </a>
    </div>
    ` : ""}

    <div class="detail-section">
      <div class="detail-section-title">Quick Actions</div>
      <div class="detail-quick-actions">
        <button class="btn btn-outline" id="detail-view-trace">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="2.4"/><circle cx="6" cy="18" r="2.4"/><circle cx="18" cy="12" r="2.4"/><path d="M6 8.4V15.6"/><path d="M8.2 6.9 15.8 10.9"/><path d="M8.2 17.1 15.8 13.1"/></svg>
          <span>View Trace</span>
        </button>
        <button class="btn btn-primary" id="detail-open-approval">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="m17 11 2 2 4-4"/></svg>
          <span>${isAwaiting ? "Open Approval" : "View in Investigate"}</span>
        </button>
      </div>
    </div>
  `;

  qs("#detail-close-btn").addEventListener("click", () => {
    runsPageState.selectedRunId = null;
    renderRunsPageBody();
  });
  qs("#detail-view-issue").addEventListener("click", (e) => { e.preventDefault(); openRunInInvestigate(run.run_id); });
  const apLink = qs("#detail-view-action-point");
  if (apLink) apLink.addEventListener("click", (e) => { e.preventDefault(); openRunInInvestigate(run.run_id); });
  qs("#detail-open-approval").addEventListener("click", () => openRunInInvestigate(run.run_id));
  qs("#detail-view-trace").addEventListener("click", () => {
    setPendingTraceRunId(run.run_id);
    location.hash = "#traces";
  });
}

function selectRunRow(runId) {
  runsPageState.selectedRunId = runId === runsPageState.selectedRunId ? null : runId;
  renderRunDetailPanel();
  qsa("#runs-table-full tbody tr").forEach((tr) => {
    tr.classList.toggle("row-selected", tr.dataset.rowRunId === runsPageState.selectedRunId);
  });
}

function renderRunsPageBody() {
  const filtered = filteredSortedRuns();
  const st = runsPageState;
  const start = (st.page - 1) * st.pageSize;
  const pageRuns = filtered.slice(start, start + st.pageSize);

  const container = qs("#runs-table-full");
  container.innerHTML = runsFullTableHtml(pageRuns);
  bindRunLinks(container, openRunInInvestigate);

  const sortTh = qs("#runs-sort-created");
  if (sortTh) sortTh.addEventListener("click", () => {
    runsPageState.sortDir = runsPageState.sortDir === "desc" ? "asc" : "desc";
    renderRunsPageBody();
  });

  qsa("[data-row-run-id]", container).forEach((tr) => {
    tr.addEventListener("click", (e) => {
      if (e.target.closest(".run-id-link") || e.target.closest(".row-menu-btn")) return;
      selectRunRow(tr.dataset.rowRunId);
    });
  });

  renderPagination(filtered.length);
  renderRunDetailPanel();
}

export async function renderRunsPage() {
  runsPageState.runs = await getAllKnownRuns();
  renderStatusChips();

  qs("#runs-search").value = runsPageState.search;
  qs("#runs-search").oninput = (e) => { runsPageState.search = e.target.value; runsPageState.page = 1; renderRunsPageBody(); };

  qs("#runs-priority-filter").value = runsPageState.priority;
  qs("#runs-priority-filter").onchange = (e) => { runsPageState.priority = e.target.value; runsPageState.page = 1; renderRunsPageBody(); };

  initRunsDatePicker();

  qs("#runs-refresh-btn").onclick = async () => {
    runsPageState.runs = await getAllKnownRuns();
    renderRunsPageBody();
  };

  // Auto-select the most recent run so the detail panel is visible by
  // default, matching the reference design. Only applies on first load of
  // the page — an explicit close (X) or filter change won't be overridden.
  if (!runsPageState.selectedRunId) {
    const sorted = filteredSortedRuns();
    if (sorted.length > 0) runsPageState.selectedRunId = sorted[0].run_id;
  }

  renderRunsPageBody();
}
