import { test, expect } from "@playwright/test";
import { buildPreviewUrl } from "./utils/shopify-preview.js";
import { loginToShopifyIfNeeded } from "./helpers/auth.js";
import { clickSidebarLink } from "./helpers/navigation.js";
import { waitForEmbeddedAppFrame } from "./helpers/frames.js";

test.describe("Shopify admin discounts dashboard", () => {
  test("loads discounts list after CLI-auth redirect", async ({ page }) => {
    const previewUrl = buildPreviewUrl();

    await page.goto(previewUrl, { waitUntil: "domcontentloaded" });

    await loginToShopifyIfNeeded(page);

    await clickSidebarLink(page, /manage discounts/i);

    const appFrame = waitForEmbeddedAppFrame(page);

    await expect(
      page.getByRole("heading", { name: /discounts/i }),
    ).toBeVisible({ timeout: 60_000 });
    await expect(
      appFrame.getByRole("heading", { name: /manage your discounts/i }),
    ).toBeVisible({ timeout: 60_000 });
  });
});
