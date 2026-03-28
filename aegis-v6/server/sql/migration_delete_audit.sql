-- Migration: Add deletion audit columns to community_chat_messages
-- These columns store who deleted a message and why (for admin moderation audit trail)

DO $$
BEGIN
	ALTER TABLE community_chat_messages ADD COLUMN IF NOT EXISTS deleted_by UUID;
	ALTER TABLE community_chat_messages ADD COLUMN IF NOT EXISTS delete_reason TEXT;
EXCEPTION WHEN undefined_table THEN
	RAISE NOTICE 'community_chat_messages not present; skipping delete-audit columns.';
END $$;
