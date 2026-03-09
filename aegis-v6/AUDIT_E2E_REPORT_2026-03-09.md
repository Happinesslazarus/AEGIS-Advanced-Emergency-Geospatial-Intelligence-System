# AEGIS End-to-End Audit Report (2026-03-09)

## Scope
- Hardcoded values and unsafe assumptions
- Integration pathways (frontend/backend/db/sockets/AI/n8n)
- Multi-incident architecture readiness
- AI pipeline honesty (declared vs actually wired/runnable)
- Runtime operational checks with evidence

## Evidence Snapshot
- `GET /api/health` → **200**
- `GET /api/internal/health/system` → **200**
  - `database.ok=true`
  - `ai_engine.ok=true`
  - `n8n.status=not_configured`, `n8n.fallback_active=true`, `n8n.healthy=true` (healthy-by-fallback behavior)
- `GET /api/config/incidents` → **200**, **10 incident types** returned
- `GET http://localhost:8000/health` (AI engine) → **200**, `models_loaded=4`
- `GET http://localhost:8000/api/hazard-types` → **200** (flood/drought/heatwave enabled)
- Socket E2E script (`test-socket-messaging.js`) run with fresh generated admin/citizen accounts → **Passed 3/3**

## Fixes Applied in This Pass

### 1) Removed/Reduced hardcoded regional assumptions
- `server/src/routes/reportRoutes.ts`
  - Replaced Scotland bounding-box checks with active-region derived bounds using `getActiveCityRegion()`.
- `server/src/routes/dataRoutes.ts`
  - `GET /api/weather/current` now defaults to active-region center instead of hardcoded Glasgow coords.
- `server/src/routes/internalRoutes.ts`
  - n8n-ingested alert fallback location now uses `activeRegion.name` instead of hardcoded `Scotland`.
- `client/src/components/admin/SystemHealthPanel.tsx`
  - Removed hardcoded absolute API URL (`http://localhost:3001`), now uses relative `/api/internal/health/system`.

### 2) Socket script hardening + reliability
- `test-socket-messaging.js`
  - Removed default plaintext passwords; now requires `ADMIN_PASSWORD` and `CITIZEN_PASSWORD` env vars.
  - Added startup credential validation with explicit error output.
  - Normalized success/failure completion logs to plain deterministic output.

## AI Pipeline Honesty Audit

### What is genuinely wired and operational
- Node backend uses `server/src/services/aiClient.ts` to call FastAPI AI engine:
  - `/api/predict`
  - `/api/model-status`
  - `/api/hazard-types`
  - `/api/retrain`
  - `/api/classify-report`
  - `/api/predict-severity`
  - `/api/detect-fake`
- FastAPI engine (`ai-engine/main.py`, `ai-engine/app/api/endpoints.py`) is live and exposes these endpoints.
- Runtime confirms 4 loaded models and available hazard modules (flood/drought/heatwave).

### Important caveats / truth constraints
- Wildfire prediction path in AI engine still returns 501 (declared but not implemented as predictive module).
- Model status currently includes duplicate flood model names (two versions present); this is valid for registry history but can look misleading unless active-version semantics are explicit in UI.
- n8n “healthy” can be true while `status=not_configured` because fallback mode is treated as healthy operationally.

## Incident Architecture Status

### Completed foundations
- Incident-type registry and admin upsert APIs already in place from prior pass:
  - `server/src/config/incidentTypes.ts`
  - `server/src/routes/configRoutes.ts`
- Runtime evidence confirms 10 practical incident types are available via config endpoint.

### Remaining gaps (not fully refactored yet)
- Some domain flows still remain hazard/flood-shaped by naming or specialized route/service structure (e.g., dedicated flood routes).
- Full per-incident schema enforcement across all analytics/AI/alert pathways is not yet complete end-to-end.

## Security/Config Risk Notes (Current)
- Reduced hardcoded assumptions in key runtime paths, but repository-wide scan still shows environment-sensitive defaults and dev-oriented assumptions in other files.
- Recommend a follow-up hardening pass to enforce strict env validation and remove legacy fallback literals in non-critical modules.

## Final Operational Assessment
- **Current state:** System is operational for core flows (API, DB, AI engine, incident config, realtime sockets).
- **n8n state:** Not configured, but fallback cron mode is active and reflected in health telemetry.
- **Readiness:** Strongly improved; platform is functional and more region-configurable, with remaining work concentrated in deeper cross-module incident generalization and broader secret/default hardening.

## Next High-Value Actions
1. Refactor flood-specialized route/service names into generic incident pipelines where applicable.
2. Add strict startup validation for all sensitive env vars in production mode.
3. Expose explicit `active_model_version` semantics in AI status UI to avoid ambiguity with multi-version entries.
4. Add one consolidated audit endpoint returning “capability truth table” for AI models and incident handlers.
