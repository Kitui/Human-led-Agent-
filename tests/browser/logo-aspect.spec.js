import { test, expect } from "@playwright/test";

const BASE_URL = process.env.CORRELACT_BASE_URL || "http://127.0.0.1:8000";

async function expectLogoAspect(page) {
  const logo = page.locator(".login-brand img");
  await expect(logo).toBeVisible();
  const metrics = await logo.evaluate((img) => {
    const rect = img.getBoundingClientRect();
    const parent = img.parentElement?.getBoundingClientRect();
    const style = getComputedStyle(img);
    return {
      naturalRatio: img.naturalWidth / img.naturalHeight,
      renderedRatio: rect.width / rect.height,
      width: rect.width,
      height: rect.height,
      parentWidth: parent?.width || 0,
      parentHeight: parent?.height || 0,
      transform: style.transform,
    };
  });

  expect(metrics.width).toBeGreaterThanOrEqual(190);
  expect(metrics.height).toBeGreaterThanOrEqual(105);
  expect(Math.abs(metrics.renderedRatio - metrics.naturalRatio)).toBeLessThan(0.03);
  expect(Math.abs(metrics.parentWidth - metrics.width)).toBeLessThan(2);
  expect(Math.abs(metrics.parentHeight - metrics.height)).toBeLessThan(2);
  expect(metrics.transform).toBe("none");
}

test("supplied CorrelAct logo cannot collapse into a thin strip at reported viewport", async ({ page }) => {
  await page.setViewportSize({ width: 1636, height: 929 });
  await page.goto(`${BASE_URL}/app`, { waitUntil: "domcontentloaded" });
  await expect(page.locator("#login-screen")).toHaveClass(/correlact-login-ready/);
  await expectLogoAspect(page);

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator("#login-screen")).toHaveClass(/correlact-login-ready/);
  await expectLogoAspect(page);

  const geometry = await page.evaluate(() => ({
    overflowX: document.documentElement.scrollWidth > window.innerWidth + 2,
    overflowY: document.documentElement.scrollHeight > window.innerHeight + 2,
    principlesBottom: document.querySelector(".login-principles")?.getBoundingClientRect().bottom || 0,
    panelBottom: document.querySelector(".login-panel")?.getBoundingClientRect().bottom || 0,
    viewportHeight: window.innerHeight,
  }));
  expect(geometry.overflowX).toBe(false);
  expect(geometry.overflowY).toBe(false);
  expect(geometry.principlesBottom).toBeLessThanOrEqual(geometry.viewportHeight + 1);
  expect(geometry.panelBottom).toBeLessThanOrEqual(geometry.viewportHeight + 1);
});
