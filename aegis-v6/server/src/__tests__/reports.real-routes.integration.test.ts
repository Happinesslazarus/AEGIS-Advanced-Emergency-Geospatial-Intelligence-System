process.env.NODE_ENV = 'test'
process.env.JWT_SECRET ??= 'test-jwt-secret-at-least-32-characters-long'
process.env.REFRESH_TOKEN_SECRET ??= 'test-refresh-secret-at-least-32-chars'

import jwt from 'jsonwebtoken'

jest.mock('../services/aiAnalysisPipeline.js', () => ({
  analyseReport: jest.fn(async () => undefined),
}))

jest.mock('../services/classifierRouter.js', () => ({
  classify: jest.fn(async () => ({ label: 'flood', confidence: 0.81 })),
}))

jest.mock('../services/aiClient.js', () => ({
  aiClient: {
    predictIncident: jest.fn(async () => ({ category: 'flood', confidence: 0.77 })),
  },
}))

jest.mock('../config/regions/index.js', () => ({
  getActiveCityRegion: jest.fn(() => ({
    id: 'uk-default',
    centre: { lat: 57.1497, lng: -2.0943 },
    boundingBox: { north: 57.8, south: 56.8, east: -1.5, west: -2.8 },
  })),
}))

jest.mock('../services/incidentIntelligenceCore.js', () => ({
  IncidentIntelligenceCore: jest.fn().mockImplementation(() => ({
    analyseSignals: jest.fn(async () => ({ alerts: [], recommendations: [] })),
  })),
}))

jest.mock('../services/metrics.js', () => ({
  reportSubmissionsTotal: { inc: jest.fn() },
  aegisModelAvgConfidence: { set: jest.fn() },
  aegisModelDriftScore: { set: jest.fn() },
  aegisModelAlertStatus: { set: jest.fn() },
  aegisModelFallbackTotal: { inc: jest.fn() },
}))

import express, { type Request, type Response, type NextFunction } from 'express'
import request from 'supertest'
import { beforeAll, beforeEach, describe, expect, it } from '@jest/globals'

import reportRoutes from '../routes/reportRoutes'
import { ensureTestSchema, truncateAll, getTestPool } from './helpers/testDb'
import { insertOperator, insertReport } from './helpers/testFixtures'
import { adminToken, authHeader, citizenToken, operatorToken } from './helpers/testAuth'

function superAdminToken() {
  return jwt.sign(
    {
      id: '00000000-0000-0000-0000-000000000003',
      email: 'admin@test.aegis.local',
      role: 'admin',
      displayName: 'Control Admin',
      department: 'Command & Control',
    },
    process.env.JWT_SECRET!,
    { expiresIn: '1h' },
  )
}

const app = express()
app.use(express.json())
app.set('io', { emit: jest.fn(), to: jest.fn(() => ({ emit: jest.fn() })) })
app.use('/api/reports', reportRoutes)
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  res.status(err?.statusCode || 500).json({ error: err?.message || 'Internal error' })
})

describe('reports real route integration', () => {
  beforeAll(async () => {
    await ensureTestSchema()

    const pool = getTestPool()
    await pool.query('ALTER TABLE reports ADD COLUMN IF NOT EXISTS verified_by UUID')
    await pool.query('ALTER TABLE activity_log ADD COLUMN IF NOT EXISTS report_id UUID')
    await pool.query('ALTER TABLE activity_log ADD COLUMN IF NOT EXISTS operator_name TEXT')
    await pool.query(`
      CREATE TABLE IF NOT EXISTS report_status_history (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        report_id UUID,
        old_status TEXT,
        new_status TEXT,
        changed_by UUID,
        reason TEXT,
        changed_at TIMESTAMPTZ DEFAULT NOW()
      )
    `)
  })

  beforeEach(async () => {
    await truncateAll()
    await insertOperator()
  })

  it('lists and fetches reports from production router', async () => {
    const r = await insertReport({ incident_category: 'flood', severity: 'high', status: 'new' })

    const list = await request(app).get('/api/reports?limit=20')
    expect(list.status).toBe(200)
    expect(Array.isArray(list.body)).toBe(true)
    expect(list.body.length).toBeGreaterThanOrEqual(1)

    const single = await request(app).get(`/api/reports/${r.id}`)
    expect(single.status).toBe(200)
    expect(single.body.id).toBe(r.id)
  })

  it('updates status and bulk-updates via operator endpoints', async () => {
    const r1 = await insertReport({ status: 'new' })
    const r2 = await insertReport({ status: 'new' })

    const status = await request(app)
      .put(`/api/reports/${r1.id}/status`)
      .set(...authHeader(operatorToken()))
      .send({ status: 'Flagged', reason: 'Needs manual verification' })

    expect(status.status).toBe(200)
    expect(status.body.success).toBe(true)

    const bulk = await request(app)
      .put('/api/reports/bulk/status')
      .set(...authHeader(operatorToken()))
      .send({ reportIds: [r1.id, r2.id], status: 'Resolved', reason: 'Batch resolution test' })

    expect(bulk.status).toBe(200)
    expect(bulk.body.updated).toBe(2)

    const exportJson = await request(app)
      .get('/api/reports/export/json')
      .set(...authHeader(operatorToken()))

    expect(exportJson.status).toBe(200)
    expect(Array.isArray(exportJson.body)).toBe(true)

    const notes = await request(app)
      .put(`/api/reports/${r1.id}/notes`)
      .set(...authHeader(operatorToken()))
      .send({ notes: 'Operator triage note' })

    expect(notes.status).toBe(200)
    expect(notes.body.success).toBe(true)
  })

  it('returns validation errors for invalid status transitions', async () => {
    const r = await insertReport({ status: 'new' })

    const invalid = await request(app)
      .put(`/api/reports/${r.id}/status`)
      .set(...authHeader(operatorToken()))
      .send({ status: 'NOT_A_REAL_STATUS' })

    expect(invalid.status).toBe(400)
    expect(invalid.body.error).toContain('Invalid status')

    const invalidBulk = await request(app)
      .put('/api/reports/bulk/status')
      .set(...authHeader(operatorToken()))
      .send({ reportIds: [], status: 'Verified' })

    expect(invalidBulk.status).toBe(400)
  })

  it('applies filters, reports missing ids, and rejects unauthorised status changes', async () => {
    const r1 = await insertReport({ status: 'new', incident_category: 'flood', severity: 'high' })
    await insertReport({ status: 'resolved', incident_category: 'wildfire', severity: 'low' })

    const filtered = await request(app).get('/api/reports?status=resolved&category=wildfire&limit=5')
    expect(filtered.status).toBe(200)
    expect(filtered.body).toHaveLength(1)

    const missing = await request(app).get('/api/reports/00000000-0000-0000-0000-000000000099')
    expect(missing.status).toBe(404)

    const noAuth = await request(app)
      .put(`/api/reports/${r1.id}/status`)
      .send({ status: 'Resolved' })
    expect(noAuth.status).toBe(401)

    const citizenLikeToken = jwt.sign(
      {
        id: '00000000-0000-0000-0000-000000000011',
        email: 'citizen-like@test.aegis.local',
        role: 'citizen',
        displayName: 'Citizen Like',
      },
      process.env.JWT_SECRET!,
      { expiresIn: '1h' },
    )

    const forbidden = await request(app)
      .put(`/api/reports/${r1.id}/status`)
      .set(...authHeader(citizenLikeToken))
      .send({ status: 'Resolved' })
    expect(forbidden.status).toBe(403)

    const notesDenied = await request(app)
      .put(`/api/reports/${r1.id}/notes`)
      .set(...authHeader(citizenToken()))
      .send({ notes: 'Citizen should not set operator notes' })
    expect(notesDenied.status).toBe(403)

    const exportDenied = await request(app)
      .get('/api/reports/export/json')
      .set(...authHeader(citizenToken()))
    expect(exportDenied.status).toBe(403)
  })

  it('requires a super-admin justification before overriding an already-actioned report', async () => {
    const actioned = await insertReport({ status: 'resolved' })

    const operatorAttempt = await request(app)
      .put(`/api/reports/${actioned.id}/status`)
      .set(...authHeader(operatorToken()))
      .send({ status: 'Archived' })
    expect(operatorAttempt.status).toBe(403)

    const plainAdmin = await request(app)
      .put(`/api/reports/${actioned.id}/status`)
      .set(...authHeader(adminToken()))
      .send({ status: 'Archived' })
    expect(plainAdmin.status).toBe(400)

    const missingReason = await request(app)
      .put(`/api/reports/${actioned.id}/status`)
      .set(...authHeader(superAdminToken()))
      .send({ status: 'Archived' })
    expect(missingReason.status).toBe(400)

    const allowed = await request(app)
      .put(`/api/reports/${actioned.id}/status`)
      .set(...authHeader(superAdminToken()))
      .send({ status: 'Archived', reason: 'Incident record retention complete' })
    expect(allowed.status).toBe(200)
    expect(allowed.body.success).toBe(true)
  })
})
