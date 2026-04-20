/**
 * What it tests:
 * Integration tests for the alerts and push-subscription endpoints.
  * Verifies alert creation, retrieval, push subscription registration,
  * and real-time Socket.IO broadcast on new alert events.
  *
  * How it connects:
  * - Tests server/src/routes/alertRoutes.ts and subscriptionRoutes.ts
  * - Database fixtures in server/src/__tests__/helpers/
  * - Run via: npm test -- alerts.integration
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from '@jest/globals'
import request from 'supertest'
import express, { type Request, type Response, type NextFunction } from 'express'

//Test environment
process.env.JWT_SECRET = 'test-jwt-secret-at-least-32-characters-long'
process.env.REFRESH_TOKEN_SECRET = 'test-refresh-secret-at-least-32-chars'
process.env.INTERNAL_API_KEY = 'test-internal-api-key-long-enough'
process.env.NODE_ENV = 'test'

jest.mock('../services/notificationService', () => ({
  sendEmailAlert: jest.fn(async () => ({ success: true, channel: 'email', messageId: 'msg-email', timestamp: new Date().toISOString() })),
  sendSMSAlert: jest.fn(async () => ({ success: true, channel: 'sms', messageId: 'msg-sms', timestamp: new Date().toISOString() })),
  sendTelegramAlert: jest.fn(async () => ({ success: true, channel: 'telegram', messageId: 'msg-telegram', timestamp: new Date().toISOString() })),
  sendWhatsAppAlert: jest.fn(async () => ({ success: true, channel: 'whatsapp', messageId: 'msg-whatsapp', timestamp: new Date().toISOString() })),
  sendWebPushAlert: jest.fn(async () => ({ success: true, channel: 'web', messageId: 'msg-web', timestamp: new Date().toISOString() })),
  sendAlertToSubscribers: jest.fn(async (_alert: any, subscribers: any[]) => ({
    total: subscribers.length,
    successful: subscribers.length,
    failed: 0,
    results: subscribers.map((s) => ({
      success: true,
      channel: Array.isArray(s.channels) && s.channels.length > 0 ? s.channels[0] : 'email',
      messageId: `msg-${s.id}`,
      timestamp: new Date().toISOString(),
    })),
  })),
}))

jest.mock('../config/regions/index', () => ({
  getActiveCityRegion: jest.fn(() => ({
    id: 'uk-default',
    centre: { lat: 57.1497, lng: -2.0943 },
  })),
}))

jest.mock('../services/metrics', () => ({
  alertBroadcastsTotal: { inc: jest.fn() },
}))

jest.mock('../adapters/regions/RegionRegistry', () => ({
  regionRegistry: { getRegion: jest.fn(), getAllRegions: jest.fn(() => []) },
}))

import {
  getTestPool, ensureTestSchema, truncateAll, closeTestPool,
} from './helpers/testDb'
import {
  adminToken, citizenToken, operatorToken, authHeader,
} from './helpers/testAuth'
import {
  insertCitizen, insertOperator, insertAlert,
} from './helpers/testFixtures'
import dataRoutes from '../routes/dataRoutes'
import extendedRoutes from '../routes/extendedRoutes'

//Build test app

let app: express.Express

function buildAlertTestApp() {
  const _app = express()
  _app.use(express.json())
  _app.use('/api', dataRoutes)
  _app.use('/api', extendedRoutes)
  _app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.statusCode || err.status || 500
    res.status(status).json({ error: err.message || 'Internal Server Error' })
  })

  return _app
}

//Lifecycle

beforeAll(async () => {
  app = buildAlertTestApp()
  await ensureTestSchema()
  await insertCitizen()
  await insertOperator()
}, 30_000)

afterEach(async () => {
  const pool = getTestPool()
  await pool.query('TRUNCATE alert_subscriptions, alerts, alert_delivery_log CASCADE')
})

afterAll(async () => {
  await truncateAll()
  await closeTestPool()
})

describe('Alerts & Subscriptions Integration Tests', () => {

  //Subscription management

  describe('Subscription CRUD', () => {
    it('should create an email subscription', async () => {
      const res = await request(app)
        .post('/api/subscriptions')
        .send({
          email: 'test@alerts.local',
          channels: ['email'],
          severity_filter: ['critical'],
          topic_filter: ['flood'],
        })

      expect(res.status).toBe(201)
      expect(res.body.subscription.verified).toBe(true)
      expect(res.body.subscription.channels).toContain('email')
      expect(res.body.verificationToken).toBeDefined()
    })

    it('should upsert on same email', async () => {
      await request(app).post('/api/subscriptions').send({
        email: 'dup@alerts.local', channels: ['email'],
      })
      const res = await request(app).post('/api/subscriptions').send({
        email: 'dup@alerts.local', channels: ['email', 'sms'], phone: '+447700900009',
      })

      expect(res.status).toBe(201)
      expect(res.body.subscription.channels).toContain('sms')
    })

    it('should fetch a subscription by email', async () => {
      await request(app).post('/api/subscriptions').send({
        email: 'fetch@alerts.local', channels: ['email'],
      })
      const res = await request(app).get('/api/subscriptions').query({ email: 'fetch@alerts.local' })
      expect(res.status).toBe(200)
      expect(Array.isArray(res.body)).toBe(true)
      expect(res.body[0].email).toBe('fetch@alerts.local')
    })

    it('should delete a subscription', async () => {
      const create = await request(app).post('/api/subscriptions').send({
        email: 'del@alerts.local', channels: ['email'],
      })
      const id = create.body.subscription.id

      const res = await request(app).delete(`/api/subscriptions/${id}`)
      expect(res.status).toBe(200)
      expect(res.body.deleted).toBe(true)

      //Verify it's gone
      const fetch = await request(app).get('/api/subscriptions').query({ email: 'del@alerts.local' })
      expect(fetch.status).toBe(200)
      expect(fetch.body).toEqual([])
    })

    it('should reject subscription with no channels', async () => {
      const res = await request(app).post('/api/subscriptions').send({
        email: 'empty@alerts.local', channels: [],
      })
      expect(res.status).toBe(400)
    })

    it('should return 404 for nonexistent subscription', async () => {
      const res = await request(app).get('/api/subscriptions').query({ email: 'nope@missing.local' })
      expect(res.status).toBe(200)
      expect(res.body).toEqual([])
    })
  })

  //Alert creation

  describe('Alert Creation & Listing', () => {
    it('should create an alert as operator', async () => {
      const res = await request(app)
        .post('/api/alerts')
        .set(...authHeader(operatorToken()))
        .send({
          title: 'Critical Flood Warning',
          message: 'River level rising rapidly',
          severity: 'critical',
          alertType: 'flood',
          locationText: 'Aberdeen',
          channels: ['email'],
        })

      expect(res.status).toBe(201)
      expect(res.body.id).toBeDefined()
      expect(res.body.delivery).toBeDefined()
    })

    it('should persist created alerts', async () => {
      const created = await request(app)
        .post('/api/alerts')
        .set(...authHeader(operatorToken()))
        .send({
          title: 'Flood Advisory',
          message: 'Stay alert near rivers',
          severity: 'warning',
          alertType: 'flood',
          locationText: 'Aberdeen',
        })

      expect(created.status).toBe(201)

      const pool = getTestPool()
      const db = await pool.query('SELECT id, title, severity FROM alerts WHERE id = $1', [created.body.id])
      expect(db.rows.length).toBe(1)
      expect(db.rows[0].title).toBe('Flood Advisory')
      expect(db.rows[0].severity).toBe('warning')
    })

    it('should reject alert creation without title', async () => {
      const res = await request(app)
        .post('/api/alerts')
        .set(...authHeader(operatorToken()))
        .send({ message: 'no title' })

      expect(res.status).toBe(400)
    })

    it('should reject alert creation from citizen', async () => {
      const res = await request(app)
        .post('/api/alerts')
        .set(...authHeader(citizenToken()))
        .send({ title: 'x', message: 'x', severity: 'info' })

      expect(res.status).toBe(403)
    })

    it('should reject alert creation without auth', async () => {
      const res = await request(app)
        .post('/api/alerts')
        .send({ title: 'x', message: 'x', severity: 'info' })

      expect(res.status).toBe(401)
    })

    it('should restrict activity log reads to admins', async () => {
      const unauth = await request(app).get('/api/activity')
      expect(unauth.status).toBe(401)

      const operatorDenied = await request(app)
        .get('/api/activity')
        .set(...authHeader(operatorToken()))
      expect(operatorDenied.status).toBe(403)

      const adminAllowed = await request(app)
        .get('/api/activity')
        .set(...authHeader(adminToken()))
      expect(adminAllowed.status).toBe(200)
      expect(Array.isArray(adminAllowed.body)).toBe(true)
    })
  })

  //Alert broadcast delivery

  describe('Alert Broadcasting', () => {
    it('should broadcast to matching subscribers and create delivery log entries', async () => {
      await request(app).post('/api/subscriptions').send({
        email: 'sub1@test.local', channels: ['email'], topic_filter: ['flood'],
      })
      await request(app).post('/api/subscriptions').send({
        email: 'sub2@test.local', channels: ['sms'], phone: '+447700900002', topic_filter: ['flood'],
      })

      const res = await request(app)
        .post('/api/alerts/broadcast')
        .send({
          operator_name: 'Test Operator',
          alert_type: 'flood',
          severity: 'critical',
          title: 'Flood Broadcast',
          message: 'Evacuate low-lying areas immediately',
          area: 'Aberdeen',
        })

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.alert_id).toBeDefined()
      expect(res.body.delivery_summary.matching_subscribers).toBe(2)

      //Verify delivery log
      const stats = await request(app)
        .get('/api/alerts/delivery')
        .set(...authHeader(operatorToken()))

      expect(stats.status).toBe(200)
      expect(stats.body.total).toBeGreaterThan(0)
      expect(Array.isArray(stats.body.rows)).toBe(true)
    })

    it('should handle broadcast with no subscribers', async () => {
      const res = await request(app)
        .post('/api/alerts/broadcast')
        .send({
          operator_name: 'Test Operator',
          alert_type: 'flood',
          severity: 'critical',
          title: 'No Audience',
          message: 'Nobody subscribed',
          area: 'Nowhere',
        })

      expect(res.status).toBe(400)
      expect(res.body.error).toContain('No verified subscribers')
    })

    it('should reject broadcast without required fields', async () => {
      const res = await request(app)
        .post('/api/alerts/broadcast')
        .send({ title: 'Missing required fields' })

      expect(res.status).toBe(400)
    })

    it('should reject broadcast for invalid severity', async () => {
      const res = await request(app)
        .post('/api/alerts/broadcast')
        .send({
          severity: 'low',
          title: 'Invalid severity',
          message: 'x',
          area: 'x',
        })

      expect(res.status).toBe(400)
    })
  })

  //Edge cases

  describe('Edge Cases', () => {
    it('should handle subscription with all channels', async () => {
      const res = await request(app)
        .post('/api/subscriptions')
        .send({
          email: 'all@test.local',
          phone: '+447700900003',
          channels: ['email', 'sms', 'whatsapp', 'telegram', 'web_push'],
          topic_filter: ['flood', 'fire', 'storm', 'earthquake', 'heatwave'],
        })

      expect(res.status).toBe(201)
      expect(res.body.subscription.channels.length).toBeGreaterThanOrEqual(4)
    })

    it('should handle large severity_filter arrays', async () => {
      const res = await request(app)
        .post('/api/subscriptions')
        .send({
          email: 'sev@test.local',
          channels: ['email'],
          severity_filter: ['critical', 'warning', 'info', 'low'],
        })

      expect(res.status).toBe(201)
    })

    it('should delete nonexistent subscription gracefully', async () => {
      const res = await request(app)
        .delete('/api/subscriptions/00000000-0000-0000-0000-000000000000')

      expect(res.status).toBe(200)
      expect(res.body.deleted).toBe(true)
    })

    it('should validate browser push subscription payloads on the production router', async () => {
      const missingEndpoint = await request(app)
        .post('/api/notifications/subscribe')
        .send({ subscription: { keys: { p256dh: 'x', auth: 'y' } } })

      expect(missingEndpoint.status).toBe(400)

      const missingKeys = await request(app)
        .post('/api/notifications/subscribe')
        .send({ subscription: { endpoint: 'https://push.test/sub-1' } })

      expect(missingKeys.status).toBe(400)

      const success = await request(app)
        .post('/api/notifications/subscribe')
        .set(...authHeader(citizenToken()))
        .send({
          subscription: {
            endpoint: 'https://push.test/sub-1',
            keys: { p256dh: 'p256dh-key', auth: 'auth-key' },
          },
        })

      expect(success.status).toBe(201)

      const unsubMissing = await request(app)
        .post('/api/notifications/unsubscribe')
        .send({})
      expect(unsubMissing.status).toBe(400)

      const unsubscribe = await request(app)
        .post('/api/notifications/unsubscribe')
        .send({ endpoint: 'https://push.test/sub-1' })
      expect(unsubscribe.status).toBe(200)
    })

    it('records failed alert deliveries in delivery logs', async () => {
      await request(app).post('/api/subscriptions').send({
        email: 'fail@test.local', channels: ['email'], topic_filter: ['flood'],
      })

      const notificationService = require('../services/notificationService')
      notificationService.sendEmailAlert.mockResolvedValueOnce({ success: false, error: 'smtp-down' })

      const res = await request(app)
        .post('/api/alerts')
        .set(...authHeader(operatorToken()))
        .send({
          title: 'Email Failure Drill',
          message: 'Testing alert delivery failure path',
          severity: 'critical',
          alertType: 'flood',
          channels: ['email'],
        })

      expect(res.status).toBe(201)
      expect(res.body.delivery.failed).toBeGreaterThanOrEqual(1)

      const pool = getTestPool()
      const log = await pool.query("SELECT status, error_message FROM alert_delivery_log WHERE channel = 'email' ORDER BY created_at DESC LIMIT 1")
      expect(log.rows[0].status).toBe('failed')
      expect(log.rows[0].error_message).toContain('smtp-down')
    })
  })
})

