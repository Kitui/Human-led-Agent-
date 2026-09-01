import { test, expect } from "@playwright/test";

const BASE_URL = process.env.CORRELACT_BASE_URL || "http://127.0.0.1:8000";
const USERNAME = "user@northstar.com";
const PASSWORD = "northstar-browser-test-pass";

test.use({
  screenshot: "only-on-failure",
  trace: "retain-on-failure",
});

async function openSettings(page, viewport) {
  await page.setViewportSize(viewport);
  await page.goto(`${BASE_URL}/app#settings`, { waitUntil: "domcontentloaded" });

  await page.locator("#login-username").fill(USERNAME);
  await page.locator("#login-password").fill(PASSWORD);
  await page.locator("#login-submit-btn").click();

  await expect(page.locator("#app-root")).not.toHaveClass(/hidden/);
  await expect(page.locator('section.page[data-page="settings"]')).toHaveClass(/active/);
  await page.locator("#settings-section-observability .operational-item").first().waitFor();
  await page.locator("#settings-section-tenants tbody tr").first().waitFor();

  await page.waitForFunction(() =>
    Array.from(document.styleSheets).some((sheet) =>
      String(sheet.href || "").includes("correlact-layout.css"),
    ),
  );
}

async function collectOverflowIssues(page) {
  return page.evaluate(() => {
    const tolerance = 2;
    const issues = [];
    const content = document.querySelector(".content")?.getBoundingClientRect();
    if (!content) return ["content region missing"];

    if (document.documentElement.scrollWidth > window.innerWidth + tolerance) {
      issues.push(
        `page horizontal overflow: ${document.documentElement.scrollWidth}px > ${window.innerWidth}px`,
      );
    }

    document.querySelectorAll('[data-page="settings"] .settings-row > .card').forEach((card) => {
      const rect = card.getBoundingClientRect();
      const name = card.id || card.querySelector("h2")?.textContent?.trim() || "settings card";
      if (rect.left < content.left - tolerance) {
        issues.push(`${name} crosses content left boundary`);
      }
      if (rect.right > content.right + tolerance || rect.right > window.innerWidth + tolerance) {
        issues.push(`${name} crosses content right boundary`);
      }
    });

    document
      .querySelectorAll('[data-page="settings"] .settings-completion-card .operational-item')
      .forEach((row) => {
        const card = row.closest(".card");
        if (!card) return;
        const cardRect = card.getBoundingClientRect();
        const rowName = row.querySelector(".label")?.textContent?.trim() || "operational row";

        [row, ...row.querySelectorAll(".label, .value, .health-badge")].forEach((element) => {
          const rect = element.getBoundingClientRect();
          if (rect.right > cardRect.right + tolerance) {
            issues.push(`${rowName} extends beyond ${card.id || "its card"}`);
          }
          if (rect.left < cardRect.left - tolerance) {
            issues.push(`${rowName} extends left of ${card.id || "its card"}`);
          }
        });
      });

    const orgCard = document.querySelector("#settings-section-tenants");
    if (orgCard) {
      const orgRect = orgCard.getBoundingClientRect();
      orgCard.querySelectorAll(".settings-access-note, tbody tr, tbody td").forEach((element) => {
        const rect = element.getBoundingClientRect();
        if (rect.right > orgRect.right + tolerance || rect.left < orgRect.left - tolerance) {
          issues.push(`Organization Access content escapes its card`);
        }
      });

      const visibleHeaders = Array.from(orgCard.querySelectorAll("thead th")).filter((header) => {
        const style = getComputedStyle(header);
        return style.display !== "none" && header.getBoundingClientRect().height > 0;
      });
      visibleHeaders.forEach((header) => {
        if (getComputedStyle(header).whiteSpace !== "nowrap") {
          issues.push(`Organization heading may split mid-word: ${header.textContent.trim()}`);
        }
      });
    }

    return [...new Set(issues)];
  });
}

for (const viewport of [
  { width: 1440, height: 1000 },
  { width: 1024, height: 900 },
]) {
  test(`Settings stays contained at ${viewport.width}px with expanded and collapsed navigation`, async ({ page }) => {
    await openSettings(page, viewport);

    const expandedWidth = await page.locator("#sidebar").evaluate((el) => el.getBoundingClientRect().width);
    expect(expandedWidth).toBeLessThanOrEqual(198);
    expect(expandedWidth).toBeGreaterThanOrEqual(188);

    expect(await collectOverflowIssues(page)).toEqual([]);

    await page.locator("#collapse-btn").click();
    await page.waitForTimeout(250);

    const collapsedWidth = await page.locator("#sidebar").evaluate((el) => el.getBoundingClientRect().width);
    expect(collapsedWidth).toBeLessThanOrEqual(62);
    expect(await collectOverflowIssues(page)).toEqual([]);
  });
}
