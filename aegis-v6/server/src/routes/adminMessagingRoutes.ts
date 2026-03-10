/**
 * adminMessagingRoutes.ts - Admin access to citizen messaging threads
 *
 * Provides admin/operator endpoints for viewing and responding to citizen messages:
 *   GET  /api/admin/threads           - List all message threads
 *   GET  /api/admin/threads/:id       - Get thread with messages
 *   POST /api/admin/threads/:id/messages - Send message to citizen
 *   PUT  /api/admin/threads/:id/read  - Mark thread as read (for admin)
 *
 * All routes require admin/operator authentication.
 */

import { Router, Response } from 'express'
import pool from '../models/db.js'
import { authMiddleware, AuthRequest, requireRole } from '../middleware/auth.js'

const router = Router()

// All routes require at least operator role
router.use(authMiddleware)
router.use(requireRole('admin', 'operator', 'super_admin', 'superadmin'))

/**
 * GET /api/admin/threads - List all message threads
 */
router.get('/', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
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
        c.first_name || ' ' || c.last_name AS citizen_name,
        c.email AS citizen_email,
        c.phone AS citizen_phone,
        c.is_vulnerable,
        (SELECT content FROM messages WHERE thread_id = mt.id ORDER BY created_at DESC LIMIT 1) AS last_message,
        (SELECT created_at FROM messages WHERE thread_id = mt.id ORDER BY created_at DESC LIMIT 1) AS last_message_at
      FROM message_threads mt
      JOIN citizens c ON c.id = mt.citizen_id
      ORDER BY mt.updated_at DESC
    `)

    res.json({ threads: result.rows })
  } catch (err: any) {
    console.error('[AdminMessaging] Get threads error:', err.message)
    res.status(500).json({ error: 'Failed to load message threads.' })
  }
})

/**
 * GET /api/admin/threads/:id - Get thread with all messages
 */
router.get('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    // Get thread metadata
    const threadResult = await pool.query(`
      SELECT 
        mt.*,
        c.first_name || ' ' || c.last_name AS citizen_name,
        c.email AS citizen_email,
        c.phone AS citizen_phone,
        c.is_vulnerable
      FROM message_threads mt
      JOIN citizens c ON c.id = mt.citizen_id
      WHERE mt.id = $1
    `, [req.params.id])

    if (threadResult.rows.length === 0) {
      res.status(404).json({ error: 'Thread not found.' })
      return
    }

    // Get all messages in thread
    const messagesResult = await pool.query(`
      SELECT 
        m.*,
        o.name AS operator_name
      FROM messages m
      LEFT JOIN users o ON o.id = m.operator_id AND m.sender_type = 'operator'
      WHERE m.thread_id = $1
      ORDER BY m.created_at ASC
    `, [req.params.id])

    res.json({
      thread: threadResult.rows[0],
      messages: messagesResult.rows
    })
  } catch (err: any) {
    console.error('[AdminMessaging] Get thread error:', err.message)
    res.status(500).json({ error: 'Failed to load thread.' })
  }
})

/**
 * POST /api/admin/threads/:id/messages - Send message from admin to citizen
 */
router.post('/:id/messages', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { content, image_url } = req.body

    if (!content?.trim() && !image_url) {
      res.status(400).json({ error: 'Message content or image required.' })
      return
    }

    // Verify thread exists
    const threadCheck = await pool.query(
      'SELECT id, citizen_id FROM message_threads WHERE id = $1',
      [req.params.id]
    )

    if (threadCheck.rows.length === 0) {
      res.status(404).json({ error: 'Thread not found.' })
      return
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
  } catch (err: any) {
    console.error('[AdminMessaging] Send message error:', err.message)
    res.status(500).json({ error: 'Failed to send message.' })
  }
})

/**
 * PUT /api/admin/threads/:id/read - Mark thread as read (for operator)
 */
router.put('/:id/read', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    // Verify thread exists
    const threadCheck = await pool.query(
      'SELECT id FROM message_threads WHERE id = $1',
      [req.params.id]
    )

    if (threadCheck.rows.length === 0) {
      res.status(404).json({ error: 'Thread not found.' })
      return
    }

    // Reset operator's unread count for this thread
    await pool.query(
      'UPDATE message_threads SET operator_unread = 0 WHERE id = $1',
      [req.params.id]
    )

    res.json({ success: true })
  } catch (err: any) {
    console.error('[AdminMessaging] Mark read error:', err.message)
    res.status(500).json({ error: 'Failed to mark thread as read.' })
  }
})

export default router
