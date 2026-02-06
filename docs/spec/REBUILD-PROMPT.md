# Rebuild Prompt: Discount Display Pro

You are rebuilding a Shopify app called **Discount Display Pro** from scratch. The app helps merchants display product discounts on their storefront — it fetches discounts from Shopify's Admin API, resolves which products/variants they apply to, and injects discount badges and coupon UI into the storefront via a theme app extension.

## How to Use This Prompt

This rebuild is organized into **4 phases with 6 agents**. Each phase depends on the previous one.

```
Phase 1:  [Agent 1: Foundation]
              |
Phase 2:  [Agent 2: Pipeline+Webhooks]  ||  [Agent 3: APIs+Auth]
              |                                |
Phase 3:  [Agent 4: Admin UI]           ||  [Agent 5: Storefront Extension]
              |                                |
Phase 4:  [Agent 6: Testing & Integration]
```

Phases 2 and 3 each have two agents that can run **in parallel**.

## Ground Rules for ALL Agents

1. **The specification is in `docs/business-plan-from-scratch/`** — these 14 files describe what the app must do. Build from the spec, not from the existing source code.

2. **Reference source files are provided per agent** — consult these ONLY for exact values that are hard to derive from docs (CSS selectors, GraphQL field names, Shopify API shapes). Do NOT copy code structure, error handling patterns, or architectural decisions from the existing code.

3. **Read `13-known-issues-improvements.md` first** — every agent must read this file before writing any code. It documents everything that is broken in the current implementation. Your job is to NOT repeat these mistakes. Key things to get right from the start:
   - SQLite with 8 PRAGMAs (WAL, busy_timeout=5000, etc.) — see the CRITICAL section
   - SQLite backup strategy: Litestream continuous replication + scheduled VACUUM INTO snapshots
   - Proper relational schema with junction tables (NOT JSON string fields)
   - Foreign key constraints with cascading deletes
   - Webhook handlers that return proper HTTP error codes (NOT 200 on failure)
   - GraphQL rate limit handling with exponential backoff
   - Bundled/minified theme extension JS (NOT a 205KB monolith)
   - Per-shop rate limiting on storefront API endpoints

4. **Tech stack:**
   - Framework: Remix v2 with Vite
   - UI: React 18 + Shopify Polaris (latest)
   - Database: Prisma with SQLite (properly tuned — see PRAGMAs)
   - Testing: Vitest (unit/integration) + Playwright (E2E)
   - Shopify API: Use the latest stable version
   - Theme extension JS: Bundle with Rollup or esbuild, output minified with source maps

5. **Do NOT over-engineer.** Build exactly what the spec describes. No extra abstractions, no hypothetical future features, no unnecessary indirection.

---

## Phase 1: Foundation

### Agent 1: Infrastructure & Data Model

**Goal:** Set up the project scaffold, database schema, and shared utilities that all other agents depend on.

**Read these spec files:**
- `docs/business-plan-from-scratch/01-business-requirements.md` — tier feature matrix, discount types, exclusion reasons
- `docs/business-plan-from-scratch/02-architecture-overview.md` — system architecture, data flow, tech decisions
- `docs/business-plan-from-scratch/03-data-model.md` — complete schema with field purposes, JSON formats, indexes
- `docs/business-plan-from-scratch/08-tier-billing-system.md` — FREE/BASIC/ADVANCED tiers, Managed Pricing
- `docs/business-plan-from-scratch/12-configuration-deployment.md` — env vars, Docker, build config
- `docs/business-plan-from-scratch/13-known-issues-improvements.md` — what NOT to repeat

**Reference source files (for exact values only):**
- `prisma/schema.prisma` — field names and types (but rebuild with junction tables, foreign keys, cascading deletes)
- `shopify.app.toml` — webhook subscriptions, API scopes, app configuration
- `app/shopify.server.js` — Shopify auth setup pattern (but simplify)

**Deliverables:**

1. **Project scaffold:**
   - Remix v2 + Vite project structure
   - `package.json` with all dependencies
   - `shopify.app.toml` with all webhook subscriptions and scopes
   - `Dockerfile` with proper build steps
   - `.env.example` with all required env vars documented

2. **Database (`app/db.server.js`):**
   - PrismaClient with all 8 SQLite PRAGMAs applied on creation:
     ```
     journal_mode = WAL, busy_timeout = 5000, synchronous = NORMAL,
     cache_size = -64000, foreign_keys = ON, mmap_size = 134217728,
     journal_size_limit = 67108864, temp_store = MEMORY
     ```
   - `prisma/schema.prisma` with `url = env("DATABASE_URL")`
   - `.env` with `DATABASE_URL="file:dev.sqlite?connection_limit=1"`

3. **Prisma schema — REBUILD with proper relations:**

   The current schema stores targeting data as JSON strings. Replace with junction tables:

   ```
   Current (BROKEN):
     Discount.targetIds       = JSON string of collection/product GIDs
     Discount.resolvedProductIds = JSON string of product GIDs
     Discount.resolvedVariantIds = JSON string of variant GIDs
     Discount.codes           = JSON string of coupon codes

   New (CORRECT):
     DiscountTarget   (discountId, targetType, targetGid)  — what the discount targets
     DiscountProduct  (discountId, productGid)              — resolved products
     DiscountVariant  (discountId, variantGid)              — resolved variants
     DiscountCode     (discountId, code)                    — coupon codes
   ```

   Keep all existing models (Session, Shop, Discount, Collection, Product, LiveDiscount, SetupTask, PlanSubscriptionLog) but add:
   - Proper foreign keys (Shop.id as FK to all child tables, not domain strings)
   - Cascading deletes (delete shop → deletes all child records)
   - The 4 junction tables above
   - Proper indexes on all query patterns documented in `03-data-model.md`

4. **Shared utilities:**
   - `app/utils/tier-manager.js` — client-side tier checks (isFeatureEnabled)
   - `app/utils/tier-manager.server.js` — server-side tier management with Managed Pricing
   - `app/shopify.server.js` — Shopify auth, session storage, webhook registration
   - `app/utils/logger.server.js` — pino logger (structured logging, not console.log)

5. **Shopify app setup:**
   - OAuth installation flow
   - Session storage via Prisma
   - Webhook registration for all 13 webhooks listed in `07-webhook-handlers.md`

6. **Backup infrastructure:**
   - `litestream.yml` — continuous WAL replication config for S3-compatible storage (Cloudflare R2)
   - `scripts/docker-entrypoint.sh` — restore-then-replicate pattern:
     ```
     litestream restore -if-db-not-exists -if-replica-exists ...
     litestream replicate -exec "npm run docker-start" ...
     ```
   - Dockerfile additions: Litestream binary + sqlite3 CLI
   - Scheduled `VACUUM INTO` backup script (runs via deployment platform scheduled jobs, every 6 hours)
   - `.env.example` must include `LITESTREAM_ACCESS_KEY_ID` and `LITESTREAM_SECRET_ACCESS_KEY`
   - Never use `cp` to back up SQLite — use `VACUUM INTO` or Litestream

**Critical requirements:**
- The database MUST have PRAGMAs set before any queries run
- Foreign keys MUST be enforced
- The schema MUST use junction tables, not JSON strings
- DATABASE_URL MUST be configurable via environment variable
- Litestream MUST be configured for continuous replication
- Docker entrypoint MUST auto-restore from backup if database is missing

---

## Phase 2: Backend (two agents in parallel)

### Agent 2: Discount Resolution Pipeline + Webhook Handlers

**Goal:** Build the core backend that fetches discounts from Shopify, resolves which products they apply to, and keeps the database in sync via webhooks.

**Read these spec files:**
- `docs/business-plan-from-scratch/04-discount-resolution-pipeline.md` — the complete pipeline: fetch, resolve targets, store, LiveDiscount update
- `docs/business-plan-from-scratch/07-webhook-handlers.md` — all 13 webhooks with triggers and cascading effects
- `docs/business-plan-from-scratch/13-known-issues-improvements.md` — what NOT to repeat

**Reference source files (for exact values only):**
- `app/utils/discount-resolver/graphql-queries.server.js` — exact GraphQL query shapes and field names
- `app/utils/discount-resolver/live-discount-updater.server.js` — the EXCLUSION_REASONS list (exact reason strings)
- `app/utils/discount-resolver/resolve-targets.server.js` — target resolution logic (for understanding the algorithm, not copying code)

**Deliverables:**

1. **Discount resolver pipeline (`app/utils/discount-resolver/`):**
   - `fetchers.server.js` — GraphQL queries to fetch discounts with **cursor-based pagination** (the current code stops at 250 items — fix this)
   - `graphql-queries.server.js` — query definitions
   - `resolve-targets.server.js` — resolve collections → products → variants with **full pagination** (not just first page)
   - `store-data.server.js` — store resolved data using junction tables (DiscountTarget, DiscountProduct, DiscountVariant, DiscountCode)
   - `live-discount-updater.server.js` — update LiveDiscount records with proper exclusion checking
   - `backfill.server.js` — backfill missing LiveDiscount records
   - `reprocess.server.js` — reprocess discounts when collections/products change (**only affected discounts**, not all)
   - `status-utils.server.js` — discount status helpers (active, scheduled, expired)
   - `cleanup.server.js` — cleanup orphaned records (leveraging cascading deletes)

2. **GraphQL rate limit handling:**
   - Read `throttleStatus.currentlyAvailable` from every response
   - Back off when approaching limits
   - Retry throttled requests with exponential backoff
   - Log rate limit events

3. **Webhook handlers (`app/routes/webhooks.app.*.jsx`):**
   All 13 webhooks as documented in `07-webhook-handlers.md`:
   - `discounts_create`, `discounts_update`, `discounts_delete`
   - `collections_update`, `collections_delete`
   - `products_update`, `products_delete`
   - `subscriptions_update`
   - `app_uninstalled`
   - Plus any others documented in the spec

   **CRITICAL:** Webhook handlers MUST:
   - Return proper HTTP error codes on failure (NOT 200)
   - Shopify retries webhooks that return 4xx/5xx — returning 200 on error causes silent data loss
   - Implement idempotency (track webhook IDs, skip duplicates)
   - Log errors with context (shop, webhook topic, payload summary)

4. **Incremental reprocessing:**
   - When a collection changes, only reprocess discounts that target that collection
   - When a product changes, only reprocess discounts that include that product
   - Use the junction tables (DiscountTarget, DiscountProduct) for efficient lookups instead of scanning all discounts

**Critical requirements:**
- Pagination must be cursor-based and follow ALL pages (not stop at 250)
- Webhook handlers must NOT return 200 on error
- Reprocessing must be incremental (only affected discounts)
- GraphQL calls must respect rate limits

---

### Agent 3: API Layer + Storefront Authentication

**Goal:** Build the three storefront-facing API endpoints and the per-shop authentication system.

**Read these spec files:**
- `docs/business-plan-from-scratch/06-api-layer.md` — all 3 API endpoints with request/response formats
- `docs/business-plan-from-scratch/11-authentication-security.md` — OAuth, storefront tokens, CORS, security
- `docs/business-plan-from-scratch/13-known-issues-improvements.md` — what NOT to repeat

**Reference source files (for exact values only):**
- `app/utils/discount-math.server.js` — discount calculation formulas (percentage, fixed amount, BOGO)
- `app/utils/cors.server.js` — CORS header structure

**Deliverables:**

1. **API routes:**
   - `app/routes/api.discounts.jsx` — returns discounts for a list of product handles/IDs
   - `app/routes/api.best-discounts.jsx` — calculates the best discount for a specific product/variant
   - `app/routes/api.theme-selectors.jsx` — returns CSS selectors for the shop's theme

2. **Storefront authentication (`app/utils/storefront-auth.server.js`):**
   - Per-shop token generation (crypto.randomBytes(32).toString('hex'))
   - Token stored in Shop.storefrontToken DB field + Shopify metafield
   - Token verification using `crypto.timingSafeEqual` (constant-time comparison)
   - Token cache with TTL-based eviction (the current cache is a Map without eviction — fix this)
   - Enforcement mode via `STOREFRONT_AUTH_ENFORCE` env var

3. **CORS handling (`app/utils/cors.server.js`):**
   - Allow any HTTPS origin (necessary for cross-shop support)
   - Proper preflight (OPTIONS) handling
   - Security headers

4. **Per-shop rate limiting:**
   - Sliding window counter per shop
   - Return 429 Too Many Requests with Retry-After header
   - Configurable limits (e.g., 60 requests/minute/shop)

5. **Discount math (`app/utils/discount-math.server.js`):**
   - Percentage discount calculation
   - Fixed amount discount calculation
   - Buy X Get Y calculation
   - Best discount selection logic (when multiple discounts apply)

**Critical requirements:**
- Token comparison MUST use timing-safe comparison (not `===`)
- Token cache MUST have eviction (TTL-based, not unbounded Map)
- API endpoints MUST have rate limiting
- All responses must include proper CORS headers

---

## Phase 3: Frontend (two agents in parallel)

### Agent 4: Admin UI Pages

**Goal:** Build all the merchant-facing admin pages using Shopify Polaris.

**Read these spec files:**
- `docs/business-plan-from-scratch/09-admin-ui-pages.md` — all pages with their loaders, actions, and UI components
- `docs/business-plan-from-scratch/08-tier-billing-system.md` — pricing page, tier management
- `docs/business-plan-from-scratch/01-business-requirements.md` — feature matrix, merchant UX flows

**Reference source files:** None needed. Build from the spec using Polaris components.

**Deliverables:**

1. **Dashboard (`app/routes/app._index.jsx`):**
   - Discount statistics (total, active, scheduled, expired)
   - Setup tasks checklist (onboarding flow)
   - Tier status display
   - Quick actions

2. **Discount management (`app/routes/app.discounts.jsx`):**
   - List of all synced discounts with status indicators
   - Search and filter
   - Manual sync/refresh action
   - Tier limit indicators (e.g., "3 of 3 discounts used")

3. **Settings (`app/routes/app.settings.jsx`):**
   - All settings stored as Shopify metafields under namespace `discount_app`
   - Badge appearance (colors, text, position)
   - Coupon display settings
   - Custom CSS selector overrides
   - Advanced settings (debug mode, etc.)

4. **Pricing (`app/routes/app.pricing.jsx`):**
   - Three-tier display (FREE / BASIC $9.99 / ADVANCED $19.99)
   - Current plan indicator
   - Upgrade/downgrade via Shopify Managed Pricing
   - Feature comparison table

5. **Utility pages:**
   - `app/routes/app.rebuild.jsx` — rebuild/reprocess all discounts
   - `app/routes/app.refresh-metafields.jsx` — refresh dev tunnel metafields and webhooks

6. **Layout:**
   - `app/root.jsx` — app root with Polaris AppProvider
   - `app/routes/app.jsx` — app layout with navigation sidebar

**Critical requirements:**
- Use Polaris components throughout (no custom UI where Polaris has a component)
- All settings must be persisted as Shopify metafields
- Tier limits must be enforced in the UI (disable features, show upgrade prompts)
- Dashboard loader should NOT reconcile billing on every load (webhook-only approach)

---

### Agent 5: Storefront Theme Extension

**Goal:** Build the theme app extension that displays discount badges, coupon UI, and handles price extraction on the storefront. This is the most complex agent.

**Read these spec files:**
- `docs/business-plan-from-scratch/05-storefront-display-system.md` — JS modules, DOM manipulation, price extraction
- `docs/business-plan-from-scratch/10-theme-compatibility.md` — 7 supported themes, selector system, custom overrides
- `docs/business-plan-from-scratch/13-known-issues-improvements.md` — the 205KB monolith issue, what to fix

**Reference source files (READ CAREFULLY — these contain battle-tested DOM logic):**
- `extensions/discounts-display-pro/assets/e_discounts.js` — core discount display logic, price extraction with 3-strategy fallback, hidden element detection. **This is 205KB of battle-tested code. Read it to understand the edge cases, then rewrite as clean modules.**
- `extensions/discounts-display-pro/assets/e_forms.js` — product form UI, coupon checkbox, discount badges on forms
- `extensions/discounts-display-pro/assets/pp_ui-components.js` — shared UI components (createCouponBlock, createDiscountBadge)
- `extensions/discounts-display-pro/assets/pp_variant-detection.js` — variant selection detection across themes
- `extensions/discounts-display-pro/assets/pp_discount-utils.js` — discount calculation utilities
- `extensions/discounts-display-pro/assets/theme_selectors.js` — DOM selector handling
- `extensions/discounts-display-pro/assets/logger.js` — client-side logging (window.DDPLogger)
- `extensions/discounts-display-pro/blocks/e_discounts.liquid` — Liquid block template, schema settings, config injection
- `extensions/discounts-display-pro/snippets/pp_styles.css.liquid` — all CSS styles
- `app/utils/theme-selectors.server.js` — THEME_SELECTOR_MAP with exact CSS selectors for 7 themes

**Deliverables:**

1. **Build pipeline:**
   - Rollup or esbuild config for the `extensions/` directory
   - Input: clean ES modules in a `src/` subdirectory
   - Output: single minified JS file + source map in `assets/`
   - The output file must work as a Shopify theme extension asset (no ES module syntax in output)

2. **JS modules (source, pre-bundle):**

   Split the monolith into focused modules:
   - `src/api-client.js` — fetches from `/api/discounts` and `/api/best-discounts`, handles errors, caching
   - `src/price-extractor.js` — the 3-strategy price extraction:
     1. Variant JSON (`script[data-selected-variant]`)
     2. Sale price selector (theme-specific, e.g., `.price-item--sale` for Dawn)
     3. DOM text walking (find visible price text, skip hidden elements)
   - `src/hidden-element-detector.js` — `isHiddenWithinBoundary(el, boundary)`:
     - Check `element.style.display` (inline styles), NOT `getComputedStyle()` (unreliable when parent is hidden)
     - Walk up parent chain, stop at container boundary
     - Skip elements with `visually-hidden`, `sr-only`, `screen-reader` classes
   - `src/badge-renderer.js` — creates discount badge elements, skeleton loading states
   - `src/variant-detector.js` — detects variant selection changes across themes
   - `src/coupon-handler.js` — coupon apply/remove with 3-fallback strategy:
     1. `fetch()` to cart endpoint
     2. Hidden iframe submission (fallback)
     3. Page navigation to `/discount/{code}` (last resort)
   - `src/subscription-handler.js` — handles subscription/one-time purchase switching
   - `src/currency-formatter.js` — currency detection and formatting
   - `src/theme-selectors.js` — loads and applies theme-specific CSS selectors
   - `src/ui-components.js` — shared UI (coupon block, badges, flags)
   - `src/logger.js` — client-side logging via `window.DDPLogger`
   - `src/index.js` — entry point, initialization, orchestration

3. **Liquid template (`blocks/e_discounts.liquid`):**
   - Block schema with all merchant-configurable settings
   - Inject shop config into `window.*` globals:
     - `window.DISCOUNT_STOREFRONT_TOKEN` (from metafield)
     - `window.DISCOUNT_APP_URL` (app URL for API calls)
     - `window.DISCOUNT_SETTINGS` (badge colors, positions, etc.)
   - Load the bundled JS file with `defer`
   - CSS via `snippets/pp_styles.css.liquid`

4. **Theme selector system:**
   - Support these 7 themes with exact CSS selectors from `theme-selectors.server.js`:
     - Dawn, Symmetry, Vision, Wonder, Spotlight, Horizon, Savor
   - Selector types per theme: `formPriceContainer`, `formPrice_discounted`, `priceContainer`, `productCardPrice`, etc.
   - Runtime theme detection and selector loading via `/api/theme-selectors`
   - Support custom selector overrides (merchant-configured in settings)

5. **CSS (`snippets/pp_styles.css.liquid`):**
   - Classes: `.pp-coupon-block`, `.pp-coupon-flag`, `.pp-coupon-label`, `.pp-discount-badge`
   - Responsive design
   - Theme-aware styling (works with light/dark themes)

**Critical requirements:**
- Output MUST be bundled and minified (not 205KB of unminified source)
- Price extraction MUST check inline styles (`element.style.display`), NOT `getComputedStyle()`
- Hidden element detection MUST stop at container boundary
- Coupon apply MUST have the 3-fallback strategy
- The exact CSS selectors for each theme MUST match what's in `theme-selectors.server.js`

---

## Phase 4: Quality

### Agent 6: Testing & Integration

**Goal:** Build a comprehensive test suite that covers the gaps documented in the current app.

**Read these spec files:**
- `docs/business-plan-from-scratch/13-known-issues-improvements.md` — testing gaps section
- All other spec files as needed for understanding expected behavior

**Reference source files:**
- `app/tests/` — existing test files (for structure patterns, not assertions)
- `vitest.config.ts` — test configuration
- `playwright.config.ts` — E2E configuration

**Deliverables:**

1. **Unit tests (Vitest):**
   - Discount math calculations (percentage, fixed, BOGO, best discount selection)
   - Tier manager (feature gating, tier transitions, limit enforcement)
   - Storefront auth (token generation, verification, cache eviction)
   - Status utils (active/scheduled/expired determination)
   - Price extraction logic (if testable outside DOM)

2. **Integration tests (Vitest with mocked Shopify API):**
   - Webhook handlers — mock the Shopify payload, verify database state changes
   - Discount resolver pipeline — mock GraphQL responses, verify resolved targets
   - API routes — mock database, verify response formats and auth enforcement
   - **This is the biggest testing gap in the current app.** The existing code has zero integration tests.

3. **E2E tests (Playwright):**
   - Dashboard loads and displays stats
   - Discount list shows synced discounts
   - Settings can be saved and loaded
   - Pricing page shows correct tier
   - Storefront discount badge appears (requires test store)

4. **Test infrastructure:**
   - Shared test fixtures (mock shop, mock discount, mock GraphQL responses)
   - Database test helpers (seed, reset, assert state)
   - `vitest.config.ts` with proper coverage thresholds
   - `playwright.config.ts` with auth state handling

**Critical requirements:**
- Integration tests for webhook handlers are the #1 priority
- All tests must be runnable in CI without Shopify credentials (mock everything)
- Test the SQLite PRAGMAs are actually set (query PRAGMA values in a test)

---

## Cross-Cutting Concerns (all agents)

### Error Handling
- Server-side: use `pino` for server-side logging, never `console.log`
- Client-side: use `window.DDPLogger` for client-side logging in the theme extension
- Webhook handlers: return proper HTTP codes, log context
- API routes: return structured error responses with appropriate status codes

### Security
- Storefront tokens: timing-safe comparison, TTL cache
- No SQL injection (Prisma handles this)
- No XSS (React handles this, but be careful with dangerouslySetInnerHTML in theme extension)
- CORS: allow HTTPS origins, proper preflight
- Rate limiting on all public endpoints

### Performance
- SQLite PRAGMAs (WAL, mmap, cache)
- Bundled/minified theme JS
- Cursor-based pagination (not offset)
- Incremental reprocessing (not full rescan)
- Token cache with eviction (not unbounded Map)

### What NOT to Build
- No Redis (SQLite is sufficient for this scale)
- No PostgreSQL (SQLite with proper tuning is the right choice)
- No microservices (single Remix app is correct)
- No GraphQL API for the storefront (REST is simpler and sufficient)
- No real-time WebSocket updates (polling/webhook-driven is fine)
