/**
 * File: grpcServices.ts
 *
 * Typed internal service-to-service API — defines TypeScript interfaces
 * mirroring Protocol Buffer message types (reports, alerts, analytics) and
 * gRPC status codes for direct backend communication.
 *
 * How it connects:
 * - Accepts internal requests through the gRPC gateway
 * - Reads and aggregates report, alert, AI, and analytics data
 * - Shares auth, tracing, and deadline metadata across service calls
 *
 * Simple explanation:
 * The typed internal API for fast service-to-service calls.
 */

import { EventEmitter } from 'events'
import { randomUUID } from 'crypto'
import pool from '../models/db.js'

// PROTOCOL BUFFER DEFINITIONS (represented as TypeScript interfaces)

// In production, these would be generated from .proto files

export interface GrpcMetadata {
  'x-request-id'?: string
  'x-trace-id'?: string
  'authorization'?: string
  'x-deadline-ms'?: string
  'x-client-name'?: string
}

export interface GrpcStatus {
  code: GrpcStatusCode
  message: string
  details?: any[]
}

export enum GrpcStatusCode {
  OK = 0,
  CANCELLED = 1,
  UNKNOWN = 2,
  INVALID_ARGUMENT = 3,
  DEADLINE_EXCEEDED = 4,
  NOT_FOUND = 5,
  ALREADY_EXISTS = 6,
  PERMISSION_DENIED = 7,
  RESOURCE_EXHAUSTED = 8,
  FAILED_PRECONDITION = 9,
  ABORTED = 10,
  OUT_OF_RANGE = 11,
  UNIMPLEMENTED = 12,
  INTERNAL = 13,
  UNAVAILABLE = 14,
  DATA_LOSS = 15,
  UNAUTHENTICATED = 16,
}

// REPORT SERVICE PROTO

export interface Report {
  id: string
  title: string
  description: string
  hazardType: HazardType
  status: ReportStatus
  severity: number
  location: GeoPoint
  address: string
  images: string[]
  reporterId: string
  assignedResponderId: string
  createdAt: string
  updatedAt: string
  resolvedAt: string
}

export interface GeoPoint {
  latitude: number
  longitude: number
}

export enum HazardType {
  UNSPECIFIED = 0,
  FLOOD = 1,
  FIRE = 2,
  EARTHQUAKE = 3,
  LANDSLIDE = 4,
  STORM = 5,
  INFRASTRUCTURE = 6,
  ENVIRONMENTAL = 7,
  OTHER = 8,
}

export enum ReportStatus {
  STATUS_UNSPECIFIED = 0,
  PENDING = 1,
  IN_PROGRESS = 2,
  RESOLVED = 3,
  ESCALATED = 4,
  CLOSED = 5,
}

export interface GetReportRequest {
  id: string
}

export interface GetReportResponse {
  report: Report
}

export interface ListReportsRequest {
  pageSize: number
  pageToken: string
  filter?: ReportFilter
}

export interface ReportFilter {
  statuses: ReportStatus[]
  hazardTypes: HazardType[]
  minSeverity?: number
  bounds?: GeoBounds
  fromDate?: string
  toDate?: string
}

export interface GeoBounds {
  minLat: number
  maxLat: number
  minLng: number
  maxLng: number
}

export interface ListReportsResponse {
  reports: Report[]
  nextPageToken: string
  totalCount: number
}

export interface CreateReportRequest {
  title: string
  description: string
  hazardType: HazardType
  location: GeoPoint
  address: string
  images: string[]
  reporterId: string
}

export interface CreateReportResponse {
  report: Report
}

export interface UpdateReportRequest {
  id: string
  updateMask: string[]
  report: Partial<Report>
}

export interface UpdateReportResponse {
  report: Report
}

export interface StreamReportsRequest {
  filter?: ReportFilter
}

// ALERT SERVICE PROTO

export interface Alert {
  id: string
  title: string
  message: string
  severity: AlertSeverity
  affectedArea: GeoPolygon
  isActive: boolean
  expiresAt: string
  createdAt: string
  createdById: string
}

export interface GeoPolygon {
  points: GeoPoint[]
}

export enum AlertSeverity {
  SEVERITY_UNSPECIFIED = 0,
  INFO = 1,
  WARNING = 2,
  CRITICAL = 3,
  EMERGENCY = 4,
}

export interface BroadcastAlertRequest {
  alert: Alert
  targetUserIds?: string[]
  targetRadius?: number
  centerPoint?: GeoPoint
}

export interface BroadcastAlertResponse {
  deliveredCount: number
  failedCount: number
  alertId: string
}

export interface StreamAlertsRequest {
  location?: GeoPoint
  radiusKm?: number
  severities?: AlertSeverity[]
}

// AI SERVICE PROTO

export interface ClassifyImageRequest {
  imageBase64?: string
  imageUrl?: string
  reportId?: string
}

export interface ClassifyImageResponse {
  hazardType: HazardType
  confidence: number
  severity: number
  suggestedActions: string[]
  processingTimeMs: number
  modelVersion: string
}

export interface AnalyzeTextRequest {
  text: string
  context?: string
}

export interface AnalyzeTextResponse {
  hazardType: HazardType
  confidence: number
  entities: Entity[]
  sentiment: Sentiment
}

export interface Entity {
  text: string
  type: string
  confidence: number
}

export interface Sentiment {
  score: number
  magnitude: number
}

export interface GetThreatLevelRequest {
  region: string
}

export interface GetThreatLevelResponse {
  region: string
  level: number
  trend: string
  factors: ThreatFactor[]
  updatedAt: string
}

export interface ThreatFactor {
  name: string
  contribution: number
  details: string
}

// ANALYTICS SERVICE PROTO

export interface GetAnalyticsRequest {
  fromDate: string
  toDate: string
  region?: string
  granularity: Granularity
}

export enum Granularity {
  GRANULARITY_UNSPECIFIED = 0,
  HOURLY = 1,
  DAILY = 2,
  WEEKLY = 3,
  MONTHLY = 4,
}

export interface GetAnalyticsResponse {
  totalReports: number
  totalResolved: number
  averageResponseTimeMinutes: number
  byHazardType: HazardTypeMetric[]
  byStatus: StatusMetric[]
  timeSeries: TimeSeriesPoint[]
}

export interface HazardTypeMetric {
  type: HazardType
  count: number
  percentage: number
}

export interface StatusMetric {
  status: ReportStatus
  count: number
  percentage: number
}

export interface TimeSeriesPoint {
  timestamp: string
  value: number
}

export interface GetHeatmapRequest {
  bounds: GeoBounds
  resolution: number
  fromDate?: string
  toDate?: string
}

export interface GetHeatmapResponse {
  points: HeatmapPoint[]
}

export interface HeatmapPoint {
  latitude: number
  longitude: number
  intensity: number
}

// gRPC INTERCEPTORS

type UnaryInterceptor = (
  method: string,
  request: any,
  metadata: GrpcMetadata,
  next: () => Promise<any>
) => Promise<any>

type StreamInterceptor = (
  method: string,
  metadata: GrpcMetadata,
  stream: AsyncGenerator<any, void, any>
) => AsyncGenerator<any, void, any>

const unaryInterceptors: UnaryInterceptor[] = []
const streamInterceptors: StreamInterceptor[] = []

/**
 * Logging interceptor
 */
export function loggingInterceptor(): UnaryInterceptor {
  return async (method, request, metadata, next) => {
    const start = Date.now()
    const requestId = metadata['x-request-id'] || randomUUID()
    
    console.log(`[gRPC] ${method} started`, { requestId, request: JSON.stringify(request).slice(0, 200) })
    
    try {
      const response = await next()
      const duration = Date.now() - start
      console.log(`[gRPC] ${method} completed in ${duration}ms`, { requestId })
      return response
    } catch (err: any) {
      const duration = Date.now() - start
      console.error(`[gRPC] ${method} failed in ${duration}ms`, { requestId, error: err.message })
      throw err
    }
  }
}

/**
 * Authentication interceptor
 */
export function authInterceptor(): UnaryInterceptor {
  return async (method, request, metadata, next) => {
    const publicMethods = ['Health', 'Reflection']
    const isPublic = publicMethods.some(m => method.includes(m))
    
    if (!isPublic && !metadata['authorization']) {
      throw new GrpcError(GrpcStatusCode.UNAUTHENTICATED, 'Missing authorization header')
    }
    
    // In production: verify JWT token
    // const token = metadata['authorization']?.replace('Bearer ', '')
    // const decoded = jwt.verify(token, process.env.JWT_SECRET)
    
    return next()
  }
}

/**
 * Deadline interceptor
 */
export function deadlineInterceptor(): UnaryInterceptor {
  return async (method, request, metadata, next) => {
    const deadlineMs = parseInt(metadata['x-deadline-ms'] || '30000', 10)
    
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => {
        reject(new GrpcError(GrpcStatusCode.DEADLINE_EXCEEDED, `Deadline exceeded: ${deadlineMs}ms`))
      }, deadlineMs)
    })
    
    return Promise.race([next(), timeoutPromise])
  }
}

/**
 * Tracing interceptor
 */
export function tracingInterceptor(): UnaryInterceptor {
  return async (method, request, metadata, next) => {
    const traceId = metadata['x-trace-id'] || randomUUID()
    const spanId = randomUUID().slice(0, 16)
    
    // Add trace context to metadata
    metadata['x-trace-id'] = traceId
    
    // Record span
    grpcMetrics.traces.push({
      traceId,
      spanId,
      method,
      startTime: Date.now(),
    })
    
    try {
      const response = await next()
      
      // Update span
      const span = grpcMetrics.traces.find(t => t.spanId === spanId)
      if (span) {
        span.endTime = Date.now()
        span.status = 'OK'
      }
      
      return response
    } catch (err: any) {
      const span = grpcMetrics.traces.find(t => t.spanId === spanId)
      if (span) {
        span.endTime = Date.now()
        span.status = 'ERROR'
        span.error = err.message
      }
      throw err
    }
  }
}

// Register default interceptors
unaryInterceptors.push(loggingInterceptor())
unaryInterceptors.push(authInterceptor())
unaryInterceptors.push(deadlineInterceptor())
unaryInterceptors.push(tracingInterceptor())

// gRPC ERROR CLASS

export class GrpcError extends Error {
  code: GrpcStatusCode
  details: any[]
  
  constructor(code: GrpcStatusCode, message: string, details: any[] = []) {
    super(message)
    this.code = code
    this.details = details
    this.name = 'GrpcError'
  }
  
  toStatus(): GrpcStatus {
    return {
      code: this.code,
      message: this.message,
      details: this.details,
    }
  }
}

// SERVICE IMPLEMENTATIONS

// Event emitter for streaming
const streamEmitter = new EventEmitter()
streamEmitter.setMaxListeners(1000)

/**
 * Report Service Implementation
 */
export const ReportService = {
  async GetReport(request: GetReportRequest, _metadata: GrpcMetadata): Promise<GetReportResponse> {
    const result = await pool.query('SELECT * FROM reports WHERE id = $1', [request.id])
    
    if (result.rows.length === 0) {
      throw new GrpcError(GrpcStatusCode.NOT_FOUND, `Report not found: ${request.id}`)
    }
    
    return { report: transformDbReport(result.rows[0]) }
  },
  
  async ListReports(request: ListReportsRequest, _metadata: GrpcMetadata): Promise<ListReportsResponse> {
    let query = 'SELECT * FROM reports WHERE 1=1'
    const params: any[] = []
    let paramIndex = 1
    
    if (request.filter?.statuses?.length) {
      const statusNames = request.filter.statuses.map(s => ReportStatus[s])
      query += ` AND status = ANY($${paramIndex++})`
      params.push(statusNames)
    }
    
    if (request.filter?.hazardTypes?.length) {
      const typeNames = request.filter.hazardTypes.map(t => HazardType[t])
      query += ` AND hazard_type = ANY($${paramIndex++})`
      params.push(typeNames)
    }
    
    if (request.filter?.minSeverity) {
      query += ` AND severity >= $${paramIndex++}`
      params.push(request.filter.minSeverity)
    }
    
    if (request.filter?.bounds) {
      query += ` AND ST_Within(
        location::geometry,
        ST_MakeEnvelope($${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, 4326)
      )`
      params.push(
        request.filter.bounds.minLng,
        request.filter.bounds.minLat,
        request.filter.bounds.maxLng,
        request.filter.bounds.maxLat
      )
    }
    
    if (request.pageToken) {
      query += ` AND id > $${paramIndex++}`
      params.push(Buffer.from(request.pageToken, 'base64').toString())
    }
    
    query += ` ORDER BY created_at DESC LIMIT $${paramIndex++}`
    params.push(request.pageSize + 1)
    
    const result = await pool.query(query, params)
    const hasMore = result.rows.length > request.pageSize
    const reports = result.rows.slice(0, request.pageSize).map(transformDbReport)
    
    const countResult = await pool.query('SELECT COUNT(*) FROM reports')
    
    return {
      reports,
      nextPageToken: hasMore 
        ? Buffer.from(reports[reports.length - 1].id).toString('base64')
        : '',
      totalCount: parseInt(countResult.rows[0].count, 10),
    }
  },
  
  async CreateReport(request: CreateReportRequest, _metadata: GrpcMetadata): Promise<CreateReportResponse> {
    const result = await pool.query(
      `INSERT INTO reports (
         title, description, hazard_type, location, address, 
         images, reporter_id, status, severity
       ) VALUES ($1, $2, $3, ST_SetSRID(ST_MakePoint($4, $5), 4326), $6, $7, $8, 'PENDING', 3)
       RETURNING *`,
      [
        request.title,
        request.description,
        HazardType[request.hazardType],
        request.location.longitude,
        request.location.latitude,
        request.address,
        request.images,
        request.reporterId,
      ]
    )
    
    const report = transformDbReport(result.rows[0])
    
    // Emit for streaming subscribers
    streamEmitter.emit('report:created', report)
    
    return { report }
  },
  
  async UpdateReport(request: UpdateReportRequest, _metadata: GrpcMetadata): Promise<UpdateReportResponse> {
    const updates: string[] = []
    const params: any[] = [request.id]
    let paramIndex = 2
    
    for (const field of request.updateMask) {
      const value = (request.report as any)[field]
      if (value !== undefined) {
        const snakeField = field.replace(/[A-Z]/g, c => `_${c.toLowerCase()}`)
        updates.push(`${snakeField} = $${paramIndex++}`)
        params.push(value)
      }
    }
    
    if (updates.length === 0) {
      throw new GrpcError(GrpcStatusCode.INVALID_ARGUMENT, 'No fields to update')
    }
    
    updates.push('updated_at = NOW()')
    
    const result = await pool.query(
      `UPDATE reports SET ${updates.join(', ')} WHERE id = $1 RETURNING *`,
      params
    )
    
    if (result.rows.length === 0) {
      throw new GrpcError(GrpcStatusCode.NOT_FOUND, `Report not found: ${request.id}`)
    }
    
    const report = transformDbReport(result.rows[0])
    streamEmitter.emit('report:updated', report)
    
    return { report }
  },
  
  async *StreamReports(request: StreamReportsRequest, _metadata: GrpcMetadata): AsyncGenerator<Report> {
    // Yield existing reports matching filter
    const listResponse = await ReportService.ListReports(
      { pageSize: 100, pageToken: '', filter: request.filter },
      _metadata
    )
    
    for (const report of listResponse.reports) {
      yield report
    }
    
    // Stream new reports
    const listener = (report: Report) => {
      // Check filter
      if (request.filter?.statuses?.length) {
        if (!request.filter.statuses.includes(report.status)) return
      }
      if (request.filter?.hazardTypes?.length) {
        if (!request.filter.hazardTypes.includes(report.hazardType)) return
      }
      
      // Yield through an event (simplified for demonstration)
    }
    
    streamEmitter.on('report:created', listener)
    streamEmitter.on('report:updated', listener)
    
    // Keep stream open (in production, implement proper cleanup)
    try {
      await new Promise(() => {})
    } finally {
      streamEmitter.off('report:created', listener)
      streamEmitter.off('report:updated', listener)
    }
  },
}

/**
 * Alert Service Implementation
 */
export const AlertService = {
  async BroadcastAlert(request: BroadcastAlertRequest, _metadata: GrpcMetadata): Promise<BroadcastAlertResponse> {
    let targetUserIds = request.targetUserIds || []
    
    // If radius specified, find users in area
    if (request.centerPoint && request.targetRadius) {
      const result = await pool.query(
        `SELECT id FROM users 
         WHERE last_location IS NOT NULL
         AND ST_DWithin(
           last_location::geography,
           ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
           $3 * 1000
         )`,
        [request.centerPoint.longitude, request.centerPoint.latitude, request.targetRadius]
      )
      targetUserIds = result.rows.map((r: any) => r.id)
    }
    
    // Insert alert
    const alertResult = await pool.query(
      `INSERT INTO alerts (title, message, severity, affected_area, expires_at, created_by_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        request.alert.title,
        request.alert.message,
        AlertSeverity[request.alert.severity],
        request.alert.affectedArea 
          ? `POLYGON((${request.alert.affectedArea.points.map(p => `${p.longitude} ${p.latitude}`).join(',')}))`
          : null,
        request.alert.expiresAt,
        request.alert.createdById,
      ]
    )
    
    const alertId = alertResult.rows[0].id
    
    // Emit to stream subscribers
    streamEmitter.emit('alert:broadcast', {
      alert: request.alert,
      targetUserIds,
    })
    
    return {
      alertId,
      deliveredCount: targetUserIds.length,
      failedCount: 0,
    }
  },
  
  async *StreamAlerts(request: StreamAlertsRequest, _metadata: GrpcMetadata): AsyncGenerator<Alert> {
    const listener = (data: { alert: Alert; targetUserIds: string[] }) => {
      // Filter by severity
      if (request.severities?.length) {
        if (!request.severities.includes(data.alert.severity)) return
      }
      
      // Filter by location (simplified)
      // In production: check if location is within alert affected area
    }
    
    streamEmitter.on('alert:broadcast', listener)
    
    try {
      await new Promise(() => {})
    } finally {
      streamEmitter.off('alert:broadcast', listener)
    }
  },
}

/**
 * AI Service Implementation
 */
export const AIService = {
  async ClassifyImage(request: ClassifyImageRequest, _metadata: GrpcMetadata): Promise<ClassifyImageResponse> {
    const start = Date.now()
    
    // Call AI engine
    const aiEngineUrl = process.env.AI_ENGINE_URL || 'http://localhost:8000'
    
    try {
      const response = await fetch(`${aiEngineUrl}/classify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image_base64: request.imageBase64,
          image_url: request.imageUrl,
        }),
      })
      
      if (!response.ok) {
        throw new GrpcError(GrpcStatusCode.INTERNAL, 'AI engine classification failed')
      }
      
      const result = await response.json() as any
      
      return {
        hazardType: HazardType[result.hazard_type as keyof typeof HazardType] || HazardType.OTHER,
        confidence: result.confidence,
        severity: result.severity,
        suggestedActions: result.suggested_actions || [],
        processingTimeMs: Date.now() - start,
        modelVersion: result.model_version || 'unknown',
      }
    } catch (err: any) {
      if (err instanceof GrpcError) throw err
      throw new GrpcError(GrpcStatusCode.UNAVAILABLE, `AI engine unavailable: ${err.message}`)
    }
  },
  
  async AnalyzeText(request: AnalyzeTextRequest, _metadata: GrpcMetadata): Promise<AnalyzeTextResponse> {
    const aiEngineUrl = process.env.AI_ENGINE_URL || 'http://localhost:8000'
    
    try {
      const response = await fetch(`${aiEngineUrl}/analyze-text`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: request.text,
          context: request.context,
        }),
      })
      
      if (!response.ok) {
        throw new GrpcError(GrpcStatusCode.INTERNAL, 'AI engine text analysis failed')
      }
      
      const result = await response.json() as any
      
      return {
        hazardType: HazardType[result.hazard_type as keyof typeof HazardType] || HazardType.OTHER,
        confidence: result.confidence,
        entities: result.entities || [],
        sentiment: result.sentiment || { score: 0, magnitude: 0 },
      }
    } catch (err: any) {
      if (err instanceof GrpcError) throw err
      throw new GrpcError(GrpcStatusCode.UNAVAILABLE, `AI engine unavailable: ${err.message}`)
    }
  },
  
  async GetThreatLevel(request: GetThreatLevelRequest, _metadata: GrpcMetadata): Promise<GetThreatLevelResponse> {
    const result = await pool.query(
      `SELECT * FROM threat_levels WHERE region = $1 ORDER BY updated_at DESC LIMIT 1`,
      [request.region]
    )
    
    if (result.rows.length === 0) {
      return {
        region: request.region,
        level: 0,
        trend: 'stable',
        factors: [],
        updatedAt: new Date().toISOString(),
      }
    }
    
    const row = result.rows[0]
    return {
      region: row.region,
      level: row.level,
      trend: row.trend,
      factors: row.factors || [],
      updatedAt: row.updated_at,
    }
  },
}

/**
 * Analytics Service Implementation
 */

/** Whitelist of valid date_trunc intervals to prevent SQL injection */
const VALID_GRANULARITIES: Record<Granularity, string> = {
  [Granularity.GRANULARITY_UNSPECIFIED]: 'day',
  [Granularity.HOURLY]: 'hour',
  [Granularity.DAILY]: 'day',
  [Granularity.WEEKLY]: 'week',
  [Granularity.MONTHLY]: 'month',
}

export const AnalyticsService = {
  async GetAnalytics(request: GetAnalyticsRequest, _metadata: GrpcMetadata): Promise<GetAnalyticsResponse> {
    // Build parameterized query with proper escaping
    const baseParams = [request.fromDate, request.toDate]
    let paramIdx = 3
    let regionFilter = ''
    
    if (request.region) {
      regionFilter = `AND region = $${paramIdx++}`
      baseParams.push(request.region)
    }
    
    // Whitelist validate granularity to prevent SQL injection in date_trunc
    const granularity = VALID_GRANULARITIES[request.granularity] || 'day'
    
    const [total, resolved, byType, byStatus, timeSeries] = await Promise.all([
      pool.query(
        `SELECT COUNT(*) FROM reports WHERE created_at BETWEEN $1 AND $2 ${regionFilter}`,
        baseParams
      ),
      pool.query(
        `SELECT COUNT(*) FROM reports WHERE status = 'RESOLVED' AND created_at BETWEEN $1 AND $2 ${regionFilter}`,
        baseParams
      ),
      pool.query(
        `SELECT hazard_type as type, COUNT(*) as count FROM reports WHERE created_at BETWEEN $1 AND $2 ${regionFilter} GROUP BY hazard_type`,
        baseParams
      ),
      pool.query(
        `SELECT status, COUNT(*) as count FROM reports WHERE created_at BETWEEN $1 AND $2 ${regionFilter} GROUP BY status`,
        baseParams
      ),
      pool.query(
        `SELECT 
          date_trunc('${granularity}', created_at) as timestamp,
          COUNT(*) as value
        FROM reports 
        WHERE created_at BETWEEN $1 AND $2 ${regionFilter}
        GROUP BY 1 ORDER BY 1`,
        baseParams
      ),
    ])
    
    const totalCount = parseInt(total.rows[0].count, 10)
    const resolvedCount = parseInt(resolved.rows[0].count, 10)
    
    return {
      totalReports: totalCount,
      totalResolved: resolvedCount,
      averageResponseTimeMinutes: 0, // Calculate from timeline
      byHazardType: byType.rows.map((r: any) => ({
        type: HazardType[r.type as keyof typeof HazardType] || HazardType.OTHER,
        count: parseInt(r.count, 10),
        percentage: totalCount > 0 ? (parseInt(r.count, 10) / totalCount) * 100 : 0,
      })),
      byStatus: byStatus.rows.map((r: any) => ({
        status: ReportStatus[r.status as keyof typeof ReportStatus] || ReportStatus.STATUS_UNSPECIFIED,
        count: parseInt(r.count, 10),
        percentage: totalCount > 0 ? (parseInt(r.count, 10) / totalCount) * 100 : 0,
      })),
      timeSeries: timeSeries.rows.map((r: any) => ({
        timestamp: r.timestamp,
        value: parseInt(r.value, 10),
      })),
    }
  },
  
  async GetHeatmap(request: GetHeatmapRequest, _metadata: GrpcMetadata): Promise<GetHeatmapResponse> {
    // Build parameterized query for date filter
    const params: (string | number)[] = [
      request.bounds.minLng,
      request.bounds.minLat,
      request.bounds.maxLng,
      request.bounds.maxLat,
    ]
    let dateFilter = ''
    
    if (request.fromDate && request.toDate) {
      dateFilter = 'AND created_at BETWEEN $5 AND $6'
      params.push(request.fromDate, request.toDate)
    }
    
    const result = await pool.query(
      `SELECT 
         ST_X(location::geometry) as lng,
         ST_Y(location::geometry) as lat,
         severity
       FROM reports 
       WHERE ST_Within(
         location::geometry,
         ST_MakeEnvelope($1, $2, $3, $4, 4326)
       ) ${dateFilter}`,
      params
    )
    
    // Grid aggregation
    const cellSize = (request.bounds.maxLat - request.bounds.minLat) / request.resolution
    const grid: Record<string, HeatmapPoint> = {}
    
    for (const row of result.rows) {
      const cellX = Math.floor((row.lng - request.bounds.minLng) / cellSize)
      const cellY = Math.floor((row.lat - request.bounds.minLat) / cellSize)
      const key = `${cellX},${cellY}`
      
      if (!grid[key]) {
        grid[key] = {
          latitude: request.bounds.minLat + (cellY + 0.5) * cellSize,
          longitude: request.bounds.minLng + (cellX + 0.5) * cellSize,
          intensity: 0,
        }
      }
      grid[key].intensity += row.severity
    }
    
    return { points: Object.values(grid) }
  },
}

// HEALTH & REFLECTION SERVICES

export const HealthService = {
  async Check(_request: { service?: string }, _metadata: GrpcMetadata): Promise<{ status: string }> {
    return { status: 'SERVING' }
  },
  
  async *Watch(_request: { service?: string }, _metadata: GrpcMetadata): AsyncGenerator<{ status: string }> {
    while (true) {
      yield { status: 'SERVING' }
      await new Promise(resolve => setTimeout(resolve, 5000))
    }
  },
}

export const ReflectionService = {
  async ListServices(): Promise<{ services: string[] }> {
    return {
      services: [
        'aegis.ReportService',
        'aegis.AlertService',
        'aegis.AIService',
        'aegis.AnalyticsService',
        'grpc.health.v1.Health',
        'grpc.reflection.v1alpha.ServerReflection',
      ],
    }
  },
}

// TRANSFORM HELPERS

function transformDbReport(row: any): Report {
  return {
    id: row.id,
    title: row.title,
    description: row.description || '',
    hazardType: HazardType[row.hazard_type as keyof typeof HazardType] || HazardType.OTHER,
    status: ReportStatus[row.status as keyof typeof ReportStatus] || ReportStatus.STATUS_UNSPECIFIED,
    severity: row.severity,
    location: {
      latitude: row.location?.coordinates?.[1] || 0,
      longitude: row.location?.coordinates?.[0] || 0,
    },
    address: row.address || '',
    images: row.images || [],
    reporterId: row.reporter_id || '',
    assignedResponderId: row.assigned_responder_id || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    resolvedAt: row.resolved_at || '',
  }
}

// gRPC SERVER FACADE (for HTTP/2 or gRPC-Web)

interface ServiceMethod {
  name: string
  streaming: 'unary' | 'server' | 'client' | 'bidi'
  handler: (request: any, metadata: GrpcMetadata) => Promise<any> | AsyncGenerator<any>
}

const serviceRegistry: Record<string, ServiceMethod[]> = {
  'aegis.ReportService': [
    { name: 'GetReport', streaming: 'unary', handler: ReportService.GetReport },
    { name: 'ListReports', streaming: 'unary', handler: ReportService.ListReports },
    { name: 'CreateReport', streaming: 'unary', handler: ReportService.CreateReport },
    { name: 'UpdateReport', streaming: 'unary', handler: ReportService.UpdateReport },
    { name: 'StreamReports', streaming: 'server', handler: ReportService.StreamReports },
  ],
  'aegis.AlertService': [
    { name: 'BroadcastAlert', streaming: 'unary', handler: AlertService.BroadcastAlert },
    { name: 'StreamAlerts', streaming: 'server', handler: AlertService.StreamAlerts },
  ],
  'aegis.AIService': [
    { name: 'ClassifyImage', streaming: 'unary', handler: AIService.ClassifyImage },
    { name: 'AnalyzeText', streaming: 'unary', handler: AIService.AnalyzeText },
    { name: 'GetThreatLevel', streaming: 'unary', handler: AIService.GetThreatLevel },
  ],
  'aegis.AnalyticsService': [
    { name: 'GetAnalytics', streaming: 'unary', handler: AnalyticsService.GetAnalytics },
    { name: 'GetHeatmap', streaming: 'unary', handler: AnalyticsService.GetHeatmap },
  ],
}

/**
 * Execute a gRPC method with interceptors
 */
export async function executeGrpcMethod(
  serviceName: string,
  methodName: string,
  request: any,
  metadata: GrpcMetadata = {}
): Promise<any> {
  const service = serviceRegistry[serviceName]
  if (!service) {
    throw new GrpcError(GrpcStatusCode.UNIMPLEMENTED, `Service not found: ${serviceName}`)
  }
  
  const method = service.find(m => m.name === methodName)
  if (!method) {
    throw new GrpcError(GrpcStatusCode.UNIMPLEMENTED, `Method not found: ${methodName}`)
  }
  
  // Apply interceptors
  let next = () => method.handler(request, metadata) as Promise<any>
  
  for (const interceptor of unaryInterceptors.slice().reverse()) {
    const currentNext = next
    next = () => interceptor(`${serviceName}/${methodName}`, request, metadata, currentNext)
  }
  
  return next()
}

// METRICS & MONITORING

const grpcMetrics = {
  totalCalls: 0,
  successCalls: 0,
  errorCalls: 0,
  byMethod: new Map<string, { calls: number; errors: number; latencySum: number }>(),
  traces: [] as { traceId: string; spanId: string; method: string; startTime: number; endTime?: number; status?: string; error?: string }[],
}

export function getGrpcStats(): {
  totalCalls: number
  successRate: number
  byMethod: { method: string; calls: number; errors: number; avgLatencyMs: number }[]
  recentTraces: typeof grpcMetrics.traces
} {
  const byMethod: { method: string; calls: number; errors: number; avgLatencyMs: number }[] = []
  
  for (const [method, stats] of grpcMetrics.byMethod) {
    byMethod.push({
      method,
      calls: stats.calls,
      errors: stats.errors,
      avgLatencyMs: stats.calls > 0 ? stats.latencySum / stats.calls : 0,
    })
  }
  
  return {
    totalCalls: grpcMetrics.totalCalls,
    successRate: grpcMetrics.totalCalls > 0 
      ? (grpcMetrics.successCalls / grpcMetrics.totalCalls) * 100 
      : 100,
    byMethod,
    recentTraces: grpcMetrics.traces.slice(-100),
  }
}

export function getServiceDefinitions(): Record<string, string[]> {
  const definitions: Record<string, string[]> = {}
  for (const [service, methods] of Object.entries(serviceRegistry)) {
    definitions[service] = methods.map(m => `${m.name} (${m.streaming})`)
  }
  return definitions
}

/**
 * Initialize gRPC services
 * This is a no-op as services are available immediately, but provides
 * a consistent API with other enterprise services
 */
export async function initGrpcServices(): Promise<void> {
  console.log('[gRPC] Services initialized')
}

export default {
  ReportService,
  AlertService,
  AIService,
  AnalyticsService,
  HealthService,
  ReflectionService,
  executeGrpcMethod,
  getGrpcStats,
  getServiceDefinitions,
  initGrpcServices,
  GrpcError,
  GrpcStatusCode,
}
