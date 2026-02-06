# Webhook Handlers

This document describes every webhook handler in Discount Display Pro, including the registration configuration, processing patterns, error handling strategies, and the specific business logic each handler implements. Webhooks are the primary mechanism for keeping the app's local database synchronized with Shopify's state.

---

## Webhook Registration (shopify.app.toml)

All webhook subscriptions are declared in `shopify.app.toml`. Shopify registers these automatically when the app is deployed. The app subscribes to 13 webhooks across four categories:

**File:** `shopify.app.toml`

```toml
[webhooks]
api_version = "2025-10"
```

### Standard Webhooks (10 subscriptions)

| Topic | URI | Handler File |
|-------|-----|-------------|
| `app/uninstalled` | `/webhooks/app/uninstalled` | `webhooks.app.uninstalled.jsx` |
| `app/scopes_update` | `/webhooks/app/scopes_update` | (minimal handler) |
| `app_subscriptions/update` | `/webhooks/app/subscriptions_update` | `webhooks.app.subscriptions_update.jsx` |
| `discounts/create` | `/webhooks/app/discounts_create` | `webhooks.app.discounts_create.jsx` |
| `discounts/update` | `/webhooks/app/discounts_update` | `webhooks.app.discounts_update.jsx` |
| `discounts/delete` | `/webhooks/app/discounts_delete` | `webhooks.app.discounts_delete.jsx` |
| `collections/update` | `/webhooks/app/collections_update` | `webhooks.app.collections_update.jsx` |
| `collections/delete` | `/webhooks/app/collections_delete` | `webhooks.app.collections_delete.jsx` |
| `products/update` | `/webhooks/app/products_update` | `webhooks.app.products_update.jsx` |
| `products/delete` | `/webhooks/app/products_delete` | `webhooks.app.products_delete.jsx` |

### Compliance Webhooks (3 subscriptions)

| Compliance Topic | URI | Purpose |
|-----------------|-----|---------|
| `customers/data_request` | `/webhooks/app/customers_data_request` | GDPR: Respond to customer data access requests |
| `customers/redact` | `/webhooks/app/customers_redact` | GDPR: Delete customer personal data |
| `shop/redact` | `/webhooks/app/shop_redact` | GDPR: Delete all shop data after uninstall |

Compliance webhooks are mandatory for Shopify App Store approval. They use the `compliance_topics` key instead of `topics` in the TOML configuration.

---

## Webhook Processing Pattern

All webhook handlers follow a consistent pattern:

```js
export const action = async ({ request }) => {
  // 1. Authenticate the webhook
  const { shop, topic, payload, admin } = await authenticate.webhook(request);

  // 2. Validate required data
  if (!payload?.admin_graphql_api_id) {
    return new Response(null, { status: 200 });  // Non-retryable: bad payload
  }
  if (!admin) {
    return new Response(JSON.stringify({ error: 'Admin client unavailable' }), {
      status: 500  // Retryable: transient auth issue
    });
  }

  // 3. Process the webhook
  try {
    // Business logic here
    return new Response(null, { status: 200 });
  } catch (error) {
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500  // Retryable: unexpected error
    });
  }
};
```

### Authentication

Every handler starts with `await authenticate.webhook(request)`, which:

1. Validates the HMAC signature to ensure the request came from Shopify.
2. Returns the `shop` domain, `topic` name, raw `payload` object, and an `admin` GraphQL client (when available).

### Lazy Imports

Handlers use dynamic imports for the discount resolver modules:

```js
const { resolveDiscountTargets, storeDiscountData, updateLiveDiscountData } =
  await import("../utils/discount-resolver.server.js");
```

This keeps the import tree lightweight and avoids loading the entire discount resolver module for simple webhook handlers.

---

## Discount Webhooks

### discounts/create

**File:** `app/routes/webhooks.app.discounts_create.jsx`

**Triggered when:** A new discount is created in Shopify Admin.

**Process:**

1. **Validate payload:** Checks for `payload.admin_graphql_api_id`. Returns 200 if missing (non-retryable -- Shopify sent a malformed payload).

2. **Validate admin client:** Returns 500 if `admin` is unavailable (retryable -- transient auth issue).

3. **Fetch discount details:** Queries Shopify using `GET_DISCOUNT_NODE_QUERY` with the discount GID from the webhook payload. This fetches the complete discount structure using the shared `DISCOUNT_FRAGMENT`.

4. **Resolve targets:** Calls `resolveDiscountTargets(admin, discount.discount, shop, db)` to expand the discount's targeting rules into product and variant ID lists. If resolution returns `null`, falls back to `{ productIds: [], variantIds: [] }`.

5. **Store discount data:** Calls `storeDiscountData()` to persist the discount record in the `Discount` table.

6. **Update live discount:** Calls `updateLiveDiscountData()` with `preserveExistingStatus: true` to create or update the `LiveDiscount` record. The `preserveExistingStatus` flag means newly created discounts will start as HIDDEN rather than automatically going LIVE.

7. **Cleanup:** Calls `checkAndCleanupExpiredDiscounts()` to sweep for any expired discounts.

**Error handling:**
- GraphQL errors: Returns 500 (retryable).
- Processing errors: Returns 500 (retryable).
- Missing `admin_graphql_api_id`: Returns 200 (non-retryable).

### discounts/update

**File:** `app/routes/webhooks.app.discounts_update.jsx`

**Triggered when:** A discount is modified in Shopify Admin (title, value, targets, status, dates, etc.).

This is the most complex discount webhook handler because it must handle target changes, fallback to cached data, and forced cache invalidation.

**Process:**

1. **Validate and authenticate:** Same pattern as create.

2. **Fetch updated discount:** Queries Shopify using `GET_DISCOUNT_NODE_QUERY`. Returns 500 on GraphQL errors (retryable), 200 if no discount node found (discount may have been deleted between the webhook firing and processing).

3. **Handle incomplete structures:** Logs a warning if the discount has missing `title` or `status` fields but still processes it. This handles discount types like BxGy, FreeShipping, and App discounts that may have limited fields.

4. **Check existing record:** Queries the local database for an existing `Discount` record. This is used for the fallback logic in step 5.

5. **Resolve targets with force refresh:** Calls `resolveDiscountTargets()` with `{ forceRefresh: true }`. This is the critical difference from the create handler -- `forceRefresh` forces the pipeline to re-fetch collection and product data from Shopify rather than using cached data. This ensures that if a discount's targets changed (e.g., a new collection was added), the app picks up the change.

6. **Fallback to cached targets:** If `resolveDiscountTargets()` returns `null` (the discount is not a product discount or has no customerGets), the handler checks if a previous record exists in the database:

   ```js
   if (!resolved && existingDiscount) {
     const parsedProducts = JSON.parse(existingDiscount.resolvedProductIds || '[]');
     const parsedVariants = JSON.parse(existingDiscount.resolvedVariantIds || '[]');
     resolved = { productIds: parsedProducts, variantIds: parsedVariants };
   }
   ```

   This preserves existing target data even when the discount type changes to one that no longer has resolvable targets (e.g., a product discount changed to a shipping discount). Without this fallback, the discount would lose its target data.

   If no existing record exists either, falls back to `{ productIds: [], variantIds: [] }`.

7. **Store and update:** Calls `storeDiscountData()` and `updateLiveDiscountData()` with `preserveExistingStatus: true`.

8. **Post-store verification:** After storing, queries the database again to verify what was stored. This is a debugging aid that logs the stored `resolvedProductIds` and `targetIds`.

9. **Cleanup:** Calls `checkAndCleanupExpiredDiscounts()`.

**Error handling:**
- All processing errors return 500 (retryable).
- Missing payload data returns 200 (non-retryable).
- The outer try/catch ensures even unexpected errors return 500 for retry.

### discounts/delete

**File:** `app/routes/webhooks.app.discounts_delete.jsx`

**Triggered when:** A discount is deleted from Shopify Admin.

**Process:**

1. **Extract GID:** Gets `payload.admin_graphql_api_id` as the discount GID.

2. **Transactional delete:** Uses `db.$transaction` to atomically delete from both tables:

   ```js
   const [deleted, deletedLive] = await db.$transaction([
     db.discount.deleteMany({ where: { gid: discountGid, shop } }),
     db.liveDiscount.deleteMany({ where: { gid: discountGid, shop } }),
   ]);
   ```

   Using a transaction ensures both deletes succeed or fail together, preventing orphaned records.

3. **Logging:** Logs whether records were actually found and deleted (it is normal for a discount to not exist in the local database if it was never imported -- e.g., if it was a shipping discount).

4. **Cleanup:** Calls `checkAndCleanupExpiredDiscounts()`.

**Error handling:**
- Processing errors return 500 (retryable).
- Missing `admin_graphql_api_id` returns 200 (non-retryable).

**Note:** This handler does NOT need the `admin` GraphQL client since it only deletes local records. No Shopify API calls are needed.

---

## Collection Webhooks

### collections/update

**File:** `app/routes/webhooks.app.collections_update.jsx`

**Triggered when:** A collection is updated in Shopify Admin (title change, products added/removed, smart collection rules changed, etc.).

**Process:**

1. **Fetch updated collection:** Queries Shopify GraphQL for the collection's current products using paginated queries (250 products per page). Stores the full product list.

2. **Update collection in database:** Upserts the collection record with the updated title and product IDs:

   ```js
   await db.collection.upsert({
     where: { gid: collectionId },
     update: { title, shop, productIds: JSON.stringify(allProductIds), updatedAt },
     create: { gid: collectionId, title, shop, productIds: JSON.stringify(allProductIds) },
   });
   ```

3. **Find affected discounts:** Queries the `Discount` table for discounts with `targetType: 'COLLECTION'` whose `targetIds` field contains the collection GID:

   ```js
   const affectedDiscounts = await db.discount.findMany({
     where: { shop, targetType: 'COLLECTION', targetIds: { contains: collectionId } },
   });
   ```

4. **Re-resolve affected discounts:** For each affected discount:
   - Fetches the discount's current data from Shopify using an inline GraphQL query (covers `DiscountAutomaticBasic` and `DiscountCodeBasic` types).
   - Calls `resolveDiscountTargets()` to re-expand the targets with the updated collection membership.
   - Calls `storeDiscountData()` to update the Discount record with new resolved product IDs.
   - Calls `updateLiveDiscountData()` with `preserveExistingStatus: true`.

**Why this matters:** When products are added to or removed from a collection, any discount targeting that collection needs to be updated. Without this webhook, a discount targeting "Summer Sale" collection would not reflect newly added products until the next full reprocess.

**Error handling:**
- Individual discount update errors are caught and logged but do not prevent processing of other affected discounts.
- The handler always returns 200 (errors during re-resolution of individual discounts are not retryable since the collection data itself was already saved successfully).

### collections/delete

**File:** `app/routes/webhooks.app.collections_delete.jsx`

**Triggered when:** A collection is deleted from Shopify Admin.

**Process:**

1. **Find affected discounts:** Same query pattern as collections/update -- finds discounts targeting this collection.

2. **Re-resolve affected discounts:** For each affected discount, fetches current data from Shopify. If the discount still exists (the collection was deleted but the discount itself was not), re-resolves its targets. The collection will no longer appear in the discount's targeting rules, so the resolved product list will shrink accordingly.

3. **Handle missing discounts:** If the GraphQL query returns no data for a discount (it may have been deleted alongside the collection), logs a warning and continues.

4. **Delete collection from database:**

   ```js
   await db.collection.deleteMany({ where: { gid: collectionGid, shop } });
   ```

**Important ordering:** The affected discounts are re-resolved BEFORE the collection is deleted from the local database. This ensures the resolution logic can still access the collection's product list if needed during the transition.

**Error handling:** Always returns 200. Individual discount processing errors are caught per-discount and do not block the collection deletion.

---

## Product Webhooks

### products/update

**File:** `app/routes/webhooks.app.products_update.jsx`

**Triggered when:** A product is updated in Shopify Admin (title, price, variants, status, etc.).

**Process:**

1. **Fetch updated product:** Queries Shopify for the product's full details with paginated variant fetching (250 per page, max 10 iterations as a safety limit). Captures:
   - Product title and handle
   - `priceRangeV2` (min/max variant prices)
   - All variant GIDs

2. **Update product in database:** Computes `singlePrice` (whether all variants have the same price: `minAmount === maxAmount`), then upserts:

   ```js
   await db.product.upsert({
     where: { gid: productId },
     update: { title, handle, shop, variantIds: JSON.stringify(allVariantIds), singlePrice, updatedAt },
     create: { gid: productId, title, handle, shop, variantIds: JSON.stringify(allVariantIds), singlePrice },
   });
   ```

3. **Discount reprocessing (currently disabled):** The handler contains a large commented-out block that would find and re-resolve discounts targeting this product. This logic was disabled because product updates are very frequent (any variant price change, inventory update, etc.), and re-resolving discounts for every product update would cause excessive API calls. The product data update itself (step 2) is sufficient -- the storefront API uses the stored product data to check variant eligibility.

**Why `singlePrice` matters:** The storefront UI uses this flag to determine whether to show variant-specific pricing or a single price display. When all variants have the same price, the discount badge can show a simple "15% off" without variant selection concerns.

**Error handling:** Always returns 200. Even if the admin client is unavailable, the handler returns 200 rather than 500 (unlike discount webhooks) because product data updates are less critical and will be corrected on the next full reprocess.

### products/delete

**File:** `app/routes/webhooks.app.products_delete.jsx`

**Triggered when:** A product is deleted from Shopify Admin.

**Process:**

1. **Find affected discounts:** Queries for discounts with `targetType: 'PRODUCT'` whose `targetIds` contain the deleted product GID.

2. **Re-resolve affected discounts:** For each affected discount:
   - Fetches the discount's current data from Shopify.
   - Calls `resolveDiscountTargets()` to re-expand targets. Since the product no longer exists, it will naturally drop out of the resolved product IDs.
   - Calls `storeDiscountData()` and `updateLiveDiscountData()` with `preserveExistingStatus: true`.
   - If the discount itself is no longer valid in Shopify, logs a warning.

3. **Delete product from database:**

   ```js
   await db.product.deleteMany({ where: { gid: productGid, shop } });
   ```

**Important:** The affected discount re-resolution happens BEFORE the product record is deleted, similar to the collections/delete pattern.

**Error handling:** Always returns 200. Per-discount errors are caught individually.

---

## Billing Webhook (app_subscriptions/update)

**File:** `app/routes/webhooks.app.subscriptions_update.jsx`

**Triggered when:** A Shopify app subscription changes status (created, activated, cancelled, frozen, declined, expired).

This is the most complex webhook handler in the app. It manages the shop's pricing tier, handles trial periods, deferred downgrades, and triggers discount reprocessing when tiers change.

### Subscription Data Enrichment

The webhook payload from Shopify often lacks detailed subscription information (like `currentPeriodEnd` or `lineItems`). When this data is missing, the handler enriches it via a GraphQL query:

```graphql
query ManagedPricingSubscriptions {
  currentAppInstallation {
    activeSubscriptions {
      id
      name
      status
      trialDays
      currentPeriodEnd
      createdAt
      test
      lineItems {
        plan {
          pricingDetails {
            ... on AppRecurringPricing {
              planHandle
              interval
              price { amount currencyCode }
              discount {
                durationLimitInIntervals
                remainingDurationInIntervals
                value {
                  ... on AppSubscriptionDiscountPercentage { percentage }
                  ... on AppSubscriptionDiscountAmount { amount { amount currencyCode } }
                }
              }
            }
          }
        }
      }
    }
  }
}
```

The handler matches the enriched subscription by `id` to the one from the webhook payload, then merges the data. This provides access to `planHandle`, pricing details, and discount information that are not included in the webhook payload itself.

### Subscription Logging

Every subscription webhook is logged to the `PlanSubscriptionLog` table with comprehensive details:

| Field | Source |
|-------|--------|
| shopDomain | From webhook authentication |
| topic | Webhook topic |
| webhookId | `x-shopify-webhook-id` header |
| status | Subscription status |
| subscriptionId | Shopify subscription GID |
| planHandle | From recurring pricing details |
| planName | Subscription name |
| interval | EVERY_30_DAYS, ANNUAL |
| priceAmount | Recurring price amount |
| discountPercentage | Any app subscription discount |
| trialDays | Trial period length |
| trialEnd | Computed trial end date |
| currentPeriodEnd | Billing period end date |

### Status Handling

The handler processes subscription statuses in a specific order:

**1. DECLINED / EXPIRED -- Ignored**

```js
if (status === "DECLINED" || status === "EXPIRED") {
  return new Response();
}
```

These statuses apply only to NEW subscription attempts, not existing subscriptions. For example, if a merchant has BASIC and clicks "Upgrade to ADVANCED" but then declines, they stay on BASIC. The DECLINED webhook should not change their tier.

**2. CANCELLED -- Ignored**

```js
if (status === "CANCELLED") {
  return new Response();
}
```

Shopify always sends an ACTIVE webhook for the new plan (including FREE) alongside CANCELLED for the old plan. Processing CANCELLED would cause race conditions when webhooks arrive out of order during plan changes (e.g., BASIC to ADVANCED sends CANCELLED for BASIC + ACTIVE for ADVANCED).

**3. FROZEN -- Immediate downgrade to FREE**

```js
if (status === "FROZEN") {
  if (currentTier !== "FREE") {
    await updateShopTier(shop, "FREE", db, { source: "webhook:FROZEN", ... });
  }
  return new Response();
}
```

FROZEN means payment failed. Unlike CANCELLED, there is no guaranteed follow-up ACTIVE webhook. If payment resumes later, Shopify will send a new ACTIVE webhook that restores the tier.

**4. Non-active statuses (PENDING, etc.) -- Logged and ignored**

**5. ACTIVE / ACCEPTED -- Full processing** (see below)

### Tier Resolution from Subscription

The handler resolves the tier from the subscription's plan name and handle:

```js
const resolvedTier = resolveTierFromPlanName(planName, planHandle);
const nextTier = resolvedTier || "FREE";
```

`resolveTierFromPlanName()` (from `shopify.server.js`) normalizes both `planHandle` and `planName` and checks against the set of valid tiers. It prioritizes `planHandle` over `planName`. If neither matches a known tier, returns `null` which defaults to FREE.

### Upgrade vs Downgrade Logic

The handler distinguishes between upgrades, downgrades, and same-tier renewals:

**Upgrades (or same price):** `newPrice >= currentPrice` -- Applied immediately:

```js
if (newPrice >= currentPrice || !allowDeferredDowngrade) {
  await updateShopTier(shop, nextTier, db, { source: "webhook:APP_SUBSCRIPTIONS_UPDATE", ... });
}
```

If the tier actually changed, triggers `reprocessAllDiscountsForShop()` to re-evaluate all discounts against the new tier's feature gates.

**Downgrades:** `newPrice < currentPrice` -- Deferred to end of billing period:

```js
await scheduleShopTierChange(shop, nextTier, effectiveAt, db, { ... });
```

The downgrade is scheduled for `subscriptionCurrentPeriodEnd` (or the stored `billingCurrentPeriodEnd`). The merchant keeps their current tier's features until the billing period ends. `scheduleShopTierChange()` stores the pending tier change in the `Shop` record's `pendingTier` and `pendingTierEffectiveAt` fields.

Even after scheduling a deferred downgrade, discounts are reprocessed immediately so the merchant can see which discounts will be affected.

**Trial period override:** If a trial is active (`isTrialActive`), deferred downgrades are NOT allowed -- the tier change is applied immediately instead. This prevents a merchant from starting a trial, downgrading, and continuing to use premium features during the "deferred" period.

### Trial Period Management

The handler computes trial end dates from the subscription's `trialDays` and `createdAt`:

```js
if (planTrialDays > 0 && createdAtDate) {
  computedTrialEndDate = new Date(createdAtDate);
  computedTrialEndDate.setDate(computedTrialEndDate.getDate() + planTrialDays);
}
```

If the `currentPeriodEnd` is earlier than the computed trial end, the trial end is clamped to `currentPeriodEnd`. Trial metadata is persisted on the `Shop` record (`trialEndsAt`, `trialRecordedAt`, `trialSourceSubscriptionId`) and cleared after processing.

### Billing Tier Synchronization

The handler maintains a `billingTier` field on the Shop record that tracks what Shopify considers the current plan, separate from the app's effective `tier` (which may be deferred). This is updated via raw SQL for efficiency:

```js
const sql = `UPDATE "Shop" SET "billingTier" = ?, "billingCurrentPeriodEnd" = ?, "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = ?`;
await db.$executeRawUnsafe(sql, ...params);
```

---

## App Lifecycle Webhooks (uninstalled, scopes_update)

### app/uninstalled

**File:** `app/routes/webhooks.app.uninstalled.jsx`

**Triggered when:** A merchant uninstalls the app from their Shopify store.

**Process:**

Calls `shopifyShopUninstall(db, shop)` which runs a database transaction to clean up all shop-specific data:

```js
return await db.$transaction([
  db.session.deleteMany({ where: { shop } }),
  db.liveDiscount.deleteMany({ where: { shop } }),
  db.discount.deleteMany({ where: { shop } }),
  db.product.deleteMany({ where: { shop } }),
  db.collection.deleteMany({ where: { shop } }),
  db.setupTask.deleteMany({ where: { shop } }),
  db.shop.updateMany({
    where: { domain: shop },
    data: { tier: "FREE", liveDiscountLimit: TIER_CONFIG.FREE.liveDiscountLimit, installStatus: null },
  }),
]);
```

**Key details:**
- Uses a transaction to ensure all deletions succeed or fail together.
- Deletes: sessions, live discounts, discounts, products, collections, setup tasks.
- Resets (not deletes) the Shop record to FREE tier with default limits. The Shop record is preserved to maintain billing history if the merchant reinstalls.
- Logs the count of deleted records for each table.

### app/scopes_update

**Triggered when:** The app's access scopes change (e.g., after a deployment that adds new required scopes).

This handler exists to satisfy Shopify's webhook registration requirements. It typically performs no application-level processing beyond logging.

---

## Compliance Webhooks

Three mandatory GDPR compliance webhooks are registered:

| Topic | URI | Purpose |
|-------|-----|---------|
| `customers/data_request` | `/webhooks/app/customers_data_request` | Responds to a customer's request for their personal data |
| `customers/redact` | `/webhooks/app/customers_redact` | Deletes a specific customer's personal data |
| `shop/redact` | `/webhooks/app/shop_redact` | Deletes all data for a shop (48 hours after uninstall) |

These webhooks are required for Shopify App Store compliance. Since Discount Display Pro does not store customer personal data (it only stores discount, product, and collection data), these handlers acknowledge the request and return success without needing to perform data deletion.

The `shop/redact` webhook is a safety net -- by the time it fires (48 hours after uninstall), the `app/uninstalled` handler should have already cleaned up all shop data.

---

## Retry and Idempotency Considerations

### HTTP Status Code Strategy

Shopify retries webhooks that return non-2xx status codes. The app uses a deliberate strategy for choosing status codes:

| Scenario | Status | Retryable? | Rationale |
|----------|--------|------------|-----------|
| Missing `admin_graphql_api_id` in payload | 200 | No | Bad payload will never become valid |
| Admin client unavailable | 500 | Yes | Transient auth issue, likely resolves on retry |
| GraphQL query errors | 500 | Yes | Could be rate limiting or temporary API issue |
| Internal processing error (catch block) | 500 | Yes | Transient errors may resolve |
| Discount not found in Shopify | 200 | No | Discount was deleted; retrying won't help |
| No discount data in response | 200 | No | Structural issue; retrying won't help |
| Collection/product webhooks (all cases) | 200 | No | These handlers always return 200 |

**Design principle:** Return 200 for errors that will never resolve on retry (bad data, missing resources). Return 500 for errors that are likely transient (auth failures, API rate limits, internal errors).

### Idempotency

Webhook handlers are designed to be idempotent -- processing the same webhook multiple times produces the same result:

1. **Upsert operations:** `storeDiscountData()` and `updateLiveDiscountData()` both use Prisma `upsert`, meaning a duplicate webhook simply overwrites the record with the same data.

2. **Delete operations:** `deleteMany` in the delete handlers is naturally idempotent -- deleting a non-existent record succeeds with `count: 0`.

3. **preserveExistingStatus:** This flag prevents repeated webhook processing from oscillating a discount's status. If a discount is already LIVE and the same webhook is processed again, the status stays LIVE rather than being re-evaluated.

4. **Subscription webhook:** The handler checks the current tier before making changes, and deferred downgrade scheduling is idempotent (re-scheduling with the same effective date is a no-op).

### Shopify Webhook Deduplication

Shopify may send duplicate webhooks. Each webhook includes an `x-shopify-webhook-id` header that can be used for deduplication. Currently, this header is only captured and logged in the subscription webhook handler (stored in `PlanSubscriptionLog.webhookId`) but is not used for programmatic deduplication. The app relies on idempotent operations instead.

### Out-of-Order Processing

Webhooks may arrive out of order. The most important case is the subscription webhook where CANCELLED and ACTIVE may arrive in either order during a plan change. The handler addresses this by ignoring CANCELLED entirely and only processing ACTIVE/ACCEPTED statuses.

For discount webhooks, out-of-order processing is handled by always fetching the current state from Shopify's API rather than relying on the webhook payload. This means even if `discounts/create` arrives after `discounts/update`, both will fetch and store the current state.
