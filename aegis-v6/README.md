# AEGIS v6 — Developer Guide

## Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Node.js | 20+ | Use nvm or fnm |
| npm | 10+ | bundled with Node |
| PostgreSQL | 16+ | with PostGIS + pgvector extensions |
| Python | 3.11+ | for the AI engine |
| Docker + Compose | latest | optional, for containerised stack |

## Quick Start (Local Development)

```bash
# 1. Clone and install root orchestrator
git clone <repo-url> && cd aegis-v6-fullstack/aegis-v6
npm install

# 2. Set up the database
createdb aegis
psql -d aegis -c "CREATE EXTENSION IF NOT EXISTS postgis; CREATE EXTENSION IF NOT EXISTS \"uuid-ossp\"; CREATE EXTENSION IF NOT EXISTS vector;"
psql -d aegis -f server/sql/fresh_start.sql   # or run migrations individually

# 3. Configure environment variables
cp server/.env.example server/.env
# Edit server/.env — at minimum set DATABASE_URL, JWT_SECRET, REFRESH_TOKEN_SECRET

# 4. Install service dependencies
cd server && npm install && cd ..
cd client && npm install && cd ..
cd ai-engine && pip install -r requirements.txt && cd ..

# 5. Start all services (hot-reload)
npm run dev
```

| Service | URL | Default credentials |
|---|---|---|
| Frontend (Vite HMR) | http://localhost:5173 | — |
| API (Express) | http://localhost:3001 | — |
| AI Engine (FastAPI) | http://localhost:8000 | X-API-Key: `aegis-dev-key` |
| API docs (Swagger) | http://localhost:8000/docs | — |
| Admin login | http://localhost:5173/admin | `admin@aegis.gov.uk` / `AegisAdmin2026!` |

## Architecture

```
client (React/Vite) ──→ server (Express/TS) ──→ PostgreSQL 16 + PostGIS + pgvector
                    ↕               ↕
               Socket.IO     ai-engine (FastAPI/Python)
                                    ↕
                               Ollama (local LLM)
                           + cloud fallbacks (Gemini/Groq)
```

### Service Responsibilities

**`server/`** (Express + TypeScript, port 3001)
- REST API with ~30 route files covering auth, reports, alerts, AI proxy, chat, spatial, river levels, distress, community, admin
- JWT auth with 15-min access tokens + httpOnly refresh rotation
- bcrypt 12 rounds, TOTP 2FA (AES-256-GCM), WebAuthn, HIBP breach check
- Socket.IO real-time: incident updates, community chat, SOS distress
- Region-aware data adapters (Scotland/England/Generic) — swap active region at runtime
- 70+ service modules: LLM routing, flood prediction, anomaly detection, circuit breaker, feature flags, caching, metrics, email, Twilio, Telegram, web push

**`client/`** (React 18 + Vite + TypeScript, port 5173)
- Operator dashboard: command centre, incident queue, AI transparency, community hub, analytics, security dashboard, distress panel
- Citizen portal: 6-step report wizard, SOS beacon, shelter finder, preparedness guide, community chat, multilingual chatbot
- i18n: 9 languages (en, ar, de, es, fr, hi, pt, sw, zh) with RTL support
- WCAG 2.1 AA: 7 accessibility modes (screen reader, high contrast, dyslexia, large text, reduced motion, colour-blind, captions)
- Offline-first with service worker queue and LRU predictive cache
- Dual-token auth: operators use in-memory tokens (XSS-safe), citizens use `localStorage` (trade-off documented in `src/utils/api.ts`)

**`ai-engine/`** (Python 3.11 + FastAPI, port 8000)
- 10 hazard-specific ML predictors: flood, drought, heatwave, wildfire, landslide, severe storm, power outage, water supply, infrastructure damage, public safety
- Each predictor: LSTM time-series + XGBoost spatial + ensemble meta-learner with SHAP explainability
- Falls back to physics-based heuristics when no trained model exists
- Model registry with versioning, governance approval workflow, rollback support
- Drift detection: KS-test + PSI distribution shift on 24-hour rolling window
- LLM routing: Ollama local-first → Gemini / Groq / OpenRouter fallback

## Environment Variables

Copy `server/.env.example` to `server/.env`. Required variables:

| Variable | Description |
|---|---|
| `DATABASE_URL` | `postgresql://user:pass@host:5432/aegis` |
| `JWT_SECRET` | 64+ random hex chars — `openssl rand -hex 64` |
| `REFRESH_TOKEN_SECRET` | Separate 64+ hex — `openssl rand -hex 64` |
| `INTERNAL_API_KEY` | Secret for server→AI-engine calls |
| `TWO_FACTOR_ENCRYPTION_KEY` | 32-byte hex for TOTP secret encryption |

Optional (gracefully disabled if unset):

| Variable | Feature |
|---|---|
| `OLLAMA_BASE_URL` | Local LLM (default: `http://localhost:11434`) |
| `GEMINI_API_KEY` | Cloud LLM fallback |
| `SMTP_HOST/USER/PASS` | Email notifications |
| `TWILIO_ACCOUNT_SID/AUTH_TOKEN` | SMS/WhatsApp |
| `TELEGRAM_BOT_TOKEN` | Telegram alerts |
| `VAPID_PUBLIC_KEY/PRIVATE_KEY` | Web push |
| `REDIS_URL` | Redis cache (falls back to LRU in-memory) |
| `OPENWEATHER_API_KEY` | Weather forecast data |
| `NEWSAPI_KEY` | News ingestion |

## Docker

```bash
# Full stack (dev)
docker compose up

# Production
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

**Security note:** PostgreSQL (5432) and AI engine (8000) ports are bound to `127.0.0.1` only. They are not internet-accessible. Services communicate on the Docker internal network via hostnames (`db`, `ai`, `redis`).

## Database

### Run migrations
```bash
# All migrations in order (recommended)
cd server && npm run db:migrate

# Or manually
psql -d aegis -f sql/fresh_start.sql          # baseline schema
psql -d aegis -f sql/migration_<name>.sql    # individual migration
```

### Backup / Restore
```bash
S3_BUCKET=my-backups ./scripts/dr/db-backup.sh
./scripts/dr/db-restore.sh backups/db/aegis_20260101_020000.sql.gz
./scripts/dr/db-verify-backup.sh backups/db/aegis_20260101_020000.sql.gz
```

## Testing

```bash
# Backend unit + integration tests
cd server && npm test

# Frontend unit tests (Vitest)
cd client && npm test

# Frontend E2E tests (Playwright)
cd client && npx playwright test

# Load tests (requires k6)
k6 run load-tests/full-suite.js
k6 run -e BASE_URL=http://staging:3001 load-tests/full-suite.js
```

## Code Structure

```
server/src/
├── adapters/          Region-specific data fetchers (Scotland, England, Generic)
├── config/            Region + city configuration, startup validators
├── incidents/         10 incident type modules (baseModule + per-type routes)
├── middleware/        auth, errorHandler, upload, rate limiting, idempotency
├── models/            PostgreSQL pool (db.ts)
├── routes/            ~30 route files (authRoutes, reportRoutes, aiRoutes, ...)
├── services/          ~70 service modules (LLM, chat, cache, notifications, ...)
├── sql/               47 migration SQL files + schema + seeds
├── types/             Shared TypeScript type definitions
└── utils/             AppError, securityUtils, logger, fetchWithTimeout

client/src/
├── components/admin/  Operator UI components (CommandCenter, DistressPanel, ...)
├── components/citizen/ Citizen UI (SOSButton, ReportForm, Chatbot, ...)
├── components/shared/ Cross-role (LiveMap, AlertCard, SafeHtml, ...)
├── components/ui/     Design system (Button, Modal, Toast, ...)
├── contexts/          React contexts (Auth, Socket, Alerts, Reports, ...)
├── hooks/             Custom hooks (useDistress, useSocket, useFloodData, ...)
├── pages/             Route-level page components
└── utils/             api.ts (token mgmt), auth.ts, validation, i18n, ...

ai-engine/
├── app/api/           FastAPI route handlers (endpoints.py)
├── app/core/          Config, auth, feature store, model registry, governance
├── app/hazards/       10 hazard predictor classes
├── app/models/        ML wrappers (classifier, severity predictor, image)
├── app/monitoring/    Drift detection, metrics, model monitor
├── app/registry/      Region registry for AI engine
├── app/training/      Training pipeline, model trainer, evaluator, HP tuning
└── scripts/           Training scripts, evaluation utilities
```

## Features

- Citizen incident reporting (6-step wizard, photo upload, GPS location)
- SOS distress beacon with live GPS tracking
- PostGIS spatial queries: buffer analysis, nearest feature, flood risk zones
- SEPA + EA Flood Monitoring live river gauge data
- AI hazard prediction with SHAP explainability and confidence intervals
- Multi-channel alerts: email, SMS, WhatsApp, Telegram, web push
- Real-time community chat with escalation keyword detection
- AI chatbot (local-first Ollama) with 9-language support
- Adaptive MFA (NIST SP 800-63B AAL1–3), WebAuthn passkeys
- Zero-trust session binding with HMAC + drift scoring
- Prometheus + Grafana observability
- WCAG 2.1 AA accessibility (7 modes)
- Offline-first with service worker queue
- CSV/JSON data export
- Feature flags with percentage rollouts and A/B testing

## Author

Happiness Ada Lazarus (2238282) — CM4134 Honours Project — Robert Gordon University  
Supervisor: Shabana Mahmood

