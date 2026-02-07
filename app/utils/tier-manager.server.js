import { createLogger } from "./logger.server.js";
import {
  TIER_CONFIG,
  getAvailableTiers,
  getEffectiveTierFromShopRecord,
  getTierPrice,
} from "./tier-manager.js";
import { buildDefaultShop } from "./tier-manager/default-shop.server.js";
import {
  normalizeDateInput,
  parseContext,
  parseDateValue,
  sanitizeContext,
} from "./tier-manager/context-utils.server.js";
import {
  getLiveDiscountState,
  refreshUpgradeRequiredDiscounts,
} from "./tier-manager/live-discount-helpers.server.js";
import {
  applyPendingTierIfDue as applyPendingTierIfDueExternal,
  applyPendingTierIfDueInternal,
} from "./tier-manager/pending-tier.server.js";
import {
  ensureBillingTierSynced,
  fetchShopRowById,
  rawUpdateShopById,
} from "./tier-manager/shop-records.server.js";

const logger = createLogger("TierManager");

export { getEffectiveTierFromShopRecord } from "./tier-manager.js";
export { TIER_CONFIG, getTierPrice, getAvailableTiers };

export const applyPendingTierIfDue = applyPendingTierIfDueExternal;

export async function updateShopBillingStatus(shopDomain, status, db) {
  if (!shopDomain) {
    return null;
  }

  const normalizedStatus =
    typeof status === "string" && status.trim().length > 0
      ? status.trim().toUpperCase()
      : null;

  try {
    const result = await db.shop.update({
      where: { domain: shopDomain },
      data: { billingStatus: normalizedStatus },
      select: { domain: true, billingStatus: true },
    });
    return result;
  } catch (error) {
    logger.error("Failed to update billing status", {
      err: error, shop: shopDomain,
    });
    return null;
  }
}

export async function getOrCreateShopTier(shopDomain, db, isNewInstall = false) {
  if (!shopDomain) {
    logger.error("shopDomain is undefined in getOrCreateShopTier");
    return buildDefaultShop("unknown");
  }

  try {
    let shop = await db.shop.findUnique({
      where: { domain: shopDomain },
    });

    if (!shop) {
      shop = await db.shop.create({
        data: {
          domain: shopDomain,
          tier: "FREE",
          liveDiscountLimit: TIER_CONFIG.FREE.liveDiscountLimit,
          ...(isNewInstall ? { installStatus: "init" } : {}),
        },
      });
    } else if (isNewInstall) {
      shop = await db.shop.update({
        where: { domain: shopDomain },
        data: { installStatus: "init" },
      });
    }

    const enriched = await fetchShopRowById(shop.id, db);
    if (enriched) {
      shop = enriched;
    } else {
      shop = {
        ...shop,
        billingTier: shop.billingTier ?? shop.tier ?? "FREE",
        pendingTier: shop.pendingTier ?? null,
        pendingTierEffectiveAt: shop.pendingTierEffectiveAt ?? null,
        pendingTierSourceSubscriptionId:
          shop.pendingTierSourceSubscriptionId ?? null,
        pendingTierContext: parseContext(shop.pendingTierContext) ?? null,
        trialEndsAt: parseDateValue(shop.trialEndsAt),
        trialRecordedAt: parseDateValue(shop.trialRecordedAt),
        trialSourceSubscriptionId: shop.trialSourceSubscriptionId ?? null,
      };
    }

    shop = await ensureBillingTierSynced(shop, db);
    shop = await applyPendingTierIfDueInternal(shop, db);

    return shop;
  } catch (error) {
    logger.error("Error getting/creating shop tier", {
      err: error, shop: shopDomain,
    });
    return buildDefaultShop(shopDomain);
  }
}

export async function canHaveMoreLiveDiscounts(shopDomain, db) {
  try {
    const shop = await getOrCreateShopTier(shopDomain, db);
    const effectiveTier = getEffectiveTierFromShopRecord(shop);
    await refreshUpgradeRequiredDiscounts(shopDomain, effectiveTier, db);

    const tierConfig = TIER_CONFIG[effectiveTier];

    if (tierConfig.liveDiscountLimit === null) {
      return { canCreate: true, reason: "Unlimited tier" };
    }

    const { liveDiscountCount } = await getLiveDiscountState(
      shopDomain,
      tierConfig,
      db,
    );

    const canCreate = liveDiscountCount < tierConfig.liveDiscountLimit;

    return {
      canCreate,
      reason: canCreate ? "Within limit" : "Tier limit reached",
      currentCount: liveDiscountCount,
      limit: tierConfig.liveDiscountLimit,
      tier: effectiveTier,
    };
  } catch (error) {
    logger.error("Error checking live discount creation", {
      err: error, shop: shopDomain,
    });

    return {
      canCreate: true,
      reason: "Error occurred, defaulting to allow",
      currentCount: 0,
      limit: TIER_CONFIG.FREE.liveDiscountLimit,
      tier: "FREE",
    };
  }
}

export async function getShopTierInfo(shopDomain, db) {
  if (!shopDomain) {
    logger.error("shopDomain is undefined in getShopTierInfo");
    return {
      tier: "FREE",
      tierName: TIER_CONFIG.FREE.name,
      liveDiscountLimit: TIER_CONFIG.FREE.liveDiscountLimit,
      currentLiveDiscounts: 0,
      isUnlimited: false,
    };
  }

  try {
    const shop = await getOrCreateShopTier(shopDomain, db);
    const effectiveTier = getEffectiveTierFromShopRecord(shop);
    const tierConfig = TIER_CONFIG[effectiveTier];

    const { liveDiscountCount, enforcedLimit } = await getLiveDiscountState(
      shopDomain,
      tierConfig,
      db,
      "getShopTierInfo",
    );

    return {
      tier: effectiveTier,
      tierName: tierConfig.name,
      liveDiscountLimit: tierConfig.liveDiscountLimit,
      currentLiveDiscounts: liveDiscountCount,
      price: tierConfig.price,
      features: tierConfig.features,
      isUnlimited: tierConfig.liveDiscountLimit === null,
      usagePercentage: tierConfig.liveDiscountLimit
        ? Math.round((liveDiscountCount / tierConfig.liveDiscountLimit) * 100)
        : 0,
      enforcedLimit,
      billingTier: shop.billingTier || effectiveTier,
      billingCurrentPeriodEnd: shop.billingCurrentPeriodEnd || null,
      pendingTier: shop.pendingTier || null,
      pendingTierEffectiveAt: shop.pendingTierEffectiveAt || null,
    };
  } catch (error) {
    logger.error("Error getting shop tier info", {
      err: error, shop: shopDomain,
    });

    return {
      tier: "FREE",
      tierName: TIER_CONFIG.FREE.name,
      liveDiscountLimit: TIER_CONFIG.FREE.liveDiscountLimit,
      currentLiveDiscounts: 0,
      price: TIER_CONFIG.FREE.price,
      features: TIER_CONFIG.FREE.features,
      isUnlimited: false,
      usagePercentage: 0,
      billingTier: "FREE",
      billingCurrentPeriodEnd: null,
      pendingTier: null,
      pendingTierEffectiveAt: null,
    };
  }
}

export async function updateShopTier(shopDomain, newTier, db, options = {}) {
  const {
    updateBillingTier = false,
    clearPending = true,
  } = options || {};

  try {
    if (!TIER_CONFIG[newTier]) {
      throw new Error(`Invalid tier: ${newTier}`);
    }

    const existing = await db.shop.findUnique({
      where: { domain: shopDomain },
    });

    if (!existing) {
      throw new Error(`Shop not found for tier update: ${shopDomain}`);
    }

    const updateData = {
      tier: newTier,
      liveDiscountLimit: TIER_CONFIG[newTier].liveDiscountLimit,
      billingCurrentPeriodEnd: null,
    };

    if (updateBillingTier) {
      updateData.billingTier = newTier;
    }

    if (clearPending && existing.pendingTier && existing.pendingTier === newTier) {
      updateData.pendingTier = null;
      updateData.pendingTierEffectiveAt = null;
      updateData.pendingTierSourceSubscriptionId = null;
      updateData.pendingTierContext = null;
    }

    let shop = await rawUpdateShopById(existing.id, updateData, db);
    if (!shop) {
      shop = (await fetchShopRowById(existing.id, db)) || {
        ...existing,
        ...updateData,
      };
    }

    return shop;
  } catch (error) {
    logger.error("Error updating shop tier", {
      err: error, shop: shopDomain,
    });
    throw error;
  }
}

export async function scheduleShopTierChange(
  shopDomain,
  targetTier,
  effectiveAt,
  db,
  options = {},
) {
  const {
    billingSubscriptionId = null,
    context,
    shopRecord = null,
    billingTier = targetTier,
  } = options || {};

  if (!TIER_CONFIG[targetTier]) {
    throw new Error(`Invalid target tier for schedule: ${targetTier}`);
  }

  let effectiveDate = normalizeDateInput(effectiveAt);
  if (!effectiveDate && shopRecord?.billingCurrentPeriodEnd) {
    effectiveDate = normalizeDateInput(shopRecord.billingCurrentPeriodEnd);
  }
  const serializedEffective = effectiveDate ? effectiveDate.toISOString() : null;

  let shop = shopRecord;
  if (!shop) {
    shop = await getOrCreateShopTier(shopDomain, db);
  }

  const sanitizedContext =
    context !== undefined
      ? sanitizeContext({
          ...context,
          scheduledEffectiveAt: serializedEffective,
        }) ?? null
      : serializedEffective
        ? { scheduledEffectiveAt: serializedEffective }
        : null;

  const updates = {
    billingTier,
    pendingTier: targetTier,
    pendingTierEffectiveAt: effectiveDate ?? null,
    pendingTierSourceSubscriptionId: billingSubscriptionId ?? null,
    pendingTierContext: sanitizedContext,
    billingCurrentPeriodEnd: effectiveDate ?? null,
  };

  const updated = await rawUpdateShopById(shop.id, updates, db);

  if (!updated) {
    logger.error("Failed to schedule tier change", {
      shop: shopDomain,
    });
    return shop;
  }

  return updated;
}

export async function clearPendingTierChange(shopDomain, db, _options = {}) {
  const shop = await getOrCreateShopTier(shopDomain, db);
  if (!shop?.pendingTier) {
    return shop;
  }

  const updated = await rawUpdateShopById(
    shop.id,
    {
      pendingTier: null,
      pendingTierEffectiveAt: null,
      pendingTierSourceSubscriptionId: null,
      pendingTierContext: null,
      billingTier: shop.tier,
      billingCurrentPeriodEnd: null,
    },
    db,
  );

  if (!updated) {
    logger.error("Failed to clear pending tier", {
      shop: shopDomain,
    });
    return shop;
  }

  return updated;
}
