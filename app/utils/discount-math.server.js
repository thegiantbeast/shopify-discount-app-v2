import { createLogger } from "./logger.server.js";

const logger = createLogger("DiscountMath");

/**
 * Calculate the discounted price given a regular price and discount object.
 * @param {number} regularPriceCents - The regular price in cents
 * @param {Object} discount - The discount object with type and value
 * @returns {number|null} The discounted price in cents, or regularPriceCents on error
 */
export function calculateDiscountedPrice(regularPriceCents, discount) {
  try {
    // Guard: no discount or invalid price
    if (!discount || !Number.isFinite(regularPriceCents)) {
      return regularPriceCents ?? null;
    }

    let discountAmount = 0;

    if (discount.type === "percentage") {
      // Clamp percentage to 0-100
      const percentage = Math.min(Math.max(discount.value ?? 0, 0), 100);
      discountAmount = Math.floor(regularPriceCents * (percentage / 100));
    } else {
      // Fixed amount
      const rawAmount = typeof discount.value === "number" ? discount.value : 0;
      // Clamp to [0, regularPriceCents]
      discountAmount = Math.min(
        Math.max(Math.round(rawAmount), 0),
        regularPriceCents
      );
    }

    const discountedPrice = regularPriceCents - discountAmount;

    // Final safety check
    if (!Number.isFinite(discountedPrice)) {
      return regularPriceCents;
    }

    // Never return negative
    return Math.max(0, discountedPrice);
  } catch (error) {
    logger.warn("Error calculating discounted price, returning regular price", {
      err: error, regularPriceCents, discount,
    });
    return regularPriceCents;
  }
}

/**
 * Calculate the actual savings amount for a discount.
 * @param {number} regularPriceCents - The regular price in cents
 * @param {Object} discount - The discount object
 * @returns {number} The savings amount in cents (always >= 0)
 */
export function calculateActualSavings(regularPriceCents, discount) {
  try {
    // Guard: no discount or invalid price
    if (!discount || !Number.isFinite(regularPriceCents)) {
      return 0;
    }

    if (discount.type === "percentage") {
      // Clamp percentage to 0-100
      const percentage = Math.min(Math.max(discount.value ?? 0, 0), 100);
      return Math.floor(regularPriceCents * (percentage / 100));
    } else {
      // Fixed amount
      const rawAmount = typeof discount.value === "number" ? discount.value : 0;
      // Clamp to [0, regularPriceCents]
      return Math.min(Math.max(Math.round(rawAmount), 0), regularPriceCents);
    }
  } catch (error) {
    logger.warn("Error calculating savings, returning 0", {
      err: error, regularPriceCents, discount,
    });
    return 0;
  }
}

/**
 * Check if a discount is eligible for a specific variant.
 * @param {Object} discount - The discount object with variantScope
 * @param {string|number|null} currentVariantId - The variant ID to check
 * @returns {boolean} True if the discount applies to this variant
 */
export function isDiscountEligibleForVariant(discount, currentVariantId) {
  try {
    const scope = discount?.variantScope;

    // No scope means applies to all
    if (!scope || !scope.type) {
      return true;
    }

    // ALL scope
    if (scope.type === "ALL") {
      return true;
    }

    // PARTIAL scope
    if (scope.type === "PARTIAL" && Array.isArray(scope.ids)) {
      // Can't verify eligibility without a variant ID
      if (currentVariantId == null) {
        return false;
      }

      // Check if variant ID is in the scope list (normalize to strings)
      return scope.ids.map(String).includes(String(currentVariantId));
    }

    // Unknown scope type or invalid structure
    return false;
  } catch (error) {
    logger.warn("Error checking variant eligibility, returning false", {
      err: error, discount, currentVariantId,
    });
    return false;
  }
}

/**
 * Find the single best discount from an array of discounts.
 * @param {Array} discounts - Array of discount objects
 * @param {number} regularPriceCents - The regular price in cents
 * @param {string|number|null} currentVariantId - The variant ID to check eligibility
 * @returns {Object|null} Object with { discount, finalPrice, savings } or null
 */
export function findBestDiscount(discounts, regularPriceCents, currentVariantId) {
  try {
    // Filter to eligible discounts
    const eligible = discounts.filter((d) =>
      isDiscountEligibleForVariant(d, currentVariantId)
    );

    if (eligible.length === 0) {
      return null;
    }

    if (eligible.length === 1) {
      const discount = eligible[0];
      return {
        discount,
        finalPrice: calculateDiscountedPrice(regularPriceCents, discount),
        savings: calculateActualSavings(regularPriceCents, discount),
      };
    }

    // Multiple eligible discounts: find the one with highest savings
    let best = null;
    let bestSavings = -1;
    let bestValue = -1;

    for (const discount of eligible) {
      const savings = calculateActualSavings(regularPriceCents, discount);

      // Check if this is better (higher savings, or same savings but higher value)
      if (
        savings > bestSavings ||
        (savings === bestSavings && (discount.value ?? 0) > bestValue)
      ) {
        best = discount;
        bestSavings = savings;
        bestValue = discount.value ?? 0;
      }
    }

    if (!best) {
      return null;
    }

    return {
      discount: best,
      finalPrice: calculateDiscountedPrice(regularPriceCents, best),
      savings: bestSavings,
    };
  } catch (error) {
    logger.warn("Error finding best discount, returning null", {
      err: error, regularPriceCents, currentVariantId,
    });
    return null;
  }
}

/**
 * Find the best automatic discount and best coupon discount separately.
 * @param {Array} discounts - Array of discount objects
 * @param {number} regularPriceCents - The regular price in cents
 * @param {string|number|null} currentVariantId - The variant ID to check eligibility
 * @returns {Object} Object with automatic and coupon best discounts
 */
export function findBestDiscounts(discounts, regularPriceCents, currentVariantId) {
  try {
    // Split into automatic and coupon discounts
    const automaticDiscounts = discounts.filter((d) => d.isAutomatic === true);
    const couponDiscounts = discounts.filter((d) => !d.isAutomatic);

    // Find best of each category
    const automatic = findBestDiscount(
      automaticDiscounts,
      regularPriceCents,
      currentVariantId
    );
    const coupon = findBestDiscount(
      couponDiscounts,
      regularPriceCents,
      currentVariantId
    );

    return {
      automaticDiscount: automatic?.discount || null,
      automaticFinalPrice: automatic?.finalPrice ?? null,
      automaticSavings: automatic?.savings ?? null,
      couponDiscount: coupon?.discount || null,
      couponFinalPrice: coupon?.finalPrice ?? null,
      couponSavings: coupon?.savings ?? null,
    };
  } catch (error) {
    logger.warn("Error finding best discounts, returning all null", {
      err: error, regularPriceCents, currentVariantId,
    });
    return {
      automaticDiscount: null,
      automaticFinalPrice: null,
      automaticSavings: null,
      couponDiscount: null,
      couponFinalPrice: null,
      couponSavings: null,
    };
  }
}

/**
 * Resolve the best automatic and coupon discounts, with suppression logic.
 * @param {Object} params - Parameters object
 * @param {Array} params.discounts - Array of discount objects
 * @param {number} params.regularPriceCents - The regular price in cents
 * @param {string|number|null} params.currentVariantId - The variant ID to check eligibility
 * @returns {Object} Resolved best discounts with entry objects
 */
export function resolveBestDiscounts({
  discounts,
  regularPriceCents,
  currentVariantId,
}) {
  try {
    // Guard: invalid input
    if (
      !Array.isArray(discounts) ||
      typeof regularPriceCents !== "number"
    ) {
      return {
        automaticDiscount: null,
        couponDiscount: null,
        automaticEntry: null,
        couponEntry: null,
        basePriceCents: null,
      };
    }

    // Find best discounts
    let {
      automaticDiscount,
      automaticFinalPrice,
      automaticSavings,
      couponDiscount,
      couponFinalPrice,
      couponSavings,
    } = findBestDiscounts(discounts, regularPriceCents, currentVariantId);

    // Suppression logic: if automatic is better or equal, suppress coupon
    if (automaticDiscount && couponDiscount) {
      // Compare final prices first (lower is better)
      const automaticIsBetter =
        automaticFinalPrice != null && couponFinalPrice != null
          ? automaticFinalPrice <= couponFinalPrice
          : automaticSavings >= couponSavings;

      if (automaticIsBetter) {
        couponDiscount = null;
        couponFinalPrice = null;
        couponSavings = null;
      }
    }

    // Build entry objects
    const automaticEntry = automaticDiscount
      ? {
          finalPriceCents: automaticFinalPrice,
          regularPriceCents,
        }
      : null;

    const couponEntry = couponDiscount
      ? {
          finalPriceCents: couponFinalPrice,
          regularPriceCents,
        }
      : null;

    return {
      automaticDiscount,
      couponDiscount,
      automaticEntry,
      couponEntry,
      basePriceCents: regularPriceCents,
    };
  } catch (error) {
    logger.warn("Error resolving best discounts, returning all null", {
      err: error, regularPriceCents, currentVariantId,
    });
    return {
      automaticDiscount: null,
      couponDiscount: null,
      automaticEntry: null,
      couponEntry: null,
      basePriceCents: regularPriceCents,
    };
  }
}
