/**
 * Correlation context -- propagates a request's correlation ID into every
 * async operation it spawns (services, subscribers, AI calls) using
 * Node's AsyncLocalStorage. Subscribers automatically inherit the
 * correlation ID of the request that emitted the event, so a single
 * trace ID threads through ingest -> intelligence -> action.
 */
import { AsyncLocalStorage } from 'async_hooks'
import { randomUUID } from 'crypto'

export interface CorrelationContext {
  correlationId: string
  /** Optional: who initiated -- userId, system component, etc. */
  actor?: string
}

const storage = new AsyncLocalStorage<CorrelationContext>()

/** Run a function with a correlation context bound to its async stack. */
export function runWithCorrelation<T>(
  ctx: CorrelationContext,
  fn: () => T,
): T {
  return storage.run(ctx, fn)
}

/** Get the current correlation context, if any. */
export function currentCorrelation(): CorrelationContext | undefined {
  return storage.getStore()
}

/** Get the current correlation ID, generating one if none is bound. */
export function currentCorrelationId(): string {
  return storage.getStore()?.correlationId ?? randomUUID()
}
