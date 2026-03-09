-- Community Post Reports Table for AEGIS v6
-- Allows citizens to report inappropriate posts; admins can delete reported posts

CREATE TABLE IF NOT EXISTS community_post_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,
  reporter_id UUID NOT NULL,
  reason VARCHAR(50) NOT NULL,
  details TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(post_id, reporter_id)
);

CREATE INDEX IF NOT EXISTS idx_post_reports_post ON community_post_reports(post_id);
CREATE INDEX IF NOT EXISTS idx_post_reports_reporter ON community_post_reports(reporter_id);
