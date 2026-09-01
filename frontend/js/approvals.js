/* Human-Led Agent Lab — Approvals page
 *
 * Every stat, table field, and detail-panel field below is computed from
 * real run/trace data. Two things the reference design showed have no real
 * backing in this codebase and were deliberately NOT faked:
 *  - "Requested By Agent" varying per row implies multiple specialized
 *    agents. This system has exactly one investigator agent
 *    (see agent_lab/agent.py), so the "Agent" column shows its real,
 *    constant name rather than invented per-row agent names.
 *  - "Risk Notes" (e.g. "Low risk, contained to one line item") has no
 *    corresponding field anywhere — it's omitted rather than fabricated.
 *    "Evidence" is instead derived from the run's real MCP tool-call
 *    results (trace events), not fabricated reference numbers.
 */
import {
  qs, qsa, escapeHtml, fmtTime, shortRunId, priorityBadge, statusBadge,
  AGENT_NAME, startOfDay, fmtDuration, deltaFromYesterdayHtml, api,
  showBanner, upsertHistory, getAllKnownRuns,
} from "./shared.js";

const approvalsPageState = {
  runs: [],
  search: "",
  priority: "all",
  sortDir: "desc",
  page: 1,
  pageSize: 10,
  selectedRunId: null,
};

function findTraceEvent(run, labelPredicate) {
  return (run.trace || []).find((e) => labelPredicate(e.label));
}

/* Evidence for a human decision must stay separate from the later execution
 * result. WebMCP-submitted runs attach explicit EVIDENCE-tagged Support/CRM/
 * Billing findings. Older investigator runs still expose their read-tool
 * results as "... result received" trace events. Write-tool results are
 * deliberately excluded here and remain in the Decision / execution section. */
function deriveApprovalEvidence(run) {
  const bullets = [];

  (run.trace || []).forEach((event) => {
    if (event.tag === "EVIDENCE" && event.detail) {
      const match = /^WebMCP (support|crm|billing) evidence attached$/.exec(event.label || "");
      const source = match ? match[1].toUpperCase() : "SOURCE";
      bullets.push(`${source}: ${event.detail}`);
      return;
    }

    if (event.kind !== "mcp" || !event.detail || !/result received/.test(event.label || "")) return;

    const sourceLabel = (event.label || "").replace(" result received", "");
    try {
      const parsed = JSON.parse(event.detail);
      if (parsed.created || parsed.updated) return; // execution outcome, not decision evidence
      if (parsed.found && parsed.customer) {
        const c = parsed.customer;
        bullets.push(
          `${sourceLabel}: ${c.name} — ${c.plan} plan, account ${c.account_status}, billing ${c.billing_status}, renewal ${c.renewal_status}` +
          (c.renewal_value != null ? ` ($${Number(c.renewal_value).toLocaleString()})` : "")
        );
      } else if (parsed.found && parsed.case) {
        const c = parsed.case;
        bullets.push(`${sourceLabel}: ${c.case_id} — ${c.subject || c.customer_message || c.status}`);
      } else if (parsed.found && parsed.invoice) {
        const i = parsed.invoice;
        bullets.push(`${sourceLabel}: ${i.invoice_id} — billed ${i.currency || ""} ${Number(i.billed_amount).toLocaleString()} vs contract ${Number(i.contract_amount).toLocaleString()}, dispute ${i.dispute_status}`);
      } else if (parsed.error) {
        bullets.push(`${sourceLabel}: ${parsed.error}`);
      }
    } catch (_) {
      bullets.push(`${sourceLabel}: ${event.detail.slice(0, 140)}`);
    }
  });

  return bullets;
}

function decisionKind(run) {
  if (findTraceEvent(run, (l) => l === "Execution approved by human reviewer")) return "approved";
  if (findTraceEvent(run, (l) => l === "Rejected by human reviewer")) return "rejected";
  return null;
}
function decisionTimestamp(run) {
  const e = findTraceEvent(run, (l) => l === "Execution approved by human reviewer" || l === "Rejected by human reviewer");
  return e ? new Date(e.timestamp).getTime() : null;
}
function reviewTimeSeconds(run) {
  const generated = findTraceEvent(run, (l) => l === "Action point generated" || l === "WebMCP Action Point submitted");
  const decided = findTraceEvent(run, (l) => l === "Execution approved by human reviewer" || l === "Rejected by human reviewer");
  if (!generated || !decided) return null;
  return (new Date(decided.timestamp) - new Date(generated.timestamp)) / 1000;
}

function computeApprovalsStats(runs) {
  const pending = runs.filter((r) => (r.status || "").toLowerCase() === "awaiting_approval").length;

  const todayStart = startOfDay(Date.now());
  const yesterdayStart = todayStart - 86400000;

  let approvedToday = 0, approvedYesterday = 0, rejectedToday = 0, rejectedYesterday = 0;
  const reviewTimesToday = [], reviewTimesYesterday = [];

  runs.forEach((r) => {
    const kind = decisionKind(r);
    const ts = decisionTimestamp(r);
    if (!kind || ts === null) return;

    const inToday = ts >= todayStart;
    const inYesterday = ts >= yesterdayStart && ts < todayStart;
    if (kind === "approved") {
      if (inToday) approvedToday++;
      if (inYesterday) approvedYesterday++;
    } else {
      if (inToday) rejectedToday++;
      if (inYesterday) rejectedYesterday++;
    }
    const rt = reviewTimeSeconds(r);
    if (rt !== null) {
      if (inToday) reviewTimesToday.push(rt);
      if (inYesterday) reviewTimesYesterday.push(rt);
    }
  });

  const avg = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);
  return {
    pending,
    approvedToday, approvedYesterday,
    rejectedToday, rejectedYesterday,
    avgReviewToday: avg(reviewTimesToday),
    avgReviewYesterday: avg(reviewTimesYesterday),
  };
}

function renderApprovalsStats(runs) {
  const s = computeApprovalsStats(runs);
  qs("#approvals-stats").innerHTML = `
    <div class="stat-card">
      <div class="stat-icon blue"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg></div>
      <div class="stat-body">
        <div class="stat-label">Pending Approvals</div>
        <div class="stat-value">${s.pending}</div>
        <span class="stat-trend flat">Live count</span>
      </div>
    </div>
    <div class="stat-card">
      <div class="stat-icon green"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="m8.5 12 2.5 2.5 4.5-5"/></svg></div>
      <div class="stat-body">
        <div class="stat-label">Approved Today</div>
        <div class="stat-value">${s.approvedToday}</div>
        ${deltaFromYesterdayHtml(s.approvedToday, s.approvedYesterday, (n) => String(n))}
      </div>
    </div>
    <div class="stat-card">
      <div class="stat-icon" style="background:var(--danger-bg);color:var(--danger);"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/></svg></div>
      <div class="stat-body">
        <div class="stat-label">Rejected Today</div>
        <div class="stat-value">${s.rejectedToday}</div>
        ${deltaFromYesterdayHtml(s.rejectedToday, s.rejectedYesterday, (n) => String(n))}
      </div>
    </div>
    <div class="stat-card">
      <div class="stat-icon purple"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg></div>
      <div class="stat-body">
        <div class="stat-label">Avg Review Time</div>
        <div class="stat-value">${s.avgReviewToday !== null ? fmtDuration(s.avgReviewToday) : "—"}</div>
        ${s.avgReviewToday !== null
          ? deltaFromYesterdayHtml(s.avgReviewToday, s.avgReviewYesterday, (n) => fmtDuration(n))
          : `<span class="stat-trend flat">No decisions reviewed today yet</span>`}
      </div>
    </div>
  `;
}

const APPROVAL_RELEVANT_STATUSES = ["awaiting_approval", "approved", "completed", "rejected", "failed"];

function approvalStatusBadge(run) {
  const s = (run.status || "").toLowerCase();
  if (s === "awaiting_approval") return `<span class="badge badge-pending">PENDING</span>`;
  if (s === "approved") return `<span class="badge badge-status-completed">APPROVED</span>`;
  if (s === "completed") return `<span class="badge badge-status-completed">APPROVED</span>`;
  if (s === "rejected") return `<span class="badge badge-status-rejected">REJECTED</span>`;
  if (s === "failed") return `<span class="badge badge-status-failed">FAILED</span>`;
  return statusBadge(run.status);
}

function approvedExecution(ap) {
  return ap?.execution || { type: "create_task" };
}

function executionScopeLabel(ap) {
  const execution = approvedExecution(ap);
  if (execution.type === "update_crm_status") {
    return `renewal_status: ${execution.crm_expected_status || "—"} → ${execution.crm_target_status || "—"}`;
  }
  return "One operational task using the approved recommendation, team and priority";
}

function filteredSortedApprovals() {
  const st = approvalsPageState;
  const q = st.search.trim().toLowerCase();

  let list = st.runs.filter(
    (r) => r.action_point && r.action_point.requires_human_approval && APPROVAL_RELEVANT_STATUSES.includes((r.status || "").toLowerCase())
  );

  if (st.priority !== "all") {
    list = list.filter((r) => r.action_point && r.action_point.priority === st.priority);
  }
  if (q) {
    list = list.filter((r) => {
      const haystack = [r.run_id, r.action_point ? r.action_point.title : ""].join(" ").toLowerCase();
      return haystack.includes(q);
    });
  }

  list = list.slice().sort((a, b) => {
    const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
    const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
    return st.sortDir === "desc" ? tb - ta : ta - tb;
  });

  return list;
}

function approvalsTableHtml(pageRuns) {
  if (pageRuns.length === 0) {
    return `<p class="empty-note">No approvals to show yet.</p>`;
  }
  const st = approvalsPageState;
  const sortArrow = st.sortDir === "desc"
    ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="m19 12-7 7-7-7"/></svg>'
    : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5"/><path d="m5 12 7-7 7 7"/></svg>';

  const rows = pageRuns.map((r) => `
    <tr class="${r.run_id === st.selectedRunId ? "row-selected" : ""}" data-approval-row-id="${escapeHtml(r.run_id)}">
      <td><a class="run-id-link-plain">${escapeHtml(shortRunId(r.run_id))}</a></td>
      <td>${r.action_point ? escapeHtml(r.action_point.title) : "—"}</td>
      <td>${r.action_point ? priorityBadge(r.action_point.priority) : "—"}</td>
      <td>${escapeHtml(AGENT_NAME)}</td>
      <td>${r.created_at ? fmtTime(r.created_at) : "—"}</td>
      <td>${approvalStatusBadge(r)}</td>
    </tr>
  `).join("");

  return `
    <div class="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Run ID</th><th>Title</th><th>Priority</th><th>Agent</th>
            <th><span class="sortable-th" id="approvals-sort-created">Created At ${sortArrow}</span></th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

function renderApprovalsPagination(totalCount) {
  const st = approvalsPageState;
  const totalPages = Math.max(1, Math.ceil(totalCount / st.pageSize));
  if (st.page > totalPages) st.page = totalPages;

  const start = totalCount === 0 ? 0 : (st.page - 1) * st.pageSize + 1;
  const end = Math.min(totalCount, st.page * st.pageSize);

  let lastShown = 0;
  const pageNumbers = [];
  for (let p = 1; p <= totalPages; p++) pageNumbers.push(p);
  const visible = pageNumbers.filter((p) => p === 1 || p === totalPages || Math.abs(p - st.page) <= 1);
  const numberButtons = visible.map((p) => {
    const gap = p - lastShown > 1 ? `<span class="page-btn" style="border:none;">…</span>` : "";
    lastShown = p;
    return `${gap}<button class="page-btn ${p === st.page ? "active" : ""}" data-approvals-page="${p}">${p}</button>`;
  }).join("");

  qs("#approvals-pagination").innerHTML = `
    <div class="pagination-controls">
      <button class="page-btn" id="approvals-page-prev" ${st.page <= 1 ? "disabled" : ""}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>
      </button>
      ${numberButtons}
      <button class="page-btn" id="approvals-page-next" ${st.page >= totalPages ? "disabled" : ""}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>
      </button>
    </div>
    <span class="runs-count-label" style="margin:0;">Showing ${start} to ${end} of ${totalCount}</span>
  `;

  qs("#approvals-page-prev").addEventListener("click", () => { approvalsPageState.page--; renderApprovalsPageBody(); });
  qs("#approvals-page-next").addEventListener("click", () => { approvalsPageState.page++; renderApprovalsPageBody(); });
  qsa("[data-approvals-page]", qs("#approvals-pagination")).forEach((btn) => {
    btn.addEventListener("click", () => { approvalsPageState.page = Number(btn.dataset.approvalsPage); renderApprovalsPageBody(); });
  });
}

async function submitApprovalDecision(runId, action) {
  const commentEl = qs("#approval-comment");
  const comment = commentEl ? commentEl.value.trim() : "";
  const btnId = action === "approve" ? "#approval-approve-btn" : "#approval-reject-btn";
  const btn = qs(btnId);
  if (btn) btn.disabled = true;

  try {
    const run = await api(`/runs/${runId}/${action}`, {
      method: "POST",
      body: JSON.stringify({ comment: comment || null }),
    });
    upsertHistory(run);
    approvalsPageState.runs = await getAllKnownRuns();
    approvalsPageState.selectedRunId = runId;
    renderApprovalsPageBody();
  } catch (err) {
    showBanner(`${action === "approve" ? "Approval" : "Rejection"} failed: ${err.message}`);
    if (btn) btn.disabled = false;
  }
}

function renderApprovalDetailPanel() {
  const grid = qs("#approvals-page-grid");
  const card = qs("#approval-detail-card");
  const st = approvalsPageState;
  const run = st.runs.find((r) => r.run_id === st.selectedRunId);

  if (!run || !run.action_point) {
    card.hidden = true;
    grid.classList.remove("has-detail");
    return;
  }

  card.hidden = false;
  grid.classList.add("has-detail");

  const ap = run.action_point;
  const execution = approvedExecution(ap);
  const evidence = deriveApprovalEvidence(run);
  const status = (run.status || "").toLowerCase();
  const isPending = status === "awaiting_approval";

  const decisionEvent = findTraceEvent(run, (l) => l === "Execution approved by human reviewer" || l === "Rejected by human reviewer");
  const decisionSection = isPending
    ? `
      <div class="ap-outline-actions">
        <button class="btn btn-outline-success" id="approval-approve-btn">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
          <span>Approve exact ${escapeHtml(execution.type)}</span>
        </button>
        <button class="btn btn-outline-danger" id="approval-reject-btn">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="M6 6l12 12"/></svg>
          <span>Reject</span>
        </button>
      </div>
      <div style="margin-top:14px;">
        <label class="field-label" for="approval-comment" style="font-size:12.5px;">Add a comment (optional)</label>
        <textarea class="comment-textarea" id="approval-comment" maxlength="1000" placeholder="Enter your comment here…"></textarea>
        <div class="comment-char-count"><span id="approval-comment-count">0</span> / 1000</div>
      </div>
    `
    : `
      <div class="detail-section-title">Decision</div>
      <div class="detail-field-row"><span class="d-label">Outcome</span><span class="d-value">${approvalStatusBadge(run)}</span></div>
      <div class="detail-field-row"><span class="d-label">Decided At</span><span class="d-value">${decisionEvent ? fmtTime(decisionEvent.timestamp) : (run.updated_at ? fmtTime(run.updated_at) : "—")}</span></div>
      ${run.review_comment ? `<div class="detail-field-row"><span class="d-label">Comment</span><span class="d-value">${escapeHtml(run.review_comment)}</span></div>` : ""}
      ${status === "approved" ? `<div class="detail-field-row"><span class="d-label">Execution</span><span class="d-value">Waiting for WebMCP ${escapeHtml(execution.type)}</span></div>` : ""}
      ${status === "failed" && run.error ? `<div class="detail-field-row"><span class="d-label">Error</span><span class="d-value">${escapeHtml(run.error)}</span></div>` : ""}
      ${status === "completed" && run.execution_result ? `<div class="detail-field-row"><span class="d-label">Result</span><span class="d-value">${escapeHtml(run.execution_result)}</span></div>` : ""}
    `;

  card.innerHTML = `
    <div class="detail-head">
      <div>
        <p class="reviewing-label">${isPending ? "Reviewing" : "Viewing"}</p>
        <h2 class="reviewing-id">${escapeHtml(shortRunId(run.run_id))}</h2>
      </div>
      <div style="display:flex;align-items:center;gap:10px;">
        ${approvalStatusBadge(run)}
        <button class="detail-close-btn" id="approval-detail-close">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="M6 6l12 12"/></svg>
        </button>
      </div>
    </div>

    <div class="detail-section" style="margin-top:14px;">
      <div class="ap-grid" style="margin-bottom:0;">
        <div class="ap-field full"><span class="label">Action Point${isPending ? " (Awaiting Approval)" : ""}</span><span class="value">${escapeHtml(ap.title)}</span></div>
        <div class="ap-field full"><span class="label">Issue Type</span><span class="value">${escapeHtml(ap.issue_type)}</span></div>
        <div class="ap-field full"><span class="label">Summary</span><span class="value">${escapeHtml(ap.summary)}</span></div>
        <div class="ap-field full"><span class="label">Recommended Action</span><span class="value">${escapeHtml(ap.recommended_action)}</span></div>
        <div class="ap-field"><span class="label">Execution Capability</span><span class="value"><strong>${escapeHtml(execution.type)}</strong></span></div>
        <div class="ap-field full"><span class="label">Approved Execution Scope</span><span class="value">${escapeHtml(executionScopeLabel(ap))}</span></div>
        <div class="ap-field"><span class="label">Target Team</span><span class="value">${escapeHtml(ap.target_team || "—")}</span></div>
        <div class="ap-field"><span class="label">Confidence</span><span class="value"><span class="badge badge-confidence">${ap.confidence.toFixed(2)}</span></span></div>
        <div class="ap-field"><span class="label">Requires Human Approval</span><span class="value"><span class="badge ${ap.requires_human_approval ? "badge-yes" : "badge-no"}">${ap.requires_human_approval ? "Yes" : "No"}</span></span></div>
        <div class="ap-field"><span class="label">Priority</span><span class="value">${priorityBadge(ap.priority)}</span></div>
      </div>
    </div>

    <div class="detail-section">
      <div class="detail-section-title">Evidence</div>
      ${evidence.length
        ? `<ul class="evidence-list">${evidence.map((b) => `<li>${escapeHtml(b)}</li>`).join("")}</ul>`
        : `<p class="empty-note" style="margin:0;">No MCP tool evidence recorded for this run yet.</p>`}
    </div>

    <div class="detail-section">
      ${decisionSection}
    </div>
  `;

  qs("#approval-detail-close").addEventListener("click", () => {
    approvalsPageState.selectedRunId = null;
    renderApprovalsPageBody();
  });

  if (isPending) {
    qs("#approval-approve-btn").addEventListener("click", () => submitApprovalDecision(run.run_id, "approve"));
    qs("#approval-reject-btn").addEventListener("click", () => submitApprovalDecision(run.run_id, "reject"));

    const commentEl = qs("#approval-comment");
    const countEl = qs("#approval-comment-count");
    commentEl.addEventListener("input", () => { countEl.textContent = commentEl.value.length; });
  }
}

function selectApprovalRow(runId) {
  approvalsPageState.selectedRunId = runId === approvalsPageState.selectedRunId ? null : runId;
  renderApprovalDetailPanel();
  qsa("[data-approval-row-id]").forEach((tr) => {
    tr.classList.toggle("row-selected", tr.dataset.approvalRowId === approvalsPageState.selectedRunId);
  });
}

function renderApprovalsPageBody() {
  const filtered = filteredSortedApprovals();
  const st = approvalsPageState;
  const start = (st.page - 1) * st.pageSize;
  const pageRuns = filtered.slice(start, start + st.pageSize);

  qs("#approvals-queue-title").textContent = `Approvals Queue (${filtered.length})`;

  const container = qs("#approvals-table");
  container.innerHTML = approvalsTableHtml(pageRuns);

  const sortTh = qs("#approvals-sort-created");
  if (sortTh) sortTh.addEventListener("click", () => {
    approvalsPageState.sortDir = approvalsPageState.sortDir === "desc" ? "asc" : "desc";
    renderApprovalsPageBody();
  });

  qsa("[data-approval-row-id]", container).forEach((tr) => {
    tr.addEventListener("click", () => selectApprovalRow(tr.dataset.approvalRowId));
  });

  renderApprovalsStats(st.runs);
  renderApprovalsPagination(filtered.length);
  renderApprovalDetailPanel();
}

export async function renderApprovalsPage() {
  approvalsPageState.runs = await getAllKnownRuns();

  qs("#approvals-priority-filter").value = approvalsPageState.priority;
  qs("#approvals-priority-filter").onchange = (e) => {
    approvalsPageState.priority = e.target.value;
    approvalsPageState.page = 1;
    renderApprovalsPageBody();
  };

  qs("#approvals-search-toggle").onclick = () => {
    qs("#approvals-search-wrap").classList.toggle("hidden");
    if (!qs("#approvals-search-wrap").classList.contains("hidden")) qs("#approvals-search").focus();
  };
  qs("#approvals-search").value = approvalsPageState.search;
  qs("#approvals-search").oninput = (e) => {
    approvalsPageState.search = e.target.value;
    approvalsPageState.page = 1;
    renderApprovalsPageBody();
  };

  if (!approvalsPageState.selectedRunId) {
    const sorted = filteredSortedApprovals();
    if (sorted.length > 0) approvalsPageState.selectedRunId = sorted[0].run_id;
  }

  renderApprovalsPageBody();
}