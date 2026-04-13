-- ============================================================
--  AEGIS v6 — Vision & Spatial Intelligence Migration
--  Tables added by the ML v2 / multimodal pipeline upgrade:
--
--    flood_extents             — Satellite SAR flood-mapping results
--    population_exposure_cache — WorldPop raster query cache
--    isochrone_cache           — ORS / circle isochrone cache
--    damage_assessments        — CLIP damage-severity results per incident
--    model_signal_weights      — Per-signal Bayesian fusion reliability weights
--
--  Run once against the AEGIS PostgreSQL (>=14) database.
--  Requires: PostGIS extension (already enabled).
--  pgRouting is an optional add-on — see the conditional block below.
-- ============================================================

BEGIN;

-- ── Prerequisites ───────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- 1.  flood_extents
--     Stores GeoJSON polygon output from satellite_flood_extent.py.
--     One row per incident after SAR processing completes.
-- ============================================================
CREATE TABLE IF NOT EXISTS flood_extents (
    id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    incident_id     UUID        NOT NULL,
    geojson         JSONB       NOT NULL,
    -- PostGIS geometry version for spatial queries / joins
    footprint       GEOMETRY(MultiPolygon, 4326),
    area_km2        NUMERIC(12, 4),
    method          VARCHAR(30) NOT NULL DEFAULT 'sar_sentinel1'
                    CHECK (method IN ('sar_sentinel1', 'synthetic', 'manual')),
    source_scene    TEXT,                          -- Sentinel-1 scene file name
    event_date      DATE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uidx_flood_extents_incident
    ON flood_extents (incident_id);

CREATE INDEX IF NOT EXISTS idx_flood_extents_geo
    ON flood_extents USING GIST (footprint) WHERE footprint IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_flood_extents_event_date
    ON flood_extents (event_date DESC NULLS LAST);

-- Auto-refresh updated_at
CREATE OR REPLACE FUNCTION _set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trig_flood_extents_updated_at ON flood_extents;
CREATE TRIGGER trig_flood_extents_updated_at
    BEFORE UPDATE ON flood_extents
    FOR EACH ROW EXECUTE FUNCTION _set_updated_at();


-- ============================================================
-- 2.  population_exposure_cache
--     WorldPop 100m raster result keyed by incident.
--     TTL enforced by an application-layer job (no cascade delete here).
-- ============================================================
CREATE TABLE IF NOT EXISTS population_exposure_cache (
    id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    incident_id     UUID        NOT NULL,
    population      INTEGER     NOT NULL CHECK (population >= 0),
    grid_source     VARCHAR(60) NOT NULL DEFAULT 'worldpop_100m',
    raster_year     SMALLINT    NOT NULL DEFAULT 2020,
    bbox_wkt        TEXT,                          -- source bounding box as WKT
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uidx_pop_exposure_incident
    ON population_exposure_cache (incident_id);

CREATE INDEX IF NOT EXISTS idx_pop_exposure_created
    ON population_exposure_cache (created_at DESC);


-- ============================================================
-- 3.  isochrone_cache
--     Drive-time / travel-time polygons from spatial_analytics.py.
--     result_json contains the full GeoJSON FeatureCollection.
-- ============================================================
CREATE TABLE IF NOT EXISTS isochrone_cache (
    id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    incident_id     UUID        NOT NULL,
    result_json     JSONB       NOT NULL,
    provider        VARCHAR(20) NOT NULL DEFAULT 'ors'
                    CHECK (provider IN ('ors', 'circle_approx')),
    -- Centroid cached for quick proximity look-ups
    centroid        GEOMETRY(Point, 4326),
    thresholds_min  INTEGER[]   NOT NULL DEFAULT '{5,10,20,30}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One isochrone result per incident (replace strategy in service layer)
CREATE UNIQUE INDEX IF NOT EXISTS uidx_isochrone_cache_incident
    ON isochrone_cache (incident_id);

CREATE INDEX IF NOT EXISTS idx_isochrone_cache_geo
    ON isochrone_cache USING GIST (centroid) WHERE centroid IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_isochrone_cache_created
    ON isochrone_cache (created_at DESC);


-- ============================================================
-- 4.  damage_assessments
--     Per-incident CLIP damage-severity results.
--     severity_class: no_damage | minor | major | destroyed
-- ============================================================
CREATE TABLE IF NOT EXISTS damage_assessments (
    id                  UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    incident_id         UUID        NOT NULL,
    image_url           TEXT,                      -- original image path / URL
    severity_class      VARCHAR(20) NOT NULL
                        CHECK (severity_class IN ('no_damage','minor','major','destroyed')),
    confidence          NUMERIC(5,4) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
    -- Full softmax vector for all 4 classes stored for audit/re-scoring
    class_probabilities JSONB       NOT NULL DEFAULT '{}'::jsonb,
    clip_model_version  VARCHAR(80) NOT NULL DEFAULT 'clip_damage_severity_vit_b32',
    assessed_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_damage_assessments_incident
    ON damage_assessments (incident_id, assessed_at DESC);

CREATE INDEX IF NOT EXISTS idx_damage_assessments_severity
    ON damage_assessments (severity_class);


-- ============================================================
-- 5.  model_signal_weights
--     Bayesian fusion reliability weights loaded by fusionEngineV2.ts.
--     Updated offline by the evaluation pipeline; read-only at inference time.
--
--     signal_name:  ml | clip | nlp
--     reliability_weight: [0,1] — must sum to 1 across active signals
--     active: false = signal excluded from fusion (e.g. CLIP offline)
-- ============================================================
CREATE TABLE IF NOT EXISTS model_signal_weights (
    id                  SERIAL      PRIMARY KEY,
    signal_name         VARCHAR(20) NOT NULL UNIQUE
                        CHECK (signal_name IN ('ml','clip','nlp')),
    reliability_weight  NUMERIC(5,4) NOT NULL CHECK (reliability_weight BETWEEN 0 AND 1),
    active              BOOLEAN     NOT NULL DEFAULT true,
    notes               TEXT,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed default weights (matches DEFAULT_WEIGHTS in fusionEngineV2.ts)
INSERT INTO model_signal_weights (signal_name, reliability_weight, active, notes)
VALUES
    ('ml',   0.5500, true, 'Multi-hazard XGB/LGBM/CatBoost/LSTM ensemble'),
    ('clip', 0.2800, true, 'Fine-tuned CLIP ViT-B/32 crisis classifier'),
    ('nlp',  0.1700, true, 'Keyword frequency NLP scorer')
ON CONFLICT (signal_name) DO NOTHING;

DROP TRIGGER IF EXISTS trig_model_signal_weights_updated_at ON model_signal_weights;
CREATE TRIGGER trig_model_signal_weights_updated_at
    BEFORE UPDATE ON model_signal_weights
    FOR EACH ROW EXECUTE FUNCTION _set_updated_at();


-- ============================================================
-- 6.  pgRouting (optional)
--     Provides shortest-path / isochrone routing directly in PostgreSQL.
--     Only installs if the extension is available on the database server.
--     The AEGIS spatial_analytics service uses ORS as primary + circle
--     fallback, so pgRouting is supplementary.
-- ============================================================
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_available_extensions WHERE name = 'pgrouting'
    ) THEN
        EXECUTE 'CREATE EXTENSION IF NOT EXISTS pgrouting';

        -- Road network edge table (populated from OSM import via osm2po / osm2pgrouting)
        EXECUTE $sql$
            CREATE TABLE IF NOT EXISTS road_network (
                id          BIGSERIAL   PRIMARY KEY,
                osm_id      BIGINT,
                source      INTEGER,
                target      INTEGER,
                cost        DOUBLE PRECISION,   -- travel time in minutes
                reverse_cost DOUBLE PRECISION,
                geom        GEOMETRY(LineString, 4326)
            )
        $sql$;

        EXECUTE 'CREATE INDEX IF NOT EXISTS idx_road_network_source ON road_network (source)';
        EXECUTE 'CREATE INDEX IF NOT EXISTS idx_road_network_target ON road_network (target)';
        EXECUTE 'CREATE INDEX IF NOT EXISTS idx_road_network_geo    ON road_network USING GIST (geom)';

        RAISE NOTICE 'pgRouting extension and road_network table created.';
    ELSE
        RAISE NOTICE 'pgRouting not available — skipping. Isochrones will use ORS/circle fallback.';
    END IF;
END $$;


COMMIT;

-- ============================================================
-- Rollback script (copy → run if something goes wrong)
-- ============================================================
-- BEGIN;
-- DROP TABLE IF EXISTS model_signal_weights CASCADE;
-- DROP TABLE IF EXISTS damage_assessments     CASCADE;
-- DROP TABLE IF EXISTS isochrone_cache        CASCADE;
-- DROP TABLE IF EXISTS population_exposure_cache CASCADE;
-- DROP TABLE IF EXISTS flood_extents          CASCADE;
-- DROP TABLE IF EXISTS road_network           CASCADE;
-- COMMIT;
