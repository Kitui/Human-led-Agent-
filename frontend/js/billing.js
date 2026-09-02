import { escapeHtml, getAuthSession } from "./shared.js";
import { restoreBrowserSession } from "./auth.js";
import { fetchInvoice, registerBillingWebMcpTools } from "./webmcp/billing-tools.js";

const $ = (selector) => document.querySelector(selector);

function setWebMcpStatus(state) {
  const el = $("#webmcp-status");
  el.classList.remove("ready", "unsupported");
  if (state.supported && state.registered) {
    el.classList.add("ready");
    el.querySelector("span:last-child").textContent = "WebMCP tool registered";
  } else {
    el.classList.add("unsupported");
    el.querySelector("span:last-child").textContent = "WebMCP unavailable in this browser";
  }
}

function money(value, currency = "USD") {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(Number(value));
}

function showInvoice(body) {
  if (!body.found) {
    showError("Invoice not found.");
    return;
  }

  const invoice = body.invoice;
  $("#result-invoice").textContent = invoice.invoice_id;
  $("#result-customer").textContent = invoice.customer_name;
  $("#result-status").textContent = invoice.invoice_status;
  $("#result-tenant").textContent = invoice.tenant_id;
  $("#result-contract").textContent = money(invoice.contract_amount, invoice.currency);
  $("#result-billed").textContent = money(invoice.billed_amount, invoice.currency);
  $("#result-variance").textContent = money(invoice.variance_amount, invoice.currency);
  $("#result-dispute").textContent = invoice.dispute_status;
  $("#result-hold").textContent = invoice.renewal_hold ? "Yes" : "No";
  $("#result-due").textContent = invoice.due_date;
  $("#result-reason").textContent = invoice.dispute_reason || "No active dispute";
  $("#invoice-result").classList.remove("hidden");
}

function showError(message) {
  const el = $("#invoice-error");
  el.textContent = message;
  el.classList.remove("hidden");
  $("#invoice-result").classList.add("hidden");
}

async function init() {
  await restoreBrowserSession();

  const session = getAuthSession();
  const form = $("#invoice-form");
  const tenantSelect = $("#tenant-select");

  if (!session) {
    $("#login-required").classList.remove("hidden");
    form.querySelectorAll("input, select, button").forEach((el) => { el.disabled = true; });
    setWebMcpStatus({ supported: false, registered: false });
    return;
  }

  tenantSelect.innerHTML = session.tenantIds
    .map((tenantId) => `<option value="${escapeHtml(tenantId)}">${escapeHtml(tenantId)}</option>`)
    .join("");

  try {
    setWebMcpStatus(await registerBillingWebMcpTools());
  } catch (error) {
    setWebMcpStatus({ supported: true, registered: false });
    console.error("WebMCP registration failed", error);
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    $("#invoice-error").classList.add("hidden");
    const button = $("#search-btn");
    button.disabled = true;
    button.textContent = "Checking…";
    try {
      showInvoice(await fetchInvoice($("#customer-name").value, tenantSelect.value));
    } catch (error) {
      showError(error.message || "Invoice lookup failed.");
    } finally {
      button.disabled = false;
      button.textContent = "Check invoice";
    }
  });
}

document.addEventListener("DOMContentLoaded", init);
