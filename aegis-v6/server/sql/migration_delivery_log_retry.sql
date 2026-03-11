-- Migration: Add retry tracking columns to alert_delivery_log
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='alert_delivery_log' AND column_name='retry_count') THEN
    ALTER TABLE alert_delivery_log ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='alert_delivery_log' AND column_name='last_retry_at') THEN
    ALTER TABLE alert_delivery_log ADD COLUMN last_retry_at TIMESTAMPTZ;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_alert_delivery_created ON alert_delivery_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alert_delivery_recipient ON alert_delivery_log (recipient);
