import { logger } from './logger.js';
import _ns from './namespace.js';

const DEFAULT_THEME = 'dawn';

/**
 * Normalize theme name to match server-side logic
 * @param {string} themeName - Raw theme name from Shopify.theme.name
 * @returns {string} Normalized theme name
 */
export function normalizeThemeName(themeName) {
  if (!themeName || typeof themeName !== 'string') {
    return DEFAULT_THEME;
  }

  let normalized = themeName.toLowerCase().trim();

  // Strip " - " suffix and everything after
  const dashIndex = normalized.indexOf(' - ');
  if (dashIndex !== -1) {
    normalized = normalized.substring(0, dashIndex);
  }

  // Strip "(" suffix and everything after
  const parenIndex = normalized.indexOf('(');
  if (parenIndex !== -1) {
    normalized = normalized.substring(0, parenIndex);
  }

  // Strip "[" suffix and everything after
  const bracketIndex = normalized.indexOf('[');
  if (bracketIndex !== -1) {
    normalized = normalized.substring(0, bracketIndex);
  }

  normalized = normalized.trim();

  // Remove trailing keywords
  const trailingKeywords = [
    'preview', 'live', 'published', 'unpublished',
    'development', 'dev', 'draft', 'staging', 'test',
    'copy', 'duplicate', 'backup'
  ];

  for (const keyword of trailingKeywords) {
    const pattern = new RegExp(`\\s+${keyword}$`, 'i');
    normalized = normalized.replace(pattern, '');
  }

  // Remove "copy" followed by optional digits
  normalized = normalized.replace(/\s+copy\s*\d*$/i, '');

  // Remove version numbers: v1, v2.0, 1.2.3
  normalized = normalized.replace(/\s+v?\d+(\.\d+)*$/i, '');

  normalized = normalized.trim();

  return normalized || DEFAULT_THEME;
}

/**
 * Extract normalized theme ID (last numeric sequence)
 * @param {string|number} themeId - Raw theme ID
 * @returns {string|null} Normalized theme ID or null
 */
export function normalizeThemeId(themeId) {
  if (!themeId) return null;

  const str = String(themeId);
  const matches = str.match(/\d+/g);

  if (!matches || matches.length === 0) {
    return null;
  }

  return matches[matches.length - 1];
}

/**
 * Normalize schema name
 * @param {string} schemaName - Raw schema name
 * @returns {string|null} Normalized schema name or null
 */
export function normalizeSchemaName(schemaName) {
  if (!schemaName || typeof schemaName !== 'string') {
    return null;
  }

  const normalized = schemaName.toLowerCase().trim();
  return normalized || null;
}

/**
 * Normalize theme store ID
 * @param {string|number} storeId - Raw store ID
 * @returns {string|null} Normalized store ID or null
 */
export function normalizeThemeStoreId(storeId) {
  if (!storeId) return null;

  const num = Number(storeId);
  if (isNaN(num)) return null;

  return String(Math.trunc(num));
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
 * Build theme selectors endpoint URL
 * @param {string} themeName - Normalized theme name
 * @param {string|null} themeId - Normalized theme ID
 * @param {string|null} schemaName - Normalized schema name
 * @param {string|null} storeId - Normalized store ID
 * @returns {string} Complete endpoint URL
 */
function buildThemeSelectorsUrl(themeName, themeId, schemaName, storeId) {
  const base = sanitizeBaseUrl(_ns.apiBaseUrl || '');
  if (!base) {
    logger.error({}, 'DISCOUNT_API_BASE_URL not configured');
    return null;
  }

  const path = `${base}/api/theme-selectors`;
  const params = new URLSearchParams();

  if (themeName) params.append('theme', themeName);
  if (themeId) params.append('themeId', themeId);
  if (schemaName) params.append('schemaName', schemaName);
  if (storeId) params.append('themeStoreId', storeId);

  return `${path}?${params.toString()}`;
}

/**
 * Global state for theme selectors
 */
if (!_ns._themeState) {
  _ns._themeState = {
    selectors: null,
    fallbackSelectors: null,
    resolvedTheme: null,
    usedFallback: false,
    isReady: false,
    listeners: [],
    cache: new Map(),
  };
}

/**
 * Apply payload from theme selectors API
 * @param {object} data - Response data
 */
function applyPayload(data) {
  if (!data) return;

  const state = _ns._themeState;

  // Initialize THEME_SELECTORS if needed
  if (!_ns.themeSelectors) {
    _ns.themeSelectors = {};
  }

  // Store selectors by theme name
  if (data.theme && data.selectors) {
    _ns.themeSelectors[data.theme] = data.selectors;
    state.resolvedTheme = data.theme;
    state.selectors = data.selectors;
  }

  // Store fallback selectors
  if (data.fallbackSelectors) {
    state.fallbackSelectors = data.fallbackSelectors;
  }

  state.usedFallback = data.usedFallback || false;
  state.isReady = true;

  logger.info({
    theme: data.theme,
    usedFallback: state.usedFallback,
    selectorCount: Object.keys(data.selectors || {}).length
  }, 'Theme selectors applied');
}

/**
 * Handle fetch error
 * @param {Error} error - Error object
 * @returns {object} Error result
 */
function handleFetchError(error) {
  logger.error({ err: error }, 'Failed to fetch theme selectors');

  return {
    usedFallback: true,
    selectors: null,
  };
}

/**
 * Notify all registered listeners
 */
function notifyListeners() {
  const state = _ns._themeState;
  const listeners = [...state.listeners];

  listeners.forEach((callback) => {
    try {
      callback({
        isReady: state.isReady,
        resolvedTheme: state.resolvedTheme,
        usedFallback: state.usedFallback,
      });
    } catch (err) {
      logger.error({ err }, 'Error in theme selector listener');
    }
  });
}

/**
 * Fetch theme selectors from backend
 * @param {string} themeName - Raw theme name
 * @param {string|number} themeId - Raw theme ID
 * @param {string} schemaName - Raw schema name
 * @param {string|number} storeId - Raw store ID
 * @returns {Promise<object>} Theme selectors data
 */
export async function fetchThemeSelectors(themeName, themeId, schemaName, storeId) {
  const state = _ns._themeState;

  // Normalize parameters
  const normalizedTheme = normalizeThemeName(themeName);
  const normalizedId = normalizeThemeId(themeId);
  const normalizedSchema = normalizeSchemaName(schemaName);
  const normalizedStoreId = normalizeThemeStoreId(storeId);

  // Create cache key
  const cacheKey = normalizedId || normalizedTheme;

  // Check cache
  if (state.cache.has(cacheKey)) {
    logger.info({ cacheKey }, 'Returning cached theme selectors promise');
    return state.cache.get(cacheKey);
  }

  // Create fetch promise
  const fetchPromise = (async () => {
    try {
      const url = buildThemeSelectorsUrl(
        normalizedTheme,
        normalizedId,
        normalizedSchema,
        normalizedStoreId
      );

      if (!url) {
        const result = handleFetchError(new Error('Could not build theme selectors URL'));
        notifyListeners();
        return result;
      }

      logger.info({
        theme: normalizedTheme,
        themeId: normalizedId,
        schemaName: normalizedSchema,
        storeId: normalizedStoreId,
      }, 'Fetching theme selectors');

      const response = await fetch(url, {
        method: 'GET',
        credentials: 'omit',
        headers: {
          'Accept': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();

      // Apply payload
      applyPayload(data);

      // Notify listeners
      notifyListeners();

      return data;
    } catch (error) {
      const result = handleFetchError(error);
      notifyListeners();
      return result;
    }
  })();

  // Store in cache
  state.cache.set(cacheKey, fetchPromise);

  return fetchPromise;
}

/**
 * Register listener for theme selectors resolution
 * @param {Function} callback - Callback function
 */
export function onThemeSelectorsResolved(callback) {
  if (typeof callback !== 'function') {
    logger.error({}, 'onThemeSelectorsResolved: callback must be a function');
    return;
  }

  const state = _ns._themeState;

  // If already resolved, call immediately
  if (state.isReady) {
    try {
      callback({
        isReady: true,
        resolvedTheme: state.resolvedTheme,
        usedFallback: state.usedFallback,
      });
    } catch (err) {
      logger.error({ err }, 'Error in immediate theme selector callback');
    }
  }

  // Add to listeners for future updates
  state.listeners.push(callback);
}

/**
 * Pick theme-specific selector with fallback chain
 * @param {string} themeName - Theme name
 * @param {string} key - Selector key
 * @param {any} fallbackValue - Final fallback value
 * @returns {object} { value, source } object
 */
export function pickThemeSelector(themeName, key, fallbackValue) {
  const normalizedTheme = normalizeThemeName(themeName);
  const state = _ns._themeState;

  // 1. Check theme-specific selectors in THEME_SELECTORS
  if (_ns.themeSelectors && _ns.themeSelectors[normalizedTheme]) {
    const value = _ns.themeSelectors[normalizedTheme][key];
    if (value !== undefined && value !== null) {
      return { value, source: `theme:${normalizedTheme}` };
    }
  }

  // 2. Check state selectors (current theme)
  if (state.selectors && state.selectors[key] !== undefined && state.selectors[key] !== null) {
    return { value: state.selectors[key], source: 'state' };
  }

  // 3. Check fallback selectors from backend
  if (state.fallbackSelectors && state.fallbackSelectors[key] !== undefined && state.fallbackSelectors[key] !== null) {
    return { value: state.fallbackSelectors[key], source: 'fallback-backend' };
  }

  // 4. Check Dawn selectors
  if (_ns.themeSelectors && _ns.themeSelectors[DEFAULT_THEME]) {
    const value = _ns.themeSelectors[DEFAULT_THEME][key];
    if (value !== undefined && value !== null) {
      return { value, source: `theme:${DEFAULT_THEME}` };
    }
  }

  // 5. Return provided fallback
  return { value: fallbackValue, source: 'fallback' };
}

/**
 * Ensure theme selectors are ready or timeout
 * @param {number} timeoutMs - Timeout in milliseconds
 * @returns {Promise<boolean>} True if ready, false if timeout
 */
export function ensureThemeSelectorsReady(timeoutMs = 4000) {
  const state = _ns._themeState;

  // Already ready
  if (state.isReady) {
    return Promise.resolve(true);
  }

  // Wait for promise or timeout
  return new Promise((resolve) => {
    const timeoutId = setTimeout(() => {
      logger.warn({ timeoutMs }, 'Theme selectors ready timeout');
      resolve(false);
    }, timeoutMs);

    // Subscribe to updates
    const unsubscribe = subscribeToThemeSelectorUpdates((status) => {
      if (status.isReady) {
        clearTimeout(timeoutId);
        resolve(true);
      }
    });

    // Also check if promise exists
    if (_ns._themePromise) {
      _ns._themePromise
        .then(() => {
          if (state.isReady) {
            clearTimeout(timeoutId);
            resolve(true);
          }
        })
        .catch((err) => {
          logger.error({ err }, 'Theme selectors promise rejected');
        });
    }
  });
}

/**
 * Subscribe to theme selector updates
 * @param {Function} callback - Callback function
 * @returns {Function} Unsubscribe function
 */
export function subscribeToThemeSelectorUpdates(callback) {
  if (typeof callback !== 'function') {
    logger.error({}, 'subscribeToThemeSelectorUpdates: callback must be a function');
    return () => {};
  }

  const state = _ns._themeState;
  state.listeners.push(callback);

  // Return unsubscribe function
  return () => {
    const index = state.listeners.indexOf(callback);
    if (index > -1) {
      state.listeners.splice(index, 1);
    }
  };
}

/**
 * Auto-detect and fetch theme selectors on load
 */
function autoDetectTheme() {
  try {
    // Read from Shopify global
    const shopifyTheme = window.Shopify?.theme;

    if (!shopifyTheme) {
      logger.warn({}, 'Shopify.theme not available, using default theme');
      _ns._themePromise = fetchThemeSelectors(DEFAULT_THEME, null, null, null);
      return;
    }

    const themeName = shopifyTheme.name || DEFAULT_THEME;
    const themeId = shopifyTheme.id || null;
    const schemaName = shopifyTheme.schema_name || null;
    const storeId = shopifyTheme.theme_store_id || null;

    logger.info({
      themeName,
      themeId,
      schemaName,
      storeId,
    }, 'Auto-detected theme');

    // Kick off fetch
    _ns._themePromise = fetchThemeSelectors(themeName, themeId, schemaName, storeId);
  } catch (error) {
    logger.error({ err: error }, 'Error in auto-detect theme');
    _ns._themePromise = fetchThemeSelectors(DEFAULT_THEME, null, null, null);
  }
}

// Auto-detect on module load
if (typeof window !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoDetectTheme);
  } else {
    autoDetectTheme();
  }
}
