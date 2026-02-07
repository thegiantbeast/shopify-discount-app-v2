import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { createLogger } from "../utils/logger.server.js";

const logger = createLogger("WebhookDiscountsCreate");

export const action = async ({ request }) => {
  const { shop, topic, payload, admin } = await authenticate.webhook(request);
  logger.debug("discounts/create webhook received", { shop, topic });

  if (!payload?.admin_graphql_api_id) {
    logger.warn("Missing admin_graphql_api_id in discounts/create payload", { shop });
    return new Response(JSON.stringify({ error: "Missing admin_graphql_api_id" }), { status: 422, headers: { "Content-Type": "application/json" } });
  }

  if (!admin) {
    logger.error("Admin client unavailable for discounts/create", { shop });
    return new Response(JSON.stringify({ error: "Admin client unavailable" }), { status: 500, headers: { "Content-Type": "application/json" } });
  }

  try {
    const { graphqlQuery } = await import("../utils/discount-resolver/graphql-client.server.js");
    const { GET_DISCOUNT_NODE_QUERY } = await import("../utils/discount-resolver/graphql-queries.server.js");
    const { resolveDiscountTargets } = await import("../utils/discount-resolver/resolve-targets.server.js");
    const { storeDiscountData } = await import("../utils/discount-resolver/discount-storage.server.js");
    const { updateLiveDiscountData } = await import("../utils/discount-resolver/live-discount-updater.server.js");
    const { checkAndCleanupExpiredDiscounts } = await import("../utils/discount-resolver/cleanup.server.js");

    const discountGid = payload.admin_graphql_api_id;
    const result = await graphqlQuery(admin, GET_DISCOUNT_NODE_QUERY, { id: discountGid });

    if (!result.data?.discountNode?.discount) {
      logger.warn("No discount data returned from Shopify", { shop, discountGid });
      return new Response(JSON.stringify({ error: "Discount not found in Shopify" }), { status: 500, headers: { "Content-Type": "application/json" } });
    }

    const discountData = result.data.discountNode.discount;

    const resolved = await resolveDiscountTargets(admin, discountData, shop, prisma);
    const resolvedTargets = resolved || { productIds: [], variantIds: [] };

    await storeDiscountData(discountGid, discountData, resolvedTargets, shop, prisma);
    await updateLiveDiscountData(discountGid, discountData, shop, prisma, { preserveExistingStatus: true });
    await checkAndCleanupExpiredDiscounts(shop, prisma);

    logger.info("discounts/create processed successfully", { shop, discountGid });
    return new Response(null, { status: 200 });
  } catch (error) {
    logger.error("Error processing discounts/create webhook", { err: error, shop });
    return new Response(JSON.stringify({ error: "Internal server error" }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
};
