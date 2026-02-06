I'm rebuilding a Shopify app called "Discount Display Pro" from scratch. Phase 1 (scaffold, database, schema) and Phase 2 (backend pipeline, webhooks, APIs, auth) are already complete.

The full specification is in `docs/spec/` (14 files). The CLAUDE.md in the project root has the coding conventions — read it first.

You are **Agent 5: Storefront Theme Extension** (Phase 3 — this is the most complex agent). You're building the theme app extension that displays discount badges, coupon UI, and handles price extraction on the storefront.

---

## Step 1: Read the spec

Read these files in order:

1. `docs/spec/13-known-issues-improvements.md` — **READ THIS FIRST.** It documents every mistake from v1 that you must NOT repeat. Pay special attention to the 205KB monolith issue.
2. `docs/spec/05-storefront-display-system.md` — JS modules, DOM manipulation, price extraction
3. `docs/spec/10-theme-compatibility.md` — 7 supported themes, selector system, custom overrides

## Step 2: Reference the v1 source (READ CAREFULLY)

These files are in the v1 repo at `/Users/ricardo/Code/Momentus/shopify-discount-app/`. They contain **battle-tested DOM logic** built over months of debugging against real Shopify themes. Read them to understand the edge cases, then rewrite as clean bundled modules:

- `/Users/ricardo/Code/Momentus/shopify-discount-app/extensions/discounts-display-pro/assets/e_discounts.js` — core discount display logic, price extraction with 3-strategy fallback, hidden element detection. **This is 205KB of battle-tested code. Read it for edge cases, then rewrite as clean modules.**
- `/Users/ricardo/Code/Momentus/shopify-discount-app/extensions/discounts-display-pro/assets/e_forms.js` — product form UI, coupon checkbox, discount badges on forms
- `/Users/ricardo/Code/Momentus/shopify-discount-app/extensions/discounts-display-pro/assets/pp_ui-components.js` — shared UI components (createCouponBlock, createDiscountBadge)
- `/Users/ricardo/Code/Momentus/shopify-discount-app/extensions/discounts-display-pro/assets/pp_variant-detection.js` — variant selection detection across themes
- `/Users/ricardo/Code/Momentus/shopify-discount-app/extensions/discounts-display-pro/assets/pp_discount-utils.js` — discount calculation utilities
- `/Users/ricardo/Code/Momentus/shopify-discount-app/extensions/discounts-display-pro/assets/theme_selectors.js` — DOM selector handling
- `/Users/ricardo/Code/Momentus/shopify-discount-app/extensions/discounts-display-pro/assets/logger.js` — client-side logging (window.DDPLogger)
- `/Users/ricardo/Code/Momentus/shopify-discount-app/extensions/discounts-display-pro/blocks/e_discounts.liquid` — Liquid block template, schema settings, config injection
- `/Users/ricardo/Code/Momentus/shopify-discount-app/extensions/discounts-display-pro/snippets/pp_styles.css.liquid` — all CSS styles
- `/Users/ricardo/Code/Momentus/shopify-discount-app/app/utils/theme-selectors.server.js` — THEME_SELECTOR_MAP with **exact CSS selectors for 7 themes** (you MUST use these exact selectors)

## Step 3: Build

### 3a. Build pipeline
- Rollup or esbuild config for the `extensions/` directory
- Input: clean ES modules in `extensions/discounts-display-pro/src/`
- Output: single minified JS file + source map in `extensions/discounts-display-pro/assets/`
- The output file must work as a Shopify theme extension asset (no ES module syntax in output, IIFE format)

### 3b. JS modules (source, pre-bundle)

Split the v1 monolith into focused modules under `extensions/discounts-display-pro/src/`:

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

### 3c. Liquid template (`blocks/e_discounts.liquid`)
- Block schema with all merchant-configurable settings
- Inject shop config into `window.*` globals:
  - `window.DISCOUNT_STOREFRONT_TOKEN` (from metafield)
  - `window.DISCOUNT_APP_URL` (app URL for API calls)
  - `window.DISCOUNT_SETTINGS` (badge colors, positions, etc.)
- Load the bundled JS file with `defer`
- CSS via `snippets/pp_styles.css.liquid`

### 3d. Theme selector system
- Support these 7 themes with **exact CSS selectors** from the v1 `theme-selectors.server.js`:
  - Dawn, Symmetry, Vision, Wonder, Spotlight, Horizon, Savor
- Selector types per theme: `formPriceContainer`, `formPrice_discounted`, `priceContainer`, `productCardPrice`, etc.
- Runtime theme detection and selector loading via `/api/theme-selectors`
- Support custom selector overrides (merchant-configured in settings)

### 3e. CSS (`snippets/pp_styles.css.liquid`)
- Classes: `.pp-coupon-block`, `.pp-coupon-flag`, `.pp-coupon-label`, `.pp-discount-badge`
- Responsive design
- Theme-aware styling (works with light/dark themes)

---

## Critical requirements

- Output MUST be bundled and minified (not 205KB of unminified source)
- Price extraction MUST check inline styles (`element.style.display`), NOT `getComputedStyle()` — this is critical for subscription switching where the parent container is hidden by the app itself
- Hidden element detection MUST stop at container boundary
- Coupon apply MUST have the 3-fallback strategy (fetch → iframe → navigation)
- The exact CSS selectors for each theme MUST match what's in the v1 `theme-selectors.server.js`
- Use `window.DDPLogger` for client-side logging in the theme extension
- Do NOT over-engineer — build exactly what the spec describes
