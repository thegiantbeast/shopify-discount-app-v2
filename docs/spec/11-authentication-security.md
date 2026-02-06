# Authentication and Security

Discount Display Pro has two distinct authentication boundaries: the **admin side** (merchant interacting with the app inside Shopify Admin) and the **storefront side** (theme extension JavaScript calling API endpoints from the public storefront). Each uses a different authentication mechanism suited to its context.

---

## Admin Authentication (Shopify OAuth)

All admin routes (dashboard, settings, discount management, pricing) are protected by Shopify's built-in OAuth flow via `@shopify/shopify-app-remix`.

**Configuration** (in `app/shopify.server.js`):

```javascript
const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  apiVersion: "2025-10",
  scopes: process.env.SCOPES?.split(","),
  appUrl: process.env.SHOPIFY_APP_URL || "",
  authPathPrefix: "/auth",
  sessionStorage: new PrismaSessionStorage(prisma),
  distribution: AppDistribution.AppStore,
  future: {
    unstable_newEmbeddedAuthStrategy: true,
    removeRest: true,
    unstable_managedPricingSupport: true,
  },
  ...
});
```

Key aspects:

- **Session storage**: OAuth sessions are persisted via Prisma (`PrismaSessionStorage`), stored in the `Session` database table.
- **Embedded auth strategy**: Uses `unstable_newEmbeddedAuthStrategy` for the session token-based authentication flow that Shopify recommends for embedded apps.
- **App distribution**: Set to `AppDistribution.AppStore`, meaning the app is publicly listed and must follow App Store requirements.
- **Auth hook**: The `afterAuth` hook triggers shop initialization (tier creation, metafield provisioning, discount import) after successful OAuth.
- **Custom shop domains**: If `SHOP_CUSTOM_DOMAIN` is set, it is passed to `customShopDomains` for development/testing with non-standard shop domains.

Admin routes call `authenticate.admin(request)` (exported from `shopify.server.js`) which validates the session token, ensures the session is active, and provides the `admin` GraphQL client.

---

## Storefront API Authentication (Per-Shop Tokens)

Storefront API routes (`/api/discounts`, `/api/best-discounts`) cannot use Shopify OAuth because they are called from client-side JavaScript on the public storefront, outside the Shopify Admin context. Instead, they use a custom per-shop token system.

**Source file:** `app/utils/storefront-auth.server.js`

### Token Generation

```javascript
import crypto from "crypto";

export function generateStorefrontToken() {
  return crypto.randomBytes(32).toString("hex");
}
```

- Produces a **64-character hexadecimal string** (32 bytes of cryptographic randomness).
- Uses Node.js `crypto.randomBytes`, which draws from the operating system's cryptographically secure random number generator.
- Each shop gets its own unique token.

### Token Storage

The token is stored in two locations:

1. **Local database**: `Shop.storefrontToken` field in the Prisma `Shop` model.
2. **Shopify metafield**: `discount_app.storefront_token` on the shop resource, set via GraphQL mutation.

This dual storage ensures the token is available both for server-side verification (database) and client-side injection (metafield read by Liquid).

### Token Injection

The token flows to the storefront through the Liquid template:

1. **Installation/refresh**: `initProcessMetafields()` in `app/utils/init-process-metafields.js` generates or retrieves the token:
   - First checks if a token already exists in the database.
   - If not, generates a new one, stores it in the database, and clears the in-memory cache.
   - Sets the token as a Shopify metafield via `metafieldsSet` GraphQL mutation.

2. **Liquid template**: The theme block (`e_discounts.liquid`) reads the metafield and injects it into the page:
   ```liquid
   window.DISCOUNT_STOREFRONT_TOKEN = '{{ shop.metafields.discount_app.storefront_token }}';
   ```

3. **Client-side usage**: Theme extension JavaScript includes the token in API requests as a query parameter (`token=...`) or in the request body.

**Security of metafield logging**: When logging metafield updates, the token value is redacted:
```javascript
metafields: metafieldsToSet.map(({ key, value }) => ({
  key,
  value: key === 'storefront_token' ? '[REDACTED]' : value
}))
```

### Token Verification

`authenticateStorefrontRequest(shop, providedToken, db)`:

```javascript
export async function authenticateStorefrontRequest(shop, providedToken, db) {
  if (!shop || !providedToken || typeof providedToken !== "string") {
    return false;
  }

  try {
    let storedToken = getCachedToken(shop);

    if (!storedToken) {
      const shopRecord = await db.shop.findUnique({
        where: { domain: shop },
        select: { storefrontToken: true },
      });

      if (!shopRecord?.storefrontToken) {
        return false;
      }

      storedToken = shopRecord.storefrontToken;
      setCachedToken(shop, storedToken);
    }

    // Constant-time comparison to prevent timing attacks
    const a = Buffer.from(storedToken, "utf-8");
    const b = Buffer.from(providedToken, "utf-8");
    if (a.length !== b.length) {
      return false;
    }
    return crypto.timingSafeEqual(a, b);
  } catch (error) {
    logger.error({ err: error, category: 'Auth' }, 'Error verifying storefront token');
    return false;
  }
}
```

Verification steps:

1. **Input validation**: Rejects immediately if `shop`, `providedToken`, or token type is invalid.
2. **Cache lookup**: Checks the in-memory cache first (avoids a database query on every request).
3. **Database lookup**: If not cached, fetches `storefrontToken` from the `Shop` record and caches it.
4. **Length check**: Compares buffer lengths first. If they differ, returns `false` immediately (the buffers must be equal length for `timingSafeEqual`).
5. **Timing-safe comparison**: Uses `crypto.timingSafeEqual` on UTF-8 Buffers to prevent timing side-channel attacks. This ensures an attacker cannot determine how many characters of their guess are correct based on response timing.
6. **Error handling**: Any exception during verification results in `false` (fail-closed).

### In-Memory Cache (5-min TTL)

To avoid a database query on every storefront API request, verified tokens are cached in a `Map`:

```javascript
const tokenCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
```

| Operation | Behavior |
|-----------|----------|
| `getCachedToken(shop)` | Returns the token if the cache entry exists and has not expired. Deletes expired entries. |
| `setCachedToken(shop, token)` | Stores the token with an expiry timestamp of `now + 5 minutes`. |
| `clearTokenCache(shop)` | Removes a specific shop's cached token. Called after token rotation (regeneration). |

The 5-minute TTL is a balance between performance (avoiding DB hits) and freshness (token rotations take effect within 5 minutes).

### Soft vs Hard Enforcement (STOREFRONT_AUTH_ENFORCE)

```javascript
export function isStorefrontAuthEnforced() {
  return process.env.STOREFRONT_AUTH_ENFORCE === "true";
}
```

| Mode | `STOREFRONT_AUTH_ENFORCE` | Behavior |
|------|--------------------------|----------|
| **Soft** (default) | Not set, or any value other than `"true"` | Unauthenticated requests are logged at debug level but allowed through. The API returns data normally. |
| **Hard** | `"true"` | Unauthenticated requests receive a `403 Unauthorized` response with `{ "error": "Unauthorized" }`. |

Soft mode exists for:
- **Rollout safety**: Allows enabling tokens gradually without breaking existing storefronts that have not yet received the token via metafield.
- **Debugging**: Makes it easier to test API responses without needing valid tokens.
- **Monitoring**: Logs show which shops are making unauthenticated requests, helping identify issues before switching to hard enforcement.

Each API route implements the soft/hard check identically:

```javascript
const isAuthenticated = await authenticateStorefrontRequest(shop, token, db);
if (!isAuthenticated) {
  if (isStorefrontAuthEnforced()) {
    return json({ error: 'Unauthorized' }, { status: 403, headers });
  }
  logger.debug({ shop, category: 'Auth' }, 'Unauthenticated request (soft mode)');
}
```

---

## CORS Policy

CORS headers are managed by `app/utils/cors.server.js` (detailed in the API Layer document). Key security considerations:

- **Not the primary security boundary**: CORS is a browser-side enforcement mechanism. Server-to-server requests (curl, scripts) bypass CORS entirely. The per-shop token is the real server-side protection.
- **Permissive for custom domains**: Any valid HTTPS origin is allowed because Shopify stores can have arbitrary custom domains. Blocking HTTP (except in development) provides a baseline.
- **Origin reflection**: Responses reflect the actual request `Origin` header rather than using `*`, which is slightly more secure and compatible with credentialed requests.
- **Blocked in production**: `http://localhost` and `http://127.0.0.1` are explicitly blocked in production to prevent accidental local testing against production data.
- **Vary header**: `Vary: Origin` is included to ensure CDNs and proxies do not cache CORS responses incorrectly for different origins.

---

## Input Validation

### Server-Side Validation

API endpoints validate all inputs before processing:

- **Shop parameter**: Must be a non-empty string. Trimmed and checked for type.
- **Product/variant IDs**: Extracted via `extractNumericId()` which safely parses Shopify GIDs (`gid://shopify/Product/12345`) using a regex match on trailing digits. Invalid formats return `null` and are silently filtered.
- **JSON parsing**: All JSON stored in database fields is parsed through `safeJsonParse()` which returns a safe default on failure rather than throwing.
- **Discount validation**: Each discount object is validated with `validateDiscount()` before processing (must have `gid`, `shop`, `status`).
- **Numeric values**: `regularPriceCents` is validated as a finite number. `NaN` and `Infinity` are rejected.
- **Request body**: `/api/best-discounts` validates that the body is an object and that `requests` is a non-empty array.
- **Empty filter protection**: `/api/discounts` requires at least one of `productIds`, `variantIds`, or `handles` to prevent dumping all discount data.

### Theme Selector Validation

- **Theme Store ID**: `normalizeThemeStoreId()` rejects non-numeric values, `NaN`, and the placeholder value `"000"`.
- **Theme names**: Normalized to lowercase with metadata suffixes stripped.
- **Theme ID**: Extracted as a numeric string from the raw input.

---

## XSS Prevention (DOM Construction Patterns)

The storefront theme extension renders discount badges, coupon blocks, and price displays directly into the merchant's storefront DOM. XSS prevention is critical because discount data (codes, labels, badge text) could theoretically contain malicious content.

### Safe DOM Construction

All UI elements in the theme extension are built using safe DOM APIs. There are **zero instances of `innerHTML`** across all storefront JavaScript files. Instead:

- **`document.createElement()`**: Used to create all elements (divs, spans, labels, inputs, buttons).
- **`element.textContent`**: Used to set text content, which automatically escapes HTML entities.
- **`document.createTextNode()`**: Used when building complex text with multiple segments.
- **`element.appendChild()`**: Used to compose DOM trees.

Example from `pp_ui-components.js`:

```javascript
// Badge text - safe, uses textContent
const fullBadgeText = (window.discountSettings.badgeText || 'Sale {amount} OFF')
  .replace(/\{amount\}/g, badgeText);
badge.textContent = fullBadgeText;
container.appendChild(badge);
```

### Safe Template Placeholder Replacement

Discount badge templates use the `{amount}` placeholder pattern. The replacement is done safely:

1. **String split approach** (for coupon labels in `pp_ui-components.js`):
   ```javascript
   const parts = templateText.split('{amount}');
   if (parts.length > 0) {
     labelSpan.appendChild(document.createTextNode(parts[0]));
   }
   // Insert the amount as a text node between parts
   if (parts.length > 1) {
     labelSpan.appendChild(document.createTextNode(parts[1]));
   }
   ```
   This avoids regex with user input and ensures all segments are rendered as text nodes.

2. **String replace + textContent** (for badges in `e_forms.js` and `e_cards.js`):
   ```javascript
   badge.textContent = tpl.replace('{amount}', discountDisplayValue);
   ```
   The result is set via `textContent`, which escapes any HTML in the template or value.

### No User-Controlled HTML

- Discount codes, badge text, and label templates come from either the app's configuration (set by the merchant in the admin) or from the API response.
- Even if these values contained HTML tags, `textContent` would render them as literal text, not as HTML.
- The CSS classes used (`.pp-coupon-block`, `.pp-coupon-flag`, `.pp-discount-badge`, etc.) are hardcoded, not derived from user input.

---

## API Scopes

The app requests minimal Shopify API scopes as defined in `shopify.app.toml`:

```toml
[access_scopes]
scopes = "read_discounts,read_products,read_themes"
optional_scopes = [ ]
```

| Scope | Purpose |
|-------|---------|
| `read_discounts` | Read discount data from Shopify's API (automatic discounts, code discounts, discount rules). Required for importing and resolving discount targets. |
| `read_products` | Read product and variant data from Shopify's API. Required for resolving which products/variants a discount applies to, and for syncing product handles and pricing. |
| `read_themes` | Read theme data. Required for identifying the active theme to serve correct CSS selectors. |

Notable scope characteristics:

- **Read-only**: The app uses only `read_` scopes -- it does not write to discounts, products, or themes. The app observes Shopify data but does not modify it.
- **No optional scopes**: The `optional_scopes` array is empty, meaning the app does not request any scopes beyond what is strictly required.
- **No customer data**: The app has no access to customer data, orders, or checkout information.
- **Metafield writes**: Metafield operations (storing the storefront token and app URL) use the admin GraphQL API which does not require a separate `write_metafields` scope -- apps can write to their own metafield namespaces without additional scope grants.

### Webhook Subscriptions

The app subscribes to webhooks for data it has read access to, plus app lifecycle events:

| Webhook | Scope Required | Purpose |
|---------|---------------|---------|
| `discounts/create`, `discounts/update`, `discounts/delete` | `read_discounts` | Keep discount data in sync |
| `products/update`, `products/delete` | `read_products` | Reprocess discounts when products change |
| `collections/update`, `collections/delete` | `read_products` | Reprocess discounts when collections change |
| `app/uninstalled` | (app lifecycle) | Clean up shop data on uninstall |
| `app/subscriptions_update` | (app lifecycle) | Update tier when billing changes |
| `app/scopes_update` | (app lifecycle) | Handle scope changes |
