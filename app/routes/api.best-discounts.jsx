import { json } from "@remix-run/node";
import prisma from "../db.server";
import { createLogger } from "../utils/logger.server.js";
import { resolveBestDiscounts } from "../utils/discount-math.server.js";
import { getCorsHeaders, createCorsPreflightResponse } from "../utils/cors.server.js";
import { authenticateStorefrontRequest, isStorefrontAuthEnforced } from "../utils/storefront-auth.server.js";
import { checkRateLimit, getRateLimitHeaders, createRateLimitResponse } from "../utils/rate-limiter.server.js";

const logger = createLogger("ApiBestDiscounts");

export const loader = async ({ request }) => {
  if (request.method === "OPTIONS") {
    return createCorsPreflightResponse(request, ['POST', 'OPTIONS']);
  }
  const headers = getCorsHeaders(request, ['POST', 'OPTIONS']);
  return new Response("Method not allowed", { status: 405, headers });
};

export const action = async ({ request }) => {
  try {
    // CORS headers
    const headers = getCorsHeaders(request, ['POST', 'OPTIONS']);

    // Method check
    if (request.method === "OPTIONS") {
      return createCorsPreflightResponse(request, ['POST', 'OPTIONS']);
    }
    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405, headers });
    }

    // Parse body
    let body;
    try {
      body = await request.json();
    } catch (parseError) {
      logger.error("Failed to parse request body", { err: parseError });
      return json({ error: "Invalid request body" }, { status: 400, headers });
    }

    if (!body || typeof body !== "object") {
      return json({ error: "Invalid request body" }, { status: 400, headers });
    }

    // Destructure — token may come from Authorization header or body (backward compat)
    const { shop, token: bodyToken, requests } = body;
    const token = request.headers.get('Authorization')?.replace('Bearer ', '')
      || bodyToken;

    if (!Array.isArray(requests) || requests.length === 0) {
      return json({ error: "requests must be a non-empty array" }, { status: 400, headers });
    }

    // Rate limiting (if shop provided)
    if (shop) {
      const rateResult = checkRateLimit(shop);
      if (!rateResult.allowed) {
        return createRateLimitResponse(rateResult, headers);
      }
      Object.assign(headers, getRateLimitHeaders(rateResult));
    }

    // Auth (if shop provided)
    if (shop) {
      const isAuthenticated = await authenticateStorefrontRequest(shop, token, prisma);
      if (!isAuthenticated) {
        if (isStorefrontAuthEnforced()) {
          return json({ error: 'Unauthorized' }, { status: 403, headers });
        }
        logger.debug('Unauthenticated best-discounts request (soft mode)', { shop, hasToken: !!token });
      }
    }

    // Process each request entry
    const results = [];
    const errors = [];

    for (const entry of requests) {
      try {
        // Validate entry
        if (!entry || typeof entry !== "object") {
          errors.push({ error: "Invalid request entry" });
          continue;
        }

        const { productId, variantId = null, regularPriceCents, discounts, purchaseContext = null, isSubscription = null } = entry;

        if (!productId) {
          errors.push({ error: "productId is required" });
          continue;
        }
        if (typeof regularPriceCents !== "number" || !Number.isFinite(regularPriceCents)) {
          errors.push({ error: "regularPriceCents must be a finite number", productId });
          continue;
        }
        if (!Array.isArray(discounts)) {
          errors.push({ error: "discounts must be an array", productId });
          continue;
        }

        // Purchase context filtering
        const wantsSubscription = purchaseContext === "subscription" || purchaseContext === "SUBSCRIPTION" || isSubscription === true;
        const wantsOneTime = purchaseContext === "one_time" || purchaseContext === "ONE_TIME";

        const filtered = discounts.filter(d => {
          if (!d || typeof d !== "object") return false;
          if (wantsSubscription) return d.appliesOnSubscription === true;
          if (wantsOneTime) return d.appliesOnOneTimePurchase !== false;
          return true;
        });

        if (filtered.length === 0) {
          results.push({
            productId,
            variantId,
            bestDiscounts: {
              automaticDiscount: null,
              couponDiscount: null,
              automaticEntry: null,
              couponEntry: null,
              basePriceCents: null,
              entryVariantId: null,
            }
          });
          continue;
        }

        // Normalize discounts
        const normalized = filtered.map(d => {
          const type = typeof d.type === "string" ? d.type.toLowerCase() : null;
          const value = typeof d.value === "number" ? d.value : Number(d.value);
          if (!Number.isFinite(value)) return null;
          return { ...d, type, value, isAutomatic: !!d.isAutomatic };
        }).filter(d => d && (d.type === "percentage" || d.type === "fixed"));

        if (normalized.length === 0) {
          errors.push({ error: "No valid discounts after normalization", productId });
          continue;
        }

        // Resolve best discounts
        const resolved = resolveBestDiscounts({
          discounts: normalized,
          regularPriceCents,
          currentVariantId: variantId,
        });

        results.push({
          productId,
          variantId,
          bestDiscounts: {
            ...resolved,
            entryVariantId: variantId,
          },
        });
      } catch (entryError) {
        logger.error("Failed to resolve best discounts for entry", { err: entryError, productId: entry?.productId });
        errors.push({ error: "Failed to resolve best discounts", productId: entry?.productId ?? null });
      }
    }

    // Return response
    const status = results.length > 0 ? 200 : 400;
    logger.debug("Best discount batch processed", { shop: shop || null, requestCount: requests.length, successCount: results.length, errorCount: errors.length });
    return json({ shop: shop || null, results, errors }, { status, headers });

  } catch (error) {
    logger.error("Failed to process best-discounts request", { err: error });
    const headers = getCorsHeaders(request, ['POST', 'OPTIONS']);
    return json({ error: "Unable to resolve discounts" }, { status: 500, headers });
  }
};
