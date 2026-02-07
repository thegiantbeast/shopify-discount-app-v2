# Discount Display Pro

A Shopify app that fetches discounts from the Admin API, resolves which products/variants they apply to, and displays discount badges + coupon UI on the storefront via a theme app extension.

## Prerequisites

- Node.js 18.20+, 20.10+, or 21+
- A Shopify Partner account and development store
- Shopify CLI installed (`npm install -g @shopify/cli`)

## Local Development Setup

### 1. Clone and install

```bash
git clone <repo-url>
cd shopify-discount-app-v2
npm ci
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` with your values:

| Variable | Required | Description |
|----------|----------|-------------|
| `SHOPIFY_API_KEY` | Yes | App API key from Shopify Partners dashboard |
| `SHOPIFY_API_SECRET` | Yes | App API secret from Shopify Partners dashboard |
| `SHOPIFY_APP_URL` | Yes | Your app's public URL (Shopify CLI sets this automatically in dev) |
| `DATABASE_URL` | Yes | SQLite connection string. Default: `file:dev.sqlite?connection_limit=1` |
| `SHOPIFY_BILLING_USE_TEST` | No | Set to `true` for test billing (default), `false` for real charges |
| `SHOPIFY_MANAGED_PRICING_HANDLE` | Yes | Your app's managed pricing handle (e.g., `discounts-display`) |
| `STOREFRONT_AUTH_ENFORCE` | No | `false` (default) = soft mode (log but allow), `true` = block unauthenticated requests |
| `LOG_LEVEL` | No | Logging level: `fatal`, `error`, `warn`, `info` (default), `debug`, `trace` |
| `SHOW_DASHBOARD_DEV_TOOLS` | No | Show dev tools panel on dashboard (default: `true` in dev) |
| `FRONTEND_PORT` | No | Vite HMR port (default: `8002`) |
| `HMR_SERVER_PORT` | No | HMR server port (default: `8002`) |

### 3. Set up the database

```bash
npm run setup    # prisma generate + migrate deploy
```

### 4. Link your Shopify app

```bash
npm run config:link
```

### 5. Start development

```bash
npm run dev
```

This starts the Remix dev server with Shopify CLI, which handles tunneling and OAuth.

### 6. Build the theme extension (if modifying storefront JS)

```bash
npm run build:extension         # one-time build
npm run watch:extension         # watch mode
```

## Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Start dev server with Shopify CLI |
| `npm run build` | Production Remix build |
| `npm run build:extension` | Bundle theme extension JS |
| `npm run watch:extension` | Watch + rebuild theme extension |
| `npm run setup` | Generate Prisma client + run migrations |
| `npm run test` | Run Vitest unit/integration tests |
| `npm run test:watch` | Run Vitest in watch mode |
| `npm run test:e2e` | Run Playwright E2E tests |
| `npm run lint` | ESLint |
| `npm run deploy` | Deploy to Shopify |
| `npm run start` | Start production server (after build) |

## Testing

### Unit & integration tests (Vitest)

```bash
npm run test                # run once
npm run test:watch          # watch mode
```

No Shopify credentials needed — all external dependencies are mocked.

### E2E tests (Playwright)

```bash
# Requires a running dev server and Shopify credentials:
SHOPIFY_LOGIN_EMAIL=you@example.com \
SHOPIFY_LOGIN_PASSWORD=your-password \
npm run test:e2e
```

Set `PLAYWRIGHT_SKIP_AUTH_SETUP=1` to skip Shopify auth setup (uses cached session).

## Production Deployment (Dokploy / Docker)

This section walks you through deploying the app on Dokploy step by step.

### 1. Create the application in Dokploy

1. Log into your Dokploy dashboard
2. Click **Projects** in the left sidebar, then **Create Project** (or select an existing project)
3. Inside the project, click **Create Service** → **Application**
4. Choose **Docker** as the build type
5. Under **Provider**, select **Git** and connect your repository (or use **Docker Image** if you're pushing pre-built images)
6. Set the **Branch** to `main` (or whichever branch you deploy from)

### 2. Configure build arguments

The Docker build needs to know which environment it's building for and needs a Shopify Partners token to deploy the app configuration.

1. In your application's settings, go to the **Advanced** tab → **Build Args**
2. Add the following build arg:

| Name | Value | Description |
|------|-------|-------------|
| `APP_BUILD_ENV` | `testing` or `production` | Controls which domain is injected into `shopify.app.toml` |

- `testing` → `test.discountsapp.wizardformula.pt`
- `production` → `discountsapp.wizardformula.pt`

3. For the Shopify CLI Partners token, go to **Build Args** and add:

| Name | Value |
|------|-------|
| `SHOPIFY_CLI_PARTNERS_TOKEN` | Your Partners CLI token (get it from Shopify Partners → Settings → CLI tokens) |

> **Note:** If Dokploy supports BuildKit secrets, prefer using those instead of build args so the token doesn't appear in image layer history. The Dockerfile is configured to accept it either way.

### 3. Set runtime environment variables

These are the env vars the running container needs. In Dokploy:

1. Go to your application → **Environment** tab
2. Add each variable below (one per line in `KEY=value` format):

```env
SHOPIFY_API_KEY=your-api-key
SHOPIFY_API_SECRET=your-api-secret
SHOPIFY_APP_URL=https://discountsapp.wizardformula.pt
DATABASE_URL=file:/app/prisma/dev.sqlite?connection_limit=1
SHOPIFY_MANAGED_PRICING_HANDLE=discounts-display
STOREFRONT_AUTH_ENFORCE=true
LOG_LEVEL=info
LITESTREAM_ACCESS_KEY_ID=your-r2-access-key
LITESTREAM_SECRET_ACCESS_KEY=your-r2-secret-key
```

| Variable | Required | Notes |
|----------|----------|-------|
| `SHOPIFY_API_KEY` | Yes | From Shopify Partners dashboard → App → API credentials |
| `SHOPIFY_API_SECRET` | Yes | Same location as above |
| `SHOPIFY_APP_URL` | Yes | Must match the domain for your `APP_BUILD_ENV` exactly |
| `DATABASE_URL` | Yes | Always use this exact value — the path matches where the container stores the SQLite file |
| `SHOPIFY_MANAGED_PRICING_HANDLE` | Yes | The handle you set up in Shopify Partners for managed pricing |
| `STOREFRONT_AUTH_ENFORCE` | Recommended | `true` for production, `false` if debugging storefront issues |
| `LOG_LEVEL` | No | `info` for normal operation, `debug` for troubleshooting |
| `LITESTREAM_ACCESS_KEY_ID` | Yes | Cloudflare R2 access key (from R2 → Manage R2 API Tokens) |
| `LITESTREAM_SECRET_ACCESS_KEY` | Yes | Cloudflare R2 secret key (shown once when you create the token) |

3. Click **Save**

### 4. Configure Litestream (database backups)

Before your first deploy, edit `litestream.yml` in your repository with your actual Cloudflare R2 values:

```yaml
dbs:
  - path: /app/prisma/dev.sqlite
    replicas:
      - type: s3
        bucket: your-backup-bucket          # ← replace with your R2 bucket name
        path: discounts-app/db
        endpoint: https://YOUR_ACCOUNT_ID.r2.cloudflarestorage.com  # ← replace with your R2 endpoint
        region: auto
        retention: 72h
        snapshot-interval: 1h
        sync-interval: 1s
```

**Where to find these values:**
- **Bucket name**: Cloudflare dashboard → R2 → your bucket's name
- **Endpoint**: Cloudflare dashboard → R2 → your bucket → Settings → S3 API endpoint (looks like `https://abc123.r2.cloudflarestorage.com`)
- **Credentials**: Set as env vars (`LITESTREAM_ACCESS_KEY_ID` / `LITESTREAM_SECRET_ACCESS_KEY`) — Litestream reads them automatically

Commit this file to your repository before deploying.

### 5. Configure networking

1. In your application → **Domains** tab
2. Click **Add Domain**
3. Set the **Host** to your domain (e.g., `discountsapp.wizardformula.pt`)
4. Set the **Container Port** to `3000`
5. Enable **HTTPS** (Dokploy handles Let's Encrypt certificates automatically)
6. Click **Save**

Make sure your domain's DNS points to your Dokploy server's IP address (an A record).

### 6. Enable zero-downtime deployments

Without this, each deploy causes a brief downtime (old container stops before new one is ready).

The app has a built-in health check at `/api/health` that verifies the app and database are operational. To use it:

1. Go to your application → **Advanced** tab → **Swarm Settings** (or **Health Check**, depending on your Dokploy version)
2. Paste this health check configuration:

```json
{
  "Test": ["CMD", "wget", "-qO-", "http://localhost:3000/api/health"],
  "Interval": 30000000000,
  "Timeout": 10000000000,
  "StartPeriod": 30000000000,
  "Retries": 3
}
```

**What this does:** On each deploy, Dokploy starts the new container, pings `/api/health` every 30 seconds (waiting 30 seconds initially for the app to boot), and only stops the old container once the new one responds with 200. If the health check fails 3 times, the deployment is rolled back.

### 7. Deploy

1. Go to your application → **Deployments** tab
2. Click **Deploy** (or push to your configured branch if auto-deploy is enabled)
3. Watch the build logs — you should see:
   - `npm ci` installing dependencies
   - `remix vite:build` compiling the app
   - `shopify app deploy` registering webhooks and configuration with Shopify
   - Litestream and SQLite CLI being installed
4. Once the build completes, the container starts and:
   - Litestream restores the database from R2 backup (if the SQLite file doesn't exist yet)
   - Prisma migrations run (`npm run setup`)
   - The Remix server starts on port 3000
   - Litestream begins continuous WAL replication to R2

### 8. Set up scheduled database backups

Litestream handles continuous replication, but you should also have compacted snapshots as a second safety net.

1. In Dokploy, find the **Scheduled Jobs** or **Cron Jobs** section for your application
2. Create a new job with:
   - **Schedule**: `0 */6 * * *` (every 6 hours)
   - **Command**: `sqlite3 /app/prisma/dev.sqlite "VACUUM INTO '/tmp/backup-$(date +%Y%m%d-%H%M%S).sqlite'"`
3. This creates a compacted snapshot that's safe even during active writes

**Never** use `cp` to back up SQLite — it produces corrupt backups during active writes.

### 9. Verify the deployment

After your first deploy:

1. Visit `https://your-domain.com/api/health` — should return `{"status":"ok"}`
2. Open your Shopify dev store → Apps → Discount Display Pro — the embedded app should load
3. Check the Dokploy logs for any errors (especially Litestream replication and Prisma migration output)
4. In Cloudflare R2, verify that Litestream has started writing WAL segments to your bucket

## Architecture

```
app/routes/           — Remix routes (pages + API endpoints)
app/utils/            — Server-side business logic
app/tests/            — Unit + integration tests
extensions/           — Theme app extension (storefront)
  discounts-display-pro/
    src/              — JS source modules (pre-bundle)
    assets/           — Bundled output (do not edit directly)
    blocks/           — Liquid templates
    snippets/         — CSS + config snippets
prisma/               — Schema + migrations
scripts/              — Docker entrypoint + utilities
docs/                 — Specification and agent prompts
```

### Key technical decisions

- **SQLite** with 8 performance PRAGMAs (WAL mode, busy timeout, etc.) — see `app/db.server.js`
- **Junction tables** for many-to-many relationships (not JSON arrays)
- **Webhook-driven** data sync — no polling or WebSockets
- **Litestream** for continuous database replication to Cloudflare R2
- **Per-shop rate limiting** and **timing-safe token auth** on storefront API endpoints

## Logging

Server-side logging uses `pino` with a wrapper that accepts `(message, data?)` signature:

```javascript
import { createLogger } from "./utils/logger.server.js";
const logger = createLogger("ModuleName");

logger.info("Something happened");
logger.info("User logged in", { shop, userId });
logger.error("Failed to process", { err: error, shop });
```

Client-side logging (theme extension) uses `window.DDPLogger`.
