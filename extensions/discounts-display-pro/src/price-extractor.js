import { logger } from './logger.js';
import { isHiddenWithinBoundary } from './hidden-element-detector.js';
import { parsePrice, hasCurrencyCode, extractCurrencyFormat } from './currency-formatter.js';

/**
 * parsePriceFromDOM(container, options)
 *
 * Three-strategy price extraction (in priority order):
 *
 * Strategy 1: Variant JSON (forms only)
 * - Look for <script data-selected-variant> inside container
 * - Parse JSON, extract json.price or json.final_price
 * - Most accurate source (theme-provided, bypasses DOM)
 *
 * Strategy 2: Sale price selector (forms only)
 * - Use formPriceDiscountedSelector (e.g., '.price-item--sale' for Dawn)
 * - Find FIRST VISIBLE element matching selector using isHiddenWithinBoundary(match, container)
 * - Parse price from element text
 * - CRITICAL: Uses isHiddenWithinBoundary with inline style check, NOT getComputedStyle
 *
 * Strategy 3: DOM text walking
 * - getCleanPriceText(container) - walks descendants, finds visible price text
 * - Parse the resulting text
 *
 * @param {HTMLElement} container - The DOM element to search within
 * @param {Object} options - Configuration options
 * @param {string} options.formPriceDiscountedSelector - CSS selector for discounted price (forms only)
 * @param {boolean} options.isForm - Whether this is a form context
 * @returns {{ price: number, hasCurrencyCode: boolean }|null} - Parsed price data or null
 */
export function parsePriceFromDOM(container, options = {}) {
  const { formPriceDiscountedSelector = '', isForm = false } = options;

  try {
    // Strategy 1: Variant JSON (forms only)
    if (isForm) {
      try {
        const scriptEl = container.querySelector('script[data-selected-variant]');
        if (scriptEl) {
          const json = JSON.parse(scriptEl.textContent);
          const price = json.price || json.final_price;
          if (typeof price === 'number' && price > 0) {
            logger.log('Price from variant JSON', { price }, 'debug', 'Forms');
            return { price, hasCurrencyCode: false };
          }
        }
      } catch (e) {
        logger.log('Failed to parse variant JSON', { error: e.message }, 'debug', 'Forms');
        // Fall through to next strategy
      }
    }

    // Strategy 2: Discounted form price selector (forms only)
    if (isForm && formPriceDiscountedSelector) {
      const result = getDiscountedFormPrice(container, formPriceDiscountedSelector);
      if (result) {
        logger.log('Price from discounted form selector', { price: result.price }, 'debug', 'Forms');
        return result;
      }
    }

    // Strategy 3: DOM text walking
    const priceText = getCleanPriceText(container);
    if (priceText) {
      const extracted = extractCurrencyFormat(priceText);
      const price = parsePrice(priceText);
      if (typeof price === 'number' && price > 0) {
        logger.log('Price from DOM text walking', { price, priceText: extracted }, 'debug', 'PriceExtractor');
        return { price, hasCurrencyCode: hasCurrencyCode(priceText) };
      }
    }

    logger.log('No price found', {}, 'debug', 'PriceExtractor');
    return null;
  } catch (error) {
    logger.log('Error in parsePriceFromDOM', { error: error.message }, 'error', 'PriceExtractor');
    return null;
  }
}

/**
 * getDiscountedFormPrice(container, selector)
 *
 * Finds the first VISIBLE element matching the selector within container.
 * Uses isHiddenWithinBoundary to check visibility (inline styles only, not getComputedStyle).
 *
 * @param {HTMLElement} container - The DOM element to search within
 * @param {string} selector - CSS selector for discounted price elements
 * @returns {{ price: number, hasCurrencyCode: boolean }|null} - Parsed price data or null
 */
function getDiscountedFormPrice(container, selector) {
  try {
    const matches = container.querySelectorAll(selector);

    for (const match of matches) {
      // Skip if hidden (using inline style check, NOT getComputedStyle)
      if (isHiddenWithinBoundary(match, container)) {
        logger.log('Skipping hidden discounted price element', { selector }, 'debug', 'Forms');
        continue;
      }

      // Found first visible match - extract price
      const priceText = match.textContent.trim();
      if (priceText) {
        const price = parsePrice(priceText);
        if (typeof price === 'number' && price > 0) {
          return { price, hasCurrencyCode: hasCurrencyCode(priceText) };
        }
      }
    }

    return null;
  } catch (error) {
    logger.log('Error in getDiscountedFormPrice', { error: error.message, selector }, 'error', 'Forms');
    return null;
  }
}

/**
 * getCleanPriceText(container)
 *
 * Theme-agnostic price text extraction using DOM walking.
 *
 * Strategy:
 * 1. Walk all descendant elements via container.querySelectorAll('*')
 * 2. For each element, check visibility:
 *    - CSS classes: visually-hidden, sr-only, screen-reader
 *    - HTML attributes: hidden, aria-hidden="true"
 *    - INLINE STYLES ONLY: element.style.display === 'none' or element.style.visibility === 'hidden'
 *    - Walk parent chain but STOP at container boundary
 * 3. For visible elements, look at direct TEXT_NODE children for text containing digits
 * 4. Falls back to leaf elements (no child elements) with price-like text
 * 5. Last resort: container.textContent.trim()
 *
 * @param {HTMLElement} container - The DOM element to search within
 * @returns {string} - Clean price text or empty string
 */
function getCleanPriceText(container) {
  try {
    const allElements = container.querySelectorAll('*');
    const candidateTexts = [];

    // Pass 1: Look for TEXT_NODE children in visible elements
    for (const element of allElements) {
      // Check if element is hidden
      if (isElementHiddenInline(element, container)) {
        continue;
      }

      // Look at direct TEXT_NODE children
      for (const node of element.childNodes) {
        if (node.nodeType === 3) { // TEXT_NODE
          const text = node.textContent.trim();
          // Check if text contains digits (price-like)
          if (text && /\d/.test(text)) {
            candidateTexts.push(text);
          }
        }
      }
    }

    // If we found price-like text from TEXT_NODEs, use the first one
    if (candidateTexts.length > 0) {
      logger.log('Found price from TEXT_NODE', { text: candidateTexts[0] }, 'debug', 'PriceExtractor');
      return candidateTexts[0];
    }

    // Pass 2: Look for leaf elements (no child elements) with price-like text
    for (const element of allElements) {
      if (isElementHiddenInline(element, container)) {
        continue;
      }

      // Check if this is a leaf element (no child elements, only text nodes)
      if (element.children.length === 0) {
        const text = element.textContent.trim();
        if (text && /\d/.test(text)) {
          logger.log('Found price from leaf element', { text }, 'debug', 'PriceExtractor');
          return text;
        }
      }
    }

    // Last resort: container's text content
    const fallbackText = container.textContent.trim();
    if (fallbackText && /\d/.test(fallbackText)) {
      logger.log('Using fallback container text', { text: fallbackText }, 'debug', 'PriceExtractor');
      return fallbackText;
    }

    return '';
  } catch (error) {
    logger.log('Error in getCleanPriceText', { error: error.message }, 'error', 'PriceExtractor');
    return '';
  }
}

/**
 * isElementHiddenInline(element, boundary)
 *
 * Checks if element is hidden using ONLY:
 * - CSS classes: visually-hidden, sr-only, screen-reader
 * - HTML attributes: hidden, aria-hidden="true"
 * - INLINE STYLES ONLY: element.style.display === 'none' or element.style.visibility === 'hidden'
 *
 * Walks parent chain but STOPS at boundary.
 * Does NOT use getComputedStyle (too slow and not needed for inline checks).
 *
 * @param {HTMLElement} element - Element to check
 * @param {HTMLElement} boundary - Boundary to stop at when walking parents
 * @returns {boolean} - True if element is hidden
 */
function isElementHiddenInline(element, boundary) {
  try {
    let current = element;

    while (current && current !== boundary) {
      // Check CSS classes
      if (current.classList) {
        if (current.classList.contains('visually-hidden') ||
            current.classList.contains('sr-only') ||
            current.classList.contains('screen-reader')) {
          return true;
        }
      }

      // Check HTML attributes
      if (current.hasAttribute('hidden') || current.getAttribute('aria-hidden') === 'true') {
        return true;
      }

      // Check INLINE styles only (element.style, NOT getComputedStyle)
      if (current.style.display === 'none' || current.style.visibility === 'hidden') {
        return true;
      }

      current = current.parentElement;
    }

    return false;
  } catch (error) {
    logger.log('Error in isElementHiddenInline', { error: error.message }, 'error', 'PriceExtractor');
    return false; // Assume visible on error
  }
}

/**
 * findPriceElements(container, selector, selectorSource)
 *
 * Finds price elements within container using the provided selector.
 * If no results and selectorSource !== 'custom', tries fallback selectors.
 * Filters out hidden containers using getComputedStyle (outer container check only).
 *
 * @param {HTMLElement} container - The DOM element to search within
 * @param {string} selector - CSS selector for price elements
 * @param {string} selectorSource - Source of selector ('custom' or other)
 * @returns {Array<{container: HTMLElement}>} - Array of price element objects
 */
export function findPriceElements(container, selector, selectorSource = '') {
  try {
    let elements = [];

    // Try provided selector first
    if (selector) {
      elements = Array.from(container.querySelectorAll(selector));
    }

    // If no results and not a custom selector, try fallbacks
    if (elements.length === 0 && selectorSource !== 'custom') {
      const fallbackSelectors = [
        '.product-price .js-value',
        '.product-price',
        '.price__current .js-value',
        '.price__current',
        '.price .js-value',
        '.price'
      ];

      for (const fallbackSelector of fallbackSelectors) {
        elements = Array.from(container.querySelectorAll(fallbackSelector));
        if (elements.length > 0) {
          logger.log('Using fallback selector', { fallbackSelector }, 'debug', 'PriceExtractor');
          break;
        }
      }
    }

    // Filter out hidden containers (use getComputedStyle for outer container checks)
    const visibleElements = elements.filter(el => !isElementOrAncestorHidden(el));

    logger.log('Found price elements', {
      total: elements.length,
      visible: visibleElements.length,
      selector
    }, 'debug', 'PriceExtractor');

    return visibleElements.map(el => ({ container: el }));
  } catch (error) {
    logger.log('Error in findPriceElements', { error: error.message, selector }, 'error', 'PriceExtractor');
    return [];
  }
}

/**
 * isElementOrAncestorHidden(element)
 *
 * Uses getComputedStyle to check if element or any ancestor is hidden.
 * This is appropriate for outer container visibility checks (not for price element children).
 *
 * @param {HTMLElement} element - Element to check
 * @returns {boolean} - True if element or ancestor is hidden
 */
function isElementOrAncestorHidden(element) {
  try {
    let current = element;

    while (current && current !== document.body) {
      const style = window.getComputedStyle(current);

      if (style.display === 'none' ||
          style.visibility === 'hidden' ||
          style.opacity === '0') {
        return true;
      }

      current = current.parentElement;
    }

    return false;
  } catch (error) {
    logger.log('Error in isElementOrAncestorHidden', { error: error.message }, 'error', 'PriceExtractor');
    return false; // Assume visible on error
  }
}
