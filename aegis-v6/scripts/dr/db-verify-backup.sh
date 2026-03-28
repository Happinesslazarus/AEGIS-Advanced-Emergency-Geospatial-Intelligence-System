#!/usr/bin/env bash
# AEGIS Database Backup Verification
#
# Restores a backup to a temporary database and runs integrity checks.
# Does NOT affect the production database.
#
# Usage:
#   ./scripts/dr/db-verify-backup.sh backups/db/aegis_20260309_120000.sql.gz
set -euo pipefail

BACKUP_FILE="${1:?Usage: db-verify-backup.sh <backup-file.sql.gz>}"
CONTAINER="${DB_CONTAINER:-aegis-v6-db-1}"
DB_USER="${DB_USER:-aegis}"
VERIFY_DB="aegis_verify_$$"

if [ ! -f "$BACKUP_FILE" ]; then
  echo "[verify] ERROR: File not found: $BACKUP_FILE" >&2
  exit 1
fi

cleanup() {
  echo "[verify] Cleaning up temporary database..."
  docker exec "$CONTAINER" psql -U "$DB_USER" -d postgres -c "DROP DATABASE IF EXISTS ${VERIFY_DB};" 2>/dev/null || true
}
trap cleanup EXIT

echo "[verify] Creating temporary database: ${VERIFY_DB}"
docker exec "$CONTAINER" psql -U "$DB_USER" -d postgres -c "CREATE DATABASE ${VERIFY_DB} OWNER ${DB_USER};"

echo "[verify] Restoring backup..."
gunzip -c "$BACKUP_FILE" | docker exec -i "$CONTAINER" psql -U "$DB_USER" -d "$VERIFY_DB" --quiet 2>/dev/null

echo "[verify] Running integrity checks..."

TABLE_COUNT=$(docker exec "$CONTAINER" psql -U "$DB_USER" -d "$VERIFY_DB" -tAc \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public';")

REPORT_COUNT=$(docker exec "$CONTAINER" psql -U "$DB_USER" -d "$VERIFY_DB" -tAc \
  "SELECT count(*) FROM reports;" 2>/dev/null || echo "N/A")

ALERT_COUNT=$(docker exec "$CONTAINER" psql -U "$DB_USER" -d "$VERIFY_DB" -tAc \
  "SELECT count(*) FROM alerts;" 2>/dev/null || echo "N/A")

USER_COUNT=$(docker exec "$CONTAINER" psql -U "$DB_USER" -d "$VERIFY_DB" -tAc \
  "SELECT count(*) FROM users;" 2>/dev/null || echo "N/A")

echo ""
echo "  Backup Verification Results"
echo ""
echo "  File:    ${BACKUP_FILE}"
echo "  Tables:  ${TABLE_COUNT}"
echo "  Reports: ${REPORT_COUNT}"
echo "  Alerts:  ${ALERT_COUNT}"
echo "  Users:   ${USER_COUNT}"
echo ""

if [ "$TABLE_COUNT" -gt 10 ]; then
  echo "[verify] PASS — Backup looks valid."
else
  echo "[verify] WARN — Low table count (${TABLE_COUNT}). Investigate."
  exit 1
fi
