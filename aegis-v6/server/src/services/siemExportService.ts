/**
 * File: siemExportService.ts
 *
 * SIEM event exporter — formats security events in CEF/OCSF and pushes them
 * to Splunk, Datadog, Elasticsearch, or Azure Sentinel. Event types are
 * aligned with the MITRE ATT&CK framework (TA0001–TA0040).
 *
 * How it connects:
 * - Reads security events from the security_events table
 * - Pushes formatted events to configured SIEM endpoints via HTTP
 * - Severity levels range from INFO(1) to CRITICAL(9)
 *
 * Simple explanation:
 * Sends security events to external monitoring tools so the SOC team can investigate them.
 */

import crypto from 'crypto'
import pool from '../models/db.js'
import { logger } from '../services/logger.js'

// Security Event Types aligned with MITRE ATT&CK
export enum SecurityEventType {
  // Initial Access (TA0001)
  AUTH_LOGIN_SUCCESS = 'auth.login.success',
  AUTH_LOGIN_FAILURE = 'auth.login.failure',
  AUTH_BRUTE_FORCE = 'auth.brute_force',
  AUTH_CREDENTIAL_STUFFING = 'auth.credential_stuffing',
  
  // Persistence (TA0003)
  AUTH_MFA_ENROLLED = 'auth.mfa.enrolled',
  AUTH_MFA_REMOVED = 'auth.mfa.removed',
  AUTH_PASSKEY_REGISTERED = 'auth.passkey.registered',
  AUTH_SESSION_CREATED = 'auth.session.created',
  
  // Privilege Escalation (TA0004)
  AUTH_STEP_UP = 'auth.step_up',
  AUTH_ROLE_CHANGED = 'auth.role.changed',
  AUTH_PERMISSION_GRANTED = 'auth.permission.granted',
  
  // Defense Evasion (TA0005)
  SESSION_HIJACK_DETECTED = 'session.hijack.detected',
  SESSION_DRIFT = 'session.drift',
  
  // Credential Access (TA0006)
  AUTH_PASSWORD_CHANGED = 'auth.password.changed',
  AUTH_PASSWORD_RESET = 'auth.password.reset',
  AUTH_PASSWORD_BREACHED = 'auth.password.breached',
  
  // Discovery (TA0007)
  DATA_ACCESS = 'data.access',
  DATA_EXPORT = 'data.export',
  
  // Collection (TA0009)
  DATA_EXFILTRATION_ATTEMPT = 'data.exfiltration.attempt',
  
  // Impact (TA0040)
  ACCOUNT_LOCKED = 'account.locked',
  ACCOUNT_DELETED = 'account.deleted',
  
  // Anomalies
  ANOMALY_IMPOSSIBLE_TRAVEL = 'anomaly.impossible_travel',
  ANOMALY_NEW_DEVICE = 'anomaly.new_device',
  ANOMALY_NEW_LOCATION = 'anomaly.new_location',
  ANOMALY_UNUSUAL_TIME = 'anomaly.unusual_time',
  
  // Threats
  THREAT_IP_BLOCKED = 'threat.ip.blocked',
  THREAT_HIGH_RISK = 'threat.high_risk',
  
  // System
  SYSTEM_CONFIG_CHANGED = 'system.config.changed',
  SYSTEM_ERROR = 'system.error',
}

// Event Severity Levels
export enum EventSeverity {
  INFO = 1,
  LOW = 3,
  MEDIUM = 5,
  HIGH = 7,
  CRITICAL = 9,
}

// SIEM Destinations
export type SIEMDestination = 'splunk' | 'datadog' | 'elasticsearch' | 'azure_sentinel' | 'webhook'

export interface SecurityEvent {
  eventId: string
  eventType: SecurityEventType
  severity: EventSeverity
  timestamp: Date
  userId?: string
  sessionId?: string
  ipAddress?: string
  userAgent?: string
  deviceFingerprint?: string
  geoLocation?: {
    country: string
    city: string
    lat?: number
    lon?: number
  }
  resourceId?: string
  action?: string
  outcome: 'success' | 'failure' | 'unknown'
  reason?: string
  metadata?: Record<string, any>
  correlation?: {
    parentEventId?: string
    relatedEventIds?: string[]
    attackChainId?: string
  }
  mitreAttack?: {
    tactic?: string
    technique?: string
    subtechnique?: string
  }
}

export interface CEFEvent {
  version: string
  deviceVendor: string
  deviceProduct: string
  deviceVersion: string
  signatureId: string
  name: string
  severity: number
  extension: Record<string, string>
}

export interface OCSFEvent {
  class_uid: number
  category_uid: number
  activity_id: number
  severity_id: number
  time: number
  message: string
  metadata: Record<string, any>
  actor?: Record<string, any>
  device?: Record<string, any>
  network_endpoint?: Record<string, any>
}

// Configuration
const config = {
  splunkHEC: process.env.SPLUNK_HEC_URL || '',
  splunkToken: process.env.SPLUNK_HEC_TOKEN || '',
  datadogApiKey: process.env.DATADOG_API_KEY || '',
  datadogSite: process.env.DATADOG_SITE || 'datadoghq.com',
  elasticsearchUrl: process.env.ELASTICSEARCH_URL || '',
  elasticsearchIndex: process.env.ELASTICSEARCH_SECURITY_INDEX || 'security-events',
  azureSentinelWorkspaceId: process.env.AZURE_SENTINEL_WORKSPACE_ID || '',
  azureSentinelKey: process.env.AZURE_SENTINEL_KEY || '',
  webhookUrl: process.env.SIEM_WEBHOOK_URL || '',
  webhookSecret: process.env.SIEM_WEBHOOK_SECRET || '',
  batchSize: 100,
  flushIntervalMs: 5000,
  retryAttempts: 3,
  retryDelayMs: 1000,
}

// Event buffer for batch sending
const eventBuffer: SecurityEvent[] = []
let flushTimer: NodeJS.Timeout | null = null

// Active destinations
const activeDestinations: Set<SIEMDestination> = new Set()

/**
 * Initialize SIEM export service
 */
export async function initSIEMExport(): Promise<void> {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS security_events (
        event_id VARCHAR(64) PRIMARY KEY,
        event_type VARCHAR(100) NOT NULL,
        severity INTEGER NOT NULL,
        timestamp TIMESTAMPTZ NOT NULL,
        user_id VARCHAR(100),
        session_id VARCHAR(64),
        ip_address VARCHAR(45),
        user_agent TEXT,
        device_fingerprint VARCHAR(64),
        geo_location JSONB,
        resource_id VARCHAR(255),
        action VARCHAR(100),
        outcome VARCHAR(20) NOT NULL,
        reason TEXT,
        metadata JSONB DEFAULT '{}',
        correlation JSONB DEFAULT '{}',
        mitre_attack JSONB,
        exported_to TEXT[] DEFAULT '{}',
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      
      CREATE TABLE IF NOT EXISTS siem_export_status (
        id SERIAL PRIMARY KEY,
        destination VARCHAR(50) NOT NULL,
        last_export_at TIMESTAMPTZ,
        events_exported INTEGER DEFAULT 0,
        last_error TEXT,
        status VARCHAR(20) DEFAULT 'active'
      );
      
      CREATE INDEX IF NOT EXISTS idx_security_events_type ON security_events(event_type, timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_security_events_user ON security_events(user_id, timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_security_events_severity ON security_events(severity DESC, timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_security_events_timestamp ON security_events(timestamp DESC);
    `)
    
    // Auto-detect available destinations
    detectAvailableDestinations()
    
    // Start flush timer
    startFlushTimer()
    
    // Clean old events periodically
    setInterval(cleanOldEvents, 24 * 60 * 60 * 1000) // Daily
    
    logger.info(`[SIEM] Service initialized with destinations: ${[...activeDestinations].join(', ') || 'none'}`)
  } catch (error: any) {
    logger.error('[SIEM] Init failed:', error.message)
  }
}

/**
 * Detect available SIEM destinations based on configuration
 */
function detectAvailableDestinations(): void {
  if (config.splunkHEC && config.splunkToken) {
    activeDestinations.add('splunk')
  }
  if (config.datadogApiKey) {
    activeDestinations.add('datadog')
  }
  if (config.elasticsearchUrl) {
    activeDestinations.add('elasticsearch')
  }
  if (config.azureSentinelWorkspaceId && config.azureSentinelKey) {
    activeDestinations.add('azure_sentinel')
  }
  if (config.webhookUrl) {
    activeDestinations.add('webhook')
  }
}

/**
 * Start flush timer for batched exports
 */
function startFlushTimer(): void {
  if (flushTimer) return
  
  flushTimer = setInterval(async () => {
    if (eventBuffer.length > 0) {
      await flushEvents()
    }
  }, config.flushIntervalMs)
}

/**
 * Clean old events from local storage
 */
async function cleanOldEvents(): Promise<void> {
  try {
    await pool.query(`
      DELETE FROM security_events
      WHERE timestamp < NOW() - INTERVAL '90 days'
    `)
  } catch {}
}

/**
 * Generate unique event ID
 */
function generateEventId(): string {
  return `evt_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`
}

/**
 * Create and queue a security event
 */
export async function logSecurityEvent(
  eventType: SecurityEventType,
  details: Partial<SecurityEvent>
): Promise<string> {
  const eventId = generateEventId()
  
  const event: SecurityEvent = {
    eventId,
    eventType,
    severity: getDefaultSeverity(eventType),
    timestamp: new Date(),
    outcome: 'unknown',
    ...details,
    correlation: {
      ...details.correlation,
    },
    mitreAttack: getMITREMapping(eventType),
  }
  
  // Store locally
  try {
    await pool.query(`
      INSERT INTO security_events (
        event_id, event_type, severity, timestamp, user_id, session_id,
        ip_address, user_agent, device_fingerprint, geo_location,
        resource_id, action, outcome, reason, metadata, correlation, mitre_attack
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
    `, [
      event.eventId,
      event.eventType,
      event.severity,
      event.timestamp,
      event.userId,
      event.sessionId,
      event.ipAddress,
      event.userAgent,
      event.deviceFingerprint,
      event.geoLocation ? JSON.stringify(event.geoLocation) : null,
      event.resourceId,
      event.action,
      event.outcome,
      event.reason,
      JSON.stringify(event.metadata || {}),
      JSON.stringify(event.correlation || {}),
      event.mitreAttack ? JSON.stringify(event.mitreAttack) : null,
    ])
  } catch (error: any) {
    logger.error('[SIEM] Failed to store event:', error.message)
  }
  
  // Queue for export
  eventBuffer.push(event)
  
  // Flush if buffer is full
  if (eventBuffer.length >= config.batchSize) {
    flushEvents().catch(() => {})
  }
  
  // Log high severity events immediately
  if (event.severity >= EventSeverity.HIGH) {
    logger.warn(`[SIEM] High severity event: ${eventType} - ${event.reason || 'No reason provided'}`)
  }
  
  return eventId
}

/**
 * Get default severity for event type
 */
function getDefaultSeverity(eventType: SecurityEventType): EventSeverity {
  const severityMap: Partial<Record<SecurityEventType, EventSeverity>> = {
    [SecurityEventType.AUTH_LOGIN_SUCCESS]: EventSeverity.INFO,
    [SecurityEventType.AUTH_LOGIN_FAILURE]: EventSeverity.LOW,
    [SecurityEventType.AUTH_BRUTE_FORCE]: EventSeverity.HIGH,
    [SecurityEventType.AUTH_CREDENTIAL_STUFFING]: EventSeverity.HIGH,
    [SecurityEventType.SESSION_HIJACK_DETECTED]: EventSeverity.CRITICAL,
    [SecurityEventType.AUTH_PASSWORD_BREACHED]: EventSeverity.HIGH,
    [SecurityEventType.DATA_EXFILTRATION_ATTEMPT]: EventSeverity.CRITICAL,
    [SecurityEventType.ANOMALY_IMPOSSIBLE_TRAVEL]: EventSeverity.HIGH,
    [SecurityEventType.THREAT_HIGH_RISK]: EventSeverity.HIGH,
    [SecurityEventType.THREAT_IP_BLOCKED]: EventSeverity.MEDIUM,
    [SecurityEventType.ACCOUNT_LOCKED]: EventSeverity.MEDIUM,
    [SecurityEventType.ACCOUNT_DELETED]: EventSeverity.MEDIUM,
  }
  
  return severityMap[eventType] || EventSeverity.INFO
}

/**
 * Get MITRE ATT&CK mapping for event type
 */
function getMITREMapping(eventType: SecurityEventType): SecurityEvent['mitreAttack'] | undefined {
  const mappings: Partial<Record<SecurityEventType, SecurityEvent['mitreAttack']>> = {
    [SecurityEventType.AUTH_BRUTE_FORCE]: { tactic: 'TA0001', technique: 'T1110', subtechnique: 'T1110.001' },
    [SecurityEventType.AUTH_CREDENTIAL_STUFFING]: { tactic: 'TA0001', technique: 'T1110', subtechnique: 'T1110.004' },
    [SecurityEventType.AUTH_PASSWORD_BREACHED]: { tactic: 'TA0006', technique: 'T1552' },
    [SecurityEventType.SESSION_HIJACK_DETECTED]: { tactic: 'TA0005', technique: 'T1550' },
    [SecurityEventType.DATA_EXFILTRATION_ATTEMPT]: { tactic: 'TA0010', technique: 'T1041' },
    [SecurityEventType.ANOMALY_IMPOSSIBLE_TRAVEL]: { tactic: 'TA0001', technique: 'T1078' },
  }
  
  return mappings[eventType]
}

/**
 * Flush event buffer to all destinations
 */
async function flushEvents(): Promise<void> {
  if (eventBuffer.length === 0) return
  
  const eventsToSend = [...eventBuffer]
  eventBuffer.length = 0
  
  const exportPromises: Promise<void>[] = []
  
  for (const destination of activeDestinations) {
    exportPromises.push(
      exportToDestination(destination, eventsToSend).catch(error => {
        logger.error(`[SIEM] Export to ${destination} failed:`, error.message)
      })
    )
  }
  
  await Promise.allSettled(exportPromises)
}

/**
 * Export events to a specific destination
 */
async function exportToDestination(
  destination: SIEMDestination,
  events: SecurityEvent[]
): Promise<void> {
  switch (destination) {
    case 'splunk':
      await exportToSplunk(events)
      break
    case 'datadog':
      await exportToDatadog(events)
      break
    case 'elasticsearch':
      await exportToElasticsearch(events)
      break
    case 'azure_sentinel':
      await exportToAzureSentinel(events)
      break
    case 'webhook':
      await exportToWebhook(events)
      break
  }
  
  // Mark events as exported
  const eventIds = events.map(e => e.eventId)
  await pool.query(`
    UPDATE security_events
    SET exported_to = array_append(exported_to, $1)
    WHERE event_id = ANY($2)
  `, [destination, eventIds]).catch(() => {})
}

/**
 * Export to Splunk HEC
 */
async function exportToSplunk(events: SecurityEvent[]): Promise<void> {
  if (!config.splunkHEC || !config.splunkToken) return
  
  const payload = events.map(event => ({
    time: Math.floor(event.timestamp.getTime() / 1000),
    host: 'aegis',
    source: 'aegis-security',
    sourcetype: '_json',
    event: {
      ...event,
      timestamp: event.timestamp.toISOString(),
    },
  }))
  
  await fetchWithRetry(config.splunkHEC, {
    method: 'POST',
    headers: {
      'Authorization': `Splunk ${config.splunkToken}`,
      'Content-Type': 'application/json',
    },
    body: payload.map(p => JSON.stringify(p)).join('\n'),
  })
}

/**
 * Export to Datadog
 */
async function exportToDatadog(events: SecurityEvent[]): Promise<void> {
  if (!config.datadogApiKey) return
  
  const logs = events.map(event => ({
    ddsource: 'aegis',
    ddtags: `env:production,service:aegis-security,severity:${event.severity}`,
    hostname: 'aegis',
    message: JSON.stringify(event),
    service: 'aegis-security',
    status: event.severity >= EventSeverity.HIGH ? 'error' : 
            event.severity >= EventSeverity.MEDIUM ? 'warning' : 'info',
  }))
  
  await fetchWithRetry(`https://http-intake.logs.${config.datadogSite}/api/v2/logs`, {
    method: 'POST',
    headers: {
      'DD-API-KEY': config.datadogApiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(logs),
  })
}

/**
 * Export to Elasticsearch
 */
async function exportToElasticsearch(events: SecurityEvent[]): Promise<void> {
  if (!config.elasticsearchUrl) return
  
  // Build bulk request
  const bulkBody = events.flatMap(event => [
    { index: { _index: config.elasticsearchIndex } },
    {
      '@timestamp': event.timestamp.toISOString(),
      ...event,
    },
  ])
  
  await fetchWithRetry(`${config.elasticsearchUrl}/_bulk`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-ndjson',
    },
    body: bulkBody.map(line => JSON.stringify(line)).join('\n') + '\n',
  })
}

/**
 * Export to Azure Sentinel
 */
async function exportToAzureSentinel(events: SecurityEvent[]): Promise<void> {
  if (!config.azureSentinelWorkspaceId || !config.azureSentinelKey) return
  
  const logType = 'AegisSecurityEvents'
  const body = JSON.stringify(events)
  const date = new Date().toUTCString()
  
  // Build Azure Monitor signature
  const stringToHash = `POST\n${Buffer.byteLength(body)}\napplication/json\nx-ms-date:${date}\n/api/logs`
  const decodedKey = Buffer.from(config.azureSentinelKey, 'base64')
  const signature = crypto.createHmac('sha256', decodedKey).update(stringToHash).digest('base64')
  
  await fetchWithRetry(
    `https://${config.azureSentinelWorkspaceId}.ods.opinsights.azure.com/api/logs?api-version=2016-04-01`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Log-Type': logType,
        'x-ms-date': date,
        'Authorization': `SharedKey ${config.azureSentinelWorkspaceId}:${signature}`,
      },
      body,
    }
  )
}

/**
 * Export to webhook
 */
async function exportToWebhook(events: SecurityEvent[]): Promise<void> {
  if (!config.webhookUrl) return
  
  const payload = {
    events,
    timestamp: new Date().toISOString(),
    count: events.length,
  }
  
  const body = JSON.stringify(payload)
  const signature = config.webhookSecret
    ? crypto.createHmac('sha256', config.webhookSecret).update(body).digest('hex')
    : undefined
  
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  
  if (signature) {
    headers['X-Signature-256'] = `sha256=${signature}`
  }
  
  await fetchWithRetry(config.webhookUrl, {
    method: 'POST',
    headers,
    body,
  })
}

/**
 * Fetch with retry logic
 */
async function fetchWithRetry(
  url: string,
  options: RequestInit,
  attempts = config.retryAttempts
): Promise<Response> {
  let lastError: Error | null = null
  
  for (let i = 0; i < attempts; i++) {
    try {
      const response = await fetch(url, options)
      if (response.ok) return response
      
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    } catch (error: any) {
      lastError = error
      if (i < attempts - 1) {
        await new Promise(resolve => setTimeout(resolve, config.retryDelayMs * (i + 1)))
      }
    }
  }
  
  throw lastError || new Error('Export failed')
}

/**
 * Convert event to CEF format
 */
export function toCEF(event: SecurityEvent): string {
  const cef: CEFEvent = {
    version: '0',
    deviceVendor: 'AEGIS',
    deviceProduct: 'SecurityPlatform',
    deviceVersion: '1.0',
    signatureId: event.eventType,
    name: event.eventType.replace(/\./g, ' '),
    severity: event.severity,
    extension: {
      src: event.ipAddress || '',
      suser: event.userId || '',
      outcome: event.outcome,
      reason: event.reason || '',
      msg: JSON.stringify(event.metadata || {}),
    },
  }
  
  const ext = Object.entries(cef.extension)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}=${escapeCEFValue(v)}`)
    .join(' ')
  
  return `CEF:${cef.version}|${cef.deviceVendor}|${cef.deviceProduct}|${cef.deviceVersion}|${cef.signatureId}|${cef.name}|${cef.severity}|${ext}`
}

/**
 * Escape CEF special characters
 */
function escapeCEFValue(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .replace(/=/g, '\\=')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
}

/**
 * Convert event to OCSF format
 */
export function toOCSF(event: SecurityEvent): OCSFEvent {
  return {
    class_uid: 3001, // Security Finding
    category_uid: 2, // Findings
    activity_id: 1, // Create
    severity_id: event.severity,
    time: event.timestamp.getTime(),
    message: `${event.eventType}: ${event.reason || event.outcome}`,
    metadata: {
      version: '1.0.0',
      product: {
        name: 'AEGIS Security Platform',
        vendor_name: 'AEGIS',
        version: '1.0',
      },
      uid: event.eventId,
    },
    actor: event.userId ? {
      user: { uid: event.userId },
      session: { uid: event.sessionId },
    } : undefined,
    device: event.deviceFingerprint ? {
      uid: event.deviceFingerprint,
      type: 'browser',
    } : undefined,
    network_endpoint: event.ipAddress ? {
      ip: event.ipAddress,
      location: event.geoLocation,
    } : undefined,
  }
}

/**
 * Query security events
 */
export async function querySecurityEvents(
  filters: {
    eventType?: SecurityEventType
    userId?: string
    severity?: EventSeverity
    startTime?: Date
    endTime?: Date
    outcome?: 'success' | 'failure'
  },
  options: { limit?: number; offset?: number } = {}
): Promise<{ events: SecurityEvent[]; total: number }> {
  let query = 'SELECT * FROM security_events WHERE 1=1'
  let countQuery = 'SELECT COUNT(*)::int as count FROM security_events WHERE 1=1'
  const params: any[] = []
  
  if (filters.eventType) {
    params.push(filters.eventType)
    query += ` AND event_type = $${params.length}`
    countQuery += ` AND event_type = $${params.length}`
  }
  
  if (filters.userId) {
    params.push(filters.userId)
    query += ` AND user_id = $${params.length}`
    countQuery += ` AND user_id = $${params.length}`
  }
  
  if (filters.severity) {
    params.push(filters.severity)
    query += ` AND severity >= $${params.length}`
    countQuery += ` AND severity >= $${params.length}`
  }
  
  if (filters.startTime) {
    params.push(filters.startTime)
    query += ` AND timestamp >= $${params.length}`
    countQuery += ` AND timestamp >= $${params.length}`
  }
  
  if (filters.endTime) {
    params.push(filters.endTime)
    query += ` AND timestamp <= $${params.length}`
    countQuery += ` AND timestamp <= $${params.length}`
  }
  
  if (filters.outcome) {
    params.push(filters.outcome)
    query += ` AND outcome = $${params.length}`
    countQuery += ` AND outcome = $${params.length}`
  }
  
  query += ' ORDER BY timestamp DESC'
  
  const countParams = [...params]
  
  params.push(options.limit || 100)
  query += ` LIMIT $${params.length}`
  
  params.push(options.offset || 0)
  query += ` OFFSET $${params.length}`
  
  const [eventsResult, countResult] = await Promise.all([
    pool.query(query, params),
    pool.query(countQuery, countParams),
  ])
  
  return {
    events: eventsResult.rows.map(row => ({
      eventId: row.event_id,
      eventType: row.event_type,
      severity: row.severity,
      timestamp: row.timestamp,
      userId: row.user_id,
      sessionId: row.session_id,
      ipAddress: row.ip_address,
      userAgent: row.user_agent,
      deviceFingerprint: row.device_fingerprint,
      geoLocation: row.geo_location,
      resourceId: row.resource_id,
      action: row.action,
      outcome: row.outcome,
      reason: row.reason,
      metadata: row.metadata,
      correlation: row.correlation,
      mitreAttack: row.mitre_attack,
    })),
    total: countResult.rows[0]?.count || 0,
  }
}

/**
 * Get SIEM export statistics
 */
export async function getSIEMStats(): Promise<{
  totalEvents24h: number
  eventsBySeverity: Record<string, number>
  eventsByType: Array<{ type: string; count: number }>
  exportStatus: Array<{ destination: string; status: string; eventsExported: number }>
}> {
  const [total, bySeverity, byType] = await Promise.all([
    pool.query(`
      SELECT COUNT(*)::int as count FROM security_events
      WHERE timestamp > NOW() - INTERVAL '24 hours'
    `),
    pool.query(`
      SELECT severity, COUNT(*)::int as count FROM security_events
      WHERE timestamp > NOW() - INTERVAL '24 hours'
      GROUP BY severity ORDER BY severity
    `),
    pool.query(`
      SELECT event_type, COUNT(*)::int as count FROM security_events
      WHERE timestamp > NOW() - INTERVAL '24 hours'
      GROUP BY event_type ORDER BY count DESC LIMIT 10
    `),
  ])
  
  const severityMap: Record<string, number> = {}
  for (const row of bySeverity.rows) {
    const name = row.severity >= 9 ? 'critical' :
                 row.severity >= 7 ? 'high' :
                 row.severity >= 5 ? 'medium' :
                 row.severity >= 3 ? 'low' : 'info'
    severityMap[name] = (severityMap[name] || 0) + row.count
  }
  
  return {
    totalEvents24h: total.rows[0]?.count || 0,
    eventsBySeverity: severityMap,
    eventsByType: byType.rows.map(row => ({ type: row.event_type, count: row.count })),
    exportStatus: [...activeDestinations].map(dest => ({
      destination: dest,
      status: 'active',
      eventsExported: 0, // Would track from siem_export_status table
    })),
  }
}

/**
 * Force flush all pending events
 */
export async function forceFlush(): Promise<void> {
  await flushEvents()
}

export default {
  initSIEMExport,
  logSecurityEvent,
  querySecurityEvents,
  getSIEMStats,
  forceFlush,
  toCEF,
  toOCSF,
  SecurityEventType,
  EventSeverity,
}
