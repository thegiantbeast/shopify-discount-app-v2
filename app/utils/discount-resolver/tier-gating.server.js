import { getOrCreateShopTier, getEffectiveTierFromShopRecord } from "../tier-manager.server.js";
import { ensureArray } from "./utils.server.js";

/**
 * Evaluate tier-based feature gating for a discount.
 * Returns tier info and feature flags.
 */
export async function evaluateTierGating(discountData, shop, db) {
  const shopTier = await getOrCreateShopTier(shop, db);
  const tier = getEffectiveTierFromShopRecord(shopTier);
  const isAdvanced = tier === "ADVANCED";
  const isBasicOrHigher = tier !== "FREE";

  const items = discountData.customerGets?.items;
  const itemsArray = ensureArray(items);
  const hasVariantTargets = itemsArray.some(
    (i) =>
      i &&
      i.productVariants &&
      i.productVariants.nodes &&
      i.productVariants.nodes.length > 0,
  );

  const appliesOnSubscription = !!discountData.customerGets?.appliesOnSubscription;

  return { tier, isAdvanced, isBasicOrHigher, hasVariantTargets, appliesOnSubscription };
}
