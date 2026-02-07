import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { createLogger } from "../utils/logger.server.js";

const logger = createLogger("WebhookCollectionsUpdate");

export const action = async ({ request }) => {
  const { shop, topic, payload, admin } = await authenticate.webhook(request);
  logger.info("Received collections/update webhook", { shop, topic });

  const collectionGid = payload?.admin_graphql_api_id;
  if (!collectionGid) {
    logger.warn("Missing admin_graphql_api_id in payload", { shop });
    return new Response(JSON.stringify({ error: "Missing admin_graphql_api_id" }), { status: 422, headers: { "Content-Type": "application/json" } });
  }

  try {
    const { storeCollectionData } = await import("../utils/discount-resolver/store-data.server.js");
    const { reprocessDiscountsForCollection } = await import("../utils/discount-resolver/reprocess.server.js");

    if (admin) {
      await storeCollectionData(admin, collectionGid, shop, prisma, { forceRefresh: true });
      const result = await reprocessDiscountsForCollection(admin, collectionGid, shop, prisma);
      logger.info("Collection update processed", { shop, collectionGid, processed: result.processed });
    } else {
      logger.warn("Admin client unavailable — storing without reprocess", { shop, collectionGid });
    }

    return new Response(null, { status: 200 });
  } catch (error) {
    logger.error("Error processing collections/update webhook", { err: error, shop, collectionGid });
    return new Response(JSON.stringify({ error: "Internal server error" }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
};
