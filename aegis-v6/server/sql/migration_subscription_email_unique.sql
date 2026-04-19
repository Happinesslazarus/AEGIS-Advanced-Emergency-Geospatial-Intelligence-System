-- Migration: add partial UNIQUE index on alert_subscriptions(email)
-- Prerequisite for the ON CONFLICT (email) WHERE email IS NOT NULL upsert
-- used in the /api/subscriptions POST route.
-- Web-push-only rows (email IS NULL) are excluded and remain unconstrained.

CREATE UNIQUE INDEX IF NOT EXISTS uq_alert_subscriptions_email
    ON alert_subscriptions (email)
    WHERE email IS NOT NULL;
