import { createLogger } from "./logger.server.js";
import { reprocessAllDiscountsForShop } from "./discount-resolver/reprocess.server.js";
import { checkAndCleanupExpiredDiscounts } from "./discount-resolver/cleanup.server.js";

const logger = createLogger("InitDiscounts");

export async function initProcessDiscounts(shopDomain, db, admin) {
  logger.info("Starting initial discount import", { shop: shopDomain });

  try {
    const result = await reprocessAllDiscountsForShop(admin, shopDomain, db);
    logger.info("Initial discount import completed", {
      shop: shopDomain, ...result,
    });

    await checkAndCleanupExpiredDiscounts(shopDomain, db);
  } catch (error) {
    logger.error("Error during initial discount import", {
      err: error, shop: shopDomain,
    });
  }
}
