/* CorrelAct — Settings page.
 *
 * The settings surface distinguishes configurable settings from enforced
 * platform capabilities. Operational cards are populated from live API/run/eval
 * evidence where possible, while access-sensitive organization controls are
 * rendered according to the signed-in user's scope.
 */
import { qs, qsa, escapeHtml, fmtTime, api, showBanner } from "./shared.js";
import { currentTenantIds, currentUsername } from "./auth.js";

const PLATFORM_ADMIN_USERNAME = "admin@correlact.com";

function isPlatformAdmin() {
  return (currentUsername() || "").toLowerCase() === PLATFORM_ADMIN_USERNAME;
}

function healthBadge(kind, label) {
  return `<span class="health-badge ${kind}"><span class="dot"></span>${escapeHtml(label)}</span>`;
}

function ensureCompletionUxStyles() {
  if (document.getElementById("correlact-settings-completion-styles")) return;
  const style = document.createElement("style");
  style.id = "correlact-settings-completion-styles";
  style.textContent = `
    .settings-completion-card .card-sub { max-width: 620px; line-height: 1.55; }
    .operational-list { display: grid; gap: 0; margin-top: 8px; }
    .operational-item {
      display: grid;
      grid-template-columns: minmax(145px, .9fr) minmax(190px, 1.35fr) auto;
      align-items: center;
      gap: 14px;
      min-height: 58px;
      padding: 11px 0;
      border-bottom: 1px solid var(--ca-border, #dfe5ee);
    }
    .operational-item:last-child { border-bottom: 0; }
    .operational-item .label { color: var(--ca-text, #172033); font-weight: 680; line-height: 1.35; }
    .operational-item .value { color: var(--ca-muted, #64748b); line-height: 1.45; overflow-wrap: anywhere; }
    .settings-access-note {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      margin: 2px 0 16px;
      padding: 11px 13px;
      border: 1px solid var(--ca-border, #dfe5ee);
      border-radius: 10px;
      background: var(--ca-surface-muted, #f8fafc);
      color: var(--ca-muted, #64748b);
      font-size: 12.5px;
      line-height: 1.5;
    }
    .settings-access-note strong { color: var(--ca-text, #172033); }
    .settings-access-icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex: 0 0 24px;
      width: 24px;
      height: 24px;
      border-radius: 7px;
      background: var(--ca-primary-soft, #eef4ff);
      color: var(--ca-primary, #2457d6);
      font-weight: 800;
    }
    .organization-assigned { white-space: nowrap; }
    @media (max-width: 760px) {
      .operational-item { grid-template-columns: minmax(0, 1fr) auto; gap: 7px 12px; }
      .operational-item .value { grid-column: 1 / -1; grid-row: 2; }
      .operational-item .health-badge { grid-column: 2; grid-row: 1; }
    }
  `;
  document.head.appendChild(style);
}

function operationalRow(label, value, badgeKind, badgeLabel) {
  return `<div class="operational-item"><span class="label">${escapeHtml(label)}</span><span class="value">${escapeHtml(value)}</span>${healthBadge(badgeKind, badgeLabel)}</div>`;
}

function prepareProductCompletionCards() {
  ensureCompletionUxStyles();

  const approval = qs("#settings-section-approval");
  approval.classList.add("settings-completion-card");
  approval.innerHTML = `
    <div class="card-head"><h2>Approval Policy</h2>${healthBadge("healthy", "Enforced")}</div>
    <p class="card-sub">The execution boundary applied by CorrelAct to consequential work.</p>
    <div class="operational-list">
      ${operationalRow("Consequential write actions", "Human approval required", "healthy", "Required")}
      ${operationalRow("Approved action scope", "Locked during execution", "healthy", "Enforced")}
      ${operationalRow("Cross-organization execution", "Rejected by the API", "healthy", "Blocked")}
      ${operationalRow("Repeated execution", "Protected by durable idempotency", "healthy", "Protected")}
    </div>
  `;

  const environment = qs("#settings-section-environment");
  environment.classList.add("settings-completion-card");
  environment.innerHTML = `
    <div class="card-head"><h2>Environment Status</h2></div>
    <p class="env-status-banner" id="env-status-banner"><span class="dot"></span><span id="env-status-banner-text"></span></p>
    <div class="operational-list" id="env-status-rows"></div>
    <div class="operational-list">
      <div class="operational-item"><span class="label">Environment</span><span class="value" id="env-status-environment"></span>${healthBadge("healthy", "Production")}</div>
      ${operationalRow("Platform", "Azure Container Apps", "healthy", "Hosted")}
    </div>
  `;

  const integrations = qs("#settings-section-integrations");
  integrations.classList.add("settings-completion-card");
  integrations.innerHTML = `
    <div class="card-head"><h2>Connected Capabilities</h2></div>
    <p class="card-sub">Runtime capabilities used by the current CorrelAct workflow.</p>
    <div class="operational-list" id="settings-capabilities-rows"></div>
  `;

  const observability = qs("#settings-section-observability");
  observability.classList.add("settings-completion-card");
  observability.innerHTML = `
    <div class="card-head"><h2>Observability</h2></div>
    <p class="card-sub">Signals captured from real runs and persisted evaluation history.</p>
    <div class="operational-list" id="settings-observability-rows"></div>
  `;

  const security = qs("#settings-section-security");
  security.classList.add("settings-completion-card");
  security.innerHTML = `
    <div class="card-head"><h2>Security Controls</h2>${healthBadge("healthy", "Enforced")}</div>
    <p class="card-sub">Controls protecting browser sessions, organization boundaries, and production secrets.</p>
    <div class="operational-list">
      ${operationalRow("Authenticated access", "Required for protected APIs", "healthy", "Enforced")}
      ${operationalRow("Browser session", "HttpOnly session cookie", "healthy", "Protected")}
      ${operationalRow("Organization scope", "Checked on protected reads and writes", "healthy", "Enforced")}
      ${operationalRow("Production secrets", "Azure Key Vault references", "healthy", "Managed")}
    </div>
  `;

  const orgCard = qs("#settings-section-tenants");
  const admin = isPlatformAdmin();
  const heading = orgCard.querySelector("h2");
  if (heading) heading.textContent = admin ? "Organization Management" : "Organization Access";

  const addButton = qs("#add-tenant-btn");
  if (addButton) {
    addButton.textContent = "+ Add Organization";
    addButton.classList.toggle("hidden", !admin);
    addButton.setAttribute("aria-hidden", admin ? "false" : "true");
  }

  const headers = orgCard.querySelectorAll("thead th");
  if (headers[0]) headers[0].textContent = "Organization";
  if (headers[3]) headers[3].textContent = admin ? "Action" : "Access";

  const accessNote = document.createElement("div");
  accessNote.className = "settings-access-note";
  accessNote.innerHTML = admin
    ? `<span class="settings-access-icon">A</span><span><strong>Platform administrator.</strong> You can view, create, activate, and deactivate organizations.</span>`
    : `<span class="settings-access-icon">O</span><span><strong>Organization-scoped access.</strong> Only organizations assigned to ${escapeHtml(currentUsername() || "this account")} are shown. Organization creation and lifecycle controls are restricted to the platform administrator.</span>`;
  const tableScroll = orgCard.querySelector(".table-scroll");
  if (tableScroll) orgCard.insertBefore(accessNote, tableScroll);

  const modal = qs("#add-tenant-modal");
  if (modal) {
    const modalTitle = modal.querySelector(".modal-title");
    if (modalTitle) modalTitle.textContent = "Add Organization";
    const slugLabel = modal.querySelector('label[for="add-tenant-slug"]');
    if (slugLabel) slugLabel.textContent = "Organization ID";
    const slugInput = qs("#add-tenant-slug");
    if (slugInput) slugInput.placeholder = "e.g. Atlas";
    const submit = qs("#add-tenant-submit-btn");
    if (submit) submit.textContent = "Add Organization";
  }

  const timezoneField = qs("#settings-general-default-timezone");
  const timezoneNote = timezoneField?.closest(".settings-field")?.querySelector(".field-note");
  if (timezoneNote) timezoneNote.remove();
}

function initSettingsTabs() {
  const panel = qs('section.page[data-page="settings"]');
  qsa(".settings-tab-btn", panel).forEach((btn) => {
    btn.addEventListener("click", () => {
      qsa(".settings-tab-btn", panel).forEach((b) => b.classList.toggle("active", b === btn));
      qs(`#${btn.dataset.target}`).scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
}

function renderTenantsTable(tenants) {
  const body = qs("#tenants-table-body");
  const admin = isPlatformAdmin();
  if (tenants.length === 0) {
    body.innerHTML = `<tr><td colspan="4"><p class="empty-note">No organizations available for this account.</p></td></tr>`;
    return;
  }

  body.innerHTML = tenants.map((t) => {
    const action = admin
      ? `<button class="btn btn-outline" data-toggle-tenant="${escapeHtml(t.slug)}" data-next-active="${!t.is_active}">${t.is_active ? "Deactivate" : "Activate"}</button>`
      : `<span class="health-badge healthy organization-assigned"><span class="dot"></span>Assigned</span>`;
    return `
    <tr data-tenant-row="${escapeHtml(t.slug)}">
      <td>${escapeHtml(t.slug)}</td>
      <td>${escapeHtml(t.environment)}</td>
      <td>${t.is_active ? healthBadge("healthy", "Active") : healthBadge("down", "Inactive")}</td>
      <td>${action}</td>
    </tr>
  `;
  }).join("");

  if (!admin) return;
  qsa("[data-toggle-tenant]", body).forEach((btn) => {
    btn.addEventListener("click", async () => {
      const slug = btn.dataset.toggleTenant;
      const nextActive = btn.dataset.nextActive === "true";
      btn.disabled = true;
      try {
        await api(`/tenants/${encodeURIComponent(slug)}`, { method: "PATCH", body: JSON.stringify({ is_active: nextActive }) });
        await loadAndRenderTenants();
      } catch (err) {
        showBanner(err.message || "Could not update organization.");
        btn.disabled = false;
      }
    });
  });
}

async function loadAndRenderTenants() {
  const tenants = await api("/tenants");
  renderTenantsTable(tenants);
  return tenants;
}

async function loadOperationalSignals() {
  const [runsResult, evalsResult] = await Promise.allSettled([
    api("/runs"),
    api("/evals/runs"),
  ]);
  const runs = runsResult.status === "fulfilled" && Array.isArray(runsResult.value) ? runsResult.value : [];
  const evalRuns = evalsResult.status === "fulfilled" && Array.isArray(evalsResult.value) ? evalsResult.value : [];
  const traceEvents = runs.flatMap((run) => (run.trace || []).map((event) => ({ ...event, run_id: run.run_id })));
  const newestEvent = (predicate) => traceEvents
    .filter(predicate)
    .sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0))[0] || null;

  const mcpEvent = newestEvent((event) => event.kind === "mcp");
  const guardrailEvent = newestEvent((event) => event.kind === "guardrail");
  const taskEvent = newestEvent((event) => /create_task|github/i.test(`${event.label || ""} ${event.detail || ""}`));
  const githubExecution = runs.find((run) => /github|issue/i.test(run.execution_result || ""));

  return {
    runs,
    evalRuns,
    latestEval: evalRuns[0] || null,
    mcpEvent,
    guardrailEvent,
    githubVerified: !!(taskEvent || githubExecution),
  };
}

async function loadAndRenderEnvironmentStatus(tenants, signals) {
  let apiHealthy = false;
  try {
    await api("/health");
    apiHealthy = true;
  } catch (_) {
    apiHealthy = false;
  }

  const latestEval = signals.latestEval;
  const evalPassed = latestEval?.result === "passed";
  const evalLabel = latestEval ? (evalPassed ? "Passed" : "Failed") : "Ready";
  const evalKind = latestEval ? (evalPassed ? "healthy" : "down") : "unmonitored";
  const toolLabel = signals.mcpEvent ? "Verified" : "Configured";
  const guardrailLabel = signals.guardrailEvent ? "Verified" : "Enforced";

  qs("#env-status-rows").innerHTML = [
    operationalRow("API", apiHealthy ? "Responding normally" : "Health check failed", apiHealthy ? "healthy" : "down", apiHealthy ? "Healthy" : "Unavailable"),
    operationalRow("Agent tools / MCP", signals.mcpEvent ? `Observed ${fmtTime(signals.mcpEvent.timestamp)}` : "Runtime capability configured", signals.mcpEvent ? "healthy" : "unmonitored", toolLabel),
    operationalRow("Guardrails", signals.guardrailEvent ? `Last trace ${fmtTime(signals.guardrailEvent.timestamp)}` : "Applied to native investigations", "healthy", guardrailLabel),
    operationalRow("Evaluation gate", latestEval ? `${latestEval.score.toFixed(0)}% score · ${latestEval.threshold.toFixed(0)}% threshold` : "Live suite available from Evals", evalKind, evalLabel),
  ].join("");

  qs("#env-status-banner").classList.toggle("down", !apiHealthy);
  qs("#env-status-banner-text").textContent = apiHealthy ? "Production operational" : "Production API unavailable";

  const slug = currentTenantSlug();
  const tenant = tenants.find((t) => t.slug === slug);
  qs("#env-status-environment").textContent = tenant ? tenant.environment : "Production";
}

function renderCapabilityCards(signals) {
  qs("#settings-capabilities-rows").innerHTML = [
    operationalRow("OpenAI Agents SDK", "Agent and Runner orchestration", "healthy", "Active"),
    operationalRow("Customer Operations MCP", signals.mcpEvent ? `Tool activity observed ${fmtTime(signals.mcpEvent.timestamp)}` : "Attached to investigator runtime", signals.mcpEvent ? "healthy" : "unmonitored", signals.mcpEvent ? "Verified" : "Configured"),
    operationalRow("WebMCP browser tools", "Read, propose, and approved execution surfaces", "healthy", "Enabled"),
    operationalRow("GitHub Issues", signals.githubVerified ? "External task execution observed" : "Approved task destination configured", signals.githubVerified ? "healthy" : "unmonitored", signals.githubVerified ? "Verified" : "Configured"),
    operationalRow("PostgreSQL", "Persistent workflow, identity, and eval state", "healthy", "Connected"),
  ].join("");

  const latestEval = signals.latestEval;
  const hasTrace = signals.runs.some((run) => (run.trace || []).length > 0);
  const hasUsage = signals.runs.some((run) => {
    const metrics = run.metrics || {};
    return Number(metrics.model_calls || 0) > 0 || Number(metrics.tool_calls || 0) > 0 || Number(metrics.total_tokens || 0) > 0;
  });
  qs("#settings-observability-rows").innerHTML = [
    operationalRow("Run tracing", hasTrace ? "Persisted workflow events available" : "Enabled for new workflow runs", "healthy", hasTrace ? "Active" : "Enabled"),
    operationalRow("Tool call capture", signals.mcpEvent ? "MCP/tool events captured in traces" : "Enabled for agent tool calls", "healthy", signals.mcpEvent ? "Active" : "Enabled"),
    operationalRow("Model usage metrics", hasUsage ? "Model calls, tokens, and tool calls recorded" : "SDK usage counters enabled", "healthy", hasUsage ? "Active" : "Enabled"),
    operationalRow("Evaluation history", signals.evalRuns.length ? `${signals.evalRuns.length} persisted suite run${signals.evalRuns.length === 1 ? "" : "s"}` : "Live evaluation runner available", signals.evalRuns.length ? "healthy" : "unmonitored", signals.evalRuns.length ? "Persisted" : "Ready"),
    operationalRow("Latest evaluation", latestEval ? `${latestEval.score.toFixed(0)}% · ${latestEval.passed_count}/${latestEval.total_count} cases` : "Run a live suite from Evals", latestEval ? (latestEval.result === "passed" ? "healthy" : "down") : "unmonitored", latestEval ? (latestEval.result === "passed" ? "Passed" : "Failed") : "Ready"),
  ].join("");
}

function currentTenantSlug() {
  return qs("#tenant-select-label").textContent.trim();
}

function populateGeneralForm(tenantSlug, settings) {
  qs("#settings-general-tenant-name").textContent = tenantSlug;
  qs("#settings-general-environment-name").value = settings.environment_name || "";
  qs("#settings-general-log-level").value = settings.log_level;
  qs("#settings-general-default-language").value = settings.default_language || "";
  qs("#settings-general-default-timezone").value = settings.default_timezone || "";
  qs("#settings-general-max-concurrent-runs").value = settings.max_concurrent_runs;
  qs("#settings-general-max-steps").value = settings.max_steps;
  qs("#settings-general-retry-limit").value = settings.retry_limit;
}

function populateModelForm(tenantSlug, settings) {
  qs("#settings-model-tenant-name").textContent = tenantSlug;
  qs("#settings-model-default-model").value = settings.default_model || "";
  qs("#settings-model-prompt-version").textContent = `v${settings.prompt_version}`;
  qs("#settings-model-system-prompt-override").value = settings.system_prompt_override || "";
  qs("#settings-model-auto-update-prompt").checked = !!settings.auto_update_prompt;
}

async function loadAndRenderTenantSettings() {
  const slug = currentTenantSlug();
  if (!slug) return;
  try {
    const settings = await api(`/tenants/${encodeURIComponent(slug)}/settings`);
    populateGeneralForm(slug, settings);
    populateModelForm(slug, settings);
  } catch (err) {
    showBanner(err.message || "Could not load organization settings.");
  }
}

function collectGeneralFormValues() {
  return {
    environment_name: qs("#settings-general-environment-name").value.trim(),
    log_level: qs("#settings-general-log-level").value,
    default_language: qs("#settings-general-default-language").value.trim(),
    default_timezone: qs("#settings-general-default-timezone").value.trim(),
    max_concurrent_runs: Number(qs("#settings-general-max-concurrent-runs").value),
    max_steps: Number(qs("#settings-general-max-steps").value),
    retry_limit: Number(qs("#settings-general-retry-limit").value),
  };
}

function collectModelFormValues() {
  const defaultModel = qs("#settings-model-default-model").value.trim();
  const promptOverride = qs("#settings-model-system-prompt-override").value.trim();
  return {
    default_model: defaultModel || null,
    system_prompt_override: promptOverride || null,
    auto_update_prompt: qs("#settings-model-auto-update-prompt").checked,
  };
}

function initGeneralSettingsForm() {
  const form = qs("#settings-general-form");
  const btn = qs("#settings-general-save-btn");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const slug = currentTenantSlug();
    btn.disabled = true;
    try {
      const updated = await api(`/tenants/${encodeURIComponent(slug)}/settings`, {
        method: "PATCH", body: JSON.stringify(collectGeneralFormValues()),
      });
      populateGeneralForm(slug, updated);
      showBanner("General settings saved.");
    } catch (err) {
      showBanner(err.message || "Could not save general settings.");
    } finally {
      btn.disabled = false;
    }
  });
}

function initModelSettingsForm() {
  const form = qs("#settings-model-form");
  const btn = qs("#settings-model-save-btn");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const slug = currentTenantSlug();
    btn.disabled = true;
    try {
      const updated = await api(`/tenants/${encodeURIComponent(slug)}/settings`, {
        method: "PATCH", body: JSON.stringify(collectModelFormValues()),
      });
      populateModelForm(slug, updated);
      showBanner("Model & prompt settings saved.");
    } catch (err) {
      showBanner(err.message || "Could not save model & prompt settings.");
    } finally {
      btn.disabled = false;
    }
  });
}

function openAddTenantModal() {
  qs("#add-tenant-form").reset();
  qs("#add-tenant-error").classList.add("hidden");
  qs("#add-tenant-modal").classList.remove("hidden");
  qs("#add-tenant-slug").focus();
}
function closeAddTenantModal() { qs("#add-tenant-modal").classList.add("hidden"); }

function initAddTenantModal() {
  if (!isPlatformAdmin()) return;

  qs("#add-tenant-btn").addEventListener("click", openAddTenantModal);
  qs("#add-tenant-cancel-btn").addEventListener("click", closeAddTenantModal);
  qs("#add-tenant-modal").addEventListener("click", (e) => { if (e.target === qs("#add-tenant-modal")) closeAddTenantModal(); });

  const form = qs("#add-tenant-form");
  const errorEl = qs("#add-tenant-error");
  const submitBtn = qs("#add-tenant-submit-btn");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const slug = qs("#add-tenant-slug").value.trim();
    const environment = qs("#add-tenant-environment").value;
    if (!slug) return;
    errorEl.classList.add("hidden");
    submitBtn.disabled = true;
    submitBtn.textContent = "Adding…";
    try {
      await api("/tenants", { method: "POST", body: JSON.stringify({ slug, environment }) });
      closeAddTenantModal();
      await loadAndRenderTenants();
      showBanner(`Organization "${slug}" added.`);
    } catch (err) {
      errorEl.textContent = err.message || "Could not add organization.";
      errorEl.classList.remove("hidden");
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "Add Organization";
    }
  });
}

let settingsWired = false;

export async function renderSettingsPage() {
  if (!settingsWired) {
    prepareProductCompletionCards();
    initSettingsTabs();
    initAddTenantModal();
    initGeneralSettingsForm();
    initModelSettingsForm();
    settingsWired = true;
  }
  const [tenants, signals] = await Promise.all([
    loadAndRenderTenants(),
    loadOperationalSignals(),
  ]);
  await loadAndRenderTenantSettings();
  await loadAndRenderEnvironmentStatus(tenants, signals);
  renderCapabilityCards(signals);
}
