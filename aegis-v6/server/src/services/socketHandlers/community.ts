import { Server, Socket } from 'socket.io'
import path from 'path'
import fs from 'fs'
import pool from '../../models/db.js'
import { devLog, auditLog } from '../../utils/logger.js'
import { logger } from '../logger.js'
import type { AuthPayload } from './types.js'
import { checkSocketRateLimit } from './rateLimiter.js'

/* Parse human-readable duration strings like '24h', '7d', '1w', '1m' into milliseconds */
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

// In-memory map of online community chat users (keyed by socket.id)
const communityOnlineUsers = new Map<string, {
  userId: string
  userName: string
  isAdmin: boolean
  socketId: string
  role: string
  joinedAt: Date
}>()

export function getCommunityOnlineUsers(): Array<{ userId: string; displayName: string; role: string }> {
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

/** Remove a socket from communityOnlineUsers and broadcast updated online list. */
export function cleanupCommunitySocketOnDisconnect(socketId: string, io: Server): void {
  if (communityOnlineUsers.has(socketId)) {
    communityOnlineUsers.delete(socketId)
    const onlineList = getCommunityOnlineUsers()
    io.to('community-chat').emit('community:chat:online_update', { users: onlineList })
  }
}

export function registerCommunityHandlers(
  socket: Socket,
  io: Server,
  user: AuthPayload,
  isAdmin: boolean,
  isStrictAdmin: boolean,
): void {

  const emitCommunityOnlineUsers = () => {
    try {
      const users = getCommunityOnlineUsers()
      io.to('community-chat').emit('community:chat:online_update', { users })
    } catch (err) { logger.warn({ err }, '[Socket] Failed to emit community online users') }
  }

  devLog(`[Socket] Registering community chat handlers for ${user.displayName} (${socket.id})`)

  socket.on('community:chat:join', async (ack?: Function) => {
    devLog(`[CommunityChat] JOIN REQUEST from ${user.displayName} (socket ${socket.id}) isAdmin: ${isAdmin}`)
    logger.info({ displayName: user.displayName, socketId: socket.id, isAdmin }, '[CommunityChat] Join request')

    //Check if user is banned
    try {
      const banCheck = await pool.query(
        `SELECT * FROM community_bans WHERE user_id = $1 AND (is_permanent = true OR expires_at > NOW())`,
        [user.id]
      )
      if (banCheck.rows.length > 0) {
        const ban = banCheck.rows[0]
        devLog(`[CommunityChat] ${user.displayName} is banned from community chat`)
        logger.info({ displayName: user.displayName }, '[CommunityChat] User banned from community chat')
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
      logger.error({ err }, '[CommunityChat] Ban check error')
    }

    socket.join('community-chat')

    //Add to online map
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

    //Broadcast updated online list to ALL users in room
    io.to('community-chat').emit('community:chat:online_update', { users: onlineList })

    logger.info({ displayName: user.displayName, onlineCount: onlineList.length }, '[CommunityChat] Join successful')
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
      logger.info({ displayName: user.displayName, limit, before }, '[CommunityChat] History request')
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
      logger.info({ count: result.rows.length, displayName: user.displayName }, '[CommunityChat] Loaded messages')
      //Return in chronological order
      if (ack) ack({ success: true, messages: result.rows.reverse() })
    } catch (err: any) {
      logger.error({ err }, '[CommunityChat] history error')
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

    //Enforce message length limit
    if (content.length > 5000) {
      if (ack) ack({ success: false, error: 'Message too long. Maximum 5000 characters.' });
      return
    }

    //Rate limiting: max 15 messages per minute per user (Redis-backed with in-memory fallback)
    {
      const allowed = await checkSocketRateLimit(user.id, 15, 60000)
      if (!allowed) {
        if (ack) ack({ success: false, error: 'Rate limit exceeded. Max 15 messages per minute.' })
        return
      }
    }

    //Check if user is muted
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
      logger.error({ err }, '[CommunityChat] Mute check error')
    }

    try {
      const senderType = isAdmin ? 'operator' : 'citizen'
      const result = await pool.query(
        `INSERT INTO community_chat_messages (sender_id, sender_type, content, image_url, reply_to_id)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [user.id, senderType, content || null, imageUrl, replyToId]
      )
      const msg = result.rows[0]

      //If replying, fetch the reply info
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
      //Broadcast to whole room for reliable realtime sync across all clients
      io.to('community-chat').emit('community:chat:message', payload)

      //Also emit notification to ALL connected sockets (for users not in community tab)
      //This allows CitizenDashboard/AdminPage to show notification badges
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
      logger.error({ err }, '[CommunityChat] send error')
      if (ack) ack({ success: false, error: err.message })
    }
  })

  socket.on('community:chat:delete', async (data: any, ack?: Function) => {
    const { messageId, reason } = data || {}

    //Don't allow deleting temporary messages
    if (!messageId || messageId.startsWith('tmp-')) {
      if (ack) ack({ success: false, error: 'Invalid message ID' });
      return
    }

    try {
      //Only message owner or admin can delete
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

      //Delete image file from storage if exists
      const imageUrl = check.rows[0].image_url
      if (imageUrl) {
        try {
          const filePath = path.join(process.cwd(), imageUrl)
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath)
          }
        } catch (imgErr: any) {
          logger.error({ err: imgErr }, '[CommunityChat] Image delete error')
        }
      }

      //Store deletion with audit info
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

      //Broadcast deletion with audit info so clients can show notification
      io.to('community-chat').emit('community:chat:deleted', {
        messageId,
        deletedBy: (isAdmin && !isOwnMessage) ? user.id : null,
        deletedByName: (isAdmin && !isOwnMessage) ? user.displayName : null,
        reason: deleteReason,
        originalSenderName: check.rows[0].sender_id !== user.id ? null : undefined,
      })
      if (ack) ack({ success: true })
    } catch (err: any) {
      logger.error({ err }, '[CommunityChat] delete error')
      if (ack) ack({ success: false, error: err.message })
    }
  })

  // Edit Message
  socket.on('community:chat:edit', async (data: any, ack?: Function) => {
    const { messageId, content } = data || {}
    if (!messageId || !content?.trim()) { if (ack) ack({ success: false, error: 'Missing data' }); return }
    try {
      //Only message owner can edit
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
      logger.error({ err }, '[CommunityChat] edit error')
      if (ack) ack({ success: false, error: err.message })
    }
  })

  // Report Message
  socket.on('community:chat:report', async (data: any, ack?: Function) => {
    const { messageId, reason, details } = data || {}
    if (!messageId || !reason) { if (ack) ack({ success: false, error: 'Missing data' }); return }
    try {
      await pool.query(
        `INSERT INTO community_reports (reporter_id, reporter_type, target_type, target_id, reason, details)
         VALUES ($1, $2, 'chat_message', $3, $4, $5)`,
        [user.id, isAdmin ? 'operator' : 'citizen', messageId, reason, details || null]
      )
      //Notify admins
      io.to('admins').emit('community:report:new', {
        reporterId: user.id,
        reporterName: user.displayName,
        targetType: 'chat_message',
        targetId: messageId,
        reason,
      })
      if (ack) ack({ success: true })
    } catch (err: any) {
      logger.error({ err }, '[CommunityChat] report error')
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

  // Mark Messages as Read
  socket.on('community:chat:mark_read', async (data: any, ack?: Function) => {
    try {
      const { messageIds } = data || {}
      if (!Array.isArray(messageIds) || messageIds.length === 0) {
        if (ack) ack({ success: false, error: 'No message IDs provided' })
        return
      }

      //Filter out messages already read by this user
      const checkResult = await pool.query(
        `SELECT id, sender_id, read_by FROM community_chat_messages
         WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL`,
        [messageIds]
      )

      const messagesToUpdate: string[] = []
      const updatedMessages: any[] = []

      for (const row of checkResult.rows) {
        //Don't mark own messages as read
        if (row.sender_id === user.id) continue

        const readBy = row.read_by || []
        //Check if user already marked as read
        const alreadyRead = readBy.some((r: any) =>
          r.user_id === user.id && r.user_type === (isAdmin ? 'operator' : 'citizen')
        )
        if (!alreadyRead) {
          messagesToUpdate.push(row.id)
        }
      }

      if (messagesToUpdate.length > 0) {
        //Update read_by for each message
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

        //Fetch updated messages to broadcast
        const updated = await pool.query(
          `SELECT id, sender_id, sender_type, read_by FROM community_chat_messages
           WHERE id = ANY($1::uuid[])`,
          [messagesToUpdate]
        )

        updatedMessages.push(...updated.rows)
      }

      //Broadcast read receipts to all users in the room
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
      logger.error({ err }, '[CommunityChat] mark_read error')
      if (ack) ack({ success: false, error: err.message })
    }
  })

  // Remove Member from Chat (Operator only)
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

      //Find and notify the member, remove them from room
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

      //Notify all remaining users
      io.to('community-chat').emit('community:chat:user_left', { userId: memberId })
      emitCommunityOnlineUsers()

      if (ack) ack({ success: true })
    } catch (err: any) {
      logger.error({ err }, '[CommunityChat] remove_member error')
      if (ack) ack({ success: false, error: err.message })
    }
  })

  // Ban User from Community Chat (Operator only)
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

      //Insert or update ban
      await pool.query(
        `INSERT INTO community_bans (user_id, user_type, banned_by, reason, is_permanent, expires_at)
         VALUES ($1, 'citizen', $2, $3, $4, $5)
         ON CONFLICT (user_id) DO UPDATE SET
           banned_by = $2, reason = $3, is_permanent = $4, expires_at = $5, created_at = NOW()`,
        [targetUserId, user.id, reason || 'Banned by moderator', !!permanent, expiresAt]
      )

      //Kick user from room
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
      logger.error({ err }, '[CommunityChat] ban_user error')
      if (ack) ack({ success: false, error: err.message })
    }
  })

  // Unban User from Community Chat (Operator only)
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
      logger.error({ err }, '[CommunityChat] unban_user error')
      if (ack) ack({ success: false, error: err.message })
    }
  })

  // Mute User (Typing ban for a duration)
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

      //Notify the muted user
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
      logger.error({ err }, '[CommunityChat] mute_user error')
      if (ack) ack({ success: false, error: err.message })
    }
  })

  // Unmute User (Operator only)
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
      //Notify the unmuted user
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
      logger.error({ err }, '[CommunityChat] unmute_user error')
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
}
