-- ============================================================================
-- MIGRATION: Archive & Soft-Delete System
-- Adds 'archived' and 'false_report' to report_status enum
-- Adds archived_at and deleted_at columns for soft-delete support
-- ============================================================================

-- Add new enum values to report_status (idempotent)
DO $$
BEGIN
    -- Add 'archived' status
    IF NOT EXISTS (
        SELECT 1 FROM pg_enum e
        JOIN pg_type t ON e.enumtypid = t.oid
        WHERE t.typname = 'report_status' AND e.enumlabel = 'archived'
    ) THEN
        ALTER TYPE report_status ADD VALUE 'archived';
    END IF;

    -- Add 'false_report' status
    IF NOT EXISTS (
        SELECT 1 FROM pg_enum e
        JOIN pg_type t ON e.enumtypid = t.oid
        WHERE t.typname = 'report_status' AND e.enumlabel = 'false_report'
    ) THEN
        ALTER TYPE report_status ADD VALUE 'false_report';
    END IF;
END $$;

-- Add archived_at timestamp column
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'reports' AND column_name = 'archived_at'
    ) THEN
        ALTER TABLE reports ADD COLUMN archived_at TIMESTAMPTZ DEFAULT NULL;
    END IF;
END $$;

-- Add deleted_at timestamp column for soft-delete
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'reports' AND column_name = 'deleted_at'
    ) THEN
        ALTER TABLE reports ADD COLUMN deleted_at TIMESTAMPTZ DEFAULT NULL;
    END IF;
END $$;

-- Add false_report_reason column
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'reports' AND column_name = 'false_report_reason'
    ) THEN
        ALTER TABLE reports ADD COLUMN false_report_reason TEXT DEFAULT NULL;
    END IF;
END $$;

-- Index for efficient filtering of active (non-archived, non-deleted) reports
CREATE INDEX IF NOT EXISTS idx_reports_active
    ON reports (created_at DESC)
    WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_reports_archived
    ON reports (archived_at DESC)
    WHERE status = 'archived';

RAISE NOTICE 'Archive system migration complete.';
