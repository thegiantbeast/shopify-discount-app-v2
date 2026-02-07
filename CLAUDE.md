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

## Shopify CLI Configuration

Two TOML files configure how Shopify CLI manages the app:

- **`shopify.app.toml`** — App identity and Partner dashboard configuration: client ID, name, application URL, webhook subscriptions, access scopes, and auth redirect URLs. This is what `shopify app deploy` pushes to Shopify.
- **`shopify.web.toml`** — Web process definition: declares roles (`frontend`, `backend`), dev/build commands, and webhooks path. Shopify CLI scans for this file to discover the app's web process. **Without it, `automatically_update_urls_on_dev` has no effect** — the CLI skips URL updates because it finds no frontend/backend config.

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

- **Server logging:** Use `pino` via the wrapper in `logger.server.js`. Signature: `logger.info("message", { data })` (message first, data second). Never `console.log`
- **Client logging:** Use `window["discounts-display-pro"].logger` for client-side logging in the theme extension (from `logger.js`)
- **Error handling:** Webhook handlers MUST return proper HTTP error codes on failure (never 200). Shopify retries on 4xx/5xx — returning 200 on error causes silent data loss.
- **Imports:** Use `.server.js` suffix for server-only modules (Remix convention)
- **CSS classes:** Theme extension uses `.ddp-` prefix (e.g., `.ddp-coupon-block`, `.ddp-discount-badge`)
- **Window globals:** All storefront globals are namespaced under `window["discounts-display-pro"]` (bracket notation, not discoverable via autocomplete). JS source files import the namespace via `import _ns from './namespace.js'` and access properties as `_ns.settings`, `_ns.logger`, etc. Never use bare `window.*` for app-specific data.
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

## Agent Delegation Strategy

Use a three-tier model delegation pattern to optimize cost and speed:

- **Opus** — orchestrator. Reads specs, plans work, breaks tasks into focused sub-tasks, reviews output, course-corrects. Use for architectural decisions, ambiguous requirements, and quality review.
- **Sonnet** — implementation workhorse. Receives detailed, unambiguous instructions from Opus and executes them. Use for file creation, route implementation, utility modules, and any well-defined coding task.
- **Haiku** — lightweight tasks. Use for file searches, simple lookups, quick code reads, and trivial edits where full Sonnet capability isn't needed.

### When to use each model

| Task | Model | Why |
|------|-------|-----|
| Read specs, plan architecture | Opus | Needs full context understanding |
| Create Prisma schema from spec | Sonnet | Well-defined, detailed instructions |
| Implement a Remix route | Sonnet | Clear deliverable with known patterns |
| Search for a file or grep a pattern | Haiku | Simple lookup, no reasoning needed |
| Review Sonnet's output for spec compliance | Opus | Needs judgment and spec knowledge |
| Write theme extension JS (edge cases) | Sonnet + Opus review | Complex but implementable with good instructions |
| Fix a typo or rename | Haiku | Trivial change |

### How it works

When given an agent prompt (from `docs/agent-prompts/`), the orchestrator (Opus) should:
1. Read the relevant spec files itself (Opus)
2. Break the work into focused, independent sub-tasks
3. Spawn Sonnet sub-agents with detailed instructions for each sub-task
4. Review the output for correctness and spec compliance (Opus)
5. Spawn Haiku sub-agents for any simple follow-up (searches, trivial fixes)
6. Spawn Sonnet fix-up agents if review finds issues

Each sub-agent starts with a fresh context — it doesn't see the conversation history. The quality of the prompt given to it is everything. Include: exact file paths, exact field names, exact patterns to follow, and what NOT to do.

## Things NOT to Build

- No Redis (SQLite is sufficient at this scale)
- No PostgreSQL (SQLite with proper tuning is correct)
- No microservices (single Remix app)
- No real-time WebSocket updates (webhook-driven is fine)
- No over-engineering — build exactly what the spec describes

## README.md

`README.md` documents the full setup process (local + Dokploy/Docker), all environment variables, commands, and architecture overview. When making changes that affect setup, environment variables, commands, or deployment, update `README.md` accordingly.
