/**
 * AEGIS Event Type Catalogue
 *
 * Single source of truth for every event name that flows through the
 * typed event bus. Names are dotted, lowercase, and stable -- consumers
 * pattern-match on these literals.
 *
 * Adding a new event:
 *   1. Add the name here
 *   2. Add the matching payload interface in eventContracts.ts
 *   3. Add the entry to AegisEventMap (eventContracts.ts)
 *   4. TypeScript will then enforce typed publish/subscribe everywhere.
 */

export const AegisEventNames = {
  // Citizen / ingest
  REPORT_CREATED: 'report.created',
  SOS_ACTIVATED: 'sos.activated',
  SENSOR_READING_INGESTED: 'sensor.reading.ingested',

  // Intelligence (continuous AI)
  HAZARD_PREDICTED: 'hazard.predicted',
  RISK_UPDATED: 'risk.updated',
  CASCADE_TRIGGERED: 'cascade.triggered',

  // Operator / response
  ALERT_CREATED: 'alert.created',
  INCIDENT_ESCALATED: 'incident.escalated',
  RESOURCE_DISPATCHED: 'resource.dispatched',

  // System
  SYSTEM_HEALTH_CHANGED: 'system.health.changed',
} as const

export type AegisEventName =
  typeof AegisEventNames[keyof typeof AegisEventNames]

/** Where an event originated -- used for filtering and audit. */
export type AegisEventSource =
  | 'citizen'
  | 'operator'
  | 'ai-engine'
  | 'system'
  | 'external-api'
  | 'subscriber'

/** Standard severity ladder shared across hazards, alerts, incidents. */
export type AegisSeverity = 'low' | 'medium' | 'high' | 'critical'
