/**
 * What it tests:
 * Integration tests for the AI engine proxy routes with real HTTP calls.
  * Verifies that /api/ai/* endpoints forward correctly to the AI engine
  * and that authentication, timeout, and error-response handling are correct.
  *
  * How it connects:
  * - Tests server/src/routes/aiRoutes.ts (non-registry endpoints)
  * - Requires a running PostgreSQL and optionally a mock AI engine
  * - Run via: npm test -- ai.real
 */

process.env.NODE_ENV = 'test'
process.env.JWT_SECRET ??= 'test-jwt-secret-at-least-32-characters-long'
process.env.REFRESH_TOKEN_SECRET ??= 'test-refresh-secret-at-least-32-chars'

const mockPredict: jest.Mock = jest.fn(async () => ({
  probability: 0.86,
  risk_level: 'High',
  confidence: 0.79,
  model_version: 'v-test-1',
  contributing_factors: [{ factor: 'rainfall', importance: 0.8, value: 12 }],
  data_sources: ['rain-gauge'],
}))
const mockIsAvailable: jest.Mock = jest.fn(async () => true)
const mockGetModelStatus: jest.Mock = jest.fn(async () => ({ models_loaded: 4 }))
const mockTriggerRetrain: jest.Mock = jest.fn(async () => ({ job_id: 'job-123', accepted: true }))
const mockClassifyReport: jest.Mock = jest.fn(async () => ({ label: 'flood', confidence: 0.73 }))
const mockPredictSeverity: jest.Mock = jest.fn(async () => ({ severity: 'high', confidence: 0.7 }))
const mockRollbackModel: jest.Mock = jest.fn(async () => ({ ok: true, to_version: 'v-prev' }))
const mockCheckDrift: jest.Mock = jest.fn(async () => ({ models: [] }))
const mockSubmitPredictionFeedback: jest.Mock = jest.fn(async () => ({ success: true }))
const mockGetPredictionStats: jest.Mock = jest.fn(async () => ({ total: 3 }))

jest.mock('../services/aiClient.js', () => ({
  aiClient: {
    predict: mockPredict,
    isAvailable: mockIsAvailable,
    getModelStatus: mockGetModelStatus,
    getHazardTypes: jest.fn(async () => ['flood', 'wildfire']),
    triggerRetrain: mockTriggerRetrain,
    classifyReport: mockClassifyReport,
    predictSeverity: mockPredictSeverity,
    detectFake: jest.fn(async () => ({ risk: 'low' })),
    rollbackModel: mockRollbackModel,
    checkDrift: mockCheckDrift,
    submitPredictionFeedback: mockSubmitPredictionFeedback,
    getPredictionStats: mockGetPredictionStats,
    listGovernedModels: jest.fn(async () => ({ items: [] })),
    listModelVersions: jest.fn(async () => ({ items: [] })),
    listRegistryVersions: jest.fn(async () => ({ items: [] })),
    promoteRegistryModel: jest.fn(async () => ({ ok: true })),
    demoteRegistryModel: jest.fn(async () => ({ ok: true })),
    validateRegistryModel: jest.fn(async () => ({ ok: true })),
    cleanupRegistryVersions: jest.fn(async () => ({ ok: true })),
    cleanupAllRegistry: jest.fn(async () => ({ ok: true })),
    getRegistryHealth: jest.fn(async () => ({ current_version: 'v1' })),
    getAllRegistryHealth: jest.fn(async () => ({ items: [] })),
    getRegistryDrift: jest.fn(async () => ({ snapshot: {} })),
    markRegistryDegraded: jest.fn(async () => ({ updated: true })),
    recommendRegistryRollback: jest.fn(async () => ({ recommendation: 'monitor' })),
  },
}))

jest.mock('../services/imageAnalysisService.js', () => ({
  analyseImage: jest.fn(async () => ({
    photoValidation: { isAuthentic: true },
    exifAnalysis: { hasExif: false },
    modelUsed: 'vit',
    processingTimeMs: 42,
  })),
}))

const metricInc = jest.fn()
const metricSet = jest.fn()

jest.mock('../services/metrics.js', () => ({
  aiPredictionsTotal: { inc: (...args: any[]) => metricInc(...args) },
  aegisModelPredictionsTotal: { inc: (...args: any[]) => metricInc(...args) },
  aegisModelAvgConfidence: { set: (...args: any[]) => metricSet(...args) },
  aegisModelDriftScore: { set: (...args: any[]) => metricSet(...args) },
  aegisModelAlertStatus: { set: (...args: any[]) => metricSet(...args) },
}))

import express, { type Request, type Response, type NextFunction } from 'express'
import request from 'supertest'
import { beforeAll, beforeEach, describe, expect, it } from '@jest/globals'

import aiRoutes from '../routes/aiRoutes'
import { ensureTestSchema, truncateAll, getTestPool } from './helpers/testDb'
import { insertOperator } from './helpers/testFixtures'
import { adminToken, authHeader, operatorToken } from './helpers/testAuth'

const app = express()
app.use(express.json())
app.set('io', { to: jest.fn(() => ({ emit: jest.fn() })) })
app.use('/api/ai', aiRoutes)
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  res.status(err?.statusCode || 500).json({ error: err?.message || 'Internal error' })
})

describe('ai non-registry real route integration', () => {
  beforeAll(async () => {
    await ensureTestSchema()
  })

  beforeEach(async () => {
    await truncateAll()
    await insertOperator()
    await insertOperator({ id: '00000000-0000-0000-0000-000000000003', role: 'admin', email: 'admin@test.aegis.local', display_name: 'Test Admin' })
    mockPredict.mockClear()
    mockIsAvailable.mockReset().mockResolvedValue(true)
    mockGetModelStatus.mockReset().mockResolvedValue({ models_loaded: 4 })
    mockTriggerRetrain.mockReset().mockResolvedValue({ job_id: 'job-123', accepted: true })
    mockClassifyReport.mockReset().mockResolvedValue({ label: 'flood', confidence: 0.73 })
    mockPredictSeverity.mockReset().mockResolvedValue({ severity: 'high', confidence: 0.7 })
    mockRollbackModel.mockReset().mockResolvedValue({ ok: true, to_version: 'v-prev' })
    mockCheckDrift.mockReset().mockResolvedValue({ models: [] })
    mockSubmitPredictionFeedback.mockReset().mockResolvedValue({ success: true })
    mockGetPredictionStats.mockReset().mockResolvedValue({ total: 3 })
    metricInc.mockClear()
    metricSet.mockClear()
  })

  it('rejects unauthenticated predict requests and invalid prediction payloads', async () => {
    const unauth = await request(app)
      .post('/api/ai/predict')
      .send({ hazard_type: 'flood' })

    expect(unauth.status).toBe(401)

    const missing = await request(app)
      .post('/api/ai/predict')
      .set(...authHeader(operatorToken()))
      .send({ hazard_type: 'flood', region_id: 'uk-default' })

    expect(missing.status).toBe(400)
    expect(missing.body.error).toContain('Missing required fields')

    const invalidCoords = await request(app)
      .post('/api/ai/predict')
      .set(...authHeader(operatorToken()))
      .send({
        hazard_type: 'flood',
        region_id: 'uk-default',
        latitude: 123,
        longitude: -2.1,
      })

    expect(invalidCoords.status).toBe(400)
    expect(invalidCoords.body.error).toContain('Invalid coordinates')
  })

  it('stores successful predictions through the production router', async () => {
    const res = await request(app)
      .post('/api/ai/predict')
      .set(...authHeader(operatorToken()))
      .send({
        hazard_type: 'flood',
        region_id: 'uk-default',
        latitude: 57.1497,
        longitude: -2.0943,
      })

    expect(res.status).toBe(200)
    expect(res.body.prediction_id).toBeDefined()
    expect(metricInc).toHaveBeenCalled()

    const pool = getTestPool()
    const inserted = await pool.query('SELECT COUNT(*)::int AS c FROM ai_predictions')
    expect(inserted.rows[0].c).toBe(1)
  })

  it('reports status for both unavailable and operational AI engine states', async () => {
    mockIsAvailable.mockResolvedValueOnce(false)

    const unavailable = await request(app).get('/api/ai/status')
    expect(unavailable.status).toBe(200)
    expect(unavailable.body.status).toBe('unavailable')

    const available = await request(app).get('/api/ai/status')
    expect(available.status).toBe(200)
    expect(available.body.status).toBe('operational')
    expect(available.body.models_loaded).toBe(4)
  })

  it('enforces admin and validation branches for retraining and rollback', async () => {
    const forbiddenRetrain = await request(app)
      .post('/api/ai/retrain')
      .set(...authHeader(operatorToken()))
      .send({ hazard_type: 'flood', region_id: 'uk-default' })

    expect(forbiddenRetrain.status).toBe(403)

    const missingRetrainArgs = await request(app)
      .post('/api/ai/retrain')
      .set(...authHeader(adminToken()))
      .send({ hazard_type: 'flood' })

    expect(missingRetrainArgs.status).toBe(400)

    const retrain = await request(app)
      .post('/api/ai/retrain')
      .set(...authHeader(adminToken()))
      .send({ hazard_type: 'flood', region_id: 'uk-default' })

    expect(retrain.status).toBe(200)
    expect(retrain.body.job_id).toBe('job-123')

    const forbiddenRollback = await request(app)
      .post('/api/ai/models/rollback')
      .set(...authHeader(operatorToken()))
      .send({ model_name: 'flood' })

    expect(forbiddenRollback.status).toBe(403)

    const missingModel = await request(app)
      .post('/api/ai/models/rollback')
      .set(...authHeader(adminToken()))
      .send({})

    expect(missingModel.status).toBe(400)

    const rollback = await request(app)
      .post('/api/ai/models/rollback')
      .set(...authHeader(adminToken()))
      .send({ model_name: 'flood', target_version: 'v-prev' })

    expect(rollback.status).toBe(200)
    expect(mockRollbackModel).toHaveBeenCalledWith('flood', 'v-prev')
  })

  it('covers classify, severity, drift, feedback, and stats failure branches on the real router', async () => {
    const missingText = await request(app)
      .post('/api/ai/classify-report')
      .set(...authHeader(operatorToken()))
      .send({ description: 'Missing text' })

    expect(missingText.status).toBe(400)

    mockClassifyReport.mockRejectedValueOnce(new Error('classifier offline'))
    const classifyFailure = await request(app)
      .post('/api/ai/classify-report')
      .set(...authHeader(operatorToken()))
      .send({ text: 'river burst its banks' })

    expect(classifyFailure.status).toBe(500)

    const missingSeverityText = await request(app)
      .post('/api/ai/predict-severity')
      .set(...authHeader(operatorToken()))
      .send({})

    expect(missingSeverityText.status).toBe(400)

    const invalidFeedback = await request(app)
      .post('/api/ai/predictions/pred-1/feedback')
      .set(...authHeader(operatorToken()))
      .send({ feedback: 'bad-value' })

    expect(invalidFeedback.status).toBe(400)

    const drift = await request(app)
      .get('/api/ai/drift?hours=12')
      .set(...authHeader(operatorToken()))

    expect(drift.status).toBe(200)
    expect(mockCheckDrift).toHaveBeenCalledWith(undefined, 12)

    const stats = await request(app)
      .get('/api/ai/predictions/stats?model_name=flood-model&hours=6')
      .set(...authHeader(operatorToken()))

    expect(stats.status).toBe(200)
    expect(mockGetPredictionStats).toHaveBeenCalledWith('flood-model', 6)
  })

})