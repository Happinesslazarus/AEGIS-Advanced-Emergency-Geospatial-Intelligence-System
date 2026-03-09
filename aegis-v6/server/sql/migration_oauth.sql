-- migration_oauth.sql — Add OAuth provider columns to citizens table
-- Idempotent — safe to run multiple times

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'citizens' AND column_name = 'google_id') THEN
    ALTER TABLE citizens ADD COLUMN google_id TEXT UNIQUE;
    CREATE INDEX idx_citizens_google_id ON citizens(google_id) WHERE google_id IS NOT NULL;
    RAISE NOTICE 'Added google_id column to citizens';
  END IF;
END $$;

-- Future OAuth providers (Facebook, GitHub, Apple)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'citizens' AND column_name = 'oauth_provider') THEN
    ALTER TABLE citizens ADD COLUMN oauth_provider TEXT;
    RAISE NOTICE 'Added oauth_provider column to citizens';
  END IF;
END $$;
