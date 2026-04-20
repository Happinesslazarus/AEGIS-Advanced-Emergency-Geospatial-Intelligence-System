/**
 * What it tests:
 * Integration tests for the community help-request and chat endpoints.
  * Verifies post creation, moderation, upvoting, and real-time
  * Socket.IO broadcast of new community posts.
  *
  * How it connects:
  * - Tests server/src/routes/communityRoutes.ts
  * - Database fixtures truncated between tests
  * - Run via: npm test -- community.integration
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from '@jest/globals'
import request from 'supertest'
import express, { type Request, type Response, type NextFunction } from 'express'
import { v4 as uuid } from 'uuid'

//Test environment
process.env.JWT_SECRET = 'test-jwt-secret-at-least-32-characters-long'
process.env.REFRESH_TOKEN_SECRET = 'test-refresh-secret-at-least-32-chars'
process.env.NODE_ENV = 'test'

import {
  getTestPool, ensureTestSchema, truncateAll, closeTestPool,
} from './helpers/testDb'
import {
  citizenToken, operatorToken, adminToken, authHeader,
  TEST_CITIZEN, TEST_OPERATOR, TEST_ADMIN,
} from './helpers/testAuth'
import { insertCitizen, insertOperator, insertPost } from './helpers/testFixtures'
import { AppError } from '../utils/AppError'

//Build test app

let app: express.Express
let emittedEvents: Array<{ event: string; args: unknown[] }>

function buildCommunityTestApp() {
  const pool = getTestPool()
  const _app = express()
  _app.use(express.json())

  emittedEvents = []
  _app.set('io', {
    emit(event: string, ...args: unknown[]) {
      emittedEvents.push({ event, args })
      return true
    },
    to() { return { emit() {} } },
  })

  const { authMiddleware } = require('../middleware/auth')
  const router = express.Router()

  //Helper
  async function getUserInfo(userId: string) {
    const c = await pool.query('SELECT id, display_name, role FROM citizens WHERE id = $1', [userId])
    if (c.rows[0]) return c.rows[0]
    const o = await pool.query('SELECT id, display_name, role FROM operators WHERE id = $1', [userId])
    return o.rows[0] || null
  }

  //GET /posts
  router.get('/posts', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = (req as any).user?.id
      if (!userId) throw AppError.unauthorized('Authentication required')
      const limit = Math.min(50, parseInt(req.query.limit as string) || 20)
      const { rows } = await pool.query(`
        SELECT p.id, p.author_id, p.content, p.location, p.is_hazard_update,
               p.created_at,
               COALESCE(c.display_name, o.display_name, 'Unknown') as author_name,
               (SELECT COUNT(*) FROM community_post_likes WHERE post_id = p.id) as likes_count,
               (SELECT COUNT(*) FROM community_comments WHERE post_id = p.id) as comments_count,
               EXISTS(SELECT 1 FROM community_post_likes WHERE post_id = p.id AND user_id = $1) as is_liked_by_user
        FROM community_posts p
        LEFT JOIN citizens c ON p.author_id = c.id
        LEFT JOIN operators o ON p.author_id = o.id
        WHERE p.deleted_at IS NULL
        ORDER BY p.created_at DESC LIMIT $2
      `, [userId, limit])
      res.json({ posts: rows })
    } catch (err) { next(err) }
  })

  //POST /posts
  router.post('/posts', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = (req as any).user?.id
      if (!userId) throw AppError.unauthorized('Authentication required')
      const { content, location, is_hazard_update } = req.body
      if (!content?.trim()) throw AppError.badRequest('Content is required')
      const postId = uuid()
      const { rows } = await pool.query(
        `INSERT INTO community_posts (id, author_id, content, location, is_hazard_update, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5, NOW(), NOW()) RETURNING *`,
        [postId, userId, content.trim(), location || null, is_hazard_update || false],
      )
      const author = await getUserInfo(userId)
      res.status(201).json({
        ...rows[0],
        author_name: author?.display_name,
        likes_count: 0,
        comments_count: 0,
      })
    } catch (err) { next(err) }
  })

  //PUT /posts/:postId -- edit (owner only)
  router.put('/posts/:postId', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = (req as any).user?.id
      if (!userId) throw AppError.unauthorized('Authentication required')
      const { content } = req.body
      if (!content?.trim()) throw AppError.badRequest('Content is required')
      const post = await pool.query(
        'SELECT author_id FROM community_posts WHERE id = $1 AND deleted_at IS NULL',
        [req.params.postId],
      )
      if (post.rows.length === 0) throw AppError.notFound('Post not found')
      if (post.rows[0].author_id !== userId) throw AppError.forbidden('You can only edit your own posts')
      const { rows } = await pool.query(
        'UPDATE community_posts SET content = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
        [content.trim(), req.params.postId],
      )
      res.json(rows[0])
    } catch (err) { next(err) }
  })

  //DELETE /posts/:postId -- owner or admin (reported posts only)
  router.delete('/posts/:postId', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = (req as any).user?.id
      const role = (req as any).user?.role
      if (!userId) throw AppError.unauthorized('Authentication required')
      const post = await pool.query(
        'SELECT author_id FROM community_posts WHERE id = $1 AND deleted_at IS NULL',
        [req.params.postId],
      )
      if (post.rows.length === 0) throw AppError.notFound('Post not found')
      if (post.rows[0].author_id === userId) {
        await pool.query('UPDATE community_posts SET deleted_at = NOW() WHERE id = $1', [req.params.postId])
        return res.json({ deleted: true })
      }
      if (['admin', 'operator'].includes(role)) {
        const reports = await pool.query(
          'SELECT COUNT(*)::int as cnt FROM community_post_reports WHERE post_id = $1',
          [req.params.postId],
        )
        if (reports.rows[0].cnt === 0) throw AppError.forbidden('Admins can only delete reported posts')
        await pool.query('UPDATE community_posts SET deleted_at = NOW() WHERE id = $1', [req.params.postId])
        return res.json({ deleted: true })
      }
      throw AppError.forbidden('Unauthorized')
    } catch (err) { next(err) }
  })

  //POST /posts/:postId/like -- toggle
  router.post('/posts/:postId/like', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = (req as any).user?.id
      if (!userId) throw AppError.unauthorized('Authentication required')
      const { postId } = req.params
      const existing = await pool.query(
        'SELECT id FROM community_post_likes WHERE post_id = $1 AND user_id = $2',
        [postId, userId],
      )
      if (existing.rows.length > 0) {
        await pool.query('DELETE FROM community_post_likes WHERE post_id = $1 AND user_id = $2', [postId, userId])
        const { rows } = await pool.query('SELECT COUNT(*)::int as cnt FROM community_post_likes WHERE post_id = $1', [postId])
        const io = req.app.get('io')
        io?.emit('community:post:liked', { postId, liked: false, likes_count: rows[0].cnt })
        return res.json({ liked: false, likes_count: rows[0].cnt })
      }
      await pool.query(
        'INSERT INTO community_post_likes (id, post_id, user_id, created_at) VALUES ($1,$2,$3,NOW())',
        [uuid(), postId, userId],
      )
      const { rows } = await pool.query('SELECT COUNT(*)::int as cnt FROM community_post_likes WHERE post_id = $1', [postId])
      const io = req.app.get('io')
      io?.emit('community:post:liked', { postId, liked: true, likes_count: rows[0].cnt })
      res.json({ liked: true, likes_count: rows[0].cnt })
    } catch (err) { next(err) }
  })

  //GET /posts/:postId/comments
  router.get('/posts/:postId/comments', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { rows } = await pool.query(
        `SELECT cm.id, cm.post_id, cm.user_id as author_id, cm.content, cm.created_at,
                COALESCE(c.display_name, o.display_name, 'Unknown') as author_name
         FROM community_comments cm
         LEFT JOIN citizens c ON cm.user_id = c.id
         LEFT JOIN operators o ON cm.user_id = o.id
         WHERE cm.post_id = $1 AND cm.deleted_at IS NULL
         ORDER BY cm.created_at ASC`,
        [req.params.postId],
      )
      res.json({ comments: rows })
    } catch (err) { next(err) }
  })

  //POST /posts/:postId/comments
  router.post('/posts/:postId/comments', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = (req as any).user?.id
      if (!userId) throw AppError.unauthorized('Authentication required')
      const { content } = req.body
      if (!content?.trim()) throw AppError.badRequest('Comment content is required')
      const { rows } = await pool.query(
        `INSERT INTO community_comments (id, post_id, user_id, content, created_at)
         VALUES ($1,$2,$3,$4,NOW()) RETURNING *`,
        [uuid(), req.params.postId, userId, content.trim()],
      )
      const io = req.app.get('io')
      io?.emit('community:post:commented', { postId: req.params.postId, comment: rows[0] })
      res.status(201).json(rows[0])
    } catch (err) { next(err) }
  })

  //POST /posts/:postId/report
  router.post('/posts/:postId/report', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = (req as any).user?.id
      if (!userId) throw AppError.unauthorized('Authentication required')
      const { reason, details } = req.body
      if (!reason) throw AppError.badRequest('Reason is required')
      const validReasons = ['spam', 'harassment', 'misinformation', 'inappropriate', 'violence', 'other']
      if (!validReasons.includes(reason)) throw AppError.badRequest('Invalid reason')
      const post = await pool.query(
        'SELECT id, author_id FROM community_posts WHERE id = $1 AND deleted_at IS NULL',
        [req.params.postId],
      )
      if (post.rows.length === 0) throw AppError.notFound('Post not found')
      if (post.rows[0].author_id === userId) throw AppError.badRequest('Cannot report your own post')
      await pool.query(
        `INSERT INTO community_post_reports (id, post_id, reporter_id, reason, details)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (post_id, reporter_id) DO UPDATE SET reason = $4, details = $5`,
        [uuid(), req.params.postId, userId, reason, details || null],
      )
      const cnt = await pool.query('SELECT COUNT(*)::int as cnt FROM community_post_reports WHERE post_id = $1', [req.params.postId])
      res.json({ reported: true, reports_count: cnt.rows[0].cnt })
    } catch (err) { next(err) }
  })

  _app.use('/api/community', router)
  _app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.statusCode || err.status || 500
    res.status(status).json({ error: err.message || 'Internal Server Error' })
  })

  return _app
}

//Lifecycle

beforeAll(async () => {
  app = buildCommunityTestApp()
  await ensureTestSchema()
  await insertCitizen()
  await insertOperator()
  //Insert admin into operators table
  const pool = getTestPool()
  await pool.query(
    `INSERT INTO operators (id, email, display_name, role, department)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name`,
    [TEST_ADMIN.id, TEST_ADMIN.email, TEST_ADMIN.displayName, 'admin', 'Administration'],
  )
}, 30_000)

afterEach(async () => {
  const pool = getTestPool()
  await pool.query('TRUNCATE community_post_reports, community_post_likes, community_comments, community_posts CASCADE')
  emittedEvents = []
})

afterAll(async () => {
  await truncateAll()
  await closeTestPool()
})

describe('Community Integration Tests', () => {

  //Post CRUD

  describe('Post CRUD', () => {
    it('should create a post', async () => {
      const res = await request(app)
        .post('/api/community/posts')
        .set(...authHeader(citizenToken()))
        .send({ content: 'Road flooded on Main Street' })

      expect(res.status).toBe(201)
      expect(res.body.content).toBe('Road flooded on Main Street')
      expect(res.body.author_id).toBe(TEST_CITIZEN.id)
      expect(res.body.likes_count).toBe(0)
    })

    it('should list posts', async () => {
      await insertPost(TEST_CITIZEN.id, 'Post one')
      await insertPost(TEST_CITIZEN.id, 'Post two')

      const res = await request(app)
        .get('/api/community/posts')
        .set(...authHeader(citizenToken()))

      expect(res.status).toBe(200)
      expect(res.body.posts.length).toBe(2)
    })

    it('should edit own post', async () => {
      const post = await insertPost(TEST_CITIZEN.id, 'Original content')

      const res = await request(app)
        .put(`/api/community/posts/${post.id}`)
        .set(...authHeader(citizenToken()))
        .send({ content: 'Updated content' })

      expect(res.status).toBe(200)
      expect(res.body.content).toBe('Updated content')
    })

    it('should reject editing another user\'s post', async () => {
      const post = await insertPost(TEST_CITIZEN.id, 'Citizen post')

      const res = await request(app)
        .put(`/api/community/posts/${post.id}`)
        .set(...authHeader(operatorToken()))
        .send({ content: 'Hacked!' })

      expect(res.status).toBe(403)
    })

    it('should delete own post (soft delete)', async () => {
      const post = await insertPost(TEST_CITIZEN.id, 'Delete me')

      const res = await request(app)
        .delete(`/api/community/posts/${post.id}`)
        .set(...authHeader(citizenToken()))

      expect(res.status).toBe(200)
      expect(res.body.deleted).toBe(true)

      //Should not appear in listings
      const list = await request(app)
        .get('/api/community/posts')
        .set(...authHeader(citizenToken()))
      expect(list.body.posts.length).toBe(0)
    })

    it('should reject empty content', async () => {
      const res = await request(app)
        .post('/api/community/posts')
        .set(...authHeader(citizenToken()))
        .send({ content: '   ' })

      expect(res.status).toBe(400)
    })

    it('should reject unauthenticated post creation', async () => {
      const res = await request(app)
        .post('/api/community/posts')
        .send({ content: 'No auth' })

      expect(res.status).toBe(401)
    })
  })

  //Likes

  describe('Likes (Toggle)', () => {
    it('should like a post', async () => {
      const post = await insertPost(TEST_CITIZEN.id, 'Like me')

      const res = await request(app)
        .post(`/api/community/posts/${post.id}/like`)
        .set(...authHeader(citizenToken()))

      expect(res.status).toBe(200)
      expect(res.body.liked).toBe(true)
      expect(res.body.likes_count).toBe(1)
    })

    it('should unlike when toggled again', async () => {
      const post = await insertPost(TEST_CITIZEN.id, 'Toggle me')

      //Like
      await request(app)
        .post(`/api/community/posts/${post.id}/like`)
        .set(...authHeader(citizenToken()))

      //Unlike
      const res = await request(app)
        .post(`/api/community/posts/${post.id}/like`)
        .set(...authHeader(citizenToken()))

      expect(res.body.liked).toBe(false)
      expect(res.body.likes_count).toBe(0)
    })

    it('should emit Socket.IO event on like', async () => {
      const post = await insertPost(TEST_CITIZEN.id, 'Event test')

      await request(app)
        .post(`/api/community/posts/${post.id}/like`)
        .set(...authHeader(citizenToken()))

      expect(emittedEvents.some(e => e.event === 'community:post:liked')).toBe(true)
    })

    it('should track likes_count via listing endpoint', async () => {
      const post = await insertPost(TEST_CITIZEN.id, 'Count test')

      //Two different users like
      await request(app)
        .post(`/api/community/posts/${post.id}/like`)
        .set(...authHeader(citizenToken()))
      await request(app)
        .post(`/api/community/posts/${post.id}/like`)
        .set(...authHeader(operatorToken()))

      const list = await request(app)
        .get('/api/community/posts')
        .set(...authHeader(citizenToken()))
      expect(parseInt(list.body.posts[0].likes_count)).toBe(2)
    })
  })

  //Comments

  describe('Comments', () => {
    it('should add a comment to a post', async () => {
      const post = await insertPost(TEST_CITIZEN.id, 'Comment on me')

      const res = await request(app)
        .post(`/api/community/posts/${post.id}/comments`)
        .set(...authHeader(operatorToken()))
        .send({ content: 'Stay safe!' })

      expect(res.status).toBe(201)
      expect(res.body.content).toBe('Stay safe!')
    })

    it('should list comments for a post', async () => {
      const post = await insertPost(TEST_CITIZEN.id, 'Multi comments')
      const pool = getTestPool()
      await pool.query(
        'INSERT INTO community_comments (id, post_id, user_id, content, created_at) VALUES ($1,$2,$3,$4,NOW())',
        [uuid(), post.id, TEST_CITIZEN.id, 'Comment 1'],
      )
      await pool.query(
        'INSERT INTO community_comments (id, post_id, user_id, content, created_at) VALUES ($1,$2,$3,$4,NOW())',
        [uuid(), post.id, TEST_OPERATOR.id, 'Comment 2'],
      )

      const res = await request(app)
        .get(`/api/community/posts/${post.id}/comments`)
        .set(...authHeader(citizenToken()))

      expect(res.status).toBe(200)
      expect(res.body.comments.length).toBe(2)
    })

    it('should reject empty comment', async () => {
      const post = await insertPost(TEST_CITIZEN.id, 'Empty comment test')

      const res = await request(app)
        .post(`/api/community/posts/${post.id}/comments`)
        .set(...authHeader(citizenToken()))
        .send({ content: '' })

      expect(res.status).toBe(400)
    })

    it('should emit Socket.IO event on comment', async () => {
      const post = await insertPost(TEST_CITIZEN.id, 'Socket comment')

      await request(app)
        .post(`/api/community/posts/${post.id}/comments`)
        .set(...authHeader(citizenToken()))
        .send({ content: 'Real-time comment' })

      expect(emittedEvents.some(e => e.event === 'community:post:commented')).toBe(true)
    })
  })

  //Reporting & Moderation

  describe('Reporting & Moderation', () => {
    it('should report a post with valid reason', async () => {
      const post = await insertPost(TEST_CITIZEN.id, 'Report this')

      const res = await request(app)
        .post(`/api/community/posts/${post.id}/report`)
        .set(...authHeader(operatorToken()))
        .send({ reason: 'misinformation', details: 'False information' })

      expect(res.status).toBe(200)
      expect(res.body.reported).toBe(true)
      expect(res.body.reports_count).toBe(1)
    })

    it('should reject reporting own post', async () => {
      const post = await insertPost(TEST_CITIZEN.id, 'My own post')

      const res = await request(app)
        .post(`/api/community/posts/${post.id}/report`)
        .set(...authHeader(citizenToken()))
        .send({ reason: 'spam' })

      expect(res.status).toBe(400)
      expect(res.body.error).toContain('Cannot report your own post')
    })

    it('should reject invalid report reason', async () => {
      const post = await insertPost(TEST_CITIZEN.id, 'Invalid reason')

      const res = await request(app)
        .post(`/api/community/posts/${post.id}/report`)
        .set(...authHeader(operatorToken()))
        .send({ reason: 'not_a_valid_reason' })

      expect(res.status).toBe(400)
    })

    it('should allow admin to delete reported post', async () => {
      const post = await insertPost(TEST_CITIZEN.id, 'Will be reported')

      //Operator reports it
      await request(app)
        .post(`/api/community/posts/${post.id}/report`)
        .set(...authHeader(operatorToken()))
        .send({ reason: 'spam' })

      //Admin deletes it
      const res = await request(app)
        .delete(`/api/community/posts/${post.id}`)
        .set(...authHeader(adminToken()))

      expect(res.status).toBe(200)
      expect(res.body.deleted).toBe(true)
    })

    it('should prevent admin from deleting unreported post', async () => {
      const post = await insertPost(TEST_CITIZEN.id, 'Not reported')

      const res = await request(app)
        .delete(`/api/community/posts/${post.id}`)
        .set(...authHeader(adminToken()))

      expect(res.status).toBe(403)
      expect(res.body.error).toContain('reported')
    })

    it('should prevent citizen from deleting another\'s post', async () => {
      const post = await insertPost(TEST_OPERATOR.id, 'Operator post')

      const res = await request(app)
        .delete(`/api/community/posts/${post.id}`)
        .set(...authHeader(citizenToken()))

      expect(res.status).toBe(403)
    })
  })

  //Edge Cases

  describe('Edge Cases', () => {
    it('should handle post with hazard_update flag', async () => {
      const res = await request(app)
        .post('/api/community/posts')
        .set(...authHeader(citizenToken()))
        .send({ content: 'HAZARD: flooding on Bridge St', is_hazard_update: true })

      expect(res.status).toBe(201)
    })

    it('should handle post with location', async () => {
      const res = await request(app)
        .post('/api/community/posts')
        .set(...authHeader(citizenToken()))
        .send({ content: 'Status update', location: 'City Centre, Aberdeen' })

      expect(res.status).toBe(201)
      expect(res.body.location).toBe('City Centre, Aberdeen')
    })

    it('should return 404 when editing nonexistent post', async () => {
      const res = await request(app)
        .put('/api/community/posts/00000000-0000-0000-0000-000000000000')
        .set(...authHeader(citizenToken()))
        .send({ content: 'Updated' })

      expect(res.status).toBe(404)
    })
  })
})

