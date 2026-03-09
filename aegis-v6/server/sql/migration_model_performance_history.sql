-- Migration: Model performance history tracking (M17)
-- Stores hourly snapshots of model metrics for trend graphs and SLA monitoring.

CREATE TABLE IF NOT EXISTS model_performance_history (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    model_name      VARCHAR(100) NOT NULL,
    model_version   VARCHAR(50)  NOT NULL,
    measurement_hour TIMESTAMPTZ NOT NULL,
    accuracy        NUMERIC(5,4),
    precision_score NUMERIC(5,4),
    recall          NUMERIC(5,4),
    f1_score        NUMERIC(5,4),
    prediction_count INTEGER     DEFAULT 0,
    avg_latency_ms  NUMERIC(8,2),
    drift_detected  BOOLEAN     DEFAULT false,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_perf_history_model_hour
    ON model_performance_history(model_name, measurement_hour DESC);

CREATE INDEX IF NOT EXISTS idx_perf_history_model_name
    ON model_performance_history(model_name, created_at DESC);

-- View: latest metrics per model (convenient for dashboard queries)
CREATE OR REPLACE VIEW model_latest_performance AS
SELECT DISTINCT ON (model_name)
    model_name, model_version, measurement_hour,
    accuracy, precision_score, recall, f1_score,
    prediction_count, avg_latency_ms, drift_detected
FROM model_performance_history
ORDER BY model_name, measurement_hour DESC;
