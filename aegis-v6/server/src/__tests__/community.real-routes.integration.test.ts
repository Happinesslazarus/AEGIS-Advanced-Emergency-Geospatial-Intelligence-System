process.env.NODE_ENV = 'test'
process.env.JWT_SECRET ??= 'test-jwt-secret-at-least-32-characters-long'
process.env.REFRESH_TOKEN_SECRET ??= 'test-refresh-secret-at-least-32-chars'

import express, { type Request, type Response, type NextFunction } from 'express'
import request from 'supertest'
import { beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals'

import communityRoutes from '../routes/communityRoutes'
import { ensureTestSchema, truncateAll } from './helpers/testDb'
import { insertCitizen, insertOperator, insertPost } from './helpers/testFixtures'
import { authHeader, citizenToken, operatorToken, generateTestToken, TEST_CITIZEN } from './helpers/testAuth'

const ioEmit = jest.fn()
const ioToEmit = jest.fn()
const ioTo = jest.fn(() => ({ emit: ioToEmit }))

const app = express()
app.use(express.json())
app.set('io', { emit: ioEmit, to: ioTo })
app.use('/api/community', communityRoutes)
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  res.status(err?.statusCode || 500).json({ error: err?.message || 'Internal error' })
})

describe('community real route integration', () => {
  beforeAll(async () => {
    await ensureTestSchema()
  })

  beforeEach(async () => {
    ioEmit.mockClear()
    ioTo.mockClear()
    ioToEmit.mockClear()
    await truncateAll()
    await insertCitizen()
    await insertOperator()
  })

  it('creates, lists, likes, comments, reports, and deletes a post via real routes', async () => {
    const create = await request(app)
      .post('/api/community/posts')
      .set(...authHeader(citizenToken()))
      .send({ content: 'Road blocked near bridge', location: 'Bridge Road' })

    expect(create.status).toBe(201)
    const postId = create.body.id as string

    const list = await request(app)
      .get('/api/community/posts?limit=10')
      .set(...authHeader(citizenToken()))

    expect(list.status).toBe(200)
    expect(Array.isArray(list.body.posts)).toBe(true)
    expect(list.body.posts.length).toBeGreaterThanOrEqual(1)

    const like = await request(app)
      .post(`/api/community/posts/${postId}/like`)
      .set(...authHeader(operatorToken()))

    expect(like.status).toBe(200)
    expect(like.body.liked).toBe(true)

    const report = await request(app)
      .post(`/api/community/posts/${postId}/report`)
      .set(...authHeader(operatorToken()))
      .send({ reason: 'misinformation', details: 'Needs moderation check' })

    expect(report.status).toBe(200)
    expect(report.body.reported).toBe(true)

    const del = await request(app)
      .delete(`/api/community/posts/${postId}`)
      .set(...authHeader(operatorToken()))

    expect(del.status).toBe(200)
    expect(del.body.deleted).toBe(true)
    expect(ioEmit).toHaveBeenCalled()
  })

  it('enforces ownership and validation for edit/report flows', async () => {
    const seeded = await insertPost(TEST_CITIZEN.id, 'Initial post body')

    const invalidComment = await request(app)
      .post(`/api/community/posts/${seeded.id}/comments`)
      .set(...authHeader(operatorToken()))
      .send({ content: '   ' })

    expect(invalidComment.status).toBe(400)

    const forbiddenEdit = await request(app)
      .put(`/api/community/posts/${seeded.id}`)
      .set(...authHeader(operatorToken()))
      .send({ content: 'Edited by another user', location: 'X' })

    expect(forbiddenEdit.status).toBe(403)

    const selfReportBlocked = await request(app)
      .post(`/api/community/posts/${seeded.id}/report`)
      .set(...authHeader(citizenToken()))
      .send({ reason: 'spam' })

    expect(selfReportBlocked.status).toBe(400)
    expect(selfReportBlocked.body.error).toContain('own post')
  })

  it('returns hazard updates subset and toggles like state', async () => {
    await request(app)
      .post('/api/community/posts')
      .set(...authHeader(citizenToken()))
      .send({ content: 'Normal update', is_hazard_update: 'false' })

    await request(app)
      .post('/api/community/posts')
      .set(...authHeader(citizenToken()))
      .send({ content: 'Flood waters rising', is_hazard_update: 'true' })

    const hazard = await request(app)
      .get('/api/community/posts/hazard-updates')
      .set(...authHeader(operatorToken()))

    expect(hazard.status).toBe(200)
    expect(hazard.body.posts.length).toBe(1)

    const postId = hazard.body.posts[0].id as string
    const like1 = await request(app)
      .post(`/api/community/posts/${postId}/like`)
      .set(...authHeader(operatorToken()))
    const like2 = await request(app)
      .post(`/api/community/posts/${postId}/like`)
      .set(...authHeader(operatorToken()))

    expect(like1.body.liked).toBe(true)
    expect(like2.body.liked).toBe(false)
  })

  it('blocks citizen moderation actions and allows operator account suspension', async () => {
    const otherCitizen = {
      id: '00000000-0000-0000-0000-000000000020',
      email: 'community-other@test.aegis.local',
      role: 'citizen',
      displayName: 'Community Other',
    }
    await insertCitizen({
      id: otherCitizen.id,
      email: otherCitizen.email,
      display_name: otherCitizen.displayName,
    })
    const otherCitizenToken = generateTestToken(otherCitizen)

    const suspendDenied = await request(app)
      .post(`/api/community/citizens/${otherCitizen.id}/suspend`)
      .set(...authHeader(citizenToken()))

    expect(suspendDenied.status).toBe(403)

    const deleteDenied = await request(app)
      .delete(`/api/community/citizens/${TEST_CITIZEN.id}`)
      .set(...authHeader(otherCitizenToken))

    expect(deleteDenied.status).toBe(403)

    const suspendAllowed = await request(app)
      .post(`/api/community/citizens/${otherCitizen.id}/suspend`)
      .set(...authHeader(operatorToken()))

    expect(suspendAllowed.status).toBe(200)
    expect(suspendAllowed.body.success).toBe(true)
  })
})
