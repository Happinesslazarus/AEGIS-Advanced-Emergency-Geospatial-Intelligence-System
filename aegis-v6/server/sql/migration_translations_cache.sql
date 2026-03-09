-- Migration: Create translations_cache table for server-side translation caching
-- Run: psql -U postgres -d aegis -f server/sql/migration_translations_cache.sql

CREATE TABLE IF NOT EXISTS translations_cache (
    id SERIAL PRIMARY KEY,
    source_text TEXT NOT NULL,
    source_lang VARCHAR(10) NOT NULL DEFAULT 'auto',
    target_lang VARCHAR(10) NOT NULL,
    translated_text TEXT NOT NULL,
    detected_language VARCHAR(10),
    provider VARCHAR(50) NOT NULL DEFAULT 'mymemory',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (source_text, source_lang, target_lang)
);

-- Index for lookups
CREATE INDEX IF NOT EXISTS idx_translations_cache_lookup
    ON translations_cache (source_text, source_lang, target_lang);

-- Index for cache cleanup
CREATE INDEX IF NOT EXISTS idx_translations_cache_created
    ON translations_cache (created_at);
