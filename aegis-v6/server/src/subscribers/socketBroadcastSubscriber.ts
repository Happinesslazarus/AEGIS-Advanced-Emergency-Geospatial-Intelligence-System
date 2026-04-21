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
 *   report.created      -> 'report:created'      (all clients)
 *   report.updated      -> 'report:updated'      (all clients)
 *   report.assigned     -> 'report:assigned'     (admins room only)
 *   report.resolved     -> 'report:resolved'     (all clients)
 *   sos.activated       -> 'distress:new'        (admins room only)
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
      emit('report:created', { ...evt.payload, correlationId: evt.correlationId })
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
      emit('distress:new', { ...evt.payload, correlationId: evt.correlationId }, 'admins')
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
