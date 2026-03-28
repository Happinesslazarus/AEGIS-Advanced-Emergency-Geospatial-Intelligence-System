-- Migration: Add incident_type alias for backwards compatibility
-- Date: 2026-03-16
-- 
-- The schema defines 'incident_category' but some code uses 'incident_type'.
-- This migration adds incident_type as a generated column (alias) so both work.
-- 
-- RUN THIS MIGRATION ONCE ON YOUR DATABASE

-- Add incident_type as a generated column that mirrors incident_category
ALTER TABLE reports 
ADD COLUMN IF NOT EXISTS incident_type VARCHAR(50) 
GENERATED ALWAYS AS (incident_category) STORED;

-- Create index on incident_type for query performance
CREATE INDEX IF NOT EXISTS idx_reports_incident_type 
ON reports (incident_type);

-- Also add to alerts table for consistency (if needed for alert queries)
-- The alerts table uses alert_type which serves a similar purpose
-- But let's add an incident_type alias if needed
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'alerts' AND column_name = 'incident_type'
    ) THEN
        ALTER TABLE alerts 
        ADD COLUMN incident_type VARCHAR(50) 
        GENERATED ALWAYS AS (alert_type) STORED;
    END IF;
END $$;

-- Create index on alerts.incident_type
CREATE INDEX IF NOT EXISTS idx_alerts_incident_type 
ON alerts (incident_type);

-- Add helpful comment
COMMENT ON COLUMN reports.incident_type IS 
'Generated column - alias for incident_category. Use incident_category in new code.';

COMMENT ON COLUMN alerts.incident_type IS 
'Generated column - alias for alert_type. Use alert_type in new code.';
