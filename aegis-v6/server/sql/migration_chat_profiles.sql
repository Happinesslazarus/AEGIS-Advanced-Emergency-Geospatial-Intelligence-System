-- ═══════════════════════════════════════════════════════════════════════════════
--  AEGIS v6.8 — Enhanced Chat, Profile & Vulnerability System (ADDITIVE ONLY)
-- ═══════════════════════════════════════════════════════════════════════════════

BEGIN;

-- §1 ADD VULNERABILITY + BIO + COUNTRY COLUMNS TO CITIZENS
ALTER TABLE citizens ADD COLUMN IF NOT EXISTS is_vulnerable BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE citizens ADD COLUMN IF NOT EXISTS vulnerability_details TEXT;
ALTER TABLE citizens ADD COLUMN IF NOT EXISTS bio TEXT;
ALTER TABLE citizens ADD COLUMN IF NOT EXISTS country VARCHAR(100) DEFAULT 'United Kingdom';
ALTER TABLE citizens ADD COLUMN IF NOT EXISTS city VARCHAR(100);
ALTER TABLE citizens ADD COLUMN IF NOT EXISTS address_line VARCHAR(255);
ALTER TABLE citizens ADD COLUMN IF NOT EXISTS date_of_birth DATE;

-- §2 ADD MESSAGE STATUS COLUMNS (sent/delivered/read)
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'message_status_enum') THEN
        CREATE TYPE message_status_enum AS ENUM ('sent', 'delivered', 'read');
    END IF;
END $$;

ALTER TABLE messages ADD COLUMN IF NOT EXISTS status message_status_enum NOT NULL DEFAULT 'sent';
ALTER TABLE messages ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ;

-- §3 ADD TYPING INDICATOR & ONLINE STATUS TRACKING
CREATE TABLE IF NOT EXISTS user_presence (
    user_id     UUID        PRIMARY KEY,
    user_type   VARCHAR(20) NOT NULL DEFAULT 'citizen',
    is_online   BOOLEAN     NOT NULL DEFAULT false,
    last_seen   TIMESTAMPTZ NOT NULL DEFAULT now(),
    socket_id   VARCHAR(50)
);

-- §4 ADD EMERGENCY FLAG TO THREADS
ALTER TABLE message_threads ADD COLUMN IF NOT EXISTS is_emergency BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE message_threads ADD COLUMN IF NOT EXISTS auto_escalated BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE message_threads ADD COLUMN IF NOT EXISTS escalation_keywords TEXT[];

-- §5 INDEX FOR VULNERABLE CITIZENS (priority)
CREATE INDEX IF NOT EXISTS idx_citizens_vulnerable
    ON citizens (is_vulnerable) WHERE is_vulnerable = true AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_message_threads_emergency
    ON message_threads (is_emergency, status) WHERE is_emergency = true;

CREATE INDEX IF NOT EXISTS idx_user_presence_online
    ON user_presence (is_online) WHERE is_online = true;

COMMIT;
