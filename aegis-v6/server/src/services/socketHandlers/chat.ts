import { Server, Socket } from 'socket.io'
import pool from '../../models/db.js'
import { devLog } from '../../utils/logger.js'
import { logger } from '../logger.js'
import type { AuthPayload } from './types.js'

const ESCALATION_KEYWORDS = [
  'help', 'trapped', 'injured', 'drowning', 'fire', 'emergency', 'sos',
  'rescue', 'bleeding', 'collapsed', 'unconscious', 'flood', 'stranded',
  'can\'t breathe', 'chest pain', 'heart attack', 'dying', 'danger',
  'attack', 'violence', 'abuse', 'urgent',
]

export function registerChatHandlers(
  socket: Socket,
  io: Server,
  user: AuthPayload,
  isAdmin: boolean,
  typingTimers: Map<string, ReturnType<typeof setTimeout>>,
): void {

  // Send Message
  socket.on('message:send', async (data: { threadId: string; content?: string; attachmentUrl?: string; attachment_url?: string }, ack?: Function) => {
    try {
      const { threadId } = data
      const content = data?.content?.trim() || null
      const attachmentUrl = data?.attachmentUrl || data?.attachment_url || null
      if (!content && !attachmentUrl) {
        if (ack) ack({ success: false, error: 'Empty message' })
        return
      }

      //Verify access
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

      //Citizens can only access their own threads
      if (!isAdmin && thread.citizen_id !== user.id) {
        if (ack) ack({ success: false, error: 'Access denied' })
        return
      }
      //Admins can access any thread
      if (isAdmin && thread.status === 'closed') {
        if (ack) ack({ success: false, error: 'Thread is closed' })
        return
      }

      const senderType = isAdmin ? 'operator' : 'citizen'

      //Insert message
      const msgResult = await pool.query(
        `INSERT INTO messages (thread_id, sender_type, sender_id, content, attachment_url, attachment_type, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'sent')
         RETURNING *`,
        [threadId, senderType, user.id, content, attachmentUrl, attachmentUrl ? 'image' : null]
      )
      const msg = msgResult.rows[0]
      const threadPreview = content || '[Image]'

      //Check for emergency keywords (citizen messages only)
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

      //Update thread metadata
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

      //Broadcast to thread room
      const broadcastMsg = {
        ...msg,
        sender_name: user.displayName,
        sender_role: user.role,
        is_emergency: isEmergency,
      }

      //Broadcast to OTHER users in thread (not sender - they get it from ack)
      socket.to(`thread:${threadId}`).emit('message:new', broadcastMsg)

      //Notify admins of new citizen messages
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

      //Notify citizen of admin reply
      if (isAdmin) {
        io.to(`user:${thread.citizen_id}`).emit('citizen:new_reply', {
          threadId,
          message: broadcastMsg,
        })

        //Emit updated total unread count to citizen
        const unreadResult = await pool.query(
          'SELECT COALESCE(SUM(citizen_unread), 0)::int as total FROM message_threads WHERE citizen_id = $1',
          [thread.citizen_id]
        )
        io.to(`user:${thread.citizen_id}`).emit('citizen:unread_count', {
          total: unreadResult.rows[0]?.total || 0,
        })
      }

      //Mark as delivered if recipient is online
      if (isAdmin) {
        //Admin sent ? check if citizen is online
        const presence = await pool.query(
          'SELECT is_online FROM user_presence WHERE user_id = $1',
          [thread.citizen_id]
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
      } else {
        //Citizen sent ? check if any admin is online (in the admins room)
        const adminRoom = io.sockets.adapter.rooms.get('admins')
        if (adminRoom && adminRoom.size > 0) {
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
      logger.error({ err }, '[Socket] message:send error')
      if (ack) ack({ success: false, error: err.message })
    }
  })

  // Create Thread
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

      //Limit active threads
      const countResult = await pool.query(
        `SELECT COUNT(*) as cnt FROM message_threads WHERE citizen_id = $1 AND status IN ('open','in_progress')`,
        [user.id]
      )
      if (parseInt(countResult.rows[0].cnt) >= 10) {
        if (ack) ack({ success: false, error: 'Too many active threads' })
        return
      }

      //Check for emergency keywords
      const lowerMsg = message.toLowerCase()
      const matchedKeywords = ESCALATION_KEYWORDS.filter(kw => lowerMsg.includes(kw))
      const isEm = emergency || matchedKeywords.length > 0

      //Check if citizen is vulnerable
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

      //Insert first message
      await pool.query(
        `INSERT INTO messages (thread_id, sender_type, sender_id, content, status)
         VALUES ($1, 'citizen', $2, $3, 'sent')`,
        [thread.id, user.id, message.trim()]
      )

      //Join the new thread room
      socket.join(`thread:${thread.id}`)

      //Build enriched thread object
      const enrichedThread = {
        ...thread,
        citizen_name: user.displayName,
        is_vulnerable: isVulnerable,
        last_message: message.trim(),
      }

      //Notify the citizen who created the thread (so their list updates instantly)
      socket.emit('thread:created', enrichedThread)

      //Notify admins
      io.to('admins').emit('admin:new_thread', enrichedThread)

      if (ack) ack({ success: true, thread: enrichedThread })
    } catch (err: any) {
      logger.error({ err }, '[Socket] thread:create error')
      if (ack) ack({ success: false, error: err.message })
    }
  })

  // Typing Indicator
  socket.on('typing:start', (data: { threadId: string }) => {
    if (!data?.threadId) return
    const key = `${user.id}:${data.threadId}`
    //Clear existing timer if re-triggered
    const existing = typingTimers.get(key)
    if (existing) clearTimeout(existing)
    socket.to(`thread:${data.threadId}`).emit('typing:start', {
      threadId: data.threadId, userId: user.id, displayName: user.displayName, role: user.role,
    })
    //Auto-clear typing indicator after 30 seconds
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

  // Mark Messages as Read
  socket.on('messages:read', async (data: { threadId: string }) => {
    try {
      const { threadId } = data
      const senderType = isAdmin ? 'citizen' : 'operator'

      //Mark messages from the OTHER side as read
      const updated = await pool.query(
        `UPDATE messages SET status = 'read', read_at = NOW()
         WHERE thread_id = $1 AND sender_type = $2 AND read_at IS NULL
         RETURNING id`,
        [threadId, senderType]
      )

      //Reset unread counter
      if (isAdmin) {
        await pool.query('UPDATE message_threads SET operator_unread = 0 WHERE id = $1', [threadId])
      } else {
        await pool.query('UPDATE message_threads SET citizen_unread = 0 WHERE id = $1', [threadId])
      }

      //Fetch updated thread and broadcast to all connected clients
      const threadResult = await pool.query(
        `SELECT * FROM message_threads WHERE id = $1`,
        [threadId]
      )
      if (threadResult.rows[0]) {
        io.to(`thread:${threadId}`).emit('thread:updated', threadResult.rows[0])
        //Also emit to the user's personal room in case they're not in the thread room yet
        socket.emit('thread:updated', threadResult.rows[0])
      }

      //Notify sender that messages were read
      updated.rows.forEach(msg => {
        io.to(`thread:${threadId}`).emit('message:status', {
          messageId: msg.id, status: 'read',
        })
      })
    } catch (err) { logger.warn({ err, userId: user.id }, '[Socket] Failed to mark messages as read') }
  })

  // Join Thread Room
  socket.on('thread:join', async (data: { threadId: string }) => {
    const { threadId } = data
    devLog(`[Socket] ${user.role} ${user.displayName} requesting to join thread:${threadId}`)
    //Verify access
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
      logger.warn({ role: user.role, displayName: user.displayName, threadId }, '[Socket] Denied access to thread')
    }
  })

  // Load Thread Messages
  socket.on('thread:messages', async (data: { threadId: string }, ack?: Function) => {
    try {
      const { threadId } = data
      //Verify access
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
      logger.error({ err }, '[Socket] thread:messages error')
    }
  })

  // Citizen: Get my threads
  socket.on('citizen:get_threads', async (ack?: Function) => {
    if (isAdmin) {
      logger.info('[Socket] citizen:get_threads called by admin, ignoring')
      return
    }
    logger.info({ displayName: user.displayName, userId: user.id }, '[Socket] citizen:get_threads called')
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
      logger.info({ count: threads.rows.length, userId: user.id }, '[Socket] citizen:get_threads found threads')
      socket.emit('citizen:threads', threads.rows)
      if (ack) ack(threads.rows)
    } catch (err: any) {
      logger.error({ err }, '[Socket] citizen:get_threads error')
    }
  })

  // Admin: Get all threads
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
    } catch (err) { logger.warn({ err, userId: user.id }, '[Socket] Failed to fetch admin threads') }
  })

  // Admin: Assign thread to self
  socket.on('admin:assign_thread', async (data: { threadId: string; operatorId?: string }, ack?: Function) => {
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
      logger.error({ err }, '[Socket] assign_thread error')
      if (ack) ack({ success: false, error: err.message })
    }
  })

  // Admin: Resolve thread
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
      logger.error({ err }, '[Socket] resolve_thread error')
      if (ack) ack({ success: false, error: err.message })
    }
  })
}
