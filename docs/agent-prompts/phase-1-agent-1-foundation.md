I'm rebuilding a Shopify app called "Discount Display Pro" from scratch. The app fetches discounts from Shopify's Admin API, resolves which products/variants they apply to, and displays discount badges + coupon UI on the storefront via a theme app extension.

The full specification is in `docs/spec/` (14 files). The CLAUDE.md in the project root has the coding conventions — read it first.

You are **Agent 1: Infrastructure & Data Model** (Phase 1 — everything else depends on your output).

---

## Step 1: Read the spec

Read these files in order:

1. `docs/spec/13-known-issues-improvements.md` — **READ THIS FIRST.** It documents every mistake from v1 that you must NOT repeat.
2. `docs/spec/02-architecture-overview.md` — system architecture, data flow, tech decisions
3. `docs/spec/03-data-model.md` — complete schema with field purposes, JSON formats, indexes
4. `docs/spec/01-business-requirements.md` — tier feature matrix, discount types, exclusion reasons
5. `docs/spec/08-tier-billing-system.md` — FREE/BASIC/ADVANCED tiers, Managed Pricing
6. `docs/spec/12-configuration-deployment.md` — env vars, Docker, build config, backup strategy

## Step 2: Reference the v1 source (exact values only)

These files are in the v1 repo at `/Users/ricardo/Code/Momentus/shopify-discount-app/`. Read them for exact field names, webhook subscriptions, and API scopes — but do NOT copy code patterns or architecture:

- `/Users/ricardo/Code/Momentus/shopify-discount-app/prisma/schema.prisma` — field names and types (rebuild with junction tables, FKs, cascading deletes)
- `/Users/ricardo/Code/Momentus/shopify-discount-app/shopify.app.toml` — webhook subscriptions, API scopes, app config
- `/Users/ricardo/Code/Momentus/shopify-discount-app/app/shopify.server.js` — Shopify auth setup pattern

## Step 3: Build

### 3a. Project scaffold
- Remix v2 + Vite project structure
- `package.json` with all dependencies
- `shopify.app.toml` with all webhook subscriptions and scopes (copy from v1 reference)
- `.env.example` with all required env vars documented

### 3b. Database (`app/db.server.js`)
PrismaClient with all 8 SQLite PRAGMAs applied on creation:
```
journal_mode = WAL, busy_timeout = 5000, synchronous = NORMAL,
cache_size = -64000, foreign_keys = ON, mmap_size = 134217728,
journal_size_limit = 67108864, temp_store = MEMORY
```
- `prisma/schema.prisma` with `url = env("DATABASE_URL")`
- `.env` with `DATABASE_URL="file:dev.sqlite?connection_limit=1"`

### 3c. Prisma schema — REBUILD with proper relations

The v1 schema stores targeting data as JSON strings. Replace with junction tables:

```
v1 (BROKEN):
  Discount.targetIds       = JSON string of collection/product GIDs
  Discount.resolvedProductIds = JSON string of product GIDs
  Discount.resolvedVariantIds = JSON string of variant GIDs
  Discount.codes           = JSON string of coupon codes

v2 (CORRECT):
  DiscountTarget   (discountId, targetType, targetGid)  — what the discount targets
  DiscountProduct  (discountId, productGid)              — resolved products
  DiscountVariant  (discountId, variantGid)              — resolved variants
  DiscountCode     (discountId, code)                    — coupon codes
```

Keep all existing models (Session, Shop, Discount, Collection, Product, LiveDiscount, SetupTask, PlanSubscriptionLog) but add:
- Proper foreign keys (Shop.id as FK to all child tables, not domain strings)
- Cascading deletes (delete shop → deletes all child records)
- The 4 junction tables above
- Proper indexes on all query patterns documented in `03-data-model.md`

### 3d. Shared utilities
- `app/utils/tier-manager.js` — client-side tier checks (isFeatureEnabled)
- `app/utils/tier-manager.server.js` — server-side tier management with Managed Pricing
- `app/shopify.server.js` — Shopify auth, session storage, webhook registration
- `app/utils/logger.server.js` — pino logger (structured logging, not console.log)

### 3e. Shopify app setup
- OAuth installation flow
- Session storage via Prisma
- Webhook registration for all 13 webhooks listed in `docs/spec/07-webhook-handlers.md`

### 3f. Backup infrastructure
- `litestream.yml` — continuous WAL replication config for Cloudflare R2
- `scripts/docker-entrypoint.sh` — restore-then-replicate pattern:
  ```
  litestream restore -if-db-not-exists -if-replica-exists ...
  litestream replicate -exec "npm run docker-start" ...
  ```
- Dockerfile with Litestream binary + sqlite3 CLI
- `scripts/backup-sqlite.sh` — scheduled VACUUM INTO backup (runs every 6 hours via deployment platform)
- `.env.example` must include `LITESTREAM_ACCESS_KEY_ID` and `LITESTREAM_SECRET_ACCESS_KEY`

### 3g. Docker
- `Dockerfile` with: node:24-alpine, Litestream, sqlite3, build steps, deploy step, entrypoint
- Domain replacement via `APP_BUILD_ENV` build arg (testing/production)

---

## Critical requirements

- The database MUST have PRAGMAs set before any queries run
- Foreign keys MUST be enforced (`PRAGMA foreign_keys = ON`)
- The schema MUST use junction tables, not JSON strings
- DATABASE_URL MUST be configurable via environment variable
- Litestream MUST be configured for continuous replication
- Docker entrypoint MUST auto-restore from backup if database is missing
- Never use `cp` to back up SQLite — use VACUUM INTO or Litestream
- Use `pino` for server-side logging, never `console.log`
- Do NOT over-engineer — build exactly what the spec describes
