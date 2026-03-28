/**
 * tests__/aiRegistry.integration.test.ts — Model Governance Registry Endpoints
 *
 * Tests all five model-governance endpoints:
 *   GET  /api/ai/registry/health
 *   GET  /api/ai/registry/health/:hazard/:region
 *   GET  /api/ai/registry/drift/:hazard/:region/:version
 *   GET  /api/ai/registry/recommend-rollback/:hazard/:region
 *   POST /api/ai/registry/mark-degraded/:hazard/:region/:version
 *
 * Coverage targets:
 * Auth protection (401 / 403 on every route)
 * HTTP happy-path shapes
 * activity_log DB write after mark-degraded
 * Prometheus gauge calls after health / drift
 * Rollback recommendation determinism
 * Edge cases (empty registry, aiClient errors, default drift_score)
 */

// Environment bootstrap (must be before any imports that read env)
process.env.JWT_SECRET = 'test-jwt-secret-at-least-32-characters-long'
process.env.REFRESH_TOKEN_SECRET = 'test-refresh-secret-at-least-32-chars'
process.env.NODE_ENV = 'test'

import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, jest } from '@jest/globals'
import request from 'supertest'
import express, { type Request, type Response, type NextFunction } from 'express'

import {
  getTestPool, ensureTestSchema, truncateAll, closeTestPool,
} from './helpers/testDb'
import {
  citizenToken, operatorToken, adminToken, expiredToken, authHeader,
  TEST_ADMIN, TEST_OPERATOR,
} from './helpers/testAuth'
import { insertCitizen, insertOperator } from './helpers/testFixtures'
import { AppError } from '../utils/AppError'

// Mock AI client responses

const MOCK_ALL_HEALTH = {
  items: [
    {
      hazard_type: 'flood',
      region_id: 'uk-default',
      current_version: 'v2026.03.03.093011',
      health_status: 'rollback_recommended',
      drift_score: 0.77,
      avg_confidence: 0.65,
      alert_level: 'WARNING',
    },
    {
      hazard_type: 'drought',
      region_id: 'uk-default',
      current_version: 'v2026.03.03.093011',
      health_status: 'healthy',
      drift_score: 0.12,
      avg_confidence: 0.88,
      alert_level: 'INFO',
    },
    {
      hazard_type: 'wildfire',
      region_id: 'uk-default',
      current_version: 'v2026.03.03.093011',
      health_status: 'healthy',
      drift_score: 0.08,
      avg_confidence: 0.91,
      alert_level: 'INFO',
    },
  ],
  total: 3,
}

const MOCK_SINGLE_HEALTH = {
  hazard_type: 'flood',
  region_id: 'uk-default',
  current_version: 'v2026.03.03.093011',
  health_status: 'rollback_recommended',
  drift_score: 0.77,
  avg_confidence: 0.65,
  alert_level: 'WARNING',
}

const MOCK_DRIFT = {
  hazard_type: 'flood',
  region_id: 'uk-default',
  version: 'v2026.03.03.093011',
  snapshot: {
    drift_score: 0.77,
    avg_confidence: 0.65,
    alert_level: 'WARNING',
    sample_count: 150,
    computed_at: '2026-03-17T12:00:00Z',
  },
}

const MOCK_ROLLBACK = {
  hazard_type: 'flood',
  region_id: 'uk-default',
  current_version: 'v2026.03.03.093011',
  recommended_rollback_version: 'v2026.03.03.080723',
  reason: 'drift_score_exceeded_threshold',
  drift_score: 0.77,
}

const MOCK_MARK_DEGRADED = {
  status: 'success',
  key: 'flood_uk-default_v2026.03.03.093011',
  health_status: 'rollback_recommended',
  drift_score: 0.79,
  fallback_count: 0,
  recommended_rollback_version: 'v2026.03.03.080723',
}

// Prometheus gauge tracker (replaces real prom-client calls)

const gaugeCallLog: Array<{ labels: Record<string, string>; value: number }> = []
const mockGaugeSet = jest.fn((labels: Record<string, string>, value: number) => {
  gaugeCallLog.push({ labels, value })
})
const mockMetric = { set: mockGaugeSet, inc: jest.fn() }

// In-process aiClient mock
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockAiClient: Record<string, jest.Mock<any>> = {
  getAllRegistryHealth: jest.fn(),
  getRegistryHealth: jest.fn(),
  getRegistryDrift: jest.fn(),
  recommendRegistryRollback: jest.fn(),
  markRegistryDegraded: jest.fn(),
}

// App factory

let app: express.Express

function alertLevelToMetric(alertLevel: string): number {
  const level = String(alertLevel || '').toUpperCase()
  if (level === 'INFO') return 1
  if (level === 'WARNING') return 2
  if (level === 'CRITICAL') return 3
  return 0
}

function buildRegistryTestApp(): express.Express {
  const pool = getTestPool()
  const _app = express()
  _app.use(express.json())

  // Import real auth middleware so auth enforcement is not mocked
  const { authMiddleware, operatorOnly } = require('../middleware/auth')

  const router = express.Router()

  // GET /health
  router.get('/health', authMiddleware, operatorOnly, async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await mockAiClient.getAllRegistryHealth()
      for (const item of result?.items ?? []) {
        if (!item?.current_version) continue
        const labels = { hazard: item.hazard_type, region: item.region_id, version: item.current_version }
        mockMetric.set(labels, Number(item.drift_score ?? 0))
        mockMetric.set(labels, alertLevelToMetric(item.alert_level || item.health_status))
      }
      res.json(result)
    } catch (err) { next(err) }
  })

  // GET /health/:hazardType/:regionId
  router.get('/health/:hazardType/:regionId', authMiddleware, operatorOnly, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { hazardType, regionId } = req.params
      const result = await mockAiClient.getRegistryHealth(hazardType, regionId)
      if (result?.current_version) {
        const labels = { hazard: hazardType, region: regionId, version: result.current_version }
        mockMetric.set(labels, Number(result.avg_confidence ?? 0))
        mockMetric.set(labels, Number(result.drift_score ?? 0))
        mockMetric.set(labels, alertLevelToMetric(result.alert_level || result.health_status))
      }
      res.json(result)
    } catch (err) { next(err) }
  })

  // GET /drift/:hazardType/:regionId/:version
  router.get('/drift/:hazardType/:regionId/:version', authMiddleware, operatorOnly, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { hazardType, regionId, version } = req.params
      const result = await mockAiClient.getRegistryDrift(hazardType, regionId, version)
      const snap = result?.snapshot ?? {}
      const labels = { hazard: hazardType, region: regionId, version }
      mockMetric.set(labels, Number(snap.avg_confidence ?? 0))
      mockMetric.set(labels, Number(snap.drift_score ?? 0))
      mockMetric.set(labels, alertLevelToMetric(snap.alert_level ?? 'HEALTHY'))
      res.json(result)
    } catch (err) { next(err) }
  })

  // GET /recommend-rollback/:hazardType/:regionId
  router.get('/recommend-rollback/:hazardType/:regionId', authMiddleware, operatorOnly, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { hazardType, regionId } = req.params
      const result = await mockAiClient.recommendRegistryRollback(hazardType, regionId)
      res.json(result)
    } catch (err) { next(err) }
  })

  // POST /mark-degraded/:hazardType/:regionId/:version
  router.post('/mark-degraded/:hazardType/:regionId/:version', authMiddleware, operatorOnly, async (req: any, res: Response, next: NextFunction) => {
    try {
      if (req.user?.role !== 'admin') {
        throw AppError.forbidden('Admin access required')
      }
      const { hazardType, regionId, version } = req.params
      const driftScore = Number(req.body?.drift_score ?? 0.8)
      const reason = String(req.body?.reason || 'manual_mark_degraded')

      const result = await mockAiClient.markRegistryDegraded(hazardType, regionId, version, driftScore, reason)

      await pool.query(
        `INSERT INTO activity_log (operator_id, action, action_type, metadata)
         VALUES ($1, $2, $3, $4)`,
        [
          req.user?.id ?? null,
          `Marked model degraded: ${hazardType}/${regionId}/${version}`,
          'note',
          JSON.stringify({ targetType: 'ai_model', hazardType, regionId, version, driftScore, reason, result }),
        ],
      )

      res.json(result)
    } catch (err) { next(err) }
  })

  _app.use('/api/ai/registry', router)

  // Error handler
  _app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.statusCode ?? err.status ?? 500
    res.status(status).json({ error: err.message ?? 'Internal Server Error' })
  })

  return _app
}

// Lifecycle

beforeAll(async () => {
  app = buildRegistryTestApp()
  await ensureTestSchema()
  await insertCitizen()
  await insertOperator()
  // Insert admin so JWT operator_id can be traced in activity_log
  await insertOperator({
    id: TEST_ADMIN.id,
    email: TEST_ADMIN.email,
    display_name: TEST_ADMIN.displayName,
    role: 'admin',
  })
}, 30_000)

beforeEach(() => {
  // Reset all mock state before each test
  jest.clearAllMocks()
  gaugeCallLog.length = 0
  mockAiClient.getAllRegistryHealth.mockResolvedValue(MOCK_ALL_HEALTH)
  mockAiClient.getRegistryHealth.mockResolvedValue(MOCK_SINGLE_HEALTH)
  mockAiClient.getRegistryDrift.mockResolvedValue(MOCK_DRIFT)
  mockAiClient.recommendRegistryRollback.mockResolvedValue(MOCK_ROLLBACK)
  mockAiClient.markRegistryDegraded.mockResolvedValue(MOCK_MARK_DEGRADED)
})

afterEach(async () => {
  const pool = getTestPool()
  await pool.query('TRUNCATE activity_log CASCADE')
})

afterAll(async () => {
  await truncateAll()
  await closeTestPool()
})

// TESTS

describe('AI Model Governance — Registry Integration Tests', () => {

  // 1. Authentication protection (applies to all routes)
  describe('Authentication & Authorisation', () => {

    it('should deny unauthenticated GET /registry/health ? 401', async () => {
      const res = await request(app).get('/api/ai/registry/health')
      expect(res.status).toBe(401)
    })

    it('should deny unauthenticated GET /registry/health/:h/:r ? 401', async () => {
      const res = await request(app).get('/api/ai/registry/health/flood/uk-default')
      expect(res.status).toBe(401)
    })

    it('should deny unauthenticated GET /registry/drift/:h/:r/:v ? 401', async () => {
      const res = await request(app).get('/api/ai/registry/drift/flood/uk-default/v1')
      expect(res.status).toBe(401)
    })

    it('should deny unauthenticated GET /registry/recommend-rollback/:h/:r ? 401', async () => {
      const res = await request(app).get('/api/ai/registry/recommend-rollback/flood/uk-default')
      expect(res.status).toBe(401)
    })

    it('should deny unauthenticated POST /registry/mark-degraded/:h/:r/:v ? 401', async () => {
      const res = await request(app)
        .post('/api/ai/registry/mark-degraded/flood/uk-default/v1')
        .send({ drift_score: 0.8 })
      expect(res.status).toBe(401)
    })

    it('should deny expired token on any registry route ? 401', async () => {
      const res = await request(app)
        .get('/api/ai/registry/health')
        .set(...authHeader(expiredToken()))
      expect(res.status).toBe(401)
    })

    it('should deny citizen token on /registry/health ? 403', async () => {
      const res = await request(app)
        .get('/api/ai/registry/health')
        .set(...authHeader(citizenToken()))
      expect(res.status).toBe(403)
    })

    it('should deny citizen token on /registry/drift ? 403', async () => {
      const res = await request(app)
        .get('/api/ai/registry/drift/flood/uk-default/v1')
        .set(...authHeader(citizenToken()))
      expect(res.status).toBe(403)
    })

    it('should deny citizen token on /registry/recommend-rollback ? 403', async () => {
      const res = await request(app)
        .get('/api/ai/registry/recommend-rollback/flood/uk-default')
        .set(...authHeader(citizenToken()))
      expect(res.status).toBe(403)
    })

    it('should deny operator (non-admin) on POST /mark-degraded ? 403', async () => {
      const res = await request(app)
        .post('/api/ai/registry/mark-degraded/flood/uk-default/v1')
        .set(...authHeader(operatorToken()))
        .send({ drift_score: 0.8 })
      expect(res.status).toBe(403)
    })

    it('should deny citizen on POST /mark-degraded ? 403', async () => {
      const res = await request(app)
        .post('/api/ai/registry/mark-degraded/flood/uk-default/v1')
        .set(...authHeader(citizenToken()))
        .send({ drift_score: 0.8 })
      expect(res.status).toBe(403)
    })
  })

  // 2. GET /api/ai/registry/health (all models)
  describe('GET /api/ai/registry/health — All model health', () => {

    it('should return 200 with items array for operator', async () => {
      const res = await request(app)
        .get('/api/ai/registry/health')
        .set(...authHeader(operatorToken()))

      expect(res.status).toBe(200)
      expect(res.body.items).toBeDefined()
      expect(Array.isArray(res.body.items)).toBe(true)
      expect(res.body.total).toBe(3)
    })

    it('should return 200 with items array for admin', async () => {
      const res = await request(app)
        .get('/api/ai/registry/health')
        .set(...authHeader(adminToken()))

      expect(res.status).toBe(200)
      expect(res.body.items.length).toBe(3)
    })

    it('should include required fields in each health item', async () => {
      const res = await request(app)
        .get('/api/ai/registry/health')
        .set(...authHeader(operatorToken()))

      const first = res.body.items[0]
      expect(first.hazard_type).toBeDefined()
      expect(first.region_id).toBeDefined()
      expect(first.current_version).toBeDefined()
      expect(typeof first.drift_score).toBe('number')
      expect(first.health_status).toBeDefined()
      expect(first.alert_level).toBeDefined()
    })

    it('should include rollback_recommended item in response', async () => {
      const res = await request(app)
        .get('/api/ai/registry/health')
        .set(...authHeader(operatorToken()))

      const degraded = res.body.items.find((i: any) => i.health_status === 'rollback_recommended')
      expect(degraded).toBeDefined()
      expect(degraded.hazard_type).toBe('flood')
    })

    it('should update Prometheus gauges for each item (2 calls per item)', async () => {
      await request(app)
        .get('/api/ai/registry/health')
        .set(...authHeader(operatorToken()))

      // 3 items — 2 gauge updates (drift + alert_status)
      expect(mockGaugeSet).toHaveBeenCalledTimes(6)
      const callArgs = mockGaugeSet.mock.calls[0] as [Record<string, string>, number]
      expect(callArgs[0]).toHaveProperty('hazard', 'flood')
      expect(callArgs[0]).toHaveProperty('region', 'uk-default')
      expect(callArgs[0]).toHaveProperty('version', 'v2026.03.03.093011')
    })

    it('should handle empty registry gracefully ? 200 with empty items', async () => {
      mockAiClient.getAllRegistryHealth.mockResolvedValueOnce({ items: [], total: 0 })

      const res = await request(app)
        .get('/api/ai/registry/health')
        .set(...authHeader(operatorToken()))

      expect(res.status).toBe(200)
      expect(res.body.items).toEqual([])
      expect(res.body.total).toBe(0)
    })

    it('should return 500 when aiClient throws', async () => {
      mockAiClient.getAllRegistryHealth.mockRejectedValueOnce(new Error('AI Engine unreachable'))

      const res = await request(app)
        .get('/api/ai/registry/health')
        .set(...authHeader(operatorToken()))

      expect(res.status).toBe(500)
    })

    it('should skip Prometheus update for items missing current_version', async () => {
      mockAiClient.getAllRegistryHealth.mockResolvedValueOnce({
        items: [{ hazard_type: 'flood', region_id: 'uk-default', health_status: 'healthy' } as any],
        total: 1,
      })

      await request(app)
        .get('/api/ai/registry/health')
        .set(...authHeader(operatorToken()))

      // No gauge calls — item has no current_version
      expect(mockGaugeSet).not.toHaveBeenCalled()
    })
  })

  // 3. GET /api/ai/registry/health/:hazard/:region
  describe('GET /api/ai/registry/health/:hazard/:region — Single model health', () => {

    it('should return 200 with flood/uk-default health for operator', async () => {
      const res = await request(app)
        .get('/api/ai/registry/health/flood/uk-default')
        .set(...authHeader(operatorToken()))

      expect(res.status).toBe(200)
      expect(res.body.hazard_type).toBe('flood')
      expect(res.body.region_id).toBe('uk-default')
      expect(typeof res.body.drift_score).toBe('number')
      expect(typeof res.body.avg_confidence).toBe('number')
      expect(res.body.health_status).toBe('rollback_recommended')
    })

    it('should call aiClient.getRegistryHealth with correct params', async () => {
      await request(app)
        .get('/api/ai/registry/health/drought/uk-default')
        .set(...authHeader(operatorToken()))

      expect(mockAiClient.getRegistryHealth).toHaveBeenCalledWith('drought', 'uk-default')
    })

    it('should pass arbitrary hazard+region params through to aiClient', async () => {
      await request(app)
        .get('/api/ai/registry/health/severe_storm/scotland')
        .set(...authHeader(operatorToken()))

      expect(mockAiClient.getRegistryHealth).toHaveBeenCalledWith('severe_storm', 'scotland')
    })

    it('should update 3 Prometheus gauges (avg_confidence, drift_score, alert_status)', async () => {
      await request(app)
        .get('/api/ai/registry/health/flood/uk-default')
        .set(...authHeader(operatorToken()))

      expect(mockGaugeSet).toHaveBeenCalledTimes(3)

      const firstArgs = mockGaugeSet.mock.calls[0] as [Record<string, string>, number]
      expect(firstArgs[0]).toMatchObject({ hazard: 'flood', region: 'uk-default' })
    })

    it('should set drift Prometheus gauge with drift_score value', async () => {
      await request(app)
        .get('/api/ai/registry/health/flood/uk-default')
        .set(...authHeader(operatorToken()))

      const driftCall = gaugeCallLog.find(c => c.value === MOCK_SINGLE_HEALTH.drift_score)
      expect(driftCall).toBeDefined()
    })

    it('should set alert_status Prometheus gauge to 2 for WARNING', async () => {
      await request(app)
        .get('/api/ai/registry/health/flood/uk-default')
        .set(...authHeader(operatorToken()))

      const warnCall = gaugeCallLog.find(c => c.value === 2) // WARNING = 2
      expect(warnCall).toBeDefined()
    })

    it('should skip Prometheus update when current_version is absent', async () => {
      mockAiClient.getRegistryHealth.mockResolvedValueOnce({ hazard_type: 'flood', region_id: 'uk-default' } as any)

      await request(app)
        .get('/api/ai/registry/health/flood/uk-default')
        .set(...authHeader(operatorToken()))

      expect(mockGaugeSet).not.toHaveBeenCalled()
    })

    it('should return 500 when aiClient throws', async () => {
      mockAiClient.getRegistryHealth.mockRejectedValueOnce(new Error('Model not found'))

      const res = await request(app)
        .get('/api/ai/registry/health/flood/uk-default')
        .set(...authHeader(operatorToken()))

      expect(res.status).toBe(500)
    })
  })

  // 4. GET /api/ai/registry/drift/:hazard/:region/:version
  describe('GET /api/ai/registry/drift/:hazard/:region/:version — Drift snapshot', () => {

    it('should return 200 with snapshot data for operator', async () => {
      const res = await request(app)
        .get('/api/ai/registry/drift/flood/uk-default/v2026.03.03.093011')
        .set(...authHeader(operatorToken()))

      expect(res.status).toBe(200)
      expect(res.body.snapshot).toBeDefined()
      expect(typeof res.body.snapshot.drift_score).toBe('number')
      expect(typeof res.body.snapshot.avg_confidence).toBe('number')
      expect(res.body.snapshot.sample_count).toBeDefined()
    })

    it('should call aiClient.getRegistryDrift with all three params', async () => {
      const VERSION = 'v2026.03.03.093011'
      await request(app)
        .get(`/api/ai/registry/drift/flood/uk-default/${VERSION}`)
        .set(...authHeader(operatorToken()))

      expect(mockAiClient.getRegistryDrift).toHaveBeenCalledWith('flood', 'uk-default', VERSION)
    })

    it('should update 3 Prometheus gauges per drift call', async () => {
      await request(app)
        .get('/api/ai/registry/drift/flood/uk-default/v2026.03.03.093011')
        .set(...authHeader(operatorToken()))

      expect(mockGaugeSet).toHaveBeenCalledTimes(3)
    })

    it('should include version in Prometheus gauge label', async () => {
      await request(app)
        .get('/api/ai/registry/drift/flood/uk-default/v2026.03.03.093011')
        .set(...authHeader(operatorToken()))

      const versionedCall = gaugeCallLog.find(c => c.labels.version === 'v2026.03.03.093011')
      expect(versionedCall).toBeDefined()
    })

    it('should handle different hazard types (wildfire, heatwave, etc.)', async () => {
      const hazards = ['wildfire', 'heatwave', 'landslide', 'severe_storm']
      for (const hazard of hazards) {
        mockAiClient.getRegistryDrift.mockResolvedValueOnce({
          ...MOCK_DRIFT,
          hazard_type: hazard,
        })

        const res = await request(app)
          .get(`/api/ai/registry/drift/${hazard}/uk-default/v1`)
          .set(...authHeader(operatorToken()))

        expect(res.status).toBe(200)
        expect(mockAiClient.getRegistryDrift).toHaveBeenCalledWith(hazard, 'uk-default', 'v1')
        jest.clearAllMocks()
      }
    })

    it('should default alert_level Prometheus metric to 0 when alert_level is absent', async () => {
      mockAiClient.getRegistryDrift.mockResolvedValueOnce({
        hazard_type: 'flood',
        region_id: 'uk-default',
        version: 'v1',
        snapshot: { drift_score: 0.5, avg_confidence: 0.7 } as any,
      } as any)

      await request(app)
        .get('/api/ai/registry/drift/flood/uk-default/v1')
        .set(...authHeader(operatorToken()))

      // alertLevelToMetric('HEALTHY' undefined) ? 0
      const zeroCall = gaugeCallLog.find(c => c.value === 0)
      expect(zeroCall).toBeDefined()
    })

    it('should return 500 when aiClient throws', async () => {
      mockAiClient.getRegistryDrift.mockRejectedValueOnce(new Error('Drift computation failed'))

      const res = await request(app)
        .get('/api/ai/registry/drift/flood/uk-default/v99')
        .set(...authHeader(operatorToken()))

      expect(res.status).toBe(500)
    })
  })

  // 5. GET /api/ai/registry/recommend-rollback/:hazard/:region
  describe('GET /api/ai/registry/recommend-rollback/:hazard/:region — Rollback recommendation', () => {

    it('should return 200 with rollback recommendation for operator', async () => {
      const res = await request(app)
        .get('/api/ai/registry/recommend-rollback/flood/uk-default')
        .set(...authHeader(operatorToken()))

      expect(res.status).toBe(200)
      expect(res.body.recommended_rollback_version).toBeDefined()
      expect(res.body.current_version).toBeDefined()
      expect(res.body.reason).toBeDefined()
      expect(typeof res.body.drift_score).toBe('number')
    })

    it('should return the same rollback version on repeated calls (deterministic)', async () => {
      const res1 = await request(app)
        .get('/api/ai/registry/recommend-rollback/flood/uk-default')
        .set(...authHeader(operatorToken()))

      const res2 = await request(app)
        .get('/api/ai/registry/recommend-rollback/flood/uk-default')
        .set(...authHeader(operatorToken()))

      expect(res1.body.recommended_rollback_version).toBe(res2.body.recommended_rollback_version)
      expect(res1.body.recommended_rollback_version).toBe('v2026.03.03.080723')
    })

    it('should call aiClient.recommendRegistryRollback with correct params', async () => {
      await request(app)
        .get('/api/ai/registry/recommend-rollback/drought/uk-default')
        .set(...authHeader(operatorToken()))

      expect(mockAiClient.recommendRegistryRollback).toHaveBeenCalledWith('drought', 'uk-default')
    })

    it('should return 200 for admin access', async () => {
      const res = await request(app)
        .get('/api/ai/registry/recommend-rollback/flood/uk-default')
        .set(...authHeader(adminToken()))

      expect(res.status).toBe(200)
    })

    it('should return 500 when aiClient throws', async () => {
      mockAiClient.recommendRegistryRollback.mockRejectedValueOnce(new Error('No stable prior version'))

      const res = await request(app)
        .get('/api/ai/registry/recommend-rollback/flood/uk-default')
        .set(...authHeader(operatorToken()))

      expect(res.status).toBe(500)
    })

    it('should pass arbitrary hazard types to aiClient', async () => {
      for (const hazard of ['wildfire', 'heatwave', 'landslide']) {
        mockAiClient.recommendRegistryRollback.mockResolvedValueOnce({
          ...MOCK_ROLLBACK,
          hazard_type: hazard,
        })

        const res = await request(app)
          .get(`/api/ai/registry/recommend-rollback/${hazard}/uk-default`)
          .set(...authHeader(operatorToken()))

        expect(res.status).toBe(200)
        expect(mockAiClient.recommendRegistryRollback).toHaveBeenCalledWith(hazard, 'uk-default')
        jest.clearAllMocks()
        mockAiClient.recommendRegistryRollback.mockResolvedValue(MOCK_ROLLBACK)
      }
    })
  })

  // 6. POST /api/ai/registry/mark-degraded/:hazard/:region/:version
  describe('POST /api/ai/registry/mark-degraded/:hazard/:region/:version — Mark degraded', () => {

    it('should return 200 with success status for admin', async () => {
      const res = await request(app)
        .post('/api/ai/registry/mark-degraded/flood/uk-default/v2026.03.03.093011')
        .set(...authHeader(adminToken()))
        .send({ drift_score: 0.79, reason: 'drift_threshold_exceeded' })

      expect(res.status).toBe(200)
      expect(res.body.status).toBe('success')
      expect(res.body.health_status).toBe('rollback_recommended')
      expect(typeof res.body.drift_score).toBe('number')
      expect(res.body.recommended_rollback_version).toBeDefined()
    })

    it('should write one audit row to activity_log', async () => {
      await request(app)
        .post('/api/ai/registry/mark-degraded/flood/uk-default/v2026.03.03.093011')
        .set(...authHeader(adminToken()))
        .send({ drift_score: 0.79, reason: 'test_audit_write' })

      const pool = getTestPool()
      const { rows } = await pool.query(
        `SELECT * FROM activity_log WHERE action ILIKE '%flood/uk-default%'`,
      )
      expect(rows.length).toBe(1)
      expect(rows[0].action_type).toBe('note')
    })

    it('should store correct metadata in activity_log', async () => {
      await request(app)
        .post('/api/ai/registry/mark-degraded/flood/uk-default/v2026.03.03.093011')
        .set(...authHeader(adminToken()))
        .send({ drift_score: 0.85, reason: 'metadata_check' })

      const pool = getTestPool()
      const { rows } = await pool.query(
        `SELECT metadata FROM activity_log WHERE action ILIKE '%flood/uk-default%'`,
      )
      const meta = rows[0].metadata
      expect(meta.hazardType).toBe('flood')
      expect(meta.regionId).toBe('uk-default')
      expect(meta.version).toBe('v2026.03.03.093011')
      expect(meta.driftScore).toBe(0.85)
      expect(meta.reason).toBe('metadata_check')
      expect(meta.targetType).toBe('ai_model')
    })

    it('should store the operator_id (admin UUID) in activity_log', async () => {
      await request(app)
        .post('/api/ai/registry/mark-degraded/flood/uk-default/v2026.03.03.093011')
        .set(...authHeader(adminToken()))
        .send({ drift_score: 0.75, reason: 'operator_id_check' })

      const pool = getTestPool()
      const { rows } = await pool.query(
        `SELECT operator_id FROM activity_log WHERE action ILIKE '%flood/uk-default%'`,
      )
      expect(rows.length).toBe(1)
      expect(rows[0].operator_id).toBe(TEST_ADMIN.id)
    })

    it('should call aiClient.markRegistryDegraded with correct params', async () => {
      await request(app)
        .post('/api/ai/registry/mark-degraded/flood/uk-default/v2026.03.03.093011')
        .set(...authHeader(adminToken()))
        .send({ drift_score: 0.85, reason: 'manual' })

      expect(mockAiClient.markRegistryDegraded).toHaveBeenCalledWith(
        'flood', 'uk-default', 'v2026.03.03.093011', 0.85, 'manual',
      )
    })

    it('should use default drift_score of 0.8 when not provided', async () => {
      await request(app)
        .post('/api/ai/registry/mark-degraded/flood/uk-default/v1')
        .set(...authHeader(adminToken()))
        .send({ reason: 'no_score_given' })

      expect(mockAiClient.markRegistryDegraded).toHaveBeenCalledWith(
        'flood', 'uk-default', 'v1', 0.8, 'no_score_given',
      )
    })

    it('should use default reason text when not provided', async () => {
      await request(app)
        .post('/api/ai/registry/mark-degraded/flood/uk-default/v1')
        .set(...authHeader(adminToken()))
        .send({ drift_score: 0.9 })

      expect(mockAiClient.markRegistryDegraded).toHaveBeenCalledWith(
        'flood', 'uk-default', 'v1', 0.9, 'manual_mark_degraded',
      )
    })

    it('should create separate activity_log rows for different models', async () => {
      await request(app)
        .post('/api/ai/registry/mark-degraded/flood/uk-default/v1')
        .set(...authHeader(adminToken()))
        .send({ drift_score: 0.8 })

      await request(app)
        .post('/api/ai/registry/mark-degraded/drought/uk-default/v1')
        .set(...authHeader(adminToken()))
        .send({ drift_score: 0.82 })

      const pool = getTestPool()
      const { rows } = await pool.query('SELECT * FROM activity_log ORDER BY created_at')
      expect(rows.length).toBe(2)
      expect(rows[0].action).toContain('flood')
      expect(rows[1].action).toContain('drought')
    })

    it('should return 500 when aiClient throws and not write to activity_log', async () => {
      mockAiClient.markRegistryDegraded.mockRejectedValueOnce(new Error('Registry write error'))

      const res = await request(app)
        .post('/api/ai/registry/mark-degraded/flood/uk-default/v1')
        .set(...authHeader(adminToken()))
        .send({ drift_score: 0.8 })

      expect(res.status).toBe(500)

      const pool = getTestPool()
      const { rows } = await pool.query('SELECT * FROM activity_log')
      // aiClient failed before the DB write
      expect(rows.length).toBe(0)
    })

    it('should include result payload from aiClient in activity_log metadata', async () => {
      await request(app)
        .post('/api/ai/registry/mark-degraded/flood/uk-default/v2026.03.03.093011')
        .set(...authHeader(adminToken()))
        .send({ drift_score: 0.79 })

      const pool = getTestPool()
      const { rows } = await pool.query('SELECT metadata FROM activity_log')
      const meta = rows[0].metadata
      expect(meta.result.status).toBe('success')
      expect(meta.result.recommended_rollback_version).toBe('v2026.03.03.080723')
    })
  })

  // 7. Prometheus metric value correctness
  describe('Prometheus gauge value correctness', () => {

    it('alertLevelToMetric: INFO model sets gauge to 1', async () => {
      mockAiClient.getRegistryHealth.mockResolvedValueOnce({
        ...MOCK_SINGLE_HEALTH,
        health_status: 'healthy',
        alert_level: 'INFO',
        current_version: 'v1',
      })

      await request(app)
        .get('/api/ai/registry/health/drought/uk-default')
        .set(...authHeader(operatorToken()))

      const infoCall = gaugeCallLog.find(c => c.value === 1)
      expect(infoCall).toBeDefined()
    })

    it('alertLevelToMetric: WARNING model sets gauge to 2', async () => {
      await request(app)
        .get('/api/ai/registry/health/flood/uk-default')
        .set(...authHeader(operatorToken()))

      const warnCall = gaugeCallLog.find(c => c.value === 2)
      expect(warnCall).toBeDefined()
    })

    it('alertLevelToMetric: CRITICAL model sets gauge to 3', async () => {
      mockAiClient.getRegistryHealth.mockResolvedValueOnce({
        ...MOCK_SINGLE_HEALTH,
        alert_level: 'CRITICAL',
        current_version: 'v1',
      })

      await request(app)
        .get('/api/ai/registry/health/flood/uk-default')
        .set('Authorization', `Bearer ${operatorToken()}`)

      const criticalCalls = gaugeCallLog.filter(c => c.value === 3)
      expect(criticalCalls.length).toBeGreaterThan(0)
    })

    it('alertLevelToMetric: unknown level sets gauge to 0', async () => {
      mockAiClient.getRegistryHealth.mockResolvedValueOnce({
        ...MOCK_SINGLE_HEALTH,
        alert_level: 'UNKNOWN_LEVEL',
        current_version: 'v1',
      })

      await request(app)
        .get('/api/ai/registry/health/flood/uk-default')
        .set('Authorization', `Bearer ${operatorToken()}`)

      const zeroCalls = gaugeCallLog.filter(c => c.value === 0)
      expect(zeroCalls.length).toBeGreaterThan(0)
    })
  })

  // 8. Snapshot row checks (model_monitoring_snapshots via aiClient mock)
  describe('Monitoring snapshot table (via aiClient mock verification)', () => {

    it('mockAiClient.getRegistryDrift is called once per drift request', async () => {
      await request(app)
        .get('/api/ai/registry/drift/flood/uk-default/v1')
        .set(...authHeader(operatorToken()))

      expect(mockAiClient.getRegistryDrift).toHaveBeenCalledTimes(1)
    })

    it('Consecutive drift snapshot requests call aiClient each time', async () => {
      await request(app)
        .get('/api/ai/registry/drift/flood/uk-default/v1')
        .set(...authHeader(operatorToken()))

      await request(app)
        .get('/api/ai/registry/drift/drought/uk-default/v1')
        .set(...authHeader(operatorToken()))

      expect(mockAiClient.getRegistryDrift).toHaveBeenCalledTimes(2)
    })

    it('All 3 Prometheus gauges are updated with version label per drift call', async () => {
      await request(app)
        .get('/api/ai/registry/drift/flood/uk-default/v2026.03.03.093011')
        .set(...authHeader(operatorToken()))

      const versionedCalls = gaugeCallLog.filter(c => c.labels.version === 'v2026.03.03.093011')
      expect(versionedCalls.length).toBe(3)
    })
  })
})
