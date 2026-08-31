import { getAuthSession } from "./shared.js";
import { restoreBrowserSession } from "./auth.js";
import { fetchCase, registerSupportWebMcpTools } from "./webmcp/support-tools.js";

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

function showCase(body) {
  if (!body.found) {
    showError("Support case not found.");
    return;
  }

  const supportCase = body.case;
  $("#result-case").textContent = supportCase.case_id;
  $("#result-customer").textContent = supportCase.customer_name;
  $("#result-status").textContent = supportCase.status;
  $("#result-tenant").textContent = supportCase.tenant_id;
  $("#result-priority").textContent = supportCase.priority;
  $("#result-channel").textContent = supportCase.channel;
  $("#result-category").textContent = supportCase.category;
  $("#result-escalation").textContent = supportCase.escalation_status;
  $("#result-team").textContent = supportCase.assigned_team;
  $("#result-subject").textContent = supportCase.subject;
  $("#result-message").textContent = supportCase.customer_message;
  $("#case-result").classList.remove("hidden");
}

function showError(message) {
  const el = $("#case-error");
  el.textContent = message;
  el.classList.remove("hidden");
  $("#case-result").classList.add("hidden");
}

async function init() {
  await restoreBrowserSession();

  const session = getAuthSession();
  const form = $("#case-form");
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
    setWebMcpStatus(await registerSupportWebMcpTools());
  } catch (error) {
    setWebMcpStatus({ supported: true, registered: false });
    console.error("WebMCP registration failed", error);
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    $("#case-error").classList.add("hidden");
    const button = $("#search-btn");
    button.disabled = true;
    button.textContent = "Checking…";
    try {
      showCase(await fetchCase($("#customer-name").value, tenantSelect.value));
    } catch (error) {
      showError(error.message || "Support case lookup failed.");
    } finally {
      button.disabled = false;
      button.textContent = "Check case";
    }
  });
}

document.addEventListener("DOMContentLoaded", init);
