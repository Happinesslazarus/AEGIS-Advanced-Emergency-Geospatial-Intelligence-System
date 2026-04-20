/**
 * Integration test verifying that POST /api/internal/errors/frontend is
 * rate-limited to 20 requests per minute per IP.
 *
 * This test spins up a minimal Express app that mounts internalRoutes exactly
 * as it is mounted in production (same middleware stack, same pool mock).
 * No real database is required: the pool.query mock resolves successfully
 * for the first 20 calls and we check the 21st returns 429.
 */

import { describe, it, expect, beforeAll, afterAll, jest } from '@jest/globals'
import request from 'supertest'
import express from 'express'
import type { Application } from 'express'
import { Server } from 'http'

// -
//Env stubs required by the module graph
// -
process.env.JWT_SECRET       = 'test-jwt-secret-at-least-32-characters-long'
process.env.REFRESH_TOKEN_SECRET = 'test-refresh-secret-at-least-32-chars'
process.env.INTERNAL_API_KEY = 'test-internal-key'
process.env.NODE_ENV         = 'test'

// -
//Mock the database pool -- the route does INSERT INTO frontend_errors.
//We want that to succeed so we can count up to the limit cleanly.
// -
const mockQuery: jest.Mock = jest.fn(async () => ({ rows: [], rowCount: 1 }))
const mockPool = { query: mockQuery, on: jest.fn() }

jest.mock('../models/db.js', () => ({
  __esModule: true,
  default: mockPool,
}))

//Mocks for services imported by the route file
jest.mock('../services/n8nHealthCheck.js',    () => ({ getN8nHealthState:    jest.fn().mockReturnValue({ healthy: true }) }))
jest.mock('../services/cronJobs.js',          () => ({ isFallbackActive:     jest.fn().mockReturnValue(false) }))
jest.mock('../services/externalApiWrapper.js',() => ({ getCircuitBreakerStates: jest.fn().mockReturnValue({}) }))
jest.mock('../services/n8nWorkflowService.js',() => ({ getWorkflowDefinitions:  jest.fn().mockReturnValue([]) }))
jest.mock('../config/regions/index.js',       () => ({ getActiveCityRegion:  jest.fn().mockReturnValue({ id: 'aberdeen' }) }))
jest.mock('../middleware/internalAuth.js', () => ({
  internalAuth:    (_r: unknown, _s: unknown, n: () => void) => n(),
  n8nWebhookAuth:  (_r: unknown, _s: unknown, n: () => void) => n(),
  internalApiKeyAuth: (_r: unknown, _s: unknown, n: () => void) => n(),
}))
jest.mock('../utils/AppError.js', () => ({
  AppError: {
    badRequest:          (m: string) => { const e = new Error(m) as any; e.statusCode = 400; return e },
    serviceUnavailable:  (m: string) => { const e = new Error(m) as any; e.statusCode = 503; return e },
  },
}))
jest.mock('../services/logger.js', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }))
jest.mock('../utils/logger.js',    () => ({ devLog: jest.fn() }))

// -
//Build the minimal app
// -

let app: Application
let server: Server

beforeAll(async () => {
  const { default: internalRoutes } = await import('../routes/internalRoutes.js')

  app = express()
  app.set('trust proxy', 1)   // required for X-Forwarded-For keying by express-rate-limit
  app.use(express.json())
  app.use('/api/internal', internalRoutes)

  server = app.listen(0) // random free port
})

afterAll(() => {
  server?.close()
})

// -
//Tests
// -

describe('POST /api/internal/errors/frontend -- rate limiting', () => {
  const validBody = {
    error_message: 'TypeError: Cannot read properties of undefined',
    component_name: 'DashboardPage',
    route: '/dashboard',
    browser_info: 'Chrome/124',
  }

  it('accepts the first 20 requests within a 1-minute window', async () => {
    const responses = await Promise.all(
      Array.from({ length: 20 }).map(() =>
        request(app)
          .post('/api/internal/errors/frontend')
          .set('X-Forwarded-For', '10.0.0.1') // same IP for all
          .send(validBody)
      )
    )
    const statuses = responses.map(r => r.status)
    //All should succeed (200 OK or whatever the route returns for success)
    expect(statuses.every(s => s < 400)).toBe(true)
  }, 15_000)

  it('returns 429 on the 21st request from the same IP', async () => {
    //One more after the 20 above
    const res = await request(app)
      .post('/api/internal/errors/frontend')
      .set('X-Forwarded-For', '10.0.0.1')
      .send(validBody)

    expect(res.status).toBe(429)
    expect(res.body).toMatchObject({ error: expect.stringContaining('Too many') })
  })

  it('allows a different IP through even when the first IP is rate-limited', async () => {
    const res = await request(app)
      .post('/api/internal/errors/frontend')
      .set('X-Forwarded-For', '10.0.0.2') // different IP
      .send(validBody)

    //A fresh IP is not rate-limited
    expect(res.status).toBeLessThan(400)
  })
})
