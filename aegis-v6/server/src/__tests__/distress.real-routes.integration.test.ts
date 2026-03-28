process.env.NODE_ENV = 'test'
process.env.JWT_SECRET ??= 'test-jwt-secret-at-least-32-characters-long'
process.env.REFRESH_TOKEN_SECRET ??= 'test-refresh-secret-at-least-32-chars'

import express, { type Request, type Response, type NextFunction } from 'express'
import request from 'supertest'
import { beforeAll, beforeEach, describe, expect, it } from '@jest/globals'

import distressRoutes from '../routes/distressRoutes'
import { ensureTestSchema, truncateAll, getTestPool } from './helpers/testDb'
import { insertCitizen, insertOperator } from './helpers/testFixtures'
import { authHeader, citizenToken, operatorToken, generateTestToken, TEST_CITIZEN, TEST_OPERATOR } from './helpers/testAuth'

const app = express()
app.use(express.json())
app.use('/api/distress', distressRoutes)
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  res.status(err?.statusCode || 500).json({ error: err?.message || 'Internal error' })
})

describe('distress real route integration', () => {
  beforeAll(async () => {
    await ensureTestSchema()
    await truncateAll()
    await insertCitizen()
    await insertOperator()
  })

  beforeEach(async () => {
    await truncateAll()
    await insertCitizen()
    await insertOperator()
  })

  it('activates, updates location, acknowledges, resolves, and appears in history', async () => {
    const activate = await request(app)
      .post('/api/distress/activate')
      .set(...authHeader(citizenToken()))
      .send({
        citizenName: 'Citizen Under Test',
        latitude: 57.1497,
        longitude: -2.0943,
        message: 'Need help',
      })

    expect(activate.status).toBe(201)
    expect(activate.body.distress.status).toBe('active')

    const distressId = activate.body.distress.id as string

    const location = await request(app)
      .post('/api/distress/location')
      .set(...authHeader(citizenToken()))
      .send({ distressId, latitude: 57.15, longitude: -2.09, accuracy: 6.5 })

    expect(location.status).toBe(200)
    expect(location.body.success).toBe(true)

    const active = await request(app)
      .get('/api/distress/active')
      .set(...authHeader(operatorToken()))

    expect(active.status).toBe(200)
    expect(active.body.count).toBe(1)

    const ack = await request(app)
      .post(`/api/distress/${distressId}/acknowledge`)
      .set(...authHeader(operatorToken()))
      .send({ operatorId: 'op-1', triageLevel: 'high' })

    expect(ack.status).toBe(200)
    expect(ack.body.distress.status).toBe('acknowledged')
    expect(ack.body.distress.acknowledged_by).toBe(TEST_OPERATOR.id)

    const resolve = await request(app)
      .post(`/api/distress/${distressId}/resolve`)
      .set(...authHeader(operatorToken()))
      .send({ operatorId: 'op-1', resolution: 'Dispatched unit' })

    expect(resolve.status).toBe(200)
    expect(resolve.body.distress.status).toBe('resolved')
    expect(resolve.body.distress.resolved_by).toBe(TEST_OPERATOR.id)

    const history = await request(app)
      .get('/api/distress/history?limit=10')
      .set(...authHeader(operatorToken()))

    expect(history.status).toBe(200)
    expect(Array.isArray(history.body.distressCalls)).toBe(true)
    expect(history.body.distressCalls.length).toBeGreaterThanOrEqual(1)
  })

  it('rejects duplicate active distress and blocks operator endpoints for citizen role', async () => {
    const first = await request(app)
      .post('/api/distress/activate')
      .set(...authHeader(citizenToken()))
      .send({ latitude: 57.14, longitude: -2.09 })

    expect(first.status).toBe(201)

    const duplicate = await request(app)
      .post('/api/distress/activate')
      .set(...authHeader(citizenToken()))
      .send({ latitude: 57.14, longitude: -2.09 })

    expect(duplicate.status).toBe(409)
    expect(duplicate.body.error).toContain('active distress call')

    const blocked = await request(app)
      .get('/api/distress/active')
      .set(...authHeader(citizenToken()))

    expect(blocked.status).toBe(403)
  })

  it('returns 404 when canceling unknown distress session', async () => {
    const res = await request(app)
      .post('/api/distress/cancel')
      .set(...authHeader(citizenToken()))
      .send({ distressId: '00000000-0000-0000-0000-000000000099', citizenId: TEST_CITIZEN.id })

    expect(res.status).toBe(404)
  })

  it('persists location history entries when updates are sent', async () => {
    const activate = await request(app)
      .post('/api/distress/activate')
      .set(...authHeader(citizenToken()))
      .send({ latitude: 57.1497, longitude: -2.0943 })

    const distressId = activate.body.distress.id as string

    await request(app)
      .post('/api/distress/location')
      .set(...authHeader(citizenToken()))
      .send({ distressId, latitude: 57.1501, longitude: -2.0941, speed: 1.2 })

    const pool = getTestPool()
    const { rows } = await pool.query('SELECT COUNT(*)::int AS c FROM distress_location_history WHERE distress_id = $1', [distressId])
    expect(rows[0].c).toBeGreaterThanOrEqual(1)
  })

  it('blocks citizens from reading or updating another citizen distress call', async () => {
    const otherCitizen = {
      id: '00000000-0000-0000-0000-000000000010',
      email: 'other-citizen@test.aegis.local',
      role: 'citizen',
      displayName: 'Other Citizen',
    }
    await insertCitizen({
      id: otherCitizen.id,
      email: otherCitizen.email,
      display_name: otherCitizen.displayName,
    })

    const activate = await request(app)
      .post('/api/distress/activate')
      .set(...authHeader(citizenToken()))
      .send({ latitude: 57.1497, longitude: -2.0943 })

    const distressId = activate.body.distress.id as string
    const otherCitizenToken = generateTestToken(otherCitizen)

    const readDenied = await request(app)
      .get(`/api/distress/${distressId}`)
      .set(...authHeader(otherCitizenToken))

    expect(readDenied.status).toBe(404)

    const updateDenied = await request(app)
      .post('/api/distress/location')
      .set(...authHeader(otherCitizenToken))
      .send({ distressId, latitude: 57.16, longitude: -2.08 })

    expect(updateDenied.status).toBe(404)
  })
})
