import { createLogger } from "../logger.server.js";

const logger = createLogger("DiscountResolver");

export function parseGid(gid) {
  if (!gid || typeof gid !== "string") return null;
  const match = gid.match(/gid:\/\/shopify\/([^/]+)\/(\d+)/);
  if (!match) return null;
  return { type: match[1], id: match[2], fullGid: gid };
}

export function getDiscountClassValue(discountData) {
  if (!discountData) return null;
  if (typeof discountData.discountClass === "string" && discountData.discountClass) {
    return discountData.discountClass;
  }
  if (Array.isArray(discountData.discountClasses) && discountData.discountClasses.length > 0) {
    const first = discountData.discountClasses[0];
    if (typeof first === "string" && first) return first;
  }
  return null;
}

export function ensureArray(value) {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined) return [];
  return [value];
}

export function isProductDiscount(discountData) {
  const discountClass = getDiscountClassValue(discountData);
  return typeof discountClass === "string" && discountClass.toUpperCase() === "PRODUCT";
}

export function isAllCustomersSelection(selection) {
  const selectionType =
    selection && typeof selection.__typename === "string"
      ? selection.__typename.toLowerCase()
      : null;
  return !selectionType || selectionType.includes("all");
}

export function safeJsonParse(value, fallback = []) {
  try {
    return JSON.parse(value || "[]");
  } catch (error) {
    logger.error("Failed to parse JSON payload", { err: error });
    return fallback;
  }
}

/**
 * Look up the Shop's database ID from its domain string.
 * Required because all child tables use shopId FK (not domain).
 */
export async function getShopIdByDomain(shop, db) {
  const shopRecord = await db.shop.findUnique({
    where: { domain: shop },
    select: { id: true },
  });
  return shopRecord?.id ?? null;
}
