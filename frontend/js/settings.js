/* Human-Led Agent Lab — Settings page: identity, tab switching, Tenant
 * Management (list / create / activate / deactivate), and per-tenant
 * General Settings + Model & Prompt. Approval Policy / Integrations /
 * Observability are still planned for later phases; Security is a
 * permanent placeholder, no real feature planned. */
import { qs, qsa, escapeHtml, api, getAuthSession, showBanner } from "./shared.js";

function updateSettingsIdentity() {
  const session = getAuthSession();
  qs("#settings-username").textContent = session ? session.username : "—";
  qs("#settings-valid-tenants").textContent = session ? session.tenantIds.join(", ") : "—";
}

function initSettingsTabs() {
  // Scoped to the settings <section>, not "[data-page=settings]" alone --
  // the sidebar nav link also carries data-page="settings" for its own
  // active-highlight logic (see main.js's navigateTo), and querySelector
  // would otherwise match that link first since it comes first in the DOM.
  const panel = qs('section.page[data-page="settings"]');
  qsa(".settings-tab-btn", panel).forEach((btn) => {
    btn.addEventListener("click", () => {
      qsa(".settings-tab-btn", panel).forEach((b) => b.classList.toggle("active", b === btn));
      qsa(".settings-tab-panel", panel).forEach((p) => p.classList.toggle("active", p.dataset.tabPanel === btn.dataset.tab));
    });
  });
}

function renderTenantsTable(tenants) {
  const body = qs("#tenants-table-body");
  if (tenants.length === 0) {
    body.innerHTML = `<tr><td colspan="4"><p class="empty-note">No tenants yet.</p></td></tr>`;
    return;
  }
  body.innerHTML = tenants.map((t) => `
    <tr data-tenant-row="${escapeHtml(t.slug)}">
      <td>${escapeHtml(t.slug)}</td>
      <td>${escapeHtml(t.environment)}</td>
      <td>${t.is_active ? `<span class="health-badge healthy"><span class="dot"></span>Active</span>` : `<span class="health-badge down"><span class="dot"></span>Inactive</span>`}</td>
      <td><button class="btn btn-outline" data-toggle-tenant="${escapeHtml(t.slug)}" data-next-active="${!t.is_active}">${t.is_active ? "Deactivate" : "Activate"}</button></td>
    </tr>
  `).join("");

  qsa("[data-toggle-tenant]", body).forEach((btn) => {
    btn.addEventListener("click", async () => {
      const slug = btn.dataset.toggleTenant;
      const nextActive = btn.dataset.nextActive === "true";
      btn.disabled = true;
      try {
        await api(`/tenants/${encodeURIComponent(slug)}`, { method: "PATCH", body: JSON.stringify({ is_active: nextActive }) });
        await loadAndRenderTenants();
      } catch (err) {
        showBanner(err.message || "Could not update tenant.");
        btn.disabled = false;
      }
    });
  });
}

async function loadAndRenderTenants() {
  renderTenantsTable(await api("/tenants"));
}

/* ---------------- tenant-scoped settings (General / Model & Prompt) ----------------
 * Both cards act on "whichever tenant is currently selected in the topbar
 * dropdown" -- the same lookup investigate.js's doInvestigate() already
 * uses at submit time, so there's one source of truth for "current tenant"
 * across the app, not a second picker duplicated in Settings.
 */
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
    showBanner(err.message || "Could not load tenant settings.");
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
      showBanner(`Tenant "${slug}" added.`);
    } catch (err) {
      errorEl.textContent = err.message || "Could not add tenant.";
      errorEl.classList.remove("hidden");
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "Add Tenant";
    }
  });
}

let settingsWired = false;

export async function renderSettingsPage() {
  updateSettingsIdentity();
  if (!settingsWired) {
    initSettingsTabs();
    initAddTenantModal();
    initGeneralSettingsForm();
    initModelSettingsForm();
    settingsWired = true;
  }
  await loadAndRenderTenants();
  await loadAndRenderTenantSettings();
}
