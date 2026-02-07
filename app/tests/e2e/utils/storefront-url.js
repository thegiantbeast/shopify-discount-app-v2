/**
 * Storefront URL builder with optional theme preview support.
 */

const DEFAULT_STOREFRONT_URL = "https://wizardformula-2.myshopify.com";

function normalizeBaseUrl(baseUrl) {
  return baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
}

/**
 * Builds a storefront URL, optionally with a theme preview ID.
 * @param {string} [pathOrUrl='/']
 * @returns {string}
 */
export function buildStorefrontUrl(pathOrUrl = "/") {
  const baseUrl = normalizeBaseUrl(
    process.env.STOREFRONT_URL || DEFAULT_STOREFRONT_URL,
  );
  const previewThemeId = process.env.STOREFRONT_PREVIEW_THEME_ID;

  const url = pathOrUrl.startsWith("http")
    ? new URL(pathOrUrl)
    : new URL(
        pathOrUrl.startsWith("/")
          ? `${baseUrl}${pathOrUrl}`
          : `${baseUrl}/${pathOrUrl}`,
      );

  if (previewThemeId) {
    url.searchParams.set("preview_theme_id", previewThemeId);
  }

  return url.toString();
}
