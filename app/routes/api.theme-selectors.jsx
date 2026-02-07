import { json } from "@remix-run/node";
import { createLogger } from "../utils/logger.server.js";
import { getCorsHeaders, createCorsPreflightResponse } from "../utils/cors.server.js";
import {
  buildSelectorResponse,
  getCachedThemeSelectors,
  cacheThemeSelectors,
} from "../utils/theme-selectors.server.js";

const logger = createLogger("ApiThemeSelectors");

/**
 * Handles OPTIONS preflight requests
 */
export const action = async ({ request }) => {
  if (request.method === 'OPTIONS') {
    return createCorsPreflightResponse(request, ['GET', 'OPTIONS']);
  }

  const headers = getCorsHeaders(request, ['GET', 'OPTIONS']);
  return new Response('Method not allowed', { status: 405, headers });
};

/**
 * GET /api/theme-selectors
 *
 * Returns theme CSS selectors for the storefront.
 * No authentication required (returns generic CSS data, no shop-specific info).
 * No rate limiting (static data).
 *
 * Query params:
 * - theme: Theme name (e.g., "Dawn")
 * - schemaName: Theme schema name
 * - themeStoreId: Shopify Theme Store ID
 * - themeId: Shopify theme ID (for caching)
 */
export const loader = async ({ request }) => {
  const corsHeaders = getCorsHeaders(request, ['GET', 'OPTIONS']);

  try {
    const url = new URL(request.url);
    const theme = url.searchParams.get('theme');
    const schemaName = url.searchParams.get('schemaName');
    const themeStoreId = url.searchParams.get('themeStoreId');
    const themeId = url.searchParams.get('themeId');

    logger.debug("Theme selector request received", {
      theme,
      schemaName,
      themeStoreId,
      themeId,
    });

    // Try cache first if themeId provided
    if (themeId) {
      const cached = getCachedThemeSelectors(themeId);
      if (cached) {
        const response = {
          ...cached,
          themeId,
          matchedViaThemeId: true,
        };

        logger.debug("Returning cached theme selectors", { themeId });
        return json(response, { headers: corsHeaders });
      }
    }

    // Build response from theme metadata
    const payload = buildSelectorResponse(theme, schemaName, themeStoreId);

    // Cache if themeId provided and not a fallback result
    if (themeId && !payload.usedFallback) {
      cacheThemeSelectors(themeId, payload);
    }

    // Enrich response
    const response = {
      ...payload,
      themeId: themeId || null,
      matchedViaThemeId: false,
    };

    logger.debug("Theme selectors resolved", {
      themeId,
      resolvedTheme: response.resolvedTheme,
      usedFallback: response.usedFallback,
      matchedViaStoreId: response.matchedViaStoreId,
      matchedViaSchema: response.matchedViaSchema,
    });

    return json(response, { headers: corsHeaders });

  } catch (error) {
    logger.error("Error resolving theme selectors", { err: error });

    return json(
      { error: "Unable to resolve selectors" },
      { status: 500, headers: corsHeaders }
    );
  }
};
