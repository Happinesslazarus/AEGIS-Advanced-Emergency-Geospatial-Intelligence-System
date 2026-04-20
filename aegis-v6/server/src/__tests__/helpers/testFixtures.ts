/**
 * Database fixture helpers for integration tests. Provides `insertCitizen`,
 * `insertOperator`, `insertAdmin`, and cleanup utilities that seed the test
 * database with predictable user records before each test and remove them
 * afterwards, ensuring test isolation without full schema teardown.
 *
 * - Depends on testDb.ts (Pool) and testAuth.ts (canonical test user IDs)
 * - Called in beforeEach / afterEach blocks across the integration test suite
 */

import { getTestPool } from './testDb'
import { TEST_CITIZEN, TEST_OPERATOR, TEST_ADMIN, type TestUser } from './testAuth'

// User fixtures

/* Insert a citizen into the `citizens` table. Returns the full row. */
export async function insertCitizen(overrides: Partial<Record<string, unknown>> = {}) {
  const pool = getTestPool()
  const defaults = {
    id: TEST_CITIZEN.id,
    email: TEST_CITIZEN.email,
    display_name: TEST_CITIZEN.displayName,
    role: 'citizen',
    phone: '+447700900000',
    is_vulnerable: false,
    password_hash: '$2b$12$placeholderhash',
  }
  const d = { ...defaults, ...overrides }
  const { rows } = await pool.query(
    `INSERT INTO citizens (id, email, display_name, role, phone, is_vulnerable, password_hash)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name
     RETURNING *`,
    [d.id, d.email, d.display_name, d.role, d.phone, d.is_vulnerable, d.password_hash],
  )
  return rows[0]
}

/* Insert an operator into the `operators` table. */
export async function insertOperator(overrides: Partial<Record<string, unknown>> = {}) {
  const pool = getTestPool()
  const defaults = {
    id: TEST_OPERATOR.id,
    email: TEST_OPERATOR.email,
    display_name: TEST_OPERATOR.displayName,
    role: 'operator',
    department: 'Emergency Response',
  }
  const d = { ...defaults, ...overrides }
  const { rows } = await pool.query(
    `INSERT INTO operators (id, email, display_name, role, department)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name
     RETURNING *`,
    [d.id, d.email, d.display_name, d.role, d.department],
  )
  return rows[0]
}

// Distress fixtures

export interface DistressFixture {
  citizenId: string
  citizenName: string
  latitude: number
  longitude: number
  message?: string
  contactNumber?: string
}

export const DEFAULT_DISTRESS: DistressFixture = {
  citizenId: TEST_CITIZEN.id,
  citizenName: 'Test Citizen',
  latitude: 57.1497,
  longitude: -2.0943,
  message: 'Integration test SOS',
  contactNumber: '+447700900000',
}

// Report fixtures

export interface ReportFixture {
  incident_category: string
  description: string
  severity: string
  location_text: string
  latitude: number
  longitude: number
  reporter_name?: string
}

export const FLOOD_REPORT: ReportFixture = {
  incident_category: 'flood',
  description: 'Water rising rapidly near residential area after heavy rain.',
  severity: 'high',
  location_text: 'Test Location, Aberdeen',
  latitude: 57.1497,
  longitude: -2.0943,
  reporter_name: 'Test Reporter',
}

export const FIRE_REPORT: ReportFixture = {
  incident_category: 'wildfire',
  description: 'Smoke visible from brush fire on hillside.',
  severity: 'medium',
  location_text: 'Hill Road, Test Area',
  latitude: 57.15,
  longitude: -2.10,
  reporter_name: 'Fire Reporter',
}

export const MINOR_REPORT: ReportFixture = {
  incident_category: 'infrastructure_damage',
  description: 'Small pothole on road causing traffic delays.',
  severity: 'low',
  location_text: 'Main Street',
  latitude: 57.148,
  longitude: -2.095,
}

/* Insert a report directly into the DB (bypasses API validation). */
export async function insertReport(overrides: Partial<Record<string, unknown>> = {}) {
  const pool = getTestPool()
  const d = { ...FLOOD_REPORT, ...overrides }
  const { rows } = await pool.query(
    `INSERT INTO reports (incident_category, description, severity, location_text,
       coordinates, reporter_name, status)
     VALUES ($1,$2,$3,$4, ST_MakePoint($5,$6)::geography, $7, $8) RETURNING *`,
    [
      d.incident_category, d.description, d.severity, d.location_text,
      d.longitude, d.latitude, d.reporter_name || null, (d as any).status || 'new',
    ],
  )
  return rows[0]
}

// Alert fixtures

export interface AlertFixture {
  title: string
  message: string
  severity: string
  alert_type: string
  location_text?: string
}

export const CRITICAL_ALERT: AlertFixture = {
  title: 'FLOOD WARNING — Immediate Action Required',
  message: 'River levels have breached flood defences. Evacuate low-lying areas immediately.',
  severity: 'critical',
  alert_type: 'flood',
  location_text: 'Test River Basin',
}

export const INFO_ALERT: AlertFixture = {
  title: 'Weather Advisory',
  message: 'Heavy rain expected over the next 24 hours. Stay informed.',
  severity: 'info',
  alert_type: 'weather',
}

/* Insert an alert directly into the DB. */
export async function insertAlert(overrides: Partial<Record<string, unknown>> = {}) {
  const pool = getTestPool()
  const d = { ...CRITICAL_ALERT, ...overrides }
  const { rows } = await pool.query(
    `INSERT INTO alerts (title, message, severity, alert_type, location_text, is_active)
     VALUES ($1,$2,$3,$4,$5, true) RETURNING *`,
    [d.title, d.message, d.severity, d.alert_type, d.location_text || null],
  )
  return rows[0]
}

// Alert subscription fixtures

export async function insertSubscription(overrides: Partial<Record<string, unknown>> = {}) {
  const pool = getTestPool()
  const defaults = {
    email: 'subscriber@test.aegis.local',
    phone: '+447700900001',
    channels: ['email'],
    verified: true,
    consent_given: true,
    severity_filter: ['critical', 'warning', 'info'],
    topic_filter: ['flood', 'fire', 'storm', 'general'],
  }
  const d = { ...defaults, ...overrides }
  const { rows } = await pool.query(
    `INSERT INTO alert_subscriptions
       (email, phone, channels, verified, consent_given, consent_timestamp, severity_filter, topic_filter)
     VALUES ($1,$2,$3,$4,$5,NOW(),$6,$7) RETURNING *`,
    [d.email, d.phone, d.channels, d.verified, d.consent_given, d.severity_filter, d.topic_filter],
  )
  return rows[0]
}

// Community fixtures

/* Insert a community post. */
export async function insertPost(authorId: string, content = 'Test community post') {
  const pool = getTestPool()
  const { rows } = await pool.query(
    `INSERT INTO community_posts (author_id, content) VALUES ($1,$2) RETURNING *`,
    [authorId, content],
  )
  return rows[0]
}

// GDPR fixtures

/* Seed a citizen with data across many tables for GDPR export/erasure tests. */
export async function seedCitizenData(citizenId: string) {
  const pool = getTestPool()
  // safety check-in
  await pool.query(
    `INSERT INTO safety_check_ins (citizen_id, status, message) VALUES ($1,'safe','All good')`,
    [citizenId],
  )
  // emergency contact
  await pool.query(
    `INSERT INTO emergency_contacts (citizen_id, name, phone, relationship, is_primary)
     VALUES ($1,'Jane Doe','+447700900099','partner',true)`,
    [citizenId],
  )
  // preferences
  await pool.query(
    `INSERT INTO citizen_preferences (citizen_id, theme, language)
     VALUES ($1,'dark','en') ON CONFLICT DO NOTHING`,
    [citizenId],
  )
  // message thread + message
  const thread = await pool.query(
    `INSERT INTO message_threads (citizen_id, subject) VALUES ($1,'Help needed') RETURNING id`,
    [citizenId],
  )
  await pool.query(
    `INSERT INTO messages (thread_id, content, sender_type) VALUES ($1,'Please help','citizen')`,
    [thread.rows[0].id],
  )
  // report linked to citizen
  await pool.query(
    `INSERT INTO reports (citizen_id, description, severity, reporter_name, reporter_contact)
     VALUES ($1,'Flood in my area','high','Test User','test@aegis.local')`,
    [citizenId],
  )
  // community post
  await pool.query(
    `INSERT INTO community_posts (author_id, content) VALUES ($1,'Community update from test citizen')`,
    [citizenId],
  )
}

// Flood prediction fixtures

export async function insertFloodPrediction(overrides: Partial<Record<string, unknown>> = {}) {
  const pool = getTestPool()
  const defaults = {
    region_id: 'scotland',
    latitude: 57.1497,
    longitude: -2.0943,
    area: 'Test River Basin',
    risk_level: 'high',
    confidence: 0.82,
    predicted_level: 2.5,
    fusion_score: 0.75,
    time_to_flood_min: 120,
    status: 'active',
  }
  const d = { ...defaults, ...overrides }
  const { rows } = await pool.query(
    `INSERT INTO flood_predictions
       (region_id, latitude, longitude, area, risk_level, confidence,
        predicted_level, fusion_score, time_to_flood_min, status,
        expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, NOW() + INTERVAL '6 hours')
     RETURNING *`,
    [d.region_id, d.latitude, d.longitude, d.area, d.risk_level,
     d.confidence, d.predicted_level, d.fusion_score, d.time_to_flood_min, d.status],
  )
  return rows[0]
}

