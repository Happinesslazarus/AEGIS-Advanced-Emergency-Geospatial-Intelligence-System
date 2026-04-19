-- Migration: associate alert_subscriptions with citizen accounts
-- Adds citizen_id (nullable FK to citizens table) so the server can
-- differentiate anonymous subscriptions from signed-in citizen subscriptions.

ALTER TABLE alert_subscriptions
  ADD COLUMN IF NOT EXISTS citizen_id UUID
    REFERENCES citizens(id) ON DELETE SET NULL;

-- Index for fast look-up of all subscriptions belonging to one citizen
CREATE INDEX IF NOT EXISTS idx_alert_subscriptions_citizen
  ON alert_subscriptions (citizen_id)
  WHERE citizen_id IS NOT NULL;
