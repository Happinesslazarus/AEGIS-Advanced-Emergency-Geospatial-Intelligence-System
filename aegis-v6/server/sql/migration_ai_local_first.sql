-- migration_ai_local_first.sql
-- AEGIS v6.11 — Local-First AI System Migration
--
-- Adds tables for:
--   §1  Canned replies (admin messaging templates)
--   §2  Token usage log (persistent AI cost tracking)
--   §3  Response cache improvements
--   §4  Chat session enhancements (model routing metadata)

-- §1  CANNED REPLIES — Reusable admin messaging templates
CREATE TABLE IF NOT EXISTS canned_replies (
    id              UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    title           VARCHAR(200)    NOT NULL,
    content         TEXT            NOT NULL,
    category        VARCHAR(50)     NOT NULL DEFAULT 'general',
    shortcut        VARCHAR(20),
    usage_count     INTEGER         NOT NULL DEFAULT 0,
    created_by      UUID,
    deleted_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ     NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_canned_replies_category
    ON canned_replies (category) WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_canned_replies_shortcut
    ON canned_replies (shortcut) WHERE shortcut IS NOT NULL AND deleted_at IS NULL;

-- §2  TOKEN USAGE LOG — Persistent AI invocation tracking for cost dashboard
CREATE TABLE IF NOT EXISTS token_usage_log (
    id              UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    provider        VARCHAR(50)     NOT NULL,
    model           VARCHAR(100)    NOT NULL,
    tokens_used     INTEGER         NOT NULL DEFAULT 0,
    is_local        BOOLEAN         NOT NULL DEFAULT false,
    query_classification VARCHAR(30),
    session_id      UUID,
    latency_ms      INTEGER,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_token_usage_created
    ON token_usage_log (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_token_usage_provider
    ON token_usage_log (provider, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_token_usage_local
    ON token_usage_log (is_local, created_at DESC);

-- §3  RESPONSE CACHE — Ensure the cache table exists with all needed columns
CREATE TABLE IF NOT EXISTS response_cache (
    query_hash      VARCHAR(64)     PRIMARY KEY,
    query_text      TEXT            NOT NULL,
    response_text   TEXT            NOT NULL,
    model_used      VARCHAR(100),
    ttl_seconds     INTEGER         NOT NULL DEFAULT 3600,
    hit_count       INTEGER         NOT NULL DEFAULT 0,
    expires_at      TIMESTAMPTZ     NOT NULL DEFAULT now() + INTERVAL '1 hour',
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT now(),
    embedding_vector vector(768)
);

CREATE INDEX IF NOT EXISTS idx_response_cache_expires
    ON response_cache (expires_at) WHERE expires_at > NOW();

-- HNSW index for fast semantic similarity search on cached queries
CREATE INDEX IF NOT EXISTS idx_response_cache_embedding
    ON response_cache USING hnsw (embedding_vector vector_cosine_ops)
    WHERE embedding_vector IS NOT NULL;

-- §4  CHAT SESSION ENHANCEMENTS
-- Add query classification tracking and model preference columns

ALTER TABLE chat_sessions
    ADD COLUMN IF NOT EXISTS query_classifications JSONB DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS local_ratio NUMERIC(4,3) DEFAULT 0,
    ADD COLUMN IF NOT EXISTS preferred_model VARCHAR(100);

-- Add provider tracking to chat messages
ALTER TABLE chat_messages
    ADD COLUMN IF NOT EXISTS provider VARCHAR(50),
    ADD COLUMN IF NOT EXISTS is_local BOOLEAN DEFAULT false,
    ADD COLUMN IF NOT EXISTS query_classification VARCHAR(30);

-- §5  SEED DATA — Default canned replies for emergency management
INSERT INTO canned_replies (title, content, category, shortcut) VALUES
    ('Emergency Acknowledged',
     'Thank you for reporting this emergency. We have received your message and are coordinating a response. Please stay safe and follow any evacuation instructions. If you are in immediate danger, call emergency services immediately.',
     'emergency', '/ack'),
    ('Shelter Information',
     'Here are the nearest emergency shelters currently accepting evacuees. Please bring essential items: medications, identification, phone charger, and warm clothing. Pets are welcome at designated shelters.',
     'shelter', '/shelter'),
    ('Flood Safety',
     'Flood safety reminders: Move to higher ground immediately. Do NOT walk or drive through flood water. Turn off gas and electricity if safe to do so. If trapped, move to the highest floor and signal from a window.',
     'flood', '/flood'),
    ('Update Request',
     'We are monitoring the situation and will provide updates as new information becomes available. For the latest information, check the AEGIS alerts dashboard or contact emergency services.',
     'general', '/update'),
    ('Thank You & Close',
     'Thank you for your report. This matter has been resolved or referred to the appropriate emergency services. If the situation changes, please don''t hesitate to contact us again. Stay safe.',
     'general', '/close')
ON CONFLICT DO NOTHING;
