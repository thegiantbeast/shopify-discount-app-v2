# Theme Compatibility

Discount Display Pro must work across dozens of Shopify themes, each with its own DOM structure, CSS class conventions, and custom elements. This document explains the theme selector system that makes this possible.

---

## The Problem: Different DOM Structures per Theme

Every Shopify theme renders product cards and product pages differently. A price element might be:

| Theme | Price Container | Price Element (Sale) | Product Card |
|-------|----------------|---------------------|--------------|
| Dawn | `.price__container` | `.price-item--sale` | `.card-wrapper` |
| Symmetry | `.price-container` | *(none)* | `product-block` |
| Vision | `.product-price-container` | `.amount.discounted` | `product-card` (custom element) |
| Horizon | `[ref="priceContainer"]` | *(none)* | `product-card` (custom element) |
| Savor | `[ref="priceContainer"]` | `.price` | `product-card` (custom element) |

Without knowing which theme is active, the app cannot:
- Find where prices are displayed on the page
- Inject discount badges in the correct location
- Detect variant changes from the correct form inputs
- Read the current price to calculate discounts

---

## Solution: Theme Selector Map

The system uses a server-side `THEME_SELECTOR_MAP` (defined in `app/utils/theme-selectors.server.js`) that maps each supported theme to its DOM selectors. The client-side `theme_selectors.js` fetches the correct selector set from `/api/theme-selectors` at page load, passing the theme's name, ID, schema name, and theme store ID.

### Architecture

```
Client (storefront)                     Server (app backend)
-------------------                     --------------------
theme_selectors.js                      api.theme-selectors.jsx
  |                                       |
  | GET /api/theme-selectors              |
  |   ?theme=dawn                         |
  |   &themeId=12345                      |
  |   &schemaName=dawn                    |
  |   &themeStoreId=887                   |
  |-------------------------------------->|
  |                                       | buildSelectorResponse()
  |                                       |   1. Check themeStoreId -> THEME_STORE_ID_MAP
  |                                       |   2. Check schemaName -> THEME_SELECTOR_MAP
  |                                       |   3. Check themeName -> THEME_SELECTOR_MAP
  |                                       |   4. Fallback to Dawn
  |                                       |
  |<--------------------------------------| { resolvedTheme, selectors, usedFallback, ... }
  |                                       |
  | window.THEME_SELECTORS[theme] = ...   |
  | Notify listeners                      |
```

---

## Supported Themes (Complete Selector Table)

The `THEME_SELECTOR_MAP` in `app/utils/theme-selectors.server.js` defines selectors for seven themes:

| Theme | Theme Store ID | cardContainer | cardPrice | formContainer | formPrice | formPrice_discounted | variantInput |
|-------|---------------|---------------|-----------|---------------|-----------|---------------------|--------------|
| **Dawn** | 887 | `.card-wrapper` | `.price__container` | `.product__info-wrapper` | `.price__container` | `.price-item--sale` | *(default)* |
| **Symmetry** | 568 | `product-block` | `.product-price--block` | `.product-form` | `.price-container` | *(empty)* | *(default)* |
| **Vision** | 2053 | `product-card` | `.price` | `.product-information` | `.product-price-container` | `.amount.discounted` | *(default)* |
| **Wonder** | 2684 | `.card__container, .shoppable-product-card, .wt-products-slider__product, .wt-product__info` | `.price__container` | `.wt-product__info` | `.price__container` | *(empty)* | *(default)* |
| **Spotlight** | 1891 | `.card__information` | `.price__container` | `.product__info-wrapper` | `.price__container` | *(empty)* | *(default)* |
| **Horizon** | 2481 | `product-card` | `product-price` | `.product-details` | `[ref="priceContainer"]` | *(empty)* | `input[ref="variantId"]` |
| **Savor** | *(not yet assigned)* | `product-card` | `product-price` | `.product-details` | `[ref="priceContainer"]` | `.price` | *(default)* |

**Notes:**
- An empty `formPrice_discounted` means the theme does not have a dedicated sale-price element; price extraction falls back to `getCleanPriceText` DOM walking
- The default `variantInput` selector is: `input[ref="variantId"], input[name="id"], select[name="id"], [data-variant-id]`
- Dawn is the default fallback theme (used when no match is found)

---

## Selector Types per Theme

Each theme entry in the map can define six selector types:

### Card Selectors (Collection Pages)

| Selector | Purpose | Example (Dawn) |
|----------|---------|----------------|
| `cardContainer` | The outermost element wrapping a single product card. Used to scope product ID detection and price element searches. | `.card-wrapper` |
| `cardPrice` | The price display element within a card. The app injects discount badges after this element. | `.price__container` |

### Form Selectors (Product Pages)

| Selector | Purpose | Example (Dawn) |
|----------|---------|----------------|
| `formContainer` | The product form wrapper on the product detail page or featured product section. Scopes all form-related DOM queries. | `.product__info-wrapper` |
| `formPrice` | The price display container within the form. The app hides this and renders its own price UI. | `.price__container` |
| `formPrice_discounted` | **CRITICAL**: The element that shows the discounted/sale price when a subscription plan is selected. Used by `getDiscountedFormPrice()` to read the current price after plan switching. | `.price-item--sale` |
| `variantInput` | The input element carrying the selected variant ID. Used for variant change detection. | `input[name="id"]` |

### Why `formPrice_discounted` Is Critical

When a customer switches between "One-time purchase" and "Subscribe & save" on themes like Dawn, Shopify's native JavaScript updates the price display by toggling visibility of child elements within `.price__container`:

```html
<div class="price__container" style="display: none;">  <!-- App hides this -->
  <div class="price__regular" style="display: block;">$100</div>  <!-- One-time -->
  <div class="price__sale">
    <span class="price-item--sale" style="display: block;">$80</span>  <!-- Subscription -->
  </div>
</div>
```

The `formPrice_discounted` selector (`.price-item--sale` for Dawn) lets the app directly target the sale price element, bypassing the complexity of figuring out which nested element is "currently visible" when the entire container is hidden by the app.

---

## Theme Detection Flow (Client + Server)

### Client-Side Detection (theme_selectors.js)

On page load, `theme_selectors.js` reads four identifiers from the `Shopify.theme` global:

```javascript
// From Shopify.theme (set by Shopify on every storefront page):
detectedTheme    = normalizeThemeName(Shopify.theme.name)        // e.g., "dawn"
detectedThemeId  = normalizeThemeId(Shopify.theme.id)            // e.g., "12345678"
detectedSchema   = normalizeSchemaName(Shopify.theme.schema_name) // e.g., "dawn"
detectedStoreId  = normalizeThemeStoreId(Shopify.theme.theme_store_id) // e.g., "887"
```

These are sent as query parameters to the server:
```
GET /api/theme-selectors?theme=dawn&themeId=12345678&schemaName=dawn&themeStoreId=887
```

### Server-Side Resolution (api.theme-selectors.jsx)

The API route handler:

1. **Cache check** -- If `themeId` is provided, checks the in-memory selector cache (`theme-selector-cache.server.js`)
2. **Build response** -- Calls `buildSelectorResponse(theme, schemaName, themeStoreId)` from `theme-selectors.server.js`
3. **Cache store** -- If a non-fallback match was found and `themeId` is available, stores in cache

---

## Resolution Priority (themeStoreId -> schemaName -> themeName -> fallback)

The `buildSelectorResponse` function resolves selectors in this priority order:

### 1. Theme Store ID (Highest Priority)
```javascript
const THEME_STORE_ID_MAP = {
  887: 'dawn',
  568: 'symmetry',
  2053: 'vision',
  2684: 'wonder',
  1891: 'spotlight',
  2481: 'horizon'
};
```

The theme store ID is the most reliable identifier because it is assigned by Shopify and does not change when merchants rename their theme. For example, a merchant might rename "Dawn" to "My Custom Theme" but the `theme_store_id` remains `887`.

### 2. Schema Name
The `schema_name` property (e.g., `"dawn"`) is checked directly against the `THEME_SELECTOR_MAP` keys. This catches cases where the theme store ID is missing but the schema name is preserved.

### 3. Theme Name
The normalized theme name is looked up in `THEME_SELECTOR_MAP`. This is the least reliable method because merchants frequently rename themes.

### 4. Fallback to Dawn
If none of the above produce a match, the Dawn selectors are returned as a fallback. The response includes `usedFallback: true` to indicate this.

The response payload includes flags documenting how the match was made:
```json
{
  "theme": "dawn",
  "schemaName": "dawn",
  "themeStoreId": 887,
  "resolvedTheme": "dawn",
  "usedFallback": false,
  "selectors": { "cardContainer": ".card-wrapper", ... },
  "fallbackTheme": "dawn",
  "fallbackSelectors": { ... },
  "matchedViaSchema": false,
  "matchedViaStoreId": true
}
```

---

## Theme Name Normalization

Both client and server implement identical `normalizeThemeName()` functions to handle the many variations merchants apply to theme names.

### Normalization Rules

Given a raw theme name like `"Dawn - Copy 3 (Preview)"`:

```
1. Lowercase and trim
   "dawn - copy 3 (preview)"

2. Strip " - " suffix (and everything after)
   "dawn"  (stripped " - copy 3 (preview)")

3. Strip "(" suffix (and everything after)
   (already handled by step 2)

4. Strip "[" suffix (and everything after)
   (not applicable)

5. Remove trailing keywords:
   - preview, live, published, unpublished, development, dev, draft,
     staging, test, copy, duplicate, backup
   - "copy" followed by optional digits
   - Version numbers: v1, v2.0, 1.2.3

6. Final trim
```

### Examples

| Raw Theme Name | Normalized |
|---------------|------------|
| `Dawn` | `dawn` |
| `Dawn - Copy` | `dawn` |
| `Dawn - My Store Version` | `dawn` |
| `Dawn (Preview)` | `dawn` |
| `Dawn [dev]` | `dawn` |
| `Dawn copy 3` | `dawn` |
| `Dawn v2.1` | `dawn` |
| `Dawn development` | `dawn` |
| `Symmetry staging` | `symmetry` |
| `My Awesome Theme` | `my awesome theme` (no match, falls back to Dawn) |

---

## Custom Selector Overrides

Merchants can override individual selectors via the app's advanced settings. These overrides are stored as Shopify metafields under the `discount_app` namespace and injected into `window.appSettings` by `e_config.liquid`.

### Available Custom Selectors

| Metafield Key | appSettings Property | Selector Type |
|---------------|---------------------|---------------|
| `user_card_price_selector` | `userCardPriceSelector` | Card price container |
| `user_card_container_selector` | `userCardContainerSelector` | Product card container |
| `user_form_price_selector` | `userFormPriceSelector` | Form price container |
| `user_form_container_selector` | `userFormContainerSelector` | Form container |
| `user_form_selector` | `userFormSelector` | Form element |
| `user_variant_input_selector` | `userVariantInputSelector` | Variant input |

### Per-Selector Enable Toggles

Each custom selector has an independent enable/disable toggle:

| Metafield Key | appSettings Property |
|---------------|---------------------|
| `use_card_price_selector` | `useCardPriceSelector` |
| `use_card_container_selector` | `useCardContainerSelector` |
| `use_form_selector` | `useFormSelector` |
| `use_form_container_selector` | `useFormContainerSelector` |
| `use_form_price_selector` | `useFormPriceSelector` |
| `use_variant_input_selector` | `useVariantInputSelector` |

### Master Toggle

`use_auto_detect_selectors` (metafield) / `useAutoDetectSelectors` (appSettings) -- When `true`, all custom selectors are ignored and the theme selector map is used exclusively.

If `useAutoDetectSelectors` is not explicitly set, the system auto-detects: if ANY custom selector has a non-empty value, custom mode is assumed (`FORCE_AUTO = false`); otherwise auto-detection is used.

### Resolution Logic (per selector)

For each selector type, `initializeSelectors()` in `e_discounts.js` follows this logic:

```
IF FORCE_AUTO is false
  AND per-selector toggle is enabled (e.g., useCardPriceSelector === true)
  AND custom value is non-empty
  AND custom value is not the placeholder "leave empty for theme auto detection"
THEN
  Use the custom selector value
  Source: "custom"
ELSE
  Use pickThemeSelector(themeName, selectorKey, fallbackDefault)
  Source: "theme:<name>" or "state:<name>" or "fallback"
```

### Placeholder Handling

The string `"leave empty for theme auto detection"` is treated as a null/empty value. This is the default value shown in the settings UI to guide merchants.

### Legacy Metafield Migration

`e_config.liquid` contains backwards-compatible mapping from older metafield names:
- `user_embed_price_container_selector` -> `user_card_price_selector`
- `user_price_container_selector` -> `user_card_price_selector`
- `user_product_container_selector` -> `user_card_container_selector`

---

## Fallback Strategy

The system has multiple fallback layers to ensure discount display works even on unsupported themes:

### Theme Selector Fallback Chain

```
1. Exact theme match (via store ID, schema, or name)
2. Dawn selectors as default (THEME_SELECTOR_MAP['dawn'])
3. Hardcoded CSS fallback selectors:
   - Card price: '.price__container'
   - Card container: '.grid__item, product-card, .product-card'
   - Form price: '.price__container'
   - Variant input: 'input[ref="variantId"], input[name="id"], select[name="id"], [data-variant-id]'
```

### Price Element Fallback Chain

When the primary selector finds no elements:

```
1. Primary selector (from theme map or custom)
2. Fallback selectors (tried in order):
   - '.product-price .js-value'
   - '.product-price'
   - '.price__current .js-value'
   - '.price__current'
   - '.price .js-value'
   - '.price'
3. If custom selector source: no fallbacks (merchant explicitly chose their selector)
```

### Theme Selector Fetch Fallback

If the `/api/theme-selectors` fetch fails:
- `handleFetchError()` returns a payload with `usedFallback: true` and `selectors: null`
- The client then falls back to hardcoded defaults

### `usedFallback` Flag

The API response includes a `usedFallback` boolean. When `true`:
- The client knows Dawn defaults were used, not a theme-specific match
- Diagnostic logging includes this information
- The app settings page can alert merchants that their theme may need custom selectors

---

## Server-Side Caching (theme-selector-cache.server.js)

The theme selector cache is an in-memory LRU cache that stores resolved selector payloads keyed by Shopify theme ID.

### Cache Configuration

| Parameter | Default | Env Variable |
|-----------|---------|-------------|
| Max entries | 200 | `THEME_SELECTOR_CACHE_SIZE` |
| TTL | 30 days | `THEME_SELECTOR_CACHE_TTL_MS` |

### Cache Behavior

- **Key**: Normalized Shopify theme ID (numeric string extracted from the raw ID)
- **Storage**: Only stores non-fallback results (`usedFallback === false`)
- **Eviction**: LRU-based when exceeding max entries; expired entries pruned on write
- **Access tracking**: `lastAccess` timestamp updated on every read
- **Cache hit**: Logged via `pino` with `themeId` and `resolvedTheme`
- **`clearThemeSelectorCache()`**: Clears the entire cache (available for admin operations)

---

## Adding Support for a New Theme

To add support for a new Shopify theme:

### Step 1: Identify the Theme's DOM Structure

Open the theme's storefront and inspect:
1. **Collection page** -- Find the product card wrapper element and the price display within it
2. **Product page** -- Find the product info/form wrapper and the price container
3. **Sale price element** -- If the theme has a dedicated element for sale/discounted prices (visible when a subscription plan is selected), note its selector
4. **Variant input** -- Find how the selected variant ID is stored (usually `input[name="id"]` but some themes use custom elements)
5. **Custom elements** -- Note if the theme uses web components (`product-card`, `product-price`, etc.)

### Step 2: Add to THEME_SELECTOR_MAP

In `app/utils/theme-selectors.server.js`, add a new entry:

```javascript
const THEME_SELECTOR_MAP = {
  // ... existing themes ...

  newtheme: {
    // Cards (collection/grid)
    cardContainer: '.new-theme-card',
    cardPrice: '.new-theme-price',
    // Forms (product page, featured product, quick add wrappers)
    formContainer: '.new-theme-form-wrapper',
    formPrice: '.new-theme-price-container',
    formPrice_discounted: '.new-theme-sale-price',  // or '' if no dedicated element
    // Only include variantInput if theme uses non-standard variant input
    // variantInput: 'input[ref="customVariantId"]',
  },
};
```

### Step 3: Add Theme Store ID Mapping (if available)

If the theme is listed in the Shopify Theme Store and you know its store ID:

```javascript
const THEME_STORE_ID_ENTRIES = [
  // ... existing entries ...
  { id: 9999, key: 'newtheme' },
];
```

### Step 4: Test

1. Install the theme on a test store
2. Verify collection page badges appear on product cards
3. Verify product page discount UI renders correctly
4. Test variant switching (ensure price updates)
5. Test subscription plan switching (if applicable)
6. Check that no duplicate elements appear
7. Verify the theme editor preview modes work

### Step 5: Deploy

The new selectors are picked up automatically on the next deployment. No client-side code changes are needed -- `theme_selectors.js` fetches selectors dynamically from the API.

### Notes for Custom Element Themes

Themes like Horizon and Savor use web components (custom HTML elements):
- `product-card` as the card container (instead of a CSS class)
- `product-price` as the price container
- `[ref="priceContainer"]` as attribute-based selectors
- `input[ref="variantId"]` as variant inputs

These require tag-name or attribute selectors rather than class-based selectors. The selector system supports any valid CSS selector string.
