import { TIER_CONFIG } from "../tier-manager.js";

export function buildDefaultShop(domain = "unknown") {
  return {
    id: "default",
    domain,
    tier: "FREE",
    liveDiscountLimit: TIER_CONFIG.FREE.liveDiscountLimit,
    billingTier: "FREE",
    billingCurrentPeriodEnd: null,
    pendingTier: null,
    pendingTierEffectiveAt: null,
    pendingTierSourceSubscriptionId: null,
    pendingTierContext: null,
    trialEndsAt: null,
    trialRecordedAt: null,
    trialSourceSubscriptionId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}
