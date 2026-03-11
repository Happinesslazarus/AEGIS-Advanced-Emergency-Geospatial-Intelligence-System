-- Migration: Add custom_fields JSONB column to reports table
-- Stores incident-specific form fields (water depth, smoke intensity, etc.)
-- Safe to run multiple times (IF NOT EXISTS guard via column check)

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'reports' AND column_name = 'custom_fields'
  ) THEN
    ALTER TABLE reports ADD COLUMN custom_fields JSONB NOT NULL DEFAULT '{}'::jsonb;
    CREATE INDEX IF NOT EXISTS idx_reports_custom_fields ON reports USING GIN (custom_fields);
    RAISE NOTICE 'custom_fields column added to reports table';
  ELSE
    RAISE NOTICE 'custom_fields column already exists, skipping';
  END IF;
END $$;
