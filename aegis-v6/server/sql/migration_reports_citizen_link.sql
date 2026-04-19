-- Migration: Add citizen_id to reports for GDPR erasure support
-- Date: 2026-04-13
-- Description: Links reports to the submitting citizen so reports can be
--   anonymised when a citizen requests account deletion (GDPR Art. 17).
--   Column is nullable so anonymous/guest reports continue to work.

ALTER TABLE reports ADD COLUMN IF NOT EXISTS
  citizen_id UUID REFERENCES citizens(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_reports_citizen_id
  ON reports(citizen_id) WHERE citizen_id IS NOT NULL;
