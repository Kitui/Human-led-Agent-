import { getAuthSession } from "./shared.js";
import { restoreBrowserSession } from "./auth.js";
import { fetchCustomer, registerCrmWebMcpTools } from "./webmcp/crm-tools.js";

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

function showCustomer(body) {
  const customer = body.customer;
  $("#result-name").textContent = customer.name;
  $("#result-plan").textContent = customer.plan;
  $("#result-tenant").textContent = customer.tenant_id;
  $("#result-account").textContent = customer.account_status;
  $("#result-billing").textContent = customer.billing_status;
  $("#result-renewal").textContent = customer.renewal_status;
  $("#result-value").textContent = customer.renewal_value == null
    ? "—"
    : `$${Number(customer.renewal_value).toLocaleString()}`;
  $("#customer-result").classList.remove("hidden");
}

function showError(message) {
  const el = $("#customer-error");
  el.textContent = message;
  el.classList.remove("hidden");
  $("#customer-result").classList.add("hidden");
}

async function init() {
  // This CRM workspace may be opened in a different tab from the main application.
  // Restore that tab from the shared browser cookie before deciding whether
  // the user is signed in.
  await restoreBrowserSession();

  const session = getAuthSession();
  const form = $("#customer-form");
  const tenantSelect = $("#tenant-select");

  if (!session) {
    $("#login-required").classList.remove("hidden");
    form.querySelectorAll("input, select, button").forEach((el) => { el.disabled = true; });
    setWebMcpStatus({ supported: false, registered: false });
    return;
  }

  tenantSelect.innerHTML = session.tenantIds
    .map((tenantId) => `<option value="${tenantId}">${tenantId}</option>`)
    .join("");

  try {
    setWebMcpStatus(await registerCrmWebMcpTools());
  } catch (error) {
    setWebMcpStatus({ supported: true, registered: false });
    console.error("WebMCP registration failed", error);
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    $("#customer-error").classList.add("hidden");
    const button = $("#search-btn");
    button.disabled = true;
    button.textContent = "Searching…";
    try {
      const body = await fetchCustomer($("#customer-name").value, tenantSelect.value);
      showCustomer(body);
    } catch (error) {
      showError(error.message || "Customer lookup failed.");
    } finally {
      button.disabled = false;
      button.textContent = "Search";
    }
  });
}

document.addEventListener("DOMContentLoaded", init);
