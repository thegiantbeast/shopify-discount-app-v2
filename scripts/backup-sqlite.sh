#!/bin/sh
set -e

# Scheduled VACUUM INTO backup — runs every 6 hours via deployment platform
# NEVER use `cp` to back up SQLite — produces corrupt backups during active writes

DB_PATH="/app/prisma/dev.sqlite"
BACKUP_DIR="/app/prisma/backups"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/backup-${TIMESTAMP}.sqlite"

mkdir -p "$BACKUP_DIR"

echo "Creating backup: ${BACKUP_FILE}"
sqlite3 "$DB_PATH" "VACUUM INTO '${BACKUP_FILE}';"
echo "Backup completed: ${BACKUP_FILE}"

# Clean up backups older than 7 days
find "$BACKUP_DIR" -name "backup-*.sqlite" -mtime +7 -delete 2>/dev/null || true
echo "Cleanup completed"
