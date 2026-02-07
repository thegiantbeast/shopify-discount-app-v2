import { createLogger } from "./logger.server.js";

const logger = createLogger("ThemeSelectors");

// Theme selector mapping from v1 (exact values)
const THEME_SELECTOR_MAP = {
  dawn: {
    cardContainer: '.card-wrapper',
    cardPrice: '.price__container',
    formContainer: '.product__info-wrapper',
    formPrice: '.price__container',
    formPrice_discounted: '.price-item--sale',
  },
  symmetry: {
    cardContainer: 'product-block',
    cardPrice: '.product-price--block',
    formContainer: '.product-form',
    formPrice: '.price-container',
    formPrice_discounted: '',
  },
  vision: {
    cardContainer: 'product-card',
    cardPrice: '.price',
    formContainer: '.product-information',
    formPrice: '.product-price-container',
    formPrice_discounted: '.amount.discounted',
  },
  wonder: {
    cardContainer: '.card__container, .shoppable-product-card, .wt-products-slider__product, .wt-product__info',
    cardPrice: '.price__container',
    formContainer: '.wt-product__info',
    formPrice: '.price__container',
    formPrice_discounted: '',
  },
  spotlight: {
    cardContainer: '.card__information',
    cardPrice: '.price__container',
    formContainer: '.product__info-wrapper',
    formPrice: '.price__container',
    formPrice_discounted: '',
  },
  horizon: {
    cardContainer: 'product-card',
    cardPrice: 'product-price',
    formContainer: '.product-details',
    formPrice: '[ref="priceContainer"]',
    formPrice_discounted: '',
  },
  savor: {
    cardContainer: 'product-card',
    cardPrice: 'product-price',
    formContainer: '.product-details',
    formPrice: '[ref="priceContainer"]',
    formPrice_discounted: '.price',
  },
};

const DEFAULT_THEME = 'dawn';

const THEME_STORE_ID_MAP = {
  887: 'dawn',
  568: 'symmetry',
  2053: 'vision',
  2684: 'wonder',
  1891: 'spotlight',
  2481: 'horizon',
  // Savor has no Theme Store ID
};

// Cache configuration
const CACHE_MAX_SIZE = parseInt(process.env.THEME_SELECTOR_CACHE_SIZE, 10) || 200;
const CACHE_TTL_MS = parseInt(process.env.THEME_SELECTOR_CACHE_TTL_MS, 10) || (30 * 24 * 60 * 60 * 1000); // 30 days

// Cache structure: Map<themeId, { payload, expiresAt, lastAccess }>
const selectorCache = new Map();

/**
 * Normalizes theme store ID to a number.
 * Rejects NaN, placeholder "000", zero.
 * @param {string|number} value
 * @returns {number|null}
 */
export function normalizeThemeStoreId(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const str = String(value).trim();
  if (str === '000') {
    return null;
  }

  const num = Number(str);
  if (isNaN(num) || num === 0) {
    return null;
  }

  return num;
}

/**
 * Normalizes theme name by lowercasing, trimming, and stripping common metadata suffixes.
 * @param {string} themeName
 * @returns {string|null}
 */
export function normalizeThemeName(themeName) {
  if (!themeName || typeof themeName !== 'string') {
    return null;
  }

  let normalized = themeName.toLowerCase().trim();

  // Strip version numbers like " v7.2" or " v12"
  normalized = normalized.replace(/\s+v\d+(\.\d+)?/g, '');

  // Strip common metadata patterns
  normalized = normalized.replace(/\s+-\s+copy/g, '');
  normalized = normalized.replace(/\s+\(preview\)/g, '');
  normalized = normalized.replace(/\s+\[dev\]/g, '');

  // Strip common keywords from end
  const keywordsToRemove = [
    'preview', 'live', 'published', 'development',
    'staging', 'test', 'draft', 'copy', 'duplicate', 'backup'
  ];

  for (const keyword of keywordsToRemove) {
    const regex = new RegExp(`\\s+${keyword}$`, 'g');
    normalized = normalized.replace(regex, '');
  }

  normalized = normalized.trim();

  return normalized || null;
}

/**
 * Normalizes schema name by lowercasing and trimming.
 * @param {string} schemaName
 * @returns {string|null}
 */
export function normalizeSchemaName(schemaName) {
  if (!schemaName || typeof schemaName !== 'string') {
    return null;
  }

  const normalized = schemaName.toLowerCase().trim();
  return normalized || null;
}

/**
 * Gets theme key from Theme Store ID.
 * @param {number|null} themeStoreId
 * @returns {string|null}
 */
export function getThemeKeyFromStoreId(themeStoreId) {
  if (themeStoreId === null) {
    return null;
  }

  return THEME_STORE_ID_MAP[themeStoreId] || null;
}

/**
 * Gets theme selectors by theme name.
 * @param {string|null} themeName
 * @returns {object|null}
 */
export function getThemeSelectors(themeName) {
  if (!themeName) {
    return null;
  }

  return THEME_SELECTOR_MAP[themeName] || null;
}

/**
 * Gets fallback selectors (Dawn).
 * @returns {object}
 */
export function getFallbackSelectors() {
  return THEME_SELECTOR_MAP[DEFAULT_THEME];
}

/**
 * Gets cached theme selectors by theme ID.
 * @param {string} themeId
 * @returns {object|null}
 */
export function getCachedThemeSelectors(themeId) {
  if (!themeId) {
    return null;
  }

  const entry = selectorCache.get(themeId);

  if (!entry) {
    return null;
  }

  // Check expiration
  if (Date.now() > entry.expiresAt) {
    selectorCache.delete(themeId);
    logger.debug("Cache entry expired, deleted", { themeId });
    return null;
  }

  // Update last access time for LRU
  entry.lastAccess = Date.now();

  logger.debug("Cache hit", { themeId });
  return entry.payload;
}

/**
 * Caches theme selectors (only non-fallback results).
 * @param {string} themeId
 * @param {object} payload
 */
export function cacheThemeSelectors(themeId, payload) {
  if (!themeId || !payload) {
    return;
  }

  // Only cache non-fallback results
  if (payload.usedFallback === true) {
    logger.debug("Skipping cache for fallback result", { themeId });
    return;
  }

  const now = Date.now();
  const entry = {
    payload,
    expiresAt: now + CACHE_TTL_MS,
    lastAccess: now,
  };

  selectorCache.set(themeId, entry);
  logger.debug("Cached theme selectors", { themeId, cacheSize: selectorCache.size });

  // Prune cache after writing
  pruneCache();
}

/**
 * Prunes expired and LRU entries from cache.
 */
export function pruneCache() {
  const now = Date.now();

  // Delete expired entries
  for (const [themeId, entry] of selectorCache.entries()) {
    if (now > entry.expiresAt) {
      selectorCache.delete(themeId);
      logger.debug("Pruned expired cache entry", { themeId });
    }
  }

  // If still over max size, delete oldest lastAccess (LRU)
  if (selectorCache.size > CACHE_MAX_SIZE) {
    const entries = Array.from(selectorCache.entries());
    entries.sort((a, b) => a[1].lastAccess - b[1].lastAccess);

    const toDelete = entries.slice(0, selectorCache.size - CACHE_MAX_SIZE);
    for (const [themeId] of toDelete) {
      selectorCache.delete(themeId);
      logger.debug("Pruned LRU cache entry", { themeId });
    }
  }
}

/**
 * Builds selector response with resolution priority logic.
 * Resolution priority:
 * 1. Theme Store ID
 * 2. Schema name
 * 3. Theme name
 * 4. Fallback to Dawn
 *
 * @param {string} themeName
 * @param {string} schemaName
 * @param {string|number} themeStoreId
 * @returns {object}
 */
export function buildSelectorResponse(themeName, schemaName, themeStoreId) {
  const normalizedThemeName = normalizeThemeName(themeName);
  const normalizedSchemaName = normalizeSchemaName(schemaName);
  const normalizedStoreId = normalizeThemeStoreId(themeStoreId);

  let resolvedTheme = null;
  let selectors = null;
  let usedFallback = false;
  let matchedViaStoreId = false;
  let matchedViaSchema = false;

  // Priority 1: Theme Store ID
  if (normalizedStoreId !== null) {
    const themeKey = getThemeKeyFromStoreId(normalizedStoreId);
    if (themeKey) {
      selectors = getThemeSelectors(themeKey);
      if (selectors) {
        resolvedTheme = themeKey;
        matchedViaStoreId = true;
        logger.debug("Resolved via Theme Store ID", { themeStoreId: normalizedStoreId, resolvedTheme });
      }
    }
  }

  // Priority 2: Schema name
  if (!selectors && normalizedSchemaName) {
    selectors = getThemeSelectors(normalizedSchemaName);
    if (selectors) {
      resolvedTheme = normalizedSchemaName;
      matchedViaSchema = true;
      logger.debug("Resolved via schema name", { schemaName: normalizedSchemaName, resolvedTheme });
    }
  }

  // Priority 3: Theme name
  if (!selectors && normalizedThemeName) {
    selectors = getThemeSelectors(normalizedThemeName);
    if (selectors) {
      resolvedTheme = normalizedThemeName;
      logger.debug("Resolved via theme name", { themeName: normalizedThemeName, resolvedTheme });
    }
  }

  // Priority 4: Fallback to Dawn
  if (!selectors) {
    selectors = getFallbackSelectors();
    resolvedTheme = DEFAULT_THEME;
    usedFallback = true;
    logger.debug("Used fallback theme", { resolvedTheme });
  }

  return {
    theme: normalizedThemeName,
    schemaName: normalizedSchemaName,
    themeStoreId: normalizedStoreId,
    resolvedTheme,
    usedFallback,
    selectors,
    fallbackTheme: DEFAULT_THEME,
    fallbackSelectors: getFallbackSelectors(),
    matchedViaStoreId,
    matchedViaSchema,
  };
}
