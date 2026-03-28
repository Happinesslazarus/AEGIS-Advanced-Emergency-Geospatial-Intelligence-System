-- migration_two_factor_auth.sql
-- Adds TOTP-based two-factor authentication columns to operators table.
-- Idempotent: safe to re-run on existing environments.

DO $$
BEGIN
  -- two_factor_enabled: whether 2FA is active for this operator
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'operators' AND column_name = 'two_factor_enabled'
  ) THEN
    ALTER TABLE operators ADD COLUMN two_factor_enabled BOOLEAN NOT NULL DEFAULT false;
  END IF;

  -- two_factor_secret: AES-256-GCM encrypted TOTP secret (base32)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'operators' AND column_name = 'two_factor_secret'
  ) THEN
    ALTER TABLE operators ADD COLUMN two_factor_secret TEXT NULL;
  END IF;

  -- two_factor_backup_codes: SHA-256 hashed one-time recovery codes
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'operators' AND column_name = 'two_factor_backup_codes'
  ) THEN
    ALTER TABLE operators ADD COLUMN two_factor_backup_codes TEXT[] NULL;
  END IF;

  -- two_factor_enabled_at: timestamp when 2FA was activated
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'operators' AND column_name = 'two_factor_enabled_at'
  ) THEN
    ALTER TABLE operators ADD COLUMN two_factor_enabled_at TIMESTAMPTZ NULL;
  END IF;

  -- two_factor_last_verified_at: last successful 2FA verification
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'operators' AND column_name = 'two_factor_last_verified_at'
  ) THEN
    ALTER TABLE operators ADD COLUMN two_factor_last_verified_at TIMESTAMPTZ NULL;
  END IF;

  -- two_factor_recovery_generated_at: when backup codes were last generated
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'operators' AND column_name = 'two_factor_recovery_generated_at'
  ) THEN
    ALTER TABLE operators ADD COLUMN two_factor_recovery_generated_at TIMESTAMPTZ NULL;
  END IF;

  -- two_factor_failed_attempts: brute-force protection counter for 2FA codes
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'operators' AND column_name = 'two_factor_failed_attempts'
  ) THEN
    ALTER TABLE operators ADD COLUMN two_factor_failed_attempts INTEGER NOT NULL DEFAULT 0;
  END IF;

  -- two_factor_locked_until: lockout timestamp after too many failed 2FA attempts
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'operators' AND column_name = 'two_factor_locked_until'
  ) THEN
    ALTER TABLE operators ADD COLUMN two_factor_locked_until TIMESTAMPTZ NULL;
  END IF;

  -- two_factor_last_totp_at: timestamp of last accepted TOTP code (replay protection)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'operators' AND column_name = 'two_factor_last_totp_at'
  ) THEN
    ALTER TABLE operators ADD COLUMN two_factor_last_totp_at TIMESTAMPTZ NULL;
  END IF;

  -- two_factor_last_totp_hash: hash of last accepted TOTP code (replay protection)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'operators' AND column_name = 'two_factor_last_totp_hash'
  ) THEN
    ALTER TABLE operators ADD COLUMN two_factor_last_totp_hash VARCHAR(64) NULL;
  END IF;

  RAISE NOTICE '[2FA Migration] All two-factor columns ensured on operators table.';
END
$$;

-- Temp tokens table for 2FA login flow (short-lived, one-time use)
-- Uses "consumed" (not "used") to clearly distinguish from general usage
CREATE TABLE IF NOT EXISTS two_factor_temp_tokens (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES operators(id) ON DELETE CASCADE,
  token_hash    VARCHAR(128) NOT NULL,
  expires_at    TIMESTAMPTZ NOT NULL,
  consumed      BOOLEAN NOT NULL DEFAULT false,
  ip_address    TEXT NULL,
  user_agent    TEXT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Idempotent column additions for existing installations that already have the table
DO $$
BEGIN
  -- Rename used → consumed if the old column exists
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'two_factor_temp_tokens' AND column_name = 'used'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'two_factor_temp_tokens' AND column_name = 'consumed'
  ) THEN
    ALTER TABLE two_factor_temp_tokens RENAME COLUMN used TO consumed;
  END IF;

  -- Add ip_address if missing
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'two_factor_temp_tokens' AND column_name = 'ip_address'
  ) THEN
    ALTER TABLE two_factor_temp_tokens ADD COLUMN ip_address TEXT NULL;
  END IF;

  -- Add user_agent if missing
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'two_factor_temp_tokens' AND column_name = 'user_agent'
  ) THEN
    ALTER TABLE two_factor_temp_tokens ADD COLUMN user_agent TEXT NULL;
  END IF;
END
$$;

-- Index for token lookup (exact match on hash)
CREATE INDEX IF NOT EXISTS idx_2fa_temp_token_hash ON two_factor_temp_tokens (token_hash);

-- Index for cleanup of expired tokens
CREATE INDEX IF NOT EXISTS idx_2fa_temp_token_expires ON two_factor_temp_tokens (expires_at)
  WHERE consumed = false;

-- Index for brute-force lockout checks
CREATE INDEX IF NOT EXISTS idx_operators_2fa_lockout ON operators (two_factor_locked_until)
  WHERE two_factor_locked_until IS NOT NULL;
