import { logger } from './logger.js';
import _ns from './namespace.js';

/**
 * Resolve shop domain from various sources
 * @returns {string|null} Shop domain or null
 */
export function resolveShopDomain() {
  // 1. Check cached value
  if (_ns._shopDomain) {
    return _ns._shopDomain;
  }

  // 2. Check Shopify.shop global
  if (window.Shopify?.shop) {
    _ns._shopDomain = window.Shopify.shop;
    return _ns._shopDomain;
  }

  // 3. Parse from hostname (*.myshopify.com)
  try {
    const hostname = window.location.hostname;
    if (hostname.endsWith('.myshopify.com')) {
      _ns._shopDomain = hostname;
      return _ns._shopDomain;
    }

    // Custom domain - try to extract from Shopify Checkout or other sources
    // For now, return null if we can't determine
    logger.warn({ hostname }, 'Could not resolve shop domain from hostname');
    return null;
  } catch (error) {
    logger.error({ err: error }, 'Error resolving shop domain');
    return null;
  }
}

/**
 * Sanitize base URL (remove trailing slash)
 * @param {string} url - Base URL
 * @returns {string} Sanitized URL
 */
function sanitizeBaseUrl(url) {
  if (!url || typeof url !== 'string') {
    logger.error({ url }, 'Invalid base URL');
    return '';
  }
  return url.replace(/\/$/, '');
}

/**
 * Build discounts API URL
 * @param {object} params - Query parameters
 * @returns {string|null} Complete endpoint URL or null
 */
function buildDiscountsUrl(params) {
  const base = sanitizeBaseUrl(_ns.apiBaseUrl || '');
  if (!base) {
    logger.error({}, 'DISCOUNT_API_BASE_URL not configured');
    return null;
  }

  const path = `${base}/api/discounts`;
  const queryParams = new URLSearchParams();

  // Add all provided params
  Object.keys(params).forEach((key) => {
    const value = params[key];
    if (value !== undefined && value !== null && value !== '') {
      if (Array.isArray(value)) {
        // Join arrays with comma
        queryParams.append(key, value.join(','));
      } else {
        queryParams.append(key, String(value));
      }
    }
  });

  return `${path}?${queryParams.toString()}`;
}

/**
 * Build best discounts API URL
 * @returns {string|null} Complete endpoint URL or null
 */
function buildBestDiscountsUrl() {
  const base = sanitizeBaseUrl(_ns.apiBaseUrl || '');
  if (!base) {
    logger.error({}, 'DISCOUNT_API_BASE_URL not configured');
    return null;
  }

  return `${base}/api/best-discounts`;
}

/**
 * Extract IDs from page context
 * @param {object} pageContext - Page context object
 * @returns {object} Extracted IDs
 */
function extractIdsFromContext(pageContext) {
  const productIds = [];
  const variantIds = [];
  const handles = [];

  if (!pageContext) {
    return { productIds, variantIds, handles };
  }

  // Extract from various context sources
  if (pageContext.productId) {
    productIds.push(pageContext.productId);
  }

  if (pageContext.variantId) {
    variantIds.push(pageContext.variantId);
  }

  if (pageContext.handle) {
    handles.push(pageContext.handle);
  }

  if (pageContext.productIds && Array.isArray(pageContext.productIds)) {
    productIds.push(...pageContext.productIds);
  }

  if (pageContext.variantIds && Array.isArray(pageContext.variantIds)) {
    variantIds.push(...pageContext.variantIds);
  }

  if (pageContext.handles && Array.isArray(pageContext.handles)) {
    handles.push(...pageContext.handles);
  }

  // Deduplicate
  return {
    productIds: [...new Set(productIds)],
    variantIds: [...new Set(variantIds)],
    handles: [...new Set(handles)],
  };
}

/**
 * Load discount data from backend
 * @param {object} pageContext - Page context with product/variant IDs
 * @returns {Promise<object|null>} Discount data or null
 */
export async function loadDiscountData(pageContext) {
  try {
    // Check if already fetching (deduplicate requests)
    if (_ns._fetchPromise) {
      logger.info({}, 'Reusing existing discounts fetch promise');
      return await _ns._fetchPromise;
    }

    // Check if already cached
    if (_ns._fetchCache) {
      logger.info({}, 'Returning cached discount data');
      return _ns._fetchCache;
    }

    // Resolve shop domain
    const shop = resolveShopDomain();
    if (!shop) {
      logger.error({}, 'Cannot load discounts: shop domain not resolved');
      return null;
    }

    // Get storefront token
    const token = _ns.storefrontToken;
    if (!token) {
      logger.error({}, 'Cannot load discounts: DISCOUNT_STOREFRONT_TOKEN not configured');
      return null;
    }

    // Extract IDs from context
    const { productIds, variantIds, handles } = extractIdsFromContext(pageContext);

    // Build URL
    const url = buildDiscountsUrl({
      shop,
      productIds: productIds.length > 0 ? productIds : undefined,
      variantIds: variantIds.length > 0 ? variantIds : undefined,
      handles: handles.length > 0 ? handles : undefined,
    });

    if (!url) {
      return null;
    }

    logger.info({
      shop,
      productCount: productIds.length,
      variantCount: variantIds.length,
      handleCount: handles.length,
    }, 'Fetching discount data');

    // Create fetch promise
    const fetchPromise = (async () => {
      try {
        const response = await fetch(url, {
          method: 'GET',
          credentials: 'omit',
          headers: {
            'Accept': 'application/json',
            'Authorization': `Bearer ${token}`,
          },
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();

        logger.info({
          discountCount: data.discounts?.length || 0,
          productCount: data.products?.length || 0,
        }, 'Discount data loaded');

        // Cache the data
        _ns._fetchCache = data;

        return data;
      } catch (error) {
        logger.error({ err: error }, 'Failed to load discount data');
        return null;
      } finally {
        // Clear the promise so it can be retried
        _ns._fetchPromise = null;
      }
    })();

    // Store promise to deduplicate concurrent requests
    _ns._fetchPromise = fetchPromise;

    return await fetchPromise;
  } catch (error) {
    logger.error({ err: error }, 'Error in loadDiscountData');
    return null;
  }
}

/**
 * Fetch additional discount data for missing products
 * @param {object} options - Options object
 * @param {Array<string>} options.productIds - Product IDs
 * @param {Array<string>} options.handles - Product handles
 * @param {Array<string>} options.variantIds - Variant IDs
 * @returns {Promise<object>} Result object
 */
export async function fetchAdditionalDiscountData({ productIds = [], handles = [], variantIds = [] }) {
  try {
    // Resolve shop domain
    const shop = resolveShopDomain();
    if (!shop) {
      logger.error({}, 'Cannot fetch additional discounts: shop domain not resolved');
      return { success: false, hasData: false };
    }

    // Get storefront token
    const token = _ns.storefrontToken;
    if (!token) {
      logger.error({}, 'Cannot fetch additional discounts: DISCOUNT_STOREFRONT_TOKEN not configured');
      return { success: false, hasData: false };
    }

    // Check if we have any IDs to fetch
    if (productIds.length === 0 && handles.length === 0 && variantIds.length === 0) {
      logger.warn({}, 'No IDs provided for additional discount fetch');
      return { success: true, hasData: false };
    }

    // Build URL
    const url = buildDiscountsUrl({
      shop,
      productIds: productIds.length > 0 ? productIds : undefined,
      variantIds: variantIds.length > 0 ? variantIds : undefined,
      handles: handles.length > 0 ? handles : undefined,
    });

    if (!url) {
      return { success: false, hasData: false };
    }

    logger.info({
      shop,
      productCount: productIds.length,
      variantCount: variantIds.length,
      handleCount: handles.length,
    }, 'Fetching additional discount data');

    const response = await fetch(url, {
      method: 'GET',
      credentials: 'omit',
      headers: {
        'Accept': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();

    logger.info({
      discountCount: data.discounts?.length || 0,
      productCount: data.products?.length || 0,
    }, 'Additional discount data loaded');

    // Merge with existing cached data
    if (_ns._fetchCache) {
      const existing = _ns._fetchCache;

      // Merge discounts (avoid duplicates by ID)
      const existingDiscountIds = new Set(
        (existing.discounts || []).map((d) => d.id)
      );
      const newDiscounts = (data.discounts || []).filter(
        (d) => !existingDiscountIds.has(d.id)
      );

      // Merge products (avoid duplicates by ID)
      const existingProductIds = new Set(
        (existing.products || []).map((p) => p.id)
      );
      const newProducts = (data.products || []).filter(
        (p) => !existingProductIds.has(p.id)
      );

      _ns._fetchCache = {
        ...existing,
        discounts: [...(existing.discounts || []), ...newDiscounts],
        products: [...(existing.products || []), ...newProducts],
      };

      logger.info({
        newDiscounts: newDiscounts.length,
        newProducts: newProducts.length,
      }, 'Merged additional discount data with cache');
    } else {
      // No existing data, cache new data
      _ns._fetchCache = data;
    }

    return {
      success: true,
      hasData: (data.discounts?.length || 0) > 0 || (data.products?.length || 0) > 0,
      data,
    };
  } catch (error) {
    logger.error({ err: error }, 'Failed to fetch additional discount data');
    return { success: false, hasData: false, data: null };
  }
}

/**
 * Request best discounts calculation from backend
 * @param {object} options - Options object
 * @param {string} options.shop - Shop domain
 * @param {Array<object>} options.entries - Discount entries
 * @returns {Promise<object>} Result object with results and errors arrays
 */
export async function requestBestDiscounts({ shop, entries }) {
  try {
    // Validate inputs
    if (!shop) {
      shop = resolveShopDomain();
      if (!shop) {
        logger.error({}, 'Cannot request best discounts: shop domain not resolved');
        return { results: [], errors: ['Shop domain not resolved'] };
      }
    }

    if (!Array.isArray(entries) || entries.length === 0) {
      logger.warn({}, 'No entries provided for best discounts request');
      return { results: [], errors: [] };
    }

    // Get storefront token
    const token = _ns.storefrontToken;
    if (!token) {
      logger.error({}, 'Cannot request best discounts: DISCOUNT_STOREFRONT_TOKEN not configured');
      return { results: [], errors: ['Storefront token not configured'] };
    }

    // Build URL
    const url = buildBestDiscountsUrl();
    if (!url) {
      return { results: [], errors: ['Could not build API URL'] };
    }

    logger.info({
      shop,
      entryCount: entries.length,
    }, 'Requesting best discounts');

    const response = await fetch(url, {
      method: 'POST',
      credentials: 'omit',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        shop,
        requests: entries,
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();

    logger.info({
      resultCount: data.results?.length || 0,
      errorCount: data.errors?.length || 0,
    }, 'Best discounts response received');

    return {
      results: data.results || [],
      errors: data.errors || [],
    };
  } catch (error) {
    logger.error({ err: error }, 'Failed to request best discounts');
    return {
      results: [],
      errors: [error.message || 'Unknown error'],
    };
  }
}
