/**
 * AEGIS Event Payload Contracts
 *
 * Each event has a strongly-typed payload. The AegisEventMap below ties
 * event names to payload shapes so eventBus.publish() / subscribe() are
 * fully typed -- the compiler refuses any mismatch.
 *
 * These contracts are deliberately narrow: only the fields a subscriber
 * actually needs. Anything richer should be fetched by ID from the
 * relevant service inside the subscriber.
 */

import type { AegisEventNames, AegisSeverity } from './eventTypes.js'

// CITIZEN / INGEST PAYLOADS

export interface ReportCreatedPayload {
  reportId: string
  reporterId?: string
  hazardType: string
  latitude: number
  longitude: number
  description?: string
  mediaCount: number
  severity?: AegisSeverity
}

export interface ReportUpdatedPayload {
  reportId: string
  updatedBy?: string
  changedFields: string[]
  previousStatus?: string
  newStatus?: string
}

export interface ReportAssignedPayload {
  reportId: string
  assigneeId: string
  assignedBy?: string
  teamId?: string
}

export interface ReportResolvedPayload {
  reportId: string
  resolvedBy?: string
  resolution: string
  durationMs?: number
}

export interface SosActivatedPayload {
  sosId: string
  userId: string
  latitude: number
  longitude: number
  message?: string
  batteryLevel?: number
}

export interface SensorReadingIngestedPayload {
  sensorId: string
  sensorType: string
  value: number
  unit: string
  latitude: number
  longitude: number
  observedAt: string
}

// INTELLIGENCE PAYLOADS

export interface HazardPredictedPayload {
  predictionId: string
  hazardType: string
  regionId: string
  score: number
  confidence: number
  modelVersion: string
  features?: Record<string, number>
}

export interface RiskUpdatedPayload {
  regionId: string
  previousScore: number
  newScore: number
  delta: number
  reason: string
}

export interface CascadeTriggeredPayload {
  triggerEvent: string
  triggerEntityId: string
  cascadedHazard: string
  affectedRegionId: string
  reason: string
}

// RESPONSE PAYLOADS

export interface AlertCreatedPayload {
  alertId: string
  hazardType: string
  severity: AegisSeverity
  message: string
  affectedRegionId?: string
  expiresAt?: string
}

export interface AlertBroadcastPayload {
  alertId: string
  channels: ('socket' | 'push' | 'email' | 'sms' | 'telegram')[]
  audienceSize?: number
  affectedRegionId?: string
}

export interface AlertAcknowledgedPayload {
  alertId: string
  acknowledgedBy: string
  acknowledgedAt: string
  note?: string
}

export interface AlertExpiredPayload {
  alertId: string
  expiredAt: string
  reason?: 'ttl' | 'manual' | 'superseded'
}

export interface IncidentEscalatedPayload {
  incidentId: string
  fromSeverity: AegisSeverity
  toSeverity: AegisSeverity
  reason: string
}

export interface ResourceDispatchedPayload {
  dispatchId: string
  resourceType: string
  resourceId: string
  incidentId?: string
  destinationLat: number
  destinationLng: number
}

// SYSTEM PAYLOADS

export interface SystemHealthChangedPayload {
  component: string
  previousStatus: 'healthy' | 'degraded' | 'down'
  currentStatus: 'healthy' | 'degraded' | 'down'
  detail?: string
}

// EVENT NAME -> PAYLOAD MAP (compiler-enforced)

export interface AegisEventMap {
  [AegisEventNames.REPORT_CREATED]: ReportCreatedPayload
  [AegisEventNames.REPORT_UPDATED]: ReportUpdatedPayload
  [AegisEventNames.REPORT_ASSIGNED]: ReportAssignedPayload
  [AegisEventNames.REPORT_RESOLVED]: ReportResolvedPayload
  [AegisEventNames.SOS_ACTIVATED]: SosActivatedPayload
  [AegisEventNames.SENSOR_READING_INGESTED]: SensorReadingIngestedPayload
  [AegisEventNames.HAZARD_PREDICTED]: HazardPredictedPayload
  [AegisEventNames.RISK_UPDATED]: RiskUpdatedPayload
  [AegisEventNames.CASCADE_TRIGGERED]: CascadeTriggeredPayload
  [AegisEventNames.ALERT_CREATED]: AlertCreatedPayload
  [AegisEventNames.ALERT_BROADCAST]: AlertBroadcastPayload
  [AegisEventNames.ALERT_ACKNOWLEDGED]: AlertAcknowledgedPayload
  [AegisEventNames.ALERT_EXPIRED]: AlertExpiredPayload
  [AegisEventNames.INCIDENT_ESCALATED]: IncidentEscalatedPayload
  [AegisEventNames.RESOURCE_DISPATCHED]: ResourceDispatchedPayload
  [AegisEventNames.SYSTEM_HEALTH_CHANGED]: SystemHealthChangedPayload
}
