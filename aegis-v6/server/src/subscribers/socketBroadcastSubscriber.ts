/**
 * Socket Broadcast Subscriber
 *
 * Subscribes to a curated set of Aegis events and broadcasts them over
 * Socket.IO so connected operator dashboards and citizen apps update
 * live without polling. Replaces ad-hoc `io.emit(...)` calls scattered
 * inside route handlers -- routes now just emit a typed event and this
 * subscriber decides what to broadcast and to whom.
 *
 * Mapping rules:
 *   report.created      -> 'report:new'          (all clients, full row fetched from DB)
 *   report.updated      -> 'report:updated'      (all clients)
 *   report.assigned     -> 'report:assigned'     (admins room only)
 *   report.resolved     -> 'report:resolved'     (all clients)
 *   sos.activated       -> 'distress:new_alert'  (admins room) +
 *                          'distress:alarm'      (admins room)
 *   alert.created       -> 'alert:new'           (all clients)
 *   alert.broadcast     -> 'alert:broadcast'     (all clients)
 *   alert.acknowledged  -> 'alert:acknowledged'  (admins room only)
 *   alert.expired       -> 'alert:expired'       (all clients)
 *   incident.escalated  -> 'incident:escalated'  (admins room only)
 *   hazard.predicted    -> 'hazard:predicted'    (all clients)
 *   risk.updated        -> 'risk:updated'        (all clients)
 */
import { eventBus } from '../events/eventBus.js'
import { AegisEventNames } from '../events/eventTypes.js'
import { getIO } from '../services/socket.js'
import { logger } from '../services/logger.js'
import pool from '../models/db.js'

const SEVERITY_MAP: Record<string, string> = {
  low: 'Low', medium: 'Medium', high: 'High', critical: 'Critical',
}
const STATUS_MAP: Record<string, string> = {
  unverified: 'Unverified', verified: 'Verified',
  urgent: 'Urgent', flagged: 'Flagged', resolved: 'Resolved',
}

function emit(channel: string, payload: unknown, room?: string): void {
  const io = getIO()
  if (!io) {
    logger.warn({ channel }, '[socketBroadcast] io not initialised; skipping')
    return
  }
  if (room) io.to(room).emit(channel, payload)
  else io.emit(channel, payload)
}

export function registerSocketBroadcastSubscriber(): () => void {
  const unsubs: Array<() => void> = []

  unsubs.push(
    eventBus.subscribe(AegisEventNames.REPORT_CREATED, async (evt) => {
      try {
        const result = await pool.query<{
          id: number; report_number: string; incident_category: string
          incident_subtype: string; display_type: string; description: string
          severity: string; status: string; trapped_persons: string
          location_text: string; lat: number; lng: number
          has_media: boolean; media_type: string | null; media_url: string | null
          ai_confidence: number | null; ai_analysis: unknown
          location_metadata: unknown; operator_notes: string | null
          created_at: string; updated_at: string | null
          verified_at: string | null; resolved_at: string | null
          reporter_name: string | null
          media: Array<{ id: number; url: string; file_url: string; fileType: string; fileSize: number; originalFilename: string }>
        }>(
          `SELECT r.id, r.report_number, r.incident_category, r.incident_subtype, r.display_type,
                  r.description, r.severity, r.status, r.trapped_persons, r.location_text,
                  r.lat, r.lng, r.has_media, r.media_type, r.media_url,
                  r.ai_confidence, r.ai_analysis, r.location_metadata, r.operator_notes,
                  r.created_at, r.updated_at, r.verified_at, r.resolved_at,
                  c.display_name AS reporter_name,
                  COALESCE(
                    JSON_AGG(JSON_BUILD_OBJECT(
                      'id', rm.id, 'url', rm.file_url, 'file_url', rm.file_url,
                      'fileType', rm.file_type, 'fileSize', rm.file_size,
                      'originalFilename', rm.original_filename, 'aiAnalysis', null
                    )) FILTER (WHERE rm.id IS NOT NULL), '[]'
                  ) AS media
           FROM reports r
           LEFT JOIN citizens c ON r.citizen_id = c.id
           LEFT JOIN report_media rm ON rm.report_id = r.id
           WHERE r.id = $1
           GROUP BY r.id, c.display_name`,
          [evt.payload.reportId],
        )
        if (result.rows.length === 0) {
          logger.warn({ reportId: evt.payload.reportId }, '[socketBroadcast] REPORT_CREATED: report not found')
          return
        }
        const row = result.rows[0]
        emit('report:new', {
          ...row,
          severity: SEVERITY_MAP[row.severity] ?? row.severity,
          status: STATUS_MAP[row.status] ?? row.status,
          correlationId: evt.correlationId,
        })
      } catch (err) {
        logger.error({ err, reportId: evt.payload.reportId }, '[socketBroadcast] REPORT_CREATED fetch failed')
      }
    }),
  )

  unsubs.push(
    eventBus.subscribe(AegisEventNames.REPORT_UPDATED, async (evt) => {
      emit('report:updated', { ...evt.payload, correlationId: evt.correlationId })
    }),
  )

  unsubs.push(
    eventBus.subscribe(AegisEventNames.REPORT_ASSIGNED, async (evt) => {
      emit('report:assigned', { ...evt.payload, correlationId: evt.correlationId }, 'admins')
    }),
  )

  unsubs.push(
    eventBus.subscribe(AegisEventNames.REPORT_RESOLVED, async (evt) => {
      emit('report:resolved', { ...evt.payload, correlationId: evt.correlationId })
    }),
  )

  unsubs.push(
    eventBus.subscribe(AegisEventNames.SOS_ACTIVATED, async (evt) => {
      const { sosId, citizenName, isVulnerable, latitude, longitude, message } = evt.payload
      emit('distress:new_alert', {
        id: sosId,
        citizenName,
        citizen_name: citizenName,
        isVulnerable: isVulnerable ?? false,
        is_vulnerable: isVulnerable ?? false,
        latitude,
        longitude,
        message,
        status: 'active',
        urgency: isVulnerable ? 'CRITICAL' : 'HIGH',
        correlationId: evt.correlationId,
      }, 'admins')
      emit('distress:alarm', {
        distressId: sosId,
        citizenName,
        isVulnerable: isVulnerable ?? false,
        latitude,
        longitude,
        correlationId: evt.correlationId,
      }, 'admins')
    }),
  )

  unsubs.push(
    eventBus.subscribe(AegisEventNames.ALERT_CREATED, async (evt) => {
      emit('alert:new', { ...evt.payload, correlationId: evt.correlationId })
    }),
  )

  unsubs.push(
    eventBus.subscribe(AegisEventNames.ALERT_BROADCAST, async (evt) => {
      emit('alert:broadcast', { ...evt.payload, correlationId: evt.correlationId })
    }),
  )

  unsubs.push(
    eventBus.subscribe(AegisEventNames.ALERT_ACKNOWLEDGED, async (evt) => {
      emit('alert:acknowledged', { ...evt.payload, correlationId: evt.correlationId }, 'admins')
    }),
  )

  unsubs.push(
    eventBus.subscribe(AegisEventNames.ALERT_EXPIRED, async (evt) => {
      emit('alert:expired', { ...evt.payload, correlationId: evt.correlationId })
    }),
  )

  unsubs.push(
    eventBus.subscribe(AegisEventNames.INCIDENT_ESCALATED, async (evt) => {
      emit('incident:escalated', { ...evt.payload, correlationId: evt.correlationId }, 'admins')
    }),
  )

  unsubs.push(
    eventBus.subscribe(AegisEventNames.HAZARD_PREDICTED, async (evt) => {
      emit('hazard:predicted', { ...evt.payload, correlationId: evt.correlationId })
    }),
  )

  unsubs.push(
    eventBus.subscribe(AegisEventNames.RISK_UPDATED, async (evt) => {
      emit('risk:updated', { ...evt.payload, correlationId: evt.correlationId })
    }),
  )

  return () => unsubs.forEach((u) => u())
}
