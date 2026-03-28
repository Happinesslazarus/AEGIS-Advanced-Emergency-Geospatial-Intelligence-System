#!/usr/bin/env bash
# AEGIS v6 -- Database Migration Runner
# Runs inside the dedicated `migration` Docker service.
#
# Execution order:
#   1. Wait for PostgreSQL readiness (pg_isready)
#   2. Apply schema.sql (idempotent -- CREATE IF NOT EXISTS)
#   3. Create schema_migrations tracking table
#   4. Apply every migration from migration_manifest.txt (or alphabetical
#      fallback), skipping any already recorded in schema_migrations
#   5. Apply seed files (dev only, controlled by SEED_DATA env var)
#
# All migrations use IF NOT EXISTS / ON CONFLICT DO NOTHING, so re-runs are
# safe.  The script exits 0 on success, 1 on the first failure (with a clear
# message identifying which file failed).
set -euo pipefail

# Configuration
MIGRATIONS_DIR="${MIGRATIONS_DIR:-/migrations}"
PGHOST="${PGHOST:-db}"
PGPORT="${PGPORT:-5432}"
PGUSER="${PGUSER:-postgres}"
PGDATABASE="${PGDATABASE:-aegis}"

MAX_RETRIES="${DB_READY_RETRIES:-30}"
RETRY_INTERVAL="${DB_READY_INTERVAL:-2}"

# SEED_DATA: "true" to run seed files, anything else to skip.
# Default to "true" for dev; docker-compose.prod.yml overrides to "false".
SEED_DATA="${SEED_DATA:-true}"

# Helpers
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No colour

log()   { printf "${CYAN}[migration]${NC} %s\n" "$*"; }
ok()    { printf "${GREEN}[migration] OK${NC} %s\n" "$*"; }
warn()  { printf "${YELLOW}[migration] WARN${NC} %s\n" "$*"; }
fail()  { printf "${RED}[migration] FAIL${NC} %s\n" "$*" >&2; }

apply_sql() {
  local file="$1"
  local label
  label="$(basename "$file")"
  log "Applying ${label} ..."
  if psql -v ON_ERROR_STOP=1 -f "$file" > /dev/null 2>&1; then
    ok "${label}"
  else
    fail "${label} -- migration failed"
    fail "Run manually to see the error:"
    fail "  psql -v ON_ERROR_STOP=1 -f ${file}"
    return 1
  fi
}

# Check if a migration has already been applied
is_applied() {
  local mname="$1"
  local result
  result=$(psql -v ON_ERROR_STOP=1 -tAc \
    "SELECT 1 FROM schema_migrations WHERE name = '${mname}' LIMIT 1;" 2>/dev/null)
  [ "$result" = "1" ]
}

# 1. Wait for PostgreSQL
log "Waiting for PostgreSQL at ${PGHOST}:${PGPORT} ..."
attempt=0
until pg_isready -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" -q; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge "$MAX_RETRIES" ]; then
    fail "PostgreSQL not ready after $((MAX_RETRIES * RETRY_INTERVAL))s -- aborting."
    exit 1
  fi
  sleep "$RETRY_INTERVAL"
done
ok "PostgreSQL is ready."

# 2. Core schema
if [ -f "${MIGRATIONS_DIR}/schema.sql" ]; then
  apply_sql "${MIGRATIONS_DIR}/schema.sql"
else
  fail "schema.sql not found in ${MIGRATIONS_DIR}"
  exit 1
fi

# 2b. Schema migrations tracking table
log "Ensuring schema_migrations tracking table exists ..."
psql -v ON_ERROR_STOP=1 -c \
  "CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ DEFAULT NOW());" \
  > /dev/null 2>&1
ok "schema_migrations table ready."

# 3. Migrations (manifest-first deterministic order, stateful)
migration_count=0
skipped_count=0
MANIFEST_FILE="${MIGRATIONS_DIR}/migration_manifest.txt"

if [ -f "$MANIFEST_FILE" ]; then
  log "Applying migrations from manifest: ${MANIFEST_FILE}"
  while IFS= read -r rel || [ -n "$rel" ]; do
    # Skip blank lines and comments
    if [ -z "$rel" ] || printf '%s' "$rel" | grep -qE '^\s*#'; then
      continue
    fi

    rel="$(printf '%s' "$rel" | sed 's/^\s*//; s/\s*$//')"
    file="${MIGRATIONS_DIR}/${rel}"

    if [ ! -f "$file" ]; then
      fail "Manifest references missing migration: ${rel}"
      exit 1
    fi

    # Skip already-applied migrations
    if is_applied "$rel"; then
      skipped_count=$((skipped_count + 1))
      continue
    fi

    apply_sql "$file"

    # Record successful application
    psql -v ON_ERROR_STOP=1 -c \
      "INSERT INTO schema_migrations (name) VALUES ('${rel}') ON CONFLICT DO NOTHING;" \
      > /dev/null 2>&1

    migration_count=$((migration_count + 1))
  done < "$MANIFEST_FILE"
else
  warn "No migration_manifest.txt found. Falling back to legacy alphabetical migration_*.sql order."
  for f in $(LC_ALL=C ls -1 "${MIGRATIONS_DIR}"/migration_*.sql 2>/dev/null); do
    fname="$(basename "$f")"

    # Skip already-applied migrations
    if is_applied "$fname"; then
      skipped_count=$((skipped_count + 1))
      continue
    fi

    apply_sql "$f"

    # Record successful application
    psql -v ON_ERROR_STOP=1 -c \
      "INSERT INTO schema_migrations (name) VALUES ('${fname}') ON CONFLICT DO NOTHING;" \
      > /dev/null 2>&1

    migration_count=$((migration_count + 1))
  done
fi

if [ "$migration_count" -eq 0 ] && [ "$skipped_count" -eq 0 ]; then
  warn "No migration files were found in ${MIGRATIONS_DIR}."
elif [ "$migration_count" -eq 0 ]; then
  ok "All ${skipped_count} migration(s) already applied -- nothing to do."
else
  ok "${migration_count} migration(s) applied, ${skipped_count} skipped (already applied)."
fi

# 4. Seed data (development only)
if [ "$SEED_DATA" = "true" ]; then
  log "SEED_DATA=true -- applying seed files ..."
  for seed_file in seed.sql seed_risk_layers.sql; do
    if [ -f "${MIGRATIONS_DIR}/${seed_file}" ]; then
      apply_sql "${MIGRATIONS_DIR}/${seed_file}"
    else
      warn "${seed_file} not found -- skipping."
    fi
  done
else
  log "SEED_DATA=${SEED_DATA} -- skipping seed files (production mode)."
fi

# Done
echo ""
ok "All migrations completed successfully (${migration_count} new, ${skipped_count} skipped)."
exit 0
