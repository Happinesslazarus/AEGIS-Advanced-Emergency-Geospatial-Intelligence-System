/**
 * Typed Frontend Event Stream
 *
 * Mirror of the server's AegisEventMap so frontend subscribers get the
 * same compile-time guarantees the backend has. Used by useEventStream
 * and the hazard/risk hooks to subscribe to live AI predictions.
 *
 * Two tiers of channels coexist here:
 *   - "Spine" channels   -- emitted by the typed event bus / subscribers
 *                           (hazard:predicted, risk:updated, alert:new, ...)
 *   - "Legacy" channels  -- rich io.emit() payloads from existing routes
 *                           (distress:new_alert, incident:alert, ...).
 *                           Typed here so every consumer can use the same
 *                           hook abstraction; will fold into the spine over
 *                           time without touching consumers.
 */
import type { Socket } from 'socket.io-client'

export const AegisChannels = {
  // Spine
  HAZARD_PREDICTED: 'hazard:predicted',
  RISK_UPDATED: 'risk:updated',
  ALERT_NEW: 'alert:new',
  INCIDENT_ESCALATED: 'incident:escalated',
  REPORT_CREATED: 'report:created',
  // Legacy rich broadcasts (typed for the migration)
  REPORT_NEW: 'report:new',
  REPORT_UPDATED: 'report:updated',
  REPORT_BULK_UPDATED: 'report:bulk-updated',
  INCIDENT_ALERT: 'incident:alert',
  INCIDENT_ALERT_PRIORITY: 'incident:alert:priority',
  INCIDENT_PREDICTIONS_UPDATED: 'incident:predictions_updated',
  DISTRESS_NEW_ALERT: 'distress:new_alert',
  DISTRESS_NEW: 'distress:new',
  DISTRESS_UPDATED: 'distress:updated',
  DISTRESS_ALARM: 'distress:alarm',
  DISTRESS_CANCELLED: 'distress:cancelled',
  DISTRESS_STATUS_CHANGED: 'distress:status_changed',
  DISTRESS_LOCATION: 'distress:location',
  DISTRESS_ACKNOWLEDGED: 'distress:acknowledged',
  DISTRESS_RESOLVED: 'distress:resolved',
  // Alert variants
  ALERT_UPDATE: 'alert:update',
} as const

export type AegisChannel = typeof AegisChannels[keyof typeof AegisChannels]

export interface HazardPredictedEvent {
  predictionId: string
  hazardType: string
  regionId: string
  score: number
  confidence: number
  modelVersion: string
  correlationId?: string
}

export interface RiskUpdatedEvent {
  regionId: string
  previousScore: number
  newScore: number
  delta: number
  reason: string
  correlationId?: string
}

export interface AlertNewEvent {
  alertId?: string
  id?: string
  hazardType?: string
  type?: string
  severity: 'low' | 'medium' | 'high' | 'critical' | 'warning' | 'info' | string
  title?: string
  message: string
  area?: string
  affectedRegionId?: string
  issuedAt?: string
  actionRequired?: string
  correlationId?: string
  [k: string]: unknown
}

export interface IncidentEscalatedEvent {
  incidentId: string
  fromSeverity: string
  toSeverity: string
  reason: string
  correlationId?: string
}

export interface ReportCreatedEvent {
  reportId: string
  hazardType: string
  severity: string
  regionId?: string
  correlationId?: string
}

/* ---------- Legacy rich broadcast payloads (typed loosely on purpose) ---------- */

export interface ReportNewEvent {
  id?: string
  reportId?: string
  hazardType?: string
  severity?: string
  status?: string
  latitude?: number
  longitude?: number
  description?: string
  reporterId?: string
  createdAt?: string
  [k: string]: unknown
}

export interface ReportUpdatedEvent {
  id?: string
  status?: string
  [k: string]: unknown
}

export interface ReportBulkUpdatedEvent {
  reportIds?: string[]
  status?: string
  [k: string]: unknown
}

export interface IncidentAlertEvent {
  incidentType?: string
  riskLevel?: string
  title?: string
  description?: string
  timestamp?: string
  [k: string]: unknown
}

export interface DistressEvent {
  id?: string
  userId?: string
  status?: string
  latitude?: number
  longitude?: number
  timestamp?: string
  [k: string]: unknown
}

export interface AegisChannelMap {
  // Spine
  [AegisChannels.HAZARD_PREDICTED]: HazardPredictedEvent
  [AegisChannels.RISK_UPDATED]: RiskUpdatedEvent
  [AegisChannels.ALERT_NEW]: AlertNewEvent
  [AegisChannels.INCIDENT_ESCALATED]: IncidentEscalatedEvent
  [AegisChannels.REPORT_CREATED]: ReportCreatedEvent
  // Legacy
  [AegisChannels.REPORT_NEW]: ReportNewEvent
  [AegisChannels.REPORT_UPDATED]: ReportUpdatedEvent
  [AegisChannels.REPORT_BULK_UPDATED]: ReportBulkUpdatedEvent
  [AegisChannels.INCIDENT_ALERT]: IncidentAlertEvent
  [AegisChannels.INCIDENT_ALERT_PRIORITY]: IncidentAlertEvent
  [AegisChannels.INCIDENT_PREDICTIONS_UPDATED]: Record<string, unknown>
  [AegisChannels.DISTRESS_NEW_ALERT]: DistressEvent
  [AegisChannels.DISTRESS_NEW]: DistressEvent
  [AegisChannels.DISTRESS_UPDATED]: DistressEvent
  [AegisChannels.DISTRESS_ALARM]: DistressEvent
  [AegisChannels.DISTRESS_CANCELLED]: DistressEvent
  [AegisChannels.DISTRESS_STATUS_CHANGED]: DistressEvent & { distressId?: string }
  [AegisChannels.DISTRESS_LOCATION]: DistressEvent & { distressId?: string; accuracy?: number; heading?: number; speed?: number }
  [AegisChannels.DISTRESS_ACKNOWLEDGED]: DistressEvent
  [AegisChannels.DISTRESS_RESOLVED]: DistressEvent
  [AegisChannels.ALERT_UPDATE]: IncidentAlertEvent
}

/** Strongly-typed subscribe helper. Returns an unsubscribe function. */
export function subscribeChannel<C extends AegisChannel>(
  socket: Socket,
  channel: C,
  handler: (payload: AegisChannelMap[C]) => void,
): () => void {
  // socket.io's listener type is conditional on the channel literal; we
  // intentionally bridge to a runtime-checked handler via `any` so the
  // typed contract on the public API is preserved without fighting the
  // socket-typed map.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = socket as any
  const wrapped = (payload: unknown) => handler(payload as AegisChannelMap[C])
  s.on(channel, wrapped)
  return () => { s.off(channel, wrapped) }
}
