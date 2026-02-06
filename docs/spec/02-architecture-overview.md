# Architecture Overview

This document describes the system architecture of Discount Display Pro, a Shopify discount management app that helps merchants display product discounts on their storefront. It covers the tech stack, component map, data flows, installation/uninstall lifecycle, and caching strategy.

---

## High-Level System Diagram

```
+-------------------------------+       +-------------------------------+
|      SHOPIFY PLATFORM         |       |     MERCHANT'S STOREFRONT     |
|                               |       |                               |
|  +-------------------------+  |       |  +-------------------------+  |
|  |  Shopify Admin API      |  |       |  | Theme App Extension     |  |
|  |  (GraphQL v2025-10)     |  |       |  | (Liquid + Vanilla JS)   |  |
|  +----------+--------------+  |       |  |                         |  |
|             |                 |       |  | e_discounts.liquid       |  |
|  +----------+--------------+  |       |  | e_discounts.js          |  |
|  |  Webhooks               |  |       |  | e_forms.js              |  |
|  |  - discounts_create     |  |       |  | e_cards.js              |  |
|  |  - discounts_update     |  |       |  | pp_ui-components.js     |  |
|  |  - discounts_delete     |  |       |  | pp_discount-utils.js    |  |
|  |  - products_update      |  |       |  | pp_variant-detection.js |  |
|  |  - products_delete      |  |       |  | theme_selectors.js      |  |
|  |  - collections_update   |  |       |  +----------+--------------+  |
|  |  - collections_delete   |  |       |             |                 |
|  |  - subscriptions_update |  |       |     (Reads metafields for     |
|  |  - app/uninstalled      |  |       |      app_url, log_level,      |
|  +----------+--------------+  |       |      storefront_token)        |
|             |                 |       +---------|---------------------+
+-------------|-----------------|                 |
              |                                   |
              v                                   v
+--------------------------------------------------------------+
|                   APP SERVER (Remix + Node.js)                |
|                                                               |
|  +--------------------+    +------------------------------+   |
|  | Remix Routes       |    | Discount Resolver Module     |   |
|  |                    |    |                              |   |
|  | app._index (dash)  |    | fetchers.server.js           |   |
|  | app.discounts      |    | graphql-queries.server.js    |   |
|  | app.settings       |    | resolve-targets.server.js    |   |
|  | app.pricing        |    | discount-storage.server.js   |   |
|  | app.rebuild        |    | live-discount-updater.server  |   |
|  | app.refresh-meta   |    | backfill.server.js           |   |
|  +--------------------+    | reprocess.server.js          |   |
|                            | status-utils.server.js       |   |
|  +--------------------+    | tier-gating.server.js        |   |
|  | API Routes         |    | cleanup.server.js            |   |
|  |                    |    | db-cache.server.js           |   |
|  | api.discounts      |    | store-data.server.js         |   |
|  | api.best-discounts |    | utils.server.js              |   |
|  | api.theme-selectors|    +------------------------------+   |
|  +--------------------+                                       |
|                            +------------------------------+   |
|  +--------------------+    | Server Utilities              |   |
|  | Webhook Handlers   |    |                              |   |
|  |                    |    | tier-manager.server.js        |   |
|  | webhooks.app.*     |    | tier-manager.js (shared)      |   |
|  | (8 handlers)       |    | storefront-auth.server.js     |   |
|  +--------------------+    | theme-selector-cache.server   |   |
|                            | theme-selectors.server.js     |   |
|  +--------------------+    | init-process-discounts.js     |   |
|  | Auth & Config      |    | init-process-metafields.js    |   |
|  |                    |    | dashboard-data.server.js      |   |
|  | shopify.server.js  |    | discount-math.server.js       |   |
|  | db.server.js       |    | cors.server.js                |   |
|  +--------------------+    +------------------------------+   |
|                                                               |
|  +----------------------------------------------------------+ |
|  |                    SQLite (Prisma ORM)                    | |
|  |                                                          | |
|  |  Session | Shop | Discount | LiveDiscount | Collection   | |
|  |  Product | SetupTask | PlanSubscriptionLog               | |
|  +----------------------------------------------------------+ |
+---------------------------------------------------------------+
```

---

## Tech Stack Decisions and Rationale

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| **Framework** | Remix v2.16.1 + Vite | Shopify's recommended stack for embedded apps. Server-side rendering, file-based routing, and built-in loader/action patterns map well to Shopify's authentication flow. |
| **UI (Admin)** | React 18 + Shopify Polaris | Required for Shopify embedded app UI consistency. Polaris provides native-feeling components within the Shopify admin. |
| **UI (Storefront)** | Vanilla JavaScript | Shopify theme app extensions do **not** support React or bundled frameworks. All storefront code must be plain JS that loads via `<script>` tags in Liquid templates. |
| **Database** | SQLite via Prisma ORM | Shopify apps deployed via Docker on their hosting infrastructure use SQLite. Prisma provides type-safe queries, migrations, and schema management. Single-file database simplifies deployment. |
| **API** | Shopify Admin GraphQL API v2025-10 | The app reads discount, product, and collection data from Shopify. GraphQL allows fetching exactly the fields needed, with pagination support for large catalogs. |
| **Authentication** | Shopify App Remix (OAuth) + Custom Storefront Tokens | Admin routes use Shopify's built-in OAuth. Storefront API routes use per-shop tokens stored as metafields, verified with `crypto.timingSafeEqual`. |
| **Testing** | Vitest (unit) + Playwright (E2E) | Vitest for fast unit tests of business logic. Playwright for end-to-end tests against real Shopify stores. |
| **Session Storage** | PrismaSessionStorage | Stores Shopify OAuth sessions in the same SQLite database, using the official `@shopify/shopify-app-session-storage-prisma` adapter. |

### Key Design Decisions

1. **Two-Table Discount Pattern**: Discount metadata lives in the `Discount` table (all discounts, including unsupported ones). Display state lives in the `LiveDiscount` table (only discounts that could potentially appear on storefront). This separation means merchants see all their discounts in the admin UI, while the storefront API only queries the lightweight `LiveDiscount` table.

2. **Managed Pricing (Shopify Billing)**: The app uses `unstable_managedPricingSupport: true`, meaning Shopify manages the pricing page and plan selection. The app reads billing state from subscription webhooks rather than creating charges directly.

3. **Storefront Auth as Soft/Hard Toggle**: The `STOREFRONT_AUTH_ENFORCE` environment variable controls whether unauthenticated storefront requests are blocked (hard) or just logged (soft). This allows gradual rollout of token enforcement.

4. **Vanilla JS Storefront**: Since theme extensions cannot bundle React, all storefront display logic (badges, coupon blocks, price extraction, variant detection) is implemented in plain JavaScript modules that communicate via `window` globals and DOM events.

---

## Component Map

### Server-Side Components

```
shopify.server.js
  |-- Shopify app configuration (API key, scopes, billing)
  |-- afterAuth hook --> shopifyShopInstall()
  |       |-- getOrCreateShopTier()       [tier-manager.server.js]
  |       |-- initProcessMetafields()     [init-process-metafields.js]
  |       |-- initProcessDiscounts()      [init-process-discounts.js]
  |-- shopifyShopUninstall()              [transactional cleanup]
  |-- resolveTierFromPlanName()           [billing -> tier mapping]
  |-- buildPlanSelectionUrl()             [managed pricing URL builder]

discount-resolver/
  |-- reprocess.server.js                 [reprocessAllDiscountsForShop - main orchestrator]
  |     |-- GraphQL pagination through all discounts
  |     |-- resolveDiscountTargets()      [resolve-targets.server.js]
  |     |-- storeDiscountData()           [discount-storage.server.js]
  |     |-- updateLiveDiscountData()      [live-discount-updater.server.js]
  |     |-- ensureLiveDiscountsForShop()  [backfill.server.js]
  |
  |-- resolve-targets.server.js           [Collection -> Products, Variant -> Product resolution]
  |     |-- fetchCollectionProducts()     [fetchers.server.js]
  |     |-- fetchVariantProductAndAllVariants() [fetchers.server.js]
  |     |-- storeProductData()            [store-data.server.js]
  |
  |-- discount-storage.server.js          [Upserts into Discount table]
  |-- live-discount-updater.server.js     [Upserts into LiveDiscount table with exclusion logic]
  |     |-- evaluateTierGating()          [tier-gating.server.js]
  |     |-- canHaveMoreLiveDiscounts()    [tier-manager.server.js]
  |     |-- checkAndCleanupExpiredDiscounts() [cleanup.server.js]
  |
  |-- backfill.server.js                  [Creates missing LiveDiscount records from Discount table]
  |-- cleanup.server.js                   [Removes expired Discount + LiveDiscount records]
  |-- db-cache.server.js                  [DB lookups for cached Collection/Product data]
  |-- fetchers.server.js                  [GraphQL queries to Shopify Admin API]
  |-- graphql-queries.server.js           [Shared GraphQL query/fragment definitions]
  |-- status-utils.server.js              [computeDiscountType, temporal bounds, expiry checks]
  |-- tier-gating.server.js               [Evaluates plan-based feature restrictions]
  |-- utils.server.js                     [parseGid, ensureArray, safeJsonParse, etc.]
```

### Client-Side Components (Theme Extension)

```
e_discounts.liquid (entry point)
  |-- Injects metafield values: app_url, log_level, storefront_token
  |-- Loads scripts in order:
  |     1. theme_selectors.js (defer)
  |     2. pp_discount-utils.js (defer)
  |     3. pp_ui-components.js (defer)
  |     4. pp_variant-detection.js (defer)
  |     5. e_cards.js (module, dynamic inject)
  |     6. e_forms.js (module, dynamic inject)
  |     7. e_discounts.js (module, dynamic inject)
  |
  |-- e_discounts.js (core orchestrator)
  |     |-- Fetches discounts from api.discounts with shop + productIds + token
  |     |-- parsePriceFromDOM() - extracts current price from DOM
  |     |-- getDiscountedFormPrice() - reads sale price via theme selectors
  |     |-- getCleanPriceText() - falls back to visible text extraction
  |     |-- isHiddenWithinBoundary() - checks inline display:none up parent chain
  |     |-- Delegates to e_forms.js and e_cards.js for rendering
  |
  |-- e_forms.js (product page rendering)
  |     |-- renderPPFormUI() - renders coupon blocks and badges on product forms
  |     |-- Uses window.DiscountUI from pp_ui-components.js (with fallback)
  |
  |-- e_cards.js (collection page rendering)
  |     |-- Renders discount badges on product cards in collection grids
  |
  |-- pp_ui-components.js (shared UI)
  |     |-- DiscountUI.createCouponBlock() - coupon code display
  |     |-- DiscountUI.createDiscountBadge() - percentage/amount badge
  |
  |-- pp_discount-utils.js (calculations)
  |     |-- Discount math utilities for storefront
  |
  |-- pp_variant-detection.js (variant tracking)
  |     |-- Detects variant changes via URL params, option selectors, Shopify events
  |
  |-- theme_selectors.js (DOM selectors)
  |     |-- Theme-specific CSS selectors for price containers, forms, etc.
```

---

## Data Flow: Discount Lifecycle

This is the primary data flow from a discount being created in Shopify to it being displayed on the storefront.

```
                    SHOPIFY ADMIN
                         |
            Merchant creates/edits discount
                         |
                         v
               +-------------------+
               | Webhook fires     |
               | (discounts_create |
               |  or _update)      |
               +---------+---------+
                         |
                         v
               +-------------------+
               | Webhook Handler   |
               | (Remix route)     |
               +---------+---------+
                         |
            +------------+-------------+
            |                          |
            v                          v
  +-------------------+    +------------------------+
  | Fetch full        |    | resolveDiscountTargets |
  | discount via      |    |                        |
  | GraphQL           |    | - Collection -> fetch   |
  | (GET_DISCOUNT_    |    |   product IDs           |
  |  NODE_QUERY)      |    | - Product -> store data |
  +--------+----------+    | - Variant -> find parent|
           |               |   product & siblings    |
           |               +----------+-------------+
           |                          |
           |               Returns: { productIds[], variantIds[] }
           |                          |
           +------------+-------------+
                        |
                        v
              +-------------------+
              | storeDiscountData |
              | (Discount table)  |
              |                   |
              | Upsert: gid,      |
              | title, status,    |
              | targetIds,        |
              | resolvedProductIds|
              | resolvedVariantIds|
              | valueType, %/amt, |
              | codes, etc.       |
              +--------+----------+
                       |
                       v
              +------------------------+
              | updateLiveDiscountData |
              | (LiveDiscount table)   |
              |                        |
              | Exclusion checks:      |
              | 1. Expired? -> DELETE  |
              | 2. Non-product? ->     |
              |    NOT_SUPPORTED       |
              | 3. BXGY? ->           |
              |    NOT_SUPPORTED       |
              | 4. Customer segment?   |
              |    -> NOT_SUPPORTED    |
              | 5. Min requirement?    |
              |    -> NOT_SUPPORTED    |
              | 6. Tier gating:        |
              |    - Subscription ->   |
              |      UPGRADE_REQUIRED  |
              |    - Variant ->        |
              |      UPGRADE_REQUIRED  |
              |    - Fixed amount ->   |
              |      UPGRADE_REQUIRED  |
              | 7. Not started? ->     |
              |    SCHEDULED           |
              | 8. Active? -> LIVE     |
              |    (if within limit)   |
              | 9. Over limit? ->      |
              |    HIDDEN              |
              +--------+---------------+
                       |
                       v
              +------------------------+
              | checkAndCleanup        |
              | ExpiredDiscounts       |
              | (removes past-endDate  |
              |  records from both     |
              |  Discount + LiveDisc.) |
              +------------------------+


                STOREFRONT DISPLAY
                       |
            Customer visits product page
                       |
                       v
              +------------------------+
              | e_discounts.liquid     |
              | injects app_url,       |
              | storefront_token from  |
              | shop metafields        |
              +--------+---------------+
                       |
                       v
              +------------------------+
              | e_discounts.js         |
              | Calls api.discounts    |
              | ?shop=X&productIds=Y   |
              | &token=Z               |
              +--------+---------------+
                       |
                       v
              +------------------------+
              | api.discounts route    |
              |                        |
              | 1. Verify token        |
              | 2. Query LiveDiscount  |
              |    WHERE status=LIVE   |
              |    AND startsAt<=now   |
              |    AND (endsAt IS NULL |
              |     OR endsAt>now)     |
              | 3. Join with Discount  |
              |    for full details    |
              | 4. Apply tier gating   |
              | 5. Resolve variantScope|
              |    per product         |
              | 6. Return JSON payload |
              +--------+---------------+
                       |
                       v
              +------------------------+
              | e_forms.js / e_cards.js|
              | Render badges, coupon  |
              | blocks on DOM          |
              +------------------------+
```

---

## Data Flow: Variant Change on Product Page

When a customer selects a different variant on a product page, the discount display must update to reflect variant-specific pricing and eligibility.

```
  Customer selects a new variant
  (clicks color/size swatch, dropdown change, etc.)
           |
           v
  +------------------------------+
  | pp_variant-detection.js      |
  | Detects variant change via:  |
  | 1. URL ?variant= param      |
  | 2. Shopify section render    |
  |    event (variant:change)    |
  | 3. Option selector mutation  |
  |    (MutationObserver)        |
  | 4. script[data-selected-     |
  |    variant] JSON update      |
  +-------------+----------------+
                |
                v
  +------------------------------+
  | e_discounts.js               |
  | Receives new variant ID      |
  |                              |
  | 1. Check variant against     |
  |    discount.variantScope:    |
  |    - type: ALL -> applies    |
  |    - type: PARTIAL -> check  |
  |      if variantId in ids[]   |
  |                              |
  | 2. Extract new price from    |
  |    DOM for the variant:      |
  |    a. Variant JSON (prefer)  |
  |    b. getDiscountedFormPrice |
  |    c. getCleanPriceText      |
  |                              |
  | 3. Recalculate discounted    |
  |    price with discount value |
  +-------------+----------------+
                |
                v
  +------------------------------+
  | e_forms.js                   |
  | Re-renders discount UI:      |
  | - Updates badge values       |
  | - Shows/hides coupon block   |
  |   based on variant scope     |
  | - Updates "was/now" pricing  |
  +------------------------------+
```

---

## Data Flow: Subscription/One-Time Switching

When a product page has both one-time purchase and subscription options (e.g., via a subscription app like Recharge), switching between them requires careful price extraction because Shopify themes toggle visibility of price elements.

```
  Customer toggles between
  "One-time purchase" and "Subscribe & Save"
           |
           v
  +----------------------------------+
  | Subscription app (e.g. Recharge) |
  | toggles display:none on price    |
  | containers in the DOM            |
  |                                  |
  | <div class="price__container"    |
  |   style="display: none;">        |
  |   <div class="price__regular">   |
  |     $100  (one-time)             |
  |   </div>                         |
  |   <div class="price__sale"       |
  |     style="display: none;">      |
  |     $80  (subscription)          |
  |   </div>                         |
  | </div>                           |
  +----------------+-----------------+
                   |
                   v
  +----------------------------------+
  | e_discounts.js price extraction  |
  |                                  |
  | isHiddenWithinBoundary(el, bnd)  |
  | - Checks element.style.display   |
  |   (inline styles, NOT computed)  |
  | - Walks up parent chain          |
  | - Stops at container boundary    |
  | - Skips visually-hidden,         |
  |   sr-only, screen-reader classes |
  |                                  |
  | CRITICAL: Uses inline styles     |
  | because getComputedStyle() is    |
  | unreliable when parent is hidden |
  +----------------+-----------------+
                   |
                   v
  +----------------------------------+
  | Discount eligibility check       |
  |                                  |
  | discount.appliesOnOneTimePurchase|
  | discount.appliesOnSubscription   |
  |                                  |
  | If subscription is selected but  |
  | discount only applies to one-    |
  | time: hide discount UI           |
  |                                  |
  | If one-time selected but         |
  | discount is subscription-only:   |
  | hide discount UI                 |
  +----------------+-----------------+
                   |
                   v
  +----------------------------------+
  | e_forms.js re-renders with the   |
  | correct price and visibility     |
  +----------------------------------+
```

---

## Data Flow: Collection/Product Update Cascading

When a collection or product is updated in Shopify, discounts that target those entities must be reprocessed to reflect the changes (e.g., a product added to or removed from a collection).

```
  Collection updated in Shopify
  (product added/removed)
           |
           v
  +----------------------------------+
  | webhooks.app.collections_update  |
  |                                  |
  | 1. Receives collection GID       |
  | 2. Re-fetches collection product |
  |    list from Shopify API         |
  | 3. Updates Collection record     |
  |    (productIds JSON)             |
  | 4. Finds all Discounts where     |
  |    targetIds contains this       |
  |    collection GID                |
  | 5. For each affected discount:   |
  |    - resolveDiscountTargets()    |
  |    - storeDiscountData()         |
  |    - updateLiveDiscountData()    |
  |      (preserveExistingStatus)    |
  +----------------------------------+


  Product updated in Shopify
  (variants added/removed, price changed)
           |
           v
  +----------------------------------+
  | webhooks.app.products_update     |
  |                                  |
  | 1. Receives product GID          |
  | 2. Re-fetches product variants   |
  |    and price range from API      |
  | 3. Updates Product record        |
  |    (variantIds, singlePrice)     |
  | 4. Finds all Discounts where     |
  |    resolvedProductIds contains   |
  |    this product GID              |
  | 5. For each affected discount:   |
  |    - resolveDiscountTargets()    |
  |      (forceRefresh: true)        |
  |    - storeDiscountData()         |
  |    - updateLiveDiscountData()    |
  |      (preserveExistingStatus)    |
  +----------------------------------+


  Collection/Product deleted
           |
           v
  +----------------------------------+
  | webhooks.app.collections_delete  |
  | webhooks.app.products_delete     |
  |                                  |
  | 1. Removes the Collection or     |
  |    Product record from DB        |
  | 2. Finds affected Discounts      |
  | 3. Re-resolves targets (the      |
  |    deleted entity will no longer  |
  |    appear in resolved IDs)       |
  +----------------------------------+
```

---

## Installation Flow (afterAuth Hook)

The `afterAuth` hook in `shopify.server.js` orchestrates the complete installation sequence. This runs both on first install and on re-authentication.

```
  Merchant installs app / opens app (afterAuth fires)
           |
           v
  +----------------------------------+
  | shopifyShopInstall()             |
  | Context: "afterAuth"             |
  +--------+-------------------------+
           |
           v
  +-------------------------------------------------+
  | Step 1: getOrCreateShopTier(shopDomain, db, true)|
  |                                                  |
  | - Finds or creates Shop record                   |
  | - Sets installStatus = "init"                    |
  | - Defaults to FREE tier with liveDiscountLimit=1 |
  | - Syncs billingTier from subscription state      |
  |   (ensureBillingTierSynced)                      |
  | - Applies any pending tier changes if due        |
  |   (applyPendingTierIfDueInternal)                |
  +-------------------------------------------------+
           |
           v
  +-------------------------------------------------+
  | Step 2: initProcessMetafields(shopDomain, admin) |
  |                                                  |
  | Sets Shopify shop-level metafields via GraphQL:  |
  |                                                  |
  | a. discount_app.app_url                          |
  |    = process.env.SHOPIFY_APP_URL                 |
  |    (The URL the storefront JS calls for data)    |
  |                                                  |
  | b. discount_app.log_level                        |
  |    = process.env.LOG_LEVEL || "info"             |
  |    (Controls client-side logging verbosity)      |
  |                                                  |
  | c. discount_app.storefront_token                 |
  |    = Existing token from DB, or generate new one |
  |    - generateStorefrontToken() = 32 random bytes |
  |    - Stored in Shop.storefrontToken field         |
  |    - Cache cleared on generation                 |
  |    (Used by storefront JS to authenticate API)   |
  +-------------------------------------------------+
           |
           v
  +-------------------------------------------------+
  | Step 3: initProcessDiscounts(shopDomain, db, admin)|
  |                                                    |
  | - Checks if LiveDiscount records exist for shop    |
  | - If count == 0 (fresh install or clean state):    |
  |   a. reprocessAllDiscountsForShop()                |
  |      - Paginates through ALL discountNodes via     |
  |        GET_ALL_DISCOUNTS_QUERY (100 per page)      |
  |      - For each discount:                          |
  |        1. resolveDiscountTargets()                 |
  |        2. storeDiscountData()                      |
  |        3. updateLiveDiscountData()                 |
  |           (preserveExistingStatus: true)           |
  |      - ensureLiveDiscountsForShop() (backfill)     |
  |   b. checkAndCleanupExpiredDiscounts()             |
  |                                                    |
  | - If LiveDiscounts already exist: SKIP             |
  |   (prevents re-import on re-auth)                  |
  +-------------------------------------------------+
           |
           v
  +-------------------------------------------------+
  | Step 4: Set installStatus = "done"               |
  |                                                  |
  | On error at any step:                            |
  | - Log error                                       |
  | - Set installStatus = "failed"                    |
  +-------------------------------------------------+
```

### Install Status Values

| Status | Meaning |
|--------|---------|
| `init` | Installation in progress |
| `done` | Installation completed successfully |
| `failed` | Installation encountered an error |
| `null` | Shop has been uninstalled (reset) |

---

## Uninstall Flow

The uninstall runs as a single database transaction to prevent partial cleanup.

```
  webhooks.app.uninstalled fires
           |
           v
  +----------------------------------+
  | shopifyShopUninstall(db, shop)   |
  |                                  |
  | Single $transaction containing:  |
  |                                  |
  | 1. DELETE Session WHERE shop=X   |
  | 2. DELETE LiveDiscount WHERE     |
  |    shop=X                        |
  | 3. DELETE Discount WHERE shop=X  |
  | 4. DELETE Product WHERE shop=X   |
  | 5. DELETE Collection WHERE shop=X|
  | 6. DELETE SetupTask WHERE shop=X |
  | 7. UPDATE Shop SET:              |
  |    - tier = "FREE"               |
  |    - liveDiscountLimit = 1       |
  |    - installStatus = null        |
  |                                  |
  | NOTE: Shop record is NOT deleted |
  | It is reset to FREE tier so that |
  | re-installation can detect the   |
  | existing record and reuse it.    |
  +----------------------------------+
```

**What is NOT deleted on uninstall:**
- The `Shop` record itself (reset to FREE, not deleted)
- `PlanSubscriptionLog` records (billing audit trail preserved)
- Shopify metafields (Shopify manages these; they are re-set on next install)

---

## Reprocess/Rebuild Flow

The reprocess flow can be triggered manually (via `app.rebuild` route) or automatically during installation. It is the most comprehensive data synchronization operation.

```
  reprocessAllDiscountsForShop(admin, shop, db)
           |
           v
  +------------------------------------------+
  | Paginate through ALL discountNodes       |
  | via GET_ALL_DISCOUNTS_QUERY              |
  | (100 nodes per page, follows cursor)     |
  +-----+------------------------------------+
        |
        | For each discount node:
        v
  +------------------------------------------+
  | 1. resolveDiscountTargets()              |
  |    - For collection targets:             |
  |      fetchCollectionProducts() with      |
  |      pagination (250 products/page)      |
  |      then storeProductData() for each    |
  |    - For product targets:                |
  |      storeProductData() directly         |
  |    - For variant targets:                |
  |      fetchVariantProductAndAllVariants() |
  |      to find parent product              |
  |                                          |
  | 2. storeDiscountData()                   |
  |    - Upserts into Discount table         |
  |    - ALL discounts stored regardless     |
  |      of exclusion status                 |
  |                                          |
  | 3. updateLiveDiscountData()              |
  |    - Upserts into LiveDiscount table     |
  |    - preserveExistingStatus: true        |
  |      (prevents HIDDEN->LIVE promotion    |
  |       during bulk reprocess)             |
  |    - NEW discounts default to HIDDEN     |
  |      when preserveExistingStatus is on   |
  +-----+------------------------------------+
        |
        v
  +------------------------------------------+
  | ensureLiveDiscountsForShop() (backfill)  |
  |                                          |
  | Finds Discount records that have no      |
  | corresponding LiveDiscount record.       |
  | Builds synthetic discountData from the   |
  | stored Discount fields and calls         |
  | updateLiveDiscountData() for each.       |
  +-----+------------------------------------+
        |
        v
  +------------------------------------------+
  | Returns summary:                         |
  | { total, processed, updated,             |
  |   added, deleted, backfilled }           |
  +------------------------------------------+
```

### The `preserveExistingStatus` Option

This option on `updateLiveDiscountData` is critical for reprocessing safety:

| Scenario | Without `preserveExistingStatus` | With `preserveExistingStatus` |
|----------|--------------------------------|-------------------------------|
| Existing LIVE discount | Stays LIVE (if still eligible) | Stays LIVE |
| Existing HIDDEN discount | Might become LIVE (if eligible) | Stays HIDDEN |
| Existing SCHEDULED discount | Might become LIVE (if now active) | Stays SCHEDULED |
| New discount (no existing record) | Becomes LIVE (if eligible + within limit) | Becomes HIDDEN |

The purpose is to prevent a bulk reprocess from accidentally promoting many discounts to LIVE status at once, which could exceed the merchant's tier limit or make unexpected discounts visible on the storefront.

---

## Caching Strategy

### Server-Side Caches

#### 1. Storefront Token Cache

**Location:** `app/utils/storefront-auth.server.js`

```
In-memory Map: { shopDomain -> { token, expiresAt } }
TTL: 5 minutes
```

- Avoids a database query on every storefront API request
- Cache is populated on first token verification per shop
- Cleared explicitly when a token is regenerated (`clearTokenCache`)
- Falls back to DB lookup on cache miss or expiry

#### 2. Theme Selector Cache

**Location:** `app/utils/theme-selector-cache.server.js`

```
In-memory Map: { normalizedThemeId -> { payload, cachedAt, lastAccess } }
TTL: 30 days (configurable via THEME_SELECTOR_CACHE_TTL_MS)
Max entries: 200 (configurable via THEME_SELECTOR_CACHE_SIZE)
Eviction: LRU (least recently accessed) when over max size
```

- Caches resolved CSS selectors per Shopify theme ID
- Theme IDs are normalized (extracted numeric portion)
- Entries with `usedFallback: true` are never cached (they indicate the theme was not recognized)
- On prune: expired entries removed first, then LRU eviction if still over limit
- Cleared in full via `clearThemeSelectorCache()`

#### 3. Database as Cache (Collection/Product Data)

**Location:** `app/utils/discount-resolver/db-cache.server.js` and `store-data.server.js`

The `Collection` and `Product` tables serve as a local cache of Shopify data:

- `getCollectionFromDB()` / `getProductFromDB()` check for existing records before making GraphQL API calls
- If a record exists and `forceRefresh` is not set, the cached data is returned
- `forceRefresh: true` bypasses the cache and re-fetches from Shopify API
- Collection product lists and product variant lists are stored as JSON strings

#### 4. Prisma Client Singleton

**Location:** `app/db.server.js`

- In production: a single `PrismaClient` stored on `global.__prismaProdClient`
- In development: stored on `global.prismaGlobal` with staleness detection
  - If the `planSubscriptionLog` delegate is missing (schema changed), the old client is disconnected and replaced
  - This handles Prisma schema changes during development without restarting the server

### Client-Side Caching

The storefront JavaScript does **not** implement explicit caching. Each page load fetches fresh discount data from `api.discounts`. This is intentional because:

1. Discount data can change at any time (merchant creates/deletes discounts)
2. The API response is lightweight (only LIVE discounts for requested products)
3. Product pages are typically cached by Shopify's CDN, so the discount fetch happens once per page view
4. The `api.discounts` route includes CORS headers but no `Cache-Control` headers, so browsers use default heuristics

### Cache Invalidation Triggers

| Event | Cache Affected | Invalidation Method |
|-------|---------------|---------------------|
| Token regeneration | Token cache | `clearTokenCache(shop)` |
| Theme extension settings change | Theme selector cache | `clearThemeSelectorCache()` |
| Collection update webhook | DB cache (Collection table) | `storeCollectionData(forceRefresh: true)` |
| Product update webhook | DB cache (Product table) | `storeProductData(forceRefresh: true)` |
| Discount create/update webhook | LiveDiscount + Discount tables | Full re-resolve and upsert |
| App reinstall | All per-shop data | Transaction deletes all shop data |
