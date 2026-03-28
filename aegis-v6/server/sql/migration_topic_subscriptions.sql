--  AEGIS — Topic-Based Alert Subscriptions (#32)
--  Adds topic_filter column so subscribers can choose which alert types
--  (flood, fire, storm, earthquake, heatwave, tsunami, general) they receive.

BEGIN;

-- §1 ADD topic_filter column (array of alert types)
ALTER TABLE alert_subscriptions
    ADD COLUMN IF NOT EXISTS topic_filter TEXT[] NOT NULL DEFAULT '{flood,fire,storm,earthquake,heatwave,tsunami,general}';

-- §2 Index for topic-based broadcast queries
CREATE INDEX IF NOT EXISTS idx_alert_subscriptions_topic
    ON alert_subscriptions USING GIN (topic_filter);

COMMIT;
