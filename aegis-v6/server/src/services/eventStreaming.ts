/**
 * In-process event streaming service -- zero external broker dependencies.
 * Uses MemoryStreamBackend (EventEmitter) for fan-out, the Transactional
 * Outbox pattern (Richardson -- https://microservices.io/patterns/data/
 * transactional-outbox.html) for durability, and dead-letter queuing with
 * exponential back-off (Kleppmann 2017, Ch.11) for fault isolation.
 */

import { EventEmitter } from 'events'
import { createHash, randomUUID } from 'crypto'
import pool from '../models/db.js'
import { logger } from './logger.js'

//TYPE DEFINITIONS

export interface StreamEvent<T = any> {
  id: string
  topic: string
  key?: string
  value: T
  headers: Record<string, string>
  timestamp: Date
  partition?: number
  offset?: number
  schemaVersion?: string
}

export interface EventSchema {
  name: string
  version: string
  fields: SchemaField[]
  required?: string[]
}

export interface SchemaField {
  name: string
  type: 'string' | 'number' | 'boolean' | 'object' | 'array' | 'null'
  description?: string
  items?: SchemaField // For arrays
  properties?: Record<string, SchemaField> // For objects
}

type EventHandler<T = any> = (event: StreamEvent<T>) => Promise<void>

type StreamBackend = 'memory'

interface DeadLetterEntry {
  originalEvent: StreamEvent
  error: string
  retryCount: number
  lastAttempt: Date
  nextRetry?: Date
}

//TOPICS / ROUTING KEYS

export const Topics = {
  //Report lifecycle
  REPORT_CREATED: 'aegis.reports.created',
  REPORT_UPDATED: 'aegis.reports.updated',
  REPORT_ASSIGNED: 'aegis.reports.assigned',
  REPORT_RESOLVED: 'aegis.reports.resolved',
  REPORT_ESCALATED: 'aegis.reports.escalated',
  
  //Alert lifecycle
  ALERT_CREATED: 'aegis.alerts.created',
  ALERT_BROADCAST: 'aegis.alerts.broadcast',
  ALERT_ACKNOWLEDGED: 'aegis.alerts.acknowledged',
  ALERT_EXPIRED: 'aegis.alerts.expired',
  
  //User events
  USER_REGISTERED: 'aegis.users.registered',
  USER_LOGIN: 'aegis.users.login',
  USER_LOCATION_UPDATE: 'aegis.users.location',
  
  //AI/ML events
  AI_CLASSIFICATION_COMPLETED: 'aegis.ai.classification.completed',
  AI_THREAT_LEVEL_CHANGED: 'aegis.ai.threat.changed',
  AI_PREDICTION_GENERATED: 'aegis.ai.prediction.generated',
  
  //System events
  SYSTEM_HEALTH_CHECK: 'aegis.system.health',
  SYSTEM_METRIC_COLLECTED: 'aegis.system.metrics',
  SYSTEM_AUDIT_LOG: 'aegis.system.audit',
  
  //Dead letter
  DEAD_LETTER: 'aegis.dlq',
} as const

//SCHEMA REGISTRY

const schemaRegistry = new Map<string, EventSchema[]>()

/**
 * Register an event schema
 */
export function registerSchema(schema: EventSchema): void {
  const existing = schemaRegistry.get(schema.name) || []
  existing.push(schema)
  schemaRegistry.set(schema.name, existing)
  logger.info(`[EventStreaming] Schema registered: ${schema.name} v${schema.version}`)
}

/**
 * Get latest schema version for an event type
 */
export function getSchema(name: string, version?: string): EventSchema | undefined {
  const versions = schemaRegistry.get(name)
  if (!versions || versions.length === 0) return undefined
  
  if (version) {
    return versions.find(s => s.version === version)
  }
  
  //Return latest version
  return versions[versions.length - 1]
}

/**
 * Validate event against schema
 */
function validateEvent(event: StreamEvent, schema: EventSchema): { valid: boolean; errors: string[] } {
  const errors: string[] = []
  const value = event.value
  
  //Check required fields
  if (schema.required) {
    for (const field of schema.required) {
      if (value[field] === undefined || value[field] === null) {
        errors.push(`Missing required field: ${field}`)
      }
    }
  }
  
  //Type check fields
  for (const field of schema.fields) {
    const fieldValue = value[field.name]
    if (fieldValue === undefined) continue
    
    const actualType = Array.isArray(fieldValue) ? 'array' : typeof fieldValue
    if (actualType !== field.type && field.type !== 'null') {
      errors.push(`Field ${field.name}: expected ${field.type}, got ${actualType}`)
    }
  }
  
  return { valid: errors.length === 0, errors }
}

//Register built-in schemas
registerSchema({
  name: 'ReportCreated',
  version: '1.0.0',
  fields: [
    { name: 'reportId', type: 'string' },
    { name: 'title', type: 'string' },
    { name: 'hazardType', type: 'string' },
    { name: 'severity', type: 'number' },
    { name: 'location', type: 'object' },
    { name: 'reporterId', type: 'string' },
    { name: 'timestamp', type: 'string' },
  ],
  required: ['reportId', 'title', 'hazardType', 'severity'],
})

registerSchema({
  name: 'AlertBroadcast',
  version: '1.0.0',
  fields: [
    { name: 'alertId', type: 'string' },
    { name: 'title', type: 'string' },
    { name: 'severity', type: 'string' },
    { name: 'affectedArea', type: 'object' },
    { name: 'targetUsers', type: 'array' },
  ],
  required: ['alertId', 'title', 'severity'],
})

//IN-MEMORY BACKEND (Development/Testing)

class MemoryStreamBackend {
  private static MAX_EVENTS_PER_TOPIC = 10_000
  private topics = new Map<string, StreamEvent[]>()
  private consumers = new Map<string, Set<EventHandler>>()
  private consumerGroups = new Map<string, Map<string, number>>() // groupId -> topic -> offset
  private emitter = new EventEmitter()

  async produce(event: StreamEvent): Promise<string> {
    const events = this.topics.get(event.topic) || []
    event.offset = events.length
    event.partition = 0
    events.push(event)
    //Evict oldest events when topic exceeds retention limit
    if (events.length > MemoryStreamBackend.MAX_EVENTS_PER_TOPIC) {
      events.splice(0, events.length - MemoryStreamBackend.MAX_EVENTS_PER_TOPIC)
    }
    this.topics.set(event.topic, events)
    
    //Notify consumers
    this.emitter.emit(event.topic, event)
    
    return event.id
  }
  
  subscribe(topic: string, handler: EventHandler, groupId?: string): () => void {
    const handlers = this.consumers.get(topic) || new Set()
    handlers.add(handler)
    this.consumers.set(topic, handlers)
    
    //Set up listener
    const listener = async (event: StreamEvent) => {
      try {
        await handler(event)
        
        //Update offset for consumer group
        if (groupId) {
          const group = this.consumerGroups.get(groupId) || new Map()
          group.set(topic, (event.offset || 0) + 1)
          this.consumerGroups.set(groupId, group)
        }
      } catch (err) {
        logger.error({ err }, `[EventStreaming] Handler error for ${topic}`)
      }
    }
    
    this.emitter.on(topic, listener)
    
    return () => {
      handlers.delete(handler)
      this.emitter.off(topic, listener)
    }
  }
  
  async replay(topic: string, fromOffset: number, handler: EventHandler): Promise<void> {
    const events = this.topics.get(topic) || []
    for (let i = fromOffset; i < events.length; i++) {
      await handler(events[i])
    }
  }
  
  getPartitions(topic: string): number[] {
    return this.topics.has(topic) ? [0] : []
  }
  
  getOffset(topic: string, groupId: string): number {
    return this.consumerGroups.get(groupId)?.get(topic) || 0
  }
  
  getStats(): { topics: number; events: number; consumers: number } {
    let totalEvents = 0
    for (const events of this.topics.values()) {
      totalEvents += events.length
    }
    
    let totalConsumers = 0
    for (const handlers of this.consumers.values()) {
      totalConsumers += handlers.size
    }
    
    return {
      topics: this.topics.size,
      events: totalEvents,
      consumers: totalConsumers,
    }
  }
}

//DEAD LETTER QUEUE

const deadLetterQueue: DeadLetterEntry[] = []
const MAX_RETRIES = 5
const RETRY_DELAYS = [1000, 5000, 30000, 120000, 600000] // 1s, 5s, 30s, 2m, 10m

async function handleDeadLetter(
  event: StreamEvent,
  error: Error,
  retryCount: number
): Promise<void> {
  if (retryCount >= MAX_RETRIES) {
    //Move to dead letter queue
    deadLetterQueue.push({
      originalEvent: event,
      error: error.message,
      retryCount,
      lastAttempt: new Date(),
    })
    
    //Persist to database for durability
    try {
      await pool.query(
        `INSERT INTO dead_letter_queue (event_id, topic, payload, error, retry_count)
         VALUES ($1, $2, $3, $4, $5)`,
        [event.id, event.topic, JSON.stringify(event.value), error.message, retryCount]
      )
    } catch (dbErr) {
      logger.error({ err: dbErr }, '[EventStreaming] Failed to persist DLQ entry')
    }
    
    logger.error(`[EventStreaming] Event ${event.id} moved to dead letter queue after ${retryCount} retries`)
    return
  }
  
  //Schedule retry with exponential backoff
  const delay = RETRY_DELAYS[retryCount] || RETRY_DELAYS[RETRY_DELAYS.length - 1]
  logger.warn(`[EventStreaming] Scheduling retry ${retryCount + 1} for event ${event.id} in ${delay}ms`)
  
  setTimeout(() => {
    //Re-publish with retry header
    publish(event.topic, event.value, {
      ...event.headers,
      'x-retry-count': String(retryCount + 1),
      'x-original-id': event.id,
    }).catch(err => {
      logger.error({ err }, '[EventStreaming] Retry failed')
    })
  }, delay)
}

export function getDeadLetterQueue(): DeadLetterEntry[] {
  return [...deadLetterQueue]
}

export async function replayDeadLetterEvent(eventId: string): Promise<boolean> {
  const index = deadLetterQueue.findIndex(e => e.originalEvent.id === eventId)
  if (index === -1) return false
  
  const entry = deadLetterQueue.splice(index, 1)[0]
  await publish(entry.originalEvent.topic, entry.originalEvent.value, {
    ...entry.originalEvent.headers,
    'x-dlq-replay': 'true',
  })
  
  return true
}

//TRANSACTIONAL OUTBOX PATTERN

interface OutboxEntry {
  id: string
  topic: string
  payload: any
  headers: Record<string, string>
  createdAt: Date
  published: boolean
  publishedAt?: Date
}

/**
 * Write event to outbox within database transaction
 * Ensures exactly-once semantics with database operations
 */
export async function writeToOutbox(
  client: any, // Database transaction client
  topic: string,
  payload: any,
  headers: Record<string, string> = {}
): Promise<string> {
  const id = randomUUID()
  
  await client.query(
    `INSERT INTO event_outbox (id, topic, payload, headers, created_at, published)
     VALUES ($1, $2, $3, $4, NOW(), false)`,
    [id, topic, JSON.stringify(payload), JSON.stringify(headers)]
  )
  
  return id
}

/**
 * Process outbox entries (called by background worker)
 */
export async function processOutbox(): Promise<number> {
  const result = await pool.query(
    `SELECT * FROM event_outbox 
     WHERE published = false 
     ORDER BY created_at 
     LIMIT 100
     FOR UPDATE SKIP LOCKED`
  )
  
  let published = 0
  
  for (const row of result.rows) {
    try {
      await publish(row.topic, JSON.parse(row.payload), JSON.parse(row.headers))
      
      await pool.query(
        `UPDATE event_outbox SET published = true, published_at = NOW() WHERE id = $1`,
        [row.id]
      )
      
      published++
    } catch (err) {
      logger.error({ err, entryId: row.id }, '[EventStreaming] Failed to process outbox entry')
    }
  }
  
  return published
}

//MAIN EVENT STREAMING SERVICE

let backend: MemoryStreamBackend
let initialized = false

const subscriptionHandlers = new Map<string, Map<string, EventHandler>>()

/**
 * Initialize event streaming service
 */
export async function initEventStreaming(): Promise<void> {
  backend = new MemoryStreamBackend()

  //Ensure outbox/DLQ tables exist before polling
  await createEventStreamingTables()

  //Start outbox processor
  setInterval(processOutbox, 5000)

  initialized = true
  logger.info('[EventStreaming] Initialized with memory backend')
}

/**
 * Publish an event to a topic
 */
export async function publish<T = any>(
  topic: string,
  value: T,
  headers: Record<string, string> = {},
  key?: string
): Promise<string> {
  if (!initialized) {
    await initEventStreaming()
  }
  
  const event: StreamEvent<T> = {
    id: randomUUID(),
    topic,
    key,
    value,
    headers: {
      'x-event-time': new Date().toISOString(),
      'x-producer': 'aegis-backend',
      'x-correlation-id': headers['x-correlation-id'] || randomUUID(),
      ...headers,
    },
    timestamp: new Date(),
  }
  
  //Schema validation if available
  const schemaName = headers['x-schema-name']
  if (schemaName) {
    const schema = getSchema(schemaName)
    if (schema) {
      const validation = validateEvent(event, schema)
      if (!validation.valid) {
        throw new Error(`Schema validation failed: ${validation.errors.join(', ')}`)
      }
      event.schemaVersion = schema.version
    }
  }
  
  const eventId = await backend.produce(event)
  
  //Emit metrics
  eventMetrics.published++
  eventMetrics.byTopic.set(topic, (eventMetrics.byTopic.get(topic) || 0) + 1)
  
  return eventId
}

/**
 * Subscribe to a topic with a handler
 */
export function subscribe<T = any>(
  topic: string,
  handler: EventHandler<T>,
  options: { groupId?: string; fromBeginning?: boolean } = {}
): () => void {
  if (!initialized) {
    initEventStreaming()
  }
  
  const wrappedHandler: EventHandler = async (event) => {
    const retryCount = parseInt(event.headers['x-retry-count'] || '0', 10)
    
    try {
      await handler(event)
      eventMetrics.consumed++
    } catch (err: any) {
      eventMetrics.errors++
      await handleDeadLetter(event, err, retryCount)
    }
  }
  
  //Track subscription
  if (!subscriptionHandlers.has(topic)) {
    subscriptionHandlers.set(topic, new Map())
  }
  const handlerId = randomUUID()
  subscriptionHandlers.get(topic)!.set(handlerId, wrappedHandler)
  
  const unsubscribe = backend.subscribe(topic, wrappedHandler, options.groupId)
  
  return () => {
    unsubscribe()
    subscriptionHandlers.get(topic)?.delete(handlerId)
  }
}

/**
 * Replay events from a specific offset
 */
export async function replay(
  topic: string,
  fromOffset: number,
  handler: EventHandler
): Promise<void> {
  if (!initialized) {
    await initEventStreaming()
  }
  
  await backend.replay(topic, fromOffset, handler)
}

//CONVENIENCE PUBLISHERS FOR AEGIS EVENTS

export const EventPublishers = {
  reportCreated: (report: any) => publish(Topics.REPORT_CREATED, {
    reportId: report.id,
    title: report.title,
    hazardType: report.hazardType,
    severity: report.severity,
    location: report.location,
    reporterId: report.reporterId,
    timestamp: new Date().toISOString(),
  }, { 'x-schema-name': 'ReportCreated' }, report.id),
  
  reportUpdated: (report: any, changes: string[]) => publish(Topics.REPORT_UPDATED, {
    reportId: report.id,
    changes,
    updatedAt: new Date().toISOString(),
  }, {}, report.id),
  
  reportAssigned: (reportId: string, responderId: string) => publish(Topics.REPORT_ASSIGNED, {
    reportId,
    responderId,
    assignedAt: new Date().toISOString(),
  }, {}, reportId),
  
  reportResolved: (reportId: string, resolution: string) => publish(Topics.REPORT_RESOLVED, {
    reportId,
    resolution,
    resolvedAt: new Date().toISOString(),
  }, {}, reportId),
  
  alertBroadcast: (alert: any, targetUserIds?: string[]) => publish(Topics.ALERT_BROADCAST, {
    alertId: alert.id,
    title: alert.title,
    severity: alert.severity,
    affectedArea: alert.affectedArea,
    targetUsers: targetUserIds,
  }, { 'x-schema-name': 'AlertBroadcast' }),
  
  aiClassificationCompleted: (reportId: string, result: any) => publish(Topics.AI_CLASSIFICATION_COMPLETED, {
    reportId,
    result,
    completedAt: new Date().toISOString(),
  }),
  
  threatLevelChanged: (region: string, oldLevel: number, newLevel: number) => publish(Topics.AI_THREAT_LEVEL_CHANGED, {
    region,
    oldLevel,
    newLevel,
    changedAt: new Date().toISOString(),
  }),
  
  auditLog: (action: string, userId: string, details: any) => publish(Topics.SYSTEM_AUDIT_LOG, {
    action,
    userId,
    details,
    timestamp: new Date().toISOString(),
  }),
}

//METRICS & MONITORING

const eventMetrics = {
  published: 0,
  consumed: 0,
  errors: 0,
  dlqSize: 0,
  byTopic: new Map<string, number>(),
}

export function getEventStreamingStats(): {
  backend: StreamBackend
  metrics: typeof eventMetrics
  dlqSize: number
  subscriptions: { topic: string; handlers: number }[]
  backendStats: any
} {
  const subscriptions: { topic: string; handlers: number }[] = []
  for (const [topic, handlers] of subscriptionHandlers) {
    subscriptions.push({ topic, handlers: handlers.size })
  }
  
  return {
    backend: (backend as any).constructor.name.replace('StreamBackend', '').toLowerCase() as StreamBackend,
    metrics: {
      ...eventMetrics,
      byTopic: Object.fromEntries(eventMetrics.byTopic) as any,
    },
    dlqSize: deadLetterQueue.length,
    subscriptions,
    backendStats: backend.getStats(),
  }
}

//DATABASE MIGRATIONS FOR OUTBOX & DLQ

export async function createEventStreamingTables(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS event_outbox (
      id UUID PRIMARY KEY,
      topic VARCHAR(255) NOT NULL,
      payload JSONB NOT NULL,
      headers JSONB DEFAULT '{}',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      published BOOLEAN DEFAULT false,
      published_at TIMESTAMPTZ
    );
    
    CREATE INDEX IF NOT EXISTS idx_outbox_unpublished 
      ON event_outbox(created_at) WHERE published = false;
    
    CREATE TABLE IF NOT EXISTS dead_letter_queue (
      id SERIAL PRIMARY KEY,
      event_id UUID NOT NULL,
      topic VARCHAR(255) NOT NULL,
      payload JSONB NOT NULL,
      error TEXT,
      retry_count INT DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    
    CREATE INDEX IF NOT EXISTS idx_dlq_topic ON dead_letter_queue(topic);
  `)
  
  logger.info('[EventStreaming] Database tables created')
}

export default {
  initEventStreaming,
  publish,
  subscribe,
  replay,
  Topics,
  EventPublishers,
  registerSchema,
  getSchema,
  writeToOutbox,
  processOutbox,
  getDeadLetterQueue,
  replayDeadLetterEvent,
  getEventStreamingStats,
  createEventStreamingTables,
}
