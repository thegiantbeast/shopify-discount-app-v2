import { authenticate } from "../shopify.server";
import { createLogger } from "../utils/logger.server.js";

const logger = createLogger("WebhookScopesUpdate");

export const action = async ({ request }) => {
  const { shop, topic } = await authenticate.webhook(request);
  logger.info("Received app/scopes_update webhook", { shop, topic });
  return new Response(null, { status: 200 });
};
