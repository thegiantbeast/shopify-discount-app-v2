# Configuration and Deployment

This document covers every configuration file, environment variable, build step, and deployment process for Discount Display Pro.

---

## Environment Variables (complete list)

### Application

| Variable                          | Required | Default     | Description                                                        |
|----------------------------------|----------|-------------|--------------------------------------------------------------------|
| `SHOPIFY_API_KEY`                 | Yes      | --          | Shopify app API key (set by Shopify CLI during `dev` or `deploy`)  |
| `SHOPIFY_API_SECRET`              | Yes      | --          | Shopify app API secret (set by Shopify CLI)                        |
| `SHOPIFY_APP_URL`                 | Yes      | --          | Public URL of the running app (e.g., tunnel URL or production URL) |
| `NODE_ENV`                        | No       | `development` | Set to `production` in Docker builds                              |
| `PORT`                            | No       | `3000`      | HTTP port for the Remix server                                     |
| `DATABASE_URL`                    | **Yes**  | `file:dev.sqlite` | Prisma database connection string. **CRITICAL:** Currently hardcoded in `schema.prisma` — must be changed to `env("DATABASE_URL")`. Use `?connection_limit=1` to ensure SQLite PRAGMAs apply consistently. See [13-known-issues-improvements.md](13-known-issues-improvements.md) for the full SQLite tuning requirements. |

### Billing & Pricing

| Variable                          | Required | Default     | Description                                                        |
|----------------------------------|----------|-------------|--------------------------------------------------------------------|
| `SHOPIFY_BILLING_USE_TEST`        | No       | `false`     | Set to `"true"` to use test billing mode                           |
| `SHOPIFY_MANAGED_PRICING_HANDLE`  | No       | --          | Handle for the Shopify Managed Pricing plan (e.g., `"discounts-display"`) |

### Storefront Authentication

| Variable                          | Required | Default     | Description                                                        |
|----------------------------------|----------|-------------|--------------------------------------------------------------------|
| `STOREFRONT_AUTH_ENFORCE`         | No       | `false`     | `"true"` to block unauthorized storefront API requests; `"false"` to log only |

### Logging

| Variable                          | Required | Default     | Description                                                        |
|----------------------------------|----------|-------------|--------------------------------------------------------------------|
| `LOG_LEVEL`                       | No       | `info`      | Logging verbosity: `debug`, `info`, `warn`, `error`                |
| `LOG_CATEGORIES`                  | No       | (all)       | Comma-separated list to filter log output (e.g., `"Forms,Cards,General"`) |

### Development

| Variable                          | Required | Default     | Description                                                        |
|----------------------------------|----------|-------------|--------------------------------------------------------------------|
| `SHOW_DASHBOARD_DEV_TOOLS`        | No       | `false`     | `"true"` to show the Developer Tools card on the dashboard         |
| `APP_BUILD_ENV`                   | No       | `dev`       | Build environment: `dev`, `testing`, `production`                  |
| `FRONTEND_PORT`                   | No       | `8002`      | Port for Vite HMR when using a tunnel                              |
| `HMR_SERVER_PORT`                 | No       | `8002`      | Remix config HMR port (legacy config)                              |

### Build-time Only (Docker)

| Variable                          | Required | Default     | Description                                                        |
|----------------------------------|----------|-------------|--------------------------------------------------------------------|
| `SHOPIFY_CLI_PARTNERS_TOKEN`      | Yes (build) | --       | Partners API token used by `shopify app deploy` during Docker build |

### E2E Testing

| Variable                          | Required | Default     | Description                                                        |
|----------------------------------|----------|-------------|--------------------------------------------------------------------|
| `PLAYWRIGHT_SKIP_AUTH_SETUP`      | No       | `0`         | Set to `"1"` to skip Shopify login during E2E tests               |
| `PLAYWRIGHT_STORAGE_STATE`        | No       | `playwright/.auth/shopify.json` | Path to the auth storage state file       |
| `SHOPIFY_LOGIN_EMAIL`             | E2E only | --          | Shopify partner email for E2E auth setup                           |
| `SHOPIFY_LOGIN_PASSWORD`          | E2E only | --          | Shopify partner password for E2E auth setup                        |

### Local `.env` File (Development Defaults)

The committed `.env` file contains development defaults:

```env
LOG_LEVEL=debug
LOG_CATEGORIES=forms
SHOPIFY_BILLING_USE_TEST=true
SHOPIFY_MANAGED_PRICING_HANDLE=discounts-display
SHOW_DASHBOARD_DEV_TOOLS=true
APP_BUILD_ENV=dev
```

Note: `SHOPIFY_API_KEY` and `SHOPIFY_API_SECRET` are injected by Shopify CLI at runtime and not committed to the `.env` file.

---

## Configuration Files

### shopify.app.toml (webhook subscriptions, scopes, auth)

**File:** `shopify.app.toml`

This is the Shopify CLI configuration file that defines the app's identity, scopes, webhooks, and auth redirect URLs.

**App Identity:**
```toml
client_id = "c14a881db543db5ee77a83c990e47dab"
name = "discounts display pro"
application_url = "https://example.com"
embedded = true
```

The `application_url` uses `example.com` as a placeholder. During Docker builds, `sed` replaces this with the actual domain (see Docker Deployment section).

**API Version and Webhook Subscriptions:**
```toml
[webhooks]
api_version = "2025-10"
```

Ten webhook subscriptions plus three compliance topics are declared:

| Topic                      | URI                                      |
|---------------------------|------------------------------------------|
| `app/uninstalled`          | `/webhooks/app/uninstalled`              |
| `app/scopes_update`        | `/webhooks/app/scopes_update`            |
| `app_subscriptions/update` | `/webhooks/app/subscriptions_update`     |
| `discounts/create`         | `/webhooks/app/discounts_create`         |
| `discounts/update`         | `/webhooks/app/discounts_update`         |
| `discounts/delete`         | `/webhooks/app/discounts_delete`         |
| `collections/update`       | `/webhooks/app/collections_update`       |
| `collections/delete`       | `/webhooks/app/collections_delete`       |
| `products/update`          | `/webhooks/app/products_update`          |
| `products/delete`          | `/webhooks/app/products_delete`          |
| `customers/data_request` (compliance) | `/webhooks/app/customers_data_request` |
| `customers/redact` (compliance)       | `/webhooks/app/customers_redact`       |
| `shop/redact` (compliance)            | `/webhooks/app/shop_redact`            |

**Access Scopes:**
```toml
[access_scopes]
scopes = "read_discounts,read_products,read_themes"
use_legacy_install_flow = false
```

The app requests read-only access to discounts, products, and themes. No write scopes are needed because all mutations go through the admin GraphQL API (authenticated via session tokens).

**Auth Redirect URLs:**
```toml
[auth]
redirect_urls = [
  "https://example.com/auth/callback",
  "https://example.com/auth/shopify/callback"
]
```

These are also replaced with the actual domain during Docker build.

**POS:** Disabled (`embedded = false`).

### vite.config.js

**File:** `vite.config.js`

The Vite configuration handles both development (with HMR tunneling) and production builds.

**Key settings:**
- **HOST workaround:** Remaps the `HOST` env var to `SHOPIFY_APP_URL` to work around a Remix issue.
- **HMR configuration:** When running on localhost, uses `ws://localhost:64999`. When running behind a tunnel, uses `wss://{host}:8002` with client port 443.
- **Server port:** `process.env.PORT || 3000`.
- **Allowed hosts:** The tunnel hostname is added to `server.allowedHosts`.
- **Remix plugin:** Configured with Remix v3 future flags:
  - `v3_fetcherPersist: true`
  - `v3_relativeSplatPath: true`
  - `v3_throwAbortReason: true`
  - `v3_lazyRouteDiscovery: true`
  - `v3_singleFetch: false` (disabled)
  - `v3_routeConfig: true`
- **Build:** `assetsInlineLimit: 0` ensures no assets are inlined as base64.
- **Optimized dependencies:** `@shopify/app-bridge-react` and `@shopify/polaris` are pre-bundled.
- **tsconfig paths plugin** is included for path alias resolution.

### remix.config.js

**File:** `remix.config.js`

A legacy Remix configuration file (CommonJS format). While Vite is the primary build tool, this file exists for compatibility:

```js
module.exports = {
  ignoredRouteFiles: ["**/.*"],
  appDirectory: "app",
  serverModuleFormat: "cjs",
  dev: { port: process.env.HMR_SERVER_PORT || 8002 },
  future: {},
};
```

This mirrors the HOST-to-SHOPIFY_APP_URL workaround found in `vite.config.js`.

---

## Database Setup (Prisma, SQLite)

The app uses **Prisma** as its ORM with **SQLite** as the database engine.

- **Schema file:** `prisma/schema.prisma`
- **Database file:** `prisma/dev.sqlite`
- **Setup command:** `npm run setup` runs `prisma generate && prisma migrate deploy`
- **Prisma generate** creates the TypeScript client from the schema.
- **Prisma migrate deploy** applies all pending migrations to the SQLite file.

In Docker, the setup command runs at container start (`docker-start` script: `npm run setup && npm run start`), so migrations are applied on every deployment.

---

## Build Process

The build uses Remix with Vite:

```bash
npm run build    # Equivalent to: remix vite:build
```

This produces:
- `build/server/index.js` -- the server bundle (served by `remix-serve`)
- `build/client/` -- static client assets

The production server is started with:
```bash
npm run start    # Equivalent to: remix-serve ./build/server/index.js
```

---

## Docker Deployment

**File:** `Dockerfile`

### Two-Stage Build

The Dockerfile performs a single-stage build (no multi-stage) with distinct phases:

**Phase 1: Base Image and Dependencies**
```dockerfile
FROM node:24-alpine
RUN apk add --no-cache openssl
```
- Uses `node:24-alpine` as the base image.
- Installs `openssl` (required by Prisma for SQLite).
- Sets `NODE_ENV=production`.

**Phase 2: Install Dependencies**
```dockerfile
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force
```
- Copies only package files first for Docker layer caching.
- Installs production dependencies only (`--omit=dev`).

**Phase 3: Copy Source and Domain Replacement**
```dockerfile
COPY . .
RUN case "$APP_BUILD_ENV" in \
        testing) DOMAIN_REPLACEMENT="test.discountsapp.wizardformula.pt" ;; \
        production) DOMAIN_REPLACEMENT="discountsapp.wizardformula.pt" ;; \
        *) echo "Invalid APP_BUILD_ENV..." >&2; exit 1 ;; \
    esac && \
    sed -i "s|example.com|${DOMAIN_REPLACEMENT}|g" shopify.app.toml
```

### Domain Replacement

The `shopify.app.toml` file uses `example.com` as a placeholder for all URLs (`application_url`, `redirect_urls`). At build time, the `APP_BUILD_ENV` argument determines the replacement:

| `APP_BUILD_ENV` | Domain                                    |
|-----------------|-------------------------------------------|
| `testing`       | `test.discountsapp.wizardformula.pt`      |
| `production`    | `discountsapp.wizardformula.pt`           |

`sed` replaces all occurrences of `example.com` in the TOML file.

**Phase 4: Build and Deploy**
```dockerfile
RUN npm run build
RUN npm install -g @shopify/cli@latest && \
    SHOPIFY_CLI_PARTNERS_TOKEN="$SHOPIFY_CLI_PARTNERS_TOKEN" \
    SHOPIFY_CLI_NO_ANALYTICS=1 \
    shopify app deploy -f && \
    npm remove -g @shopify/cli
```
- Builds the Remix application.
- Installs the Shopify CLI globally, runs `shopify app deploy -f` (force deploy, no confirmation prompt), then removes the CLI to keep the image smaller.
- The `SHOPIFY_CLI_PARTNERS_TOKEN` build argument authenticates the deploy.

**Phase 5: Litestream + Backup Infrastructure**
```dockerfile
# Install Litestream for continuous SQLite replication
ADD https://github.com/benbjohnson/litestream/releases/download/v0.5.7/litestream-v0.5.7-linux-amd64.tar.gz /tmp/litestream.tar.gz
RUN tar -C /usr/local/bin -xzf /tmp/litestream.tar.gz && rm /tmp/litestream.tar.gz

# Install sqlite3 CLI for scheduled backups (VACUUM INTO)
RUN apk add --no-cache sqlite

COPY litestream.yml /etc/litestream.yml
COPY scripts/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh
```

**Phase 6: Runtime**
```dockerfile
CMD ["/usr/local/bin/docker-entrypoint.sh"]
```
- The entrypoint script: (1) restores database from Litestream if missing, (2) starts the app under Litestream replication
- Pattern: `litestream restore -if-db-not-exists → litestream replicate -exec "npm run docker-start"`
- `docker-start` runs: `npm run setup && npm run start`
- This ensures Prisma migrations are applied before starting the server.
- Litestream continuously streams WAL changes to S3-compatible storage (e.g., Cloudflare R2)

The container exposes port 3000.

### Backup Configuration

**File: `litestream.yml`** (project root)
```yaml
dbs:
  - path: /app/prisma/dev.sqlite
    replicas:
      - type: s3
        bucket: your-backup-bucket
        path: discounts-app/db
        endpoint: https://YOUR_ACCOUNT_ID.r2.cloudflarestorage.com
        region: auto
        retention: 72h
        snapshot-interval: 1h
        sync-interval: 1s
```

Credentials via env vars: `LITESTREAM_ACCESS_KEY_ID`, `LITESTREAM_SECRET_ACCESS_KEY`.

**Scheduled VACUUM INTO** (every 6 hours) — run via deployment platform's scheduled jobs (e.g., Dokploy), not cron inside the container:
```bash
sqlite3 /app/prisma/dev.sqlite "VACUUM INTO '/app/prisma/backups/backup-$(date +%Y%m%d-%H%M%S).sqlite';"
```

See `13-known-issues-improvements.md` for full backup strategy rationale and restore procedures.

---

## Deployment Environments

### Testing: test.discountsapp.wizardformula.pt

Built with `APP_BUILD_ENV=testing`. Used for QA and staging. Test billing mode is typically enabled (`SHOPIFY_BILLING_USE_TEST=true`).

### Production: discountsapp.wizardformula.pt

Built with `APP_BUILD_ENV=production`. The live production environment serving real merchants.

Both environments run the same Docker image with different build arguments. The domain replacement ensures that webhook URLs, auth redirects, and the application URL all point to the correct host.

---

## Testing Setup

### Vitest (Unit Tests)

**File:** `vitest.config.ts`

```ts
export default defineConfig({
  test: {
    globals: true,
    environment: "jsdom",
    include: ["app/tests/unit/**/*.{test,spec}.{js,jsx,ts,tsx}"],
    exclude: ["app/tests/e2e/**"],
    setupFiles: ["./app/tests/setup.ts"]
  }
});
```

- **Environment:** `jsdom` for DOM testing.
- **Globals:** `true` -- `describe`, `it`, `expect` etc. are available without imports.
- **Test location:** `app/tests/unit/` directory.
- **Setup file:** `app/tests/setup.ts` runs before all tests.

**Commands:**
```bash
npm run test          # vitest run (single run)
npm run test:watch    # vitest (watch mode)
npm run test -- filename  # Run tests matching a pattern
```

### Playwright (E2E Tests)

**File:** `playwright.config.ts`

```ts
export default defineConfig({
  testDir: './app/tests/e2e',
  timeout: 120_000,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  snapshotPathTemplate: '{testDir}/regressions/screenshots/{arg}{ext}',
  globalSetup: skipAuthSetup ? undefined : './app/tests/e2e/global-setup.ts',
  use: {
    headless: true,
    viewport: { width: 1600, height: 900 },
    deviceScaleFactor: 2,
    actionTimeout: 30_000,
    navigationTimeout: 60_000,
    screenshot: 'only-on-failure',
    video: 'retain-on-failure'
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome HiDPI'] } }]
});
```

- **Test directory:** `app/tests/e2e/`
- **Timeout:** 2 minutes per test.
- **Retries:** 1 in CI, 0 locally.
- **Workers:** 2 in CI, auto locally.
- **Auth:** When `PLAYWRIGHT_SKIP_AUTH_SETUP=1` is not set, the global setup runs a Shopify login flow and saves auth state to `playwright/.auth/shopify.json`.
- **Device:** Desktop Chrome HiDPI (high-DPI viewport for visual regression accuracy).

### PLAYWRIGHT_SKIP_AUTH_SETUP=1

This is the key flag for running E2E tests without a real Shopify session:

```bash
# Skip auth setup (tests requiring real sessions will still fail)
PLAYWRIGHT_SKIP_AUTH_SETUP=1 npx playwright test --config=playwright.config.ts --project=chromium

# With full auth (requires SHOPIFY_LOGIN_EMAIL and SHOPIFY_LOGIN_PASSWORD)
npm run test:e2e
```

When set, the global setup script is skipped entirely, and no `storageState` is applied to the browser context.

---

## Package Management (always npm ci)

The project enforces `npm ci` for dependency installation:

- `npm ci` installs dependencies exactly as specified in `package-lock.json`, ensuring deterministic builds.
- `npm install` should never be used as it may update the lockfile.
- The lockfile (`package-lock.json`) must not be deleted.
- The Dockerfile uses `npm ci --omit=dev` to install only production dependencies.

**Key dependency versions:**

| Package                           | Version   |
|----------------------------------|-----------|
| `@remix-run/dev`                  | ^2.16.1   |
| `@remix-run/node`                 | ^2.16.1   |
| `@remix-run/react`                | ^2.16.1   |
| `@remix-run/serve`                | ^2.16.1   |
| `@shopify/polaris`                | ^12.27.0  |
| `@shopify/app-bridge-react`       | ^4.1.10   |
| `@shopify/shopify-app-remix`      | ^3.7.0    |
| `@prisma/client`                  | ^6.2.1    |
| `react`                           | ^18.2.0   |
| `vite`                            | ^6.2.2    |
| `vitest`                          | ^3.2.4    |
| `@playwright/test`                | ^1.56.0   |

**Module format:** ESM (`"type": "module"` in `package.json`).

**Workspaces:** `extensions/*` is declared as a workspace for the theme app extension.

**Node engine requirement:** `^18.20 || ^20.10 || >=21.0.0`.
