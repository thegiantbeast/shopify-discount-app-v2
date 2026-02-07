import { createLogger } from "../logger.server.js";

const logger = createLogger("Cleanup");

/**
 * Find and remove expired discounts from both Discount and LiveDiscount tables.
 * Shop-scoped operation — only cleans up discounts for the specified shop.
 */
export async function checkAndCleanupExpiredDiscounts(shop, db) {
  try {
    const now = new Date();

    const [expiredDiscounts, expiredLiveDiscounts] = await Promise.all([
      db.discount.findMany({
        where: {
          shop,
          endsAt: { not: null, lt: now },
        },
        select: { gid: true },
      }),
      db.liveDiscount.findMany({
        where: {
          shop,
          endsAt: { not: null, lt: now },
        },
        select: { gid: true },
      }),
    ]);

    const expiredGids = Array.from(
      new Set([
        ...expiredDiscounts.map((d) => d.gid),
        ...expiredLiveDiscounts.map((d) => d.gid),
      ]),
    );

    if (expiredGids.length === 0) {
      return { cleaned: 0, total: 0 };
    }

    const [deletedDiscounts, deletedLiveDiscounts] = await Promise.all([
      db.discount.deleteMany({
        where: { gid: { in: expiredGids }, shop },
      }),
      db.liveDiscount.deleteMany({
        where: { gid: { in: expiredGids }, shop },
      }),
    ]);

    const cleanedCount =
      (deletedDiscounts?.count || 0) + (deletedLiveDiscounts?.count || 0);

    logger.info(
      "Cleaned up expired discount records",
      { shop, cleaned: cleanedCount, total: expiredGids.length }
    );

    return { cleaned: cleanedCount, total: expiredGids.length };
  } catch (error) {
    logger.error(
      "Error checking for expired discounts",
      { err: error, shop },
    );
    return { cleaned: 0, total: 0 };
  }
}
