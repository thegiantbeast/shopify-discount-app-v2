import { test, expect } from "@playwright/test";
import { buildStorefrontUrl } from "./utils/storefront-url.js";
import {
  handlePasswordProtection,
  waitForDiscountUI,
  waitForDiscountContainer,
  getDisplayedDiscountPercentage,
  isDiscountVisible,
  stepPause,
} from "./helpers/storefront.js";

const TEST_PRODUCT_PATH = "/products/the-complete-snowboard";
const TEST_PRODUCT_HANDLE = "the-complete-snowboard";

async function ensureProductPageLoaded(page) {
  const targetUrl = buildStorefrontUrl(TEST_PRODUCT_PATH);

  await page.goto(targetUrl, { waitUntil: "networkidle" });
  await handlePasswordProtection(page);

  if (!page.url().includes(TEST_PRODUCT_PATH)) {
    await page.goto(targetUrl, { waitUntil: "networkidle" });
  }

  await page.waitForFunction(
    (handle) => window.ShopifyAnalytics?.meta?.product?.handle === handle,
    TEST_PRODUCT_HANDLE,
    { timeout: 15000 },
  );
}

async function getCurrentVariantId(page) {
  return page.evaluate(() => {
    const select = document.querySelector('select[name="id"]');
    if (select && select.value) return String(select.value);
    const checked = document.querySelector('input[name="id"]:checked');
    if (checked && checked.value) return String(checked.value);
    const hidden = document.querySelector('input[name="id"][type="hidden"]');
    if (hidden && hidden.value) return String(hidden.value);
    return null;
  });
}

async function getVariantIds(page) {
  const ids = await page.evaluate(() => {
    const found = new Set();
    const analyticsVariants =
      window.ShopifyAnalytics?.meta?.product?.variants;
    if (Array.isArray(analyticsVariants)) {
      analyticsVariants.forEach((variant) => {
        if (variant && variant.id) found.add(String(variant.id));
      });
    }

    const select = document.querySelector('select[name="id"]');
    if (select) {
      Array.from(select.options || []).forEach((option) => {
        if (option && option.value) found.add(String(option.value));
      });
    }

    document.querySelectorAll('input[name="id"][value]').forEach((input) => {
      if (input.value) found.add(String(input.value));
    });

    const scripts = Array.from(
      document.querySelectorAll('script[type="application/json"]'),
    );
    for (const script of scripts) {
      const text = script.textContent || "";
      if (!text || !text.includes("variants")) continue;
      try {
        const parsed = JSON.parse(text);
        const variants =
          parsed?.product?.variants || parsed?.variants || [];
        if (Array.isArray(variants)) {
          variants.forEach((variant) => {
            if (variant && variant.id) found.add(String(variant.id));
          });
        }
      } catch (_error) {
        // Ignore JSON parse failures for unrelated scripts
      }
    }

    return Array.from(found);
  });

  return ids;
}

async function getVariantOptionGroup(page) {
  return page.evaluate(() => {
    const fieldsets = Array.from(document.querySelectorAll("fieldset"));
    for (const fieldset of fieldsets) {
      const legend = fieldset.querySelector("legend");
      const name = legend?.textContent?.trim() || "";
      const inputs = Array.from(
        fieldset.querySelectorAll('input[type="radio"]'),
      );
      if (inputs.length === 0) continue;
      const options = inputs
        .map((input) => {
          const id = input.id || null;
          let labelText = "";
          if (id) {
            const label = document.querySelector(`label[for="${id}"]`);
            labelText = label?.textContent?.trim() || "";
          }
          if (!labelText) {
            const wrapper = input.closest("label");
            labelText = wrapper?.textContent?.trim() || "";
          }
          return {
            id,
            value: input.value ? String(input.value) : "",
            label: labelText,
          };
        })
        .filter((option) => option.value || option.label);

      if (options.length > 0) {
        return { name, options };
      }
    }

    const radioGroups = new Map();
    document
      .querySelectorAll('input[type="radio"][name]')
      .forEach((input) => {
        const name = input.name || "";
        const id = input.id || null;
        let labelText = "";
        if (id) {
          const label = document.querySelector(`label[for="${id}"]`);
          labelText = label?.textContent?.trim() || "";
        }
        if (!labelText) {
          const wrapper = input.closest("label");
          labelText = wrapper?.textContent?.trim() || "";
        }
        const option = {
          id,
          value: input.value ? String(input.value) : "",
          label: labelText,
        };
        if (!radioGroups.has(name)) {
          radioGroups.set(name, []);
        }
        radioGroups.get(name)?.push(option);
      });

    for (const [name, options] of radioGroups.entries()) {
      const usable = options.filter(
        (option) => option.value || option.label,
      );
      if (usable.length > 0) {
        return { name, options: usable };
      }
    }

    return null;
  });
}

async function selectVariantOption(page, group, option) {
  const scope = page
    .locator('form[action^="/cart/add"], .product__info-wrapper')
    .first();
  const optionLabel = option.value || option.label;
  if (option.id) {
    const label = scope.locator(`label[for="${option.id}"]`).first();
    if ((await label.count()) > 0) {
      await label.scrollIntoViewIfNeeded();
      await label.click();
      return;
    }
  }

  if (group.name && optionLabel) {
    const fieldset = scope
      .locator(`fieldset:has(legend:has-text("${group.name}"))`)
      .first();
    if ((await fieldset.count()) > 0) {
      const label = fieldset
        .locator(`label:has-text("${optionLabel}")`)
        .first();
      if ((await label.count()) > 0) {
        await label.scrollIntoViewIfNeeded();
        await label.click();
        return;
      }
    }
  }

  if (optionLabel) {
    const label = scope.locator(`label:has-text("${optionLabel}")`).first();
    if ((await label.count()) > 0) {
      await label.scrollIntoViewIfNeeded();
      await label.click();
      return;
    }
  }

  if (option.value) {
    const radio = scope
      .locator(`input[type="radio"][value="${option.value}"]`)
      .first();
    if ((await radio.count()) > 0) {
      await radio.scrollIntoViewIfNeeded();
      await radio.click({ force: true });
      return;
    }
  }

  throw new Error(
    `Could not select option ${optionLabel || option.value || "unknown"}`,
  );
}

async function selectVariantById(page, variantId) {
  const select = page.locator('select[name="id"]').first();
  if ((await select.count()) > 0) {
    await select.selectOption(variantId);
    return;
  }

  const selectionResult = await page.evaluate((id) => {
    const normalizeOptions = (variant) => {
      const optionValues = [];
      if (Array.isArray(variant?.options) && variant.options.length > 0) {
        variant.options.forEach((value) => optionValues.push(String(value)));
      } else {
        if (variant?.option1) optionValues.push(String(variant.option1));
        if (variant?.option2) optionValues.push(String(variant.option2));
        if (variant?.option3) optionValues.push(String(variant.option3));
      }
      if (
        optionValues.length === 0 &&
        typeof variant?.title === "string" &&
        variant.title !== "Default Title"
      ) {
        variant.title
          .split(" / ")
          .forEach((value) => optionValues.push(String(value)));
      }
      return optionValues;
    };

    const normalizeOptionNames = (product) => {
      if (!product?.options) return [];
      if (Array.isArray(product.options)) {
        if (
          product.options.length > 0 &&
          typeof product.options[0] === "string"
        ) {
          return product.options.map((name) => String(name));
        }
        if (
          product.options.length > 0 &&
          typeof product.options[0] === "object"
        ) {
          return product.options.map((opt) => String(opt?.name || ""));
        }
      }
      return [];
    };

    const findVariant = (product) => {
      const variants = Array.isArray(product?.variants)
        ? product.variants
        : [];
      return variants.find((item) => String(item?.id) === String(id));
    };

    const buildSelections = (product, variant) => {
      const optionValues = normalizeOptions(variant);
      if (optionValues.length === 0) return null;
      const optionNames = normalizeOptionNames(product);
      return optionValues.map((value, index) => ({
        name: optionNames[index] || "",
        value,
      }));
    };

    const analyticsProduct = window.ShopifyAnalytics?.meta?.product;
    if (analyticsProduct) {
      const analyticsVariant = findVariant(analyticsProduct);
      const selections = buildSelections(analyticsProduct, analyticsVariant);
      if (selections) {
        return { ok: true, selections };
      }
    }

    const scripts = Array.from(
      document.querySelectorAll('script[type="application/json"]'),
    );
    for (const script of scripts) {
      const text = script.textContent || "";
      if (!text.includes("variants")) continue;
      try {
        const parsed = JSON.parse(text);
        const candidateProduct = parsed?.product || parsed;
        const candidateVariant = findVariant(candidateProduct);
        if (!candidateVariant) continue;
        const selections = buildSelections(
          candidateProduct,
          candidateVariant,
        );
        if (selections) {
          return { ok: true, selections };
        }
      } catch (_error) {
        // Ignore unrelated JSON blocks
      }
    }

    const fallbackVariant = analyticsProduct
      ? findVariant(analyticsProduct)
      : null;
    if (!fallbackVariant) return { ok: false, reason: "missing-variant" };
    return { ok: false, reason: "missing-options" };
  }, variantId);

  if (!selectionResult?.ok) {
    throw new Error(
      `Variant ${variantId} not found (${selectionResult?.reason || "unknown"})`,
    );
  }

  const selections = selectionResult.selections;
  if (!selections.length) {
    throw new Error(`Variant ${variantId} has no selectable options`);
  }

  const scope = page
    .locator('form[action^="/cart/add"], .product__info-wrapper')
    .first();

  for (const [index, selection] of selections.entries()) {
    const optionName = selection.name;
    const optionValue = selection.value;
    let handled = false;

    const selectSelectors = [
      optionName ? `select[name="options[${optionName}]"]` : "",
      optionName ? `select[name="${optionName}"]` : "",
      `select[name="options[${index + 1}]"]`,
    ].filter(Boolean);

    for (const selector of selectSelectors) {
      const optionSelect = scope.locator(selector).first();
      if ((await optionSelect.count()) > 0) {
        await optionSelect.scrollIntoViewIfNeeded();
        await optionSelect.selectOption(optionValue);
        handled = true;
        break;
      }
    }

    if (!handled) {
      const radioSelectors = [
        optionName
          ? `input[type="radio"][name="${optionName}"][value="${optionValue}"]`
          : "",
        optionName
          ? `input[type="radio"][name="options[${optionName}]"][value="${optionValue}"]`
          : "",
        `input[type="radio"][value="${optionValue}"]`,
      ].filter(Boolean);

      for (const selector of radioSelectors) {
        const radioInput = scope.locator(selector).first();
        if ((await radioInput.count()) > 0) {
          const radioId = await radioInput.getAttribute("id");
          if (radioId) {
            const radioLabel = scope
              .locator(`label[for="${radioId}"]`)
              .first();
            if ((await radioLabel.count()) > 0) {
              await radioLabel.scrollIntoViewIfNeeded();
              await radioLabel.click();
              handled = true;
              break;
            }
          }

          await radioInput.scrollIntoViewIfNeeded();
          await radioInput.click({ force: true });
          handled = true;
          break;
        }
      }
    }

    if (!handled && optionName) {
      const fieldset = scope
        .locator(`fieldset:has(legend:has-text("${optionName}"))`)
        .first();
      if ((await fieldset.count()) > 0) {
        const label = fieldset
          .locator(`label:has-text("${optionValue}")`)
          .first();
        if ((await label.count()) > 0) {
          await label.scrollIntoViewIfNeeded();
          await label.click();
          handled = true;
        }
      }
    }

    if (!handled) {
      const label = scope
        .locator(`label:has-text("${optionValue}")`)
        .first();
      if ((await label.count()) > 0) {
        await label.scrollIntoViewIfNeeded();
        await label.click();
        handled = true;
      }
    }

    if (!handled) {
      throw new Error(
        `Could not select option ${optionName || `#${index + 1}`}=${optionValue}`,
      );
    }

    await page.waitForTimeout(200);
  }
}

function getDiscountDebugSnapshot(page) {
  return page.evaluate(() => {
    const ns = window["discounts-display-pro"];
    const productId = window.ShopifyAnalytics?.meta?.product?.id || null;
    if (!ns || typeof ns.utils?.getProducts !== "function") {
      return { productId, hasDebug: false };
    }
    const products = ns.utils.getProducts();
    return {
      productId,
      hasDebug: true,
      productKeys: Object.keys(products || {}),
      product: productId ? products?.[String(productId)] : null,
    };
  });
}

function setupConsoleLogging(page) {
  page.on("console", (msg) => {
    const text = msg.text();
    if (
      text.includes("Discount") ||
      msg.type() === "error" ||
      msg.type() === "warn"
    ) {
      console.log(`[Browser Console] ${text}`);
    }
  });
}

test.describe("Discount variant switching (non-subscription)", () => {
  test.beforeEach(async ({ page, context }) => {
    await context.clearCookies();
    setupConsoleLogging(page);

    await ensureProductPageLoaded(page);
    await waitForDiscountUI(page);
  });

  test("switching across 5 variants preserves 10% discount code", async ({
    page,
  }) => {
    const optionGroup = await getVariantOptionGroup(page);
    if (optionGroup) {
      console.log(
        "Detected option group:",
        optionGroup.name,
        optionGroup.options.map((option) => option.label || option.value),
      );
    }

    let selectionTargets;

    if (optionGroup && optionGroup.options.length >= 5) {
      selectionTargets = optionGroup.options.slice(0, 5).map((option) => ({
        type: "option",
        optionGroup,
        option,
      }));
    } else {
      const variantIds = await getVariantIds(page);
      console.log("Detected variant IDs:", variantIds);
      expect(variantIds.length).toBeGreaterThanOrEqual(5);
      selectionTargets = variantIds
        .slice(0, 5)
        .map((variantId) => ({ type: "variant", variantId }));
    }

    const results = [];

    const assertDiscountForVariant = async (target, step) => {
      if (target.type === "option") {
        await selectVariantOption(page, target.optionGroup, target.option);
      } else {
        await selectVariantById(page, target.variantId);
      }
      await page.waitForTimeout(800);
      await page.waitForFunction(
        (targetInfo) => {
          if (targetInfo?.type === "option") {
            const option = targetInfo.option;
            if (option?.id) {
              const input = document.getElementById(option.id);
              if (input) return input.checked;
            }
            if (option?.value) {
              const radio = document.querySelector(
                `input[type="radio"][value="${option.value}"]`,
              );
              if (radio) return radio.checked;
            }
            return true;
          }

          const id =
            targetInfo?.type === "variant" ? targetInfo.variantId : null;
          const select = document.querySelector('select[name="id"]');
          if (select && select.value)
            return String(select.value) === String(id);
          const checked = document.querySelector(
            'input[name="id"]:checked',
          );
          if (checked && checked.value)
            return String(checked.value) === String(id);
          const hidden = document.querySelector(
            'input[name="id"][type="hidden"]',
          );
          if (hidden && hidden.value)
            return String(hidden.value) === String(id);
          return false;
        },
        target,
      );

      try {
        await waitForDiscountContainer(page, 10000);
      } catch (error) {
        const snapshot = await getDiscountDebugSnapshot(page);
        console.log("Discount container missing; debug snapshot:", snapshot);
        throw error;
      }

      const hasDiscount = await isDiscountVisible(page);
      const percentage = await getDisplayedDiscountPercentage(page);
      const selectedVariantId = await getCurrentVariantId(page);

      const targetLabel =
        target.type === "variant"
          ? target.variantId
          : target.option.label || target.option.value;
      results.push({
        step,
        variantId: targetLabel,
        selectedVariantId,
        hasDiscount,
        percentage,
      });
      console.log(
        `[${step}] target=${targetLabel} selected=${selectedVariantId} visible=${hasDiscount} percentage=${percentage}`,
      );

      if (!hasDiscount || percentage !== 10) {
        const snapshot = await getDiscountDebugSnapshot(page);
        console.log("Unexpected discount state; debug snapshot:", snapshot);
      }

      expect(hasDiscount).toBe(true);
      expect(percentage).toBe(10);
    };

    for (const [index, target] of selectionTargets.entries()) {
      await test.step(`forward switch ${index + 1}`, async () => {
        await assertDiscountForVariant(target, `forward-${index + 1}`);
      });
    }

    await test.step("switch back to first variant", async () => {
      await assertDiscountForVariant(selectionTargets[0], "back-to-first");
    });

    await test.step("switch to second variant again", async () => {
      await assertDiscountForVariant(selectionTargets[1], "back-to-second");
    });

    console.log("Variant switching results:", results);
  });
});
