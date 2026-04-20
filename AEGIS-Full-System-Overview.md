# AEGIS — Advanced Emergency Geospatial Intelligence System

## Complete System Overview (for review/discussion without needing to open the app)

**Author:** Happiness Ada Lazarus (2238282)  
**Programme:** CM4134 Honours Project, Robert Gordon University  
**Development period:** ~3.5 months, working ~14 hrs/day, ~26 days/month (~1,274 total hours)  
**Codebase size:** ~272,000 lines across ~794 files  
**Branch:** main | **Last clean commit:** e86d5c6  

---

## 1. WHAT IS AEGIS?

AEGIS is an AI-powered multi-hazard disaster management platform that:
- Lets **citizens** report emergencies, receive alerts, find shelters, chat with an AI chatbot, and send SOS distress signals
- Lets **operators/admins** manage incidents, broadcast alerts, view AI predictions, monitor system health, and coordinate emergency response
- Uses **machine learning** to predict 11 types of natural/infrastructure hazards using real-time data from government APIs (EA Flood Monitoring, SEPA, Open-Meteo, NASA POWER)
- Shows everything on **real-time maps** with flood zones, river levels, and threat overlays
- Focused on **Scotland** as the primary deployment region, expandable to UK-wide

---

## 2. TECH STACK

### Backend (Server)
| Layer | Technology |
|---|---|
| Runtime | Node.js 20+ with TypeScript 5.3 |
| Framework | Express 4.18 |
| Database | PostgreSQL 16 with PostGIS (spatial) + pgvector (embeddings) |
| Cache | Redis 7 (ioredis) |
| Real-time | Socket.IO 4.8 |
| Auth | JWT + bcrypt + Passport (Google/GitHub OAuth) |
| Validation | Zod |
| Logging | Pino |
| Metrics | Prometheus (prom-client) |
| Email | Nodemailer |
| SMS | Twilio |
| Push | web-push |
| OCR | Tesseract.js |
| Error tracking | Sentry |

### Frontend (Client)
| Layer | Technology |
|---|---|
| Framework | React 18 + TypeScript 5.3 |
| Build | Vite 5 |
| Styling | TailwindCSS 3.4 |
| Routing | React Router 6 |
| Data fetching | TanStack React Query 5 |
| Maps | Leaflet + MapLibre GL + deck.gl |
| Animations | Framer Motion |
| i18n | i18next (9 languages) |
| Testing | Vitest + Playwright |
| Accessibility | axe-core/react |
| Error tracking | Sentry |

### AI Engine (Python)
| Layer | Technology |
|---|---|
| Framework | FastAPI + Uvicorn |
| ML Traditional | scikit-learn, XGBoost, LightGBM, CatBoost |
| ML Deep | TensorFlow, PyTorch |
| NLP | HuggingFace Transformers |
| Forecasting | Prophet |
| Explainability | SHAP, LIME |
| Drift detection | Evidently |
| Experiment tracking | MLflow, WandB |
| Hyperparameter tuning | Optuna |
| Geospatial | GeoPandas, Rasterio, xarray |
| Vision | open-clip-torch |
| Speech | faster-whisper |

### Infrastructure (Docker)
| Service | Purpose |
|---|---|
| PostgreSQL 16 (PostGIS + pgvector) | Primary database |
| Redis 7 | Distributed cache |
| Prometheus | Metrics collection |
| Alertmanager | Alert routing |
| Grafana | Dashboards |
| Nginx | Client static file serving |

---

## 3. SYSTEM ARCHITECTURE

```
┌─────────────────────────────────────────────────────────────┐
│                     CITIZENS (Browser)                       │
│  Report Form → SOS Beacon → Shelter Finder → AI Chatbot     │
│  Community Chat → Alert Feed → Preparedness Guide            │
└───────────────────────┬─────────────────────────────────────┘
                        │ HTTPS + WebSocket (Socket.IO)
┌───────────────────────▼─────────────────────────────────────┐
│                   EXPRESS SERVER (Node.js)                    │
│                                                              │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐   │
│  │ 36 Route │  │ 68 Svc   │  │ Resilience│  │ Real-time│   │
│  │  Files   │  │  Files   │  │  Layer    │  │ Socket.IO│   │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘   │
│                                                              │
│  Auth │ Reports │ Alerts │ Chat │ Flood │ AI Proxy │ Data   │
└──────┬──────────────┬───────────────┬───────────────────────┘
       │              │               │
  ┌────▼────┐   ┌─────▼─────┐   ┌────▼──────────┐
  │PostgreSQL│   │   Redis   │   │  AI ENGINE    │
  │ PostGIS  │   │   Cache   │   │  (FastAPI)    │
  │ pgvector │   │           │   │  11 Hazard    │
  │ ~70 tbls │   └───────────┘   │  Classifiers  │
  └──────────┘                   │  SHAP/LIME    │
                                 └───────────────┘
                                        │
                            ┌───────────▼───────────┐
                            │  EXTERNAL DATA APIS   │
                            │  EA Flood Monitoring   │
                            │  SEPA River Levels     │
                            │  Open-Meteo Weather    │
                            │  NASA POWER            │
                            │  OpenRouteService      │
                            └───────────────────────┘
```

---

## 4. WHAT EACH PART DOES

### 4A. CITIZEN-FACING FEATURES

| Feature | What it does |
|---|---|
| **6-Step Report Wizard** | Citizens submit emergency reports with location (GPS/map pin), category, severity, photos, and description. Goes through: Type → Location → Details → Media → Review → Submit |
| **SOS Distress Beacon** | One-tap emergency button that sends GPS coordinates + timestamp to all online operators via Socket.IO. Operators see it flash in their distress panel |
| **AI Chatbot** | Conversational assistant that answers emergency questions using RAG (retrieval-augmented generation). Can check weather, find shelters, look up active alerts, and analyze uploaded images. Routes to specialist agents (crisis responder, trauma support, preparedness coach) based on detected intent |
| **Shelter Finder** | Shows nearby shelters/evacuation centres on a map with directions, capacity, and real-time availability |
| **Community Chat** | Real-time chat rooms where citizens can share info, request help, and coordinate during disasters |
| **Alert Feed** | Live stream of operator-broadcast alerts with severity levels and affected areas |
| **Preparedness Guide** | Educational content on emergency preparedness for different hazard types |
| **Safety Check-In** | Citizens can mark themselves as "safe" during incidents so family/friends can see |
| **Family Check-In** | Track family member safety status during emergencies |
| **Risk Assessment** | Personal risk score based on location, nearby hazards, and historical patterns |

### 4B. OPERATOR/ADMIN FEATURES

| Feature | What it does |
|---|---|
| **Command Center** | Central dashboard showing active incidents, resource status, and live map |
| **Incident Queue** | Incoming citizen reports triaged by AI severity prediction. Operators verify, escalate, or resolve |
| **Alert Broadcasting** | Create and send alerts to citizens via push notification, email, SMS, and in-app |
| **AI Transparency Console** | Shows what the AI predicted, why (SHAP explanations), confidence level, and allows human override |
| **Analytics Dashboard** | Charts/graphs of incident trends, response times, prediction accuracy |
| **Security Dashboard** | Login attempts, device tracking, IP monitoring, 2FA status |
| **User Management** | Create/manage operator accounts with role-based access (admin, operator, viewer) |
| **System Health Panel** | Server uptime, database status, cache hit rates, AI engine health |
| **Live Operations Map** | Real-time map with all incidents, flood zones, river gauges, deployed resources |
| **Distress Panel** | Live feed of SOS beacon activations with citizen location |
| **Community Hub (Admin)** | Moderate community posts, ban/mute users, manage guidelines |
| **All Reports Manager** | Search, filter, export all citizen reports |
| **Activity/Audit Log** | Every operator action logged with timestamp, IP, and before/after state |

### 4C. AI ENGINE (Python)

| Component | What it does |
|---|---|
| **11 Hazard Classifiers** | Each hazard type (flood, drought, heatwave, wildfire, etc.) has its own trained model. Uses LSTM, XGBoost, LightGBM, CatBoost, RandomForest, or ensemble depending on hazard |
| **Training Pipeline** | Automated pipeline: data loading → feature engineering → hyperparameter tuning (Optuna) → model training → evaluation → SHAP explainability → model registry |
| **Feature Engineering** | 28 features: 11 static (elevation, basin slope, soil type...) + 13 dynamic (rainfall at multiple windows, river levels, soil moisture...) + 4 climate macro (ENSO, seasonal anomaly...) |
| **Data Fetchers** | 11 scripts that pull real data from government/scientific APIs (Open-Meteo, EMDAT, GRDC, IBTrACS, OpenAQ, SPEI...) |
| **Model Registry** | Versioned model storage with semantic versioning (e.g. flood-scotland-v1.2.3). Auto-loads latest approved model |
| **Drift Detection** | Monitors if incoming data distribution shifts from training data using KS test, PSI, and JS divergence. Auto-triggers retraining if drift exceeds threshold |
| **Image Classifier** | CLIP-based image analysis for uploaded photos — classifies crisis type and severity |
| **Fake Detection** | Detects potentially false/misleading reports using NLP |
| **Report Classification** | Auto-categorizes incoming text reports by hazard type |
| **Severity Prediction** | Predicts severity level (1-5) from report content |
| **Explainability** | SHAP and LIME explanations for every prediction, shown in the AI Transparency Console |

### 4D. REAL-TIME DATA PIPELINE

| Step | What happens |
|---|---|
| 1. **Ingestion** | `cronJobs.ts` triggers `dataIngestionService.ts` every 5-15 minutes to fetch latest data from EA Flood Monitoring, SEPA, Open-Meteo, NASA POWER |
| 2. **Normalisation** | Raw API responses are normalised into a consistent schema and stored in PostgreSQL |
| 3. **Fusion** | `fusionEngine.ts` combines 10 data sources (water levels, rainfall, soil moisture, citizen reports, satellite data...) into a single flood probability score per area |
| 4. **Prediction** | Fused data is sent to the AI Engine for hazard prediction via HTTP. AI returns probability, severity, confidence, and SHAP explanation |
| 5. **Alerting** | If prediction exceeds threshold, operators are notified. They can verify and broadcast alerts to citizens |
| 6. **Display** | Results shown on maps, dashboards, and fed into the chatbot's live context |

---

## 5. DATABASE STRUCTURE (~70 tables)

### Core Tables
| Table | Purpose |
|---|---|
| `operators` | Admin/operator accounts (role: admin, operator, viewer) |
| `citizens` | Citizen accounts (separate from operators) |
| `reports` | Emergency reports with PostGIS geometry |
| `alerts` | Broadcast alerts with severity and affected area |
| `incidents` | Tracked incidents (may combine multiple reports) |
| `flood_zones` | Flood zone polygons from SEPA/EA |
| `activity_log` | Operator action audit trail |

### AI Tables
| Table | Purpose |
|---|---|
| `ai_predictions` | Every AI prediction with input, output, and confidence |
| `ai_models` | Model registry (name, version, accuracy, status) |
| `model_drift_metrics` | Distribution shift measurements |
| `training_jobs` | Training run history |
| `fusion_computations` | Multi-source fusion results |
| `image_analyses` | Image classification results |

### Citizen Engagement
| Table | Purpose |
|---|---|
| `citizen_preferences` | Language, notification preferences, accessibility settings |
| `citizen_chat_memory` | Cross-session chatbot memory |
| `safety_check_ins` | "I'm safe" check-in records |
| `emergency_contacts` | Citizen emergency contact list |
| `alert_subscriptions` | Per-citizen alert topic subscriptions |

### Auth & Security
| Table | Purpose |
|---|---|
| `user_sessions` | Active sessions with device fingerprint |
| `trusted_devices` | Remembered devices for 2FA skip |
| `security_events` | Login attempts, 2FA changes, suspicious activity |
| `password_history` | Previous password hashes (prevent reuse) |

### Community
| Table | Purpose |
|---|---|
| `community_posts` | Forum posts |
| `community_comments` | Comments on posts |
| `community_chat_messages` | Real-time chat messages |
| `community_bans/mutes` | Moderation actions |

---

## 6. EVERY FILE IN THE SERVER — WHAT IT DOES

### 6A. ROUTES (36 files — HTTP endpoints)

| File | What it does |
|---|---|
| `authRoutes.ts` | Operator login/logout/register with JWT, password reset, session management |
| `citizenAuthRoutes.ts` | Citizen registration, login, email verification, password reset |
| `citizenRoutes.ts` | Citizen profile CRUD, preferences, emergency contacts |
| `reportRoutes.ts` | Create/read/update/delete emergency reports, AI auto-classification on submit |
| `incidentRoutes.ts` | Incident lifecycle management (create from reports, assign, escalate, resolve) |
| `alertRoutes` (via floodRoutes) | Alert broadcasting to citizens via multiple channels |
| `chatRoutes.ts` | AI chatbot conversation endpoints (send message, get history, feedback) |
| `floodRoutes.ts` | Flood zone queries, flood predictions, evacuation routes |
| `riverRoutes.ts` | River level data (live gauges, historical, thresholds) |
| `dataRoutes.ts` | Data export (CSV/JSON), data import, admin data management |
| `distressRoutes.ts` | SOS beacon endpoints (activate, deactivate, acknowledge) |
| `aiRoutes.ts` | AI prediction proxy (sends data to Python AI engine, returns results) |
| `adminAiRoutes.ts` | Admin AI management (model status, retrain trigger, drift dashboard) |
| `extendedRoutes.ts` | Extended analytics (fusion engine, flood fingerprinting, incident intelligence, feature flags) |
| `spatialRoutes.ts` | PostGIS spatial queries (nearby reports, area search, buffer zones) |
| `mapTileRoutes.ts` | Map tile serving for offline/custom layers |
| `uploadRoutes.ts` | File upload handling (images, evidence, avatars) with Multer |
| `communityRoutes.ts` | Community forum CRUD (posts, comments, likes, shares) |
| `adminCommunityRoutes.ts` | Community moderation (ban, mute, delete, pin) |
| `securityRoutes.ts` | Security dashboard data (login attempts, devices, IP blocks) |
| `twoFactorRoutes.ts` | Operator 2FA setup (TOTP, WebAuthn) |
| `citizenTwoFactorRoutes.ts` | Citizen 2FA setup |
| `adaptiveMFARoutes.ts` | Adaptive MFA challenges (step-up auth when risk detected) |
| `emergencyQRAuthRoutes.ts` | QR code quick-auth for disaster kiosks |
| `oauthRoutes.ts` | Google OAuth login flow |
| `githubOAuthRoutes.ts` | GitHub OAuth login flow |
| `magicLinkRoutes.ts` | Passwordless magic link authentication |
| `configRoutes.ts` | System configuration and feature flags |
| `helplinesRoutes.ts` | Emergency helpline numbers by region |
| `translationRoutes.ts` | Translation API endpoint |
| `setupRoutes.ts` | First-run setup wizard |
| `internalRoutes.ts` | Internal admin introspection (health checks, circuit breaker status, bulk ops) |
| `adminCacheRoutes.ts` | Admin cache management (flush, stats) |
| `adminMessagingRoutes.ts` | Admin messaging (operator-to-citizen, broadcast) |
| `docsRoutes.ts` | Swagger/OpenAPI documentation serving |
| `userRoutes.ts` | User profile management |
| `telegramRoutes.ts` | Telegram bot webhook for alert delivery |

### 6B. SERVICES (68 files — business logic)

#### Core Services
| File | Lines | What it does |
|---|---|---|
| `chatService.ts` | 1,223 | Central chatbot orchestrator — receives message, runs safety checks, detects emergency, builds context, routes to LLM, executes tool calls, returns response |
| `chatTools.ts` | 2,076 | Defines every tool the chatbot can call (check weather, find shelters, analyze images, look up alerts) and implements handlers |
| `llmRouter.ts` | 1,811 | Routes LLM requests to best available provider: Ollama (local) → Gemini → Groq → OpenRouter → HuggingFace. Tracks health/latency per provider |
| `socket.ts` | 1,648 | Socket.IO server: handles real-time connections for incident updates, chat messages, SOS signals, community chat, presence tracking |
| `cronJobs.ts` | 1,054 | Scheduled background tasks: river data (5 min), threat recalculation (10 min), AI predictions (15 min), drift checks (6 hrs), cleanup (1 hr) |
| `dataIngestionService.ts` | 1,015 | Fetches data from EA Flood Monitoring, SEPA, Open-Meteo, NASA POWER, NewsAPI. Rate limited with retry and exponential backoff |
| `notificationService.ts` | — | Multi-channel notification delivery: email, SMS (Twilio), push (web-push), Telegram, in-app |
| `emailService.ts` | — | Email sending via Nodemailer (SMTP) |
| `riverLevelService.ts` | — | River gauge data processing and threshold monitoring |
| `threatLevelService.ts` | — | Aggregates multiple risk signals into overall threat level per area |
| `floodPredictionService.ts` | — | Flood prediction coordination between data sources and AI engine |
| `imageAnalysisService.ts` | — | Sends uploaded images to AI engine for crisis classification |
| `translationService.ts` | — | Text translation via external API |

#### Chat Subsystem (12 files feeding into chatService.ts)
| File | Lines | What it does |
|---|---|---|
| `chatAgentRouter.ts` | 368 | Routes to specialist agents (crisis_responder, trauma_support, preparedness_coach, medical_advisor, logistics_coordinator) based on emotion/intent |
| `chatDialogue.ts` | 364 | Tracks conversation slots (location, hazard type, household size) across turns, detects topic shifts, summarizes old messages |
| `chatQuality.ts` | 321 | Scores response quality on 6 dimensions, generates contextual follow-up questions |
| `chatSafety.ts` | 313 | Safety pipeline: prompt injection detection, PII redaction, content validation. Routes crisis/suicide keywords to trauma support |
| `chatEmergency.ts` | 169 | Detects emergency urgency in messages, categorizes by type (flood, fire, medical), flags high-severity for bypass |
| `chatLiveContext.ts` | 189 | Injects real-time data (active alerts, river levels, weather, shelters) into every LLM system prompt |
| `chatPromptBuilder.ts` | 120 | Constructs the full LLM prompt from system instructions + context + conversation history + tools |
| `chatConstants.ts` | 430 | All chat configuration: system prompts, tool schemas, agent profiles, safety keywords |
| `chatCache.ts` | — | Caches frequent chatbot responses to reduce LLM calls |
| `chatRag.ts` | 146 | RAG retrieval: searches knowledge base for relevant documents to include in prompt |
| `ragExpansionService.ts` | 858 | Full RAG pipeline: document chunking, vector embedding via pgvector, BM25 keyword search + cosine similarity re-ranking |
| `embeddingRouter.ts` | 238 | Routes text-to-vector embedding: Ollama (local) → HuggingFace → Gemini fallback |
| `personalizationEngine.ts` | 1,091 | Cross-session memory: remembers citizen details from past chats and tailors future responses |

#### AI Integration
| File | Lines | What it does |
|---|---|---|
| `aiClient.ts` | — | HTTP client that calls the Python AI engine's FastAPI endpoints |
| `aiAnalysisPipeline.ts` | — | Orchestrates the full analysis pipeline: classify report → predict severity → detect fakes → explain with SHAP |
| `classifierRouter.ts` | 637 | Routes classification requests (sentiment, severity, fake detection) to HuggingFace models with circuit breaker per model |
| `mlTrainingPipeline.ts` | 505 | Triggers model retraining, stores accuracy/F1/AUC metrics in DB |
| `modelMonitoringService.ts` | 140 | Reads recent predictions from DB, exposes stats (avg confidence, drift scores) as Prometheus metrics |
| `fusionEngine.ts` | 1,420 | Combines 10 real-time data sources into single flood probability score with confidence interval |
| `floodFingerprinting.ts` | 447 | Builds feature vectors for current flood conditions, matches against historical patterns using cosine similarity |
| `incidentIntelligenceCore.ts` | 774 | Spatial/temporal clustering of incidents, cascading incident prediction, Monte Carlo confidence, anomaly detection |
| `evacuationService.ts` | 972 | Calculates safe evacuation routes to shelters using OpenRouteService API, factoring in road closures and flood zones |

#### Resilience & Reliability (10 files)
| File | Lines | What it does |
|---|---|---|
| `bulkhead.ts` | 392 | Caps concurrent executions per subsystem (e.g. max 10 AI calls). If one subsystem overloads, others keep working. Based on Nygard (2007) "Release It!" |
| `circuitBreaker.ts` | 483 | If an external service fails 5+ times, stops calling it for 30 seconds instead of hammering it. Auto-retries after cooldown |
| `adaptiveRateLimiting.ts` | 432 | Rate limits that auto-adjust based on server CPU/memory load. Different limits per role (admin/operator/citizen) |
| `resilienceLayer.ts` | 328 | Wraps external API calls with caching + rate limiting + circuit breaking in one function |
| `requestCoalescing.ts` | 312 | If 100 users request the same data simultaneously, only 1 DB query runs and all 100 share the result |
| `requestPrioritization.ts` | 348 | Distress/SOS calls get processed before normal requests. 5 priority levels |
| `selfHealing.ts` | 581 | Monitors DB, cache, AI engine, WebSocket every 30 seconds. If degraded, auto-reconnects/restarts |
| `zeroDowntime.ts` | 543 | Graceful shutdown: finishes processing current requests before stopping during deployments. Kubernetes health probes |
| `cacheService.ts` | 513 | Redis cache with namespace-scoped keys, stale-while-revalidate, and LRU eviction |
| `apiGateway.ts` | 506 | API key management, per-key rate limits, API versioning, webhook signature verification |

#### Security (10 files)
| File | Lines | What it does |
|---|---|---|
| `adaptiveMFAService.ts` | 890 | When a login looks risky (new device, new location), forces extra authentication. Evaluates risk per NIST AAL levels |
| `governanceEngine.ts` | 1,274 | AI governance: explainability, human-in-the-loop for low-confidence predictions, drift detection, EU AI Act audit logging |
| `webauthnAttestationService.ts` | 912 | WebAuthn/FIDO2 passkey verification — parses CBOR attestation data, validates 4 formats, extracts public keys |
| `passkeysService.ts` | 516 | Passkey lifecycle: registration challenge → credential storage → authentication verification |
| `deviceManagementService.ts` | 569 | Tracks devices per user with fingerprints, sends "new device detected" email alerts |
| `deviceTrustService.ts` | 291 | SHA-256 device fingerprints with 30-day trust expiry (max 10 per user) |
| `ipSecurityService.ts` | 481 | IP blocklist/allowlist, auto-blocks after 20 failed login attempts |
| `riskAuthService.ts` | 199 | Scores every login 0-100 based on known IPs, recent failures, UA history, time-of-day |
| `hibpService.ts` | 184 | Checks passwords against Have I Been Pwned using k-Anonymity (safe — only sends 5 chars of hash) |
| `securityAlertService.ts` | 273 | Sends alerts when security events happen (2FA disabled, account locked, new device) |

#### Monitoring & Operations
| File | Lines | What it does |
|---|---|---|
| `metrics.ts` | 287 | Prometheus metrics: HTTP request histograms, WebSocket gauges, distress counters, alert delivery, AI predictions |
| `eventStreaming.ts` | 1,028 | Event broker with 4 swappable backends (Memory, Kafka, RabbitMQ, Redis). Currently uses Memory backend |
| `featureFlags.ts` | 501 | In-memory feature toggles with percentage rollouts, A/B variants, and kill switches |
| `n8nWorkflowService.ts` | 214 | n8n automation workflow integration |
| `n8nHealthCheck.ts` | 197 | Monitors n8n health, activates fallback cron jobs if n8n is down |
| `logger.ts` | — | Structured JSON logging via Pino |
| `securityLogger.ts` | — | Security-specific audit logging |
| `queryLogger.ts` | — | SQL query performance logging |
| `openApiGenerator.ts` | — | Generates OpenAPI/Swagger spec from route definitions |

---

## 7. CLIENT PAGES AND COMPONENTS

### 7A. Pages (19 routes)

| Page | Route | What it shows |
|---|---|---|
| **Landing Page** | `/` | Hero section, feature overview, login/register buttons |
| **Citizen Page** | `/citizen` | Public safety map with active alerts and flood zones |
| **Citizen Auth** | `/citizen/auth` | Login/register form for citizens |
| **Citizen Dashboard** | `/citizen/dashboard` | Authenticated view: reports, alerts, chatbot, shelters, community |
| **Admin Page** | `/admin` | Operator command center with all admin features |
| **Alerts Page** | `/alerts` | Public alert feed |
| **Guest Dashboard** | `/guest` | Read-only view for non-registered users |
| **About** | `/about` | Project info |
| **Privacy/Terms/Accessibility** | `/privacy`, `/terms`, `/accessibility` | Legal pages |
| **QR Auth** | `/qr-auth` | QR code authentication for disaster kiosks |
| **Magic Link** | `/magic-link` | Passwordless login callback |
| **OAuth Callback** | `/oauth/callback` | Google/GitHub OAuth redirect handler |
| **Setup Wizard** | `/setup` | First-run admin setup |
| **404** | `*` | Not found page |

### 7B. Admin Components (29)
Command Center, Incident Queue, Distress Panel, Alert Broadcasting, AI Transparency Console/Dashboard, Analytics Center/Dashboard, Security Dashboard, System Health Panel, User Access Management, All Reports Manager, Activity Log, Audit Trail, Live Operations Map, Community Hub, Admin Messaging, Crowd Density, Historical Intelligence, Resource Deployment Console, Incident Command Console, Delivery Dashboard, First Admin Setup, Login, 2FA Challenge/Settings, Welcome Dashboard, Keyboard Shortcuts

### 7C. Citizen Components (22)
Chatbot, Report Form (6-step wizard), SOS Button, Shelter Finder/Map, Community Chat/Room, Alert Subscribe, Preparedness Guide, Safety Check-In, Family Check-In, Risk Assessment, Live Incident Map, Offline Emergency Card, Onboarding Tutorial, Citizen Messaging, Citizen 2FA, Community Guidelines/Help, Crowd Density Heatmap, Citizen Welcome

### 7D. Shared Components (51)
Disaster Map, Live Map, Map 3D/3D View, Flood Layer Control, River Gauge/Level Panel, Weather Panel, Alert Card/Panel, Emergency Banner, Error Boundary, Route Guards, Accessibility Panel, Cookie Consent, Language Selector/Dropdown/Bar, Notification Toast, Offline Indicator, Session Expiry Handler, Incident Filter/Map Layers, Intelligence Dashboard, Hazard/Flood Prediction Timeline, Image Analysis Results, Climate Risk Dashboard, Emergency Readiness Score, Stat Card, Threat Radar Widget, Spatial Toolbar, Voice Input Button, and more

### 7E. UI Components (18)
Button, Modal, Toast, Form Elements, Loading States, Error States, Empty State, Skeleton, Navigation, Skip Links, Theme Selector, Page Transition, Lazy Image, Confetti Effect, and more

---

## 8. AI ENGINE — DETAILED

### 8A. Supported Hazards (11)

| # | Hazard | Model Type | Data Sources |
|---|---|---|---|
| 1 | **Flood** | LSTM + XGBoost + Ensemble | EA Flood Monitoring, SEPA, Open-Meteo rainfall, river discharge |
| 2 | **Drought** | LSTM + LightGBM + SPI | SPEI drought index, soil moisture, rainfall deficit |
| 3 | **Heatwave** | Transformer + CatBoost | Temperature forecasts, urban heat island data |
| 4 | **Wildfire** | RandomForest + XGBoost | Vegetation index (NDVI), wind, humidity, temperature |
| 5 | **Severe Storm** | XGBoost | Wind speed, pressure, historical storm tracks |
| 6 | **Landslide** | RandomForest | Elevation, slope, soil type, rainfall saturation |
| 7 | **Power Outage** | LightGBM | Weather severity, infrastructure age, historical outages |
| 8 | **Water Supply** | LightGBM | Reservoir levels, demand patterns, contamination risk |
| 9 | **Infrastructure Damage** | RandomForest | Age, material, exposure, maintenance history |
| 10 | **Public Safety** | XGBoost | Crime patterns, event data, crowd density |
| 11 | **Environmental Hazard** | LightGBM | Air quality, chemical spills, radiation |

### 8B. Feature Schema (28 features per prediction)

**Static (11):** latitude, longitude, elevation, basin_slope, catchment_area, soil_type, permeability, drainage_density, land_use, impervious_surface, vegetation_class

**Dynamic (13):** rainfall_1h, rainfall_6h, rainfall_24h, rainfall_7d, rainfall_30d, river_level, river_discharge, soil_moisture, temperature, evapotranspiration, NDVI, wind_speed, humidity

**Climate Macro (4):** seasonal_anomaly, climate_zone, ENSO_index, long_term_rainfall_anomaly

### 8C. Training Pipeline

1. **Data Loading** — Pulls from PostgreSQL + external APIs
2. **Feature Engineering** — Rolling statistics, lag features, interaction terms, Fourier seasonal encoding
3. **Train/Validation Split** — Time-series split (5 folds, 24-hour gap to prevent leakage)
4. **Hyperparameter Tuning** — Optuna with 100 trials, 1-hour timeout
5. **Model Training** — Trains the selected algorithm
6. **Calibration** — Isotonic regression to calibrate probability outputs
7. **Evaluation** — Accuracy, F1, AUC, Brier score
8. **Explainability** — SHAP values for feature importance
9. **Registry** — Saves to model registry with version, region, metrics
10. **Drift Monitoring** — Ongoing KS test, PSI, JS divergence on production data

### 8D. Data Fetchers (11 real-world API integrations)

| Fetcher | Source | What it gets |
|---|---|---|
| `data_fetch_open_meteo.py` | Open-Meteo | Weather forecasts, historical weather |
| `data_fetch_cams_openmeteo.py` | CAMS via Open-Meteo | Air quality forecasts |
| `data_fetch_emdat.py` | EM-DAT | International disaster database |
| `data_fetch_grdc.py` | GRDC | Global river discharge data |
| `data_fetch_ibtracs.py` | IBTrACS | Tropical cyclone tracks |
| `data_fetch_openaq.py` | OpenAQ | Real-time air quality |
| `data_fetch_outages.py` | Custom | Power outage events |
| `data_fetch_road_accidents.py` | Custom | Road accident data |
| `data_fetch_spei.py` | SPEI | Standardised Precipitation-Evapotranspiration Index |
| `multi_location_weather.py` | Open-Meteo | Multi-city weather batch |
| `data_fetch_events.py` | Custom | Event data aggregator |

---

## 9. SUPPORTED LANGUAGES (9)

| Language | Direction | Coverage |
|---|---|---|
| English | LTR | Full (source of truth) |
| Spanish (Español) | LTR | Full |
| French (Français) | LTR | Full |
| Arabic (العربية) | RTL | Full |
| German (Deutsch) | LTR | Full |
| Portuguese (Português) | LTR | Full |
| Hindi (हिन्दी) | LTR | Full |
| Chinese (中文) | LTR | Full |
| Swahili (Kiswahili) | LTR | Full |

**Accessibility modes (7):** Screen reader, high contrast, dyslexia-friendly, large text, reduced motion, colour-blind, captions

---

## 10. WHAT'S FLAGGED AS POTENTIALLY OVER-SCOPED

The following files exist and work but may be considered beyond what's needed for a PhD research prototype. They are listed here for review.

### 10A. DEAD CODE (not imported anywhere — safe to delete)
| File | Lines | What it is |
|---|---|---|
| `useOfflineFirst.tsx` | 435 | IndexedDB offline queue — never wired in |
| `usePredictiveCache.tsx` | 253 | Navigation-based prefetching — never wired in |
| `useWebAuthn.ts` | 373 | Client-side WebAuthn hook — never wired in |
| `useVirtualList.tsx` | 265 | Virtual scrolling — never wired in |

### 10B. ENTERPRISE AUTH (beyond research scope?)
| File | Lines | What it is |
|---|---|---|
| `webauthnAttestationService.ts` | 912 | FIDO2 CBOR attestation crypto |
| `passkeysService.ts` | 516 | Full passkey lifecycle |
| `adaptiveMFAService.ts` | 890 | NIST AAL-level adaptive MFA |
| `deviceManagementService.ts` | 569 | Device fingerprint registry |
| `ipSecurityService.ts` | 481 | IP blocklist with geo-restrictions |
| `emergencyQRAuthRoutes.ts` | 660 | QR kiosk authentication |
| `QRAuthPage.tsx` | 641 | Client QR auth page |

### 10C. SCOPE QUESTIONS (useful but perhaps too much?)
| File | Lines | What it is |
|---|---|---|
| `governanceEngine.ts` | 1,274 | EU AI Act compliance engine |
| `personalizationEngine.ts` | 1,091 | Cross-session citizen memory |
| `featureFlags.ts` | 501 | Netflix-grade feature toggles |
| `n8nWorkflowService.ts` | 214 | n8n automation integration |
| `n8nHealthCheck.ts` | 197 | n8n monitoring |
| `CookieConsent.tsx` | 250 | GDPR cookie banner |
| `communityRoutes.ts` | 851 | Full community forum |
| `eventStreaming.ts` | 1,028 | Kafka/RabbitMQ/Redis event backends (only Memory is used) |

### 10D. WHAT SHOULD DEFINITELY STAY (core to the research)
- All 10 resilience files (fault isolation IS the research contribution for emergency systems)
- All 11 hazard classifiers + training pipeline + data fetchers (this IS the PhD)
- Chat system (citizen-facing AI interface)
- Fusion engine + flood fingerprinting + incident intelligence (multi-source prediction)
- Report system + alert system (core CRUD)
- Socket.IO real-time layer
- Data ingestion pipeline
- Evacuation service
- Cron jobs + metrics
- Model registry + drift monitoring

---

## 11. LINE COUNT BREAKDOWN

| Component | Lines | Files |
|---|---|---|
| Server TypeScript | ~86,700 | ~270 |
| Client TSX | ~84,300 | ~174 |
| Client TS | ~34,900 | ~102 |
| Python AI Engine | ~60,300 | ~194 |
| SQL Migrations | ~6,000 | ~54 |
| **TOTAL** | **~272,200** | **~794** |

---

## 12. HOW TO RUN IT

```bash
# 1. Clone
git clone https://github.com/Happinesslazarus/AEGIS-Advanced-Emergency-Geospatial-Intelligence-System.git

# 2. Start everything with Docker
cd aegis-v6
docker compose up -d

# 3. Access
# Client:  http://localhost
# Server:  http://localhost:3001
# AI:      http://localhost:8000
# Grafana: http://localhost:3002

# Or run without Docker (development):
# Terminal 1: cd server && npm install && npm run dev
# Terminal 2: cd client && npm install && npm run dev
# Terminal 3: cd ai-engine && pip install -r requirements.txt && uvicorn main:app --reload
```

---

*This document describes every part of AEGIS so you can discuss what to keep or remove without needing to open the application.*
