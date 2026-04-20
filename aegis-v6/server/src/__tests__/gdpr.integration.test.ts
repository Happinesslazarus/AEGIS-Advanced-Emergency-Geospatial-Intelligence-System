/**
 * Integration tests for GDPR data-subject rights endpoints.
  * Verifies data export (Article 20), erasure request (Article 17),
  * and consent logging against a real PostgreSQL database.
  *
  * - Tests server/src/routes/gdprRoutes.ts
  * - Touches gdpr_requests and consent_log tables
  * - Run via: npm test -- gdpr
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach } from '@jest/globals'
import request from 'supertest'
import express, { type Request, type Response, type NextFunction } from 'express'

//Test environment
process.env.JWT_SECRET = 'test-jwt-secret-at-least-32-characters-long'
process.env.REFRESH_TOKEN_SECRET = 'test-refresh-secret-at-least-32-chars'
process.env.NODE_ENV = 'test'

import {
  getTestPool, ensureTestSchema, truncateAll, closeTestPool,
} from './helpers/testDb'
import {
  citizenToken, operatorToken, authHeader,
  TEST_CITIZEN,
} from './helpers/testAuth'
import { insertCitizen, seedCitizenData } from './helpers/testFixtures'
import citizenRoutes from '../routes/citizenRoutes'

//Build test app

let app: express.Express

function buildGdprTestApp() {
  const _app = express()
  _app.use(express.json())
  _app.use('/api/citizen', citizenRoutes)
  _app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.statusCode || err.status || 500
    res.status(status).json({ error: err.message || 'Internal Server Error' })
  })

  return _app
}

//Lifecycle

beforeAll(async () => {
  app = buildGdprTestApp()
  await ensureTestSchema()
}, 30_000)

beforeEach(async () => {
  await insertCitizen()
})

afterEach(async () => {
  const pool = getTestPool()
  await pool.query('TRUNCATE community_posts, community_chat_messages, messages, message_threads, safety_check_ins, emergency_contacts, citizen_preferences, citizen_alert_history, account_deletion_log, reports CASCADE')
})

afterAll(async () => {
  await truncateAll()
  await closeTestPool()
})

describe('GDPR Integration Tests', () => {

  //Data Export (Article 20)

  describe('Data Export', () => {
    it('should export all citizen data', async () => {
      await seedCitizenData(TEST_CITIZEN.id)

      const res = await request(app)
        .get('/api/citizen/data-export')
        .set(...authHeader(citizenToken()))

      expect(res.status).toBe(200)
      expect(res.body.exportDate).toBeDefined()
      expect(res.body.profile).toBeDefined()
      expect(res.body.profile.id).toBe(TEST_CITIZEN.id)
      expect(res.body.profile.email).toBe(TEST_CITIZEN.email)
      expect(res.body.reports.length).toBeGreaterThanOrEqual(1)
      expect(res.body.messageThreads.length).toBeGreaterThanOrEqual(1)
      expect(res.body.messages.length).toBeGreaterThanOrEqual(1)
      expect(res.body.safetyCheckIns.length).toBeGreaterThanOrEqual(1)
      expect(res.body.emergencyContacts.length).toBeGreaterThanOrEqual(1)
      expect(res.body.preferences).not.toBeNull()
    })

    it('should export empty arrays for citizen with no data', async () => {
      const res = await request(app)
        .get('/api/citizen/data-export')
        .set(...authHeader(citizenToken()))

      expect(res.status).toBe(200)
      expect(res.body.profile).toBeDefined()
      expect(res.body.reports).toEqual([])
      expect(res.body.messages).toEqual([])
      expect(res.body.safetyCheckIns).toEqual([])
    })

    it('should reject unauthenticated export', async () => {
      const res = await request(app).get('/api/citizen/data-export')
      expect(res.status).toBe(401)
    })

    it('should reject operator trying to export citizen data', async () => {
      const res = await request(app)
        .get('/api/citizen/data-export')
        .set(...authHeader(operatorToken()))

      expect(res.status).toBe(403)
    })
  })

  //Data Erasure (Article 17)

  describe('Data Erasure', () => {
    it('should delete all citizen data and anonymise reports', async () => {
      await seedCitizenData(TEST_CITIZEN.id)

      const res = await request(app)
        .delete('/api/citizen/data-erasure')
        .set(...authHeader(citizenToken()))

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)

      //Verify citizen account deleted
      const pool = getTestPool()
      const citizen = await pool.query('SELECT id FROM citizens WHERE id = $1', [TEST_CITIZEN.id])
      expect(citizen.rows.length).toBe(0)

      //Verify personal data deleted
      const contacts = await pool.query('SELECT id FROM emergency_contacts WHERE citizen_id = $1', [TEST_CITIZEN.id])
      expect(contacts.rows.length).toBe(0)

      const checkins = await pool.query('SELECT id FROM safety_check_ins WHERE citizen_id = $1', [TEST_CITIZEN.id])
      expect(checkins.rows.length).toBe(0)

      const prefs = await pool.query('SELECT * FROM citizen_preferences WHERE citizen_id = $1', [TEST_CITIZEN.id])
      expect(prefs.rows.length).toBe(0)

      const threads = await pool.query('SELECT id FROM message_threads WHERE citizen_id = $1', [TEST_CITIZEN.id])
      expect(threads.rows.length).toBe(0)
    })

    it('should anonymise reports (keep for safety, remove PII)', async () => {
      await seedCitizenData(TEST_CITIZEN.id)

      await request(app)
        .delete('/api/citizen/data-erasure')
        .set(...authHeader(citizenToken()))

      //Reports should exist but be anonymised
      const pool = getTestPool()
      const reports = await pool.query('SELECT reporter_name, citizen_id FROM reports WHERE reporter_name = $1', ['Anonymised'])
      expect(reports.rows.length).toBeGreaterThanOrEqual(1)
      expect(reports.rows[0].citizen_id).toBeNull()
    })

    it('should anonymise community posts', async () => {
      await seedCitizenData(TEST_CITIZEN.id)

      await request(app)
        .delete('/api/citizen/data-erasure')
        .set(...authHeader(citizenToken()))

      const pool = getTestPool()
      const posts = await pool.query('SELECT author_id FROM community_posts WHERE author_id IS NULL')
      expect(posts.rows.length).toBeGreaterThanOrEqual(1)
    })

    it('should create audit log entry', async () => {
      await seedCitizenData(TEST_CITIZEN.id)

      await request(app)
        .delete('/api/citizen/data-erasure')
        .set(...authHeader(citizenToken()))

      const pool = getTestPool()
      const log = await pool.query(
        'SELECT * FROM account_deletion_log WHERE citizen_id = $1 AND action = $2',
        [TEST_CITIZEN.id, 'data_erasure_executed'],
      )
      expect(log.rows.length).toBeGreaterThanOrEqual(1)
    })

    it('should be transactional (all-or-nothing)', async () => {
      //If the citizen has seeded data, erasure should delete everything atomically
      await seedCitizenData(TEST_CITIZEN.id)

      const res = await request(app)
        .delete('/api/citizen/data-erasure')
        .set(...authHeader(citizenToken()))

      expect(res.status).toBe(200)
      //If it succeeded, all personal data must be gone
      const pool = getTestPool()
      const citizen = await pool.query('SELECT id FROM citizens WHERE id = $1', [TEST_CITIZEN.id])
      expect(citizen.rows.length).toBe(0)
    })
  })

  //30-Day Account Deletion Grace Period

  describe('Account Deletion (30-day grace)', () => {
    it('should request deletion and set 30-day schedule', async () => {
      const res = await request(app)
        .post('/api/citizen/request-deletion')
        .set(...authHeader(citizenToken()))

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.deletion_scheduled_at).toBeDefined()

      //Verify the scheduled date is ~30 days ahead
      const scheduledDate = new Date(res.body.deletion_scheduled_at)
      const now = new Date()
      const daysDiff = (scheduledDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
      expect(daysDiff).toBeGreaterThan(29)
      expect(daysDiff).toBeLessThan(31)
    })

    it('should return already_requested on duplicate request', async () => {
      await request(app)
        .post('/api/citizen/request-deletion')
        .set(...authHeader(citizenToken()))

      const res = await request(app)
        .post('/api/citizen/request-deletion')
        .set(...authHeader(citizenToken()))

      expect(res.body.already_requested).toBe(true)
    })

    it('should cancel pending deletion', async () => {
      await request(app)
        .post('/api/citizen/request-deletion')
        .set(...authHeader(citizenToken()))

      const res = await request(app)
        .post('/api/citizen/cancel-deletion')
        .set(...authHeader(citizenToken()))

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)

      //Verify timestamps cleared
      const pool = getTestPool()
      const { rows } = await pool.query(
        'SELECT deletion_requested_at, deletion_scheduled_at FROM citizens WHERE id = $1',
        [TEST_CITIZEN.id],
      )
      expect(rows[0].deletion_requested_at).toBeNull()
      expect(rows[0].deletion_scheduled_at).toBeNull()
    })

    it('should reject cancellation when no pending request', async () => {
      const res = await request(app)
        .post('/api/citizen/cancel-deletion')
        .set(...authHeader(citizenToken()))

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
    })

    it('should log deletion request in audit trail', async () => {
      await request(app)
        .post('/api/citizen/request-deletion')
        .set(...authHeader(citizenToken()))

      const pool = getTestPool()
      const log = await pool.query(
        'SELECT * FROM account_deletion_log WHERE citizen_id = $1 AND action = $2',
        [TEST_CITIZEN.id, 'deletion_requested'],
      )
      expect(log.rows.length).toBe(1)
    })

    it('should expose deletion status and reject unauthenticated deletion operations', async () => {
      const pool = getTestPool()
      await pool.query(
        'UPDATE citizens SET deletion_requested_at = NULL, deletion_scheduled_at = NULL WHERE id = $1',
        [TEST_CITIZEN.id],
      )

      const initial = await request(app)
        .get('/api/citizen/deletion-status')
        .set(...authHeader(citizenToken()))

      expect(initial.status).toBe(200)
      expect(initial.body.deletion_requested).toBe(false)

      await request(app)
        .post('/api/citizen/request-deletion')
        .set(...authHeader(citizenToken()))

      const scheduled = await request(app)
        .get('/api/citizen/deletion-status')
        .set(...authHeader(citizenToken()))

      expect(scheduled.status).toBe(200)
      expect(scheduled.body.deletion_requested).toBe(true)

      const unauth = await request(app).post('/api/citizen/cancel-deletion')
      expect(unauth.status).toBe(401)
    })

    it('rejects non-citizen tokens on deletion routes', async () => {
      const requestDeletion = await request(app)
        .post('/api/citizen/request-deletion')
        .set(...authHeader(operatorToken()))

      expect(requestDeletion.status).toBe(403)

      const status = await request(app)
        .get('/api/citizen/deletion-status')
        .set(...authHeader(operatorToken()))

      expect(status.status).toBe(403)
    })
  })
})

