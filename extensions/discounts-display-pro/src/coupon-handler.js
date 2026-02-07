import { logger } from './logger.js';
import _ns from './namespace.js';

/**
 * Builds a discount URL with return_to parameter
 * @param {string} discountCode - The discount code to apply
 * @returns {string} Full discount URL with return path
 */
export function buildDiscountUrlWithReturnTo(discountCode) {
  try {
    const encodedCode = encodeURIComponent(discountCode);
    const currentPath = window.location.pathname + window.location.search;
    const encodedReturnTo = encodeURIComponent(currentPath);
    const discountUrl = `/discount/${encodedCode}?return_to=${encodedReturnTo}`;

    logger.debug({ discountCode, discountUrl }, 'Built discount URL');
    return discountUrl;
  } catch (error) {
    logger.error({ err: error, discountCode }, 'Failed to build discount URL');
    // Fallback to simple URL without return_to
    return `/discount/${encodeURIComponent(discountCode)}`;
  }
}

/**
 * Applies a discount code using 3-fallback strategy
 * @param {string} discountCode - The discount code to apply
 * @param {Object} options - Options object
 * @param {boolean} options.silent - If false, navigate directly without trying fetch/iframe
 * @returns {Promise<void>}
 */
export async function applyDiscountCode(discountCode, options = {}) {
  const { silent = true } = options;

  try {
    // Store applied state in sessionStorage
    const storageKey = `wf_coupon_applied_${discountCode}`;
    sessionStorage.setItem(storageKey, '1');
    logger.info({ discountCode, silent }, 'Applying discount code');

    // Build discount URL
    const discountUrl = buildDiscountUrlWithReturnTo(discountCode);

    // Check if in theme editor
    if (typeof Shopify !== 'undefined' && Shopify.designMode) {
      logger.debug({ discountCode }, 'In theme editor, skipping network requests');
      return;
    }

    // If not silent, navigate directly
    if (!silent) {
      logger.info({ discountCode, discountUrl }, 'Non-silent mode, navigating directly');
      window.location.href = discountUrl;
      return;
    }

    // Strategy 1: fetch() with timeout
    try {
      logger.debug({ discountCode }, 'Attempting Strategy 1: fetch()');
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2500);

      const response = await fetch(discountUrl, {
        method: 'GET',
        credentials: 'include',
        mode: 'cors',
        redirect: 'follow',
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (response.ok || (response.status >= 200 && response.status < 400)) {
        logger.info({ discountCode, status: response.status }, 'Strategy 1 succeeded');
        return;
      }

      logger.warn({ discountCode, status: response.status }, 'Strategy 1 failed, trying Strategy 2');
    } catch (fetchError) {
      logger.warn({ err: fetchError, discountCode }, 'Strategy 1 failed, trying Strategy 2');
    }

    // Strategy 2: hidden iframe with timeout
    try {
      logger.debug({ discountCode }, 'Attempting Strategy 2: iframe');
      await applyViaIframe(discountUrl, discountCode);
      logger.info({ discountCode }, 'Strategy 2 succeeded');
      return;
    } catch (iframeError) {
      logger.warn({ err: iframeError, discountCode }, 'Strategy 2 failed, trying Strategy 3');
    }

    // Strategy 3: Direct navigation
    logger.info({ discountCode, discountUrl }, 'Strategy 3: direct navigation');
    window.location.href = discountUrl;

  } catch (error) {
    logger.error({ err: error, discountCode }, 'Failed to apply discount code');
    throw error;
  }
}

/**
 * Applies discount via hidden iframe with timeout
 * @param {string} url - The discount URL
 * @param {string} discountCode - The discount code (for logging)
 * @returns {Promise<void>}
 */
function applyViaIframe(url, discountCode) {
  return new Promise((resolve, reject) => {
    let iframe = null;
    let timeoutId = null;
    let resolved = false;

    const cleanup = () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      if (iframe && iframe.parentNode) {
        setTimeout(() => {
          try {
            if (iframe && iframe.parentNode) {
              iframe.parentNode.removeChild(iframe);
            }
          } catch (err) {
            logger.warn({ err, discountCode }, 'Failed to remove iframe');
          }
        }, 250);
      }
    };

    const finish = (success, error = null) => {
      if (resolved) return;
      resolved = true;
      cleanup();
      if (success) {
        resolve();
      } else {
        reject(error || new Error('Iframe strategy failed'));
      }
    };

    try {
      iframe = document.createElement('iframe');
      iframe.style.display = 'none';
      iframe.style.position = 'absolute';
      iframe.style.width = '0';
      iframe.style.height = '0';
      iframe.style.border = 'none';
      iframe.setAttribute('aria-hidden', 'true');
      iframe.src = url;

      iframe.onload = () => {
        logger.debug({ discountCode }, 'Iframe loaded');
        finish(true);
      };

      iframe.onerror = (error) => {
        logger.warn({ err: error, discountCode }, 'Iframe error');
        finish(false, error);
      };

      timeoutId = setTimeout(() => {
        logger.warn({ discountCode }, 'Iframe timeout');
        finish(false, new Error('Iframe timeout'));
      }, 3500);

      document.body.appendChild(iframe);

    } catch (error) {
      logger.error({ err: error, discountCode }, 'Failed to create iframe');
      finish(false, error);
    }
  });
}

/**
 * Initialize coupon state tracking
 */
export function initCouponState() {
  if (!_ns._couponState) {
    _ns._couponState = {};
    logger.debug('Initialized coupon state tracker');
  }
}

/**
 * Get coupon applied state by code
 * @param {string} code - Discount code
 * @returns {{ applied: boolean }} State object
 */
export function getCouponState(code) {
  try {
    initCouponState();
    const state = _ns._couponState[code];
    if (state && typeof state === 'object') {
      return state;
    }
    return { applied: state === true };
  } catch (error) {
    logger.error({ err: error, code }, 'Failed to get coupon state');
    return { applied: false };
  }
}

/**
 * Set coupon applied state by code
 * @param {string} code - Discount code
 * @param {Object|boolean} stateOrApplied - State object { applied, timestamp } or boolean
 */
export function setCouponState(code, stateOrApplied) {
  try {
    initCouponState();
    if (typeof stateOrApplied === 'object') {
      _ns._couponState[code] = stateOrApplied;
    } else {
      _ns._couponState[code] = { applied: !!stateOrApplied };
    }
    logger.debug({ code, state: _ns._couponState[code] }, 'Set coupon state');
  } catch (error) {
    logger.error({ err: error, code }, 'Failed to set coupon state');
  }
}
