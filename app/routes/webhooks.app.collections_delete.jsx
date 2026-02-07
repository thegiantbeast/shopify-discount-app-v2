import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { createLogger } from "../utils/logger.server.js";

const logger = createLogger("WebhookCollectionsDelete");

export const action = async ({ request }) => {
  const { shop, topic, payload, admin } = await authenticate.webhook(request);
  logger.info("Received collections/delete webhook", { shop, topic });

  const collectionGid = payload?.admin_graphql_api_id;
  if (!collectionGid) {
    logger.warn("Missing admin_graphql_api_id in payload", { shop });
    return new Response(JSON.stringify({ error: "Missing admin_graphql_api_id" }), { status: 422, headers: { "Content-Type": "application/json" } });
  }

  try {
    // Reprocess affected discounts BEFORE deleting the collection
    if (admin) {
      const { reprocessDiscountsForCollection } = await import("../utils/discount-resolver/reprocess.server.js");
      const result = await reprocessDiscountsForCollection(admin, collectionGid, shop, prisma);
      logger.info("Reprocessed affected discounts", { shop, collectionGid, processed: result.processed });
    }

    // Delete collection from local DB
    const deleted = await prisma.collection.deleteMany({
      where: { gid: collectionGid, shop },
    });

    logger.info("Collection delete processed", {
      shop, collectionGid, deletedCount: deleted.count,
    });

    return new Response(null, { status: 200 });
  } catch (error) {
    logger.error("Error processing collections/delete webhook", { err: error, shop, collectionGid });
    return new Response(JSON.stringify({ error: "Internal server error" }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
};
