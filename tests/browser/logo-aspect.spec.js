import { createHash } from "node:crypto";
import { test, expect } from "@playwright/test";

const BASE_URL = process.env.CORRELACT_BASE_URL || "http://127.0.0.1:8000";
const LOGO_PATH = "/assets/correlact-logo-user.png?v=20260901b";
const EXPECTED_LOGO_SHA256 = "c376f21d389802a42fc7454184021f7c1ffcd8fc9186b2c092be99bec19abfd2";

async function expectLogoAspect(page) {
  const logo = page.locator(".login-brand img");
  await expect(logo).toBeVisible();
  await expect(logo).toHaveAttribute("src", LOGO_PATH);

  const metrics = await logo.evaluate((img) => {
    const rect = img.getBoundingClientRect();
    const parent = img.parentElement?.getBoundingClientRect();
    const style = getComputedStyle(img);
    return {
      naturalWidth: img.naturalWidth,
      naturalHeight: img.naturalHeight,
      naturalRatio: img.naturalWidth / img.naturalHeight,
      renderedRatio: rect.width / rect.height,
      width: rect.width,
      height: rect.height,
      parentWidth: parent?.width || 0,
      parentHeight: parent?.height || 0,
      transform: style.transform,
    };
  });

  expect(metrics.naturalWidth).toBe(240);
  expect(metrics.naturalHeight).toBe(135);
  expect(metrics.width).toBeGreaterThanOrEqual(190);
  expect(metrics.height).toBeGreaterThanOrEqual(105);
  expect(Math.abs(metrics.renderedRatio - metrics.naturalRatio)).toBeLessThan(0.03);
  expect(Math.abs(metrics.parentWidth - metrics.width)).toBeLessThan(2);
  expect(Math.abs(metrics.parentHeight - metrics.height)).toBeLessThan(2);
  expect(metrics.transform).toBe("none");

  const response = await page.request.get(`${BASE_URL}${LOGO_PATH}`);
  expect(response.ok()).toBe(true);
  const body = await response.body();
  expect(createHash("sha256").update(body).digest("hex")).toBe(EXPECTED_LOGO_SHA256);
}

async function expectInputIconSpacing(page, inputSelector) {
  const metrics = await page.locator(inputSelector).evaluate((input) => {
    const wrap = input.closest(".login-input-wrap");
    const icon = wrap?.querySelector(".login-input-icon");
    const inputRect = input.getBoundingClientRect();
    const iconRect = icon?.getBoundingClientRect();
    const style = getComputedStyle(input);
    const paddingLeft = Number.parseFloat(style.paddingLeft);
    const paddingRight = Number.parseFloat(style.paddingRight);
    return {
      paddingLeft,
      paddingRight,
      marginBottom: Number.parseFloat(style.marginBottom),
      textStart: inputRect.left + paddingLeft,
      iconRight: iconRect?.right || inputRect.left,
    };
  });

  expect(metrics.paddingLeft).toBeGreaterThanOrEqual(50);
  expect(metrics.paddingRight).toBeGreaterThanOrEqual(50);
  expect(metrics.marginBottom).toBe(0);
  expect(metrics.textStart - metrics.iconRight).toBeGreaterThanOrEqual(10);
}

async function expectStableLogin(page) {
  await expect(page.locator("#login-screen")).toHaveClass(/correlact-login-ready/);
  await expectLogoAspect(page);
  await expectInputIconSpacing(page, "#login-username");
  await expectInputIconSpacing(page, "#login-password");
  await expect(page.locator('link[data-correlact-fixes]')).toHaveAttribute("href", /correlact-fixes\.css\?v=20260901b$/);
}

test("supplied CorrelAct logo and login inputs render correctly at reported viewport", async ({ page }) => {
  await page.setViewportSize({ width: 1636, height: 929 });
  await page.goto(`${BASE_URL}/app`, { waitUntil: "domcontentloaded" });
  await expectStableLogin(page);

  await page.reload({ waitUntil: "domcontentloaded" });
  await expectStableLogin(page);

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
