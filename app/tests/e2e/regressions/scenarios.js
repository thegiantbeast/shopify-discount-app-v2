/**
 * Visual regression scenario registry.
 * Each scenario is a named function that sets up the page state
 * before a screenshot is taken.
 */

const DISCOUNT_RENDER_SELECTORS = [
  ".ddp-discounts .ddp-discounted-price__sale",
  ".ddp-discounts .ddp-discounted-price__badge",
  ".ddp-discounts .ddp-coupon-applied",
  ".ddp-discounts .ddp-discounted-price-container",
];

async function waitForDiscountRender(page) {
  try {
    await page.waitForFunction(
      (selectors) => {
        return selectors.some((selector) => {
          const el = document.querySelector(selector);
          if (!(el instanceof Element)) return false;
          const styles = window.getComputedStyle(el);
          const hidden =
            styles.visibility === "hidden" ||
            styles.display === "none" ||
            styles.opacity === "0";
          if (hidden) return false;
          const text = (el.textContent || "").trim();
          return text.length > 0;
        });
      },
      DISCOUNT_RENDER_SELECTORS,
      { timeout: 10_000 },
    );

    await page.waitForTimeout(400);
  } catch {
    await page.waitForTimeout(1500);
  }
}

async function selectVariantOption(page, optionLabel, fallbackSelector) {
  const labelLocator = page.locator(`label:has-text("${optionLabel}")`).first();
  if (await labelLocator.count()) {
    if (await labelLocator.isVisible().catch(() => false)) {
      await labelLocator.scrollIntoViewIfNeeded().catch(() => undefined);
      await labelLocator.click();
      return;
    }
  }

  if (fallbackSelector) {
    const fallbackLocator = page.locator(fallbackSelector).first();
    if (await fallbackLocator.count()) {
      await fallbackLocator.scrollIntoViewIfNeeded().catch(() => undefined);
      await fallbackLocator.click();
      return;
    }
  }

  const selectLocator = page
    .locator("select")
    .filter({ has: page.locator(`option:has-text("${optionLabel}")`) })
    .first();

  if (await selectLocator.count()) {
    try {
      await selectLocator.selectOption({ label: optionLabel });
    } catch (error) {
      const optionValue = await selectLocator
        .locator(`option:has-text("${optionLabel}")`)
        .first()
        .getAttribute("value");

      if (!optionValue) {
        throw error;
      }

      await selectLocator.selectOption(optionValue);
    }

    return;
  }

  const comboboxLocator = page
    .locator('[role="combobox"]')
    .filter({
      has: page.locator(`[role="option"]:has-text("${optionLabel}")`),
    })
    .first();

  if (await comboboxLocator.count()) {
    await comboboxLocator.click().catch(() => undefined);
    const optionLocator = page
      .locator(`[role="option"]:has-text("${optionLabel}")`)
      .first();
    await optionLocator.click();
    return;
  }

  throw new Error(
    `Unable to locate variant option "${optionLabel}" for regression scenario.`,
  );
}

const registry = {
  "dawn-select-second-variant": async (page) => {
    const variantSelector = page.locator("[data-variant-option]").first();
    if (await variantSelector.count()) {
      const secondOption = variantSelector
        .locator('button, input[type="radio"], option')
        .nth(1);
      if (await secondOption.isVisible().catch(() => false)) {
        await secondOption.click();
      }
    }

    await page.waitForTimeout(250);
  },
  "selling-plans-select-special": async (page) => {
    await selectVariantOption(page, "Special Selling Plans Ski Wax");
    await waitForDiscountRender(page);
  },
  "selling-plans-select-sample": async (page) => {
    await selectVariantOption(page, "Sample Selling Plans Ski Wax");
    await waitForDiscountRender(page);
  },
};

/**
 * Gets a named regression scenario.
 * @param {string} name
 * @returns {((page: import('@playwright/test').Page) => Promise<void>)|undefined}
 */
export function getRegressionScenario(name) {
  return registry[name];
}

/**
 * Registers a new regression scenario.
 * @param {string} name
 * @param {(page: import('@playwright/test').Page) => Promise<void>} scenario
 */
export function registerRegressionScenario(name, scenario) {
  registry[name] = scenario;
}
