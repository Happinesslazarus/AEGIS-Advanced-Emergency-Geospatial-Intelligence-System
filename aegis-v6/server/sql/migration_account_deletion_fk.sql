-- Migration: Referential integrity + FTS index for community chat
-- Run once against the aegis database.

-- Add FK constraint: account_deletion_log.citizen_id → citizens.id
-- ON DELETE CASCADE so deleting a citizen cleans up log rows automatically
ALTER TABLE account_deletion_log
  DROP CONSTRAINT IF EXISTS fk_account_deletion_log_citizen;

ALTER TABLE account_deletion_log
  ADD CONSTRAINT fk_account_deletion_log_citizen
  FOREIGN KEY (citizen_id) REFERENCES citizens(id) ON DELETE CASCADE;

-- Full-text search index for community chat message content
-- Allows fast keyword search across the messages table
CREATE INDEX IF NOT EXISTS idx_community_chat_messages_content_fts
  ON community_chat_messages USING GIN(to_tsvector('english', COALESCE(content, '')));
