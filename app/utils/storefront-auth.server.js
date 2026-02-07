import crypto from "crypto";
import { createLogger } from "./logger.server.js";

const logger = createLogger("StorefrontAuth");

// Cache configuration
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_CACHE_SIZE = parseInt(process.env.STOREFRONT_TOKEN_CACHE_SIZE, 10) || 1000;

// In-memory token cache with TTL
const tokenCache = new Map();

/**
 * Generates a secure random token for storefront API authentication
 * @returns {string} 64-character hex string
 */
export function generateStorefrontToken() {
  return crypto.randomBytes(32).toString("hex");
}

/**
 * Retrieves a cached token if it exists and hasn't expired
 * @param {string} shop - Shop domain
 * @returns {string|null} Token or null if not cached/expired
 */
function getCachedToken(shop) {
  const entry = tokenCache.get(shop);
  if (!entry) {
    return null;
  }

  // Check if expired
  if (Date.now() > entry.expiresAt) {
    tokenCache.delete(shop);
    logger.debug("Token cache entry expired", { shop });
    return null;
  }

  return entry.token;
}

/**
 * Stores a token in cache with TTL
 * @param {string} shop - Shop domain
 * @param {string} token - Token to cache
 */
function setCachedToken(shop, token) {
  const expiresAt = Date.now() + CACHE_TTL_MS;

  // If cache exceeds max size, prune expired entries first
  if (tokenCache.size >= MAX_CACHE_SIZE) {
    pruneExpiredEntries();

    // If still over limit after pruning, delete oldest entry (LRU-like)
    if (tokenCache.size >= MAX_CACHE_SIZE) {
      const firstKey = tokenCache.keys().next().value;
      if (firstKey) {
        tokenCache.delete(firstKey);
        logger.debug("Evicted oldest cache entry", { shop: firstKey });
      }
    }
  }

  tokenCache.set(shop, { token, expiresAt });
  logger.debug("Token cached", { shop });
}

/**
 * Removes all expired entries from cache
 */
function pruneExpiredEntries() {
  const now = Date.now();
  let prunedCount = 0;

  for (const [shop, entry] of tokenCache.entries()) {
    if (now > entry.expiresAt) {
      tokenCache.delete(shop);
      prunedCount++;
    }
  }

  if (prunedCount > 0) {
    logger.debug("Pruned expired cache entries", { prunedCount });
  }
}

/**
 * Clears a specific shop's token from cache
 * @param {string} shop - Shop domain
 */
export function clearTokenCache(shop) {
  const deleted = tokenCache.delete(shop);
  if (deleted) {
    logger.debug("Token cache cleared for shop", { shop });
  }
}

/**
 * Clears entire token cache
 */
export function clearAllTokenCache() {
  const size = tokenCache.size;
  tokenCache.clear();
  logger.debug("All token cache cleared", { clearedEntries: size });
}

/**
 * Authenticates a storefront API request using timing-safe token comparison
 * @param {string} shop - Shop domain
 * @param {string} providedToken - Token from request
 * @param {Object} db - Prisma client instance
 * @returns {Promise<boolean>} True if authenticated, false otherwise
 */
export async function authenticateStorefrontRequest(shop, providedToken, db) {
  try {
    // Validate inputs
    if (!shop || !providedToken || typeof providedToken !== "string") {
      logger.debug("Invalid authentication input", { shop, hasToken: !!providedToken });
      return false;
    }

    // Check cache first
    let storedToken = getCachedToken(shop);

    // If not cached, query database
    if (!storedToken) {
      const shopRecord = await db.shop.findUnique({
        where: { domain: shop },
        select: { storefrontToken: true },
      });

      if (!shopRecord || !shopRecord.storefrontToken) {
        logger.warn("Shop not found or no storefront token configured", { shop });
        return false;
      }

      storedToken = shopRecord.storefrontToken;
      setCachedToken(shop, storedToken);
    }

    // Constant-time comparison using crypto.timingSafeEqual
    const a = Buffer.from(storedToken, "utf-8");
    const b = Buffer.from(providedToken, "utf-8");

    // Must have same length for timingSafeEqual
    if (a.length !== b.length) {
      logger.warn("Token length mismatch", { shop });
      return false;
    }

    const isValid = crypto.timingSafeEqual(a, b);

    if (isValid) {
      logger.debug("Storefront authentication successful", { shop });
    } else {
      logger.warn("Invalid storefront token provided", { shop });
    }

    return isValid;
  } catch (error) {
    logger.error("Error verifying storefront token", { err: error, category: "Auth" });
    return false;
  }
}

/**
 * Checks if storefront authentication is enforced
 * @returns {boolean} True if auth enforcement is enabled
 */
export function isStorefrontAuthEnforced() {
  return process.env.STOREFRONT_AUTH_ENFORCE === "true";
}
