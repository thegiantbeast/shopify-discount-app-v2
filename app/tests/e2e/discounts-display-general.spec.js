import { test, expect } from "@playwright/test";
import { buildStorefrontUrl } from "./utils/storefront-url.js";
import {
  handlePasswordProtection,
  waitForDiscountUI,
  resolvePriceLocator,
  resolveAddToCartButton,
  parsePrice,
  stepPause,
} from "./helpers/storefront.js";
import {
  resolveCartItemContainer,
  getCartItemPriceValue,
} from "./helpers/cart.js";

const LIQUID_PRODUCT_PATH = "/products/the-collection-snowboard-liquid";
const LIQUID_PRODUCT_HANDLE = "the-collection-snowboard-liquid";

test.describe("Storefront coupon apply", () => {
  test("shows 25% automatic, 30% coupon, then applies coupon", async ({
    page,
  }) => {
    await page.context().setExtraHTTPHeaders({
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_5_2) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
    });
    await page.addInitScript(() => {
      try {
        Object.defineProperty(navigator, "webdriver", { get: () => false });
        localStorage.setItem("wf_dev_no_auto_apply", "1");
      } catch (_error) {
        // Ignore if read-only.
      }
    });

    const targetUrl = buildStorefrontUrl(LIQUID_PRODUCT_PATH);
    await page.goto(targetUrl, { waitUntil: "networkidle" });
    await handlePasswordProtection(page);
    await stepPause(page);

    if (!page.url().includes(LIQUID_PRODUCT_PATH)) {
      await page.goto(targetUrl, { waitUntil: "networkidle" });
      await handlePasswordProtection(page);
      await stepPause(page);
    }

    await page.waitForFunction(
      (handle) =>
        window.ShopifyAnalytics?.meta?.product?.handle === handle,
      LIQUID_PRODUCT_HANDLE,
      { timeout: 15000 },
    );
    await stepPause(page);

    await waitForDiscountUI(page);
    await stepPause(page);

    const automaticBadge = page.locator(".ddp-discounted-price__badge").first();
    await expect(automaticBadge).toBeVisible({ timeout: 15000 });
    await expect(automaticBadge).toContainText("25%");
    await stepPause(page);

    const couponBlock = page.locator(".ddp-coupon-block").first();
    await expect(couponBlock).toBeVisible({ timeout: 15000 });

    const couponLabel = couponBlock.locator(".ddp-coupon-label").first();
    await expect(couponLabel).toContainText("30%");
    await stepPause(page);

    const couponCheckbox = couponBlock
      .locator('.ddp-coupon-label input[type="checkbox"]')
      .first();
    await expect(couponCheckbox).not.toBeChecked();
    await expect(
      couponBlock.locator(".ddp-coupon-applied.visible"),
    ).toHaveCount(0);
    await stepPause(page);

    const priceLocator = await resolvePriceLocator(page);
    const originalPriceText = await priceLocator.textContent();

    await couponCheckbox.click();
    await stepPause(page);

    const appliedState = couponBlock
      .locator(".ddp-coupon-applied.visible")
      .first();
    await expect(appliedState).toBeVisible({ timeout: 20000 });
    await expect(appliedState).toContainText("30%");
    await expect(couponCheckbox).toBeChecked({ timeout: 20000 });
    await stepPause(page);

    const discountedPriceContainer = page
      .locator(".ddp-discounted-price-container")
      .first();
    await expect(discountedPriceContainer).toBeVisible({ timeout: 10000 });

    await expect(priceLocator).toBeHidden();
    await page.waitForTimeout(600);
    await expect(priceLocator).toBeHidden();
    await stepPause(page);

    const discountedPriceText = await discountedPriceContainer
      .locator(".ddp-discounted-price__sale")
      .first()
      .textContent();
    const originalValue = parsePrice(originalPriceText);
    const discountedValue = parsePrice(discountedPriceText);
    if (originalValue != null && discountedValue != null) {
      expect(discountedValue).toBeLessThan(originalValue);
    }

    const addToCartButton = await resolveAddToCartButton(page);
    const addResponsePromise = page.waitForResponse((response) => {
      return response.url().includes("/cart/add") && response.status() < 400;
    });
    await addToCartButton.click();
    await addResponsePromise.catch(() => undefined);
    await stepPause(page);

    await page.goto(buildStorefrontUrl("/cart"), { waitUntil: "networkidle" });
    await handlePasswordProtection(page);
    await stepPause(page);

    const cartItemContainer = await resolveCartItemContainer(
      page,
      LIQUID_PRODUCT_PATH,
    );
    await expect(cartItemContainer).toBeVisible({ timeout: 15000 });

    const cartValue = await getCartItemPriceValue(cartItemContainer);
    expect(discountedValue).not.toBeNull();
    expect(cartValue).not.toBeNull();
    expect(cartValue).toBeCloseTo(discountedValue, 2);
  });
});
