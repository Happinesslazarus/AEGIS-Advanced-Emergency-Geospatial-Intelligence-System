-- AEGIS v6.6 - System hardening (additive only)
-- Safe, backward-compatible extensions for alert delivery + auth reset + report history

BEGIN;

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS alert_delivery_log (
    id              UUID            PRIMARY KEY DEFAULT uuid_generate_v4(),
    alert_id        UUID            NOT NULL,
    channel         VARCHAR(50)     NOT NULL,
    recipient       VARCHAR(255),
    provider_id     VARCHAR(255),
    status          VARCHAR(50)     NOT NULL DEFAULT 'pending',
    error_message   TEXT,
    sent_at         TIMESTAMPTZ,
    delivered_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT now(),

    CONSTRAINT fk_delivery_alert
        FOREIGN KEY (alert_id)
        REFERENCES alerts (id)
        ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_alert_delivery_alert_id ON alert_delivery_log (alert_id);
CREATE INDEX IF NOT EXISTS idx_alert_delivery_status ON alert_delivery_log (status);
CREATE INDEX IF NOT EXISTS idx_alert_delivery_channel ON alert_delivery_log (channel);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id          UUID            PRIMARY KEY DEFAULT uuid_generate_v4(),
    operator_id UUID            NOT NULL REFERENCES operators(id) ON DELETE CASCADE,
    token       VARCHAR(255)    NOT NULL UNIQUE,
    expires_at  TIMESTAMPTZ     NOT NULL,
    used_at     TIMESTAMPTZ,
    ip_address  INET,
    created_at  TIMESTAMPTZ     NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_password_reset_token
    ON password_reset_tokens (token)
    WHERE used_at IS NULL AND expires_at > now();

CREATE TABLE IF NOT EXISTS report_status_history (
    id          UUID            PRIMARY KEY DEFAULT uuid_generate_v4(),
    report_id   UUID            NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
    old_status  VARCHAR(50),
    new_status  VARCHAR(50)     NOT NULL,
    changed_by  UUID            REFERENCES operators(id) ON DELETE SET NULL,
    reason      TEXT,
    created_at  TIMESTAMPTZ     NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_report_status_history_report ON report_status_history (report_id);
CREATE INDEX IF NOT EXISTS idx_report_status_history_created ON report_status_history (created_at DESC);

COMMIT;
