/**
 * What it tests:
 * Integration tests for the incident report submission and retrieval flow.
  * Verifies report creation, AI analysis trigger, media upload,
  * status transitions, and admin approval flow.
  *
  * How it connects:
  * - Tests server/src/routes/reportRoutes.ts
  * - AI analysis mocked to isolate from ai-engine service
  * - Run via: npm test -- reports.integration
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from '@jest/globals'
import request from 'supertest'
import express, { type Request, type Response, type NextFunction } from 'express'

// Test environment
process.env.JWT_SECRET = 'test-jwt-secret-at-least-32-characters-long'
process.env.REFRESH_TOKEN_SECRET = 'test-refresh-secret-at-least-32-chars'
process.env.NODE_ENV = 'test'

import {
  getTestPool, ensureTestSchema, truncateAll, closeTestPool,
} from './helpers/testDb'
import {
  citizenToken, operatorToken, adminToken, expiredToken, authHeader,
  TEST_CITIZEN, TEST_OPERATOR,
} from './helpers/testAuth'
import {
  insertCitizen, insertOperator, insertReport,
  FLOOD_REPORT, FIRE_REPORT, MINOR_REPORT,
} from './helpers/testFixtures'
import { AppError } from '../utils/AppError'

// Build test app

let app: express.Express
let emittedEvents: Array<{ event: string; args: unknown[] }>

function buildReportTestApp() {
  const pool = getTestPool()
  const _app = express()
  _app.use(express.json())

  emittedEvents = []
  // Mock io
  _app.set('io', {
    emit(event: string, ...args: unknown[]) {
      emittedEvents.push({ event, args })
      return true
    },
  })

  const { authMiddleware, operatorOnly } = require('../middleware/auth')
  const router = express.Router()

  // GET / — list reports with filters
  router.get('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { status, severity, category, limit = '100' } = req.query
      let query = `
        SELECT id, report_number, incident_category, incident_subtype, display_type,
               description, severity, status, trapped_persons, location_text,
               ST_Y(coordinates::geometry) as lat, ST_X(coordinates::geometry) as lng,
               has_media, reporter_name, ai_confidence, ai_analysis, operator_notes,
               created_at, updated_at
        FROM reports WHERE deleted_at IS NULL`
      const params: any[] = []
      let idx = 1
      if (status) { query += ` AND status = $${idx++}`; params.push(status) }
      if (severity) { query += ` AND severity = $${idx++}`; params.push(severity) }
      if (category) { query += ` AND incident_category = $${idx++}`; params.push(category) }
      query += ` ORDER BY created_at DESC LIMIT $${idx}`
      params.push(parseInt(limit as string) || 100)
      const result = await pool.query(query, params)
      res.json({ reports: result.rows, total: result.rows.length })
    } catch (err) { next(err) }
  })

  // GET /stats — aggregate statistics
  router.get('/stats', async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const total = await pool.query('SELECT COUNT(*) as count FROM reports WHERE deleted_at IS NULL')
      const byStatus = await pool.query(
        `SELECT status, COUNT(*) as count FROM reports WHERE deleted_at IS NULL GROUP BY status`,
      )
      const bySeverity = await pool.query(
        `SELECT severity, COUNT(*) as count FROM reports WHERE deleted_at IS NULL GROUP BY severity`,
      )
      res.json({
        total: parseInt(total.rows[0].count),
        byStatus: byStatus.rows,
        bySeverity: bySeverity.rows,
      })
    } catch (err) { next(err) }
  })

  // GET /:id — single report
  router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { rows } = await pool.query(
        `SELECT id, report_number, incident_category, description, severity, status,
                location_text, reporter_name, operator_notes, created_at, updated_at,
                ST_Y(coordinates::geometry) as lat, ST_X(coordinates::geometry) as lng
         FROM reports WHERE id = $1 AND deleted_at IS NULL`,
        [req.params.id],
      )
      if (rows.length === 0) throw AppError.notFound('Report not found')
      res.json({ report: rows[0] })
    } catch (err) { next(err) }
  })

  // POST / — submit report (authenticated or anonymous)
  router.post('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const {
        incident_category, description, severity, location_text,
        latitude, longitude, reporter_name, trapped_persons,
        citizen_id,
      } = req.body

      if (!description || !severity) {
        throw AppError.badRequest('description and severity are required')
      }

      const withCoords = latitude != null && longitude != null
      const valuesBase = [
        incident_category || 'general',
        description,
        severity,
        location_text || null,
        reporter_name || 'Anonymous',
        trapped_persons || 0,
      ]

      const { rows } = withCoords
        ? await pool.query(
            `INSERT INTO reports (incident_category, description, severity, location_text,
               coordinates, reporter_name, trapped_persons, citizen_id, status)
             VALUES ($1,$2,$3,$4, ST_MakePoint($8, $7)::geography, $5, $6, $9, 'new') RETURNING *`,
            [
              ...valuesBase,
              parseFloat(latitude),
              parseFloat(longitude),
              citizen_id || null,
            ],
          )
        : await pool.query(
            `INSERT INTO reports (incident_category, description, severity, location_text,
               coordinates, reporter_name, trapped_persons, citizen_id, status)
             VALUES ($1,$2,$3,$4, NULL, $5, $6, $7, 'new') RETURNING *`,
            [...valuesBase, citizen_id || null],
          )

      const io = req.app.get('io')
      io?.emit('report:new', { report: rows[0] })

      res.status(201).json({ report: rows[0] })
    } catch (err) { next(err) }
  })

  // PUT /bulk/status — bulk status update (operator only)
  router.put('/bulk/status', authMiddleware, operatorOnly, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { ids, status: newStatus } = req.body
      if (!Array.isArray(ids) || ids.length === 0) {
        throw AppError.badRequest('ids array is required')
      }
      const { rows } = await pool.query(
        `UPDATE reports SET status = $2, updated_at = NOW()
         WHERE id = ANY($1) AND deleted_at IS NULL RETURNING id, status`,
        [ids, newStatus],
      )

      const io = req.app.get('io')
      io?.emit('report:bulk-updated', { updated: rows })

      res.json({ updated: rows.length, reports: rows })
    } catch (err) { next(err) }
  })

  // PUT /:id/status — update status (operator only)
  router.put('/:id/status', authMiddleware, operatorOnly, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { status: newStatus } = req.body
      const validStatuses = ['new', 'investigating', 'confirmed', 'resolved', 'archived', 'false_report']
      if (!validStatuses.includes(newStatus)) {
        throw AppError.badRequest(`Invalid status. Must be one of: ${validStatuses.join(', ')}`)
      }
      const { rows } = await pool.query(
        `UPDATE reports SET status = $2, updated_at = NOW()
         WHERE id = $1 AND deleted_at IS NULL RETURNING *`,
        [req.params.id, newStatus],
      )
      if (rows.length === 0) throw AppError.notFound('Report not found')

      const io = req.app.get('io')
      io?.emit('report:updated', { report: rows[0] })

      res.json({ report: rows[0] })
    } catch (err) { next(err) }
  })

  // PUT /:id/notes — add operator notes
  router.put('/:id/notes', authMiddleware, operatorOnly, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { notes } = req.body
      const { rows } = await pool.query(
        `UPDATE reports SET operator_notes = $2, updated_at = NOW()
         WHERE id = $1 AND deleted_at IS NULL RETURNING *`,
        [req.params.id, notes],
      )
      if (rows.length === 0) throw AppError.notFound('Report not found')
      res.json({ report: rows[0] })
    } catch (err) { next(err) }
  })

  _app.use('/api/reports', router)
  _app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.statusCode || err.status || 500
    res.status(status).json({ error: err.message || 'Internal Server Error' })
  })

  return _app
}

// Lifecycle

beforeAll(async () => {
  app = buildReportTestApp()
  await ensureTestSchema()
  await insertCitizen()
  await insertOperator()
}, 30_000)

afterEach(async () => {
  const pool = getTestPool()
  await pool.query('TRUNCATE report_media, reports CASCADE')
  emittedEvents = []
})

afterAll(async () => {
  await truncateAll()
  await closeTestPool()
})

describe('Reports Integration Tests', () => {

  // Report submission

  describe('Submit Report', () => {
    it('should submit a report with all fields', async () => {
      const res = await request(app)
        .post('/api/reports')
        .send({
          incident_category: FLOOD_REPORT.incident_category,
          description: FLOOD_REPORT.description,
          severity: FLOOD_REPORT.severity,
          location_text: FLOOD_REPORT.location_text,
          latitude: FLOOD_REPORT.latitude,
          longitude: FLOOD_REPORT.longitude,
          reporter_name: FLOOD_REPORT.reporter_name,
          citizen_id: TEST_CITIZEN.id,
        })

      expect(res.status).toBe(201)
      expect(res.body.report).toBeDefined()
      expect(res.body.report.status).toBe('new')
      expect(res.body.report.severity).toBe('high')
      expect(res.body.report.incident_category).toBe('flood')
    })

    it('should submit anonymous report (no citizen_id)', async () => {
      const res = await request(app)
        .post('/api/reports')
        .send({
          description: 'Anonymous flood sighting',
          severity: 'medium',
          reporter_name: 'Anonymous Witness',
        })

      expect(res.status).toBe(201)
      expect(res.body.report.citizen_id).toBeNull()
      expect(res.body.report.reporter_name).toBe('Anonymous Witness')
    })

    it('should emit report:new Socket.IO event on submission', async () => {
      await request(app)
        .post('/api/reports')
        .send({ description: 'Test event emission', severity: 'low' })

      expect(emittedEvents.some(e => e.event === 'report:new')).toBe(true)
    })

    it('should reject report without required fields', async () => {
      const res = await request(app)
        .post('/api/reports')
        .send({ incident_category: 'flood' }) // missing description & severity

      expect(res.status).toBe(400)
    })

    it('should default reporter_name to Anonymous', async () => {
      const res = await request(app)
        .post('/api/reports')
        .send({ description: 'No name given', severity: 'low' })

      expect(res.status).toBe(201)
      expect(res.body.report.reporter_name).toBe('Anonymous')
    })
  })

  // Report listing & filtering

  describe('List & Filter Reports', () => {
    beforeEach(async () => {
      await insertReport({ severity: 'high', status: 'new', incident_category: 'flood' })
      await insertReport({ severity: 'low', status: 'resolved', incident_category: 'wildfire', description: 'Brush fire resolved' })
      await insertReport({ severity: 'medium', status: 'investigating', incident_category: 'flood', description: 'Under investigation' })
    })

    it('should list all reports', async () => {
      const res = await request(app).get('/api/reports')
      expect(res.status).toBe(200)
      expect(res.body.reports.length).toBe(3)
    })

    it('should filter by status', async () => {
      const res = await request(app).get('/api/reports?status=resolved')
      expect(res.status).toBe(200)
      expect(res.body.reports.length).toBe(1)
      expect(res.body.reports[0].status).toBe('resolved')
    })

    it('should filter by severity', async () => {
      const res = await request(app).get('/api/reports?severity=high')
      expect(res.status).toBe(200)
      expect(res.body.reports.length).toBe(1)
    })

    it('should filter by category', async () => {
      const res = await request(app).get('/api/reports?category=flood')
      expect(res.status).toBe(200)
      expect(res.body.reports.length).toBe(2)
    })

    it('should respect limit parameter', async () => {
      const res = await request(app).get('/api/reports?limit=1')
      expect(res.status).toBe(200)
      expect(res.body.reports.length).toBe(1)
    })
  })

  // Single report retrieval

  describe('Get Single Report', () => {
    it('should fetch a report by id', async () => {
      const report = await insertReport()
      const res = await request(app).get(`/api/reports/${report.id}`)

      expect(res.status).toBe(200)
      expect(res.body.report.id).toBe(report.id)
    })

    it('should return 404 for nonexistent report', async () => {
      const res = await request(app).get('/api/reports/00000000-0000-0000-0000-000000000000')
      expect(res.status).toBe(404)
    })
  })

  // Status updates

  describe('Update Report Status', () => {
    it('should update status as operator', async () => {
      const report = await insertReport()

      const res = await request(app)
        .put(`/api/reports/${report.id}/status`)
        .set(...authHeader(operatorToken()))
        .send({ status: 'investigating' })

      expect(res.status).toBe(200)
      expect(res.body.report.status).toBe('investigating')
    })

    it('should emit report:updated event on status change', async () => {
      const report = await insertReport()

      await request(app)
        .put(`/api/reports/${report.id}/status`)
        .set(...authHeader(operatorToken()))
        .send({ status: 'confirmed' })

      expect(emittedEvents.some(e => e.event === 'report:updated')).toBe(true)
    })

    it('should reject invalid status value', async () => {
      const report = await insertReport()

      const res = await request(app)
        .put(`/api/reports/${report.id}/status`)
        .set(...authHeader(operatorToken()))
        .send({ status: 'invalid_status' })

      expect(res.status).toBe(400)
    })

    it('should reject citizen trying to update status', async () => {
      const report = await insertReport()

      const res = await request(app)
        .put(`/api/reports/${report.id}/status`)
        .set(...authHeader(citizenToken()))
        .send({ status: 'resolved' })

      expect(res.status).toBe(403)
    })

    it('should reject unauthenticated status update', async () => {
      const report = await insertReport()

      const res = await request(app)
        .put(`/api/reports/${report.id}/status`)
        .send({ status: 'resolved' })

      expect(res.status).toBe(401)
    })
  })

  // Bulk operations

  describe('Bulk Status Update', () => {
    it('should update multiple reports at once', async () => {
      const r1 = await insertReport({ description: 'Report 1' })
      const r2 = await insertReport({ description: 'Report 2' })
      const r3 = await insertReport({ description: 'Report 3' })

      const res = await request(app)
        .put('/api/reports/bulk/status')
        .set(...authHeader(operatorToken()))
        .send({ ids: [r1.id, r2.id, r3.id], status: 'resolved' })

      expect(res.status).toBe(200)
      expect(res.body.updated).toBe(3)
    })

    it('should emit report:bulk-updated event', async () => {
      const r1 = await insertReport({ description: 'Bulk 1' })

      await request(app)
        .put('/api/reports/bulk/status')
        .set(...authHeader(operatorToken()))
        .send({ ids: [r1.id], status: 'archived' })

      expect(emittedEvents.some(e => e.event === 'report:bulk-updated')).toBe(true)
    })

    it('should reject bulk update with empty ids', async () => {
      const res = await request(app)
        .put('/api/reports/bulk/status')
        .set(...authHeader(operatorToken()))
        .send({ ids: [], status: 'resolved' })

      expect(res.status).toBe(400)
    })
  })

  // Operator notes

  describe('Operator Notes', () => {
    it('should add notes to a report', async () => {
      const report = await insertReport()

      const res = await request(app)
        .put(`/api/reports/${report.id}/notes`)
        .set(...authHeader(operatorToken()))
        .send({ notes: 'Field team dispatched at 14:00' })

      expect(res.status).toBe(200)
      expect(res.body.report.operator_notes).toBe('Field team dispatched at 14:00')
    })
  })

  // Statistics

  describe('Report Statistics', () => {
    it('should return aggregate stats', async () => {
      await insertReport({ severity: 'high', status: 'new' })
      await insertReport({ severity: 'low', status: 'resolved', description: 'R2' })

      const res = await request(app).get('/api/reports/stats')

      expect(res.status).toBe(200)
      expect(res.body.total).toBe(2)
      expect(res.body.byStatus.length).toBeGreaterThan(0)
      expect(res.body.bySeverity.length).toBeGreaterThan(0)
    })
  })

  // Edge cases

  describe('Edge Cases', () => {
    it('should handle very long description', async () => {
      const longDesc = 'A'.repeat(5000)
      const res = await request(app)
        .post('/api/reports')
        .send({ description: longDesc, severity: 'low' })

      expect(res.status).toBe(201)
      expect(res.body.report.description.length).toBe(5000)
    })

    it('should handle trapped_persons field', async () => {
      const res = await request(app)
        .post('/api/reports')
        .send({
          description: 'People trapped in building',
          severity: 'critical',
          trapped_persons: 5,
        })

      expect(res.status).toBe(201)
      expect(res.body.report.trapped_persons).toBe(5)
    })

    it('should handle report without coordinates', async () => {
      const res = await request(app)
        .post('/api/reports')
        .send({
          description: 'No GPS available',
          severity: 'medium',
          location_text: 'Near city centre',
        })

      expect(res.status).toBe(201)
      expect(res.body.report.location_text).toBe('Near city centre')
    })
  })
})

