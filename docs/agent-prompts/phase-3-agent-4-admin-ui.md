I'm rebuilding a Shopify app called "Discount Display Pro" from scratch. Phase 1 (scaffold, database, schema) and Phase 2 (backend pipeline, webhooks, APIs, auth) are already complete.

The full specification is in `docs/spec/` (14 files). The CLAUDE.md in the project root has the coding conventions — read it first.

You are **Agent 4: Admin UI Pages** (Phase 3 — runs in parallel with Agent 5).

---

## Step 1: Read the spec

Read these files in order:

1. `docs/spec/13-known-issues-improvements.md` — **READ THIS FIRST.** It documents every mistake from v1 that you must NOT repeat.
2. `docs/spec/09-admin-ui-pages.md` — all pages with their loaders, actions, and UI components
3. `docs/spec/08-tier-billing-system.md` — pricing page, tier management, Managed Pricing
4. `docs/spec/01-business-requirements.md` — feature matrix, merchant UX flows

## Step 2: Reference source files

No v1 source files needed. Build from the spec using Shopify Polaris components.

## Step 3: Build

### 3a. Dashboard (`app/routes/app._index.jsx`)
- Discount statistics (total, active, scheduled, expired)
- Setup tasks checklist (onboarding flow)
- Tier status display
- Quick actions

### 3b. Discount management (`app/routes/app.discounts.jsx`)
- List of all synced discounts with status indicators
- Search and filter
- Manual sync/refresh action
- Tier limit indicators (e.g., "3 of 3 discounts used")

### 3c. Settings (`app/routes/app.settings.jsx`)
- All settings stored as Shopify metafields under namespace `discount_app`
- Badge appearance (colors, text, position)
- Coupon display settings
- Custom CSS selector overrides
- Advanced settings (debug mode, etc.)

### 3d. Pricing (`app/routes/app.pricing.jsx`)
- Three-tier display (FREE / BASIC $9.99 / ADVANCED $19.99)
- Current plan indicator
- Upgrade/downgrade via Shopify Managed Pricing
- Feature comparison table

### 3e. Utility pages
- `app/routes/app.rebuild.jsx` — rebuild/reprocess all discounts
- `app/routes/app.refresh-metafields.jsx` — refresh dev tunnel metafields and webhooks

### 3f. Layout
- `app/root.jsx` — app root with Polaris AppProvider
- `app/routes/app.jsx` — app layout with navigation sidebar

---

## Critical requirements

- Use Polaris components throughout (no custom UI where Polaris has a component)
- All settings must be persisted as Shopify metafields (namespace: `discount_app`)
- Tier limits must be enforced in the UI (disable features, show upgrade prompts)
- Dashboard loader should NOT reconcile billing on every load — use webhook-only approach
- Use `pino` for server-side logging in loaders/actions, never `console.log`
- Do NOT over-engineer — build exactly what the spec describes
