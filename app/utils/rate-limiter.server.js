import { createLogger } from "./logger.server.js";

const logger = createLogger("RateLimiter");

// Configuration
const DEFAULT_MAX_REQUESTS = 60; // per window
const DEFAULT_WINDOW_MS = 60 * 1000; // 1 minute
const MAX_SHOPS = 10000; // max tracked shops before cleanup

// Allow env overrides
const maxRequests = process.env.RATE_LIMIT_MAX_REQUESTS
  ? parseInt(process.env.RATE_LIMIT_MAX_REQUESTS, 10)
  : DEFAULT_MAX_REQUESTS;

const windowMs = process.env.RATE_LIMIT_WINDOW_MS
  ? parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10)
  : DEFAULT_WINDOW_MS;

// In-memory storage: Map<shop domain, timestamp array>
const requestMap = new Map();

/**
 * Check if a shop is within rate limits using sliding window algorithm
 * @param {string} shop - Shop domain
 * @returns {{ allowed: boolean, remaining: number, retryAfter: number | null }}
 */
export function checkRateLimit(shop) {
  // If no shop provided, always allow
  if (!shop) {
    return {
      allowed: true,
      remaining: maxRequests,
      retryAfter: null,
    };
  }

  const now = Date.now();
  const windowStart = now - windowMs;

  // Get or create timestamp array for this shop
  let timestamps = requestMap.get(shop) || [];

  // Filter out expired timestamps (sliding window)
  timestamps = timestamps.filter((ts) => ts > windowStart);

  // Always write back filtered timestamps to prevent stale accumulation
  requestMap.set(shop, timestamps);

  // Check if rate limited
  if (timestamps.length >= maxRequests) {
    // Calculate retry after (seconds until oldest timestamp expires)
    const oldestTimestamp = timestamps[0];
    const retryAfter = Math.ceil((oldestTimestamp + windowMs - now) / 1000);

    logger.warn("Rate limit exceeded", {
      shop, count: timestamps.length, limit: maxRequests,
    });

    return {
      allowed: false,
      remaining: 0,
      retryAfter,
    };
  }

  // Allow request - add current timestamp
  timestamps.push(now);

  // Cleanup if too many shops tracked
  if (requestMap.size > MAX_SHOPS) {
    cleanup();
  }

  return {
    allowed: true,
    remaining: maxRequests - timestamps.length,
    retryAfter: null,
  };
}

/**
 * Generate rate limit headers from checkRateLimit result
 * @param {{ allowed: boolean, remaining: number, retryAfter: number | null }} result
 * @returns {Record<string, string>}
 */
export function getRateLimitHeaders(result) {
  const headers = {
    "X-RateLimit-Limit": String(maxRequests),
    "X-RateLimit-Remaining": String(result.remaining),
  };

  if (result.retryAfter != null) {
    headers["Retry-After"] = String(result.retryAfter);
  }

  return headers;
}

/**
 * Create a 429 Too Many Requests Response
 * @param {{ allowed: boolean, remaining: number, retryAfter: number | null }} result
 * @param {Record<string, string>} headers - Additional headers to include
 * @returns {Response}
 */
export function createRateLimitResponse(result, headers = {}) {
  return new Response(
    JSON.stringify({
      error: "Too Many Requests",
      retryAfter: result.retryAfter,
    }),
    {
      status: 429,
      headers: {
        "Content-Type": "application/json",
        ...getRateLimitHeaders(result),
        ...headers,
      },
    }
  );
}

/**
 * Reset rate limit for a specific shop (for testing)
 * @param {string} shop - Shop domain
 */
export function resetRateLimit(shop) {
  requestMap.delete(shop);
  logger.debug("Rate limit reset for shop", { shop });
}

/**
 * Reset all rate limits (for testing)
 */
export function resetAllRateLimits() {
  requestMap.clear();
  logger.debug("All rate limits reset");
}

/**
 * Cleanup old entries to prevent unbounded memory growth
 * Removes entries with empty timestamp arrays or oldest entries if still over limit
 */
function cleanup() {
  const now = Date.now();
  const windowStart = now - windowMs;

  // First pass: remove shops with all expired timestamps
  for (const [shop, timestamps] of requestMap.entries()) {
    const validTimestamps = timestamps.filter((ts) => ts > windowStart);
    if (validTimestamps.length === 0) {
      requestMap.delete(shop);
    } else if (validTimestamps.length !== timestamps.length) {
      // Update with filtered timestamps
      requestMap.set(shop, validTimestamps);
    }
  }

  // If still over limit, remove shop with oldest last-request timestamp
  if (requestMap.size > MAX_SHOPS) {
    let oldestShop = null;
    let oldestTimestamp = Infinity;

    for (const [shop, timestamps] of requestMap.entries()) {
      const lastTimestamp = timestamps[timestamps.length - 1];
      if (lastTimestamp < oldestTimestamp) {
        oldestTimestamp = lastTimestamp;
        oldestShop = shop;
      }
    }

    if (oldestShop) {
      requestMap.delete(oldestShop);
      logger.debug("Removed oldest shop during cleanup", {
        shop: oldestShop, mapSize: requestMap.size,
      });
    }
  }
}
