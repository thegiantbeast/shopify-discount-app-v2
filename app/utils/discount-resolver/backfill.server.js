import { createLogger } from "../logger.server.js";
import { updateLiveDiscountData } from "./live-discount-updater.server.js";

const logger = createLogger("Backfill");

/**
 * Self-healing module for LiveDiscount data consistency.
 *
 * The app maintains two tables for discounts:
 *   - `Discount` — the full record synced from Shopify's Admin API (source of truth)
 *   - `LiveDiscount` — a denormalized, storefront-optimized view used by the API
 *     endpoints (/api/discounts, /api/best-discounts) to serve the theme extension
 *
 * Normally both tables are updated together during sync or webhook processing.
 * However, a LiveDiscount row can go missing if a webhook was partially processed,
 * the server crashed mid-sync, or the app was updated and reprocessing didn't cover
 * every record. When that happens, the storefront silently stops showing badges for
 * those discounts.
 *
 * This module detects the gap (Discount exists but LiveDiscount doesn't) and
 * reconstructs the missing LiveDiscount from the stored Discount fields — no
 * Shopify API call needed.
 */

/**
 * Converts a stored Discount DB record into the discountData shape that
 * `updateLiveDiscountData` expects (mimics the structure returned by the
 * Shopify GraphQL fetchers). Only product/variant GIDs are included as a
 * signal that targets exist — full target resolution is not needed here
 * because the LiveDiscount updater only checks for their presence.
 */
function buildDiscountDataFromStoredDiscount(discount) {
  const items = [];
  const hasProducts = discount.products?.length > 0;
  const hasVariants = discount.variants?.length > 0;

  if (hasProducts || hasVariants) {
    const item = {};
    if (hasProducts) {
      item.products = { nodes: [{ id: discount.products[0].productGid }] };
    }
    if (hasVariants) {
      item.productVariants = { nodes: [{ id: discount.variants[0].variantGid }] };
    }
    items.push(item);
  }

  let value = null;
  if (discount.valueType === "AMOUNT" && discount.amount !== null) {
    value = {
      amount: {
        amount: String(discount.amount),
        currencyCode: discount.currencyCode || "USD",
      },
    };
  } else if (discount.valueType === "PERCENTAGE" && discount.percentage !== null) {
    value = { percentage: discount.percentage };
  }

  return {
    title: discount.title,
    status: discount.status,
    startsAt: discount.startsAt,
    endsAt: discount.endsAt,
    summary: discount.summary,
    discountClass: discount.discountClass,
    context: {
      __typename: discount.customerSelectionAll
        ? "DiscountBuyerSelectionAll"
        : "DiscountCustomerSegments",
    },
    minimumRequirement: discount.minimumRequirement,
    customerGets: {
      appliesOnOneTimePurchase: Boolean(discount.appliesOnOneTimePurchase),
      appliesOnSubscription: Boolean(discount.appliesOnSubscription),
      items,
      ...(value ? { value } : {}),
    },
  };
}

/**
 * Finds Discount records that have no corresponding LiveDiscount row and
 * backfills the missing LiveDiscount entries from the stored Discount data.
 *
 * Called during shop install and periodic reprocessing as a safety net to
 * guarantee every Discount is represented in the storefront-facing table.
 *
 * @returns {{ backfilled: number }} Count of LiveDiscount rows created.
 */
export async function ensureLiveDiscountsForShop(shop, db) {
  const liveDiscounts = await db.liveDiscount.findMany({
    where: { shop },
    select: { gid: true },
  });
  const liveGids = liveDiscounts.map((d) => d.gid);

  const missingLiveDiscounts = await db.discount.findMany({
    where: {
      shop,
      ...(liveGids.length > 0 ? { gid: { notIn: liveGids } } : {}),
    },
    include: {
      products: { take: 1 },
      variants: { take: 1 },
    },
  });

  if (missingLiveDiscounts.length === 0) {
    return { backfilled: 0 };
  }

  let backfilled = 0;

  for (const storedDiscount of missingLiveDiscounts) {
    try {
      const fallbackData = buildDiscountDataFromStoredDiscount(storedDiscount);
      const updated = await updateLiveDiscountData(
        storedDiscount.gid,
        fallbackData,
        shop,
        db,
        { preserveExistingStatus: true },
      );
      if (updated) backfilled++;
    } catch (error) {
      logger.error(
        "Failed to backfill live discount",
        { err: error, discountGid: storedDiscount.gid },
      );
    }
  }

  logger.debug(
    "Backfill completed",
    { shop, backfilled, total: missingLiveDiscounts.length },
  );

  return { backfilled };
}
