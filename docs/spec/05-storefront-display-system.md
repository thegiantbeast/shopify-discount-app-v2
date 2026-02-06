# Storefront Display System

The storefront display system is the customer-facing half of Discount Display Pro. It consists of a Shopify theme app extension (an embed block injected into the `<body>` of every storefront page) that detects products on the page, fetches their discount data from the app backend, and renders discount badges, prices, and coupon checkboxes directly into the merchant's theme -- without the merchant editing any template code.

---

## Architecture: Liquid Block + JavaScript Modules

The system follows a layered architecture:

1. **Liquid layer** -- `e_discounts.liquid` is the single embed block registered via `{% schema %}` with `"target": "body"`. It renders configuration snippets, loads static JavaScript assets, and includes CSS stylesheets. It runs on every page of the storefront.

2. **JavaScript layer** -- Eight JavaScript files handle all runtime logic. They communicate through `window.*` globals and follow a strict loading order (see next section). There is no build step; all files are plain ES5/ES6 shipped as Shopify theme extension assets.

3. **CSS layer** -- Two Liquid-rendered style snippets (`pp_styles.css.liquid` for product-page/form styles, `e_styles.css.liquid` for collection-card styles) inject `<style>` blocks with Liquid-resolved CSS custom properties for merchant-configured colors, font sizes, and border settings.

4. **Server layer** -- Two API routes (`/api/discounts` and `/api/best-discounts`) provide discount data and server-side best-discount resolution. A third route (`/api/theme-selectors`) returns the CSS selector map for the detected theme.

---

## Loading Sequence

The loading order is carefully orchestrated to ensure dependencies are available before consumers run. The Liquid block (`e_discounts.liquid`) controls this sequence:

```
1. {% render 'e_config' %}                        -- Liquid config snippet (synchronous, inline <script>)
2. <script src="theme_selectors.js" defer>         -- Theme selector bootstrapper
3. <script> ... inline JS ...                      -- Sets window.DISCOUNT_API_BASE_URL, APP_VERSIONS, log level
4. <script type="module" src="logger.js">          -- Logger (ES module, deferred by nature)
5. <script src="pp_discount-utils.js" defer>       -- Price/discount utilities
6. <script src="pp_ui-components.js" defer>        -- UI component factory (DiscountUI)
7. <script src="pp_variant-detection.js" defer>    -- Variant change detection helpers
8. <link rel="preload"> for e_cards, e_forms, e_discounts  -- Preload hints
9. Sequential dynamic injection:
     a. e_cards.js   (module)
     b. e_forms.js   (module)
     c. e_discounts.js (module)
10. {% render 'e_styles.css' %}                    -- Card CSS
11. {% render 'pp_styles.css' %}                   -- Form/PDP CSS
```

### The `waitForDiscountUI` Pattern

Before injecting the three sequential modules (steps 9a-9c), the loader waits for `window.DiscountUI` to become available. This object is set by `pp_ui-components.js` (loaded with `defer` in step 6).

```javascript
function waitForDiscountUI() {
  return new Promise((resolve) => {
    if (window.DiscountUI) { resolve(); return; }
    const check = setInterval(() => {
      if (window.DiscountUI) { clearInterval(check); resolve(); }
    }, 10);
    // Timeout after 3 seconds - proceed anyway to avoid infinite wait
    setTimeout(() => { clearInterval(check); resolve(); }, 3000);
  });
}
```

Key details:
- Polls every **10ms** for `window.DiscountUI`
- Times out after **3000ms** and proceeds regardless (graceful degradation)
- After DiscountUI is confirmed (or timed out), modules are loaded **sequentially** via `Promise.reduce` -- each module's `<script type="module">` must fully load before the next is injected

### Module Injection

Each of the three sequential modules (`e_cards.js`, `e_forms.js`, `e_discounts.js`) is injected as a `<script type="module">` into `document.head`. If the primary Shopify CDN URL fails, a fallback URL is tried using the app's backend base URL (`/embed-assets/<filename>`). Each script is tagged with `data-discount-module` to prevent duplicate injection.

---

## Configuration Injection (e_config.liquid)

The `e_config.liquid` snippet is rendered synchronously by Liquid before any JavaScript executes. It sets all configuration on `window.*` globals:

### Badge Text Templates
- `window.shopAutomaticBadgeText` -- e.g., `"Sale {amount} OFF"` (from metafield or default)
- `window.shopCouponBadgeText` -- e.g., `"Save {amount} with coupon"` (from metafield or default)
- `window.ppCouponApplyLabel` -- e.g., `"Apply {amount} discount"`
- `window.ppCouponAppliedLabel` -- e.g., `"{amount} off coupon applied"`

The `{amount}` placeholder is replaced at render time with the formatted discount value (e.g., `"20%"` or `"$5.00"`).

### Visual Settings
- Colors: `ppAutomaticBadgeBgColor`, `ppCouponBadgeBgColor`, `ppAppliedIconColor`, `ppAppliedTextColor`
- Font sizes: `ppBadgeFontSize`
- Icons: `ppAppliedIconFile` (one of four SVG options)
- Border: thickness and color for coupon box (from block settings)

### Currency Configuration
- `window.shopCurrency` / `window.presentmentCurrency` -- The customer's presentment currency ISO code (resolved from `cart.currency` -> `localization.country.currency` -> `shop.currency`)
- `window.presentmentCurrencySymbol` -- The currency symbol
- `window.shopMoneyFormat` / `window.shopMoneyWithCurrencyFormat` -- Shopify's money format strings
- `window.currencySymbols` -- A comprehensive map of 200+ currency codes to their symbols

### Custom Selector Overrides
- `window.appSettings.userCardPriceSelector` -- Custom CSS selector for card price containers
- `window.appSettings.userCardContainerSelector` -- Custom CSS selector for product card containers
- `window.appSettings.userFormPriceSelector` -- Custom CSS selector for form price containers
- `window.appSettings.userFormContainerSelector` -- Custom CSS selector for form containers
- `window.appSettings.userVariantInputSelector` -- Custom CSS selector for variant inputs
- Per-selector enable toggles: `useCardPriceSelector`, `useFormPriceSelector`, etc.
- `window.appSettings.useAutoDetectSelectors` -- Master toggle for auto-detection vs. custom selectors

### Behavior Settings
- `window.discountSettings.autoApplyCoupons` -- Whether to auto-apply coupon discounts
- `window.discountSettings.showTermsLink` -- Whether to show "Terms and Conditions" links
- `window.discountSettings.discountTermsTemplate` -- Multiline terms text template
- `window.ppPreviewMode` -- Theme editor preview mode (`"real"`, `"automatic"`, or `"coupon"`)

---

## JavaScript Module Overview (all 8 files)

| File | Global Object | Purpose |
|------|--------------|---------|
| `logger.js` | `window.DDPLogger` | Structured logging with level filtering (`debug`/`info`/`warn`/`error`), category filtering (`Forms`/`Cards`/`General`/`PPBlock`), and optional console bridge |
| `theme_selectors.js` | `window.THEME_SELECTORS`, `window.themeSelectorsPromise` | Fetches theme-specific CSS selectors from `/api/theme-selectors` based on `Shopify.theme.name`, `theme_store_id`, and `schema_name`. Caches results and notifies listeners |
| `pp_discount-utils.js` | `window.DiscountUtils` | Price formatting (`formatPrice`), date formatting (`formatDate`), HSBA-to-hex conversion, discount clearing (`clearExistingDiscounts`), and best-discount API calls (`requestBestDiscounts`) |
| `pp_ui-components.js` | `window.DiscountUI` | Factory methods for creating discount DOM elements: `createPriceContainer`, `createCouponBlock`, `showTermsModal` |
| `pp_variant-detection.js` | `window.VariantDetection` | Detects variant changes via cart form `input[name="id"]` listeners, `MutationObserver` on variant inputs, and fallback section-level event delegation |
| `e_cards.js` | `window.EmbedCards` | Renders discount UI on product cards (collection pages): `createAutomaticDiscountDisplay` and `createCouponBadge` |
| `e_forms.js` | `window.EmbedForms` | Renders discount UI on product forms (product pages): `renderPPFormUI` and `applyDiscountCode` |
| `e_discounts.js` | (orchestrator) | Main orchestrator: loads discount data from API, detects products on page, parses prices from DOM, resolves best discounts, delegates rendering to EmbedCards/EmbedForms, manages variant change handling, MutationObserver for dynamic content |

---

## Initialization Flow (e_discounts.js)

The initialization follows this sequence:

```
1. waitForShopifyTheme()           -- Polls for Shopify.theme.name (max 3s)
2. DOMContentLoaded / immediate    -- Triggers initializeDiscountSystem()
3. ensureThemeSelectorsReady()     -- Waits for theme selectors from API (max 4s)
4. subscribeToThemeSelectorUpdates() -- Registers listener for late-arriving selectors
5. initializeSelectors()           -- Computes all CSS selectors (custom overrides vs theme defaults)
6. loadAllProductsFromDatabase()   -- Fetches /api/discounts with page product context
7. findProductContainers()         -- Finds all card containers on page
8. findFormContainers()            -- Finds all form containers on page
9. applyDiscountsToContainers()    -- Iterates containers, calls applyDiscountsToProduct()
10. MutationObserver setup         -- Watches for dynamically added containers
```

### Retry Logic
- If `appSettings` is not yet available, retries after 500ms
- If discount data fails to load, retries after 2000ms
- On initialization error, retries after 2000ms

### MutationObserver
After initialization, a global `MutationObserver` watches `document.body` for newly added DOM nodes. When a node matches the product container selector or form container selector, `applyDiscountsToContainers` is called on it. This handles:
- Infinite scroll / lazy-loaded collection pages
- Quick-add modals
- AJAX-loaded featured product sections

### Heartbeat Mechanism
A hidden `<div id="discount-heartbeat">` is updated every 30 seconds with a `data-timestamp` attribute. This provides a way to verify the script is still running (useful for debugging in production).

---

## Product Card Rendering (e_cards.js)

Product cards appear on collection pages, search results, and featured collection sections. The `EmbedCards` module handles their rendering.

### `createAutomaticDiscountDisplay(container, productId, regularPrice, finalPrice, discount, hasCurrencyCode, singlePrice)`

For automatic discounts on cards:
1. Finds price elements via `findPriceElements(container)` with fallback selectors
2. For each price element (handles multiple price instances per card):
   - Checks if discount elements already exist (prevents duplicates)
   - If the discount applies to ALL variants (`variantScope.type === 'ALL'`):
     - Hides the original price element (`display: none`)
     - Creates a crossed-out regular price span (`.discounted-price__regular`)
     - Creates a sale price span (`.discounted-price__sale`)
     - Prepends "From" prefix if `singlePrice` is false
   - Creates a badge span (`.discounted-price__badge`) with text from `shopAutomaticBadgeText` template
   - Creates an alignment wrapper (`.automatic-wrapper`) that respects `shopBadgeAlignment` (`left`/`center`/`right`)
   - If discount is PARTIAL, adds "in selected items" text
3. Triggers a layout nudge (`window.dispatchEvent(new Event('resize'))`) to help themes recalculate section heights

### `createCouponBadge(container, productId, discount, hasCurrencyCode)`

For coupon discounts on cards:
1. Finds price elements in the same way
2. Creates a badge div (`.coupon-badge`) with text from `shopCouponBadgeText` template
3. Wraps in a `.coupon-wrapper` with alignment support
4. If PARTIAL scope, adds "in selected items" text
5. Triggers layout nudge

### Layout Nudge System
Cards use a deferred layout nudge mechanism to prevent theme sections from clipping newly added discount elements:
- `scheduleLayoutNudge()` uses `requestAnimationFrame` to dispatch a `resize` event
- `schedulePostLoadNudge()` dispatches resize events at 50ms and 250ms after `window.load`

---

## Product Form Rendering (e_forms.js)

Product forms appear on the product detail page, featured product sections, and quick-add modals. The `EmbedForms` module provides `renderPPFormUI` which creates the full discount UI matching the "PP" (Product Page) block parity.

### `renderPPFormUI(container, ctx)`

Parameters via `ctx`:
- `productId`, `currentVariantId`, `regularPrice`
- `automaticDiscount`, `couponDiscount`
- `automaticFinalPrice`, `couponFinalPrice`
- `variantChanged`, `sellingPlanId`, `sellingPlanChanged`
- `baseOneTimePrice`, `baseSubscriptionPrice`

Rendering logic:

1. **Find price element** -- Uses `FORM_PRICE_CONTAINER_SELECTOR` (e.g., `.price__container` for Dawn) with fallback selectors
2. **Hide original price** -- Immediately sets `priceEl.style.display = 'none'` to prevent flicker during rebuild
3. **Create wrapper** -- Creates `.pp-discounts.pp-discounts-container` div, removing any existing one
4. **Determine auto-apply** -- Checks `embedSettings.autoApplyCoupons` and whether coupon price is better than automatic price
5. **Choose winning discount**:
   - If auto-apply enabled AND coupon is better: use coupon
   - Else if automatic discount exists: use automatic
   - Else: no discount (restore original price)
6. **Check coupon applied state** -- Consults `window.couponAppliedState[productId-variantId]` to maintain applied state across re-renders
7. **Build price container** -- For discounts:
   - Crossed-out regular price (`.pp-discounted-price__regular`)
   - If subscription: also shows subscription base price
   - Sale price (`.pp-discounted-price__sale`)
   - Badge for automatic discounts
   - Terms link if `showTermsLink` is enabled
8. **Build coupon block** -- If coupon discount exists, delegates to `DiscountUI.createCouponBlock` (see below)
9. **Restore price** -- If no discount applies, restores `priceEl.style.display = ''`

---

## UI Component Factory (pp_ui-components.js)

The `window.DiscountUI` object provides three factory methods:

### `createPriceContainer(regularPrice, finalPrice, discount, isAutomatic)`
Creates a `.pp-discounted-price-container` with:
- Crossed-out regular price
- Bold sale price
- Automatic discount badge (if `isAutomatic`)
- Terms link (if enabled)

### `createCouponBlock(discount, onApply, onRemove, productId, variantId, isAutoApplied)`
Creates the interactive coupon UI with these DOM elements:
- `.pp-coupon-block` -- Outer container with configurable border
- `.pp-coupon-flag` -- Colored flag tag with clip-path pennant shape, showing "Coupon:" text
- `.pp-coupon-label` -- Checkbox + label text using the `{amount}` template pattern
- `.pp-coupon-applied` -- Applied state with SVG icon (four icon options: flower, square, circle, check) and applied text
- `.pp-coupon-toolbar` -- Action toolbar container
- `.pp-terms-link` -- "Terms and Conditions" link (if enabled)

**XSS Safety**: All text content is set via `document.createElement` + `textContent` (never `innerHTML`). The `{amount}` placeholder is split and reconstructed using `document.createTextNode` and `<b>` elements.

**State Management**:
- Checkbox `change` event toggles `window.couponAppliedState[stateKey]`
- When checked: hides label, shows applied state, calls `onApply()`
- When unchecked: shows label, hides applied state, calls `onRemove()`
- Auto-applied coupons have disabled checkbox with tooltip "This coupon is automatically applied"
- Auto-apply tracked via `sessionStorage.setItem('wf_auto_applied_<CODE>', '1')`

### `showTermsModal(discount)`
Creates a full-screen modal overlay with:
- Discount details: type, value, end date, purchase type (one-time/subscription/both)
- Terms and conditions (from `discountTermsTemplate`, split on newlines)
- Close via X button, overlay click, or Escape key

---

## Coupon Apply/Remove Flow

When a shopper checks the coupon checkbox, the following cascade executes:

### Apply Flow (`applyDiscountCode`)

```
1. Store in sessionStorage: wf_coupon_applied_<CODE> = '1'
2. Build discount URL: /discount/<CODE>?return_to=<current_page>
3. If in theme editor: return (no network call)
4. Attempt fetch() with 2500ms AbortController timeout
   - credentials: 'include', mode: 'cors', redirect: 'follow'
   - If success (2xx-3xx): done
   - If fail/timeout:
5. Attempt hidden iframe with 3500ms timeout
   - iframe.src = discountURL, style.display = 'none', aria-hidden = 'true'
   - On load: remove iframe after 250ms
   - On error or timeout:
6. Direct navigation: window.location.href = discountURL
```

### Remove Flow
When unchecked:
- If an automatic discount exists: re-renders the automatic discount price
- If no automatic discount: removes the wrapper entirely and restores the original theme price

### Auto-Apply Logic
When `autoApplyCoupons === true`:
1. Check if coupon discount exists and is better than automatic discount
2. If yes: `defaultUseCoupon = true` -- coupon is pre-selected
3. On first render with auto-apply: calls `onApply(true)` (silent mode)
4. Tracks in `sessionStorage` to prevent re-applying on page refresh

---

## Price Extraction System

Price extraction is one of the most critical and complex subsystems. The app must read the current price from the theme's DOM -- which varies dramatically across themes -- to calculate discounted prices.

### parsePriceFromDOM

The main entry point. Called for each product container to extract the current price.

**Priority order:**

```
1. Variant JSON (forms only):
   - Looks for <script data-selected-variant> inside the container
   - Parses JSON, extracts json.price or json.final_price
   - Most accurate source (theme-provided, bypasses DOM entirely)

2. getDiscountedFormPrice (forms only):
   - Uses FORM_PRICE_DISCOUNTED_SELECTOR (e.g., '.price-item--sale' for Dawn)
   - Finds the first VISIBLE element matching the selector
   - Critical for subscription/one-time price switching

3. getCleanPriceText (DOM walking):
   - Walks all descendant elements of the price container
   - Finds the first visible element with text containing digits
   - Falls back to first leaf element with price-like text
   - Last resort: raw container textContent
```

### getDiscountedFormPrice

```javascript
function getDiscountedFormPrice(container)
```

This function is critical for themes that show a separate "sale price" element when subscription plans are selected. It uses `FORM_PRICE_DISCOUNTED_SELECTOR` (resolved from the theme selector map).

1. Returns `null` if selector is empty or container is not a form
2. Queries all matching elements: `container.querySelectorAll(FORM_PRICE_DISCOUNTED_SELECTOR)`
3. For each match, calls `isHiddenWithinBoundary(match, container)` to skip hidden ones
4. Uses the first visible match
5. Parses price text via `parsePrice()`
6. Returns `{ price: <cents>, hasCurrencyCode: <boolean> }` or `null`

### getCleanPriceText

```javascript
function getCleanPriceText(container)
```

Theme-agnostic price text extraction that handles the complexity of hidden elements within a price container:

1. Walks all descendant elements via `container.querySelectorAll('*')`
2. For each element, checks visibility using `isElementHiddenWithinContainer(el)`:
   - Checks CSS classes: `visually-hidden`, `sr-only`, `screen-reader`
   - Checks HTML attributes: `hidden`, `aria-hidden="true"`
   - **Checks inline styles only**: `element.style.display === 'none'` or `element.style.visibility === 'hidden'`
   - Walks parent chain but **STOPS at the container boundary** (does not check if container itself is hidden)
3. For visible elements, looks at direct `TEXT_NODE` children for text containing digits
4. Falls back to leaf elements (no child elements) with price-like text
5. Last resort: `container.textContent.trim()`

### isHiddenWithinBoundary

```javascript
function isHiddenWithinBoundary(el, boundary)
```

**CRITICAL IMPLEMENTATION DETAIL**: This function checks visibility using **inline styles only** (`element.style.display`), NOT `getComputedStyle()`. This is intentional:

- The app often hides the price container itself (`priceEl.style.display = 'none'`) to render its own UI
- If `getComputedStyle` were used, ALL children would appear hidden because the parent is hidden
- By checking only inline styles, the function can determine which elements the **theme** has hidden (e.g., subscription price when one-time is selected) versus which elements the **app** has hidden

The function:
1. Starts at the target element
2. Walks up the parent chain
3. At each node, checks `element.style.display === 'none'` or `element.style.visibility === 'hidden'`
4. Also checks for `visually-hidden`, `sr-only`, `screen-reader` CSS classes
5. **Stops walking at the boundary element** (typically the form container)

### findPriceElements

```javascript
function findPriceElements(container)
```

Finds all price container elements within a product container:
1. Uses `EMBED_PRICE_CONTAINER_SELECTOR` for cards, `FORM_PRICE_CONTAINER_SELECTOR` for forms
2. If no elements found and selector source is not `custom`, tries fallback selectors:
   - `.product-price .js-value`, `.product-price`, `.price__current .js-value`, `.price__current`, `.price .js-value`, `.price`
3. Filters out hidden containers (uses `getComputedStyle` for this broader check)
4. Returns array of `{ container: <element> }` objects

---

## Price Formatting (pp_discount-utils.js)

The `DiscountUtils.formatPrice` function handles price formatting with a four-tier fallback:

```
1. Shopify.formatMoney (if currency matches base currency)
   - Uses shop.money_format or shop.money_with_currency_format
   - Only works for the shop's base currency

2. Detected DOM prefix/suffix
   - Uses window.__detectedCurrencyPrefix and window.__detectedCurrencySuffix
   - Captures what the theme actually renders (e.g., "Lek" vs "L" for Albanian Lek)
   - Extracted once from the first price text seen on the page via extractCurrencyFormat()

3. Presentment currency symbol
   - Uses window.presentmentCurrencySymbol (from Liquid's localization object)
   - Falls back to window.currencySymbols map

4. Intl.NumberFormat
   - Browser's built-in currency formatter
   - Final fallback: toFixed(2)
```

### Price Parsing (`parsePrice`)

Handles both US (`1,234.56`) and European (`1.234,56`) number formats:

1. Removes labels ("From", "each", "per item")
2. Removes currency code suffix
3. Calls `detectMoneyFormat()` to classify as `'us'` or `'european'`:
   - Comma + 2 digits at end = European (`,56`)
   - Dot + 2 digits at end = US (`.56`)
   - Dot + 3 digits = European thousands separator (`1.234`)
4. Extracts numeric match with appropriate regex
5. Normalizes to standard decimal format
6. Converts to cents (multiplies by 100, rounds)

---

## Variant Change Handling

Variant changes are detected through multiple mechanisms:

### Detection Methods (in `attachVariantListeners` and `VariantDetection`)

1. **Direct input monitoring** -- Observes `input[name="id"]` and theme-specific variant inputs via `change` and `input` events
2. **MutationObserver** -- Watches variant input elements for `value` attribute changes (for programmatic updates)
3. **URL monitoring** -- Watches for `variant=<id>` in URL parameters
4. **Custom events** -- Listens for `variant:change`, `variant:changed`, `product:variant:changed`, `option:change`
5. **Selling plan detection** -- Monitors `input[name="selling_plan"]` and `select[name="selling_plan"]` for subscription/one-time switching
6. **Price change detection** -- `MutationObserver` on price container parent for `childList` + `characterData` changes

### On Variant Change

```
1. markVariantSwitch(container, newVariantId)
   - Shows skeleton loader immediately (prevents stale price display)
   - Debounced to prevent duplicate switches

2. Reset coupon applied state for new variant
   - window.couponAppliedState[productId-variantId] = false

3. Re-run applyDiscountsToProduct(container, productId)
   - Re-detects current variant via getCurrentVariantInfo()
   - Re-detects selling plan via getCurrentSellingPlanInfo()
   - Filters discounts by variant eligibility (variantScope)
   - Filters by selling plan eligibility (appliesOnSubscription / appliesOnOneTimePurchase)
   - Requests fresh best-discount resolution from server if needed
   - Re-renders UI
```

### Debouncing
- `FORM_PROCESS_DEBOUNCE_MS = 250` -- Minimum interval between processing the same container
- `VARIANT_REAPPLY_FALLBACK_MS = 750` -- Fallback timer for variant reapply if DOM events are missed
- WeakMap-based per-container tracking (`__wfLastRunAt`, `__wfLastVariant`, `__wfLastSellingPlan`)

---

## Best Discount API Call

When the client needs server-side discount resolution (e.g., after a variant change with a new price), it calls the Best Discount API:

### `ensureBestDiscountsFromAPI({ productId, variantId, regularPrice, discounts, container, purchaseContext })`

1. Checks if a cached result exists with matching variant and price
2. If not, prepares a POST request to `/api/best-discounts`:
   ```json
   {
     "shop": "<shop-domain>",
     "token": "<storefront-token>",
     "requests": [{
       "productId": "123",
       "variantId": "456",
       "regularPriceCents": 5000,
       "discounts": [...],
       "purchaseContext": "one_time"
     }]
   }
   ```
3. On success: stores result in `products[productId].bestDiscounts.byVariant[variantId][context]`
4. On failure: falls back to `computeBestDiscountsLocally()` (client-side calculation)
5. After resolution: re-runs `applyDiscountsToProduct()` on all awaiting containers

### Local Fallback (`computeBestDiscountsLocally`)
- Separates automatic and coupon discounts
- For each category, selects the discount that produces the lowest final price
- If both exist and automatic wins (lower or equal final price), coupon is suppressed
- Tie-breaker: higher percentage/value wins

---

## Global State Management

The system maintains several categories of global state:

### Product Data
- `products` -- Map of productId to product data (discounts, variants, handle, bestDiscounts)
- `VARIANT_TO_PRODUCT` -- Map of variantId to productId for reverse lookups

### Processing State (per-container, via WeakMaps)
- `__wfLastRunAt` -- Timestamp of last processing (debounce)
- `__wfLastVariant` -- Last processed `{ variantId, planId }` context
- `__wfLastSellingPlan` -- Last selling plan ID
- `__wfReapplying` -- WeakSet of containers currently being re-rendered (prevents observer loops)
- `__wfPriceObservers` -- MutationObservers watching price elements
- `__wfLastPriceText` -- Last seen price text (change detection)
- `__wfSkeletonShownAt` -- Timestamp when skeleton was shown (minimum display enforcement)
- `__wfSkeletonTimeoutTimers` -- Timeout IDs for skeleton auto-clear

### Coupon State
- `window.couponAppliedState` -- Map of `"productId-variantId"` to boolean
- `sessionStorage.wf_coupon_applied_<CODE>` -- Persists coupon application across page navigations
- `sessionStorage.wf_auto_applied_<CODE>` -- Tracks auto-apply to prevent re-application

### Missing Product Queue
- `missingProductQueue` -- Tracks products not found in initial data load:
  - `productIds` (Set), `handles` (Set), `variantIds` (Set), `containers` (Map)
- `missingProductAttempts` -- Per-key retry counter
- `missingProductFetchFailureCount` -- Global failure counter

### Fetch Deduplication
- `window.__discountsFetchPromise` -- Shared in-flight fetch promise (prevents duplicate API calls)
- `window.__discountsFetchData` -- Cached API response for page-level reuse
- `__wfBestDiscountFetches` -- Map of in-flight best-discount fetch promises
- `__wfBestDiscountAwaitingContainers` -- Map of containers waiting for best-discount results

---

## Missing Product Queue

When a product container is found on the page but has no discount data (not in the initial API response), it enters the missing product queue for batch-fetching:

```
1. queueMissingProductData(container, productId)
   - Extracts identifiers (productId, handle, variantId) from DOM
   - Checks retry budget (max 5 attempts per key)
   - Adds to queue sets
   - Schedules flush in 150ms

2. flushMissingProductData()
   - Filters out already-resolved products
   - Calls fetchAdditionalDiscountData({ productIds, handles, variantIds })
   - On success: merges data, re-runs applyDiscountsToProduct on queued containers
   - On failure: increments failure counter, schedules retry with exponential backoff

3. Exponential Backoff
   - BASE_FAILURE_BACKOFF_MS = 250
   - delay = min(MAX_FAILURE_BACKOFF_MS, 250 * 2^(failures-1))
   - MAX_FAILURE_BACKOFF_MS = 10000 (10 seconds)
   - MAX_MISSING_PRODUCT_ATTEMPTS = 5 per product key
   - MAX_GLOBAL_FETCH_FAILURES = 5 (then gives up entirely)

4. After max attempts: markProductAsNoDiscount()
   - Creates a stub product entry with empty discounts array
   - Clears retry counters for all related keys
```

---

## CSS Architecture

### Two Style Sources

**`e_styles.css.liquid`** -- Styles for product cards on collection pages:
- Uses CSS custom properties set via Liquid (`:root` variables)
- `.embed-discounts .discounted-price-container` -- Inline-flex layout for crossed-out + sale price
- `.embed-discounts .discounted-price__regular` -- Line-through text decoration
- `.embed-discounts .discounted-price__sale` -- Bold, colored with `--discounted-price-color`
- `.embed-discounts .discounted-price__badge` -- Rounded badge with `--automatic-badge-bg-color`
- `.embed-discounts .coupon-badge` -- Styled with `--coupon-badge-bg-color`
- `.embed-discounts .automatic-wrapper` / `.coupon-wrapper` -- `width: fit-content`, block display
- `.discount-selected-items-text` -- "in selected items" helper text

**`pp_styles.css.liquid`** -- Styles for product page forms:
- `.pp-coupon-block` -- Flex column with configurable border (thickness + color from block settings)
- `.pp-coupon-flag` -- Pennant shape via `clip-path: polygon(0% 0%, 100% 0%, 90% 50%, 100% 100%, 0% 100%)`
- `.pp-coupon-label` -- Inline-flex with checkbox, configurable accent color
- `.pp-coupon-applied` -- Hidden by default, shown via `.visible` class
- `.pp-discounted-price-container` -- Inline-flex with column gap
- `.pp-discounted-price__regular` -- Line-through
- `.pp-discounted-price__sale` -- Bold, configurable color and font size
- `.pp-discounted-price__badge` -- Rounded badge with configurable background
- Skeleton loader styles (pulse animation)
- Terms modal styles (fixed overlay, centered content, backdrop blur)

### Skeleton Loader

The skeleton loader provides visual feedback during discount data loading:
- `.pp-discounts--loading` -- Container class, min-height 100px
- `.pp-skeleton-loader` -- Flex column with animated pulse lines
- `.pp-skeleton-line--price` -- Taller line (28px) simulating a price
- `.pp-skeleton-line--lg/md/sm` -- Decreasing widths (85%/65%/45%)
- `@keyframes pp-skeleton-pulse` -- Opacity oscillation between 1.0 and 0.55

**Timing constraints:**
- `SKELETON_TIMEOUT_MS = 8000` -- Maximum display time before auto-clearing
- `SKELETON_MIN_DISPLAY_MS = 300` -- Minimum display time to prevent flicker (if data resolves faster than 300ms, skeleton remains until 300ms have passed)

---

## Theme Editor Preview Mode

When the merchant is in Shopify's theme editor (`Shopify.designMode === true`), the system supports preview modes:

### Preview Modes
- `"real"` -- Shows actual discount data from the API (default)
- `"automatic"` -- Simulates a 20% automatic discount on all products
- `"coupon"` -- Simulates a 15% coupon discount with code "PREVIEW15"

### Preview Behavior
- Preview mode is read from `window.ppPreviewMode` (set by block setting `pp_preview_mode`)
- `buildPreviewDiscount()` creates synthetic discount objects
- Discount URL application is skipped in editor mode (`if (isEditor) return;`)
- `showCouponApplied` block setting allows previewing the "applied" state of coupons
- `window.APP_VERSIONS` exposes detailed version info only in the editor (backend URL, shop domain, extension name)

### Environment Classification
The inline script classifies the backend environment based on `DISCOUNT_API_BASE_URL`:
- `"DEV"` -- localhost, 127.x, ngrok
- `"TESTING"` -- test, staging, preview in URL
- `"PROD"` -- wizardformula, discountsapp in URL

This is stored in `window.APP_VERSIONS.BACKEND` and used by dev-only features like coupon unapply toggle.
