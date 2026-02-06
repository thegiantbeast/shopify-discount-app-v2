# Admin UI Pages

The Discount Display Pro admin interface is built with Remix v2 and Shopify Polaris. All pages are embedded within the Shopify admin via the App Bridge, so merchants never leave the Shopify dashboard. This document covers every admin route, its data loading, actions, and UI components.

---

## Framework: Remix v2 + Shopify Polaris

- **Remix v2.16.1** provides server-side rendering, file-based routing, loaders (GET), and actions (POST).
- **Shopify Polaris v12** supplies the design system -- cards, badges, buttons, index tables, toasts, modals, and layout primitives.
- **Shopify App Bridge React v4** embeds the app inside the Shopify admin shell and provides `TitleBar`, `NavMenu`, and `useAppBridge`.
- All admin routes live under `app/routes/app.*.jsx`. The parent layout (`app.jsx`) wraps every page with authentication and the navigation menu.

---

## App Shell (app.jsx)

**File:** `app/routes/app.jsx`

The shell is the parent route for every `/app/*` page. It handles three responsibilities:

### Loader

- Calls `authenticate.admin(request)` to verify the merchant session.
- Returns the `SHOPIFY_API_KEY` environment variable to the client.

### Component

- Wraps all child routes in `<AppProvider isEmbeddedApp>` so the Polaris design system and App Bridge context are available everywhere.
- Renders the `<NavMenu>` with four navigation links:

| Link Label        | Route            |
|-------------------|------------------|
| Home              | `/app`           |
| Manage discounts  | `/app/discounts` |
| Subscription      | `/app/pricing`   |
| Settings          | `/app/settings`  |

- Renders `<Outlet />` for the active child route.

### Error Boundary

- Delegates to `boundary.error()` from `@shopify/shopify-app-remix/server` so that Shopify-specific response headers are included in error pages.

---

## Dashboard (app._index.jsx)

**File:** `app/routes/app._index.jsx`

The dashboard is the first page merchants see after opening the app. It provides an at-a-glance overview of plan status, setup progress, live discount counts, and developer tools (in dev mode).

### Data Loading

The loader performs several operations in sequence:

1. **Authentication:** `authenticate.admin(request)` obtains the `admin` GraphQL client and `session`.
2. **Shop Resolution:** `resolveShopWithAuth(admin, "IndexPage")` determines the shop domain via GraphQL.
3. **Plan Refresh Detection:** Checks URL search parameters for billing-related signals (`billing`, `charge_id`, `subscription_id`, `app_subscription_id`, `plan`, `plan_id`, `planChange`). When any are present, the managed subscription cache is bypassed.
4. **Managed Subscription Fetch:** Queries the Shopify GraphQL API for `currentAppInstallation.activeSubscriptions` to get plan details including:
   - Subscription ID, name, status, trial days
   - Recurring pricing details (plan handle, interval, price, discount)
   - Cache: Results are stored in an in-memory `Map` with a **10-minute TTL** (`MANAGED_SUBSCRIPTION_CACHE_TTL_MS = 600000`). Cache is invalidated when plan refresh signals are detected.
5. **Tier Reconciliation:** `reconcileTierFromSubscription(shop, activeSubscription)` compares the subscription's plan handle against known tier definitions. If the shop's stored tier differs from the subscription's resolved tier, it updates the database. This acts as a safety net for missed webhook events.
6. **Billing Metadata Sync:** `syncBillingMetadata(shop, activeSubscription)` updates the shop's `billingCurrentPeriodEnd` and `pendingTierEffectiveAt` fields in the database.
7. **Dashboard Data:** `loadDashboardData(shop)` aggregates:
   - `tierInfo` -- current tier name, limits, usage percentage, pending tier info
   - `totalDiscountCount` -- total `LiveDiscount` records for the shop
   - `liveDiscountCount` -- `LiveDiscount` records with status `LIVE`
   - `manualTaskStatuses` -- completion state of manual setup tasks from the `SetupTask` table
8. **Embed Block Status:** `getEmbedBlockStatus(admin, shop)` checks whether the theme app extension embed block is enabled in the active theme.
9. **Install Status:** Reads `Shop.installStatus` to determine if the initial discount import completed, failed, or is still in progress.

**Return shape:**

```js
{
  tierInfo,            // { tier, tierName, liveDiscountLimit, currentLiveDiscounts, usagePercentage, isUnlimited, pendingTier, pendingTierEffectiveAt }
  availableTiers,      // Array of { key, name, price, features }
  shop,                // "example.myshopify.com"
  discountCount,       // Number (same as liveDiscountCount)
  liveDiscountCount,   // Number
  totalDiscountCount,  // Number
  manualTaskStatuses,  // { "Enable embed block": true, "Customize appearance (optional)": false }
  embedBlockStatus,    // { checked: boolean, enabled: boolean }
  showDevTools,        // Boolean (from SHOW_DASHBOARD_DEV_TOOLS env var)
  planRefreshRequested,// Boolean
  installStatus,       // "done" | "failed" | null
}
```

### Components

#### Setup Checklist

A progress card displayed when `installStatus === "done"`. Contains four tasks with a visual progress bar:

| Task                             | Detection    | Description                                                                 |
|----------------------------------|-------------|-----------------------------------------------------------------------------|
| Create your first discount       | Automatic   | Completed when `totalDiscountCount > 0`                                     |
| Make discount live               | Automatic   | Completed when `liveDiscountCount > 0`                                      |
| Enable embed block               | Auto or Manual | Auto-detected via theme API when possible; otherwise manually toggleable  |
| Customize appearance (optional)  | Manual      | Merchant clicks the checkbox to mark as done                                |

Each task is rendered by the `TaskItem` component, which displays a circular checkbox icon (green check when complete, gray circle when pending), a title, description, and an optional action button.

**Auto-refresh logic:** When the dashboard loads with zero discounts and zero live discounts (and install status is not "failed"), it schedules automatic revalidation attempts at `[250ms, 1000ms]` intervals to catch data that may be still processing from the initial import.

#### Tier Usage Card

Displays the current plan name, a usage bar showing `currentLiveDiscounts / liveDiscountLimit`, and a percentage label. When the tier is unlimited, it simply shows the count. The card includes a "View Plans & Upgrade" button linking to `/app/pricing`.

If a pending downgrade is detected (`pendingTier` differs from `tier` and is a lower tier), an info banner shows:
> Downgrade to {pendingTierName} will take effect after this billing cycle ({date}).

The plan status badge shows "Active" (green) or "Cancelled" (red) based on whether there is a pending tier change.

#### Help & Resources Card

Provides two plain buttons:
- **Knowledge Base** -- opens the HelpScout Beacon to the "answers" view, or falls back to the docs URL.
- **Contact Support** -- opens the Beacon to the "ask" view, or falls back to the support email.

Displays version number ("Version 2.1.0") and attribution.

#### Developer Tools Card

Only rendered when `SHOW_DASHBOARD_DEV_TOOLS=true`. Provides a "Refresh Dev Tunnel" button that submits a POST to `/app/refresh-metafields` to update webhook URLs and storefront API metafields for the current dev tunnel.

#### Install Failed Banner

When `installStatus === "failed"`, a critical banner is shown with a "Retry import" button that POSTs to `/app/rebuild`.

#### Embed Block Warning Banner

When there are live discounts but the embed block is confirmed disabled (`embedBlockChecked && !embedBlockEnabled`), a warning banner appears:
> You have N live discount(s), but the app embed is disabled in your theme. Customers won't see discount badges on your storefront until you enable it.

### Actions (Toggle Tasks, Refresh)

The dashboard action handler processes manual task completion toggles:

1. Authenticates the request and resolves the shop.
2. Reads `taskTitle` and `completed` from form data.
3. Validates the task title against `MANUAL_TASK_DEFINITIONS` (only "Enable embed block" and "Customize appearance (optional)" are recognized).
4. Calls `updateManualTaskStatus(shop, taskTitle, completed, taskDefinition)` which upserts a record in the `SetupTask` table.
5. Returns the full map of manual task statuses.

---

## Discount Management (app.discounts.jsx)

**File:** `app/routes/app.discounts.jsx`

This page lists all of the shop's discounts from the `LiveDiscount` table and allows merchants to toggle their visibility.

### Discount List with Status

#### Loader

1. Authenticates and resolves the shop domain.
2. Fetches tier info for the shop to display usage limits.
3. Runs a backfill check: if `Discount` count exceeds `LiveDiscount` count, calls `ensureLiveDiscountsForShop()` to recover missing records.
4. Queries `LiveDiscount` records where the discount has not expired (no `endsAt` or `endsAt > now`).
5. Sorts by status priority: `LIVE` > `HIDDEN` > `SCHEDULED` > `NOT_SUPPORTED` > `UPGRADE_REQUIRED`, with secondary sort by `createdAt` descending within the same status.
6. Enriches each discount with its title from the `Discount` table.

#### UI Components

- **Header cards:** An instruction card ("Manage Your Discounts") alongside a plan usage card showing live discount count vs. limit with a progress bar.
- **Tab filters:** Four tabs -- All, Visible (LIVE), Hidden (HIDDEN + SCHEDULED), Unsupported (NOT_SUPPORTED + UPGRADE_REQUIRED).
- **IndexTable:** Polaris table with selectable rows. Columns: Description (title + summary), Scheduled badge, Status badge.
- **Status badges:**

| Status            | Badge Tone | Label            |
|-------------------|-----------|------------------|
| LIVE              | success   | Live             |
| HIDDEN            | attention | Hidden           |
| SCHEDULED         | info      | Scheduled        |
| NOT_SUPPORTED     | new       | Not Supported    |
| UPGRADE_REQUIRED  | warning   | Upgrade Required |

- **Empty state:** When no discounts exist, shows Shopify's standard empty state illustration.
- **Tier limit warning:** When the shop has reached its live discount limit, a warning box is displayed.
- **Resync button:** Triggers a full reprocess of all discounts via the `resync` action.

### Toggle LIVE/HIDDEN

#### Actions

The action handler supports three operations:

1. **`activate`** -- Sets selected discount(s) to `LIVE` status.
   - Backend validates tier limits before allowing bulk activation. If activating N hidden discounts would exceed the plan limit, returns a 400 error with `tierLimit: true`.
   - After activation, checks if any activated discounts are scheduled (start date in the future) and sets `scheduledActivated` flag.

2. **`deactivate`** -- Sets selected discount(s) to `HIDDEN` status. No tier limit checks needed.

3. **`resync`** -- Calls `reprocessAllDiscountsForShop(admin, shop, db)` followed by `ensureLiveDiscountsForShop(shop, db)`. Returns a summary of backfilled records.

**Bulk actions in the UI:**
- "Set as live" button appears when hidden discounts are selected. Disabled if tier limits would be exceeded or if no selected discounts can be activated.
- "Set as hidden" button appears when live discounts are selected.
- NOT_SUPPORTED and UPGRADE_REQUIRED discounts cannot be selected at all (`isSelectableDiscount` filter).

---

## Settings (app.settings.jsx)

**File:** `app/routes/app.settings.jsx`

The settings page lets merchants customize discount messaging text and configure advanced theme selectors. All settings are stored as Shopify metafields under the `discount_app` namespace.

### All Settings Keys and Defaults

#### Customize Settings (Text & Boolean)

| Key                        | Type                    | Default                                                                                                                                           |
|---------------------------|-------------------------|---------------------------------------------------------------------------------------------------------------------------------------------------|
| `automatic_badge_text`     | single_line_text_field  | `"Sale {amount} OFF"`                                                                                                                             |
| `coupon_badge_text`        | single_line_text_field  | `"Save {amount} with coupon"`                                                                                                                     |
| `pp_automatic_badge_text`  | single_line_text_field  | `"Sale {amount} OFF"`                                                                                                                             |
| `pp_coupon_text`           | single_line_text_field  | `"Coupon:"`                                                                                                                                       |
| `pp_coupon_apply_label`    | single_line_text_field  | `"Apply {amount} discount"`                                                                                                                       |
| `pp_coupon_applied_label`  | single_line_text_field  | `"{amount} off coupon applied"`                                                                                                                   |
| `auto_apply_coupons`       | boolean                 | `false` (locked to `false` on the FREE tier)                                                                                                      |
| `discount_terms_template`  | multi_line_text_field   | `"This discount may not combine with other promotions...\nValid on selected products only\nWe reserve the right to modify or cancel this offer..."` |

All text fields support the `{amount}` placeholder which is replaced with the actual discount value at render time on the storefront.

The `auto_apply_coupons` setting is tier-gated: it is forced to `false` for shops on the FREE tier, both in the loader (read) and action (write). The checkbox is disabled in the UI with a prompt to upgrade.

#### Advanced Settings (Selectors)

| Key                           | Type                    | Default  | Purpose                              |
|-------------------------------|-------------------------|----------|--------------------------------------|
| `use_auto_detect_selectors`   | boolean                 | `true`   | Master toggle for auto-detection     |
| `use_card_price_selector`     | boolean                 | `false`  | Use custom card price selector       |
| `user_card_price_selector`    | single_line_text_field  | `""`     | Custom CSS selector value            |
| `use_card_container_selector` | boolean                 | `false`  | Use custom card container selector   |
| `user_card_container_selector`| single_line_text_field  | `""`     | Custom CSS selector value            |
| `use_form_container_selector` | boolean                 | `false`  | Use custom form container selector   |
| `user_form_container_selector`| single_line_text_field  | `""`     | Custom CSS selector value            |
| `use_form_price_selector`     | boolean                 | `false`  | Use custom form price selector       |
| `user_form_price_selector`    | single_line_text_field  | `""`     | Custom CSS selector value            |
| `use_variant_input_selector`  | boolean                 | `false`  | Use custom variant input selector    |
| `user_variant_input_selector` | single_line_text_field  | `""`     | Custom CSS selector value            |

#### System Settings (written by other routes, not the settings page)

| Key                 | Type                    | Written By                           |
|--------------------|-------------------------|--------------------------------------|
| `app_url`           | single_line_text_field  | Install flow, refresh-metafields     |
| `log_level`         | single_line_text_field  | Refresh-metafields                   |
| `storefront_token`  | single_line_text_field  | Install flow, refresh-metafields     |

### Metafield Storage (namespace: discount_app)

All settings are persisted as Shopify shop metafields using the `metafieldsSet` GraphQL mutation. The namespace is `discount_app` for all keys.

**Loader flow:**
1. Builds a dynamic GraphQL query that fetches all known setting keys as aliased metafield reads in a single query.
2. Parses each value using its type: strings as-is, booleans from `"true"`/`"false"` strings, integers via `parseInt`.
3. Falls back to the `CUSTOMIZE_DEFAULTS` or `ADVANCED_DEFAULTS` maps when a metafield has no value.
4. Also loads the shop's tier info to determine whether `auto_apply_coupons` should be locked.

**Action flow:**
1. Parses a JSON payload from the form's hidden `settings` input containing both `customize` and `advanced` sections.
2. Fetches the shop ID via `fetchShopOwnerId()` (queries `shop { id }`).
3. Calls `saveCustomizeSettings()` and `saveAdvancedSettings()` in sequence, each building an array of `MetafieldsSetInput` objects and sending a single `metafieldsSet` mutation.
4. Advanced string settings skip saving if the value is empty/whitespace (prevents saving blank selectors).
5. Returns combined success/error state.

### Per-Selector Toggle Pattern

Each advanced selector follows a two-part pattern:

1. **`use_{name}_selector`** (boolean) -- whether to use a custom selector or auto-detect.
2. **`user_{name}_selector`** (string) -- the custom CSS selector value, only shown when `use_*` is `true`.

The UI renders each pair as a `<Select>` dropdown (Auto-detect / Custom) followed by a `<TextField>` that only appears in custom mode. When the master toggle `use_auto_detect_selectors` is enabled, all individual selector controls are disabled.

**UI sections:**
- **Product Cards:** `automatic_badge_text`, `coupon_badge_text` (card-level badge text)
- **Product Forms:** `pp_automatic_badge_text`, `pp_coupon_text`, `pp_coupon_apply_label`, `pp_coupon_applied_label` (product page badge text), plus the `auto_apply_coupons` checkbox and `discount_terms_template` multiline field.
- **Advanced Theme Selectors:** The selector toggle grid, organized into Product Cards and Product Forms sections.

The page uses a single "Save" button in the page header that submits the combined form. The button is disabled until at least one setting has changed (dirty check via JSON comparison).

---

## Pricing (app.pricing.jsx)

**File:** `app/routes/app.pricing.jsx`

The pricing page displays available plans, the merchant's current subscription details, and allows plan changes via Shopify Managed Pricing.

### Plan Cards, Managed Pricing

#### Loader

1. Authenticates and resolves the shop domain.
2. Fetches `activeSubscriptions` from the Shopify GraphQL API, including:
   - Subscription metadata (ID, name, status, trial days, period end, test flag)
   - Line items with both `AppRecurringPricing` and `AppUsagePricing` details
   - Discount information (percentage or amount, duration limits)
3. Fetches the shop's IANA timezone and abbreviation for date display.
4. Syncs billing metadata (`billingCurrentPeriodEnd`, `pendingTierEffectiveAt`) to the shop record.
5. Loads the shop's tier info from the database.
6. Builds the `planSelectionUrl` using `buildPlanSelectionUrl(shop)` -- this is a Shopify-provided URL that opens the Managed Pricing plan selection flow.

#### UI Components

**Current Plan Section:**
- Displays the plan name with an Active/Cancelled badge.
- Shows price, billing interval (Every 30 days / Annually / Every 90 days), and billing cycle dates.
- When a subscription exists with trial days, calculates and shows days remaining in trial.
- Success/error banners for returning from billing flows (detected via `?billing=success` or `?billing=error` URL params).
- Pending plan change banner when a downgrade is scheduled.

**Plan Cards Grid:**
- Renders all available tiers from `getAvailableTiers()` in a responsive grid.
- The ADVANCED tier card has an inverted background color and a "Most Popular" badge.
- Each card shows: plan name, price/month, "Billed through Shopify" note, feature list, and a Choose/Manage plan button.
- The "Choose plan" button opens the Shopify Managed Pricing flow (`window.top.location.href = planSelectionUrl`).

**Downgrade Modal:**
- When a merchant clicks a plan that would be a downgrade (target tier index < current tier index), a modal opens explaining:
  - Downgrades take effect at the next billing cycle.
  - If live discounts exceed the new plan limit, all discounts will be set to hidden.
  - Link to the downgrade guide documentation.
- The modal has an "Acknowledge" button that simply closes it; the actual downgrade goes through Shopify Managed Pricing.

**Help Section:**
- "Contact Sales" link at the bottom of the page.

---

## Database Rebuild (app.rebuild.jsx)

**File:** `app/routes/app.rebuild.jsx`

An action-only route (no UI component) used to re-import discounts when the initial install fails.

### Action

1. Authenticates and resolves the shop domain.
2. Checks the shop's `installStatus`:
   - If `"done"`, returns immediately with `{ success: true, status: "done" }` -- no rebuild needed.
   - Otherwise, calls `shopifyShopReInstall(shop, admin)` from `shopify.server.js` which re-runs the full discount import pipeline.
3. Returns `{ success: true, status: "rebuilt" }` on completion.

This route is invoked from two places:
- The "Retry import" button on the dashboard's install-failed banner.
- Could be called programmatically from any admin context.

---

## Refresh Metafields (app.refresh-metafields.jsx)

**File:** `app/routes/app.refresh-metafields.jsx`

An action-only route used during development to update webhook registrations and metafield URLs when the dev tunnel changes.

### Action

1. Authenticates and resolves the shop domain.
2. Reads `SHOPIFY_APP_URL` from environment variables.
3. Calls `initProcessMetafields(shop, admin, db)` to update the storefront API URL and token metafields.
4. Registers webhooks manually via GraphQL:
   - Queries all existing webhook subscriptions.
   - Deletes any webhook pointing to a different base URL than the current `SHOPIFY_APP_URL`.
   - Creates new webhooks for all required topics that do not already exist with the correct URL.

**Required webhook topics:**

| Topic                      | URI                                      |
|---------------------------|------------------------------------------|
| APP_UNINSTALLED            | /webhooks/app/uninstalled                |
| APP_SCOPES_UPDATE          | /webhooks/app/scopes_update              |
| APP_SUBSCRIPTIONS_UPDATE   | /webhooks/app/subscriptions_update       |
| DISCOUNTS_CREATE           | /webhooks/app/discounts_create           |
| DISCOUNTS_UPDATE           | /webhooks/app/discounts_update           |
| DISCOUNTS_DELETE           | /webhooks/app/discounts_delete           |
| COLLECTIONS_UPDATE         | /webhooks/app/collections_update         |
| COLLECTIONS_DELETE         | /webhooks/app/collections_delete         |
| PRODUCTS_UPDATE            | /webhooks/app/products_update            |
| PRODUCTS_DELETE            | /webhooks/app/products_delete            |

5. Queries webhooks again after registration to verify and returns a summary:
   - Number created, skipped (already existed), and failed.
   - Total webhook count and discount-related webhooks for confirmation.

This route is invoked from the Developer Tools card on the dashboard when `SHOW_DASHBOARD_DEV_TOOLS=true`.
