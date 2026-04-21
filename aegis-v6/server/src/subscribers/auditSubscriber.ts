/**
 * Audit Subscriber
 *
 * Subscribes to every Aegis event and writes a structured audit line.
 * Replaces ad-hoc `auditLog(...)` calls scattered across routes/services
 * with a single centralised observer that runs automatically for every
 * domain event the system emits.
 *
 * Failures here are isolated by the eventBus DLQ -- a broken audit
 * subscriber never blocks publishers or sibling subscribers.
 */
import { auditLog } from '../utils/logger.js'
import { eventBus } from '../events/eventBus.js'
import { AegisEventNames, type AegisEventName } from '../events/eventTypes.js'

const AUDITED_EVENTS: AegisEventName[] = Object.values(AegisEventNames)

export function registerAuditSubscriber(): () => void {
  const unsubscribers = AUDITED_EVENTS.map((name) =>
    eventBus.subscribe(name, async (evt) => {
      auditLog(`event:${evt.name}`, `[${evt.source}] ${evt.id}`, {
        correlationId: evt.correlationId,
        severity: evt.severity,
        regionId: evt.regionId,
        timestamp: evt.timestamp,
      })
    }),
  )
  return () => unsubscribers.forEach((u) => u())
}
