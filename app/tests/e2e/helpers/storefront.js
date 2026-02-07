/**
 * Shared storefront test helpers.
 * Extracted from v1's duplicated helpers across 4 spec files.
 */

const DEFAULT_STOREFRONT_PASSWORD =
  process.env.STOREFRONT_PASSWORD || "102938";

/**
 * Handles storefront password protection page.
 * @param {import('@playwright/test').Page} page
 * @param {string} [password]
 */
export async function handlePasswordProtection(page, password) {
  const pw = password || DEFAULT_STOREFRONT_PASSWORD;
  const passwordInput = page.locator('input[type="password"]');
  if ((await passwordInput.count()) > 0) {
    await passwordInput.fill(pw);
    const submitButton = page.locator(
      'button[type="submit"], input[type="submit"], button:has-text("Enter")',
    );
    if ((await submitButton.count()) > 0) {
      await submitButton.first().click();
    } else {
      await passwordInput.press("Enter");
    }
    await page.waitForLoadState("networkidle");
  }
}

/**
 * Waits for the discount UI namespace to be initialized.
 * v2 uses window["display-discounts-pro"].ui instead of window.DiscountUI.
 * @param {import('@playwright/test').Page} page
 * @param {number} [timeout=15000]
 */
export async function waitForDiscountUI(page, timeout = 15000) {
  await page.waitForFunction(
    () => window["display-discounts-pro"]?.ui !== undefined,
    { timeout },
  );
}

/**
 * Waits for any discount container element to become visible.
 * @param {import('@playwright/test').Page} page
 * @param {number} [timeout=10000]
 */
export async function waitForDiscountContainer(page, timeout = 10000) {
  await page.waitForSelector(
    ".ddp-discounts-container, .ddp-discount-badge, .ddp-coupon-block, .ddp-coupon-flag",
    { state: "visible", timeout },
  );
}

/**
 * Gets the displayed discount percentage from badge or coupon block.
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<number|null>}
 */
export async function getDisplayedDiscountPercentage(page) {
  const badge = page.locator(
    ".ddp-discount-badge, .ddp-coupon-block, .ddp-coupon-flag, .ddp-discounted-price__badge",
  );
  if ((await badge.count()) === 0) return null;
  const text = await badge.first().textContent();
  if (!text) return null;
  const match = text.match(/(\d+)%/);
  return match ? parseInt(match[1], 10) : null;
}

/**
 * Polls until a specific discount percentage is displayed.
 * @param {import('@playwright/test').Page} page
 * @param {number} expected
 * @param {number} [timeout=20000]
 */
export async function waitForDiscountPercentage(
  page,
  expected,
  timeout = 20000,
) {
  await page.waitForFunction(
    (value) => {
      const el = document.querySelector(
        ".ddp-discount-badge, .ddp-coupon-block",
      );
      if (!el) return false;
      const text = el.textContent || "";
      const match = text.match(/(\d+)%/);
      if (!match) return false;
      return Number(match[1]) === value;
    },
    expected,
    { timeout },
  );
}

/**
 * Whether any discount element is visible.
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<boolean>}
 */
export async function isDiscountVisible(page) {
  const badge = page.locator(
    ".ddp-discount-badge, .ddp-coupon-block, .ddp-coupon-flag, .ddp-discounted-price__badge",
  );
  return (await badge.count()) > 0;
}

/**
 * Resolves the price container locator within the product form.
 * Tries a cascade of common selectors.
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<import('@playwright/test').Locator>}
 */
export async function resolvePriceLocator(page) {
  const scope = page
    .locator('form[action^="/cart/add"], .product__info-wrapper')
    .first();

  const customSelector = await page.evaluate(() => {
    const ns = window["display-discounts-pro"];
    const raw = ns?._formPriceSelector;
    if (typeof raw === "string" && raw.trim().length > 0) return raw.trim();
    return null;
  });

  const selectors = [
    customSelector,
    ".price__container",
    ".product-price .js-value",
    ".product-price",
    ".price__current .js-value",
    ".price__current",
    ".price .js-value",
    ".price",
  ].filter(Boolean);

  for (const selector of selectors) {
    const locator = scope.locator(selector).first();
    if ((await locator.count()) > 0) {
      return locator;
    }
  }

  throw new Error("No price container found in product scope.");
}

/**
 * Resolves the add-to-cart button locator.
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<import('@playwright/test').Locator>}
 */
export async function resolveAddToCartButton(page) {
  const form = page.locator('form[action^="/cart/add"]').first();
  const selectors = [
    'button[type="submit"]',
    'button[name="add"]',
    'button:has-text("Add to cart")',
    'button:has-text("Add to Cart")',
    'button:has-text("Add to bag")',
    'button:has-text("Add to Bag")',
    'input[type="submit"]',
  ];

  for (const selector of selectors) {
    const button = form.locator(selector).first();
    if ((await button.count()) > 0) {
      return button;
    }
  }

  // Fallback: search outside form
  for (const selector of selectors) {
    const button = page.locator(selector).first();
    if ((await button.count()) > 0) {
      return button;
    }
  }

  throw new Error("Add to cart button not found.");
}

/**
 * Parses a price string into a number, handling international formats.
 * @param {string|null} raw
 * @returns {number|null}
 */
export function parsePrice(raw) {
  if (!raw) return null;
  const cleaned = raw.replace(/[^\d.,]/g, "").trim();
  if (!cleaned) return null;
  const hasComma = cleaned.includes(",");
  const hasDot = cleaned.includes(".");
  let normalized = cleaned;
  if (hasComma && hasDot) {
    normalized = cleaned.replace(/,/g, "");
  } else if (hasComma && !hasDot) {
    normalized = cleaned.replace(",", ".");
  }
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

/**
 * Gets the discounted sale price from the discount price container.
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<number|null>}
 */
export async function getDiscountedSalePrice(page) {
  const direct = page
    .locator(".ddp-discounted-price__sale, .ddp-discounted-price__final")
    .first();
  if (await direct.count()) {
    return parsePrice(await direct.textContent());
  }

  const container = page.locator(".ddp-discounted-price-container").first();
  if (await container.count()) {
    const priceText = await container.evaluate((node) => {
      const textEls = Array.from(node.querySelectorAll("*"));
      const priced = textEls
        .map((el) => el.textContent || "")
        .filter((text) => /[$€£]\s?\d/.test(text));
      return priced.length ? priced[priced.length - 1] : null;
    });
    return parsePrice(priceText);
  }

  return null;
}

/**
 * Brief pause for UI settling.
 * @param {import('@playwright/test').Page} page
 */
export async function stepPause(page) {
  await page.waitForTimeout(1000);
}
