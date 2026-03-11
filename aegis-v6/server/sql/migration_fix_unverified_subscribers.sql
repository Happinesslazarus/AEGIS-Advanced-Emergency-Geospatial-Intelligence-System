-- Migration: Auto-verify alert subscriptions that were stuck as unverified
-- Root cause: Non-email subscribers had no way to click a verification link,
-- and email subscribers got stuck if SMTP was not configured.
-- Safe to run multiple times.

-- Auto-verify subscriptions that:
--   a) Don't include 'email' in their channels (no verification mechanism exists)
--   b) OR include 'email' but also have other channels (partial verify is OK)
-- This unblocks SMS, Telegram, WhatsApp subscribers who were created before the fix.

UPDATE alert_subscriptions
SET verified = true,
    verification_token = NULL,
    updated_at = NOW()
WHERE verified = false
  AND (
    NOT ('email' = ANY(channels))
    OR array_length(channels, 1) > 1
  );

-- For pure email subscribers still unverified, just verify them too
-- (SMTP may not be configured, so they'd never receive the link)
UPDATE alert_subscriptions
SET verified = true,
    verification_token = NULL,
    updated_at = NOW()
WHERE verified = false;
