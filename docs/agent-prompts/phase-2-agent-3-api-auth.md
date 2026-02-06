I'm rebuilding a Shopify app called "Discount Display Pro" from scratch. Phase 1 (project scaffold, database, Prisma schema with junction tables) is already complete.

The full specification is in `docs/spec/` (14 files). The CLAUDE.md in the project root has the coding conventions — read it first.

You are **Agent 3: API Layer + Storefront Authentication** (Phase 2 — runs in parallel with Agent 2).

---

## Step 1: Read the spec

Read these files in order:

1. `docs/spec/13-known-issues-improvements.md` — **READ THIS FIRST.** It documents every mistake from v1 that you must NOT repeat.
2. `docs/spec/06-api-layer.md` — all 3 API endpoints with request/response formats
3. `docs/spec/11-authentication-security.md` — OAuth, storefront tokens, CORS, security

## Step 2: Reference the v1 source (exact values only)

These files are in the v1 repo at `/Users/ricardo/Code/Momentus/shopify-discount-app/`. Read them for exact calculation formulas and CORS header structure — but do NOT copy code patterns:

- `/Users/ricardo/Code/Momentus/shopify-discount-app/app/utils/discount-math.server.js` — discount calculation formulas (percentage, fixed amount, BOGO)
- `/Users/ricardo/Code/Momentus/shopify-discount-app/app/utils/cors.server.js` — CORS header structure

## Step 3: Build

### 3a. API routes
- `app/routes/api.discounts.jsx` — returns discounts for a list of product handles/IDs
- `app/routes/api.best-discounts.jsx` — calculates the best discount for a specific product/variant
- `app/routes/api.theme-selectors.jsx` — returns CSS selectors for the shop's theme

### 3b. Storefront authentication (`app/utils/storefront-auth.server.js`)
- Per-shop token generation (`crypto.randomBytes(32).toString('hex')`)
- Token stored in `Shop.storefrontToken` DB field + Shopify metafield
- Token verification using `crypto.timingSafeEqual` (constant-time comparison)
- Token cache with **TTL-based eviction** (v1 uses a Map without eviction — fix this)
- Enforcement mode via `STOREFRONT_AUTH_ENFORCE` env var

### 3c. CORS handling (`app/utils/cors.server.js`)
- Allow any HTTPS origin (necessary for cross-shop support)
- Proper preflight (OPTIONS) handling
- Security headers

### 3d. Per-shop rate limiting
- Sliding window counter per shop
- Return `429 Too Many Requests` with `Retry-After` header
- Configurable limits (e.g., 60 requests/minute/shop)
- In-memory implementation is fine (no Redis needed at this scale)

### 3e. Discount math (`app/utils/discount-math.server.js`)
- Percentage discount calculation
- Fixed amount discount calculation
- Buy X Get Y calculation
- Best discount selection logic (when multiple discounts apply)

---

## Critical requirements

- Token comparison MUST use `crypto.timingSafeEqual` (never `===`)
- Token cache MUST have TTL-based eviction (never unbounded Map)
- API endpoints MUST have per-shop rate limiting
- All responses must include proper CORS headers
- Return structured error responses with appropriate HTTP status codes
- Use `pino` for server-side logging, never `console.log`
- Do NOT over-engineer — build exactly what the spec describes
