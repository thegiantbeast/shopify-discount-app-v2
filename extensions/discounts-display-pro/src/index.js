/**
 * Discount Display Pro - Main Orchestrator
 *
 * Entry point that coordinates all modules:
 * - Theme selector initialization
 * - Product data loading
 * - DOM scanning and discount application
 * - Variant change detection
 * - Missing product queue management
 * - Preview mode support
 * - MutationObserver for dynamic content
 */

import { logger } from './logger.js';
import { isHiddenWithinBoundary } from './hidden-element-detector.js';
import { formatPrice, parsePrice, hasCurrencyCode, extractCurrencyFormat, calculateDiscountedPrice } from './currency-formatter.js';
import {
  normalizeThemeName, pickThemeSelector, ensureThemeSelectorsReady,
  subscribeToThemeSelectorUpdates
} from './theme-selectors.js';
import { resolveShopDomain, loadDiscountData, fetchAdditionalDiscountData, requestBestDiscounts } from './api-client.js';
import { parsePriceFromDOM, findPriceElements } from './price-extractor.js';
import { createAutomaticDiscountDisplay, createCouponBadge } from './badge-renderer.js';
import { createPriceContainer, createCouponBlock, showTermsModal, buildSkeletonLoader } from './ui-components.js';
import { setupVariantDetection, getCurrentVariantInfo, getCurrentSellingPlanInfo } from './variant-detector.js';
import { applyDiscountCode, getCouponState, setCouponState, initCouponState } from './coupon-handler.js';
import { PURCHASE_CONTEXT, resolvePurchaseContext, isDiscountEligibleForSellingPlan, filterDiscountsByPurchaseContext } from './subscription-handler.js';
import _ns from './namespace.js';

// ============================================================================
// Core State Management
// ============================================================================

/**
 * Product data cache - keyed by product ID
 * Structure: { [productId]: { id, handle, title, variants, discounts, ... } }
 */
let products = {};

/**
 * Variant ID to Product ID mapping for quick lookups
 */
let VARIANT_TO_PRODUCT = {};

/**
 * Initialization state flags
 */
let initializationAttempted = false;
let initializationComplete = false;

/**
 * Missing product queue - for products discovered in DOM but not in initial data
 */
const missingProductQueue = {
  productIds: new Set(),
  handles: new Set(),
  variantIds: new Set(),
  containers: new Map() // container -> { productId, handle, variantIds }
};

let missingProductQueueTimer = null;
let missingProductFetchInFlight = false;
const missingProductAttempts = new Map(); // key -> attempt count
let missingProductFetchFailureCount = 0;

/**
 * Whether the shop's tier allows coupon auto-apply (BASIC+)
 */
let autoApplyEnabled = false;

const MAX_MISSING_PRODUCT_ATTEMPTS = 5;
const MAX_FAILURE_BACKOFF_MS = 10000;
const BASE_FAILURE_BACKOFF_MS = 250;
const MAX_GLOBAL_FETCH_FAILURES = 5;

/**
 * Debounce and processing state - WeakMaps for per-container state
 */
const FORM_PROCESS_DEBOUNCE_MS = 250;
const VARIANT_REAPPLY_FALLBACK_MS = 750;
const SKELETON_TIMEOUT_MS = 8000;
const SKELETON_MIN_DISPLAY_MS = 300;

const __wfLastRunAt = new WeakMap(); // container -> timestamp
const __wfLastVariant = new WeakMap(); // container -> variantId
const __wfReapplying = new WeakSet(); // container set
const __wfSkeletonShownAt = new WeakMap(); // container -> timestamp
const __wfSkeletonTimeoutTimers = new WeakMap(); // container -> timeoutId
const __wfBestDiscountFetches = new Map(); // cacheKey -> Promise
const __wfBestDiscountAwaitingContainers = new Map(); // cacheKey -> Set(containers)

/**
 * Selector state - computed once at init, refreshed on theme selector updates
 */
let EMBED_PRICE_CONTAINER_SELECTOR = '';
let PRODUCT_CONTAINER_SELECTOR = '';
let VARIANT_INPUT_SELECTOR = '';
let FORM_CONTAINER_SELECTOR = '';
let FORM_PRICE_CONTAINER_SELECTOR = '';
let FORM_PRICE_DISCOUNTED_SELECTOR = '';
const SELECTOR_RESOLUTION = {}; // For debugging/logging

// ============================================================================
// Selector Initialization
// ============================================================================

/**
 * Initialize all theme selectors based on _ns.selectorOverrides and theme detection
 */
function initializeSelectors() {
  logger.info('Initializing theme selectors');

  const settings = _ns.selectorOverrides || {};
  const FORCE_AUTO = settings.themeSelectors_forceAutoDetection === true;
  const placeholder = 'leave empty for theme auto detection';

  /**
   * Resolve a selector with custom override logic
   */
  function resolveSelector(key, defaultFallback) {
    const enableKey = `themeSelectors_${key}_enable`;
    const customKey = `themeSelectors_${key}_custom`;

    const isEnabled = settings[enableKey] === true;
    const customValue = settings[customKey];

    // Use custom value if: not force auto, setting enabled, custom value exists, and not placeholder
    if (!FORCE_AUTO && isEnabled && customValue && customValue.toLowerCase() !== placeholder.toLowerCase()) {
      logger.info({ key, customValue }, 'Using custom selector');
      return customValue;
    }

    // Otherwise use theme detection
    const state = _ns._themeState;
    const themeName = state?.resolvedTheme || 'dawn';
    const result = pickThemeSelector(themeName, key, null);
    if (result && result.value) {
      logger.info({ key, detected: result.value, source: result.source }, 'Using detected selector');
      return result.value;
    }

    // Fall back to default
    logger.info({ key, fallback: defaultFallback }, 'Using default selector');
    return defaultFallback;
  }

  // Resolve each selector
  EMBED_PRICE_CONTAINER_SELECTOR = resolveSelector('cardPrice', '.price__container');
  PRODUCT_CONTAINER_SELECTOR = resolveSelector('cardContainer', '.grid__item, product-card, .product-card');
  VARIANT_INPUT_SELECTOR = resolveSelector('variantInput', 'input[ref="variantId"], input[name="id"], select[name="id"], [data-variant-id]');
  FORM_CONTAINER_SELECTOR = resolveSelector('formContainer', 'form[action*="/cart/add"]');
  FORM_PRICE_CONTAINER_SELECTOR = resolveSelector('formPrice', '.price__container');
  FORM_PRICE_DISCOUNTED_SELECTOR = resolveSelector('formPrice_discounted', '.price__sale');

  // Store resolution for debugging
  SELECTOR_RESOLUTION.cardPrice = EMBED_PRICE_CONTAINER_SELECTOR;
  SELECTOR_RESOLUTION.cardContainer = PRODUCT_CONTAINER_SELECTOR;
  SELECTOR_RESOLUTION.variantInput = VARIANT_INPUT_SELECTOR;
  SELECTOR_RESOLUTION.formContainer = FORM_CONTAINER_SELECTOR;
  SELECTOR_RESOLUTION.formPrice = FORM_PRICE_CONTAINER_SELECTOR;
  SELECTOR_RESOLUTION.formPrice_discounted = FORM_PRICE_DISCOUNTED_SELECTOR;

  // Expose key selectors on window for external access
  _ns._formPriceSelector = FORM_PRICE_CONTAINER_SELECTOR;
  _ns._formSelector = FORM_CONTAINER_SELECTOR;

  logger.info({ selectors: SELECTOR_RESOLUTION }, 'Selectors initialized');
}

// ============================================================================
// Container Detection
// ============================================================================

/**
 * Find all product card containers on the page
 */
function findProductContainers() {
  if (!PRODUCT_CONTAINER_SELECTOR) {
    logger.warn('Product container selector not initialized');
    return [];
  }

  try {
    const containers = Array.from(document.querySelectorAll(PRODUCT_CONTAINER_SELECTOR));
    logger.info({ count: containers.length }, 'Found product containers');
    return containers;
  } catch (err) {
    logger.error({ err, selector: PRODUCT_CONTAINER_SELECTOR }, 'Error finding product containers');
    return [];
  }
}

/**
 * Find all form containers on the page
 */
function findFormContainers() {
  if (!FORM_CONTAINER_SELECTOR) {
    logger.warn('Form container selector not initialized');
    return [];
  }

  try {
    const containers = Array.from(document.querySelectorAll(FORM_CONTAINER_SELECTOR));
    logger.info({ count: containers.length }, 'Found form containers');
    return containers;
  } catch (err) {
    logger.error({ err, selector: FORM_CONTAINER_SELECTOR }, 'Error finding form containers');
    return [];
  }
}

/**
 * Check if a container is a form container
 */
function isFormContainer(container) {
  if (!container) return false;

  try {
    // Check if matches form selector
    if (FORM_CONTAINER_SELECTOR && container.matches(FORM_CONTAINER_SELECTOR)) {
      return true;
    }

    // Check if contains cart form
    const cartForm = container.querySelector('form[action*="/cart/add"]');
    if (cartForm) {
      return true;
    }

    return false;
  } catch (err) {
    logger.error({ err }, 'Error checking if form container');
    return false;
  }
}

// ============================================================================
// Product ID Detection
// ============================================================================

/**
 * Find product ID for a given container using multiple strategies
 */
function findProductId(container) {
  if (!container) return null;

  try {
    // Strategy 1: Variant input -> VARIANT_TO_PRODUCT mapping
    const variantInput = container.querySelector(VARIANT_INPUT_SELECTOR);
    if (variantInput) {
      const variantId = variantInput.value || variantInput.getAttribute('data-variant-id') || variantInput.getAttribute('ref');
      if (variantId) {
        const productId = VARIANT_TO_PRODUCT[variantId];
        if (productId) {
          logger.debug({ variantId, productId }, 'Found product ID via variant mapping');
          return productId;
        }
      }
    }

    // Strategy 2: Container data-product-id attribute
    const containerProductId = container.getAttribute('data-product-id');
    if (containerProductId) {
      logger.debug({ productId: containerProductId }, 'Found product ID via container attribute');
      return containerProductId;
    }

    // Strategy 3: Input[name="product-id"] or input[name="product_id"]
    const productInput = container.querySelector('input[name="product-id"], input[name="product_id"]');
    if (productInput?.value) {
      logger.debug({ productId: productInput.value }, 'Found product ID via product input');
      return productInput.value;
    }

    // Strategy 4: Inner element with data-product-id
    const innerProductEl = container.querySelector('[data-product-id]');
    if (innerProductEl) {
      const innerProductId = innerProductEl.getAttribute('data-product-id');
      if (innerProductId) {
        logger.debug({ productId: innerProductId }, 'Found product ID via inner element');
        return innerProductId;
      }
    }

    // Strategy 5: Link href /products/<handle> -> match to products by handle
    const productLink = container.querySelector('a[href*="/products/"]');
    if (productLink) {
      const href = productLink.getAttribute('href');
      const match = href.match(/\/products\/([^?/#]+)/);
      if (match) {
        const handle = match[1];
        // Search products by handle
        for (const [productId, product] of Object.entries(products)) {
          if (product.handle === handle) {
            logger.debug({ handle, productId }, 'Found product ID via handle match');
            return productId;
          }
        }
        // Queue handle for fetching
        logger.debug({ handle }, 'Product handle found but not in cache');
        queueMissingProductData(container, null, handle);
      }
    }

    // Strategy 6: Link ID attribute numeric extraction
    if (productLink) {
      const linkId = productLink.getAttribute('id');
      if (linkId) {
        const numericMatch = linkId.match(/(\d{10,})/); // Shopify IDs are typically 10+ digits
        if (numericMatch) {
          const candidateId = numericMatch[1];
          if (products[candidateId]) {
            logger.debug({ productId: candidateId }, 'Found product ID via link ID extraction');
            return candidateId;
          }
        }
      }
    }

    // Strategy 7: Section-scope variant/product-id search
    const sectionId = container.closest('[id*="shopify-section"]')?.id;
    if (sectionId) {
      const sectionScope = document.getElementById(sectionId);
      if (sectionScope) {
        const sectionProductInput = sectionScope.querySelector('input[name="product-id"], input[name="product_id"]');
        if (sectionProductInput?.value) {
          logger.debug({ productId: sectionProductInput.value, sectionId }, 'Found product ID via section scope');
          return sectionProductInput.value;
        }
      }
    }

    logger.debug('Could not find product ID for container');
    return null;
  } catch (err) {
    logger.error({ err }, 'Error finding product ID');
    return null;
  }
}

// ============================================================================
// Data Management
// ============================================================================

/**
 * Merge discount data from API into local cache
 */
function mergeDiscountData(discountData) {
  if (!discountData || !discountData.products) {
    logger.warn('Invalid discount data received');
    return;
  }

  try {
    // Capture tier-gated feature flags from API response
    if (discountData.autoApplyEnabled !== undefined) {
      autoApplyEnabled = discountData.autoApplyEnabled;
    }

    const newProducts = discountData.products;
    let mergedCount = 0;

    for (const [productId, productData] of Object.entries(newProducts)) {
      products[productId] = productData;
      mergedCount++;

      // Build variant-to-product mapping
      if (productData.variants && Array.isArray(productData.variants)) {
        for (const variant of productData.variants) {
          if (variant.id) {
            VARIANT_TO_PRODUCT[variant.id] = productId;
          }
        }
      }
    }

    logger.info({ mergedCount, totalProducts: Object.keys(products).length }, 'Merged discount data');
  } catch (err) {
    logger.error({ err }, 'Error merging discount data');
  }
}

/**
 * Collect all product context from the current page (product IDs, variant IDs, handles)
 */
function collectPageProductContext() {
  const context = {
    productIds: new Set(),
    variantIds: new Set(),
    handles: new Set()
  };

  try {
    // Find all containers
    const containers = [
      ...findProductContainers(),
      ...findFormContainers()
    ];

    for (const container of containers) {
      // Try to find product ID
      const productId = findProductId(container);
      if (productId) {
        context.productIds.add(productId);
      }

      // Try to find variant ID
      const variantInput = container.querySelector(VARIANT_INPUT_SELECTOR);
      if (variantInput) {
        const variantId = variantInput.value || variantInput.getAttribute('data-variant-id') || variantInput.getAttribute('ref');
        if (variantId) {
          context.variantIds.add(variantId);
        }
      }

      // Try to find product handle
      const productLink = container.querySelector('a[href*="/products/"]');
      if (productLink) {
        const href = productLink.getAttribute('href');
        const match = href.match(/\/products\/([^?/#]+)/);
        if (match) {
          context.handles.add(match[1]);
        }
      }
    }

    // Convert Sets to Arrays
    const result = {
      productIds: Array.from(context.productIds),
      variantIds: Array.from(context.variantIds),
      handles: Array.from(context.handles)
    };

    logger.info(result, 'Collected page product context');
    return result;
  } catch (err) {
    logger.error({ err }, 'Error collecting page product context');
    return { productIds: [], variantIds: [], handles: [] };
  }
}

/**
 * Load all products from database (initial page load)
 */
async function loadAllProductsFromDatabase() {
  try {
    logger.info('Loading discount data from database');

    // Collect page context to send with request
    const context = collectPageProductContext();

    const discountData = await loadDiscountData(context);
    if (discountData) {
      mergeDiscountData(discountData);
    }
  } catch (err) {
    logger.error({ err }, 'Error loading products from database');
  }
}

// ============================================================================
// Missing Product Queue
// ============================================================================

/**
 * Queue a product for fetching if not in cache
 */
function queueMissingProductData(container, productId = null, handle = null, variantIds = []) {
  try {
    // Don't queue if already at max attempts
    const key = productId || handle || variantIds.join(',');
    if (missingProductAttempts.get(key) >= MAX_MISSING_PRODUCT_ATTEMPTS) {
      logger.debug({ key }, 'Max attempts reached for missing product');
      return;
    }

    // Don't queue if global failure count too high
    if (missingProductFetchFailureCount >= MAX_GLOBAL_FETCH_FAILURES) {
      logger.warn('Global fetch failure count exceeded, not queuing');
      return;
    }

    // Add to queue
    if (productId) missingProductQueue.productIds.add(productId);
    if (handle) missingProductQueue.handles.add(handle);
    if (variantIds.length > 0) {
      variantIds.forEach(vid => missingProductQueue.variantIds.add(vid));
    }

    // Store container mapping
    if (container) {
      missingProductQueue.containers.set(container, { productId, handle, variantIds });
    }

    logger.debug({ productId, handle, variantIds }, 'Queued missing product data');

    // Schedule flush
    if (missingProductQueueTimer) {
      clearTimeout(missingProductQueueTimer);
    }

    const backoffMs = Math.min(
      BASE_FAILURE_BACKOFF_MS * Math.pow(2, missingProductFetchFailureCount),
      MAX_FAILURE_BACKOFF_MS
    );

    missingProductQueueTimer = setTimeout(() => {
      flushMissingProductData();
    }, backoffMs);
  } catch (err) {
    logger.error({ err }, 'Error queuing missing product data');
  }
}

/**
 * Flush missing product queue and fetch from API
 */
async function flushMissingProductData() {
  if (missingProductFetchInFlight) {
    logger.debug('Missing product fetch already in flight');
    return;
  }

  if (missingProductQueue.productIds.size === 0 &&
      missingProductQueue.handles.size === 0 &&
      missingProductQueue.variantIds.size === 0) {
    logger.debug('Missing product queue is empty');
    return;
  }

  missingProductFetchInFlight = true;

  try {
    // Snapshot current queue
    const productIds = Array.from(missingProductQueue.productIds);
    const handles = Array.from(missingProductQueue.handles);
    const variantIds = Array.from(missingProductQueue.variantIds);
    const containers = new Map(missingProductQueue.containers);

    // Clear queue
    missingProductQueue.productIds.clear();
    missingProductQueue.handles.clear();
    missingProductQueue.variantIds.clear();
    missingProductQueue.containers.clear();

    logger.info({ productIds, handles, variantIds }, 'Flushing missing product queue');

    // Increment attempt counts
    productIds.forEach(id => {
      const count = missingProductAttempts.get(id) || 0;
      missingProductAttempts.set(id, count + 1);
    });
    handles.forEach(h => {
      const count = missingProductAttempts.get(h) || 0;
      missingProductAttempts.set(h, count + 1);
    });

    // Fetch data
    const result = await fetchAdditionalDiscountData({
      productIds,
      handles,
      variantIds
    });

    if (result.success && result.data) {
      mergeDiscountData(result.data);

      // Reset failure count on success
      missingProductFetchFailureCount = 0;

      // Reapply discounts to waiting containers
      for (const [container, queueData] of containers.entries()) {
        if (!container.isConnected) continue;

        const productId = queueData.productId || findProductId(container);
        if (productId && products[productId]) {
          logger.debug({ productId }, 'Reapplying discounts after missing product fetch');
          applyDiscountsToProduct(container, productId);
        }
      }
    } else {
      // Increment failure count
      missingProductFetchFailureCount++;
      logger.warn({ failureCount: missingProductFetchFailureCount }, 'Missing product fetch failed');

      // Re-queue if not at max attempts
      for (const [container, queueData] of containers.entries()) {
        if (!container.isConnected) continue;
        queueMissingProductData(container, queueData.productId, queueData.handle, queueData.variantIds);
      }
    }
  } catch (err) {
    logger.error({ err }, 'Error flushing missing product queue');
    missingProductFetchFailureCount++;
  } finally {
    missingProductFetchInFlight = false;
  }
}

// ============================================================================
// Best Discount Computation
// ============================================================================

/**
 * Compute best discounts locally (client-side)
 */
function computeBestDiscountsLocally(discounts, regularPrice) {
  if (!discounts || discounts.length === 0) {
    return {
      automaticDiscount: null,
      couponDiscount: null,
      automaticFinalPrice: null,
      couponFinalPrice: null
    };
  }

  try {
    const priceValue = typeof regularPrice === 'number' ? regularPrice : parsePrice(regularPrice);

    // Separate automatic and coupon discounts
    const automaticDiscounts = discounts.filter(d => d.isAutomatic);
    const couponDiscounts = discounts.filter(d => !d.isAutomatic);

    // Find best automatic discount (lowest final price)
    let bestAutomatic = null;
    let bestAutomaticPrice = Infinity;

    for (const discount of automaticDiscounts) {
      const finalPrice = calculateDiscountedPrice(priceValue, discount);
      if (finalPrice < bestAutomaticPrice) {
        bestAutomaticPrice = finalPrice;
        bestAutomatic = discount;
      }
    }

    // Find best coupon discount (lowest final price)
    let bestCoupon = null;
    let bestCouponPrice = Infinity;

    for (const discount of couponDiscounts) {
      const finalPrice = calculateDiscountedPrice(priceValue, discount);
      if (finalPrice < bestCouponPrice) {
        bestCouponPrice = finalPrice;
        bestCoupon = discount;
      }
    }

    // If automatic discount wins, suppress coupon
    if (bestAutomatic && bestCoupon && bestAutomaticPrice <= bestCouponPrice) {
      bestCoupon = null;
      bestCouponPrice = null;
    }

    return {
      automaticDiscount: bestAutomatic,
      couponDiscount: bestCoupon,
      automaticFinalPrice: bestAutomatic ? bestAutomaticPrice : null,
      couponFinalPrice: bestCoupon ? bestCouponPrice : null
    };
  } catch (err) {
    logger.error({ err }, 'Error computing best discounts locally');
    return {
      automaticDiscount: null,
      couponDiscount: null,
      automaticFinalPrice: null,
      couponFinalPrice: null
    };
  }
}

/**
 * Ensure best discounts from API (with caching and fallback)
 */
async function ensureBestDiscountsFromAPI(options) {
  const {
    productId,
    variantId,
    regularPrice,
    sellingPlanId = null,
    discounts
  } = options;

  try {
    // Build cache key
    const cacheKey = `${productId}:${variantId}:${sellingPlanId || 'none'}`;

    // Check if fetch already in flight
    if (__wfBestDiscountFetches.has(cacheKey)) {
      logger.debug({ cacheKey }, 'Best discount fetch already in flight');
      return await __wfBestDiscountFetches.get(cacheKey);
    }

    // Start fetch
    const fetchPromise = (async () => {
      try {
        const shopDomain = resolveShopDomain();
        if (!shopDomain) {
          throw new Error('Shop domain not found');
        }

        const result = await requestBestDiscounts({
          shop: shopDomain,
          entries: [{
            productId,
            variantId,
            regularPrice: typeof regularPrice === 'number' ? regularPrice : parsePrice(regularPrice),
            sellingPlanId
          }]
        });

        return result;
      } catch (err) {
        logger.error({ err, cacheKey }, 'Best discount API request failed');
        // Fallback to local computation
        return computeBestDiscountsLocally(discounts, regularPrice);
      } finally {
        // Clean up cache
        __wfBestDiscountFetches.delete(cacheKey);
      }
    })();

    __wfBestDiscountFetches.set(cacheKey, fetchPromise);
    return await fetchPromise;
  } catch (err) {
    logger.error({ err }, 'Error ensuring best discounts from API');
    return computeBestDiscountsLocally(discounts, regularPrice);
  }
}

// ============================================================================
// Skeleton Loader
// ============================================================================

/**
 * Show processing skeleton for form container
 */
function showFormProcessingSkeleton(container) {
  if (!container) return;

  try {
    // Check if already showing
    if (__wfSkeletonShownAt.has(container)) {
      return;
    }

    // Clear any existing discount UI
    clearExistingDiscounts(container);

    // Create skeleton
    const skeleton = buildSkeletonLoader();
    if (!skeleton) return;

    // Insert skeleton
    const priceEl = container.querySelector(FORM_PRICE_CONTAINER_SELECTOR);
    if (priceEl && priceEl.parentElement) {
      priceEl.parentElement.insertBefore(skeleton, priceEl);
      priceEl.style.display = 'none';
    } else {
      container.insertBefore(skeleton, container.firstChild);
    }

    // Mark shown
    __wfSkeletonShownAt.set(container, Date.now());

    // Set timeout to remove skeleton if it takes too long
    const timeoutId = setTimeout(() => {
      clearFormProcessingSkeleton(container, { force: true });
    }, SKELETON_TIMEOUT_MS);

    __wfSkeletonTimeoutTimers.set(container, timeoutId);

    logger.debug('Showing form processing skeleton');
  } catch (err) {
    logger.error({ err }, 'Error showing skeleton');
  }
}

/**
 * Clear processing skeleton from form container
 */
function clearFormProcessingSkeleton(container, options = {}) {
  if (!container) return;

  try {
    const shownAt = __wfSkeletonShownAt.get(container);
    if (!shownAt) return;

    const elapsed = Date.now() - shownAt;
    const force = options.force === true;

    // Ensure minimum display time unless forced
    if (!force && elapsed < SKELETON_MIN_DISPLAY_MS) {
      setTimeout(() => {
        clearFormProcessingSkeleton(container, { force: true });
      }, SKELETON_MIN_DISPLAY_MS - elapsed);
      return;
    }

    // Remove skeleton
    const skeleton = container.querySelector('.ddp-skeleton-loader');
    if (skeleton) {
      skeleton.remove();
    }

    // Clear timeout
    const timeoutId = __wfSkeletonTimeoutTimers.get(container);
    if (timeoutId) {
      clearTimeout(timeoutId);
      __wfSkeletonTimeoutTimers.delete(container);
    }

    // Clear state
    __wfSkeletonShownAt.delete(container);

    logger.debug('Cleared form processing skeleton');
  } catch (err) {
    logger.error({ err }, 'Error clearing skeleton');
  }
}

/**
 * Mark variant switch and trigger debounced reapply
 */
function markVariantSwitch(container, nextVariantId) {
  if (!container) return;

  try {
    const prevVariantId = __wfLastVariant.get(container);

    if (prevVariantId === nextVariantId) {
      logger.debug({ variantId: nextVariantId }, 'Variant unchanged, skipping');
      return;
    }

    logger.info({ prevVariantId, nextVariantId }, 'Variant changed');

    // Update stored variant
    __wfLastVariant.set(container, nextVariantId);

    // Show skeleton for forms
    if (isFormContainer(container)) {
      showFormProcessingSkeleton(container);
    }

    // Set reapplying flag
    __wfReapplying.add(container);

    // Debounce reapply
    setTimeout(() => {
      if (!container.isConnected) return;

      const productId = findProductId(container);
      if (productId) {
        applyDiscountsToProduct(container, productId);
      }

      __wfReapplying.delete(container);
    }, VARIANT_REAPPLY_FALLBACK_MS);
  } catch (err) {
    logger.error({ err }, 'Error marking variant switch');
  }
}

// ============================================================================
// Preview Mode
// ============================================================================

/**
 * Get preview mode state (only in Shopify design mode)
 */
function getPreviewMode() {
  if (typeof Shopify === 'undefined' || !Shopify.designMode) {
    return null;
  }

  if (_ns.previewMode) {
    return _ns.previewMode;
  }

  return null;
}

/**
 * Build preview discount based on block settings
 */
function buildPreviewDiscount({ type, value, isAutomatic, code }) {
  return {
    id: 'preview-' + Date.now(),
    title: isAutomatic ? 'Preview Automatic Discount' : 'Preview Coupon Code',
    type: type || 'percentage',
    value: value || 10,
    isAutomatic: isAutomatic === true,
    codes: isAutomatic ? [] : [code || 'PREVIEW10'],
    description: 'This is a preview discount for theme editor.',
    validFrom: new Date().toISOString(),
    validUntil: null,
    isPreview: true
  };
}

// ============================================================================
// Discount Application - Core Logic
// ============================================================================

/**
 * Apply discounts to a product container (main entry point)
 */
function applyDiscountsToProduct(container, productId) {
  if (!container || !productId) {
    logger.debug('Cannot apply discounts: missing container or product ID');
    return;
  }

  try {
    // Debounce for form containers
    if (isFormContainer(container)) {
      const lastRunAt = __wfLastRunAt.get(container) || 0;
      const elapsed = Date.now() - lastRunAt;

      if (elapsed < FORM_PROCESS_DEBOUNCE_MS && !__wfReapplying.has(container)) {
        logger.debug({ elapsed }, 'Debouncing form processing');
        setTimeout(() => {
          if (container.isConnected) {
            applyDiscountsToProduct(container, productId);
          }
        }, FORM_PROCESS_DEBOUNCE_MS - elapsed);
        return;
      }

      __wfLastRunAt.set(container, Date.now());
    }

    // Check preview mode
    const previewMode = getPreviewMode();
    if (previewMode) {
      logger.debug('Preview mode active');
      const previewDiscount = buildPreviewDiscount(previewMode);

      if (isFormContainer(container)) {
        renderFormUI(container, {
          productId,
          discounts: [previewDiscount],
          automaticDiscount: previewDiscount.isAutomatic ? previewDiscount : null,
          couponDiscount: !previewDiscount.isAutomatic ? previewDiscount : null,
          isPreview: true
        });
      } else {
        renderCardBadges(container, [previewDiscount]);
      }
      return;
    }

    // Get product data
    const productData = products[productId];
    if (!productData) {
      logger.debug({ productId }, 'Product data not in cache, queuing');
      queueMissingProductData(container, productId);
      return;
    }

    // Get discounts
    let discounts = productData.discounts || [];
    if (discounts.length === 0) {
      logger.debug({ productId }, 'No discounts for product');
      clearExistingDiscounts(container);
      return;
    }

    // Detect current variant
    const variantInfo = getCurrentVariantInfo(container, VARIANT_INPUT_SELECTOR);
    const variantId = variantInfo?.variantId;

    if (variantId) {
      __wfLastVariant.set(container, variantId);
    }

    // Filter discounts by variant eligibility
    if (variantId) {
      discounts = discounts.filter(discount => {
        // Check if discount applies to this variant
        if (!discount.variants || discount.variants.length === 0) {
          return true; // Applies to all variants
        }
        return discount.variants.includes(variantId);
      });

      if (discounts.length === 0) {
        logger.debug({ productId, variantId }, 'No discounts for variant');
        clearExistingDiscounts(container);
        return;
      }
    }

    // Detect selling plan
    const sellingPlanInfo = getCurrentSellingPlanInfo(container);
    const sellingPlanId = sellingPlanInfo?.sellingPlanId;
    const purchaseContext = resolvePurchaseContext(sellingPlanId);

    // Filter discounts by selling plan eligibility
    discounts = filterDiscountsByPurchaseContext(discounts, purchaseContext);

    if (discounts.length === 0) {
      logger.debug({ productId, purchaseContext }, 'No discounts for purchase context');
      clearExistingDiscounts(container);
      return;
    }

    // Parse price from DOM
    const isForm = isFormContainer(container);
    const priceData = parsePriceFromDOM(container, {
      formPriceDiscountedSelector: isForm ? FORM_PRICE_DISCOUNTED_SELECTOR : '',
      isForm
    });

    if (!priceData || !priceData.price) {
      logger.debug('Could not parse price from DOM');
      clearExistingDiscounts(container);
      return;
    }

    // Normalize price data shape for downstream consumers
    priceData.regularPrice = priceData.price;

    // Compute best discounts
    const useAPI = _ns.selectorOverrides?.useBestDiscountAPI === true;
    let bestDiscounts;

    if (useAPI && isFormContainer(container)) {
      // Use API for form containers
      ensureBestDiscountsFromAPI({
        productId,
        variantId,
        regularPrice: priceData.regularPrice,
        sellingPlanId,
        discounts
      }).then(result => {
        if (!container.isConnected) return;

        const ctx = {
          productId,
          variantId,
          sellingPlanId,
          productData,
          priceData,
          discounts,
          ...result
        };

        renderFormUI(container, ctx);
      }).catch(err => {
        logger.error({ err }, 'Error getting best discounts from API');

        // Fallback to local computation
        const fallbackResult = computeBestDiscountsLocally(discounts, priceData.regularPrice);
        const ctx = {
          productId,
          variantId,
          sellingPlanId,
          productData,
          priceData,
          discounts,
          ...fallbackResult
        };

        if (container.isConnected) {
          renderFormUI(container, ctx);
        }
      });
    } else {
      // Use local computation
      bestDiscounts = computeBestDiscountsLocally(discounts, priceData.regularPrice);

      const ctx = {
        productId,
        variantId,
        sellingPlanId,
        productData,
        priceData,
        discounts,
        ...bestDiscounts
      };

      if (isFormContainer(container)) {
        renderFormUI(container, ctx);
      } else {
        renderCardBadges(container, discounts);
      }
    }
  } catch (err) {
    logger.error({ err, productId }, 'Error applying discounts to product');
  }
}

/**
 * Render form UI (product page)
 */
function renderFormUI(container, ctx) {
  if (!container) return;

  try {
    // Clear skeleton
    clearFormProcessingSkeleton(container);

    // Clear existing discounts
    clearExistingDiscounts(container);

    const {
      productId,
      variantId,
      priceData,
      automaticDiscount,
      couponDiscount,
      automaticFinalPrice,
      couponFinalPrice,
      isPreview = false
    } = ctx;

    // Determine winning discount (for auto-apply logic)
    let winningDiscount = automaticDiscount;
    let winningFinalPrice = automaticFinalPrice;

    // Find and hide original price element
    const priceEl = container.querySelector(FORM_PRICE_CONTAINER_SELECTOR);
    if (priceEl) {
      priceEl.style.display = 'none';
    }

    // Create main container
    const discountContainer = document.createElement('div');
    discountContainer.className = 'ddp-discounts ddp-discounts-container';

    // Mount price container if we have a discount
    if (winningDiscount) {
      const priceContainer = createPriceContainer(
        priceData.regularPrice,
        winningFinalPrice,
        winningDiscount,
        true, // isAutomatic
        priceData.hasCurrencyCode
      );

      if (priceContainer) {
        discountContainer.appendChild(priceContainer);
      }
    }

    // Create coupon block if eligible (BASIC+ tier only)
    if (couponDiscount && autoApplyEnabled) {
      const couponBlock = createCouponBlock(
        couponDiscount,
        (code) => { applyDiscountCode(code); },  // onApply
        (code) => { applyDiscountCode(''); },     // onRemove
        productId,
        variantId,
        false // isAutoApplied
      );

      if (couponBlock) {
        discountContainer.appendChild(couponBlock);
      }
    }

    // Insert container
    if (priceEl && priceEl.parentElement) {
      priceEl.parentElement.insertBefore(discountContainer, priceEl);
    } else {
      const formEl = container.querySelector('form[action*="/cart/add"]');
      if (formEl) {
        formEl.insertBefore(discountContainer, formEl.firstChild);
      } else {
        container.insertBefore(discountContainer, container.firstChild);
      }
    }

    logger.info({ productId, variantId, hasAutomatic: !!automaticDiscount, hasCoupon: !!couponDiscount }, 'Rendered form UI');
  } catch (err) {
    logger.error({ err }, 'Error rendering form UI');

    // Restore original price on error
    const priceEl = container.querySelector(FORM_PRICE_CONTAINER_SELECTOR);
    if (priceEl) {
      priceEl.style.display = '';
    }
  }
}

/**
 * Render card badges (collection/search pages)
 */
function renderCardBadges(container, discounts) {
  if (!container || !discounts || discounts.length === 0) return;

  try {
    // Clear existing badges
    clearExistingDiscounts(container);

    // Find price elements to attach badges
    const priceElements = findPriceElements(container, EMBED_PRICE_CONTAINER_SELECTOR);
    if (priceElements.length === 0) {
      logger.debug('No price elements found for badge attachment');
      return;
    }

    // Check if first price element is hidden
    if (isHiddenWithinBoundary(priceElements[0].container, container)) {
      logger.debug('Price element is hidden, skipping badge');
      return;
    }

    const productId = findProductId(container);

    // Parse price from first visible price element for automatic discount calculations
    const priceText = priceElements[0].container.textContent;
    const regularPrice = parsePrice(priceText);
    const priceHasCurrency = hasCurrencyCode(priceText);

    // Separate automatic and coupon discounts
    const automaticDiscounts = discounts.filter(d => d.isAutomatic);
    const couponDiscounts = discounts.filter(d => !d.isAutomatic);

    // Render automatic badge (highest value)
    if (automaticDiscounts.length > 0) {
      const topAutomatic = automaticDiscounts.sort((a, b) => b.value - a.value)[0];
      const finalPrice = regularPrice ? calculateDiscountedPrice(regularPrice, topAutomatic) : null;
      createAutomaticDiscountDisplay(container, priceElements, {
        productId,
        regularPrice,
        finalPrice,
        discount: topAutomatic,
        hasCurrencyCode: priceHasCurrency,
        singlePrice: false
      });
    }

    // Render coupon badge (highest value)
    if (couponDiscounts.length > 0) {
      const topCoupon = couponDiscounts.sort((a, b) => b.value - a.value)[0];
      createCouponBadge(container, priceElements, {
        productId,
        discount: topCoupon,
        hasCurrencyCode: priceHasCurrency
      });
    }

    logger.debug({ automaticCount: automaticDiscounts.length, couponCount: couponDiscounts.length }, 'Rendered card badges');
  } catch (err) {
    logger.error({ err }, 'Error rendering card badges');
  }
}

/**
 * Clear existing discount UI from container
 */
function clearExistingDiscounts(container) {
  if (!container) return;

  try {
    // Remove discount containers
    container.querySelectorAll('.ddp-discounts, .ddp-discounts-container').forEach(el => el.remove());

    // Remove badges
    container.querySelectorAll('.ddp-discount-badge, .ddp-coupon-badge').forEach(el => el.remove());

    // Remove skeletons
    container.querySelectorAll('.ddp-skeleton-loader').forEach(el => el.remove());

    // Restore hidden price elements
    const priceEl = container.querySelector(FORM_PRICE_CONTAINER_SELECTOR);
    if (priceEl && priceEl.style.display === 'none') {
      priceEl.style.display = '';
    }
  } catch (err) {
    logger.error({ err }, 'Error clearing existing discounts');
  }
}

// ============================================================================
// Variant Change Detection
// ============================================================================

/**
 * Attach variant change listeners to a container
 */
function attachVariantListeners(container) {
  if (!container) return;

  try {
    setupVariantDetection(
      container,
      VARIANT_INPUT_SELECTOR,
      (variantId) => {
        if (!variantId) return;
        logger.debug({ variantId }, 'Variant change detected');
        markVariantSwitch(container, variantId);
      },
      (sellingPlanId) => {
        // Re-process on selling plan change
        const productId = findProductId(container);
        if (productId) {
          applyDiscountsToProduct(container, productId);
        }
      }
    );

    logger.debug('Attached variant listeners');
  } catch (err) {
    logger.error({ err }, 'Error attaching variant listeners');
  }
}

// ============================================================================
// DOM Observer
// ============================================================================

/**
 * Setup MutationObserver to watch for new containers
 */
function setupDOMObserver() {
  try {
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type !== 'childList') continue;

        for (const node of mutation.addedNodes) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue;

          // Check if node itself is a container
          const isProductContainer = node.matches && node.matches(PRODUCT_CONTAINER_SELECTOR);
          const isFormContainerMatch = node.matches && node.matches(FORM_CONTAINER_SELECTOR);

          if (isProductContainer || isFormContainerMatch) {
            logger.debug('New container detected via mutation');
            const productId = findProductId(node);
            if (productId) {
              applyDiscountsToProduct(node, productId);
              attachVariantListeners(node);
            }
          }

          // Check descendants
          if (node.querySelectorAll) {
            const productContainers = node.querySelectorAll(PRODUCT_CONTAINER_SELECTOR);
            const formContainers = node.querySelectorAll(FORM_CONTAINER_SELECTOR);

            for (const container of [...productContainers, ...formContainers]) {
              logger.debug('New container detected in subtree');
              const productId = findProductId(container);
              if (productId) {
                applyDiscountsToProduct(container, productId);
                attachVariantListeners(container);
              }
            }
          }
        }
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    logger.info('DOM observer initialized');
  } catch (err) {
    logger.error({ err }, 'Error setting up DOM observer');
  }
}

// ============================================================================
// Heartbeat
// ============================================================================

/**
 * Setup heartbeat div for monitoring
 */
function setupHeartbeat() {
  try {
    let heartbeatDiv = document.getElementById('discount-heartbeat');

    if (!heartbeatDiv) {
      heartbeatDiv = document.createElement('div');
      heartbeatDiv.id = 'discount-heartbeat';
      heartbeatDiv.style.display = 'none';
      document.body.appendChild(heartbeatDiv);
    }

    function updateHeartbeat() {
      heartbeatDiv.setAttribute('data-timestamp', Date.now().toString());
    }

    // Update immediately and then every 30s
    updateHeartbeat();
    setInterval(updateHeartbeat, 30000);

    logger.info('Heartbeat initialized');
  } catch (err) {
    logger.error({ err }, 'Error setting up heartbeat');
  }
}

// ============================================================================
// Initialization
// ============================================================================

/**
 * Wait for Shopify.theme.name to be available
 */
async function waitForShopifyTheme(maxWaitMs = 3000) {
  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitMs) {
    if (typeof Shopify !== 'undefined' && Shopify.theme && Shopify.theme.name) {
      logger.info({ themeName: Shopify.theme.name }, 'Shopify theme detected');
      return true;
    }

    await new Promise(resolve => setTimeout(resolve, 100));
  }

  logger.warn('Shopify theme not detected within timeout');
  return false;
}

/**
 * Main initialization function
 */
async function initialize() {
  if (initializationAttempted) {
    logger.warn('Initialization already attempted');
    return;
  }

  initializationAttempted = true;
  logger.info('Starting Discount Display Pro initialization');

  try {
    // Step 1: Wait for Shopify theme
    await waitForShopifyTheme();

    // Step 2: Wait for DOM
    if (document.readyState === 'loading') {
      await new Promise(resolve => {
        document.addEventListener('DOMContentLoaded', resolve);
      });
    }

    // Step 3: Ensure theme selectors ready
    await ensureThemeSelectorsReady(4000);

    // Step 4: Subscribe to theme selector updates
    subscribeToThemeSelectorUpdates(() => {
      logger.info('Theme selectors updated, reinitializing selectors');
      initializeSelectors();

      // Reapply to all containers
      const containers = [
        ...findProductContainers(),
        ...findFormContainers()
      ];

      for (const container of containers) {
        const productId = findProductId(container);
        if (productId) {
          applyDiscountsToProduct(container, productId);
        }
      }
    });

    // Step 5: Initialize selectors
    initializeSelectors();

    // Step 6: Initialize coupon state
    initCouponState();

    // Step 7: Load all products from database
    await loadAllProductsFromDatabase();

    // Step 8: Find all containers
    const productContainers = findProductContainers();
    const formContainers = findFormContainers();
    const allContainers = [...productContainers, ...formContainers];

    logger.info({ totalContainers: allContainers.length }, 'Found containers');

    // Step 9: Apply discounts to each container
    for (const container of allContainers) {
      const productId = findProductId(container);
      if (productId) {
        applyDiscountsToProduct(container, productId);
        attachVariantListeners(container);
      }
    }

    // Step 10: Setup MutationObserver
    setupDOMObserver();

    // Step 11: Setup heartbeat
    setupHeartbeat();

    // Mark complete
    initializationComplete = true;
    logger.info('Discount Display Pro initialization complete');
  } catch (err) {
    logger.error({ err }, 'Error during initialization');
  }
}

// ============================================================================
// Global API Exposure
// ============================================================================

/**
 * Format date helper (for terms modal, etc.)
 */
function formatDate(dateString) {
  if (!dateString) return '';

  try {
    const date = new Date(dateString);
    return date.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  } catch (err) {
    return dateString;
  }
}

/**
 * Build discount URL with return_to parameter
 */
function buildDiscountUrlWithReturnTo(code) {
  const currentUrl = window.location.href;
  const returnToUrl = encodeURIComponent(currentUrl);
  return `/discount/${encodeURIComponent(code)}?return_to=${returnToUrl}`;
}

// Expose APIs on window
_ns.ui = {
  createPriceContainer,
  createCouponBlock,
  showTermsModal
};

_ns.cards = {
  createAutomaticDiscountDisplay,
  createCouponBadge
};

_ns.forms = {
  renderPPFormUI: renderFormUI,
  applyDiscountCode,
  buildDiscountUrlWithReturnTo
};

_ns.utils = {
  formatPrice,
  formatDate,
  parsePrice,
  calculateDiscountedPrice,
  clearExistingDiscounts,
  requestBestDiscounts
};

// Logger already exposed in logger.js but reinforce here
_ns.logger = logger;

// Expose initialization state for debugging
_ns.state = {
  get initializationComplete() { return initializationComplete; },
  get products() { return products; },
  get selectors() { return SELECTOR_RESOLUTION; }
};

// ============================================================================
// Entry Point
// ============================================================================

// Auto-initialize
if (typeof window !== 'undefined') {
  // Start initialization immediately if DOM is ready, otherwise wait
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize);
  } else {
    initialize();
  }
}

export default {
  initialize,
  applyDiscountsToProduct,
  clearExistingDiscounts,
  findProductContainers,
  findFormContainers,
  mergeDiscountData
};
