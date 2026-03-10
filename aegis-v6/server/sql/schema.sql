-- ═══════════════════════════════════════════════════════════════════════════════
--  AEGIS v6.1 — Production Database Schema
--  PostgreSQL 14+ with PostGIS
--
--  Advanced Emergency Geospatial Intelligence System
--  AI-enabled disaster reporting, alerting, and community response platform
--
--  Author  : Happiness Ada Lazarus (2238282)
--  Module  : CM4134 Honours Project — Robert Gordon University
--  Date    : 2026
--
--  This schema creates all tables needed for the AEGIS platform:
--
--      operators            Admin / operator / viewer accounts (bcrypt auth)
--      departments          Organisational units for operator assignment
--      reports              Citizen-submitted emergency reports (PostGIS Point)
--      alerts               Operator-generated warnings broadcast to citizens
--      activity_log         Immutable operator action audit trail
--      audit_log            Extended audit trail with before/after state capture
--      ai_model_metrics     AI model performance data for transparency dashboard
--      flood_zones          PostGIS spatial data from SEPA / QGIS exports
--      community_help       Citizen-to-citizen mutual aid offers and requests
--      alert_subscriptions  Citizen multi-channel alert preferences
--
--  Prerequisites:
--      • PostgreSQL 14 or later
--      • PostGIS extension available on the server
--
--  Usage:
--      createdb aegis
--      psql -U postgres -d aegis -f schema.sql
--
--  Design decisions:
--      • ENUM types replace CHECK constraints — type-safe, indexable, and
--        enforced at the catalog level rather than per-row evaluation.
--      • Soft-delete columns (deleted_at, deleted_by) on mutable tables;
--        log tables are append-only and therefore have no soft delete.
--      • Explicit ON DELETE SET NULL on every FK to operators so that
--        removing an operator never cascades into data loss.
--      • Full-text search via tsvector + GIN index on reports, populated
--        by a BEFORE INSERT OR UPDATE trigger with weighted lexemes.
--      • All timestamps are TIMESTAMPTZ (UTC-aware); all JSON is JSONB.
--      • updated_at columns are maintained by a shared trigger function.
-- ═══════════════════════════════════════════════════════════════════════════════


-- ─────────────────────────────────────────────────────────────────────────────
-- §0  EXTENSIONS
-- ─────────────────────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS postgis;          -- spatial queries (ST_*)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";      -- uuid_generate_v4()


-- ─────────────────────────────────────────────────────────────────────────────
-- §1  ENUM TYPES
--
--     Centralised domain values.  Safer than CHECK constraints because the
--     allowed set is defined once in the catalog and shared across every
--     column that references the type.  Adding a new value is a single
--     ALTER TYPE … ADD VALUE statement with no table rewrite.
-- ─────────────────────────────────────────────────────────────────────────────

DO $$ BEGIN

    -- Operator access levels
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'operator_role') THEN
        CREATE TYPE operator_role AS ENUM (
            'admin',
            'operator',
            'viewer'
        );
    END IF;

    -- Report lifecycle states
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'report_status') THEN
        CREATE TYPE report_status AS ENUM (
            'unverified',
            'verified',
            'urgent',
            'flagged',
            'resolved',
            'archived',
            'false_report'
        );
    END IF;

    -- Report impact level
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'report_severity') THEN
        CREATE TYPE report_severity AS ENUM (
            'high',
            'medium',
            'low'
        );
    END IF;

    -- Alert broadcast priority
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'alert_severity') THEN
        CREATE TYPE alert_severity AS ENUM (
            'critical',
            'warning',
            'info'
        );
    END IF;

    -- SEPA flood mechanism classification
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'flood_type_enum') THEN
        CREATE TYPE flood_type_enum AS ENUM (
            'river',
            'coastal',
            'surface'
        );
    END IF;

    -- SEPA flood probability band
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'flood_probability_enum') THEN
        CREATE TYPE flood_probability_enum AS ENUM (
            'high',
            'medium',
            'low'
        );
    END IF;

    -- Community help direction
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'community_help_type') THEN
        CREATE TYPE community_help_type AS ENUM (
            'offer',
            'request'
        );
    END IF;

    -- Community help lifecycle
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'community_help_status') THEN
        CREATE TYPE community_help_status AS ENUM (
            'active',
            'fulfilled',
            'expired',
            'cancelled'
        );
    END IF;

    -- Community help resource kind
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'community_help_category') THEN
        CREATE TYPE community_help_category AS ENUM (
            'shelter',
            'food',
            'transport',
            'medical',
            'clothing',
            'other'
        );
    END IF;

    -- Audit action classification
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'activity_action_type') THEN
        CREATE TYPE activity_action_type AS ENUM (
            'verify',
            'flag',
            'urgent',
            'resolve',
            'alert',
            'deploy',
            'login',
            'logout',
            'register',
            'print',
            'export',
            'note'
        );
    END IF;

END $$;


-- ─────────────────────────────────────────────────────────────────────────────
-- §2  TABLES
-- ─────────────────────────────────────────────────────────────────────────────


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  departments                                                            ║
-- ║  Organisational units for operator assignment.                          ║
-- ║  Seeded with ten UK-standard emergency management departments.          ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

CREATE TABLE IF NOT EXISTS departments (
    id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    name            TEXT        NOT NULL,
    description     TEXT,
    created_at      TIMESTAMPTZ NOT NULL    DEFAULT now(),

    CONSTRAINT uq_departments_name UNIQUE (name)
);


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  operators                                                              ║
-- ║  Admin / operator / viewer accounts.                                    ║
-- ║  Passwords are stored as bcrypt hashes — never in plaintext.            ║
-- ║  Supports soft-delete: a deleted operator's email becomes available     ║
-- ║  again thanks to the partial unique index below.                        ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

CREATE TABLE IF NOT EXISTS operators (
    id              UUID            PRIMARY KEY DEFAULT uuid_generate_v4(),
    email           VARCHAR(255)    NOT NULL,
    password_hash   VARCHAR(255)    NOT NULL,
    display_name    VARCHAR(100)    NOT NULL,
    role            operator_role   NOT NULL DEFAULT 'operator',
    avatar_url      VARCHAR(500),
    department      VARCHAR(100),
    phone           VARCHAR(20),
    is_active       BOOLEAN         NOT NULL DEFAULT true,
    last_login      TIMESTAMPTZ,

    -- Soft-delete bookkeeping
    deleted_at      TIMESTAMPTZ,
    deleted_by      UUID,

    created_at      TIMESTAMPTZ     NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ     NOT NULL DEFAULT now(),

    -- Self-referencing FK (an admin soft-deletes another operator)
    CONSTRAINT fk_operators_deleted_by
        FOREIGN KEY (deleted_by)
        REFERENCES  operators (id)
        ON DELETE   SET NULL
);

-- Email must be unique among non-deleted rows only.
-- If an operator is soft-deleted, their email is released for re-use.
CREATE UNIQUE INDEX IF NOT EXISTS uq_operators_email_active
    ON operators (email)
    WHERE deleted_at IS NULL;

-- Fast lookup by department for admin dashboards
CREATE INDEX IF NOT EXISTS idx_operators_department
    ON operators (department)
    WHERE deleted_at IS NULL;


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  reports                                                                ║
-- ║  Citizen-submitted emergency reports with PostGIS coordinates.          ║
-- ║  Core table of the platform — heavily indexed for dashboard,            ║
-- ║  map-tile, and full-text search queries.                                ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

CREATE TABLE IF NOT EXISTS reports (
    id                  UUID                    PRIMARY KEY DEFAULT uuid_generate_v4(),
    report_number       VARCHAR(20)             NOT NULL,
    incident_category   VARCHAR(50)             NOT NULL,
    incident_subtype    VARCHAR(50)             NOT NULL,
    display_type        VARCHAR(200)            NOT NULL,
    description         TEXT                    NOT NULL,
    severity            report_severity         NOT NULL DEFAULT 'low',
    status              report_status           NOT NULL DEFAULT 'unverified',
    trapped_persons     VARCHAR(20)             NOT NULL DEFAULT 'no',

    -- Location ──────────────────────────────────────────
    location_text       VARCHAR(500)            NOT NULL,
    coordinates         GEOMETRY(Point, 4326)   NOT NULL,

    -- Evidence ──────────────────────────────────────────
    has_media           BOOLEAN                 NOT NULL DEFAULT false,
    media_type          VARCHAR(10),
    media_url           VARCHAR(500),

    -- Reporter metadata ─────────────────────────────────
    reporter_name       VARCHAR(100)            NOT NULL DEFAULT 'Anonymous Citizen',
    reporter_ip         VARCHAR(45),

    -- AI analysis (JSONB for flexibility) ───────────────
    ai_confidence       INTEGER                 NOT NULL DEFAULT 0
                            CHECK (ai_confidence BETWEEN 0 AND 100),
    ai_analysis         JSONB                   NOT NULL DEFAULT '{}'::jsonb,

    -- Operator workflow ─────────────────────────────────
    operator_notes      TEXT,
    assigned_to         UUID,
    verified_by         UUID,
    verified_at         TIMESTAMPTZ,
    resolved_at         TIMESTAMPTZ,

    -- Soft-delete bookkeeping ───────────────────────────
    deleted_at          TIMESTAMPTZ,
    deleted_by          UUID,

    -- Full-text search vector (auto-populated by trigger)
    search_vector       tsvector,

    created_at          TIMESTAMPTZ             NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ             NOT NULL DEFAULT now(),

    -- Constraints ───────────────────────────────────────
    CONSTRAINT uq_reports_report_number
        UNIQUE (report_number),

    CONSTRAINT fk_reports_assigned_to
        FOREIGN KEY (assigned_to)
        REFERENCES  operators (id)
        ON DELETE   SET NULL,

    CONSTRAINT fk_reports_verified_by
        FOREIGN KEY (verified_by)
        REFERENCES  operators (id)
        ON DELETE   SET NULL,

    CONSTRAINT fk_reports_deleted_by
        FOREIGN KEY (deleted_by)
        REFERENCES  operators (id)
        ON DELETE   SET NULL
);

-- PostGIS spatial index — fast geographic queries & map rendering
CREATE INDEX IF NOT EXISTS idx_reports_coordinates
    ON reports USING GIST (coordinates);

-- Dashboard primary query: status + newest first
CREATE INDEX IF NOT EXISTS idx_reports_status_created
    ON reports (status, created_at DESC);

-- Severity filter for analytics / triage views
CREATE INDEX IF NOT EXISTS idx_reports_severity
    ON reports (severity);

-- Pure chronological listing
CREATE INDEX IF NOT EXISTS idx_reports_created
    ON reports (created_at DESC);

-- Full-text search (GIN is optimal for tsvector)
CREATE INDEX IF NOT EXISTS idx_reports_search_vector
    ON reports USING GIN (search_vector);

-- AI confidence range queries (analytics dashboard)
CREATE INDEX IF NOT EXISTS idx_reports_ai_confidence
    ON reports (ai_confidence);


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  alerts                                                                 ║
-- ║  Operator-generated warnings broadcast to citizens.                     ║
-- ║  Includes optional PostGIS point + radius for geographic targeting.     ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

CREATE TABLE IF NOT EXISTS alerts (
    id              UUID                    PRIMARY KEY DEFAULT uuid_generate_v4(),
    title           VARCHAR(200)            NOT NULL,
    message         TEXT                    NOT NULL,
    severity        alert_severity          NOT NULL DEFAULT 'info',
    alert_type      VARCHAR(50)             NOT NULL DEFAULT 'incident_alert',
    location_text   VARCHAR(200),
    coordinates     GEOMETRY(Point, 4326),
    radius_km       FLOAT                   NOT NULL DEFAULT 10.0,
    is_active       BOOLEAN                 NOT NULL DEFAULT true,

    created_by      UUID,
    expires_at      TIMESTAMPTZ,

    -- Soft-delete bookkeeping
    deleted_at      TIMESTAMPTZ,
    deleted_by      UUID,

    created_at      TIMESTAMPTZ             NOT NULL DEFAULT now(),

    CONSTRAINT fk_alerts_created_by
        FOREIGN KEY (created_by)
        REFERENCES  operators (id)
        ON DELETE   SET NULL,

    CONSTRAINT fk_alerts_deleted_by
        FOREIGN KEY (deleted_by)
        REFERENCES  operators (id)
        ON DELETE   SET NULL
);

-- Active alerts with expiry — used by citizen portal polling
CREATE INDEX IF NOT EXISTS idx_alerts_active_expires
    ON alerts (is_active, expires_at)
    WHERE is_active = true;

-- Severity filter
CREATE INDEX IF NOT EXISTS idx_alerts_severity
    ON alerts (severity);

-- Spatial index for geographic alert targeting
CREATE INDEX IF NOT EXISTS idx_alerts_coordinates
    ON alerts USING GIST (coordinates)
    WHERE coordinates IS NOT NULL;


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  activity_log                                                           ║
-- ║  Immutable operator action audit trail.                                 ║
-- ║  Every verify, flag, alert, login, export, and print is recorded.       ║
-- ║  NO soft-delete — audit records must never be removed or altered.        ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

CREATE TABLE IF NOT EXISTS activity_log (
    id              SERIAL                  PRIMARY KEY,
    action          VARCHAR(200)            NOT NULL,
    action_type     activity_action_type    NOT NULL,
    report_id       UUID,
    operator_id     UUID,
    operator_name   VARCHAR(100),
    metadata        JSONB                   NOT NULL DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ             NOT NULL DEFAULT now(),

    CONSTRAINT fk_activity_log_report
        FOREIGN KEY (report_id)
        REFERENCES  reports (id)
        ON DELETE   SET NULL,

    CONSTRAINT fk_activity_log_operator
        FOREIGN KEY (operator_id)
        REFERENCES  operators (id)
        ON DELETE   SET NULL
);

-- Newest activity first (dashboard feed)
CREATE INDEX IF NOT EXISTS idx_activity_log_created
    ON activity_log (created_at DESC);

-- Filter by action type
CREATE INDEX IF NOT EXISTS idx_activity_log_action_type
    ON activity_log (action_type);

-- Filter by operator
CREATE INDEX IF NOT EXISTS idx_activity_log_operator
    ON activity_log (operator_id);

-- Filter by related report
CREATE INDEX IF NOT EXISTS idx_activity_log_report
    ON activity_log (report_id)
    WHERE report_id IS NOT NULL;


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  audit_log                                                              ║
-- ║  Extended compliance audit trail with before/after state capture.        ║
-- ║  Records WHO did WHAT to WHICH record, WHEN, and from WHERE.            ║
-- ║  NO soft-delete — compliance records are immutable by design.           ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

CREATE TABLE IF NOT EXISTS audit_log (
    id              UUID            PRIMARY KEY DEFAULT uuid_generate_v4(),
    operator_id     UUID,
    operator_name   VARCHAR(100),
    action          TEXT            NOT NULL,
    action_type     VARCHAR(50)     NOT NULL,
    target_type     VARCHAR(50),
    target_id       VARCHAR(50),
    before_state    JSONB,
    after_state     JSONB,
    ip_address      VARCHAR(45),
    user_agent      TEXT,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT now(),

    CONSTRAINT fk_audit_log_operator
        FOREIGN KEY (operator_id)
        REFERENCES  operators (id)
        ON DELETE   SET NULL
);

-- Newest audit entries first
CREATE INDEX IF NOT EXISTS idx_audit_log_created
    ON audit_log (created_at DESC);

-- Filter by operator
CREATE INDEX IF NOT EXISTS idx_audit_log_operator
    ON audit_log (operator_id);

-- Filter by action type (verify, flag, alert, etc.)
CREATE INDEX IF NOT EXISTS idx_audit_log_action_type
    ON audit_log (action_type);

-- Filter by target (e.g. all actions on a specific report)
CREATE INDEX IF NOT EXISTS idx_audit_log_target
    ON audit_log (target_type, target_id)
    WHERE target_type IS NOT NULL;


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  ai_model_metrics                                                       ║
-- ║  AI transparency dashboard data.                                        ║
-- ║  Stores accuracy, precision, recall, F1, confusion matrices, and        ║
-- ║  feature importance vectors for each model version.                     ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

CREATE TABLE IF NOT EXISTS ai_model_metrics (
    id                      SERIAL          PRIMARY KEY,
    model_name              VARCHAR(100)    NOT NULL,
    model_version           VARCHAR(20)     NOT NULL,
    accuracy                FLOAT,
    precision_score         FLOAT,
    recall                  FLOAT,
    f1_score                FLOAT,
    confusion_matrix        JSONB,
    feature_importance      JSONB,
    confidence_distribution JSONB,
    training_samples        INTEGER,
    last_trained            TIMESTAMPTZ,
    notes                   TEXT,
    created_at              TIMESTAMPTZ     NOT NULL DEFAULT now()
);

-- Lookup by model name + version (dashboard queries)
CREATE INDEX IF NOT EXISTS idx_ai_model_metrics_model
    ON ai_model_metrics (model_name, model_version);


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  flood_zones                                                            ║
-- ║  PostGIS spatial data imported from SEPA via QGIS GeoJSON exports.      ║
-- ║  Used for point-in-polygon flood risk checks (ST_Contains / ST_Within). ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

CREATE TABLE IF NOT EXISTS flood_zones (
    id              SERIAL                      PRIMARY KEY,
    zone_name       VARCHAR(200),
    flood_type      flood_type_enum             NOT NULL,
    probability     flood_probability_enum      NOT NULL,
    return_period   VARCHAR(20),
    geometry        GEOMETRY(MultiPolygon, 4326) NOT NULL,
    source          VARCHAR(100)                NOT NULL DEFAULT 'SEPA',
    created_at      TIMESTAMPTZ                 NOT NULL DEFAULT now()
);

-- GIST spatial index — critical for ST_Contains / ST_Intersects performance
CREATE INDEX IF NOT EXISTS idx_flood_zones_geometry
    ON flood_zones USING GIST (geometry);

-- Filter by type and probability (analytics dashboard)
CREATE INDEX IF NOT EXISTS idx_flood_zones_type_prob
    ON flood_zones (flood_type, probability);


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  community_help                                                         ║
-- ║  Citizen-to-citizen mutual aid offers and requests.                     ║
-- ║  Categories: shelter, food, transport, medical, clothing, other.        ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

CREATE TABLE IF NOT EXISTS community_help (
    id              UUID                        PRIMARY KEY DEFAULT uuid_generate_v4(),
    type            community_help_type         NOT NULL,
    category        community_help_category     NOT NULL DEFAULT 'other',
    title           TEXT                        NOT NULL,
    description     TEXT,
    location_text   TEXT,
    location_lat    DOUBLE PRECISION,
    location_lng    DOUBLE PRECISION,
    contact_info    TEXT,
    capacity        INTEGER,
    consent_given   BOOLEAN                     NOT NULL DEFAULT false,
    status          community_help_status       NOT NULL DEFAULT 'active',

    -- Soft-delete bookkeeping
    deleted_at      TIMESTAMPTZ,

    created_at      TIMESTAMPTZ                 NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ                 NOT NULL DEFAULT now()
);

-- Active listings (citizen portal main query)
CREATE INDEX IF NOT EXISTS idx_community_help_status
    ON community_help (status)
    WHERE deleted_at IS NULL;

-- Filter by offer vs request
CREATE INDEX IF NOT EXISTS idx_community_help_type
    ON community_help (type);

-- Filter by category (shelter, food, etc.)
CREATE INDEX IF NOT EXISTS idx_community_help_category
    ON community_help (category);


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  alert_subscriptions                                                    ║
-- ║  Citizen multi-channel alert delivery preferences.                      ║
-- ║  Channels: email, SMS, Telegram, WhatsApp, web push.                   ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

CREATE TABLE IF NOT EXISTS alert_subscriptions (
    id                  UUID            PRIMARY KEY DEFAULT uuid_generate_v4(),
    email               TEXT,
    phone               TEXT,
    telegram_id         TEXT,
    whatsapp            TEXT,
    channels            TEXT[]          NOT NULL DEFAULT '{}',
    location_lat        DOUBLE PRECISION,
    location_lng        DOUBLE PRECISION,
    radius_km           INTEGER         NOT NULL DEFAULT 50,
    severity_filter     TEXT[]          NOT NULL DEFAULT '{critical,warning,info}',
    verified            BOOLEAN         NOT NULL DEFAULT false,
    verification_token  TEXT,
    consent_given       BOOLEAN         NOT NULL DEFAULT false,
    consent_timestamp   TIMESTAMPTZ,

    created_at          TIMESTAMPTZ     NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ     NOT NULL DEFAULT now()
);

-- Look up subscriptions by email (unsubscribe flow)
CREATE INDEX IF NOT EXISTS idx_alert_subscriptions_email
    ON alert_subscriptions (email)
    WHERE email IS NOT NULL;

-- Verified subscribers only (broadcast query)
CREATE INDEX IF NOT EXISTS idx_alert_subscriptions_verified
    ON alert_subscriptions (verified)
    WHERE verified = true;


-- ─────────────────────────────────────────────────────────────────────────────
-- §3  FUNCTIONS & TRIGGERS
-- ─────────────────────────────────────────────────────────────────────────────


-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │  3a. Auto-generate report numbers: RPT-001, RPT-002, …                  │
-- │                                                                          │
-- │  Fires BEFORE INSERT.  Only when report_number is NULL or empty.         │
-- │  Finds the current maximum numeric suffix and increments.                │
-- └──────────────────────────────────────────────────────────────────────────┘

CREATE OR REPLACE FUNCTION generate_report_number()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    next_num INTEGER;
BEGIN
    SELECT COALESCE(
               MAX(CAST(SUBSTRING(report_number FROM 5) AS INTEGER)),
               0
           ) + 1
      INTO next_num
      FROM reports;

    NEW.report_number := 'RPT-' || LPAD(next_num::TEXT, 3, '0');
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_report_number ON reports;

CREATE TRIGGER trg_report_number
    BEFORE INSERT ON reports
    FOR EACH ROW
    WHEN (NEW.report_number IS NULL OR NEW.report_number = '')
    EXECUTE FUNCTION generate_report_number();


-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │  3b. Generic updated_at timestamp trigger                                │
-- │                                                                          │
-- │  Shared across every mutable table that carries an updated_at column.    │
-- └──────────────────────────────────────────────────────────────────────────┘

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

-- operators
DROP TRIGGER IF EXISTS trg_operators_updated_at ON operators;
CREATE TRIGGER trg_operators_updated_at
    BEFORE UPDATE ON operators
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

-- reports
DROP TRIGGER IF EXISTS trg_reports_updated_at ON reports;
CREATE TRIGGER trg_reports_updated_at
    BEFORE UPDATE ON reports
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

-- community_help
DROP TRIGGER IF EXISTS trg_community_help_updated_at ON community_help;
CREATE TRIGGER trg_community_help_updated_at
    BEFORE UPDATE ON community_help
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

-- alert_subscriptions
DROP TRIGGER IF EXISTS trg_alert_subscriptions_updated_at ON alert_subscriptions;
CREATE TRIGGER trg_alert_subscriptions_updated_at
    BEFORE UPDATE ON alert_subscriptions
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();


-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │  3c. Full-text search vector auto-population for reports                 │
-- │                                                                          │
-- │  Combines three weighted columns into a single tsvector:                 │
-- │      A (highest) — description        (what happened)                    │
-- │      B (medium)  — display_type       (incident type label)              │
-- │      C (lowest)  — location_text      (where it happened)               │
-- │                                                                          │
-- │  Usage:  SELECT * FROM reports                                           │
-- │          WHERE search_vector @@ plainto_tsquery('english', 'flooding');   │
-- └──────────────────────────────────────────────────────────────────────────┘

CREATE OR REPLACE FUNCTION reports_search_vector_update()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.search_vector :=
        setweight(to_tsvector('english', COALESCE(NEW.description,   '')), 'A') ||
        setweight(to_tsvector('english', COALESCE(NEW.display_type,  '')), 'B') ||
        setweight(to_tsvector('english', COALESCE(NEW.location_text, '')), 'C');
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reports_search_vector ON reports;

CREATE TRIGGER trg_reports_search_vector
    BEFORE INSERT OR UPDATE OF description, display_type, location_text
    ON reports
    FOR EACH ROW
    EXECUTE FUNCTION reports_search_vector_update();


-- ─────────────────────────────────────────────────────────────────────────────
-- §4  SEED DATA — Departments
--
--     Ten UK-standard emergency management departments.
--     ON CONFLICT ensures idempotent re-runs.
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO departments (name, description) VALUES
    ('Emergency Operations',    'Central emergency coordination'),
    ('Fire & Rescue',           'Fire response and rescue operations'),
    ('Police',                  'Law enforcement and public safety'),
    ('Health & Medical',        'Medical response and hospitals'),
    ('Infrastructure',          'Roads, bridges, utilities'),
    ('Environmental',           'Environmental monitoring and protection'),
    ('Community Liaison',       'Public engagement and community support'),
    ('IT & Communications',     'Technology systems and comms'),
    ('Logistics',               'Resource allocation and supply chain'),
    ('Command & Control',       'Senior leadership and strategy')
ON CONFLICT (name) DO NOTHING;


-- ═══════════════════════════════════════════════════════════════════════════════
-- END OF SCHEMA
-- ═══════════════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════════════════
--  AEGIS v6.2 — Schema Extensions
--  Additional tables for report media, flood predictions, resource deployments
-- ═══════════════════════════════════════════════════════════════════════════════

-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  report_media                                                            ║
-- ║  Relational evidence storage for citizen-submitted report images.        ║
-- ║  Separate from reports table — supports multi-image per report.          ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

CREATE TABLE IF NOT EXISTS report_media (
    id                      UUID                    PRIMARY KEY DEFAULT uuid_generate_v4(),
    report_id               UUID                    NOT NULL,
    file_url                VARCHAR(500)            NOT NULL,
    file_type               VARCHAR(20)             NOT NULL DEFAULT 'image/jpeg',
    file_size               INTEGER                 NOT NULL DEFAULT 0,
    original_filename       VARCHAR(255),

    -- AI processing results
    ai_processed            BOOLEAN                 NOT NULL DEFAULT false,
    ai_classification       VARCHAR(100),
    ai_water_depth          VARCHAR(50),
    ai_authenticity_score   FLOAT,
    ai_model_version        VARCHAR(50),
    ai_reasoning            TEXT,

    created_at              TIMESTAMPTZ             NOT NULL DEFAULT now(),

    CONSTRAINT fk_report_media_report
        FOREIGN KEY (report_id)
        REFERENCES  reports (id)
        ON DELETE   CASCADE
);

CREATE INDEX IF NOT EXISTS idx_report_media_report_id
    ON report_media (report_id);


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  flood_predictions                                                       ║
-- ║  AI-generated flood prediction records for operator pre-alerting.        ║
-- ║  Linked to AI model version for traceability.                            ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

CREATE TABLE IF NOT EXISTS flood_predictions (
    id                      UUID                    PRIMARY KEY DEFAULT uuid_generate_v4(),
    area                    VARCHAR(200)            NOT NULL,
    probability             FLOAT                   NOT NULL CHECK (probability BETWEEN 0 AND 1),
    time_to_flood           VARCHAR(100),
    matched_pattern         VARCHAR(300),
    next_areas              TEXT[],
    severity                report_severity         NOT NULL DEFAULT 'medium',
    confidence              INTEGER                 NOT NULL DEFAULT 0
                                CHECK (confidence BETWEEN 0 AND 100),
    data_sources            TEXT[],
    coordinates             GEOMETRY(Point, 4326),
    model_version           VARCHAR(50),
    pre_alert_sent          BOOLEAN                 NOT NULL DEFAULT false,
    pre_alert_sent_at       TIMESTAMPTZ,
    pre_alert_sent_by       UUID,

    created_at              TIMESTAMPTZ             NOT NULL DEFAULT now(),
    expires_at              TIMESTAMPTZ,

    CONSTRAINT fk_predictions_sent_by
        FOREIGN KEY (pre_alert_sent_by)
        REFERENCES  operators (id)
        ON DELETE   SET NULL
);

CREATE INDEX IF NOT EXISTS idx_flood_predictions_active
    ON flood_predictions (created_at DESC)
    WHERE pre_alert_sent = false;

CREATE INDEX IF NOT EXISTS idx_flood_predictions_coordinates
    ON flood_predictions USING GIST (coordinates)
    WHERE coordinates IS NOT NULL;


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  resource_deployments                                                    ║
-- ║  Zone-based resource tracking with AI recommendations.                   ║
-- ║  Supports operator deploy/recall workflow.                               ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

CREATE TABLE IF NOT EXISTS resource_deployments (
    id                      UUID                    PRIMARY KEY DEFAULT uuid_generate_v4(),
    zone                    VARCHAR(100)            NOT NULL,
    priority                VARCHAR(20)             NOT NULL DEFAULT 'Medium',
    active_reports          INTEGER                 NOT NULL DEFAULT 0,
    estimated_affected      VARCHAR(200),
    ai_recommendation       TEXT,
    ambulances              INTEGER                 NOT NULL DEFAULT 0,
    fire_engines            INTEGER                 NOT NULL DEFAULT 0,
    rescue_boats            INTEGER                 NOT NULL DEFAULT 0,
    deployed                BOOLEAN                 NOT NULL DEFAULT false,
    deployed_at             TIMESTAMPTZ,
    deployed_by             UUID,
    coordinates             GEOMETRY(Point, 4326),

    created_at              TIMESTAMPTZ             NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ             NOT NULL DEFAULT now(),

    CONSTRAINT fk_deployments_deployed_by
        FOREIGN KEY (deployed_by)
        REFERENCES  operators (id)
        ON DELETE   SET NULL
);

CREATE INDEX IF NOT EXISTS idx_resource_deployments_zone
    ON resource_deployments (zone);


-- ═══════════════════════════════════════════════════════════════════════════════
--  AEGIS v6.2 — Extended Schema: Account Governance, Delivery, AI, Spatial
-- ═══════════════════════════════════════════════════════════════════════════════

-- §A  ACCOUNT GOVERNANCE — Suspension support
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE operators
    ADD COLUMN IF NOT EXISTS is_suspended    BOOLEAN     NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS suspended_until TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS suspended_by    UUID REFERENCES operators(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS anonymised_at   TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS anonymised_by   UUID REFERENCES operators(id) ON DELETE SET NULL;


-- ─────────────────────────────────────────────────────────────────────────────
-- §B  ALERT DELIVERY LOG — Track every channel delivery attempt
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS alert_delivery_log (
    id              UUID            PRIMARY KEY DEFAULT uuid_generate_v4(),
    alert_id        UUID            NOT NULL,
    channel         VARCHAR(50)     NOT NULL,  -- web, email, sms, telegram
    recipient       VARCHAR(255),
    provider_id     VARCHAR(255),              -- external provider response ID
    status          VARCHAR(50)     NOT NULL DEFAULT 'pending',  -- pending, sent, delivered, failed
    error_message   TEXT,
    sent_at         TIMESTAMPTZ,
    delivered_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT now(),

    CONSTRAINT fk_delivery_alert
        FOREIGN KEY (alert_id)
        REFERENCES  alerts (id)
        ON DELETE   CASCADE
);

CREATE INDEX IF NOT EXISTS idx_alert_delivery_alert_id
    ON alert_delivery_log (alert_id);

CREATE INDEX IF NOT EXISTS idx_alert_delivery_status
    ON alert_delivery_log (status);

CREATE INDEX IF NOT EXISTS idx_alert_delivery_channel
    ON alert_delivery_log (channel);


-- ─────────────────────────────────────────────────────────────────────────────
-- §C  AI EXECUTION LOG — Every AI model invocation is logged
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ai_executions (
    id                UUID            PRIMARY KEY DEFAULT uuid_generate_v4(),
    model_name        VARCHAR(100)    NOT NULL,
    model_version     VARCHAR(50)     NOT NULL,
    input_payload     JSONB,
    raw_response      JSONB,
    status            VARCHAR(50)     NOT NULL DEFAULT 'success',  -- success, failed, timeout
    execution_time_ms INTEGER,
    triggered_by      UUID REFERENCES operators(id) ON DELETE SET NULL,
    target_type       VARCHAR(50),     -- report, prediction, classification
    target_id         UUID,
    created_at        TIMESTAMPTZ     NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_executions_model
    ON ai_executions (model_name, model_version);

CREATE INDEX IF NOT EXISTS idx_ai_executions_created
    ON ai_executions (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_executions_target
    ON ai_executions (target_type, target_id);


-- ─────────────────────────────────────────────────────────────────────────────
-- §D  PREDICTION RECORDS — Stored results from AI prediction engine
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS prediction_records (
    id                  UUID            PRIMARY KEY DEFAULT uuid_generate_v4(),
    area_id             VARCHAR(100),
    area_name           VARCHAR(255),
    risk_level          VARCHAR(50)     NOT NULL,  -- Low, Medium, High, Critical
    probability         NUMERIC(5,2)    NOT NULL,  -- 0.00 - 100.00
    confidence          NUMERIC(5,2)    NOT NULL,
    predicted_peak_time TIMESTAMPTZ,
    affected_radius_km  NUMERIC(8,2),
    model_version       VARCHAR(50)     NOT NULL,
    raw_response        JSONB,
    input_data          JSONB,
    coordinates         geometry(Point, 4326),
    generated_at        TIMESTAMPTZ     NOT NULL DEFAULT now(),
    created_at          TIMESTAMPTZ     NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_prediction_records_area
    ON prediction_records (area_id);

CREATE INDEX IF NOT EXISTS idx_prediction_records_risk
    ON prediction_records (risk_level);

CREATE INDEX IF NOT EXISTS idx_prediction_records_created
    ON prediction_records (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_prediction_records_geo
    ON prediction_records USING GIST (coordinates);


-- ─────────────────────────────────────────────────────────────────────────────
-- §E  SPATIAL INTELLIGENCE — Risk layers, heatmaps, overlays
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS risk_layers (
    id              UUID            PRIMARY KEY DEFAULT uuid_generate_v4(),
    name            VARCHAR(255)    NOT NULL,
    layer_type      VARCHAR(50)     NOT NULL,  -- flood_risk, heatmap, prediction
    geometry_data   geometry(MultiPolygon, 4326),
    properties      JSONB,
    model_version   VARCHAR(50),
    valid_from      TIMESTAMPTZ     NOT NULL DEFAULT now(),
    valid_until     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_risk_layers_geo
    ON risk_layers USING GIST (geometry_data);

CREATE INDEX IF NOT EXISTS idx_risk_layers_type
    ON risk_layers (layer_type);


CREATE TABLE IF NOT EXISTS heatmap_layers (
    id              UUID            PRIMARY KEY DEFAULT uuid_generate_v4(),
    name            VARCHAR(255)    NOT NULL,
    source          VARCHAR(100),   -- ai_prediction, historical, realtime
    intensity_data  JSONB           NOT NULL,  -- array of {lat, lng, intensity}
    model_version   VARCHAR(50),
    generated_at    TIMESTAMPTZ     NOT NULL DEFAULT now(),
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_heatmap_layers_source
    ON heatmap_layers (source);


-- ─────────────────────────────────────────────────────────────────────────────
-- §F  REPORT STATUS HISTORY — Track every status change
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS report_status_history (
    id              UUID            PRIMARY KEY DEFAULT uuid_generate_v4(),
    report_id       UUID            NOT NULL,
    old_status      VARCHAR(50),
    new_status      VARCHAR(50)     NOT NULL,
    changed_by      UUID REFERENCES operators(id) ON DELETE SET NULL,
    reason          TEXT,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT now(),

    CONSTRAINT fk_status_history_report
        FOREIGN KEY (report_id)
        REFERENCES  reports (id)
        ON DELETE   CASCADE
);

CREATE INDEX IF NOT EXISTS idx_report_status_history_report
    ON report_status_history (report_id);

CREATE INDEX IF NOT EXISTS idx_report_status_history_created
    ON report_status_history (created_at DESC);


-- ─────────────────────────────────────────────────────────────────────────────
-- §G  SYSTEM EVENTS — Application-level event log
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS system_events (
    id              UUID            PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_type      VARCHAR(100)    NOT NULL,  -- login, logout, export, password_reset, etc.
    actor_id        UUID REFERENCES operators(id) ON DELETE SET NULL,
    actor_name      VARCHAR(100),
    target_type     VARCHAR(50),
    target_id       UUID,
    metadata        JSONB,
    ip_address      INET,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_system_events_type
    ON system_events (event_type);

CREATE INDEX IF NOT EXISTS idx_system_events_actor
    ON system_events (actor_id);

CREATE INDEX IF NOT EXISTS idx_system_events_created
    ON system_events (created_at DESC);

