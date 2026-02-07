import { createLogger } from "./logger.server.js";

const logger = createLogger("Environment");

const BUILD_ENV_MAP = {
  PROD: "PROD",
  PRODUCTION: "PROD",
  LIVE: "PROD",
  TEST: "TESTING",
  TESTING: "TESTING",
  STAGING: "TESTING",
  QA: "TESTING",
  DEV: "DEV",
  DEVELOPMENT: "DEV",
  LOCAL: "DEV",
};

const DEFAULT_ENV = "DEV";

function normalizeBuildEnv(value) {
  if (!value || typeof value !== "string") return DEFAULT_ENV;
  return BUILD_ENV_MAP[value.trim().toUpperCase()] || DEFAULT_ENV;
}

function deriveBackendEnv(url) {
  if (!url) return DEFAULT_ENV;

  const lower = String(url).toLowerCase();
  if (lower.includes("localhost") || lower.includes("127.") || lower.includes("ngrok")) return "DEV";
  if (lower.includes("test") || lower.includes("staging") || lower.includes("preview")) return "TESTING";
  if (lower.includes("wizardformula") || lower.includes("discountsapp")) return "PROD";

  return DEFAULT_ENV;
}

export function getAppVersionInfo({ shopDomain = null } = {}) {
  const buildEnv = normalizeBuildEnv(process.env.APP_BUILD_ENV);
  const backendUrl = process.env.SHOPIFY_APP_URL || null;
  const backendEnv = deriveBackendEnv(backendUrl);

  const info = {
    METAFIELDS: buildEnv,
    FRONTEND: buildEnv,
    BACKEND: backendEnv,
    BACKEND_URL: backendUrl,
    SHOP: shopDomain,
    EXTENSION: "discounts-display-pro",
    API_VERSION: process.env.SHOPIFY_API_VERSION || "2025-10",
    BUILD_SHA: process.env.APP_BUILD_SHA || process.env.GIT_SHA || null,
    DEPLOYED_AT: process.env.APP_DEPLOYED_AT || null,
  };

  logger.debug("App version info resolved", { backend: backendEnv, build: buildEnv });

  return info;
}
