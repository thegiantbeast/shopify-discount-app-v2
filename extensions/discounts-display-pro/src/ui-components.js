import { logger } from './logger.js';
import { formatPrice, formatDate } from './currency-formatter.js';
import { applyDiscountCode, getCouponState, setCouponState } from './coupon-handler.js';
import _ns from './namespace.js';

/**
 * UI Components Module
 * Shared UI components for product page form rendering (PP parity).
 */

// SVG path data for the 4 icon options
const ICON_PATHS = {
  'check-mark-flower-filled.svg': 'M23.334 11.96c-.713-.726-.872-1.829-.393-2.727.342-.64.366-1.401.064-2.062-.301-.66-.893-1.142-1.601-1.302-.991-.225-1.722-1.067-1.803-2.081-.059-.723-.451-1.378-1.062-1.77-.609-.393-1.367-.478-2.05-.229-.956.347-2.026.032-2.642-.776-.44-.576-1.124-.915-1.85-.915-.725 0-1.409.339-1.849.915-.613.809-1.683 1.124-2.639.777-.682-.248-1.44-.163-2.05.229-.61.392-1.003 1.047-1.061 1.77-.082 1.014-.812 1.857-1.803 2.081-.708.16-1.3.642-1.601 1.302s-.277 1.422.065 2.061c.479.897.32 2.001-.392 2.727-.509.517-.747 1.242-.644 1.96s.536 1.347 1.17 1.7c.888.495 1.352 1.51 1.144 2.505-.147.71.044 1.448.519 1.996.476.549 1.18.844 1.902.798 1.016-.063 1.953.54 2.317 1.489.259.678.82 1.195 1.517 1.399.695.204 1.447.072 2.031-.357.819-.603 1.936-.603 2.754 0 .584.43 1.336.562 2.031.357.697-.204 1.258-.722 1.518-1.399.363-.949 1.301-1.553 2.316-1.489.724.046 1.427-.249 1.902-.798.475-.548.667-1.286.519-1.996-.207-.995.256-2.01 1.145-2.505.633-.354 1.065-.982 1.169-1.7s-.135-1.443-.643-1.96zm-12.584 5.43l-4.5-4.364 1.857-1.857 2.643 2.506 5.643-5.784 1.857 1.857-7.5 7.642z',
  'check-mark-circle-filled.svg': 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z',
  'check-mark-square-filled.svg': 'M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-9 14l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z',
  'check-mark.svg': 'M20.285 2l-11.285 11.567-5.286-5.011-3.714 3.716 9 8.728 15-15.285z'
};

/**
 * Creates a price container with discount display.
 *
 * @param {number} regularPrice - Original price before discount
 * @param {number} finalPrice - Price after discount applied
 * @param {Object} discount - Discount object
 * @param {boolean} isAutomatic - Whether this is an automatic discount
 * @param {boolean} hasCurrencyCode - Whether to include currency code in formatting
 * @returns {HTMLElement} Price container element
 */
export function createPriceContainer(regularPrice, finalPrice, discount, isAutomatic, hasCurrencyCode) {
  try {
    logger.debug({ regularPrice, finalPrice, isAutomatic }, 'Creating price container');

    const container = document.createElement('div');
    container.className = 'ddp-discounted-price-container';

    // Crossed-out regular price
    const regularPriceEl = document.createElement('span');
    regularPriceEl.className = 'ddp-discounted-price__regular';
    regularPriceEl.textContent = formatPrice(regularPrice, hasCurrencyCode);
    container.appendChild(regularPriceEl);

    // Bold sale price
    const salePriceEl = document.createElement('span');
    salePriceEl.className = 'ddp-discounted-price__sale';
    salePriceEl.textContent = formatPrice(finalPrice, hasCurrencyCode);
    container.appendChild(salePriceEl);

    // Add badge for automatic discounts
    if (isAutomatic && discount) {
      const badge = document.createElement('span');
      badge.className = 'ddp-discounted-price__badge';

      // Format badge text
      const badgeTemplate = _ns.automaticBadgeText || 'Save {amount}';
      const discountAmount = formatDiscountAmount(discount, hasCurrencyCode);
      badge.textContent = badgeTemplate.replace('{amount}', discountAmount);

      container.appendChild(badge);
    }

    // Add terms link if enabled
    const settings = _ns.settings || {};
    if (settings.showTermsLink && discount) {
      const termsLink = document.createElement('button');
      termsLink.className = 'ddp-terms-link';
      termsLink.type = 'button';
      termsLink.textContent = 'Terms';
      termsLink.setAttribute('aria-label', 'View discount terms and conditions');

      termsLink.addEventListener('click', (e) => {
        e.preventDefault();
        showTermsModal(discount);
      });

      container.appendChild(termsLink);
    }

    logger.debug({}, 'Price container created');
    return container;
  } catch (err) {
    logger.error({ err }, 'Failed to create price container');
    const fallback = document.createElement('div');
    fallback.textContent = formatPrice(finalPrice, hasCurrencyCode);
    return fallback;
  }
}

/**
 * Creates an interactive coupon block.
 *
 * @param {Object} discount - Discount object with code and details
 * @param {Function} onApply - Callback when coupon is applied
 * @param {Function} onRemove - Callback when coupon is removed
 * @param {string} productId - Shopify product ID
 * @param {string} variantId - Shopify variant ID
 * @param {boolean} isAutoApplied - Whether coupon is auto-applied
 * @returns {HTMLElement} Coupon block element
 */
export function createCouponBlock(discount, onApply, onRemove, productId, variantId, isAutoApplied) {
  try {
    logger.debug({ discountId: discount.id, productId, variantId, isAutoApplied }, 'Creating coupon block');

    const settings = _ns.settings || {};
    const isInEditor = window.Shopify && window.Shopify.designMode;

    // Main container
    const block = document.createElement('div');
    block.className = 'ddp-coupon-block';
    block.dataset.discountId = discount.id;
    block.dataset.code = discount.code;

    // Main content wrapper
    const mainContent = document.createElement('div');
    mainContent.className = 'ddp-coupon-main-content';

    // Pennant flag
    const flag = document.createElement('div');
    flag.className = 'ddp-coupon-flag';
    flag.textContent = 'Coupon:';
    mainContent.appendChild(flag);

    // Label wrapper
    const labelWrapper = document.createElement('div');
    labelWrapper.className = 'ddp-coupon-label-wrapper';

    // Checkbox and label
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.id = `ddp-coupon-${discount.id}`;
    checkbox.className = 'ddp-coupon-checkbox';

    // Check if coupon is already applied
    const couponState = getCouponState(discount.code);
    const isApplied = couponState.applied || isAutoApplied || (isInEditor && _ns.showAppliedPreview);

    if (isApplied) {
      checkbox.checked = true;
    }

    if (isAutoApplied) {
      checkbox.disabled = true;
      checkbox.title = 'This coupon is automatically applied';
    }

    const label = document.createElement('label');
    label.htmlFor = checkbox.id;
    label.className = 'ddp-coupon-label';

    // Build label text safely (split template by {amount}, use textContent + <b> for amount)
    const labelTemplate = settings.couponLabelText || 'Apply code {code} to save {amount}';
    const discountAmount = formatDiscountAmount(discount, true);

    // Replace {code} and {amount}
    let labelText = labelTemplate
      .replace('{code}', discount.code)
      .replace('{amount}', discountAmount);

    // For simple case, just use textContent
    // In v1, {amount} was wrapped in <b>, but we use textContent for XSS safety
    label.textContent = labelText;

    labelWrapper.appendChild(checkbox);
    labelWrapper.appendChild(label);
    mainContent.appendChild(labelWrapper);

    // Applied status (hidden by default)
    const appliedStatus = document.createElement('div');
    appliedStatus.className = 'ddp-coupon-applied';

    if (isApplied) {
      appliedStatus.classList.add('visible');
      labelWrapper.style.display = 'none';
    }

    // SVG icon
    const iconFile = settings.appliedIconFile || 'check-mark-circle-filled.svg';
    const iconPath = ICON_PATHS[iconFile] || ICON_PATHS['check-mark-circle-filled.svg'];

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '24');
    svg.setAttribute('height', '24');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'currentColor');
    svg.setAttribute('aria-hidden', 'true');

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', iconPath);
    svg.appendChild(path);

    appliedStatus.appendChild(svg);

    const appliedText = document.createElement('span');
    appliedText.textContent = settings.appliedText || 'Coupon applied';
    appliedStatus.appendChild(appliedText);

    mainContent.appendChild(appliedStatus);
    block.appendChild(mainContent);

    // Toolbar
    const toolbar = document.createElement('div');
    toolbar.className = 'ddp-coupon-toolbar';

    // Terms link
    if (settings.showTermsLink) {
      const termsLink = document.createElement('button');
      termsLink.className = 'ddp-terms-link';
      termsLink.type = 'button';
      termsLink.textContent = 'Terms';
      termsLink.setAttribute('aria-label', 'View coupon terms and conditions');

      termsLink.addEventListener('click', (e) => {
        e.preventDefault();
        showTermsModal(discount);
      });

      toolbar.appendChild(termsLink);
    }

    block.appendChild(toolbar);

    // Checkbox change handler
    checkbox.addEventListener('change', async (e) => {
      try {
        if (e.target.checked) {
          logger.info({ code: discount.code, productId, variantId }, 'Applying coupon');

          // Hide label, show applied status
          labelWrapper.style.display = 'none';
          appliedStatus.classList.add('visible');

          // Update state
          setCouponState(discount.code, { applied: true, timestamp: Date.now() });

          // Call onApply callback
          if (typeof onApply === 'function') {
            await onApply(discount.code);
          }

          // Apply discount code to cart
          try {
            await applyDiscountCode(discount.code);
          } catch (applyErr) {
            logger.error({ err: applyErr, code: discount.code }, 'Failed to apply discount code');
            // Revert UI on failure
            e.target.checked = false;
            labelWrapper.style.display = '';
            appliedStatus.classList.remove('visible');
            setCouponState(discount.code, { applied: false });
          }
        } else {
          logger.info({ code: discount.code, productId, variantId }, 'Removing coupon');

          // Show label, hide applied status
          labelWrapper.style.display = '';
          appliedStatus.classList.remove('visible');

          // Update state
          setCouponState(discount.code, { applied: false });

          // Call onRemove callback
          if (typeof onRemove === 'function') {
            await onRemove(discount.code);
          }

          // Remove discount code from cart
          try {
            await applyDiscountCode(''); // Empty code removes discount
          } catch (removeErr) {
            logger.error({ err: removeErr, code: discount.code }, 'Failed to remove discount code');
          }
        }
      } catch (err) {
        logger.error({ err, code: discount.code }, 'Error handling coupon checkbox change');
      }
    });

    // Track auto-applied coupons in sessionStorage
    if (isAutoApplied) {
      try {
        sessionStorage.setItem(`wf_auto_applied_${discount.code}`, 'true');
      } catch (storageErr) {
        logger.warn({ err: storageErr }, 'Failed to set auto-applied flag in sessionStorage');
      }
    }

    logger.debug({ discountId: discount.id }, 'Coupon block created');
    return block;
  } catch (err) {
    logger.error({ err, discountId: discount?.id }, 'Failed to create coupon block');
    const fallback = document.createElement('div');
    fallback.className = 'ddp-coupon-block-error';
    fallback.textContent = 'Coupon temporarily unavailable';
    return fallback;
  }
}

/**
 * Shows a full-screen modal with discount terms and conditions.
 *
 * @param {Object} discount - Discount object with details
 */
export function showTermsModal(discount) {
  try {
    logger.debug({ discountId: discount.id }, 'Showing terms modal');

    const settings = _ns.settings || {};

    // Create overlay
    const overlay = document.createElement('div');
    overlay.className = 'ddp-terms-modal-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'ddp-terms-modal-title');

    // Create modal content
    const modal = document.createElement('div');
    modal.className = 'ddp-terms-modal-content';

    // Header
    const header = document.createElement('div');
    header.className = 'ddp-terms-modal-header';

    const title = document.createElement('h2');
    title.id = 'ddp-terms-modal-title';
    title.textContent = 'Discount Information';
    header.appendChild(title);

    const closeButton = document.createElement('button');
    closeButton.className = 'ddp-terms-modal-close';
    closeButton.type = 'button';
    closeButton.textContent = '×';
    closeButton.setAttribute('aria-label', 'Close modal');
    header.appendChild(closeButton);

    modal.appendChild(header);

    // Body
    const body = document.createElement('div');
    body.className = 'ddp-terms-modal-body';

    // Discount details
    const detailsSection = document.createElement('div');
    detailsSection.className = 'ddp-terms-section';

    const detailsTitle = document.createElement('h3');
    detailsTitle.textContent = 'Details';
    detailsSection.appendChild(detailsTitle);

    // Type
    const typeRow = document.createElement('p');
    const typeLabel = document.createElement('strong');
    typeLabel.textContent = 'Type: ';
    typeRow.appendChild(typeLabel);
    const typeValue = document.createTextNode(discount.type === 'percentage' ? 'Percentage' : 'Fixed Amount');
    typeRow.appendChild(typeValue);
    detailsSection.appendChild(typeRow);

    // Value
    const valueRow = document.createElement('p');
    const valueLabel = document.createElement('strong');
    valueLabel.textContent = 'Value: ';
    valueRow.appendChild(valueLabel);
    const discountAmount = formatDiscountAmount(discount, true);
    const valueValue = document.createTextNode(discountAmount);
    valueRow.appendChild(valueValue);
    detailsSection.appendChild(valueRow);

    // End date
    if (discount.endsAt) {
      const endDateRow = document.createElement('p');
      const endDateLabel = document.createElement('strong');
      endDateLabel.textContent = 'Expires: ';
      endDateRow.appendChild(endDateLabel);
      const endDateValue = document.createTextNode(formatDate(discount.endsAt));
      endDateRow.appendChild(endDateValue);
      detailsSection.appendChild(endDateRow);
    }

    // Purchase type
    if (discount.appliesOncePerCustomer !== undefined) {
      const purchaseTypeRow = document.createElement('p');
      const purchaseTypeLabel = document.createElement('strong');
      purchaseTypeLabel.textContent = 'Usage: ';
      purchaseTypeRow.appendChild(purchaseTypeLabel);
      const purchaseTypeValue = document.createTextNode(
        discount.appliesOncePerCustomer ? 'One time per customer' : 'Multiple uses allowed'
      );
      purchaseTypeRow.appendChild(purchaseTypeValue);
      detailsSection.appendChild(purchaseTypeRow);
    }

    body.appendChild(detailsSection);

    // Terms section
    const termsSection = document.createElement('div');
    termsSection.className = 'ddp-terms-section';

    const termsTitle = document.createElement('h3');
    termsTitle.textContent = 'Terms & Conditions';
    termsSection.appendChild(termsTitle);

    // Split terms template on newlines and create paragraphs
    const termsTemplate = settings.discountTermsTemplate || 'Please see store policies for complete terms.';
    const termsLines = termsTemplate.split('\n').filter(line => line.trim());

    termsLines.forEach(line => {
      const p = document.createElement('p');
      p.textContent = line.trim();
      termsSection.appendChild(p);
    });

    body.appendChild(termsSection);
    modal.appendChild(body);

    overlay.appendChild(modal);

    // Close handlers
    const closeModal = () => {
      try {
        overlay.remove();
        document.body.style.overflow = '';
        logger.debug({}, 'Terms modal closed');
      } catch (err) {
        logger.error({ err }, 'Failed to close terms modal');
      }
    };

    closeButton.addEventListener('click', closeModal);

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        closeModal();
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && document.body.contains(overlay)) {
        closeModal();
      }
    }, { once: true });

    // Prevent body scroll
    document.body.style.overflow = 'hidden';

    // Append to body
    document.body.appendChild(overlay);

    // Focus close button for accessibility
    closeButton.focus();

    logger.info({ discountId: discount.id }, 'Terms modal shown');
  } catch (err) {
    logger.error({ err, discountId: discount?.id }, 'Failed to show terms modal');
  }
}

/**
 * Builds a loading skeleton placeholder.
 *
 * @returns {HTMLElement} Skeleton loader element
 */
export function buildSkeletonLoader() {
  try {
    const skeleton = document.createElement('div');
    skeleton.className = 'ddp-skeleton-loader';
    skeleton.setAttribute('role', 'status');
    skeleton.setAttribute('aria-live', 'polite');
    skeleton.setAttribute('aria-label', 'Loading discounts');

    // Price line
    const priceLine = document.createElement('div');
    priceLine.className = 'ddp-skeleton-line ddp-skeleton-line--price';
    priceLine.style.height = '28px';
    priceLine.style.width = '120px';
    skeleton.appendChild(priceLine);

    // Large line
    const largeLine = document.createElement('div');
    largeLine.className = 'ddp-skeleton-line ddp-skeleton-line--lg';
    largeLine.style.width = '85%';
    skeleton.appendChild(largeLine);

    // Medium line
    const mediumLine = document.createElement('div');
    mediumLine.className = 'ddp-skeleton-line ddp-skeleton-line--md';
    mediumLine.style.width = '65%';
    skeleton.appendChild(mediumLine);

    // Small line
    const smallLine = document.createElement('div');
    smallLine.className = 'ddp-skeleton-line ddp-skeleton-line--sm';
    smallLine.style.width = '45%';
    skeleton.appendChild(smallLine);

    // Screen reader text
    const srOnly = document.createElement('span');
    srOnly.className = 'ddp-sr-only';
    srOnly.textContent = 'Loading discounts ...';
    skeleton.appendChild(srOnly);

    logger.debug({}, 'Skeleton loader created');
    return skeleton;
  } catch (err) {
    logger.error({ err }, 'Failed to create skeleton loader');
    const fallback = document.createElement('div');
    fallback.textContent = 'Loading...';
    return fallback;
  }
}

/**
 * Formats discount amount for display.
 *
 * @param {Object} discount - Discount object with type and value
 * @param {boolean} hasCurrencyCode - Whether to include currency code
 * @returns {string} Formatted discount amount
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
