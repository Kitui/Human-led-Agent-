import { api, escapeHtml, fmtTime, getAuthSession, shortRunId } from "./shared.js";
import { restoreBrowserSession } from "./auth.js";
import {
  executeApprovedCrmStatus,
  executeApprovedTask,
  registerTaskWebMcpTool,
  unregisterTaskWebMcpTool,
  TASK_EXECUTED_EVENT,
} from "./webmcp/task-tools.js";

const $ = (selector) => document.querySelector(selector);

function executionType(run) {
  return run?.action_point?.execution?.type || "create_task";
}

function executionLabel(type) {
  return type === "update_crm_status" ? "CRM status update" : "Operational task";
}

function toolListLabel(tools = []) {
  if (!tools.length) return "Controlled execution";
  return tools.join(" + ");
}

function setWebMcpStatus({ supported, registered, registeredTools = [], locked = false }) {
  const el = $("#webmcp-status");
  el.classList.remove("ready", "unsupported", "locked");
  if (supported && registered) {
    el.classList.add("ready");
    el.querySelector("span:last-child").textContent = `${toolListLabel(registeredTools)} exposed · approved authority`;
    return;
  }
  if (supported && locked) {
    el.classList.add("locked");
    el.querySelector("span:last-child").textContent = "Execution locked · approval required";
    return;
  }
  el.classList.add("unsupported");
  el.querySelector("span:last-child").textContent = supported
    ? "WebMCP tool registration failed"
    : "WebMCP unavailable in this browser";
}

function setExecuteStage(label, stateClass, copy) {
  const stage = $("#authority-execute");
  stage.classList.remove("state-checking", "state-enabled", "state-locked", "state-unavailable", "state-complete");
  stage.classList.add(stateClass);
  $("#authority-execute-state").textContent = label;
  $("#authority-execute-copy").textContent = copy;
}

function renderExecutionCompleted(result) {
  const tenantId = $("#tenant-select").value || "organization";
  $("#authority-phase").textContent = "Execution completed";
  setExecuteStage(
    "COMPLETED",
    "state-complete",
    result?.execution_result || "Approved execution completed.",
  );
  $("#authority-approval").textContent = "Authority consumed for this run";
  $("#authority-scope").textContent = `${tenantId} · ${shortRunId(result?.run_id || "")}`;
  $("#authority-exposure").textContent = "The approved capability for this run is consumed. Repeating the same invocation cannot repeat the write.";
}

function renderTaskAuthority(runs, toolState) {
  const tenantId = $("#tenant-select").value || "organization";
  const registeredTools = toolState.registeredTools || [];

  if (runs.length && toolState.registered) {
    const first = runs[0];
    const customer = approvedCustomer(first) || "approved customer";
    $("#authority-phase").textContent = "Execution authority granted";
    setExecuteStage("ENABLED", "state-enabled", `Human approval verified. ${toolListLabel(registeredTools)} is exposed only for matching approved runs.`);
    $("#authority-approval").textContent = `${runs.length} executable approved run${runs.length === 1 ? "" : "s"} verified`;
    $("#authority-scope").textContent = `${tenantId} · ${customer} · ${shortRunId(first.run_id)}`;
    $("#authority-exposure").textContent = `${toolListLabel(registeredTools)} registered in this page's WebMCP context`;
    return;
  }

  if (runs.length && !toolState.supported) {
    $("#authority-phase").textContent = "Approved · browser unavailable";
    setExecuteStage("UNAVAILABLE", "state-unavailable", "Human-approved work exists, but this browser does not expose the WebMCP registration API.");
    $("#authority-approval").textContent = `${runs.length} executable approved run${runs.length === 1 ? "" : "s"} verified`;
    $("#authority-scope").textContent = `${tenantId} · approved queue ready`;
    $("#authority-exposure").textContent = "Approved write capabilities cannot be exposed in this browser";
    return;
  }

  if (runs.length && toolState.supported && !toolState.registered) {
    $("#authority-phase").textContent = "Tool registration failed";
    setExecuteStage("UNAVAILABLE", "state-unavailable", "Approval exists, but the approved write capability could not be registered in the browser context.");
    $("#authority-approval").textContent = `${runs.length} executable approved run${runs.length === 1 ? "" : "s"} verified`;
    $("#authority-scope").textContent = `${tenantId} · approved queue ready`;
    $("#authority-exposure").textContent = "Controlled execution tool registration failed";
    return;
  }

  $("#authority-phase").textContent = "Execution authority locked";
  setExecuteStage("LOCKED", "state-locked", "No executable human-approved run exists for this organization.");
  $("#authority-approval").textContent = "Waiting for an approved run";
  $("#authority-scope").textContent = `${tenantId} · no executable approved work`;
  $("#authority-exposure").textContent = "Write tools are removed from this page's WebMCP context";
}

function renderTaskAuthoritySignedOut() {
  $("#authority-phase").textContent = "Sign in required";
  setExecuteStage("LOCKED", "state-locked", "No execution authority exists without an authenticated CorrelAct session.");
  $("#authority-approval").textContent = "Authentication required";
  $("#authority-scope").textContent = "No organization scope";
  $("#authority-exposure").textContent = "Controlled write tools are not exposed";
}

function approvedCustomer(run) {
  const explicit = (run.trace || []).find(
    (item) => item.tag === "EVIDENCE"
      && ["WebMCP crm evidence attached", "CRM customer evidence attached"].includes(item.label)
      && item.detail,
  );
  if (explicit) return String(explicit.detail).split(":", 1)[0].trim();

  const legacyRead = (run.trace || []).find(
    (item) => item.label === "get_customer result received" && item.detail,
  );
  if (!legacyRead) return "";

  const detail = String(legacyRead.detail);
  try {
    const parsed = JSON.parse(detail);
    if (parsed?.found && parsed?.customer?.name) return String(parsed.customer.name).trim();
  } catch (_) {
    // Fall through to a tolerant match for old/truncated trace formats.
  }

  const match = detail.match(/["']name["']\s*:\s*["']([^"']+)["']/);
  return match ? match[1].trim() : "";
}

function runOrigin(run) {
  return (run.trace || []).some((event) => event.label === "WebMCP Action Point submitted")
    ? "WebMCP Investigation"
    : "CorrelAct Investigate";
}

function executionScopeHtml(run) {
  const type = executionType(run);
  const execution = run?.action_point?.execution;
  if (type === "update_crm_status") {
    return `
      <div class="approved-action">
        <span>Approved execution</span>
        <p><strong>update_crm_status</strong> · renewal_status: ${escapeHtml(execution?.crm_expected_status || "—")} → ${escapeHtml(execution?.crm_target_status || "—")}</p>
      </div>
    `;
  }
  return `
    <div class="approved-action">
      <span>Approved execution</span>
      <p><strong>create_task</strong> · one GitHub operational task using the approved team, priority and recommendation.</p>
    </div>
  `;
}

function showExecutionSuccess(result) {
  $("#execution-result").classList.remove("hidden", "error");
  $("#execution-result").innerHTML = `<strong>Completed</strong><span>${escapeHtml(result?.execution_result || "Approved execution completed.")}</span>`;
}

function renderRuns(runs) {
  const container = $("#approved-runs");
  if (!runs.length) {
    container.innerHTML = '<p class="empty">No approved Action Points are waiting for controlled execution.</p>';
    return;
  }

  container.innerHTML = runs.map((run) => {
    const ap = run.action_point || {};
    const customer = approvedCustomer(run) || "—";
    const type = executionType(run);
    return `
      <article class="run-card" data-run-id="${escapeHtml(run.run_id)}" data-customer="${escapeHtml(customer)}" data-execution-type="${escapeHtml(type)}">
        <div class="run-card-head">
          <div>
            <span class="run-id">${escapeHtml(shortRunId(run.run_id))}</span>
            <h3>${escapeHtml(ap.title || "Approved Action Point")}</h3>
          </div>
          <span class="approved-badge">HUMAN APPROVED</span>
        </div>
        <div class="run-meta">
          <div><span>Customer</span><strong>${escapeHtml(customer)}</strong></div>
          <div><span>Capability</span><strong>${escapeHtml(type)}</strong></div>
          <div><span>Priority</span><strong>${escapeHtml(ap.priority || "—")}</strong></div>
          <div><span>Source</span><strong>${escapeHtml(runOrigin(run))}</strong></div>
        </div>
        <div class="approved-action">
          <span>Approved action</span>
          <p>${escapeHtml(ap.recommended_action || "—")}</p>
        </div>
        ${executionScopeHtml(run)}
        <div class="scope-row"><span>Approved</span><strong>${run.updated_at ? escapeHtml(fmtTime(run.updated_at)) : "—"}</strong></div>
        <button class="execute-btn" data-execute-run="${escapeHtml(run.run_id)}" ${customer === "—" ? "disabled" : ""}>
          Execute ${escapeHtml(executionLabel(type))}
        </button>
      </article>
    `;
  }).join("");

  container.querySelectorAll("[data-execute-run]").forEach((button) => {
    button.addEventListener("click", async () => {
      const card = button.closest(".run-card");
      const runId = card.dataset.runId;
      const customerName = card.dataset.customer;
      const type = card.dataset.executionType;
      const tenantId = $("#tenant-select").value;
      button.disabled = true;
      button.textContent = "Executing…";
      try {
        const result = type === "update_crm_status"
          ? await executeApprovedCrmStatus(runId, tenantId, customerName)
          : await executeApprovedTask(runId, tenantId, customerName);
        showExecutionSuccess(result);
        renderExecutionCompleted(result);
        window.setTimeout(() => { loadApprovedRuns().catch(console.error); }, 2500);
      } catch (error) {
        $("#execution-result").classList.remove("hidden");
        $("#execution-result").classList.add("error");
        $("#execution-result").innerHTML = `<strong>Execution failed</strong><span>${escapeHtml(error.message || "Unknown error")}</span>`;
        button.disabled = false;
        button.textContent = `Execute ${executionLabel(type)}`;
      }
    });
  });
}

async function syncTaskAuthority(executableRuns) {
  const supported = !!document.modelContext?.registerTool;

  if (!executableRuns.length) {
    unregisterTaskWebMcpTool();
    const state = { supported, registered: false, registeredTools: [], locked: supported };
    setWebMcpStatus(state);
    renderTaskAuthority([], state);
    return state;
  }

  if (!supported) {
    const state = { supported: false, registered: false, registeredTools: [], locked: false };
    setWebMcpStatus(state);
    renderTaskAuthority(executableRuns, state);
    return state;
  }

  const executionTypes = [...new Set(executableRuns.map(executionType))];
  try {
    const result = await registerTaskWebMcpTool(executionTypes);
    const state = { ...result, locked: false };
    setWebMcpStatus(state);
    renderTaskAuthority(executableRuns, state);
    return state;
  } catch (error) {
    console.error("Tasks WebMCP registration failed", error);
    const state = { supported: true, registered: false, registeredTools: [], locked: false };
    setWebMcpStatus(state);
    renderTaskAuthority(executableRuns, state);
    return state;
  }
}

async function loadApprovedRuns() {
  const tenantId = $("#tenant-select").value;
  if (!tenantId) return;
  const runs = await api(`/runs?status=approved&tenant_id=${encodeURIComponent(tenantId)}`);
  renderRuns(runs);
  const executableRuns = runs.filter((run) => !!approvedCustomer(run));
  $("#ready-count").textContent = String(executableRuns.length);
  await syncTaskAuthority(executableRuns);
}

async function init() {
  await restoreBrowserSession();
  const session = getAuthSession();

  if (!session) {
    $("#login-required").classList.remove("hidden");
    setWebMcpStatus({ supported: false, registered: false, registeredTools: [], locked: false });
    renderTaskAuthoritySignedOut();
    return;
  }

  $("#tenant-select").innerHTML = session.tenantIds
    .map((tenantId) => `<option value="${escapeHtml(tenantId)}">${escapeHtml(tenantId)}</option>`)
    .join("");

  window.addEventListener(TASK_EXECUTED_EVENT, (event) => {
    showExecutionSuccess(event.detail);
    renderExecutionCompleted(event.detail);
    window.setTimeout(() => { loadApprovedRuns().catch(console.error); }, 2500);
  });

  $("#tenant-select").addEventListener("change", loadApprovedRuns);
  window.addEventListener("focus", () => { loadApprovedRuns().catch(console.error); });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) loadApprovedRuns().catch(console.error);
  });

  await loadApprovedRuns();
}

document.addEventListener("DOMContentLoaded", init);
