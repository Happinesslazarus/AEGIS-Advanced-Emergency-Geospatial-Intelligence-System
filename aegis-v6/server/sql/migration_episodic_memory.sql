-- migration_episodic_memory.sql
-- Episodic memory: remembers specific past incidents a citizen experienced
-- "Last March you reported flooding on your street — similar conditions are developing now"

CREATE TABLE IF NOT EXISTS citizen_episodic_memory (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  citizen_id    UUID NOT NULL REFERENCES citizens(id) ON DELETE CASCADE,
  event_type    VARCHAR(50) NOT NULL,   -- flood_personal, evacuation, shelter_visit, property_damage, etc.
  summary       TEXT NOT NULL,           -- brief description of what happened
  location      VARCHAR(255),            -- where it happened (street, area, postcode)
  severity      VARCHAR(20),             -- low, medium, high, critical
  occurred_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  outcome       TEXT,                    -- how it was resolved
  related_alert_id UUID,                 -- link to the alert that was active at the time
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for fast citizen lookups (ordered by recency)
CREATE INDEX IF NOT EXISTS idx_episodic_citizen_time
  ON citizen_episodic_memory (citizen_id, occurred_at DESC);

-- Index for finding episodes by event type across all citizens (analytics)
CREATE INDEX IF NOT EXISTS idx_episodic_event_type
  ON citizen_episodic_memory (event_type, occurred_at DESC);
