import { test, expect } from "@playwright/test";

const BASE_URL = process.env.CORRELACT_BASE_URL || "http://127.0.0.1:8000";
const ADMIN_USERNAME = "admin@correlact.com";
const ADMIN_PASSWORD = "admin-browser-test-pass";

async function signIn(page, username = ADMIN_USERNAME, password = ADMIN_PASSWORD) {
  await page.locator("#login-username").fill(username);
  await page.locator("#login-password").fill(password);
  await page.locator("#login-submit-btn").click();
  await expect(page.locator("#app-root")).not.toHaveClass(/hidden/);
}

async function createProposal(page, tenantId, suffix) {
  return page.evaluate(async ({ tenantId, suffix }) => {
    const response = await fetch("/webmcp/action-points", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({
        tenant_id: tenantId,
        issue: `${tenantId} browser scope ${suffix}`,
        title: `${tenantId} scoped proposal ${suffix}`,
        issue_type: "Browser scope regression",
        summary: `Synthetic browser-test proposal for ${tenantId}`,
        priority: "high",
        recommended_action: "Verify organization-scoped rendering",
        confidence: 0.99,
        target_team: "Operations",
        evidence: [{ source: "crm", reference: `${tenantId}-${suffix}`, finding: `Scoped evidence for ${tenantId}` }],
      }),
    });
    if (!response.ok) throw new Error(`proposal failed: ${response.status}`);
    return response.json();
  }, { tenantId, suffix });
}

for (const viewport of [
  { width: 1440, height: 1000 },
  { width: 1024, height: 900 },
  { width: 390, height: 844 },
]) {
  test(`secured login uses CorrelAct theme and stays contained at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto(`${BASE_URL}/app`, { waitUntil: "domcontentloaded" });

    await expect(page.locator("#login-screen")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
    await expect(page.getByText("Investigate.", { exact: true })).toBeVisible();
    await expect(page.getByText("Correlate.", { exact: true })).toBeVisible();
    await expect(page.getByText("Act.", { exact: true })).toBeVisible();
    await expect(page.getByText(/Sign in with SSO/i)).toHaveCount(0);
    await expect(page.getByText(/Forgot password/i)).toHaveCount(0);

    const primary = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--primary").trim());
    expect(primary.toLowerCase()).toBe("#ef2b32");

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2);
    expect(overflow).toBe(false);

    await page.locator("#login-password").fill("visible-test");
    await expect(page.locator("#login-password")).toHaveAttribute("type", "password");
    await page.locator("#login-password-toggle").click();
    await expect(page.locator("#login-password")).toHaveAttribute("type", "text");
    await page.locator("#login-password-toggle").click();
    await expect(page.locator("#login-password")).toHaveAttribute("type", "password");
  });
}

test("admin organization selector re-scopes dashboard runs and visuals", async ({ page }) => {
  const observedRunRequests = [];
  page.on("request", (request) => {
    try {
      const url = new URL(request.url());
      if (url.pathname === "/runs" && request.method() === "GET") {
        observedRunRequests.push(url.searchParams.get("tenant_id"));
      }
    } catch (_) { /* ignore */ }
  });

  await page.goto(`${BASE_URL}/app#investigate`, { waitUntil: "domcontentloaded" });
  await signIn(page);
  await expect(page.locator("#tenant-select-label")).toHaveText("NorthStar");

  await createProposal(page, "NorthStar", "one");
  await createProposal(page, "Neptune", "one");
  await createProposal(page, "Neptune", "two");

  await page.locator('.nav-item[data-page="dashboard"]').click();
  await expect(page.locator('section.page[data-page="dashboard"]')).toHaveClass(/active/);
  await expect(page.locator("#dashboard-runs-table tbody tr")).toHaveCount(1);
  await expect(page.locator("#dashboard-runs-table tbody tr td:nth-child(2)")).toHaveText(["NorthStar"]);
  await expect(page.locator("#dashboard-stats .stat-card").first().locator(".stat-value")).toHaveText("1");

  await page.locator("#tenant-select").click();
  await page.locator('#tenant-menu button[data-tenant="Neptune"]').click();
  await expect(page.locator("#tenant-select-label")).toHaveText("Neptune");
  await expect(page.locator("#dashboard-runs-table tbody tr")).toHaveCount(2);
  await expect(page.locator("#dashboard-runs-table tbody tr td:nth-child(2)")).toHaveText(["Neptune", "Neptune"]);
  await expect(page.locator("#dashboard-stats .stat-card").first().locator(".stat-value")).toHaveText("2");
  await expect(page.locator("#dashboard-runs-table")).not.toContainText("NorthStar");

  expect(observedRunRequests).toContain("NorthStar");
  expect(observedRunRequests).toContain("Neptune");

  await page.locator('.nav-item[data-page="runs"]').click();
  await expect(page.locator('section.page[data-page="runs"]')).toHaveClass(/active/);
  await expect(page.locator("#runs-table-full tbody tr")).toHaveCount(2);
  await expect(page.locator("#runs-table-full tbody tr td:nth-child(2)")).toHaveText(["Neptune", "Neptune"]);
  await expect(page.locator("#runs-table-full")).not.toContainText("NorthStar");
});
