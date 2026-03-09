/*
 * socket.ts - Real-time Socket.IO server for AEGIS Citizen ↔ Admin chat
 *
 * Features:
 *   - JWT authentication on connection (citizen or operator)
 *   - Private citizen-admin messaging rooms
 *   - Message status tracking (sent → delivered → read)
 *   - Typing indicators
 *   - Online/offline presence
 *   - Emergency chat auto-escalation (keywords: help, trapped, injured, etc.)
 *   - Admin live notifications for new messages
 *   - Vulnerable citizen priority flagging
 */

import { Server as HttpServer } from 'http'
import { Server, Socket } from 'socket.io'
import jwt from 'jsonwebtoken'
import pool from '../models/db.js'
import path from 'path'
import fs from 'fs'
import { devLog, auditLog } from '../utils/logger.js'

// Re-use the shared JWT secret (see auth.ts for production guard)
const JWT_SECRET = process.env.JWT_SECRET || (() => {
  const crypto = require('crypto') as typeof import('crypto')
  return crypto.randomBytes(64).toString('hex')
})()
const CITIZEN_ROLES = new Set(['citizen', 'verified_citizen', 'community_leader'])

/** Parse human-readable duration strings like '24h', '7d', '1w', '1m' into milliseconds */
function parseDuration(duration: string): number {
  const match = String(duration).match(/^(\d+)\s*(h|d|w|m|hours?|days?|weeks?|months?)$/i)
  if (!match) return 0
  const num = parseInt(match[1])
  const unit = match[2].toLowerCase()
  const HOUR = 3600000
  const DAY = 86400000
  if (unit.startsWith('h')) return num * HOUR
  if (unit.startsWith('d')) return num * DAY
  if (unit.startsWith('w')) return num * DAY * 7
  if (unit.startsWith('m')) return num * DAY * 30
  return 0
}

const ESCALATION_KEYWORDS = [
  'help', 'trapped', 'injured', 'drowning', 'fire', 'emergency', 'sos',
  'rescue', 'bleeding', 'collapsed', 'unconscious', 'flood', 'stranded',
  'can\'t breathe', 'chest pain', 'heart attack', 'dying', 'danger',
  'attack', 'violence', 'abuse', 'urgent'
]

interface AuthPayload {
  id: string
  email: string
  role: string
  displayName: string
  department?: string
}

// ─── In-memory map of online community chat users (keyed by socket.id) ────
const communityOnlineUsers = new Map<string, {
  userId: string
  userName: string
  isAdmin: boolean
  socketId: string
  role: string
  joinedAt: Date
}>()

// Per-user message rate limiting (in-memory, clears on restart)
const messageRateLimits = new Map<string, { count: number; resetAt: number }>()

export function initSocketServer(httpServer: HttpServer): Server {
  const io = new Server(httpServer, {
    cors: {
      origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
        const allowed = [
          'http://localhost:5173', 'http://localhost:5174', 'http://localhost:5175',
          'http://localhost:3000', 'http://127.0.0.1:5173', 'http://127.0.0.1:5174',
          process.env.CLIENT_URL,
        ].filter(Boolean)
        if (!origin || allowed.includes(origin)) callback(null, true)
        else callback(null, true) // Allow all in dev
      },
      credentials: true,
    },
    transports: ['websocket', 'polling'],
  })

  // ─── Initialize Database Tables on Startup ───────────────────────────────────
  initDb().catch(err => console.error('[Socket] Database initialization error:', err.message))

  async function initDb() {
    try {
      // Ensure message_threads table exists
      await pool.query(`
        CREATE TABLE IF NOT EXISTS message_threads (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          citizen_id UUID NOT NULL,
          subject VARCHAR(200) NOT NULL,
          status VARCHAR(20) NOT NULL DEFAULT 'open',
          priority VARCHAR(20) NOT NULL DEFAULT 'normal',
          assigned_to UUID,
          is_emergency BOOLEAN NOT NULL DEFAULT false,
          auto_escalated BOOLEAN NOT NULL DEFAULT false,
          escalation_keywords TEXT[],
          last_message_at TIMESTAMPTZ,
          citizen_unread INTEGER NOT NULL DEFAULT 0,
          operator_unread INTEGER NOT NULL DEFAULT 0,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `)

      // Ensure messages table exists
      await pool.query(`
        CREATE TABLE IF NOT EXISTS messages (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          thread_id UUID NOT NULL,
          sender_type VARCHAR(20) NOT NULL,
          sender_id UUID NOT NULL,
          content TEXT,
          attachment_url TEXT,
          attachment_type VARCHAR(50),
          status VARCHAR(20) NOT NULL DEFAULT 'sent',
          delivered_at TIMESTAMPTZ,
          read_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `)

      // Ensure direct-message attachment columns exist for older databases
      await pool.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS attachment_url TEXT`).catch(() => {})
      await pool.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS attachment_type VARCHAR(50)`).catch(() => {})
      await pool.query(`ALTER TABLE messages ALTER COLUMN content DROP NOT NULL`).catch(() => {})

      // Ensure community_chat_messages table exists
      await pool.query(`
        CREATE TABLE IF NOT EXISTS community_chat_messages (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          sender_id UUID NOT NULL,
          sender_type VARCHAR(20) NOT NULL DEFAULT 'citizen',
          content TEXT,
          image_url TEXT,
          reply_to_id UUID,
          deleted_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `)

      // Add new columns to community_chat_messages if they don't exist
      await pool.query(`ALTER TABLE community_chat_messages ADD COLUMN IF NOT EXISTS image_url TEXT`)
      await pool.query(`ALTER TABLE community_chat_messages ADD COLUMN IF NOT EXISTS reply_to_id UUID`)
      // Add read_by column to track who read each message
      await pool.query(`ALTER TABLE community_chat_messages ADD COLUMN IF NOT EXISTS read_by JSONB DEFAULT '[]'::jsonb`)
      // Make content nullable for image-only messages
      await pool.query(`ALTER TABLE community_chat_messages ALTER COLUMN content DROP NOT NULL`)

      // Ensure user_presence table exists
      await pool.query(`
        CREATE TABLE IF NOT EXISTS user_presence (
          user_id UUID PRIMARY KEY,
          user_type VARCHAR(20) NOT NULL DEFAULT 'citizen',
          is_online BOOLEAN NOT NULL DEFAULT false,
          last_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
          socket_id VARCHAR(50)
        )
      `)

      // Ensure community_posts table exists
      await pool.query(`
        CREATE TABLE IF NOT EXISTS community_posts (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          author_id UUID NOT NULL,
          content TEXT NOT NULL,
          image_url VARCHAR(500),
          location VARCHAR(255),
          is_hazard_update BOOLEAN DEFAULT false,
          deleted_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `)

      // Ensure community_comments table exists
      await pool.query(`
        CREATE TABLE IF NOT EXISTS community_comments (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          post_id UUID NOT NULL,
          author_id UUID NOT NULL,
          content TEXT NOT NULL,
          image_url VARCHAR(500),
          deleted_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `)

      // Ensure community_post_likes table exists
      await pool.query(`
        CREATE TABLE IF NOT EXISTS community_post_likes (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          post_id UUID NOT NULL,
          user_id UUID NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          UNIQUE(post_id, user_id)
        )
      `)

      // Ensure community_post_shares table exists
      await pool.query(`
        CREATE TABLE IF NOT EXISTS community_post_shares (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          post_id UUID NOT NULL,
          user_id UUID NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `)

      // Add category column if missing (migration for existing DBs)
      await pool.query('ALTER TABLE message_threads ADD COLUMN IF NOT EXISTS category VARCHAR(50) NOT NULL DEFAULT \'general\'').catch(() => {})

      devLog('[Socket] Database tables initialized successfully')
    } catch (err: any) {
      // Tables might already exist or have different definitions, which is OK
      if (!err.message?.includes('already exists')) {
        console.warn('[Socket] Table initialization warning:', err.message)
      }
    }
  }

  // ─── JWT Authentication Middleware ──────────────────────────────────────────
  io.use((socket, next) => {
    const token = socket.handshake.auth.token || socket.handshake.headers.authorization?.replace('Bearer ', '')
    if (!token) return next(new Error('Authentication required'))

    try {
      const decoded = jwt.verify(token, JWT_SECRET) as AuthPayload
      ;(socket as any).user = decoded
      next()
    } catch {
      next(new Error('Invalid token'))
    }
  })

  io.on('connection', async (socket: Socket) => {
    let user = (socket as any).user as AuthPayload
    const roleLower = String(user.role || '').toLowerCase()
    // isAdmin: any non-citizen role (operator, responder, supervisor, admin, etc.) can use admin socket features
    const isAdmin = !CITIZEN_ROLES.has(roleLower)
    // isStrictAdmin: only the explicit 'admin' role for highly privileged operations (ban, mass moderation)
    // Note: this intentionally differs from isSuperAdmin() in adminCommunityRoutes.ts which also
    // grants elevated access based on department === 'Command & Control'. Socket-level bans use
    // role-only checks to avoid trusting user-supplied department strings from the JWT.
    const isStrictAdmin = roleLower === 'admin'

    // Normalize token identity to an existing DB row to avoid orphan sender_id values
    try {
      const table = isAdmin ? 'operators' : 'citizens'
      let resolved = await pool.query(
        `SELECT id, display_name, role, email, ${isAdmin ? 'department' : 'NULL::text as department'} FROM ${table} WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
        [user.id]
      )

      if (resolved.rows.length === 0 && user.email) {
        resolved = await pool.query(
          `SELECT id, display_name, role, email, ${isAdmin ? 'department' : 'NULL::text as department'} FROM ${table} WHERE LOWER(email) = LOWER($1) AND deleted_at IS NULL LIMIT 1`,
          [user.email]
        )
      }

      if (resolved.rows[0]) {
        user = {
          ...user,
          id: resolved.rows[0].id,
          email: resolved.rows[0].email || user.email,
          displayName: resolved.rows[0].display_name || user.displayName,
          role: resolved.rows[0].role || user.role,
          department: resolved.rows[0].department || user.department,
        }
        ;(socket as any).user = user
      } else {
        socket.emit('auth:error', { message: 'Session no longer matches an active account. Please sign in again.' })
        socket.disconnect(true)
        return
      }
    } catch (err: any) {
      console.error('[Socket] user normalization error:', err.message)
      socket.disconnect(true)
      return
    }

    // Store user on socket.data for room introspection (community chat online list)
    socket.data.user = user

    devLog(`[Socket] ${user.role} ${user.displayName} connected (${socket.id})`)

    // ── Update presence ────────────────────────────────────────────────
    try {
      await pool.query(
        `INSERT INTO user_presence (user_id, user_type, is_online, last_seen, socket_id)
         VALUES ($1, $2, true, NOW(), $3)
         ON CONFLICT (user_id) DO UPDATE 
         SET is_online = true, last_seen = NOW(), socket_id = $3`,
        [user.id, isAdmin ? 'operator' : 'citizen', socket.id]
      )
    } catch {}

    // ── Join rooms ─────────────────────────────────────────────────────
    // Citizens join their own room; admins join admin room
    socket.join(`user:${user.id}`)
    if (isAdmin) {
      socket.join('admins')
      // Send all unresolved threads to admin on connect
      try {
        const threads = await pool.query(
          `SELECT t.*, c.display_name as citizen_name, c.is_vulnerable, c.avatar_url as citizen_avatar,
                  c.phone as citizen_phone, c.email as citizen_email,
                  (SELECT COALESCE(content, CASE WHEN attachment_url IS NOT NULL THEN '[Image]' ELSE '[Message]' END)
                   FROM messages WHERE thread_id = t.id ORDER BY created_at DESC LIMIT 1) as last_message
           FROM message_threads t
           JOIN citizens c ON t.citizen_id = c.id
           WHERE t.status IN ('open', 'in_progress')
           ORDER BY 
             t.is_emergency DESC,
             c.is_vulnerable DESC,
             t.priority DESC,
             t.updated_at DESC`
        )
        devLog(`[Socket] Sending ${threads.rows.length} threads to admin ${user.displayName}`)
        socket.emit('admin:threads', threads.rows)
      } catch (err: any) {
        console.error('[Socket] Failed to load admin threads:', err.message)
      }
    } else {
      // Citizen joins their thread rooms
      try {
        const threads = await pool.query(
          `SELECT id FROM message_threads WHERE citizen_id = $1 AND status != 'closed'`,
          [user.id]
        )
        threads.rows.forEach(t => socket.join(`thread:${t.id}`))
      } catch {}
    }

    // ── Send Message ───────────────────────────────────────────────────
    socket.on('message:send', async (data: { threadId: string; content?: string; attachmentUrl?: string; attachment_url?: string }, ack?: Function) => {
      try {
        const { threadId } = data
        const content = data?.content?.trim() || null
        const attachmentUrl = data?.attachmentUrl || data?.attachment_url || null
        if (!content && !attachmentUrl) {
          if (ack) ack({ success: false, error: 'Empty message' })
          return
        }

        // Verify access
        const threadCheck = await pool.query(
          `SELECT t.*, c.is_vulnerable FROM message_threads t 
           JOIN citizens c ON t.citizen_id = c.id
           WHERE t.id = $1`,
          [threadId]
        )
        if (threadCheck.rows.length === 0) {
          if (ack) ack({ success: false, error: 'Thread not found' })
          return
        }

        const thread = threadCheck.rows[0]

        // Citizens can only access their own threads
        if (!isAdmin && thread.citizen_id !== user.id) {
          if (ack) ack({ success: false, error: 'Access denied' })
          return
        }
        // Admins can access any thread
        if (isAdmin && thread.status === 'closed') {
          if (ack) ack({ success: false, error: 'Thread is closed' })
          return
        }

        const senderType = isAdmin ? 'operator' : 'citizen'

        // Insert message
        const msgResult = await pool.query(
          `INSERT INTO messages (thread_id, sender_type, sender_id, content, attachment_url, attachment_type, status)
           VALUES ($1, $2, $3, $4, $5, $6, 'sent')
           RETURNING *`,
          [threadId, senderType, user.id, content, attachmentUrl, attachmentUrl ? 'image' : null]
        )
        const msg = msgResult.rows[0]
        const threadPreview = content || '[Image]'

        // Check for emergency keywords (citizen messages only)
        let isEmergency = false
        if (!isAdmin) {
          const lowerContent = (content || '').toLowerCase()
          const matchedKeywords = ESCALATION_KEYWORDS.filter(kw => lowerContent.includes(kw))
          if (matchedKeywords.length > 0 || thread.is_vulnerable) {
            isEmergency = true
            await pool.query(
              `UPDATE message_threads SET is_emergency = true, auto_escalated = true,
                      escalation_keywords = $2, priority = 'urgent'
               WHERE id = $1`,
              [threadId, matchedKeywords]
            )
          }
        }

        // Update thread metadata
        if (isAdmin) {
          await pool.query(
            `UPDATE message_threads SET last_message_at = NOW(), citizen_unread = citizen_unread + 1,
                    status = CASE WHEN status = 'open' THEN 'in_progress' ELSE status END,
                    assigned_to = COALESCE(assigned_to, $2)
             WHERE id = $1`,
            [threadId, user.id]
          )
        } else {
          await pool.query(
            `UPDATE message_threads SET last_message_at = NOW(), operator_unread = operator_unread + 1,
                    status = 'open'
             WHERE id = $1`,
            [threadId]
          )
        }

        // Broadcast to thread room
        const broadcastMsg = {
          ...msg,
          sender_name: user.displayName,
          sender_role: user.role,
          is_emergency: isEmergency,
        }

        // Broadcast to OTHER users in thread (not sender - they get it from ack)
        socket.to(`thread:${threadId}`).emit('message:new', broadcastMsg)

        // Notify admins of new citizen messages
        if (!isAdmin) {
          io.to('admins').emit('admin:new_message', {
            threadId,
            message: broadcastMsg,
            citizenName: user.displayName,
            isVulnerable: thread.is_vulnerable,
            isEmergency,
            priority: isEmergency ? 'urgent' : thread.priority,
            preview: threadPreview,
          })
        }

        // Notify citizen of admin reply
        if (isAdmin) {
          io.to(`user:${thread.citizen_id}`).emit('citizen:new_reply', {
            threadId,
            message: broadcastMsg,
          })

          // Emit updated total unread count to citizen (#35)
          const unreadResult = await pool.query(
            'SELECT COALESCE(SUM(citizen_unread), 0)::int as total FROM message_threads WHERE citizen_id = $1',
            [thread.citizen_id]
          )
          io.to(`user:${thread.citizen_id}`).emit('citizen:unread_count', {
            total: unreadResult.rows[0]?.total || 0,
          })
        }

        // Mark as delivered if recipient is online
        const recipientId = isAdmin ? thread.citizen_id : null
        if (recipientId) {
          const presence = await pool.query(
            'SELECT is_online FROM user_presence WHERE user_id = $1',
            [recipientId]
          )
          if (presence.rows[0]?.is_online) {
            await pool.query(
              `UPDATE messages SET status = 'delivered', delivered_at = NOW() WHERE id = $1`,
              [msg.id]
            )
            io.to(`thread:${threadId}`).emit('message:status', {
              messageId: msg.id, status: 'delivered',
            })
          }
        }

        if (ack) ack({ success: true, message: broadcastMsg })
      } catch (err: any) {
        console.error('[Socket] message:send error:', err.message)
        if (ack) ack({ success: false, error: err.message })
      }
    })

    // ── Create Thread ──────────────────────────────────────────────────
    socket.on('thread:create', async (data: { subject: string; category?: string; message: string; isEmergency?: boolean }, ack?: Function) => {
      try {
        if (isAdmin) {
          if (ack) ack({ success: false, error: 'Only citizens can create threads' })
          return
        }
        const { subject, category, message, isEmergency: emergency } = data
        if (!subject?.trim() || !message?.trim()) {
          if (ack) ack({ success: false, error: 'Subject and message are required' })
          return
        }

        // Limit active threads
        const countResult = await pool.query(
          `SELECT COUNT(*) as cnt FROM message_threads WHERE citizen_id = $1 AND status IN ('open','in_progress')`,
          [user.id]
        )
        if (parseInt(countResult.rows[0].cnt) >= 10) {
          if (ack) ack({ success: false, error: 'Too many active threads' })
          return
        }

        // Check for emergency keywords
        const lowerMsg = message.toLowerCase()
        const matchedKeywords = ESCALATION_KEYWORDS.filter(kw => lowerMsg.includes(kw))
        const isEm = emergency || matchedKeywords.length > 0

        // Check if citizen is vulnerable
        const citizenCheck = await pool.query('SELECT is_vulnerable FROM citizens WHERE id = $1', [user.id])
        const isVulnerable = citizenCheck.rows[0]?.is_vulnerable || false

        const threadResult = await pool.query(
          `INSERT INTO message_threads (citizen_id, subject, category, last_message_at, operator_unread, is_emergency, auto_escalated, escalation_keywords, priority)
           VALUES ($1, $2, $3, NOW(), 1, $4, $5, $6, $7)
           RETURNING *`,
          [
            user.id, subject.trim(), category || 'general',
            isEm || isVulnerable, isEm,
            matchedKeywords.length > 0 ? matchedKeywords : null,
            (isEm || isVulnerable) ? 'urgent' : 'normal',
          ]
        )
        const thread = threadResult.rows[0]

        // Insert first message
        await pool.query(
          `INSERT INTO messages (thread_id, sender_type, sender_id, content, status)
           VALUES ($1, 'citizen', $2, $3, 'sent')`,
          [thread.id, user.id, message.trim()]
        )

        // Join the new thread room
        socket.join(`thread:${thread.id}`)

        // Build enriched thread object
        const enrichedThread = {
          ...thread,
          citizen_name: user.displayName,
          is_vulnerable: isVulnerable,
          last_message: message.trim(),
        }

        // Notify the citizen who created the thread (so their list updates instantly)
        socket.emit('thread:created', enrichedThread)

        // Notify admins
        io.to('admins').emit('admin:new_thread', enrichedThread)

        if (ack) ack({ success: true, thread: enrichedThread })
      } catch (err: any) {
        console.error('[Socket] thread:create error:', err.message)
        if (ack) ack({ success: false, error: err.message })
      }
    })

    // ── Typing Indicator ───────────────────────────────────────────────
    // Track typing timers to auto-clear stale indicators
    const typingTimers = new Map<string, ReturnType<typeof setTimeout>>()

    socket.on('typing:start', (data: { threadId: string }) => {
      if (!data?.threadId) return
      const key = `${user.id}:${data.threadId}`
      // Clear existing timer if re-triggered
      const existing = typingTimers.get(key)
      if (existing) clearTimeout(existing)
      socket.to(`thread:${data.threadId}`).emit('typing:start', {
        threadId: data.threadId, userId: user.id, displayName: user.displayName, role: user.role,
      })
      // Auto-clear typing indicator after 30 seconds
      typingTimers.set(key, setTimeout(() => {
        io.to(`thread:${data.threadId}`).emit('typing:stop', { threadId: data.threadId, userId: user.id })
        typingTimers.delete(key)
      }, 30000))
    })

    socket.on('typing:stop', (data: { threadId: string }) => {
      if (!data?.threadId) return
      const key = `${user.id}:${data.threadId}`
      const existing = typingTimers.get(key)
      if (existing) { clearTimeout(existing); typingTimers.delete(key) }
      socket.to(`thread:${data.threadId}`).emit('typing:stop', {
        threadId: data.threadId, userId: user.id,
      })
    })

    // ── Mark Messages as Read ──────────────────────────────────────────
    socket.on('messages:read', async (data: { threadId: string }) => {
      try {
        const { threadId } = data
        const senderType = isAdmin ? 'citizen' : 'operator'

        // Mark messages from the OTHER side as read
        const updated = await pool.query(
          `UPDATE messages SET status = 'read', read_at = NOW()
           WHERE thread_id = $1 AND sender_type = $2 AND read_at IS NULL
           RETURNING id`,
          [threadId, senderType]
        )

        // Reset unread counter
        if (isAdmin) {
          await pool.query('UPDATE message_threads SET operator_unread = 0 WHERE id = $1', [threadId])
        } else {
          await pool.query('UPDATE message_threads SET citizen_unread = 0 WHERE id = $1', [threadId])
        }

        // Fetch updated thread and broadcast to all connected clients
        const threadResult = await pool.query(
          `SELECT * FROM message_threads WHERE id = $1`,
          [threadId]
        )
        if (threadResult.rows[0]) {
          io.to(`thread:${threadId}`).emit('thread:updated', threadResult.rows[0])
          // Also emit to the user's personal room in case they're not in the thread room yet
          socket.emit('thread:updated', threadResult.rows[0])
        }

        // Notify sender that messages were read
        updated.rows.forEach(msg => {
          io.to(`thread:${threadId}`).emit('message:status', {
            messageId: msg.id, status: 'read',
          })
        })
      } catch {}
    })

    // ── Join Thread Room ───────────────────────────────────────────────
    socket.on('thread:join', async (data: { threadId: string }) => {
      const { threadId } = data
      devLog(`[Socket] ${user.role} ${user.displayName} requesting to join thread:${threadId}`)
      // Verify access
      const check = await pool.query(
        isAdmin
          ? `SELECT id FROM message_threads WHERE id = $1`
          : `SELECT id FROM message_threads WHERE id = $1 AND citizen_id = $2`,
        isAdmin ? [threadId] : [threadId, user.id]
      )
      if (check.rows.length > 0) {
        socket.join(`thread:${threadId}`)
        devLog(`[Socket] ${user.role} ${user.displayName} joined thread:${threadId}`)
      } else {
        console.warn(`[Socket] ${user.role} ${user.displayName} denied access to thread:${threadId}`)
      }
    })

    // ── Load Thread Messages ───────────────────────────────────────────
    socket.on('thread:messages', async (data: { threadId: string }, ack?: Function) => {
      try {
        const { threadId } = data
        // Verify access
        const check = await pool.query(
          isAdmin
            ? `SELECT id FROM message_threads WHERE id = $1`
            : `SELECT id FROM message_threads WHERE id = $1 AND citizen_id = $2`,
          isAdmin ? [threadId] : [threadId, user.id]
        )
        if (check.rows.length === 0) return

        const msgs = await pool.query(
          `SELECT m.*, 
                  CASE WHEN m.sender_type = 'citizen' THEN c.display_name ELSE o.display_name END as sender_name,
                  CASE WHEN m.sender_type = 'citizen' THEN NULL ELSE COALESCE(o.role::text, 'operator') END as sender_role
           FROM messages m
           LEFT JOIN citizens c ON m.sender_type = 'citizen' AND m.sender_id = c.id
           LEFT JOIN operators o ON m.sender_type = 'operator' AND m.sender_id = o.id
           WHERE m.thread_id = $1
           ORDER BY m.created_at ASC
           LIMIT 200`,
          [threadId]
        )

        socket.emit('thread:messages', { threadId, messages: msgs.rows })
        if (ack) ack(msgs.rows)
      } catch (err: any) {
        console.error('[Socket] thread:messages error:', err.message)
      }
    })

    // ── Citizen: Get my threads ────────────────────────────────────────
    socket.on('citizen:get_threads', async (ack?: Function) => {
      if (isAdmin) return
      try {
        const threads = await pool.query(
          `SELECT t.*,
                  (SELECT COALESCE(content, CASE WHEN attachment_url IS NOT NULL THEN '[Image]' ELSE '[Message]' END)
                   FROM messages WHERE thread_id = t.id ORDER BY created_at DESC LIMIT 1) as last_message
           FROM message_threads t
           WHERE t.citizen_id = $1
           ORDER BY t.updated_at DESC`,
          [user.id]
        )
        socket.emit('citizen:threads', threads.rows)
        if (ack) ack(threads.rows)
      } catch {}
    })

    // ── Admin: Get all threads ─────────────────────────────────────────
    socket.on('admin:get_threads', async (ack?: Function) => {
      if (!isAdmin) return
      devLog(`[Socket] admin:get_threads requested by ${user.displayName}`)
      try {
        const threads = await pool.query(
          `SELECT t.*, c.display_name as citizen_name, c.is_vulnerable, c.avatar_url as citizen_avatar,
                  c.phone as citizen_phone, c.email as citizen_email,
                  (SELECT COALESCE(content, CASE WHEN attachment_url IS NOT NULL THEN '[Image]' ELSE '[Message]' END)
                   FROM messages WHERE thread_id = t.id ORDER BY created_at DESC LIMIT 1) as last_message
           FROM message_threads t
           JOIN citizens c ON t.citizen_id = c.id
           WHERE t.status IN ('open', 'in_progress')
           ORDER BY 
             t.is_emergency DESC,
             c.is_vulnerable DESC,
             t.priority DESC,
             t.updated_at DESC`
        )
        if (ack) ack(threads.rows)
        else socket.emit('admin:threads', threads.rows)
      } catch {}
    })

    // ── Admin: Assign thread to self ───────────────────────────────────
    socket.on('admin:assign_thread', async (data: { threadId: string, operatorId?: string }, ack?: Function) => {
      if (!isAdmin) return
      try {
        const assignTo = data.operatorId || user.id
        await pool.query(
          `UPDATE message_threads SET assigned_to = $1, status = 'in_progress', updated_at = NOW() WHERE id = $2`,
          [assignTo, data.threadId]
        )
        socket.join(`thread:${data.threadId}`)
        devLog(`[Socket] Thread ${data.threadId} assigned to ${user.displayName}`)
        io.to('admins').emit('admin:thread_assigned', { threadId: data.threadId, operatorId: assignTo, operatorName: user.displayName })
        if (ack) ack({ success: true })
      } catch (err: any) {
        console.error('[Socket] assign_thread error:', err.message)
        if (ack) ack({ success: false, error: err.message })
      }
    })

    // ── Admin: Resolve thread ──────────────────────────────────────────
    socket.on('admin:resolve_thread', async (data: { threadId: string }, ack?: Function) => {
      if (!isAdmin) return
      try {
        await pool.query(
          `UPDATE message_threads SET status = 'closed', updated_at = NOW() WHERE id = $1`,
          [data.threadId]
        )
        devLog(`[Socket] Thread ${data.threadId} closed by ${user.displayName}`)
        io.to(`thread:${data.threadId}`).emit('thread:resolved', { threadId: data.threadId, status: 'closed' })
        io.to('admins').emit('admin:thread_resolved', { threadId: data.threadId, status: 'closed', operatorName: user.displayName })
        if (ack) ack({ success: true })
      } catch (err: any) {
        console.error('[Socket] resolve_thread error:', err.message)
        if (ack) ack({ success: false, error: err.message })
      }
    })

    // ═══════════════════════════════════════════════════════════════════════════
    // COMMUNITY CHAT ROOM — Real-time group chat for all users
    // ═══════════════════════════════════════════════════════════════════════════

    const getCommunityOnlineUsers = () => {
      const users: any[] = []
      const seen = new Set<string>()
      for (const entry of communityOnlineUsers.values()) {
        if (seen.has(entry.userId)) continue
        seen.add(entry.userId)
        users.push({
          userId: entry.userId,
          displayName: entry.userName,
          role: entry.role,
        })
      }
      return users
    }

    const emitCommunityOnlineUsers = () => {
      try {
        const users = getCommunityOnlineUsers()
        io.to('community-chat').emit('community:chat:online_update', { users })
      } catch {}
    }

    devLog(`[Socket] Registering community chat handlers for ${user.displayName} (${socket.id})`)

    socket.on('community:chat:join', async (ack?: Function) => {
      devLog(`[CommunityChat] JOIN REQUEST from ${user.displayName} (socket ${socket.id}) isAdmin: ${isAdmin}`)

      // Check if user is banned
      try {
        const banCheck = await pool.query(
          `SELECT * FROM community_bans WHERE user_id = $1 AND (is_permanent = true OR expires_at > NOW())`,
          [user.id]
        )
        if (banCheck.rows.length > 0) {
          const ban = banCheck.rows[0]
          devLog(`[CommunityChat] ${user.displayName} is banned from community chat`)
          if (ack) ack({
            success: false,
            banned: true,
            reason: ban.reason || 'You have been banned from community chat.',
            permanent: ban.is_permanent,
            expires_at: ban.expires_at,
          })
          return
        }
      } catch (err: any) {
        console.error('[CommunityChat] Ban check error:', err.message)
      }

      socket.join('community-chat')

      // Add to online map
      communityOnlineUsers.set(socket.id, {
        userId: user.id,
        userName: user.displayName,
        isAdmin,
        socketId: socket.id,
        role: user.department || user.role || 'citizen',
        joinedAt: new Date(),
      })

      const onlineList = getCommunityOnlineUsers()
      devLog(`[CommunityChat] ${user.displayName} joined. Online: ${onlineList.length}`)

      socket.to('community-chat').emit('community:chat:user_joined', {
        userId: user.id, displayName: user.displayName, role: user.department || user.role
      })

      // Broadcast updated online list to ALL users in room
      io.to('community-chat').emit('community:chat:online_update', { users: onlineList })

      if (ack) ack({ success: true, users: onlineList })
    })

    socket.on('community:chat:leave', () => {
      socket.leave('community-chat')
      communityOnlineUsers.delete(socket.id)
      socket.to('community-chat').emit('community:chat:user_left', { userId: user.id, displayName: user.displayName })
      emitCommunityOnlineUsers()
    })

    socket.on('community:chat:history', async (data: any, ack?: Function) => {
      try {
        const limit = Math.min(Math.max(parseInt(data?.limit) || 50, 1), 200) // Cap at 200
        const before = data?.before // optional ISO timestamp for pagination
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
          query += ` AND cm.created_at < $${params.length + 1}`
          params.push(before)
        }
        query += ` ORDER BY cm.created_at DESC LIMIT $${params.length + 1}`
        params.push(limit)

        const result = await pool.query(query, params)
        // Return in chronological order
        if (ack) ack({ success: true, messages: result.rows.reverse() })
      } catch (err: any) {
        console.error('[CommunityChat] history error:', err.message)
        if (ack) ack({ success: false, error: err.message })
      }
    })

    socket.on('community:chat:send', async (data: any, ack?: Function) => {
      const content = data?.content?.trim() || ''
      const imageUrl = data?.image_url || null
      const replyToId = data?.reply_to_id || null

      if (!content && !imageUrl) {
        if (ack) ack({ success: false, error: 'Empty message' });
        return
      }

      // Enforce message length limit (#81)
      if (content.length > 5000) {
        if (ack) ack({ success: false, error: 'Message too long. Maximum 5000 characters.' });
        return
      }

      // Rate limiting: max 15 messages per minute per user
      {
        const now = Date.now()
        const limiter = messageRateLimits.get(user.id) || { count: 0, resetAt: now + 60000 }
        if (now > limiter.resetAt) { limiter.count = 0; limiter.resetAt = now + 60000 }
        if (limiter.count >= 15) {
          if (ack) ack({ success: false, error: 'Rate limit exceeded. Max 15 messages per minute.' })
          return
        }
        limiter.count++
        messageRateLimits.set(user.id, limiter)
      }

      // Check if user is muted
      try {
        const muteCheck = await pool.query(
          `SELECT * FROM community_mutes WHERE user_id = $1 AND expires_at > NOW()`,
          [user.id]
        )
        if (muteCheck.rows.length > 0) {
          const mute = muteCheck.rows[0]
          if (ack) ack({
            success: false,
            muted: true,
            error: `You are muted until ${new Date(mute.expires_at).toLocaleString()}. Reason: ${mute.reason || 'Violation of community guidelines'}`,
            expires_at: mute.expires_at,
          })
          return
        }
      } catch (err: any) {
        console.error('[CommunityChat] Mute check error:', err.message)
      }
      
      try {
        const senderType = isAdmin ? 'operator' : 'citizen'
        const result = await pool.query(
          `INSERT INTO community_chat_messages (sender_id, sender_type, content, image_url, reply_to_id)
           VALUES ($1, $2, $3, $4, $5) RETURNING *`,
          [user.id, senderType, content || null, imageUrl, replyToId]
        )
        const msg = result.rows[0]
        
        // If replying, fetch the reply info
        let replyContent = null, replySenderName = null
        if (replyToId) {
          const replyResult = await pool.query(
            `SELECT cm.content,
                    CASE WHEN cm.sender_type = 'citizen' THEN c.display_name ELSE o.display_name END as sender_name
             FROM community_chat_messages cm
             LEFT JOIN citizens c ON cm.sender_type = 'citizen' AND cm.sender_id = c.id
             LEFT JOIN operators o ON cm.sender_type = 'operator' AND cm.sender_id = o.id
             WHERE cm.id = $1`, [replyToId]
          )
          if (replyResult.rows[0]) {
            replyContent = replyResult.rows[0].content
            replySenderName = replyResult.rows[0].sender_name
          }
        }
        const resolved = await pool.query(
          `SELECT cm.id, cm.sender_id, cm.sender_type, cm.content, cm.image_url, cm.reply_to_id, cm.created_at, cm.deleted_at, cm.read_by,
                  COALESCE(
                    CASE WHEN cm.sender_type = 'citizen' THEN c.display_name ELSE o.display_name END,
                    c.display_name,
                    o.display_name,
                    $2,
                    'Anonymous User'
                  ) as sender_name,
                  CASE
                    WHEN cm.sender_type = 'citizen' THEN 'citizen'
                    ELSE COALESCE(NULLIF(o.department, ''), o.role::text, $3, 'operator')
                  END as sender_role,
                  COALESCE(c.avatar_url, o.avatar_url) as sender_avatar
           FROM community_chat_messages cm
           LEFT JOIN citizens c ON cm.sender_id = c.id
           LEFT JOIN operators o ON cm.sender_id = o.id
           WHERE cm.id = $1`,
          [msg.id, user.displayName || null, isAdmin ? (user.department || user.role) : null]
        )

        const payload = {
          ...(resolved.rows[0] || msg),
          reply_content: replyContent,
          reply_sender_name: replySenderName,
        }
        // Broadcast to whole room for reliable realtime sync across all clients
        io.to('community-chat').emit('community:chat:message', payload)

        // Also emit notification to ALL connected sockets (for users not in community tab)
        // This allows CitizenDashboard/AdminPage to show notification badges
        io.emit('community:chat:notification', {
          type: 'new_message',
          senderId: user.id,
          senderName: payload.sender_name,
          preview: (content || '').substring(0, 60) || '(image)',
          timestamp: payload.created_at,
        })

        if (ack) {
          ack({ success: true, message: payload })
        }
      } catch (err: any) {
        console.error('[CommunityChat] send error:', err.message)
        if (ack) ack({ success: false, error: err.message })
      }
    })

    socket.on('community:chat:delete', async (data: any, ack?: Function) => {
      const { messageId, reason } = data || {}
      
      // Don't allow deleting temporary messages
      if (!messageId || messageId.startsWith('tmp-')) { 
        if (ack) ack({ success: false, error: 'Invalid message ID' }); 
        return
      }
      
      try {
        // Only message owner or admin can delete
        const check = await pool.query(
          `SELECT sender_id, sender_type, image_url FROM community_chat_messages WHERE id = $1 AND deleted_at IS NULL`, [messageId]
        )
        if (check.rows.length === 0) { 
          if (ack) ack({ success: false, error: 'Not found' }); 
          return 
        }
        const isOwnMessage = check.rows[0].sender_id === user.id
        if (!isOwnMessage && !isAdmin) {
          if (ack) ack({ success: false, error: 'Unauthorized' }); 
          return
        }

        // Delete image file from storage if exists
        const imageUrl = check.rows[0].image_url
        if (imageUrl) {
          try {
            const filePath = path.join(process.cwd(), imageUrl)
            if (fs.existsSync(filePath)) {
              fs.unlinkSync(filePath)
            }
          } catch (imgErr: any) {
            console.error('[CommunityChat] Image delete error:', imgErr.message)
          }
        }

        // Store deletion with audit info
        const deleteReason = (isAdmin && !isOwnMessage && reason) ? reason : null
        const deletedBy = (isAdmin && !isOwnMessage) ? user.id : check.rows[0].sender_id

        await pool.query(
          `UPDATE community_chat_messages 
           SET deleted_at = NOW(), 
               deleted_by = $2, 
               delete_reason = $3
           WHERE id = $1`,
          [messageId, deletedBy, deleteReason]
        )

        // Broadcast deletion with audit info so clients can show notification
        io.to('community-chat').emit('community:chat:deleted', {
          messageId,
          deletedBy: (isAdmin && !isOwnMessage) ? user.id : null,
          deletedByName: (isAdmin && !isOwnMessage) ? user.displayName : null,
          reason: deleteReason,
          originalSenderName: check.rows[0].sender_id !== user.id ? null : undefined,
        })
        if (ack) ack({ success: true })
      } catch (err: any) {
        console.error('[CommunityChat] delete error:', err.message)
        if (ack) ack({ success: false, error: err.message })
      }
    })


    // ── Edit Message ─────────────────────────────────────────────────
    socket.on('community:chat:edit', async (data: any, ack?: Function) => {
      const { messageId, content } = data || {}
      if (!messageId || !content?.trim()) { if (ack) ack({ success: false, error: 'Missing data' }); return }
      try {
        // Only message owner can edit
        const check = await pool.query(
          `SELECT sender_id FROM community_chat_messages WHERE id = $1 AND deleted_at IS NULL`, [messageId]
        )
        if (check.rows.length === 0) { if (ack) ack({ success: false, error: 'Not found' }); return }
        if (check.rows[0].sender_id !== user.id) {
          if (ack) ack({ success: false, error: 'Unauthorized' }); return
        }
        await pool.query(
          `UPDATE community_chat_messages SET content = $1, edited_at = NOW() WHERE id = $2`,
          [content.trim(), messageId]
        )
        io.to('community-chat').emit('community:chat:edited', {
          messageId, content: content.trim(), edited_at: new Date().toISOString()
        })
        if (ack) ack({ success: true })
      } catch (err: any) {
        console.error('[CommunityChat] edit error:', err.message)
        if (ack) ack({ success: false, error: err.message })
      }
    })

    // ── Report Message ───────────────────────────────────────────────
    socket.on('community:chat:report', async (data: any, ack?: Function) => {
      const { messageId, reason, details } = data || {}
      if (!messageId || !reason) { if (ack) ack({ success: false, error: 'Missing data' }); return }
      try {
        await pool.query(
          `INSERT INTO community_reports (reporter_id, reporter_type, target_type, target_id, reason, details)
           VALUES ($1, $2, 'chat_message', $3, $4, $5)`,
          [user.id, isAdmin ? 'operator' : 'citizen', messageId, reason, details || null]
        )
        // Notify admins
        io.to('admins').emit('community:report:new', {
          reporterId: user.id,
          reporterName: user.displayName,
          targetType: 'chat_message',
          targetId: messageId,
          reason,
        })
        if (ack) ack({ success: true })
      } catch (err: any) {
        console.error('[CommunityChat] report error:', err.message)
        if (ack) ack({ success: false, error: err.message })
      }
    })

    socket.on('community:chat:typing', () => {
      socket.to('community-chat').emit('community:chat:typing', {
        userId: user.id, displayName: user.displayName
      })
    })

    socket.on('community:chat:stop_typing', () => {
      socket.to('community-chat').emit('community:chat:stop_typing', { userId: user.id })
    })

    // ── Mark Messages as Read ────────────────────────────────────────
    socket.on('community:chat:mark_read', async (data: any, ack?: Function) => {
      try {
        const { messageIds } = data || {}
        if (!Array.isArray(messageIds) || messageIds.length === 0) {
          if (ack) ack({ success: false, error: 'No message IDs provided' })
          return
        }

        // Filter out messages already read by this user
        const checkResult = await pool.query(
          `SELECT id, sender_id, read_by FROM community_chat_messages 
           WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL`,
          [messageIds]
        )

        const messagesToUpdate: string[] = []
        const updatedMessages: any[] = []

        for (const row of checkResult.rows) {
          // Don't mark own messages as read
          if (row.sender_id === user.id) continue

          const readBy = row.read_by || []
          // Check if user already marked as read
          const alreadyRead = readBy.some((r: any) => 
            r.user_id === user.id && r.user_type === (isAdmin ? 'operator' : 'citizen')
          )
          if (!alreadyRead) {
            messagesToUpdate.push(row.id)
          }
        }

        if (messagesToUpdate.length > 0) {
          // Update read_by for each message
          await pool.query(
            `UPDATE community_chat_messages 
             SET read_by = read_by || $1::jsonb
             WHERE id = ANY($2::uuid[])`,
            [
              JSON.stringify([{
                user_id: user.id,
                user_type: isAdmin ? 'operator' : 'citizen',
                read_at: new Date().toISOString()
              }]),
              messagesToUpdate
            ]
          )

          // Fetch updated messages to broadcast
          const updated = await pool.query(
            `SELECT id, sender_id, sender_type, read_by FROM community_chat_messages 
             WHERE id = ANY($1::uuid[])`,
            [messagesToUpdate]
          )

          updatedMessages.push(...updated.rows)
        }

        // Broadcast read receipts to all users in the room
        if (updatedMessages.length > 0) {
          io.to('community-chat').emit('community:chat:messages_read', {
            messages: updatedMessages.map(m => ({
              id: m.id,
              read_by: m.read_by
            }))
          })
        }

        if (ack) ack({ success: true, updatedCount: updatedMessages.length })
      } catch (err: any) {
        console.error('[CommunityChat] mark_read error:', err.message)
        if (ack) ack({ success: false, error: err.message })
      }
    })

    // ── Remove Member from Chat (Operator only) ─────────────────────────
    socket.on('community:chat:remove_member', async (data: any, ack?: Function) => {
      try {
        if (!isStrictAdmin) {
          if (ack) ack({ success: false, error: 'Unauthorized' })
          return
        }

        const { memberId, memberType } = data || {}
        if (!memberId) {
          if (ack) ack({ success: false, error: 'No memberId provided' })
          return
        }

        // Find and notify the member, remove them from room
        const room = io.sockets.adapter.rooms.get('community-chat')
        if (room) {
          for (const sid of room) {
            const s = io.sockets.sockets.get(sid) as any
            if (s?.data?.user?.id === memberId) {
              s.emit('community:removed', { message: 'You have been removed from community chat by a moderator.' })
              s.leave('community-chat')
              communityOnlineUsers.delete(sid)
              devLog('[CommunityChat] Removed member:', memberId)
            }
          }
        }

        // Notify all remaining users
        io.to('community-chat').emit('community:chat:user_left', { userId: memberId })
        emitCommunityOnlineUsers()

        if (ack) ack({ success: true })
      } catch (err: any) {
        console.error('[CommunityChat] remove_member error:', err.message)
        if (ack) ack({ success: false, error: err.message })
      }
    })

    // ── Ban User from Community Chat (Operator only) ─────────────────────
    socket.on('community:chat:ban_user', async (data: any, ack?: Function) => {
      try {
        if (!isStrictAdmin) {
          if (ack) ack({ success: false, error: 'Unauthorized' })
          return
        }

        const { userId: targetUserId, reason, duration, permanent } = data || {}
        if (!targetUserId) {
          if (ack) ack({ success: false, error: 'No userId provided' })
          return
        }

        let expiresAt = null
        if (!permanent && duration) {
          const now = new Date()
          const durationMs = parseDuration(duration)
          if (durationMs > 0) {
            expiresAt = new Date(now.getTime() + durationMs)
          }
        }

        // Insert or update ban
        await pool.query(
          `INSERT INTO community_bans (user_id, user_type, banned_by, reason, is_permanent, expires_at)
           VALUES ($1, 'citizen', $2, $3, $4, $5)
           ON CONFLICT (user_id) DO UPDATE SET
             banned_by = $2, reason = $3, is_permanent = $4, expires_at = $5, created_at = NOW()`,
          [targetUserId, user.id, reason || 'Banned by moderator', !!permanent, expiresAt]
        )

        // Kick user from room
        const room = io.sockets.adapter.rooms.get('community-chat')
        if (room) {
          for (const sid of room) {
            const s = io.sockets.sockets.get(sid) as any
            if (s?.data?.user?.id === targetUserId) {
              s.emit('community:removed', {
                message: permanent
                  ? 'You have been permanently banned from community chat.'
                  : `You have been banned from community chat until ${expiresAt?.toLocaleString() || 'further notice'}.`,
                banned: true,
              })
              s.leave('community-chat')
              communityOnlineUsers.delete(sid)
            }
          }
        }

        io.to('community-chat').emit('community:chat:user_left', { userId: targetUserId })
        emitCommunityOnlineUsers()

        auditLog('CommunityChat', `${user.displayName} banned ${targetUserId}`, { permanent })
        if (ack) ack({ success: true })
      } catch (err: any) {
        console.error('[CommunityChat] ban_user error:', err.message)
        if (ack) ack({ success: false, error: err.message })
      }
    })

    // ── Unban User from Community Chat (Operator only) ───────────────────
    socket.on('community:chat:unban_user', async (data: any, ack?: Function) => {
      try {
        if (!isStrictAdmin) {
          if (ack) ack({ success: false, error: 'Unauthorized' })
          return
        }
        const { userId: targetUserId } = data || {}
        if (!targetUserId) {
          if (ack) ack({ success: false, error: 'No userId provided' })
          return
        }
        await pool.query('DELETE FROM community_bans WHERE user_id = $1', [targetUserId])
        auditLog('CommunityChat', `${user.displayName} unbanned ${targetUserId}`)
        if (ack) ack({ success: true })
      } catch (err: any) {
        console.error('[CommunityChat] unban_user error:', err.message)
        if (ack) ack({ success: false, error: err.message })
      }
    })

    // ── Mute User (Typing ban for a duration) ─────────────────────────────
    socket.on('community:chat:mute_user', async (data: any, ack?: Function) => {
      try {
        if (!isStrictAdmin) {
          if (ack) ack({ success: false, error: 'Unauthorized' })
          return
        }

        const { userId: targetUserId, reason, duration } = data || {}
        if (!targetUserId || !duration) {
          if (ack) ack({ success: false, error: 'userId and duration are required' })
          return
        }

        const durationMs = parseDuration(duration)
        if (durationMs <= 0) {
          if (ack) ack({ success: false, error: 'Invalid duration' })
          return
        }

        const expiresAt = new Date(Date.now() + durationMs)

        await pool.query(
          `INSERT INTO community_mutes (user_id, user_type, muted_by, reason, expires_at)
           VALUES ($1, 'citizen', $2, $3, $4)
           ON CONFLICT (user_id) DO UPDATE SET
             muted_by = $2, reason = $3, expires_at = $4, created_at = NOW()`,
          [targetUserId, user.id, reason || 'Muted by moderator', expiresAt]
        )

        // Notify the muted user
        const room = io.sockets.adapter.rooms.get('community-chat')
        if (room) {
          for (const sid of room) {
            const s = io.sockets.sockets.get(sid) as any
            if (s?.data?.user?.id === targetUserId) {
              s.emit('community:chat:muted', {
                reason: reason || 'Muted by moderator',
                expires_at: expiresAt.toISOString(),
                duration,
              })
            }
          }
        }

        auditLog('CommunityChat', `${user.displayName} muted ${targetUserId}`, { duration })
        if (ack) ack({ success: true })
      } catch (err: any) {
        console.error('[CommunityChat] mute_user error:', err.message)
        if (ack) ack({ success: false, error: err.message })
      }
    })

    // ── Unmute User (Operator only) ──────────────────────────────────────
    socket.on('community:chat:unmute_user', async (data: any, ack?: Function) => {
      try {
        if (!isStrictAdmin) {
          if (ack) ack({ success: false, error: 'Unauthorized' })
          return
        }
        const { userId: targetUserId } = data || {}
        if (!targetUserId) {
          if (ack) ack({ success: false, error: 'No userId provided' })
          return
        }
        await pool.query('DELETE FROM community_mutes WHERE user_id = $1', [targetUserId])
        // Notify the unmuted user
        const room = io.sockets.adapter.rooms.get('community-chat')
        if (room) {
          for (const sid of room) {
            const s = io.sockets.sockets.get(sid) as any
            if (s?.data?.user?.id === targetUserId) {
              s.emit('community:chat:unmuted', {})
            }
          }
        }
        auditLog('CommunityChat', `${user.displayName} unmuted ${targetUserId}`)
        if (ack) ack({ success: true })
      } catch (err: any) {
        console.error('[CommunityChat] unmute_user error:', err.message)
        if (ack) ack({ success: false, error: err.message })
      }
    })

    socket.on('community:chat:online', (ack?: Function) => {
      try {
        const users = getCommunityOnlineUsers()
        if (ack) ack({ success: true, users })
      } catch (err: any) {
        if (ack) ack({ success: false, users: [] })
      }
    })

    // ═══════════════════════════════════════════════════════════════════════════
    // PERSONAL DISTRESS BEACON / SOS SYSTEM
    // Real-time emergency tracking with live GPS, operator acknowledgement,
    // dead-man switch, and triage prioritisation
    // ═══════════════════════════════════════════════════════════════════════════

    socket.on('distress:activate', async (data: {
      latitude: number; longitude: number; message?: string; contactNumber?: string
    }, ack?: Function) => {
      try {
        if (isAdmin) {
          if (ack) ack({ success: false, error: 'Only citizens can activate distress' })
          return
        }

        const { latitude, longitude, message, contactNumber } = data
        if (latitude == null || longitude == null) {
          if (ack) ack({ success: false, error: 'GPS coordinates required' })
          return
        }

        // Check for existing active call
        const existing = await pool.query(
          `SELECT id FROM distress_calls WHERE citizen_id = $1 AND status IN ('active', 'acknowledged')`,
          [user.id]
        )
        if (existing.rows.length > 0) {
          if (ack) ack({ success: false, error: 'Already active', distressId: existing.rows[0].id })
          return
        }

        // Get citizen info
        let isVulnerable = false
        let phone = contactNumber || null
        try {
          const cInfo = await pool.query('SELECT is_vulnerable, phone FROM citizens WHERE id = $1', [user.id])
          if (cInfo.rows[0]) {
            isVulnerable = cInfo.rows[0].is_vulnerable || false
            phone = phone || cInfo.rows[0].phone
          }
        } catch {}

        const result = await pool.query(
          `INSERT INTO distress_calls (
             citizen_id, citizen_name, initial_lat, initial_lng, current_lat, current_lng,
             latitude, longitude, message, notes, contact_number, is_vulnerable, status, last_update_at, last_gps_at
           ) VALUES ($1, $2, $3, $4, $3, $4, $3, $4, $5, $5, $6, $7, 'active', NOW(), NOW())
           RETURNING *`,
          [user.id, user.displayName, latitude, longitude, message || null, phone, isVulnerable]
        )

        const distressCall = result.rows[0]

        // Join distress room for real-time updates
        socket.join(`distress:${distressCall.id}`)

        // 🚨 ALERT ALL OPERATORS — with alarm-level urgency
        io.to('admins').emit('distress:new_alert', {
          ...distressCall,
          citizenName: user.displayName,
          isVulnerable,
          urgency: isVulnerable ? 'CRITICAL' : 'HIGH',
        })

        // Play alarm sound notification on admin clients
        io.to('admins').emit('distress:alarm', {
          distressId: distressCall.id,
          citizenName: user.displayName,
          isVulnerable,
          latitude,
          longitude,
        })

        auditLog('Distress', `SOS ACTIVATED by ${user.displayName}`, { latitude, longitude, isVulnerable })

        if (ack) ack({ success: true, distress: distressCall })
      } catch (err: any) {
        console.error('[Distress] Activation error:', err.message)
        if (ack) ack({ success: false, error: err.message })
      }
    })

    socket.on('distress:location_update', async (data: {
      distressId: string; latitude: number; longitude: number; accuracy?: number; heading?: number; speed?: number
    }) => {
      try {
        const { distressId, latitude, longitude, accuracy, heading, speed } = data

        await pool.query(
          `UPDATE distress_calls 
           SET current_lat = $2, current_lng = $3, latitude = $2, longitude = $3,
               accuracy = $4, heading = $5, speed = $6, last_update_at = NOW(), last_gps_at = NOW(),
               location_history = COALESCE(location_history, '[]'::jsonb) || jsonb_build_object('lat', $2, 'lng', $3, 'ts', NOW())
           WHERE id = $1 AND citizen_id = $7 AND status IN ('active', 'acknowledged')
           `,
          [distressId, latitude, longitude, accuracy || null, heading || null, speed || null, user.id]
        )

        // Broadcast live GPS to operators tracking this distress
        io.to(`distress:${distressId}`).emit('distress:location', {
          distressId, latitude, longitude, accuracy, heading, speed, timestamp: new Date().toISOString(),
        })

        // Also broadcast to all admins (for dashboard)
        io.to('admins').emit('distress:location', {
          distressId, latitude, longitude, accuracy, heading, speed, timestamp: new Date().toISOString(),
        })
      } catch (err: any) {
        console.error('[Distress] Location update error:', err.message)
      }
    })

    socket.on('distress:heartbeat', async (data: { distressId: string }) => {
      // Dead-man switch — citizen pings every 30s to prove they're OK
      try {
        await pool.query(
          `UPDATE distress_calls SET last_update_at = NOW(), last_gps_at = NOW() WHERE id = $1 AND citizen_id = $2 AND status IN ('active', 'acknowledged')`,
          [data.distressId, user.id]
        )
        io.to(`distress:${data.distressId}`).emit('distress:heartbeat_ack', {
          distressId: data.distressId,
          timestamp: new Date().toISOString(),
        })
      } catch {}
    })

    socket.on('distress:cancel', async (data: { distressId: string }, ack?: Function) => {
      try {
        const result = await pool.query(
          `UPDATE distress_calls SET status = 'cancelled', resolved_at = NOW()
           WHERE id = $1 AND citizen_id = $2 AND status IN ('active', 'acknowledged')
           RETURNING *`,
          [data.distressId, user.id]
        )
        if (result.rows.length === 0) {
          if (ack) ack({ success: false, error: 'Not found' })
          return
        }

        socket.leave(`distress:${data.distressId}`)

        io.to('admins').emit('distress:cancelled', {
          distressId: data.distressId,
          citizenName: user.displayName,
        })
        io.to(`distress:${data.distressId}`).emit('distress:cancelled', {
          distressId: data.distressId,
        })

        auditLog('Distress', `SOS cancelled by ${user.displayName}`)
        if (ack) ack({ success: true })
      } catch (err: any) {
        if (ack) ack({ success: false, error: err.message })
      }
    })

    // Operator acknowledges distress call (starts tracking)
    socket.on('distress:acknowledge', async (data: { distressId: string; triageLevel?: string }, ack?: Function) => {
      try {
        if (!isAdmin) {
          if (ack) ack({ success: false, error: 'Operators only' })
          return
        }

        const result = await pool.query(
          `UPDATE distress_calls 
           SET status = 'acknowledged', acknowledged_by = $2, acknowledged_at = NOW(), triage_level = $3
           WHERE id = $1 AND status = 'active'
           RETURNING *`,
          [data.distressId, user.id, data.triageLevel || 'medium']
        )

        if (result.rows.length === 0) {
          if (ack) ack({ success: false, error: 'Not found or already acknowledged' })
          return
        }

        // Operator joins distress room for live GPS
        socket.join(`distress:${data.distressId}`)

        // Notify the citizen their SOS was acknowledged
        io.to(`distress:${data.distressId}`).emit('distress:acknowledged', {
          distressId: data.distressId,
          operatorName: user.displayName,
          triageLevel: data.triageLevel || 'medium',
        })

        // Notify other admins
        io.to('admins').emit('distress:status_changed', {
          distressId: data.distressId,
          status: 'acknowledged',
          operatorName: user.displayName,
          triageLevel: data.triageLevel || 'medium',
        })

        auditLog('Distress', `Acknowledged by ${user.displayName}`, { triageLevel: data.triageLevel || 'medium' })
        if (ack) ack({ success: true, distress: result.rows[0] })
      } catch (err: any) {
        if (ack) ack({ success: false, error: err.message })
      }
    })

    // Operator resolves distress call
    socket.on('distress:resolve', async (data: { distressId: string; resolution?: string }, ack?: Function) => {
      try {
        if (!isAdmin) {
          if (ack) ack({ success: false, error: 'Operators only' })
          return
        }

        const result = await pool.query(
          `UPDATE distress_calls 
           SET status = 'resolved', resolved_at = NOW(), resolved_by = $2, resolution = $3
           WHERE id = $1 AND status IN ('active', 'acknowledged')
           RETURNING *`,
          [data.distressId, user.id, data.resolution || 'Resolved by operator']
        )

        if (result.rows.length === 0) {
          if (ack) ack({ success: false, error: 'Not found' })
          return
        }

        // Notify the citizen
        io.to(`distress:${data.distressId}`).emit('distress:resolved', {
          distressId: data.distressId,
          operatorName: user.displayName,
          resolution: data.resolution || 'Resolved by operator',
        })

        // Notify all admins
        io.to('admins').emit('distress:status_changed', {
          distressId: data.distressId,
          status: 'resolved',
          operatorName: user.displayName,
        })

        auditLog('Distress', `Resolved by ${user.displayName}`)
        if (ack) ack({ success: true, distress: result.rows[0] })
      } catch (err: any) {
        if (ack) ack({ success: false, error: err.message })
      }
    })

    // Operator starts tracking a distress call (joins room for live GPS)
    socket.on('distress:track', (data: { distressId: string }) => {
      if (isAdmin) {
        socket.join(`distress:${data.distressId}`)
        devLog(`[Distress] ${user.displayName} tracking distress ${data.distressId}`)
      }
    })

    // Operator stops tracking
    socket.on('distress:untrack', (data: { distressId: string }) => {
      socket.leave(`distress:${data.distressId}`)
    })

    // ── Disconnect ─────────────────────────────────────────────────────
    socket.on('disconnect', async () => {
      try {
        await pool.query(
          `UPDATE user_presence SET is_online = false, last_seen = NOW(), socket_id = NULL WHERE user_id = $1`,
          [user.id]
        )
      } catch {}

      // Clear all typing timers for this user on disconnect
      for (const [key, timer] of typingTimers) {
        if (key.startsWith(`${user.id}:`)) {
          clearTimeout(timer)
          typingTimers.delete(key)
          const threadId = key.split(':').slice(1).join(':')
          io.to(`thread:${threadId}`).emit('typing:stop', { threadId, userId: user.id })
        }
      }

      // Clean up rate limiter entry
      messageRateLimits.delete(user.id)

      // Clean up active distress calls (#20) — mark as disconnected so operators know
      if (!isAdmin) {
        try {
          const activeDistress = await pool.query(
            `SELECT id FROM distress_calls WHERE citizen_id = $1 AND status IN ('active', 'acknowledged')`,
            [user.id]
          )
          for (const row of activeDistress.rows) {
            await pool.query(
              `UPDATE distress_calls SET notes = COALESCE(notes, '') || ' [DISCONNECTED at ' || NOW()::text || ']' WHERE id = $1`,
              [row.id]
            )
            io.to('admins').emit('distress:citizen_disconnected', {
              distressId: row.id,
              citizenName: user.displayName,
              timestamp: new Date().toISOString(),
            })
            io.to(`distress:${row.id}`).emit('distress:citizen_disconnected', {
              distressId: row.id,
              citizenName: user.displayName,
              timestamp: new Date().toISOString(),
            })
          }
        } catch (err: any) {
          console.error('[Distress] Disconnect cleanup error:', err.message)
        }
      }

      // Remove from community online map and notify
      if (communityOnlineUsers.has(socket.id)) {
        communityOnlineUsers.delete(socket.id)
        const onlineList = getCommunityOnlineUsers()
        io.to('community-chat').emit('community:chat:online_update', { users: onlineList })
      }

      socket.to('community-chat').emit('community:chat:user_left', { userId: user.id, displayName: user.displayName })

      // Notify relevant parties
      if (isAdmin) {
        io.to('admins').emit('admin:operator_offline', { id: user.id, name: user.displayName })
      }
    })
  })

  return io
}
