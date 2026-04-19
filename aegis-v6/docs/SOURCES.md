# AEGIS — Sources, References & Further Reading

This document lists the academic papers, official specifications, and technical
resources that informed the design and implementation of each major component.

---

## Authentication & Security

### Multi-Factor Authentication / Adaptive MFA (`adaptiveMFAService.ts`, `adaptiveMFARoutes.ts`)

- **NIST SP 800-63B** — Digital Identity Guidelines: Authentication and Lifecycle Management.
  National Institute of Standards and Technology (2017, updated 2024).
  Defines Authenticator Assurance Levels (AAL1–AAL3) used throughout the service.
  https://pages.nist.gov/800-63-3/sp800-63b.html

- **OWASP Multi-Factor Authentication Cheat Sheet** — recommended MFA methods, OTP
  handling, and brute-force protection guidance.
  https://cheatsheetseries.owasp.org/cheatsheets/Multifactor_Authentication_Cheat_Sheet.html

- **OWASP Authentication Cheat Sheet** — session management, re-authentication
  requirements, credential storage.
  https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html

### WebAuthn / Passkeys (`webauthnAttestationService.ts`, `passkeysService.ts`)

- **W3C Web Authentication Level 2** — the full specification for the WebAuthn API,
  attestation formats (none, packed, fido-u2f, apple), COSE key encoding, and
  authenticator data structure.
  https://www.w3.org/TR/webauthn-2/

- **FIDO Alliance CTAP2 Specification** — Client-to-Authenticator Protocol used by
  hardware keys and platform authenticators.
  https://fidoalliance.org/specs/fido-v2.1-ps-20210615/fido-client-to-authenticator-protocol-v2.1-ps-20210615.html

- **RFC 7049 — CBOR (Concise Binary Object Representation)** — binary encoding format
  used in WebAuthn authenticatorData and attestation objects.
  https://datatracker.ietf.org/doc/html/rfc7049

- **MDN Web Docs: Web Authentication API** — practical reference for registration
  and authentication ceremony flows.
  https://developer.mozilla.org/en-US/docs/Web/API/Web_Authentication_API

### Risk-Based Security & Zero Trust (`riskAuthService.ts`, `zeroTrustSessionService.ts`, `ipSecurityService.ts`)

- **NIST SP 800-207** — Zero Trust Architecture.
  https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-207.pdf

- **OWASP Top Ten (2021)** — informed threat modelling for injection, broken auth,
  IDOR, security misconfiguration, and logging requirements.
  https://owasp.org/www-project-top-ten/

- **Have I Been Pwned API (hibpService.ts)** — Troy Hunt's breach database used to
  detect compromised passwords at registration.
  https://haveibeenpwned.com/API/v3

---

## Resilience Patterns

### Circuit Breaker (`circuitBreaker.ts`)

- **Nygard, M.T. (2007)** *Release It! Design and Deploy Production-Ready Software.*
  Pragmatic Bookshelf. Chapter 5: Stability Patterns — Circuit Breaker.

- **Fowler, M. "CircuitBreaker"** — canonical description of the CLOSED/OPEN/HALF-OPEN
  state machine.
  https://martinfowler.com/bliki/CircuitBreaker.html

- **Microsoft Azure Architecture Centre: Circuit Breaker pattern**
  https://learn.microsoft.com/en-us/azure/architecture/patterns/circuit-breaker

### Bulkhead Isolation (`bulkhead.ts`)

- **Nygard, M.T. (2007)** *Release It!* Chapter 4: Bulkheads — partitioning concurrent
  workloads so that a surge in one compartment does not starve others.

- **Microsoft Azure Architecture Centre: Bulkhead pattern**
  https://learn.microsoft.com/en-us/azure/architecture/patterns/bulkhead

### Request Prioritisation & QoS (`requestPrioritization.ts`)

- **Mogul, J.C. & Ramakrishnan, K.K. (1997)** — "Eliminating receive livelock in an
  interrupt-driven kernel." *ACM Transactions on Computer Systems.*
  Basis for priority-queue-based scheduling under load.

### Transactional Outbox (`eventStreaming.ts`, `dataIngestionService.ts`)

- **Richardson, C. "Transactional Outbox"** — microservices.io pattern: write events to
  an outbox table in the same DB transaction as the domain write, then publish
  asynchronously, preventing dual-write inconsistency.
  https://microservices.io/patterns/data/transactional-outbox.html

- **Kleppmann, M. (2017)** *Designing Data-Intensive Applications.* O'Reilly.
  Chapter 11: Stream Processing — log-based messaging, consumer groups, exactly-once delivery.

### Event Streaming — KafkaJS (`eventStreaming.ts`)

- **Apache Kafka Documentation** — broker configuration, topic partitioning, consumer
  groups, offset management.
  https://kafka.apache.org/documentation/

- **KafkaJS Official Documentation** — Node.js Kafka client used in KafkaStreamBackend.
  https://kafka.js.org/docs/getting-started

---

## AI / Machine Learning

### SHAP Explainability (`shap_explainer.py`, `governanceEngine.ts`)

- **Lundberg, S.M. & Lee, S.I. (2017)** "A Unified Approach to Interpreting Model
  Predictions." *Advances in Neural Information Processing Systems (NeurIPS) 30.*
  https://arxiv.org/abs/1705.07874

- **Lundberg, S.M. et al. (2020)** "From local explanations to global understanding
  with explainable AI for trees." *Nature Machine Intelligence 2*, 56–67.
  https://doi.org/10.1038/s42256-019-0138-9

- **SHAP Python Library** — used directly in `shap_explainer.py`.
  https://shap.readthedocs.io/en/latest/

### Gradient Boosting / CatBoost (all `train_*_real.py` files)

- **Prokhorenkova, L. et al. (2018)** "CatBoost: unbiased boosting with categorical
  features." *NeurIPS 2018.*
  https://arxiv.org/abs/1706.09516

- **CatBoost Official Documentation** — Python API reference for CatBoostClassifier,
  cross-validation, feature importance, and model export.
  https://catboost.ai/docs/concepts/python-reference_catboostclassifier.html

### Retrieval-Augmented Generation (`ragExpansionService.ts`)

- **Lewis, P. et al. (2020)** "Retrieval-Augmented Generation for Knowledge-Intensive
  NLP Tasks." *NeurIPS 2020.*
  https://arxiv.org/abs/2005.11401

- **Robertson, S. & Zaragoza, H. (2009)** "The Probabilistic Relevance Framework:
  BM25 and Beyond." *Foundations and Trends in Information Retrieval 3*(4).
  Used for BM25 keyword scoring in `ragExpansionService.ts`.

- **pgvector** — PostgreSQL extension for vector similarity search (cosine, L2, dot
  product) used for embedding-based retrieval.
  https://github.com/pgvector/pgvector

### AI Governance (`governanceEngine.ts`)

- **European Commission AI Act (2024)** — Articles 13–14 on transparency and human
  oversight requirements for high-risk AI systems. AEGIS's governance layer
  implements human-in-the-loop review routing and audit logging in line with
  these requirements.
  https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32024R1689

- **NIST AI Risk Management Framework (AI RMF 1.0, 2023)** — governance, mapping,
  measurement, and management of AI risk.
  https://www.nist.gov/system/files/documents/2023/01/26/NIST.AI.100-1.pdf

- **Doshi-Velez, F. & Kim, B. (2017)** "Towards a rigorous science of interpretable
  machine learning." Preprint.
  https://arxiv.org/abs/1702.08608

---

## Data Sources

### Flood & Hydrology (`train_flood_real.py`, `FloodDataClient.ts`, `SEPAAdapter.ts`)

- **Global Runoff Data Centre (GRDC)** — daily river discharge records used in flood
  training data.
  https://grdc.bafg.de/

- **Scottish Environment Protection Agency (SEPA)** — real-time river levels and
  flood warnings for Scottish regions.
  https://www.sepa.org.uk/environment/water/flooding/

- **Environment Agency (England)** — Flood Warning API providing real-time flood alerts.
  https://environment.data.gov.uk/flood-monitoring/doc/reference

- **Open-Meteo** — free, open-source weather API providing ERA5 reanalysis and
  forecast data. Used by OpenMeteoAdapter and all training pipelines.
  https://open-meteo.com/en/docs

### Tropical Cyclone / Storm (`train_severe_storm_real.py`, `data_fetch_ibtracs.py`)

- **IBTrACS (International Best Track Archive for Climate Stewardship)** — NOAA
  global tropical cyclone track and intensity database.
  https://www.ncei.noaa.gov/products/international-best-track-archive

### Drought / SPEI (`train_drought_real.py`, `data_fetch_spei.py`)

- **Vicente-Serrano, S.M. et al. (2010)** "A Multiscalar Drought Index Sensitive to
  Global Warming: The Standardized Precipitation Evapotranspiration Index."
  *Journal of Climate 23*(7), 1696–1718.
  https://doi.org/10.1175/2009JCLI2909.1

- **Global SPEI Database (SPEIbase)** — gridded monthly SPEI for global drought monitoring.
  https://spei.csic.es/database.html

### Disaster Event Records (`data_fetch_emdat.py`)

- **EM-DAT International Disaster Database** — Centre for Research on the Epidemiology
  of Disasters (CRED), Université catholique de Louvain.
  https://www.emdat.be/

### Air Quality (`data_fetch_openaq.py`, `train_environmental_hazard_real.py`)

- **OpenAQ** — open-source global air quality data platform aggregating PM2.5, PM10,
  NO₂, SO₂, CO, and O₃ readings.
  https://openaq.org/

### Power Outage (`data_fetch_outages.py`, `train_power_outage_real.py`)

- **U.S. DOE Electric Emergency & Disturbance Reports (OE-417)** — power disruption
  event records used for training data.
  https://www.oe.netl.doe.gov/OE417.aspx

---

## Infrastructure & Database

### PostgreSQL / PostGIS (`spatialRoutes.ts`, `db.ts`, schema migrations)

- **PostGIS Documentation** — spatial functions (ST_Distance, ST_DWithin, ST_ClusterKMeans,
  ST_Buffer, ST_HeatmapGrid) used throughout `spatialRoutes.ts`.
  https://postgis.net/documentation/

- **PostgreSQL Documentation** — advisory locks, SKIP LOCKED, window functions,
  JSONB operators.
  https://www.postgresql.org/docs/current/

### Redis Caching (`cacheService.ts`, `cacheMetrics.ts`)

- **Redis Documentation** — key expiry, pub/sub, sorted sets, and SCAN-based key management.
  https://redis.io/docs/

- **ioredis** — Node.js Redis client used throughout the caching layer.
  https://github.com/redis/ioredis

---

## Web Standards & APIs

### Push Notifications (`notificationService.ts`)

- **RFC 8030 — HTTP Web Push Protocol**
  https://datatracker.ietf.org/doc/html/rfc8030

- **VAPID (Voluntary Application Server Identification)** — RFC 8292
  https://datatracker.ietf.org/doc/html/rfc8292

### Rate Limiting (`adaptiveRateLimiting.ts`, `requestCoalescing.ts`)

- **IETF Draft: Rate Limit Headers** — standardised `RateLimit-*` response headers.
  https://datatracker.ietf.org/doc/html/draft-ietf-httpapi-ratelimit-headers

### Idempotency (`idempotency.ts`)

- **Stripe Engineering Blog** — "Idempotency in distributed systems" — basis for
  the idempotency key middleware.
  https://stripe.com/blog/idempotency

---

## Front-End

### React 18 / TypeScript / Vite

- **React Documentation** — hooks, context, concurrent rendering.
  https://react.dev/

- **TypeScript Handbook**
  https://www.typescriptlang.org/docs/handbook/

- **Vite Documentation**
  https://vitejs.dev/guide/

### Leaflet / Mapping (`DisasterMap.tsx`, `LiveMap.tsx`)

- **Leaflet.js Documentation** — tile layers, markers, GeoJSON, clustering.
  https://leafletjs.com/reference.html

### Socket.IO Real-Time (`socket.ts`, `SocketContext.tsx`)

- **Socket.IO Documentation** — rooms, namespaces, acknowledgements, reconnection.
  https://socket.io/docs/v4/

---

## Accessibility

- **WCAG 2.1 (Web Content Accessibility Guidelines)** — Level AA compliance target
  for all citizen-facing UI. Referenced in `AccessibilityPage.tsx` and `SkipLinks.tsx`.
  https://www.w3.org/TR/WCAG21/

- **ARIA Authoring Practices Guide (APG)** — modal dialog, combobox, live region
  patterns used throughout the component library.
  https://www.w3.org/WAI/ARIA/apg/
