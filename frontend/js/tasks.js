import { api, escapeHtml, fmtTime, getAuthSession, shortRunId } from "./shared.js";
import { restoreBrowserSession } from "./auth.js";
import { executeApprovedTask, registerTaskWebMcpTool } from "./webmcp/task-tools.js";

const $ = (selector) => document.querySelector(selector);

function setWebMcpStatus({ supported, registered }) {
  const el = $("#webmcp-status");
  el.classList.remove("ready", "unsupported");
  if (supported && registered) {
    el.classList.add("ready");
    el.querySelector("span:last-child").textContent = "create_task registered";
    return;
  }
  el.classList.add("unsupported");
  el.querySelector("span:last-child").textContent = supported
    ? "WebMCP tool registration failed"
    : "WebMCP unavailable in this browser";
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
    : "Correlact Investigate";
}

function renderRuns(runs) {
  const container = $("#approved-runs");
  if (!runs.length) {
    container.innerHTML = '<p class="empty">No approved Action Points are waiting for task execution.</p>';
    return;
  }

  container.innerHTML = runs.map((run) => {
    const ap = run.action_point || {};
    const customer = approvedCustomer(run) || "—";
    return `
      <article class="run-card" data-run-id="${escapeHtml(run.run_id)}" data-customer="${escapeHtml(customer)}">
        <div class="run-card-head">
          <div>
            <span class="run-id">${escapeHtml(shortRunId(run.run_id))}</span>
            <h3>${escapeHtml(ap.title || "Approved Action Point")}</h3>
          </div>
          <span class="approved-badge">HUMAN APPROVED</span>
        </div>
        <div class="run-meta">
          <div><span>Customer</span><strong>${escapeHtml(customer)}</strong></div>
          <div><span>Target team</span><strong>${escapeHtml(ap.target_team || "—")}</strong></div>
          <div><span>Priority</span><strong>${escapeHtml(ap.priority || "—")}</strong></div>
          <div><span>Source</span><strong>${escapeHtml(runOrigin(run))}</strong></div>
        </div>
        <div class="approved-action">
          <span>Approved action</span>
          <p>${escapeHtml(ap.recommended_action || "—")}</p>
        </div>
        <div class="scope-row"><span>Approved</span><strong>${run.updated_at ? escapeHtml(fmtTime(run.updated_at)) : "—"}</strong></div>
        <button class="execute-btn" data-execute-run="${escapeHtml(run.run_id)}" ${customer === "—" ? "disabled" : ""}>
          Execute approved task
        </button>
      </article>
    `;
  }).join("");

  container.querySelectorAll("[data-execute-run]").forEach((button) => {
    button.addEventListener("click", async () => {
      const card = button.closest(".run-card");
      const runId = card.dataset.runId;
      const customerName = card.dataset.customer;
      const tenantId = $("#tenant-select").value;
      button.disabled = true;
      button.textContent = "Executing…";
      try {
        const result = await executeApprovedTask(runId, tenantId, customerName);
        $("#execution-result").classList.remove("hidden", "error");
        $("#execution-result").innerHTML = `<strong>Completed</strong><span>${escapeHtml(result.execution_result || "Task execution completed.")}</span>`;
        await loadApprovedRuns();
      } catch (error) {
        $("#execution-result").classList.remove("hidden");
        $("#execution-result").classList.add("error");
        $("#execution-result").innerHTML = `<strong>Execution failed</strong><span>${escapeHtml(error.message || "Unknown error")}</span>`;
        button.disabled = false;
        button.textContent = "Execute approved task";
      }
    });
  });
}

async function loadApprovedRuns() {
  const tenantId = $("#tenant-select").value;
  if (!tenantId) return;
  const runs = await api(`/runs?status=approved&tenant_id=${encodeURIComponent(tenantId)}`);
  renderRuns(runs);
  $("#ready-count").textContent = String(runs.length);
}

async function init() {
  await restoreBrowserSession();
  const session = getAuthSession();

  if (!session) {
    $("#login-required").classList.remove("hidden");
    setWebMcpStatus({ supported: false, registered: false });
    return;
  }

  $("#tenant-select").innerHTML = session.tenantIds
    .map((tenantId) => `<option value="${escapeHtml(tenantId)}">${escapeHtml(tenantId)}</option>`)
    .join("");

  try {
    setWebMcpStatus(await registerTaskWebMcpTool());
  } catch (error) {
    console.error("Tasks WebMCP registration failed", error);
    setWebMcpStatus({ supported: true, registered: false });
  }

  $("#tenant-select").addEventListener("change", loadApprovedRuns);
  await loadApprovedRuns();
}

document.addEventListener("DOMContentLoaded", init);
