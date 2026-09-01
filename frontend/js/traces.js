/* Human-Led Agent Lab — Traces page
 *
 * The Execution Timeline is built entirely from real `run.trace` events —
 * paired MCP "X called" / "X result received" events are merged into one
 * step with a real duration between them. No step exists here that this
 * codebase doesn't actually perform: there is no "Input Validation" or
 * "search_policy" or "Notify Customer" stage anywhere in agent_lab/, so
 * none appear here, unlike the reference design's mock steps. A run still
 * awaiting a decision gets two real, clearly-labeled "not yet reached"
 * placeholder steps for the deterministic remainder of its OWN pipeline
 * (human approval, then execution) — not fabricated content, just showing
 * what this run will do next if approved, mirroring the workflow stepper
 * already used elsewhere in this app.
 * "Model Calls" / "Tool Calls" / "Total Tokens" come from
 * `run.metrics`, itself populated backend-side from the agent SDK's own
 * RunResult.raw_responses / usage / new_items — see agent_lab/workflow.py.
 */
import {
  qs, qsa, escapeHtml, fmtTime, shortRunId, statusBadge, formatDateInput,
  AGENT_NAME, apiVersion, fmtDuration, api, showBanner, getAllKnownRuns,
  consumePendingTraceRunId,
} from "./shared.js";

const tracesPageState = {
  runs: [],
  search: "",
  dateFrom: "",
  dateTo: "",
  status: "all",
  selectedRunId: null,
};
let tracesDatePicker = null;

function initTracesDatePicker() {
  if (tracesDatePicker) return;
  const clearBtn = qs("#traces-date-clear");

  tracesDatePicker = flatpickr("#traces-date-range", {
    mode: "range",
    dateFormat: "Y-m-d",
    altInput: true,
    altFormat: "M j, Y",
    locale: { rangeSeparator: " – " },
    onChange: (selectedDates) => {
      if (selectedDates.length === 2) {
        tracesPageState.dateFrom = formatDateInput(selectedDates[0]);
        tracesPageState.dateTo = formatDateInput(selectedDates[1]);
      } else if (selectedDates.length === 0) {
        tracesPageState.dateFrom = "";
        tracesPageState.dateTo = "";
      } else {
        return;
      }
      clearBtn.hidden = !(tracesPageState.dateFrom && tracesPageState.dateTo);
      renderTracesList();
    },
  });

  clearBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    tracesDatePicker.clear();
    tracesPageState.dateFrom = "";
    tracesPageState.dateTo = "";
    clearBtn.hidden = true;
    renderTracesList();
  });

  qs("#traces-date-wrap").addEventListener("click", (e) => {
    if (e.target.closest(".date-clear-btn")) return;
    tracesDatePicker.open();
  });
}

function filteredTraces() {
  const st = tracesPageState;
  const q = st.search.trim().toLowerCase();
  const fromTs = st.dateFrom ? new Date(st.dateFrom).getTime() : null;
  const toTs = st.dateTo ? new Date(st.dateTo).getTime() + 86400000 : null;

  return st.runs.filter((r) => {
    if (st.status !== "all" && (r.status || "").toLowerCase() !== st.status) return false;
    const created = r.created_at ? new Date(r.created_at).getTime() : null;
    if (fromTs !== null && (created === null || created < fromTs)) return false;
    if (toTs !== null && (created === null || created >= toTs)) return false;
    if (q && !r.run_id.toLowerCase().includes(q) && !shortRunId(r.run_id).toLowerCase().includes(q)) return false;
    return true;
  }).slice().sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
}

// Classifies a real trace event into who acted on the run -- agent read,
// agent proposal, human decision, agent write, or outcome -- using only the
// event's own kind/tag/label already recorded by agent_lab. Returns null for
// anything that doesn't match a known real shape rather than guessing.
function activityRole({ kind, tag, rawLabel }) {
  if (kind === "guardrail") return { label: "SAFETY CHECK", cls: "role-safety" };
  if (tag === "MCP" || tag === "TOOL" || tag === "EVIDENCE") return { label: "AGENT READ", cls: "role-read" };
  if (tag === "HUMAN_REVIEW") return { label: "AGENT PROPOSAL", cls: "role-propose" };
  if (tag === "HUMAN_APPROVAL") return { label: "HUMAN DECISION", cls: "role-human" };
  if (rawLabel === "Rejected by human reviewer" || rawLabel === "Reviewer comment added") {
    return { label: "HUMAN DECISION", cls: "role-human" };
  }
  if (tag === "WEBMCP_WRITE") return { label: "AGENT WRITE", cls: "role-write" };
  if (tag === "EXECUTION_RESULT" || rawLabel === "Execution completed" || kind === "error") {
    return { label: "OUTCOME", cls: "role-outcome" };
  }
  return null;
}

function roleBadgeHtml(role) {
  return role ? `<span class="role-badge ${role.cls}">${escapeHtml(role.label)}</span>` : "";
}

function fmtStepDuration(ms) {
  // Sub-millisecond gaps just reflect how fast this process looped over
  // already-finished events, not a real measured duration — show "--"
  // rather than a misleadingly precise "0 ms".
  if (ms === null || ms === undefined || ms < 1) return "--";
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(2)}s`;
}

function buildExecutionSteps(run) {
  const trace = run.trace || [];
  const steps = [];
  const used = new Set();

  for (let i = 0; i < trace.length; i++) {
    if (used.has(i)) continue;
    const e = trace[i];

    if (e.kind === "mcp" && /called$/.test(e.label)) {
      const toolName = e.label.replace(/^MCP |^Tool /, "").replace(/ called$/, "");
      let resultEvent = null;
      for (let j = i + 1; j < trace.length; j++) {
        if (!used.has(j) && trace[j].label === `${toolName} result received`) {
          resultEvent = trace[j];
          used.add(j);
          break;
        }
      }
      const durationMs = resultEvent ? new Date(resultEvent.timestamp) - new Date(e.timestamp) : null;
      steps.push({
        title: e.label.replace(" called", ""),
        desc: resultEvent && resultEvent.detail ? resultEvent.detail.replace(/\s+/g, " ").slice(0, 90) : "Tool call in progress…",
        durationMs,
        state: "done",
        tag: e.tag,
        detail: resultEvent ? resultEvent.detail : null,
        kind: e.kind,
        rawLabel: e.label,
      });
      continue;
    }
    if (e.kind === "mcp") {
      if (/result received$/.test(e.label)) continue; // an unmatched result (shouldn't normally happen)
      // A standalone mcp-kind event with no "called"/"result received" pair,
      // e.g. a WebMCP evidence citation attached at proposal time -- still a
      // real event, so it gets its own step rather than being dropped.
      steps.push({
        title: e.label,
        desc: e.detail ? e.detail.replace(/\s+/g, " ").slice(0, 140) : "",
        durationMs: null,
        state: "done",
        tag: e.tag,
        detail: e.detail,
        kind: e.kind,
        rawLabel: e.label,
      });
      continue;
    }

    steps.push({
      title: e.label,
      desc: e.detail ? e.detail.replace(/\s+/g, " ").slice(0, 140) : "",
      durationMs: null,
      state: e.kind === "error" ? "error" : "done",
      tag: e.tag,
      detail: e.detail,
      kind: e.kind,
      rawLabel: e.label,
    });
  }

  const status = (run.status || "").toLowerCase();
  if (status === "awaiting_approval") {
    steps.push({ title: "Human Approval Decision", desc: "Not yet reached — waiting for a reviewer.", durationMs: null, state: "pending" });
    steps.push({ title: "Execution", desc: "Runs only after the action point is approved.", durationMs: null, state: "pending" });
  }

  return steps;
}

function execStepIconSvg(state) {
  if (state === "done") return '<path d="M20 6 9 17l-5-5"/>';
  if (state === "error") return '<path d="M18 6 6 18"/><path d="M6 6l12 12"/>';
  return null; // pending steps show their step number instead
}

function renderExecutionTimeline(run) {
  const steps = buildExecutionSteps(run);
  if (steps.length === 0) {
    return `<p class="empty-note">No trace events recorded for this run yet.</p>`;
  }
  return `
    <div class="exec-timeline">
      ${steps.map((s, i) => {
        const icon = execStepIconSvg(s.state);
        const role = activityRole(s);
        return `
        <div class="exec-step ${s.state}">
          <div class="exec-step-num">${icon ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">${icon}</svg>` : i + 1}</div>
          <div class="exec-step-body ${s.detail ? "" : "no-detail"}" data-step-idx="${i}">
            <div class="exec-step-row">
              <span class="exec-step-title">${escapeHtml(s.title)} ${roleBadgeHtml(role)} ${s.tag ? `<span class="pill-tag ${s.tag === "PASS" ? "pass" : "mcp"}">${escapeHtml(s.tag)}</span>` : ""}</span>
              <span class="exec-step-meta">
                <span class="exec-step-duration">${fmtStepDuration(s.durationMs)}</span>
                ${s.detail ? `<span class="exec-step-chevron"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg></span>` : ""}
              </span>
            </div>
            ${s.desc ? `<div class="exec-step-desc">${escapeHtml(s.desc)}</div>` : ""}
            ${s.detail ? `<div class="exec-step-detail">${escapeHtml(s.detail)}</div>` : ""}
          </div>
        </div>
      `;
      }).join("")}
    </div>
  `;
}

function highlightJson(value) {
  const str = JSON.stringify(value, null, 2);
  return escapeHtml(str).replace(
    /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\btrue\b|\bfalse\b|\bnull\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g,
    (match) => {
      let cls = "json-number";
      if (/^&quot;/.test(match)) cls = /:$/.test(match) ? "json-key" : "json-string";
      else if (/true|false/.test(match)) cls = "json-bool";
      else if (/null/.test(match)) cls = "json-null";
      return `<span class="${cls}">${match}</span>`;
    }
  );
}

async function exportRunTrace(run) {
  const blob = new Blob([JSON.stringify(run, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${shortRunId(run.run_id)}-trace.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function renderTraceDetail(run) {
  const card = qs("#trace-detail-card");
  const metrics = run.metrics || { model_calls: 0, tool_calls: 0, total_tokens: 0 };
  const totalDurationSec = run.created_at && run.updated_at
    ? (new Date(run.updated_at) - new Date(run.created_at)) / 1000
    : null;

  card.innerHTML = `
    <div class="card">
      <div class="trace-detail-header">
        <div>
          <p class="th-label">Run ID</p>
          <div class="th-runid">
            ${escapeHtml(shortRunId(run.run_id))}
            <button class="trace-copy-btn" id="trace-copy-id" title="Copy full run ID">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/></svg>
            </button>
          </div>
        </div>
        <div class="th-stat">
          <p class="th-label">Overall Status</p>
          ${statusBadge(run.status)}
        </div>
        <div class="th-stat">
          <p class="th-label">Started</p>
          <div class="th-stat-value" style="font-size:13px;">${run.created_at ? fmtTime(run.created_at) : "—"}</div>
        </div>
      </div>

      <div class="trace-stat-row" style="margin-bottom:0;padding-bottom:0;border-bottom:none;">
        <div class="th-stat">
          <p class="th-label">Total Duration</p>
          <div class="th-stat-value"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>${totalDurationSec !== null ? fmtDuration(totalDurationSec) : "—"}</div>
        </div>
        <div class="th-stat">
          <p class="th-label">Model Calls</p>
          <div class="th-stat-value">${metrics.model_calls}</div>
        </div>
        <div class="th-stat">
          <p class="th-label">Tool Calls</p>
          <div class="th-stat-value">${metrics.tool_calls}</div>
        </div>
        <div class="th-stat">
          <p class="th-label">Total Tokens</p>
          <div class="th-stat-value">${metrics.total_tokens.toLocaleString()}</div>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="timeline-card-head">
        <h3>Execution Timeline <span class="step-count-pill">${(run.trace || []).length ? buildExecutionSteps(run).length : 0} steps</span></h3>
        <button class="link-sm" id="trace-expand-all" style="background:none;border:none;cursor:pointer;">Expand all</button>
      </div>
      ${renderExecutionTimeline(run)}
    </div>

    <div class="card">
      <div class="trace-tabs">
        <button class="trace-tab-btn active" data-tab="details">Trace Details</button>
        <button class="trace-tab-btn" data-tab="json">JSON / Logs</button>
        <button class="trace-tab-btn" data-tab="metadata">Metadata</button>
      </div>

      <div class="trace-tab-panel active" data-tab-panel="details">
        ${(run.trace || []).length ? `
          <div class="table-scroll">
            <table class="trace-details-table" style="min-width:720px;">
              <thead><tr><th>Time</th><th>Role</th><th>Kind</th><th>Label</th><th>Tag</th><th>Detail</th></tr></thead>
              <tbody>
                ${run.trace.map((e) => `
                  <tr>
                    <td style="white-space:nowrap;">${fmtTime(e.timestamp)}</td>
                    <td style="white-space:nowrap;">${roleBadgeHtml(activityRole({ kind: e.kind, tag: e.tag, rawLabel: e.label }))}</td>
                    <td style="white-space:nowrap;">${escapeHtml(e.kind)}</td>
                    <td style="white-space:nowrap;">${escapeHtml(e.label)}</td>
                    <td style="white-space:nowrap;">${e.tag ? `<span class="pill-tag ${e.tag === "PASS" ? "pass" : "mcp"}">${escapeHtml(e.tag)}</span>` : ""}</td>
                    <td class="trace-detail-cell" title="${escapeHtml(e.detail || "")}">${e.detail ? escapeHtml(e.detail.slice(0, 120)) : ""}</td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
          </div>
        ` : `<p class="empty-note">No trace events recorded yet.</p>`}
      </div>

      <div class="trace-tab-panel" data-tab-panel="json">
        <div class="trace-json-toolbar">
          <button class="btn btn-outline" id="trace-copy-json" style="padding:6px 12px;font-size:12.5px;">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/></svg>
            <span>Copy JSON</span>
          </button>
        </div>
        <div class="trace-json-view">${highlightJson(run)}</div>
      </div>

      <div class="trace-tab-panel" data-tab-panel="metadata">
        <div class="trace-metadata-grid">
          <div class="detail-field-row"><span class="d-label">Run ID</span><span class="d-value" style="font-family:monospace;font-size:11.5px;">${escapeHtml(run.run_id)}</span></div>
          <div class="detail-field-row"><span class="d-label">Tenant</span><span class="d-value">${escapeHtml(run.tenant_id)}</span></div>
          <div class="detail-field-row"><span class="d-label">Agent</span><span class="d-value">${escapeHtml(AGENT_NAME)}</span></div>
          <div class="detail-field-row"><span class="d-label">API Version</span><span class="d-value">${apiVersion ? escapeHtml(apiVersion) : "—"}</span></div>
          <div class="detail-field-row"><span class="d-label">Workflow Step</span><span class="d-value">${run.step_count} / ${run.max_steps}</span></div>
          <div class="detail-field-row"><span class="d-label">Idempotency Key</span><span class="d-value" style="font-family:monospace;font-size:11.5px;">${run.idempotency_key ? escapeHtml(run.idempotency_key.slice(0, 12)) + "…" : "Not yet assigned"}</span></div>
          <div class="detail-field-row"><span class="d-label">Created At</span><span class="d-value">${run.created_at ? fmtTime(run.created_at) : "—"}</span></div>
          <div class="detail-field-row"><span class="d-label">Updated At</span><span class="d-value">${run.updated_at ? fmtTime(run.updated_at) : "—"}</span></div>
        </div>
      </div>

      <div class="trace-footer-links">
        <a href="#" class="link-sm" id="trace-view-logs">View logs
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17 17 7"/><path d="M7 7h10v10"/></svg>
        </a>
        <button class="link-sm" id="trace-download-btn" style="background:none;border:none;cursor:pointer;">Download full trace
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/></svg>
        </button>
      </div>
    </div>
  `;

  // step expand/collapse
  qsa(".exec-step-body[data-step-idx]", card).forEach((el) => {
    if (el.classList.contains("no-detail")) return;
    el.addEventListener("click", () => el.classList.toggle("expanded"));
  });
  qs("#trace-expand-all").addEventListener("click", () => {
    const bodies = qsa(".exec-step-body[data-step-idx]:not(.no-detail)", card);
    const anyCollapsed = bodies.some((b) => !b.classList.contains("expanded"));
    bodies.forEach((b) => b.classList.toggle("expanded", anyCollapsed));
    qs("#trace-expand-all").textContent = anyCollapsed ? "Collapse all" : "Expand all";
  });

  // tabs
  qsa(".trace-tab-btn", card).forEach((btn) => {
    btn.addEventListener("click", () => {
      qsa(".trace-tab-btn", card).forEach((b) => b.classList.toggle("active", b === btn));
      qsa(".trace-tab-panel", card).forEach((p) => p.classList.toggle("active", p.dataset.tabPanel === btn.dataset.tab));
    });
  });

  // copy / export actions
  qs("#trace-copy-id").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(run.run_id); showBanner("Run ID copied to clipboard."); }
    catch (_) { showBanner("Could not copy — clipboard access denied."); }
  });
  qs("#trace-copy-json").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(JSON.stringify(run, null, 2)); showBanner("Run JSON copied to clipboard."); }
    catch (_) { showBanner("Could not copy — clipboard access denied."); }
  });
  qs("#trace-view-logs").addEventListener("click", (e) => {
    e.preventDefault();
    qs('.trace-tab-btn[data-tab="json"]', card).click();
    card.scrollIntoView({ behavior: "smooth", block: "start" });
  });
  qs("#trace-download-btn").addEventListener("click", () => exportRunTrace(run));
}

function renderTracesList() {
  const list = qs("#traces-run-list");
  const filtered = filteredTraces();
  const st = tracesPageState;

  if (filtered.length === 0) {
    list.innerHTML = `<p class="empty-note">No traces match these filters.</p>`;
  } else {
    list.innerHTML = filtered.map((r) => `
      <button class="trace-run-row ${r.run_id === st.selectedRunId ? "selected" : ""}" data-trace-run-id="${escapeHtml(r.run_id)}">
        <div class="trace-run-main">
          <div class="trace-run-top">
            <span class="trace-run-id">${escapeHtml(shortRunId(r.run_id))}</span>
            ${statusBadge(r.status)}
          </div>
          <div class="trace-run-time">${r.created_at ? fmtTime(r.created_at) : "—"}</div>
          <div class="trace-run-desc">${escapeHtml((r.action_point ? r.action_point.title : r.issue || "").slice(0, 70))}</div>
        </div>
        <span class="trace-run-chevron"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg></span>
      </button>
    `).join("");
    qsa("[data-trace-run-id]", list).forEach((btn) => {
      btn.addEventListener("click", () => selectTraceRun(btn.dataset.traceRunId));
    });
  }

  qs("#traces-export-btn").disabled = !st.selectedRunId;

  // keep selection valid; auto-select the top match if nothing (valid) is selected
  const stillValid = filtered.some((r) => r.run_id === st.selectedRunId);
  if (!stillValid) {
    st.selectedRunId = filtered.length > 0 ? filtered[0].run_id : null;
    qsa("[data-trace-run-id]", list).forEach((b) => b.classList.toggle("selected", b.dataset.traceRunId === st.selectedRunId));
  }

  const card = qs("#trace-detail-card");
  const selected = st.runs.find((r) => r.run_id === st.selectedRunId);
  if (selected) {
    renderTraceDetail(selected);
  } else {
    card.innerHTML = `<div class="card"><p class="empty-note">Select a run on the left to inspect its trace.</p></div>`;
  }
}

function selectTraceRun(runId) {
  tracesPageState.selectedRunId = runId;
  renderTracesList();
}

export async function renderTracesPage() {
  tracesPageState.runs = await getAllKnownRuns();
  initTracesDatePicker();

  qs("#traces-search").value = tracesPageState.search;
  qs("#traces-search").oninput = (e) => { tracesPageState.search = e.target.value; renderTracesList(); };

  qs("#traces-status-filter").value = tracesPageState.status;
  qs("#traces-status-filter").onchange = (e) => { tracesPageState.status = e.target.value; renderTracesList(); };

  qs("#traces-view-all").onclick = (e) => {
    e.preventDefault();
    tracesPageState.search = "";
    tracesPageState.status = "all";
    tracesPageState.dateFrom = "";
    tracesPageState.dateTo = "";
    if (tracesDatePicker) tracesDatePicker.clear();
    qs("#traces-search").value = "";
    qs("#traces-status-filter").value = "all";
    qs("#traces-date-clear").hidden = true;
    renderTracesList();
  };

  qs("#traces-export-btn").onclick = () => {
    const run = tracesPageState.runs.find((r) => r.run_id === tracesPageState.selectedRunId);
    if (run) exportRunTrace(run);
  };

  const pendingRunId = consumePendingTraceRunId();
  if (pendingRunId) {
    tracesPageState.selectedRunId = pendingRunId;
  }

  renderTracesList();
}
