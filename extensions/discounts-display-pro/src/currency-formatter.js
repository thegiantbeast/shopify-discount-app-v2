import _ns from './namespace.js';

/**
 * Currency Formatter and Price Parser
 *
 * Four-tier price formatting fallback:
 * 1. Shopify.formatMoney if currency matches base currency
 * 2. Detected DOM prefix/suffix
 * 3. Presentment currency symbol
 * 4. Intl.NumberFormat
 */

import { logger } from './logger.js';

/**
 * Detect money format from a price text sample
 * @param {string} text - Price text to analyze
 * @returns {string} - 'european' or 'us'
 */
function detectMoneyFormat(text) {
  try {
    // Remove currency symbols and letters
    const cleaned = text.replace(/[^\d.,]/g, '');

    // European format: comma as decimal separator (e.g., 1.234,56)
    if (/,\d{2}$/.test(cleaned)) {
      return 'european';
    }

    // US format: dot as decimal separator (e.g., 1,234.56)
    if (/\.\d{2}$/.test(cleaned)) {
      return 'us';
    }

    // Check for European thousands separator (dot with 3 digits after)
    if (/\.\d{3}/.test(cleaned) && !/\.\d{2}$/.test(cleaned)) {
      return 'european';
    }

    // Default to US format
    return 'us';
  } catch (error) {
    logger.logError(error, 'Error detecting money format', 'General');
    return 'us';
  }
}

/**
 * Format price with four-tier fallback
 * @param {number} priceInCents - Price in cents
 * @param {boolean} includeCurrencyCode - Whether to include currency code
 * @returns {string} - Formatted price string
 */
export function formatPrice(priceInCents, includeCurrencyCode = false) {
  try {
    const priceInDollars = priceInCents / 100;

    // Tier 1: Shopify.formatMoney if available and currency matches
    if (typeof window !== 'undefined' && window.Shopify && window.Shopify.formatMoney) {
      try {
        const format = includeCurrencyCode
          ? (_ns?.shopMoneyWithCurrencyFormat || _ns?.shopMoneyFormat || '{{amount}}')
          : (_ns?.shopMoneyFormat || '{{amount}}');

        // Shopify.formatMoney expects cents
        return window.Shopify.formatMoney(priceInCents, format);
      } catch (error) {
        logger.logError(error, 'Shopify.formatMoney failed', 'General');
      }
    }

    // Format the numeric value
    const formatted = priceInDollars.toFixed(2);

    // Tier 2: Detected DOM prefix/suffix
    if (typeof window !== 'undefined' && _ns &&
        (_ns._currencyPrefix || _ns._currencySuffix)) {
      const prefix = _ns._currencyPrefix || '';
      const suffix = _ns._currencySuffix || '';
      return `${prefix}${formatted}${suffix}`;
    }

    // Tier 3: Presentment currency symbol
    if (typeof window !== 'undefined') {
      const symbol = (_ns && _ns.currencySymbol) ||
                    (_ns && _ns.currencySymbols && _ns.currencySymbols[window.Currency]) ||
                    '$';
      return `${symbol}${formatted}`;
    }

    // Tier 4: Intl.NumberFormat fallback
    try {
      if (typeof Intl !== 'undefined' && Intl.NumberFormat) {
        const currency = (typeof window !== 'undefined' && window.Currency) || 'USD';
        const formatter = new Intl.NumberFormat('en-US', {
          style: 'currency',
          currency: currency,
          minimumFractionDigits: 2,
          maximumFractionDigits: 2
        });
        return formatter.format(priceInDollars);
      }
    } catch (error) {
      logger.logError(error, 'Intl.NumberFormat failed', 'General');
    }

    // Final fallback: simple format
    return `$${formatted}`;

  } catch (error) {
    logger.logError(error, 'Error formatting price', 'General');
    return `$${(priceInCents / 100).toFixed(2)}`;
  }
}

/**
 * Parse price text to cents
 * @param {string} text - Price text to parse
 * @returns {number|null} - Price in cents, or null if parsing fails
 */
export function parsePrice(text) {
  if (!text || typeof text !== 'string') return null;

  try {
    // Remove common labels
    let cleaned = text.trim()
      .replace(/\bfrom\b/gi, '')
      .replace(/\beach\b/gi, '')
      .replace(/\bper item\b/gi, '')
      .replace(/\bper\b/gi, '');

    // Remove currency codes (3 uppercase letters)
    cleaned = cleaned.replace(/\b[A-Z]{3}\b/g, '');

    // Detect format
    const format = detectMoneyFormat(cleaned);

    // Extract numeric part with decimal/thousand separators
    let match;
    if (format === 'european') {
      // European: 1.234,56 or 1234,56
      match = cleaned.match(/[\d.]+,\d{2}/);
      if (match) {
        // Replace dots (thousands) and comma (decimal)
        const normalized = match[0].replace(/\./g, '').replace(',', '.');
        const priceInDollars = parseFloat(normalized);
        if (!isNaN(priceInDollars)) {
          return Math.round(priceInDollars * 100);
        }
      }
    } else {
      // US format: 1,234.56 or 1234.56
      match = cleaned.match(/[\d,]+\.\d{2}|[\d,]+/);
      if (match) {
        // Remove commas (thousands)
        const normalized = match[0].replace(/,/g, '');
        const priceInDollars = parseFloat(normalized);
        if (!isNaN(priceInDollars)) {
          return Math.round(priceInDollars * 100);
        }
      }
    }

    // Fallback: extract any decimal number
    match = cleaned.match(/\d+\.?\d*/);
    if (match) {
      const priceInDollars = parseFloat(match[0]);
      if (!isNaN(priceInDollars)) {
        return Math.round(priceInDollars * 100);
      }
    }

    return null;
  } catch (error) {
    logger.logError(error, 'Error parsing price', 'General');
    return null;
  }
}

/**
 * Check if price text contains a currency code
 * @param {string} text - Price text to check
 * @returns {boolean} - True if currency code is present
 */
export function hasCurrencyCode(text) {
  if (!text || typeof text !== 'string') return false;

  try {
    // Match 3 uppercase letters (currency code pattern)
    return /\b[A-Z]{3}\b/.test(text);
  } catch (error) {
    return false;
  }
}

/**
 * Extract currency format (prefix/suffix) from price text
 * @param {string} priceText - Price text to analyze
 * @returns {Object} - {prefix, suffix}
 */
export function extractCurrencyFormat(priceText) {
  if (!priceText || typeof priceText !== 'string') {
    return { prefix: '', suffix: '' };
  }

  try {
    // Find numeric part
    const numericMatch = priceText.match(/[\d.,]+/);
    if (!numericMatch) {
      return { prefix: '', suffix: '' };
    }

    const numericPart = numericMatch[0];
    const numericIndex = priceText.indexOf(numericPart);

    const prefix = priceText.substring(0, numericIndex).trim();
    const suffix = priceText.substring(numericIndex + numericPart.length).trim();

    // Store in window for reuse
    if (typeof window !== 'undefined') {
      if (prefix) _ns._currencyPrefix = prefix;
      if (suffix) _ns._currencySuffix = suffix;
    }

    return { prefix, suffix };
  } catch (error) {
    logger.logError(error, 'Error extracting currency format', 'General');
    return { prefix: '', suffix: '' };
  }
}

/**
 * Calculate discounted price
 * @param {number} regularPrice - Regular price in cents
 * @param {Object} discount - Discount object with type and value
 * @returns {number} - Discounted price in cents
 */
export function calculateDiscountedPrice(regularPrice, discount) {
  if (!discount || !discount.type) return regularPrice;

  try {
    let discountAmount = 0;

    if (discount.type === 'percentage') {
      const percentage = discount.value || 0;
      discountAmount = Math.floor(regularPrice * percentage / 100);
    } else if (discount.type === 'fixed') {
      discountAmount = Math.min(discount.value || 0, regularPrice);
    }

    return Math.max(0, regularPrice - discountAmount);
  } catch (error) {
    logger.logError(error, 'Error calculating discounted price', 'General');
    return regularPrice;
  }
}

/**
 * Format date string
 * @param {string} dateString - ISO date string
 * @returns {string} - Formatted date
 */
export function formatDate(dateString) {
  try {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  } catch (error) {
    logger.logError(error, 'Error formatting date', 'General');
    return dateString;
  }
}
