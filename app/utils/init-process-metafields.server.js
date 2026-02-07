import { createLogger } from "./logger.server.js";
import {
  generateStorefrontToken,
  clearTokenCache,
} from "./storefront-auth.server.js";

const logger = createLogger("InitMetafields");

/**
 * Provisions shop-level Shopify metafields that the theme extension reads
 * via Liquid to configure itself (API base URL, log level, auth token).
 *
 * Called during shop install (afterAuth hook) and via the refresh-metafields
 * dev route when the tunnel URL changes.
 */
export async function initProcessMetafields(shopDomain, admin, db) {
  const appUrl = process.env.SHOPIFY_APP_URL;
  const appLogLevel = process.env.LOG_LEVEL || "info";

  const metafieldsToSet = [
    {
      namespace: "discount_app",
      key: "app_url",
      type: "single_line_text_field",
      value: appUrl,
    },
    {
      namespace: "discount_app",
      key: "log_level",
      type: "single_line_text_field",
      value: appLogLevel,
    },
  ];

  // Generate or retrieve the per-shop storefront auth token
  let storefrontToken;
  try {
    if (db) {
      const shopRecord = await db.shop.findUnique({
        where: { domain: shopDomain },
        select: { storefrontToken: true },
      });
      storefrontToken = shopRecord?.storefrontToken;
    }

    if (!storefrontToken) {
      storefrontToken = generateStorefrontToken();
      if (db) {
        await db.shop.updateMany({
          where: { domain: shopDomain },
          data: { storefrontToken },
        });
        clearTokenCache(shopDomain);
      }
    }

    metafieldsToSet.push({
      namespace: "discount_app",
      key: "storefront_token",
      type: "single_line_text_field",
      value: storefrontToken,
    });
  } catch (tokenError) {
    logger.error("Error generating storefront token", {
      err: tokenError,
      shop: shopDomain,
    });
  }

  // Fetch the shop's GID (required as ownerId for metafieldsSet)
  const shopResponse = await admin.graphql(`
    query {
      shop {
        id
      }
    }
  `);
  const shopData = await shopResponse.json();

  if (shopData.errors) {
    logger.error("Shop query returned errors", {
      errors: shopData.errors,
      shop: shopDomain,
    });
    return;
  }

  const shopGid = shopData.data.shop.id;

  // Write all metafields to Shopify
  const response = await admin.graphql(
    `
    mutation setShopMetafields($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        userErrors {
          field
          message
        }
      }
    }
  `,
    {
      variables: {
        metafields: metafieldsToSet.map((mf) => ({ ...mf, ownerId: shopGid })),
      },
    },
  );

  const responseData = await response.json();

  if (responseData.data?.metafieldsSet?.userErrors?.length > 0) {
    logger.error("Metafield mutation returned user errors", {
      userErrors: responseData.data.metafieldsSet.userErrors,
      shop: shopDomain,
    });
  }

  if (responseData.errors) {
    logger.error("Metafield mutation returned errors", {
      errors: responseData.errors,
      shop: shopDomain,
    });
  }

  logger.info("Updated shop metafields", {
    shop: shopDomain,
    metafields: metafieldsToSet.map(({ key, value }) => ({
      key,
      value: key === "storefront_token" ? "[REDACTED]" : value,
    })),
  });
}
