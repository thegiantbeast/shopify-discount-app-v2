import { logger } from './logger.js';

/**
 * Purchase context constants
 */
export const PURCHASE_CONTEXT = {
  DEFAULT: 'any',
  ONE_TIME: 'one_time',
  SUBSCRIPTION: 'subscription'
};

/**
 * Resolves purchase context from selling plan ID
 * @param {string|null} sellingPlanId - Selling plan ID (null/empty for one-time)
 * @returns {string} Purchase context constant
 */
export function resolvePurchaseContext(sellingPlanId) {
  try {
    // If selling plan is present and truthy, it's a subscription
    if (sellingPlanId && sellingPlanId !== '' && sellingPlanId !== '0') {
      logger.debug({ sellingPlanId }, 'Resolved context: subscription');
      return PURCHASE_CONTEXT.SUBSCRIPTION;
    }

    // Otherwise it's one-time
    logger.debug({ sellingPlanId }, 'Resolved context: one-time');
    return PURCHASE_CONTEXT.ONE_TIME;

  } catch (error) {
    logger.error({ err: error, sellingPlanId }, 'Failed to resolve purchase context');
    // Default to one-time on error
    return PURCHASE_CONTEXT.ONE_TIME;
  }
}

/**
 * Checks if a discount is eligible for the given selling plan
 * @param {Object} discount - Discount object
 * @param {string|null} sellingPlanId - Selling plan ID
 * @returns {boolean} Whether discount is eligible
 */
export function isDiscountEligibleForSellingPlan(discount, sellingPlanId) {
  try {
    if (!discount) {
      logger.warn('No discount provided to eligibility check');
      return false;
    }

    const context = resolvePurchaseContext(sellingPlanId);

    // Subscription context
    if (context === PURCHASE_CONTEXT.SUBSCRIPTION) {
      const eligible = discount.appliesOnSubscription === true;
      logger.debug({
        discountId: discount.id,
        sellingPlanId,
        appliesOnSubscription: discount.appliesOnSubscription,
        eligible
      }, 'Checked subscription eligibility');
      return eligible;
    }

    // One-time context
    // Eligible unless explicitly set to false
    const eligible = discount.appliesOnOneTimePurchase !== false;
    logger.debug({
      discountId: discount.id,
      sellingPlanId,
      appliesOnOneTimePurchase: discount.appliesOnOneTimePurchase,
      eligible
    }, 'Checked one-time eligibility');
    return eligible;

  } catch (error) {
    logger.error({
      err: error,
      discountId: discount?.id,
      sellingPlanId
    }, 'Failed to check discount eligibility');
    // Default to eligible on error (fail open)
    return true;
  }
}

/**
 * Filters array of discounts by purchase context eligibility
 * @param {Array} discounts - Array of discount objects
 * @param {string|null} sellingPlanId - Selling plan ID
 * @returns {Array} Filtered array of eligible discounts
 */
export function filterDiscountsByPurchaseContext(discounts, sellingPlanId) {
  try {
    if (!Array.isArray(discounts)) {
      logger.warn({ discounts }, 'Invalid discounts array provided');
      return [];
    }

    const context = resolvePurchaseContext(sellingPlanId);
    const eligible = discounts.filter(discount =>
      isDiscountEligibleForSellingPlan(discount, sellingPlanId)
    );

    logger.info({
      context,
      sellingPlanId,
      totalDiscounts: discounts.length,
      eligibleDiscounts: eligible.length
    }, 'Filtered discounts by purchase context');

    return eligible;

  } catch (error) {
    logger.error({
      err: error,
      sellingPlanId,
      discountCount: discounts?.length
    }, 'Failed to filter discounts by purchase context');
    // Return all discounts on error (fail open)
    return discounts || [];
  }
}

/**
 * Gets purchase context label for display
 * @param {string} context - Purchase context constant
 * @returns {string} Human-readable label
 */
export function getPurchaseContextLabel(context) {
  switch (context) {
    case PURCHASE_CONTEXT.SUBSCRIPTION:
      return 'Subscription';
    case PURCHASE_CONTEXT.ONE_TIME:
      return 'One-time purchase';
    case PURCHASE_CONTEXT.DEFAULT:
    default:
      return 'Any purchase type';
  }
}

/**
 * Checks if discount requires subscription
 * @param {Object} discount - Discount object
 * @returns {boolean} True if discount only applies to subscriptions
 */
export function isSubscriptionOnly(discount) {
  try {
    if (!discount) return false;

    const subscriptionOnly = discount.appliesOnSubscription === true &&
                            discount.appliesOnOneTimePurchase === false;

    logger.debug({
      discountId: discount.id,
      appliesOnSubscription: discount.appliesOnSubscription,
      appliesOnOneTimePurchase: discount.appliesOnOneTimePurchase,
      subscriptionOnly
    }, 'Checked if subscription only');

    return subscriptionOnly;

  } catch (error) {
    logger.error({ err: error, discountId: discount?.id }, 'Failed to check subscription only');
    return false;
  }
}

/**
 * Checks if discount requires one-time purchase
 * @param {Object} discount - Discount object
 * @returns {boolean} True if discount only applies to one-time purchases
 */
export function isOneTimeOnly(discount) {
  try {
    if (!discount) return false;

    const oneTimeOnly = discount.appliesOnOneTimePurchase !== false &&
                       discount.appliesOnSubscription === false;

    logger.debug({
      discountId: discount.id,
      appliesOnSubscription: discount.appliesOnSubscription,
      appliesOnOneTimePurchase: discount.appliesOnOneTimePurchase,
      oneTimeOnly
    }, 'Checked if one-time only');

    return oneTimeOnly;

  } catch (error) {
    logger.error({ err: error, discountId: discount?.id }, 'Failed to check one-time only');
    return false;
  }
}
