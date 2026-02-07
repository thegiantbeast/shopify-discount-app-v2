import { test, expect } from "@playwright/test";
import {
  loadRegressionTargetsSync,
  preparePageForScreenshot,
  unlockStorefrontIfNeeded,
  resolveScenario,
} from "./helpers.js";

const regressionTargets = loadRegressionTargetsSync();

test.describe("Storefront visual regressions", () => {
  test.skip(
    regressionTargets.length === 0,
    "Add entries to app/tests/e2e/regressions/urls.json to enable visual regression coverage.",
  );

  for (const target of regressionTargets) {
    test(`${target.theme} | ${target.baselineFileName}`, async ({ page }) => {
      await page.goto(target.url, { waitUntil: "domcontentloaded" });
      await unlockStorefrontIfNeeded(page, target.password);
      await page.goto(target.url, { waitUntil: "networkidle" });

      const scenario = resolveScenario(target);
      if (scenario) {
        await scenario(page);
        await page.waitForLoadState("networkidle").catch(() => undefined);
      }

      const snapshotOptions = {};
      if (typeof target.maxDiffPixels === "number") {
        snapshotOptions.maxDiffPixels = target.maxDiffPixels;
      }
      if (typeof target.maxDiffPixelRatio === "number") {
        snapshotOptions.maxDiffPixelRatio = target.maxDiffPixelRatio;
      }

      await preparePageForScreenshot(page, target);

      if (target.snapshotSelector) {
        const locator = page.locator(target.snapshotSelector).first();
        await locator.waitFor({ state: "visible", timeout: 10_000 });
        await locator.scrollIntoViewIfNeeded().catch(() => undefined);

        await expect(locator).toHaveScreenshot(
          target.snapshotName,
          snapshotOptions,
        );
      } else {
        const screenshot = await page.screenshot({
          fullPage: true,
          animations: "disabled",
          scale: "device",
        });

        await expect(screenshot).toMatchSnapshot(
          target.snapshotName,
          snapshotOptions,
        );
      }
    });
  }
});
