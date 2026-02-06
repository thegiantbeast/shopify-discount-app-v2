# Discount Display Pro -- Build-from-Scratch Guide

## What This App Does (3 sentences)

Discount Display Pro is a Shopify embedded app that automatically syncs a merchant's discounts from the Shopify Admin GraphQL API, resolves which products and variants each discount targets, and stores those mappings in a local SQLite database. It serves discount data to the storefront through authenticated API endpoints and renders discount badges, updated prices, and coupon apply/remove checkboxes directly on product cards and product pages via a vanilla JavaScript theme app extension. Three pricing tiers (Free, Basic, Advanced) gate access to features like the number of simultaneously active discounts, auto-apply coupons, fixed-price discounts, subscription product compatibility, and variant-specific targeting.

## How to Read This Documentation

This documentation set is designed to give a developer everything needed to rebuild Discount Display Pro from scratch. Start with the business requirements to understand *what* the app does from the merchant's perspective before diving into *how* it works technically. Each numbered document builds on the ones before it, so reading in order is recommended for a first pass. For returning readers or those looking up a specific subsystem, each document is self-contained enough to be read independently.

Conventions used throughout:
- **Bold terms** on first use indicate entries in the Glossary below.
- File paths reference the original repository structure for traceability.
- "Merchant" refers to the Shopify store owner who installs the app; "customer" or "shopper" refers to the person browsing the storefront.
- Tier names are always written in ALL CAPS: FREE, BASIC, ADVANCED.

## File Index

| # | File | Description |
|---|------|-------------|
| 01 | `01-business-requirements.md` | What the app does from the merchant's perspective: features, tiers, discount types, storefront behavior, settings, and exclusion rules -- no code |
| 02 | `02-architecture-overview.md` | High-level system architecture: tech stack choices, data flow diagrams, directory structure, and how subsystems connect |
| 03 | `03-data-model.md` | Prisma schema walkthrough: every model, field, index, and the reasoning behind the two-table discount storage pattern |
| 04 | `04-shopify-integration.md` | OAuth setup, API scopes, webhook registrations, metafield usage, managed pricing configuration, and App Bridge setup |
| 05 | `05-discount-resolver.md` | The discount sync pipeline: fetching from GraphQL, resolving product/collection/variant targets, storing mappings, and the LiveDiscount updater |
| 06 | `06-tier-system.md` | Pricing tiers, feature gating logic, live discount limits, Shopify managed billing integration, pending tier transitions, and trial handling |
| 07 | `07-storefront-api.md` | The `api.discounts` and `api.best-discounts` endpoints: request/response shapes, per-shop token authentication, CORS, and currency handling |
| 08 | `08-theme-extension.md` | The vanilla JS theme app extension: script loading, DOM injection, price extraction, variant detection, coupon apply flow, and theme selector system |
| 09 | `09-admin-ui.md` | Embedded admin pages: dashboard, discount list, settings, pricing page -- Remix routes, loaders, actions, and Polaris components |
| 10 | `10-webhook-handlers.md` | Every webhook the app subscribes to, what it does on receipt, and how it triggers reprocessing of affected discounts |
| 11 | `11-theme-selector-system.md` | How the app detects and overrides CSS selectors per theme, the fallback chain, and merchant custom selector overrides |
| 12 | `12-testing-strategy.md` | Vitest unit tests, Playwright E2E tests, auth state management, and what each test spec covers |
| 13 | `13-deployment-and-ops.md` | Docker deployment, Shopify CLI deploy, environment configuration, database migrations, and monitoring considerations |

## Suggested Reading Order

**First-time reader (building from scratch):**
1. `01-business-requirements.md` -- Understand what you are building
2. `02-architecture-overview.md` -- Understand how the pieces fit together
3. `03-data-model.md` -- Design the database first
4. `04-shopify-integration.md` -- Set up OAuth, scopes, and webhooks
5. `05-discount-resolver.md` -- Build the core sync pipeline
6. `06-tier-system.md` -- Implement pricing and feature gating
7. `07-storefront-api.md` -- Expose discount data to the storefront
8. `08-theme-extension.md` -- Build the customer-facing UI
9. `09-admin-ui.md` -- Build the merchant-facing admin pages
10. `10-webhook-handlers.md` -- Wire up real-time sync
11. `11-theme-selector-system.md` -- Handle theme compatibility
12. `12-testing-strategy.md` -- Write tests
13. `13-deployment-and-ops.md` -- Ship it

**Debugging a specific area:**
- Discount not showing on storefront? Start with `08-theme-extension.md`, then `07-storefront-api.md`, then `05-discount-resolver.md`
- Billing or tier issue? Start with `06-tier-system.md`
- Wrong products targeted? Start with `05-discount-resolver.md`, section on target resolution
- Theme compatibility? Start with `11-theme-selector-system.md`

## Quick Reference: Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **Database** | SQLite via Prisma | Simplicity and zero-ops for a single-instance Shopify app; no need for a separate database server. All data is derived from Shopify and can be rebuilt from the API. |
| **Storefront scripts** | Vanilla JavaScript (no framework) | Shopify theme app extensions cannot use React or other frameworks; scripts must be lightweight, standalone, and compatible with any Liquid theme. |
| **Storefront API auth** | Per-shop random tokens (not Shopify App Proxy) | App Proxy routes are slow (~500ms+ overhead) and unreliable for real-time storefront display. Per-shop tokens stored as metafields allow direct, fast API calls from the browser. |
| **Billing** | Shopify Managed Pricing (`unstable_managedPricingSupport: true`) | Lets Shopify handle the subscription UI, plan selection, and payment processing. The app just reads the active subscription to determine the tier. |
| **Theme compatibility** | Theme selector map pattern | Each supported theme has a map of CSS selectors for card containers, price elements, form containers, etc. Falling back to Dawn selectors when unknown. Merchants can override with custom selectors. |
| **Discount storage** | Two-table pattern (Discount + LiveDiscount) | `Discount` stores the raw synced data from Shopify including targeting rules. `LiveDiscount` stores the resolved, display-ready state with status, exclusion reasons, and temporal bounds. This separation keeps the sync pipeline independent from the display logic. |
| **Shopify API version** | `2025-10` | Pinned version for stability; update deliberately when new features are needed. |
| **App framework** | Remix v2.16.1 with `@shopify/shopify-app-remix` | Shopify's recommended stack for embedded apps. Provides OAuth, session management, App Bridge integration, and webhook handling out of the box. |
| **UI framework** | React 18 + Shopify Polaris | Required for embedded Shopify admin pages. Polaris provides Shopify-native UI components. |
| **Testing** | Vitest (unit) + Playwright (E2E) | Vitest for fast unit tests of business logic; Playwright for end-to-end storefront and admin testing with real browser interactions. |

## Glossary of Terms

| Term | Definition |
|------|------------|
| **GID** | Shopify Global ID. A URI-formatted identifier like `gid://shopify/DiscountAutomaticNode/12345`. Used throughout the Shopify GraphQL API to uniquely identify resources. The app stores GIDs as primary keys in the database. |
| **LiveDiscount** | A database record representing the display-ready state of a discount. Contains the resolved status (LIVE, HIDDEN, SCHEDULED, NOT_SUPPORTED, UPGRADE_REQUIRED), exclusion reasons, and temporal bounds. One LiveDiscount per synced discount. |
| **Discount** | A database record storing the raw synced discount data from Shopify, including title, type, value, targeting rules (products, collections, variants), and the discount code (if applicable). The source-of-truth for what Shopify knows about the discount. |
| **Tier gating** | The system that restricts which features a merchant can use based on their pricing plan. For example, variant-specific discounts require the ADVANCED tier. When a discount requires a higher tier, the LiveDiscount is saved with status UPGRADE_REQUIRED and an exclusion reason. |
| **Exclusion reason** | A machine-readable code explaining why a discount cannot be displayed on the storefront. Examples: `NOT_PRODUCT_DISCOUNT` (it is an order-level discount), `CUSTOMER_SEGMENT` (restricted to specific customer groups), `MIN_REQUIREMENT` (requires minimum cart value). Stored on the LiveDiscount record so the merchant can understand why a discount is hidden. |
| **Storefront token** | A random 32-byte hex string generated per shop and stored both in the database (`Shop.storefrontToken`) and as a Shopify metafield (`discount_app.storefront_token`). The theme extension reads it from the metafield and sends it with every API request. The server verifies it using `crypto.timingSafeEqual`. |
| **Presentment currency** | The currency a customer sees when shopping. In multi-currency stores, this may differ from the shop's base currency. The app uses presentment prices (the customer's currency) for discount calculations, not the shop's base currency. |
| **Selling plan** | A Shopify concept for subscription pricing. A product can have one or more selling plans (e.g., "Subscribe and save 10%"). The app must detect when a customer switches between one-time purchase and a selling plan, and recalculate the discount display accordingly. |
| **Theme selector map** | A server-side data structure mapping supported theme names to CSS selectors for key DOM elements (card containers, price elements, form containers, etc.). Used by the storefront scripts to find the right elements to inject discount UI into. |
| **Discount resolver** | The server-side pipeline that fetches discounts from Shopify's GraphQL API, determines which products/variants they target, and stores the results in the database. Runs on install, webhook events, and manual refresh. |
| **Embed block** | The theme app extension block (`e_discounts.liquid`) that merchants enable in the Shopify theme editor. It loads all storefront JavaScript and CSS, reads configuration from metafields, and serves as the entry point for discount display on the storefront. |
| **Auto-apply** | A BASIC+ tier feature where coupon discounts are automatically applied on product pages without the customer needing to check a checkbox. The coupon is silently applied via a background fetch to `/discount/<CODE>`. |
| **App Bridge** | Shopify's JavaScript SDK for embedded apps. Provides communication between the app iframe and the Shopify admin, enabling navigation, toast messages, and modal dialogs. |
| **Managed Pricing** | Shopify's billing system where the app defines pricing plans in `shopify.app.toml` and Shopify handles the subscription UI, payment, and plan changes. The app reads the active subscription to determine the merchant's tier. |
