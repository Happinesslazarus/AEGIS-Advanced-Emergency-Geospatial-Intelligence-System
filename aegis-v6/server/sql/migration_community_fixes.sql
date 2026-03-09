-- Community Chat Fixes Migration
-- Adds edited_at column for message editing and reports table for reporting.

-- 1. Add edited_at column to community_chat_messages
ALTER TABLE community_chat_messages ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ DEFAULT NULL;

-- 2. Create community_reports table
CREATE TABLE IF NOT EXISTS community_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id UUID NOT NULL,
  reporter_type VARCHAR(20) NOT NULL DEFAULT 'citizen',
  target_type VARCHAR(30) NOT NULL DEFAULT 'chat_message',
  target_id UUID NOT NULL,
  reason TEXT NOT NULL,
  details TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'open',
  admin_action TEXT,
  reviewed_by UUID,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Index for efficient lookups
CREATE INDEX IF NOT EXISTS idx_community_reports_status ON community_reports (status);
CREATE INDEX IF NOT EXISTS idx_community_reports_target ON community_reports (target_type, target_id);
