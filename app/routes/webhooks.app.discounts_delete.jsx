import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { createLogger } from "../utils/logger.server.js";

const logger = createLogger("WebhookDiscountsDelete");

export const action = async ({ request }) => {
  const { shop, topic, payload } = await authenticate.webhook(request);
  logger.debug("discounts/delete webhook received", { shop, topic });

  if (!payload?.admin_graphql_api_id) {
    logger.warn("Missing admin_graphql_api_id in discounts/delete payload", { shop });
    return new Response(JSON.stringify({ error: "Missing admin_graphql_api_id" }), { status: 422, headers: { "Content-Type": "application/json" } });
  }

  try {
    const { checkAndCleanupExpiredDiscounts } = await import("../utils/discount-resolver/cleanup.server.js");

    const discountGid = payload.admin_graphql_api_id;

    const [deleted, deletedLive] = await prisma.$transaction([
      prisma.discount.deleteMany({ where: { gid: discountGid, shop } }),
      prisma.liveDiscount.deleteMany({ where: { gid: discountGid, shop } }),
    ]);

    logger.info("discounts/delete processed", {
      shop, discountGid, deletedDiscount: deleted.count, deletedLive: deletedLive.count,
    });

    await checkAndCleanupExpiredDiscounts(shop, prisma);
    return new Response(null, { status: 200 });
  } catch (error) {
    logger.error("Error processing discounts/delete webhook", { err: error, shop });
    return new Response(JSON.stringify({ error: "Internal server error" }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
};
