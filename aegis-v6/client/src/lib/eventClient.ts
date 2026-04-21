/**
 * Typed Frontend Event Stream
 *
 * Mirror of the server's AegisEventMap so frontend subscribers get the
 * same compile-time guarantees the backend has. Used by useEventStream
 * and the hazard/risk hooks to subscribe to live AI predictions.
 */
import type { Socket } from 'socket.io-client'

export const AegisChannels = {
  HAZARD_PREDICTED: 'hazard:predicted',
  RISK_UPDATED: 'risk:updated',
  ALERT_NEW: 'alert:new',
  INCIDENT_ESCALATED: 'incident:escalated',
  REPORT_CREATED: 'report:created',
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
  alertId: string
  hazardType: string
  severity: 'low' | 'medium' | 'high' | 'critical'
  message: string
  affectedRegionId?: string
  correlationId?: string
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

export interface AegisChannelMap {
  [AegisChannels.HAZARD_PREDICTED]: HazardPredictedEvent
  [AegisChannels.RISK_UPDATED]: RiskUpdatedEvent
  [AegisChannels.ALERT_NEW]: AlertNewEvent
  [AegisChannels.INCIDENT_ESCALATED]: IncidentEscalatedEvent
  [AegisChannels.REPORT_CREATED]: ReportCreatedEvent
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
