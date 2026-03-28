-- AEGIS v6 - Model Monitoring Snapshots and Prediction Traceability Extensions

ALTER TABLE ai_predictions
    ADD COLUMN IF NOT EXISTS predicted_label VARCHAR(64),
    ADD COLUMN IF NOT EXISTS predicted_severity VARCHAR(64),
    ADD COLUMN IF NOT EXISTS top_shap_contributors JSONB,
    ADD COLUMN IF NOT EXISTS input_feature_summary_hash VARCHAR(128);

CREATE INDEX IF NOT EXISTS idx_ai_predictions_model_trace
    ON ai_predictions (hazard_type, region_id, model_version, generated_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_predictions_input_hash
    ON ai_predictions (input_feature_summary_hash, generated_at DESC);

CREATE TABLE IF NOT EXISTS model_monitoring_snapshots (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    hazard_type VARCHAR(64) NOT NULL,
    region_id VARCHAR(100) NOT NULL,
    model_version VARCHAR(100) NOT NULL,
    snapshot_time TIMESTAMPTZ NOT NULL,
    sample_count INTEGER NOT NULL DEFAULT 0,
    avg_confidence NUMERIC(8,6) NOT NULL DEFAULT 0,
    prediction_positive_rate NUMERIC(8,6) NOT NULL DEFAULT 0,
    confidence_std NUMERIC(8,6) NOT NULL DEFAULT 0,
    top_feature_means JSONB NOT NULL DEFAULT '{}'::jsonb,
    top_feature_stds JSONB NOT NULL DEFAULT '{}'::jsonb,
    drift_score NUMERIC(8,6) NOT NULL DEFAULT 0,
    alert_level VARCHAR(16) NOT NULL DEFAULT 'HEALTHY',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_model_monitoring_snapshots_lookup
    ON model_monitoring_snapshots (hazard_type, region_id, model_version, snapshot_time DESC);

CREATE INDEX IF NOT EXISTS idx_model_monitoring_snapshots_alert
    ON model_monitoring_snapshots (alert_level, snapshot_time DESC);
