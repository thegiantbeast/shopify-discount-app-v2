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

const PRODUCTS = [
  {
    path: "/products/the-collection-snowboard-hydrogen",
    handle: "the-collection-snowboard-hydrogen",
  },
  {
    path: "/products/the-collection-snowboard-liquid",
    handle: "the-collection-snowboard-liquid",
  },
];

test.describe("Storefront coupon auto-apply", () => {
  for (const product of PRODUCTS) {
    test(`auto-applies coupon on product form when enabled (${product.handle})`, async ({
      page,
    }) => {
      await page.context().setExtraHTTPHeaders({
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_5_2) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
      });
      await page.addInitScript(() => {
        try {
          Object.defineProperty(navigator, "webdriver", {
            get: () => false,
          });
        } catch (_error) {
          // Ignore if read-only.
        }
      });

      const homeUrl = buildStorefrontUrl("/");
      const targetUrl = buildStorefrontUrl(product.path);

      await page.goto(homeUrl, { waitUntil: "networkidle" });
      await handlePasswordProtection(page);

      if (!page.url().includes(product.path)) {
        await page.goto(targetUrl, { waitUntil: "networkidle" });
        await handlePasswordProtection(page);
      }

      await page.waitForFunction(
        (handle) =>
          window.ShopifyAnalytics?.meta?.product?.handle === handle,
        product.handle,
        { timeout: 15000 },
      );

      await waitForDiscountUI(page);

      const couponBlock = page.locator(".ddp-coupon-block").first();
      await expect(couponBlock).toBeVisible({ timeout: 15000 });

      const couponCheckbox = couponBlock
        .locator('.ddp-coupon-label input[type="checkbox"]')
        .first();
      await expect(couponCheckbox).toBeChecked({ timeout: 20000 });
      await expect(couponCheckbox).toBeDisabled({ timeout: 20000 });

      const appliedState = couponBlock
        .locator(".ddp-coupon-applied.visible")
        .first();
      await expect(appliedState).toBeVisible({ timeout: 20000 });
      await expect(appliedState).toContainText("30%");

      const priceLocator = await resolvePriceLocator(page);
      const originalPriceText = await priceLocator.textContent();

      const discountedPriceContainer = page
        .locator(".ddp-discounted-price-container")
        .first();
      await expect(discountedPriceContainer).toBeVisible({ timeout: 10000 });

      await expect(priceLocator).toBeHidden();
      await page.waitForTimeout(600);
      await expect(priceLocator).toBeHidden();

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
        return (
          response.url().includes("/cart/add") && response.status() < 400
        );
      });
      await addToCartButton.click();
      await addResponsePromise.catch(() => undefined);

      await page.goto(buildStorefrontUrl("/cart"), {
        waitUntil: "networkidle",
      });
      await handlePasswordProtection(page);

      const cartItemContainer = await resolveCartItemContainer(
        page,
        product.path,
      );
      await expect(cartItemContainer).toBeVisible({ timeout: 15000 });

      const cartValue = await getCartItemPriceValue(cartItemContainer);
      expect(discountedValue).not.toBeNull();
      expect(cartValue).not.toBeNull();
      expect(cartValue).toBeCloseTo(discountedValue, 2);
    });
  }
});
