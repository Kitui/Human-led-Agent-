/* CorrelAct — Investigate workspace */
import {
  qs, escapeHtml, fmtTime, shortRunId, priorityBadge, statusBadge,
  traceIconClass, traceIconSvg, api, showBanner, loadHistory, upsertHistory,
  addClientTraceEvent, bindRunLinks,
} from "./shared.js";

const STEP_ORDER = ["new", "investigating", "awaiting_approval", "approved", "executing", "completed"];

const STEP_META = {
  new: { label: "NEW", icon: '<rect x="6" y="6" width="12" height="14" rx="1.5"/><path d="M9 6V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1"/>' },
  investigating: { label: "INVESTIGATING", icon: '<circle cx="11" cy="11" r="6"/><path d="m20 20-3.5-3.5"/>' },
  awaiting_approval: { label: "AWAITING APPROVAL", icon: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>' },
  approved: { label: "APPROVED", icon: '<path d="M12 3 5 6v5c0 4.5 3 8 7 9 4-1 7-4.5 7-9V6l-7-3Z"/><path d="m9.5 12 2 2 3.5-3.5"/>' },
  executing: { label: "EXECUTING", icon: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82M4.68 9A1.65 1.65 0 0 0 4.35 7.18M9 4.6a1.65 1.65 0 0 0 1.51-1M15 4.6a1.65 1.65 0 0 1-1.51-1M15 19.4a1.65 1.65 0 0 1 1.82.33M9 19.4a1.65 1.65 0 0 0-1.82.33"/><path d="M3 12h1M20 12h1M12 3v1M12 20v1"/>' },
  completed: { label: "COMPLETED", icon: '<circle cx="12" cy="12" r="9"/><path d="m8.5 12 2.5 2.5 4.5-5"/>' },
};

/* ---------------- stepper ---------------- */
export function renderStepper(status) {
  const activeKey = (status || "new").toLowerCase();
  const el = qs("#stepper");
  el.innerHTML = STEP_ORDER.map((key, i) => {
    const meta = STEP_META[key];
    const active = key === activeKey;
    const connector = i < STEP_ORDER.length - 1 ? '<div class="step-connector"></div>' : "";
    return `
      <div class="step ${active ? "active" : ""}">
        <div class="step-circle"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${meta.icon}</svg></div>
        <div class="step-label">${meta.label}</div>
      </div>
      ${connector}
    `;
  }).join("");
  el.style.display = "flex";
}

/* ---------------- proposed action ---------------- */
function renderActionPoint(run) {
  const card = qs("#action-point-card");
  const ap = run.action_point;
  if (!ap) { card.hidden = true; return; }
  card.hidden = false;

  const status = (run.status || "").toLowerCase();
  qs("#action-point-heading").textContent = status === "awaiting_approval"
    ? "Proposed Action · Awaiting Approval"
    : status === "approved"
      ? "Proposed Action · Approved"
      : "Proposed Action";

  const fields = qs("#ap-fields");
  fields.innerHTML = `
    <div class="ap-field full"><span class="label">Title</span><span class="value">${escapeHtml(ap.title)}</span></div>
    <div class="ap-field full"><span class="label">Issue Type</span><span class="value">${escapeHtml(ap.issue_type)}</span></div>
    <div class="ap-field full"><span class="label">Summary</span><span class="value">${escapeHtml(ap.summary)}</span></div>
    <div class="ap-field"><span class="label">Priority</span><span class="value">${priorityBadge(ap.priority)}</span></div>
    <div class="ap-field"><span class="label">Target Team</span><span class="value">${escapeHtml(ap.target_team || "—")}</span></div>
    <div class="ap-field"><span class="label">Confidence</span><span class="value"><span class="badge badge-confidence">${ap.confidence.toFixed(2)}</span></span></div>
    <div class="ap-field"><span class="label">Requires Human Approval</span><span class="value"><span class="badge ${ap.requires_human_approval ? "badge-yes" : "badge-no"}">${ap.requires_human_approval ? "Yes" : "No"}</span></span></div>
  `;

  const actions = qs("#ap-actions");
  if (status === "awaiting_approval") {
    actions.innerHTML = `
      <button class="btn btn-success" id="approve-btn">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
        <span>Approve</span>
      </button>
      <button class="btn btn-danger" id="reject-btn">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="M6 6l12 12"/></svg>
        <span>Reject</span>
      </button>
    `;
    qs("#approve-btn").addEventListener("click", () => doApprove(run.run_id));
    qs("#reject-btn").addEventListener("click", () => doReject(run.run_id));
  } else if (status === "approved") {
    actions.innerHTML = `
      <div class="result-note">Approved by a human reviewer. No external action has executed yet.</div>
      <a class="btn btn-primary" href="/tasks/">Open Tasks Workspace</a>
    `;
  } else if (status === "completed") {
    actions.innerHTML = `<div class="result-note">${escapeHtml(run.execution_result || "No execution was required for this action.")}</div>`;
  } else if (status === "rejected") {
    actions.innerHTML = `<div class="result-note">This action was rejected. No changes were executed.</div>`;
  } else if (status === "failed") {
    actions.innerHTML = `<div class="result-note">Execution failed: ${escapeHtml(run.error || "Unknown error.")}</div>`;
  } else {
    actions.innerHTML = "";
  }
}

/* ---------------- trace timeline ---------------- */
function buildTraceEvents(run) {
  const events = [];
  (run.trace || []).forEach((e) => events.push({ ...e, source: "backend" }));
  (run._clientTrace || []).forEach((e) => events.push({ ...e, source: "client" }));
  events.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  return events;
}

function renderTraceTimeline(container, run) {
  if (!run) {
    container.innerHTML = `<p class="empty-note">Run an investigation to see trace events here.</p>`;
    return;
  }
  const events = buildTraceEvents(run);
  if (events.length === 0) {
    container.innerHTML = `<p class="empty-note">No trace events recorded yet for this run.</p>`;
    return;
  }
  container.innerHTML = events.map((e) => `
    <div class="timeline-item">
      <div class="timeline-icon ${traceIconClass(e.kind)}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${traceIconSvg(e.kind)}</svg>
      </div>
      <div class="timeline-body">
        <div class="timeline-title-row">
          <span class="timeline-title">${escapeHtml(e.label)} ${e.tag ? `<span class="pill-tag ${e.tag === "PASS" ? "pass" : e.tag === "MCP" || e.tag === "TOOL" ? "mcp" : ""}">${escapeHtml(e.tag)}</span>` : ""}</span>
          <span class="timeline-time">${fmtTime(e.timestamp)}</span>
        </div>
        ${e.detail ? `<div class="timeline-desc">${escapeHtml(e.detail)}</div>` : ""}
      </div>
    </div>
  `).join("");
}

/* ---------------- recent runs table ---------------- */
function runsTableHtml(runs, opts) {
  opts = opts || {};
  if (!runs || runs.length === 0) {
    return `<p class="empty-note">No runs yet. Investigate an issue to get started.</p>`;
  }
  const rows = runs.slice(0, opts.limit || runs.length).map((r) => `
    <tr>
      <td><a class="run-id-link" data-run-id="${escapeHtml(r.run_id)}">${escapeHtml(shortRunId(r.run_id))}</a></td>
      <td>${escapeHtml(r.tenant_id)}</td>
      <td>${statusBadge(r.status)}</td>
      <td>${r.action_point ? priorityBadge(r.action_point.priority) : "—"}</td>
      <td>${r.created_at ? fmtTime(r.created_at) : r._createdAt ? fmtTime(r._createdAt) : "—"}</td>
      <td>${r.updated_at ? fmtTime(r.updated_at) : r._updatedAt ? fmtTime(r._updatedAt) : "—"}</td>
      <td><button class="row-menu-btn" title="More">⋯</button></td>
    </tr>
  `).join("");
  return `
    <table>
      <thead><tr><th>Run ID</th><th>Tenant</th><th>Status</th><th>Priority</th><th>Created At</th><th>Updated At</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

export async function openRunInInvestigate(runId) {
  try {
    const run = await api(`/runs/${runId}`);
    upsertHistory(run);
    location.hash = "#investigate";
    applyRunToInvestigateView(run);
  } catch (err) {
    showBanner(`Could not load run: ${err.message}`);
  }
}

/* ---------------- page renderer ---------------- */
export async function renderInvestigatePage() {
  const runs = loadHistory();
  const container = qs("#recent-runs-table");
  container.innerHTML = runsTableHtml(runs, { limit: 4 });
  bindRunLinks(container, openRunInInvestigate);
}

function applyRunToInvestigateView(run) {
  renderStepper(run.status);
  renderActionPoint(run);
  renderTraceTimeline(qs("#trace-timeline"), run);
  renderInvestigatePage();
}

export async function doInvestigate() {
  const btn = qs("#investigate-btn");
  const tenantId = qs("#tenant-select-label").textContent.trim();
  const issue = qs("#issue-input").value.trim();
  if (!issue) { showBanner("Describe the issue before investigating."); return; }

  btn.disabled = true;
  const requestedAt = Date.now();
  renderStepper("investigating");
  qs("#action-point-card").hidden = true;
  qs("#trace-timeline").innerHTML = `<p class="empty-note">Investigating…</p>`;

  try {
    const run = await api("/investigate", {
      method: "POST",
      body: JSON.stringify({ tenant_id: tenantId, issue }),
    });
    run._clientTrace = [
      { kind: "client", label: "Investigation requested", detail: `Tenant: ${tenantId}`, timestamp: requestedAt },
      { kind: "client", label: `Response received — ${run.status.toUpperCase()}`, detail: run.duration_seconds ? `Completed in ${run.duration_seconds.toFixed(2)}s` : "", timestamp: Date.now() },
    ];
    upsertHistory(run);
    applyRunToInvestigateView(run);
  } catch (err) {
    renderStepper("new");
    showBanner(`Investigation failed: ${err.message}`);
  } finally {
    btn.disabled = false;
  }
}

async function doApprove(runId) {
  renderStepper("approved");
  addClientTraceEvent(runId, { kind: "client", label: "Approval submitted" });
  try {
    const run = await api(`/runs/${runId}/approve`, { method: "POST" });
    const merged = { ...loadHistory().find((r) => r.run_id === runId), ...run };
    merged._clientTrace = (merged._clientTrace || []).concat([
      {
        kind: "client",
        label: `Approval recorded — ${run.status.toUpperCase()}`,
        detail: run.status === "approved" ? "External execution has not started." : "",
        timestamp: Date.now(),
      },
    ]);
    upsertHistory(merged);
    applyRunToInvestigateView(merged);
  } catch (err) {
    renderStepper("awaiting_approval");
    showBanner(`Approval failed: ${err.message}`);
  }
}

async function doReject(runId) {
  try {
    const run = await api(`/runs/${runId}/reject`, { method: "POST" });
    addClientTraceEvent(runId, { kind: "client", label: "Rejected by human reviewer" });
    const merged = { ...loadHistory().find((r) => r.run_id === runId), ...run };
    upsertHistory(merged);
    applyRunToInvestigateView(merged);
  } catch (err) {
    showBanner(`Reject failed: ${err.message}`);
  }
}
