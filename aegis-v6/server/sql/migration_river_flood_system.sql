-- ═══════════════════════════════════════════════════════════════════════════════
-- migration_river_flood_system.sql — River levels, flood zones, multi-tenant
--
-- Adds:
--   1. river_levels — Live river gauge readings stored every 5 minutes
--   2. flood_zones — Official flood zone polygons
--   3. distress_calls — Personal distress beacon / SOS calls
--   4. region_id column to existing tables for multi-tenant support
--   5. Indexes for spatial and time-series queries
--
-- Designed to be idempotent — safe to run multiple times.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ─── 1. River Levels ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS river_levels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  region_id VARCHAR(50) DEFAULT 'aberdeen_scotland_uk',
  station_id VARCHAR(100) NOT NULL,
  station_name VARCHAR(200),
  river_name VARCHAR(200),
  level_metres DOUBLE PRECISION,
  flow_cumecs DOUBLE PRECISION,
  status VARCHAR(20) DEFAULT 'normal',
  trend VARCHAR(20) DEFAULT 'stable',
  previous_level DOUBLE PRECISION,
  percentage_of_flood_level INTEGER,
  threshold_method VARCHAR(20) DEFAULT 'dynamic',
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  raw_response JSONB,
  data_source VARCHAR(50) DEFAULT 'SEPA'
);

CREATE INDEX IF NOT EXISTS idx_river_levels_station ON river_levels(station_id);
CREATE INDEX IF NOT EXISTS idx_river_levels_timestamp ON river_levels(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_river_levels_region ON river_levels(region_id);
CREATE INDEX IF NOT EXISTS idx_river_levels_station_time ON river_levels(station_id, timestamp DESC);

-- ─── 2. Flood Zones ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS flood_zones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  region_id VARCHAR(50) DEFAULT 'aberdeen_scotland_uk',
  zone_name VARCHAR(200) NOT NULL,
  risk_level VARCHAR(20) NOT NULL DEFAULT 'medium',
  source VARCHAR(100) DEFAULT 'SEPA',
  geometry JSONB,
  is_active BOOLEAN DEFAULT false,
  activated_at TIMESTAMPTZ,
  activated_by VARCHAR(100),
  properties JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_flood_zones_region ON flood_zones(region_id);
CREATE INDEX IF NOT EXISTS idx_flood_zones_active ON flood_zones(is_active) WHERE is_active = true;

-- ─── 3. Distress Calls ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS distress_calls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  citizen_id UUID,
  region_id VARCHAR(50) DEFAULT 'aberdeen_scotland_uk',
  activated_at TIMESTAMPTZ DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  initial_lat DOUBLE PRECISION NOT NULL,
  initial_lng DOUBLE PRECISION NOT NULL,
  current_lat DOUBLE PRECISION,
  current_lng DOUBLE PRECISION,
  location_history JSONB DEFAULT '[]',
  status VARCHAR(20) DEFAULT 'active',
  priority VARCHAR(20) DEFAULT 'high',
  assigned_operator_id UUID,
  flood_zone_at_activation VARCHAR(200),
  river_level_at_activation DOUBLE PRECISION,
  nearest_shelter_at_activation JSONB,
  citizen_battery_level INTEGER,
  is_moving BOOLEAN DEFAULT false,
  last_update_at TIMESTAMPTZ DEFAULT NOW(),
  notes TEXT,
  resolution_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_distress_calls_status ON distress_calls(status);
CREATE INDEX IF NOT EXISTS idx_distress_calls_citizen ON distress_calls(citizen_id);
CREATE INDEX IF NOT EXISTS idx_distress_calls_region ON distress_calls(region_id);
CREATE INDEX IF NOT EXISTS idx_distress_calls_active ON distress_calls(status) WHERE status IN ('active', 'responding');

-- ─── 4. Flood Predictions (cached) ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS flood_predictions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  region_id VARCHAR(50) DEFAULT 'aberdeen_scotland_uk',
  river_name VARCHAR(200),
  station_id VARCHAR(100),
  current_level DOUBLE PRECISION,
  predicted_levels JSONB DEFAULT '[]',
  affected_areas JSONB DEFAULT '[]',
  estimated_properties INTEGER DEFAULT 0,
  estimated_people INTEGER DEFAULT 0,
  confidence INTEGER DEFAULT 50,
  rainfall_forecast_mm DOUBLE PRECISION,
  calculated_at TIMESTAMPTZ DEFAULT NOW(),
  valid_until TIMESTAMPTZ DEFAULT NOW() + INTERVAL '1 hour'
);

CREATE INDEX IF NOT EXISTS idx_flood_predictions_region ON flood_predictions(region_id);
CREATE INDEX IF NOT EXISTS idx_flood_predictions_valid ON flood_predictions(valid_until);

-- ─── 5. Threat Level Log ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS threat_level_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  region_id VARCHAR(50) DEFAULT 'aberdeen_scotland_uk',
  level VARCHAR(20) NOT NULL,
  previous_level VARCHAR(20),
  trigger_reasons JSONB DEFAULT '[]',
  river_levels JSONB DEFAULT '{}',
  active_reports INTEGER DEFAULT 0,
  calculated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_threat_level_region ON threat_level_log(region_id, calculated_at DESC);

-- ─── 6. Evacuation Routes (cached) ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS evacuation_routes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  region_id VARCHAR(50) DEFAULT 'aberdeen_scotland_uk',
  route_name VARCHAR(200),
  from_area VARCHAR(200),
  to_shelter VARCHAR(200),
  distance_km DOUBLE PRECISION,
  duration_minutes INTEGER,
  geometry JSONB,
  is_blocked BOOLEAN DEFAULT false,
  blocked_reason TEXT,
  calculated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_evacuation_routes_region ON evacuation_routes(region_id);

-- ─── 7. Multi-tenant: Add region_id to existing tables ─────────────────────

-- reports table
DO $$ BEGIN
  ALTER TABLE reports ADD COLUMN IF NOT EXISTS region_id VARCHAR(50) DEFAULT 'aberdeen_scotland_uk';
EXCEPTION WHEN undefined_table THEN NULL; END $$;

-- shelters table
DO $$ BEGIN
  ALTER TABLE shelters ADD COLUMN IF NOT EXISTS region_id VARCHAR(50) DEFAULT 'aberdeen_scotland_uk';
EXCEPTION WHEN undefined_table THEN NULL; END $$;

-- alerts table  
DO $$ BEGIN
  ALTER TABLE alerts ADD COLUMN IF NOT EXISTS region_id VARCHAR(50) DEFAULT 'aberdeen_scotland_uk';
EXCEPTION WHEN undefined_table THEN NULL; END $$;

-- external_alerts table
DO $$ BEGIN
  ALTER TABLE external_alerts ADD COLUMN IF NOT EXISTS region_id VARCHAR(50) DEFAULT 'aberdeen_scotland_uk';
EXCEPTION WHEN undefined_table THEN NULL; END $$;

-- weather_cache or similar
DO $$ BEGIN
  ALTER TABLE weather_cache ADD COLUMN IF NOT EXISTS region_id VARCHAR(50) DEFAULT 'aberdeen_scotland_uk';
EXCEPTION WHEN undefined_table THEN NULL; END $$;

COMMIT;
