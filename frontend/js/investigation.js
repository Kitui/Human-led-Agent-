import { getAuthSession } from "./shared.js";
import { restoreBrowserSession } from "./auth.js";
import { fetchCustomer, registerCrmWebMcpTools } from "./webmcp/crm-tools.js";
import { fetchInvoice, registerBillingWebMcpTools } from "./webmcp/billing-tools.js";
import { fetchCase, registerSupportWebMcpTools } from "./webmcp/support-tools.js";
import { registerActionPointWebMcpTool } from "./webmcp/action-point-tools.js";

const $ = (selector) => document.querySelector(selector);

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
  await restoreBrowserSession();

  const session = getAuthSession();
  const form = $("#investigation-form");
  const tenantSelect = $("#tenant-select");

  if (!session) {
    $("#login-required").classList.remove("hidden");
    form.querySelectorAll("input, select, button").forEach((el) => { el.disabled = true; });
    setWebMcpStatus({ supported: false, registeredCount: 0 });
    return;
  }

  tenantSelect.innerHTML = session.tenantIds
    .map((tenantId) => `<option value="${tenantId}">${tenantId}</option>`)
    .join("");

  try {
    setWebMcpStatus(await registerInvestigationTools());
  } catch (error) {
    setWebMcpStatus({ supported: true, registeredCount: 0 });
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
