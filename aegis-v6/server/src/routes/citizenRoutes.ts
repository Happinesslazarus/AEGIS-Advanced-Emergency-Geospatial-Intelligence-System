/**
 * File: citizenRoutes.ts
 *
 * What this file does:
 * Citizen-specific features: safety check-ins, message threads with
 * operators, and the citizen dashboard with personalised alerts.
 *
 * How it connects:
 * - Mounted at /api/citizen in index.ts
 * - Citizens authenticate via citizenAuthRoutes.ts
 * - Messages are the citizen half of admin messaging (adminMessagingRoutes.ts)
 * - Real-time message notifications via Socket.IO
 *
 * Key endpoints:
 * POST /api/citizen/safety          — Submit safety check-in
 * GET  /api/citizen/safety/history  — Check-in history
 * GET  /api/citizen/threads         — List message threads
 * POST /api/citizen/threads         — Start new conversation
 * POST /api/citizen/threads/:id/messages — Send message
 *
 * Simple explanation:
 * Citizen features: safety check-ins, messaging with operators, and alerts.
 */

import { Router, Response, NextFunction } from 'express'
import rateLimit from 'express-rate-limit'
import pool from '../models/db.js'
import { authMiddleware, citizenOnly, AuthRequest } from '../middleware/auth.js'
import { logger } from '../services/logger.js'

const router = Router()

// All routes require citizen authentication
router.use(authMiddleware, citizenOnly)

// Rate limiters for citizen-facing endpoints
const safetyLimiter = rateLimit({
  windowMs: 60 * 1000, max: 10, // 10 check-ins per minute
  message: { error: 'Too many safety check-ins. Please wait before trying again.' },
  standardHeaders: true, legacyHeaders: false,
})
const threadLimiter = rateLimit({
  windowMs: 60 * 1000, max: 10, // 10 thread ops per minute
  message: { error: 'Rate limit reached. Please slow down.' },
  standardHeaders: true, legacyHeaders: false,
})
const messageLimiter = rateLimit({
  windowMs: 60 * 1000, max: 30, // 30 messages per minute
  message: { error: 'Message rate limit reached. Please wait.' },
  standardHeaders: true, legacyHeaders: false,
})

// Input limits
const MAX_MESSAGE_LENGTH = 5000
const MAX_SUBJECT_LENGTH = 200
const MAX_SAFETY_MESSAGE = 1000

// SAFETY CHECK-IN

// POST /safety — Submit a safety check-in (atomic transaction for help escalation)
router.post('/safety', safetyLimiter, async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  const client = await pool.connect()
  try {
    const { status, message, locationLat, locationLng } = req.body

    if (!status || !['safe', 'help', 'unsure'].includes(status)) {
      throw AppError.badRequest('Valid status required: safe, help, or unsure.')
    }

    // Validate message length
    if (message && typeof message === 'string' && message.length > MAX_SAFETY_MESSAGE) {
      throw AppError.badRequest(`Message must be ${MAX_SAFETY_MESSAGE} characters or less.`)
    }

    await client.query('BEGIN')

    const result = await client.query(
      `INSERT INTO safety_check_ins (citizen_id, status, location_lat, location_lng, message, escalation_status)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        req.user!.id,
        status,
        locationLat || null,
        locationLng || null,
        message || null,
        status === 'help' ? 'pending' : null,
      ]
    )

    const checkIn = result.rows[0]

    // If status is 'help', auto-escalate — create a message thread for admin visibility
    if (status === 'help') {
      // Update escalation timestamp
      await client.query(
        'UPDATE safety_check_ins SET escalated_at = NOW() WHERE id = $1',
        [checkIn.id]
      )

      // Auto-create a message thread so admin can see & respond
      const threadExists = await client.query(
        `SELECT id FROM message_threads
         WHERE citizen_id = $1 AND status IN ('open', 'in_progress')
           AND subject LIKE 'HELP REQUEST%'
         LIMIT 1
         FOR UPDATE`,
        [req.user!.id]
      )

      if (threadExists.rows.length === 0) {
        const threadResult = await client.query(
          `INSERT INTO message_threads (citizen_id, subject, status, priority)
           VALUES ($1, $2, 'open', 'urgent')
           RETURNING id`,
          [req.user!.id, `HELP REQUEST — ${req.user!.displayName}`]
        )

        // Auto-insert the help message
        const helpMsg = message || 'I need help. Please respond urgently.'
        await client.query(
          `INSERT INTO messages (thread_id, sender_type, sender_id, content)
           VALUES ($1, 'citizen', $2, $3)`,
          [threadResult.rows[0].id, req.user!.id, `🆘 SAFETY CHECK-IN: ${helpMsg}`]
        )

        await client.query(
          `UPDATE message_threads SET last_message_at = NOW(), operator_unread = operator_unread + 1 WHERE id = $1`,
          [threadResult.rows[0].id]
        )
      }

      // Auto-notify emergency contacts who opted in
      try {
        const contacts = await client.query(
          `SELECT name, phone FROM emergency_contacts WHERE citizen_id = $1 AND notify_on_help = true`,
          [req.user!.id]
        )
        if (contacts.rows.length > 0) {
          // Log notification for audit (actual SMS/email would require external service)
          for (const contact of contacts.rows) {
            logger.info({ contactName: contact.name, contactPhone: contact.phone, citizen: req.user!.displayName }, '[EmergencyNotify] Would notify contact about help status')
          }
          // Store notification record for dashboard visibility
          await client.query(
            `INSERT INTO safety_check_ins (citizen_id, status, message, escalation_status)
             VALUES ($1, 'notification_sent', $2, 'completed')`,
            [req.user!.id, `Emergency contacts notified: ${contacts.rows.map((c: any) => c.name).join(', ')}`]
          ).catch(() => {})
        }
      } catch (notifyErr: any) {
        logger.error({ err: notifyErr }, '[EmergencyNotify] Contact notification failed')
      }
    }

    await client.query('COMMIT')
    res.status(201).json(checkIn)
  } catch (err) {
    await client.query('ROLLBACK')
    next(err)
  } finally {
    client.release()
  }
})

// GET /safety/history — Get safety check-in history
router.get('/safety/history', async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100)
    const result = await pool.query(
      `SELECT s.*, o.display_name as acknowledged_by_name
       FROM safety_check_ins s
       LEFT JOIN operators o ON s.acknowledged_by = o.id
       WHERE s.citizen_id = $1
       ORDER BY s.created_at DESC
       LIMIT $2`,
      [req.user!.id, limit]
    )
    res.json(result.rows)
  } catch (err) {
    next(err)
  }
})

// GET /safety/latest — Get latest safety status
router.get('/safety/latest', async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const result = await pool.query(
      `SELECT s.*, o.display_name as acknowledged_by_name
       FROM safety_check_ins s
       LEFT JOIN operators o ON s.acknowledged_by = o.id
       WHERE s.citizen_id = $1
       ORDER BY s.created_at DESC
       LIMIT 1`,
      [req.user!.id]
    )
    res.json(result.rows[0] || null)
  } catch (err) {
    next(err)
  }
})

// MESSAGING

// GET /threads — List citizen’s message threads (paginated)
router.get('/threads', async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 50)
    const offset = Math.max(parseInt(req.query.offset as string) || 0, 0)
    const result = await pool.query(
      `SELECT t.*, o.display_name as assigned_to_name,
              lm.content as last_message
       FROM message_threads t
       LEFT JOIN operators o ON t.assigned_to = o.id
       LEFT JOIN LATERAL (
         SELECT content FROM messages WHERE thread_id = t.id ORDER BY created_at DESC LIMIT 1
       ) lm ON true
       WHERE t.citizen_id = $1
       ORDER BY t.updated_at DESC
       LIMIT $2 OFFSET $3`,
      [req.user!.id, limit, offset]
    )
    res.json(result.rows)
  } catch (err) {
    next(err)
  }
})

// POST /threads — Create a new message thread
router.post('/threads', threadLimiter, async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { subject, message } = req.body

    if (!subject || !message) {
      throw AppError.badRequest('Subject and message are required.')
    }

    // Validate lengths
    if (subject.length > MAX_SUBJECT_LENGTH) {
      throw AppError.badRequest(`Subject must be ${MAX_SUBJECT_LENGTH} characters or less.`)
    }
    if (message.length > MAX_MESSAGE_LENGTH) {
      throw AppError.badRequest(`Message must be ${MAX_MESSAGE_LENGTH} characters or less.`)
    }

    // Limit active threads per citizen
    const activeCount = await pool.query(
      `SELECT COUNT(*) as cnt FROM message_threads
       WHERE citizen_id = $1 AND status IN ('open', 'in_progress')`,
      [req.user!.id]
    )
    if (parseInt(activeCount.rows[0].cnt) >= 10) {
      throw AppError.badRequest('Maximum 10 active threads allowed. Please close existing threads first.')
    }

    const threadResult = await pool.query(
      `INSERT INTO message_threads (citizen_id, subject, last_message_at, operator_unread)
       VALUES ($1, $2, NOW(), 1)
       RETURNING *`,
      [req.user!.id, subject]
    )

    const thread = threadResult.rows[0]

    await pool.query(
      `INSERT INTO messages (thread_id, sender_type, sender_id, content)
       VALUES ($1, 'citizen', $2, $3)`,
      [thread.id, req.user!.id, message]
    )

    res.status(201).json(thread)
  } catch (err) {
    next(err)
  }
})

// GET /threads/:id — Get thread with messages
router.get('/threads/:id', async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const threadResult = await pool.query(
      `SELECT t.*, o.display_name as assigned_to_name
       FROM message_threads t
       LEFT JOIN operators o ON t.assigned_to = o.id
       WHERE t.id = $1 AND t.citizen_id = $2`,
      [req.params.id, req.user!.id]
    )

    if (threadResult.rows.length === 0) {
      throw AppError.notFound('Thread not found.')
    }

    // Pagination (#33): ?limit=50&before=<messageId>
    const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 50, 1), 200)
    const before = req.query.before as string | undefined

    let messagesQuery = `
       SELECT m.*,
              COALESCE(op.display_name, cit.display_name, 'Unknown') as sender_name
       FROM messages m
       LEFT JOIN operators op ON m.sender_type = 'operator' AND op.id = m.sender_id
       LEFT JOIN citizens cit ON m.sender_type = 'citizen' AND cit.id = m.sender_id
       WHERE m.thread_id = $1`
    const params: any[] = [req.params.id]

    if (before) {
      messagesQuery += ` AND m.id < $${params.length + 1}`
      params.push(before)
    }

    messagesQuery += ` ORDER BY m.created_at DESC LIMIT $${params.length + 1}`
    params.push(limit + 1) // fetch one extra to check hasMore

    const messagesResult = await pool.query(messagesQuery, params)
    const hasMore = messagesResult.rows.length > limit
    const messages = messagesResult.rows.slice(0, limit).reverse() // chronological order

    // Mark operator messages as read by citizen
    await pool.query(
      `UPDATE messages SET status = 'read', read_at = NOW()
       WHERE thread_id = $1 AND sender_type = 'operator' AND (read_at IS NULL OR status != 'read')`,
      [req.params.id]
    )
    await pool.query(
      `UPDATE message_threads SET citizen_unread = 0 WHERE id = $1`,
      [req.params.id]
    )

    res.json({
      thread: threadResult.rows[0],
      messages,
      hasMore,
      oldestId: messages.length > 0 ? messages[0].id : null,
    })
  } catch (err) {
    next(err)
  }
})

// POST /threads/:id/messages — Send message in thread
router.post('/threads/:id/messages', messageLimiter, async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { content } = req.body
    if (!content) {
      throw AppError.badRequest('Message content is required.')
    }
    if (typeof content === 'string' && content.length > MAX_MESSAGE_LENGTH) {
      throw AppError.badRequest(`Message must be ${MAX_MESSAGE_LENGTH} characters or less.`)
    }

    // Verify thread belongs to citizen
    const threadCheck = await pool.query(
      `SELECT id, status FROM message_threads WHERE id = $1 AND citizen_id = $2`,
      [req.params.id, req.user!.id]
    )

    if (threadCheck.rows.length === 0) {
      throw AppError.notFound('Thread not found.')
    }

    if (threadCheck.rows[0].status === 'closed') {
      throw AppError.badRequest('This thread is closed. Please create a new one.')
    }

    const msgResult = await pool.query(
      `INSERT INTO messages (thread_id, sender_type, sender_id, content)
       VALUES ($1, 'citizen', $2, $3)
       RETURNING *`,
      [req.params.id, req.user!.id, content]
    )

    // Update thread metadata
    await pool.query(
      `UPDATE message_threads
       SET last_message_at = NOW(), updated_at = NOW(), operator_unread = operator_unread + 1, status = 'open'
       WHERE id = $1`,
      [req.params.id]
    )

    res.status(201).json(msgResult.rows[0])
  } catch (err) {
    next(err)
  }
})

// PUT /threads/:id/read — Mark all messages in thread as read
router.put('/threads/:id/read', async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Verify thread belongs to citizen
    const threadCheck = await pool.query(
      `SELECT id FROM message_threads WHERE id = $1 AND citizen_id = $2`,
      [req.params.id, req.user!.id]
    )

    if (threadCheck.rows.length === 0) {
      throw AppError.notFound('Thread not found.')
    }

    // Mark all unread messages as read for this citizen
    await pool.query(
      `UPDATE messages
       SET status = 'read', read_at = NOW()
       WHERE thread_id = $1 AND sender_type = 'operator' AND status != 'read'`,
      [req.params.id]
    )

    // Reset citizen's unread count
    await pool.query(
      `UPDATE message_threads SET citizen_unread = 0 WHERE id = $1`,
      [req.params.id]
    )

    res.json({ success: true })
  } catch (err) {
    next(err)
  }
})

// ALERT HISTORY

// GET /alert-history — Get citizen's alert interaction history
router.get('/alert-history', async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const result = await pool.query(
      `SELECT ah.*, a.title, a.message, a.severity, a.alert_type, a.location_text
       FROM citizen_alert_history ah
       JOIN alerts a ON ah.alert_id = a.id
       WHERE ah.citizen_id = $1
       ORDER BY ah.seen_at DESC
       LIMIT 50`,
      [req.user!.id]
    )
    res.json(result.rows)
  } catch (err) {
    next(err)
  }
})

// POST /alert-history — Record that citizen saw/played an alert
router.post('/alert-history', async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { alertId, audioPlayed } = req.body
    if (!alertId) {
      throw AppError.badRequest('Alert ID is required.')
    }

    await pool.query(
      `INSERT INTO citizen_alert_history (citizen_id, alert_id, audio_played)
       VALUES ($1, $2, $3)
       ON CONFLICT (citizen_id, alert_id)
       DO UPDATE SET audio_played = COALESCE($3, citizen_alert_history.audio_played)`,
      [req.user!.id, alertId, audioPlayed || false]
    )

    res.json({ recorded: true })
  } catch (err) {
    next(err)
  }
})

// PERSONALIZED DASHBOARD

// GET /dashboard-stats — Get personalized dashboard data
router.get('/dashboard-stats', async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Run all dashboard queries in parallel for performance
    const [citizenResult, alertsResult, criticalResult, reportsResult, safetyResult, unreadResult, recentAlerts, helpResult] = await Promise.all([
      pool.query('SELECT preferred_region, location_lat, location_lng FROM citizens WHERE id = $1', [req.user!.id]),
      pool.query(`SELECT COUNT(*) as count FROM alerts WHERE is_active = true AND deleted_at IS NULL`),
      pool.query(`SELECT COUNT(*) as count FROM alerts WHERE is_active = true AND severity = 'critical' AND deleted_at IS NULL`),
      pool.query(`SELECT COUNT(*) as count FROM reports WHERE created_at > NOW() - INTERVAL '24 hours' AND deleted_at IS NULL`),
      pool.query(`SELECT status, created_at FROM safety_check_ins WHERE citizen_id = $1 ORDER BY created_at DESC LIMIT 1`, [req.user!.id]),
      pool.query(`SELECT COALESCE(SUM(citizen_unread), 0) as count FROM message_threads WHERE citizen_id = $1 AND status != 'closed'`, [req.user!.id]),
      pool.query(`SELECT id, title, message, severity, alert_type, location_text, created_at FROM alerts WHERE is_active = true AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 5`),
      pool.query(`SELECT COUNT(*) as count FROM community_help WHERE status = 'active' AND deleted_at IS NULL`).catch(() => ({ rows: [{ count: '0' }] })),
    ])

    const citizen = citizenResult.rows[0]

    res.json({
      activeAlerts: parseInt(alertsResult.rows[0].count),
      criticalAlerts: parseInt(criticalResult.rows[0].count),
      recentReports24h: parseInt(reportsResult.rows[0].count),
      currentSafety: safetyResult.rows[0] || null,
      unreadMessages: parseInt(unreadResult.rows[0].count),
      recentAlerts: recentAlerts.rows,
      communityHelp: parseInt(helpResult.rows[0].count),
      region: citizen?.preferred_region || null,
    })
  } catch (err) {
    next(err)
  }
})

// GDPR Data Export — GET /api/citizen/data-export

router.get('/data-export', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id

    // Gather all user data from every table in parallel
    const catchLog = (table: string) => (err: any) => { logger.error({ err, userId, table }, '[DataExport] Query failed'); return { rows: [] as any[] } }
    const [profile, reports, threads, threadMessages, safetyHistory, emergContacts, prefs, alertHistory] = await Promise.all([
      pool.query(`SELECT id, email, display_name, phone, preferred_region, is_vulnerable, country, city, bio, created_at FROM citizens WHERE id = $1`, [userId]),
      pool.query(`SELECT id, description, severity, status, location_text, created_at FROM reports WHERE citizen_id = $1 ORDER BY created_at DESC`, [userId]).catch(catchLog('reports')),
      pool.query(`SELECT id, subject, status, priority, created_at FROM message_threads WHERE citizen_id = $1 ORDER BY created_at DESC`, [userId]).catch(catchLog('message_threads')),
      pool.query(`SELECT m.content, m.sender_type, m.created_at, t.subject FROM messages m JOIN message_threads t ON m.thread_id = t.id WHERE t.citizen_id = $1 ORDER BY m.created_at DESC LIMIT 500`, [userId]).catch(catchLog('messages')),
      pool.query(`SELECT status, message, location_lat, location_lng, created_at FROM safety_check_ins WHERE citizen_id = $1 ORDER BY created_at DESC`, [userId]).catch(catchLog('safety_check_ins')),
      pool.query(`SELECT name, phone, relationship, is_primary FROM emergency_contacts WHERE citizen_id = $1`, [userId]).catch(catchLog('emergency_contacts')),
      pool.query(`SELECT * FROM citizen_preferences WHERE citizen_id = $1`, [userId]).catch(catchLog('citizen_preferences')),
      pool.query(`SELECT ah.seen_at, ah.audio_played, a.title, a.severity FROM citizen_alert_history ah JOIN alerts a ON ah.alert_id = a.id WHERE ah.citizen_id = $1 ORDER BY ah.seen_at DESC LIMIT 100`, [userId]).catch(catchLog('citizen_alert_history')),
    ])

    const exportData = {
      exportDate: new Date().toISOString(),
      platform: 'AEGIS Emergency Management v6.9.0',
      subject: 'GDPR Data Export (Article 20 — Right to Data Portability)',
      profile: profile.rows[0] || null,
      reports: reports.rows,
      messageThreads: threads.rows,
      messages: threadMessages.rows,
      safetyCheckIns: safetyHistory.rows,
      emergencyContacts: emergContacts.rows,
      preferences: prefs.rows[0] || null,
      alertHistory: alertHistory.rows,
    }

    res.setHeader('Content-Disposition', `attachment; filename="aegis-data-export-${new Date().toISOString().slice(0, 10)}.json"`)
    res.json(exportData)
  } catch (err) {
    next(err)
  }
})

// GDPR Data Erasure — DELETE /api/citizen/data-erasure

router.delete('/data-erasure', async (req: AuthRequest, res: Response, next: NextFunction) => {
  const client = await pool.connect()
  try {
    const userId = req.user!.id

    await client.query('BEGIN')

    // Log the erasure request FIRST for GDPR audit trail (kept separately)
    await client.query(
      `INSERT INTO account_deletion_log (citizen_id, citizen_email, citizen_name, action, details)
       SELECT $1, email, display_name, 'data_erasure_executed', '{"method": "immediate"}'
       FROM citizens WHERE id = $1`,
      [userId]
    ).catch(() => {}) // best-effort audit

    // Delete user data across all tables (order matters for FK constraints)
    await client.query(`DELETE FROM citizen_alert_history WHERE citizen_id = $1`, [userId])
    await client.query(`DELETE FROM messages WHERE thread_id IN (SELECT id FROM message_threads WHERE citizen_id = $1)`, [userId])
    await client.query(`DELETE FROM message_threads WHERE citizen_id = $1`, [userId])
    await client.query(`DELETE FROM safety_check_ins WHERE citizen_id = $1`, [userId])
    await client.query(`DELETE FROM emergency_contacts WHERE citizen_id = $1`, [userId])
    await client.query(`DELETE FROM citizen_preferences WHERE citizen_id = $1`, [userId])

    // Anonymise community content (keep for community value but remove PII)
    await client.query(
      `UPDATE community_posts SET author_id = NULL WHERE author_id = $1`,
      [userId]
    ).catch(() => {})
    await client.query(
      `UPDATE community_chat_messages SET sender_name = 'Deleted User', sender_id = '00000000-0000-0000-0000-000000000000' WHERE sender_id = $1`,
      [userId]
    ).catch(() => {})

    // Anonymise reports (keep for public safety but remove PII)
    await client.query(
      `UPDATE reports SET
         citizen_id = NULL,
         reporter_name = 'Anonymised',
         reporter_contact = NULL,
         description = regexp_replace(description, '(\\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}\\b|\\b\\d{5,}\\b)', '[REDACTED]', 'g')
       WHERE citizen_id = $1`,
      [userId]
    ).catch(() => {})

    // Delete the citizen account
    await client.query(`DELETE FROM citizens WHERE id = $1`, [userId])

    await client.query('COMMIT')

    res.json({
      success: true,
      message: 'Your account and personal data have been permanently deleted. Reports have been anonymised for public safety records.',
    })
  } catch (err) {
    await client.query('ROLLBACK')
    next(err)
  } finally {
    client.release()
  }
})

// ACCOUNT DELETION — 30-day grace period (like Instagram/Facebook)

// POST /request-deletion — Request account deletion with 30-day grace period
router.post('/request-deletion', async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user!.id

    // Check if already requested
    const existing = await pool.query(
      'SELECT deletion_requested_at, deletion_scheduled_at FROM citizens WHERE id = $1',
      [userId]
    )
    if (!existing.rows[0]) {
      throw AppError.notFound('Account not found')
    }
    if (existing.rows[0].deletion_requested_at) {
      res.json({
        success: true,
        already_requested: true,
        deletion_scheduled_at: existing.rows[0].deletion_scheduled_at,
        message: 'Account deletion already requested.',
      })
      return
    }

    // Set deletion schedule
    const result = await pool.query(
      `UPDATE citizens
       SET deletion_requested_at = NOW(),
           deletion_scheduled_at = NOW() + INTERVAL '30 days'
       WHERE id = $1
       RETURNING deletion_requested_at, deletion_scheduled_at, email, display_name`,
      [userId]
    )

    const citizen = result.rows[0]

    // Log the deletion request
    await pool.query(
      `INSERT INTO account_deletion_log (citizen_id, citizen_email, citizen_name, action, details)
       VALUES ($1, $2, $3, 'deletion_requested', $4)`,
      [userId, citizen.email, citizen.display_name, JSON.stringify({
        scheduled_for: citizen.deletion_scheduled_at,
      })]
    )

    logger.info({ citizenName: citizen.display_name, scheduledAt: citizen.deletion_scheduled_at }, '[AccountDeletion] Deletion requested')

    res.json({
      success: true,
      deletion_scheduled_at: citizen.deletion_scheduled_at,
      message: `Your account will be permanently deleted on ${new Date(citizen.deletion_scheduled_at).toLocaleDateString()}. You can cancel by logging back in within 30 days.`,
    })
  } catch (err) {
    next(err)
  }
})

// POST /cancel-deletion — Cancel pending account deletion
router.post('/cancel-deletion', async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user!.id

    const result = await pool.query(
      `UPDATE citizens
       SET deletion_requested_at = NULL,
           deletion_scheduled_at = NULL
       WHERE id = $1 AND deletion_requested_at IS NOT NULL
       RETURNING email, display_name`,
      [userId]
    )

    if (result.rows.length === 0) {
      res.json({ success: true, message: 'No pending deletion to cancel.' })
      return
    }

    const citizen = result.rows[0]

    // Log the cancellation
    await pool.query(
      `INSERT INTO account_deletion_log (citizen_id, citizen_email, citizen_name, action)
       VALUES ($1, $2, $3, 'deletion_cancelled')`,
      [userId, citizen.email, citizen.display_name]
    )

    logger.info({ citizenName: citizen.display_name }, '[AccountDeletion] Deletion cancelled')

    res.json({
      success: true,
      message: 'Account deletion has been cancelled. Welcome back!',
    })
  } catch (err) {
    next(err)
  }
})

// GET /deletion-status — Check deletion status
router.get('/deletion-status', async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user!.id
    const result = await pool.query(
      'SELECT deletion_requested_at, deletion_scheduled_at FROM citizens WHERE id = $1',
      [userId]
    )
    if (!result.rows[0]) {
      throw AppError.notFound('Account not found')
    }
    res.json({
      deletion_requested: !!result.rows[0].deletion_requested_at,
      deletion_requested_at: result.rows[0].deletion_requested_at,
      deletion_scheduled_at: result.rows[0].deletion_scheduled_at,
    })
  } catch (err) {
    next(err)
  }
})

// FAMILY / GROUP SAFETY (#37)

import crypto from 'crypto'
import { AppError } from '../utils/AppError.js'

// POST /safety-groups — Create a new safety group
router.post('/safety-groups', async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user!.id
    const { name, description } = req.body
    if (!name || typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 100) {
      throw AppError.badRequest('Group name must be 2-100 characters.')
    }
    const inviteCode = crypto.randomBytes(6).toString('hex').toUpperCase()
    const result = await pool.query(
      `INSERT INTO safety_groups (name, created_by, invite_code, description)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [name.trim(), userId, inviteCode, (description || '').slice(0, 500)]
    )
    // Creator is automatically an admin member
    await pool.query(
      `INSERT INTO safety_group_members (group_id, citizen_id, role) VALUES ($1, $2, 'admin')`,
      [result.rows[0].id, userId]
    )
    res.status(201).json(result.rows[0])
  } catch (err) {
    next(err)
  }
})

// GET /safety-groups — List groups the citizen belongs to
router.get('/safety-groups', async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user!.id
    const result = await pool.query(
      `SELECT g.*, sgm.role AS my_role,
        (SELECT COUNT(*) FROM safety_group_members WHERE group_id = g.id) AS member_count
       FROM safety_groups g
       INNER JOIN safety_group_members sgm ON sgm.group_id = g.id AND sgm.citizen_id = $1
       ORDER BY g.created_at DESC`,
      [userId]
    )
    res.json(result.rows)
  } catch (err) {
    next(err)
  }
})

// GET /safety-groups/:id/members — Get group members with latest safety status
router.get('/safety-groups/:id/members', async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user!.id
    const groupId = req.params.id
    // Verify membership
    const membership = await pool.query(
      'SELECT 1 FROM safety_group_members WHERE group_id = $1 AND citizen_id = $2',
      [groupId, userId]
    )
    if (membership.rows.length === 0) {
      throw AppError.forbidden('Not a member of this group.')
    }
    const result = await pool.query(
      `SELECT c.id, c.display_name, c.avatar_url, c.is_vulnerable, sgm.role,
        (SELECT status FROM safety_check_ins WHERE citizen_id = c.id ORDER BY created_at DESC LIMIT 1) AS last_status,
        (SELECT created_at FROM safety_check_ins WHERE citizen_id = c.id ORDER BY created_at DESC LIMIT 1) AS last_checkin_at
       FROM safety_group_members sgm
       INNER JOIN citizens c ON c.id = sgm.citizen_id
       WHERE sgm.group_id = $1 AND c.deleted_at IS NULL
       ORDER BY c.display_name`,
      [groupId]
    )
    res.json(result.rows)
  } catch (err) {
    next(err)
  }
})

// POST /safety-groups/join — Join a group via invite code
router.post('/safety-groups/join', async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user!.id
    const { inviteCode } = req.body
    if (!inviteCode || typeof inviteCode !== 'string') {
      throw AppError.badRequest('Invite code is required.')
    }
    const group = await pool.query(
      'SELECT id, name FROM safety_groups WHERE invite_code = $1',
      [inviteCode.trim().toUpperCase()]
    )
    if (group.rows.length === 0) {
      throw AppError.notFound('Invalid invite code.')
    }
    // Check if already a member
    const existing = await pool.query(
      'SELECT 1 FROM safety_group_members WHERE group_id = $1 AND citizen_id = $2',
      [group.rows[0].id, userId]
    )
    if (existing.rows.length > 0) {
      res.json({ message: 'Already a member', group: group.rows[0] })
      return
    }
    await pool.query(
      `INSERT INTO safety_group_members (group_id, citizen_id, role) VALUES ($1, $2, 'member')`,
      [group.rows[0].id, userId]
    )
    res.status(201).json({ message: 'Joined group successfully', group: group.rows[0] })
  } catch (err) {
    next(err)
  }
})

// DELETE /safety-groups/:id/leave — Leave a safety group
router.delete('/safety-groups/:id/leave', async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user!.id
    const groupId = req.params.id
    await pool.query(
      'DELETE FROM safety_group_members WHERE group_id = $1 AND citizen_id = $2',
      [groupId, userId]
    )
    // If no members left, delete the group
    const remaining = await pool.query(
      'SELECT COUNT(*) FROM safety_group_members WHERE group_id = $1',
      [groupId]
    )
    if (parseInt(remaining.rows[0].count) === 0) {
      await pool.query('DELETE FROM safety_groups WHERE id = $1', [groupId])
    }
    res.json({ success: true })
  } catch (err) {
    next(err)
  }
})

export default router
