import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { createLogger } from "../utils/logger.server.js";

const logger = createLogger("WebhookShopRedact");

export const action = async ({ request }) => {
  const { shop, topic } = await authenticate.webhook(request);
  logger.info("Received shop/redact webhook", { shop, topic });

  try {
    // Safety net — data should already be cleaned by app/uninstalled.
    // Delete any remaining shop-scoped data.
    const deleted = await prisma.$transaction([
      prisma.liveDiscount.deleteMany({ where: { shop } }),
      prisma.discount.deleteMany({ where: { shop } }),
      prisma.product.deleteMany({ where: { shop } }),
      prisma.collection.deleteMany({ where: { shop } }),
      prisma.setupTask.deleteMany({ where: { shop } }),
      prisma.session.deleteMany({ where: { shop } }),
    ]);

    logger.info("Shop redact completed", { shop, results: deleted.map((r) => r.count) });
    return new Response(null, { status: 200 });
  } catch (error) {
    logger.error("Error processing shop/redact webhook", { err: error, shop });
    return new Response(JSON.stringify({ error: "Internal server error" }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
};
