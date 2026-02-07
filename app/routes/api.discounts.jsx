import { json } from "@remix-run/node";
import prisma from "../db.server";
import { createLogger } from "../utils/logger.server.js";
import { getShopTierInfo } from "../utils/tier-manager.server.js";
import { getCorsHeaders, createCorsPreflightResponse } from "../utils/cors.server.js";
import { authenticateStorefrontRequest, isStorefrontAuthEnforced } from "../utils/storefront-auth.server.js";
import { checkRateLimit, getRateLimitHeaders, createRateLimitResponse } from "../utils/rate-limiter.server.js";

const logger = createLogger("ApiDiscounts");

/**
 * Extracts numeric ID from Shopify GID.
 * @param {string} gid - Shopify GID (e.g., "gid://shopify/Product/12345")
 * @returns {string|null} Numeric ID or null
 */
function extractNumericId(gid) {
  if (!gid || typeof gid !== 'string') return null;
  const match = gid.match(/\/(\d+)$/);
  return match ? match[1] : null;
}

/**
 * Validates that a discount has required fields.
 * @param {object} discount - Discount object
 * @returns {boolean} True if valid
 */
function validateDiscount(discount) {
  return !!(discount && discount.gid && discount.shop && discount.status);
}

/**
 * Parses list query parameters that can appear multiple times, each comma-separated.
 * @param {URLSearchParams} searchParams - URL search parameters
 * @param {string} key - Parameter key
 * @returns {string[]} Array of parsed values
 */
function parseListParam(searchParams, key) {
  const values = searchParams.getAll(key);
  const results = [];
  for (const raw of values) {
    if (typeof raw !== 'string') continue;
    raw.split(',').forEach(segment => {
      const trimmed = segment.trim();
      if (trimmed) results.push(trimmed);
    });
  }
  return results;
}

/**
 * Handles OPTIONS and non-GET methods.
 */
export const action = async ({ request }) => {
  if (request.method === 'OPTIONS') {
    return createCorsPreflightResponse(request, ['GET', 'OPTIONS']);
  }
  const headers = getCorsHeaders(request, ['GET', 'OPTIONS']);
  return new Response('Method not allowed', { status: 405, headers });
};

/**
 * GET /api/discounts - Returns active discounts for requested products.
 */
export const loader = async ({ request }) => {
  const headers = getCorsHeaders(request, ['GET', 'OPTIONS']);

  try {
    const url = new URL(request.url);

    // Parse shop parameter
    const shop = url.searchParams.get('shop');
    if (!shop) {
      logger.warn("Missing shop parameter", { url: url.toString() });
      return json({ error: 'Missing shop parameter' }, { status: 400, headers });
    }

    // Rate limiting
    const rateResult = checkRateLimit(shop);
    if (!rateResult.allowed) {
      logger.warn("Rate limit exceeded", { shop, limit: rateResult.limit });
      return createRateLimitResponse(rateResult, headers);
    }
    Object.assign(headers, getRateLimitHeaders(rateResult));

    // Authentication (header preferred, query param fallback)
    const token = request.headers.get('Authorization')?.replace('Bearer ', '')
      || url.searchParams.get('token');
    const isAuthenticated = await authenticateStorefrontRequest(shop, token, prisma);
    const authEnforced = isStorefrontAuthEnforced();

    if (!isAuthenticated && authEnforced) {
      logger.warn("Storefront authentication failed", { shop });
      return json({ error: 'Unauthorized' }, { status: 403, headers });
    }

    if (!isAuthenticated && !authEnforced) {
      logger.debug("Storefront auth in soft mode, allowing unauthenticated request", { shop });
    }

    // Parse filter parameters and extract numeric IDs (handle both GID and plain numeric formats)
    const rawProductIds = parseListParam(url.searchParams, 'productIds');
    const rawVariantIds = parseListParam(url.searchParams, 'variantIds');
    const rawHandles = parseListParam(url.searchParams, 'handles');

    const requestedProductIds = new Set(
      rawProductIds
        .map(id => extractNumericId(id) || (/^\d+$/.test(id) ? id : null))
        .filter(Boolean)
    );
    const requestedVariantIds = new Set(
      rawVariantIds
        .map(id => extractNumericId(id) || (/^\d+$/.test(id) ? id : null))
        .filter(Boolean)
    );
    const requestedHandles = new Set(rawHandles);

    const filterActive = requestedProductIds.size > 0 || requestedVariantIds.size > 0 || requestedHandles.size > 0;

    // If no filters provided, return empty result (prevent dumping all discounts)
    if (!filterActive) {
      logger.debug("No filters provided, returning empty result", { shop });
      return json({ products: {} }, { status: 200, headers });
    }

    // Resolve handles to product IDs
    if (requestedHandles.size > 0) {
      try {
        const handleMatches = await prisma.product.findMany({
          where: { shop, handle: { in: Array.from(requestedHandles) } },
          select: { gid: true }
        });

        for (const product of handleMatches) {
          const numericId = extractNumericId(product.gid);
          if (numericId) {
            requestedProductIds.add(numericId);
          }
        }

        logger.debug("Resolved handles to product IDs", {
          shop, handles: requestedHandles.size, resolved: handleMatches.length,
        });
      } catch (handleErr) {
        logger.error("Error resolving handles to product IDs", { err: handleErr, shop });
      }
    }

    // Fetch live discounts
    const now = new Date();
    const liveDiscounts = await prisma.liveDiscount.findMany({
      where: {
        shop,
        status: 'LIVE',
        startsAt: { lte: now },
        OR: [{ endsAt: null }, { endsAt: { gt: now } }]
      }
    });

    logger.info("Fetched live discounts", { shop, count: liveDiscounts.length });

    // Load tier info
    let tierInfo;
    try {
      tierInfo = await getShopTierInfo(shop, prisma);
    } catch (err) {
      logger.error("Failed to load tier info, defaulting to FREE", { err, shop });
      tierInfo = { tier: 'FREE' };
    }

    const tier = tierInfo.tier || 'FREE';
    const isBasicOrHigher = ['BASIC', 'ADVANCED'].includes(tier);
    const isAdvanced = tier === 'ADVANCED';

    logger.debug("Loaded tier info", { shop, tier, isBasicOrHigher, isAdvanced });

    // Preload detailed discounts with junction tables
    const discountGids = liveDiscounts.map(d => d.gid).filter(Boolean);
    const detailedDiscounts = discountGids.length > 0
      ? await prisma.discount.findMany({
          where: { shop, gid: { in: discountGids } },
          include: {
            targets: true,    // DiscountTarget records
            products: true,   // DiscountProduct records
            variants: true,   // DiscountVariant records
            codes: true,      // DiscountCode records
          }
        })
      : [];
    const detailedMap = new Map(detailedDiscounts.map(d => [d.gid, d]));

    logger.debug("Loaded detailed discounts with junction tables", { shop, loaded: detailedDiscounts.length });

    // Process each live discount
    const products = {};
    const productIdSet = new Set();

    for (const liveDisc of liveDiscounts) {
      // Validate
      if (!validateDiscount(liveDisc)) {
        logger.debug("Skipping invalid discount", { gid: liveDisc.gid });
        continue;
      }

      const detail = detailedMap.get(liveDisc.gid);
      if (!detail) {
        logger.debug("No detailed record found", { gid: liveDisc.gid });
        continue;
      }

      // Use junction tables instead of JSON parsing
      const resolvedProductGids = detail.products.map(p => p.productGid);
      const resolvedVariantGids = detail.variants.map(v => v.variantGid);
      const targets = detail.targets;
      const codes = detail.codes;

      const numericProductIds = resolvedProductGids.map(extractNumericId).filter(Boolean);
      const numericVariantIds = resolvedVariantGids.map(extractNumericId).filter(Boolean);

      // Check if this discount matches any requested products/variants
      const matchesProduct = numericProductIds.some(id => requestedProductIds.has(id));
      const matchesVariant = numericVariantIds.some(id => requestedVariantIds.has(id));
      if (!matchesProduct && !matchesVariant) {
        continue;
      }

      // Determine target levels from DiscountTarget records
      const productLevelTargets = new Set();
      const variantLevelTargets = new Set();
      let hasCollectionLevelTargets = false;

      for (const target of targets) {
        if (target.targetGid.includes('Collection/')) {
          hasCollectionLevelTargets = true;
        } else if (target.targetGid.includes('ProductVariant/')) {
          const vid = extractNumericId(target.targetGid);
          if (vid) variantLevelTargets.add(vid);
        } else if (target.targetGid.includes('Product/')) {
          const pid = extractNumericId(target.targetGid);
          if (pid) productLevelTargets.add(pid);
        }
      }

      // Exclusion: minimum requirement (needs cart context)
      if (detail.minimumRequirement) {
        logger.debug("Skipping discount with minimum requirement", { gid: detail.gid });
        continue;
      }

      // Tier gating: fixed-amount excluded for FREE tier
      const valueType = detail.valueType === 'PERCENTAGE' ? 'percentage' : 'fixed';
      if (!isBasicOrHigher && valueType === 'fixed') {
        logger.debug("Skipping fixed-amount discount for FREE tier", { gid: detail.gid, tier });
        continue;
      }

      // Build discount object
      const discountObj = {
        isAutomatic: detail.discountType === 'AUTO',
        type: valueType,
        value: detail.valueType === 'PERCENTAGE'
          ? Math.round(detail.percentage * 100)
          : detail.amount,
        endDate: detail.endsAt ? detail.endsAt.toISOString().split('T')[0] : null,
        appliesOnOneTimePurchase: detail.appliesOnOneTimePurchase,
        appliesOnSubscription: detail.appliesOnSubscription,
      };

      // Add coupon code from junction table
      if (detail.discountType === 'CODE' && codes.length > 0) {
        discountObj.code = codes[0].code;
      }

      // Add to each affected product
      for (const productGid of resolvedProductGids) {
        const productId = extractNumericId(productGid);
        if (!productId) continue;

        // Check if this product matches the request filters
        if (filterActive) {
          const variantMatchesRequest = requestedVariantIds.size > 0 && (
            numericVariantIds.some(id => requestedVariantIds.has(id))
          );
          if (!requestedProductIds.has(productId) && !variantMatchesRequest) {
            continue;
          }
        }

        // Initialize product entry
        if (!products[productId]) {
          products[productId] = { handle: null, variants: {}, discounts: [], singlePrice: false };
        }
        productIdSet.add(productId);

        // Clone discount with per-product variant scope
        const productDiscount = { ...discountObj };

        if (productLevelTargets.has(productId) || hasCollectionLevelTargets) {
          productDiscount.variantScope = { type: 'ALL', ids: [] };
        } else if (variantLevelTargets.size > 0) {
          productDiscount.variantScope = { type: 'PARTIAL', ids: numericVariantIds };
        } else {
          productDiscount.variantScope = { type: 'ALL', ids: [] };
        }

        // Tier gating per product
        if (!isAdvanced && detail.appliesOnSubscription) {
          logger.debug("Skipping subscription discount for non-ADVANCED tier", { gid: detail.gid, tier });
          continue;
        }
        if (!isAdvanced && productDiscount.variantScope.type === 'PARTIAL') {
          logger.debug("Skipping partial variant scope for non-ADVANCED tier", { gid: detail.gid, tier });
          continue;
        }

        products[productId].discounts.push(productDiscount);
      }
    }

    // Enrich products with handle and singlePrice
    const numericIds = Array.from(productIdSet);
    if (numericIds.length > 0) {
      const orFilters = numericIds.map(id => ({ gid: { endsWith: id } }));
      const dbProducts = await prisma.product.findMany({
        where: { shop, OR: orFilters },
        select: { gid: true, handle: true, singlePrice: true }
      });

      for (const p of dbProducts) {
        const num = extractNumericId(p.gid);
        if (num && products[num]) {
          products[num].handle = p.handle || null;
          products[num].singlePrice = !!p.singlePrice;
        }
      }

      logger.debug("Enriched products with handle and singlePrice", { shop, enriched: dbProducts.length });
    }

    logger.info("Successfully processed discounts", {
      shop, productCount: Object.keys(products).length, tier,
    });

    return json({ products, autoApplyEnabled: isBasicOrHigher }, { status: 200, headers });

  } catch (error) {
    logger.error("Failed to load discount data", { err: error });
    return json({ error: 'Failed to load discount data' }, { status: 500, headers });
  }
};
