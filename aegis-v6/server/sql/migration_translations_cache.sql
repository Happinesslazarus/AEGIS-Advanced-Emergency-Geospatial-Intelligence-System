-- Migration: Create translations_cache table for server-side translation caching
-- Run: psql -U postgres -d aegis -f server/sql/migration_translations_cache.sql

CREATE TABLE IF NOT EXISTS translations_cache (
    id SERIAL PRIMARY KEY,
    source_text TEXT NOT NULL,
    source_text_hash VARCHAR(32),
    source_lang VARCHAR(10) NOT NULL DEFAULT 'auto',
    target_lang VARCHAR(10) NOT NULL,
    translated_text TEXT NOT NULL,
    detected_language VARCHAR(10),
    provider VARCHAR(50) NOT NULL DEFAULT 'azure',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (source_text, source_lang, target_lang)
);

ALTER TABLE translations_cache
    ADD COLUMN IF NOT EXISTS source_text_hash VARCHAR(32);

UPDATE translations_cache
SET source_text_hash = md5(source_text)
WHERE source_text_hash IS NULL;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'translations_cache_source_text_source_lang_target_lang_key'
    ) THEN
        ALTER TABLE translations_cache
            DROP CONSTRAINT translations_cache_source_text_source_lang_target_lang_key;
    END IF;
END $$;

-- Hash-based unique lookup avoids collisions from truncated text keys in older code.
CREATE UNIQUE INDEX IF NOT EXISTS idx_translations_cache_hash_unique
    ON translations_cache (source_text_hash, source_lang, target_lang);

CREATE INDEX IF NOT EXISTS idx_translations_cache_lookup
    ON translations_cache (source_text_hash, source_lang, target_lang);

-- Index for cache cleanup
CREATE INDEX IF NOT EXISTS idx_translations_cache_created
    ON translations_cache (created_at);
