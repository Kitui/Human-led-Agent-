import { test, expect } from "@playwright/test";

const BASE_URL = process.env.CORRELACT_BASE_URL || "http://127.0.0.1:8000";
const ADMIN_USERNAME = "admin@correlact.com";
const ADMIN_PASSWORD = "admin-browser-test-pass";
const LOGO_PATH = "/assets/correlact-logo.png?v=20260901d";

async function signIn(page, username = ADMIN_USERNAME, password = ADMIN_PASSWORD) {
  await page.locator("#login-username").fill(username);
  await page.locator("#login-password").fill(password);
  await page.locator("#login-submit-btn").click();
  await expect(page.locator("#app-root")).not.toHaveClass(/hidden/);
}

// submit_action_point now validates CRM evidence against a real customer
// record for the organization (see agent_lab/api.py), so this synthetic
// scope-check proposal must bind to the tenant's actual reference customer
// instead of a made-up "<tenant>-<suffix>" string.
const REFERENCE_CUSTOMER_BY_TENANT = { NorthStar: "ACME", Neptune: "GreenMart" };

async function createProposal(page, tenantId, suffix) {
  return page.evaluate(async ({ tenantId, suffix, customerName }) => {
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
        evidence: [{ source: "crm", reference: customerName, finding: `Scoped evidence for ${tenantId}` }],
      }),
    });
    if (!response.ok) throw new Error(`proposal failed: ${response.status}`);
    return response.json();
  }, { tenantId, suffix, customerName: REFERENCE_CUSTOMER_BY_TENANT[tenantId] });
}

for (const viewport of [
  { width: 1920, height: 940 },
  { width: 1440, height: 1000 },
  { width: 1366, height: 680 },
  { width: 1024, height: 900 },
  { width: 390, height: 844 },
]) {
  test(`secured login uses supplied CorrelAct logo and stays contained at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.addInitScript(() => {
      window.__correlactCLS = 0;
      try {
        const observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            if (!entry.hadRecentInput) window.__correlactCLS += entry.value;
          }
        });
        observer.observe({ type: "layout-shift", buffered: true });
      } catch (_) { /* layout-shift is Chromium-only; this suite runs Chromium */ }
    });

    await page.setViewportSize(viewport);
    await page.goto(`${BASE_URL}/app`, { waitUntil: "domcontentloaded" });

    await expect(page.locator("#login-screen")).toHaveClass(/correlact-login-ready/);
    await expect(page.locator("#login-screen")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
    await expect(page.getByText("Human-led", { exact: true })).toBeVisible();
    await expect(page.getByText("operational intelligence", { exact: true })).toBeVisible();
    await expect(page.getByText(/Sign in with SSO/i)).toHaveCount(0);
    await expect(page.getByText(/Forgot password/i)).toHaveCount(0);

    const primary = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--primary").trim());
    expect(primary.toLowerCase()).toBe("#ef2b32");

    const logo = page.locator(".login-brand img");
    await expect(logo).toBeVisible();
    await expect(logo).toHaveAttribute("src", LOGO_PATH);
    const logoMetrics = await logo.evaluate((img) => ({
      naturalWidth: img.naturalWidth,
      naturalHeight: img.naturalHeight,
      width: img.getBoundingClientRect().width,
      height: img.getBoundingClientRect().height,
    }));
    expect(logoMetrics.naturalWidth).toBe(240);
    expect(logoMetrics.naturalHeight).toBe(135);
    expect(logoMetrics.width).toBeGreaterThan(150);
    expect(logoMetrics.height).toBeGreaterThan(70);

    const logoResponse = await page.request.get(`${BASE_URL}${LOGO_PATH}`);
    expect(logoResponse.ok()).toBe(true);
    expect((await logoResponse.body()).subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2);
    expect(overflow).toBe(false);

    if (viewport.width >= 981) {
      const geometry = await page.evaluate(() => {
        const principles = document.querySelector(".login-principles")?.getBoundingClientRect();
        const panel = document.querySelector(".login-panel")?.getBoundingClientRect();
        return {
          docTooTall: document.documentElement.scrollHeight > window.innerHeight + 2,
          principlesBottom: principles?.bottom ?? 0,
          panelBottom: panel?.bottom ?? 0,
          viewportHeight: window.innerHeight,
        };
      });
      expect(geometry.docTooTall).toBe(false);
      expect(geometry.principlesBottom).toBeLessThanOrEqual(geometry.viewportHeight + 1);
      expect(geometry.panelBottom).toBeLessThanOrEqual(geometry.viewportHeight + 1);
    }

    await page.waitForTimeout(250);
    const cls = await page.evaluate(() => window.__correlactCLS || 0);
    expect(cls).toBeLessThan(0.08);

    await page.locator("#login-password").fill("visible-test");
    await expect(page.locator("#login-password")).toHaveAttribute("type", "password");
    await page.locator("#login-password-toggle").click();
    await expect(page.locator("#login-password")).toHaveAttribute("type", "text");
    await page.locator("#login-password-toggle").click();
    await expect(page.locator("#login-password")).toHaveAttribute("type", "password");
  });
}

test("hard refresh does not expose the legacy login or reflow the final composition", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 940 });
  await page.goto(`${BASE_URL}/app`, { waitUntil: "domcontentloaded" });
  await expect(page.locator("#login-screen")).toHaveClass(/correlact-login-ready/);

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator("#login-screen")).toHaveClass(/correlact-login-ready/);
  await expect(page.locator(".login-brand img")).toBeVisible();
  await expect(page.locator(".modal-card.login-card")).toHaveCount(0);

  const finalGeometry = await page.evaluate(() => {
    const story = document.querySelector(".login-story")?.getBoundingClientRect();
    const principles = document.querySelector(".login-principles")?.getBoundingClientRect();
    const panel = document.querySelector(".login-panel")?.getBoundingClientRect();
    return {
      overflowX: document.documentElement.scrollWidth > window.innerWidth + 2,
      overflowY: document.documentElement.scrollHeight > window.innerHeight + 2,
      storyBottom: story?.bottom ?? 0,
      principlesBottom: principles?.bottom ?? 0,
      panelBottom: panel?.bottom ?? 0,
      viewportHeight: window.innerHeight,
    };
  });
  expect(finalGeometry.overflowX).toBe(false);
  expect(finalGeometry.overflowY).toBe(false);
  expect(finalGeometry.storyBottom).toBeLessThanOrEqual(finalGeometry.viewportHeight + 1);
  expect(finalGeometry.principlesBottom).toBeLessThanOrEqual(finalGeometry.viewportHeight + 1);
  expect(finalGeometry.panelBottom).toBeLessThanOrEqual(finalGeometry.viewportHeight + 1);
});

async function tenantRunCount(page, tenantId) {
  return page.evaluate(async (tenantId) => {
    const response = await fetch(`/runs?tenant_id=${encodeURIComponent(tenantId)}`, { credentials: "same-origin" });
    const runs = await response.json();
    return Array.isArray(runs) ? runs.length : 0;
  }, tenantId);
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

  // NorthStar and Neptune may already carry runs created by other browser
  // specs that exercise a real controlled-execution flow against the shared
  // fixtures (e.g. tests/browser/controlled-execution.spec.js). Assert
  // relative to that baseline instead of an absolute count so this test
  // verifies "the tenant selector shows exactly this tenant's runs," not "no
  // sibling spec has ever touched NorthStar/Neptune."
  const northStarBaseline = await tenantRunCount(page, "NorthStar");
  const neptuneBaseline = await tenantRunCount(page, "Neptune");

  await createProposal(page, "NorthStar", "one");
  await createProposal(page, "Neptune", "one");
  await createProposal(page, "Neptune", "two");

  await page.locator('.nav-item[data-page="dashboard"]').click();
  await expect(page.locator('section.page[data-page="dashboard"]')).toHaveClass(/active/);
  // toHaveText(array) retries until the DOM settles; a one-shot
  // allTextContents() read right after a navigation/re-render can catch a
  // transient pre-render state and fail on an otherwise-correct page.
  const northStarExpectedCount = northStarBaseline + 1;
  await expect(page.locator("#dashboard-runs-table tbody tr")).toHaveCount(northStarExpectedCount);
  await expect(page.locator("#dashboard-runs-table tbody tr td:nth-child(2)"))
    .toHaveText(Array(northStarExpectedCount).fill("NorthStar"));
  await expect(page.locator("#dashboard-stats .stat-card").first().locator(".stat-value")).toHaveText(String(northStarExpectedCount));

  await page.locator("#tenant-select").click();
  await page.locator('#tenant-menu button[data-tenant="Neptune"]').click();
  await expect(page.locator("#tenant-select-label")).toHaveText("Neptune");
  const neptuneExpectedCount = neptuneBaseline + 2;
  await expect(page.locator("#dashboard-runs-table tbody tr")).toHaveCount(neptuneExpectedCount);
  await expect(page.locator("#dashboard-runs-table tbody tr td:nth-child(2)"))
    .toHaveText(Array(neptuneExpectedCount).fill("Neptune"));
  await expect(page.locator("#dashboard-stats .stat-card").first().locator(".stat-value")).toHaveText(String(neptuneExpectedCount));
  await expect(page.locator("#dashboard-runs-table")).not.toContainText("NorthStar");

  expect(observedRunRequests).toContain("NorthStar");
  expect(observedRunRequests).toContain("Neptune");

  await page.locator('.nav-item[data-page="runs"]').click();
  await expect(page.locator('section.page[data-page="runs"]')).toHaveClass(/active/);
  await expect(page.locator("#runs-table-full tbody tr")).toHaveCount(neptuneExpectedCount);
  await expect(page.locator("#runs-table-full tbody tr td:nth-child(2)"))
    .toHaveText(Array(neptuneExpectedCount).fill("Neptune"));
  await expect(page.locator("#runs-table-full")).not.toContainText("NorthStar");
});
