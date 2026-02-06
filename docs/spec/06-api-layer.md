# API Layer

Discount Display Pro exposes three public API endpoints that the storefront theme extension calls to retrieve discount data, resolve the best discount for a given product/variant, and fetch theme-specific CSS selectors. All three endpoints are CORS-enabled and protected by per-shop storefront tokens.

---

## Authentication Overview

Every storefront-facing API route verifies a per-shop token before returning data. The token is a 64-character hex string generated during app installation, stored both in the local database (`Shop.storefrontToken`) and as a Shopify metafield (`discount_app.storefront_token`). The Liquid theme block reads the metafield and injects it into `window.DISCOUNT_STOREFRONT_TOKEN` so that client-side JavaScript can send it with every API request.

Authentication follows a **soft/hard enforcement model** controlled by the `STOREFRONT_AUTH_ENFORCE` environment variable:

| Mode | Behavior |
|------|----------|
| **Hard** (`STOREFRONT_AUTH_ENFORCE=true`) | Missing or invalid tokens return `403 Unauthorized`. |
| **Soft** (default) | Missing or invalid tokens are logged but the request is allowed through. This is useful during rollout or debugging. |

The `/api/theme-selectors` endpoint is the only route that does **not** require token authentication, because it returns generic CSS selector mappings that contain no shop-specific data.

---

## CORS Configuration

CORS headers are managed by `app/utils/cors.server.js`. The policy is deliberately permissive because Shopify stores can operate on arbitrary custom domains, making a strict origin whitelist impractical. The per-shop storefront token is the real server-side protection; CORS is defense-in-depth.

**Origin validation priority:**

1. **No origin header** (same-origin or server-to-server): Allowed.
2. **Blocked origins**: `http://localhost` and `http://127.0.0.1` are blocked in production. In development mode (`NODE_ENV=development`) these are allowed.
3. **Known Shopify patterns**: `*.myshopify.com`, `*.shopify.com`, `admin.shopify.com` are always allowed.
4. **App domains**: `*.wizardformula.pt` and `*.trycloudflare.com` (dev tunnels) are always allowed.
5. **Dev patterns**: `localhost` and `127.0.0.1` with any port are allowed only in development mode.
6. **Custom HTTPS domains**: Any valid HTTPS origin matching the pattern `https://<domain>.<tld>` is allowed. This is the fallback that enables custom storefront domains. These requests are logged for monitoring.
7. **Everything else**: Rejected with `Access-Control-Allow-Origin: null`.

Key implementation details:
- The response reflects the actual request `Origin` header (not a wildcard `*`), which is more secure.
- A `Vary: Origin` header is included for correct caching behavior.
- Preflight `OPTIONS` requests return a `200` with the appropriate CORS headers.
- Allowed methods are specified per-route (`GET` for `/api/discounts` and `/api/theme-selectors`; `POST` for `/api/best-discounts`).

---

## API: GET /api/discounts

**Source file:** `app/routes/api.discounts.jsx`

### Purpose

Returns all active discounts for a set of products, formatted for consumption by the storefront theme extension. This is the primary endpoint called by `e_discounts.js` on collection and product pages.

### Authentication

- **Token parameter**: `token` (query string)
- **Shop parameter**: `shop` (query string, required)
- Verification via `authenticateStorefrontRequest(shop, token, db)`
- Enforcement mode applies (soft or hard)

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `shop` | string | Yes | The shop domain (e.g., `my-store.myshopify.com`) |
| `token` | string | Yes* | Per-shop storefront token (*required in hard enforcement mode) |
| `productIds` | string | No | Comma-separated product IDs or Shopify GIDs. Can appear multiple times. |
| `variantIds` | string | No | Comma-separated variant IDs or Shopify GIDs. Can appear multiple times. |
| `handles` | string | No | Comma-separated product handles. Can appear multiple times. |

At least one of `productIds`, `variantIds`, or `handles` must be provided. If none are present, the endpoint returns `{ products: {} }` with a `200` status to prevent dumping all discounts.

Product handles are resolved to product IDs via a database lookup before filtering.

### Processing Logic

1. **Fetch live discounts**: Queries `LiveDiscount` records for the shop where `status = 'LIVE'`, `startsAt <= now`, and either `endsAt` is null or `endsAt > now`.

2. **Load tier info**: Retrieves the shop's current tier (FREE, BASIC, or ADVANCED) to apply feature gating.

3. **Preload detailed records**: Fetches full `Discount` records for all matched live discounts in a single query (avoids N+1).

4. **Process each discount**:
   - Validates structure (must have `gid`, `shop`, `status`).
   - Parses `resolvedProductIds`, `resolvedVariantIds`, and `targetIds` from JSON.
   - Filters to only discounts matching the requested products/variants.
   - Determines **variant scope** per product:
     - `ALL` if the discount targets the product directly or via a collection.
     - `PARTIAL` with specific variant IDs if the discount targets individual variants.
   - **Exclusion rules**:
     - Discounts with `minimumRequirement` are excluded (require cart context).
     - Fixed-amount discounts are excluded for FREE tier.
     - Subscription discounts are excluded for non-ADVANCED tiers.
     - Variant-specific discounts (PARTIAL scope) are excluded for non-ADVANCED tiers.
   - Extracts the first coupon code for `CODE` type discounts.

5. **Enrich products**: Fetches `handle` and `singlePrice` from the Product table.

6. **Build response**: Assembles the response payload with the `aa` (auto-apply) flag set based on tier.

### Response Format

```json
{
  "products": {
    "12345678": {
      "handle": "cool-product",
      "variants": {},
      "discounts": [
        {
          "variantScope": {
            "type": "ALL",
            "ids": []
          },
          "isAutomatic": true,
          "type": "percentage",
          "value": 20,
          "endDate": "2025-12-31",
          "appliesOnOneTimePurchase": true,
          "appliesOnSubscription": false
        },
        {
          "variantScope": {
            "type": "PARTIAL",
            "ids": ["44444444", "55555555"]
          },
          "isAutomatic": false,
          "type": "fixed",
          "value": 500,
          "endDate": null,
          "code": "SAVE5",
          "appliesOnOneTimePurchase": true,
          "appliesOnSubscription": false
        }
      ],
      "singlePrice": false
    }
  },
  "aa": true
}
```

**Field reference:**

| Field | Type | Description |
|-------|------|-------------|
| `products` | object | Keyed by numeric product ID (not GID). |
| `products[id].handle` | string or null | Product handle for URL-based matching. |
| `products[id].variants` | object | Reserved for variant-level data (currently empty). |
| `products[id].discounts` | array | Array of discount objects applicable to this product. |
| `products[id].singlePrice` | boolean | Whether the product has only one price (all variants same price). |
| `discounts[].variantScope.type` | `"ALL"` or `"PARTIAL"` | Whether the discount applies to all variants or specific ones. |
| `discounts[].variantScope.ids` | string[] | Numeric variant IDs (only populated when type is `PARTIAL`). |
| `discounts[].isAutomatic` | boolean | `true` for automatic discounts, `false` for code discounts. |
| `discounts[].type` | `"percentage"` or `"fixed"` | Discount value type. |
| `discounts[].value` | number | Discount amount. Percentage values are on a **0-100 scale** (e.g., 20 means 20%). Fixed values are in the store's minor currency unit (cents). |
| `discounts[].endDate` | string or null | ISO date string (`YYYY-MM-DD`) or null if no end date. |
| `discounts[].code` | string | Present only for code discounts. The coupon code to display/apply. |
| `discounts[].appliesOnOneTimePurchase` | boolean | Whether the discount applies to one-time purchases. |
| `discounts[].appliesOnSubscription` | boolean | Whether the discount applies to subscription purchases. |
| `aa` | boolean | Auto-apply eligible. `true` when the shop is on BASIC tier or higher, enabling coupon auto-apply on the storefront. |

---

## API: POST /api/best-discounts

**Source file:** `app/routes/api.best-discounts.jsx`

### Purpose

Given a batch of product/variant contexts with their current prices and applicable discounts, this endpoint calculates the best discount to display for each. It is called by the theme extension when it needs to determine which discount produces the greatest savings for a specific product at a specific price.

### Authentication

- **Token field**: `token` (in JSON body)
- **Shop field**: `shop` (in JSON body)
- Verification via `authenticateStorefrontRequest(shop, token, db)`
- Enforcement mode applies (soft or hard)

### Request Body

```json
{
  "shop": "my-store.myshopify.com",
  "token": "abc123...",
  "requests": [
    {
      "productId": "12345678",
      "variantId": "44444444",
      "regularPriceCents": 2999,
      "discounts": [
        {
          "type": "percentage",
          "value": 20,
          "isAutomatic": true,
          "variantScope": { "type": "ALL", "ids": [] },
          "appliesOnOneTimePurchase": true,
          "appliesOnSubscription": false
        }
      ],
      "purchaseContext": "one_time",
      "isSubscription": false
    }
  ]
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `shop` | string | No | Shop domain for token verification. |
| `token` | string | No | Per-shop storefront token. |
| `requests` | array | Yes | Array of resolution requests. Must be non-empty. |
| `requests[].productId` | string | Yes | Numeric product ID. |
| `requests[].variantId` | string | No | Numeric variant ID (for variant-scope filtering). |
| `requests[].regularPriceCents` | number | Yes | Current regular price in cents (minor currency unit). |
| `requests[].discounts` | array | Yes | Discount objects (same format as returned by `/api/discounts`). |
| `requests[].purchaseContext` | string | No | `"subscription"`, `"SUBSCRIPTION"`, `"one_time"`, or `"ONE_TIME"`. Filters discounts by purchase type. |
| `requests[].isSubscription` | boolean | No | Alternative to `purchaseContext` -- if `true`, filters to subscription-applicable discounts. |

### Processing Logic

For each request entry:

1. **Purchase context filtering**: Filters the discount array based on `purchaseContext` or `isSubscription`:
   - Subscription context: only discounts with `appliesOnSubscription === true`.
   - One-time context: only discounts with `appliesOnOneTimePurchase !== false`.
   - No context: all discounts pass.

2. **Normalization**: Normalizes discount type to lowercase (`"percentage"` or `"fixed"`), ensures value is a finite number, and sets `isAutomatic` flag.

3. **Best discount resolution**: Delegates to `resolveBestDiscounts()` from `discount-math.server.js`, which:
   - Checks variant eligibility (ALL scope passes, PARTIAL scope requires variant ID match).
   - Calculates actual savings for each eligible discount at the given price.
   - Selects the best automatic discount and best coupon discount independently.

4. **Result assembly**: Returns the best automatic and coupon discount for each product/variant combination.

### Response Format

```json
{
  "shop": "my-store.myshopify.com",
  "results": [
    {
      "productId": "12345678",
      "variantId": "44444444",
      "bestDiscounts": {
        "automaticDiscount": { "type": "percentage", "value": 20, "isAutomatic": true },
        "couponDiscount": null,
        "automaticEntry": { "type": "percentage", "value": 20, "isAutomatic": true },
        "couponEntry": null,
        "basePriceCents": 2999,
        "entryVariantId": "44444444"
      }
    }
  ],
  "errors": []
}
```

| Field | Type | Description |
|-------|------|-------------|
| `shop` | string or null | Echo of the request shop. |
| `results` | array | Successful resolutions. |
| `results[].productId` | string | Product ID from the request. |
| `results[].variantId` | string or null | Variant ID from the request. |
| `results[].bestDiscounts` | object | Best discount breakdown. |
| `results[].bestDiscounts.automaticDiscount` | object or null | Best automatic discount. |
| `results[].bestDiscounts.couponDiscount` | object or null | Best coupon discount. |
| `errors` | array | Per-entry errors (validation failures, processing errors). |

The response HTTP status is `200` if any results were produced, `400` if all entries failed.

---

## API: GET /api/theme-selectors

**Source file:** `app/routes/api.theme-selectors.jsx`

### Purpose

Returns CSS selector mappings for a given Shopify theme so that the storefront scripts know where to find price containers, product cards, form wrappers, and other DOM elements. Different themes structure their HTML differently, so this endpoint provides the correct selectors per theme.

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `theme` | string | No | Theme name as displayed in Shopify admin (e.g., `"Dawn"`, `"Dawn - Copy"`, `"Symmetry v7.2"`). Normalized to lowercase with suffixes stripped. |
| `schemaName` | string | No | Canonical schema name from the theme's `settings_schema.json` (e.g., `"dawn"`, `"symmetry"`). |
| `themeStoreId` | string | No | Numeric Shopify Theme Store ID (e.g., `887` for Dawn). |
| `themeId` | string | No | Shopify theme ID (numeric). Used as cache key. |

No authentication token is required because this endpoint returns generic CSS selector data with no shop-specific information.

### Resolution Priority

The endpoint resolves selectors in the following priority order:

1. **In-memory cache**: If `themeId` is provided and a cached entry exists (not expired), return it immediately.
2. **Theme Store ID**: If `themeStoreId` matches a known theme (e.g., `887` = Dawn, `568` = Symmetry), use its selectors.
3. **Schema name**: If `schemaName` matches a known theme key, use its selectors.
4. **Theme name**: If the normalized `theme` parameter matches a known theme key, use its selectors.
5. **Fallback**: If no match is found, Dawn's selectors are returned as the default fallback.

**Known themes and their Store IDs:**

| Theme | Store ID | Key |
|-------|----------|-----|
| Dawn | 887 | `dawn` |
| Symmetry | 568 | `symmetry` |
| Vision | 2053 | `vision` |
| Wonder | 2684 | `wonder` |
| Spotlight | 1891 | `spotlight` |
| Horizon | 2481 | `horizon` |
| Savor | -- | `savor` |

**Theme name normalization**: The theme name has trailing metadata stripped -- suffixes like ` - Copy`, `(Preview)`, `[dev]`, version numbers (e.g., `v7.2`), and keywords (`preview`, `live`, `published`, `development`, `staging`, `test`, `draft`, etc.) are all removed before matching.

### Response Format

```json
{
  "theme": "dawn",
  "schemaName": "dawn",
  "themeStoreId": 887,
  "resolvedTheme": "dawn",
  "usedFallback": false,
  "selectors": {
    "cardContainer": ".card-wrapper",
    "cardPrice": ".price__container",
    "formContainer": ".product__info-wrapper",
    "formPrice": ".price__container",
    "formPrice_discounted": ".price-item--sale"
  },
  "fallbackTheme": "dawn",
  "fallbackSelectors": {
    "cardContainer": ".card-wrapper",
    "cardPrice": ".price__container",
    "formContainer": ".product__info-wrapper",
    "formPrice": ".price__container",
    "formPrice_discounted": ".price-item--sale"
  },
  "themeId": "12345",
  "matchedViaThemeId": false,
  "matchedViaStoreId": true,
  "matchedViaSchema": false
}
```

| Field | Type | Description |
|-------|------|-------------|
| `theme` | string or null | Normalized theme name from the request. |
| `schemaName` | string or null | Normalized schema name from the request. |
| `themeStoreId` | number or null | Normalized theme store ID. |
| `resolvedTheme` | string | The theme key whose selectors are being returned. |
| `usedFallback` | boolean | `true` if no theme matched and Dawn fallback was used. |
| `selectors` | object | The CSS selector map for the resolved theme. |
| `selectors.cardContainer` | string | Selector for product card wrappers on collection/grid pages. |
| `selectors.cardPrice` | string | Selector for price containers within product cards. |
| `selectors.formContainer` | string | Selector for the product form wrapper on product pages. |
| `selectors.formPrice` | string | Selector for the price container within the product form. |
| `selectors.formPrice_discounted` | string | Selector for the sale/discounted price element (empty string if theme has no specific selector). |
| `fallbackTheme` | string | Always `"dawn"`. |
| `fallbackSelectors` | object | Dawn's selector map, always included for client-side fallback logic. |
| `themeId` | string or null | The theme ID from the request (used as cache key). |
| `matchedViaThemeId` | boolean | Whether the response was served from the theme ID cache. |
| `matchedViaStoreId` | boolean | Whether the theme was matched by Theme Store ID. |
| `matchedViaSchema` | boolean | Whether the theme was matched by schema name. |

### Caching

Theme selector responses are cached in-memory by `themeId` with the following configuration:

| Setting | Default | Environment Variable |
|---------|---------|---------------------|
| Cache size (max entries) | 200 | `THEME_SELECTOR_CACHE_SIZE` |
| Cache TTL | 30 days | `THEME_SELECTOR_CACHE_TTL_MS` |

Cache behavior:
- Only non-fallback responses are cached (if `usedFallback` is true, the response is not stored).
- Cache entries are evicted when expired or when the cache exceeds the maximum size (LRU eviction based on `lastAccess` timestamp).
- The `pruneCache()` function runs after every cache write to remove expired entries and enforce the size limit.
- Cached entries have `matchedViaThemeId: true` stamped on them so the client knows the result came from cache.

---

## Error Handling Patterns

All three API endpoints follow consistent error handling patterns:

### HTTP Status Codes

| Status | Meaning |
|--------|---------|
| `200` | Success. |
| `400` | Bad request (missing required parameters, invalid body). |
| `403` | Unauthorized (invalid token in hard enforcement mode). |
| `405` | Method not allowed (e.g., POST to a GET-only endpoint). |
| `500` | Internal server error (database failures, unhandled exceptions). |

### Error Response Format

```json
{
  "error": "Human-readable error message",
  "details": "Optional additional context"
}
```

### Defensive Patterns

1. **Safe JSON parsing**: All JSON fields stored in the database (e.g., `resolvedProductIds`, `codes`) are parsed through `safeJsonParse()`, which returns a default value on failure rather than throwing.

2. **GID extraction**: `extractNumericId()` safely extracts numeric IDs from Shopify GIDs (`gid://shopify/Product/12345` becomes `"12345"`), returning `null` on invalid input.

3. **Discount validation**: Each discount is validated with `validateDiscount()` before processing. Invalid structures are logged and skipped.

4. **Processing error accumulation**: Individual discount processing errors do not abort the entire request. Errors are accumulated in a `processingErrors` array, and valid discounts continue to be processed.

5. **Tier fallback**: If tier info cannot be loaded, the system defaults to `FREE` tier rather than failing.

6. **Database error isolation**: Database errors when enriching products with handles do not cause the request to fail -- the response simply omits handle data.

7. **Batch error tolerance** (`/api/best-discounts`): Each request entry in the batch is processed independently. Individual failures produce error entries in the `errors` array without affecting other entries in the batch.
