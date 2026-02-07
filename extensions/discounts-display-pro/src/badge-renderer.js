import { logger } from './logger.js';
import { formatPrice } from './currency-formatter.js';
import _ns from './namespace.js';

/**
 * Badge Renderer Module
 * Handles rendering of discount badges and price displays on product cards (collection pages).
 */

let layoutNudgeScheduled = false;
let postLoadNudgeScheduled = false;

/**
 * Creates automatic discount display elements for product cards.
 *
 * @param {HTMLElement} container - Parent container for discount elements
 * @param {Array<Object>} priceElements - Array of price element objects with container/element properties
 * @param {Object} options - Configuration options
 * @param {string} options.productId - Shopify product ID
 * @param {number} options.regularPrice - Original price before discount
 * @param {number} options.finalPrice - Price after discount applied
 * @param {Object} options.discount - Discount object with type, value, and scope info
 * @param {boolean} options.hasCurrencyCode - Whether to include currency code in formatting
 * @param {boolean} options.singlePrice - Whether this is a single-variant product
 * @returns {Array<HTMLElement>} Array of created discount elements
 */
export function createAutomaticDiscountDisplay(container, priceElements, options) {
  const {
    productId,
    regularPrice,
    finalPrice,
    discount,
    hasCurrencyCode,
    singlePrice
  } = options;

  const createdElements = [];

  try {
    logger.debug({ productId, discountId: discount.id }, 'Creating automatic discount display');

    priceElements.forEach((priceEl, index) => {
      try {
        // Check for existing discount elements to avoid duplicates
        const existingContainer = priceEl.container.querySelector('.discounted-price-container');
        const existingWrapper = priceEl.container.querySelector('.automatic-wrapper');

        if (existingContainer || existingWrapper) {
          logger.debug({ productId, index }, 'Discount elements already exist, skipping');
          return;
        }

        const isFullScope = discount.variantScope && discount.variantScope.type === 'ALL';
        const isPartialScope = discount.variantScope && discount.variantScope.type === 'PARTIAL';

        // Create price container
        const priceContainer = document.createElement('div');
        priceContainer.className = 'discounted-price-container';

        if (isFullScope) {
          // Hide original price
          priceEl.container.style.display = 'none';

          // Add "From" prefix for multi-variant products
          if (!singlePrice) {
            const fromPrefix = document.createElement('span');
            fromPrefix.className = 'discount-from-prefix';
            fromPrefix.textContent = 'From ';
            priceContainer.appendChild(fromPrefix);
          }

          // Create crossed-out regular price
          const regularPriceSpan = document.createElement('span');
          regularPriceSpan.className = 'discounted-price__regular';
          regularPriceSpan.textContent = formatPrice(regularPrice, hasCurrencyCode);
          priceContainer.appendChild(regularPriceSpan);

          // Create sale price
          const salePriceSpan = document.createElement('span');
          salePriceSpan.className = 'discounted-price__sale';
          salePriceSpan.textContent = formatPrice(finalPrice, hasCurrencyCode);
          priceContainer.appendChild(salePriceSpan);
        }

        // Create badge
        const badge = document.createElement('span');
        badge.className = 'discounted-price__badge';

        // Format badge text using template
        const badgeTemplate = _ns.automaticBadgeText || 'Save {amount}';
        const discountAmount = formatDiscountAmount(discount, hasCurrencyCode);
        badge.textContent = badgeTemplate.replace('{amount}', discountAmount);

        // Create alignment wrapper
        const wrapper = document.createElement('div');
        wrapper.className = 'automatic-wrapper';

        // Apply alignment from settings
        const alignment = _ns.badgeAlignment || 'left';
        const justifyMap = {
          left: 'flex-start',
          center: 'center',
          right: 'flex-end'
        };
        wrapper.style.display = 'flex';
        wrapper.style.justifyContent = justifyMap[alignment] || 'flex-start';
        wrapper.style.alignItems = 'center';
        wrapper.style.gap = '8px';
        wrapper.style.marginTop = '4px';

        // Append price container and badge to wrapper
        if (isFullScope) {
          wrapper.appendChild(priceContainer);
        }
        wrapper.appendChild(badge);

        // Add "in selected items" text for partial scope
        if (isPartialScope) {
          const selectedItemsText = document.createElement('span');
          selectedItemsText.className = 'discount-selected-items-text';
          selectedItemsText.textContent = 'in selected items';
          selectedItemsText.style.fontSize = '0.875em';
          selectedItemsText.style.color = '#666';
          wrapper.appendChild(selectedItemsText);
        }

        // Insert wrapper after the price container
        priceEl.container.parentNode.insertBefore(wrapper, priceEl.container.nextSibling);

        createdElements.push(wrapper);

        logger.debug({ productId, index }, 'Automatic discount display created');
      } catch (err) {
        logger.error({ err, productId, index }, 'Failed to create discount display for price element');
      }
    });

    // Trigger layout nudge
    scheduleLayoutNudge();
    schedulePostLoadNudge();

    logger.info({ productId, count: createdElements.length }, 'Automatic discount displays created');
  } catch (err) {
    logger.error({ err, productId }, 'Failed to create automatic discount display');
  }

  return createdElements;
}

/**
 * Creates coupon badge display for product cards.
 *
 * @param {HTMLElement} container - Parent container for coupon elements
 * @param {Array<Object>} priceElements - Array of price element objects
 * @param {Object} options - Configuration options
 * @param {string} options.productId - Shopify product ID
 * @param {Object} options.discount - Discount object with type, value, and scope info
 * @param {boolean} options.hasCurrencyCode - Whether to include currency code in formatting
 * @returns {Array<HTMLElement>} Array of created coupon badge elements
 */
export function createCouponBadge(container, priceElements, options) {
  const {
    productId,
    discount,
    hasCurrencyCode
  } = options;

  const createdElements = [];

  try {
    logger.debug({ productId, discountId: discount.id }, 'Creating coupon badge');

    priceElements.forEach((priceEl, index) => {
      try {
        // Check for existing coupon badges to avoid duplicates
        const existingBadge = priceEl.container.querySelector('.coupon-badge');
        const existingWrapper = priceEl.container.querySelector('.coupon-wrapper');

        if (existingBadge || existingWrapper) {
          logger.debug({ productId, index }, 'Coupon badge already exists, skipping');
          return;
        }

        const isPartialScope = discount.variantScope && discount.variantScope.type === 'PARTIAL';

        // Create badge
        const badge = document.createElement('div');
        badge.className = 'coupon-badge';

        // Format badge text using template
        const badgeTemplate = _ns.couponBadgeText || 'Save {amount} with coupon';
        const discountAmount = formatDiscountAmount(discount, hasCurrencyCode);
        badge.textContent = badgeTemplate.replace('{amount}', discountAmount);

        // Create alignment wrapper
        const wrapper = document.createElement('div');
        wrapper.className = 'coupon-wrapper';

        // Apply alignment from settings
        const alignment = _ns.badgeAlignment || 'left';
        const justifyMap = {
          left: 'flex-start',
          center: 'center',
          right: 'flex-end'
        };
        wrapper.style.display = 'flex';
        wrapper.style.justifyContent = justifyMap[alignment] || 'flex-start';
        wrapper.style.alignItems = 'center';
        wrapper.style.gap = '8px';
        wrapper.style.marginTop = '4px';

        wrapper.appendChild(badge);

        // Add "in selected items" text for partial scope
        if (isPartialScope) {
          const selectedItemsText = document.createElement('span');
          selectedItemsText.className = 'discount-selected-items-text';
          selectedItemsText.textContent = 'in selected items';
          selectedItemsText.style.fontSize = '0.875em';
          selectedItemsText.style.color = '#666';
          wrapper.appendChild(selectedItemsText);
        }

        // Insert wrapper after the price container
        priceEl.container.parentNode.insertBefore(wrapper, priceEl.container.nextSibling);

        createdElements.push(wrapper);

        logger.debug({ productId, index }, 'Coupon badge created');
      } catch (err) {
        logger.error({ err, productId, index }, 'Failed to create coupon badge for price element');
      }
    });

    // Trigger layout nudge
    scheduleLayoutNudge();
    schedulePostLoadNudge();

    logger.info({ productId, count: createdElements.length }, 'Coupon badges created');
  } catch (err) {
    logger.error({ err, productId }, 'Failed to create coupon badge');
  }

  return createdElements;
}

/**
 * Schedules a layout nudge to trigger theme layout recalculation.
 * Batches multiple requests into a single RAF callback.
 */
function scheduleLayoutNudge() {
  if (layoutNudgeScheduled) {
    return;
  }

  layoutNudgeScheduled = true;

  requestAnimationFrame(() => {
    try {
      // Dispatch resize event to trigger theme layout recalculation
      window.dispatchEvent(new Event('resize'));
      logger.debug({}, 'Layout nudge triggered');
    } catch (err) {
      logger.error({ err }, 'Failed to trigger layout nudge');
    } finally {
      layoutNudgeScheduled = false;
    }
  });
}

/**
 * Schedules post-load layout nudges at 50ms and 250ms after window load.
 * Helps ensure theme layouts properly accommodate discount elements.
 */
function schedulePostLoadNudge() {
  if (postLoadNudgeScheduled) {
    return;
  }

  postLoadNudgeScheduled = true;

  const triggerNudge = () => {
    try {
      // First nudge at 50ms
      setTimeout(() => {
        window.dispatchEvent(new Event('resize'));
        logger.debug({}, 'Post-load nudge (50ms) triggered');
      }, 50);

      // Second nudge at 250ms
      setTimeout(() => {
        window.dispatchEvent(new Event('resize'));
        logger.debug({}, 'Post-load nudge (250ms) triggered');
      }, 250);
    } catch (err) {
      logger.error({ err }, 'Failed to trigger post-load nudges');
    }
  };

  if (document.readyState === 'complete') {
    triggerNudge();
  } else {
    window.addEventListener('load', triggerNudge, { once: true });
  }
}

/**
 * Formats discount amount for display in badges.
 *
 * @param {Object} discount - Discount object with type and value
 * @param {boolean} hasCurrencyCode - Whether to include currency code
 * @returns {string} Formatted discount amount (e.g., "20%" or "$5.00")
 */
function formatDiscountAmount(discount, hasCurrencyCode) {
  try {
    if (discount.type === 'percentage') {
      return `${discount.value}%`;
    } else if (discount.type === 'fixed_amount') {
      return formatPrice(discount.value, hasCurrencyCode);
    } else {
      logger.warn({ discountType: discount.type }, 'Unknown discount type');
      return formatPrice(discount.value, hasCurrencyCode);
    }
  } catch (err) {
    logger.error({ err, discount }, 'Failed to format discount amount');
    return '$0.00';
  }
}
