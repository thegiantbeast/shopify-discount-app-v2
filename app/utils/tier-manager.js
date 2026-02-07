// Shared tier metadata and browser-safe helpers
// This file is imported by both client and server code — no Node.js imports

export const TIER_CONFIG = {
  FREE: {
    name: "Free",
    liveDiscountLimit: 1,
    price: 0,
    features: [
      { text: "1 active discount", bold: false },
      { text: "Automatic and code discounts", bold: false },
      { text: "Product page, grids and collections", bold: false },
      { text: "Customizable UI", bold: false },
      { text: "Updated price in cart and checkout", bold: false },
      { text: "Integrated with Shopify's native discount system", bold: false },
    ],
  },
  BASIC: {
    name: "Basic",
    liveDiscountLimit: 3,
    price: 9.99,
    features: [
      { text: "3 live discounts", bold: false },
      { text: "All features of the Free tier", bold: false },
      { text: "Auto-apply coupon option", bold: true },
      { text: "Fixed-price discount support", bold: true },
    ],
  },
  ADVANCED: {
    name: "Advanced",
    liveDiscountLimit: null, // unlimited
    price: 19.99,
    features: [
      { text: "Unlimited live discounts", bold: false },
      { text: "All features of the Basic tier", bold: false },
      { text: "Subscription product compatibility", bold: true },
      { text: "Variant-specific discount support", bold: true },
    ],
  },
};

export const TIER_KEYS = Object.keys(TIER_CONFIG);

const FEATURE_TIERS = {
  fixedAmount: "BASIC",
  autoApply: "BASIC",
  subscription: "ADVANCED",
  variantSpecific: "ADVANCED",
};

export function getTierPrice(tier) {
  return TIER_CONFIG[tier]?.price ?? 0;
}

export function getAvailableTiers() {
  return Object.entries(TIER_CONFIG).map(([key, config]) => ({
    key,
    name: config.name,
    price: config.price,
    liveDiscountLimit: config.liveDiscountLimit,
    features: config.features,
    isUnlimited: config.liveDiscountLimit === null,
  }));
}

export function getEffectiveTierFromShopRecord(shop) {
  const tier = shop?.tier;
  if (typeof tier === "string" && TIER_KEYS.includes(tier)) return tier;
  return "FREE";
}

export function isFeatureEnabled(tier, feature) {
  const tierIndex = TIER_KEYS.indexOf(tier);
  if (tierIndex === -1) return false;

  const requiredTier = FEATURE_TIERS[feature];
  if (!requiredTier) return false;

  return tierIndex >= TIER_KEYS.indexOf(requiredTier);
}

export function getLiveDiscountLimit(tier) {
  if (!TIER_CONFIG[tier]) return TIER_CONFIG.FREE.liveDiscountLimit;
  return TIER_CONFIG[tier].liveDiscountLimit;
}
