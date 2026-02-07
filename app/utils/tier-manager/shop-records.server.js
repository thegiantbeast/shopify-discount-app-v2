import { createLogger } from "../logger.server.js";
import {
  parseContext,
  parseDateValue,
  parseNumeric,
  serializeContext,
} from "./context-utils.server.js";

const logger = createLogger("TierManager");

export async function fetchShopRowById(shopId, db) {
  try {
    const rows = await db.$queryRaw`
      SELECT
        "id",
        "domain",
        "tier",
        "liveDiscountLimit",
        "billingTier",
        "pendingTier",
        "pendingTierEffectiveAt",
        "pendingTierSourceSubscriptionId",
        "pendingTierContext",
        "trialEndsAt",
        "trialRecordedAt",
        "trialSourceSubscriptionId",
        "billingCurrentPeriodEnd",
        "createdAt",
        "updatedAt"
      FROM "Shop"
      WHERE "id" = ${shopId}
      LIMIT 1
    `;

    if (Array.isArray(rows) && rows.length > 0) {
      const row = rows[0];
      return {
        id: row.id,
        domain: row.domain,
        tier: row.tier,
        liveDiscountLimit: parseNumeric(row.liveDiscountLimit),
        billingTier: row.billingTier ?? null,
        pendingTier: row.pendingTier ?? null,
        pendingTierEffectiveAt: parseDateValue(row.pendingTierEffectiveAt),
        pendingTierSourceSubscriptionId:
          row.pendingTierSourceSubscriptionId ?? null,
        pendingTierContext: parseContext(row.pendingTierContext),
        trialEndsAt: parseDateValue(row.trialEndsAt),
        trialRecordedAt: parseDateValue(row.trialRecordedAt),
        trialSourceSubscriptionId: row.trialSourceSubscriptionId ?? null,
        billingCurrentPeriodEnd: parseDateValue(row.billingCurrentPeriodEnd),
        createdAt: parseDateValue(row.createdAt) ?? new Date(),
        updatedAt: parseDateValue(row.updatedAt) ?? new Date(),
      };
    }
  } catch (error) {
    logger.error("Failed to fetch raw shop row", {
      err: error, shopId,
    });
  }
  return null;
}

export async function rawUpdateShopById(shopId, updates, db) {
  const assignments = [];
  const params = [];

  const pushAssignment = (clause, value) => {
    assignments.push(clause);
    if (value instanceof Date) {
      params.push(value.toISOString());
    } else {
      params.push(value);
    }
  };

  if (Object.prototype.hasOwnProperty.call(updates, "tier")) {
    pushAssignment('"tier" = ?', updates.tier);
  }

  if (Object.prototype.hasOwnProperty.call(updates, "liveDiscountLimit")) {
    pushAssignment('"liveDiscountLimit" = ?', updates.liveDiscountLimit);
  }

  if (Object.prototype.hasOwnProperty.call(updates, "billingTier")) {
    pushAssignment('"billingTier" = ?', updates.billingTier);
  }

  if (Object.prototype.hasOwnProperty.call(updates, "pendingTier")) {
    pushAssignment('"pendingTier" = ?', updates.pendingTier);
  }

  if (
    Object.prototype.hasOwnProperty.call(updates, "pendingTierEffectiveAt")
  ) {
    const encoded =
      updates.pendingTierEffectiveAt instanceof Date
        ? updates.pendingTierEffectiveAt.toISOString()
        : updates.pendingTierEffectiveAt;
    pushAssignment('"pendingTierEffectiveAt" = ?', encoded);
  }

  if (
    Object.prototype.hasOwnProperty.call(
      updates,
      "pendingTierSourceSubscriptionId",
    )
  ) {
    pushAssignment(
      '"pendingTierSourceSubscriptionId" = ?',
      updates.pendingTierSourceSubscriptionId,
    );
  }

  if (Object.prototype.hasOwnProperty.call(updates, "pendingTierContext")) {
    const contextValue =
      updates.pendingTierContext === undefined
        ? null
        : typeof updates.pendingTierContext === "string"
          ? updates.pendingTierContext
          : serializeContext(updates.pendingTierContext) ?? null;
    pushAssignment('"pendingTierContext" = ?', contextValue);
  }

  if (Object.prototype.hasOwnProperty.call(updates, "trialEndsAt")) {
    const encoded =
      updates.trialEndsAt instanceof Date
        ? updates.trialEndsAt.toISOString()
        : updates.trialEndsAt;
    pushAssignment('"trialEndsAt" = ?', encoded);
  }

  if (Object.prototype.hasOwnProperty.call(updates, "trialRecordedAt")) {
    const encoded =
      updates.trialRecordedAt instanceof Date
        ? updates.trialRecordedAt.toISOString()
        : updates.trialRecordedAt;
    pushAssignment('"trialRecordedAt" = ?', encoded);
  }

  if (Object.prototype.hasOwnProperty.call(updates, "trialSourceSubscriptionId")) {
    pushAssignment('"trialSourceSubscriptionId" = ?', updates.trialSourceSubscriptionId);
  }

  if (
    Object.prototype.hasOwnProperty.call(updates, "billingCurrentPeriodEnd")
  ) {
    const value =
      updates.billingCurrentPeriodEnd instanceof Date
        ? updates.billingCurrentPeriodEnd.toISOString()
        : updates.billingCurrentPeriodEnd;
    pushAssignment('"billingCurrentPeriodEnd" = ?', value);
  }

  if (!assignments.length) {
    return fetchShopRowById(shopId, db);
  }

  const sql = `UPDATE "Shop" SET ${assignments.join(", ")}, "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = ?`;
  params.push(shopId);

  try {
    await db.$executeRawUnsafe(sql, ...params);
  } catch (error) {
    logger.error("Raw update failed for shop", {
      err: error, shopId,
    });
    return null;
  }

  return fetchShopRowById(shopId, db);
}

export async function ensureBillingTierSynced(shop, db) {
  if (!shop) return shop;
  const billingTier =
    typeof shop.billingTier === "string" ? shop.billingTier : null;
  const pendingTier =
    typeof shop.pendingTier === "string" ? shop.pendingTier : null;
  if (!pendingTier && billingTier === (shop.tier || "FREE")) {
    return shop;
  }

  if (pendingTier && billingTier === pendingTier) {
    return shop;
  }

  const fallbackTier = pendingTier || shop.tier || "FREE";
  const updatedShop = await rawUpdateShopById(
    shop.id,
    { billingTier: fallbackTier },
    db,
  );
  if (updatedShop) {
    return updatedShop;
  }

  logger.warn("Falling back without billing tier sync", {
    shop: shop.domain,
  });
  return {
    ...shop,
    billingTier: fallbackTier,
  };
}
