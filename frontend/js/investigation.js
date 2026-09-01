import { escapeHtml, getAuthSession, shortRunId } from "./shared.js";
import { restoreBrowserSession } from "./auth.js";
import { fetchCustomer, registerCrmWebMcpTools } from "./webmcp/crm-tools.js";
import { fetchInvoice, registerBillingWebMcpTools } from "./webmcp/billing-tools.js";
import { fetchCase, registerSupportWebMcpTools } from "./webmcp/support-tools.js";
import {
  ACTION_POINT_SUBMITTED_EVENT,
  registerActionPointWebMcpTool,
} from "./webmcp/action-point-tools.js";

const $ = (selector) => document.querySelector(selector);

function setStage(stageId, stateId, label, stateClass) {
  const stage = $(stageId);
  const state = $(stateId);
  stage.classList.remove("state-checking", "state-enabled", "state-complete", "state-submitted", "state-locked", "state-unavailable");
  stage.classList.add(stateClass);
  state.textContent = label;
}

function renderAuthorityChecking() {
  $("#authority-phase").textContent = "Checking authority…";
  setStage("#authority-read", "#authority-read-state", "CHECKING", "state-checking");
  setStage("#authority-propose", "#authority-propose-state", "CHECKING", "state-checking");
  setStage("#authority-execute", "#authority-execute-state", "LOCKED", "state-locked");
  $("#authority-boundary").textContent = "Human approval is required before execution authority exists.";
  $("#authority-run").textContent = "No proposal submitted yet";
  $("#authority-next").textContent = "Approval unlocks only the capability bound to the proposal";
}

function renderAuthorityReady({ supported, registeredCount }) {
  if (!supported || registeredCount !== 4) {
    $("#authority-phase").textContent = supported ? "Tool registration incomplete" : "WebMCP unavailable";
    setStage("#authority-read", "#authority-read-state", supported ? "INCOMPLETE" : "UNAVAILABLE", "state-unavailable");
    setStage("#authority-propose", "#authority-propose-state", supported ? "INCOMPLETE" : "UNAVAILABLE", "state-unavailable");
    setStage("#authority-execute", "#authority-execute-state", "LOCKED", "state-locked");
    $("#authority-boundary").textContent = "Execution remains unavailable regardless of browser tool support.";
    $("#authority-next").textContent = supported ? "Resolve tool registration before testing" : "Use a WebMCP-capable browser";
    return;
  }

  $("#authority-phase").textContent = "Investigation authority";
  setStage("#authority-read", "#authority-read-state", "ENABLED", "state-enabled");
  setStage("#authority-propose", "#authority-propose-state", "ENABLED", "state-enabled");
  setStage("#authority-execute", "#authority-execute-state", "LOCKED", "state-locked");
  $("#authority-boundary").textContent = "No controlled write tool is exposed in this workspace. The agent can read and propose only.";
  $("#authority-next").textContent = "Submit a proposal → human approval → proposal-specific execution authority";
}

function renderAuthoritySignedOut() {
  $("#authority-phase").textContent = "Sign in required";
  setStage("#authority-read", "#authority-read-state", "SIGN IN", "state-unavailable");
  setStage("#authority-propose", "#authority-propose-state", "SIGN IN", "state-unavailable");
  setStage("#authority-execute", "#authority-execute-state", "LOCKED", "state-locked");
  $("#authority-boundary").textContent = "No protected CorrelAct capability is available without an authenticated session.";
  $("#authority-run").textContent = "No authenticated run";
  $("#authority-next").textContent = "Sign in to establish organization-scoped authority";
}

function proposalExecution(payload, run) {
  return payload?.execution?.type || run?.action_point?.execution?.type || "create_task";
}

function renderAuthorityAfterProposal(detail) {
  const run = detail?.run;
  const payload = detail?.payload;
  if (!run) return;

  $("#authority-phase").textContent = "Awaiting human approval";
  setStage("#authority-read", "#authority-read-state", "COMPLETE", "state-complete");
  setStage("#authority-propose", "#authority-propose-state", "SUBMITTED", "state-submitted");
  setStage("#authority-execute", "#authority-execute-state", "LOCKED", "state-locked");

  const organization = payload?.tenant_id || run.tenant_id || "organization";
  const capability = proposalExecution(payload, run);
  $("#authority-boundary").textContent = `Proposal persisted. No write occurred; ${capability} remains unavailable until a human approves this exact run.`;
  $("#authority-run").textContent = `${shortRunId(run.run_id)} · ${organization} · ${capability}`;
  $("#authority-next").textContent = `Approval can expose ${capability} only for this approved customer and action scope`;
}

const CORRELATION_SOURCE_LABEL = { support: "Support", crm: "CRM", billing: "Billing" };
const CORRELATION_SOURCE_TOOL = { support: "get_case", crm: "get_customer", billing: "get_invoice" };

function renderEvidenceCorrelation(detail) {
  const payload = detail?.payload;
  if (!payload) return;

  const evidence = Array.isArray(payload.evidence) ? payload.evidence : [];
  const evidenceNodes = evidence.map((item) => `
    <li class="correlation-node">
      <span class="correlation-source">${escapeHtml(CORRELATION_SOURCE_LABEL[item.source] || item.source || "Evidence")}<code>${escapeHtml(CORRELATION_SOURCE_TOOL[item.source] || "")}</code></span>
      <p>${escapeHtml(item.finding || "")}</p>
      <span class="correlation-ref">${escapeHtml(item.reference || "")}</span>
    </li>
  `).join("");

  const execution = payload.execution?.type || "create_task";
  const executionDetail = execution === "update_crm_status"
    ? ` · renewal_status ${payload.execution?.crm_expected_status || "—"} → ${payload.execution?.crm_target_status || "—"}`
    : "";

  $("#correlation-chain").innerHTML = `
    ${evidenceNodes}
    <li class="correlation-node cause-node">
      <span class="correlation-source">Correlated cause</span>
      <p>${escapeHtml(payload.summary || "—")}</p>
    </li>
    <li class="correlation-node action-node">
      <span class="correlation-source">Proposed action · ${escapeHtml(execution)}</span>
      <p>${escapeHtml(payload.recommended_action || "—")}${escapeHtml(executionDetail)}</p>
    </li>
  `;

  $("#correlation-confidence").textContent = typeof payload.confidence === "number"
    ? `${Math.round(payload.confidence * 100)}%`
    : "—";
  $("#correlation-sources").textContent = String(evidence.length);
  $("#correlation-team").textContent = payload.target_team || "—";

  $("#correlation-section").classList.remove("hidden");
}

function setWebMcpStatus({ supported, registeredCount }) {
  const el = $("#webmcp-status");
  el.classList.remove("ready", "unsupported");
  if (supported && registeredCount === 4) {
    el.classList.add("ready");
    el.querySelector("span:last-child").textContent = "4 WebMCP tools registered";
    return;
  }
  el.classList.add("unsupported");
  el.querySelector("span:last-child").textContent = supported
    ? `${registeredCount}/4 WebMCP tools registered`
    : "WebMCP unavailable in this browser";
}

function formatValue(value) {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return value.toLocaleString("en-US");
  return String(value);
}

function renderEvidence(selector, entries) {
  const dl = $(selector);
  dl.innerHTML = entries
    .map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(formatValue(value))}</dd></div>`)
    .join("");
}

function showEvidence({ support, customer, invoice }) {
  const supportCase = support.case;
  const account = customer.customer;
  const billing = invoice.invoice;

  renderEvidence("#support-evidence", [
    ["Case", supportCase.case_id],
    ["Priority", supportCase.priority],
    ["Status", supportCase.status],
    ["Subject", supportCase.subject],
    ["Message", supportCase.customer_message],
    ["Escalation", supportCase.escalation_status],
  ]);

  renderEvidence("#crm-evidence", [
    ["Customer", account.name],
    ["Plan", account.plan],
    ["Account", account.account_status],
    ["Billing", account.billing_status],
    ["Renewal", account.renewal_status],
    ["Renewal value", account.renewal_value],
  ]);

  renderEvidence("#billing-evidence", [
    ["Invoice", billing.invoice_id],
    ["Contract", `${billing.currency} ${Number(billing.contract_amount).toLocaleString("en-US")}`],
    ["Billed", `${billing.currency} ${Number(billing.billed_amount).toLocaleString("en-US")}`],
    ["Variance", `${billing.currency} ${Number(billing.variance_amount).toLocaleString("en-US")}`],
    ["Dispute", billing.dispute_status],
    ["Renewal hold", billing.renewal_hold],
  ]);

  $("#evidence-section").classList.remove("hidden");
}

function showError(message) {
  const el = $("#investigation-error");
  el.textContent = message;
  el.classList.remove("hidden");
  $("#evidence-section").classList.add("hidden");
}

async function registerInvestigationTools() {
  if (!document.modelContext?.registerTool) {
    return { supported: false, registeredCount: 0 };
  }

  const results = await Promise.all([
    registerSupportWebMcpTools(),
    registerCrmWebMcpTools(),
    registerBillingWebMcpTools(),
    registerActionPointWebMcpTool(),
  ]);

  return {
    supported: true,
    registeredCount: results.filter((result) => result.registered).length,
  };
}

async function init() {
  renderAuthorityChecking();
  window.addEventListener(ACTION_POINT_SUBMITTED_EVENT, (event) => {
    renderAuthorityAfterProposal(event.detail);
    renderEvidenceCorrelation(event.detail);
  });

  await restoreBrowserSession();

  const session = getAuthSession();
  const form = $("#investigation-form");
  const tenantSelect = $("#tenant-select");

  if (!session) {
    $("#login-required").classList.remove("hidden");
    form.querySelectorAll("input, select, button").forEach((el) => { el.disabled = true; });
    setWebMcpStatus({ supported: false, registeredCount: 0 });
    renderAuthoritySignedOut();
    return;
  }

  tenantSelect.innerHTML = session.tenantIds
    .map((tenantId) => `<option value="${tenantId}">${tenantId}</option>`)
    .join("");

  try {
    const toolState = await registerInvestigationTools();
    setWebMcpStatus(toolState);
    renderAuthorityReady(toolState);
  } catch (error) {
    const failedState = { supported: true, registeredCount: 0 };
    setWebMcpStatus(failedState);
    renderAuthorityReady(failedState);
    console.error("Investigation WebMCP registration failed", error);
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    $("#investigation-error").classList.add("hidden");

    const customerName = $("#customer-name").value;
    const tenantId = tenantSelect.value;
    const button = $("#load-btn");
    button.disabled = true;
    button.textContent = "Loading…";

    try {
      const [support, customer, invoice] = await Promise.all([
        fetchCase(customerName, tenantId),
        fetchCustomer(customerName, tenantId),
        fetchInvoice(customerName, tenantId),
      ]);

      if (!support.found || !customer.found || !invoice.found) {
        throw new Error("Complete evidence was not found across all three sources.");
      }

      showEvidence({ support, customer, invoice });
    } catch (error) {
      showError(error.message || "Evidence lookup failed.");
    } finally {
      button.disabled = false;
      button.textContent = "Load evidence";
    }
  });
}

document.addEventListener("DOMContentLoaded", init);
