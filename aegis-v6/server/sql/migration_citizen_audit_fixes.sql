-- ═══════════════════════════════════════════════════════════════════════════
-- Citizen Audit Fixes Migration
-- Adds missing columns to support socket.ts distress handlers, password
-- reset flow, and community help citizen tracking.
-- Run: psql -f migration_citizen_audit_fixes.sql
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. distress_calls: add columns used by socket.ts but missing in original migration ──

ALTER TABLE distress_calls ADD COLUMN IF NOT EXISTS citizen_name      VARCHAR(255);
ALTER TABLE distress_calls ADD COLUMN IF NOT EXISTS latitude          DOUBLE PRECISION;
ALTER TABLE distress_calls ADD COLUMN IF NOT EXISTS longitude         DOUBLE PRECISION;
ALTER TABLE distress_calls ADD COLUMN IF NOT EXISTS message           TEXT;
ALTER TABLE distress_calls ADD COLUMN IF NOT EXISTS contact_number    VARCHAR(50);
ALTER TABLE distress_calls ADD COLUMN IF NOT EXISTS is_vulnerable     BOOLEAN DEFAULT false;
ALTER TABLE distress_calls ADD COLUMN IF NOT EXISTS accuracy          DOUBLE PRECISION;
ALTER TABLE distress_calls ADD COLUMN IF NOT EXISTS heading           DOUBLE PRECISION;
ALTER TABLE distress_calls ADD COLUMN IF NOT EXISTS speed             DOUBLE PRECISION;
ALTER TABLE distress_calls ADD COLUMN IF NOT EXISTS last_gps_at       TIMESTAMPTZ;
ALTER TABLE distress_calls ADD COLUMN IF NOT EXISTS acknowledged_by   UUID;
ALTER TABLE distress_calls ADD COLUMN IF NOT EXISTS acknowledged_at   TIMESTAMPTZ;
ALTER TABLE distress_calls ADD COLUMN IF NOT EXISTS triage_level      VARCHAR(20);
ALTER TABLE distress_calls ADD COLUMN IF NOT EXISTS resolved_by       UUID;
ALTER TABLE distress_calls ADD COLUMN IF NOT EXISTS resolution        TEXT;

-- ─── 2. citizens: add password-reset columns ──────────────────────────────

ALTER TABLE citizens ADD COLUMN IF NOT EXISTS reset_token         TEXT;
ALTER TABLE citizens ADD COLUMN IF NOT EXISTS reset_token_expires TIMESTAMPTZ;

-- ─── 3. community_help: add citizen_id FK for tracking who created an entry ──

ALTER TABLE community_help ADD COLUMN IF NOT EXISTS citizen_id UUID;

-- ─── 4. account_deletion_log: ensure GDPR audit table exists ─────────────

CREATE TABLE IF NOT EXISTS account_deletion_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  citizen_id    UUID,
  citizen_email VARCHAR(255),
  citizen_name  VARCHAR(255),
  action        VARCHAR(100) NOT NULL,
  details       JSONB DEFAULT '{}',
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ─── 5. community_post_shares: referenced by communityRoutes but no migration ──

CREATE TABLE IF NOT EXISTS community_post_shares (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id    UUID NOT NULL,
  citizen_id UUID NOT NULL,
  platform   VARCHAR(50),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_community_post_shares_post ON community_post_shares(post_id);
CREATE INDEX IF NOT EXISTS idx_community_post_shares_citizen ON community_post_shares(citizen_id);

COMMIT;
