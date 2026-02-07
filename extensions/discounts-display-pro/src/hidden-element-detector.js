/**
 * Hidden Element Detector
 *
 * CRITICAL: This checks visibility using INLINE STYLES ONLY, NOT getComputedStyle().
 *
 * WHY: The app hides the price container itself (priceEl.style.display = 'none')
 * to render its own UI. If getComputedStyle() were used, ALL children would appear
 * hidden because the parent is hidden. By checking only inline styles, we can
 * distinguish what the THEME has hidden vs what the APP has hidden.
 */

/**
 * Check if an element is hidden within a boundary container
 * @param {HTMLElement} el - Element to check
 * @param {HTMLElement} boundary - Boundary container (not checked itself)
 * @returns {boolean} - True if element is hidden, false if visible
 */
export function isHiddenWithinBoundary(el, boundary) {
  // Return true for null/undefined elements
  if (!el) return true;

  // Safety check for boundary
  if (!boundary) {
    boundary = document.body;
  }

  try {
    let current = el;

    // Walk up the DOM tree from el to boundary (exclusive)
    while (current && current !== boundary && current !== document.body && current !== document.documentElement) {

      // Check inline style for display: none
      if (current.style && current.style.display === 'none') {
        return true;
      }

      // Check inline style for visibility: hidden
      if (current.style && current.style.visibility === 'hidden') {
        return true;
      }

      // Check for screen reader / visually hidden classes
      if (current.className) {
        // Handle SVGAnimatedString (SVG elements have className as object)
        const classNameStr = typeof current.className === 'string'
          ? current.className
          : (current.className.baseVal || '');

        if (classNameStr.includes('visually-hidden') ||
            classNameStr.includes('sr-only') ||
            classNameStr.includes('screen-reader')) {
          return true;
        }
      }

      // Move to parent
      current = current.parentElement;
    }

    return false;
  } catch (error) {
    // On error, assume visible to avoid breaking functionality
    return false;
  }
}

/**
 * Alias for isHiddenWithinBoundary - used by getCleanPriceText
 * @param {HTMLElement} el - Element to check
 * @param {HTMLElement} container - Container boundary
 * @returns {boolean} - True if element is hidden
 */
export function isElementHiddenWithinContainer(el, container) {
  return isHiddenWithinBoundary(el, container);
}
