/*
 * communityRoutes.ts — Community Chat and Post Sharing
 *
 * Endpoints for community posts, comments, likes, and hazard updates
 * Allows citizens to share information, photos, and status updates
 */

import express, { Request, Response } from 'express'
import pool from '../models/db.js'
import { v4 as uuid } from 'uuid'
import multer from 'multer'
import path from 'path'
import fs from 'fs'
import { authMiddleware, AuthRequest } from '../middleware/auth.js'
import { validateMagicBytes } from '../middleware/upload.js'

const router = express.Router()

// ─── File Upload Configuration ───────────────────────────────────────────────
const uploadsDir = path.join(process.cwd(), 'uploads', 'community')
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true })
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir)
  },
  filename: (req, file, cb) => {
    const timestamp = Date.now()
    const random = Math.random().toString(36).substring(2, 8)
    cb(null, `${timestamp}-${random}${path.extname(file.originalname)}`)
  },
})

const fileFilter = (req: any, file: Express.Multer.File, cb: any) => {
  if (!file.mimetype.startsWith('image/')) {
    return cb(new Error('Only image files are allowed'), false)
  }
  cb(null, true)
}

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
})

// ─── Helper: Get User Info ───────────────────────────────────────────────────
async function getUserInfo(userId: string) {
  // Check citizens table first
  const citizenResult = await pool.query(
    'SELECT id, email, display_name, avatar_url, role FROM citizens WHERE id = $1',
    [userId]
  )
  if (citizenResult.rows[0]) return citizenResult.rows[0]
  // Fall back to operators table
  const operatorResult = await pool.query(
    'SELECT id, email, display_name, avatar_url, role FROM operators WHERE id = $1',
    [userId]
  )
  return operatorResult.rows[0] || null
}

// ─── GET /posts/hazard-updates — Hazard-flagged posts only (M6) ──────────────
router.get('/posts/hazard-updates', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id
    if (!userId) return res.status(401).json({ error: 'Authentication required' })
    const limit = Math.min(50, parseInt(req.query.limit as string) || 20)
    const result = await pool.query(`
      SELECT
        p.id, p.author_id, p.content, p.image_url, p.location, p.is_hazard_update,
        p.created_at, p.updated_at,
        COALESCE(c.display_name, o.display_name, 'Unknown') as author_name,
        COALESCE(c.role::text, o.role::text, 'citizen') as author_role,
        COALESCE(c.avatar_url, o.avatar_url) as author_avatar,
        (SELECT COUNT(*) FROM community_post_likes WHERE post_id = p.id) as likes_count,
        (SELECT COUNT(*) FROM community_comments WHERE post_id = p.id) as comments_count,
        EXISTS(SELECT 1 FROM community_post_likes WHERE post_id = p.id AND user_id = $1) as is_liked_by_user
      FROM community_posts p
      LEFT JOIN citizens c ON p.author_id = c.id
      LEFT JOIN operators o ON p.author_id = o.id
      WHERE p.deleted_at IS NULL AND p.is_hazard_update = true
      GROUP BY p.id, c.id, o.id
      ORDER BY p.created_at DESC
      LIMIT $2
    `, [userId, limit])
    res.json({ posts: result.rows })
  } catch (err: any) {
    console.error('[Community] GET /posts/hazard-updates error:', err.message)
    res.status(500).json({ error: 'Failed to fetch hazard updates' })
  }
})

// ─── GET /posts — List all community posts with cursor pagination (M4) ────────
router.get('/posts', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id
    if (!userId) return res.status(401).json({ error: 'Authentication required' })

    const limit = Math.min(50, parseInt(req.query.limit as string) || 20)
    const before = req.query.before as string | undefined

    const params: any[] = [userId]
    let cursorClause = ''
    if (before) {
      params.push(before)
      cursorClause = `AND p.created_at < $${params.length}`
    }
    params.push(limit + 1) // fetch one extra to check hasMore

    const result = await pool.query(`
      SELECT
        p.id, p.author_id, p.content, p.image_url, p.location, p.is_hazard_update,
        p.created_at, p.updated_at,
        COALESCE(c.display_name, o.display_name, 'Unknown') as author_name,
        COALESCE(c.role::text, o.role::text, 'citizen') as author_role,
        COALESCE(c.avatar_url, o.avatar_url) as author_avatar,
        (SELECT COUNT(*) FROM community_post_likes WHERE post_id = p.id) as likes_count,
        (SELECT COUNT(*) FROM community_comments WHERE post_id = p.id) as comments_count,
        (SELECT COUNT(*) FROM community_post_shares WHERE post_id = p.id) as shares_count,
        EXISTS(SELECT 1 FROM community_post_likes WHERE post_id = p.id AND user_id = $1) as is_liked_by_user,
        (SELECT COUNT(*) FROM community_post_reports WHERE post_id = p.id) as reports_count,
        EXISTS(SELECT 1 FROM community_post_reports WHERE post_id = p.id AND reporter_id = $1) as is_reported_by_user
      FROM community_posts p
      LEFT JOIN citizens c ON p.author_id = c.id
      LEFT JOIN operators o ON p.author_id = o.id
      WHERE p.deleted_at IS NULL ${cursorClause}
      GROUP BY p.id, c.id, o.id
      ORDER BY p.created_at DESC
      LIMIT $${params.length}
    `, params)

    const hasMore = result.rows.length > limit
    const posts = hasMore ? result.rows.slice(0, limit) : result.rows
    const nextCursor = hasMore ? posts[posts.length - 1]?.created_at : null

    res.json({ posts, hasMore, nextCursor })
  } catch (err: any) {
    console.error('[Community] GET /posts error:', err.message)
    res.status(500).json({ error: 'Failed to fetch posts' })
  }
})

// ─── POST /posts — Create a new community post ────────────────────────────────
router.post('/posts', authMiddleware, upload.single('image'), validateMagicBytes, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id
    if (!userId) return res.status(401).json({ error: 'Authentication required' })
    const { content, location, is_hazard_update } = req.body

    if (!content?.trim()) {
      return res.status(400).json({ error: 'Content is required' })
    }

    const postId = uuid()
    const imageUrl = req.file ? `/uploads/community/${req.file.filename}` : null

    const result = await pool.query(`
      INSERT INTO community_posts (id, author_id, content, image_url, location, is_hazard_update, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
      RETURNING *
    `, [postId, userId, content.trim(), imageUrl, location || null, is_hazard_update === 'true' || false])

    const post = result.rows[0]
    const author = await getUserInfo(userId)

    res.status(201).json({
      id: post.id,
      author_id: post.author_id,
      author_name: author?.display_name,
      author_role: author?.role || 'citizen',
      author_avatar: author?.avatar_url,
      content: post.content,
      image_url: post.image_url,
      location: post.location,
      is_hazard_update: post.is_hazard_update,
      likes_count: 0,
      comments_count: 0,
      shares_count: 0,
      is_liked_by_user: false,
      created_at: post.created_at,
      updated_at: post.updated_at,
    })
  } catch (err: any) {
    console.error('[Community] POST /posts error:', err.message)
    res.status(500).json({ error: 'Failed to create post' })
  }
})

// ─── POST /posts/:postId/like — Like/unlike a post ────────────────────────────
router.post('/posts/:postId/like', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id
    if (!userId) return res.status(401).json({ error: 'Authentication required' })
    const { postId } = req.params

    // Check if already liked
    const likeCheck = await pool.query(
      'SELECT id FROM community_post_likes WHERE post_id = $1 AND user_id = $2',
      [postId, userId]
    )

    if (likeCheck.rows.length > 0) {
      // Unlike
      await pool.query(
        'DELETE FROM community_post_likes WHERE post_id = $1 AND user_id = $2',
        [postId, userId]
      )
      // Get updated count
      const countResult = await pool.query(
        'SELECT COUNT(*) as cnt FROM community_post_likes WHERE post_id = $1',
        [postId]
      )
      const likes_count = parseInt(countResult.rows[0].cnt)

      // Broadcast real-time update to all connected clients
      const io = req.app.get('io')
      if (io) {
        io.emit('community:post:liked', { postId, userId, liked: false, likes_count })
      }

      res.json({ liked: false, likes_count })
    } else {
      // Like
      const likeId = uuid()
      await pool.query(
        'INSERT INTO community_post_likes (id, post_id, user_id, created_at) VALUES ($1, $2, $3, NOW())',
        [likeId, postId, userId]
      )
      // Get updated count
      const countResult = await pool.query(
        'SELECT COUNT(*) as cnt FROM community_post_likes WHERE post_id = $1',
        [postId]
      )
      const likes_count = parseInt(countResult.rows[0].cnt)

      // Get liker info for notification
      const likerInfo = await getUserInfo(userId)

      // Get post author to notify them
      const postResult = await pool.query('SELECT author_id FROM community_posts WHERE id = $1', [postId])
      const postAuthorId = postResult.rows[0]?.author_id

      // Broadcast real-time update to all connected clients
      const io = req.app.get('io')
      if (io) {
        io.emit('community:post:liked', { postId, userId, liked: true, likes_count, likerName: likerInfo?.display_name || 'Someone' })

        // Notify post author (if not self-like)
        if (postAuthorId && postAuthorId !== userId) {
          io.to(`user:${postAuthorId}`).emit('community:post:notification', {
            type: 'like',
            postId,
            actorName: likerInfo?.display_name || 'Someone',
            message: `${likerInfo?.display_name || 'Someone'} liked your post`
          })
        }
      }

      res.json({ liked: true, likes_count })
    }
  } catch (err: any) {
    console.error('[Community] POST /posts/:postId/like error:', err.message)
    res.status(500).json({ error: 'Failed to like post' })
  }
})

// ─── GET /posts/:postId/comments — Get comments for a post ────────────────────
router.get('/posts/:postId/comments', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { postId } = req.params

    const result = await pool.query(`
      SELECT 
        cm.id, cm.post_id, cm.author_id, cm.content, cm.image_url, cm.created_at,
        COALESCE(c.display_name, o.display_name, 'Unknown') as author_name, COALESCE(c.role::text, o.role::text, 'citizen') as author_role, COALESCE(c.avatar_url, o.avatar_url) as author_avatar
      FROM community_comments cm
      LEFT JOIN citizens c ON cm.author_id = c.id
      LEFT JOIN operators o ON cm.author_id = o.id
      WHERE cm.post_id = $1 AND cm.deleted_at IS NULL
      ORDER BY cm.created_at ASC
    `, [postId])

    res.json({ comments: result.rows })
  } catch (err: any) {
    console.error('[Community] GET /posts/:postId/comments error:', err.message)
    res.status(500).json({ error: 'Failed to fetch comments' })
  }
})

// ─── POST /posts/:postId/comments — Add a comment ────────────────────────────
router.post('/posts/:postId/comments', authMiddleware, upload.single('image'), validateMagicBytes, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id
    if (!userId) return res.status(401).json({ error: 'Authentication required' })
    const { postId } = req.params
    const { content } = req.body

    if (!content?.trim()) {
      return res.status(400).json({ error: 'Comment content is required' })
    }

    const commentId = uuid()
    const imageUrl = req.file ? `/uploads/community/${req.file.filename}` : null

    const result = await pool.query(`
      INSERT INTO community_comments (id, post_id, author_id, content, image_url, created_at)
      VALUES ($1, $2, $3, $4, $5, NOW())
      RETURNING *
    `, [commentId, postId, userId, content.trim(), imageUrl])

    const comment = result.rows[0]
    const author = await getUserInfo(userId)

    const commentPayload = {
      id: comment.id,
      post_id: comment.post_id,
      author_id: comment.author_id,
      author_name: author?.display_name,
      author_role: author?.role || 'citizen',
      author_avatar: author?.avatar_url,
      content: comment.content,
      image_url: comment.image_url,
      created_at: comment.created_at,
    }

    // Get updated comment count
    const countResult = await pool.query(
      'SELECT COUNT(*) as cnt FROM community_comments WHERE post_id = $1 AND deleted_at IS NULL',
      [postId]
    )
    const comments_count = parseInt(countResult.rows[0].cnt)

    // Get post author to notify them
    const postResult = await pool.query('SELECT author_id FROM community_posts WHERE id = $1', [postId])
    const postAuthorId = postResult.rows[0]?.author_id

    // Broadcast real-time update to all connected clients
    const io = req.app.get('io')
    if (io) {
      io.emit('community:post:commented', { postId, comment: commentPayload, comments_count })

      // Notify post author (if not self-comment)
      if (postAuthorId && postAuthorId !== userId) {
        io.to(`user:${postAuthorId}`).emit('community:post:notification', {
          type: 'comment',
          postId,
          actorName: author?.display_name || 'Someone',
          message: `${author?.display_name || 'Someone'} commented on your post`
        })
      }
    }

    res.status(201).json(commentPayload)
  } catch (err: any) {
    console.error('[Community] POST /posts/:postId/comments error:', err.message)
    res.status(500).json({ error: 'Failed to create comment' })
  }
})

// ─── PUT /posts/:postId — Edit a post (owner only) ──────────────────────────
router.put('/posts/:postId', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id
    if (!userId) return res.status(401).json({ error: 'Authentication required' })
    const { postId } = req.params
    const { content, location } = req.body

    if (!content?.trim()) {
      return res.status(400).json({ error: 'Content is required' })
    }

    // Only the owner can edit
    const postCheck = await pool.query(
      'SELECT author_id FROM community_posts WHERE id = $1 AND deleted_at IS NULL',
      [postId]
    )
    if (postCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Post not found' })
    }
    if (postCheck.rows[0].author_id !== userId) {
      return res.status(403).json({ error: 'You can only edit your own posts' })
    }

    const result = await pool.query(
      `UPDATE community_posts SET content = $1, location = $2, updated_at = NOW() WHERE id = $3 RETURNING *`,
      [content.trim(), location || null, postId]
    )

    const post = result.rows[0]
    res.json({
      id: post.id,
      content: post.content,
      location: post.location,
      updated_at: post.updated_at,
    })
  } catch (err: any) {
    console.error('[Community] PUT /posts/:postId error:', err.message)
    res.status(500).json({ error: 'Failed to edit post' })
  }
})

// ─── DELETE /posts/:postId — Delete a post (owner only) ─────────────────────
router.delete('/posts/:postId', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id
    if (!userId) return res.status(401).json({ error: 'Authentication required' })
    const { postId } = req.params
    const user = (req as any).user
    const isAdmin = user && ['admin', 'operator'].includes(String(user?.role || '').toLowerCase())

    // Check post exists
    const postCheck = await pool.query(
      'SELECT author_id FROM community_posts WHERE id = $1 AND deleted_at IS NULL',
      [postId]
    )

    if (postCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Post not found' })
    }

    // Owner can always delete their own posts
    if (postCheck.rows[0].author_id === userId) {
      await pool.query('UPDATE community_posts SET deleted_at = NOW() WHERE id = $1', [postId])
      return res.json({ deleted: true })
    }

    // Admin can delete ONLY if post has been reported
    if (isAdmin) {
      const reportCheck = await pool.query(
        'SELECT COUNT(*) as cnt FROM community_post_reports WHERE post_id = $1',
        [postId]
      )
      if (parseInt(reportCheck.rows[0].cnt) === 0) {
        return res.status(403).json({ error: 'Admins can only delete reported posts' })
      }
      await pool.query('UPDATE community_posts SET deleted_at = NOW() WHERE id = $1', [postId])
      if (process.env.NODE_ENV !== 'production') console.log(`[Community] Admin ${userId} deleted reported post ${postId}`)
      return res.json({ deleted: true })
    }

    return res.status(403).json({ error: 'Unauthorized' })
  } catch (err: any) {
    console.error('[Community] DELETE /posts/:postId error:', err.message)
    res.status(500).json({ error: 'Failed to delete post' })
  }
})

// ─── POST /posts/:postId/report — Report a community post ─────────────────────
router.post('/posts/:postId/report', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id
    if (!userId) return res.status(401).json({ error: 'Authentication required' })
    const { postId } = req.params
    const { reason, details } = req.body

    if (!reason) return res.status(400).json({ error: 'Reason is required' })

    const validReasons = ['spam', 'harassment', 'misinformation', 'inappropriate', 'violence', 'other']
    if (!validReasons.includes(reason)) {
      return res.status(400).json({ error: 'Invalid reason' })
    }

    // Check post exists
    const postCheck = await pool.query(
      'SELECT id, author_id FROM community_posts WHERE id = $1 AND deleted_at IS NULL',
      [postId]
    )
    if (postCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Post not found' })
    }

    // Can't report own post
    if (postCheck.rows[0].author_id === userId) {
      return res.status(400).json({ error: 'Cannot report your own post' })
    }

    // Insert report (ON CONFLICT ignore duplicate)
    await pool.query(
      `INSERT INTO community_post_reports (id, post_id, reporter_id, reason, details)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (post_id, reporter_id) DO UPDATE SET reason = $4, details = $5`,
      [uuid(), postId, userId, reason, details || null]
    )

    // Get updated report count
    const countResult = await pool.query(
      'SELECT COUNT(*) as cnt FROM community_post_reports WHERE post_id = $1',
      [postId]
    )

    res.json({ reported: true, reports_count: parseInt(countResult.rows[0].cnt) })
  } catch (err: any) {
    console.error('[Community] POST /posts/:postId/report error:', err.message)
    res.status(500).json({ error: 'Failed to report post' })
  }
})

// ─── GET /chat/messages — Get community chat history (M5: search support) ──
router.get('/chat/messages', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const limit = parseInt((req.query.limit as string) || '50')
    const before = req.query.before as string | undefined
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : undefined
    const senderType = typeof req.query.senderType === 'string' ? req.query.senderType.trim() : undefined
    const userId = req.user?.id
    const userName = req.user?.displayName || req.user?.display_name || 'Unknown'
    
    console.log('[Community] GET /chat/messages from:', userName, 'Limit:', limit, 'Before:', before)

    let query = `
      SELECT cm.id, cm.sender_id, cm.sender_type, cm.content, cm.image_url, cm.reply_to_id, cm.created_at, cm.deleted_at, cm.read_by,
             COALESCE(
               CASE WHEN cm.sender_type = 'citizen' THEN c.display_name ELSE o.display_name END,
               c.display_name,
               o.display_name,
               'Anonymous User'
             ) as sender_name,
             CASE
               WHEN cm.sender_type = 'citizen' THEN 'citizen'
               ELSE COALESCE(NULLIF(o.department, ''), o.role::text, 'operator')
             END as sender_role,
             COALESCE(c.avatar_url, o.avatar_url) as sender_avatar,
             rm.content as reply_content,
             COALESCE(
               CASE WHEN rm.sender_type = 'citizen' THEN rc.display_name ELSE ro.display_name END,
               rc.display_name,
               ro.display_name,
               'Anonymous User'
             ) as reply_sender_name
      FROM community_chat_messages cm
      LEFT JOIN citizens c ON cm.sender_id = c.id
      LEFT JOIN operators o ON cm.sender_id = o.id
      LEFT JOIN community_chat_messages rm ON cm.reply_to_id = rm.id
      LEFT JOIN citizens rc ON rm.sender_id = rc.id
      LEFT JOIN operators ro ON rm.sender_id = ro.id
      WHERE cm.deleted_at IS NULL
    `
    const params: any[] = []

    if (before) {
      params.push(before)
      query += ` AND cm.created_at < $${params.length}`
    }

    if (search && search.length > 0) {
      params.push(search)
      query += ` AND to_tsvector('english', COALESCE(cm.content, '')) @@ plainto_tsquery('english', $${params.length})`
    }

    if (senderType === 'citizen' || senderType === 'operator') {
      params.push(senderType)
      query += ` AND cm.sender_type = $${params.length}`
    }

    query += ` ORDER BY cm.created_at DESC LIMIT $${params.length + 1}`
    params.push(Math.min(limit, 100))

    const result = await pool.query(query, params)
    console.log('[Community] ✅ Loaded', result.rows.length, 'messages for', userName)
    res.json(result.rows.reverse())
  } catch (err: any) {
    console.error('[Community] GET /chat/messages error:', err.message)
    res.status(500).json({ error: 'Failed to load messages' })
  }
})

// ─── GET /chat/profile/:senderType/:senderId — Public profile for community chat ───
router.get('/chat/profile/:senderType/:senderId', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const senderType = String(req.params.senderType || '').toLowerCase()
    const senderId = req.params.senderId

    if (!senderId || (senderType !== 'citizen' && senderType !== 'operator')) {
      return res.status(400).json({ error: 'Invalid profile request' })
    }

    if (senderType === 'citizen') {
      const result = await pool.query(
        `SELECT c.id,
                c.display_name as name,
                c.avatar_url as profile_photo,
                'Citizen' as role,
                c.bio,
                c.created_at as joined_at,
                CASE WHEN up.is_online THEN 'Online' ELSE 'Offline' END as status,
                (SELECT COUNT(*) FROM community_chat_messages WHERE sender_id = c.id AND deleted_at IS NULL) as message_count
         FROM citizens c
         LEFT JOIN user_presence up ON up.user_id = c.id
         WHERE c.id = $1 AND c.deleted_at IS NULL
         LIMIT 1`,
        [senderId]
      )
      if (result.rows.length === 0) return res.status(404).json({ error: 'Profile not found' })
      return res.json(result.rows[0])
    }

    const result = await pool.query(
      `SELECT o.id,
              o.display_name as name,
              o.avatar_url as profile_photo,
              COALESCE(NULLIF(o.department, ''), o.role::text, 'Operator') as role,
              o.created_at as joined_at,
              CASE WHEN up.is_online THEN 'Online' ELSE 'Offline' END as status,
              (SELECT COUNT(*) FROM community_chat_messages WHERE sender_id = o.id AND deleted_at IS NULL) as message_count
       FROM operators o
       LEFT JOIN user_presence up ON up.user_id = o.id
       WHERE o.id = $1 AND o.deleted_at IS NULL
       LIMIT 1`,
      [senderId]
    )
    if (result.rows.length === 0) return res.status(404).json({ error: 'Profile not found' })
    return res.json(result.rows[0])
  } catch (err: any) {
    console.error('[Community] GET /chat/profile error:', err.message)
    return res.status(500).json({ error: 'Failed to load profile' })
  }
})

// ─── POST /join — Join community chat ────────────────────────────────────────
router.post('/join', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id
    if (!userId) return res.status(401).json({ error: 'Authentication required' })
    const userRole = String(req.user?.role || '').toLowerCase()
    const isOp = !['citizen', 'verified_citizen', 'community_leader'].includes(userRole)
    const userType = isOp ? 'operator' : 'citizen'

    // Check if banned
    const banCheck = await pool.query(
      `SELECT * FROM community_bans WHERE user_id = $1 AND (is_permanent = true OR expires_at > NOW())`,
      [userId]
    )
    if (banCheck.rows.length > 0) {
      const ban = banCheck.rows[0]
      return res.status(403).json({
        error: 'You are banned from community chat.',
        reason: ban.reason,
        permanent: ban.is_permanent,
        expires_at: ban.expires_at,
      })
    }

    await pool.query(
      `INSERT INTO community_members (user_id, user_type, joined_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (user_id) DO NOTHING`,
      [userId, userType]
    )
    res.json({ success: true, message: 'Joined community chat' })
  } catch (err: any) {
    console.error('[Community] POST /join error:', err.message)
    res.status(500).json({ error: 'Failed to join community' })
  }
})

// ─── DELETE /leave — Leave community chat ────────────────────────────────────
router.delete('/leave', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id
    if (!userId) return res.status(401).json({ error: 'Authentication required' })
    await pool.query('DELETE FROM community_members WHERE user_id = $1', [userId])
    res.json({ success: true, message: 'Left community chat' })
  } catch (err: any) {
    console.error('[Community] DELETE /leave error:', err.message)
    res.status(500).json({ error: 'Failed to leave community' })
  }
})

// ─── GET /membership — Check membership status ──────────────────────────────
router.get('/membership', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id
    if (!userId) return res.status(401).json({ error: 'Authentication required' })

    const memberCheck = await pool.query(
      'SELECT * FROM community_members WHERE user_id = $1',
      [userId]
    )

    const banCheck = await pool.query(
      `SELECT reason, is_permanent, expires_at FROM community_bans WHERE user_id = $1 AND (is_permanent = true OR expires_at > NOW())`,
      [userId]
    )

    const muteCheck = await pool.query(
      `SELECT reason, expires_at FROM community_mutes WHERE user_id = $1 AND expires_at > NOW()`,
      [userId]
    )

    res.json({
      isMember: memberCheck.rows.length > 0,
      joinedAt: memberCheck.rows[0]?.joined_at || null,
      isBanned: banCheck.rows.length > 0,
      ban: banCheck.rows[0] || null,
      isMuted: muteCheck.rows.length > 0,
      mute: muteCheck.rows[0] || null,
    })
  } catch (err: any) {
    console.error('[Community] GET /membership error:', err.message)
    res.status(500).json({ error: 'Failed to check membership' })
  }
})

// ─── GET /chat/preview — Get last 5 messages for non-members ─────────────────
router.get('/chat/preview', async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(`
      SELECT cm.id, cm.content, cm.created_at,
             COALESCE(
               CASE WHEN cm.sender_type = 'citizen' THEN c.display_name ELSE o.display_name END,
               'Anonymous User'
             ) as sender_name,
             cm.sender_type
      FROM community_chat_messages cm
      LEFT JOIN citizens c ON cm.sender_id = c.id
      LEFT JOIN operators o ON cm.sender_id = o.id
      WHERE cm.deleted_at IS NULL
      ORDER BY cm.created_at DESC
      LIMIT 5
    `)
    res.json({ messages: result.rows.reverse() })
  } catch (err: any) {
    console.error('[Community] GET /chat/preview error:', err.message)
    res.status(500).json({ error: 'Failed to load preview' })
  }
})

// ─── POST /chat/upload — Upload image for community chat ─────────────────────
router.post('/chat/upload', authMiddleware, upload.single('image'), validateMagicBytes, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image file provided' })
    }
    const imageUrl = `/uploads/community/${req.file.filename}`
    res.json({ success: true, image_url: imageUrl })
  } catch (err: any) {
    console.error('[Community] POST /chat/upload error:', err.message)
    res.status(500).json({ error: 'Failed to upload image' })
  }
})

// ─── POST /citizens/:citizenId/suspend — Suspend citizen account (operators only) ───
router.post('/citizens/:citizenId/suspend', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const citizenId = req.params.citizenId
    const user = (req as any).user
    const isAdmin = user && ['admin', 'operator'].includes(String(user?.role || '').toLowerCase())
    
    if (!isAdmin) return res.status(403).json({ error: 'Unauthorized' })
    
    // Soft delete: set deleted_at to mark account as suspended
    const result = await pool.query(
      `UPDATE citizens SET deleted_at = NOW() WHERE id = $1 RETURNING id, display_name`,
      [citizenId]
    )
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Citizen not found' })
    }
    
    if (process.env.NODE_ENV !== 'production') console.log('[Community] Citizen suspended:', result.rows[0].display_name)
    res.json({ success: true, message: 'Citizen account suspended' })
  } catch (err: any) {
    console.error('[Community] Suspend citizen error:', err.message)
    res.status(500).json({ error: 'Failed to suspend account' })
  }
})

// ─── DELETE /citizens/:citizenId — Delete citizen account (self or operators) ───
router.delete('/citizens/:citizenId', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const citizenId = req.params.citizenId
    const user = (req as any).user
    const isAdmin = user && ['admin', 'operator'].includes(String(user?.role || '').toLowerCase())
    
    // Allow self-deletion or admin deletion
    if (user?.id !== citizenId && !isAdmin) {
      return res.status(403).json({ error: 'Unauthorized' })
    }
    
    // Soft delete
    const result = await pool.query(
      `UPDATE citizens SET deleted_at = NOW() WHERE id = $1 RETURNING id, display_name`,
      [citizenId]
    )
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Citizen not found' })
    }
    
    if (process.env.NODE_ENV !== 'production') console.log('[Community] Citizen deleted:', result.rows[0].display_name)
    res.json({ success: true, message: 'Account deleted permanently' })
  } catch (err: any) {
    console.error('[Community] Delete citizen error:', err.message)
    res.status(500).json({ error: 'Failed to delete account' })
  }
})

export default router


