FROM node:24-alpine
RUN apk add --no-cache openssl

EXPOSE 3000

WORKDIR /app

ENV NODE_ENV=production
ARG APP_BUILD_ENV=production

# Install dependencies (layer cached)
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy source
COPY . .

# Domain replacement based on build environment
RUN case "$APP_BUILD_ENV" in \
        testing) DOMAIN_REPLACEMENT="test.discountsapp.wizardformula.pt" ;; \
        production) DOMAIN_REPLACEMENT="discountsapp.wizardformula.pt" ;; \
        *) echo "Invalid APP_BUILD_ENV: $APP_BUILD_ENV. Expected 'testing' or 'production'." >&2; exit 1 ;; \
    esac && \
    sed -i "s|example.com|${DOMAIN_REPLACEMENT}|g" shopify.app.toml

# Generate Prisma client (needed by Remix build; postinstall hook may skip with --omit=dev)
RUN npx prisma generate

# Build Remix app
RUN npm run build

# Deploy to Shopify (token passed via BuildKit secret, never stored in image layers)
RUN --mount=type=secret,id=SHOPIFY_CLI_PARTNERS_TOKEN \
    npm install -g @shopify/cli@latest && \
    SHOPIFY_CLI_PARTNERS_TOKEN="$(cat /run/secrets/SHOPIFY_CLI_PARTNERS_TOKEN)" SHOPIFY_CLI_NO_ANALYTICS=1 shopify app deploy -f && \
    npm remove -g @shopify/cli

# Install Litestream for continuous SQLite replication
ADD https://github.com/benbjohnson/litestream/releases/download/v0.5.7/litestream-v0.5.7-linux-amd64.tar.gz /tmp/litestream.tar.gz
RUN tar -C /usr/local/bin -xzf /tmp/litestream.tar.gz && rm /tmp/litestream.tar.gz

# Install sqlite3 CLI for scheduled backups (VACUUM INTO)
RUN apk add --no-cache sqlite

# Copy backup infrastructure
COPY litestream.yml /etc/litestream.yml
COPY scripts/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/health || exit 1

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
