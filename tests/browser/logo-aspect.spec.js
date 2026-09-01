import { test, expect } from "@playwright/test";

const BASE_URL = process.env.CORRELACT_BASE_URL || "http://127.0.0.1:8000";
const LOGO_PATH = "/assets/correlact-logo.png?v=20260901d";

async function expectLogoVisibleAndUnclipped(page) {
  const logo = page.locator(".login-brand img");
  await expect(logo).toBeVisible();
  await expect(logo).toHaveAttribute("src", LOGO_PATH);

  const metrics = await logo.evaluate((img) => {
    const rect = img.getBoundingClientRect();
    const parent = img.parentElement?.getBoundingClientRect();
    const style = getComputedStyle(img);

    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let minX = canvas.width;
    let minY = canvas.height;
    let maxX = -1;
    let maxY = -1;
    let opaquePixels = 0;
    for (let y = 0; y < canvas.height; y += 1) {
      for (let x = 0; x < canvas.width; x += 1) {
        const alpha = data[(y * canvas.width + x) * 4 + 3];
        if (alpha > 8) {
          opaquePixels += 1;
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
        }
      }
    }

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
      objectFit: style.objectFit,
      coverageWidth: maxX >= minX ? maxX - minX + 1 : 0,
      coverageHeight: maxY >= minY ? maxY - minY + 1 : 0,
      opaquePixels,
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
  expect(metrics.objectFit).toBe("contain");

  // The verified artwork fills essentially its entire canvas edge to edge
  // (no intentional transparent margins), so both axes get the same strict
  // coverage gate -- this is what actually catches a collapsed/clipped render.
  expect(metrics.coverageWidth / metrics.naturalWidth).toBeGreaterThan(0.9);
  expect(metrics.coverageHeight / metrics.naturalHeight).toBeGreaterThan(0.9);
  expect(metrics.opaquePixels).toBeGreaterThan(1500);
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
  await expectLogoVisibleAndUnclipped(page);
  await expectInputIconSpacing(page, "#login-username");
  await expectInputIconSpacing(page, "#login-password");
  await expect(page.locator('link[data-correlact-fixes]')).toHaveAttribute("href", /correlact-fixes\.css\?v=20260901d$/);
}

test("CorrelAct logo stays fully visible and login icons never overlap text at reported viewport", async ({ page }) => {
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
