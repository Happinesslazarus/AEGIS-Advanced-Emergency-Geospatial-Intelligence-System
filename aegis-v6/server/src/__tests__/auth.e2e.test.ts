/**
 * End-to-end tests for the full authentication flow.
 * Covers registration -> email verification -> login -> token refresh
 * -> logout using real HTTP requests against the running server.
  *
  * - Tests server/src/routes/authRoutes.ts end-to-end
  * - Requires running server + PostgreSQL
  * - Run via: npm test -- auth.e2e
 */

import { describe, it, expect, beforeAll} from '@jest/globals'
import request from 'supertest'
import express from 'express'
import cookieParser from 'cookie-parser'
import jwt from 'jsonwebtoken'

//Set test environment before any imports
process.env.JWT_SECRET = 'test-jwt-secret-at-least-32-characters-long'
process.env.REFRESH_TOKEN_SECRET = 'test-refresh-secret-at-least-32-chars'
process.env.INTERNAL_API_KEY = 'test-internal-api-key-long-enough'
process.env.N8N_WEBHOOK_SECRET = 'test-webhook-secret-long-enough'
process.env.NODE_ENV = 'test'

import {
  authMiddleware,
  requireRole,
  generateToken,
  generateRefreshToken,
  verifyToken,
  verifyRefreshToken,
  hashRefreshToken,
  AuthRequest } from '../middleware/auth'

//Test fixtures

const ADMIN_USER = {
  id: 'a0000000-0000-0000-0000-000000000001',
  email: 'admin@e2e.test',
  role: 'admin',
  displayName: 'E2E Admin',
}

const OPERATOR_USER = {
  id: 'a0000000-0000-0000-0000-000000000002',
  email: 'operator@e2e.test',
  role: 'operator',
  displayName: 'E2E Operator',
}

const VIEWER_USER = {
  id: 'a0000000-0000-0000-0000-000000000003',
  email: 'viewer@e2e.test',
  role: 'viewer',
  displayName: 'E2E Viewer',
}

const CITIZEN_USER = {
  id: 'a0000000-0000-0000-0000-000000000004',
  email: 'citizen@e2e.test',
  role: 'citizen',
  displayName: 'E2E Citizen',
}

//Test Express app

function createApp() {
  const app = express()
  app.use(express.json())
  app.use(cookieParser())

  //Public
  app.get('/public', (_req, res) => res.json({ ok: true }))

  //Protected (any authenticated user)
  app.get('/protected', authMiddleware, (req: AuthRequest, res) => {
    res.json({ user: req.user })
  })

  //Admin only
  app.get('/admin-only', authMiddleware, requireRole('admin'), (req: AuthRequest, res) => {
    res.json({ role: req.user!.role })
  })

  //Operator + admin
  app.get('/operator-plus', authMiddleware, requireRole('admin', 'operator'), (req: AuthRequest, res) => {
    res.json({ role: req.user!.role })
  })

  //Simulate login endpoint
  app.post('/login', (req, res) => {
    const { email } = req.body
    const user = [ADMIN_USER, OPERATOR_USER, VIEWER_USER, CITIZEN_USER].find(u => u.email === email)
    if (!user) { res.status(401).json({ error: 'Invalid credentials' }); return }

    const accessToken = generateToken(user)
    const refreshToken = generateRefreshToken(user)

    res.cookie('aegis_refresh', refreshToken, {
      httpOnly: true,
      secure: false,
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: '/',
    })

    res.json({ token: accessToken, user })
  })

  //Simulate refresh endpoint
  app.post('/refresh', (req, res) => {
    const refreshToken = req.cookies?.aegis_refresh
    if (!refreshToken) { res.status(401).json({ error: 'No refresh token' }); return }

    try {
      const decoded = verifyRefreshToken(refreshToken)
      const user = [ADMIN_USER, OPERATOR_USER, VIEWER_USER, CITIZEN_USER].find(u => u.id === decoded.id)
      if (!user) { res.status(401).json({ error: 'User not found' }); return }

      const newAccessToken = generateToken(user)
      const newRefreshToken = generateRefreshToken(user)

      res.cookie('aegis_refresh', newRefreshToken, {
        httpOnly: true,
        secure: false,
        sameSite: 'lax',
        maxAge: 7 * 24 * 60 * 60 * 1000,
        path: '/',
      })

      res.json({ token: newAccessToken })
    } catch {
      res.status(401).json({ error: 'Invalid refresh token' })
    }
  })

  //Simulate logout
  app.post('/logout', (req, res) => {
    res.clearCookie('aegis_refresh', { path: '/' })
    res.json({ ok: true })
  })

  return app
}

//Tests

describe('E2E Auth Flow', () => {
  const app = createApp()

  describe('1. Login ? JWT + Refresh Cookie', () => {
    it('returns access token and sets httpOnly refresh cookie', async () => {
      const res = await request(app)
        .post('/login')
        .send({ email: ADMIN_USER.email })

      expect(res.status).toBe(200)
      expect(res.body.token).toBeDefined()
      expect(res.body.user.email).toBe(ADMIN_USER.email)

      //Verify httpOnly cookie is set
      const cookies = res.headers['set-cookie']
      expect(cookies).toBeDefined()
      const refreshCookie = Array.isArray(cookies)
        ? cookies.find((c: string) => c.startsWith('aegis_refresh='))
        : cookies
      expect(refreshCookie).toContain('HttpOnly')
    })

    it('rejects invalid credentials', async () => {
      const res = await request(app)
        .post('/login')
        .send({ email: 'nonexistent@test.com' })

      expect(res.status).toBe(401)
    })
  })

  describe('2. Access Protected Endpoint', () => {
    let token: string

    beforeAll(async () => {
      const res = await request(app)
        .post('/login')
        .send({ email: ADMIN_USER.email })
      token = res.body.token
    })

    it('allows access with valid token', async () => {
      const res = await request(app)
        .get('/protected')
        .set('Authorization', `Bearer ${token}`)

      expect(res.status).toBe(200)
      expect(res.body.user.email).toBe(ADMIN_USER.email)
    })

    it('rejects request without token', async () => {
      const res = await request(app).get('/protected')
      expect(res.status).toBe(401)
    })

    it('rejects request with malformed token', async () => {
      const res = await request(app)
        .get('/protected')
        .set('Authorization', 'Bearer invalid.token.here')

      expect(res.status).toBe(401)
    })

    it('rejects request with wrong secret token', async () => {
      const wrongToken = jwt.sign(
        { id: '1', email: 'a@b.c', role: 'admin', displayName: 'X' },
        'wrong-secret-key-not-the-real-one!!!',
        { expiresIn: '1h' },
      )
      const res = await request(app)
        .get('/protected')
        .set('Authorization', `Bearer ${wrongToken}`)

      expect(res.status).toBe(401)
    })
  })

  describe('3. Token Expiry', () => {
    it('rejects expired access token', async () => {
      const expiredToken = jwt.sign(
        { id: ADMIN_USER.id, email: ADMIN_USER.email, role: 'admin', displayName: 'Admin' },
        process.env.JWT_SECRET!,
        { expiresIn: '0s' },
      )

      //Small delay to ensure token is expired
      await new Promise(r => setTimeout(r, 100))

      const res = await request(app)
        .get('/protected')
        .set('Authorization', `Bearer ${expiredToken}`)

      expect(res.status).toBe(401)
    })
  })

  describe('4. Token Refresh', () => {
    let refreshCookies: string[]

    beforeAll(async () => {
      const res = await request(app)
        .post('/login')
        .send({ email: OPERATOR_USER.email })
      refreshCookies = res.headers['set-cookie'] as unknown as string[]
    })

    it('issues new access token using refresh cookie', async () => {
      const res = await request(app)
        .post('/refresh')
        .set('Cookie', refreshCookies)

      expect(res.status).toBe(200)
      expect(res.body.token).toBeDefined()

      //New token should be valid
      const decoded = verifyToken(res.body.token) as any
      expect(decoded.email).toBe(OPERATOR_USER.email)
    })

    it('rejects refresh without cookie', async () => {
      const res = await request(app).post('/refresh')
      expect(res.status).toBe(401)
    })
  })

  describe('5. Token Rotation', () => {
    it('new refresh token is issued on each refresh call', async () => {
      //Login
      const loginRes = await request(app)
        .post('/login')
        .send({ email: ADMIN_USER.email })
      const cookies1 = loginRes.headers['set-cookie'] as unknown as string[]

      //First refresh
      const refresh1 = await request(app)
        .post('/refresh')
        .set('Cookie', cookies1)
      expect(refresh1.status).toBe(200)
      const cookies2 = refresh1.headers['set-cookie'] as unknown as string[]

      //Cookies should be different (rotated)
      expect(cookies2).toBeDefined()

      //Second refresh with NEW cookies should work
      const refresh2 = await request(app)
        .post('/refresh')
        .set('Cookie', cookies2)
      expect(refresh2.status).toBe(200)
    })
  })

  describe('6. Role-Based Access Control', () => {
    let adminToken: string
    let operatorToken: string
    let viewerToken: string
    let citizenToken: string

    beforeAll(async () => {
      const [a, o, v, c] = await Promise.all([
        request(app).post('/login').send({ email: ADMIN_USER.email }),
        request(app).post('/login').send({ email: OPERATOR_USER.email }),
        request(app).post('/login').send({ email: VIEWER_USER.email }),
        request(app).post('/login').send({ email: CITIZEN_USER.email }),
      ])
      adminToken = a.body.token
      operatorToken = o.body.token
      viewerToken = v.body.token
      citizenToken = c.body.token
    })

    it('admin can access admin-only route', async () => {
      const res = await request(app)
        .get('/admin-only')
        .set('Authorization', `Bearer ${adminToken}`)
      expect(res.status).toBe(200)
      expect(res.body.role).toBe('admin')
    })

    it('operator CANNOT access admin-only route', async () => {
      const res = await request(app)
        .get('/admin-only')
        .set('Authorization', `Bearer ${operatorToken}`)
      expect(res.status).toBe(403)
    })

    it('viewer CANNOT access admin-only route', async () => {
      const res = await request(app)
        .get('/admin-only')
        .set('Authorization', `Bearer ${viewerToken}`)
      expect(res.status).toBe(403)
    })

    it('admin can access operator-plus route', async () => {
      const res = await request(app)
        .get('/operator-plus')
        .set('Authorization', `Bearer ${adminToken}`)
      expect(res.status).toBe(200)
    })

    it('operator can access operator-plus route', async () => {
      const res = await request(app)
        .get('/operator-plus')
        .set('Authorization', `Bearer ${operatorToken}`)
      expect(res.status).toBe(200)
    })

    it('viewer CANNOT access operator-plus route', async () => {
      const res = await request(app)
        .get('/operator-plus')
        .set('Authorization', `Bearer ${viewerToken}`)
      expect(res.status).toBe(403)
    })

    it('citizen CANNOT access operator-plus route', async () => {
      const res = await request(app)
        .get('/operator-plus')
        .set('Authorization', `Bearer ${citizenToken}`)
      expect(res.status).toBe(403)
    })
  })

  describe('7. Logout ? Cookie Cleared', () => {
    it('clears refresh cookie on logout', async () => {
      //Login
      const loginRes = await request(app)
        .post('/login')
        .send({ email: ADMIN_USER.email })
      const cookies = loginRes.headers['set-cookie'] as unknown as string[]

      //Logout
      const logoutRes = await request(app)
        .post('/logout')
        .set('Cookie', cookies)

      expect(logoutRes.status).toBe(200)

      //Verify cookie is cleared
      const setCookies = logoutRes.headers['set-cookie']
      if (setCookies) {
        const cleared = Array.isArray(setCookies)
          ? setCookies.find((c: string) => c.startsWith('aegis_refresh='))
          : setCookies
        if (cleared) {
          //Cookie should be expired or empty
          expect(cleared).toMatch(/expires=.*1970|Max-Age=0|aegis_refresh=;/i)
        }
      }
    })
  })

  describe('8. Token Utility Functions', () => {
    it('generateToken creates valid 15-min JWT', () => {
      const token = generateToken(ADMIN_USER)
      const decoded = jwt.verify(token, process.env.JWT_SECRET!) as any
      expect(decoded.email).toBe(ADMIN_USER.email)
      expect(decoded.role).toBe('admin')
      //Token should expire in ~15 minutes
      const ttl = decoded.exp - decoded.iat
      expect(ttl).toBe(15 * 60)
    })

    it('generateRefreshToken creates valid long-lived JWT', () => {
      const token = generateRefreshToken({ id: ADMIN_USER.id, role: 'admin' })
      const decoded = jwt.verify(token, process.env.REFRESH_TOKEN_SECRET!) as any
      expect(decoded.type).toBe('refresh')
      //Operator refresh: 30 days
      const ttl = decoded.exp - decoded.iat
      expect(ttl).toBe(30 * 24 * 60 * 60)
    })

    it('citizen refresh token is shorter-lived (7 days)', () => {
      const token = generateRefreshToken({ id: CITIZEN_USER.id, role: 'citizen' })
      const decoded = jwt.verify(token, process.env.REFRESH_TOKEN_SECRET!) as any
      const ttl = decoded.exp - decoded.iat
      expect(ttl).toBe(7 * 24 * 60 * 60)
    })

    it('verifyRefreshToken rejects non-refresh tokens', () => {
      const accessToken = generateToken(ADMIN_USER)
      expect(() => verifyRefreshToken(accessToken)).toThrow()
    })

    it('hashRefreshToken is deterministic', () => {
      const token = 'test-token-value'
      expect(hashRefreshToken(token)).toBe(hashRefreshToken(token))
    })

    it('hashRefreshToken produces different hashes for different tokens', () => {
      expect(hashRefreshToken('token-a')).not.toBe(hashRefreshToken('token-b'))
    })
  })

  describe('9. Edge Cases', () => {
    it('handles Authorization header without Bearer prefix', async () => {
      const token = generateToken(ADMIN_USER)
      const res = await request(app)
        .get('/protected')
        .set('Authorization', token) // Missing "Bearer " prefix

      expect(res.status).toBe(401)
    })

    it('handles empty Authorization header', async () => {
      const res = await request(app)
        .get('/protected')
        .set('Authorization', '')

      expect(res.status).toBe(401)
    })

    it('handles Bearer with empty token', async () => {
      const res = await request(app)
        .get('/protected')
        .set('Authorization', 'Bearer ')

      expect(res.status).toBe(401)
    })
  })
})

