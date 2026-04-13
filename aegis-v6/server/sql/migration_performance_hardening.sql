--  AEGIS v6.9 — Performance & Integrity Hardening Migration
--  Changes:
--    1. schema_migrations tracking table — idempotent migration bookkeeping
--    2. ai_confidence column type fix: INTEGER → NUMERIC(5,2) (supports 0-100.00)
--    3. Composite indexes for high-frequency dashboard queries
--    4. Partial indexes for active-record hot paths (avoid full scans on deleted rows)
--    5. FK support indexes (prevents sequential scans on joins)
--    6. Spatial partial index for active reports only
--  Fully idempotent — safe to run multiple times.
--  Prerequisites: schema.sql + all prior migrations must have been applied.
--  Usage:
--    psql -U postgres -d aegis -f migration_performance_hardening.sql

BEGIN;

--  1. Schema migrations tracking
-- Provides a canonical record of which migrations have executed,
-- preventing accidental double-runs and enabling CI/CD checks.

CREATE TABLE IF NOT EXISTS schema_migrations (
    name             VARCHAR(200)  PRIMARY KEY,
    applied_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),
    checksum         CHAR(64),           -- SHA-256 of the file content (optional)
    applied_by       VARCHAR(100)  DEFAULT current_user
);

COMMENT ON TABLE schema_migrations IS
    'Tracks every migration that has been applied to this database instance.';

-- Self-register this migration
INSERT INTO schema_migrations (name)
VALUES ('migration_performance_hardening')
ON CONFLICT (name) DO NOTHING;

--  2. ai_confidence type upgrade
-- The original INTEGER type forces confidence values (0–100) to be stored as
-- whole-number percentages, losing precision for AI model outputs like 87.34.
-- NUMERIC(5,2) stores values up to 999.99 with 2 decimal places, accommodating
-- the 0–100 scale with fractional precision while remaining compatible with
-- all existing CHECK constraints.

DO $$
BEGIN
    -- Only alter if the column is still INTEGER (guard against re-runs)
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE  table_name  = 'reports'
        AND    column_name = 'ai_confidence'
        AND    data_type   = 'integer'
    ) THEN
        -- Drop the existing CHECK constraint first (it gets recreated below)
        ALTER TABLE reports
            DROP CONSTRAINT IF EXISTS reports_ai_confidence_check;

        ALTER TABLE reports
            ALTER COLUMN ai_confidence
            TYPE NUMERIC(5,2)
            USING ai_confidence::NUMERIC(5,2);

        -- Re-add the range constraint
        ALTER TABLE reports
            ADD CONSTRAINT reports_ai_confidence_check
            CHECK (ai_confidence BETWEEN 0 AND 100);

        RAISE NOTICE 'ai_confidence column upgraded from INTEGER to NUMERIC(5,2)';
    ELSE
        RAISE NOTICE 'ai_confidence already NUMERIC — skipping type change';
    END IF;
END;
$$;

--  3. Composite indexes for dashboard hot paths

-- Operator triage view: unresolved reports by severity, newest first
CREATE INDEX IF NOT EXISTS idx_reports_status_severity_created
    ON reports (status, severity, created_at DESC)
    WHERE deleted_at IS NULL;

-- Assigned-to operator workload view (FK join support + filter)
CREATE INDEX IF NOT EXISTS idx_reports_assigned_status
    ON reports (assigned_to, status)
    WHERE deleted_at IS NULL AND assigned_to IS NOT NULL;

-- Analytics: hazard-type breakdown over time
CREATE INDEX IF NOT EXISTS idx_reports_type_created
    ON reports (incident_category, created_at DESC)
    WHERE deleted_at IS NULL;

-- Alert filtering for active notifications (status + severity)
CREATE INDEX IF NOT EXISTS idx_alerts_status_severity
    ON alerts (is_active, severity, created_at DESC)
    WHERE is_active = true;

-- AI execution audit: most recent executions per model
CREATE INDEX IF NOT EXISTS idx_ai_executions_model_created
    ON ai_executions (model_name, created_at DESC);

--  4. Partial indexes for active-record hot paths
-- Standard indexes include deleted/resolved rows which are rarely queried
-- after the fact. Partial indexes reduce index size and improve plan quality.

-- Active reports spatial lookup (map rendering)
DROP INDEX IF EXISTS idx_reports_coordinates_active;
CREATE INDEX IF NOT EXISTS idx_reports_coordinates_active
    ON reports USING GIST (coordinates)
    WHERE deleted_at IS NULL AND status NOT IN ('resolved', 'archived');

-- Active alerts by expiry (push notification sweeper)
CREATE INDEX IF NOT EXISTS idx_alerts_active_not_expired
    ON alerts (expires_at ASC)
    WHERE is_active = true AND expires_at IS NOT NULL;

-- Pending deliveries (retry queue scan)
CREATE INDEX IF NOT EXISTS idx_alert_delivery_pending
    ON alert_delivery_log (created_at ASC)
    WHERE status IN ('pending', 'failed');

-- Active flood predictions for map overlay
CREATE INDEX IF NOT EXISTS idx_flood_predictions_active_expires
    ON flood_predictions (expires_at DESC)
    WHERE pre_alert_sent = false;

--  5. FK support indexes (prevent sequential scans on FK joins)

-- reports.assigned_to → operators(id)
CREATE INDEX IF NOT EXISTS idx_reports_fk_assigned_to
    ON reports (assigned_to)
    WHERE assigned_to IS NOT NULL;

-- reports.verified_by → operators(id)
CREATE INDEX IF NOT EXISTS idx_reports_fk_verified_by
    ON reports (verified_by)
    WHERE verified_by IS NOT NULL;

-- activity_log.report_id → reports(id)  (already has idx_activity_log_report)
-- audit_log.operator_id (already indexed)

-- alert_delivery_log.alert_id → alerts(id)
CREATE INDEX IF NOT EXISTS idx_alert_delivery_fk_alert
    ON alert_delivery_log (alert_id);

-- report_media.report_id → reports(id)  (already indexed)

-- prediction_records geographic bounding box queries
CREATE INDEX IF NOT EXISTS idx_prediction_records_bbox
    ON prediction_records USING GIST (coordinates)
    WHERE coordinates IS NOT NULL;

--  6. Cluster hint for time-series tables
-- activity_log is append-only and queried by recency — clustering on created_at
-- improves sequential scans on recent activity feeds. This is a one-time hint
-- (CLUSTER is not persistent across writes but helps on freshly loaded data).
-- Uncomment to run during a low-traffic maintenance window:
-- CLUSTER activity_log USING idx_activity_log_created;

--  7. Analyse updated tables
-- Refreshes planner statistics after index changes so the query planner
-- immediately benefits from the new indexes.
ANALYZE reports;
ANALYZE alerts;
ANALYZE ai_executions;
ANALYZE alert_delivery_log;
ANALYZE flood_predictions;
ANALYZE prediction_records;

COMMIT;

--  Verification query (run manually to confirm)
-- SELECT migration_name, applied_at FROM schema_migrations ORDER BY applied_at;
-- SELECT column_name, data_type, numeric_precision, numeric_scale
--   FROM information_schema.columns
--  WHERE table_name = 'reports' AND column_name = 'ai_confidence';
