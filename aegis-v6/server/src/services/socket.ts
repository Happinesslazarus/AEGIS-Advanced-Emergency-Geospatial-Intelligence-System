/**
 * Sets up and manages the Socket.IO WebSocket server. Handles real-time
 * features: community chat rooms, admin broadcast alerts, distress beacon
 * updates, and operator live notifications. Includes per-connection JWT
 * authentication, rate limiting (Redis-backed, in-memory fallback), and
 * automatic escalation detection in chat messages.
 *
 * - Initialised by server/src/index.ts (initSocketServer) at startup
 * - The returned io instance is shared with route handlers via app.set('io', io)
 * - setRiverIO / setThreatIO / setCommunityRealtimeIo in index.ts share the io
 *   with domain services that push live data (river levels, threat escalations)
 * - distressRoutes.ts emits to the 'distress' namespace when a SOS is activated
 * - reportRoutes.ts emits to the 'admin' room when a new report is submitted
 * - Client: client/src/contexts/SocketContext.tsx manages the browser WebSocket
 * - Client: client/src/hooks/useSocket.ts wraps event subscription logic
 *
 * Key namespaces / rooms:
 * - / (default)     -- all authenticated users, admin broadcasts
 * - admin room      -- operator-only event stream
 * - community rooms -- per-community-group chat rooms
 * - distress room   -- live SOS updates for operators
 *
 * - server/src/services/communityRealtime.ts  -- community-specific realtime events
 * - server/src/services/riverLevelService.ts  -- emits river gauge updates through socket
 * - server/src/services/threatLevelService.ts -- emits threat level changes through socket
 * - client/src/contexts/SocketContext.tsx     -- how the browser connects & subscribes
 * */

import { Server as HttpServer } from 'http'
import { Server, Socket } from 'socket.io'
import pool from '../models/db.js'
import { devLog } from '../utils/logger.js'
import { logger } from './logger.js'
import { verifyToken } from '../middleware/auth.js'
import { checkConnectionRateLimit, clearSocketRateLimit } from './socketHandlers/rateLimiter.js'
import type { AuthPayload } from './socketHandlers/types.js'
import { registerChatHandlers } from './socketHandlers/chat.js'
import { registerCommunityHandlers, cleanupCommunitySocketOnDisconnect } from './socketHandlers/community.js'
import { registerDistressHandlers, cleanupDistressOnDisconnect } from './socketHandlers/distress.js'

const CITIZEN_ROLES = new Set(['citizen', 'verified_citizen', 'community_leader'])

// Incident Alert Broadcast API
//Allows server-side services (cronJobs, incident modules, n8n webhooks) to
//push real-time incident predictions and alerts to all connected clients.

let _io: Server | null = null

/** Accessor for the singleton Socket.IO instance. Returns null until
 *  initSocketServer() has been called. Used by event subscribers that
 *  need to broadcast without going through `req.app.get('io')`. */
export function getIO(): Server | null {
  return _io
}

export interface IncidentAlertPayload {
  incidentType: string
  regionId: string
  riskLevel: 'Low' | 'Medium' | 'High' | 'Critical'
  probability: number
  confidence: number
  title: string
  description: string
  affectedArea?: { lat: number; lng: number; radiusKm: number }
  timestamp: string
  sourceModel?: string
}

 /*
 * Broadcast a new incident prediction alert to all connected clients.
 * Called by cronJobs, incident modules, and n8n webhook handlers.
  */
export function broadcastIncidentAlert(payload: IncidentAlertPayload): void {
  if (!_io) return
  _io.emit('incident:alert', payload)
  //Also target the admins room for high/critical alerts
  if (payload.riskLevel === 'High' || payload.riskLevel === 'Critical') {
    _io.to('admins').emit('incident:alert:priority', payload)
  }
  devLog(`[Socket] broadcast incident:alert ${payload.incidentType}@${payload.regionId} risk=${payload.riskLevel}`)
}

export interface OperatorAlertPayload {
  id: string
  type: string      // e.g. flood, safe_zone, transit_metro, general
  severity: 'critical' | 'warning' | 'info'
  title: string
  message: string
  area: string
  actionRequired?: string
  issuedAt: string
}

/**
 * Broadcast an operator-issued alert to ALL connected Socket.IO clients.
 * This is the fastest possible delivery (< 50 ms) for users who have
 * the app open and is a better complement to web push (which can take
 * several seconds to arrive through the push service).
 */
export function broadcastAlert(payload: OperatorAlertPayload): void {
  if (!_io) return
  _io.emit('alert:new', payload)
  if (payload.severity === 'critical') {
    _io.to('admins').emit('alert:new:critical', payload)
  }
  devLog(`[Socket] broadcast alert:new type=${payload.type} severity=${payload.severity}`)
}

 /*
 * Broadcast a batch prediction update (e.g. periodic refresh of all active predictions).
 * Clients use this to update their dashboards without polling.
  */
export function broadcastPredictionUpdate(regionId: string, predictions: unknown[]): void {
  if (!_io) return
  _io.emit('incident:predictions_updated', { regionId, predictions, timestamp: new Date().toISOString() })
  devLog(`[Socket] broadcast incident:predictions_updated region=${regionId} count=${predictions.length}`)
}

export function initSocketServer(httpServer: HttpServer): Server {
  const io = new Server(httpServer, {
    cors: {
      origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
        const allowed = [
          'http://localhost:5173', 'http://localhost:5174', 'http://localhost:5175',
          'http://localhost:3000', 'http://127.0.0.1:5173', 'http://127.0.0.1:5174',
          process.env.CLIENT_URL,
        ].filter(Boolean)
        if (!origin || allowed.includes(origin)) {
          callback(null, true)
        } else if (process.env.NODE_ENV !== 'production') {
          //Allow all origins in development only
          callback(null, true)
        } else {
          callback(new Error(`WebSocket CORS: origin ${origin} not allowed`))
        }
      },
      credentials: true,
    },
    transports: ['websocket', 'polling'],
  })

  //Store io reference so broadcastIncidentAlert / broadcastPredictionUpdate work
  _io = io

  //NOTE: Chat/community tables are now managed via migration_chat_tables.sql
  //No runtime DDL -- all schema changes go through the migration pipeline.

  // JWT Authentication Middleware
  io.use((socket, next) => {
    const ip = socket.handshake.address
    if (!checkConnectionRateLimit(ip)) {
      return next(new Error('Too many connections from this IP. Please try again later.'))
    }
    const token = socket.handshake.auth.token || socket.handshake.headers.authorization?.replace('Bearer ', '')
    if (!token) return next(new Error('Authentication required'))

    try {
      const decoded = verifyToken<AuthPayload>(token)
      ;(socket as any).user = decoded
      next()
    } catch {
      next(new Error('Invalid token'))
    }
  })

  io.on('connection', async (socket: Socket) => {
    let user = (socket as any).user as AuthPayload
    const roleLower = String(user.role || '').toLowerCase()
    //isAdmin: any non-citizen role (operator, responder, supervisor, admin, etc.) can use admin socket features
    const isAdmin = !CITIZEN_ROLES.has(roleLower)
    //isStrictAdmin: only the explicit 'admin' role for highly privileged operations (ban, mass moderation)
    //Note: this intentionally differs from isSuperAdmin() in adminCommunityRoutes.ts which also
    //grants elevated access based on department === 'Command & Control'. Socket-level bans use
    //role-only checks to avoid trusting user-supplied department strings from the JWT.
    const isStrictAdmin = roleLower === 'admin'

    //Normalize token identity to an existing DB row to avoid orphan sender_id values
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
      logger.error({ err }, '[Socket] user normalization error')
      socket.disconnect(true)
      return
    }

    //Store user on socket.data for room introspection (community chat online list)
    socket.data.user = user

    devLog(`[Socket] ${user.role} ${user.displayName} connected (${socket.id})`)

    // Update presence
    try {
      await pool.query(
        `INSERT INTO user_presence (user_id, user_type, is_online, last_seen, socket_id)
         VALUES ($1, $2, true, NOW(), $3)
         ON CONFLICT (user_id) DO UPDATE
         SET is_online = true, last_seen = NOW(), socket_id = $3`,
        [user.id, isAdmin ? 'operator' : 'citizen', socket.id]
      )
    } catch (err) { logger.warn({ err, userId: user.id }, '[Socket] Failed to upsert user_presence on connect') }

    // Join rooms
    //Citizens join their own room; admins join admin room
    socket.join(`user:${user.id}`)
    if (isAdmin) {
      socket.join('admins')
      //Send all unresolved threads to admin on connect
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
        logger.error({ err }, '[Socket] Failed to load admin threads')
      }
    } else {
      //Citizen joins their thread rooms
      try {
        const threads = await pool.query(
          `SELECT id FROM message_threads WHERE citizen_id = $1 AND status != 'closed'`,
          [user.id]
        )
        threads.rows.forEach(t => socket.join(`thread:${t.id}`))
      } catch (err) { logger.warn({ err, userId: user.id }, '[Socket] Failed to join citizen thread rooms') }
    }

    
    const typingTimers = new Map<string, ReturnType<typeof setTimeout>>()
    registerChatHandlers(socket, io, user, isAdmin, typingTimers)
    registerCommunityHandlers(socket, io, user, isAdmin, isStrictAdmin)
    registerDistressHandlers(socket, io, user, isAdmin)

    socket.on('disconnect', async () => {
      try {
        await pool.query(
          `UPDATE user_presence SET is_online = false, last_seen = NOW(), socket_id = NULL WHERE user_id = $1`,
          [user.id]
        )
      } catch (err) { logger.warn({ err, userId: user.id }, '[Socket] Failed to update presence on disconnect') }

      //Clear all typing timers for this user on disconnect
      for (const [key, timer] of typingTimers) {
        if (key.startsWith(`${user.id}:`)) {
          clearTimeout(timer)
          typingTimers.delete(key)
          const threadId = key.split(':').slice(1).join(':')
          io.to(`thread:${threadId}`).emit('typing:stop', { threadId, userId: user.id })
        }
      }

      //Clean up rate limiter entry (Redis + in-memory)
      clearSocketRateLimit(user.id).catch(() => {})

      //Clean up active distress calls -- mark as disconnected so operators know
      await cleanupDistressOnDisconnect(io, user.id, user.displayName, isAdmin)

      //Remove from community online map and notify
      cleanupCommunitySocketOnDisconnect(socket.id, io)

      socket.to('community-chat').emit('community:chat:user_left', { userId: user.id, displayName: user.displayName })

      //Notify relevant parties
      if (isAdmin) {
        io.to('admins').emit('admin:operator_offline', { id: user.id, name: user.displayName })
      }
    })
  })

  return io
}