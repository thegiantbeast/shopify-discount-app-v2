I'm rebuilding a Shopify app called "Discount Display Pro" from scratch. Phases 1-3 (scaffold, database, backend, APIs, admin UI, storefront extension) are already complete.

The full specification is in `docs/spec/` (14 files). The CLAUDE.md in the project root has the coding conventions — read it first.

You are **Agent 6: Testing & Integration** (Phase 4 — the final phase).

---

## Step 1: Read the spec

Read these files in order:

1. `docs/spec/13-known-issues-improvements.md` — **READ THIS FIRST.** Pay special attention to the "Testing Gaps" section — it describes what v1 is missing.
2. Browse all other spec files as needed for understanding expected behavior.

## Step 2: Understand the existing code

Before writing tests, read through the code that Agents 1-5 produced:
- `app/db.server.js` — database setup with PRAGMAs
- `app/utils/discount-resolver/` — discount resolution pipeline
- `app/routes/webhooks.app.*.jsx` — webhook handlers
- `app/routes/api.*.jsx` — API endpoints
- `app/utils/storefront-auth.server.js` — token auth
- `app/utils/discount-math.server.js` — discount calculations
- `app/utils/tier-manager.server.js` — tier management

## Step 3: Reference v1 test structure

These files are in the v1 repo at `/Users/ricardo/Code/Momentus/shopify-discount-app/`. Read them for test patterns and structure only:

- `/Users/ricardo/Code/Momentus/shopify-discount-app/app/tests/` — existing test files
- `/Users/ricardo/Code/Momentus/shopify-discount-app/vitest.config.ts` — test configuration
- `/Users/ricardo/Code/Momentus/shopify-discount-app/playwright.config.ts` — E2E configuration

## Step 4: Build

### 4a. Unit tests (Vitest) — test pure logic in isolation
- Discount math calculations (percentage, fixed, BOGO, best discount selection)
- Tier manager (feature gating, tier transitions, limit enforcement)
- Storefront auth (token generation, verification, cache eviction)
- Status utils (active/scheduled/expired determination)
- Price extraction logic (if testable outside DOM)

### 4b. Integration tests (Vitest with mocked Shopify API) — THIS IS THE #1 PRIORITY

**v1 has zero integration tests. This is the biggest testing gap.**

- **Webhook handlers** — mock the Shopify payload, verify database state changes after processing
- **Discount resolver pipeline** — mock GraphQL responses, verify resolved targets are stored correctly in junction tables
- **API routes** — mock database, verify response formats, auth enforcement, rate limiting, CORS headers
- **SQLite PRAGMAs** — query PRAGMA values and verify they're correctly set

### 4c. E2E tests (Playwright)
- Dashboard loads and displays stats
- Discount list shows synced discounts
- Settings can be saved and loaded
- Pricing page shows correct tier
- Storefront discount badge appears (requires test store)

### 4d. Test infrastructure
- Shared test fixtures (mock shop, mock discount, mock GraphQL responses)
- Database test helpers (seed, reset, assert state)
- `vitest.config.ts` with proper coverage thresholds
- `playwright.config.ts` with auth state handling
- `PLAYWRIGHT_SKIP_AUTH_SETUP=1` support for running without Shopify credentials

---

## Critical requirements

- Integration tests for webhook handlers are the **#1 priority** — these are the most likely source of bugs
- All tests must be runnable in CI without Shopify credentials (mock everything)
- Test that SQLite PRAGMAs are actually set (query `PRAGMA journal_mode`, `PRAGMA busy_timeout`, etc. and assert values)
- Test that webhook handlers return proper error codes on failure (not 200)
- Test that token comparison uses timing-safe equality
- Do NOT over-engineer — write focused tests for the most critical paths first
