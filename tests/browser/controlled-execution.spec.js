import { test, expect } from "@playwright/test";

const BASE_URL = process.env.CORRELACT_BASE_URL || "http://127.0.0.1:8000";
const USERNAME = "user@northstar.com";
const PASSWORD = "northstar-browser-test-pass";

async function signIn(page) {
  await page.goto(`${BASE_URL}/app#approvals`, { waitUntil: "domcontentloaded" });
  await page.locator("#login-username").fill(USERNAME);
  await page.locator("#login-password").fill(PASSWORD);
  await page.locator("#login-submit-btn").click();
  await expect(page.locator("#app-root")).not.toHaveClass(/hidden/);
}

async function api(page, path, options = {}) {
  return page.evaluate(async ({ path, options }) => {
    const response = await fetch(path, {
      credentials: "same-origin",
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
    });
    let body = null;
    try { body = await response.json(); } catch (_) { /* no body */ }
    return { ok: response.ok, status: response.status, body };
  }, { path, options });
}

function crmProposal() {
  return {
    tenant_id: "NorthStar",
    issue: "ACME renewal needs a governed CRM escalation.",
    title: "Escalate ACME renewal in CRM",
    issue_type: "Renewal follow-up",
    summary: "CRM evidence shows ACME renewal is blocked and needs an explicit escalation status before follow-up.",
    priority: "high",
    recommended_action: "Update the CRM renewal status from blocked to escalation_open so the approved follow-up is visible to the account team.",
    confidence: 0.99,
    target_team: "Account Management",
    execution: {
      type: "update_crm_status",
      crm_expected_status: "blocked",
      crm_target_status: "escalation_open",
    },
    evidence: [
      {
        source: "crm",
        reference: "ACME",
        finding: "Account is active and renewal_status is blocked.",
      },
    ],
  };
}

test("same human gate governs a distinct CRM write and exposes the exact approved transition", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await signIn(page);

  const before = await api(page, "/crm/customers/ACME?tenant_id=NorthStar");
  expect(before.status).toBe(200);
  expect(before.body.customer.renewal_status).toBe("blocked");

  const submitted = await api(page, "/webmcp/action-points", {
    method: "POST",
    body: JSON.stringify(crmProposal()),
  });
  expect(submitted.status).toBe(200);
  expect(submitted.body.status).toBe("awaiting_approval");
  expect(submitted.body.action_point.execution.type).toBe("update_crm_status");

  // Refresh the real Approvals surface and verify the reviewer sees exactly
  // which capability and state transition would be authorized.
  await page.locator('.nav-item[data-page="approvals"]').click();
  await expect(page.locator('section.page[data-page="approvals"]')).toHaveClass(/active/);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator("#app-root")).not.toHaveClass(/hidden/);
  await expect(page.locator("#approval-detail-card")).toContainText("Execution Capability");
  await expect(page.locator("#approval-detail-card")).toContainText("update_crm_status");
  await expect(page.locator("#approval-detail-card")).toContainText("renewal_status: blocked → escalation_open");
  await expect(page.locator("#approval-approve-btn")).toContainText("Approve exact update_crm_status");

  await page.locator("#approval-approve-btn").click();
  await expect(page.locator("#approval-detail-card")).toContainText("Waiting for WebMCP update_crm_status");

  // Approval is authorization only: it must not mutate CRM state.
  const afterApproval = await api(page, "/crm/customers/ACME?tenant_id=NorthStar");
  expect(afterApproval.status).toBe(200);
  expect(afterApproval.body.customer.renewal_status).toBe("blocked");

  // The separate Tasks surface gets the approved capability and executes it.
  await page.goto(`${BASE_URL}/tasks/`, { waitUntil: "domcontentloaded" });
  await expect(page.locator(".run-card")).toContainText("update_crm_status");
  await expect(page.locator(".run-card")).toContainText("renewal_status: blocked → escalation_open");
  const executeButton = page.getByRole("button", { name: "Execute CRM status update" });
  await expect(executeButton).toBeVisible();
  await executeButton.click();
  await expect(page.locator("#execution-result")).toContainText("Updated CRM renewal status for ACME from blocked to escalation_open");

  const afterExecution = await api(page, "/crm/customers/ACME?tenant_id=NorthStar");
  expect(afterExecution.status).toBe(200);
  expect(afterExecution.body.customer.renewal_status).toBe("escalation_open");

  // A repeated invocation is accepted as the same completed run and cannot
  // perform a second business-state transition.
  const repeated = await api(page, "/webmcp/crm-status", {
    method: "POST",
    body: JSON.stringify({
      run_id: submitted.body.run_id,
      tenant_id: "NorthStar",
      customer_name: "ACME",
    }),
  });
  expect(repeated.status).toBe(200);
  expect(repeated.body.status).toBe("completed");
  expect(repeated.body.idempotency_key).toBeTruthy();

  const afterRepeat = await api(page, "/crm/customers/ACME?tenant_id=NorthStar");
  expect(afterRepeat.body.customer.renewal_status).toBe("escalation_open");
});
