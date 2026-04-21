import { Server, Socket } from 'socket.io'
import pool from '../../models/db.js'
import { devLog, auditLog } from '../../utils/logger.js'
import { logger } from '../logger.js'
import { distressEventsTotal, distressActiveGauge, distressResponseLatency } from '../metrics.js'
import { eventBus } from '../../events/eventBus.js'
import { AegisEventNames } from '../../events/eventTypes.js'
import { runWithCorrelation } from '../../events/correlationContext.js'
import { randomUUID } from 'crypto'
import type { AuthPayload } from './types.js'

export function registerDistressHandlers(
  socket: Socket,
  io: Server,
  user: AuthPayload,
  isAdmin: boolean,
): void {

  //PERSONAL DISTRESS BEACON / SOS SYSTEM
  //Real-time emergency tracking with live GPS, operator acknowledgement,
  //dead-man switch, and triage prioritisation

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

      //Check for existing active call
      const existing = await pool.query(
        `SELECT id FROM distress_calls WHERE citizen_id = $1 AND status IN ('active', 'acknowledged')`,
        [user.id]
      )
      if (existing.rows.length > 0) {
        if (ack) ack({ success: false, error: 'Already active', distressId: existing.rows[0].id })
        return
      }

      //Get citizen info
      let isVulnerable = false
      let phone = contactNumber || null
      try {
        const cInfo = await pool.query('SELECT is_vulnerable, phone FROM citizens WHERE id = $1', [user.id])
        if (cInfo.rows[0]) {
          isVulnerable = cInfo.rows[0].is_vulnerable || false
          phone = phone || cInfo.rows[0].phone
        }
      } catch (err) { logger.warn({ err, userId: user.id }, '[Socket] Failed to fetch citizen vulnerability info for distress call') }

      const result = await pool.query(
        `INSERT INTO distress_calls (
           citizen_id, citizen_name, initial_lat, initial_lng, current_lat, current_lng,
           latitude, longitude, message, notes, contact_number, is_vulnerable, status, last_update_at, last_gps_at
         ) VALUES ($1, $2, $3, $4, $3, $4, $3, $4, $5, $5, $6, $7, 'active', NOW(), NOW())
         RETURNING *`,
        [user.id, user.displayName, latitude, longitude, message || null, phone, isVulnerable]
      )

      const distressCall = result.rows[0]

      //Join distress room for real-time updates
      socket.join(`distress:${distressCall.id}`)

      // ?? ALERT ALL OPERATORS -- with alarm-level urgency
      io.to('admins').emit('distress:new_alert', {
        ...distressCall,
        citizenName: user.displayName,
        isVulnerable,
        urgency: isVulnerable ? 'CRITICAL' : 'HIGH',
      })

      //Play alarm sound notification on admin clients
      io.to('admins').emit('distress:alarm', {
        distressId: distressCall.id,
        citizenName: user.displayName,
        isVulnerable,
        latitude,
        longitude,
      })

      auditLog('Distress', `SOS ACTIVATED by ${user.displayName}`, { latitude, longitude, isVulnerable })
      distressEventsTotal.inc({ event: 'activate' })
      distressActiveGauge.inc()

      //Publish typed event onto the Aegis spine. The auditSubscriber records
      //it; future subscribers (notifications, n8n, AI cascade) react without
      //touching this handler. Wrapped in a fresh correlation context because
      //socket events do not have an Express requestId.
      runWithCorrelation({ correlationId: randomUUID(), actor: String(user.id) }, () => {
        void eventBus.publish(
          AegisEventNames.SOS_ACTIVATED,
          {
            sosId: String(distressCall.id),
            userId: String(user.id),
            latitude,
            longitude,
            message: typeof message === 'string' ? message.slice(0, 500) : undefined,
          },
          { source: 'citizen', severity: isVulnerable ? 'critical' : 'high' },
        )
      })

      if (ack) ack({ success: true, distress: distressCall })
    } catch (err: any) {
      logger.error({ err }, '[Distress] Activation error')
      distressEventsTotal.inc({ event: 'activate_error' })
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

      //Broadcast live GPS to operators tracking this distress
      io.to(`distress:${distressId}`).emit('distress:location', {
        distressId, latitude, longitude, accuracy, heading, speed, timestamp: new Date().toISOString(),
      })

      //Also broadcast to all admins (for dashboard)
      io.to('admins').emit('distress:location', {
        distressId, latitude, longitude, accuracy, heading, speed, timestamp: new Date().toISOString(),
      })
    } catch (err: any) {
      logger.error({ err }, '[Distress] Location update error')
    }
  })

  socket.on('distress:heartbeat', async (data: { distressId: string }) => {
    //Dead-man switch -- citizen pings every 30s to prove they're OK
    try {
      await pool.query(
        `UPDATE distress_calls SET last_update_at = NOW(), last_gps_at = NOW() WHERE id = $1 AND citizen_id = $2 AND status IN ('active', 'acknowledged')`,
        [data.distressId, user.id]
      )
      io.to(`distress:${data.distressId}`).emit('distress:heartbeat_ack', {
        distressId: data.distressId,
        timestamp: new Date().toISOString(),
      })
    } catch (err) { logger.warn({ err, userId: user.id }, '[Socket] Failed to process distress heartbeat') }
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
      distressEventsTotal.inc({ event: 'cancel' })
      distressActiveGauge.dec()
      if (ack) ack({ success: true })
    } catch (err: any) {
      if (ack) ack({ success: false, error: err.message })
    }
  })

  //Operator acknowledges distress call (starts tracking)
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

      //Operator joins distress room for live GPS
      socket.join(`distress:${data.distressId}`)

      //Notify the citizen their SOS was acknowledged
      io.to(`distress:${data.distressId}`).emit('distress:acknowledged', {
        distressId: data.distressId,
        operatorName: user.displayName,
        triageLevel: data.triageLevel || 'medium',
      })

      //Notify other admins
      io.to('admins').emit('distress:status_changed', {
        distressId: data.distressId,
        status: 'acknowledged',
        operatorName: user.displayName,
        triageLevel: data.triageLevel || 'medium',
      })

      auditLog('Distress', `Acknowledged by ${user.displayName}`, { triageLevel: data.triageLevel || 'medium' })
      distressEventsTotal.inc({ event: 'acknowledge' })
      //Track response latency (time from creation to acknowledgement)
      const ackCall = result.rows[0]
      if (ackCall.created_at) {
        const latencySeconds = (Date.now() - new Date(ackCall.created_at).getTime()) / 1000
        distressResponseLatency.observe(latencySeconds)
      }
      if (ack) ack({ success: true, distress: result.rows[0] })
    } catch (err: any) {
      if (ack) ack({ success: false, error: err.message })
    }
  })

  //Operator resolves distress call
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

      //Notify the citizen
      io.to(`distress:${data.distressId}`).emit('distress:resolved', {
        distressId: data.distressId,
        operatorName: user.displayName,
        resolution: data.resolution || 'Resolved by operator',
      })

      //Notify all admins
      io.to('admins').emit('distress:status_changed', {
        distressId: data.distressId,
        status: 'resolved',
        operatorName: user.displayName,
      })

      auditLog('Distress', `Resolved by ${user.displayName}`)
      distressEventsTotal.inc({ event: 'resolve' })
      distressActiveGauge.dec()
      if (ack) ack({ success: true, distress: result.rows[0] })
    } catch (err: any) {
      if (ack) ack({ success: false, error: err.message })
    }
  })

  //Operator starts tracking a distress call (joins room for live GPS)
  socket.on('distress:track', (data: { distressId: string }) => {
    if (isAdmin) {
      socket.join(`distress:${data.distressId}`)
      devLog(`[Distress] ${user.displayName} tracking distress ${data.distressId}`)
    }
  })

  //Operator stops tracking
  socket.on('distress:untrack', (data: { distressId: string }) => {
    socket.leave(`distress:${data.distressId}`)
  })
}

/**
 * Called from the disconnect handler in socket.ts.
 * Marks active distress calls as [DISCONNECTED] and notifies operators.
 */
export async function cleanupDistressOnDisconnect(
  io: Server,
  userId: string,
  displayName: string,
  isAdmin: boolean,
): Promise<void> {
  if (isAdmin) return
  try {
    const activeDistress = await pool.query(
      `SELECT id FROM distress_calls WHERE citizen_id = $1 AND status IN ('active', 'acknowledged')`,
      [userId]
    )
    for (const row of activeDistress.rows) {
      await pool.query(
        `UPDATE distress_calls SET notes = COALESCE(notes, '') || ' [DISCONNECTED at ' || NOW()::text || ']' WHERE id = $1`,
        [row.id]
      )
      io.to('admins').emit('distress:citizen_disconnected', {
        distressId: row.id,
        citizenName: displayName,
        timestamp: new Date().toISOString(),
      })
      io.to(`distress:${row.id}`).emit('distress:citizen_disconnected', {
        distressId: row.id,
        citizenName: displayName,
        timestamp: new Date().toISOString(),
      })
    }
  } catch (err: any) {
    logger.error({ err }, '[Distress] Disconnect cleanup error')
  }
}
