--  AEGIS v6.9 — Production Upgrade Migration
--  PostgreSQL 14+ with PostGIS + pgvector
--  Adds tables for:
--    • LLM chat sessions and messages (AI chatbot)
--    • RAG document store with vector embeddings
--    • Response cache (reduce redundant LLM calls)
--    • Consent records (GDPR compliance)
--    • External alert ingestion (SEPA RSS, Met Office)
--    • Hazard module configuration (universal architecture)
--    • Zone risk scores (computed risk layers)
--    • Model drift metrics (AI transparency)
--    • Damage estimates (impact assessment)
--    • Training labels (human-in-the-loop)
--    • Shelter locations (emergency infrastructure)
--    • Scheduled jobs log (cron audit trail)
--  Prerequisites:
--    • Run AFTER schema.sql and migration_citizen_system.sql
--    • pgvector extension must be available on the server
--      (install via: CREATE EXTENSION vector;)
--  Usage:
--    psql -U postgres -d aegis -f migration_production_upgrade.sql

-- Each statement runs independently so a single failure doesn't
-- abort the entire migration. pgvector is optional — RAG works
-- with full-text search as a fallback if the extension isn't installed.

-- Try to install pgvector — silently ignored if not available
DO $$ BEGIN
    CREATE EXTENSION IF NOT EXISTS vector;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'pgvector extension not available — RAG will use full-text search fallback';
END $$;

-- §1  ENUM TYPES

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'chat_session_status') THEN
        CREATE TYPE chat_session_status AS ENUM ('active', 'archived', 'expired');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'chat_message_role') THEN
        CREATE TYPE chat_message_role AS ENUM ('user', 'assistant', 'system', 'tool');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'consent_type_enum') THEN
        CREATE TYPE consent_type_enum AS ENUM (
            'data_processing', 'location_tracking', 'ai_analysis', 'marketing', 'research'
        );
    END IF;
END $$;

-- §2  CHAT SESSIONS (LLM-powered chatbot conversations)

CREATE TABLE IF NOT EXISTS chat_sessions (
    id              UUID                PRIMARY KEY DEFAULT uuid_generate_v4(),
    citizen_id      UUID                REFERENCES citizens(id) ON DELETE SET NULL,
    operator_id     UUID                REFERENCES operators(id) ON DELETE SET NULL,
    title           VARCHAR(255),
    status          chat_session_status NOT NULL DEFAULT 'active',
    model_used      VARCHAR(100),
    total_tokens    INTEGER             NOT NULL DEFAULT 0,
    metadata        JSONB               NOT NULL DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ         NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ         NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chat_sessions_citizen
    ON chat_sessions (citizen_id, created_at DESC) WHERE citizen_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_chat_sessions_status
    ON chat_sessions (status) WHERE status = 'active';

-- §3  CHAT MESSAGES (individual messages within a session)

CREATE TABLE IF NOT EXISTS chat_messages (
    id              UUID                PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id      UUID                NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
    role            chat_message_role   NOT NULL,
    content         TEXT                NOT NULL,
    model_used      VARCHAR(100),
    tokens_used     INTEGER             NOT NULL DEFAULT 0,
    latency_ms      INTEGER,
    tool_calls      JSONB,
    metadata        JSONB               NOT NULL DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ         NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_session
    ON chat_messages (session_id, created_at ASC);

-- §4  RAG DOCUMENTS (knowledge base for retrieval-augmented generation)

CREATE TABLE IF NOT EXISTS rag_documents (
    id              UUID            PRIMARY KEY DEFAULT uuid_generate_v4(),
    title           VARCHAR(500)    NOT NULL,
    content         TEXT            NOT NULL,
    source          VARCHAR(255)    NOT NULL,
    doc_type        VARCHAR(50)     NOT NULL DEFAULT 'general',
    -- embedding column is TEXT unless pgvector is installed
    -- (the application layer handles encoding/decoding)
    embedding       TEXT,
    chunk_index     INTEGER         NOT NULL DEFAULT 0,
    metadata        JSONB           NOT NULL DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ     NOT NULL DEFAULT now()
);

-- Vector index is created only if pgvector extension is available
-- Otherwise the app falls back to full-text search for RAG
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') THEN
        EXECUTE 'ALTER TABLE rag_documents ALTER COLUMN embedding TYPE vector(384) USING embedding::vector(384)';
        EXECUTE 'CREATE INDEX IF NOT EXISTS idx_rag_documents_embedding ON rag_documents USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100)';
    END IF;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Could not create vector index — will use text fallback';
END $$;

CREATE INDEX IF NOT EXISTS idx_rag_documents_type
    ON rag_documents (doc_type);

CREATE INDEX IF NOT EXISTS idx_rag_documents_source
    ON rag_documents (source);

-- §5  RESPONSE CACHE (avoid redundant LLM calls for repeated questions)

CREATE TABLE IF NOT EXISTS response_cache (
    id              UUID            PRIMARY KEY DEFAULT uuid_generate_v4(),
    query_hash      VARCHAR(64)     NOT NULL,
    query_text      TEXT            NOT NULL,
    response_text   TEXT            NOT NULL,
    model_used      VARCHAR(100)    NOT NULL,
    ttl_seconds     INTEGER         NOT NULL DEFAULT 3600,
    hit_count       INTEGER         NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT now(),
    expires_at      TIMESTAMPTZ     NOT NULL DEFAULT (now() + INTERVAL '1 hour')
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_response_cache_hash
    ON response_cache (query_hash);

CREATE INDEX IF NOT EXISTS idx_response_cache_expires
    ON response_cache (expires_at);

-- §6  CONSENT RECORDS (GDPR Article 7 — proof of consent)

CREATE TABLE IF NOT EXISTS consent_records (
    id              UUID                PRIMARY KEY DEFAULT uuid_generate_v4(),
    citizen_id      UUID                REFERENCES citizens(id) ON DELETE SET NULL,
    operator_id     UUID                REFERENCES operators(id) ON DELETE SET NULL,
    consent_type    consent_type_enum   NOT NULL,
    granted         BOOLEAN             NOT NULL,
    ip_address      INET,
    user_agent      TEXT,
    created_at      TIMESTAMPTZ         NOT NULL DEFAULT now(),
    withdrawn_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_consent_records_citizen
    ON consent_records (citizen_id) WHERE citizen_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_consent_records_type
    ON consent_records (consent_type, granted);

-- §7  EXTERNAL ALERTS (ingested from SEPA RSS, Met Office, EA)

CREATE TABLE IF NOT EXISTS external_alerts (
    id              UUID            PRIMARY KEY DEFAULT uuid_generate_v4(),
    source          VARCHAR(100)    NOT NULL,
    source_id       VARCHAR(255)    NOT NULL,
    title           VARCHAR(500)    NOT NULL,
    description     TEXT,
    severity        alert_severity  NOT NULL DEFAULT 'info',
    area            VARCHAR(255),
    coordinates     GEOMETRY(Point, 4326),
    raw_data        JSONB           NOT NULL DEFAULT '{}'::jsonb,
    ingested_at     TIMESTAMPTZ     NOT NULL DEFAULT now(),
    expires_at      TIMESTAMPTZ
);

-- Prevent duplicate ingestion of the same external alert
CREATE UNIQUE INDEX IF NOT EXISTS uq_external_alerts_source
    ON external_alerts (source, source_id);

CREATE INDEX IF NOT EXISTS idx_external_alerts_severity
    ON external_alerts (severity);

CREATE INDEX IF NOT EXISTS idx_external_alerts_geo
    ON external_alerts USING GIST (coordinates) WHERE coordinates IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_external_alerts_ingested
    ON external_alerts (ingested_at DESC);

-- §8  HAZARD MODULES (universal architecture — per-region hazard config)

CREATE TABLE IF NOT EXISTS hazard_modules (
    id              UUID            PRIMARY KEY DEFAULT uuid_generate_v4(),
    hazard_type     VARCHAR(50)     NOT NULL,
    region_id       VARCHAR(50)     NOT NULL,
    enabled         BOOLEAN         NOT NULL DEFAULT true,
    config          JSONB           NOT NULL DEFAULT '{}'::jsonb,
    api_sources     TEXT[]          NOT NULL DEFAULT '{}',
    model_version   VARCHAR(50),
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ     NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_hazard_modules_type_region
    ON hazard_modules (hazard_type, region_id);

-- §9  ZONE RISK SCORES (computed risk layers per zone per hazard)

CREATE TABLE IF NOT EXISTS zone_risk_scores (
    id                      UUID            PRIMARY KEY DEFAULT uuid_generate_v4(),
    zone_name               VARCHAR(200)    NOT NULL,
    hazard_type             VARCHAR(50)     NOT NULL,
    risk_score              NUMERIC(5,2)    NOT NULL CHECK (risk_score BETWEEN 0 AND 100),
    confidence              NUMERIC(5,2)    NOT NULL CHECK (confidence BETWEEN 0 AND 100),
    contributing_factors    JSONB           NOT NULL DEFAULT '{}'::jsonb,
    geometry                GEOMETRY(MultiPolygon, 4326),
    computed_at             TIMESTAMPTZ     NOT NULL DEFAULT now(),
    expires_at              TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_zone_risk_scores_geo
    ON zone_risk_scores USING GIST (geometry) WHERE geometry IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_zone_risk_scores_hazard
    ON zone_risk_scores (hazard_type, risk_score DESC);

CREATE INDEX IF NOT EXISTS idx_zone_risk_scores_computed
    ON zone_risk_scores (computed_at DESC);

-- §10  MODEL DRIFT METRICS (detect degradation in production models)

CREATE TABLE IF NOT EXISTS model_drift_metrics (
    id              UUID            PRIMARY KEY DEFAULT uuid_generate_v4(),
    model_name      VARCHAR(100)    NOT NULL,
    model_version   VARCHAR(50)     NOT NULL,
    metric_name     VARCHAR(100)    NOT NULL,
    baseline_value  NUMERIC(10,4)   NOT NULL,
    current_value   NUMERIC(10,4)   NOT NULL,
    drift_detected  BOOLEAN         NOT NULL DEFAULT false,
    threshold       NUMERIC(10,4)   NOT NULL,
    computed_at     TIMESTAMPTZ     NOT NULL DEFAULT now()
);

ALTER TABLE model_drift_metrics
    ADD COLUMN IF NOT EXISTS model_name VARCHAR(100),
    ADD COLUMN IF NOT EXISTS model_version VARCHAR(50),
    ADD COLUMN IF NOT EXISTS metric_name VARCHAR(100),
    ADD COLUMN IF NOT EXISTS baseline_value NUMERIC(10,4),
    ADD COLUMN IF NOT EXISTS current_value NUMERIC(10,4),
    ADD COLUMN IF NOT EXISTS computed_at TIMESTAMPTZ DEFAULT now();

UPDATE model_drift_metrics
SET computed_at = COALESCE(computed_at, created_at, now())
WHERE computed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_model_drift_model
    ON model_drift_metrics (model_name, model_version, computed_at DESC);

CREATE INDEX IF NOT EXISTS idx_model_drift_detected
    ON model_drift_metrics (drift_detected) WHERE drift_detected = true;

-- §11  DAMAGE ESTIMATES (AI-generated impact assessments)

CREATE TABLE IF NOT EXISTS damage_estimates (
    id                  UUID            PRIMARY KEY DEFAULT uuid_generate_v4(),
    report_id           UUID            REFERENCES reports(id) ON DELETE SET NULL,
    zone_name           VARCHAR(200),
    estimated_cost_gbp  NUMERIC(12,2)   NOT NULL DEFAULT 0,
    affected_properties INTEGER         NOT NULL DEFAULT 0,
    affected_people     INTEGER         NOT NULL DEFAULT 0,
    confidence          NUMERIC(5,2)    NOT NULL CHECK (confidence BETWEEN 0 AND 100),
    model_version       VARCHAR(50)     NOT NULL,
    breakdown           JSONB           NOT NULL DEFAULT '{}'::jsonb,
    created_at          TIMESTAMPTZ     NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_damage_estimates_report
    ON damage_estimates (report_id) WHERE report_id IS NOT NULL;

-- §12  TRAINING LABELS (human-in-the-loop annotation for model improvement)

CREATE TABLE IF NOT EXISTS training_labels (
    id              UUID            PRIMARY KEY DEFAULT uuid_generate_v4(),
    report_id       UUID            REFERENCES reports(id) ON DELETE SET NULL,
    label_type      VARCHAR(50)     NOT NULL,
    label_value     VARCHAR(255)    NOT NULL,
    labelled_by     UUID            REFERENCES operators(id) ON DELETE SET NULL,
    confidence      NUMERIC(5,2),
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_training_labels_report
    ON training_labels (report_id) WHERE report_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_training_labels_type
    ON training_labels (label_type);

-- §13  SHELTERS (emergency infrastructure locations)

CREATE TABLE IF NOT EXISTS shelters (
    id              UUID                    PRIMARY KEY DEFAULT uuid_generate_v4(),
    name            VARCHAR(255)            NOT NULL,
    address         TEXT,
    coordinates     GEOMETRY(Point, 4326)   NOT NULL,
    capacity        INTEGER                 NOT NULL DEFAULT 0,
    current_occupancy INTEGER              NOT NULL DEFAULT 0,
    shelter_type    VARCHAR(50)             NOT NULL DEFAULT 'general',
    amenities       TEXT[]                  NOT NULL DEFAULT '{}',
    phone           VARCHAR(20),
    is_active       BOOLEAN                 NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ             NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ             NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_shelters_geo
    ON shelters USING GIST (coordinates);

CREATE INDEX IF NOT EXISTS idx_shelters_active
    ON shelters (is_active) WHERE is_active = true;

-- §14  SCHEDULED JOBS LOG (cron execution audit trail)

CREATE TABLE IF NOT EXISTS scheduled_jobs (
    id              UUID            PRIMARY KEY DEFAULT uuid_generate_v4(),
    job_name        VARCHAR(100)    NOT NULL,
    status          VARCHAR(20)     NOT NULL DEFAULT 'success',
    duration_ms     INTEGER,
    records_affected INTEGER       DEFAULT 0,
    error_message   TEXT,
    started_at      TIMESTAMPTZ     NOT NULL DEFAULT now(),
    completed_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_scheduled_jobs_name
    ON scheduled_jobs (job_name, started_at DESC);

-- §15  CITIZENS TABLE EXTENSIONS (profile fields from v6.8)

ALTER TABLE citizens
    ADD COLUMN IF NOT EXISTS bio             TEXT,
    ADD COLUMN IF NOT EXISTS address_line    TEXT,
    ADD COLUMN IF NOT EXISTS status_color    VARCHAR(10) DEFAULT 'green',
    ADD COLUMN IF NOT EXISTS vulnerability_flag BOOLEAN NOT NULL DEFAULT false;

-- §16  TRIGGERS

-- chat_sessions updated_at
DROP TRIGGER IF EXISTS trg_chat_sessions_updated_at ON chat_sessions;
CREATE TRIGGER trg_chat_sessions_updated_at
    BEFORE UPDATE ON chat_sessions
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

-- rag_documents updated_at
DROP TRIGGER IF EXISTS trg_rag_documents_updated_at ON rag_documents;
CREATE TRIGGER trg_rag_documents_updated_at
    BEFORE UPDATE ON rag_documents
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

-- hazard_modules updated_at
DROP TRIGGER IF EXISTS trg_hazard_modules_updated_at ON hazard_modules;
CREATE TRIGGER trg_hazard_modules_updated_at
    BEFORE UPDATE ON hazard_modules
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

-- shelters updated_at
DROP TRIGGER IF EXISTS trg_shelters_updated_at ON shelters;
CREATE TRIGGER trg_shelters_updated_at
    BEFORE UPDATE ON shelters
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

-- §17  SEED DATA — RAG Documents (emergency guidance knowledge base)

INSERT INTO rag_documents (title, content, source, doc_type, chunk_index) VALUES
    ('Flood Safety Guide',
     'If flooding is imminent: Move to higher ground immediately. Do not walk or drive through flood water—just 6 inches of fast-flowing water can knock you over, and 2 feet can float a car. Turn off gas, electricity, and water at the mains if safe to do so. Move important documents and valuables upstairs. Call 999 if you are trapped or in immediate danger.',
     'SEPA Flood Guidance', 'emergency_procedure', 0),

    ('Heatwave Safety Guide',
     'During a heatwave: Stay hydrated—drink plenty of water even if not thirsty. Avoid direct sunlight between 11am and 3pm. Keep curtains closed on sun-facing windows. Check on vulnerable neighbours, elderly relatives, and those with chronic conditions. Never leave children or pets in parked vehicles. Call 111 if someone shows signs of heatstroke.',
     'NHS Heat-Health Guidelines', 'emergency_procedure', 0),

    ('Emergency Kit Checklist',
     'Every household should prepare an emergency kit containing: bottled water (3 litres per person per day for 3 days), non-perishable food, torch and spare batteries, first aid kit, battery-powered or wind-up radio, copies of important documents in a waterproof bag, prescription medications, warm clothing and blankets, mobile phone charger (portable), whistle (to signal for help).',
     'Scottish Government Ready Scotland', 'preparedness', 0),

    ('SEPA Flood Warning Levels',
     'SEPA issues three levels of flood warning: 1) Flood Alert (Be Aware): Flooding is possible in the area. Be prepared and monitor SEPA website. 2) Flood Warning (Be Prepared): Flooding is expected. Take immediate action to protect yourself and your property. 3) Severe Flood Warning (Take Action): Severe flooding with danger to life. Follow emergency service instructions immediately.',
     'SEPA Warning System', 'reference', 0),

    ('Reporting an Emergency to AEGIS',
     'When submitting an emergency report through AEGIS: 1) Select the correct incident category and subtype. 2) Provide a clear, factual description of what is happening. 3) Include your exact location or use the map pin. 4) Attach photos or video if safe to do so. 5) Indicate if anyone is trapped or in immediate danger. 6) Your report will be triaged by AI and reviewed by an operator.',
     'AEGIS User Guide', 'help', 0),

    ('Community Mutual Aid',
     'During emergencies, community support is vital. Through AEGIS Community Help, you can: Offer shelter to displaced neighbours, share transport for evacuations, provide food and supplies, offer medical or first aid expertise. All community help posts require consent confirmation. Contact details are only shared with verified responders.',
     'AEGIS Community Guide', 'help', 0)
ON CONFLICT DO NOTHING;

-- §18  SEED DATA — Sample Shelters

INSERT INTO shelters (name, address, coordinates, capacity, shelter_type, amenities, phone) VALUES
    ('Aberdeen Exhibition & Conference Centre',
     'Bridge of Don, Aberdeen AB23 8BL',
     ST_SetSRID(ST_MakePoint(-2.0943, 57.1680), 4326),
     500, 'general', '{beds,food,water,medical,wifi}', '01224 824824'),

    ('Edinburgh International Conference Centre',
     'The Exchange, 150 Morrison St, Edinburgh EH3 8EE',
     ST_SetSRID(ST_MakePoint(-3.2075, 55.9468), 4326),
     800, 'general', '{beds,food,water,medical,wifi,parking}', '0131 300 3000'),

    ('Scottish Event Campus (SEC)',
     'Exhibition Way, Glasgow G3 8YW',
     ST_SetSRID(ST_MakePoint(-4.2877, 55.8607), 4326),
     1200, 'general', '{beds,food,water,medical,wifi,parking}', '0141 248 3000'),

    ('Caird Hall',
     'City Square, Dundee DD1 3BB',
     ST_SetSRID(ST_MakePoint(-2.9707, 56.4600), 4326),
     300, 'general', '{beds,food,water,wifi}', '01382 434940'),

    ('Inverness Leisure Centre',
     'Bught Lane, Inverness IV3 5SS',
     ST_SetSRID(ST_MakePoint(-4.2396, 57.4668), 4326),
     200, 'general', '{beds,food,water,showers}', '01463 667500')
ON CONFLICT DO NOTHING;

-- Done. Migration complete (no COMMIT needed — each statement runs independently).
