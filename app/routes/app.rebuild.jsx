import { json } from "@remix-run/node";
import { createLogger } from "../utils/logger.server.js";
import prisma from "../db.server.js";

const logger = createLogger("RebuildRoute");

/**
 * Action-only route for re-importing discounts when the initial install fails.
 * Called from the dashboard "Retry import" button.
 */
export const action = async ({ request }) => {
  const { authenticate, shopifyShopReInstall } = await import(
    "../shopify.server"
  );

  const { admin, session } = await authenticate.admin(request);
  const shopDomain = session?.shop;

  logger.info("Rebuild action invoked", { shop: shopDomain });

  try {
    const shop = await prisma.shop.findUnique({
      where: { domain: shopDomain },
      select: { installStatus: true },
    });

    if (shop?.installStatus === "done") {
      return json({ success: true, status: "done" });
    }

    await shopifyShopReInstall(shopDomain, admin);
    return json({ success: true, status: "rebuilt" });
  } catch (error) {
    logger.error("Rebuild failed", { err: error, shop: shopDomain });
    return json({ success: false, error: "Rebuild failed" }, { status: 500 });
  }
};
