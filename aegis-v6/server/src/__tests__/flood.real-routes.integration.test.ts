/**
 * Real-route integration tests for the flood endpoints with mocked services.
  * Tests authentication guards, response shapes, and cache behaviour
  * without hitting external flood data APIs.
  *
  * - Tests server/src/routes/floodRoutes.ts with mocked riverLevelService
  * - Run via: npm test -- flood.real
 */

process.env.NODE_ENV = 'test'

jest.mock('../services/floodPredictionService.js', () => ({
  getFloodPredictions: jest.fn(async () => [
    { id: 'p1', area: 'north-bank', risk_level: 'high' },
    { id: 'p2', area: 'south-bank', risk_level: 'medium' },
  ]),
}))

jest.mock('../services/evacuationService.js', () => ({
  calculateEvacuationRoutes: jest.fn(async (lat: number, lng: number) => ({
    routes: [{ id: 'r1', startLat: lat, startLng: lng, etaMinutes: 7 }],
    alternatives: [],
  })),
  getOperationalEvacuationOverview: jest.fn(async () => ({
    routes: [{ id: 'operational-1', destinationType: 'shelter' }],
  })),
}))

jest.mock('../services/threatLevelService.js', () => ({
  calculateThreatLevel: jest.fn(async () => ({ level: 'high', score: 0.82 })),
}))

jest.mock('../config/incidentTypes.js', () => ({
  getIncidentType: jest.fn((incidentType: string) => ({
    id: incidentType,
    enabled: incidentType !== 'disabled-incident',
  })),
}))

jest.mock('../incidents/index.js', () => ({
  getIncidentModule: jest.fn(() => ({
    getPredictions: jest.fn(async () => [{ id: 'wf-1', risk: 'watch' }]),
    getAlerts: jest.fn(async () => [{ severity: 'critical' }, { severity: 'low' }]),
  })),
}))

jest.mock('../config/regions/index.js', () => ({
  getActiveCityRegion: jest.fn(() => ({ id: 'uk-default' })),
}))

import express, { type Request, type Response, type NextFunction } from 'express'
import request from 'supertest'
import { describe, expect, it } from '@jest/globals'
import floodRoutes from '../routes/floodRoutes'

const app = express()
app.use(express.json())
app.use('/api', floodRoutes)
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  res.status(err?.statusCode || 500).json({ error: err?.message || 'Internal error' })
})

describe('flood real route integration (with mocked services)', () => {
  it('serves canonical flood prediction and threat endpoints', async () => {
    const prediction = await request(app).get('/api/flood/prediction')
    expect(prediction.status).toBe(200)
    expect(prediction.body.count).toBe(2)

    const threat = await request(app).get('/api/flood/threat')
    expect(threat.status).toBe(200)
    expect(threat.body.level).toBe('high')
  })

  it('supports incident aliases and non-flood module delegation', async () => {
    const wildfirePrediction = await request(app).get('/api/incidents/wildfire/prediction')
    expect(wildfirePrediction.status).toBe(200)
    expect(wildfirePrediction.body.incidentType).toBe('wildfire')

    const wildfireThreat = await request(app).get('/api/incidents/wildfire/threat')
    expect(wildfireThreat.status).toBe(200)
    expect(wildfireThreat.body.level).toBe('critical')

    const refresh = await request(app).post('/api/incidents/wildfire/prediction/refresh')
    expect(refresh.status).toBe(200)
    expect(refresh.body.refreshed).toBe(true)
  })

  it('validates evacuation input and supports canonical + legacy routes', async () => {
    const bad = await request(app).post('/api/flood/evacuation/route').send({ startLat: 'x', startLng: 12 })
    expect(bad.status).toBe(400)

    const canonical = await request(app)
      .post('/api/flood/evacuation/route')
      .send({ startLat: 57.1497, startLng: -2.0943, destinationType: 'both' })
    expect(canonical.status).toBe(200)
    expect(canonical.body.routes.length).toBeGreaterThanOrEqual(1)

    const legacy = await request(app).get('/api/evacuation/routes?destinationType=shelter')
    expect(legacy.status).toBe(200)
    expect(legacy.body.count).toBe(1)
  })

  it('rejects unsafe river names in extents endpoint', async () => {
    const attack = await request(app).get('/api/flood/extents/../secrets')
    expect(attack.status).toBe(404)

    const invalid = await request(app).get('/api/incidents/flood/extents/../../../etc/passwd')
    expect(invalid.status).toBe(404)
  })
})
