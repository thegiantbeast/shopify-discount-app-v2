# Known Issues and Improvements for a Rebuild

This document is an honest retrospective on the current Discount Display Pro architecture. It catalogs technical debt, known limitations, and concrete recommendations for a ground-up rebuild. Each issue is described with its impact and the recommended fix.

---

## Architecture Issues

### CRITICAL: SQLite running with zero production tuning

This is the single highest-impact issue in the entire codebase. SQLite is running with **factory defaults** designed for embedded/mobile use, not web servers. The database configuration in `app/db.server.js` is simply `new PrismaClient()` with no tuning whatsoever.

**Current defaults and their impact:**

| Setting | Default | Problem |
|---------|---------|---------|
| `journal_mode` | DELETE (not WAL) | Readers block writers. Every storefront API read blocks webhook writes and vice versa. |
| `busy_timeout` | 0 ms | Any write lock contention fails **immediately** with `SQLITE_BUSY`. Combined with webhooks returning 200 on errors (see Webhook Issues), data is **silently lost**. |
| `synchronous` | FULL | Fsync on every single commit — ~2x slower than necessary. |
| `cache_size` | ~2 MB | Far too small for a web app. Hot data must be re-read from disk. |
| `foreign_keys` | OFF | Schema `REFERENCES` constraints are **not enforced** at runtime. Orphaned data accumulates silently. |
| `mmap_size` | 0 | All reads go through syscalls instead of memory-mapped I/O. |
| `temp_store` | DISK | Temp tables/sort operations write to disk instead of memory. |

**Silent data loss scenario:** Two webhooks arrive within milliseconds (e.g., `discounts/update` and `collections/update`). The first acquires a write lock. The second immediately fails with `SQLITE_BUSY` because `busy_timeout = 0`. The webhook handler catches the error and returns HTTP 200 (see Webhook Issues section). Shopify sees 200 and does **not** retry. The second webhook's data is permanently lost with no trace in logs.

**Additionally:** The database URL is hardcoded to `file:dev.sqlite` in `prisma/schema.prisma` rather than using `env("DATABASE_URL")`. It cannot be configured per environment.

**Impact:** CRITICAL — This affects every single database operation. WAL + busy_timeout alone would prevent silent data loss and dramatically improve API response times.

**Required fix — 8 PRAGMAs after client creation:**

```javascript
const SQLITE_PRAGMAS = [
  "PRAGMA journal_mode = WAL",        // Concurrent reads + writes. Persistent (set once).
  "PRAGMA busy_timeout = 5000",        // Wait 5s for lock instead of failing immediately.
  "PRAGMA synchronous = NORMAL",       // ~2x faster writes. Safe for app crashes.
  "PRAGMA cache_size = -64000",        // 64 MB page cache (negative = kilobytes).
  "PRAGMA foreign_keys = ON",          // Enforce FK constraints (OFF by default!).
  "PRAGMA mmap_size = 134217728",      // Memory-map 128 MB for faster reads.
  "PRAGMA journal_size_limit = 67108864", // Cap WAL file at 64 MB.
  "PRAGMA temp_store = MEMORY",        // Keep temp tables in memory.
];
```

These are the same values Rails 8 / Litestack use by default. Additionally:
- Change `prisma/schema.prisma` URL from `"file:dev.sqlite"` to `env("DATABASE_URL")`
- Set `DATABASE_URL="file:dev.sqlite?connection_limit=1"` in `.env` (single connection ensures PRAGMAs apply to all queries)
- WAL mode handles read concurrency at the file level regardless of Prisma's pool

**Note on SQLite vs PostgreSQL:** SQLite is actually the right database choice for this app. Single Docker container, read-heavy workload (storefront API reads >> webhook writes), small database, no network round-trip latency. The problem is the configuration, not the engine. Only reconsider PostgreSQL if you need multiple server instances writing concurrently, the database exceeds ~10 GB, or you're hitting >1000 write transactions/second.

### CRITICAL: No backup mechanism

All client data lives in a **single SQLite file** (multi-tenant). If the file is corrupted or lost, every merchant's data is gone. Currently there is no backup mechanism of any kind — no replication, no scheduled snapshots, no recovery path.

**Important:** You cannot safely back up SQLite by copying the file. During active writes, `cp` captures a half-written page and produces a corrupt backup. In WAL mode, the database spans three files (`.sqlite`, `.sqlite-wal`, `.sqlite-shm`) — copying just the main file gives an incomplete database.

**Impact:** CRITICAL — No recovery from corruption, accidental deletion, bad migrations, or host failure.

**Required fix — two layers of protection:**

1. **Litestream** (continuous replication) — Streams WAL changes to S3-compatible storage (e.g., Cloudflare R2) every ~1 second. Recovery Point Objective (RPO) < 5 seconds. Requires WAL mode (see SQLite tuning above). The Docker entrypoint should auto-restore from Litestream if the database file is missing.

2. **Scheduled VACUUM INTO** (every 6 hours) — Creates clean, compacted backup snapshots. `VACUUM INTO` is safe during active writes (single-transaction snapshot). Run via deployment platform's scheduled jobs (e.g., Dokploy Schedule Jobs), not cron inside the container.

**Backup storage:** Cloudflare R2 recommended — S3-compatible with zero egress fees. For a ~500 MB database with 30 days of backups, costs well under $1/month.

**Restore options:**
- Litestream: restore latest state or point-in-time (`-timestamp` flag)
- VACUUM INTO backups: standalone `.sqlite` files, copy and restart

**Docker changes needed:**
- Install Litestream binary in Dockerfile
- Add `litestream.yml` config
- Replace `CMD` with entrypoint script that runs restore-then-replicate
- Add `LITESTREAM_ACCESS_KEY_ID` and `LITESTREAM_SECRET_ACCESS_KEY` env vars

### SQLite single-container deployment limitation

Even with proper tuning, SQLite limits the app to a single container instance. It does not support concurrent writes from multiple processes. This means:

- The app cannot scale horizontally (multiple containers sharing a database).
- No replication or failover capability.

**Impact:** Acceptable for this app's scale (single Shopify app, read-heavy workload). Only becomes an issue if the app needs to serve thousands of shops simultaneously.

**Recommendation:** Keep SQLite with proper tuning for the foreseeable future. If horizontal scaling is eventually needed, migrate to PostgreSQL with connection pooling (PgBouncer or Prisma Accelerate).

### 205KB e_discounts.js monolith

The main storefront JavaScript file (`extensions/discounts-display-pro/assets/e_discounts.js`) is a single 205KB file that handles:

- API fetch calls to `/api/discounts` and `/api/best-discounts`
- Price extraction from the DOM (multiple strategies and fallbacks)
- DOM manipulation for injecting discount badges
- Variant selection detection
- Skeleton loading states
- Currency format detection
- Subscription/one-time purchase switching logic

This file is not minified, not tree-shaken, and loaded in its entirety on every product and collection page.

**Impact:** Increased page load times for all storefront visitors. Difficult to maintain and debug due to the file's size and mixed responsibilities.

**Recommendation:** Split into focused modules (API client, price extractor, badge renderer, variant detector, etc.) and bundle with Rollup or esbuild. This would enable tree-shaking, minification, and source maps for debugging.

### No build step for theme extension JavaScript

All JavaScript in `extensions/discounts-display-pro/assets/` is hand-written vanilla JavaScript with no bundler, no minification, no transpilation, and no source maps. Files are served as-is by Shopify's CDN.

**Impact:** Larger-than-necessary file sizes delivered to end users. No ability to use modern JavaScript features that require transpilation. No dead code elimination. Debugging production issues requires reading unminified source.

**Recommendation:** Introduce a build pipeline (Rollup or esbuild) for the theme extension assets. Output minified, bundled files. Generate source maps for debugging.

---

## Data Model Issues

### JSON string fields instead of relations

Several critical data fields are stored as JSON-serialized strings in the `Discount` model rather than proper relational tables:

- `targetIds` -- JSON array of collection/product GIDs
- `resolvedProductIds` -- JSON array of resolved product GIDs
- `resolvedVariantIds` -- JSON array of resolved variant GIDs
- `codes` -- JSON array of coupon codes

**Impact:** Cannot query or filter by these values efficiently. No referential integrity. No indexing on individual target IDs. Every read requires JSON parsing. Updating a single target requires re-serializing the entire array.

**Recommendation:** Create proper junction tables (`DiscountTarget`, `DiscountProduct`, `DiscountVariant`, `DiscountCode`) with foreign keys. This enables efficient queries like "find all discounts targeting product X" without full-table scans and JSON parsing.

### No foreign keys between models

The `Shop`, `Discount`, `Collection`, `Product`, and `LiveDiscount` tables are linked by the `shop` domain string and `gid` strings, but there are no actual foreign key constraints in the database schema.

**Impact:** Orphaned records can accumulate silently. No cascading deletes when a shop is removed. Data integrity depends entirely on application-level cleanup code, which is fragile.

**Recommendation:** Add proper foreign key constraints with cascading deletes. Use the shop's database ID (not the domain string) as the foreign key to all child tables.

---

## Discount Resolution Issues

### 250-item pagination limit for large collections

When resolving which products belong to a collection, the app fetches up to 250 items per GraphQL request. For collections with more than 250 products, only the first page of results is processed.

**Impact:** Discounts targeting large collections will silently miss products beyond the 250-item boundary. Merchants may see inconsistent discount coverage with no indication of why.

**Recommendation:** Implement cursor-based pagination that follows `pageInfo.hasNextPage` until all products are fetched. Add a safety limit (e.g., 10,000 items) with a warning to the merchant.

### No pagination for discount codes

Discount codes are fetched with `first: 100` and no pagination. Discounts with more than 100 codes will have an incomplete code list.

**Impact:** Merchants with many coupon codes may find that some codes are not recognized by the storefront display logic.

**Recommendation:** Paginate through all discount codes, or at minimum fetch a generous limit with a warning.

### Reprocessing processes ALL discounts

When a collection or product changes, `reprocessDiscountsForCollection()` or `reprocessDiscountsForProduct()` triggers reprocessing. However, the current implementation lacks incremental processing -- it often reprocesses all discounts rather than only those affected by the change.

**Impact:** Unnecessary API calls and database writes. Slower webhook processing. Higher risk of hitting GraphQL rate limits.

**Recommendation:** Build a dependency graph so that only discounts directly targeting the changed collection or product are reprocessed. Track which discounts depend on which collections.

### No GraphQL rate limiting handling

The app makes multiple GraphQL API calls during discount resolution, webhook processing, and page loads, but does not check or respect the Shopify GraphQL rate limit headers (`X-Shopify-Shop-Api-Call-Limit` or the `cost` field in GraphQL responses).

**Impact:** Under heavy webhook load (e.g., a bulk discount update), the app may exceed rate limits, causing 429 errors and failed processing. These failures are logged but not retried.

**Recommendation:** Implement a rate-limit-aware GraphQL client that reads the `throttleStatus` from responses, backs off when approaching limits, and retries throttled requests with exponential backoff.

---

## Storefront Display Issues

### Price parsing European format edge cases

The storefront price extraction code parses prices from DOM text content. While it handles common formats (e.g., `$10.00`, `10,00`), European locales that use periods as thousands separators and commas as decimal separators (e.g., `1.234,56`) can be misinterpreted.

**Impact:** Merchants using European-format currencies may see incorrect discount calculations displayed on their storefronts.

**Recommendation:** Use the Shopify Money format from the shop's configuration rather than parsing text. When text parsing is necessary, use the detected currency format from the Shopify `Intl` locale rather than inferring from the first price seen.

### Currency format detection relies on first price seen on page

The app detects the store's currency format (decimal separator, currency symbol position, etc.) by examining the first price element it finds on the page. If that element is malformed, hidden, or uses a non-standard format, all subsequent price calculations on the page will be wrong.

**Impact:** Edge cases where the first price element is unusual (e.g., a "From" price, a crossed-out original price, or a subscription price) can cause cascading errors across the entire page.

**Recommendation:** Sample multiple price elements and use consensus. Alternatively, read the currency format from the Shopify `window.Shopify.currency` object or the shop's locale configuration.

### Subscription switching relies on inline style checking

When a product page switches between one-time purchase and subscription pricing, the app determines which price elements are visible by checking `element.style.display` (inline styles) rather than `getComputedStyle()`. This is because the parent container is often hidden by the app itself, making `getComputedStyle()` unreliable.

**Impact:** Themes that toggle visibility using CSS classes, `hidden` attributes, or stylesheet rules rather than inline styles will not be detected correctly. The app may display the wrong base price for the discount calculation.

**Recommendation:** Use a MutationObserver to watch for price changes rather than polling. When the variant or subscription option changes, wait for the theme to update the DOM and then re-extract prices. This is more robust than checking visibility of individual elements.

### Theme selector map hardcoded in server code

The mapping of theme names to CSS selectors is hardcoded in `app/utils/theme-selectors.server.js`. Adding support for a new Shopify theme requires a code change and redeployment.

**Impact:** New themes or theme updates cannot be supported without a developer deploying new code. Merchants using uncommon themes must manually configure custom selectors.

**Recommendation:** Move the selector map to a database table or configuration file that can be updated without code deployment. Alternatively, provide a theme selector editor in the admin UI that lets the support team add new themes without code changes.

---

## API Issues

### No rate limiting on storefront API

The `/api/discounts` and `/api/best-discounts` endpoints have no rate limiting. Any client can make unlimited requests.

**Impact:** A malicious actor or a misconfigured storefront theme could send thousands of requests per second, causing database load and potential downtime.

**Recommendation:** Implement per-shop rate limiting using a sliding window counter (e.g., 60 requests per minute per shop). With PostgreSQL, this can be done in the database; with Redis, it is even simpler.

### No pagination on /api/discounts response

The `/api/discounts` endpoint returns all matching discounts for a product in a single response with no pagination.

**Impact:** Products with many applicable discounts will generate large JSON responses. While unlikely to be a major issue (most products have few discounts), it creates an unbounded response size.

**Recommendation:** Add a `limit` parameter with a sensible default (e.g., 50) and support cursor-based pagination.

### CORS allows any HTTPS origin

The storefront API endpoints set permissive CORS headers that accept requests from any HTTPS origin. While this is necessary for the app to work across all Shopify stores (each store has a unique `.myshopify.com` domain), it means any HTTPS website can call the API.

**Impact:** Low risk in practice because the storefront token is required for authentication and each token is shop-specific. However, it does expand the attack surface slightly.

**Recommendation:** Acceptable for the current architecture. If migrating to Shopify App Proxy, CORS becomes irrelevant as requests are proxied through the store's own domain.

---

## Billing Issues

### Tier reconciliation in the dashboard loader

The dashboard loader queries the Shopify GraphQL API for the merchant's current subscription and reconciles the shop's tier in the database if it differs from what the subscription indicates. This is a safety net for cases where the `app_subscriptions/update` webhook was missed or failed.

**Impact:** Every dashboard page load potentially triggers a tier update, adding latency and GraphQL API usage. The reconciliation logic is duplicated between the webhook handler and the dashboard loader.

**Recommendation:** Tier changes should be webhook-only. Improve webhook reliability instead (idempotency keys, retry logic, dead letter queues). The dashboard can display a "sync billing" button as a manual escape hatch rather than running reconciliation on every load.

---

## Testing Gaps

### E2E tests require real Shopify authentication

All E2E tests run against a real Shopify development store. There are no integration tests that test webhook handlers, API routes, or discount resolution logic in isolation without a live Shopify session.

**Impact:** CI/CD pipelines cannot run a meaningful E2E test suite without valid Shopify credentials. Tests are slow (2 minutes timeout each) and flaky due to network dependency. Webhook handlers and API routes have no automated test coverage.

**Recommendation:** Add integration tests that mock the Shopify Admin API responses and test webhook handlers, discount resolution, and API routes in isolation. Use Vitest for these tests rather than Playwright. Reserve Playwright E2E tests for critical user journeys only.

### No error monitoring

The app logs errors to stdout via `pino` (the Node.js structured logger) but has no error monitoring, alerting, or crash reporting service.

**Impact:** Production errors are only visible by reading container logs. No alerting when error rates spike. No aggregation of similar errors. No stack trace correlation.

**Recommendation:** Integrate Sentry (or a similar service) for error monitoring. Sentry provides automatic capture of unhandled exceptions, breadcrumbs for debugging, and alerting. The Remix integration is straightforward.

---

## Security Improvements

### Token rotation not implemented

The per-shop storefront authentication token is generated once and stored in the `Shop.storefrontToken` database field and as a Shopify metafield. There is no mechanism to rotate tokens.

**Impact:** If a token is compromised, there is no way to invalidate it without manually updating the database and metafield. Long-lived tokens increase the window of exposure.

**Recommendation:** Implement token rotation with a grace period. When rotating, accept both the old and new token for a configurable period (e.g., 5 minutes) to allow the Liquid template to pick up the new metafield value without downtime.

### Consider App Proxy instead of custom auth tokens

The current architecture uses custom per-shop tokens to authenticate storefront API requests. Shopify provides an App Proxy feature that routes requests through the store's own domain and automatically includes HMAC verification.

**Impact:** The custom token approach works but adds complexity (token generation, storage, injection via metafields, timing-safe comparison, cache management). App Proxy would eliminate all of this.

**Recommendation:** Evaluate migrating storefront API calls to use Shopify App Proxy. This provides built-in authentication (HMAC-verified), eliminates CORS issues (requests come from the store's domain), and removes the need for custom token management.

---

## Recommended Changes If Rebuilding

If building this app from scratch, the following changes should be prioritized (ordered by impact):

### 1. SQLite production tuning (CRITICAL — do this first)

Configure SQLite with proper PRAGMAs from day one. This is the single highest-impact change — it prevents silent data loss and dramatically improves performance. Apply these 8 PRAGMAs on every client creation:

1. `PRAGMA journal_mode = WAL` — concurrent reads + writes (persistent, set once)
2. `PRAGMA busy_timeout = 5000` — wait 5s for locks instead of failing immediately
3. `PRAGMA synchronous = NORMAL` — ~2x faster writes, safe for app crashes
4. `PRAGMA cache_size = -64000` — 64 MB page cache (default is ~2 MB)
5. `PRAGMA foreign_keys = ON` — enforce FK constraints (OFF by default!)
6. `PRAGMA mmap_size = 134217728` — memory-map 128 MB for near-instant reads
7. `PRAGMA journal_size_limit = 67108864` — cap WAL file at 64 MB
8. `PRAGMA temp_store = MEMORY` — keep temp tables in memory

Also: make the database URL configurable via `env("DATABASE_URL")` with `connection_limit=1` to ensure PRAGMAs apply to all queries. Keep SQLite — it's the right choice for this app's scale. Only consider PostgreSQL if you need multiple server instances or >10 GB databases.

### 2. SQLite backup strategy (CRITICAL — set up with infrastructure)

All data is in one file. Set up two backup layers from day one:

1. **Litestream** — continuous WAL replication to Cloudflare R2 (RPO < 5 seconds). Runs as a wrapper around the app process. Auto-restores on container start if the database is missing.
2. **Scheduled VACUUM INTO** — compacted snapshots every 6 hours via deployment platform's scheduled jobs. Safe during active writes.

Docker entrypoint pattern: `litestream restore → litestream replicate -exec "npm run start"`. Never use `cp` to back up SQLite — it produces corrupt backups during active writes.

### 3. Bundle theme extension with Rollup/esbuild

Introduce a build pipeline for the `extensions/discounts-display-pro/assets/` directory. Split `e_discounts.js` into focused modules:

- `api-client.js` -- fetches discount data from the app's API
- `price-extractor.js` -- DOM price reading with theme-specific strategies
- `badge-renderer.js` -- creates and updates discount badge elements
- `variant-detector.js` -- tracks variant selection changes
- `currency-formatter.js` -- currency detection and formatting
- `subscription-handler.js` -- subscription/one-time purchase switching

Bundle into a single minified output file with source maps.

### 4. Proper relational schema with junction tables

Replace JSON string fields with normalized tables:

```
DiscountTarget (discount_id, target_type, target_gid)
DiscountProduct (discount_id, product_gid)
DiscountVariant (discount_id, variant_gid)
DiscountCode (discount_id, code)
```

Add foreign key constraints with cascading deletes between Shop and all child tables.

### 5. Redis caching layer

Add Redis for:

- Storefront API response caching (discount data per product, TTL-based)
- Rate limiting counters (sliding window per shop)
- Managed subscription cache (replace the in-memory Map currently used in the dashboard loader)
- Session storage (replace SQLite-based session storage)

### 6. Request rate limiting

Implement per-shop rate limiting on all storefront-facing API endpoints. Use Redis-backed sliding window counters. Return `429 Too Many Requests` with `Retry-After` headers.

### 7. Webhook idempotency keys

Track processed webhook IDs to prevent duplicate processing. Shopify may deliver the same webhook multiple times. Store webhook IDs with a TTL (e.g., 24 hours) in Redis and skip processing if already seen.

### 8. Consider App Proxy instead of custom auth tokens

Replace the custom storefront token system with Shopify App Proxy. This eliminates token generation, metafield storage, timing-safe comparison, and CORS configuration. The App Proxy provides HMAC-verified requests routed through the store's domain.

### 9. Proper error monitoring (Sentry)

Integrate Sentry for:

- Automatic exception capture in both server and client code
- Breadcrumb trails for debugging complex flows (discount resolution, webhook processing)
- Performance monitoring for slow loaders and API responses
- Alerting on error rate spikes

### 10. GraphQL rate limit handling

Build a rate-limit-aware wrapper around the Shopify Admin GraphQL client that:

- Reads `throttleStatus.currentlyAvailable` from every response
- Backs off when available points drop below a threshold
- Retries throttled requests with exponential backoff
- Queues requests when near the limit

### 11. Incremental reprocessing

Build a dependency graph that tracks which discounts target which collections and products. When a webhook fires for a collection or product change, only reprocess the specific discounts that reference that entity rather than reprocessing everything.
