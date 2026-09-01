import { getAuthSession, shortRunId } from "./shared.js";
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
  $("#authority-next").textContent = "Approval unlocks scoped execution in Tasks";
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
  $("#authority-boundary").textContent = "create_task is not exposed in this workspace. No external write authority exists yet.";
  $("#authority-next").textContent = "Submit a proposal → human approval → scoped Tasks authority";
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

function renderAuthorityAfterProposal(detail) {
  const run = detail?.run;
  const payload = detail?.payload;
  if (!run) return;

  $("#authority-phase").textContent = "Awaiting human approval";
  setStage("#authority-read", "#authority-read-state", "COMPLETE", "state-complete");
  setStage("#authority-propose", "#authority-propose-state", "SUBMITTED", "state-submitted");
  setStage("#authority-execute", "#authority-execute-state", "LOCKED", "state-locked");

  const organization = payload?.tenant_id || run.tenant_id || "organization";
  $("#authority-boundary").textContent = "Proposal persisted. No external write occurred; create_task remains absent from this page.";
  $("#authority-run").textContent = `${shortRunId(run.run_id)} · ${organization}`;
  $("#authority-next").textContent = "A human must approve this exact run before Tasks can expose create_task";
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
    .map(([label, value]) => `<div><dt>${label}</dt><dd>${formatValue(value)}</dd></div>`)
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
