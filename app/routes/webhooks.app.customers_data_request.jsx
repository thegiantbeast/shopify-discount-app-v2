import { authenticate } from "../shopify.server";
import { createLogger } from "../utils/logger.server.js";

const logger = createLogger("WebhookCustomersDataRequest");

export const action = async ({ request }) => {
  const { shop, topic } = await authenticate.webhook(request);
  logger.info("Received customers/data_request webhook — no customer data stored", { shop, topic });
  return new Response(null, { status: 200 });
};
