import { createLogger } from "../logger.server.js";
import { canHaveMoreLiveDiscounts } from "../tier-manager.server.js";
import { checkAndCleanupExpiredDiscounts } from "./cleanup.server.js";
import { evaluateTierGating } from "./tier-gating.server.js";
import {
  isAllCustomersSelection,
  isProductDiscount,
  getDiscountClassValue,
  getShopIdByDomain,
} from "./utils.server.js";
import {
  computeDiscountType,
  getTemporalBounds,
  isExpiredStatus,
  isPastEndDate,
} from "./status-utils.server.js";

const logger = createLogger("LiveDiscountUpdater");

export const EXCLUSION_REASONS = {
  NOT_PRODUCT_DISCOUNT: "NOT_PRODUCT_DISCOUNT",
  CUSTOMER_SEGMENT: "CUSTOMER_SEGMENT",
  MIN_REQUIREMENT: "MIN_REQUIREMENT",
  BXGY_DISCOUNT: "BXGY_DISCOUNT",
  SUBSCRIPTION_TIER: "SUBSCRIPTION_TIER",
  VARIANT_TIER: "VARIANT_TIER",
  FIXED_AMOUNT_TIER: "FIXED_AMOUNT_TIER",
};

export const EXCLUSION_DETAILS = {
  NOT_PRODUCT_DISCOUNT: (discountClass) =>
    `This ${discountClass?.toLowerCase() || "discount"} type cannot be displayed on product pages. Only product-level discounts are supported.`,
  CUSTOMER_SEGMENT:
    "This discount is limited to specific customer groups and cannot be displayed publicly on your storefront.",
  MIN_REQUIREMENT:
    "This discount requires a minimum cart value or quantity, which cannot be verified on the product page.",
  BXGY_DISCOUNT:
    "Buy X Get Y discounts cannot be displayed on product pages. These discounts require cart-level calculations.",
  SUBSCRIPTION_TIER: (tier) =>
    `Subscription discounts require the Advanced plan. Your current plan is ${tier}.`,
  VARIANT_TIER: (tier) =>
    `Variant-specific discounts require the Advanced plan. Your current plan is ${tier}.`,
  FIXED_AMOUNT_TIER: (tier) =>
    `Fixed-amount discounts require the Basic plan or higher. Your current plan is ${tier}.`,
};

export async function updateLiveDiscountData(discountId, discountData, shop, db, opts = {}) {
  try {
    const discountType = computeDiscountType(discountId);
    const { startsAt, endsAt } = getTemporalBounds(discountData);
    const now = new Date();
    const hasStarted = now >= startsAt;

    // Pre-check: expiration
    if (isExpiredStatus(discountData.status)) {
      await removeDiscountEverywhere(discountId, shop, db);
      return true;
    }

    if (isPastEndDate(endsAt, now)) {
      await removeDiscountEverywhere(discountId, shop, db);
      return true;
    }

    let exclusionReason = null;
    let exclusionDetails = null;
    let status = "HIDDEN";

    // Check 1: Non-product discount
    const isProductClass = isProductDiscount(discountData);
    if (!isProductClass) {
      const discountClass = getDiscountClassValue(discountData);
      exclusionReason = EXCLUSION_REASONS.NOT_PRODUCT_DISCOUNT;
      exclusionDetails = EXCLUSION_DETAILS.NOT_PRODUCT_DISCOUNT(discountClass);
      status = "NOT_SUPPORTED";
    }

    // Check 2: Buy X Get Y
    const discountTypeName = discountData.__typename || "";
    const isBxgyDiscount = discountTypeName.includes("Bxgy");
    if (!exclusionReason && isBxgyDiscount) {
      exclusionReason = EXCLUSION_REASONS.BXGY_DISCOUNT;
      exclusionDetails = EXCLUSION_DETAILS.BXGY_DISCOUNT;
      status = "NOT_SUPPORTED";
    }

    // Check 3: Customer segment
    const selection = discountData.context;
    const appliesToAllCustomers = isAllCustomersSelection(selection);
    if (!exclusionReason && !appliesToAllCustomers) {
      exclusionReason = EXCLUSION_REASONS.CUSTOMER_SEGMENT;
      exclusionDetails = EXCLUSION_DETAILS.CUSTOMER_SEGMENT;
      status = "NOT_SUPPORTED";
    }

    // Check 4: Minimum requirement
    if (!exclusionReason && discountData.minimumRequirement) {
      exclusionReason = EXCLUSION_REASONS.MIN_REQUIREMENT;
      exclusionDetails = EXCLUSION_DETAILS.MIN_REQUIREMENT;
      status = "NOT_SUPPORTED";
    }

    // Check 5: Tier-based exclusions
    if (!exclusionReason) {
      try {
        const tierInfo = await evaluateTierGating(discountData, shop, db);

        if (!tierInfo.isAdvanced && tierInfo.appliesOnSubscription) {
          exclusionReason = EXCLUSION_REASONS.SUBSCRIPTION_TIER;
          exclusionDetails = EXCLUSION_DETAILS.SUBSCRIPTION_TIER(tierInfo.tier);
          status = "UPGRADE_REQUIRED";
        }

        if (!exclusionReason && !tierInfo.isAdvanced && tierInfo.hasVariantTargets) {
          exclusionReason = EXCLUSION_REASONS.VARIANT_TIER;
          exclusionDetails = EXCLUSION_DETAILS.VARIANT_TIER(tierInfo.tier);
          status = "UPGRADE_REQUIRED";
        }

        const discountValue = discountData.customerGets?.value;
        const isFixedAmount = discountValue?.amount !== undefined;
        if (!exclusionReason && isFixedAmount && !tierInfo.isBasicOrHigher) {
          exclusionReason = EXCLUSION_REASONS.FIXED_AMOUNT_TIER;
          exclusionDetails = EXCLUSION_DETAILS.FIXED_AMOUNT_TIER(tierInfo.tier);
          status = "UPGRADE_REQUIRED";
        }
      } catch (tierErr) {
        logger.error(
          "Tier gating check failed",
          { err: tierErr, discountId }
        );
        exclusionReason = EXCLUSION_REASONS.SUBSCRIPTION_TIER;
        exclusionDetails =
          "Unable to verify plan eligibility. Please try refreshing or contact support.";
        status = "NOT_SUPPORTED";
      }
    }

    // Determine proper status if no exclusion
    if (!exclusionReason) {
      if (!hasStarted) {
        status = "SCHEDULED";
      } else if (discountData.status === "ACTIVE" && (!endsAt || now <= endsAt)) {
        status = "LIVE";
      } else {
        status = "HIDDEN";
      }

      const existingLiveDiscount = await db.liveDiscount.findUnique({
        where: { gid: discountId },
      });

      if (opts.preserveExistingStatus && existingLiveDiscount) {
        const preservableStatuses = ["LIVE", "HIDDEN", "SCHEDULED"];
        if (preservableStatuses.includes(existingLiveDiscount.status)) {
          status = existingLiveDiscount.status;
        }
      } else if (opts.preserveExistingStatus && !existingLiveDiscount) {
        status = "HIDDEN";
      } else if (
        status === "LIVE" &&
        (!existingLiveDiscount || existingLiveDiscount.status !== "LIVE")
      ) {
        const tierCheck = await canHaveMoreLiveDiscounts(shop, db);
        if (!tierCheck.canCreate) {
          status = "HIDDEN";
        }
      }
    }

    const shopId = await getShopIdByDomain(shop, db);
    if (!shopId) {
      logger.error("Shop not found for LiveDiscount upsert", { shop, discountId });
      return false;
    }

    await db.liveDiscount.upsert({
      where: { gid: discountId },
      update: {
        summary: discountData.summary || "",
        discountType,
        status,
        startsAt,
        endsAt,
        exclusionReason,
        exclusionDetails,
        updatedAt: new Date(),
      },
      create: {
        gid: discountId,
        shop,
        shopId,
        summary: discountData.summary || "",
        discountType,
        status,
        startsAt,
        endsAt,
        exclusionReason,
        exclusionDetails,
      },
    });

    await checkAndCleanupExpiredDiscounts(shop, db);
    return true;
  } catch (error) {
    logger.error(
      "Error updating live discount data",
      { err: error, discountId }
    );
    return false;
  }
}

async function removeDiscountEverywhere(discountId, shop, db) {
  await db.liveDiscount.deleteMany({ where: { gid: discountId, shop } });
  await db.discount.deleteMany({ where: { gid: discountId, shop } });
}
