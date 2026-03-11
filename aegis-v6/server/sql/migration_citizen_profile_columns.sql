-- Migration: Add missing citizen profile columns and account deletion support
-- Date: 2026-03-10
-- Description: Adds is_vulnerable, vulnerability_details, country, city,
--   date_of_birth, bio, address_line, deletion_requested_at, deletion_scheduled_at
--   to citizens table. Creates account_deletion_log table.
-- Safe to re-run (uses IF NOT EXISTS / ADD COLUMN IF NOT EXISTS).

-- ─── Citizens table columns ───────────────────────────────────────────────────
ALTER TABLE citizens ADD COLUMN IF NOT EXISTS is_vulnerable BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE citizens ADD COLUMN IF NOT EXISTS vulnerability_details TEXT;
ALTER TABLE citizens ADD COLUMN IF NOT EXISTS country VARCHAR(100) DEFAULT 'United Kingdom';
ALTER TABLE citizens ADD COLUMN IF NOT EXISTS city VARCHAR(100);
ALTER TABLE citizens ADD COLUMN IF NOT EXISTS date_of_birth DATE;
ALTER TABLE citizens ADD COLUMN IF NOT EXISTS bio VARCHAR(500);
ALTER TABLE citizens ADD COLUMN IF NOT EXISTS address_line VARCHAR(200);
ALTER TABLE citizens ADD COLUMN IF NOT EXISTS deletion_requested_at TIMESTAMPTZ;
ALTER TABLE citizens ADD COLUMN IF NOT EXISTS deletion_scheduled_at TIMESTAMPTZ;

-- ─── Account deletion audit log ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS account_deletion_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  citizen_id UUID REFERENCES citizens(id),
  citizen_email VARCHAR(255),
  citizen_name VARCHAR(255),
  action VARCHAR(100) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for quick lookup by citizen
CREATE INDEX IF NOT EXISTS idx_account_deletion_log_citizen
  ON account_deletion_log(citizen_id);
