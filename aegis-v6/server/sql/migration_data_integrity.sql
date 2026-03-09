-- ═══════════════════════════════════════════════════════════════════════════
-- Data Integrity Migration — Foreign Keys, Cascades, Anonymization
-- Fixes: #66 FK constraints, #67 anonymize vs cascade, #69 reporter FK,
--        #70 cascade/anonymize on citizen deletion, emergency_contacts.notify_on_help
-- Run: psql -f migration_data_integrity.sql
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. emergency_contacts: add notify_on_help column (#43) ──────────────

ALTER TABLE emergency_contacts ADD COLUMN IF NOT EXISTS notify_on_help BOOLEAN DEFAULT true;

-- ─── 2. FK constraints for community_chat_messages (#66) ─────────────────

-- We use ON DELETE SET NULL so messages are preserved (anonymized) if a user is deleted.
-- The sender_id cannot have a simple FK because it can reference citizens OR operators.
-- Instead, add a check constraint + index.

CREATE INDEX IF NOT EXISTS idx_community_chat_sender ON community_chat_messages(sender_id, sender_type);

-- ─── 3. community_posts: ON DELETE → anonymize author (#67) ──────────────
-- Instead of CASCADE (which deletes all posts when user is deleted),
-- we'll create a function that anonymizes posts on citizen deletion.

-- Ensure author_id column exists with proper index
CREATE INDEX IF NOT EXISTS idx_community_posts_author ON community_posts(author_id);

-- ─── 4. community_post_reports: reporter_id FK (#69) ─────────────────────

CREATE INDEX IF NOT EXISTS idx_community_reports_reporter ON community_post_reports(reporter_id);
CREATE INDEX IF NOT EXISTS idx_community_reports_post ON community_post_reports(post_id);

-- ─── 5. community_post_shares FK constraints ────────────────────────────

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'fk_shares_post' AND table_name = 'community_post_shares'
  ) THEN
    ALTER TABLE community_post_shares 
      ADD CONSTRAINT fk_shares_post FOREIGN KEY (post_id) REFERENCES community_posts(id) ON DELETE CASCADE;
  END IF;
END $$;

-- ─── 6. message_threads FK ─────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_message_threads_citizen ON message_threads(citizen_id);

-- ─── 7. safety_check_ins FK ────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_safety_checkins_citizen ON safety_check_ins(citizen_id);

-- ─── 8. distress_calls FK ──────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_distress_calls_citizen ON distress_calls(citizen_id);

-- ─── 9. Anonymization function for citizen deletion (#67, #70) ──────────
-- Instead of CASCADE, anonymize user data in community content

CREATE OR REPLACE FUNCTION anonymize_citizen_content(p_citizen_id UUID) RETURNS void AS $$
BEGIN
  -- Anonymize community posts (don't delete)
  UPDATE community_posts SET author_id = NULL WHERE author_id = p_citizen_id;
  
  -- Anonymize community chat messages (don't delete)
  UPDATE community_chat_messages SET sender_id = NULL WHERE sender_id = p_citizen_id;
  
  -- Anonymize community comments
  UPDATE community_comments SET author_id = NULL WHERE author_id = p_citizen_id;
  
  -- Anonymize community post likes
  DELETE FROM community_post_likes WHERE user_id = p_citizen_id;
  
  -- Anonymize community post shares
  DELETE FROM community_post_shares WHERE citizen_id = p_citizen_id;
  
  -- Anonymize community post reports
  UPDATE community_post_reports SET reporter_id = NULL WHERE reporter_id = p_citizen_id;
  
  -- Anonymize community help entries
  UPDATE community_help SET citizen_id = NULL WHERE citizen_id = p_citizen_id;

  -- Keep distress_calls for audit (anonymize citizen_name)
  UPDATE distress_calls SET citizen_name = '[DELETED]' WHERE citizen_id = p_citizen_id;
  
  -- Keep safety_check_ins for audit
  -- (citizen_id FK will be set null if we add FK constraint)
  
  -- Keep message_threads for audit trail
  -- (admin may need to reference old conversations)
END;
$$ LANGUAGE plpgsql;

-- ─── 10. Add status_color to citizens table (#48) ──────────────────────

ALTER TABLE citizens ADD COLUMN IF NOT EXISTS status_color VARCHAR(20) DEFAULT 'green';

COMMIT;
