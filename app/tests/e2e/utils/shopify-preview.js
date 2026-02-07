/**
 * Shopify admin and preview URL builders.
 * Uses SHOPIFY_SHOP_DOMAIN env var (v2 convention).
 */
import { readFileSync } from "fs";
import path from "path";

let cachedClientId = null;

function resolveClientId() {
  if (process.env.SHOPIFY_CLIENT_ID) {
    return process.env.SHOPIFY_CLIENT_ID;
  }

  if (cachedClientId) {
    return cachedClientId;
  }

  const tomlPath = path.join(process.cwd(), "shopify.app.toml");
  const rawToml = readFileSync(tomlPath, "utf8");
  const match = rawToml.match(/client_id\s*=\s*"([^"]+)"/);

  if (!match) {
    throw new Error(
      "Unable to resolve Shopify client_id. Set SHOPIFY_CLIENT_ID or ensure shopify.app.toml contains client_id.",
    );
  }

  cachedClientId = match[1];
  return cachedClientId;
}

/**
 * Builds the Shopify CLI OAuth redirect URL for admin access.
 * @returns {string}
 */
export function buildPreviewUrl() {
  const store = process.env.SHOPIFY_SHOP_DOMAIN;
  if (!store) {
    throw new Error(
      "SHOPIFY_SHOP_DOMAIN environment variable is required to build the preview URL.",
    );
  }

  const clientId = resolveClientId();
  // Strip protocol and trailing slashes if present
  const domain = store.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  // Ensure .myshopify.com suffix
  const fullDomain = domain.includes(".myshopify.com")
    ? domain
    : `${domain}.myshopify.com`;
  return `https://${fullDomain}/admin/oauth/redirect_from_cli?client_id=${clientId}`;
}

/**
 * Builds a Shopify admin URL.
 * @param {string} [adminPath='/']
 * @returns {string}
 */
export function buildAdminUrl(adminPath = "/") {
  const store = process.env.SHOPIFY_SHOP_DOMAIN;
  if (!store) {
    throw new Error(
      "SHOPIFY_SHOP_DOMAIN environment variable is required to build admin URLs.",
    );
  }

  // Extract store handle from domain
  const domain = store.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  const handle = domain.replace(/\.myshopify\.com$/, "");
  const normalized = adminPath.startsWith("/") ? adminPath : `/${adminPath}`;
  return `https://admin.shopify.com/store/${handle}${normalized}`;
}
