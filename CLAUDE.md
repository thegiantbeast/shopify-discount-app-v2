# CLAUDE.md

## What This App Is

Discount Display Pro — a Shopify app that fetches discounts from the Admin API, resolves which products/variants they apply to, and displays discount badges + coupon UI on the storefront via a theme app extension.

Full specification: `docs/spec/` (14 files). Read `13-known-issues-improvements.md` before writing any code — it documents every mistake from v1.

## Tech Stack

- **Framework:** Remix v2 with Vite
- **UI:** React 18 + Shopify Polaris (latest)
- **Database:** Prisma + SQLite (properly tuned — see Database section)
- **Testing:** Vitest (unit/integration) + Playwright (E2E)
- **Theme extension JS:** Bundled with Rollup/esbuild, minified with source maps
- **Shopify API:** Latest stable version

## Commands

```bash
npm ci                    # Install (always ci, never install)
npm run dev               # Dev server with Shopify CLI
npm run build             # Production build
npm run test              # Vitest
npm run test:e2e          # Playwright
npm run lint              # ESLint
npm run setup             # prisma generate + migrate deploy
```

## Database — CRITICAL

SQLite with these 8 PRAGMAs applied on EVERY client creation in `app/db.server.js`:

```javascript
"PRAGMA journal_mode = WAL"
"PRAGMA busy_timeout = 5000"
"PRAGMA synchronous = NORMAL"
"PRAGMA cache_size = -64000"
"PRAGMA foreign_keys = ON"
"PRAGMA mmap_size = 134217728"
"PRAGMA journal_size_limit = 67108864"
"PRAGMA temp_store = MEMORY"
```

- `prisma/schema.prisma` uses `url = env("DATABASE_URL")`
- `.env` has `DATABASE_URL="file:dev.sqlite?connection_limit=1"`
- Without these PRAGMAs, concurrent webhooks cause silent data loss

## Database Backups — CRITICAL

All merchant data is in one SQLite file. Two backup layers required from day one:

1. **Litestream** — continuous WAL replication to Cloudflare R2 (~1s RPO). Wraps the app process. Auto-restores if database is missing on container start.
2. **Scheduled VACUUM INTO** — compacted snapshots every 6 hours. Safe during active writes. Run via deployment platform scheduled jobs, not cron in container.

Docker entrypoint pattern: `litestream restore → litestream replicate -exec "npm run docker-start"`

**Never** use `cp` to back up SQLite — produces corrupt backups during active writes. Use `VACUUM INTO` or Litestream.

## Directory Structure

```
app/routes/           — Remix routes (pages + API endpoints)
app/utils/            — Server-side business logic
app/tests/            — Test suites
extensions/           — Theme app extension (storefront)
  discounts-display-pro/
    src/              — JS source modules (pre-bundle)
    assets/           — Bundled output (generated, do not edit)
    blocks/           — Liquid templates
    snippets/         — CSS + config snippets
prisma/               — Schema + migrations
docs/                 — Specification and documentation
```

## Coding Conventions

- **Server logging:** Use `pino` for server-side logging (the standard Node.js structured logger), never `console.log`
- **Client logging:** Use `window.DDPLogger` for client-side logging in the theme extension (from `logger.js`)
- **Error handling:** Webhook handlers MUST return proper HTTP error codes on failure (never 200). Shopify retries on 4xx/5xx — returning 200 on error causes silent data loss.
- **Imports:** Use `.server.js` suffix for server-only modules (Remix convention)
- **CSS classes:** Theme extension uses `.pp-` prefix (e.g., `.pp-coupon-block`, `.pp-discount-badge`)
- **Metafield namespace:** `discount_app` for all app metafields

## Data Model Rules

- Use **junction tables** for many-to-many relationships (DiscountTarget, DiscountProduct, DiscountVariant, DiscountCode) — never JSON string arrays
- Use **foreign keys** with cascading deletes (Shop → all child tables)
- Use Shop's database ID as FK (not the domain string)
- All JSON fields that need querying must be in proper relational tables

## API Rules

- Storefront API endpoints (`/api/discounts`, `/api/best-discounts`) require per-shop token auth
- Token verification uses `crypto.timingSafeEqual` (never `===`)
- Token cache must have TTL-based eviction (never unbounded Map)
- All public endpoints must have per-shop rate limiting
- CORS: allow any HTTPS origin (required for cross-shop support)

## GraphQL Rules

- Always use cursor-based pagination (follow ALL pages, not just first 250)
- Read `throttleStatus.currentlyAvailable` from every response
- Retry throttled requests with exponential backoff
- Log rate limit events

## Theme Extension Rules

- JS source lives in `extensions/.../src/` as ES modules
- Bundle with Rollup/esbuild into a single minified file in `assets/`
- Price extraction checks `element.style.display` (inline styles), NOT `getComputedStyle()`
- Hidden element detection stops at container boundary
- Coupon apply uses 3-fallback: fetch → iframe → navigation
- Support 7 themes: Dawn, Symmetry, Vision, Wonder, Spotlight, Horizon, Savor

## Things NOT to Build

- No Redis (SQLite is sufficient at this scale)
- No PostgreSQL (SQLite with proper tuning is correct)
- No microservices (single Remix app)
- No real-time WebSocket updates (webhook-driven is fine)
- No over-engineering — build exactly what the spec describes
