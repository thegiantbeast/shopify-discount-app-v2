import { createLogger } from "./logger.server.js";

const logger = createLogger("CORS");

const BLOCKED_ORIGINS = [
  "http://localhost",
  "http://127.0.0.1",
];

const ALLOWED_ORIGIN_PATTERNS = [
  /^https:\/\/[a-z0-9-]+\.myshopify\.com$/i,
  /^https:\/\/[a-z0-9-]+\.shopify\.com$/i,
  /^https:\/\/admin\.shopify\.com$/i,
  /^https:\/\/[a-z0-9.-]+\.wizardformula\.pt$/i,
  /^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/i,
];

const DEV_ALLOWED_PATTERNS = [
  /^https?:\/\/localhost(:\d+)?$/i,
  /^https?:\/\/127\.0\.0\.1(:\d+)?$/i,
];

// Custom HTTPS domain fallback
const CUSTOM_DOMAIN_PATTERN = /^https:\/\/[a-z0-9][a-z0-9.-]*[a-z0-9]\.[a-z]{2,}$/i;

/**
 * Check if the app is running in development mode
 */
function isDevelopment() {
  return process.env.NODE_ENV === "development";
}

/**
 * Determine if an origin is allowed based on the CORS policy
 * @param {string | null | undefined} origin - The origin header value
 * @returns {boolean} - True if the origin is allowed
 */
export function isOriginAllowed(origin) {
  // Priority 1: No origin header (same-origin or server-to-server)
  if (!origin) {
    return true;
  }

  // Priority 2: Blocked origins (production only)
  if (!isDevelopment() && BLOCKED_ORIGINS.includes(origin)) {
    logger.warn("Blocked origin rejected in production", { origin });
    return false;
  }

  // Priority 3: Known Shopify patterns
  for (const pattern of ALLOWED_ORIGIN_PATTERNS) {
    if (pattern.test(origin)) {
      logger.debug("Shopify/app domain allowed", { origin });
      return true;
    }
  }

  // Priority 4: Dev patterns (development only)
  if (isDevelopment()) {
    for (const pattern of DEV_ALLOWED_PATTERNS) {
      if (pattern.test(origin)) {
        logger.debug("Dev origin allowed in development", { origin });
        return true;
      }
    }
  }

  // Priority 5: Custom HTTPS domains
  if (CUSTOM_DOMAIN_PATTERN.test(origin)) {
    logger.info("Custom HTTPS domain allowed", { origin });
    return true;
  }

  // Priority 6: Everything else rejected
  logger.warn("Origin rejected by CORS policy", { origin });
  return false;
}

/**
 * Get CORS headers for a request
 * @param {Request} request - The incoming request
 * @param {string[]} allowedMethods - Array of allowed HTTP methods
 * @returns {Record<string, string>} - Headers object
 */
export function getCorsHeaders(request, allowedMethods = ["GET", "OPTIONS"]) {
  const origin = request.headers.get("Origin");
  const headers = {
    "Access-Control-Allow-Methods": allowedMethods.join(", "),
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    Vary: "Origin",
  };

  if (!origin) {
    // No origin header: use wildcard for same-origin compatibility
    headers["Access-Control-Allow-Origin"] = "*";
    return headers;
  }

  if (isOriginAllowed(origin)) {
    // Reflect the actual origin (never use wildcard with credentials)
    headers["Access-Control-Allow-Origin"] = origin;
  } else {
    // Rejected origin: explicitly set to null
    headers["Access-Control-Allow-Origin"] = "null";
  }

  return headers;
}

/**
 * Create a CORS preflight response
 * @param {Request} request - The incoming request
 * @param {string[]} allowedMethods - Array of allowed HTTP methods
 * @returns {Response} - 200 response with CORS headers
 */
export function createCorsPreflightResponse(request, allowedMethods = ["GET", "OPTIONS"]) {
  return new Response(null, {
    status: 200,
    headers: getCorsHeaders(request, allowedMethods),
  });
}
