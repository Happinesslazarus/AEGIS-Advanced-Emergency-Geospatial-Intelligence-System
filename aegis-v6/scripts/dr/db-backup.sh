#!/usr/bin/env bash
# AEGIS Database Backup Script
#
# Creates a timestamped pg_dump of the aegis database.
# Optionally uploads to S3 for off-site storage (when S3_BUCKET is set).
# Designed to run from the host machine with access to docker compose.
#
# Usage:
#   ./scripts/dr/db-backup.sh                                   # local only
#   S3_BUCKET=my-aegis-backups ./scripts/dr/db-backup.sh        # local + S3
#   BACKUP_DIR=/mnt/backups ./scripts/dr/db-backup.sh           # custom dir
#
# Cron example (daily at 02:00):
#   0 2 * * * cd /opt/aegis && S3_BUCKET=my-aegis-backups ./scripts/dr/db-backup.sh >> /var/log/aegis-backup.log 2>&1
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-./backups/db}"
CONTAINER="${DB_CONTAINER:-aegis-v6-db-1}"
DB_NAME="${DB_NAME:-aegis}"
DB_USER="${DB_USER:-aegis}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
S3_BUCKET="${S3_BUCKET:-}"
S3_PREFIX="${S3_PREFIX:-aegis/db}"
TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
BACKUP_FILE="${BACKUP_DIR}/aegis_${TIMESTAMP}.sql.gz"

mkdir -p "$BACKUP_DIR"

echo "[backup] Starting pg_dump of ${DB_NAME} from container ${CONTAINER}..."

docker exec "$CONTAINER" pg_dump \
  -U "$DB_USER" \
  -d "$DB_NAME" \
  --no-owner \
  --no-acl \
  --clean \
  --if-exists \
  --format=plain \
  | gzip > "$BACKUP_FILE"

SIZE=$(stat --printf="%s" "$BACKUP_FILE" 2>/dev/null || stat -f%z "$BACKUP_FILE")
echo "[backup] Created: ${BACKUP_FILE} (${SIZE} bytes)"

# Off-site upload to S3
if [ -n "$S3_BUCKET" ]; then
  S3_DEST="s3://${S3_BUCKET}/${S3_PREFIX}/aegis_${TIMESTAMP}.sql.gz"
  echo "[backup] Uploading to ${S3_DEST}..."
  if aws s3 cp "$BACKUP_FILE" "$S3_DEST" --storage-class STANDARD_IA; then
    echo "[backup] S3 upload complete."
  else
    echo "[backup] ERROR: S3 upload failed! Local backup is still available at ${BACKUP_FILE}" >&2
  fi
fi

# Prune old local backups
if [ "$RETENTION_DAYS" -gt 0 ]; then
  DELETED=$(find "$BACKUP_DIR" -name "aegis_*.sql.gz" -mtime +"$RETENTION_DAYS" -delete -print | wc -l)
  echo "[backup] Pruned ${DELETED} local backups older than ${RETENTION_DAYS} days"
fi

echo "[backup] Done."
