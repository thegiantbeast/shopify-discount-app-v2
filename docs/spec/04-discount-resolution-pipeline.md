# Discount Resolution Pipeline

This document describes the complete backend pipeline that fetches discounts from Shopify, resolves their product/variant targets, stores them in the local database, determines their display eligibility, and serves them to the storefront. This pipeline is the core engine of Discount Display Pro.

---

## Pipeline Overview

The discount resolution pipeline transforms raw Shopify discount data into storefront-ready display records. It operates through six sequential steps:

```
Shopify GraphQL API
       |
       v
[Step 1] fetchInitialDiscounts()     -- Lightweight bulk fetch with filters
       |
       v
[Step 2] GET_DISCOUNT_NODE_QUERY     -- Detailed per-discount fetch
       |
       v
[Step 3] resolveDiscountTargets()    -- Expand collections/products/variants to product IDs
       |
       v
[Step 4] storeDiscountData()         -- Persist to Discount table
         storeCollectionData()       -- Persist collection-to-product mappings
         storeProductData()          -- Persist product-to-variant mappings
       |
       v
[Step 5] updateLiveDiscountData()    -- Evaluate eligibility, write to LiveDiscount table
       |
       v
[Step 6] checkAndCleanupExpiredDiscounts()  -- Remove expired records from both tables
```

Additional processes run outside the main pipeline:

- **Reprocessing** (`reprocessAllDiscountsForShop`): Full re-sync of all discounts from Shopify.
- **Backfill** (`ensureLiveDiscountsForShop`): Creates missing LiveDiscount records from stored Discount data.
- **Best Discount Calculation** (`discount-math.server.js`): Determines which discount to display on the storefront API.

**Source files:**

| File | Purpose |
|------|---------|
| `app/utils/discount-resolver/fetchers.server.js` | GraphQL fetchers for discounts, collections, variants |
| `app/utils/discount-resolver/graphql-queries.server.js` | Shared GraphQL query definitions and fragments |
| `app/utils/discount-resolver/resolve-targets.server.js` | Expands discount targets to resolved product/variant IDs |
| `app/utils/discount-resolver/discount-storage.server.js` | Stores discount data in the Discount table |
| `app/utils/discount-resolver/store-data.server.js` | Stores collection and product data in their respective tables |
| `app/utils/discount-resolver/live-discount-updater.server.js` | Evaluates eligibility, writes to LiveDiscount table |
| `app/utils/discount-resolver/backfill.server.js` | Backfills missing LiveDiscount records |
| `app/utils/discount-resolver/reprocess.server.js` | Full reprocessing of all discounts for a shop |
| `app/utils/discount-resolver/tier-gating.server.js` | Evaluates tier-based feature gating |
| `app/utils/discount-resolver/status-utils.server.js` | Discount type computation and temporal logic |
| `app/utils/discount-resolver/cleanup.server.js` | Removes expired discounts from both tables |
| `app/utils/discount-resolver/db-cache.server.js` | Database cache lookups for collections and products |
| `app/utils/discount-resolver/utils.server.js` | Shared utilities (GID parsing, JSON parsing, type checks) |
| `app/utils/discount-math.server.js` | Best discount calculation and price math |

---

## Step 1: Initial Fetch (fetchInitialDiscounts)

**File:** `fetchers.server.js` -- `fetchInitialDiscounts(admin, shop)`

This is the lightweight bulk-fetch step used during the initial discount import. It fetches up to 250 discount nodes from Shopify in a single query and applies client-side filtering to discard discounts that cannot be displayed on the storefront.

### GraphQL Query

```graphql
query getInitialDiscounts {
  discountNodes(first: 250, query: "status:active AND discount_class:product") {
    pageInfo { hasNextPage endCursor }
    edges {
      node {
        id
        discount {
          __typename
          ... on DiscountCodeBasic { startsAt endsAt summary context { __typename } minimumRequirement { ... } customerSelection { __typename } }
          ... on DiscountAutomaticBasic { startsAt endsAt summary context { __typename } minimumRequirement { ... } }
        }
      }
    }
  }
}
```

**Server-side filter:** `status:active AND discount_class:product` -- This tells Shopify to only return active, product-class discounts. This excludes shipping discounts, order discounts, and inactive/scheduled/expired discounts at the API level.

### Client-Side Filtering

After the GraphQL response arrives, two additional filters are applied:

1. **Minimum requirement exclusion:** Any discount with `minimumRequirement.greaterThanOrEqualToSubtotal` or `minimumRequirement.greaterThanOrEqualToQuantity` is excluded. These discounts require cart-level conditions that cannot be verified on a product page.

2. **Customer segment exclusion:** The function checks the `context` field (for automatic discounts) or `customerSelection` field (for code discounts). If the `__typename` does not include "all" (case-insensitive), the discount is excluded. Only discounts available to all customers can be publicly displayed.

### Return Value

Returns an array of lightweight discount objects:

```js
{
  gid: "gid://shopify/DiscountAutomaticNode/12345",
  summary: "15% off all products",
  __typename: "DiscountAutomaticBasic",
  startsAt: "2024-01-01T00:00:00Z",
  endsAt: null
}
```

**Note:** This step fetches only summary-level data. The detailed discount data (value, targets, codes) is fetched in Step 2 via `GET_DISCOUNT_NODE_QUERY`.

---

## Step 2: Detailed Fetch (GET_DISCOUNT_NODE_QUERY)

**File:** `graphql-queries.server.js`

After the initial fetch identifies which discounts exist, each discount is fetched individually using `GET_DISCOUNT_NODE_QUERY`. This query uses the shared `DISCOUNT_FRAGMENT` to retrieve the complete discount structure.

### Query Structure

```graphql
query GetDiscountNode($id: ID!) {
  discountNode(id: $id) {
    id
    discount {
      ${DISCOUNT_FRAGMENT}
    }
  }
}
```

The `DISCOUNT_FRAGMENT` handles all 8 Shopify discount types through inline fragments. Each type queries only the fields that actually exist on that type:

| Discount Type | Key Fields |
|---------------|-----------|
| `DiscountAutomaticBasic` | title, status, startsAt, endsAt, summary, discountClass, discountClasses, context, minimumRequirement, customerGets (items + value) |
| `DiscountCodeBasic` | All of the above + codesCount, codes (first 100) |
| `DiscountAutomaticBxgy` | title, status, startsAt, endsAt, summary, discountClass, discountClasses, context, customerGets |
| `DiscountCodeBxgy` | All of Bxgy above + codesCount, codes |
| `DiscountAutomaticFreeShipping` | title, status, startsAt, endsAt, summary, discountClass, discountClasses, context, minimumRequirement |
| `DiscountCodeFreeShipping` | All of FreeShipping above + codesCount, codes |
| `DiscountAutomaticApp` | title, status, startsAt, endsAt, discountClass, discountClasses, context (NO summary field) |
| `DiscountCodeApp` | All of App above + codesCount, codes (NO summary field) |

### customerGets Structure

For Basic and Bxgy types, the `customerGets` field contains:

- **`appliesOnOneTimePurchase`** (Boolean): Whether the discount applies to one-time purchases.
- **`appliesOnSubscription`** (Boolean): Whether the discount applies to subscription purchases.
- **`items`**: The target items, which can be one of:
  - `DiscountCollections` -- collections targeted (up to 100 nodes).
  - `DiscountProducts` -- products targeted (up to 100 nodes) and/or productVariants targeted (up to 100 nodes).
- **`value`**: The discount value, which can be:
  - `DiscountPercentage` -- `{ percentage }` (a number like `-15.0` representing 15% off).
  - `DiscountAmount` -- `{ amount { amount, currencyCode } }` (a fixed amount).

### Pagination Note

The `GET_ALL_DISCOUNTS_QUERY` (used by reprocessing, not the initial import) fetches 100 discounts per page with cursor-based pagination:

```graphql
query getAllDiscounts($after: String) {
  discountNodes(first: 100, after: $after) {
    pageInfo { hasNextPage endCursor }
    edges { node { id discount { ${DISCOUNT_FRAGMENT} } } }
  }
}
```

This query does NOT apply the `status:active AND discount_class:product` filter -- it fetches ALL discounts so the pipeline can evaluate every discount and properly set exclusion reasons in the LiveDiscount table.

---

## Step 3: Target Resolution (resolveDiscountTargets)

**File:** `resolve-targets.server.js` -- `resolveDiscountTargets(admin, discountData, shop, db, options)`

This step expands the discount's targeting rules into concrete lists of product GIDs and variant GIDs. A discount can target collections, products, or variants -- this function resolves all three into flat ID lists.

### Process

1. **Validate discount class:** Calls `isProductDiscount()` to check if the discount's `discountClass` or `discountClasses[0]` equals "PRODUCT" (case-insensitive). Returns `null` if not a product discount.

2. **Validate customerGets:** Returns `null` if `discountData.customerGets` or `discountData.customerGets.items` is missing.

3. **Iterate items:** Uses `ensureArray()` to normalize `items` (which may be an object or array depending on the Shopify response), then processes each item:

   - **Collections:** For each collection node, parses the GID to extract the numeric ID, then calls `fetchCollectionProducts()` to get all product GIDs in that collection. Each product is also stored via `storeProductData()`.

   - **Products:** Directly adds each product GID to the resolved set. Calls `storeProductData()` for each.

   - **Product Variants:** For each variant, calls `fetchVariantProductAndAllVariants()` to look up the parent product. Adds both the variant GID and the parent product GID to their respective sets.

4. **Return:** Returns `{ productIds: [...], variantIds: [...] }` or `null` if the discount is not a product discount.

### Collection Product Fetching (fetchCollectionProducts)

**File:** `fetchers.server.js` -- `fetchCollectionProducts(admin, collectionId, shop, db, options)`

Fetches all product GIDs belonging to a collection. Uses cursor-based pagination (250 products per page) to handle large collections.

**Caching behavior:**
- First checks the local database via `getCollectionFromDB()` (from `db-cache.server.js`).
- If cached data exists and `forceRefresh` is not set, returns cached product IDs immediately.
- If fetching from Shopify, stores/updates the collection data via `storeCollectionData()`.

### Variant Product Fetching (fetchVariantProductAndAllVariants)

**File:** `fetchers.server.js` -- `fetchVariantProductAndAllVariants(admin, variantGid, shop, db, options)`

Given a variant GID, resolves the parent product and fetches all sibling variants.

1. Queries Shopify for the variant's parent product ID.
2. Checks the local database cache via `getProductFromDB()`.
3. If not cached (or `forceRefresh`), fetches all variant IDs for the product with cursor-based pagination.
4. Stores/updates the product data via `storeProductData()`.
5. Returns `{ productId, variantIds }`.

### The forceRefresh Option

When `options.forceRefresh` is `true`, all cache lookups are bypassed and data is re-fetched from Shopify. This is used by the `discounts/update` webhook handler to ensure target data is current after a discount is modified.

---

## Step 4: Data Storage (storeDiscountData, storeCollectionData, storeProductData)

### storeDiscountData

**File:** `discount-storage.server.js` -- `storeDiscountData(discountId, discountData, resolvedData, shop, db)`

Persists the complete discount record to the `Discount` table using Prisma `upsert`. This function stores ALL discounts regardless of eligibility -- the exclusion logic is handled in Step 5.

**Fields stored:**

| Field | Source | Notes |
|-------|--------|-------|
| `gid` | `discountId` | Shopify GID (primary key for upsert) |
| `shop` | `shop` | Shop domain |
| `title` | `discountData.title` | Falls back to "Untitled discount" |
| `status` | `discountData.status` | Shopify status (ACTIVE, EXPIRED, etc.) |
| `startsAt` | `getTemporalBounds()` | ISO string |
| `endsAt` | `getTemporalBounds()` | ISO string or null |
| `summary` | `discountData.summary` | Human-readable description |
| `discountClass` | `getDiscountClassValue()` | "PRODUCT", "SHIPPING", etc. |
| `discountType` | `computeDiscountType()` | "AUTO" or "CODE" |
| `targetType` | Derived from items | "COLLECTION", "PRODUCT", or "UNKNOWN" |
| `targetIds` | JSON array | Original collection/product/variant GIDs from Shopify |
| `resolvedProductIds` | JSON array | All resolved product GIDs |
| `resolvedVariantIds` | JSON array | All resolved variant GIDs |
| `valueType` | From `customerGets.value` | "PERCENTAGE" or "AMOUNT" |
| `percentage` | From `value.percentage` | The percentage value (e.g., `-15.0` from Shopify) |
| `amount` | From `value.amount.amount` | Parsed as float |
| `currencyCode` | From `value.amount.currencyCode` | e.g., "USD" |
| `appliesOnOneTimePurchase` | Boolean | From `customerGets` |
| `appliesOnSubscription` | Boolean | From `customerGets` |
| `customerSelectionAll` | Boolean | Whether it applies to all customers |
| `customerSegments` | JSON string | Always `"[]"` currently |
| `codes` | JSON array of strings | Discount codes (for CODE type) |
| `minimumRequirement` | Object or null | Raw Shopify minimum requirement data |

**Important design note:** This function stores ALL discounts, even ones that will be excluded from display. This ensures merchants can see all their discounts in the app dashboard, with clear explanations for why some cannot be displayed on the storefront. The exclusion logic lives in `updateLiveDiscountData()` (Step 5).

### storeCollectionData

**File:** `store-data.server.js` -- `storeCollectionData(admin, collectionGid, shop, db, options)`

Fetches and stores a collection's metadata and product list in the `Collection` table.

**Process:**
1. Checks if collection already exists in DB. If it does and `forceRefresh` is false, returns early.
2. Queries Shopify for the collection's title and all product IDs (with pagination, 250 per page).
3. Upserts the collection record with `title`, `shop`, and `productIds` (JSON-encoded array of product GIDs).

### storeProductData

**File:** `store-data.server.js` -- `storeProductData(admin, productGid, shop, db, options)`

Fetches and stores a product's metadata, variant list, and price range in the `Product` table.

**Process:**
1. Checks if product already exists in DB. If it does and `forceRefresh` is false, returns early.
2. Queries Shopify for the product's title, handle, `priceRangeV2` (min/max variant prices), and all variant IDs (with pagination).
3. Computes `singlePrice` boolean: `true` if `minVariantPrice.amount === maxVariantPrice.amount` (all variants have the same price).
4. Upserts the product record with `title`, `handle`, `shop`, `variantIds` (JSON-encoded array), and `singlePrice`.

---

## Step 5: LiveDiscount Update (updateLiveDiscountData)

**File:** `live-discount-updater.server.js` -- `updateLiveDiscountData(discountId, discountData, shop, db, opts)`

This is the most critical step in the pipeline. It evaluates whether a discount can be displayed on the storefront and writes the result to the `LiveDiscount` table with an appropriate status and optional exclusion reason.

The function performs checks in a specific priority order. Once an exclusion reason is found, subsequent checks are skipped.

### Pre-check: Expiration

Before any exclusion checks, the function checks if the discount has expired:

1. **Status-based expiration:** If `discountData.status === "EXPIRED"`, calls `removeDiscountEverywhere()` which deletes the record from BOTH the `Discount` and `LiveDiscount` tables, then returns.

2. **Date-based expiration:** If the discount's `endsAt` date is in the past (`isPastEndDate(endsAt, now)`), same deletion behavior.

### Exclusion Checks (in priority order)

Each check runs only if no previous exclusion reason has been set. The order matters because some checks are more fundamental than others.

**Check 1: Non-product discount (NOT_PRODUCT_DISCOUNT)**

```js
const isProductClass = isProductDiscount(discountData);
```

Calls `isProductDiscount()` which checks if `discountClass` (or `discountClasses[0]`) equals "PRODUCT" (case-insensitive). If not a product discount (e.g., SHIPPING, ORDER), the discount is excluded.

- Status: `NOT_SUPPORTED`
- Detail: "This {discountClass} type cannot be displayed on product pages. Only product-level discounts are supported."

**Check 2: Buy X Get Y (BXGY_DISCOUNT)**

```js
const discountTypeName = discountData.__typename || '';
const isBxgyDiscount = discountTypeName.includes('Bxgy');
```

Checks the `__typename` for the string "Bxgy". BXGY discounts (both automatic and code-based) require cart-level calculations and cannot be accurately displayed on product pages.

- Status: `NOT_SUPPORTED`
- Detail: "Buy X Get Y discounts cannot be displayed on product pages. These discounts require cart-level calculations."

**Check 3: Customer segment (CUSTOMER_SEGMENT)**

```js
const selection = discountData.context;
const appliesToAllCustomers = isAllCustomersSelection(selection);
```

Uses the `context` field's `__typename` to determine if the discount applies to all customers. If `__typename` is present and does NOT include "all" (case-insensitive), the discount is restricted to specific customer groups and cannot be publicly displayed.

- Status: `NOT_SUPPORTED`
- Detail: "This discount is limited to specific customer groups and cannot be displayed publicly on your storefront."

**Check 4: Minimum requirement (MIN_REQUIREMENT)**

```js
if (discountData.minimumRequirement) { ... }
```

If any minimum requirement object exists (subtotal or quantity), the discount is excluded because the app cannot verify cart-level conditions on a product page.

- Status: `NOT_SUPPORTED`
- Detail: "This discount requires a minimum cart value or quantity, which cannot be verified on the product page."

**Check 5: Tier-based exclusions (SUBSCRIPTION_TIER, VARIANT_TIER, FIXED_AMOUNT_TIER)**

This check calls `evaluateTierGating()` which looks up the shop's current tier and evaluates feature eligibility. Three sub-checks are performed in order:

| Sub-check | Condition | Required Tier | Exclusion Reason |
|-----------|-----------|---------------|-----------------|
| Subscription discount | `appliesOnSubscription === true` | ADVANCED | `SUBSCRIPTION_TIER` |
| Variant-targeted discount | Has variant targets in `customerGets.items.productVariants.nodes` | ADVANCED | `VARIANT_TIER` |
| Fixed-amount discount | `customerGets.value.amount` exists | BASIC or higher | `FIXED_AMOUNT_TIER` |

- Status: `UPGRADE_REQUIRED`
- Details include the shop's current tier name.
- If the tier check itself throws an error, the discount defaults to `SUBSCRIPTION_TIER` exclusion with a generic error message and `NOT_SUPPORTED` status.

### Status Determination

If no exclusion reason was found, the function determines the display status:

1. **SCHEDULED:** If the current time is before the discount's `startsAt` date.
2. **LIVE:** If `discountData.status === "ACTIVE"` AND the discount hasn't ended (no `endsAt` or `now <= endsAt`).
3. **HIDDEN:** Default fallback for any other case.

### Tier Limit Enforcement

After determining a status of LIVE, the function checks whether the shop can have more live discounts:

```js
if (status === "LIVE" && (!existingLiveDiscount || existingLiveDiscount.status !== "LIVE")) {
  const tierCheck = await canHaveMoreLiveDiscounts(shop, db);
  if (!tierCheck.canCreate) {
    status = "HIDDEN";
  }
}
```

This only applies when a discount is being newly promoted to LIVE (not already LIVE). The `canHaveMoreLiveDiscounts()` function from `tier-manager.server.js` checks the shop's tier-specific limit on the number of simultaneously live discounts. If the limit is reached, the discount stays HIDDEN instead of going LIVE.

### preserveExistingStatus Option

When `opts.preserveExistingStatus` is `true`, the function respects existing status values to avoid accidentally changing a discount's visibility:

```js
if (opts.preserveExistingStatus && existingLiveDiscount) {
  const preservableStatuses = ["LIVE", "HIDDEN", "SCHEDULED"];
  if (preservableStatuses.includes(existingLiveDiscount.status)) {
    status = existingLiveDiscount.status;
  }
}
```

**When it is used:**
- During webhook processing (`discounts/create`, `discounts/update`) -- prevents a webhook from automatically promoting a HIDDEN discount to LIVE.
- During `reprocessAllDiscountsForShop` -- prevents bulk reprocessing from accidentally changing manually set statuses.
- During backfill (`ensureLiveDiscountsForShop`) -- new backfilled records default to HIDDEN.

**When `preserveExistingStatus` is true and no existing record exists:**
```js
if (opts.preserveExistingStatus && !existingLiveDiscount) {
  status = "HIDDEN";
}
```

New discounts discovered during reprocessing or webhook handling start as HIDDEN rather than automatically going LIVE. The merchant must manually activate them from the dashboard.

### Exclusion Reason Constants

```js
const EXCLUSION_REASONS = {
  NOT_PRODUCT_DISCOUNT: 'NOT_PRODUCT_DISCOUNT',
  CUSTOMER_SEGMENT: 'CUSTOMER_SEGMENT',
  MIN_REQUIREMENT: 'MIN_REQUIREMENT',
  BXGY_DISCOUNT: 'BXGY_DISCOUNT',
  SUBSCRIPTION_TIER: 'SUBSCRIPTION_TIER',
  VARIANT_TIER: 'VARIANT_TIER',
  FIXED_AMOUNT_TIER: 'FIXED_AMOUNT_TIER',
};
```

Each exclusion reason has a corresponding human-readable explanation in `EXCLUSION_DETAILS` that is stored in the `exclusionDetails` field of the LiveDiscount record and displayed to merchants in the app dashboard.

### LiveDiscount Upsert

Finally, the LiveDiscount record is written:

```js
await db.liveDiscount.upsert({
  where: { gid: discountId },
  update: { summary, discountType, status, startsAt, endsAt, exclusionReason, exclusionDetails, updatedAt },
  create: { gid: discountId, shop, summary, discountType, status, startsAt, endsAt, exclusionReason, exclusionDetails },
});
```

After the upsert, `checkAndCleanupExpiredDiscounts()` is called to garbage-collect any expired records.

### removeDiscountEverywhere

When a discount is expired (by status or by end date), this helper deletes it from BOTH tables:

```js
async function removeDiscountEverywhere(discountId, shop, db) {
  await db.liveDiscount.deleteMany({ where: { gid: discountId, shop } });
  await db.discount.deleteMany({ where: { gid: discountId, shop } });
}
```

---

## Step 6: Cleanup (checkAndCleanupExpiredDiscounts)

**File:** `cleanup.server.js` -- `checkAndCleanupExpiredDiscounts(shop, db)`

Called at the end of every LiveDiscount update and during most webhook handlers. It performs a sweep of both the `Discount` and `LiveDiscount` tables to find and remove records whose `endsAt` date is in the past.

**Process:**

1. Queries both tables in parallel for records where `endsAt` is non-null and less than the current time.
2. Merges the GIDs from both result sets into a deduplicated array.
3. Deletes matching records from both tables in parallel using `deleteMany`.
4. Returns `{ cleaned: totalDeletedRecords, total: uniqueExpiredGids }`.

**Note:** This is a shop-scoped operation -- it only cleans up discounts for the specified shop.

---

## Reprocessing (reprocessAllDiscountsForShop)

**File:** `reprocess.server.js` -- `reprocessAllDiscountsForShop(admin, shop, db)`

A full re-sync operation that fetches ALL discounts from Shopify (not just active product discounts) and processes each one through the pipeline. This is triggered by:

- Tier changes (subscription upgrades/downgrades) via the `subscriptions_update` webhook.
- Manual rebuild from the `app.rebuild` route.

### Process

1. **Paginated fetch:** Uses `GET_ALL_DISCOUNTS_QUERY` to fetch all discounts with cursor-based pagination (100 per page). Unlike the initial import, this query has no `status:active AND discount_class:product` filter.

2. **Per-discount processing:** For each discount node:
   - Checks if the discount already exists in the local database (`db.discount.findFirst`).
   - Calls `resolveDiscountTargets()` to resolve product/variant targets. If resolution returns `null`, falls back to empty targets.
   - Calls `storeDiscountData()` to upsert the Discount record.
   - Calls `updateLiveDiscountData()` with `preserveExistingStatus: true` to update the LiveDiscount record without accidentally promoting HIDDEN discounts.
   - Tracks whether each discount was added, deleted, or updated.

3. **Backfill:** After processing all Shopify discounts, calls `ensureLiveDiscountsForShop()` to create LiveDiscount records for any Discount records that are missing a corresponding LiveDiscount.

4. **Return:** Returns statistics: `{ total, processed, updated, added, deleted, backfilled }`.

---

## Backfill (ensureLiveDiscountsForShop)

**File:** `backfill.server.js` -- `ensureLiveDiscountsForShop(shop, db)`

Creates missing LiveDiscount records for discounts that exist in the Discount table but have no corresponding LiveDiscount record. This can happen when:

- A discount was stored during a previous pipeline run but the LiveDiscount step failed.
- Database corruption or partial writes occurred.
- The app was upgraded and the LiveDiscount table structure changed.

### Process

1. Fetches all LiveDiscount GIDs for the shop.
2. Queries the Discount table for records whose GID is NOT in the LiveDiscount set.
3. For each missing discount, calls `buildDiscountDataFromStoredDiscount()` to reconstruct a `discountData` object from the stored Discount record.
4. Calls `updateLiveDiscountData()` with `preserveExistingStatus: true` for each reconstructed discount.

### buildDiscountDataFromStoredDiscount

This internal function reconstructs the data structure that `updateLiveDiscountData()` expects from a stored Discount database record:

```js
{
  title,
  status,
  startsAt,
  endsAt,
  summary,
  discountClass,
  context: {
    __typename: customerSelectionAll ? "DiscountBuyerSelectionAll" : "DiscountCustomerSegments"
  },
  minimumRequirement,
  customerGets: {
    appliesOnOneTimePurchase: Boolean(discount.appliesOnOneTimePurchase),
    appliesOnSubscription: Boolean(discount.appliesOnSubscription),
    items: [{ products: { nodes: [{ id }] }, productVariants: { nodes: [{ id }] } }],
    value: { percentage } or { amount: { amount, currencyCode } }
  }
}
```

**Note:** The reconstructed `items` only includes the FIRST product and variant ID from the stored arrays. This is sufficient for the exclusion checks in `updateLiveDiscountData()` (which only needs to know IF variants exist, not ALL variants), but means backfilled records may have incomplete target data for the storefront API. The full target data remains in the Discount table's `resolvedProductIds` and `resolvedVariantIds` fields.

---

## Best Discount Calculation (discount-math.server.js)

**File:** `app/utils/discount-math.server.js`

This module handles server-side discount calculation logic for the storefront API. When a product page requests discount data, this module determines which discount offers the best value.

### Core Functions

#### calculateDiscountedPrice(regularPriceCents, discount)

Calculates the final price after applying a discount.

- **Percentage discounts:** `discountAmount = Math.floor(regularPriceCents * (percentage / 100))`. The `Math.floor()` ensures the discount amount is always rounded down (in favor of the merchant). The percentage is clamped between 0 and 100.
- **Fixed-amount discounts:** The amount is clamped between 0 and `regularPriceCents` to prevent negative prices.
- Final price is always `Math.max(0, discountedPrice)` -- never goes below zero.

#### calculateActualSavings(regularPriceCents, discount)

Calculates the savings amount (in cents) for a given discount. Uses the same math as `calculateDiscountedPrice` but returns just the savings amount.

#### isDiscountEligibleForVariant(discount, currentVariantId)

Determines if a discount applies to a specific variant:

- **`scope.type === "ALL"`:** Discount applies to all variants. Always eligible.
- **`scope.type === "PARTIAL"`:** Discount applies to specific variants only. Checks if `currentVariantId` is in the `scope.ids` array. If `currentVariantId` is null/undefined, returns `false` (cannot verify eligibility for partial discounts without a variant selection).

#### findBestDiscount(discounts, regularPriceCents, currentVariantId)

Finds the single best discount from a list:

1. Filters to only eligible discounts (via `isDiscountEligibleForVariant`).
2. If only one eligible discount, returns it directly.
3. If multiple, compares by savings amount. On a tie, compares by raw `discount.value` (higher value wins).

#### findBestDiscounts(discounts, regularPriceCents, currentVariantId)

Splits discounts into automatic and coupon groups, then finds the best of each:

```js
const automaticDiscounts = discounts.filter(d => d.isAutomatic);
const couponDiscounts = discounts.filter(d => !d.isAutomatic);
const automatic = findBestDiscount(automaticDiscounts, ...);
const coupon = findBestDiscount(couponDiscounts, ...);
```

Returns both the best automatic discount and the best coupon discount.

#### resolveBestDiscounts({ discounts, regularPriceCents, currentVariantId })

The top-level function called by the API. Determines the final discount(s) to display:

1. Calls `findBestDiscounts()` to get the best automatic and best coupon.
2. **Automatic beats or ties coupon rule:** If both exist, compares their final prices (or savings if prices are not available). If the automatic discount produces a price less than or equal to the coupon's price, the coupon is nulled out:

```js
if (automaticDiscount && couponDiscount) {
  const automaticBeatsCoupon = automaticFinalPrice <= couponFinalPrice;
  if (automaticBeatsCoupon) {
    couponDiscount = null;
    couponFinalPrice = null;
    couponSavings = null;
  }
}
```

**Rationale:** If the automatic discount is already as good as or better than the coupon, there is no reason to show the coupon -- the customer gets the better deal automatically. The coupon is only shown when it provides additional savings beyond the automatic discount.

3. Returns:
```js
{
  automaticDiscount,
  couponDiscount,
  automaticEntry: { finalPriceCents, regularPriceCents },
  couponEntry: { finalPriceCents, regularPriceCents },
  basePriceCents
}
```

---

## GraphQL Query Definitions

**File:** `graphql-queries.server.js`

Three shared queries are defined:

| Query | Used By | Filter | Page Size |
|-------|---------|--------|-----------|
| Inline query in `fetchInitialDiscounts` | Initial import | `status:active AND discount_class:product` | 250 |
| `GET_DISCOUNT_NODE_QUERY` | Webhooks (create/update), per-discount fetch | By ID | Single |
| `GET_ALL_DISCOUNTS_QUERY` | `reprocessAllDiscountsForShop` | None (all discounts) | 100 |

All three use the `DISCOUNT_FRAGMENT` for consistent field selection, except the initial import query which uses a simpler inline fragment with only summary-level fields.

---

## Discount Type Computation (AUTO vs CODE)

**File:** `status-utils.server.js` -- `computeDiscountType(discountId)`

Determines whether a discount is automatic or code-based by examining the GID string:

```js
export function computeDiscountType(discountId) {
  return discountId.includes("DiscountCodeNode") ? "CODE" : "AUTO";
}
```

Shopify uses different GID patterns:
- **Automatic discounts:** `gid://shopify/DiscountAutomaticNode/12345`
- **Code discounts:** `gid://shopify/DiscountCodeNode/12345`

The distinction is critical because:
- AUTO discounts are applied automatically at checkout and displayed as badges on the storefront.
- CODE discounts require the customer to enter a code and are displayed as coupon blocks with the code visible.

---

## Temporal Logic (startsAt/endsAt, Scheduled status)

**File:** `status-utils.server.js`

### getTemporalBounds(discountData)

Parses and validates the temporal boundaries:

```js
export function getTemporalBounds(discountData) {
  let startsAt = discountData?.startsAt ? new Date(discountData.startsAt) : new Date();
  let endsAt = discountData?.endsAt ? new Date(discountData.endsAt) : null;
  if (Number.isNaN(startsAt?.valueOf?.())) startsAt = new Date();
  if (endsAt && Number.isNaN(endsAt?.valueOf?.())) endsAt = null;
  return { startsAt, endsAt };
}
```

- If `startsAt` is missing or invalid, defaults to the current time (assumes the discount starts immediately).
- If `endsAt` is missing, returns `null` (no end date -- runs indefinitely).
- If `endsAt` is present but invalid, returns `null`.

### isExpiredStatus(status)

Returns `true` if the Shopify status is `"EXPIRED"`.

### isPastEndDate(endsAt, now)

Returns `true` if `endsAt` is non-null and the current time is past it.

### Scheduled Status Logic

In `updateLiveDiscountData()`, a discount is marked as SCHEDULED when:

```js
if (!hasStarted) {
  status = "SCHEDULED";
}
```

Where `hasStarted` is `now >= startsAt`. This means discounts with a future `startsAt` date are stored in the LiveDiscount table but marked as SCHEDULED, allowing the app to display "upcoming discount" indicators if desired.

---

## Utility Functions

**File:** `utils.server.js`

### parseGid(gid)

Parses a Shopify GID string into its components:

```js
parseGid("gid://shopify/Collection/12345")
// Returns: { type: "Collection", id: "12345", fullGid: "gid://shopify/Collection/12345" }
```

### getDiscountClassValue(discountData)

Extracts the discount class from `discountData.discountClass` (string) or `discountData.discountClasses[0]` (array). Returns the first non-empty string found, or `null`.

### ensureArray(value)

Normalizes a value that may be an object, array, null, or undefined into an array. This handles Shopify's inconsistent response format where `items` may be a single object or an array depending on the discount configuration.

### isProductDiscount(discountData)

Returns `true` if the discount's class is "PRODUCT" (case-insensitive).

### isAllCustomersSelection(selection)

Returns `true` if the selection's `__typename` is missing, null, or includes "all" (case-insensitive). This treats missing customer selection data as "all customers" for safety.

### safeJsonParse(value, fallback)

Safely parses JSON strings, returning the `fallback` value (default `[]`) on parse errors. Used extensively when reading JSON-encoded arrays from the database.

---

## Database Cache (db-cache.server.js)

**File:** `db-cache.server.js`

Two functions provide fast cache lookups to avoid unnecessary GraphQL calls:

### getCollectionFromDB(collectionGid, shop, db)

Looks up a collection by GID and shop domain. Returns the parsed `productIds` array or `null` if not cached.

### getProductFromDB(productGid, shop, db)

Looks up a product by GID and shop domain. Returns the parsed `variantIds` array or `null` if not cached.

Both functions use `safeJsonParse` to handle any stored data corruption gracefully.

---

## Tier Gating (evaluateTierGating)

**File:** `tier-gating.server.js` -- `evaluateTierGating(discountData, shop, db)`

Evaluates a discount's eligibility based on the shop's current pricing tier. Called during Step 5 only after all non-tier exclusions have been cleared.

**Process:**

1. Calls `getOrCreateShopTier(shop, db)` to get the shop's record.
2. Calls `getEffectiveTierFromShopRecord(shopTier)` to compute the effective tier (which accounts for pending tier changes and trial periods).
3. Computes tier flags:
   - `isAdvanced = tier === "ADVANCED"`
   - `isBasicOrHigher = tier !== "FREE"`
4. Checks for variant targets in `discountData.customerGets.items` (looks for `productVariants.nodes` with length > 0).
5. Checks `discountData.customerGets.appliesOnSubscription`.

**Returns:**

```js
{
  tier: "FREE" | "BASIC" | "ADVANCED",
  isAdvanced: boolean,
  isBasicOrHigher: boolean,
  hasVariantTargets: boolean,
  appliesOnSubscription: boolean
}
```

The caller (`updateLiveDiscountData`) uses these flags to determine the specific tier exclusion:

| Feature | Required Tier | Exclusion if not met |
|---------|---------------|---------------------|
| Subscription discounts | ADVANCED | `SUBSCRIPTION_TIER` |
| Variant-specific discounts | ADVANCED | `VARIANT_TIER` |
| Fixed-amount discounts | BASIC or higher | `FIXED_AMOUNT_TIER` |
