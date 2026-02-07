import { TIER_CONFIG } from "../tier-manager.js";
import { createLogger } from "../logger.server.js";
import { normalizeDateInput } from "./context-utils.server.js";
import { fetchShopRowById, rawUpdateShopById } from "./shop-records.server.js";

const logger = createLogger("TierManager");
const TIER_KEYS = Object.keys(TIER_CONFIG);

export async function applyPendingTierIfDueInternal(shop, db) {
  if (!shop?.pendingTier || !shop.pendingTierEffectiveAt) {
    return shop;
  }

  const effectiveAt = normalizeDateInput(shop.pendingTierEffectiveAt);
  if (!effectiveAt) {
    return shop;
  }

  const now = new Date();
  if (effectiveAt.getTime() > now.getTime()) {
    return shop;
  }

  const targetTier = shop.pendingTier;
  if (!TIER_KEYS.includes(targetTier)) {
    logger.warn("Pending tier is invalid, clearing invalid pending tier data", {
      shop: shop.domain, pendingTier: targetTier,
    });
    try {
      await rawUpdateShopById(
        shop.id,
        {
          pendingTier: null,
          pendingTierEffectiveAt: null,
          pendingTierSourceSubscriptionId: null,
          pendingTierContext: null,
        },
        db,
      );
    } catch (clearError) {
      logger.error("Failed to clear invalid pending tier", {
        err: clearError, shop: shop.domain,
      });
    }
    return shop;
  }

  const updatedShop = await rawUpdateShopById(
    shop.id,
    {
      tier: targetTier,
      liveDiscountLimit: TIER_CONFIG[targetTier]?.liveDiscountLimit ?? null,
      billingTier: targetTier,
      billingCurrentPeriodEnd: null,
      pendingTier: null,
      pendingTierEffectiveAt: null,
      pendingTierSourceSubscriptionId: null,
      pendingTierContext: null,
    },
    db,
  );

  if (!updatedShop) {
    logger.error("Raw update failed while applying pending tier", {
      shop: shop.domain,
    });
    return shop;
  }

  return updatedShop;
}

export async function applyPendingTierIfDue(shopDomain, db) {
  if (!shopDomain) {
    return null;
  }
  try {
    const shop = await db.shop.findUnique({
      where: { domain: shopDomain },
    });
    if (!shop) {
      return null;
    }
    const enriched = await fetchShopRowById(shop.id, db);
    const effectiveShop = enriched || shop;
    return applyPendingTierIfDueInternal(effectiveShop, db);
  } catch (error) {
    logger.error("Failed to apply pending tier", {
      err: error, shop: shopDomain,
    });
    return null;
  }
}
