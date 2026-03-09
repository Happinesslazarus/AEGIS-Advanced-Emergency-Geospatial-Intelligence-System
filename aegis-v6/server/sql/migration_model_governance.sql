-- ═══════════════════════════════════════════════════════════════════════════════
-- AEGIS Phase 5: Model Governance, Drift Detection, and Automatic Safeguards
-- Migration script — run against the aegis database
-- ═══════════════════════════════════════════════════════════════════════════════

-- §1 Model Governance Registry
-- Every trained model version is tracked with status lifecycle:
-- candidate → active | failed
-- active → archived (when replacedby newer)
-- archived → active (on rollback)
CREATE TABLE IF NOT EXISTS model_governance (
    id              UUID            PRIMARY KEY DEFAULT uuid_generate_v4(),
    model_name      VARCHAR(100)    NOT NULL,
    version         VARCHAR(100)    NOT NULL,
    status          VARCHAR(20)     NOT NULL DEFAULT 'candidate'
                        CHECK (status IN ('active', 'candidate', 'archived', 'failed', 'rollback')),
    artifact_path   TEXT            NOT NULL,
    dataset_hash    VARCHAR(128),
    dataset_size    INTEGER,
    feature_names   JSONB,
    metrics_json    JSONB           NOT NULL DEFAULT '{}'::jsonb,
    training_config JSONB           DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT now(),
    activated_at    TIMESTAMPTZ,
    archived_at     TIMESTAMPTZ,
    created_by      VARCHAR(100)    DEFAULT 'system',
    notes           TEXT,
    UNIQUE(model_name, version)
);

CREATE INDEX IF NOT EXISTS idx_model_governance_name_status
    ON model_governance (model_name, status);
CREATE INDEX IF NOT EXISTS idx_model_governance_active
    ON model_governance (model_name) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_model_governance_created
    ON model_governance (created_at DESC);

-- §2 Prediction Logs
-- Every prediction is logged with input, output, confidence, latency.
-- Supports feedback for human-in-the-loop learning.
CREATE TABLE IF NOT EXISTS prediction_logs (
    id              UUID            PRIMARY KEY DEFAULT uuid_generate_v4(),
    model_name      VARCHAR(100)    NOT NULL,
    model_version   VARCHAR(100)    NOT NULL,
    input_hash      VARCHAR(128),
    input_summary   JSONB,
    prediction      JSONB           NOT NULL,
    confidence      NUMERIC(6,4),
    latency_ms      INTEGER,
    feedback        VARCHAR(50),
    feedback_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_prediction_logs_model
    ON prediction_logs (model_name, model_version, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_prediction_logs_feedback
    ON prediction_logs (model_name) WHERE feedback IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_prediction_logs_created
    ON prediction_logs (created_at DESC);
