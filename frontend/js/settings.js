/* Human-Led Agent Lab — Settings page: identity, tab switching, Tenant
 * Management (list / create / activate / deactivate). Only the General tab
 * has real functionality this phase — Model & Prompt / Approval Policy /
 * Integrations / Observability are per-tenant settings planned for later
 * phases; Security is a permanent placeholder, no real feature planned. */
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
    settingsWired = true;
  }
  await loadAndRenderTenants();
}
