-- migration_deployment_integration.sql
-- Adds full deployment integration: incident linkage, asset tracking, prediction linkage
-- Safe to re-run (IF NOT EXISTS / ADD COLUMN IF NOT EXISTS)

-- 1. Link deployment zones to the report that triggered them
ALTER TABLE resource_deployments
  ADD COLUMN IF NOT EXISTS report_id UUID REFERENCES reports(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS prediction_id UUID REFERENCES flood_predictions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS is_ai_draft BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ai_draft_acknowledged_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ai_draft_acknowledged_by UUID REFERENCES operators(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_resource_deployments_report
  ON resource_deployments (report_id) WHERE report_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_resource_deployments_prediction
  ON resource_deployments (prediction_id) WHERE prediction_id IS NOT NULL;

-- 2. Individual asset tracking table
-- Each row is a physical asset (vehicle/boat) assigned to a deployment zone
CREATE TABLE IF NOT EXISTS deployment_assets (
  id              UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  deployment_id   UUID          NOT NULL REFERENCES resource_deployments(id) ON DELETE CASCADE,
  asset_type      VARCHAR(20)   NOT NULL CHECK (asset_type IN ('ambulance','fire_engine','rescue_boat','helicopter','other')),
  call_sign       VARCHAR(50)   NOT NULL,
  status          VARCHAR(20)   NOT NULL DEFAULT 'staging'
                    CHECK (status IN ('staging','en_route','on_site','returning','available','off_duty')),
  -- Last known GPS position
  last_lat        DOUBLE PRECISION,
  last_lng        DOUBLE PRECISION,
  last_seen_at    TIMESTAMPTZ,
  -- Crew
  crew_count      INTEGER       NOT NULL DEFAULT 1,
  notes           TEXT,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_deployment_assets_deployment
  ON deployment_assets (deployment_id);

CREATE INDEX IF NOT EXISTS idx_deployment_assets_status
  ON deployment_assets (status);

-- auto-update updated_at on asset status change
CREATE OR REPLACE FUNCTION update_deployment_asset_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_deployment_asset_updated_at ON deployment_assets;
CREATE TRIGGER trg_deployment_asset_updated_at
  BEFORE UPDATE ON deployment_assets
  FOR EACH ROW EXECUTE FUNCTION update_deployment_asset_updated_at();

-- 3. AI dispatch feedback log
-- Stores every prediction→zone recommendation for model improvement
CREATE TABLE IF NOT EXISTS ai_dispatch_feedback (
  id              UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  prediction_id   UUID          REFERENCES flood_predictions(id) ON DELETE SET NULL,
  deployment_id   UUID          REFERENCES resource_deployments(id) ON DELETE SET NULL,
  feedback        VARCHAR(20)   NOT NULL CHECK (feedback IN ('correct','incorrect','uncertain')),
  outcome_notes   TEXT,
  submitted_by    UUID          REFERENCES operators(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT now()
);
