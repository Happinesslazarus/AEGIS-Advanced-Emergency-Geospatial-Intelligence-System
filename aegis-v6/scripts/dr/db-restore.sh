#!/usr/bin/env bash
# AEGIS Database Restore Script
#
# Restores a backup .sql.gz file into the running PostgreSQL container.
# WARNING: This drops and recreates the database. Run only intentionally.
#
# Usage:
#   ./scripts/dr/db-restore.sh backups/db/aegis_20260309_120000.sql.gz
set -euo pipefail

BACKUP_FILE="${1:?Usage: db-restore.sh <backup-file.sql.gz>}"
CONTAINER="${DB_CONTAINER:-aegis-v6-db-1}"
DB_NAME="${DB_NAME:-aegis}"
DB_USER="${DB_USER:-aegis}"

if [ ! -f "$BACKUP_FILE" ]; then
  echo "[restore] ERROR: File not found: $BACKUP_FILE" >&2
  exit 1
fi

echo "║  WARNING: This will REPLACE the ${DB_NAME} database       ║"
echo "║  Backup file: ${BACKUP_FILE}                              ║"
echo ""
read -r -p "Type 'yes' to continue: " CONFIRM
if [ "$CONFIRM" != "yes" ]; then
  echo "[restore] Aborted."
  exit 0
fi

echo "[restore] Stopping server to prevent writes..."
docker compose stop server 2>/dev/null || true

echo "[restore] Dropping and recreating database..."
docker exec "$CONTAINER" psql -U "$DB_USER" -d postgres -c "
  SELECT pg_terminate_backend(pid) FROM pg_stat_activity
  WHERE datname = '${DB_NAME}' AND pid <> pg_backend_pid();
"
docker exec "$CONTAINER" psql -U "$DB_USER" -d postgres -c "DROP DATABASE IF EXISTS ${DB_NAME};"
docker exec "$CONTAINER" psql -U "$DB_USER" -d postgres -c "CREATE DATABASE ${DB_NAME} OWNER ${DB_USER};"

echo "[restore] Loading backup..."
gunzip -c "$BACKUP_FILE" | docker exec -i "$CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" --quiet

echo "[restore] Running migrations..."
docker compose run --rm migration 2>/dev/null || echo "[restore] No migration service; skip."

echo "[restore] Restarting server..."
docker compose start server 2>/dev/null || true

echo "[restore] Verifying table count..."
TABLE_COUNT=$(docker exec "$CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -tAc \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public';")
echo "[restore] Public tables: ${TABLE_COUNT}"

echo "[restore] Done. Database restored from ${BACKUP_FILE}."
