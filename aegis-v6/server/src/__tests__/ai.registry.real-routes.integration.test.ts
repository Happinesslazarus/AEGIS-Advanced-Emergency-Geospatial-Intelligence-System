/**
 * What it tests:
 * Integration tests for the AI model governance routes.
  * Covers model status queries, retraining triggers, and the governance
  * lifecycle (shadow → candidate → active) via real HTTP routes.
  *
  * How it connects:
  * - Tests server/src/routes/aiRoutes.ts (registry governance endpoints)
  * - Testing server/src/services/modelMonitoringService.ts in integration
  * - Run via: npm test -- ai.registry.real
 */

process.env.NODE_ENV = 'test'
process.env.JWT_SECRET ??= 'test-jwt-secret-at-least-32-characters-long'
process.env.REFRESH_TOKEN_SECRET ??= 'test-refresh-secret-at-least-32-chars'

const mockGetRegistryHealth: jest.Mock = jest.fn(async () => ({
  current_version: 'v2026.03.10',
  avg_confidence: 0.84,
  drift_score: 0.12,
  alert_level: 'INFO',
}))

const mockGetAllRegistryHealth: jest.Mock = jest.fn(async () => ({
  items: [
    { hazard_type: 'flood', region_id: 'uk-default', current_version: 'v1', drift_score: 0.2, health_status: 'watch' },
  ],
}))

const mockGetRegistryDrift: jest.Mock = jest.fn(async () => ({
  snapshot: {
    sample_count: 22,
    avg_confidence: 0.77,
    confidence_std: 0.11,
    prediction_positive_rate: 0.42,
    drift_score: 0.27,
    alert_level: 'WARNING',
    top_feature_means: { rainfall: 0.8 },
    top_feature_stds: { rainfall: 0.12 },
  },
}))

const mockRecommendRollback: jest.Mock = jest.fn(async () => ({ recommendation: 'monitor', reason: 'stable enough' }))
const mockMarkDegraded: jest.Mock = jest.fn(async () => ({ updated: true, health_status: 'degraded' }))
const mockSubmitPredictionFeedback: jest.Mock = jest.fn(async () => ({ success: true }))

jest.mock('../services/aiClient.js', () => ({
  aiClient: {
    getRegistryHealth: mockGetRegistryHealth,
    getAllRegistryHealth: mockGetAllRegistryHealth,
    getRegistryDrift: mockGetRegistryDrift,
    recommendRegistryRollback: mockRecommendRollback,
    markRegistryDegraded: mockMarkDegraded,
    listRegistryVersions: jest.fn(async () => ({ items: [] })),
    promoteRegistryModel: jest.fn(async () => ({ ok: true })),
    demoteRegistryModel: jest.fn(async () => ({ ok: true })),
    validateRegistryModel: jest.fn(async () => ({ ok: true })),
    cleanupRegistryVersions: jest.fn(async () => ({ ok: true })),
    cleanupAllRegistry: jest.fn(async () => ({ ok: true })),
    submitPredictionFeedback: mockSubmitPredictionFeedback,
  },
}))

const metricSet = jest.fn()
const metricInc = jest.fn()

jest.mock('../services/metrics.js', () => ({
  aegisModelAvgConfidence: { set: (...args: any[]) => metricSet(...args) },
  aegisModelDriftScore: { set: (...args: any[]) => metricSet(...args) },
  aegisModelAlertStatus: { set: (...args: any[]) => metricSet(...args) },
  aegisModelFallbackTotal: { inc: (...args: any[]) => metricInc(...args) },
  reportSubmissionsTotal: { inc: jest.fn() },
}))

import express, { type Request, type Response, type NextFunction } from 'express'
import request from 'supertest'
import { beforeAll, beforeEach, describe, expect, it } from '@jest/globals'
import aiRoutes from '../routes/aiRoutes'
import { collectModelRollingStats, computeAndPersistModelDriftSnapshots } from '../services/modelMonitoringService'
import { ensureTestSchema, truncateAll, getTestPool } from './helpers/testDb'
import { insertOperator } from './helpers/testFixtures'
import { adminToken, operatorToken, authHeader, citizenToken } from './helpers/testAuth'

const app = express()
app.use(express.json())
app.use('/api/ai', aiRoutes)
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  res.status(err?.statusCode || 500).json({ error: err?.message || 'Internal error' })
})

describe('ai registry governance real routes + monitoring service', () => {
  beforeAll(async () => {
    await ensureTestSchema()
  })

  beforeEach(async () => {
    metricSet.mockClear()
    metricInc.mockClear()
    await truncateAll()
    await insertOperator({ id: '00000000-0000-0000-0000-000000000002', role: 'operator' })
    await insertOperator({ id: '00000000-0000-0000-0000-000000000003', role: 'admin', email: 'admin@test.aegis.local', display_name: 'Test Admin' })
  })

  it('exposes registry health and drift endpoints and updates metrics', async () => {
    const h1 = await request(app)
      .get('/api/ai/registry/health/flood/uk-default')
      .set(...authHeader(operatorToken()))
    expect(h1.status).toBe(200)
    expect(h1.body.current_version).toBe('v2026.03.10')

    const hAll = await request(app)
      .get('/api/ai/registry/health')
      .set(...authHeader(operatorToken()))
    expect(hAll.status).toBe(200)
    expect(Array.isArray(hAll.body.items)).toBe(true)

    const drift = await request(app)
      .get('/api/ai/registry/drift/flood/uk-default/v2026.03.10')
      .set(...authHeader(operatorToken()))
    expect(drift.status).toBe(200)
    expect(drift.body.snapshot.drift_score).toBe(0.27)
    expect(metricSet).toHaveBeenCalled()
  })

  it('enforces admin for mark-degraded and allows rollback recommendation to operators', async () => {
    const denied = await request(app)
      .post('/api/ai/registry/mark-degraded/flood/uk-default/v1')
      .set(...authHeader(operatorToken()))
      .send({ drift_score: 0.91, reason: 'manual override' })
    expect(denied.status).toBe(403)

    const allowed = await request(app)
      .post('/api/ai/registry/mark-degraded/flood/uk-default/v1')
      .set(...authHeader(adminToken()))
      .send({ drift_score: 0.91, reason: 'manual override' })
    expect(allowed.status).toBe(200)
    expect(allowed.body.updated).toBe(true)

    const rec = await request(app)
      .get('/api/ai/registry/recommend-rollback/flood/uk-default')
      .set(...authHeader(operatorToken()))
    expect(rec.status).toBe(200)
    expect(rec.body.recommendation).toBe('monitor')
  })

  it('covers registry auth failures, upstream failures, and default degraded arguments', async () => {
    const unauth = await request(app).get('/api/ai/registry/health/flood/uk-default')
    expect(unauth.status).toBe(401)

    mockGetRegistryHealth.mockRejectedValueOnce(new Error('registry unavailable'))
    const healthFailure = await request(app)
      .get('/api/ai/registry/health/flood/uk-default')
      .set(...authHeader(operatorToken()))
    expect(healthFailure.status).toBe(500)

    mockGetRegistryDrift.mockRejectedValueOnce(new Error('drift unavailable'))
    const driftFailure = await request(app)
      .get('/api/ai/registry/drift/flood/uk-default/v1')
      .set(...authHeader(operatorToken()))
    expect(driftFailure.status).toBe(500)

    mockRecommendRollback.mockRejectedValueOnce(new Error('rollback unavailable'))
    const rollbackFailure = await request(app)
      .get('/api/ai/registry/recommend-rollback/flood/uk-default')
      .set(...authHeader(operatorToken()))
    expect(rollbackFailure.status).toBe(500)

    const degraded = await request(app)
      .post('/api/ai/registry/mark-degraded/flood/uk-default/v2')
      .set(...authHeader(adminToken()))
      .send({})

    expect(degraded.status).toBe(200)
    expect(mockMarkDegraded).toHaveBeenLastCalledWith('flood', 'uk-default', 'v2', 0.8, 'manual_mark_degraded')
  })

  it('restricts prediction feedback to operator roles', async () => {
    const citizenDenied = await request(app)
      .post('/api/ai/predictions/test-prediction/feedback')
      .set(...authHeader(citizenToken()))
      .send({ feedback: 'correct' })
    expect(citizenDenied.status).toBe(403)

    const operatorAllowed = await request(app)
      .post('/api/ai/predictions/test-prediction/feedback')
      .set(...authHeader(operatorToken()))
      .send({ feedback: 'correct' })
    expect(operatorAllowed.status).toBe(200)
    expect(mockSubmitPredictionFeedback).toHaveBeenCalledWith('test-prediction', 'correct')
  })

  it('persists drift snapshots and computes rolling metrics in monitoring service', async () => {
    const pool = getTestPool()
    await pool.query(
      `INSERT INTO ai_predictions (hazard_type, region_id, model_version, confidence, probability, generated_at)
       VALUES ('flood', 'uk-default', 'v1', 0.8, 0.7, NOW()),
              ('flood', 'uk-default', 'v1', 0.6, 0.4, NOW())`
    )

    const rolled = await collectModelRollingStats()
    expect(rolled).toBeGreaterThanOrEqual(1)

    const snapped = await computeAndPersistModelDriftSnapshots()
    expect(snapped).toBeGreaterThanOrEqual(1)

    const { rows } = await pool.query('SELECT COUNT(*)::int AS c FROM model_monitoring_snapshots')
    expect(rows[0].c).toBeGreaterThanOrEqual(1)
  })
})
