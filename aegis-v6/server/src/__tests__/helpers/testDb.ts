/**
 * Module: testDb.ts
 *
 * Test db server module.
 *
 * - Run by the test runner (Vitest or Jest)
 */

import pg from 'pg'

const { Pool } = pg

// Pool singleton

let _pool: pg.Pool | null = null

/**
 * Returns a shared Pool pointing at the test database.
 * Validates that we are NOT accidentally connected to a production DB.
 */
export function getTestPool(): pg.Pool {
  if (_pool) return _pool

  const url = process.env.DATABASE_URL
  if (!url) {
    throw new Error(
      'DATABASE_URL is not set. Integration tests require a PostgreSQL test database.\n' +
      'Set DATABASE_URL=postgresql://postgres:postgres@localhost:5432/aegis_test',
    )
  }

  // Safety guard: refuse to run against anything that looks like production
  if (/production|prod[_-]db/i.test(url)) {
    throw new Error('Refusing to run tests against a production-looking DATABASE_URL')
  }

  _pool = new Pool({
    connectionString: url,
    max: 5,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 5_000,
  })

  return _pool
}

// Schema bootstrap

/**
 * Ensures the minimum schema required by integration tests exists.
 * Idempotent — safe to call in every beforeAll.
 */
export async function ensureTestSchema(): Promise<void> {
  const pool = getTestPool()

  await pool.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`)
  await pool.query(`CREATE EXTENSION IF NOT EXISTS postgis`)

  // Citizens (used by distress, reports, GDPR, community)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS citizens (
      id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      email         TEXT UNIQUE,
      display_name  TEXT NOT NULL DEFAULT 'Test Citizen',
      password_hash TEXT,
      phone         TEXT,
      role          TEXT NOT NULL DEFAULT 'citizen',
      preferred_region TEXT,
      location_lat  DOUBLE PRECISION,
      location_lng  DOUBLE PRECISION,
      is_vulnerable BOOLEAN DEFAULT false,
      avatar_url    TEXT,
      country       TEXT,
      city          TEXT,
      bio           TEXT,
      email_verified BOOLEAN DEFAULT false,
      deletion_requested_at TIMESTAMPTZ,
      deletion_scheduled_at TIMESTAMPTZ,
      created_at    TIMESTAMPTZ DEFAULT NOW(),
      updated_at    TIMESTAMPTZ DEFAULT NOW()
    )
  `)

  // Operators
  await pool.query(`
    CREATE TABLE IF NOT EXISTS operators (
      id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      email         TEXT UNIQUE,
      display_name  TEXT NOT NULL DEFAULT 'Test Operator',
      password_hash TEXT,
      role          TEXT NOT NULL DEFAULT 'operator',
      avatar_url    TEXT,
      department    TEXT,
      created_at    TIMESTAMPTZ DEFAULT NOW()
    )
  `)

  // Distress
  await pool.query(`
    CREATE TABLE IF NOT EXISTS distress_calls (
      id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      citizen_id      UUID REFERENCES citizens(id),
      citizen_name    TEXT,
      latitude        DOUBLE PRECISION NOT NULL,
      longitude       DOUBLE PRECISION NOT NULL,
      accuracy        DOUBLE PRECISION,
      heading         DOUBLE PRECISION,
      speed           DOUBLE PRECISION,
      message         TEXT,
      contact_number  TEXT,
      is_vulnerable   BOOLEAN DEFAULT false,
      status          TEXT NOT NULL DEFAULT 'active',
      triage_level    TEXT DEFAULT 'medium',
      acknowledged_by TEXT,
      acknowledged_at TIMESTAMPTZ,
      resolved_by     TEXT,
      resolved_at     TIMESTAMPTZ,
      resolution      TEXT,
      last_gps_at     TIMESTAMPTZ,
      created_at      TIMESTAMPTZ DEFAULT NOW()
    )
  `)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS distress_location_history (
      id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      distress_id UUID REFERENCES distress_calls(id),
      latitude    DOUBLE PRECISION NOT NULL,
      longitude   DOUBLE PRECISION NOT NULL,
      accuracy    DOUBLE PRECISION,
      heading     DOUBLE PRECISION,
      speed       DOUBLE PRECISION,
      created_at  TIMESTAMPTZ DEFAULT NOW()
    )
  `)

  // Reports
  await pool.query(`
    CREATE TABLE IF NOT EXISTS reports (
      id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      report_number     TEXT UNIQUE DEFAULT (
        'RPT-' || EXTRACT(EPOCH FROM clock_timestamp())::BIGINT::TEXT || '-' || substr(md5(random()::text), 1, 6)
      ),
      citizen_id        UUID,
      incident_category TEXT,
      incident_subtype  TEXT,
      display_type      TEXT,
      description       TEXT,
      severity          TEXT DEFAULT 'medium',
      status            TEXT DEFAULT 'new',
      trapped_persons   INT DEFAULT 0,
      location_text     TEXT,
      coordinates       geography(Point, 4326),
      has_media         BOOLEAN DEFAULT false,
      media_type        TEXT,
      media_url         TEXT,
      reporter_name     TEXT,
      reporter_contact  TEXT,
      ai_confidence     DOUBLE PRECISION,
      ai_analysis       JSONB,
      operator_notes    TEXT,
      deleted_at        TIMESTAMPTZ,
      verified_at       TIMESTAMPTZ,
      resolved_at       TIMESTAMPTZ,
      created_at        TIMESTAMPTZ DEFAULT NOW(),
      updated_at        TIMESTAMPTZ DEFAULT NOW()
    )
  `)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS report_media (
      id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      report_id             UUID REFERENCES reports(id),
      file_url              TEXT,
      file_type             TEXT,
      file_size             INT,
      original_filename     TEXT,
      ai_processed          BOOLEAN DEFAULT false,
      ai_classification     TEXT,
      ai_water_depth        DOUBLE PRECISION,
      ai_authenticity_score DOUBLE PRECISION,
      ai_reasoning          TEXT,
      created_at            TIMESTAMPTZ DEFAULT NOW()
    )
  `)

  // Alerts
  await pool.query(`
    CREATE TABLE IF NOT EXISTS alerts (
      id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      title        TEXT NOT NULL,
      message      TEXT,
      severity     TEXT DEFAULT 'info',
      alert_type   TEXT DEFAULT 'general',
      location_text TEXT,
      coordinates  TEXT,
      radius_km    DOUBLE PRECISION,
      expires_at   TIMESTAMPTZ,
      is_active    BOOLEAN DEFAULT true,
      created_by   UUID,
      deleted_at   TIMESTAMPTZ,
      created_at   TIMESTAMPTZ DEFAULT NOW(),
      updated_at   TIMESTAMPTZ DEFAULT NOW()
    )
  `)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS alert_subscriptions (
      id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      email               TEXT,
      phone               TEXT,
      telegram_id         TEXT,
      whatsapp            TEXT,
      channels            TEXT[] DEFAULT '{}',
      location_lat        DOUBLE PRECISION,
      location_lng        DOUBLE PRECISION,
      radius_km           INT DEFAULT 50,
      severity_filter     TEXT[] DEFAULT '{critical,warning,info}',
      topic_filter        TEXT[] DEFAULT '{flood,fire,storm,general}',
      verification_token  TEXT,
      verified            BOOLEAN DEFAULT false,
      consent_given       BOOLEAN DEFAULT false,
      consent_timestamp   TIMESTAMPTZ,
      created_at          TIMESTAMPTZ DEFAULT NOW(),
      updated_at          TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (email)
    )
  `)

  // Community
  await pool.query(`
    CREATE TABLE IF NOT EXISTS community_posts (
      id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      author_id        UUID,
      content          TEXT NOT NULL,
      image_url        TEXT,
      location         TEXT,
      is_hazard_update BOOLEAN DEFAULT false,
      deleted_at       TIMESTAMPTZ,
      created_at       TIMESTAMPTZ DEFAULT NOW(),
      updated_at       TIMESTAMPTZ DEFAULT NOW()
    )
  `)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS community_post_likes (
      id      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      post_id UUID REFERENCES community_posts(id),
      user_id UUID NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS community_comments (
      id      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      post_id UUID REFERENCES community_posts(id),
      user_id UUID NOT NULL,
      author_id UUID,
      content TEXT NOT NULL,
      deleted_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS community_post_reports (
      id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      post_id     UUID REFERENCES community_posts(id),
      reporter_id UUID NOT NULL,
      reason      TEXT,
      details     TEXT,
      created_at  TIMESTAMPTZ DEFAULT NOW()
    )
  `)

  // Keep schema compatible with route-mirroring test handlers even if table existed earlier.
  await pool.query(`
    ALTER TABLE reports
    ALTER COLUMN report_number SET DEFAULT (
      'RPT-' || EXTRACT(EPOCH FROM clock_timestamp())::BIGINT::TEXT || '-' || substr(md5(random()::text), 1, 6)
    )
  `)
  await pool.query(`ALTER TABLE community_comments ADD COLUMN IF NOT EXISTS author_id UUID`)
  await pool.query(`ALTER TABLE community_comments ADD COLUMN IF NOT EXISTS image_url TEXT`)
  await pool.query(`ALTER TABLE community_comments ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ`)
  await pool.query(`UPDATE community_comments SET author_id = user_id WHERE author_id IS NULL`)
  await pool.query(`ALTER TABLE community_post_reports ADD COLUMN IF NOT EXISTS details TEXT`)
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS ux_community_post_reports_post_reporter ON community_post_reports (post_id, reporter_id)`)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS community_post_shares (
      id      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      post_id UUID REFERENCES community_posts(id),
      user_id UUID NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS community_chat_messages (
      id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      room_id     TEXT,
      sender_id   UUID,
      sender_name TEXT,
      content     TEXT,
      image_url   TEXT,
      deleted_at  TIMESTAMPTZ,
      created_at  TIMESTAMPTZ DEFAULT NOW()
    )
  `)

  // GDPR / Messaging / Safety
  await pool.query(`
    CREATE TABLE IF NOT EXISTS message_threads (
      id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      citizen_id     UUID,
      subject        TEXT,
      status         TEXT DEFAULT 'open',
      priority       TEXT DEFAULT 'normal',
      citizen_unread INT DEFAULT 0,
      created_at     TIMESTAMPTZ DEFAULT NOW()
    )
  `)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS messages (
      id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      thread_id   UUID REFERENCES message_threads(id),
      content     TEXT,
      sender_type TEXT DEFAULT 'citizen',
      created_at  TIMESTAMPTZ DEFAULT NOW()
    )
  `)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS safety_check_ins (
      id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      citizen_id   UUID,
      status       TEXT DEFAULT 'safe',
      message      TEXT,
      location_lat DOUBLE PRECISION,
      location_lng DOUBLE PRECISION,
      created_at   TIMESTAMPTZ DEFAULT NOW()
    )
  `)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS emergency_contacts (
      id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      citizen_id  UUID,
      name        TEXT,
      phone       TEXT,
      relationship TEXT,
      is_primary  BOOLEAN DEFAULT false
    )
  `)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS citizen_preferences (
      id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      citizen_id UUID UNIQUE,
      theme      TEXT DEFAULT 'system',
      language   TEXT DEFAULT 'en',
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS citizen_alert_history (
      id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      citizen_id   UUID,
      alert_id     UUID,
      seen_at      TIMESTAMPTZ DEFAULT NOW(),
      audio_played BOOLEAN DEFAULT false
    )
  `)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS account_deletion_log (
      id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      citizen_id     UUID,
      citizen_email  TEXT,
      citizen_name   TEXT,
      action         TEXT,
      details        JSONB,
      created_at     TIMESTAMPTZ DEFAULT NOW()
    )
  `)

  // Flood predictions
  await pool.query(`
    CREATE TABLE IF NOT EXISTS flood_predictions (
      id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      region_id        TEXT,
      latitude         DOUBLE PRECISION,
      longitude        DOUBLE PRECISION,
      area             TEXT,
      risk_level       TEXT,
      confidence       DOUBLE PRECISION,
      predicted_level  DOUBLE PRECISION,
      fusion_score     DOUBLE PRECISION,
      time_to_flood_min INT,
      status           TEXT DEFAULT 'active',
      fingerprint_data JSONB,
      expires_at       TIMESTAMPTZ,
      created_at       TIMESTAMPTZ DEFAULT NOW()
    )
  `)

  // Departments
  await pool.query(`
    CREATE TABLE IF NOT EXISTS departments (
      id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      name        TEXT UNIQUE NOT NULL,
      description TEXT,
      created_at  TIMESTAMPTZ DEFAULT NOW()
    )
  `)

  // Delivery log (alerts)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS alert_delivery_log (
      id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      alert_id        UUID,
      subscription_id UUID,
      channel         TEXT,
      recipient       TEXT,
      provider_id     TEXT,
      status          TEXT DEFAULT 'pending',
      error_message   TEXT,
      sent_at         TIMESTAMPTZ,
      delivered_at    TIMESTAMPTZ,
      retry_count     INT DEFAULT 0,
      last_retry_at   TIMESTAMPTZ,
      created_at      TIMESTAMPTZ DEFAULT NOW()
    )
  `)

  await pool.query(`ALTER TABLE alerts ADD COLUMN IF NOT EXISTS coordinates TEXT`)
  await pool.query(`ALTER TABLE alerts ADD COLUMN IF NOT EXISTS radius_km DOUBLE PRECISION`)
  await pool.query(`ALTER TABLE alerts ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ`)
  await pool.query(`ALTER TABLE alert_delivery_log ADD COLUMN IF NOT EXISTS recipient TEXT`)
  await pool.query(`ALTER TABLE alert_delivery_log ADD COLUMN IF NOT EXISTS provider_id TEXT`)
  await pool.query(`ALTER TABLE alert_delivery_log ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ`)
  await pool.query(`ALTER TABLE alert_delivery_log ADD COLUMN IF NOT EXISTS retry_count INT DEFAULT 0`)
  await pool.query(`ALTER TABLE alert_delivery_log ADD COLUMN IF NOT EXISTS last_retry_at TIMESTAMPTZ`)

  // Community help
  await pool.query(`
    CREATE TABLE IF NOT EXISTS community_help (
      id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      status      TEXT DEFAULT 'active',
      deleted_at  TIMESTAMPTZ,
      created_at  TIMESTAMPTZ DEFAULT NOW()
    )
  `)

  // Audit log
  await pool.query(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      operator_id   UUID,
      operator_name TEXT,
      action        TEXT,
      action_type   TEXT,
      target_type   TEXT,
      target_id     TEXT,
      before_state  JSONB,
      after_state   JSONB,
      ip_address    TEXT,
      user_agent    TEXT,
      created_at    TIMESTAMPTZ DEFAULT NOW()
    )
  `)

  // Chat (LLM chatbot)
  await pool.query(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'chat_session_status') THEN
        CREATE TYPE chat_session_status AS ENUM ('active', 'archived', 'expired');
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'chat_message_role') THEN
        CREATE TYPE chat_message_role AS ENUM ('user', 'assistant', 'system', 'tool');
      END IF;
    END $$
  `)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS chat_sessions (
      id           UUID                PRIMARY KEY DEFAULT uuid_generate_v4(),
      citizen_id   UUID                REFERENCES citizens(id) ON DELETE SET NULL,
      operator_id  UUID                REFERENCES operators(id) ON DELETE SET NULL,
      title        VARCHAR(255),
      status       chat_session_status NOT NULL DEFAULT 'active',
      model_used   VARCHAR(100),
      total_tokens INTEGER             NOT NULL DEFAULT 0,
      metadata     JSONB               NOT NULL DEFAULT '{}'::jsonb,
      created_at   TIMESTAMPTZ         NOT NULL DEFAULT now(),
      updated_at   TIMESTAMPTZ         NOT NULL DEFAULT now()
    )
  `)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS chat_messages (
      id          UUID               PRIMARY KEY DEFAULT uuid_generate_v4(),
      session_id  UUID               NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
      role        chat_message_role  NOT NULL,
      content     TEXT               NOT NULL,
      model_used  VARCHAR(100),
      tokens_used INTEGER            NOT NULL DEFAULT 0,
      latency_ms  INTEGER,
      tool_calls  JSONB,
      metadata    JSONB              NOT NULL DEFAULT '{}'::jsonb,
      created_at  TIMESTAMPTZ        NOT NULL DEFAULT now()
    )
  `)

  // Security events
  await pool.query(`
    CREATE TABLE IF NOT EXISTS security_events (
      id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
      user_id     UUID,
      user_type   TEXT,
      event_type  TEXT        NOT NULL,
      ip_address  INET,
      user_agent  TEXT,
      metadata    JSONB       NOT NULL DEFAULT '{}'::jsonb,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `)

  // Device trust (2FA bypass)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS trusted_devices (
      id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      operator_id     UUID NOT NULL REFERENCES operators(id) ON DELETE CASCADE,
      device_hash     VARCHAR(128) NOT NULL,
      device_name     TEXT,
      ip_address      TEXT,
      trusted_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at      TIMESTAMPTZ NOT NULL,
      last_used_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      revoked         BOOLEAN NOT NULL DEFAULT false,
      revoked_at      TIMESTAMPTZ,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS ux_trusted_devices_op_hash
    ON trusted_devices (operator_id, device_hash)
    WHERE revoked = false
  `)

  // Operator security preferences
  await pool.query(`
    CREATE TABLE IF NOT EXISTS operator_security_preferences (
      operator_id     UUID PRIMARY KEY REFERENCES operators(id) ON DELETE CASCADE,
      alert_on_2fa_disabled       BOOLEAN NOT NULL DEFAULT true,
      alert_on_backup_code_used   BOOLEAN NOT NULL DEFAULT true,
      alert_on_new_device_login   BOOLEAN NOT NULL DEFAULT true,
      alert_on_suspicious_access  BOOLEAN NOT NULL DEFAULT true,
      alert_on_lockout            BOOLEAN NOT NULL DEFAULT true,
      updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)

  // AI governance: activity log
  await pool.query(`
    CREATE TABLE IF NOT EXISTS activity_log (
      id           UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
      operator_id  UUID,
      action       TEXT,
      action_type  TEXT        NOT NULL DEFAULT 'note',
      target_type  TEXT,
      metadata     JSONB       NOT NULL DEFAULT '{}'::jsonb,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `)

  // AI predictions
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ai_predictions (
      id                          UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
      hazard_type                 TEXT,
      region_id                   TEXT,
      probability                 DOUBLE PRECISION,
      risk_level                  TEXT,
      confidence                  DOUBLE PRECISION,
      confidence_score            DOUBLE PRECISION,
      model_version               TEXT,
      predicted_label             TEXT,
      predicted_severity          TEXT,
      top_shap_contributors       JSONB,
      input_feature_summary_hash  TEXT,
      prediction_response         JSONB,
      contributing_factors        JSONB,
      data_sources                JSONB,
      feedback                    TEXT,
      requested_by                UUID,
      execution_time_ms           INT,
      predicted_peak_time         TIMESTAMPTZ,
      expires_at                  TIMESTAMPTZ,
      generated_at                TIMESTAMPTZ   NOT NULL DEFAULT now(),
      created_at                  TIMESTAMPTZ   NOT NULL DEFAULT now()
    )
  `)

  // Add PostGIS geometry columns to ai_predictions if extension is available
  await pool.query(`
    ALTER TABLE ai_predictions
    ADD COLUMN IF NOT EXISTS input_coordinates geometry(Point, 4326)
  `).catch(() => {})
  await pool.query(`
    ALTER TABLE ai_predictions
    ADD COLUMN IF NOT EXISTS affected_area geometry
  `).catch(() => {})

  // Model monitoring snapshots
  await pool.query(`
    CREATE TABLE IF NOT EXISTS model_monitoring_snapshots (
      id               UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
      hazard_type      TEXT          NOT NULL,
      region_id        TEXT          NOT NULL,
      model_version    TEXT          NOT NULL,
      drift_score      DOUBLE PRECISION,
      avg_confidence   DOUBLE PRECISION,
      health_status    TEXT          NOT NULL DEFAULT 'healthy',
      sample_count     INT           NOT NULL DEFAULT 0,
      alert_level      TEXT,
      snapshot_data    JSONB         NOT NULL DEFAULT '{}'::jsonb,
      computed_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),
      created_at       TIMESTAMPTZ   NOT NULL DEFAULT now()
    )
  `)
  await pool.query(`ALTER TABLE model_monitoring_snapshots ADD COLUMN IF NOT EXISTS snapshot_time TIMESTAMPTZ`)
  await pool.query(`ALTER TABLE model_monitoring_snapshots ADD COLUMN IF NOT EXISTS prediction_positive_rate DOUBLE PRECISION`)
  await pool.query(`ALTER TABLE model_monitoring_snapshots ADD COLUMN IF NOT EXISTS confidence_std DOUBLE PRECISION`)
  await pool.query(`ALTER TABLE model_monitoring_snapshots ADD COLUMN IF NOT EXISTS top_feature_means JSONB`)
  await pool.query(`ALTER TABLE model_monitoring_snapshots ADD COLUMN IF NOT EXISTS top_feature_stds JSONB`)

  // Scheduled jobs log (cron audit)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS scheduled_jobs (
      id               UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
      job_name         TEXT          NOT NULL,
      status           TEXT          NOT NULL DEFAULT 'success',
      duration_ms      INT,
      records_affected INT,
      error_message    TEXT,
      completed_at     TIMESTAMPTZ   NOT NULL DEFAULT now()
    )
  `)
}

// Cleanup helpers

/* Tables in dependency-safe truncation order (children first). */
const ALL_TEST_TABLES = [
  'security_events',
  'scheduled_jobs',
  'activity_log',
  'model_monitoring_snapshots',
  'ai_predictions',
  'chat_messages',
  'chat_sessions',
  'alert_delivery_log',
  'citizen_alert_history',
  'account_deletion_log',
  'messages',
  'message_threads',
  'safety_check_ins',
  'emergency_contacts',
  'citizen_preferences',
  'community_chat_messages',
  'community_post_reports',
  'community_post_shares',
  'community_post_likes',
  'community_comments',
  'community_posts',
  'community_help',
  'report_media',
  'reports',
  'alert_subscriptions',
  'alerts',
  'distress_location_history',
  'distress_calls',
  'flood_predictions',
  'departments',
  'operators',
  'citizens',
]

/**
 * Truncate all test tables. Call in afterEach / afterAll to isolate tests.
 */
export async function truncateAll(): Promise<void> {
  const pool = getTestPool()
  await pool.query(`TRUNCATE ${ALL_TEST_TABLES.join(', ')} CASCADE`)
}

/**
 * Truncate specific tables only.
 */
export async function truncateTables(...tables: string[]): Promise<void> {
  const pool = getTestPool()
  // Allowlist check to prevent SQL injection
  for (const t of tables) {
    if (!ALL_TEST_TABLES.includes(t)) {
      throw new Error(`Unknown table: ${t}`)
    }
  }
  await pool.query(`TRUNCATE ${tables.join(', ')} CASCADE`)
}

// Transaction wrapper (for single-test isolation)

/**
 * Run a callback inside a transaction that is always rolled back.
 * Useful for tests that need full isolation without truncation cost.
 */
export async function withRollback<T>(
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const pool = getTestPool()
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await fn(client)
    await client.query('ROLLBACK')
    return result
  } finally {
    client.release()
  }
}

// Lifecycle

/**
 * Close the pool. Call in the final afterAll of each test file.
 */
export async function closeTestPool(): Promise<void> {
  if (_pool) {
    await _pool.end()
    _pool = null
  }
}
