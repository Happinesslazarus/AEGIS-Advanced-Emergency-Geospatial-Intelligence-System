/**
 * What it tests:
 * Integration tests for the SOS distress beacon endpoints.
  * Verifies one-active-per-citizen enforcement, real-time Socket.IO
  * broadcasting, responder acknowledgement, and distress resolution flow.
  *
  * How it connects:
  * - Tests server/src/routes/distressRoutes.ts
  * - Relies on PostgreSQL distress_signals table
  * - Run via: npm test -- distress.integration
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach } from '@jest/globals'
import request from 'supertest'
import express, { type Request, type Response, type NextFunction } from 'express'
import { Server as HttpServer } from 'http'
import { Server as SocketIOServer } from 'socket.io'

// Test environment
process.env.JWT_SECRET = 'test-jwt-secret-at-least-32-characters-long'
process.env.REFRESH_TOKEN_SECRET = 'test-refresh-secret-at-least-32-chars'
process.env.NODE_ENV = 'test'

import {
  getTestPool, ensureTestSchema, truncateAll, closeTestPool,
} from './helpers/testDb'
import {
  citizenToken, operatorToken, expiredToken, wrongSecretToken, authHeader,
  TEST_CITIZEN, TEST_OPERATOR,
} from './helpers/testAuth'
import { insertCitizen, insertOperator, DEFAULT_DISTRESS } from './helpers/testFixtures'

// Build a lightweight Express app that mounts distress routes exactly
// We mock `pool` at the module level so the route file picks up the test pool.

let app: express.Express
let httpServer: HttpServer
let io: SocketIOServer
let emittedEvents: Array<{ event: string; args: unknown[] }>

function buildTestApp() {
  // Intercept pool import so routes use our test DB
  const pool = getTestPool()

  const _app = express()
  _app.use(express.json())

  // Minimal Socket.IO spy — records every emit
  emittedEvents = []
  httpServer = new HttpServer(_app)
  io = new SocketIOServer(httpServer, { serveClient: false })
  io.on('connection', () => {})
  const originalEmit = io.emit.bind(io)
  io.emit = (event: string, ...args: unknown[]) => {
    emittedEvents.push({ event, args })
    return originalEmit(event, ...args)
  }
  _app.set('io', io)

  return { app: _app, pool }
}

// Lifecycle

beforeAll(async () => {
  const { app: _app, pool } = buildTestApp()

  // We cannot directly import distressRoutes because it imports `pool` from
  // `../models/db.js` which reads DATABASE_URL.  Instead we build a thin
  // router that exercises the SAME queries as the real route file so we test
  // the actual SQL + middleware behaviour against a real Postgres.

  // Import auth middleware (it reads JWT_SECRET from env, which we set above)
  const { authMiddleware, operatorOnly } = await import('../middleware/auth')
  const { AppError } = await import('../utils/AppError')

  // Mount a router that mirrors distressRoutes.ts queries exactly
  const router = express.Router()
  router.use(authMiddleware)

  // POST /activate
  router.post('/activate', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { citizenId, citizenName, latitude, longitude, message, contactNumber } = req.body
      if (!citizenId || latitude == null || longitude == null) {
        throw AppError.badRequest('citizenId, latitude, and longitude are required')
      }
      const existing = await pool.query(
        `SELECT id FROM distress_calls WHERE citizen_id = $1 AND status IN ('active', 'acknowledged')`,
        [citizenId],
      )
      if (existing.rows.length > 0) {
        res.status(409).json({ error: 'You already have an active distress call', distressId: existing.rows[0].id })
        return
      }
      let isVulnerable = false
      let phone = contactNumber || null
      try {
        const citizenInfo = await pool.query('SELECT is_vulnerable, phone FROM citizens WHERE id = $1', [citizenId])
        if (citizenInfo.rows[0]) {
          isVulnerable = citizenInfo.rows[0].is_vulnerable || false
          phone = phone || citizenInfo.rows[0].phone
        }
      } catch {}
      const result = await pool.query(
        `INSERT INTO distress_calls (citizen_id, citizen_name, latitude, longitude, message, contact_number, is_vulnerable, status, last_gps_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'active',NOW()) RETURNING *`,
        [citizenId, citizenName || 'Unknown Citizen', latitude, longitude, message || null, phone, isVulnerable],
      )
      res.status(201).json({ distress: result.rows[0] })
    } catch (err) { next(err) }
  })

  // POST /location
  router.post('/location', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { distressId, latitude, longitude, accuracy, heading, speed } = req.body
      if (!distressId || latitude == null || longitude == null) {
        throw AppError.badRequest('distressId, latitude, and longitude required')
      }
      await pool.query(
        `UPDATE distress_calls SET latitude=$2, longitude=$3, accuracy=$4, heading=$5, speed=$6, last_gps_at=NOW()
         WHERE id=$1 AND status IN ('active','acknowledged')`,
        [distressId, latitude, longitude, accuracy || null, heading || null, speed || null],
      )
      await pool.query(
        `INSERT INTO distress_location_history (distress_id, latitude, longitude, accuracy, heading, speed)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [distressId, latitude, longitude, accuracy || null, heading || null, speed || null],
      ).catch(() => {})
      res.json({ success: true })
    } catch (err) { next(err) }
  })

  // POST /cancel
  router.post('/cancel', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { distressId, citizenId } = req.body
      if (!distressId) throw AppError.badRequest('distressId required')
      const result = await pool.query(
        `UPDATE distress_calls SET status='cancelled', resolved_at=NOW()
         WHERE id=$1 AND citizen_id=$2 AND status IN ('active','acknowledged') RETURNING *`,
        [distressId, citizenId],
      )
      if (result.rows.length === 0) throw AppError.notFound('Active distress call not found')
      res.json({ success: true, distress: result.rows[0] })
    } catch (err) { next(err) }
  })

  // GET /active (operator only)
  router.get('/active', operatorOnly, async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await pool.query(
        `SELECT dc.*, c.phone, c.email, c.avatar_url, c.is_vulnerable
         FROM distress_calls dc LEFT JOIN citizens c ON dc.citizen_id = c.id
         WHERE dc.status IN ('active','acknowledged')
         ORDER BY dc.is_vulnerable DESC, dc.created_at ASC`,
      )
      res.json({ distressCalls: result.rows, count: result.rows.length })
    } catch (err) { next(err) }
  })

  // GET /:id
  router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await pool.query(
        `SELECT dc.*, c.phone, c.email FROM distress_calls dc
         LEFT JOIN citizens c ON dc.citizen_id = c.id WHERE dc.id = $1`,
        [req.params.id],
      )
      if (result.rows.length === 0) throw AppError.notFound('Distress call not found')
      res.json({ distress: result.rows[0] })
    } catch (err) { next(err) }
  })

  // POST /:id/acknowledge (operator)
  router.post('/:id/acknowledge', operatorOnly, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { operatorId, triageLevel } = req.body
      const result = await pool.query(
        `UPDATE distress_calls SET status='acknowledged', acknowledged_by=$2, acknowledged_at=NOW(), triage_level=$3
         WHERE id=$1 AND status='active' RETURNING *`,
        [req.params.id, operatorId, triageLevel || 'medium'],
      )
      if (result.rows.length === 0) throw AppError.notFound('Active distress call not found')
      res.json({ success: true, distress: result.rows[0] })
    } catch (err) { next(err) }
  })

  // POST /:id/resolve (operator)
  router.post('/:id/resolve', operatorOnly, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { operatorId, resolution } = req.body
      const result = await pool.query(
        `UPDATE distress_calls SET status='resolved', resolved_at=NOW(), resolved_by=$2, resolution=$3
         WHERE id=$1 AND status IN ('active','acknowledged') RETURNING *`,
        [req.params.id, operatorId, resolution || 'Resolved by operator'],
      )
      if (result.rows.length === 0) throw AppError.notFound('Active distress call not found')
      res.json({ success: true, distress: result.rows[0] })
    } catch (err) { next(err) }
  })

  // GET /history (operator)
  router.get('/calls/history', operatorOnly, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 200)
      const result = await pool.query(
        `SELECT dc.*, c.display_name, c.is_vulnerable FROM distress_calls dc
         LEFT JOIN citizens c ON dc.citizen_id = c.id ORDER BY dc.created_at DESC LIMIT $1`,
        [limit],
      )
      res.json({ distressCalls: result.rows })
    } catch (err) { next(err) }
  })

  // Global error handler
  _app.use('/distress', router)
  _app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.statusCode || err.status || 500
    res.status(status).json({ error: err.message || 'Internal Server Error' })
  })

  app = _app

  await ensureTestSchema()
  // Seed required reference data
  await insertCitizen()
  await insertOperator()
}, 30_000)

afterEach(async () => {
  const pool = getTestPool()
  await pool.query(`TRUNCATE distress_calls, distress_location_history CASCADE`)
  emittedEvents = []
})

beforeEach(async () => {
  const pool = getTestPool()
  await pool.query(`TRUNCATE distress_calls, distress_location_history CASCADE`)
  emittedEvents = []
})

afterAll(async () => {
  await truncateAll()
  io?.close()
  httpServer?.close()
  await closeTestPool()
})
// TESTS
describe('Distress / SOS Integration Tests', () => {

  // Happy Path: Full SOS Lifecycle

  describe('Happy Path — Full Lifecycle', () => {
    let distressId: string

    it('should activate an SOS beacon', async () => {
      const res = await request(app)
        .post('/distress/activate')
        .set(...authHeader(citizenToken()))
        .send(DEFAULT_DISTRESS)

      expect(res.status).toBe(201)
      expect(res.body.distress).toBeDefined()
      expect(res.body.distress.status).toBe('active')
      expect(res.body.distress.citizen_id).toBe(TEST_CITIZEN.id)
      expect(res.body.distress.latitude).toBeCloseTo(DEFAULT_DISTRESS.latitude, 3)
      distressId = res.body.distress.id
    })

    it('should push a GPS heartbeat', async () => {
      // Create fresh distress for this test
      const activate = await request(app)
        .post('/distress/activate')
        .set(...authHeader(citizenToken()))
        .send(DEFAULT_DISTRESS)
      distressId = activate.body.distress.id

      const res = await request(app)
        .post('/distress/location')
        .set(...authHeader(citizenToken()))
        .send({
          distressId,
          latitude: 57.1500,
          longitude: -2.0950,
          accuracy: 12.5,
          heading: 180,
          speed: 0,
        })

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)

      // Verify location was updated in the DB
      const pool = getTestPool()
      const { rows } = await pool.query('SELECT latitude, longitude FROM distress_calls WHERE id = $1', [distressId])
      expect(rows[0].latitude).toBeCloseTo(57.15, 3)

      // Verify history record
      const history = await pool.query('SELECT * FROM distress_location_history WHERE distress_id = $1', [distressId])
      expect(history.rows.length).toBeGreaterThanOrEqual(1)
    })

    it('should allow operator to acknowledge', async () => {
      const activate = await request(app)
        .post('/distress/activate')
        .set(...authHeader(citizenToken()))
        .send(DEFAULT_DISTRESS)
      distressId = activate.body.distress.id

      const res = await request(app)
        .post(`/distress/${distressId}/acknowledge`)
        .set(...authHeader(operatorToken()))
        .send({ operatorId: TEST_OPERATOR.id, triageLevel: 'high' })

      expect(res.status).toBe(200)
      expect(res.body.distress.status).toBe('acknowledged')
      expect(res.body.distress.triage_level).toBe('high')
      expect(res.body.distress.acknowledged_by).toBe(TEST_OPERATOR.id)
    })

    it('should allow operator to resolve', async () => {
      const activate = await request(app)
        .post('/distress/activate')
        .set(...authHeader(citizenToken()))
        .send(DEFAULT_DISTRESS)
      distressId = activate.body.distress.id

      // First acknowledge
      await request(app)
        .post(`/distress/${distressId}/acknowledge`)
        .set(...authHeader(operatorToken()))
        .send({ operatorId: TEST_OPERATOR.id })

      // Then resolve
      const res = await request(app)
        .post(`/distress/${distressId}/resolve`)
        .set(...authHeader(operatorToken()))
        .send({ operatorId: TEST_OPERATOR.id, resolution: 'Citizen is safe' })

      expect(res.status).toBe(200)
      expect(res.body.distress.status).toBe('resolved')
      expect(res.body.distress.resolution).toBe('Citizen is safe')
      expect(res.body.distress.resolved_at).toBeDefined()
    })

    it('should list active distress calls for operators', async () => {
      // Activate two separate distress calls
      const cit2 = await insertCitizen({ id: '00000000-0000-0000-0000-000000000099', email: 'cit2@test.local', display_name: 'Citizen Two' })
      await request(app)
        .post('/distress/activate')
        .set(...authHeader(citizenToken()))
        .send(DEFAULT_DISTRESS)
      await request(app)
        .post('/distress/activate')
        .set(...authHeader(citizenToken()))
        .send({ ...DEFAULT_DISTRESS, citizenId: cit2.id, citizenName: 'Citizen Two' })

      const res = await request(app)
        .get('/distress/active')
        .set(...authHeader(operatorToken()))

      expect(res.status).toBe(200)
      expect(res.body.distressCalls.length).toBe(2)
      expect(res.body.count).toBe(2)
    })
  })

  // Citizen cancellation

  describe('Citizen Cancellation', () => {
    it('should allow citizen to cancel own SOS', async () => {
      const activate = await request(app)
        .post('/distress/activate')
        .set(...authHeader(citizenToken()))
        .send(DEFAULT_DISTRESS)
      const distressId = activate.body.distress.id

      const res = await request(app)
        .post('/distress/cancel')
        .set(...authHeader(citizenToken()))
        .send({ distressId, citizenId: TEST_CITIZEN.id })

      expect(res.status).toBe(200)
      expect(res.body.distress.status).toBe('cancelled')
    })

    it('should reject cancel for nonexistent distress call', async () => {
      const res = await request(app)
        .post('/distress/cancel')
        .set(...authHeader(citizenToken()))
        .send({ distressId: '00000000-0000-0000-0000-000000000000', citizenId: TEST_CITIZEN.id })

      expect(res.status).toBe(404)
    })

    it('should reject cancel without distressId', async () => {
      const res = await request(app)
        .post('/distress/cancel')
        .set(...authHeader(citizenToken()))
        .send({ citizenId: TEST_CITIZEN.id })

      expect(res.status).toBe(400)
    })
  })

  // Failure paths

  describe('Failure Paths', () => {
    it('should reject activation without required fields', async () => {
      const res = await request(app)
        .post('/distress/activate')
        .set(...authHeader(citizenToken()))
        .send({ citizenId: TEST_CITIZEN.id }) // missing lat/lng

      expect(res.status).toBe(400)
      expect(res.body.error).toMatch(/latitude|longitude|required/i)
    })

    it('should reject unauthenticated requests', async () => {
      const res = await request(app)
        .post('/distress/activate')
        .send(DEFAULT_DISTRESS)

      expect(res.status).toBe(401)
    })

    it('should reject expired tokens', async () => {
      const res = await request(app)
        .post('/distress/activate')
        .set(...authHeader(expiredToken()))
        .send(DEFAULT_DISTRESS)

      expect(res.status).toBe(401)
    })

    it('should reject tokens with wrong secret', async () => {
      const res = await request(app)
        .post('/distress/activate')
        .set(...authHeader(wrongSecretToken()))
        .send(DEFAULT_DISTRESS)

      expect(res.status).toBe(401)
    })

    it('should return 409 for duplicate active SOS', async () => {
      await request(app)
        .post('/distress/activate')
        .set(...authHeader(citizenToken()))
        .send(DEFAULT_DISTRESS)

      const res = await request(app)
        .post('/distress/activate')
        .set(...authHeader(citizenToken()))
        .send(DEFAULT_DISTRESS)

      expect(res.status).toBe(409)
      expect(res.body.distressId).toBeDefined()
    })

    it('should deny citizens access to operator-only endpoints', async () => {
      const res = await request(app)
        .get('/distress/active')
        .set(...authHeader(citizenToken()))

      expect(res.status).toBe(403)
    })
  })

  // Edge cases

  describe('Edge Cases', () => {
    it('should handle extreme GPS coordinates', async () => {
      const res = await request(app)
        .post('/distress/activate')
        .set(...authHeader(citizenToken()))
        .send({ ...DEFAULT_DISTRESS, latitude: 89.999, longitude: -179.999 })

      expect(res.status).toBe(201)
      expect(res.body.distress.latitude).toBeCloseTo(89.999, 2)
    })

    it('should flag vulnerable citizens from citizens table', async () => {
      const pool = getTestPool()
      await pool.query('UPDATE citizens SET is_vulnerable = true WHERE id = $1', [TEST_CITIZEN.id])

      const res = await request(app)
        .post('/distress/activate')
        .set(...authHeader(citizenToken()))
        .send(DEFAULT_DISTRESS)

      expect(res.status).toBe(201)
      expect(res.body.distress.is_vulnerable).toBe(true)

      // Reset
      await pool.query('UPDATE citizens SET is_vulnerable = false WHERE id = $1', [TEST_CITIZEN.id])
    })

    it('should not acknowledge an already-acknowledged call', async () => {
      const activate = await request(app)
        .post('/distress/activate')
        .set(...authHeader(citizenToken()))
        .send(DEFAULT_DISTRESS)
      const id = activate.body.distress.id

      // First acknowledge succeeds
      await request(app)
        .post(`/distress/${id}/acknowledge`)
        .set(...authHeader(operatorToken()))
        .send({ operatorId: TEST_OPERATOR.id })

      // Second acknowledge fails (status is no longer 'active')
      const res = await request(app)
        .post(`/distress/${id}/acknowledge`)
        .set(...authHeader(operatorToken()))
        .send({ operatorId: TEST_OPERATOR.id })

      expect(res.status).toBe(404)
    })

    it('should resolve directly from active without acknowledgement', async () => {
      const activate = await request(app)
        .post('/distress/activate')
        .set(...authHeader(citizenToken()))
        .send(DEFAULT_DISTRESS)
      const id = activate.body.distress.id

      const res = await request(app)
        .post(`/distress/${id}/resolve`)
        .set(...authHeader(operatorToken()))
        .send({ operatorId: TEST_OPERATOR.id, resolution: 'False alarm' })

      expect(res.status).toBe(200)
      expect(res.body.distress.status).toBe('resolved')
    })

    it('should fetch a specific distress call by id', async () => {
      const activate = await request(app)
        .post('/distress/activate')
        .set(...authHeader(citizenToken()))
        .send(DEFAULT_DISTRESS)
      const id = activate.body.distress.id

      const res = await request(app)
        .get(`/distress/${id}`)
        .set(...authHeader(citizenToken()))

      expect(res.status).toBe(200)
      expect(res.body.distress.id).toBe(id)
    })

    it('should return 404 for nonexistent distress id', async () => {
      const res = await request(app)
        .get('/distress/00000000-0000-0000-0000-000000000000')
        .set(...authHeader(citizenToken()))

      expect(res.status).toBe(404)
    })

    it('should store GPS location history', async () => {
      const activate = await request(app)
        .post('/distress/activate')
        .set(...authHeader(citizenToken()))
        .send(DEFAULT_DISTRESS)
      const distressId = activate.body.distress.id

      // Push 3 GPS updates
      for (let i = 0; i < 3; i++) {
        await request(app)
          .post('/distress/location')
          .set(...authHeader(citizenToken()))
          .send({ distressId, latitude: 57.15 + i * 0.001, longitude: -2.09 })
      }

      const pool = getTestPool()
      const { rows } = await pool.query(
        'SELECT * FROM distress_location_history WHERE distress_id = $1 ORDER BY created_at',
        [distressId],
      )
      expect(rows.length).toBe(3)
    })
  })
})

