#!/usr/bin/env bash
# ============================================================
# AEGIS v6 — Full Development Stack Startup
#
# Starts in order:
#   1. n8n (workflow automation) on port 5678
#   2. AEGIS API server on port 3001
#   3. Vite frontend on port 5173
#
# Usage:
#   cd aegis-v6
#   bash start-dev.sh
# ============================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SERVER_DIR="$SCRIPT_DIR/server"
CLIENT_DIR="$SCRIPT_DIR/client"

# ── Colours ──────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

info()    { echo -e "${CYAN}[AEGIS]${NC} $*"; }
success() { echo -e "${GREEN}[AEGIS]${NC} $*"; }
warn()    { echo -e "${YELLOW}[AEGIS]${NC} $*"; }
error()   { echo -e "${RED}[AEGIS]${NC} $*"; }

# ── Cleanup on exit ──────────────────────────────
N8N_PID="" SERVER_PID="" CLIENT_PID=""
cleanup() {
  echo ""
  info "Shutting down all services..."
  [ -n "$CLIENT_PID" ] && kill "$CLIENT_PID" 2>/dev/null
  [ -n "$SERVER_PID" ] && kill "$SERVER_PID" 2>/dev/null
  [ -n "$N8N_PID"    ] && kill "$N8N_PID"    2>/dev/null
  success "All services stopped."
}
trap cleanup EXIT INT TERM

# ── 1. Start n8n ─────────────────────────────────
info "Starting n8n on port 5678..."

export AEGIS_BACKEND_URL=http://localhost:3001
export N8N_BLOCK_ENV_ACCESS_IN_NODE=false

# Kill any stale n8n processes on port 5678
PID_5678=$(lsof -ti:5678 2>/dev/null || true)
[ -n "$PID_5678" ] && { warn "Killing stale process on :5678 (PID $PID_5678)"; kill "$PID_5678" 2>/dev/null; sleep 1; }

n8n start >> /tmp/n8n-aegis.log 2>&1 &
N8N_PID=$!
info "n8n started (PID $N8N_PID) — waiting for it to be healthy..."

# Wait up to 30 s for n8n /healthz
N8N_UP=false
for i in $(seq 1 30); do
  if curl -s -o /dev/null -w "%{http_code}" http://localhost:5678/healthz 2>/dev/null | grep -q "200"; then
    N8N_UP=true
    break
  fi
  sleep 1
done

if [ "$N8N_UP" = true ]; then
  success "n8n is healthy at http://localhost:5678"
else
  warn "n8n didn't respond within 30 s — server will use fallback cron jobs"
fi

# ── 2. Start AEGIS API server ─────────────────────
info "Starting AEGIS server on port 3001..."

# Kill any stale server process
PID_3001=$(lsof -ti:3001 2>/dev/null || true)
[ -n "$PID_3001" ] && { warn "Killing stale process on :3001 (PID $PID_3001)"; kill "$PID_3001" 2>/dev/null; sleep 1; }

cd "$SERVER_DIR"
npm run dev >> /tmp/aegis-server.log 2>&1 &
SERVER_PID=$!

# Wait up to 15 s for server /api/health
SERVER_UP=false
for i in $(seq 1 15); do
  if curl -s -o /dev/null -w "%{http_code}" http://localhost:3001/api/health 2>/dev/null | grep -q "200"; then
    SERVER_UP=true
    break
  fi
  sleep 1
done

if [ "$SERVER_UP" = true ]; then
  success "AEGIS server is healthy at http://localhost:3001"
else
  warn "Server health check timed out — check /tmp/aegis-server.log"
fi

# ── 3. Start Vite dev client ──────────────────────
info "Starting Vite client on port 5173..."

# Kill any stale client process
PID_5173=$(lsof -ti:5173 2>/dev/null || true)
[ -n "$PID_5173" ] && { warn "Killing stale process on :5173 (PID $PID_5173)"; kill "$PID_5173" 2>/dev/null; sleep 1; }

cd "$CLIENT_DIR"
npm run dev >> /tmp/aegis-client.log 2>&1 &
CLIENT_PID=$!

# Brief wait then check Vite
sleep 4
if curl -s -o /dev/null -w "%{http_code}" http://localhost:5173 2>/dev/null | grep -q "200"; then
  success "Vite client is running at http://localhost:5173"
else
  warn "Vite client didn't respond yet — check /tmp/aegis-client.log"
fi

# ── Summary ───────────────────────────────────────
echo ""
echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}  AEGIS v6 Development Stack Running${NC}"
echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "  n8n UI:       ${CYAN}http://localhost:5678${NC}"
echo -e "  AEGIS API:    ${CYAN}http://localhost:3001/api/health${NC}"
echo -e "  AEGIS UI:     ${CYAN}http://localhost:5173${NC}"
echo -e "  Logs:         /tmp/n8n-aegis.log | /tmp/aegis-server.log | /tmp/aegis-client.log"
echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "  Press ${BOLD}Ctrl+C${NC} to stop all services."
echo ""

# Keep running until interrupted
wait $SERVER_PID
