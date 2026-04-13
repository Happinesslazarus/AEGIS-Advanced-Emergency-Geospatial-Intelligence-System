# AEGIS Backend Service Layer

This document describes the major services in `server/src/services/`. Services sit between route handlers and infrastructure (database, external APIs, cache, LLM providers).

## Auth & Security Services

### `adaptiveMFAService.ts`
Implements NIST SP 800-63B AAL1–3. Selects the required authentication assurance level based on risk score, operator role, and session context. Upgrades to TOTP (AAL2) or hardware key (AAL3) for high-risk operations.

### `anomalyDetectionService.ts`
Login/session anomaly detector returning a 0–100 risk score. Detects: impossible travel (geodesic distance + time delta), new device fingerprint, unusual login hours/days, credential stuffing patterns, brute force, session hijack indicators.

### `deviceTrustService.ts`
Device fingerprint storage and trust management. Operators can mark a device as trusted for 30 days, reducing friction for low-risk logins.

### `ipSecurityService.ts`
IP-level firewall: in-memory allowlist/blocklist synced from `ip_blocklist`/`ip_allowlist` DB tables every 60 seconds. Auto-blocks IPs after 20 failed attempts (1-hour block). Optional geo-restriction per country code.

### `riskAuthService.ts`
Combines anomaly score, device trust, IP reputation, and time-based factors into a 0–100 risk score. Feeds `adaptiveMFAService` to determine required step-up.

### `securityLogger.ts`
Immutable audit trail: writes to `security_events` table (append-only). Captures login, logout, failed auth, password reset, 2FA enrol/use, suspicious access, account lock.

### `securityAlertService.ts`
Sends operator alerts for high-severity events: account lockout, repeated failures, suspicious access detected. Dispatches via email and in-app notification.

### `siemExportService.ts`
Formats security events as CEF (Common Event Format) or OCSF (Open Cybersecurity Schema Framework) for export to Splunk, Elasticsearch, Azure Sentinel, Datadog.

### `zeroTrustSessionService.ts`
Per-request session integrity check. HMAC-binds sessions to user-agent + IP subnet. Computes a "drift score" if request attributes deviate from session baseline; issues challenge at configurable threshold.

### `webauthnAttestationService.ts`
Pure-crypto WebAuthn attestation verifier supporting ES256 (P-256), RS256 (RSA-PKCS1), and EdDSA (Ed25519) algorithms. Does not depend on a hardware attestation CA.

### `hibpService.ts`
Have I Been Pwned integration using k-Anonymity: sends only the first 5 chars of SHA-1 hash to HIBP API. 24-hour in-memory cache. Gracefully degrades if HIBP is unreachable.

## AI & LLM Services

### `llmRouter.ts`
Multi-provider LLM router. Tiers: primary (qwen3:8b), fast (qwen3:4b), specialist (qwen2.5vl:7b), ultrafast (qwen3:1.7b). Cloud fallbacks: Gemini, Groq, OpenRouter, HuggingFace. Per-provider rolling latency tracking (last 20 calls). Token usage log (last 10,000 entries). Streaming support.

### `chatService.ts`
Full chat orchestration: system prompt construction (with `NON_OVERRIDABLE_PREAMBLE` for prompt injection resistance), RAG retrieval, query classification, LLM routing, memory extraction, smart suggestion generation, session token budget enforcement (200,000 tokens default).

### `aiClient.ts`
HTTP client for the Python FastAPI AI engine. Wraps all 10 hazard prediction endpoints. Handles circuit breaker + retry logic.

### `aiAnalysisPipeline.ts`
Server-side pipeline that aggregates results from the AI engine + local heuristics + live sensor data to produce a unified hazard assessment.

### `imageAnalysisService.ts`
Routes uploaded images to the Ollama vision model (qwen2.5vl:7b) for disaster scene analysis: identifies hazard type, severity indicators, visible damage.

### `classifierRouter.ts`
Multi-label incident report classifier. Routes to ML model or LLM depending on confidence threshold. Used to auto-categorise citizen reports.

### `embeddingRouter.ts`
Text embedding generation for RAG. Routes to local embedding model or cloud API. Stores to pgvector for similarity search.

### `ragExpansionService.ts`
Retrieval-Augmented Generation: retrieves relevant context chunks from pgvector based on user query embedding, then prepends to LLM context window.

## Flood & Hazard Services

### `floodPredictionService.ts`
Combines river levels (SEPA), rainfall forecast (OpenWeatherMap → Open-Meteo fallback), and GeoJSON flood extents to predict per-river flood probability and affected area.

### `threatLevelService.ts`
Combines river levels, incident reports, and AI predictions into a regional GREEN/AMBER/RED/CRITICAL threat level. Region-aware escalation thresholds. Broadcasts via Socket.IO when level changes.

### `riverLevelService.ts`
Fetches and caches SEPA river station levels. Provides current levels and 24-hour history for each station.

### `fusionEngine.ts`
Multi-source data fusion: merges sensor readings, weather forecasts, social media signals, and AI predictions into a unified situational awareness score.

### `floodFingerprinting.ts`
Calculates a signature for each flood event based on spatial extent, affected river IDs, and severity. Used for deduplication and historical comparison.

## Infrastructure Services

### `cacheService.ts`
Enterprise cache abstraction: namespace-scoped versioned keys, stale-while-revalidate, LRU eviction (5,000 entries), full Prometheus instrumentation. Redis with in-memory LRU fallback.

### `circuitBreaker.ts`
Three-state fault tolerance (CLOSED → OPEN → HALF_OPEN) wrapping external calls. Configurable failure threshold and reset timeout. Prometheus metrics for state transitions.

### `resilienceLayer.ts`
Combines circuit breaker + bulkhead + retry with exponential backoff + timeout for external API calls.

### `cronJobs.ts`
node-cron scheduler: flood warning ingestion (every 5 min), river levels (every 3 min), threat level recalculation (every 10 min), AI predictions (every 15 min), model drift monitoring (hourly). All jobs record timing + status in `scheduled_jobs` table.

### `socket.ts`
Socket.IO server: JWT auth on connect, Redis-backed per-user rate limiting, community chat with escalation keyword detection, distress beacon broadcasts, online user presence tracking.

### `secretsManager.ts`
Unified secrets abstraction with 5-minute TTL cache. Supports vault backends (HashiCorp Vault, AWS Secrets Manager) with `.env` file fallback for development.

### `featureFlags.ts`
In-memory flag engine with percentage-based rollouts, multi-attribute targeting rules (role, region, userId), A/B test variants with deterministic bucketing via `crypto`, kill switches. DB refresh every 30 seconds.

### `personalizationEngine.ts`
Cross-session citizen memory: extracts and stores key facts from conversations, builds behavior profile, generates smart suggestions based on past interactions. Stores in `citizen_memories` + `citizen_behavior_profiles` tables.

### `evacuationService.ts`
Calculates evacuation routes using PostGIS network analysis. Falls back to client-side Haversine routing when PostGIS road network is unavailable.

## Notification Services

### `notificationService.ts`
Multi-channel dispatcher: initialises SMTP (Nodemailer), Twilio SMS/WhatsApp, Telegram Bot, Web Push (VAPID). Each channel gracefully disabled if credentials absent.

### `emailService.ts`
Transactional email: verification, password reset, alert notifications. Dev mode stores to `dev_emails` DB table (no real sending).

## Data Pipeline

### `dataIngestionService.ts`
Scheduled data fetcher: EA Flood Monitoring, SEPA, Open-Meteo, NASA POWER, NewsAPI, Nominatim. Per-source rate limiting, exponential backoff retry, parameterised queries.

### `regionConfigService.ts`
Runtime region configuration: reads `system_config` table to determine active region, city list, emergency numbers.

### `translationService.ts`
Automatic translation for alert content into user's preferred language. Uses Ollama for translation when available; falls back to LibreTranslate API.

## Observability

### `metrics.ts`
Prometheus counter/gauge/histogram definitions for: auth failures, predictions, circuit breakers, cache hits/misses, cron job timing, distress events, and more. Exposed at `GET /metrics`.

### `logger.ts`
Structured pino logger with request ID propagation. Dev mode: pretty-printed JSON. Production: JSON lines to stdout (collected by Docker logging driver).

### `queryLogger.ts`
PostgreSQL query timing middleware: logs slow queries (> 200ms) with parameterised query text and duration for performance analysis.


Flow:
1. Accept GraphQL requests from the API layer.
2. Build request context.
3. Resolve data from subgraphs and loaders.
4. Return a single federated response.

Depends on:
- Express request/response context
- PostgreSQL data access
- Internal resolvers and loaders in the service

Used by:
- GraphQL gateway routes
- Admin and analytics clients that need aggregated data

### `grpcServices.ts`

What it does:
Defines the internal gRPC contracts and handlers used for fast service-to-service calls.

Flow:
1. Accept gRPC metadata and request payloads.
2. Validate and route the call to the right service handler.
3. Query internal data sources.
4. Return typed responses with status metadata.

Depends on:
- PostgreSQL pool
- Internal report, alert, AI, and analytics handlers

Used by:
- Internal backend services
- High-throughput service calls where JSON HTTP would be slower

### `openApiGenerator.ts`

What it does:
Generates the OpenAPI spec and feeds the documentation UI.

Flow:
1. Read route metadata.
2. Infer schemas and security details.
3. Assemble one OpenAPI document.
4. Serve the spec and docs UI.

Depends on:
- Express route definitions
- Route metadata inside the backend

Used by:
- Swagger UI
- ReDoc
- Client SDK generation

### `readReplicas.ts`

What it does:
Chooses whether a query should go to the primary database or a read replica.

Flow:
1. Inspect query type and consistency requirements.
2. Check replica health and lag.
3. Route reads to healthy replicas.
4. Route writes, transactions, and stale-sensitive reads to the primary.

Depends on:
- PostgreSQL pools
- Replica health and lag tracking in this service

Used by:
- Backend services that need read scaling without stale data surprises

## Frontend Connection

`AdminCrowdDensity.tsx` is included in this pass because it consumes backend spatial data.

Flow:
1. The admin page requests `/api/spatial/density`.
2. If the density endpoint is empty, it falls back to report-derived zones from `/api/reports`.
3. The UI renders cards, charts, and risk labels from that data.

## How To Run

Backend type-check:

	cd server
	npx tsc --noEmit

Client tests:

	cd client
	npx vitest run

## Current Notes

- This pass focused on comment cleanup, stronger typing, and file-level docs.
- The broader repo still has unrelated changes in other files, so later audit passes should stay scoped and avoid mixing concerns.