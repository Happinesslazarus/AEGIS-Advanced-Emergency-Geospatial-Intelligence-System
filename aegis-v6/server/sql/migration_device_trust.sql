-- migration_device_trust.sql
-- Adds device trust / "Remember this device" functionality for 2FA bypass.
-- Trusted devices can skip 2FA for up to 30 days. Operators can revoke trust.
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS trusted_devices (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id     UUID NOT NULL REFERENCES operators(id) ON DELETE CASCADE,
  device_hash     VARCHAR(128) NOT NULL,    -- SHA-256 of fingerprint components
  device_name     TEXT,                      -- human-readable: "Chrome on Windows 11"
  ip_address      TEXT,                      -- IP at time of trust
  trusted_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at      TIMESTAMPTZ NOT NULL,      -- trust expiry (30 days from creation)
  last_used_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked         BOOLEAN NOT NULL DEFAULT false,
  revoked_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Lookup by operator + device fingerprint (the hot path during login)
CREATE INDEX IF NOT EXISTS idx_trusted_devices_lookup
  ON trusted_devices (operator_id, device_hash)
  WHERE revoked = false;

-- Cleanup expired devices
CREATE INDEX IF NOT EXISTS idx_trusted_devices_expiry
  ON trusted_devices (expires_at)
  WHERE revoked = false;

-- Security Alerts Preference Table
-- Operators can opt in/out of specific security alert types
CREATE TABLE IF NOT EXISTS operator_security_preferences (
  operator_id     UUID PRIMARY KEY REFERENCES operators(id) ON DELETE CASCADE,
  alert_on_2fa_disabled       BOOLEAN NOT NULL DEFAULT true,
  alert_on_backup_code_used   BOOLEAN NOT NULL DEFAULT true,
  alert_on_new_device_login   BOOLEAN NOT NULL DEFAULT true,
  alert_on_suspicious_access  BOOLEAN NOT NULL DEFAULT true,
  alert_on_lockout            BOOLEAN NOT NULL DEFAULT true,
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
