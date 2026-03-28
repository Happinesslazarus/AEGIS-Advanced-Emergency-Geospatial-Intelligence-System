-- migration_missing_tables.sql
-- Fixes P0 database defects: tables referenced in application code but missing from migrations.
-- Must be idempotent (uses IF NOT EXISTS / ADD COLUMN IF NOT EXISTS).

BEGIN;

-- 1. community_chat_messages — previously only created at runtime by socket.ts
CREATE TABLE IF NOT EXISTS community_chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id UUID NOT NULL,
  sender_type VARCHAR(20) NOT NULL DEFAULT 'citizen',
  content TEXT,
  image_url TEXT,
  reply_to_id UUID,
  read_by JSONB DEFAULT '[]'::jsonb,
  deleted_at TIMESTAMPTZ,
  deleted_by UUID,
  delete_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ccm_created_at ON community_chat_messages (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ccm_sender_id ON community_chat_messages (sender_id);
CREATE INDEX IF NOT EXISTS idx_ccm_deleted_at ON community_chat_messages (deleted_at) WHERE deleted_at IS NOT NULL;

-- 2. community_moderation_logs — used by adminCommunityRoutes.ts, never defined
CREATE TABLE IF NOT EXISTS community_moderation_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id UUID NOT NULL,
  action VARCHAR(100) NOT NULL,
  target_type VARCHAR(50) NOT NULL,
  target_id UUID,
  target_user_id UUID,
  reason TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cml_admin_id ON community_moderation_logs (admin_id);
CREATE INDEX IF NOT EXISTS idx_cml_created_at ON community_moderation_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cml_target_user ON community_moderation_logs (target_user_id) WHERE target_user_id IS NOT NULL;

-- 3. distress_location_history — used by distressRoutes.ts, only in test helper
CREATE TABLE IF NOT EXISTS distress_location_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  distress_id UUID NOT NULL,
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  accuracy DOUBLE PRECISION,
  heading DOUBLE PRECISION,
  speed DOUBLE PRECISION,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dlh_distress_id ON distress_location_history (distress_id);
CREATE INDEX IF NOT EXISTS idx_dlh_recorded_at ON distress_location_history (recorded_at DESC);

-- 4. messages table — add columns that socket.ts patches at runtime
DO $$
BEGIN
  ALTER TABLE messages ADD COLUMN IF NOT EXISTS operator_id UUID;
  ALTER TABLE messages ADD COLUMN IF NOT EXISTS image_url TEXT;
  ALTER TABLE messages ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'sent';
  ALTER TABLE messages ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ;
  ALTER TABLE messages ADD COLUMN IF NOT EXISTS attachment_url TEXT;
  ALTER TABLE messages ADD COLUMN IF NOT EXISTS attachment_type VARCHAR(50);
EXCEPTION WHEN undefined_table THEN
  NULL; -- messages table may not exist yet if citizen_system migration hasn't run
END $$;

COMMIT;
