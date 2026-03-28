--  AEGIS v6.5 — AI Integration Schema Extension (ADDITIVE ONLY)
--  PostgreSQL + PostGIS
--  This migration adds tables needed for AI prediction system.
--  DOES NOT modify existing tables - only extends the schema.

BEGIN;

-- AI1  HAZARD TYPES TABLE (Master reference for all hazard types)

CREATE TABLE IF NOT EXISTS hazard_types (
    id              UUID            PRIMARY KEY DEFAULT uuid_generate_v4(),
    code            VARCHAR(50)     NOT NULL UNIQUE,  -- flood, drought, heatwave, etc.
    name            VARCHAR(100)    NOT NULL,
    description     TEXT,
    enabled         BOOLEAN         NOT NULL DEFAULT true,
    priority        INTEGER         NOT NULL DEFAULT 5,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT now()
);

-- Seed initial hazard types
INSERT INTO hazard_types (code, name, description, enabled, priority) VALUES
    ('flood', 'Flood', 'River, coastal, and surface water flooding', true, 1),
    ('drought', 'Drought', 'Long-term water scarcity and vegetation stress', true, 2),
    ('heatwave', 'Heatwave', 'Extended periods of extreme heat', true, 3),
    ('wildfire', 'Wildfire', 'Vegetation fire risk', false, 4),
    ('landslide', 'Landslide', 'Ground movement and slope failure', false, 5),
    ('storm_surge', 'Storm Surge', 'Coastal flooding from storms', false, 6)
ON CONFLICT (code) DO NOTHING;

-- §AI2  AI MODEL REGISTRY (Track all AI models and versions)

CREATE TABLE IF NOT EXISTS ai_models (
    id                  UUID            PRIMARY KEY DEFAULT uuid_generate_v4(),
    name                VARCHAR(100)    NOT NULL,
    version             VARCHAR(50)     NOT NULL,
    hazard_type         VARCHAR(50)     NOT NULL REFERENCES hazard_types(code),
    region_id           VARCHAR(100)    NOT NULL,
    model_file_path     VARCHAR(500),
    architecture        VARCHAR(100),
    framework           VARCHAR(50),

    -- Performance metrics (JSONB for flexibility)
    performance_metrics JSONB           NOT NULL DEFAULT '{}'::jsonb,
    feature_names       TEXT[],

    -- Training metadata
    trained_at          TIMESTAMPTZ,
    training_samples    INTEGER,
    training_duration_hours NUMERIC(10,2),

    -- Usage tracking
    prediction_count    INTEGER         NOT NULL DEFAULT 0,
    total_latency_ms    BIGINT          NOT NULL DEFAULT 0,
    last_used_at        TIMESTAMPTZ,

    -- Lifecycle
    status              VARCHAR(50)     NOT NULL DEFAULT 'active',  -- active, deprecated, retired
    deployed_at         TIMESTAMPTZ,
    retired_at          TIMESTAMPTZ,

    created_at          TIMESTAMPTZ     NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ     NOT NULL DEFAULT now(),

    CONSTRAINT uq_ai_models_name_version UNIQUE (name, version)
);

CREATE INDEX IF NOT EXISTS idx_ai_models_hazard_region
    ON ai_models (hazard_type, region_id, status);

CREATE INDEX IF NOT EXISTS idx_ai_models_status
    ON ai_models (status) WHERE status = 'active';

-- §AI3  AI PREDICTIONS (Store all prediction outputs)

CREATE TABLE IF NOT EXISTS ai_predictions (
    id                      UUID            PRIMARY KEY DEFAULT uuid_generate_v4(),

    -- What was predicted
    hazard_type             VARCHAR(50)     NOT NULL REFERENCES hazard_types(code),
    region_id               VARCHAR(100)    NOT NULL,

    -- Prediction results
    probability             NUMERIC(5,4)    NOT NULL CHECK (probability BETWEEN 0 AND 1),
    risk_level              VARCHAR(50)     NOT NULL,  -- Low, Medium, High, Critical
    confidence              NUMERIC(5,4)    NOT NULL CHECK (confidence BETWEEN 0 AND 1),
    predicted_peak_time     TIMESTAMPTZ,

    -- Spatial
    input_coordinates       geometry(Point, 4326),
    affected_area           geometry(Polygon, 4326),
    affected_radius_km      NUMERIC(8,2),

    -- Model used
    model_id                UUID REFERENCES ai_models(id) ON DELETE SET NULL,
    model_version           VARCHAR(50)     NOT NULL,

    -- Full prediction response (preserve everything)
    prediction_response     JSONB           NOT NULL,
    contributing_factors    JSONB,

    -- Input data snapshot
    input_features          JSONB,
    data_sources            TEXT[],

    -- Metadata
    requested_by            UUID REFERENCES operators(id) ON DELETE SET NULL,
    execution_time_ms       INTEGER,

    -- Timestamps
    generated_at            TIMESTAMPTZ     NOT NULL DEFAULT now(),
    expires_at              TIMESTAMPTZ,
    created_at              TIMESTAMPTZ     NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_predictions_hazard_region
    ON ai_predictions (hazard_type, region_id, generated_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_predictions_risk_level
    ON ai_predictions (risk_level, generated_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_predictions_coordinates
    ON ai_predictions USING GIST (input_coordinates);

CREATE INDEX IF NOT EXISTS idx_ai_predictions_area
    ON ai_predictions USING GIST (affected_area)
    WHERE affected_area IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ai_predictions_active
    ON ai_predictions (expires_at, generated_at DESC);

-- §AI4  MODEL DRIFT DETECTION (Track model performance over time)

CREATE TABLE IF NOT EXISTS model_drift_metrics (
    id                      UUID            PRIMARY KEY DEFAULT uuid_generate_v4(),
    model_id                UUID            NOT NULL REFERENCES ai_models(id) ON DELETE CASCADE,

    -- Drift indicators
    metric_type             VARCHAR(50)     NOT NULL,  -- accuracy, distribution, prediction_stability
    drift_score             NUMERIC(5,4)    NOT NULL CHECK (drift_score BETWEEN 0 AND 1),
    threshold               NUMERIC(5,4)    NOT NULL,
    drift_detected          BOOLEAN         NOT NULL DEFAULT false,

    -- Statistical measures
    statistical_tests       JSONB,

    -- Period measured
    measurement_period_start TIMESTAMPTZ    NOT NULL,
    measurement_period_end   TIMESTAMPTZ    NOT NULL,
    sample_size             INTEGER,

    -- Action taken
    alert_sent              BOOLEAN         NOT NULL DEFAULT false,
    retrain_triggered       BOOLEAN         NOT NULL DEFAULT false,

    created_at              TIMESTAMPTZ     NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_drift_metrics_model_created
    ON model_drift_metrics (model_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_drift_detected
    ON model_drift_metrics (drift_detected, created_at DESC)
    WHERE drift_detected = true;

-- §AI5  TRAINING JOBS (Track model training/retraining)

CREATE TABLE IF NOT EXISTS training_jobs (
    id                      UUID            PRIMARY KEY DEFAULT uuid_generate_v4(),

    -- Job details
    job_type                VARCHAR(50)     NOT NULL,  -- initial_training, retraining, tuning
    hazard_type             VARCHAR(50)     NOT NULL REFERENCES hazard_types(code),
    region_id               VARCHAR(100)    NOT NULL,
    model_name              VARCHAR(100)    NOT NULL,

    -- Status
    status                  VARCHAR(50)     NOT NULL DEFAULT 'queued',  -- queued, running, completed, failed
    progress_percent        INTEGER         CHECK (progress_percent BETWEEN 0 AND 100),

    -- Configuration
    training_config         JSONB,

    -- Data
    training_samples        INTEGER,
    validation_samples      INTEGER,
    test_samples            INTEGER,

    -- Results
    resulting_model_id      UUID REFERENCES ai_models(id) ON DELETE SET NULL,
    performance_metrics     JSONB,

    -- Execution
    started_at              TIMESTAMPTZ,
    completed_at            TIMESTAMPTZ,
    duration_hours          NUMERIC(10,2),

    -- Errors
    error_message           TEXT,
    error_details           JSONB,

    -- Audit
    triggered_by            UUID REFERENCES operators(id) ON DELETE SET NULL,
    trigger_reason          VARCHAR(100),

    created_at              TIMESTAMPTZ     NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ     NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_training_jobs_status
    ON training_jobs (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_training_jobs_hazard
   ON training_jobs (hazard_type, region_id, created_at DESC);

-- §AI6  PASSWORD RESET TOKENS (For forgot password flow)

CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id                  UUID            PRIMARY KEY DEFAULT uuid_generate_v4(),
    operator_id         UUID            NOT NULL REFERENCES operators(id) ON DELETE CASCADE,
    token               VARCHAR(255)    NOT NULL UNIQUE,
    expires_at          TIMESTAMPTZ     NOT NULL,
    used_at             TIMESTAMPTZ,
    ip_address          INET,
    created_at          TIMESTAMPTZ     NOT NULL DEFAULT now(),

    CONSTRAINT check_not_expired CHECK (used_at IS NULL OR used_at < expires_at)
);

CREATE INDEX IF NOT EXISTS idx_password_reset_token
    ON password_reset_tokens (token)
    WHERE used_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_password_reset_expires
    ON password_reset_tokens (expires_at);

-- §AI7  EXTEND alert_subscriptions with WhatsApp support

DO $$
BEGIN
    -- Check if whatsapp column exists
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'alert_subscriptions' AND column_name = 'whatsapp_number'
    ) THEN
        ALTER TABLE alert_subscriptions
            ADD COLUMN whatsapp_number VARCHAR(20),
            ADD COLUMN whatsapp_enabled BOOLEAN NOT NULL DEFAULT false;
    END IF;
END $$;

-- §AI8  REPORT NUMBER TRIGGER
-- Intentionally left as a no-op here: schema.sql owns the canonical
-- deterministic report-number trigger implementation.

-- §AI9  UTILITY VIEWS FOR AI SYSTEM

-- Active predictions view
CREATE OR REPLACE VIEW v_active_predictions AS
SELECT
    p.id,
    p.hazard_type,
    p.region_id,
    p.probability,
    p.risk_level,
    p.confidence,
    p.predicted_peak_time,
    ST_AsGeoJSON(p.input_coordinates) as location_geojson,
    ST_AsGeoJSON(p.affected_area) as affected_area_geojson,
    p.model_version,
    p.generated_at,
    p.expires_at,
    m.name as model_name,
    m.architecture as model_architecture
FROM ai_predictions p
LEFT JOIN ai_models m ON p.model_id = m.id
WHERE p.expires_at IS NULL OR p.expires_at > now()
ORDER BY p.generated_at DESC;

-- Model performance summary
CREATE OR REPLACE VIEW v_model_performance AS
SELECT
    m.id,
    m.name,
    m.version,
    m.hazard_type,
    m.region_id,
    m.status,
    m.prediction_count,
    CASE
        WHEN m.prediction_count > 0 THEN m.total_latency_ms::FLOAT / m.prediction_count
        ELSE NULL
    END as avg_latency_ms,
    m.performance_metrics,
    m.trained_at,
    m.last_used_at,
    COUNT(d.id) FILTER (WHERE d.drift_detected = true) as drift_alerts_count
FROM ai_models m
LEFT JOIN model_drift_metrics d ON m.id = d.model_id
GROUP BY m.id;

COMMIT;

--  Migration complete!
--  New tables added:
-- hazard_types (master reference)
-- ai_models (model registry)
-- ai_predictions (prediction storage)
-- model_drift_metrics (drift detection)
-- training_jobs (training pipeline)
-- password_reset_tokens (password reset)
--  Existing tables extended:
-- alert_subscriptions (WhatsApp support)
-- reports (report_number trigger ensured)
--  Views created:
-- v_active_predictions
-- v_model_performance
