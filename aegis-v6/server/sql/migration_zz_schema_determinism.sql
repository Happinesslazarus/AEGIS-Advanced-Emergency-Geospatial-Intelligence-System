-- AEGIS v6.11 — Deterministic, Production-Safe Schema Reconciliation
-- Purpose:
--   1) Normalize duplicated table definitions across legacy migrations
--   2) Enforce idempotent, reproducible structure for critical runtime tables
--   3) Remove dependency on manual post-migration fixes

BEGIN;

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ai_predictions (canonical)
CREATE TABLE IF NOT EXISTS ai_predictions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    hazard_type VARCHAR(50) NOT NULL,
    region_id VARCHAR(100) NOT NULL,
    probability NUMERIC(5,4) NOT NULL CHECK (probability BETWEEN 0 AND 1),
    risk_level VARCHAR(50) NOT NULL,
    confidence NUMERIC(6,4) NOT NULL CHECK (confidence BETWEEN 0 AND 100),
    predicted_peak_time TIMESTAMPTZ,
    input_coordinates GEOMETRY(Point, 4326),
    affected_area GEOMETRY(Polygon, 4326),
    affected_radius_km NUMERIC(8,2),
    model_id UUID,
    model_version VARCHAR(100) NOT NULL,
    prediction_response JSONB NOT NULL DEFAULT '{}'::jsonb,
    contributing_factors JSONB NOT NULL DEFAULT '[]'::jsonb,
    input_features JSONB,
    data_sources TEXT[] NOT NULL DEFAULT '{}'::text[],
    requested_by UUID,
    execution_time_ms INTEGER NOT NULL DEFAULT 0,
    predicted_label VARCHAR(64),
    predicted_severity VARCHAR(64),
    top_shap_contributors JSONB,
    input_feature_summary_hash VARCHAR(128),
    generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE ai_predictions ADD COLUMN IF NOT EXISTS predicted_label VARCHAR(64);
ALTER TABLE ai_predictions ADD COLUMN IF NOT EXISTS predicted_severity VARCHAR(64);
ALTER TABLE ai_predictions ADD COLUMN IF NOT EXISTS top_shap_contributors JSONB;
ALTER TABLE ai_predictions ADD COLUMN IF NOT EXISTS input_feature_summary_hash VARCHAR(128);
ALTER TABLE ai_predictions ADD COLUMN IF NOT EXISTS generated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE ai_predictions ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE ai_predictions ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
ALTER TABLE ai_predictions ADD COLUMN IF NOT EXISTS data_sources TEXT[] NOT NULL DEFAULT '{}'::text[];

CREATE INDEX IF NOT EXISTS idx_ai_predictions_hazard_region_generated
    ON ai_predictions (hazard_type, region_id, generated_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_predictions_model_trace
    ON ai_predictions (hazard_type, region_id, model_version, generated_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_predictions_expires
    ON ai_predictions (expires_at, generated_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_predictions_input_hash
    ON ai_predictions (input_feature_summary_hash, generated_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_predictions_input_coordinates
    ON ai_predictions USING GIST (input_coordinates)
    WHERE input_coordinates IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ai_predictions_affected_area
    ON ai_predictions USING GIST (affected_area)
    WHERE affected_area IS NOT NULL;

-- model_monitoring_snapshots (canonical)
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

-- alerts + alert_delivery_log (canonical)
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS deleted_by UUID;

CREATE TABLE IF NOT EXISTS alert_delivery_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    alert_id UUID NOT NULL,
    channel VARCHAR(50) NOT NULL,
    recipient VARCHAR(255),
    provider_id VARCHAR(255),
    status VARCHAR(50) NOT NULL DEFAULT 'pending',
    error_message TEXT,
    retry_count INTEGER NOT NULL DEFAULT 0,
    last_retry_at TIMESTAMPTZ,
    sent_at TIMESTAMPTZ,
    delivered_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE alert_delivery_log ADD COLUMN IF NOT EXISTS retry_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE alert_delivery_log ADD COLUMN IF NOT EXISTS last_retry_at TIMESTAMPTZ;
ALTER TABLE alert_delivery_log ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ;
ALTER TABLE alert_delivery_log ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'fk_alert_delivery_log_alert'
          AND conrelid = 'alert_delivery_log'::regclass
    ) THEN
        ALTER TABLE alert_delivery_log
            ADD CONSTRAINT fk_alert_delivery_log_alert
            FOREIGN KEY (alert_id) REFERENCES alerts(id) ON DELETE CASCADE;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_alert_delivery_alert_id ON alert_delivery_log (alert_id);
CREATE INDEX IF NOT EXISTS idx_alert_delivery_status ON alert_delivery_log (status);
CREATE INDEX IF NOT EXISTS idx_alert_delivery_channel ON alert_delivery_log (channel);
CREATE INDEX IF NOT EXISTS idx_alert_delivery_created ON alert_delivery_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alert_delivery_recipient ON alert_delivery_log (recipient);
CREATE INDEX IF NOT EXISTS idx_alert_delivery_pending ON alert_delivery_log (created_at ASC)
    WHERE status IN ('pending', 'failed');

-- distress_calls (canonical)
CREATE TABLE IF NOT EXISTS distress_calls (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    citizen_id UUID,
    citizen_name VARCHAR(255),
    region_id VARCHAR(50) NOT NULL DEFAULT 'aberdeen_scotland_uk',
    activated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at TIMESTAMPTZ,
    initial_lat DOUBLE PRECISION,
    initial_lng DOUBLE PRECISION,
    current_lat DOUBLE PRECISION,
    current_lng DOUBLE PRECISION,
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    location_history JSONB NOT NULL DEFAULT '[]'::jsonb,
    status VARCHAR(20) NOT NULL DEFAULT 'active',
    priority VARCHAR(20) NOT NULL DEFAULT 'high',
    assigned_operator_id UUID,
    flood_zone_at_activation VARCHAR(200),
    river_level_at_activation DOUBLE PRECISION,
    nearest_shelter_at_activation JSONB,
    citizen_battery_level INTEGER,
    is_moving BOOLEAN NOT NULL DEFAULT false,
    is_vulnerable BOOLEAN NOT NULL DEFAULT false,
    message TEXT,
    contact_number VARCHAR(50),
    accuracy DOUBLE PRECISION,
    heading DOUBLE PRECISION,
    speed DOUBLE PRECISION,
    triage_level VARCHAR(20),
    acknowledged_by UUID,
    acknowledged_at TIMESTAMPTZ,
    resolved_by UUID,
    resolution TEXT,
    notes TEXT,
    resolution_notes TEXT,
    last_gps_at TIMESTAMPTZ,
    last_update_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE distress_calls ADD COLUMN IF NOT EXISTS citizen_name VARCHAR(255);
ALTER TABLE distress_calls ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION;
ALTER TABLE distress_calls ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION;
ALTER TABLE distress_calls ADD COLUMN IF NOT EXISTS message TEXT;
ALTER TABLE distress_calls ADD COLUMN IF NOT EXISTS contact_number VARCHAR(50);
ALTER TABLE distress_calls ADD COLUMN IF NOT EXISTS is_vulnerable BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE distress_calls ADD COLUMN IF NOT EXISTS accuracy DOUBLE PRECISION;
ALTER TABLE distress_calls ADD COLUMN IF NOT EXISTS heading DOUBLE PRECISION;
ALTER TABLE distress_calls ADD COLUMN IF NOT EXISTS speed DOUBLE PRECISION;
ALTER TABLE distress_calls ADD COLUMN IF NOT EXISTS last_gps_at TIMESTAMPTZ;
ALTER TABLE distress_calls ADD COLUMN IF NOT EXISTS acknowledged_by UUID;
ALTER TABLE distress_calls ADD COLUMN IF NOT EXISTS acknowledged_at TIMESTAMPTZ;
ALTER TABLE distress_calls ADD COLUMN IF NOT EXISTS triage_level VARCHAR(20);
ALTER TABLE distress_calls ADD COLUMN IF NOT EXISTS resolved_by UUID;
ALTER TABLE distress_calls ADD COLUMN IF NOT EXISTS resolution TEXT;

CREATE INDEX IF NOT EXISTS idx_distress_calls_status ON distress_calls (status);
CREATE INDEX IF NOT EXISTS idx_distress_calls_active ON distress_calls (status)
    WHERE status IN ('active', 'acknowledged', 'responding');
CREATE INDEX IF NOT EXISTS idx_distress_calls_citizen ON distress_calls (citizen_id);
CREATE INDEX IF NOT EXISTS idx_distress_calls_region ON distress_calls (region_id);
CREATE INDEX IF NOT EXISTS idx_distress_calls_activated_at ON distress_calls (activated_at DESC);

-- reports + community tables (canonical)
ALTER TABLE reports ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE reports ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE reports ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS deleted_by UUID;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'reports_ai_confidence_check'
          AND conrelid = 'reports'::regclass
    ) THEN
        ALTER TABLE reports
            ADD CONSTRAINT reports_ai_confidence_check
            CHECK (ai_confidence BETWEEN 0 AND 100);
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS account_deletion_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    citizen_id UUID,
    citizen_email VARCHAR(255),
    citizen_name VARCHAR(255),
    action VARCHAR(100) NOT NULL,
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE account_deletion_log ADD COLUMN IF NOT EXISTS details JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE account_deletion_log ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'fk_account_deletion_log_citizen'
          AND conrelid = 'account_deletion_log'::regclass
    ) THEN
        ALTER TABLE account_deletion_log
            ADD CONSTRAINT fk_account_deletion_log_citizen
            FOREIGN KEY (citizen_id) REFERENCES citizens(id) ON DELETE CASCADE;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_account_deletion_log_citizen ON account_deletion_log (citizen_id);
CREATE INDEX IF NOT EXISTS idx_account_deletion_log_created ON account_deletion_log (created_at DESC);

CREATE TABLE IF NOT EXISTS community_reports (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    reporter_id UUID NOT NULL,
    reporter_type VARCHAR(20) NOT NULL DEFAULT 'citizen',
    target_type VARCHAR(50) NOT NULL,
    target_id UUID NOT NULL,
    reason TEXT NOT NULL,
    details TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    admin_action TEXT,
    reviewed_by UUID,
    reviewed_at TIMESTAMPTZ,
    resolved_by UUID,
    resolved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE community_reports ADD COLUMN IF NOT EXISTS admin_action TEXT;
ALTER TABLE community_reports ADD COLUMN IF NOT EXISTS reviewed_by UUID;
ALTER TABLE community_reports ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;
ALTER TABLE community_reports ADD COLUMN IF NOT EXISTS resolved_by UUID;
ALTER TABLE community_reports ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_community_reports_status ON community_reports (status);
CREATE INDEX IF NOT EXISTS idx_community_reports_target ON community_reports (target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_community_reports_created ON community_reports (created_at DESC);

CREATE TABLE IF NOT EXISTS community_post_reports (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    post_id UUID NOT NULL,
    reporter_id UUID NOT NULL,
    reason VARCHAR(100) NOT NULL,
    details TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (post_id, reporter_id)
);

CREATE INDEX IF NOT EXISTS idx_post_reports_post ON community_post_reports (post_id);
CREATE INDEX IF NOT EXISTS idx_post_reports_reporter ON community_post_reports (reporter_id);

-- audit_log (canonical)
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS operator_id UUID;
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS operator_name VARCHAR(100);
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS target_type VARCHAR(50);
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS target_id VARCHAR(100);
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS before_state JSONB;
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS after_state JSONB;
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS ip_address VARCHAR(45);
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS user_agent TEXT;
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_operator ON audit_log (operator_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_action_type ON audit_log (action_type);
CREATE INDEX IF NOT EXISTS idx_audit_log_target ON audit_log (target_type, target_id)
    WHERE target_type IS NOT NULL;

COMMIT;
