I'm rebuilding a Shopify app called "Discount Display Pro" from scratch. Phase 1 (project scaffold, database, Prisma schema with junction tables) is already complete.

The full specification is in `docs/spec/` (14 files). The CLAUDE.md in the project root has the coding conventions — read it first.

You are **Agent 2: Discount Resolution Pipeline + Webhook Handlers** (Phase 2 — runs in parallel with Agent 3).

---

## Step 1: Read the spec

Read these files in order:

1. `docs/spec/13-known-issues-improvements.md` — **READ THIS FIRST.** It documents every mistake from v1 that you must NOT repeat.
2. `docs/spec/04-discount-resolution-pipeline.md` — the complete pipeline: fetch, resolve targets, store, LiveDiscount update
3. `docs/spec/07-webhook-handlers.md` — all 13 webhooks with triggers and cascading effects

## Step 2: Understand the existing schema

Read the Prisma schema that Agent 1 created (in `prisma/schema.prisma`) to understand the junction tables you'll be writing to: `DiscountTarget`, `DiscountProduct`, `DiscountVariant`, `DiscountCode`.

## Step 3: Reference the v1 source (exact values only)

These files are in the v1 repo at `/Users/ricardo/Code/Momentus/shopify-discount-app/`. Read them for exact GraphQL field names, exclusion reason strings, and algorithm understanding — but do NOT copy code patterns:

- `/Users/ricardo/Code/Momentus/shopify-discount-app/app/utils/discount-resolver/graphql-queries.server.js` — exact GraphQL query shapes and field names
- `/Users/ricardo/Code/Momentus/shopify-discount-app/app/utils/discount-resolver/live-discount-updater.server.js` — the EXCLUSION_REASONS list (exact reason strings)
- `/Users/ricardo/Code/Momentus/shopify-discount-app/app/utils/discount-resolver/resolve-targets.server.js` — target resolution algorithm

## Step 4: Build

### 4a. Discount resolver pipeline (`app/utils/discount-resolver/`)
- `fetchers.server.js` — GraphQL queries to fetch discounts with **cursor-based pagination** (v1 stops at 250 items — fix this)
- `graphql-queries.server.js` — query definitions
- `resolve-targets.server.js` — resolve collections → products → variants with **full pagination** (not just first page)
- `store-data.server.js` — store resolved data using junction tables (DiscountTarget, DiscountProduct, DiscountVariant, DiscountCode)
- `live-discount-updater.server.js` — update LiveDiscount records with proper exclusion checking
- `backfill.server.js` — backfill missing LiveDiscount records
- `reprocess.server.js` — reprocess discounts when collections/products change (**only affected discounts**, not all)
- `status-utils.server.js` — discount status helpers (active, scheduled, expired)
- `cleanup.server.js` — cleanup orphaned records (leveraging cascading deletes)

### 4b. GraphQL rate limit handling
- Read `throttleStatus.currentlyAvailable` from every response
- Back off when approaching limits
- Retry throttled requests with exponential backoff
- Log rate limit events via `pino`

### 4c. Webhook handlers (`app/routes/webhooks.app.*.jsx`)

All 13 webhooks as documented in `docs/spec/07-webhook-handlers.md`:
- `discounts_create`, `discounts_update`, `discounts_delete`
- `collections_update`, `collections_delete`
- `products_update`, `products_delete`
- `subscriptions_update`
- `app_uninstalled`
- Plus any others documented in the spec

**CRITICAL — Webhook handlers MUST:**
- Return proper HTTP error codes on failure (NOT 200). Shopify retries on 4xx/5xx — returning 200 on error causes **silent data loss**.
- Implement idempotency (track webhook IDs, skip duplicates)
- Log errors with context (shop, webhook topic, payload summary) via `pino`

### 4d. Incremental reprocessing
- When a collection changes, only reprocess discounts that target that collection
- When a product changes, only reprocess discounts that include that product
- Use the junction tables (DiscountTarget, DiscountProduct) for efficient lookups instead of scanning all discounts

---

## Critical requirements

- Pagination must be cursor-based and follow ALL pages (not stop at 250)
- Webhook handlers must NOT return 200 on error — this is the #1 cause of silent data loss in v1
- Reprocessing must be incremental (only affected discounts, not full rescan)
- GraphQL calls must respect rate limits with exponential backoff
- Use `pino` for server-side logging, never `console.log`
- Store resolved data in junction tables, not JSON strings
- Do NOT over-engineer — build exactly what the spec describes
