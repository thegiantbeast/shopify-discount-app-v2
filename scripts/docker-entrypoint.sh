#!/bin/sh
set -e

DB_PATH="/app/prisma/dev.sqlite"
LITESTREAM_CONFIG="/etc/litestream.yml"

# Restore database from backup if it doesn't exist and replica is available
if [ ! -f "$DB_PATH" ]; then
  echo "Database not found. Attempting restore from Litestream..."
  litestream restore -if-replica-exists -config "$LITESTREAM_CONFIG" "$DB_PATH" || true
fi

# Start the app under Litestream replication
exec litestream replicate -config "$LITESTREAM_CONFIG" -exec "npm run docker-start"
