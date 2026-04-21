/**
 * AEGIS Typed Event Bus
 *
 * Thin, strongly-typed facade over the existing eventStreaming service
 * (memory backend + DLQ + outbox). Gives publishers and subscribers
 * compile-time guarantees that payload shapes match event names.
 *
 *   await eventBus.publish('report.created', { reportId, ... })
 *   eventBus.subscribe('report.created', async (evt) => { ... })
 *
 * The bus also:
 *   - Inherits the correlation ID from AsyncLocalStorage automatically
 *   - Wraps every event in a standard envelope (id, source, timestamp,
 *     severity, correlationId)
 *   - Isolates subscriber failures via the underlying DLQ so a broken
 *     subscriber never blocks publishers or sibling subscribers.
 */

import { randomUUID } from 'crypto'
import {
  publish as rawPublish,
  subscribe as rawSubscribe,
  type StreamEvent,
} from '../services/eventStreaming.js'
import { logger } from '../services/logger.js'
import {
  type AegisEventName,
  type AegisEventSource,
  type AegisSeverity,
} from './eventTypes.js'
import type { AegisEventMap } from './eventContracts.js'
import { currentCorrelationId } from './correlationContext.js'

/** Standard envelope every Aegis event carries. */
export interface AegisEventEnvelope<N extends AegisEventName = AegisEventName> {
  id: string
  name: N
  source: AegisEventSource
  timestamp: string
  correlationId: string
  severity?: AegisSeverity
  regionId?: string
  payload: AegisEventMap[N]
}

/** Optional metadata a publisher may override. */
export interface PublishOptions {
  source?: AegisEventSource
  severity?: AegisSeverity
  regionId?: string
  correlationId?: string
}

/** A subscriber receives the typed envelope, not the raw payload. */
export type AegisSubscriber<N extends AegisEventName> = (
  event: AegisEventEnvelope<N>,
) => Promise<void> | void

/**
 * Publish a typed Aegis event. Payload shape is enforced by the compiler.
 */
async function publish<N extends AegisEventName>(
  name: N,
  payload: AegisEventMap[N],
  options: PublishOptions = {},
): Promise<string> {
  const envelope: AegisEventEnvelope<N> = {
    id: randomUUID(),
    name,
    source: options.source ?? 'system',
    timestamp: new Date().toISOString(),
    correlationId: options.correlationId ?? currentCorrelationId(),
    severity: options.severity,
    regionId: options.regionId,
    payload,
  }

  return rawPublish(name, envelope, {
    'x-correlation-id': envelope.correlationId,
    'x-event-name': name,
    'x-event-source': envelope.source,
  })
}

/**
 * Subscribe to a typed Aegis event. Returns an unsubscribe function.
 * Subscriber failures are caught by the underlying DLQ machinery; a
 * broken subscriber never blocks the publisher or sibling subscribers.
 */
function subscribe<N extends AegisEventName>(
  name: N,
  handler: AegisSubscriber<N>,
  opts: { groupId?: string } = {},
): () => void {
  const wrapped = async (raw: StreamEvent<AegisEventEnvelope<N>>) => {
    try {
      await handler(raw.value)
    } catch (err) {
      // Re-throw so the underlying eventStreaming DLQ records it.
      logger.error(
        { err, event: name, eventId: raw.value?.id },
        '[eventBus] subscriber threw',
      )
      throw err
    }
  }
  return rawSubscribe(name, wrapped, { groupId: opts.groupId })
}

export const eventBus = { publish, subscribe }
