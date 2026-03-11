-- ═══════════════════════════════════════════════════════════════════════════════
--  AEGIS v6.7 — Citizen System Schema Extension (ADDITIVE ONLY)
--  PostgreSQL + PostGIS
--
--  Adds tables for citizen authentication, personalized dashboard,
--  safety check-in, two-way messaging, and emergency contacts.
--  DOES NOT modify existing tables — only extends the schema.
-- ═══════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- §1  ENUM TYPES
-- ─────────────────────────────────────────────────────────────────────────────

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'citizen_role') THEN
        CREATE TYPE citizen_role AS ENUM ('citizen', 'verified_citizen', 'community_leader');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'safety_status_enum') THEN
        CREATE TYPE safety_status_enum AS ENUM ('safe', 'help', 'unsure');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'message_sender_type') THEN
        CREATE TYPE message_sender_type AS ENUM ('citizen', 'operator');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'thread_status_enum') THEN
        CREATE TYPE thread_status_enum AS ENUM ('open', 'in_progress', 'resolved', 'closed');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'escalation_status_enum') THEN
        CREATE TYPE escalation_status_enum AS ENUM ('pending', 'acknowledged', 'dispatched', 'resolved');
    END IF;
END $$;


-- ─────────────────────────────────────────────────────────────────────────────
-- §2  CITIZENS TABLE
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS citizens (
    id                  UUID            PRIMARY KEY DEFAULT uuid_generate_v4(),
    email               VARCHAR(255)    NOT NULL,
    password_hash       VARCHAR(255)    NOT NULL,
    display_name        VARCHAR(100)    NOT NULL,
    phone               VARCHAR(20),
    role                citizen_role    NOT NULL DEFAULT 'citizen',
    avatar_url          VARCHAR(500),

    -- Location preferences
    location_lat        DOUBLE PRECISION,
    location_lng        DOUBLE PRECISION,
    preferred_region    VARCHAR(50),

    -- Verification & 2FA
    email_verified      BOOLEAN         NOT NULL DEFAULT false,
    verification_token  VARCHAR(255),
    otp_secret          VARCHAR(255),
    two_factor_enabled  BOOLEAN         NOT NULL DEFAULT false,

    -- Profile details
    is_vulnerable       BOOLEAN         NOT NULL DEFAULT false,
    vulnerability_details TEXT,
    country             VARCHAR(100)    DEFAULT 'United Kingdom',
    city                VARCHAR(100),
    date_of_birth       DATE,
    bio                 VARCHAR(500),
    address_line        VARCHAR(200),

    -- Account state
    is_active           BOOLEAN         NOT NULL DEFAULT true,
    last_login          TIMESTAMPTZ,
    login_count         INTEGER         NOT NULL DEFAULT 0,

    -- Soft-delete / account deletion
    deleted_at          TIMESTAMPTZ,
    deletion_requested_at TIMESTAMPTZ,
    deletion_scheduled_at TIMESTAMPTZ,
    created_at          TIMESTAMPTZ     NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ     NOT NULL DEFAULT now()
);

-- Email must be unique among non-deleted citizens
CREATE UNIQUE INDEX IF NOT EXISTS uq_citizens_email_active
    ON citizens (email) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_citizens_preferred_region
    ON citizens (preferred_region) WHERE deleted_at IS NULL;


-- ─────────────────────────────────────────────────────────────────────────────
-- §3  CITIZEN PREFERENCES TABLE
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS citizen_preferences (
    citizen_id                  UUID        PRIMARY KEY REFERENCES citizens(id) ON DELETE CASCADE,

    -- Audio alert settings
    audio_alerts_enabled        BOOLEAN     NOT NULL DEFAULT true,
    audio_voice                 VARCHAR(50) DEFAULT 'default',
    audio_volume                FLOAT       NOT NULL DEFAULT 0.8 CHECK (audio_volume BETWEEN 0 AND 1),
    auto_play_critical          BOOLEAN     NOT NULL DEFAULT true,

    -- Caption/subtitle settings
    captions_enabled            BOOLEAN     NOT NULL DEFAULT false,
    caption_font_size           VARCHAR(20) DEFAULT 'medium',
    caption_position            VARCHAR(20) DEFAULT 'bottom',

    -- Notification preferences
    notification_channels       TEXT[]      NOT NULL DEFAULT '{web}',
    severity_filter             TEXT[]      NOT NULL DEFAULT '{critical,warning,info}',
    quiet_hours_start           TIME,
    quiet_hours_end             TIME,

    -- Display preferences
    language                    VARCHAR(10) DEFAULT 'en',
    dark_mode                   BOOLEAN     DEFAULT false,
    compact_view                BOOLEAN     DEFAULT false,

    created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- ─────────────────────────────────────────────────────────────────────────────
-- §4  EMERGENCY CONTACTS TABLE
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS emergency_contacts (
    id              UUID            PRIMARY KEY DEFAULT uuid_generate_v4(),
    citizen_id      UUID            NOT NULL REFERENCES citizens(id) ON DELETE CASCADE,
    name            VARCHAR(100)    NOT NULL,
    phone           VARCHAR(20)     NOT NULL,
    relationship    VARCHAR(50),
    is_primary      BOOLEAN         NOT NULL DEFAULT false,
    notify_on_help  BOOLEAN         NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_emergency_contacts_citizen
    ON emergency_contacts (citizen_id);


-- ─────────────────────────────────────────────────────────────────────────────
-- §5  SAFETY STATUS TABLE
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS safety_check_ins (
    id                  UUID                    PRIMARY KEY DEFAULT uuid_generate_v4(),
    citizen_id          UUID                    NOT NULL REFERENCES citizens(id) ON DELETE CASCADE,
    status              safety_status_enum      NOT NULL,
    location_lat        DOUBLE PRECISION,
    location_lng        DOUBLE PRECISION,
    message             TEXT,

    -- Escalation for 'help' status
    escalation_status   escalation_status_enum  DEFAULT 'pending',
    escalated_at        TIMESTAMPTZ,
    acknowledged_by     UUID                    REFERENCES operators(id) ON DELETE SET NULL,
    acknowledged_at     TIMESTAMPTZ,
    resolved_at         TIMESTAMPTZ,
    resolution_notes    TEXT,

    created_at          TIMESTAMPTZ             NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_safety_check_ins_citizen
    ON safety_check_ins (citizen_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_safety_check_ins_escalation
    ON safety_check_ins (escalation_status)
    WHERE escalation_status IN ('pending', 'acknowledged');

CREATE INDEX IF NOT EXISTS idx_safety_check_ins_created
    ON safety_check_ins (created_at DESC);


-- ─────────────────────────────────────────────────────────────────────────────
-- §6  MESSAGE THREADS TABLE
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS message_threads (
    id              UUID                PRIMARY KEY DEFAULT uuid_generate_v4(),
    citizen_id      UUID                NOT NULL REFERENCES citizens(id) ON DELETE CASCADE,
    subject         VARCHAR(200)        NOT NULL,
    status          thread_status_enum  NOT NULL DEFAULT 'open',
    priority        VARCHAR(20)         NOT NULL DEFAULT 'normal',
    assigned_to     UUID                REFERENCES operators(id) ON DELETE SET NULL,

    last_message_at TIMESTAMPTZ,
    citizen_unread  INTEGER             NOT NULL DEFAULT 0,
    operator_unread INTEGER             NOT NULL DEFAULT 0,

    created_at      TIMESTAMPTZ         NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ         NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_message_threads_citizen
    ON message_threads (citizen_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_message_threads_status
    ON message_threads (status)
    WHERE status IN ('open', 'in_progress');

CREATE INDEX IF NOT EXISTS idx_message_threads_assigned
    ON message_threads (assigned_to)
    WHERE assigned_to IS NOT NULL;


-- ─────────────────────────────────────────────────────────────────────────────
-- §7  MESSAGES TABLE
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS messages (
    id              UUID                    PRIMARY KEY DEFAULT uuid_generate_v4(),
    thread_id       UUID                    NOT NULL REFERENCES message_threads(id) ON DELETE CASCADE,
    sender_type     message_sender_type     NOT NULL,
    sender_id       UUID                    NOT NULL,
    content         TEXT                    NOT NULL,
    read_at         TIMESTAMPTZ,
    created_at      TIMESTAMPTZ             NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_messages_thread
    ON messages (thread_id, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_messages_unread
    ON messages (thread_id, read_at)
    WHERE read_at IS NULL;


-- ─────────────────────────────────────────────────────────────────────────────
-- §8  CITIZEN ALERT HISTORY (tracks which alerts a citizen has seen/acted on)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS citizen_alert_history (
    id              UUID            PRIMARY KEY DEFAULT uuid_generate_v4(),
    citizen_id      UUID            NOT NULL REFERENCES citizens(id) ON DELETE CASCADE,
    alert_id        UUID            NOT NULL REFERENCES alerts(id) ON DELETE CASCADE,
    seen_at         TIMESTAMPTZ     NOT NULL DEFAULT now(),
    audio_played    BOOLEAN         NOT NULL DEFAULT false,
    dismissed_at    TIMESTAMPTZ,

    CONSTRAINT uq_citizen_alert UNIQUE (citizen_id, alert_id)
);

CREATE INDEX IF NOT EXISTS idx_citizen_alert_history_citizen
    ON citizen_alert_history (citizen_id, seen_at DESC);


-- ─────────────────────────────────────────────────────────────────────────────
-- §9  TRIGGERS
-- ─────────────────────────────────────────────────────────────────────────────

-- Auto-update updated_at on citizens
DROP TRIGGER IF EXISTS trg_citizens_updated_at ON citizens;
CREATE TRIGGER trg_citizens_updated_at
    BEFORE UPDATE ON citizens
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

-- Auto-update updated_at on citizen_preferences
DROP TRIGGER IF EXISTS trg_citizen_preferences_updated_at ON citizen_preferences;
CREATE TRIGGER trg_citizen_preferences_updated_at
    BEFORE UPDATE ON citizen_preferences
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

-- Auto-update updated_at on message_threads
DROP TRIGGER IF EXISTS trg_message_threads_updated_at ON message_threads;
CREATE TRIGGER trg_message_threads_updated_at
    BEFORE UPDATE ON message_threads
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();


COMMIT;

-- ═══════════════════════════════════════════════════════════════════════════════
-- END OF CITIZEN SYSTEM MIGRATION
-- ═══════════════════════════════════════════════════════════════════════════════
