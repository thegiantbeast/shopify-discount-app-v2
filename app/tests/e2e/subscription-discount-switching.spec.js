import { test, expect } from "@playwright/test";
import { buildStorefrontUrl } from "./utils/storefront-url.js";
import {
  handlePasswordProtection,
  waitForDiscountUI,
  waitForDiscountContainer,
  getDisplayedDiscountPercentage,
  waitForDiscountPercentage,
  resolveAddToCartButton,
  getDiscountedSalePrice,
  stepPause,
} from "./helpers/storefront.js";
import {
  resolveCartItemContainer,
  getCartItemPriceValue,
} from "./helpers/cart.js";

const TEST_PRODUCT_PATH = "/products/gift-card";
const TEST_PRODUCT_HANDLE = "gift-card";
const VARIANT_1_ID = "50197393834288";
const VARIANT_2_ID = "50197393867056";

async function ensureProductPage(page, variantId) {
  const targetUrl = buildStorefrontUrl(
    `${TEST_PRODUCT_PATH}?variant=${variantId}`,
  );
  await page.goto(targetUrl, { waitUntil: "networkidle" });
  await handlePasswordProtection(page);
  await stepPause(page);

  if (!page.url().includes(TEST_PRODUCT_PATH)) {
    await page.goto(targetUrl, { waitUntil: "networkidle" });
    await handlePasswordProtection(page);
    await stepPause(page);
  }

  await page.waitForFunction(
    (handle) => window.ShopifyAnalytics?.meta?.product?.handle === handle,
    TEST_PRODUCT_HANDLE,
    { timeout: 20000 },
  );
}

async function selectVariant(page, variantId) {
  const variantToDenomination = {
    "50197393834288": "$10",
    "50197393867056": "$25",
    "50197393899824": "$50",
  };

  const denomination = variantToDenomination[variantId];

  if (denomination) {
    const label = page
      .locator(`label:has-text("${denomination}")`)
      .first();
    if ((await label.count()) > 0) {
      await label.click();
      await page.waitForTimeout(1000);
      return;
    }
  }

  const selectors = [
    `input[value="${variantId}"]`,
    `[data-variant-id="${variantId}"]`,
    `option[value="${variantId}"]`,
  ];

  for (const selector of selectors) {
    const element = page.locator(selector);
    if ((await element.count()) > 0) {
      await element.click();
      await page.waitForTimeout(1000);
      return;
    }
  }

  const select = page.locator('select[name="id"]');
  if ((await select.count()) > 0) {
    await select.selectOption(variantId);
    await page.waitForTimeout(1000);
    return;
  }

  throw new Error(`Could not find variant selector for ${variantId}`);
}

async function selectSubscription(page) {
  const checked = page.locator(
    'input[data-radio-type="selling_plan"]:checked, input[data-selling-plan-id]:checked, input[name="selling_plan"]:not([value=""]):checked',
  );
  if (await checked.count()) {
    return true;
  }

  const labelSelectors = [
    'label:has(input[data-radio-type="selling_plan"])',
    "label:has(input[data-selling-plan-id])",
    'label:has(input[name="selling_plan"]:not([value=""]))',
  ];

  for (const selector of labelSelectors) {
    const label = page.locator(selector).first();
    if (await label.isVisible()) {
      await label.click();
      await page.waitForTimeout(1000);
      return true;
    }
  }

  const selectors = [
    'input[data-radio-type="selling_plan"]',
    "input[data-selling-plan-id]",
    'input[name="selling_plan"]:not([value=""])',
    '.shopify_subscriptions_app_block input[type="radio"]:not([data-radio-type="one_time_purchase"])',
  ];

  for (const selector of selectors) {
    const element = page.locator(selector).first();
    if (await element.isVisible()) {
      await element.click();
      await page.waitForTimeout(1000);
      return true;
    }
  }

  return false;
}

async function selectOneTime(page) {
  const checked = page.locator(
    'input[data-radio-type="one_time_purchase"]:checked, input[name="selling_plan"][value=""]:checked',
  );
  if (await checked.count()) {
    return true;
  }

  const subscriptionOptions = page.locator(
    'input[data-radio-type="selling_plan"], input[data-selling-plan-id], input[name="selling_plan"]:not([value=""])',
  );
  if ((await subscriptionOptions.count()) === 0) {
    return true;
  }

  const labelSelectors = [
    'label:has(input[data-radio-type="one_time_purchase"])',
    'label:has(input[name="selling_plan"][value=""])',
    'label:has(input[type="radio"][aria-label*="One-time"])',
  ];

  for (const selector of labelSelectors) {
    const label = page.locator(selector).first();
    if (await label.isVisible()) {
      await label.click();
      await page.waitForTimeout(1000);
      return true;
    }
  }

  const selectors = [
    'input[data-radio-type="one_time_purchase"]',
    ".shopify_subscriptions_app_block_one_time_purchase_option",
    'input[name="selling_plan"][value=""]',
    'input[type="radio"][aria-label*="One-time"]',
  ];

  for (const selector of selectors) {
    const element = page.locator(selector).first();
    if (await element.isVisible()) {
      await element.click();
      await page.waitForTimeout(1000);
      return true;
    }
  }

  return false;
}

test.describe("Subscription discount switching", () => {
  test("one-time and subscription discount flow with cart validation", async ({
    page,
    context,
  }) => {
    await context.clearCookies();
    await ensureProductPage(page, VARIANT_1_ID);
    await waitForDiscountUI(page);
    await waitForDiscountContainer(page, 15000);

    let percentage = await getDisplayedDiscountPercentage(page);
    expect(percentage).toBe(10);

    await selectVariant(page, VARIANT_2_ID);
    await selectOneTime(page);
    await waitForDiscountContainer(page, 15000);

    percentage = await getDisplayedDiscountPercentage(page);
    expect(percentage).toBe(10);

    const subscriptionSelected = await selectSubscription(page);
    if (!subscriptionSelected) {
      test.skip(true, "Subscription option not available on this variant");
      return;
    }

    await stepPause(page);
    await waitForDiscountContainer(page, 15000);
    await waitForDiscountPercentage(page, 90, 25000);
    percentage = await getDisplayedDiscountPercentage(page);
    expect(percentage).toBe(90);

    await selectVariant(page, VARIANT_1_ID);
    await selectOneTime(page);
    await waitForDiscountContainer(page, 15000);

    const variantOneCouponBlock = page.locator(".ddp-coupon-block").first();
    await expect(variantOneCouponBlock).toBeVisible({ timeout: 15000 });
    await expect(variantOneCouponBlock).toContainText("10%");
    const variantOneCheckbox = variantOneCouponBlock
      .locator('.ddp-coupon-label input[type="checkbox"]')
      .first();
    await expect(variantOneCheckbox).toBeVisible({ timeout: 15000 });
    await expect(variantOneCheckbox).not.toBeChecked();

    await selectVariant(page, VARIANT_2_ID);
    const subscriptionSelectedAgain = await selectSubscription(page);
    if (!subscriptionSelectedAgain) {
      test.skip(true, "Subscription option not available on this variant");
      return;
    }

    await stepPause(page);
    await waitForDiscountContainer(page, 15000);

    const couponBlock = page.locator(".ddp-coupon-block").first();
    await expect(couponBlock).toBeVisible({ timeout: 15000 });

    const couponCheckbox = couponBlock
      .locator('.ddp-coupon-label input[type="checkbox"]')
      .first();
    await expect(couponCheckbox).toBeVisible({ timeout: 15000 });
    await expect(couponCheckbox).not.toBeChecked();

    await couponCheckbox.click();
    await stepPause(page);
    const appliedState = couponBlock
      .locator(".ddp-coupon-applied.visible")
      .first();
    await expect(appliedState).toBeVisible({ timeout: 20000 });
    await expect(couponCheckbox).toBeChecked();
    await stepPause(page);

    const discountedValue = await getDiscountedSalePrice(page);
    expect(discountedValue).not.toBeNull();

    const addToCartButton = await resolveAddToCartButton(page);
    const addResponsePromise = page.waitForResponse((response) => {
      return response.url().includes("/cart/add") && response.status() < 400;
    });
    await addToCartButton.click();
    await stepPause(page);
    await addResponsePromise.catch(() => undefined);

    await page.goto(buildStorefrontUrl("/cart"), { waitUntil: "networkidle" });
    await handlePasswordProtection(page);

    const cartItemContainer = await resolveCartItemContainer(
      page,
      TEST_PRODUCT_PATH,
    );
    await expect(cartItemContainer).toBeVisible({ timeout: 15000 });

    const cartValue = await getCartItemPriceValue(cartItemContainer);
    expect(cartValue).not.toBeNull();
    expect(cartValue).toBeCloseTo(discountedValue, 2);
  });
});
