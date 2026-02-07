import { authenticate, shopifyShopUninstall } from "../shopify.server";
import prisma from "../db.server";
import { createLogger } from "../utils/logger.server.js";

const logger = createLogger("WebhookUninstalled");

export const action = async ({ request }) => {
  const { shop, topic } = await authenticate.webhook(request);
  logger.info("Received app/uninstalled webhook", { shop, topic });

  try {
    await shopifyShopUninstall(prisma, shop);
    logger.info("Shop uninstall completed", { shop });
    return new Response(null, { status: 200 });
  } catch (error) {
    logger.error("Error processing app/uninstalled webhook", { err: error, shop });
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};
