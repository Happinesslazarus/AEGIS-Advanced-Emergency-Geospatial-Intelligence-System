-- Migration: Expand deployment_assets.asset_type for multi-hazard support
-- Run ONCE on any environment that has already applied migration_deployment_integration.sql

BEGIN;

-- Step 1: Widen the column to accommodate longer type names
ALTER TABLE deployment_assets
  ALTER COLUMN asset_type TYPE VARCHAR(30);

-- Step 2: Drop the old 5-type constraint
ALTER TABLE deployment_assets
  DROP CONSTRAINT IF EXISTS deployment_assets_asset_type_check;

-- Step 3: Add expanded constraint covering all multi-hazard asset types
ALTER TABLE deployment_assets
  ADD CONSTRAINT deployment_assets_asset_type_check
  CHECK (asset_type IN (
    'ambulance',
    'fire_engine',
    'rescue_boat',
    'helicopter',
    'hazmat_unit',
    'police',
    'medical_unit',
    'urban_search_rescue',
    'other'
  ));

COMMIT;
