#!/usr/bin/env bash
# AEGIS Database Backup Script
# Usage: ./scripts/db-backup.sh [daily|weekly|manual]
# Requires: pg_dump, gzip
# Environment: DATABASE_URL or individual PG* vars
#
# Retention: daily=7, weekly=28, manual=30

set -euo pipefail

BACKUP_TYPE="${1:-manual}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_SUBDIR="${BACKUP_DIR}/${BACKUP_TYPE}"
BACKUP_FILE="${BACKUP_SUBDIR}/aegis_${BACKUP_TYPE}_${TIMESTAMP}.dump"

# Validate backup type
if [[ ! "$BACKUP_TYPE" =~ ^(daily|weekly|manual)$ ]]; then
  echo "[backup] ERROR: Invalid backup type '${BACKUP_TYPE}'. Use: daily|weekly|manual"
  exit 1
fi

# Retention periods (in days)
declare -A RETENTION=([daily]=7 [weekly]=28 [manual]=30)

# Parse DATABASE_URL if set, otherwise rely on PG* env vars
if [ -n "${DATABASE_URL:-}" ]; then
  # Extract components from postgresql://user:pass@host:port/dbname
  export PGUSER=$(echo "$DATABASE_URL" | sed -n 's|.*//\([^:]*\):.*|\1|p')
  export PGPASSWORD=$(echo "$DATABASE_URL" | sed -n 's|.*://[^:]*:\([^@]*\)@.*|\1|p')
  export PGHOST=$(echo "$DATABASE_URL" | sed -n 's|.*@\([^:]*\):.*|\1|p')
  export PGPORT=$(echo "$DATABASE_URL" | sed -n 's|.*:\([0-9]*\)/.*|\1|p')
  export PGDATABASE=$(echo "$DATABASE_URL" | sed -n 's|.*/\([^?]*\).*|\1|p')
fi

# Verify pg_dump is available
if ! command -v pg_dump &>/dev/null; then
  echo "[backup] ERROR: pg_dump not found. Install PostgreSQL client tools."
  exit 1
fi

echo "[backup] Starting ${BACKUP_TYPE} backup at $(date -Iseconds)"
echo "[backup] Database: ${PGDATABASE:-<from env>} @ ${PGHOST:-localhost}:${PGPORT:-5432}"

# Create backup directory
mkdir -p "${BACKUP_SUBDIR}"

# Run pg_dump with custom format for parallel restore capability
# Custom format includes built-in compression (--compress=6)
pg_dump \
  --format=custom \
  --compress=6 \
  --verbose \
  --no-owner \
  --no-privileges \
  --file="${BACKUP_FILE}" \
  2>&1 | tail -5

# Verify backup file exists and is non-empty
if [ ! -s "${BACKUP_FILE}" ]; then
  echo "[backup] ERROR: Backup file is empty or missing!"
  exit 1
fi

BACKUP_SIZE=$(du -h "${BACKUP_FILE}" | cut -f1)
echo "[backup] Backup complete: ${BACKUP_FILE} (${BACKUP_SIZE})"

# Cleanup old backups based on retention policy
RETENTION_DAYS="${RETENTION[$BACKUP_TYPE]:-30}"
DELETED=$(find "${BACKUP_SUBDIR}" -name "aegis_${BACKUP_TYPE}_*" -mtime "+${RETENTION_DAYS}" -delete -print | wc -l)
if [ "$DELETED" -gt 0 ]; then
  echo "[backup] Cleaned up ${DELETED} backups older than ${RETENTION_DAYS} days"
fi

echo "[backup] Done."
