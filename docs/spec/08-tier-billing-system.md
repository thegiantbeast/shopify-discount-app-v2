# Tier and Billing System

Discount Display Pro uses a three-tier pricing model (FREE, BASIC, ADVANCED) managed through Shopify's Managed Pricing infrastructure. The billing system tracks the merchant's subscription state, enforces feature and usage limits, and handles tier transitions including scheduled downgrades.

---

## Tier Configuration (FREE, BASIC, ADVANCED)

Tier definitions live in `app/utils/tier-manager.js` and are shared between server and browser code.

| Tier | Price | Live Discount Limit | Key Features |
|------|-------|---------------------|-------------|
| **FREE** | $0/month | 1 | Automatic and code discounts, product page + grids + collections, customizable UI, updated price in cart/checkout, Shopify native discount integration |
| **BASIC** | $9.99/month | 3 | All FREE features + auto-apply coupon option + fixed-price discount support |
| **ADVANCED** | $19.99/month | Unlimited | All BASIC features + subscription product compatibility + variant-specific discount support |

The configuration is defined as:

```javascript
export const TIER_CONFIG = {
  FREE: {
    name: "Free",
    liveDiscountLimit: 1,
    price: 0,
    features: [...]
  },
  BASIC: {
    name: "Basic",
    liveDiscountLimit: 3,
    price: 9.99,
    features: [...]
  },
  ADVANCED: {
    name: "Advanced",
    liveDiscountLimit: null,  // unlimited
    price: 19.99,
    features: [...]
  }
};
```

A `null` limit means unlimited. The `features` array contains display strings (some with `<b>` tags for UI emphasis).

---

## Feature Matrix

Features are gated by tier both on the server side (API responses, webhook processing) and in the storefront theme extension:

| Feature | FREE | BASIC | ADVANCED |
|---------|------|-------|----------|
| Percentage discounts | Yes | Yes | Yes |
| Fixed-amount discounts | No | Yes | Yes |
| Automatic discounts | Yes | Yes | Yes |
| Code (coupon) discounts | Yes | Yes | Yes |
| Auto-apply coupons (`aa` flag) | No | Yes | Yes |
| Subscription discount display | No | No | Yes |
| Variant-specific discounts (PARTIAL scope) | No | No | Yes |
| Live discount count | 1 | 3 | Unlimited |

The `aa` (auto-apply) flag in the `/api/discounts` response is `true` when the shop is BASIC or higher. This flag tells the storefront JavaScript whether it should auto-apply coupon codes to the cart.

---

## Shopify Managed Pricing Integration

The app uses Shopify's **Managed Pricing** (`unstable_managedPricingSupport: true` in the Shopify app configuration). This means:

- Pricing plans are defined in the Shopify Partner Dashboard, not in the app code.
- Shopify handles the billing UI, payment collection, and subscription lifecycle.
- The app receives subscription data through the authentication flow and webhook events.
- Plan changes are initiated by directing merchants to the Shopify pricing page.

**Plan selection URL construction** (`buildPlanSelectionUrl` in `app/shopify.server.js`):

```
https://admin.shopify.com/store/{storeHandle}/charges/{appSlug}/pricing_plans
```

Where:
- `{storeHandle}` is derived from the shop domain by stripping `.myshopify.com`.
- `{appSlug}` is the app's Shopify App Store slug, resolved via `getShopifyAppStoreSlug()`.

**Plan name resolution** (`resolveTierFromPlanName`): Shopify provides plan names and handles in subscription data. The resolver normalizes these to uppercase and checks against the valid tier keys (`FREE`, `BASIC`, `ADVANCED`). It checks `planHandle` first, then falls back to `planName`.

**Test billing**: The `SHOPIFY_BILLING_USE_TEST` environment variable controls whether test charges are used (defaults to `true` unless explicitly set to `"false"`).

---

## Shop Record Billing Fields (tier vs billingTier vs pendingTier)

The `Shop` database model maintains several billing-related fields that serve distinct purposes:

| Field | Type | Description |
|-------|------|-------------|
| `tier` | string | The **effective** tier -- what the shop actually operates at right now. This is the field used for all feature gating and limit enforcement. |
| `billingTier` | string | What Shopify's billing system reports as the current plan. Usually matches `tier`, but can differ temporarily during scheduled downgrades. |
| `pendingTier` | string or null | A **scheduled future tier** that will take effect at `pendingTierEffectiveAt`. Used for deferred downgrades. |
| `pendingTierEffectiveAt` | DateTime or null | When the `pendingTier` should be applied. Typically set to `billingCurrentPeriodEnd`. |
| `pendingTierSourceSubscriptionId` | string or null | The Shopify subscription ID that triggered the pending change. |
| `pendingTierContext` | JSON or null | Serialized context metadata about the pending change (stage, dates, previous tier). |
| `billingCurrentPeriodEnd` | DateTime or null | End of the current billing period from Shopify's subscription data. |
| `billingStatus` | string or null | Current subscription status from Shopify (e.g., `"ACTIVE"`, `"CANCELLED"`). |
| `liveDiscountLimit` | number or null | Cached copy of the tier's live discount limit for quick access. |
| `trialEndsAt` | DateTime or null | When a trial period ends. |
| `trialRecordedAt` | DateTime or null | When the trial was first recorded. |
| `trialSourceSubscriptionId` | string or null | Subscription ID associated with the trial. |

### Why three tier fields?

The distinction between `tier`, `billingTier`, and `pendingTier` handles the common case where a merchant **downgrades** their plan:

- **Immediate upgrade**: When upgrading (e.g., FREE to BASIC), `tier` and `billingTier` both change immediately. Features are available right away.
- **Deferred downgrade**: When downgrading (e.g., ADVANCED to BASIC), Shopify typically lets the merchant keep the higher tier until the end of the billing period. In this case:
  - `tier` stays at `ADVANCED` (merchant keeps features).
  - `billingTier` may update to `BASIC` (what Shopify reports).
  - `pendingTier` is set to `BASIC` with `pendingTierEffectiveAt` = `billingCurrentPeriodEnd`.
  - When the effective date passes, `tier` switches to `BASIC`.

---

## Tier Resolution (getEffectiveTierFromShopRecord)

The `getEffectiveTierFromShopRecord(shop)` function in `app/utils/tier-manager.js` determines the effective tier from a shop record. It is designed to be safe and browser-compatible (no async, no DB access):

```javascript
export function getEffectiveTierFromShopRecord(shop) {
  const candidates = [
    typeof shop?.tier === 'string' ? shop.tier : null,
  ].filter((value) => value && TIER_KEYS.includes(value));

  if (candidates.length === 0) {
    return 'FREE';
  }

  const sorted = candidates.sort(
    (a, b) => TIER_KEYS.indexOf(a) - TIER_KEYS.indexOf(b)
  );
  return sorted[0] || 'FREE';
}
```

Key behavior:
- Uses only `shop.tier` as the source of truth for the effective tier.
- Validates that the value is a recognized tier key.
- Falls back to `FREE` if the tier is missing, invalid, or unrecognized.
- Sorts by tier order (FREE < BASIC < ADVANCED) and picks the first, effectively picking the lowest valid candidate.

---

## Tier Changes (Immediate and Scheduled)

### Immediate Tier Update

`updateShopTier(shopDomain, newTier, db, options)` in `app/utils/tier-manager.server.js`:

- Validates the new tier against `TIER_CONFIG`.
- Updates `tier` and `liveDiscountLimit` immediately.
- Optionally updates `billingTier` if `updateBillingTier: true`.
- Clears `pendingTier` fields if the pending tier matches the new tier (and `clearPending: true`).
- Resets `billingCurrentPeriodEnd` to null.

### Scheduled Tier Change (Downgrade)

`scheduleShopTierChange(shopDomain, targetTier, effectiveAt, db, options)`:

- Sets `pendingTier` to the target tier.
- Sets `pendingTierEffectiveAt` to the provided date (or falls back to `billingCurrentPeriodEnd`).
- Records `billingSubscriptionId` and context metadata.
- Updates `billingTier` to the target tier and `billingCurrentPeriodEnd`.
- Does **not** change `tier` -- the merchant keeps their current tier until the effective date.

### Applying Pending Tier

`applyPendingTierIfDue(shopDomain, db)` and `applyPendingTierIfDueInternal(shop, db)` in `app/utils/tier-manager/pending-tier.server.js`:

- Checks if `pendingTier` and `pendingTierEffectiveAt` are set.
- If the effective date has passed (`effectiveAt <= now`), applies the tier change:
  - Sets `tier`, `billingTier`, and `liveDiscountLimit` to the pending tier values.
  - Clears all pending fields (`pendingTier`, `pendingTierEffectiveAt`, `pendingTierSourceSubscriptionId`, `pendingTierContext`).
  - Clears `billingCurrentPeriodEnd`.
- If the pending tier is invalid (not in `TIER_CONFIG`), clears the pending data without applying.
- This function is called during `getOrCreateShopTier()`, meaning it runs on every dashboard load and API call that resolves the shop tier.

### Clearing a Pending Change

`clearPendingTierChange(shopDomain, db)`:

- Removes all pending tier fields.
- Resets `billingTier` to match the current `tier`.
- Clears `billingCurrentPeriodEnd`.

---

## Billing Status Tracking

### Subscription Status Sync

`updateShopBillingStatus(shopDomain, status, db)` in `app/utils/tier-manager.server.js`:

- Normalizes the status string (trim, uppercase).
- Updates the `billingStatus` field on the Shop record.
- Called during subscription reconciliation.

### Billing Metadata Sync

`syncBillingMetadata(shop, activeSubscription)` in `app/utils/dashboard-data.server.js`:

- Called when the dashboard loader has a fresh subscription payload from Shopify.
- Syncs `billingCurrentPeriodEnd` from the subscription's `currentPeriodEnd`.
- If a `pendingTier` exists but has no `pendingTierEffectiveAt`, backfills it with the period end date.
- Returns `{ changed: boolean, appliedUpdates?: string[] }`.

### Tier Reconciliation from Subscription

`reconcileTierFromSubscription(shop, subscription)` in `app/utils/dashboard-data.server.js`:

- Called when the dashboard detects a subscription snapshot that disagrees with the stored tier.
- Resolves the tier from the subscription's plan name, plan handle, or pricing details handle.
- If the resolved tier differs from `billingTier`, updates the shop via `updateShopTier()` with `updateBillingTier: true`.
- Also updates `billingStatus` from the subscription status.
- This serves as a **self-healing mechanism** that corrects tier drift on every dashboard visit.

---

## Live Discount Limit Enforcement

### Checking Limits

`canHaveMoreLiveDiscounts(shopDomain, db)` in `app/utils/tier-manager.server.js`:

1. Resolves the shop's effective tier.
2. Calls `refreshUpgradeRequiredDiscounts()` to re-evaluate any discounts that were blocked by tier gating.
3. Gets the tier's `liveDiscountLimit` from `TIER_CONFIG`.
4. If the limit is `null` (ADVANCED tier), returns `{ canCreate: true, reason: "Unlimited tier" }`.
5. Counts current `LIVE` status discounts in `LiveDiscount`.
6. Returns:

```javascript
{
  canCreate: boolean,       // true if count < limit
  reason: string,           // "Within limit" or "Tier limit reached"
  currentCount: number,     // current LIVE discount count
  limit: number,            // tier's limit
  tier: string              // effective tier name
}
```

On error, defaults to allowing creation (fail-open) with FREE tier limits.

### Atomic Limit Enforcement

`getLiveDiscountState(shopDomain, tierConfig, db)` in `app/utils/tier-manager/live-discount-helpers.server.js`:

Uses a **database transaction** to atomically check and enforce limits:

1. Within a transaction, counts `LIVE` discounts.
2. If the count **exceeds** the tier limit (not just meets it), hides **all** live discounts by setting their status to `HIDDEN` in both the `Discount` and `LiveDiscount` tables.
3. Returns `{ liveDiscountCount, enforcedLimit }`.

This atomic enforcement prevents race conditions where concurrent webhook handlers could bypass limits. The enforcement is aggressive -- if the limit is exceeded, all discounts are hidden rather than trying to pick which ones to keep.

### Refresh After Tier Upgrade

`refreshUpgradeRequiredDiscounts(shopDomain, tier, db)` in `app/utils/tier-manager/live-discount-helpers.server.js`:

When a shop upgrades, discounts that were previously blocked by tier gating (status `UPGRADE_REQUIRED`) may become eligible:

- **BASIC** unlocks: `FIXED_AMOUNT_TIER` exclusion reason.
- **ADVANCED** unlocks: `SUBSCRIPTION_TIER`, `VARIANT_TIER`, and `FIXED_AMOUNT_TIER` exclusion reasons.

The function finds `UPGRADE_REQUIRED` discounts with matching exclusion reasons and changes their status based on the underlying discount's schedule (SCHEDULED if start date is in the future, HIDDEN otherwise for re-evaluation).

---

## Feature Gating (evaluateTierGating)

`evaluateTierGating(discountData, shop, db)` in `app/utils/discount-resolver/tier-gating.server.js`:

This function is called during discount resolution (webhook processing) to determine tier-based restrictions for a specific discount:

```javascript
export async function evaluateTierGating(discountData, shop, db) {
  const shopTier = await getOrCreateShopTier(shop, db);
  const tier = getEffectiveTierFromShopRecord(shopTier);
  const isAdvanced = tier === "ADVANCED";
  const isBasicOrHigher = tier !== "FREE";

  const hasVariantTargets = /* checks customerGets.items for productVariants */;
  const appliesOnSubscription = !!discountData.customerGets?.appliesOnSubscription;

  return { tier, isAdvanced, isBasicOrHigher, hasVariantTargets, appliesOnSubscription };
}
```

The returned flags are used by the discount resolver to decide whether to store a discount as `LIVE` or `UPGRADE_REQUIRED`:

| Condition | Required Tier | Exclusion Reason |
|-----------|--------------|------------------|
| Fixed-amount discount | BASIC+ | `FIXED_AMOUNT_TIER` |
| Subscription discount | ADVANCED | `SUBSCRIPTION_TIER` |
| Variant-specific targets | ADVANCED | `VARIANT_TIER` |

Additionally, the `/api/discounts` endpoint applies the same gating when serving data to the storefront:
- FREE tier: excludes fixed-amount discounts.
- Non-ADVANCED: excludes subscription discounts and variant-specific (PARTIAL scope) discounts.

---

## Trial Support

The Shop record includes trial-related fields:

| Field | Purpose |
|-------|---------|
| `trialEndsAt` | When the trial period expires. |
| `trialRecordedAt` | When the trial was first recorded in the database. |
| `trialSourceSubscriptionId` | The Shopify subscription ID associated with the trial. |

Trial data is tracked via the `reconcileTierFromSubscription` flow, which extracts `trialDays` from the subscription snapshot metadata. The `buildDefaultShop()` function initializes all trial fields to `null`.

Trial management relies on Shopify's managed pricing infrastructure -- the app records trial metadata for display purposes but Shopify handles trial expiration and conversion to paid subscriptions.

---

## Default Shop Fallback

`buildDefaultShop(domain)` in `app/utils/tier-manager/default-shop.server.js` creates a minimal FREE-tier shop record used as a fallback when database operations fail:

```javascript
{
  id: "default",
  domain,
  tier: "FREE",
  liveDiscountLimit: 1,        // TIER_CONFIG.FREE.liveDiscountLimit
  billingTier: "FREE",
  billingCurrentPeriodEnd: null,
  pendingTier: null,
  pendingTierEffectiveAt: null,
  pendingTierSourceSubscriptionId: null,
  pendingTierContext: null,
  trialEndsAt: null,
  trialRecordedAt: null,
  trialSourceSubscriptionId: null,
  createdAt: new Date(),
  updatedAt: new Date()
}
```

This ensures the app never crashes due to missing tier data -- it gracefully degrades to FREE tier functionality.
