-- migration_advanced_personalization.sql
-- Advanced AI personalization, cross-session memory, conversation summarization,
-- and behavioral profiling for signed-in citizens and admin operators.
-- Part of the "15 Features" chatbot power upgrade.

-- CITIZEN CHAT MEMORY — Cross-session persistent memory
-- Stores important facts the AI learns about a citizen across sessions.
-- Only for authenticated (signed-in) citizens.

CREATE TABLE IF NOT EXISTS citizen_chat_memory (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    citizen_id      UUID NOT NULL REFERENCES citizens(id) ON DELETE CASCADE,
    memory_type     VARCHAR(30) NOT NULL DEFAULT 'fact',
        -- fact: "Lives in Aberdeen near River Dee"
        -- preference: "Prefers bullet-point responses"
        -- vulnerability: "Has elderly parent with dementia"
        -- location: "Home address is X, workplace is Y"
        -- emergency_contact: "Partner's name is Z"
        -- medical: "Takes insulin, needs power for fridge"
        -- pet: "Has 2 dogs"
        -- context: "Recently experienced flood damage"
    content         TEXT NOT NULL,
    importance      SMALLINT NOT NULL DEFAULT 5 CHECK (importance BETWEEN 1 AND 10),
        -- 1=trivial, 5=normal, 8=important, 10=critical (medical/vulnerability)
    source_session  UUID REFERENCES chat_sessions(id) ON DELETE SET NULL,
    expires_at      TIMESTAMPTZ,  -- NULL = never expires
    last_used_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    use_count       INTEGER NOT NULL DEFAULT 1,
    is_active       BOOLEAN NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_citizen_chat_memory_citizen ON citizen_chat_memory(citizen_id) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_citizen_chat_memory_type ON citizen_chat_memory(citizen_id, memory_type) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_citizen_chat_memory_importance ON citizen_chat_memory(citizen_id, importance DESC) WHERE is_active = true;

-- CONVERSATION SUMMARIES — Auto-generated session summaries
-- When a conversation ends or gets long, the AI generates a summary
-- that is loaded into the next session for continuity.

CREATE TABLE IF NOT EXISTS conversation_summaries (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id      UUID NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
    citizen_id      UUID REFERENCES citizens(id) ON DELETE CASCADE,
    operator_id     UUID REFERENCES operators(id) ON DELETE SET NULL,
    summary         TEXT NOT NULL,
    key_topics      TEXT[] NOT NULL DEFAULT '{}',
    key_entities    JSONB NOT NULL DEFAULT '{}'::jsonb,
        -- { locations: [], hazards: [], people: [], actions_taken: [] }
    sentiment       VARCHAR(20) DEFAULT 'neutral',
        -- positive, neutral, concerned, distressed, critical
    unresolved_questions TEXT[] NOT NULL DEFAULT '{}',
    action_items    TEXT[] NOT NULL DEFAULT '{}',
    message_count   INTEGER NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_conversation_summaries_citizen ON conversation_summaries(citizen_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversation_summaries_session ON conversation_summaries(session_id);

-- CITIZEN BEHAVIOR PROFILE — Adaptive intelligence
-- Tracks behavioral patterns for deep personalization.
-- Updated incrementally after each conversation.

CREATE TABLE IF NOT EXISTS citizen_behavior_profile (
    citizen_id              UUID PRIMARY KEY REFERENCES citizens(id) ON DELETE CASCADE,

    -- Communication preferences (learned)
    preferred_detail_level  VARCHAR(20) NOT NULL DEFAULT 'standard',
        -- brief, standard, detailed, expert
    preferred_tone          VARCHAR(20) NOT NULL DEFAULT 'balanced',
        -- empathetic, balanced, direct, technical
    preferred_language      VARCHAR(10) NOT NULL DEFAULT 'en',
    response_format_pref    VARCHAR(20) NOT NULL DEFAULT 'mixed',
        -- bullets, paragraphs, mixed, numbered

    -- Risk profile
    risk_level              VARCHAR(20) NOT NULL DEFAULT 'standard',
        -- low, standard, elevated, high, critical
    known_vulnerabilities   TEXT[] NOT NULL DEFAULT '{}',
        -- e.g., ['elderly', 'mobility_impaired', 'medical_equipment', 'children', 'pets']
    risk_factors            JSONB NOT NULL DEFAULT '{}'::jsonb,
        -- { flood_zone: true, coastal: false, rural: true, lives_alone: true }

    -- Engagement patterns
    total_sessions          INTEGER NOT NULL DEFAULT 0,
    total_messages          INTEGER NOT NULL DEFAULT 0,
    avg_messages_per_session NUMERIC(5,1) NOT NULL DEFAULT 0,
    primary_topics          TEXT[] NOT NULL DEFAULT '{}',
    topic_frequency         JSONB NOT NULL DEFAULT '{}'::jsonb,
        -- { flood: 12, storm: 5, shelter: 3 }
    peak_activity_hours     INTEGER[] NOT NULL DEFAULT '{}',
        -- hours of day (0-23) when user is most active
    known_locations         JSONB NOT NULL DEFAULT '[]'::jsonb,
        -- [{ name: "Aberdeen", lat: 57.15, lng: -2.09, type: "home" }]

    -- Emotional patterns
    avg_sentiment           VARCHAR(20) NOT NULL DEFAULT 'neutral',
    distress_history        JSONB NOT NULL DEFAULT '[]'::jsonb,
        -- [{ date: "2026-01-15", type: "flood_anxiety", resolved: true }]

    -- Adaptive settings
    proactive_alerts        BOOLEAN NOT NULL DEFAULT true,
    auto_location_share     BOOLEAN NOT NULL DEFAULT false,
    emergency_auto_escalate BOOLEAN NOT NULL DEFAULT true,

    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ADMIN/OPERATOR BEHAVIOR PROFILE — Operational intelligence
-- Tracks operator-specific patterns for admin chatbot enhancement.

CREATE TABLE IF NOT EXISTS operator_behavior_profile (
    operator_id             UUID PRIMARY KEY REFERENCES operators(id) ON DELETE CASCADE,

    -- Role context
    specialization          TEXT[] NOT NULL DEFAULT '{}',
        -- e.g., ['flood_response', 'logistics', 'communications']
    jurisdiction_areas      TEXT[] NOT NULL DEFAULT '{}',
    rank_level              VARCHAR(30) NOT NULL DEFAULT 'operator',

    -- Communication preferences
    preferred_report_format VARCHAR(20) NOT NULL DEFAULT 'sitrep',
        -- sitrep, dashboard, brief, detailed
    preferred_data_depth    VARCHAR(20) NOT NULL DEFAULT 'detailed',
        -- summary, standard, detailed, raw

    -- Operational patterns
    total_sessions          INTEGER NOT NULL DEFAULT 0,
    frequent_queries        JSONB NOT NULL DEFAULT '{}'::jsonb,
        -- { "resource_status": 15, "incident_summary": 12 }
    active_operations       TEXT[] NOT NULL DEFAULT '{}',
    decision_patterns       JSONB NOT NULL DEFAULT '[]'::jsonb,
        -- tracks what data operators request before making decisions

    -- Workflow preferences
    auto_sitrep             BOOLEAN NOT NULL DEFAULT false,
    shift_context_carry     BOOLEAN NOT NULL DEFAULT true,

    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- SMART SUGGESTIONS LOG — Track which suggestions users click

CREATE TABLE IF NOT EXISTS chat_suggestion_clicks (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id      UUID REFERENCES chat_sessions(id) ON DELETE CASCADE,
    citizen_id      UUID REFERENCES citizens(id) ON DELETE SET NULL,
    suggestion_text TEXT NOT NULL,
    category        VARCHAR(30) NOT NULL DEFAULT 'follow_up',
        -- follow_up, quick_action, proactive, topic_suggestion
    clicked_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_suggestion_clicks_citizen ON chat_suggestion_clicks(citizen_id, clicked_at DESC);

-- ADD COLUMNS TO EXISTING TABLES

-- chat_sessions: add summary and personalization context
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'chat_sessions' AND column_name = 'session_summary'
    ) THEN
        ALTER TABLE chat_sessions ADD COLUMN session_summary TEXT;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'chat_sessions' AND column_name = 'personality_snapshot'
    ) THEN
        ALTER TABLE chat_sessions ADD COLUMN personality_snapshot JSONB DEFAULT '{}'::jsonb;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'chat_sessions' AND column_name = 'ended_at'
    ) THEN
        ALTER TABLE chat_sessions ADD COLUMN ended_at TIMESTAMPTZ;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'chat_sessions' AND column_name = 'is_summarized'
    ) THEN
        ALTER TABLE chat_sessions ADD COLUMN is_summarized BOOLEAN DEFAULT false;
    END IF;
END $$;

-- citizens: add preferences JSONB if not exists (for backward compat)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'citizens' AND column_name = 'preferences'
    ) THEN
        ALTER TABLE citizens ADD COLUMN preferences JSONB DEFAULT '{}'::jsonb;
    END IF;
END $$;
