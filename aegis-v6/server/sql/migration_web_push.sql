-- ═══════════════════════════════════════════════════════════
-- AEGIS v6 - Web Push Subscriptions Migration
-- ═══════════════════════════════════════════════════════════
-- This migration adds support for Web Push notifications

-- Create push_subscriptions table
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  subscription_data JSONB NOT NULL, -- Store the full PushSubscription object
  endpoint TEXT NOT NULL UNIQUE,
  user_agent TEXT,
  ip_address INET,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_used_at TIMESTAMP,
  is_active BOOLEAN DEFAULT true
);

-- Create index on endpoint for fast lookups
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_endpoint ON push_subscriptions(endpoint);

-- Create index on user_id for fast user-based queries
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user_id ON push_subscriptions(user_id);

-- Create index on active subscriptions
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_active ON push_subscriptions(is_active) WHERE is_active = true;

-- Add web push subscription to alert_subscriptions (if not already present)
-- This allows anonymous users to receive alerts via web push
ALTER TABLE alert_subscriptions 
  ADD COLUMN IF NOT EXISTS push_subscription JSONB;

-- Create index for push subscription lookups
CREATE INDEX IF NOT EXISTS idx_alert_subscriptions_push ON alert_subscriptions(push_subscription);

-- Update existing alert_subscriptions to support web channel
-- (Already supported via the channels JSONB array)

-- Function to clean up expired/invalid push subscriptions
CREATE OR REPLACE FUNCTION cleanup_inactive_push_subscriptions() 
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM push_subscriptions
  WHERE is_active = false 
    AND last_used_at < NOW() - INTERVAL '90 days';
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Add comment explaining the subscription data structure
COMMENT ON COLUMN push_subscriptions.subscription_data IS 
'Full PushSubscription object from browser with endpoint, keys (auth, p256dh)';

COMMENT ON TABLE push_subscriptions IS 
'Stores Web Push subscriptions for authenticated users';

COMMENT ON COLUMN alert_subscriptions.push_subscription IS 
'Web Push subscription for anonymous alert subscribers';

-- ═══════════════════════════════════════════════════════════
-- Sample query to send alerts to all web push subscribers:
-- SELECT push_subscription FROM alert_subscriptions 
-- WHERE 'web' = ANY(channels) AND push_subscription IS NOT NULL;
-- ═══════════════════════════════════════════════════════════
