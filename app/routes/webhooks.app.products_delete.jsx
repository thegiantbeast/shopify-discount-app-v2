import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { createLogger } from "../utils/logger.server.js";

const logger = createLogger("WebhookProductsDelete");

export const action = async ({ request }) => {
  const { shop, topic, payload, admin } = await authenticate.webhook(request);
  logger.info("Received products/delete webhook", { shop, topic });

  const productGid = payload?.admin_graphql_api_id;
  if (!productGid) {
    logger.warn("Missing admin_graphql_api_id in payload", { shop });
    return new Response(JSON.stringify({ error: "Missing admin_graphql_api_id" }), { status: 422, headers: { "Content-Type": "application/json" } });
  }

  try {
    // Reprocess affected discounts BEFORE deleting the product
    if (admin) {
      const { reprocessDiscountsForProduct } = await import("../utils/discount-resolver/reprocess.server.js");
      const result = await reprocessDiscountsForProduct(admin, productGid, shop, prisma);
      logger.info("Reprocessed affected discounts", { shop, productGid, processed: result.processed });
    }

    // Delete product from local DB
    const deleted = await prisma.product.deleteMany({
      where: { gid: productGid, shop },
    });

    logger.info("Product delete processed", {
      shop, productGid, deletedCount: deleted.count,
    });

    return new Response(null, { status: 200 });
  } catch (error) {
    logger.error("Error processing products/delete webhook", { err: error, shop, productGid });
    return new Response(JSON.stringify({ error: "Internal server error" }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
};
