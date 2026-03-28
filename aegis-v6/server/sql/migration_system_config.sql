-- AEGIS v6 — System Configuration & First-Run State
-- Stores platform-level key-value configuration persisted across restarts.
-- Used by the first-run onboarding wizard and future admin configuration.
-- Idempotent: safe to re-run on existing deployments.

CREATE TABLE IF NOT EXISTS system_config (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    config_key      VARCHAR(255) NOT NULL,
    config_value    JSONB NOT NULL DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Unique constraint on config_key (idempotent with IF NOT EXISTS)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_system_config_key'
  ) THEN
    ALTER TABLE system_config ADD CONSTRAINT uq_system_config_key UNIQUE (config_key);
  END IF;
END $$;

-- Auto-update updated_at on changes
CREATE OR REPLACE FUNCTION system_config_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_system_config_updated_at ON system_config;
CREATE TRIGGER trg_system_config_updated_at
  BEFORE UPDATE ON system_config
  FOR EACH ROW
  EXECUTE FUNCTION system_config_updated_at();

-- Index for fast key lookups
CREATE INDEX IF NOT EXISTS idx_system_config_key ON system_config (config_key);
