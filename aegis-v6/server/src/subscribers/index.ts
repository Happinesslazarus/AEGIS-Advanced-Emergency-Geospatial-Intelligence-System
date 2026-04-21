/**
 * Subscriber Bootstrap
 *
 * Single entry point that wires every event subscriber. Called once at
 * server start (after Socket.IO is initialised so the broadcast
 * subscriber can resolve getIO()).
 *
 * Adding a new behaviour = add a new subscriber file and register it
 * here. Routes never have to change.
 */
import { logger } from '../services/logger.js'
import { registerAuditSubscriber } from './auditSubscriber.js'
import { registerSocketBroadcastSubscriber } from './socketBroadcastSubscriber.js'
import { registerCascadeRules } from '../intelligence/cascadeRules.js'

export function registerAllSubscribers(): () => void {
  const unsubs = [
    registerAuditSubscriber(),
    registerSocketBroadcastSubscriber(),
    registerCascadeRules(),
  ]
  logger.info(`[subscribers] registered ${unsubs.length} subscriber group(s)`)
  return () => unsubs.forEach((u) => u())
}
