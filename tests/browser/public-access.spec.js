import { test, expect } from "@playwright/test";

const BASE_URL = process.env.CORRELACT_BASE_URL || "http://127.0.0.1:8000";

test.use({
  screenshot: "only-on-failure",
  trace: "retain-on-failure",
});

for (const viewport of [
  { width: 1440, height: 1000 },
  { width: 1024, height: 900 },
  { width: 390, height: 844 },
]) {
  test(`public landing is anonymous and contained at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const response = await page.goto(`${BASE_URL}/`, { waitUntil: "networkidle" });

    expect(response?.status()).toBe(200);
    await expect(page).toHaveTitle(/CorrelAct/);
    await expect(page.getByRole("heading", { name: /Operational intelligence where/i })).toBeVisible();
    await expect(page.locator('a[href="/app"]').first()).toBeVisible();
    await expect(page.locator('input[type="password"]')).toHaveCount(0);
    await expect(page.locator("#login-screen")).toHaveCount(0);

    const hasOverflow = await page.evaluate(() =>
      document.documentElement.scrollWidth > window.innerWidth + 2,
    );
    expect(hasOverflow).toBe(false);
  });
}

test("secured application remains behind sign-in", async ({ page, request }) => {
  const protectedResponse = await request.get(`${BASE_URL}/runs`);
  expect(protectedResponse.status()).toBe(401);

  await page.goto(`${BASE_URL}/app`, { waitUntil: "domcontentloaded" });
  await expect(page.locator("#login-screen")).toBeVisible();
  await expect(page.locator("#login-username")).toBeVisible();
  await expect(page.locator("#login-password")).toBeVisible();
  await expect(page.locator("#app-root")).toHaveClass(/hidden/);
});

test("public CTA opens the secured application", async ({ page }) => {
  await page.goto(`${BASE_URL}/`, { waitUntil: "domcontentloaded" });
  await page.locator('a[href="/app"]').first().click();
  await expect(page).toHaveURL(`${BASE_URL}/app`);
  await expect(page.locator("#login-screen")).toBeVisible();
});
