# Business Requirements

## Problem Statement

Shopify merchants create discounts (automatic and code-based) through the Shopify admin, but the default storefront behavior is limited in how it communicates these discounts to customers. Automatic discounts are invisible on product pages until the customer reaches checkout. Code-based discounts require the customer to already know the code and manually enter it at checkout. There is no native way to show a "Sale 20% OFF" badge on a product card, display the discounted price on a product page before checkout, or let a customer apply a coupon code with a single checkbox click directly on the product page.

This creates a gap: merchants set up discounts, but customers do not see them while browsing, leading to missed conversions and a poor shopping experience.

## Target User

The primary user is a Shopify merchant who:
- Creates product-level discounts (percentage off, fixed amount off) in the Shopify admin
- Wants customers to see discount information while browsing products, not only at checkout
- May offer coupon codes and wants customers to be able to apply them directly from the product page
- Uses a supported Shopify Online Store 2.0 theme (Dawn, Symmetry, Vision, Wonder, Spotlight, Horizon, Savor, or a Dawn-based custom theme)
- May sell subscription products alongside one-time purchases
- May operate a multi-currency store

The merchant is not a developer. They configure the app through the Shopify admin (embedded app pages) and the Shopify theme editor. They do not write code.

## Core Value Proposition

1. **Visibility**: Discounts become visible on product cards and product pages, not hidden until checkout
2. **Conversion**: Customers can see and apply coupon codes directly from the product page with one click
3. **Simplicity**: Zero-code setup -- install the app, enable the embed block in the theme editor, and discounts automatically appear
4. **Accuracy**: Discount calculations use the customer's presentment currency and respect variant-specific pricing, subscription pricing, and Shopify's native discount rules

---

## Feature Set by Tier

### Free Tier Features

**Price:** $0/month

**Live discount limit:** 1 active discount displayed on the storefront at a time

**Features:**
- 1 active discount displayed on the storefront
- Automatic discount support (percentage off)
- Code discount support (coupon checkbox on product page)
- Product page display (discount badge, updated price, coupon apply UI)
- Collection/grid page display (discount badge on product cards)
- Customizable UI (badge text, colors, fonts, alignment via theme editor and app settings)
- Updated price shown in cart and checkout (Shopify handles this natively once the discount is active)
- Integrated with Shopify's native discount system (no duplicate discount logic -- reads from Shopify directly)

**Not included in Free:**
- Auto-apply coupons (locked; checkbox disabled in settings)
- Fixed-amount discount support (e.g., "$5 off" -- requires Basic)
- More than 1 live discount (additional discounts are saved with HIDDEN status)

### Basic Tier Features ($9.99/month)

**Price:** $9.99/month

**Live discount limit:** 3 active discounts displayed simultaneously

**Features (in addition to Free):**
- 3 live discounts displayed simultaneously on the storefront
- Auto-apply coupons toggle: when enabled, eligible coupon discounts are automatically applied on product pages without the customer needing to interact with a checkbox
- Fixed-amount discount support (e.g., "$5 off a product" -- DiscountAmountValue with a specific amount)

### Advanced Tier Features ($19.99/month)

**Price:** $19.99/month

**Live discount limit:** Unlimited

**Features (in addition to Basic):**
- Unlimited live discounts displayed simultaneously
- Subscription product compatibility: discounts that apply on subscription purchases (`appliesOnSubscription: true`) are supported and displayed correctly when the customer selects a selling plan
- Variant-specific discount support: discounts that target specific product variants (not the entire product) are resolved and displayed per-variant

---

## Supported Discount Types

### Automatic Discounts (Percentage, Fixed Amount)

**What they are:** Discounts created in the Shopify admin as "Automatic discounts" -- applied automatically at checkout without a code.

**How the app displays them:**
- A badge appears on product cards (collection pages) and product forms (product pages) showing the discount amount (e.g., "Sale 20% OFF")
- The product's price is visually updated to show the discounted price alongside the original price (struck through)
- No customer interaction is required -- the badge and price update appear automatically

**Supported value types:**
- **Percentage** (all tiers): e.g., "20% off"
- **Fixed amount** (Basic tier and above): e.g., "$5 off" -- uses the `DiscountAmountValue` with a specific monetary amount

**Targeting:**
- Can target all products, specific collections, specific products, or specific variants
- Variant-specific targeting requires the Advanced tier

### Code Discounts (Coupon Checkbox)

**What they are:** Discounts created in the Shopify admin as "Discount codes" -- require a customer to enter a code at checkout.

**How the app displays them:**
- A coupon block appears on the product page with:
  - A label (e.g., "Coupon:")
  - A checkbox with the discount description (e.g., "Apply 15% discount")
  - The discount code displayed alongside the checkbox
  - An optional terms and conditions link
- When the customer checks the checkbox:
  1. The UI updates immediately to show the applied state (checkmark icon, updated text, discounted price)
  2. In the background, the app applies the discount code to the Shopify session by navigating to `/discount/<CODE>?return_to=<current_page>` (see Coupon Apply/Remove Flow below)
  3. The discount persists through to checkout

**Auto-apply behavior (Basic tier and above):**
- When the auto-apply setting is enabled, the checkbox starts in the "applied" state
- The discount code is applied silently in the background on page load
- The customer sees the discounted price immediately without any interaction

### Unsupported Types (BXGY, Free Shipping, App Discounts)

The following discount types cannot be displayed on product pages and are excluded with specific reasons:

| Discount Type | Exclusion Reason | Explanation Shown to Merchant |
|---------------|-----------------|-------------------------------|
| **Buy X Get Y (BXGY)** | `BXGY_DISCOUNT` | "Buy X Get Y discounts cannot be displayed on product pages. These discounts require cart-level calculations." |
| **Free Shipping** | `NOT_PRODUCT_DISCOUNT` | "This shipping type cannot be displayed on product pages. Only product-level discounts are supported." |
| **Order-level discounts** | `NOT_PRODUCT_DISCOUNT` | "This order type cannot be displayed on product pages. Only product-level discounts are supported." |
| **App discounts** | `NOT_PRODUCT_DISCOUNT` | Discounts created by other apps via the Shopify Functions API are not synced. |
| **Customer-segment-restricted** | `CUSTOMER_SEGMENT` | "This discount is limited to specific customer groups and cannot be displayed publicly on your storefront." |
| **Minimum requirement discounts** | `MIN_REQUIREMENT` | "This discount requires a minimum cart value or quantity, which cannot be verified on the product page." |

These discounts are still synced from Shopify and stored in the database, but their LiveDiscount record is saved with status `NOT_SUPPORTED` and the appropriate exclusion reason. The merchant can see these discounts in the admin dashboard with an explanation of why they are not displayed.

---

## Storefront Display Behavior

### Product Cards (Collection/Grid Pages)

On collection pages, search results, and any page that renders product cards in a grid:

- **Badge placement:** A small badge appears on or near the product card, positioned according to the merchant's alignment setting (left, center, or right)
- **Automatic discount badge:** Shows the discount amount (e.g., "Sale 20% OFF") with a customizable background color (default: gold/amber `#E9A417`) and text color (default: white)
- **Coupon discount badge:** Shows a coupon message (e.g., "Save 15% with coupon") with a separate customizable background color (default: blue `#279ed9`) and text color (default: white)
- **Price update:** The product card's price is updated to show the discounted price in the merchant's chosen color (default: green `#199457`), with the original price shown struck through
- **Font size:** Badge and price font sizes are independently configurable

The app finds product card elements in the DOM using theme-specific CSS selectors (card container and card price selectors) and injects the badge and price markup.

### Product Forms (Product Detail Pages)

On product pages, featured product sections, and quick-add modals:

- **Automatic discounts:** A badge (e.g., "Sale 20% OFF") appears near the product form, followed by the updated discounted price
- **Coupon discounts:** A coupon block appears with:
  - A header label (e.g., "Coupon:" -- customizable)
  - A checkbox with the apply/applied label (e.g., "Apply 15% discount" / "15% off coupon applied")
  - A visual border around the coupon block (border thickness and color customizable)
  - An applied-state icon (choice of flower, square, circle, or checkmark; color customizable)
  - An optional terms and conditions link that expands to show a bullet-point list
- **Price display:** The native Shopify price container is hidden and replaced with the app's price display showing original price (struck through) and discounted price
- **Variant switching:** When the customer selects a different variant, the discount display updates in real-time to reflect the variant's price and any variant-specific discount eligibility
- **Subscription switching:** When the customer switches between one-time purchase and a subscription selling plan, the discount display recalculates using the appropriate base price (one-time vs. subscription)

### Coupon Apply/Remove Flow

When a customer interacts with the coupon checkbox on a product page:

**Apply flow (checkbox checked):**
1. **UI update (immediate):** The checkbox text changes to the "applied" label, the applied icon appears, and the price updates to show the discounted amount
2. **Session storage:** A flag `wf_coupon_applied_<CODE>` is set in `sessionStorage` to persist the applied state across page navigations within the session
3. **Background apply (three-tier fallback):**
   - **Attempt 1 -- Fetch:** A background `fetch()` request is made to `/discount/<CODE>?return_to=<current_page>` with `credentials: 'include'`. This silently sets the discount on the Shopify session. Timeout: 2.5 seconds.
   - **Attempt 2 -- Hidden iframe:** If fetch fails, a hidden iframe is created with the discount URL. The iframe loads Shopify's discount application page in the background. Timeout: 3.5 seconds.
   - **Attempt 3 -- Page navigation:** If the iframe also fails, the browser navigates directly to the discount URL, which redirects back to the product page with the discount applied.
4. **Theme editor behavior:** In the Shopify theme editor (design mode), the background apply is skipped entirely to avoid side effects during preview.

**Remove flow (checkbox unchecked):**
- The UI reverts to the unapplied state (original label, no icon, original price)
- The `sessionStorage` flag is removed
- Note: Removing the discount from the Shopify session is not done programmatically -- the customer would need to manually remove the code at checkout. The UI simply reflects the visual "unapplied" state.

### Auto-Apply Coupon Feature

**Tier requirement:** Basic ($9.99/month) or higher

When enabled in settings:
1. On product page load, if a coupon discount is available for the current product, the coupon checkbox starts in the "applied" state
2. The discount code is applied silently in the background using the same three-tier fallback (fetch -> iframe -> navigation)
3. If the URL contains a `?discount=<CODE>` parameter, that code takes priority
4. The `sessionStorage` flag is checked to avoid re-applying a code that was already applied in the current session
5. If both an automatic discount and a coupon discount are available, the coupon is shown in applied state only if it provides a better (larger) discount than the automatic one

### Subscription vs One-Time Purchase Switching

**Tier requirement:** Advanced ($19.99/month) for subscription discount display

When a product has selling plans (subscriptions):
1. The product page typically shows a toggle or radio buttons for "One-time purchase" vs. "Subscribe and save"
2. When the customer switches between these options:
   - The app detects the change via variant/selling plan input monitoring
   - The base price changes (subscription may have its own price or a selling plan discount)
   - The discount is recalculated against the new base price
   - The discount display updates accordingly
3. **Price extraction considerations:**
   - When the subscription toggle hides/shows price elements, the app checks inline `style.display` (not `getComputedStyle`) because the price container itself may be hidden by the app
   - The app walks up the DOM tree to find hidden ancestors but stops at a defined boundary (the form container) to avoid false positives
   - Elements with accessibility classes (`visually-hidden`, `sr-only`, `screen-reader`) are always skipped as they contain screen-reader-only text, not the visible price

---

## Merchant Dashboard

### Setup Checklist / Onboarding

When a merchant first installs the app, the dashboard displays a setup checklist with tasks:

1. **Enable embed block** (manual task)
   - Description: "Enable the discount embed block to display discounts on your product pages."
   - Action button: "Open Theme Editor" (links to `https://admin.shopify.com/themes/current/editor?context=apps`)
   - The merchant must manually enable the "Discount Collections" block in the theme editor's App Embeds section
   - The app attempts to detect whether the embed block is enabled and marks this task complete when it is

2. **Customize appearance** (optional manual task)
   - Description: "Adjust colors, text, and styling to match your brand and create a consistent shopping experience."
   - Action button: "Open Settings" (links to the app's settings page)

Additional automated tasks may be shown based on discount sync status.

### Discount List with Status Indicators

The discount management page shows all synced discounts with:

- **Discount title and summary** from Shopify
- **Type indicator:** Automatic or Code
- **Status badge:**
  - `LIVE` -- Currently displayed on the storefront (green)
  - `HIDDEN` -- Synced but not displayed (either manually hidden or tier limit reached)
  - `SCHEDULED` -- Has a future start date; will become LIVE when the start date arrives
  - `NOT_SUPPORTED` -- Cannot be displayed due to an inherent limitation (see Exclusion Rules)
  - `UPGRADE_REQUIRED` -- Could be displayed, but the merchant's current tier does not support this discount type
- **Exclusion reason** (for NOT_SUPPORTED and UPGRADE_REQUIRED): A human-readable explanation of why the discount cannot be displayed, with an upgrade prompt if applicable
- **Date range:** Start and end dates for the discount

### Tier Usage and Upgrade Prompts

The dashboard shows:
- Current tier name and price
- Number of live discounts used out of the tier limit (e.g., "1 / 1 live discounts" for Free, "2 / 3" for Basic)
- Usage percentage bar
- Upgrade prompt when the merchant is at or near their live discount limit
- Feature comparison across tiers when viewing upgrade options
- If a discount has status UPGRADE_REQUIRED, the exclusion detail message includes the current tier name and a suggestion to upgrade (e.g., "Variant-specific discounts require the Advanced plan. Your current plan is Free.")

---

## Settings Available to Merchants

All settings are persisted as Shopify metafields under the `discount_app` namespace, meaning they survive app reinstalls and are accessible from the storefront Liquid templates.

### Appearance Customization (Badge Text, Colors, Fonts, Icons)

**Product Card Settings** (controlled via Shopify theme editor):

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| Price font size | Range (12-40px) | 22px | Font size for the discounted price on product cards |
| Price color | Color picker | `#199457` (green) | Color of the discounted price text |
| Automatic badge background | Color picker | `#E9A417` (amber) | Background color of the automatic discount badge |
| Automatic badge text color | Color picker | `#ffffff` (white) | Text color of the automatic discount badge |
| Coupon badge background | Color picker | `#279ed9` (blue) | Background color of the coupon discount badge |
| Coupon badge text color | Color picker | `#ffffff` (white) | Text color of the coupon discount badge |
| Badge font size | Range (8-24px) | 14px | Font size for badge text |
| Badge alignment | Select | Left | Horizontal alignment of badges: Left, Center, or Right |

**Product Form Settings** (controlled via Shopify theme editor):

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| Price font size | Range (12-40px) | 24px | Font size for the discounted price on product forms |
| Price color | Color picker | `#199473` (green) | Color of the discounted price text |
| Automatic badge background | Color picker | `#E9A417` (amber) | Background color of the automatic discount badge |
| Automatic badge text color | Color picker | `#ffffff` (white) | Text color of the automatic discount badge |
| Coupon badge background | Color picker | `#279ed9` (blue) | Background color of the coupon discount badge |
| Coupon badge text color | Color picker | `#ffffff` (white) | Text color of the coupon discount badge |
| Badge font size | Range (8-24px) | 14px | Font size for badge text |
| Coupon box border thickness | Range (0-8px) | 1px | Border thickness around the coupon checkbox block |
| Coupon box border color | Color picker | `#000000` (black) | Border color around the coupon checkbox block |
| Applied icon style | Select | Flower | Icon shown when coupon is applied: Flower, Square, Circle, or Check |
| Applied icon color | Color picker | `#199473` (green) | Color of the applied-state icon |
| Applied text color | Color picker | `#199473` (green) | Color of the "applied" label text |
| Show terms link | Checkbox | Enabled | Whether to show the terms and conditions link below the coupon block |
| Terms link font size | Range (8-36px) | 11px | Font size for the terms link text |

**Preview Settings** (theme editor only, not visible on live storefront):

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| Preview mode | Select | Real discounts | "Real discounts" loads actual data; "Automatic" and "Coupon" show simulated discount UI for styling purposes |
| Preview: show applied state | Checkbox | Disabled | When enabled, previews the coupon checkbox in its applied state |

**Text Customization** (controlled via app Settings page):

| Setting | Default Value | Placeholder | Description |
|---------|---------------|-------------|-------------|
| Card automatic badge text | `Sale {amount} OFF` | `{amount}` = discount value | Badge text for automatic discounts on product cards |
| Card coupon badge text | `Save {amount} with coupon` | `{amount}` = discount value | Badge text for coupon discounts on product cards |
| Form automatic badge text | `Sale {amount} OFF` | `{amount}` = discount value | Badge text for automatic discounts on product forms |
| Coupon label text | `Coupon:` | -- | Header label above the coupon checkbox |
| Coupon apply label | `Apply {amount} discount` | `{amount}` = discount value | Checkbox label before the coupon is applied |
| Coupon applied label | `{amount} off coupon applied` | `{amount}` = discount value | Checkbox label after the coupon is applied |

The `{amount}` placeholder is replaced at runtime with the actual discount amount (e.g., "20%", "$5.00") in the customer's presentment currency.

### Advanced CSS Selector Overrides

For merchants whose themes are not auto-detected or who need to customize where the discount UI appears:

| Setting | Default | Description |
|---------|---------|-------------|
| Use auto-detect for all selectors | Enabled | Master toggle: when on, the app uses its built-in theme detection. When off, individual selectors can be overridden. |
| Card price selector | (auto) | CSS selector for the price element inside product cards (e.g., `.price__container`) |
| Card container selector | (auto) | CSS selector for the product card wrapper element (e.g., `.card__information`) |
| Form container selector | (auto) | CSS selector for the product form wrapper (e.g., `.product__info-wrapper`) |
| Form price selector | (auto) | CSS selector for the price element inside product forms (e.g., `.price__container`) |
| Variant input selector | (auto) | CSS selector for the variant/option input that the app monitors for changes (e.g., `input[name="id"]`) |

Each selector can be set to "Auto-detect" (uses the theme selector map) or "Custom" (merchant provides a CSS selector string). Custom selectors are disabled when the master "Use auto-detect" toggle is on.

### Auto-Apply Coupons Toggle

| Setting | Default | Tier Requirement | Description |
|---------|---------|------------------|-------------|
| Auto-apply coupons | Disabled | Basic ($9.99) or higher | When enabled, coupon discounts are automatically applied on product pages without customer interaction. On the Free tier, this checkbox is disabled with a message: "Available on the Basic plan and above." with an upgrade link. |

### Terms and Conditions Template

| Setting | Default | Description |
|---------|---------|-------------|
| Bullet list content | See below | Multi-line text field where each line becomes a bullet point in the terms list shown below the coupon block on the storefront. |

Default terms template:
```
This discount may not combine with other promotions. Please confirm final price at checkout
Valid on selected products only
We reserve the right to modify or cancel this offer at any time
```

---

## Supported Themes

The app includes built-in CSS selector maps for the following Shopify themes:

| Theme | Shopify Theme Store ID | Notes |
|-------|----------------------|-------|
| **Dawn** | 887 | Default/fallback theme. Most thoroughly tested. |
| **Symmetry** | 568 | |
| **Vision** | 2053 | Has unique discounted price selector (`.amount.discounted`) |
| **Wonder** | 2684 | Multiple card container selectors to support various sections |
| **Spotlight** | 1891 | |
| **Horizon** | 2481 | Uses `[ref="..."]` attribute selectors and custom elements |
| **Savor** | -- | Uses custom elements similar to Horizon |

**Fallback behavior:** If the merchant's theme is not in the map, Dawn selectors are used as the default. This works for many Dawn-based or Dawn-derived themes. For others, the merchant can use the Advanced CSS Selector Override settings.

**Theme detection:** The app identifies the active theme by:
1. Shopify Theme Store ID (most reliable -- numeric ID mapped to theme name)
2. Theme schema name (from the theme's JSON schema)
3. Theme name (normalized: lowercased, trailing metadata stripped, version numbers removed)

---

## Multi-Currency Support

- The app uses **presentment currency** (the customer's shopping currency) for all price displays and discount calculations
- Discount values from Shopify may be in the shop's base currency; the app relies on Shopify's currency formatting (`formatMoney`) for display
- Price extraction from the DOM reads the currently displayed price (which is already in the customer's presentment currency) as the base for discount calculations
- The app detects whether prices include a currency code (e.g., "USD $10.00" vs. "$10.00") and preserves the format when rendering discounted prices

---

## Exclusion Rules (Why a Discount May Not Display)

When a discount is synced from Shopify but cannot be displayed on the storefront, the app assigns an exclusion reason and a human-readable explanation. Merchants see these explanations in the dashboard next to the affected discount.

### Inherent Limitations (Status: NOT_SUPPORTED)

These discounts can never be displayed, regardless of the merchant's tier:

| Exclusion Reason | Condition | Merchant-Facing Explanation |
|------------------|-----------|----------------------------|
| `NOT_PRODUCT_DISCOUNT` | The discount's class is not `PRODUCT` (e.g., it is `ORDER` or `SHIPPING`) | "This [type] type cannot be displayed on product pages. Only product-level discounts are supported." |
| `BXGY_DISCOUNT` | The discount is a Buy X Get Y type (`__typename` contains "Bxgy") | "Buy X Get Y discounts cannot be displayed on product pages. These discounts require cart-level calculations." |
| `CUSTOMER_SEGMENT` | The discount is restricted to specific customer groups (not "all customers") | "This discount is limited to specific customer groups and cannot be displayed publicly on your storefront." |
| `MIN_REQUIREMENT` | The discount has a minimum purchase requirement (cart value or quantity) | "This discount requires a minimum cart value or quantity, which cannot be verified on the product page." |

### Tier-Based Limitations (Status: UPGRADE_REQUIRED)

These discounts could be displayed if the merchant upgrades their plan:

| Exclusion Reason | Condition | Required Tier | Merchant-Facing Explanation |
|------------------|-----------|---------------|----------------------------|
| `SUBSCRIPTION_TIER` | The discount applies on subscription purchases (`appliesOnSubscription: true`) | ADVANCED | "Subscription discounts require the Advanced plan. Your current plan is [tier]." |
| `VARIANT_TIER` | The discount targets specific variants (not entire products) | ADVANCED | "Variant-specific discounts require the Advanced plan. Your current plan is [tier]." |
| `FIXED_AMOUNT_TIER` | The discount value is a fixed monetary amount (not a percentage) | BASIC | "Fixed-amount discounts require the Basic plan or higher. Your current plan is [tier]." |

### Status Lifecycle

A discount's LiveDiscount status follows this lifecycle:

```
Discount synced from Shopify
        |
        v
  [Check exclusion rules]
        |
        +--- Excluded (inherent) -----> NOT_SUPPORTED (permanent until discount changes)
        |
        +--- Excluded (tier) ---------> UPGRADE_REQUIRED (clears if merchant upgrades)
        |
        +--- Not excluded
              |
              +--- Start date in future ----> SCHEDULED (becomes LIVE when start date arrives)
              |
              +--- Active and within dates
              |       |
              |       +--- Tier limit not reached ----> LIVE (displayed on storefront)
              |       |
              |       +--- Tier limit reached ---------> HIDDEN (not displayed, no room)
              |
              +--- Expired or past end date ----> Deleted (removed from both tables)
```

Merchants can have discounts in multiple statuses simultaneously. For example, a Free tier merchant with 3 synced discounts might have: 1 LIVE, 1 HIDDEN (tier limit reached), and 1 NOT_SUPPORTED (it is a BXGY discount).

### Temporal Rules

- **Expired discounts** (Shopify status `EXPIRED` or past the `endsAt` date) are deleted from both the `Discount` and `LiveDiscount` tables -- they are not kept for historical reference
- **Scheduled discounts** (future `startsAt` date) are stored with `SCHEDULED` status and transition to `LIVE` or `HIDDEN` when the start date arrives
- **Discounts with no end date** remain in their current status indefinitely until the merchant deletes or deactivates them in Shopify
