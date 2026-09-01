/* CorrelAct — interaction layer for read-only Settings capability cards.
 *
 * These controls intentionally reuse existing, real product surfaces instead
 * of exposing fake configuration. The completion cards remain truthful status
 * views, while users can refresh, inspect, or navigate to the place where the
 * underlying capability is actually operated.
 */
import { qs, escapeHtml, showBanner } from "./shared.js";
import { currentTenantIds, currentUsername } from "./auth.js";
import { renderSettingsPage } from "./settings.js";

function ensureSettingsInteractionStyles() {
  if (document.getElementById("correlact-settings-interaction-styles")) return;
  const style = document.createElement("style");
  style.id = "correlact-settings-interaction-styles";
  style.textContent = `
    /* Grid items must be allowed to shrink when the sidebar is expanded.
       auto-fit responds to the actual content width, not only viewport width. */
    [data-page="settings"] .settings-row {
      min-width: 0;
      grid-template-columns: repeat(auto-fit, minmax(min(100%, 310px), 1fr));
    }
    [data-page="settings"] .settings-row-2col {
      grid-template-columns: repeat(auto-fit, minmax(min(100%, 380px), 1fr));
    }
    [data-page="settings"] .settings-row > .card {
      min-width: 0;
      max-width: 100%;
    }
    [data-page="settings"] .settings-completion-card,
    [data-page="settings"] #settings-section-tenants {
      min-width: 0;
    }
    [data-page="settings"] #settings-section-tenants .table-scroll {
      width: 100%;
      max-width: 100%;
      min-width: 0;
      overflow-x: auto;
      overscroll-behavior-inline: contain;
    }
    [data-page="settings"] #settings-section-tenants table {
      width: 100%;
      max-width: 100%;
    }
    [data-page="settings"] #settings-section-tenants th,
    [data-page="settings"] #settings-section-tenants td {
      overflow-wrap: anywhere;
    }
    [data-page="settings"] .settings-access-note {
      width: 100%;
      max-width: 100%;
      min-width: 0;
    }
    [data-page="settings"] .settings-access-note > span:last-child {
      min-width: 0;
      overflow-wrap: anywhere;
    }

    .settings-card-actions {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 7px;
      flex-wrap: wrap;
      margin-left: auto;
    }
    .settings-action-btn,
    .settings-action-link {
      min-height: 30px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      padding: 6px 9px;
      border: 1px solid var(--ca-border, #dfe5ee);
      border-radius: 8px;
      background: var(--ca-surface, #fff);
      color: var(--ca-primary, #2457d6);
      font-size: 11.5px;
      font-weight: 720;
      line-height: 1;
      text-decoration: none;
      cursor: pointer;
      white-space: nowrap;
    }
    .settings-action-btn:hover:not(:disabled),
    .settings-action-link:hover {
      border-color: rgba(36, 87, 214, .28);
      background: var(--ca-primary-soft, #eef4ff);
    }
    .settings-action-btn:disabled {
      cursor: wait;
      opacity: .65;
    }
    .settings-completion-card .operational-item {
      border-radius: 7px;
      transition: background-color 140ms ease, padding-inline 140ms ease;
    }
    .settings-completion-card .operational-item:hover {
      background: var(--ca-surface-muted, #f8fafc);
      padding-inline: 8px;
    }
    .settings-session-panel {
      margin-top: 14px;
      padding: 13px 14px;
      border: 1px solid var(--ca-border, #dfe5ee);
      border-radius: 10px;
      background: var(--ca-surface-muted, #f8fafc);
    }
    .settings-session-panel[hidden] { display: none; }
    .settings-session-grid {
      display: grid;
      grid-template-columns: minmax(100px, .55fr) minmax(0, 1.45fr);
      gap: 9px 14px;
      font-size: 12.5px;
      line-height: 1.45;
    }
    .settings-session-grid .label {
      color: var(--ca-muted, #64748b);
      font-weight: 650;
    }
    .settings-session-grid .value {
      color: var(--ca-text, #172033);
      overflow-wrap: anywhere;
    }

    @media (max-width: 760px) {
      .settings-card-actions {
        width: 100%;
        justify-content: flex-start;
        margin-left: 0;
      }
      .settings-action-btn,
      .settings-action-link {
        min-height: 34px;
      }
      .settings-session-grid { grid-template-columns: 1fr; gap: 3px; }
      .settings-session-grid .value { margin-bottom: 7px; }
    }
  `;
  document.head.appendChild(style);
}

function actionGroup(card) {
  const head = card?.querySelector(".card-head");
  if (!head) return null;
  let group = head.querySelector(".settings-card-actions");
  if (group) return group;

  group = document.createElement("div");
  group.className = "settings-card-actions";
  const heading = head.querySelector("h2");
  Array.from(head.children).forEach((child) => {
    if (child !== heading && child !== group) group.appendChild(child);
  });
  head.appendChild(group);
  return group;
}

function ensureLink(cardSelector, key, label, href, title) {
  const card = qs(cardSelector);
  const group = actionGroup(card);
  if (!group || group.querySelector(`[data-settings-action="${key}"]`)) return;
  const link = document.createElement("a");
  link.className = "settings-action-link";
  link.dataset.settingsAction = key;
  link.href = href;
  link.textContent = label;
  if (title) link.title = title;
  group.appendChild(link);
}

function ensureButton(cardSelector, key, label, title, handler) {
  const card = qs(cardSelector);
  const group = actionGroup(card);
  if (!group || group.querySelector(`[data-settings-action="${key}"]`)) return;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "settings-action-btn";
  button.dataset.settingsAction = key;
  button.textContent = label;
  if (title) button.title = title;
  button.addEventListener("click", () => handler(button));
  group.appendChild(button);
}

async function refreshSettings(button) {
  const original = button.textContent;
  button.disabled = true;
  button.textContent = "Refreshing…";
  try {
    await renderSettingsPage();
    enhanceSettingsPage();
    showBanner("Operational status refreshed.");
  } catch (err) {
    showBanner(err?.message || "Could not refresh operational status.");
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}

function toggleSessionScope(button) {
  const card = qs("#settings-section-security");
  if (!card) return;
  let panel = card.querySelector(".settings-session-panel");
  if (!panel) {
    panel = document.createElement("div");
    panel.className = "settings-session-panel";
    panel.setAttribute("hidden", "");
    const organizations = currentTenantIds();
    panel.innerHTML = `
      <div class="settings-session-grid">
        <span class="label">Signed in as</span>
        <span class="value">${escapeHtml(currentUsername() || "Unknown")}</span>
        <span class="label">Organization scope</span>
        <span class="value">${escapeHtml(organizations.length ? organizations.join(", ") : "No organizations assigned")}</span>
        <span class="label">Session protection</span>
        <span class="value">HttpOnly browser session + authenticated API access</span>
      </div>`;
    card.appendChild(panel);
  }

  const willOpen = panel.hasAttribute("hidden");
  if (willOpen) panel.removeAttribute("hidden");
  else panel.setAttribute("hidden", "");
  button.setAttribute("aria-expanded", willOpen ? "true" : "false");
  button.textContent = willOpen ? "Hide session" : "Session scope";
}

export function enhanceSettingsPage() {
  const page = qs('section.page[data-page="settings"]');
  if (!page) return;
  ensureSettingsInteractionStyles();

  ensureButton(
    "#settings-section-environment",
    "refresh-status",
    "Refresh status",
    "Reload live API, run, guardrail, MCP, and evaluation signals.",
    refreshSettings,
  );

  ensureLink(
    "#settings-section-approval",
    "review-approvals",
    "Review approvals",
    "#approvals",
    "Open the human approval queue.",
  );

  ensureLink(
    "#settings-section-integrations",
    "inspect-capabilities",
    "Inspect activity",
    "#traces",
    "Inspect real tool and execution activity in Traces.",
  );

  ensureLink(
    "#settings-section-observability",
    "open-traces",
    "Traces",
    "#traces",
    "Open run traces and tool-call activity.",
  );
  ensureLink(
    "#settings-section-observability",
    "open-evals",
    "Evals",
    "#evals",
    "Open persisted evaluation history and quality results.",
  );

  ensureButton(
    "#settings-section-security",
    "session-scope",
    "Session scope",
    "Show the current authenticated user and allowed organizations.",
    toggleSessionScope,
  );

  const orgCard = qs("#settings-section-tenants");
  const addOrgButton = qs("#add-tenant-btn");
  const adminControlsVisible = addOrgButton && !addOrgButton.classList.contains("hidden");
  if (!adminControlsVisible) {
    ensureLink(
      "#settings-section-tenants",
      "view-org-runs",
      "View runs",
      "#runs",
      "Open runs for your current organization scope.",
    );
  } else if (orgCard) {
    /* Calling actionGroup moves the existing real Add Organization button
       into the same responsive action cluster without replacing its handler. */
    actionGroup(orgCard);
  }
}