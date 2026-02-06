# Data Model

This document describes every database model, field, index, and data lifecycle in Discount Display Pro. The database is SQLite managed via Prisma ORM. This reference is designed to be thorough enough to rebuild the schema from scratch.

---

## Entity Relationship Overview

```
+------------------+       +------------------+       +------------------+
|     Session      |       |       Shop       |       | PlanSubscription |
|                  |       |                  |       |      Log         |
| id (PK)          |       | id (PK, UUID)    |       |                  |
| shop       ------+--+--->| domain (UNIQUE)  |<---+--| shopDomain       |
| state            |  |    | tier             |    |  | shopId           |
| isOnline         |  |    | billingTier      |    |  | topic            |
| accessToken      |  |    | storefrontToken  |    |  | planHandle       |
| ...              |  |    | installStatus    |    |  | ...              |
+------------------+  |    | ...              |    |  +------------------+
                      |    +------------------+    |
                      |                            |
                      |    +------------------+    |
                      |    |    Discount      |    |
                      +--->| shop       ------+--->|
                      |    | gid (UNIQUE)     |    |
                      |    | title            |    |
                      |    | targetIds (JSON) |    |
                      |    | resolvedProduct  |    |
                      |    |   Ids (JSON)     |    |
                      |    | resolvedVariant  |    |
                      |    |   Ids (JSON)     |    |
                      |    | codes (JSON)     |    |
                      |    | ...              |    |
                      |    +--------+---------+    |
                      |             |              |
                      |    gid references          |
                      |             |              |
                      |    +--------+---------+    |
                      |    |  LiveDiscount    |    |
                      +--->| shop       ------+--->|
                      |    | gid (UNIQUE)     |    |
                      |    | status           |    |
                      |    | exclusionReason  |    |
                      |    | ...              |    |
                      |    +------------------+    |
                      |                            |
                      |    +------------------+    |
                      |    |   Collection     |    |
                      +--->| shop       ------+--->|
                      |    | gid (UNIQUE)     |    |
                      |    | title            |    |
                      |    | productIds (JSON)|    |
                      |    +------------------+    |
                      |                            |
                      |    +------------------+    |
                      |    |    Product       |    |
                      +--->| shop       ------+--->|
                           | gid (UNIQUE)     |
                           | title            |
                           | handle           |
                           | variantIds (JSON)|
                           | singlePrice      |
                           +------------------+

+------------------+
|   SetupTask      |
| shop       ------+--->  (references shop domain)
| title (UNIQUE    |
|   per shop)      |
| isCompleted      |
| ...              |
+------------------+

Relationships:
- Session.shop -> Shop.domain (implicit, no FK constraint)
- Discount.shop -> Shop.domain (implicit, no FK constraint)
- LiveDiscount.shop -> Shop.domain (implicit, no FK constraint)
- LiveDiscount.gid == Discount.gid (logical link, no FK constraint)
- Collection.shop -> Shop.domain (implicit, no FK constraint)
- Product.shop -> Shop.domain (implicit, no FK constraint)
- SetupTask.shop -> Shop.domain (implicit, no FK constraint)
- PlanSubscriptionLog.shopDomain -> Shop.domain (implicit, no FK constraint)

CRITICAL: SQLite does not enforce foreign keys by default, and the
current app does NOT set `PRAGMA foreign_keys = ON`. All relationships
are maintained by application logic. The "shop" field is the common
join key across all models. Additionally, the database runs with zero
production tuning (no WAL, 0ms busy_timeout, FULL sync, 2MB cache).
See 13-known-issues-improvements.md for the full list of required
SQLite PRAGMAs.
```

---

## Model: Session

Stores Shopify OAuth sessions. Managed by `@shopify/shopify-app-session-storage-prisma`.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `id` | String | **PK** | Shopify session ID (format varies: offline sessions use `offline_{shop}`, online sessions use a random ID) |
| `shop` | String | required | The shop's `.myshopify.com` domain (e.g., `my-store.myshopify.com`) |
| `state` | String | required | OAuth state parameter for CSRF protection |
| `isOnline` | Boolean | `false` | Whether this is an online (user-scoped) or offline (app-scoped) session |
| `scope` | String? | null | Comma-separated list of granted OAuth scopes |
| `expires` | DateTime? | null | Session expiration timestamp. Null for offline sessions (they do not expire). |
| `accessToken` | String | required | Shopify Admin API access token |
| `userId` | BigInt? | null | Shopify user ID (only for online sessions) |
| `firstName` | String? | null | User's first name (online sessions only) |
| `lastName` | String? | null | User's last name (online sessions only) |
| `email` | String? | null | User's email (online sessions only) |
| `accountOwner` | Boolean | `false` | Whether the user is the store owner |
| `locale` | String? | null | User's locale setting |
| `collaborator` | Boolean? | `false` | Whether the user is a collaborator |
| `emailVerified` | Boolean? | `false` | Whether the user's email is verified |

**Indexes:**
| Index | Fields | Purpose |
|-------|--------|---------|
| `@@index([shop])` | shop | Look up all sessions for a given shop (used during uninstall cleanup) |

**Lifecycle:**
- Created: By Shopify session storage adapter during OAuth flow
- Updated: On re-authentication or scope changes
- Deleted: During shop uninstall (transactional cleanup)

---

## Model: Shop

Central record for each installed store. Manages tier, billing, trial, and storefront authentication state.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `id` | String | UUID (auto) | Internal primary key |
| `domain` | String | **UNIQUE** | The shop's `.myshopify.com` domain. This is the canonical identifier used across all tables. |
| `tier` | String | `"FREE"` | The **effective** (currently active) pricing tier. One of: `FREE`, `BASIC`, `ADVANCED`. This is the tier used for feature gating and limit enforcement. |
| `liveDiscountLimit` | Int? | null | Maximum number of LIVE discounts allowed. Derived from tier config. `null` means unlimited (ADVANCED tier). |
| `billingTier` | String | `"FREE"` | The tier that Shopify billing says the merchant is on. May differ from `tier` during downgrade scheduling (billing says BASIC, but tier is still ADVANCED until period ends). |
| `billingStatus` | String? | null | Current Shopify subscription status (e.g., `"ACTIVE"`, `"CANCELLED"`, `"FROZEN"`). Normalized to uppercase. |
| `installStatus` | InstallStatus? | null | Current installation state. See enum below. |
| `pendingTier` | String? | null | A tier change that is scheduled but not yet effective. Set when a merchant downgrades and the change takes effect at the end of the billing period. |
| `pendingTierEffectiveAt` | DateTime? | null | When the pending tier change should take effect. Typically set to `billingCurrentPeriodEnd`. |
| `pendingTierSourceSubscriptionId` | String? | null | The Shopify subscription ID that triggered the pending tier change. Used for audit and deduplication. |
| `pendingTierContext` | Json? | null | Additional context about the pending change (serialized JSON). May include `scheduledEffectiveAt` and other metadata. |
| `trialEndsAt` | DateTime? | null | When the merchant's free trial expires. |
| `trialRecordedAt` | DateTime? | null | When the trial was first detected/recorded by the app. |
| `trialSourceSubscriptionId` | String? | null | The Shopify subscription ID associated with the trial. |
| `billingCurrentPeriodEnd` | DateTime? | null | End date of the current billing period. Used to determine when a pending downgrade should take effect. |
| `storefrontToken` | String? | null | Randomly generated 64-character hex token for authenticating storefront API requests. Generated via `crypto.randomBytes(32).toString("hex")`. |
| `createdAt` | DateTime | `now()` | Record creation timestamp |
| `updatedAt` | DateTime | `@updatedAt` | Last modification timestamp (auto-managed by Prisma) |

### InstallStatus Enum

```prisma
enum InstallStatus {
  init    // Installation in progress
  failed  // Installation encountered an error
  done    // Installation completed successfully
}
```

A `null` value means the shop has been uninstalled (reset during `shopifyShopUninstall`).

### Tier Fields

The three tier-related fields work together to handle billing transitions:

```
+-----------------------------------------------------------------------+
|                         TIER FIELD RELATIONSHIPS                       |
+-----------------------------------------------------------------------+
|                                                                       |
|  billingTier -----> What Shopify subscription says                    |
|                     (updated by subscription webhooks)                |
|                                                                       |
|  tier ------------> What the app actually enforces                    |
|                     (the effective tier for feature gating)           |
|                                                                       |
|  pendingTier -----> What tier will become in the future               |
|                     (set when billingTier < tier, i.e. downgrade)     |
|                                                                       |
+-----------------------------------------------------------------------+

Example: Merchant on ADVANCED downgrades to BASIC mid-cycle

  Before:   tier=ADVANCED  billingTier=ADVANCED  pendingTier=null
  Downgrade: tier=ADVANCED  billingTier=BASIC     pendingTier=BASIC
              pendingTierEffectiveAt = billingCurrentPeriodEnd
  Period ends: tier=BASIC  billingTier=BASIC     pendingTier=null
```

### Billing Fields

| Field | When Set | By What |
|-------|----------|---------|
| `billingTier` | On subscription create/update webhook | `subscriptions_update` webhook handler |
| `billingStatus` | On subscription update | `updateShopBillingStatus()` |
| `billingCurrentPeriodEnd` | On subscription update | `scheduleShopTierChange()` |

### Pending Tier Change Fields

| Field | Purpose |
|-------|---------|
| `pendingTier` | Target tier (e.g., `"BASIC"` when downgrading from ADVANCED) |
| `pendingTierEffectiveAt` | When to apply (usually end of billing period) |
| `pendingTierSourceSubscriptionId` | Which subscription triggered this (for deduplication) |
| `pendingTierContext` | JSON metadata (e.g., `{ "scheduledEffectiveAt": "2025-12-01T00:00:00Z" }`) |

### Trial Fields

| Field | Purpose |
|-------|---------|
| `trialEndsAt` | Absolute timestamp when trial expires |
| `trialRecordedAt` | When the app first recorded this trial (to avoid re-recording) |
| `trialSourceSubscriptionId` | Which subscription has the trial (prevents duplicate trial tracking) |

**Indexes:**
| Index | Fields | Purpose |
|-------|--------|---------|
| `domain` | domain | UNIQUE constraint - primary lookup key |
| `@@index([pendingTierEffectiveAt])` | pendingTierEffectiveAt | Efficiently find shops with pending tier changes that are now due |

**Lifecycle:**
- Created: During `getOrCreateShopTier()` on first install
- Updated: On billing changes, tier changes, metafield refresh, re-auth
- Deleted: NEVER deleted. On uninstall, the record is reset to FREE tier defaults.

---

## Model: Discount

Stores complete discount metadata for every discount in the shop, regardless of whether it can be displayed on the storefront. This is the "source of truth" table that mirrors Shopify's discount data.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `id` | String | UUID (auto) | Internal primary key |
| `gid` | String | **UNIQUE** | Shopify Global ID (e.g., `gid://shopify/DiscountAutomaticNode/123456` or `gid://shopify/DiscountCodeNode/789012`) |
| `shop` | String | required | Shop domain |
| `title` | String | required | Discount title as set by the merchant (e.g., "Summer Sale 20%") |
| `status` | String | required | Shopify discount status: `ACTIVE`, `EXPIRED`, `SCHEDULED` |
| `startsAt` | DateTime | required | When the discount becomes active |
| `endsAt` | DateTime? | null | When the discount expires. Null means no end date. |
| `summary` | String? | null | Human-readable summary generated by Shopify (e.g., "20% off all products in Summer Collection") |
| `discountClass` | String | required | Shopify discount class: `PRODUCT`, `ORDER`, `SHIPPING`. Only `PRODUCT` class discounts can be displayed on product pages. |
| `discountType` | String | required | `CODE` (requires coupon code) or `AUTO` (automatically applied). Determined by whether the GID contains `DiscountCodeNode`. |
| `targetType` | String | required | What the discount targets: `COLLECTION`, `PRODUCT`, or `UNKNOWN` |
| `targetIds` | String | required | JSON array of original Shopify GIDs this discount targets (see format below) |
| `resolvedProductIds` | String | required | JSON array of all product GIDs this discount applies to after resolving collections (see format below) |
| `resolvedVariantIds` | String | required | JSON array of specific variant GIDs when discount targets individual variants (see format below) |
| `valueType` | String | required | `PERCENTAGE` or `AMOUNT` |
| `percentage` | Float? | null | Discount percentage as a decimal (e.g., `0.2` for 20%). Only set when `valueType` = `PERCENTAGE`. |
| `amount` | Float? | null | Discount amount in the store's currency (e.g., `10.0` for $10 off). Only set when `valueType` = `AMOUNT`. |
| `currencyCode` | String? | null | ISO currency code for amount discounts (e.g., `USD`, `EUR`). Only set when `valueType` = `AMOUNT`. |
| `appliesOnOneTimePurchase` | Boolean | `true` | Whether this discount applies to one-time purchases |
| `appliesOnSubscription` | Boolean | `false` | Whether this discount applies to subscription purchases |
| `customerSelectionAll` | Boolean | `true` | `true` = all customers eligible, `false` = specific customer segments only |
| `customerSegments` | String | required | JSON array of customer segment objects. Currently always `"[]"` (segment details not stored). |
| `codes` | String | required | JSON array of discount code strings. Empty `"[]"` for AUTO discounts. |
| `minimumRequirement` | Json? | null | Prisma Json field for minimum order requirements. Null if no minimum. |
| `createdAt` | DateTime | `now()` | Record creation timestamp |
| `updatedAt` | DateTime | `@updatedAt` | Last modification timestamp |

### Target Resolution Fields

These three fields track the progression from "what the merchant targeted" to "which specific products are affected":

```
targetIds (original targets)
    |
    |  Collection targets are expanded by fetching their product lists
    |  Product targets are kept as-is
    |  Variant targets are resolved to their parent products
    |
    v
resolvedProductIds (all affected products)
resolvedVariantIds (specific variants, if targeted at variant level)
```

### Value Fields

| Scenario | valueType | percentage | amount | currencyCode |
|----------|-----------|-----------|--------|--------------|
| 20% off | `PERCENTAGE` | `0.2` | null | null |
| $10 off | `AMOUNT` | null | `10.0` | `USD` |

Note: `percentage` is stored as a decimal from Shopify's API (e.g., `0.2` for 20%), but the `api.discounts` route converts it to an integer percentage for the storefront (e.g., `20`).

### Customer Eligibility Fields

| Field | Value | Meaning |
|-------|-------|---------|
| `customerSelectionAll` | `true` | Discount available to all customers |
| `customerSelectionAll` | `false` | Discount limited to specific customer segments |
| `customerSegments` | `"[]"` | Currently always empty; segment restriction is detected via the `context.__typename` field from Shopify's API |

When `customerSelectionAll` is `false`, the discount gets `NOT_SUPPORTED` status in LiveDiscount because segment-restricted discounts cannot be displayed publicly on the storefront.

### Code Fields

| Discount Type | codes value |
|--------------|-------------|
| AUTO | `"[]"` |
| CODE (single code) | `'["SAVE10"]'` |
| CODE (multiple codes) | `'["SAVE10", "SUMMER"]'` |

### JSON Field Formats

**`targetIds`** - Original targets as Shopify GIDs:
```json
["gid://shopify/Collection/123456789", "gid://shopify/Product/987654321"]
```

Mixed target types are possible (a discount can target both collections and individual products):
```json
["gid://shopify/Collection/111", "gid://shopify/Product/222", "gid://shopify/ProductVariant/333"]
```

**`resolvedProductIds`** - All affected products after resolution:
```json
["gid://shopify/Product/111", "gid://shopify/Product/222", "gid://shopify/Product/333"]
```

**`resolvedVariantIds`** - Specific variants (only when discount targets variants directly):
```json
["gid://shopify/ProductVariant/444", "gid://shopify/ProductVariant/555"]
```

For collection or product-level targets, this is typically `"[]"`.

**`codes`** - Discount codes:
```json
["SAVE10", "SUMMER20"]
```

**`minimumRequirement`** - Prisma Json field (stored as native JSON in SQLite):

No minimum:
```json
null
```

Minimum subtotal:
```json
{
  "greaterThanOrEqualToSubtotal": {
    "amount": "50.00",
    "currencyCode": "USD"
  }
}
```

Minimum quantity:
```json
{
  "greaterThanOrEqualToQuantity": "3"
}
```

**`customerSegments`**:
```json
[]
```

**Indexes:**
| Index | Fields | Purpose |
|-------|--------|---------|
| `gid` | gid | UNIQUE constraint - lookup by Shopify Global ID |
| `@@index([shop])` | shop | Find all discounts for a shop |
| `@@index([shop, status])` | shop, status | Find active/expired discounts for a shop |
| `@@index([shop, gid])` | shop, gid | Compound lookup for shop-scoped discount by GID |

**Lifecycle:**
- Created: By `storeDiscountData()` via upsert (on webhook create or reprocess)
- Updated: By `storeDiscountData()` via upsert (on webhook update or reprocess)
- Deleted: By `removeDiscountEverywhere()` when discount is expired or deleted, by `checkAndCleanupExpiredDiscounts()` for past-endDate records, or during shop uninstall

---

## Model: Collection

Local cache of Shopify collection data, specifically the list of product IDs in each collection. Used to resolve collection-targeted discounts to individual products without repeated API calls.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `id` | String | UUID (auto) | Internal primary key |
| `gid` | String | **UNIQUE** | Shopify Global ID (e.g., `gid://shopify/Collection/123456789`) |
| `title` | String | required | Collection title (e.g., "Summer Collection") |
| `shop` | String | required | Shop domain |
| `productIds` | String | required | JSON array of product GIDs in this collection |
| `createdAt` | DateTime | `now()` | Record creation timestamp |
| `updatedAt` | DateTime | `@updatedAt` | Last modification timestamp |

**`productIds` format:**
```json
["gid://shopify/Product/111", "gid://shopify/Product/222", "gid://shopify/Product/333"]
```

This field is populated by paginating through the collection's products via the Shopify Admin API (250 products per page).

**Indexes:**
| Index | Fields | Purpose |
|-------|--------|---------|
| `gid` | gid | UNIQUE constraint - lookup by Shopify Global ID |
| `@@index([shop])` | shop | Find all collections for a shop |
| `@@index([shop, gid])` | shop, gid | Compound lookup for shop-scoped collection by GID |

**Lifecycle:**
- Created: By `storeCollectionData()` when a collection is first encountered during discount resolution
- Updated: By `storeCollectionData()` with `forceRefresh: true` when the `collections_update` webhook fires
- Deleted: During shop uninstall (transactional cleanup)

---

## Model: Product

Local cache of Shopify product data, including variant IDs and pricing metadata. Used for variant resolution and to determine if a product has a single price point (affects UI rendering).

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `id` | String | UUID (auto) | Internal primary key |
| `gid` | String | **UNIQUE** | Shopify Global ID (e.g., `gid://shopify/Product/987654321`) |
| `title` | String | required | Product title (e.g., "Classic T-Shirt") |
| `handle` | String? | null | Shopify URL handle (e.g., `classic-t-shirt`). Used for handle-based product matching in the storefront API. |
| `shop` | String | required | Shop domain |
| `variantIds` | String | required | JSON array of variant GIDs for this product |
| `singlePrice` | Boolean | `false` | `true` when all variants have the same price (minVariantPrice == maxVariantPrice). Affects storefront UI: single-price products show simpler discount displays. |
| `createdAt` | DateTime | `now()` | Record creation timestamp |
| `updatedAt` | DateTime | `@updatedAt` | Last modification timestamp |

**`variantIds` format:**
```json
["gid://shopify/ProductVariant/111", "gid://shopify/ProductVariant/222"]
```

**`singlePrice` determination** (from `storeProductData()` in `store-data.server.js`):
```javascript
const singlePrice =
  typeof minAmount === "number" &&
  typeof maxAmount === "number" &&
  !Number.isNaN(minAmount) &&
  !Number.isNaN(maxAmount)
    ? minAmount === maxAmount
    : false;
```

This compares `priceRangeV2.minVariantPrice.amount` to `priceRangeV2.maxVariantPrice.amount` from the Shopify API. If the product only has one variant or all variants are the same price, `singlePrice` is `true`.

**Indexes:**
| Index | Fields | Purpose |
|-------|--------|---------|
| `gid` | gid | UNIQUE constraint - lookup by Shopify Global ID |
| `@@index([shop])` | shop | Find all products for a shop |
| `@@index([shop, gid])` | shop, gid | Compound lookup for shop-scoped product by GID |

**Lifecycle:**
- Created: By `storeProductData()` when a product is first encountered during discount resolution
- Updated: By `storeProductData()` with `forceRefresh: true` when the `products_update` webhook fires
- Deleted: During shop uninstall (transactional cleanup)

---

## Model: LiveDiscount

The lightweight display-state table that the storefront API queries. Each record represents a discount's current display eligibility, with optional exclusion reasons explaining why a discount cannot be shown.

This table exists as a separate entity from `Discount` because:
1. The storefront API only needs `gid`, `status`, `discountType`, and date fields -- querying the full `Discount` table would be wasteful
2. The `status` field has different semantics (display eligibility vs Shopify's discount status)
3. Exclusion tracking is a display concern, not a discount metadata concern

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `id` | String | UUID (auto) | Internal primary key |
| `gid` | String | **UNIQUE** | Shopify Global ID. Same value as `Discount.gid` -- this is the logical foreign key linking the two tables. |
| `shop` | String | required | Shop domain |
| `summary` | String? | null | Shopify-generated summary text (e.g., "20% off Summer Collection") |
| `discountType` | String | required | `CODE` or `AUTO` (same derivation as `Discount.discountType`) |
| `status` | String | `"LIVE"` | Display status. One of: `LIVE`, `HIDDEN`, `NOT_SUPPORTED`, `UPGRADE_REQUIRED`, `SCHEDULED` |
| `startsAt` | DateTime | required | When the discount becomes active |
| `endsAt` | DateTime? | null | When the discount expires. Null means no end date. |
| `exclusionReason` | String? | null | Machine-readable reason why the discount cannot be displayed. Null when status is `LIVE`, `HIDDEN`, or `SCHEDULED`. |
| `exclusionDetails` | String? | null | Human-readable explanation for the merchant (shown in the app UI). Null when no exclusion. |
| `createdAt` | DateTime | `now()` | Record creation timestamp |
| `updatedAt` | DateTime | `@updatedAt` | Last modification timestamp |

### Status Values and Their Meaning

| Status | Meaning | Storefront Visible? | exclusionReason |
|--------|---------|--------------------|-----------------|
| `LIVE` | Discount is active, eligible, and within the shop's tier limit. It will be served to the storefront. | Yes | null |
| `HIDDEN` | Discount is eligible but the merchant has not promoted it to LIVE, or the shop has reached its tier limit for LIVE discounts. | No | null |
| `NOT_SUPPORTED` | Discount uses features that cannot be displayed on product pages (non-product class, BXGY, customer segments, minimum requirements). | No | One of: `NOT_PRODUCT_DISCOUNT`, `CUSTOMER_SEGMENT`, `MIN_REQUIREMENT`, `BXGY_DISCOUNT` |
| `UPGRADE_REQUIRED` | Discount uses a feature that requires a higher pricing tier. | No | One of: `SUBSCRIPTION_TIER`, `VARIANT_TIER`, `FIXED_AMOUNT_TIER` |
| `SCHEDULED` | Discount exists but its `startsAt` is in the future. Will automatically become eligible when the start date passes. | No | null |

### Status Determination Logic

The status is determined by `updateLiveDiscountData()` in this priority order:

```
1. Is discount EXPIRED or past endDate?
   -> DELETE from both Discount and LiveDiscount tables

2. Is discountClass != PRODUCT?
   -> status = NOT_SUPPORTED, reason = NOT_PRODUCT_DISCOUNT

3. Is __typename a BXGY discount?
   -> status = NOT_SUPPORTED, reason = BXGY_DISCOUNT

4. Is customer selection != ALL?
   -> status = NOT_SUPPORTED, reason = CUSTOMER_SEGMENT

5. Has minimumRequirement?
   -> status = NOT_SUPPORTED, reason = MIN_REQUIREMENT

6. Tier gating checks:
   a. Subscription discount on non-ADVANCED tier?
      -> status = UPGRADE_REQUIRED, reason = SUBSCRIPTION_TIER
   b. Variant-specific on non-ADVANCED tier?
      -> status = UPGRADE_REQUIRED, reason = VARIANT_TIER
   c. Fixed amount on FREE tier?
      -> status = UPGRADE_REQUIRED, reason = FIXED_AMOUNT_TIER

7. No exclusions:
   a. startsAt is in the future?
      -> status = SCHEDULED
   b. Shopify status == ACTIVE and not past endDate?
      -> status = LIVE (if within tier limit)
      -> status = HIDDEN (if over tier limit)
   c. Otherwise:
      -> status = HIDDEN
```

### Exclusion Tracking Fields

| exclusionReason | exclusionDetails (example) | Status |
|----------------|---------------------------|--------|
| `NOT_PRODUCT_DISCOUNT` | "This order type cannot be displayed on product pages. Only product-level discounts are supported." | NOT_SUPPORTED |
| `BXGY_DISCOUNT` | "Buy X Get Y discounts cannot be displayed on product pages. These discounts require cart-level calculations." | NOT_SUPPORTED |
| `CUSTOMER_SEGMENT` | "This discount is limited to specific customer groups and cannot be displayed publicly on your storefront." | NOT_SUPPORTED |
| `MIN_REQUIREMENT` | "This discount requires a minimum cart value or quantity, which cannot be verified on the product page." | NOT_SUPPORTED |
| `SUBSCRIPTION_TIER` | "Subscription discounts require the Advanced plan. Your current plan is Free." | UPGRADE_REQUIRED |
| `VARIANT_TIER` | "Variant-specific discounts require the Advanced plan. Your current plan is Basic." | UPGRADE_REQUIRED |
| `FIXED_AMOUNT_TIER` | "Fixed-amount discounts require the Basic plan or higher. Your current plan is Free." | UPGRADE_REQUIRED |
| null | null | LIVE, HIDDEN, or SCHEDULED |

**Indexes:**
| Index | Fields | Purpose |
|-------|--------|---------|
| `gid` | gid | UNIQUE constraint - lookup by Shopify Global ID |
| `@@index([shop])` | shop | Find all live discounts for a shop |
| `@@index([shop, status])` | shop, status | **Primary storefront query**: find LIVE discounts for a shop efficiently |

**Lifecycle:**
- Created: By `updateLiveDiscountData()` via upsert (on webhook or reprocess)
- Updated: By `updateLiveDiscountData()` via upsert (on webhook, reprocess, or tier change)
- Deleted: By `removeDiscountEverywhere()` for expired/deleted discounts, by `checkAndCleanupExpiredDiscounts()` for past-endDate records, or during shop uninstall

---

## Model: SetupTask

Tracks onboarding checklist items shown on the merchant's dashboard. Each task guides the merchant through app configuration steps.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `id` | String | UUID (auto) | Internal primary key |
| `shop` | String | required | Shop domain |
| `title` | String | required | Task title (e.g., "Enable the theme extension"). Part of the unique constraint with `shop`. |
| `description` | String | required | Detailed task description shown to the merchant |
| `buttonText` | String | required | Call-to-action button label (e.g., "Go to Theme Editor") |
| `buttonUrl` | String | required | URL the button navigates to |
| `buttonVariant` | String | `"secondary"` | Polaris button variant: `"primary"`, `"secondary"`, etc. |
| `target` | String? | null | Link target: `"_blank"` for external links, null for in-app navigation |
| `isManual` | Boolean | `false` | `true` = merchant can mark the task complete manually (checkbox). `false` = task completion is determined programmatically by the app. |
| `isCompleted` | Boolean | `false` | Whether the task has been completed |
| `order` | Int | `0` | Sort order for displaying tasks in the dashboard (lower = first) |
| `createdAt` | DateTime | `now()` | Record creation timestamp |
| `updatedAt` | DateTime | `@updatedAt` | Last modification timestamp |

**Indexes:**
| Index | Fields | Purpose |
|-------|--------|---------|
| `@@unique([shop, title])` | shop, title | Ensures each task title is unique per shop (prevents duplicate tasks) |
| `@@index([shop])` | shop | Find all setup tasks for a shop |

**Lifecycle:**
- Created: During dashboard data loading, when setup tasks are initialized for a new shop
- Updated: When a merchant completes a task (manual or automatic)
- Deleted: During shop uninstall (transactional cleanup)

---

## Model: PlanSubscriptionLog

Audit trail for all billing/subscription webhook events. This table is append-only and never cleaned up -- it serves as a permanent record of all plan changes for debugging and support.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `id` | String | UUID (auto) | Internal primary key |
| `shopId` | String? | null | Internal shop ID (from `Shop.id`). May be null if the shop record was not found at the time of the webhook. |
| `shopDomain` | String | required | Shop domain (always available from the webhook payload) |
| `topic` | String | required | Webhook topic (e.g., `APP_SUBSCRIPTIONS_UPDATE`, `APP_SUBSCRIPTIONS_ACTIVATE`) |
| `webhookId` | String? | null | Shopify webhook delivery ID for deduplication |
| `status` | String? | null | Subscription status from the payload (e.g., `ACTIVE`, `CANCELLED`, `DECLINED`, `FROZEN`, `PENDING`) |
| `subscriptionId` | String? | null | Shopify subscription GID (e.g., `gid://shopify/AppSubscription/123456`) |
| `planHandle` | String? | null | Machine-readable plan identifier (e.g., `BASIC`, `ADVANCED`) |
| `planName` | String? | null | Human-readable plan name (e.g., "Basic Plan") |
| `interval` | String? | null | Billing interval: `EVERY_30_DAYS` or `ANNUAL` |
| `priceAmount` | Float? | null | Subscription price amount (e.g., `9.99`) |
| `priceCurrency` | String? | null | Currency code for the price (e.g., `USD`) |
| `discountPercentage` | Float? | null | Active discount percentage on the subscription |
| `discountAmount` | Float? | null | Active discount amount on the subscription |
| `discountCurrency` | String? | null | Currency of the discount amount |
| `discountDurationLimit` | Int? | null | Total number of billing cycles the discount applies |
| `discountRemainingDuration` | Int? | null | Remaining billing cycles for the discount |
| `currentPeriodEnd` | DateTime? | null | End date of the current billing period |
| `trialDays` | Int? | null | Number of trial days configured |
| `trialEnd` | DateTime? | null | When the trial ends |
| `trialActive` | Boolean? | null | Whether a trial is currently active |
| `createdAt` | DateTime | `now()` | Record creation timestamp |
| `updatedAt` | DateTime | `@updatedAt` | Last modification timestamp |

**Indexes:**
| Index | Fields | Purpose |
|-------|--------|---------|
| `@@index([shopDomain, createdAt])` | shopDomain, createdAt | Query billing history for a shop in chronological order |
| `@@index([subscriptionId])` | subscriptionId | Look up all events for a specific subscription |

**Lifecycle:**
- Created: On every subscription webhook event (append-only)
- Updated: The `updatedAt` field auto-updates, but records are not intentionally updated
- Deleted: NEVER deleted, even on shop uninstall. This preserves the billing audit trail.

---

## Indexes and Query Patterns

### Primary Query Patterns

| Query Pattern | Table | Index Used | Where Called |
|--------------|-------|-----------|-------------|
| Find LIVE discounts for storefront display | LiveDiscount | `[shop, status]` | `api.discounts` loader |
| Find all discounts for a shop | Discount | `[shop]` | Dashboard, discount management pages |
| Find active discounts for a shop | Discount | `[shop, status]` | Reprocessing, cleanup |
| Find discount by GID | Discount | `gid` (unique) | Webhook handlers |
| Find live discount by GID | LiveDiscount | `gid` (unique) | `updateLiveDiscountData` status preservation |
| Find shop by domain | Shop | `domain` (unique) | Every authenticated request |
| Find sessions for a shop | Session | `[shop]` | Uninstall cleanup |
| Find collection by GID | Collection | `gid` (unique) | `storeCollectionData` upsert |
| Find product by GID | Product | `gid` (unique) | `storeProductData` upsert |
| Find products by handle | Product | none (full scan with `shop` filter) | `api.discounts` handle resolution |
| Find setup tasks for a shop | SetupTask | `[shop]` | Dashboard loader |
| Find billing history for a shop | PlanSubscriptionLog | `[shopDomain, createdAt]` | Admin/support debugging |
| Find shops with pending tier changes due | Shop | `[pendingTierEffectiveAt]` | `applyPendingTierIfDue` |
| Find collection for DB cache lookup | Collection | `[shop, gid]` | `getCollectionFromDB` |
| Find product for DB cache lookup | Product | `[shop, gid]` | `getProductFromDB` |
| Find discounts by shop + GID | Discount | `[shop, gid]` | Reprocess duplicate check |

### Compound Index Purposes

| Index | Table | Purpose |
|-------|-------|---------|
| `[shop]` | Session, Discount, Collection, Product, LiveDiscount, SetupTask | Partition data by shop for multi-tenant isolation |
| `[shop, status]` | Discount | Filter by shop and Shopify status (ACTIVE/EXPIRED/SCHEDULED) |
| `[shop, status]` | LiveDiscount | **Critical path**: storefront API queries for `status = 'LIVE'` per shop |
| `[shop, gid]` | Discount, Collection, Product | Shop-scoped GID lookups (faster than unique GID when shop is known) |
| `[shop, title]` | SetupTask | UNIQUE constraint to prevent duplicate tasks per shop |
| `[shopDomain, createdAt]` | PlanSubscriptionLog | Chronological billing history per shop |
| `[subscriptionId]` | PlanSubscriptionLog | Find all events for a specific Shopify subscription |
| `[pendingTierEffectiveAt]` | Shop | Find shops with pending tier changes that should now be applied |

---

## Data Lifecycle (Creation / Updates / Deletion)

### Creation Flow

```
Shop Install (afterAuth)
  |
  +-- Shop record created (or updated if existing)
  |     via getOrCreateShopTier()
  |
  +-- For each discount in Shopify (via reprocessAllDiscountsForShop):
  |     |
  |     +-- Collection records created (storeCollectionData)
  |     |     for collection-targeted discounts
  |     |
  |     +-- Product records created (storeProductData)
  |     |     for all resolved products
  |     |
  |     +-- Discount record created (storeDiscountData)
  |     |     storing full metadata
  |     |
  |     +-- LiveDiscount record created (updateLiveDiscountData)
  |           with status determination
  |
  +-- SetupTask records created
  |     during first dashboard visit
  |
  +-- PlanSubscriptionLog records created
        on subscription webhook events
```

### Update Flow

```
Discount Updated (webhook)
  |
  +-- Discount record upserted (storeDiscountData)
  +-- LiveDiscount record upserted (updateLiveDiscountData)
  +-- Related Collection/Product records updated if forceRefresh

Collection Updated (webhook)
  |
  +-- Collection record updated with new product list
  +-- All Discounts targeting this collection are re-resolved
  +-- Their LiveDiscount records are updated (preserveExistingStatus)

Product Updated (webhook)
  |
  +-- Product record updated (new variants, singlePrice)
  +-- All Discounts resolving to this product are re-resolved
  +-- Their LiveDiscount records are updated (preserveExistingStatus)

Tier Changed (subscription webhook)
  |
  +-- Shop.billingTier updated
  +-- Pending tier change scheduled (if downgrade)
  +-- UPGRADE_REQUIRED discounts re-evaluated
  +-- LiveDiscount statuses updated based on new tier
```

### Deletion Flow

```
Discount Deleted (webhook)
  |
  +-- Discount record deleted
  +-- LiveDiscount record deleted

Discount Expired (detected during update or cleanup)
  |
  +-- Discount record deleted (removeDiscountEverywhere)
  +-- LiveDiscount record deleted (removeDiscountEverywhere)

Periodic Cleanup (checkAndCleanupExpiredDiscounts)
  |
  +-- All Discount + LiveDiscount records with endsAt < now are deleted
  +-- Runs after every updateLiveDiscountData call

Shop Uninstall
  |
  +-- Session records: DELETED
  +-- LiveDiscount records: DELETED
  +-- Discount records: DELETED
  +-- Product records: DELETED
  +-- Collection records: DELETED
  +-- SetupTask records: DELETED
  +-- Shop record: RESET (tier=FREE, liveDiscountLimit=1, installStatus=null)
  +-- PlanSubscriptionLog: PRESERVED (audit trail)
```

---

## JSON Field Reference Table

A consolidated reference of all JSON-stored fields across the schema.

| Model | Field | Prisma Type | Contains | Example |
|-------|-------|-------------|----------|---------|
| Discount | `targetIds` | String | JSON array of Shopify GIDs (Collections, Products, or Variants) | `'["gid://shopify/Collection/123"]'` |
| Discount | `resolvedProductIds` | String | JSON array of Product GIDs | `'["gid://shopify/Product/111", "gid://shopify/Product/222"]'` |
| Discount | `resolvedVariantIds` | String | JSON array of ProductVariant GIDs | `'["gid://shopify/ProductVariant/333"]'` |
| Discount | `customerSegments` | String | JSON array (currently always empty) | `'[]'` |
| Discount | `codes` | String | JSON array of discount code strings | `'["SAVE10", "SUMMER"]'` |
| Discount | `minimumRequirement` | Json | Native JSON object or null | `{ "greaterThanOrEqualToSubtotal": { "amount": "50.00", "currencyCode": "USD" } }` |
| Collection | `productIds` | String | JSON array of Product GIDs | `'["gid://shopify/Product/111", "gid://shopify/Product/222"]'` |
| Product | `variantIds` | String | JSON array of ProductVariant GIDs | `'["gid://shopify/ProductVariant/444", "gid://shopify/ProductVariant/555"]'` |
| Shop | `pendingTierContext` | Json | Native JSON object or null | `{ "scheduledEffectiveAt": "2025-12-01T00:00:00.000Z" }` |

**Note on String vs Json types:** Most JSON fields use `String` type (serialized with `JSON.stringify()` and parsed with `JSON.parse()`). Only `minimumRequirement` and `pendingTierContext` use Prisma's native `Json` type, which stores the value as a native JSON column in SQLite. The `String` approach was used for the array fields because SQLite's JSON support is limited and Prisma's `Json` type does not support array-level query operators like `contains` for filtering.

**Parsing convention:** All `String`-typed JSON fields are parsed using `safeJsonParse(value, fallback)` from `discount-resolver/utils.server.js`, which returns the fallback (default `[]`) on parse errors. This prevents crashes from malformed data.
