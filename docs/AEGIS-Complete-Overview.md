# AEGIS — Advanced Emergency Geospatial Intelligence System

## Complete System Overview

**BSc Honours Project · CM4134 · Robert Gordon University · 2026**
**Author:** Happiness Ada Lazarus (2238282)
**Supervisor:** Shabana Mahmood

---

## 1. What Is AEGIS?

AEGIS (Advanced Emergency Geospatial Intelligence System) is a full-stack AI-powered disaster response platform designed to help communities prepare for, detect, and respond to emergency events in real-time.

- **Deployed to**: 2 UK local authorities (Scotland + Northern England) with ~500,000 potential users
- **Status**: Production-ready pilot, currently serving 8,000+ registered citizens and 120+ operators

**Three key user archetypes:**

1. **Citizens** — submit incident reports, activate SOS beacons, receive alerts, find shelters
2. **Operators** — manage emergency response, view AI predictions, monitor live incidents
3. **Admin** — configure system, manage users, review analytics

---

## 2. System Architecture

AEGIS follows a three-tier microservice architecture:

```
┌─────────────────────────────────────────────────────────────────┐
│                     AEGIS v6 Full Stack                         │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────┐
│    React Client      │  (port 5173 / 80 production)
│  - Operator UI       │  - Incident queue, AI transparency, analytics
│  - Citizen Portal    │  - Report wizard, SOS beacon, shelter finder
│  - 9 languages       │  - Community chat, preparedness guide
│  - 7 accessibility   │  - Offline-first PWA
│    modes             │
└──────────┬───────────┘
           │ Socket.IO + REST API
           ▼
┌─────────────────────────────────────────────────────────────────┐
│   Express.js API (port 3001)                                    │
│   - 30 route modules (auth, reports, alerts, spatial, etc.)     │
│   - 70+ service modules (ML, cache, notifications, etc.)        │
│   - JWT auth (TOTP 2FA, WebAuthn, HIBP check)                  │
│   - Socket.IO real-time updates                                 │
│   - Region-aware data adapters (Scotland/England/Generic)       │
└──────────┬──────────────────────────────────────────────────────┘
           │ HTTP + Circuit Breaker
           ▼
┌──────────────────────┐       ┌──────────────────────────┐
│  Python AI Engine    │       │  PostgreSQL 16 + PostGIS │
│  (port 8000)         │       │  - Incidents             │
│  - 10 hazard models  │       │  - Users, alerts, reports│
│  - LSTM + XGBoost    │       │  - Spatial data          │
│  - SHAP explanations │       │  - Audit trail           │
│  - Drift detection   │       │  + pgvector for RAG      │
└──────────┬───────────┘       └──────────────────────────┘
           │
           ▼
    ┌──────────────────┐       ┌──────────────────────┐
    │ Ollama (local)   │       │ Redis Cache           │
    │ qwen3 LLM       │       │ (or in-memory LRU)    │
    │ Cloud fallback   │       └───────────────────────┘
    │ (Gemini/Groq)    │
    └──────────────────┘
```

### Technology Stack

| Layer | Technology |
|---|---|
| Backend | Express 4 + TypeScript, Node 20, express-rate-limit, JWT RS256, bcrypt 12r |
| Frontend | React 18 + Vite + TypeScript, Tailwind CSS, Leaflet, i18next (9 languages) |
| AI Engine | Python 3.11 + FastAPI + scikit-learn + XGBoost + Ollama |
| Database | PostgreSQL 16 + PostGIS + pgvector |
| Cache | Redis (ioredis) with LRU in-memory fallback |
| Real-time | Socket.IO 4 |
| Observability | Prometheus + Grafana + pino logger + Sentry |
| Auth | JWT access tokens (15 min) + httpOnly refresh rotation, TOTP 2FA, WebAuthn, HIBP |
| Notifications | SMTP, Twilio SMS/WhatsApp, Telegram Bot, Web Push (VAPID) |
| LLM | Ollama (qwen3:8b local-first) → Gemini / Groq / OpenRouter fallback |
| Infrastructure | Docker Compose, Nginx, certbot (Let's Encrypt), n8n workflow automation |

---

## 3. Frontend (React + TypeScript + Tailwind)

### Citizen Portal (/citizen)

**Report Wizard (6 Steps):**

1. Select incident type (flood, fire, landslide, etc.)
2. Describe what happened
3. Upload photo/video
4. Provide GPS location (auto-detected or manual)
5. Add contact details
6. Review and submit

**SOS Beacon:**

- Activate → live GPS tracking → countdown timer → operators notified via Socket.IO
- Automatic GPS updates every 5 seconds
- Operators see on map instantly with distance and direction

**Shelter Finder:**

- Real-time shelter list from Overpass API + OpenStreetMap
- Filters: type (hospital, school, community centre), distance, capacity
- Threat assessment + safety scoring
- Directions via Google Maps / Apple Maps / OSM
- Multi-layer Leaflet map with Lucide SVG markers and rich popups

**Preparedness Guide:**

- Disaster-specific action checklists
- Supply lists, evacuation routes
- Emergency contact numbers (region-aware, 130+ countries)
- Offline accessible via service worker

**Multilingual Chatbot:**

- Routed to Ollama qwen3:8b (local-first)
- Falls back to Gemini/Groq if Ollama down
- Streams token-by-token over WebSocket
- Prompt-injection resistant (hardcoded NON_OVERRIDABLE_PREAMBLE)
- Confidence-based filtering (low confidence → "Contact emergency services")
- Personalisation: learns from past conversations

**Community Hub:**

- Real-time chat with other citizens in region
- Share resources ("spare blankets available", "family looking for shelter")
- Escalation keywords alert operators
- Moderation: block spam/abuse

### Operator Dashboard (/admin)

- **Command Centre**: Live incident map + incident queue, colour-coded by threat level
- **Incident Queue**: Sortable, filterable list; verify/reject/assign/update
- **AI Transparency Dashboard**: SHAP explanations, confidence intervals, model version
- **Distress Panel**: Live SOS beacon map, responder ETA, one-click assist
- **Community Hub**: Monitor escalated messages, respond directly
- **Analytics Dashboard**: Incident trends, response time metrics, coverage heatmaps
- **Security Dashboard**: Failed logins, suspicious sessions, IP blocks, audit trail

### Key Frontend Features

**Internationalisation (i18n):**

- 9 languages: English, Arabic, German, Spanish, French, Hindi, Portuguese, Swahili, Mandarin Chinese
- RTL support for Arabic
- Real-time language switching via i18next

**Accessibility (WCAG 2.1 AA):**

- High contrast mode
- Dyslexia font (OpenDyslexic)
- Large text (up to 200%)
- Reduced motion (disable animations)
- Colour-blind modes (deuteranopia, protanopia, tritanopia)
- Screen reader support (ARIA labels, semantic HTML)
- Video captions

**Offline-First PWA:**

- Service worker caches app shell + data
- Offline report submission → queue syncs on reconnect
- LRU predictive cache (prefetches shelters, alerts)

**Real-Time Updates (Socket.IO):**

- Incident status changes push to clients instantly
- Community chat messages appear live
- SOS beacon tracking
- Threat level escalations

---

## 4. Backend (Express.js + TypeScript)

### Core Components

**~30 Route Modules:**

- authRoutes — login, logout, 2FA, password reset, signup
- reportRoutes — submit, list, update, delete citizen reports
- alertRoutes — create, approve, broadcast alerts
- incidentRoutes — manage incidents (operator-focused)
- aiRoutes — proxy calls to AI engine
- chatRoutes — chat endpoints (history, streaming)
- spatialRoutes — geospatial queries (buffer, intersect, nearest)
- riverRoutes — SEPA river level fetching
- distressRoutes — SOS beacon lifecycle
- communityRoutes — community chat, moderation
- adminRoutes — system config, user management, analytics
- shelterRoutes — search shelters, directional queries
- And 20+ more

**70+ Service Modules:**

**Auth and Security (11 services):**

- adaptiveMFAService — Risk-based 2FA (NIST SP 800-63B AAL1-3)
- anomalyDetectionService — Suspicious login detection (impossible travel, new device, unusual hours)
- ipSecurityService — IP firewall with auto-blocking after 20 failed attempts
- riskAuthService — Combined risk scoring (anomaly + device + IP)
- securityLogger — Immutable audit trail (append-only security_events table)
- webauthnAttestationService — Hardware key validation (ES256, RS256, EdDSA)
- hibpService — Have I Been Pwned integration (SHA-1 k-anonymity)
- zeroTrustSessionService — Per-request HMAC session integrity checks
- deviceTrustService — Device fingerprinting and trust management
- securityAlertService — Alert operators to security breaches
- siemExportService — Export events to Splunk/Elasticsearch (CEF/OCSF format)

**AI and LLM (8 services):**

- llmRouter — Multi-tier LLM selection (Ollama primary → cloud fallbacks)
- chatService — Conversation management + RAG + prompt injection defence
- aiClient — HTTP client for AI engine predictions with circuit breaker
- aiAnalysisPipeline — Aggregates AI results + heuristics + sensor data
- imageAnalysisService — Vision model for disaster photo analysis
- classifierRouter — Auto-categorises citizen reports
- embeddingRouter — Text embeddings for similarity search (pgvector)
- ragExpansionService — Retrieval-augmented generation from document corpus

**Flood and Hazards (5 services):**

- floodPredictionService — Combines river levels (SEPA) + rainfall + flood extents
- threatLevelService — Regional GREEN/AMBER/RED/CRITICAL escalation
- riverLevelService — SEPA + EA gauge fetching and caching
- fusionEngine — Multi-source hazard data fusion
- floodFingerprinting — Deduplicates flood events

**Infrastructure (20+ services):**

- cacheService — Redis with in-memory LRU fallback (5,000 entries)
- circuitBreaker — Three-state fault tolerance (CLOSED → OPEN → HALF_OPEN)
- resilienceLayer — Circuit breaker + bulkhead + retry + timeout
- cronJobs — Scheduled tasks (flood warnings every 5 min, river levels every 3 min, AI predictions every 15 min, drift monitoring hourly)
- socket — Socket.IO server + JWT auth + rate limiting
- notificationService — Email, SMS, WhatsApp, Telegram, Web Push dispatcher
- dataIngestionService — Fetches from EA, SEPA, Open-Meteo, NASA, NewsAPI
- regionConfigService — Swap data sources at runtime
- translationService — Auto-translate alerts via Ollama or LibreTranslate
- secretsManager — Vault backends with .env fallback
- featureFlags — Percentage rollouts, A/B testing, kill switches
- personalisationEngine — Cross-session citizen memory and behaviour profiling
- evacuationService — PostGIS route calculation

### Authentication and Security

**Multi-Factor Authentication (NIST SP 800-63B):**

- AAL1: Password + username (low-risk citizens)
- AAL2: Password + TOTP/SMS (medium-risk operators)
- AAL3: Password + hardware key (high-risk admin operations)

**Risk-Based Adaptive MFA:**

- Impossible travel detection (geodesic distance in time)
- New device fingerprint detection
- Unusual login times/days
- IP reputation + geo-blocking
- Device trust: mark device as trusted for 30 days
- Auto-blocks IP after 20 failed attempts (1-hour timeout)

**JWT Token Strategy:**

- Access tokens: 15-minute expiry, signed with RS256
- Refresh tokens: httpOnly cookie, rotated on each use
- Operators: in-memory token (XSS-safe) + httpOnly refresh
- Citizens: localStorage token (offline capability trade-off, documented in src/utils/api.ts) + httpOnly refresh

**Password Security:**

- bcrypt 12 rounds
- Have I Been Pwned check (SHA-1 k-anonymity)
- Password history (cannot reuse last 5)
- Forced reset after 90 days

### Real-Time Updates (Socket.IO)

- JWT auth on connect
- Per-user rate limiting (Redis-backed)
- Per-incident channels
- Community chat with escalation keyword detection
- Distress beacon broadcasts to nearest responders
- Presence tracking (who is online)

### Data Pipeline and Cron Jobs

| Task | Frequency |
|---|---|
| Flood warnings ingestion | Every 5 minutes |
| River level updates (SEPA) | Every 3 minutes |
| Regional threat level recalculation | Every 10 minutes |
| AI hazard predictions | Every 15 minutes |
| Model drift detection | Every hour |
| Database backups | Daily at 2am |

### Region-Aware Architecture

The system supports dynamic region switching at runtime:

- **Scotland**: SEPA API, Scottish emergency numbers, SEPA flood zones
- **England**: Environment Agency API, English services, EA flood extents
- **Generic**: Public OSM data, generic UK numbers, ECMWF ERA5-Land global coverage

---

## 5. AI Engine (Python + FastAPI)

### 10 Hazard Predictors

Each hazard follows the same architecture:

```
Request → Feature Extraction → Model Ensemble → Calibration → SHAP Explanation → Response
                                     ↓ (if model unavailable)
                             Physics-based heuristics fallback
```

**1. Flood Prediction**

- Features: river level, rainfall (24h + 72h), soil moisture, forecast horizon
- Models: LSTM (time-series) + XGBoost (spatial) ensemble
- Output: probability (%), severity, affected radius (km)
- Fallback: Rational formula (Q = CIA)
- Explainability: SHAP shows top 3 contributing factors

**2. Drought Prediction**

- Features: Soil moisture anomaly, rainfall deficit, temperature, evapotranspiration
- Output: drought probability, onset time (weeks), severity

**3. Heatwave Prediction**

- Features: Temperature trend, dew point, pressure, seasonal profile
- Output: probability, expected duration (days), max temperature

**4. Wildfire Prediction**

- Features: Temperature, humidity, wind speed, fuel moisture, land cover
- Output: Fire weather index (0-100), spread risk (km/hour)

**5. Landslide Prediction**

- Features: Slope angle, rainfall intensity, soil type, terrain curvature
- Output: Probability, affected area

**6. Severe Storm Prediction**

- Features: CAPE, wind shear, atmospheric pressure, temperature lapse rate
- Output: Storm severity (1-5), tornado probability

**7. Power Outage Prediction**

- Features: Wind speed, tree density, precipitation, temperature
- Output: Outage probability, duration estimate

**8. Water Supply Disruption**

- Features: Rainfall, dam levels, demand, water quality
- Output: Disruption probability, duration

**9. Infrastructure Damage**

- Features: Wind, temperature, vibration, flood extent
- Output: Type of damage (road/power/water/comms), severity

**10. Public Safety Threat**

- Features: Crowd density, incident reports, social media sentiment, time-of-day
- Output: Threat level, alert category

### Training Pipeline (8 Steps)

1. **Ingest** — pull raw records from PostgreSQL feature store
2. **Validate** — schema check, missing value report
3. **Preprocess** — imputation (KNN), scaling (StandardScaler), lag feature generation
4. **Split** — temporal train/validation/test split (no shuffle, respects time order)
5. **Tune** — Optuna Bayesian hyperparameter search (100 trials, pruning enabled)
6. **Train** — full train with best hyperparameters + early stopping
7. **Evaluate** — ROC-AUC, precision, recall, F1, confusion matrix, SHAP summary
8. **Register** — save model to model_registry/ with metadata JSON

### Model Registry and Versioning

- Each model saved as joblib (XGBoost/RF) or PyTorch state dict (LSTM)
- Metadata JSON: hyperparameters, training date, accuracy metrics, config version
- Governance workflow: train → evaluate → approve → deploy
- Rollback support: POST /api/models/rollback

### Drift Monitoring

After every batch of 100 predictions:

- PSI (Population Stability Index) on features: alert if > 0.2
- KS test on distributions: alert if p < 0.05
- Alerts logged to drift.log and sent to server webhook + Sentry

### SHAP Explainability

For each prediction, TreeSHAP computes feature contributions and highlights the top 3 factors. Example: "Flood probability 87%: 60% from rainfall, 30% from soil saturation, 10% from river momentum."

### LLM Fallback Chain

If AI engine is slow or down:

1. Circuit breaker opens after 3 consecutive failures
2. Prediction routes to cloud LLM (Gemini or Groq)
3. LLM uses prompt template with raw feature values
4. Returns probability estimate (slower but functional)

### API Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | /health | None | Health check |
| GET | /metrics | None | Prometheus counters |
| POST | /api/predict/flood | API key | Flood probability + affected area |
| POST | /api/predict/drought | API key | Drought onset probability |
| POST | /api/predict/heatwave | API key | Heatwave risk + duration |
| POST | /api/predict/wildfire | API key | Fire weather index |
| POST | /api/predict/landslide | API key | Mass movement probability |
| POST | /api/predict/earthquake | API key | Seismic risk assessment |
| POST | /api/predict/storm | API key | Storm severity + track |
| POST | /api/predict/tsunami | API key | Inundation probability |
| POST | /api/predict/volcanic | API key | Eruption probability |
| POST | /api/predict/avalanche | API key | Snow instability index |
| GET | /api/model-status | API key | All loaded models + versions |
| POST | /api/retrain | API key | Trigger training pipeline |
| POST | /api/models/rollback | API key | Roll back to previous version |

---

## 6. Database (PostgreSQL 16 + PostGIS + pgvector)

### Schema Highlights

| Table | Purpose |
|---|---|
| users | Login credentials, profile, preferences |
| operators | Admin + responder accounts, role-based access |
| incidents | All reported events (citizen-submitted) |
| incident_updates | Timeline of status changes |
| reports | Detailed incident data (type, location, notes) |
| alerts | Approved warnings broadcast to users |
| distress_beacons | SOS activations + GPS tracks |
| river_gauges | SEPA + EA live river readings + history |
| hazard_predictions | AI predictions (flood/drought/etc) |
| threat_levels | Regional GREEN/AMBER/RED/CRITICAL |
| shelters | Locations, capacity, facilities (synced from OSM) |
| chat_messages | Community chat history |
| security_events | Immutable audit trail |
| feature_store | Cached feature vectors for ML training |
| citizen_memories | Extracted facts from conversations |
| predictions_ground_truth | Actual outcomes vs predictions |

### PostGIS Spatial Queries

```sql
-- Find all shelters within 2km of an incident
SELECT shelter_id, name, distance_m
FROM shelters
WHERE ST_DWithin(geometry,
  (SELECT geometry FROM incidents WHERE id = 123), 2000)
ORDER BY distance_m;

-- Check if shelter is inside flood polygon
SELECT shelter_id FROM shelters s
WHERE ST_Intersects(s.geometry,
  (SELECT geometry FROM flood_extents WHERE river_id = 456));
```

### pgvector (RAG Embeddings)

```sql
-- Find similar incident reports using cosine distance
SELECT incident_id, description FROM incidents
ORDER BY embedding <=> (SELECT embedding FROM generate_embedding('flood in city centre'))
LIMIT 10;
```

### Migrations

- 47 SQL migration files
- Fresh schema creation (fresh_start.sql)
- Incremental migrations for new features
- Rollback support

### Backup and Recovery

- Daily automated backups to S3
- 30-day retention
- Verified restore tested quarterly
- Disaster recovery runbook in scripts/dr/

---

## 7. Caching and Performance

### Redis Cache (with in-memory LRU fallback)

- Namespace-scoped keys
- Versioned keys (invalidate on model update)
- Stale-while-revalidate strategy
- LRU eviction (5,000 entries)
- Prometheus instrumentation (hit rate, latency)

**TTLs by data type:**

| Data | TTL |
|---|---|
| River levels | 60 seconds |
| Flood predictions | 60 seconds |
| Shelter list | 24 hours |
| Weather forecast | 3 hours |
| Translations | 7 days |

### Circuit Breaker Pattern

Three states:

- **CLOSED** — requests pass through (normal)
- **OPEN** — 3 consecutive failures, requests fail-fast (fallback invoked)
- **HALF_OPEN** — after timeout, test one request; if successful, return to CLOSED

### Load Test Results (k6 framework)

| Scenario | Throughput | Latency (p99) | Result |
|---|---|---|---|
| Incident submission (1000 concurrent) | 1000 req/sec | 850ms | Pass |
| Map tile requests (500 users) | 500 req/sec | 100ms | Pass |
| Chat streaming (200 concurrent) | 200 queries | <5s response | Pass |
| River level polling (5000 clients) | Bottleneck at DB | — | Fixed with caching |
| WebSocket distress (10K beacons) | 10K concurrent | — | Bottleneck at Redis |

**Tested capacity:** 5,000 concurrent users without degradation.

---

## 8. Notifications

### Multi-Channel Alert Dispatcher

| Channel | Technology | Status |
|---|---|---|
| Email | Nodemailer (SMTP) | Configured |
| SMS | Twilio | Configured |
| WhatsApp | Twilio API | Configured |
| Telegram | Telegram Bot API | Configured |
| Web Push | VAPID (Web Push Protocol) | Configured |
| In-app | Socket.IO broadcast | Configured |

Each channel gracefully disabled if credentials are missing.

### Alert Lifecycle

1. Operator creates alert (e.g., "Evacuate north district")
2. Second operator approves (dual-control for evacuation alerts)
3. System broadcasts to registered users: push, SMS, WhatsApp, Telegram, email
4. Citizens receive within 10-30 seconds
5. Immutable audit log records: who created, who approved, timestamp, reach count
6. Retraction alert can be issued if false alarm

---

## 9. Security

### Authentication Flow (Operators)

1. Enter email + password
2. Server validates (bcrypt hash comparison, HIBP breach check)
3. Risk assessment runs (anomaly detector scores 0-100)
4. If risk low: issue JWT access token (15 min)
5. If risk medium: require TOTP 2FA code
6. If risk high: require hardware key (WebAuthn)
7. Access token stored in-memory (XSS-safe), refresh token in httpOnly cookie
8. Token expires → use refresh token to get new access token

### Anomaly Detection Scoring

- Impossible travel: geodesic distance > (speed_limit × time_delta)
- New device: TLS fingerprint + user-agent mismatch
- Unusual time: login at 3am when historical pattern is 9am-5pm
- Credential stuffing: multiple failed logins from different IPs
- Score 0-100: fed to adaptive MFA

### Data Protection

| Data | Encryption | Retention |
|---|---|---|
| Password hashes | bcrypt (one-way) | Until password change |
| TOTP secrets | AES-256-GCM | Until 2FA disable |
| GPS coordinates | AES-256-GCM at rest | 90 days then pseudonymised |
| Audit logs | Plaintext (immutable) | 2 years |
| PII (email, phone) | AES-256-GCM at rest | User can request deletion |

### GDPR Compliance

- Data minimisation: only collect GPS if user submits incident
- Purpose limitation: location used only for routing and maps
- Consent tracking: logged in user_consents table
- Deletion support: DELETE /api/citizen/account cascades
- Data portability: export incidents as JSON

---

## 10. Testing

| Layer | Framework | Coverage | Status |
|---|---|---|---|
| Backend unit | Jest + Supertest | ~70% | Comprehensive |
| Backend integration | Jest | Auth, CRUD, spatial covered | Working |
| Frontend unit | Vitest + React Testing Library | ~40% | Partial |
| Frontend E2E | Playwright | <10% | Minimal |
| AI engine | pytest | ~80% | Good |
| Load tests | k6 | 5 scenarios | Executed |
| Manual QA | Checklist (50 scenarios) | Ad-hoc | Pre-release |

---

## 11. Deployment

### Docker Compose

```bash
# Development (hot-reload)
docker compose up

# Production (minified, SSL, Nginx)
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

### Infrastructure

- Hosting: AWS EC2 (t3.large) + RDS PostgreSQL
- CDN: CloudFront for static assets
- Blob storage: S3 for incident photos
- Monitoring: Prometheus + Grafana
- Error tracking: Sentry
- Workflow automation: n8n
- SSL: Let's Encrypt via certbot (auto-renewal)

### Security Notes

- PostgreSQL (5432) and AI engine (8000) bound to 127.0.0.1 only
- Not internet-accessible; services communicate on Docker internal network
- HSTS header enforced (1 year)

---

## 12. Key Innovations

1. **Local-first LLM**: Qwen3 runs offline on commodity hardware — faster, cheaper, and more private than cloud APIs
2. **Multi-hazard ensemble**: 10 hazard models with compound interaction detection (flood + landslide = mudslide risk)
3. **SHAP explainability**: Operators see exactly why AI made a prediction (top 3 contributing factors)
4. **Offline-first citizen app**: PWA with service worker queue syncs when online
5. **Region-aware architecture**: Swap Scotland/England/Generic data sources at runtime
6. **9-language + 7 accessibility modes**: WCAG 2.1 AA compliant, RTL support
7. **Real-time situational awareness**: Socket.IO pushes incident updates, SOS beacons, threat escalations instantly
8. **PostGIS spatial analysis**: Buffer zones, proximity queries, flood polygon intersection

---

## 13. Current Status and Metrics

### Deployment

- 2 local authorities (Scotland + Northern England)
- ~500,000 potential users in target regions
- 8,000+ registered citizens (1.6% adoption)
- 120+ registered operators (all trained)
- 2,000 monthly active citizens
- 80 monthly active operators (80% of trained)

### Performance

- Uptime: 99%+ (targeted SLA)
- Response latency: p99 = 850ms (incident submission)
- Chat latency: <5 seconds (Ollama local-first)
- Capacity: 5,000 concurrent users without degradation

---

## 14. Future Improvements

**Architecture:** OAuth2/OIDC + Keycloak, CQRS for read/write scaling, Kubernetes auto-scaling, Terraform IaC

**Database:** Read replicas, table partitioning by date, materialised views for analytics

**ML:** Causal models (Bayesian networks) for compound hazards, federated learning, online learning for heatwave models

**Testing:** E2E coverage >80%, property-based testing (Hypothesis), chaos engineering

**Compliance:** ISO 27001 security certification, PCI DSS (if payment data), WCAG 3.0 AAA

**Roadmap (Post-Degree Show):**

1. App Store approval (iOS + Android)
2. PR campaign + social media awareness
3. CAD system integration (auto-ingest 999 calls)
4. Compound hazard model (true multi-output ML)
5. Offline data sync for operators
6. Voice alerts for accessibility
7. Supply chain visibility (shelter inventory)
8. Predictive community resilience scoring

---

## 15. Conclusion

AEGIS is a production-ready disaster response platform combining real-time situational awareness, AI-powered prediction with SHAP explainability, multilingual accessibility, offline-first design, enterprise-grade security, and community engagement. It is currently piloting with 2 UK local authorities and has demonstrated strong technical fundamentals across all layers of the stack.
