import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { createLogger } from "../utils/logger.server.js";

const logger = createLogger("WebhookProductsUpdate");

export const action = async ({ request }) => {
  const { shop, topic, payload, admin } = await authenticate.webhook(request);
  logger.info("Received products/update webhook", { shop, topic });

  const productGid = payload?.admin_graphql_api_id;
  if (!productGid) {
    logger.warn("Missing admin_graphql_api_id in payload", { shop });
    return new Response(JSON.stringify({ error: "Missing admin_graphql_api_id" }), { status: 422, headers: { "Content-Type": "application/json" } });
  }

  try {
    if (admin) {
      const { storeProductData } = await import("../utils/discount-resolver/store-data.server.js");
      await storeProductData(admin, productGid, shop, prisma, { forceRefresh: true });
      logger.info("Product data updated in local cache", { shop, productGid });
    } else {
      logger.warn("Admin client unavailable for product update", { shop, productGid });
    }

    // Note: Discount reprocessing for product updates is intentionally disabled.
    // Product updates are too frequent (price changes, inventory, etc.) and
    // re-resolving discounts would cause excessive API calls.
    // The stored product data (variants, singlePrice) is sufficient.

    return new Response(null, { status: 200 });
  } catch (error) {
    logger.error("Error processing products/update webhook", { err: error, shop, productGid });
    return new Response(JSON.stringify({ error: "Internal server error" }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
};
