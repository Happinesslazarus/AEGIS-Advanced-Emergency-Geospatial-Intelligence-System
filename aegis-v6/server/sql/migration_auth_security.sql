-- migration_auth_security.sql
-- Enterprise Authentication & Security Hardening
--
-- Adds:
--   §1  Account lockout columns (citizens + operators)
--   §2  Email verification columns (operators — citizens already have them)
--   §3  Hashed email verification for citizens (new column replaces plaintext)
--   §4  Password history table
--   §5  User sessions table (refresh token tracking)
--   §6  Security events table (audit trail for auth events)
--   §7  Dev email log table (captures emails in dev mode)
--   §8  Indexes for performance

-- §1  ACCOUNT LOCKOUT — Brute-force protection at DB level

ALTER TABLE citizens
    ADD COLUMN IF NOT EXISTS failed_login_attempts  INTEGER     NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS locked_until            TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS password_changed_at     TIMESTAMPTZ;

ALTER TABLE operators
    ADD COLUMN IF NOT EXISTS failed_login_attempts  INTEGER     NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS locked_until            TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS password_changed_at     TIMESTAMPTZ;

-- §2  EMAIL VERIFICATION FOR OPERATORS
-- Operators now require email verification like citizens.

ALTER TABLE operators
    ADD COLUMN IF NOT EXISTS email_verified          BOOLEAN     NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS verification_token_hash VARCHAR(255),
    ADD COLUMN IF NOT EXISTS verification_expires    TIMESTAMPTZ;

-- §3  HASHED EMAIL VERIFICATION FOR CITIZENS
-- The existing verification_token column stores plaintext. Add hashed columns
-- and keep the old column for backward compat (old tokens still work once).

ALTER TABLE citizens
    ADD COLUMN IF NOT EXISTS verification_token_hash VARCHAR(255),
    ADD COLUMN IF NOT EXISTS verification_expires    TIMESTAMPTZ;

-- §4  PASSWORD HISTORY TABLE
-- Prevents reuse of the last N passwords.

CREATE TABLE IF NOT EXISTS password_history (
    id              UUID            PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID            NOT NULL,
    user_type       VARCHAR(20)     NOT NULL CHECK (user_type IN ('citizen', 'operator')),
    password_hash   VARCHAR(255)    NOT NULL,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_password_history_user
    ON password_history (user_id, user_type, created_at DESC);

-- §5  USER SESSIONS TABLE
-- Tracks active refresh tokens for session management and revocation.

CREATE TABLE IF NOT EXISTS user_sessions (
    id                  UUID            PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id             UUID            NOT NULL,
    user_type           VARCHAR(20)     NOT NULL CHECK (user_type IN ('citizen', 'operator')),
    refresh_token_hash  VARCHAR(255)    NOT NULL,
    ip_address          INET,
    user_agent          TEXT,
    created_at          TIMESTAMPTZ     NOT NULL DEFAULT now(),
    last_used_at        TIMESTAMPTZ     NOT NULL DEFAULT now(),
    expires_at          TIMESTAMPTZ     NOT NULL,
    revoked             BOOLEAN         NOT NULL DEFAULT false,
    revoked_reason      VARCHAR(100)
);

CREATE INDEX IF NOT EXISTS idx_user_sessions_user
    ON user_sessions (user_id, user_type)
    WHERE revoked = false;

CREATE INDEX IF NOT EXISTS idx_user_sessions_token
    ON user_sessions (refresh_token_hash)
    WHERE revoked = false;

CREATE INDEX IF NOT EXISTS idx_user_sessions_expires
    ON user_sessions (expires_at)
    WHERE revoked = false;

-- §6  SECURITY EVENTS TABLE
-- Immutable audit trail for authentication and security events.

CREATE TABLE IF NOT EXISTS security_events (
    id              UUID            PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID,
    user_type       VARCHAR(20)     CHECK (user_type IN ('citizen', 'operator')),
    event_type      VARCHAR(50)     NOT NULL,
    ip_address      INET,
    user_agent      TEXT,
    metadata        JSONB           DEFAULT '{}',
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_security_events_user
    ON security_events (user_id, user_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_security_events_type
    ON security_events (event_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_security_events_ip
    ON security_events (ip_address, created_at DESC);

-- §7  DEV EMAIL LOG TABLE
-- In development mode, emails are captured here instead of being sent via SMTP.
-- Makes it easy to view verification links, reset tokens, etc. during development.

CREATE TABLE IF NOT EXISTS dev_emails (
    id              UUID            PRIMARY KEY DEFAULT uuid_generate_v4(),
    to_email        VARCHAR(255)    NOT NULL,
    subject         VARCHAR(500)    NOT NULL,
    body_text       TEXT,
    body_html       TEXT,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dev_emails_to
    ON dev_emails (to_email, created_at DESC);

-- §8  CLEANUP INDEX — Auto-purge expired sessions (for scheduled CRON)
-- Can be used with: DELETE FROM user_sessions WHERE expires_at < NOW() - INTERVAL '30 days';
-- Can be used with: DELETE FROM security_events WHERE created_at < NOW() - INTERVAL '90 days';
-- Can be used with: DELETE FROM dev_emails WHERE created_at < NOW() - INTERVAL '7 days';
