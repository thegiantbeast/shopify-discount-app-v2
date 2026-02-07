/**
 * Shared cart page helpers.
 */
import { parsePrice } from "./storefront.js";

/**
 * Resolves the cart item container for a given product.
 * @param {import('@playwright/test').Page} page
 * @param {string} productPath - e.g. '/products/the-collection-snowboard-liquid'
 * @returns {Promise<import('@playwright/test').Locator>}
 */
export async function resolveCartItemContainer(page, productPath) {
  const cartItem = page
    .locator(".cart-item, .cart__item, .cart__row, tr")
    .filter({ has: page.locator(`a[href*="${productPath}"]`) })
    .first();

  if (await cartItem.count()) {
    return cartItem;
  }

  return page.locator("main").first();
}

/**
 * Extracts the price value from a cart item container.
 * @param {import('@playwright/test').Locator} container
 * @returns {Promise<number|null>}
 */
export async function getCartItemPriceValue(container) {
  const directSelectors = [
    ".cart-item__final-price",
    ".cart-item__discounted-prices .cart-item__final-price",
    ".cart-item__price-wrapper dd.price.price--end",
    ".cart-item__price-wrapper .price.price--end",
  ];

  for (const selector of directSelectors) {
    const el = container.locator(selector).first();
    if (await el.count()) {
      const tagName = await el.evaluate((node) => node.tagName.toLowerCase());
      if (tagName === "s") continue;
      const text = await el.textContent();
      const value = parsePrice(text);
      if (value != null) return value;
    }
  }

  const priceText = await container.evaluate((node) => {
    const selectors = [
      ".cart-item__final-price",
      ".cart-item__discounted-prices .cart-item__final-price",
      ".cart-item__price-wrapper dd.price.price--end",
      ".cart-item__price-wrapper .price.price--end",
      ".cart-item__price-wrapper .price-item--sale",
      ".cart-item__price-wrapper .price-item--final",
      ".cart-item__price .price-item--final",
      ".cart-item__price .price-item--sale",
      ".cart-item__price .price-item",
      ".cart-item__price",
      ".cart-item__totals .price",
      ".price-item--sale",
      ".price-item--final",
      ".price-item",
      ".money",
    ];

    for (const selector of selectors) {
      const el = node.querySelector(selector);
      if (!el || !el.textContent) continue;
      if (el.tagName && el.tagName.toLowerCase() === "s") continue;
      return el.textContent;
    }

    const textEls = Array.from(node.querySelectorAll("*"));
    const priced = textEls
      .map((el) => el.textContent || "")
      .filter((text) => /[$€£]\s?\d/.test(text));
    return priced.length ? priced[priced.length - 1] : null;
  });

  return parsePrice(priceText);
}
