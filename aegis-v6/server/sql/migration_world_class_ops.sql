-- Migration: World-Class Operations Additions
-- Adds ops_log (ICS radio log), needs_mutual_aid, incident_commander to resource_deployments
-- Run ONCE on any environment

BEGIN;

-- 1. ICS Ops Log — append-only JSONB array of timestamped operator notes
ALTER TABLE resource_deployments
  ADD COLUMN IF NOT EXISTS ops_log JSONB NOT NULL DEFAULT '[]';

-- 2. Mutual Aid Flag — marks zone as requesting support from neighbouring agencies
ALTER TABLE resource_deployments
  ADD COLUMN IF NOT EXISTS needs_mutual_aid BOOLEAN NOT NULL DEFAULT false;

-- 3. Incident Commander — operator assigned as IC for this zone
ALTER TABLE resource_deployments
  ADD COLUMN IF NOT EXISTS incident_commander VARCHAR(200);

-- 4. AI draft acknowledgment tracking (deployed_by_name readable field)
ALTER TABLE resource_deployments
  ADD COLUMN IF NOT EXISTS ai_draft_acknowledged_by VARCHAR(200);

COMMIT;
