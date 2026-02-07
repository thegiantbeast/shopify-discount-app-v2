import "@shopify/shopify-app-remix/adapters/node";
import {
  AppDistribution,
  LogSeverity,
  shopifyApp,
} from "@shopify/shopify-app-remix/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "./db.server";
import { createLogger } from "./utils/logger.server.js";
import { getOrCreateShopTier } from "./utils/tier-manager.server";
import { initProcessMetafields } from "./utils/init-process-metafields.server";
import { initProcessDiscounts } from "./utils/init-process-discounts.server";
import { TIER_CONFIG } from "./utils/tier-manager.js";

const logger = createLogger("ShopifyConfig");

const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION || "2025-10";

export const USE_TEST_BILLING =
  process.env.SHOPIFY_BILLING_USE_TEST !== "false";

const normalizePlanNameKey = (value) =>
  typeof value === "string" ? value.trim().toUpperCase() : "";

const VALID_TIERS = new Set(Object.keys(TIER_CONFIG));

export const resolveTierFromPlanName = (planName, planHandle = null) => {
  const candidates = [planHandle, planName].filter(
    (value) => typeof value === "string" && value.trim().length > 0,
  );

  for (const candidate of candidates) {
    const normalized = normalizePlanNameKey(candidate);
    if (normalized && VALID_TIERS.has(normalized)) {
      return normalized;
    }
  }

  return null;
};

export function buildPlanSelectionUrl(shopDomain) {
  const appSlug = process.env.SHOPIFY_MANAGED_PRICING_HANDLE;
  if (!shopDomain || !appSlug) {
    if (!appSlug) {
      logger.warn(
        "Cannot build plan selection URL without SHOPIFY_MANAGED_PRICING_HANDLE",
        { shopDomain },
      );
    }
    return null;
  }
  const normalizedDomain =
    typeof shopDomain === "string" ? shopDomain.trim() : "";
  if (!normalizedDomain) {
    return null;
  }
  const storeHandle = normalizedDomain.replace(".myshopify.com", "");
  if (!storeHandle) {
    return null;
  }
  return `https://admin.shopify.com/store/${storeHandle}/charges/${appSlug}/pricing_plans`;
}

const noisyPrefixes = [
  "Authenticating admin request",
  "Authenticating webhook request",
  "No valid session found",
  "Requesting offline access token",
  "Creating new session",
];

const shopifyLogHandler = (severity, message) => {
  if (
    typeof message === "string" &&
    noisyPrefixes.some((prefix) => message.startsWith(prefix))
  ) {
    return;
  }

  switch (severity) {
    case LogSeverity.Debug:
      logger.debug(message);
      break;
    case LogSeverity.Info:
      logger.info(message);
      break;
    case LogSeverity.Warning:
      logger.warn(message);
      break;
    case LogSeverity.Error:
    default:
      logger.error(message);
      break;
  }
};

export const shopifyShopInstall = async (context, shopDomain, db, admin) => {
  try {
    await getOrCreateShopTier(shopDomain, db, true);
    await initProcessMetafields(shopDomain, admin, db);
    await initProcessDiscounts(shopDomain, db, admin);

    await db.shop.updateMany({
      where: { domain: shopDomain },
      data: { installStatus: "done" },
    });
  } catch (error) {
    logger.error("Error during shop install", { err: error, context, shop: shopDomain });
    await db.shop.updateMany({
      where: { domain: shopDomain },
      data: { installStatus: "failed" },
    });
  }
};

export const shopifyShopUninstall = async (db, shop) => {
  logger.debug("Starting shop uninstall", { shop });

  try {
    return await db.$transaction([
      db.session.deleteMany({ where: { shop } }),
      db.liveDiscount.deleteMany({ where: { shop } }),
      db.discount.deleteMany({ where: { shop } }),
      db.product.deleteMany({ where: { shop } }),
      db.collection.deleteMany({ where: { shop } }),
      db.setupTask.deleteMany({ where: { shop } }),
      db.shop.updateMany({
        where: { domain: shop },
        data: {
          tier: "FREE",
          liveDiscountLimit: TIER_CONFIG.FREE.liveDiscountLimit,
          installStatus: null,
        },
      }),
    ]);
  } catch (error) {
    logger.error("Failed to uninstall shop", { err: error, shop });
    throw error;
  }
};

export const shopifyShopReInstall = async (shopDomain, admin) => {
  await shopifyShopUninstall(prisma, shopDomain);
  await shopifyShopInstall("reInstall", shopDomain, prisma, admin);
};

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  apiVersion: SHOPIFY_API_VERSION,
  scopes: process.env.SCOPES?.split(","),
  appUrl: process.env.SHOPIFY_APP_URL || "",
  authPathPrefix: "/auth",
  sessionStorage: new PrismaSessionStorage(prisma),
  distribution: AppDistribution.AppStore,
  future: {
    unstable_newEmbeddedAuthStrategy: true,
    removeRest: true,
    unstable_managedPricingSupport: true,
  },
  logger: {
    log: shopifyLogHandler,
  },
  hooks: {
    afterAuth: async ({ session, admin }) => {
      const shopDomain = session?.shop;
      await shopifyShopInstall("afterAuth", shopDomain, prisma, admin);
    },
  },
  ...(process.env.SHOP_CUSTOM_DOMAIN
    ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
    : {}),
});

export default shopify;
export const authenticate = shopify.authenticate;
export const apiVersion = SHOPIFY_API_VERSION;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;
