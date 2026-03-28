--  AEGIS v6.9 — Community Features Migration
--  Adds: community_members, community_bans, community_mute, account deletion

BEGIN;

--  Community Members (Join/Leave)
CREATE TABLE IF NOT EXISTS community_members (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL,
    user_type   VARCHAR(20) NOT NULL DEFAULT 'citizen',
    joined_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(user_id)
);
CREATE INDEX IF NOT EXISTS idx_community_members_user ON community_members(user_id);

--  Community Bans (Permanent + Timed)
CREATE TABLE IF NOT EXISTS community_bans (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL,
    user_type   VARCHAR(20) NOT NULL DEFAULT 'citizen',
    banned_by   UUID NOT NULL,
    reason      TEXT,
    is_permanent BOOLEAN NOT NULL DEFAULT false,
    expires_at  TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(user_id)
);
CREATE INDEX IF NOT EXISTS idx_community_bans_user ON community_bans(user_id);
CREATE INDEX IF NOT EXISTS idx_community_bans_expires ON community_bans(expires_at) WHERE expires_at IS NOT NULL;

--  Community Mutes (Typing ban for duration)
CREATE TABLE IF NOT EXISTS community_mutes (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL,
    user_type   VARCHAR(20) NOT NULL DEFAULT 'citizen',
    muted_by    UUID NOT NULL,
    reason      TEXT,
    expires_at  TIMESTAMPTZ NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(user_id)
);
CREATE INDEX IF NOT EXISTS idx_community_mutes_user ON community_mutes(user_id);
CREATE INDEX IF NOT EXISTS idx_community_mutes_expires ON community_mutes(expires_at);

--  Account Deletion Columns on Citizens
ALTER TABLE citizens ADD COLUMN IF NOT EXISTS deletion_requested_at TIMESTAMPTZ;
ALTER TABLE citizens ADD COLUMN IF NOT EXISTS deletion_scheduled_at TIMESTAMPTZ;
ALTER TABLE citizens ADD COLUMN IF NOT EXISTS bio TEXT;

--  Add bio to citizens if not exists
-- (bio may already exist from earlier migration, this is safe)

--  Account Deletion Audit Log
CREATE TABLE IF NOT EXISTS account_deletion_log (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    citizen_id      UUID NOT NULL,
    citizen_email   VARCHAR(255),
    citizen_name    VARCHAR(100),
    action          VARCHAR(50) NOT NULL,
    details         JSONB DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_account_deletion_log_citizen ON account_deletion_log(citizen_id);
CREATE INDEX IF NOT EXISTS idx_account_deletion_log_created ON account_deletion_log(created_at DESC);

--  Community Reports table (if not exists)
CREATE TABLE IF NOT EXISTS community_reports (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reporter_id     UUID NOT NULL,
    reporter_type   VARCHAR(20) NOT NULL DEFAULT 'citizen',
    target_type     VARCHAR(50) NOT NULL,
    target_id       UUID NOT NULL,
    reason          VARCHAR(200) NOT NULL,
    details         TEXT,
    status          VARCHAR(20) NOT NULL DEFAULT 'pending',
    resolved_by     UUID,
    resolved_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_community_reports_target ON community_reports(target_type, target_id);

--  Add edited_at column to community_chat_messages if not exists
DO $$
BEGIN
    ALTER TABLE community_chat_messages ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ;
EXCEPTION WHEN undefined_table THEN
    RAISE NOTICE 'community_chat_messages not present; skipping edited_at column patch.';
END $$;

COMMIT;
