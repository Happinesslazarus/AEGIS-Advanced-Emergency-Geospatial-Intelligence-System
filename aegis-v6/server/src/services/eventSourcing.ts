/**
 * File: eventSourcing.ts
 *
 * Append-only event store — records domain events with correlation/causation
 * IDs, supports aggregate replay from event history, and creates periodic
 * snapshots for performance. Instrumented with Prometheus counters.
 *
 * How it connects:
 * - Writes events to PostgreSQL as an immutable append-only log
 * - Replays events to reconstruct aggregate state
 * - Uses correlation IDs compatible with distributed tracing
 *
 * Simple explanation:
 * Records every change as an event so the system can replay history.
 */

import { Pool } from 'pg'
import { v4 as uuidv4 } from 'uuid'
import client from 'prom-client'
import { logger } from './logger.js'

// Prometheus metrics
const eventsStored = new client.Counter({
  name: 'aegis_events_stored_total',
  help: 'Total events stored in event store',
  labelNames: ['aggregate_type', 'event_type'] as const,
})

const eventReplayTime = new client.Histogram({
  name: 'aegis_event_replay_seconds',
  help: 'Time to replay events for aggregate',
  labelNames: ['aggregate_type'] as const,
  buckets: [0.01, 0.05, 0.1, 0.5, 1, 5, 10],
})

const snapshotCreated = new client.Counter({
  name: 'aegis_snapshots_created_total',
  help: 'Total snapshots created',
  labelNames: ['aggregate_type'] as const,
})

// Event interfaces
export interface DomainEvent {
  eventId: string
  aggregateId: string
  aggregateType: string
  eventType: string
  eventVersion: number
  timestamp: Date
  correlationId?: string
  causationId?: string
  userId?: string
  data: Record<string, any>
  metadata: EventMetadata
}

export interface EventMetadata {
  schemaVersion: number
  source: string
  ipAddress?: string
  userAgent?: string
  sessionId?: string
  environment: string
  serverInstance?: string
}

export interface Snapshot {
  snapshotId: string
  aggregateId: string
  aggregateType: string
  version: number
  state: Record<string, any>
  createdAt: Date
}

export interface EventQuery {
  aggregateId?: string
  aggregateType?: string
  eventTypes?: string[]
  fromVersion?: number
  toVersion?: number
  fromTimestamp?: Date
  toTimestamp?: Date
  correlationId?: string
  userId?: string
  limit?: number
}

// Event handlers registry
type EventHandler = (event: DomainEvent) => Promise<void>
const eventHandlers: Map<string, EventHandler[]> = new Map()

// Snapshot interval (create snapshot every N events)
const SNAPSHOT_INTERVAL = 100

let pool: Pool | null = null

/**
 * Initialize event sourcing with database pool
 */
export async function initEventSourcing(dbPool: Pool): Promise<void> {
  pool = dbPool

  // Ensure tables exist
  await pool.query(`
    -- Event Store table (append-only, immutable)
    CREATE TABLE IF NOT EXISTS event_store (
      event_id UUID PRIMARY KEY,
      aggregate_id UUID NOT NULL,
      aggregate_type VARCHAR(100) NOT NULL,
      event_type VARCHAR(100) NOT NULL,
      event_version INTEGER NOT NULL,
      timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      correlation_id UUID,
      causation_id UUID,
      user_id VARCHAR(100),
      data JSONB NOT NULL,
      metadata JSONB NOT NULL,
      -- Ensure event ordering per aggregate
      UNIQUE (aggregate_id, event_version)
    );

    -- Indexes for efficient queries
    CREATE INDEX IF NOT EXISTS idx_event_store_aggregate 
      ON event_store(aggregate_id, event_version);
    CREATE INDEX IF NOT EXISTS idx_event_store_type 
      ON event_store(aggregate_type, event_type);
    CREATE INDEX IF NOT EXISTS idx_event_store_timestamp 
      ON event_store(timestamp);
    CREATE INDEX IF NOT EXISTS idx_event_store_correlation 
      ON event_store(correlation_id) WHERE correlation_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_event_store_user 
      ON event_store(user_id) WHERE user_id IS NOT NULL;

    -- Snapshots table for faster aggregate loading
    CREATE TABLE IF NOT EXISTS event_snapshots (
      snapshot_id UUID PRIMARY KEY,
      aggregate_id UUID NOT NULL,
      aggregate_type VARCHAR(100) NOT NULL,
      version INTEGER NOT NULL,
      state JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (aggregate_id, version)
    );

    CREATE INDEX IF NOT EXISTS idx_snapshots_aggregate 
      ON event_snapshots(aggregate_id, version DESC);

    -- Audit log view for compliance
    CREATE OR REPLACE VIEW audit_log AS
    SELECT 
      event_id,
      timestamp,
      aggregate_type,
      aggregate_id,
      event_type,
      user_id,
      metadata->>'ipAddress' as ip_address,
      metadata->>'source' as source,
      data
    FROM event_store
    ORDER BY timestamp DESC;
  `)

  logger.info('[EventSourcing] Initialized event store tables')
}

/**
 * Append event to the event store
 */
export async function appendEvent(
  aggregateId: string,
  aggregateType: string,
  eventType: string,
  data: Record<string, any>,
  options: {
    correlationId?: string
    causationId?: string
    userId?: string
    metadata?: Partial<EventMetadata>
    expectedVersion?: number  // Optimistic concurrency control
  } = {}
): Promise<DomainEvent> {
  if (!pool) throw new Error('Event sourcing not initialized')

  const eventId = uuidv4()
  const timestamp = new Date()

  // Get next version for aggregate
  const versionResult = await pool.query(
    `SELECT COALESCE(MAX(event_version), 0) as current_version 
     FROM event_store WHERE aggregate_id = $1`,
    [aggregateId]
  )
  const currentVersion = versionResult.rows[0].current_version
  const nextVersion = currentVersion + 1

  // Optimistic concurrency check
  if (options.expectedVersion !== undefined && options.expectedVersion !== currentVersion) {
    throw new Error(
      `Concurrency conflict: expected version ${options.expectedVersion}, found ${currentVersion}`
    )
  }

  const metadata: EventMetadata = {
    schemaVersion: 1,
    source: 'aegis-server',
    environment: process.env.NODE_ENV || 'development',
    serverInstance: process.env.HOSTNAME || 'unknown',
    ...options.metadata,
  }

  const event: DomainEvent = {
    eventId,
    aggregateId,
    aggregateType,
    eventType,
    eventVersion: nextVersion,
    timestamp,
    correlationId: options.correlationId,
    causationId: options.causationId,
    userId: options.userId,
    data,
    metadata,
  }

  // Insert into event store (immutable append)
  await pool.query(
    `INSERT INTO event_store (
      event_id, aggregate_id, aggregate_type, event_type, event_version,
      timestamp, correlation_id, causation_id, user_id, data, metadata
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      event.eventId,
      event.aggregateId,
      event.aggregateType,
      event.eventType,
      event.eventVersion,
      event.timestamp,
      event.correlationId || null,
      event.causationId || null,
      event.userId || null,
      JSON.stringify(event.data),
      JSON.stringify(event.metadata),
    ]
  )

  eventsStored.labels(aggregateType, eventType).inc()

  // Auto-snapshot if interval reached
  if (nextVersion % SNAPSHOT_INTERVAL === 0) {
    await createSnapshotInternal(aggregateId, aggregateType)
  }

  // Dispatch to registered handlers
  await dispatchEvent(event)

  logger.debug({
    eventId,
    aggregateId,
    eventType,
    version: nextVersion,
  }, '[EventSourcing] Event appended')

  return event
}

/**
 * Query events from the event store
 */
export async function queryEvents(query: EventQuery): Promise<DomainEvent[]> {
  if (!pool) throw new Error('Event sourcing not initialized')

  const conditions: string[] = []
  const params: any[] = []
  let paramIndex = 1

  if (query.aggregateId) {
    conditions.push(`aggregate_id = $${paramIndex++}`)
    params.push(query.aggregateId)
  }

  if (query.aggregateType) {
    conditions.push(`aggregate_type = $${paramIndex++}`)
    params.push(query.aggregateType)
  }

  if (query.eventTypes?.length) {
    conditions.push(`event_type = ANY($${paramIndex++})`)
    params.push(query.eventTypes)
  }

  if (query.fromVersion !== undefined) {
    conditions.push(`event_version >= $${paramIndex++}`)
    params.push(query.fromVersion)
  }

  if (query.toVersion !== undefined) {
    conditions.push(`event_version <= $${paramIndex++}`)
    params.push(query.toVersion)
  }

  if (query.fromTimestamp) {
    conditions.push(`timestamp >= $${paramIndex++}`)
    params.push(query.fromTimestamp)
  }

  if (query.toTimestamp) {
    conditions.push(`timestamp <= $${paramIndex++}`)
    params.push(query.toTimestamp)
  }

  if (query.correlationId) {
    conditions.push(`correlation_id = $${paramIndex++}`)
    params.push(query.correlationId)
  }

  if (query.userId) {
    conditions.push(`user_id = $${paramIndex++}`)
    params.push(query.userId)
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  let limitClause = ''
  if (typeof query.limit === 'number' && Number.isFinite(query.limit) && query.limit > 0) {
    limitClause = `LIMIT $${paramIndex++}`
    params.push(Math.floor(query.limit))
  }

  const result = await pool.query(
    `SELECT * FROM event_store ${whereClause} 
     ORDER BY aggregate_id, event_version ASC ${limitClause}`,
    params
  )

  return result.rows.map(mapRowToEvent)
}

/**
 * Get aggregate state by replaying events (point-in-time reconstruction)
 */
export async function getAggregateState<T extends Record<string, any>>(
  aggregateId: string,
  aggregateType: string,
  reducer: (state: T, event: DomainEvent) => T,
  initialState: T,
  options: { atTimestamp?: Date; atVersion?: number } = {}
): Promise<{ state: T; version: number }> {
  if (!pool) throw new Error('Event sourcing not initialized')

  const startTime = Date.now()

  // Try to load from snapshot first
  let state = { ...initialState }
  let fromVersion = 0

  const snapshotResult = await pool.query(
    `SELECT * FROM event_snapshots 
     WHERE aggregate_id = $1 AND aggregate_type = $2
     ${options.atVersion ? `AND version <= $3` : ''}
     ORDER BY version DESC LIMIT 1`,
    options.atVersion 
      ? [aggregateId, aggregateType, options.atVersion]
      : [aggregateId, aggregateType]
  )

  if (snapshotResult.rows.length > 0) {
    const snapshot = snapshotResult.rows[0]
    state = snapshot.state as T
    fromVersion = snapshot.version
  }

  // Load events after snapshot
  const query: EventQuery = {
    aggregateId,
    aggregateType,
    fromVersion: fromVersion + 1,
  }

  if (options.atVersion) query.toVersion = options.atVersion
  if (options.atTimestamp) query.toTimestamp = options.atTimestamp

  const events = await queryEvents(query)

  // Replay events through reducer
  let currentVersion = fromVersion
  for (const event of events) {
    state = reducer(state, event)
    currentVersion = event.eventVersion
  }

  eventReplayTime.labels(aggregateType).observe((Date.now() - startTime) / 1000)

  return { state, version: currentVersion }
}

/**
 * Create a snapshot of current aggregate state
 */
async function createSnapshotInternal(
  aggregateId: string,
  aggregateType: string
): Promise<void> {
  if (!pool) return

  // This would normally use a registered reducer - simplified for now
  const events = await queryEvents({ aggregateId, aggregateType })
  if (events.length === 0) return

  const latestVersion = events[events.length - 1].eventVersion

  // Store raw events as snapshot (actual impl would use reducer)
  const snapshotId = uuidv4()
  const state = {
    __events: events.map(e => ({ type: e.eventType, data: e.data })),
    __version: latestVersion,
  }

  await pool.query(
    `INSERT INTO event_snapshots (snapshot_id, aggregate_id, aggregate_type, version, state)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (aggregate_id, version) DO NOTHING`,
    [snapshotId, aggregateId, aggregateType, latestVersion, JSON.stringify(state)]
  )

  snapshotCreated.labels(aggregateType).inc()

  logger.debug({
    aggregateId,
    version: latestVersion,
  }, '[EventSourcing] Snapshot created')
}

/**
 * Create explicit snapshot with custom state
 */
export async function createSnapshot(
  aggregateId: string,
  aggregateType: string,
  version: number,
  state: Record<string, any>
): Promise<Snapshot> {
  if (!pool) throw new Error('Event sourcing not initialized')

  const snapshotId = uuidv4()
  const createdAt = new Date()

  await pool.query(
    `INSERT INTO event_snapshots (snapshot_id, aggregate_id, aggregate_type, version, state, created_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (aggregate_id, version) DO UPDATE SET state = $5, created_at = $6`,
    [snapshotId, aggregateId, aggregateType, version, JSON.stringify(state), createdAt]
  )

  snapshotCreated.labels(aggregateType).inc()

  return { snapshotId, aggregateId, aggregateType, version, state, createdAt }
}

/**
 * Register event handler for projections/side effects
 */
export function registerEventHandler(eventType: string, handler: EventHandler): void {
  if (!eventHandlers.has(eventType)) {
    eventHandlers.set(eventType, [])
  }
  eventHandlers.get(eventType)!.push(handler)
}

/**
 * Dispatch event to registered handlers
 */
async function dispatchEvent(event: DomainEvent): Promise<void> {
  const handlers = eventHandlers.get(event.eventType) || []
  const wildcardHandlers = eventHandlers.get('*') || []

  for (const handler of [...handlers, ...wildcardHandlers]) {
    try {
      await handler(event)
    } catch (err) {
      logger.error({
        err,
        eventId: event.eventId,
        eventType: event.eventType,
      }, '[EventSourcing] Handler failed')
    }
  }
}

/**
 * Replay all events (for rebuilding projections)
 */
export async function replayAllEvents(
  handler: EventHandler,
  options: { batchSize?: number; fromTimestamp?: Date } = {}
): Promise<{ processed: number; errors: number }> {
  if (!pool) throw new Error('Event sourcing not initialized')

  const batchSize = options.batchSize || 1000
  let offset = 0
  let processed = 0
  let errors = 0

  const whereClause = options.fromTimestamp
    ? `WHERE timestamp >= $1`
    : ''
  const params = options.fromTimestamp ? [options.fromTimestamp] : []

  while (true) {
    const result = await pool.query(
      `SELECT * FROM event_store ${whereClause}
       ORDER BY timestamp ASC, event_version ASC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, batchSize, offset]
    )

    if (result.rows.length === 0) break

    for (const row of result.rows) {
      try {
        await handler(mapRowToEvent(row))
        processed++
      } catch {
        errors++
      }
    }

    offset += batchSize
    logger.info({ processed, errors }, '[EventSourcing] Replay progress')
  }

  return { processed, errors }
}

/**
 * Get audit trail for compliance
 */
export async function getAuditTrail(
  options: {
    userId?: string
    aggregateType?: string
    fromDate?: Date
    toDate?: Date
    limit?: number
  } = {}
): Promise<DomainEvent[]> {
  return queryEvents({
    userId: options.userId,
    aggregateType: options.aggregateType,
    fromTimestamp: options.fromDate,
    toTimestamp: options.toDate,
    limit: options.limit || 1000,
  })
}

/**
 * Archive old events (for compliance/retention)
 */
export async function archiveEvents(
  beforeDate: Date,
  targetTable: string = 'event_store_archive'
): Promise<number> {
  if (!pool) throw new Error('Event sourcing not initialized')

  // Create archive table if not exists
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${targetTable} (LIKE event_store INCLUDING ALL)
  `)

  // Move old events to archive
  const result = await pool.query(
    `WITH moved AS (
       DELETE FROM event_store 
       WHERE timestamp < $1
       RETURNING *
     )
     INSERT INTO ${targetTable} SELECT * FROM moved
     RETURNING event_id`,
    [beforeDate]
  )

  const archivedCount = result.rowCount || 0

  logger.info({
    beforeDate,
    archivedCount,
  }, '[EventSourcing] Events archived')

  return archivedCount
}

/**
 * Map database row to DomainEvent
 */
function mapRowToEvent(row: any): DomainEvent {
  return {
    eventId: row.event_id,
    aggregateId: row.aggregate_id,
    aggregateType: row.aggregate_type,
    eventType: row.event_type,
    eventVersion: row.event_version,
    timestamp: new Date(row.timestamp),
    correlationId: row.correlation_id,
    causationId: row.causation_id,
    userId: row.user_id,
    data: row.data,
    metadata: row.metadata,
  }
}

// Pre-defined event types for AEGIS domain
export const EventTypes = {
  // Report events
  REPORT_CREATED: 'report.created',
  REPORT_UPDATED: 'report.updated',
  REPORT_VERIFIED: 'report.verified',
  REPORT_REJECTED: 'report.rejected',
  REPORT_ESCALATED: 'report.escalated',
  REPORT_RESOLVED: 'report.resolved',

  // User events
  USER_REGISTERED: 'user.registered',
  USER_LOGGED_IN: 'user.logged_in',
  USER_LOGGED_OUT: 'user.logged_out',
  USER_PROFILE_UPDATED: 'user.profile_updated',
  USER_ROLE_CHANGED: 'user.role_changed',

  // Chat events
  CHAT_MESSAGE_SENT: 'chat.message_sent',
  CHAT_MESSAGE_FLAGGED: 'chat.message_flagged',

  // Distress events
  DISTRESS_SIGNAL_SENT: 'distress.signal_sent',
  DISTRESS_RESPONDED: 'distress.responded',
  DISTRESS_RESOLVED: 'distress.resolved',

  // System events
  SYSTEM_CONFIG_CHANGED: 'system.config_changed',
  FEATURE_FLAG_UPDATED: 'feature.flag_updated',
}

export default {
  initEventSourcing,
  appendEvent,
  queryEvents,
  getAggregateState,
  createSnapshot,
  registerEventHandler,
  replayAllEvents,
  getAuditTrail,
  archiveEvents,
  EventTypes,
}
