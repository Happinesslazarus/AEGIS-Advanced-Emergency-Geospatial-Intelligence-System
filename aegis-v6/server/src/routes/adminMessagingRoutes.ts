/**
 * Admin-side messaging: operators view citizen message threads, send
 * replies, and mark conversations as read. This is the operator half
 * of the citizen ↔ admin messaging system.
 *
 * - Mounted at /api/admin/messages in index.ts
 * - Citizens send messages via citizenRoutes.ts; operators reply here
 * - Real-time notifications pushed via Socket.IO
 * - Requires operator or admin authentication
 *
 * GET  /api/admin/threads           — List all threads
 * GET  /api/admin/threads/:id       — Get thread with messages
 * POST /api/admin/threads/:id/messages — Send reply
 * PUT  /api/admin/threads/:id/read  — Mark as read
 * */

import { Router, Response, NextFunction } from 'express'
import pool from '../models/db.js'
import { authMiddleware, AuthRequest, requireRole } from '../middleware/auth.js'
import { AppError } from '../utils/AppError.js'

const router = Router()

// All routes require at least operator role
router.use(authMiddleware)
router.use(requireRole('admin', 'operator', 'super_admin', 'superadmin'))

/**
 * GET /api/admin/threads - List all message threads (paginated)
 */
router.get('/', async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1)
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || '50'), 10) || 50))
    const offset = (page - 1) * limit

    const result = await pool.query(`
      SELECT 
        mt.id,
        mt.citizen_id,
        mt.subject,
        mt.status,
        mt.created_at,
        mt.updated_at,
        mt.citizen_unread,
        mt.operator_unread,
        c.display_name AS citizen_name,
        c.email AS citizen_email,
        c.phone AS citizen_phone,
        c.is_vulnerable,
        c.avatar_url AS citizen_avatar,
        (SELECT content FROM messages WHERE thread_id = mt.id ORDER BY created_at DESC LIMIT 1) AS last_message,
        (SELECT created_at FROM messages WHERE thread_id = mt.id ORDER BY created_at DESC LIMIT 1) AS last_message_at
      FROM message_threads mt
      JOIN citizens c ON c.id = mt.citizen_id
      ORDER BY mt.updated_at DESC
      LIMIT $1 OFFSET $2
    `, [limit, offset])

    const countResult = await pool.query('SELECT COUNT(*) FROM message_threads')
    const total = parseInt(countResult.rows[0].count, 10)

    res.json({ threads: result.rows, total, page, limit, pages: Math.ceil(total / limit) })
  } catch (err) {
    next(err)
  }
})

/**
 * GET /api/admin/threads/:id - Get thread with all messages
 */
router.get('/:id', async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Get thread metadata
    const threadResult = await pool.query(`
      SELECT 
        mt.*,
        c.display_name AS citizen_name,
        c.email AS citizen_email,
        c.phone AS citizen_phone,
        c.is_vulnerable,
        c.avatar_url AS citizen_avatar
      FROM message_threads mt
      JOIN citizens c ON c.id = mt.citizen_id
      WHERE mt.id = $1
    `, [req.params.id])

    if (threadResult.rows.length === 0) {
      throw AppError.notFound('Thread not found.')
    }

    // Get all messages in thread
    const messagesResult = await pool.query(`
      SELECT 
        m.*,
        CASE WHEN m.sender_type = 'operator' THEN o.display_name
             WHEN m.sender_type = 'citizen' THEN c2.display_name
             ELSE 'Unknown' END AS sender_name
      FROM messages m
      LEFT JOIN operators o ON o.id = m.sender_id AND m.sender_type = 'operator'
      LEFT JOIN citizens c2 ON c2.id = m.sender_id AND m.sender_type = 'citizen'
      WHERE m.thread_id = $1
      ORDER BY m.created_at ASC
    `, [req.params.id])

    // Mark citizen messages as read by operator
    await pool.query(
      `UPDATE messages SET status = 'read', read_at = NOW()
       WHERE thread_id = $1 AND sender_type = 'citizen' AND (read_at IS NULL OR status != 'read')`,
      [req.params.id]
    )
    await pool.query(
      `UPDATE message_threads SET operator_unread = 0 WHERE id = $1`,
      [req.params.id]
    )

    res.json({
      thread: threadResult.rows[0],
      messages: messagesResult.rows
    })
  } catch (err) {
    next(err)
  }
})

/**
 * POST /api/admin/threads/:id/messages - Send message from admin to citizen
 */
router.post('/:id/messages', async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { content, image_url } = req.body

    if (!content?.trim() && !image_url) {
      throw AppError.badRequest('Message content or image required.')
    }

    if (content && content.length > 10000) {
      throw AppError.badRequest('Message content exceeds maximum length of 10,000 characters.')
    }

    // Verify thread exists
    const threadCheck = await pool.query(
      'SELECT id, citizen_id FROM message_threads WHERE id = $1',
      [req.params.id]
    )

    if (threadCheck.rows.length === 0) {
      throw AppError.notFound('Thread not found.')
    }

    const thread = threadCheck.rows[0]

    // Insert message
    const result = await pool.query(`
      INSERT INTO messages (thread_id, sender_type, sender_id, operator_id, content, image_url, status)
      VALUES ($1, 'operator', $2, $2, $3, $4, 'sent')
      RETURNING *
    `, [req.params.id, req.user!.id, content?.trim() || null, image_url || null])

    // Update thread metadata
    await pool.query(`
      UPDATE message_threads 
      SET updated_at = NOW(),
          citizen_unread = citizen_unread + 1,
          operator_unread = 0
      WHERE id = $1
    `, [req.params.id])

    res.json({ message: result.rows[0] })
  } catch (err) {
    next(err)
  }
})

/**
 * PUT /api/admin/threads/:id/read - Mark thread as read (for operator)
 */
router.put('/:id/read', async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Verify thread exists
    const threadCheck = await pool.query(
      'SELECT id FROM message_threads WHERE id = $1',
      [req.params.id]
    )

    if (threadCheck.rows.length === 0) {
      throw AppError.notFound('Thread not found.')
    }

    // Reset operator's unread count for this thread
    await pool.query(
      'UPDATE message_threads SET operator_unread = 0 WHERE id = $1',
      [req.params.id]
    )

    res.json({ success: true })
  } catch (err) {
    next(err)
  }
})

export default router
