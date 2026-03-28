#!/usr/bin/env bash
# AEGIS Model Rollback Script
#
# Rolls back an AI model to its previous stable version via the AI engine API.
#
# Usage:
#   ./scripts/dr/model-rollback.sh flood
#   ./scripts/dr/model-rollback.sh drought v2026.02.15
set -euo pipefail

MODEL_NAME="${1:?Usage: model-rollback.sh <model_name> [target_version]}"
TARGET_VERSION="${2:-}"
AI_ENGINE="${AI_ENGINE_URL:-http://localhost:8000}"
API_KEY="${AI_API_KEY:-aegis-dev-key}"

echo "[rollback] Model: ${MODEL_NAME}"
[ -n "$TARGET_VERSION" ] && echo "[rollback] Target version: ${TARGET_VERSION}"

PARAMS="model_name=${MODEL_NAME}"
[ -n "$TARGET_VERSION" ] && PARAMS="${PARAMS}&target_version=${TARGET_VERSION}"

RESPONSE=$(curl -s -w "\n%{http_code}" \
  -X POST "${AI_ENGINE}/api/models/rollback?${PARAMS}" \
  -H "X-API-Key: ${API_KEY}")

HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | head -n -1)

if [ "$HTTP_CODE" -ge 200 ] && [ "$HTTP_CODE" -lt 300 ]; then
  echo "[rollback] Success (HTTP ${HTTP_CODE}):"
  echo "$BODY" | python3 -m json.tool 2>/dev/null || echo "$BODY"
else
  echo "[rollback] FAILED (HTTP ${HTTP_CODE}):" >&2
  echo "$BODY" >&2
  exit 1
fi
