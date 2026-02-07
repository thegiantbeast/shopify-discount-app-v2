import { createLogger } from "../logger.server.js";

const logger = createLogger("TierManager");

const UPGRADE_ELIGIBLE_REASONS = {
  BASIC: ["FIXED_AMOUNT_TIER"],
  ADVANCED: ["SUBSCRIPTION_TIER", "VARIANT_TIER", "FIXED_AMOUNT_TIER"],
};

const getUpgradeEligibleReasons = (tier) =>
  UPGRADE_ELIGIBLE_REASONS[tier] || [];

const resolveStatusFromStoredDiscount = (discount, now) => {
  if (!discount) return "HIDDEN";
  const startsAt = discount.startsAt ? new Date(discount.startsAt) : null;
  const endsAt = discount.endsAt ? new Date(discount.endsAt) : null;

  if (startsAt && startsAt > now) {
    return "SCHEDULED";
  }

  if (endsAt && endsAt < now) {
    return "HIDDEN";
  }
  return "HIDDEN";
};

export async function refreshUpgradeRequiredDiscounts(shopDomain, tier, db) {
  const eligibleReasons = getUpgradeEligibleReasons(tier);
  if (!shopDomain || eligibleReasons.length === 0) {
    return { refreshed: 0, candidates: 0 };
  }

  try {
    const candidates = await db.liveDiscount.findMany({
      where: {
        shop: shopDomain,
        status: "UPGRADE_REQUIRED",
        exclusionReason: { in: eligibleReasons },
      },
      select: {
        gid: true,
      },
    });

    if (!candidates.length) {
      return { refreshed: 0, candidates: 0 };
    }

    const gids = candidates.map((row) => row.gid);
    const storedDiscounts = await db.discount.findMany({
      where: {
        shop: shopDomain,
        gid: { in: gids },
      },
      select: {
        gid: true,
        status: true,
        startsAt: true,
        endsAt: true,
      },
    });
    const storedByGid = new Map(
      storedDiscounts.map((discount) => [discount.gid, discount]),
    );

    const now = new Date();
    let refreshed = 0;

    for (const row of candidates) {
      const stored = storedByGid.get(row.gid);
      if (!stored) {
        continue;
      }

      const nextStatus = resolveStatusFromStoredDiscount(stored, now);
      await db.liveDiscount.update({
        where: { gid: row.gid },
        data: {
          status: nextStatus,
          exclusionReason: null,
          exclusionDetails: null,
        },
      });
      refreshed += 1;
    }

    if (refreshed > 0) {
      logger.info("Cleared upgrade-required discounts after tier change", {
        shop: shopDomain, tier, refreshed,
      });
    }

    return { refreshed, candidates: candidates.length };
  } catch (error) {
    logger.error("Failed to refresh upgrade-required discounts", {
      err: error, shop: shopDomain,
    });
    return { refreshed: 0, candidates: 0 };
  }
}

export async function getLiveDiscountState(
  shopDomain,
  tierConfig,
  db,
  contextLabel = "",
) {
  let liveDiscountCount = 0;
  let enforcedLimit = false;

  try {
    const result = await db.$transaction(async (tx) => {
      const count = await tx.liveDiscount.count({
        where: {
          shop: shopDomain,
          status: "LIVE",
        },
      });

      if (
        tierConfig.liveDiscountLimit !== null &&
        count > tierConfig.liveDiscountLimit
      ) {
        await tx.discount.updateMany({
          where: {
            shop: shopDomain,
            status: "LIVE",
          },
          data: {
            status: "HIDDEN",
          },
        });
        await tx.liveDiscount.updateMany({
          where: {
            shop: shopDomain,
            status: "LIVE",
          },
          data: {
            status: "HIDDEN",
          },
        });

        return { count: 0, previousCount: count, enforced: true };
      }

      return { count, previousCount: count, enforced: false };
    });

    liveDiscountCount = result.count;
    enforcedLimit = result.enforced;

    if (enforcedLimit) {
      const suffix = contextLabel ? ` (${contextLabel})` : "";
      logger.warn(`Live discount count (${result.previousCount}) exceeded limit (${tierConfig.liveDiscountLimit}). All discounts hidden to enforce tier limit${suffix}.`, {
        shop: shopDomain, limit: tierConfig.liveDiscountLimit, previousCount: result.previousCount,
      });
    }
  } catch (error) {
    const suffix = contextLabel ? ` in ${contextLabel}` : "";
    logger.error(`Failed to get/enforce live discount state${suffix}`, {
      err: error, shop: shopDomain,
    });
    try {
      liveDiscountCount = await db.liveDiscount.count({
        where: {
          shop: shopDomain,
          status: "LIVE",
        },
      });
    } catch (_) {
      // Ignore secondary error
    }
  }

  return {
    liveDiscountCount,
    enforcedLimit,
  };
}
