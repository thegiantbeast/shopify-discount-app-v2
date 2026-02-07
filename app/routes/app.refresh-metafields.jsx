import { json } from "@remix-run/node";
import { createLogger } from "../utils/logger.server.js";
import { initProcessMetafields } from "../utils/init-process-metafields.server.js";
import prisma from "../db.server.js";

const logger = createLogger("RefreshMetafields");

const REQUIRED_WEBHOOK_TOPICS = [
  { topic: "APP_UNINSTALLED", uri: "/webhooks/app/uninstalled" },
  { topic: "APP_SCOPES_UPDATE", uri: "/webhooks/app/scopes_update" },
  { topic: "APP_SUBSCRIPTIONS_UPDATE", uri: "/webhooks/app/subscriptions_update" },
  { topic: "DISCOUNTS_CREATE", uri: "/webhooks/app/discounts_create" },
  { topic: "DISCOUNTS_UPDATE", uri: "/webhooks/app/discounts_update" },
  { topic: "DISCOUNTS_DELETE", uri: "/webhooks/app/discounts_delete" },
  { topic: "COLLECTIONS_UPDATE", uri: "/webhooks/app/collections_update" },
  { topic: "COLLECTIONS_DELETE", uri: "/webhooks/app/collections_delete" },
  { topic: "PRODUCTS_UPDATE", uri: "/webhooks/app/products_update" },
  { topic: "PRODUCTS_DELETE", uri: "/webhooks/app/products_delete" },
];

/**
 * Action-only route used during development to update webhook registrations
 * and metafield URLs when the dev tunnel changes.
 */
export const action = async ({ request }) => {
  const { authenticate } = await import("../shopify.server");

  const { admin, session } = await authenticate.admin(request);
  const shopDomain = session?.shop;
  const appUrl = process.env.SHOPIFY_APP_URL;

  logger.info("Refresh metafields invoked", { shop: shopDomain, appUrl });

  try {
    // 1. Update metafields (app_url, log_level, storefront_token)
    await initProcessMetafields(shopDomain, admin, prisma);

    // 2. Query existing webhooks
    const existingResponse = await admin.graphql(`
      query GetWebhookSubscriptions {
        webhookSubscriptions(first: 50) {
          nodes {
            id
            topic
            endpoint {
              ... on WebhookHttpEndpoint {
                callbackUrl
              }
            }
          }
        }
      }
    `);
    const existingData = await existingResponse.json();
    const existingWebhooks =
      existingData.data?.webhookSubscriptions?.nodes || [];

    // 3. Delete webhooks pointing to a different base URL
    let deleted = 0;
    for (const webhook of existingWebhooks) {
      const callbackUrl = webhook.endpoint?.callbackUrl;
      if (callbackUrl && appUrl && !callbackUrl.startsWith(appUrl)) {
        try {
          await admin.graphql(
            `
            mutation WebhookDelete($id: ID!) {
              webhookSubscriptionDelete(id: $id) {
                userErrors { field message }
              }
            }
          `,
            { variables: { id: webhook.id } },
          );
          deleted++;
        } catch (delErr) {
          logger.warn(
            "Failed to delete old webhook",
            { err: delErr, webhookId: webhook.id },
          );
        }
      }
    }

    // 4. Create new webhooks for required topics that don't already exist
    let created = 0;
    let skipped = 0;
    let failed = 0;

    for (const { topic, uri } of REQUIRED_WEBHOOK_TOPICS) {
      const callbackUrl = `${appUrl}${uri}`;
      const exists = existingWebhooks.some(
        (w) => w.topic === topic && w.endpoint?.callbackUrl === callbackUrl,
      );

      if (exists) {
        skipped++;
        continue;
      }

      try {
        const createResponse = await admin.graphql(
          `
          mutation WebhookCreate($topic: WebhookSubscriptionTopic!, $callbackUrl: URL!) {
            webhookSubscriptionCreate(
              topic: $topic
              webhookSubscription: { callbackUrl: $callbackUrl, format: JSON }
            ) {
              webhookSubscription { id }
              userErrors { field message }
            }
          }
        `,
          { variables: { topic, callbackUrl } },
        );
        const createData = await createResponse.json();
        const errors =
          createData.data?.webhookSubscriptionCreate?.userErrors || [];
        if (errors.length > 0) {
          failed++;
          logger.warn("Webhook creation had user errors", { topic, errors });
        } else {
          created++;
        }
      } catch (createErr) {
        failed++;
        logger.warn("Failed to create webhook", { err: createErr, topic });
      }
    }

    // 5. Verify final state
    const verifyResponse = await admin.graphql(`
      query VerifyWebhooks {
        webhookSubscriptions(first: 50) {
          nodes {
            topic
            endpoint {
              ... on WebhookHttpEndpoint {
                callbackUrl
              }
            }
          }
        }
      }
    `);
    const verifyData = await verifyResponse.json();
    const finalWebhooks = verifyData.data?.webhookSubscriptions?.nodes || [];
    const discountWebhooks = finalWebhooks.filter((w) =>
      w.topic.startsWith("DISCOUNTS_"),
    );

    logger.info(
      "Webhook refresh completed",
      {
        shop: shopDomain,
        created,
        skipped,
        deleted,
        failed,
        total: finalWebhooks.length,
      },
    );

    return json({
      success: true,
      created,
      skipped,
      deleted,
      failed,
      totalWebhooks: finalWebhooks.length,
      discountWebhooks: discountWebhooks.length,
    });
  } catch (error) {
    logger.error(
      "Refresh metafields failed",
      { err: error, shop: shopDomain },
    );
    return json({ success: false, error: "Refresh failed" }, { status: 500 });
  }
};
