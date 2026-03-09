-- ═══════════════════════════════════════════════════════════════════════════════
--  AEGIS — Family/Group Safety Feature (#37)
--  Allows citizens to create safety groups (family, neighbours, etc.)
--  and track each other's safety check-in status.
-- ═══════════════════════════════════════════════════════════════════════════════

BEGIN;

-- §1 SAFETY GROUPS TABLE
CREATE TABLE IF NOT EXISTS safety_groups (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name            VARCHAR(100) NOT NULL,
    created_by      UUID NOT NULL REFERENCES citizens(id) ON DELETE CASCADE,
    invite_code     VARCHAR(20) NOT NULL UNIQUE,
    description     TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- §2 GROUP MEMBERS TABLE
CREATE TABLE IF NOT EXISTS safety_group_members (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    group_id    UUID NOT NULL REFERENCES safety_groups(id) ON DELETE CASCADE,
    citizen_id  UUID NOT NULL REFERENCES citizens(id) ON DELETE CASCADE,
    role        VARCHAR(20) NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
    joined_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(group_id, citizen_id)
);

CREATE INDEX IF NOT EXISTS idx_safety_group_members_group ON safety_group_members(group_id);
CREATE INDEX IF NOT EXISTS idx_safety_group_members_citizen ON safety_group_members(citizen_id);
CREATE INDEX IF NOT EXISTS idx_safety_groups_invite ON safety_groups(invite_code);

-- §3 ADD safety_checkin_interval_hours to citizen_preferences
ALTER TABLE citizen_preferences ADD COLUMN IF NOT EXISTS safety_checkin_interval_hours INTEGER DEFAULT 24;

COMMIT;
