/**
 * File: graphqlFederation.ts
 *
 * GraphQL federation gateway — accepts queries, fans them out to subgraph
 * resolvers, supports persisted queries (APQ via SHA-256), and provides
 * dataloaders for batching. The single schema entry point for API clients.
 *
 * How it connects:
 * - Accepts GraphQL requests from the gateway route
 * - Fans queries out to subgraph resolvers defined in this service
 * - Reuses PostgreSQL data and request context from the Express layer
 *
 * Simple explanation:
 * The single GraphQL entry point that stitches the backend data into one schema.
 */

import { Request, Response, NextFunction, Router } from 'express'
import { createHash, randomBytes } from 'crypto'
import pool from '../models/db.js'

// TYPE DEFINITIONS

interface GraphQLRequest {
  query: string
  operationName?: string
  variables?: Record<string, any>
  extensions?: {
    persistedQuery?: {
      version: number
      sha256Hash: string
    }
  }
}

interface GraphQLResponse {
  data?: Record<string, any>
  errors?: GraphQLError[]
  extensions?: Record<string, any>
}

interface GraphQLError {
  message: string
  locations?: { line: number; column: number }[]
  path?: (string | number)[]
  extensions?: Record<string, any>
}

interface Subgraph {
  name: string
  url: string
  sdl: string
  healthEndpoint?: string
  lastHealthCheck?: Date
  isHealthy: boolean
}

interface ResolverContext {
  req: Request
  res: Response
  dataloaders: Map<string, DataLoader>
  user?: any
  traceId?: string
}

interface DataLoader {
  load: (key: string) => Promise<any>
  loadMany: (keys: string[]) => Promise<any[]>
  clear: (key: string) => void
  clearAll: () => void
}

interface PersistedQuery {
  hash: string
  query: string
  operationName?: string
  createdAt: Date
  usageCount: number
}

interface SubscriptionPayload {
  type: 'connection_init' | 'connection_ack' | 'subscribe' | 'next' | 'error' | 'complete'
  id?: string
  payload?: any
}

// FEDERATED SCHEMA DEFINITION

const FEDERATED_SDL = `
  # Federation directives
  directive @key(fields: String!) on OBJECT | INTERFACE
  directive @extends on OBJECT | INTERFACE
  directive @external on FIELD_DEFINITION
  directive @requires(fields: String!) on FIELD_DEFINITION
  directive @provides(fields: String!) on FIELD_DEFINITION
  directive @shareable on OBJECT | FIELD_DEFINITION

  # Scalars
  scalar DateTime
  scalar JSON
  scalar GeoJSON
  scalar Upload

  # Enums
  enum ReportStatus {
    PENDING
    IN_PROGRESS
    RESOLVED
    ESCALATED
    CLOSED
  }

  enum HazardType {
    FLOOD
    FIRE
    EARTHQUAKE
    LANDSLIDE
    STORM
    INFRASTRUCTURE
    ENVIRONMENTAL
    OTHER
  }

  enum AlertSeverity {
    INFO
    WARNING
    CRITICAL
    EMERGENCY
  }

  enum UserRole {
    CITIZEN
    RESPONDER
    ADMIN
    SUPER_ADMIN
  }

  # Entity: Report (key entity for federation)
  type Report @key(fields: "id") {
    id: ID!
    title: String!
    description: String
    hazardType: HazardType!
    status: ReportStatus!
    severity: Int!
    location: GeoJSON!
    address: String
    images: [String!]
    reporter: User
    assignedResponder: User
    createdAt: DateTime!
    updatedAt: DateTime!
    resolvedAt: DateTime
    aiClassification: AIClassification
    timeline: [TimelineEvent!]!
  }

  # Entity: User (key entity for federation)
  type User @key(fields: "id") {
    id: ID!
    email: String!
    fullName: String!
    role: UserRole!
    avatar: String
    phone: String
    isVerified: Boolean!
    createdAt: DateTime!
    lastActive: DateTime
    reports: [Report!]!
    assignedReports: [Report!]!
    stats: UserStats
  }

  type UserStats {
    totalReports: Int!
    resolvedReports: Int!
    averageResponseTime: Float
  }

  # Entity: Alert (key entity for federation)
  type Alert @key(fields: "id") {
    id: ID!
    title: String!
    message: String!
    severity: AlertSeverity!
    affectedArea: GeoJSON
    isActive: Boolean!
    expiresAt: DateTime
    createdAt: DateTime!
    createdBy: User
    acknowledgedBy: [User!]!
  }

  type AIClassification {
    hazardType: HazardType!
    confidence: Float!
    severity: Int!
    suggestedActions: [String!]!
    modelVersion: String!
  }

  type TimelineEvent {
    id: ID!
    action: String!
    description: String
    actor: User
    timestamp: DateTime!
    metadata: JSON
  }

  # Analytics types
  type AnalyticsSummary {
    totalReports: Int!
    activeIncidents: Int!
    resolvedToday: Int!
    averageResponseTime: Float!
    byHazardType: [HazardTypeCount!]!
    byStatus: [StatusCount!]!
    trend: [TrendPoint!]!
  }

  type HazardTypeCount {
    type: HazardType!
    count: Int!
  }

  type StatusCount {
    status: ReportStatus!
    count: Int!
  }

  type TrendPoint {
    date: DateTime!
    count: Int!
  }

  # Geospatial types
  type NearbyReport {
    report: Report!
    distance: Float!
  }

  # Input types
  input ReportInput {
    title: String!
    description: String
    hazardType: HazardType!
    location: GeoJSONInput!
    address: String
    images: [String!]
  }

  input ReportUpdateInput {
    title: String
    description: String
    status: ReportStatus
    severity: Int
    assignedResponderId: ID
  }

  input GeoJSONInput {
    type: String!
    coordinates: [Float!]!
  }

  input ReportFilter {
    status: [ReportStatus!]
    hazardType: [HazardType!]
    severity: Int
    fromDate: DateTime
    toDate: DateTime
    bounds: BoundsInput
  }

  input BoundsInput {
    minLat: Float!
    maxLat: Float!
    minLng: Float!
    maxLng: Float!
  }

  input AlertInput {
    title: String!
    message: String!
    severity: AlertSeverity!
    affectedArea: GeoJSONInput
    expiresAt: DateTime
  }

  # Pagination
  type PageInfo {
    hasNextPage: Boolean!
    hasPreviousPage: Boolean!
    startCursor: String
    endCursor: String
    totalCount: Int!
  }

  type ReportConnection {
    edges: [ReportEdge!]!
    pageInfo: PageInfo!
  }

  type ReportEdge {
    node: Report!
    cursor: String!
  }

  # Queries
  type Query {
    # Reports
    report(id: ID!): Report
    reports(
      first: Int
      after: String
      last: Int
      before: String
      filter: ReportFilter
    ): ReportConnection!
    nearbyReports(
      latitude: Float!
      longitude: Float!
      radiusKm: Float!
      limit: Int
    ): [NearbyReport!]!

    # Users
    user(id: ID!): User
    me: User
    users(role: UserRole, limit: Int, offset: Int): [User!]!

    # Alerts
    alert(id: ID!): Alert
    alerts(active: Boolean, severity: AlertSeverity, limit: Int): [Alert!]!
    activeAlerts: [Alert!]!

    # Analytics
    analytics(fromDate: DateTime, toDate: DateTime): AnalyticsSummary!
    heatmapData(bounds: BoundsInput!, resolution: Int): JSON!

    # Federation
    _service: _Service!
    _entities(representations: [_Any!]!): [_Entity]!
  }

  # Mutations
  type Mutation {
    # Reports
    createReport(input: ReportInput!): Report!
    updateReport(id: ID!, input: ReportUpdateInput!): Report!
    assignReport(reportId: ID!, responderId: ID!): Report!
    resolveReport(id: ID!, resolution: String!): Report!
    escalateReport(id: ID!, reason: String!): Report!

    # Alerts
    createAlert(input: AlertInput!): Alert!
    acknowledgeAlert(id: ID!): Alert!
    deactivateAlert(id: ID!): Alert!

    # Users
    updateProfile(fullName: String, phone: String, avatar: String): User!
  }

  # Subscriptions (real-time updates)
  type Subscription {
    reportCreated: Report!
    reportUpdated(id: ID): Report!
    alertCreated: Alert!
    alertDeactivated: Alert!
    nearbyIncident(latitude: Float!, longitude: Float!, radiusKm: Float!): Report!
  }

  # Federation types
  scalar _Any
  union _Entity = Report | User | Alert

  type _Service {
    sdl: String!
  }
`

// PERSISTED QUERIES STORE

const persistedQueries = new Map<string, PersistedQuery>()

/**
 * Register a persisted query for CDN caching
 */
export function registerPersistedQuery(query: string, operationName?: string): string {
  const hash = createHash('sha256').update(query).digest('hex')
  
  if (!persistedQueries.has(hash)) {
    persistedQueries.set(hash, {
      hash,
      query,
      operationName,
      createdAt: new Date(),
      usageCount: 0,
    })
  }
  
  return hash
}

/**
 * Get persisted query by hash (APQ - Automatic Persisted Queries)
 */
function getPersistedQuery(hash: string): PersistedQuery | undefined {
  const pq = persistedQueries.get(hash)
  if (pq) {
    pq.usageCount++
  }
  return pq
}

// DATALOADER FACTORY (N+1 Prevention)

function createDataLoaders(): Map<string, DataLoader> {
  const loaders = new Map<string, DataLoader>()
  
  // User loader
  loaders.set('users', createBatchLoader(async (ids: string[]) => {
    const result = await pool.query(
      'SELECT * FROM users WHERE id = ANY($1)',
      [ids]
    )
    const userMap = new Map(result.rows.map((u: any) => [u.id, transformUser(u)]))
    return ids.map(id => userMap.get(id) || null)
  }))
  
  // Report loader
  loaders.set('reports', createBatchLoader(async (ids: string[]) => {
    const result = await pool.query(
      'SELECT * FROM reports WHERE id = ANY($1)',
      [ids]
    )
    const reportMap = new Map(result.rows.map((r: any) => [r.id, transformReport(r)]))
    return ids.map(id => reportMap.get(id) || null)
  }))
  
  // Alert loader
  loaders.set('alerts', createBatchLoader(async (ids: string[]) => {
    const result = await pool.query(
      'SELECT * FROM alerts WHERE id = ANY($1)',
      [ids]
    )
    const alertMap = new Map(result.rows.map((a: any) => [a.id, transformAlert(a)]))
    return ids.map(id => alertMap.get(id) || null)
  }))
  
  return loaders
}

function createBatchLoader(batchFn: (keys: string[]) => Promise<any[]>): DataLoader {
  const cache = new Map<string, Promise<any>>()
  let batch: string[] = []
  let batchPromise: Promise<void> | null = null
  
  const dispatchBatch = () => {
    const currentBatch = batch
    batch = []
    batchPromise = null
    
    const promise = batchFn(currentBatch)
    currentBatch.forEach((key, index) => {
      cache.set(key, promise.then(results => results[index]))
    })
  }
  
  return {
    load: (key: string) => {
      if (cache.has(key)) {
        return cache.get(key)!
      }
      
      batch.push(key)
      
      if (!batchPromise) {
        batchPromise = Promise.resolve().then(dispatchBatch)
      }
      
      const resultPromise = batchPromise.then(() => cache.get(key))
      cache.set(key, resultPromise as Promise<any>)
      return resultPromise
    },
    loadMany: (keys: string[]) => Promise.all(keys.map(k => cache.get(k) || null)),
    clear: (key: string) => { cache.delete(key) },
    clearAll: () => { cache.clear() },
  }
}

// RESOLVERS

type ResolverFn = (parent: any, args: any, context: ResolverContext) => any

interface Resolvers {
  Query: Record<string, ResolverFn>
  Mutation: Record<string, ResolverFn>
  Report: Record<string, ResolverFn>
  User: Record<string, ResolverFn>
  Alert: Record<string, ResolverFn>
}

const resolvers: Resolvers = {
  Query: {
    // Reports
    report: async (_parent, { id }, ctx) => {
      return ctx.dataloaders.get('reports')!.load(id)
    },
    
    reports: async (_parent, { first = 20, after, filter }, _ctx) => {
      let query = 'SELECT * FROM reports WHERE 1=1'
      const params: any[] = []
      let paramIndex = 1
      
      if (filter?.status?.length) {
        query += ` AND status = ANY($${paramIndex++})`
        params.push(filter.status)
      }
      
      if (filter?.hazardType?.length) {
        query += ` AND hazard_type = ANY($${paramIndex++})`
        params.push(filter.hazardType)
      }
      
      if (filter?.fromDate) {
        query += ` AND created_at >= $${paramIndex++}`
        params.push(filter.fromDate)
      }
      
      if (filter?.toDate) {
        query += ` AND created_at <= $${paramIndex++}`
        params.push(filter.toDate)
      }
      
      if (after) {
        query += ` AND id > $${paramIndex++}`
        params.push(Buffer.from(after, 'base64').toString())
      }
      
      query += ` ORDER BY created_at DESC LIMIT $${paramIndex++}`
      params.push(first + 1)
      
      const result = await pool.query(query, params)
      const hasNextPage = result.rows.length > first
      const edges = result.rows.slice(0, first).map((r: any) => ({
        node: transformReport(r),
        cursor: Buffer.from(r.id).toString('base64'),
      }))
      
      const countResult = await pool.query('SELECT COUNT(*) FROM reports')
      
      return {
        edges,
        pageInfo: {
          hasNextPage,
          hasPreviousPage: !!after,
          startCursor: edges[0]?.cursor,
          endCursor: edges[edges.length - 1]?.cursor,
          totalCount: parseInt(countResult.rows[0].count, 10),
        },
      }
    },
    
    nearbyReports: async (_parent, { latitude, longitude, radiusKm, limit = 10 }) => {
      const result = await pool.query(
        `SELECT *, 
         ST_Distance(
           location::geography, 
           ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography
         ) / 1000 as distance_km
         FROM reports 
         WHERE ST_DWithin(
           location::geography,
           ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
           $3 * 1000
         )
         ORDER BY distance_km
         LIMIT $4`,
        [longitude, latitude, radiusKm, limit]
      )
      
      return result.rows.map((r: any) => ({
        report: transformReport(r),
        distance: r.distance_km,
      }))
    },
    
    // Users
    user: async (_parent, { id }, ctx) => {
      return ctx.dataloaders.get('users')!.load(id)
    },
    
    me: async (_parent, _args, ctx) => {
      if (!ctx.user?.id) return null
      return ctx.dataloaders.get('users')!.load(ctx.user.id)
    },
    
    users: async (_parent, { role, limit = 50, offset = 0 }) => {
      let query = 'SELECT * FROM users WHERE 1=1'
      const params: any[] = []
      
      if (role) {
        query += ' AND role = $1'
        params.push(role)
      }
      
      query += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`
      params.push(limit, offset)
      
      const result = await pool.query(query, params)
      return result.rows.map(transformUser)
    },
    
    // Alerts
    alert: async (_parent, { id }, ctx) => {
      return ctx.dataloaders.get('alerts')!.load(id)
    },
    
    alerts: async (_parent, { active, severity, limit = 50 }) => {
      let query = 'SELECT * FROM alerts WHERE 1=1'
      const params: any[] = []
      let paramIndex = 1
      
      if (active !== undefined) {
        query += ` AND is_active = $${paramIndex++}`
        params.push(active)
      }
      
      if (severity) {
        query += ` AND severity = $${paramIndex++}`
        params.push(severity)
      }
      
      query += ` ORDER BY created_at DESC LIMIT $${paramIndex}`
      params.push(limit)
      
      const result = await pool.query(query, params)
      return result.rows.map(transformAlert)
    },
    
    activeAlerts: async () => {
      const result = await pool.query(
        `SELECT * FROM alerts 
         WHERE is_active = true 
         AND (expires_at IS NULL OR expires_at > NOW())
         ORDER BY severity DESC, created_at DESC`
      )
      return result.rows.map(transformAlert)
    },
    
    // Analytics
    analytics: async (_parent, { fromDate, toDate }) => {
      const dateParams: string[] = []
      let dateFilter = ''

      if (fromDate && toDate) {
        dateFilter = 'AND created_at BETWEEN $1 AND $2'
        dateParams.push(fromDate, toDate)
      }
      
      const [total, active, resolved, byType, byStatus, trend] = await Promise.all([
        pool.query(`SELECT COUNT(*) FROM reports WHERE 1=1 ${dateFilter}`, dateParams),
        pool.query(`SELECT COUNT(*) FROM reports WHERE status NOT IN ('RESOLVED', 'CLOSED') ${dateFilter}`, dateParams),
        pool.query(`SELECT COUNT(*) FROM reports WHERE status = 'RESOLVED' AND DATE(resolved_at) = CURRENT_DATE`),
        pool.query(`SELECT hazard_type as type, COUNT(*) as count FROM reports WHERE 1=1 ${dateFilter} GROUP BY hazard_type`, dateParams),
        pool.query(`SELECT status, COUNT(*) as count FROM reports WHERE 1=1 ${dateFilter} GROUP BY status`, dateParams),
        pool.query(`
          SELECT DATE(created_at) as date, COUNT(*) as count 
          FROM reports 
          WHERE created_at >= NOW() - INTERVAL '30 days'
          GROUP BY DATE(created_at) 
          ORDER BY date
        `),
      ])
      
      return {
        totalReports: parseInt(total.rows[0].count, 10),
        activeIncidents: parseInt(active.rows[0].count, 10),
        resolvedToday: parseInt(resolved.rows[0].count, 10),
        averageResponseTime: 0, // Calculate from timeline
        byHazardType: byType.rows,
        byStatus: byStatus.rows,
        trend: trend.rows,
      }
    },
    
    heatmapData: async (_parent, { bounds, resolution = 10 }) => {
      const result = await pool.query(
        `SELECT 
           ST_X(location::geometry) as lng,
           ST_Y(location::geometry) as lat,
           severity
         FROM reports 
         WHERE ST_Within(
           location::geometry,
           ST_MakeEnvelope($1, $2, $3, $4, 4326)
         )`,
        [bounds.minLng, bounds.minLat, bounds.maxLng, bounds.maxLat]
      )
      
      // Grid aggregation for heatmap
      const cellSize = (bounds.maxLat - bounds.minLat) / resolution
      const grid: Record<string, { lat: number; lng: number; intensity: number }> = {}
      
      for (const row of result.rows) {
        const cellX = Math.floor((row.lng - bounds.minLng) / cellSize)
        const cellY = Math.floor((row.lat - bounds.minLat) / cellSize)
        const key = `${cellX},${cellY}`
        
        if (!grid[key]) {
          grid[key] = {
            lat: bounds.minLat + (cellY + 0.5) * cellSize,
            lng: bounds.minLng + (cellX + 0.5) * cellSize,
            intensity: 0,
          }
        }
        grid[key].intensity += row.severity
      }
      
      return Object.values(grid)
    },
    
    // Federation
    _service: () => ({ sdl: FEDERATED_SDL }),
    
    _entities: async (_parent, { representations }, ctx) => {
      return Promise.all(
        representations.map(async (ref: any) => {
          switch (ref.__typename) {
            case 'Report':
              return ctx.dataloaders.get('reports')!.load(ref.id)
            case 'User':
              return ctx.dataloaders.get('users')!.load(ref.id)
            case 'Alert':
              return ctx.dataloaders.get('alerts')!.load(ref.id)
            default:
              return null
          }
        })
      )
    },
  },
  
  Mutation: {
    createReport: async (_parent, { input }, ctx) => {
      const result = await pool.query(
        `INSERT INTO reports (
           title, description, hazard_type, location, address, 
           images, reporter_id, status, severity
         ) VALUES ($1, $2, $3, ST_SetSRID(ST_MakePoint($4, $5), 4326), $6, $7, $8, 'PENDING', 3)
         RETURNING *`,
        [
          input.title,
          input.description,
          input.hazardType,
          input.location.coordinates[0],
          input.location.coordinates[1],
          input.address,
          input.images || [],
          ctx.user?.id,
        ]
      )
      
      const report = transformReport(result.rows[0])
      
      // Publish to subscriptions
      publishToSubscription('reportCreated', report)
      
      return report
    },
    
    updateReport: async (_parent, { id, input }, ctx) => {
      const updates: string[] = []
      const params: any[] = [id]
      let paramIndex = 2
      
      if (input.title) {
        updates.push(`title = $${paramIndex++}`)
        params.push(input.title)
      }
      if (input.description) {
        updates.push(`description = $${paramIndex++}`)
        params.push(input.description)
      }
      if (input.status) {
        updates.push(`status = $${paramIndex++}`)
        params.push(input.status)
      }
      if (input.severity) {
        updates.push(`severity = $${paramIndex++}`)
        params.push(input.severity)
      }
      if (input.assignedResponderId) {
        updates.push(`assigned_responder_id = $${paramIndex++}`)
        params.push(input.assignedResponderId)
      }
      
      updates.push('updated_at = NOW()')
      
      const result = await pool.query(
        `UPDATE reports SET ${updates.join(', ')} WHERE id = $1 RETURNING *`,
        params
      )
      
      const report = transformReport(result.rows[0])
      publishToSubscription('reportUpdated', report)
      ctx.dataloaders.get('reports')!.clear(id)
      
      return report
    },
    
    assignReport: async (_parent, { reportId, responderId }, ctx) => {
      const result = await pool.query(
        `UPDATE reports SET 
           assigned_responder_id = $2, 
           status = 'IN_PROGRESS',
           updated_at = NOW()
         WHERE id = $1 RETURNING *`,
        [reportId, responderId]
      )
      
      const report = transformReport(result.rows[0])
      publishToSubscription('reportUpdated', report)
      ctx.dataloaders.get('reports')!.clear(reportId)
      
      return report
    },
    
    resolveReport: async (_parent, { id, resolution }, ctx) => {
      const result = await pool.query(
        `UPDATE reports SET 
           status = 'RESOLVED', 
           resolved_at = NOW(),
           resolution = $2,
           updated_at = NOW()
         WHERE id = $1 RETURNING *`,
        [id, resolution]
      )
      
      const report = transformReport(result.rows[0])
      publishToSubscription('reportUpdated', report)
      ctx.dataloaders.get('reports')!.clear(id)
      
      return report
    },
    
    escalateReport: async (_parent, { id, reason }, ctx) => {
      const result = await pool.query(
        `UPDATE reports SET 
           status = 'ESCALATED', 
           severity = LEAST(severity + 1, 5),
           escalation_reason = $2,
           updated_at = NOW()
         WHERE id = $1 RETURNING *`,
        [id, reason]
      )
      
      const report = transformReport(result.rows[0])
      publishToSubscription('reportUpdated', report)
      ctx.dataloaders.get('reports')!.clear(id)
      
      return report
    },
    
    createAlert: async (_parent, { input }, ctx) => {
      const result = await pool.query(
        `INSERT INTO alerts (
           title, message, severity, affected_area, expires_at, created_by_id
         ) VALUES ($1, $2, $3, ST_SetSRID(ST_GeomFromGeoJSON($4), 4326), $5, $6)
         RETURNING *`,
        [
          input.title,
          input.message,
          input.severity,
          input.affectedArea ? JSON.stringify(input.affectedArea) : null,
          input.expiresAt,
          ctx.user?.id,
        ]
      )
      
      const alert = transformAlert(result.rows[0])
      publishToSubscription('alertCreated', alert)
      
      return alert
    },
    
    acknowledgeAlert: async (_parent, { id }, ctx) => {
      await pool.query(
        `INSERT INTO alert_acknowledgements (alert_id, user_id) VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [id, ctx.user?.id]
      )
      
      return ctx.dataloaders.get('alerts')!.load(id)
    },
    
    deactivateAlert: async (_parent, { id }, ctx) => {
      const result = await pool.query(
        `UPDATE alerts SET is_active = false WHERE id = $1 RETURNING *`,
        [id]
      )
      
      const alert = transformAlert(result.rows[0])
      publishToSubscription('alertDeactivated', alert)
      ctx.dataloaders.get('alerts')!.clear(id)
      
      return alert
    },
    
    updateProfile: async (_parent, args, ctx) => {
      const updates: string[] = []
      const params: any[] = [ctx.user?.id]
      let paramIndex = 2
      
      if (args.fullName) {
        updates.push(`full_name = $${paramIndex++}`)
        params.push(args.fullName)
      }
      if (args.phone) {
        updates.push(`phone = $${paramIndex++}`)
        params.push(args.phone)
      }
      if (args.avatar) {
        updates.push(`avatar = $${paramIndex++}`)
        params.push(args.avatar)
      }
      
      if (updates.length === 0) {
        return ctx.dataloaders.get('users')!.load(ctx.user?.id)
      }
      
      updates.push('updated_at = NOW()')
      
      const result = await pool.query(
        `UPDATE users SET ${updates.join(', ')} WHERE id = $1 RETURNING *`,
        params
      )
      
      ctx.dataloaders.get('users')!.clear(ctx.user?.id)
      return transformUser(result.rows[0])
    },
  },
  
  // Field resolvers for entity relationships
  Report: {
    reporter: async (parent, _args, ctx) => {
      if (!parent.reporterId) return null
      return ctx.dataloaders.get('users')!.load(parent.reporterId)
    },
    assignedResponder: async (parent, _args, ctx) => {
      if (!parent.assignedResponderId) return null
      return ctx.dataloaders.get('users')!.load(parent.assignedResponderId)
    },
    timeline: async (parent) => {
      const result = await pool.query(
        'SELECT * FROM report_timeline WHERE report_id = $1 ORDER BY timestamp',
        [parent.id]
      )
      return result.rows.map((t: any) => ({
        id: t.id,
        action: t.action,
        description: t.description,
        actorId: t.actor_id,
        timestamp: t.timestamp,
        metadata: t.metadata,
      }))
    },
  },
  
  User: {
    reports: async (parent) => {
      const result = await pool.query(
        'SELECT * FROM reports WHERE reporter_id = $1 ORDER BY created_at DESC LIMIT 100',
        [parent.id]
      )
      return result.rows.map(transformReport)
    },
    assignedReports: async (parent) => {
      const result = await pool.query(
        'SELECT * FROM reports WHERE assigned_responder_id = $1 ORDER BY created_at DESC',
        [parent.id]
      )
      return result.rows.map(transformReport)
    },
    stats: async (parent) => {
      const [total, resolved] = await Promise.all([
        pool.query('SELECT COUNT(*) FROM reports WHERE reporter_id = $1', [parent.id]),
        pool.query('SELECT COUNT(*) FROM reports WHERE reporter_id = $1 AND status = $2', [parent.id, 'RESOLVED']),
      ])
      return {
        totalReports: parseInt(total.rows[0].count, 10),
        resolvedReports: parseInt(resolved.rows[0].count, 10),
        averageResponseTime: null,
      }
    },
  },
  
  Alert: {
    createdBy: async (parent, _args, ctx) => {
      if (!parent.createdById) return null
      return ctx.dataloaders.get('users')!.load(parent.createdById)
    },
    acknowledgedBy: async (parent, _args, ctx) => {
      const result = await pool.query(
        'SELECT user_id FROM alert_acknowledgements WHERE alert_id = $1',
        [parent.id]
      )
      if (result.rows.length === 0) return []
      return Promise.all(
        result.rows.map((r: any) => ctx.dataloaders.get('users')!.load(r.user_id))
      )
    },
  },
}

// SUBSCRIPTION MANAGEMENT (WebSocket)

type SubscriptionCallback = (payload: any) => void
const subscriptions = new Map<string, Set<SubscriptionCallback>>()

function publishToSubscription(event: string, payload: any): void {
  const subs = subscriptions.get(event)
  if (subs) {
    for (const callback of subs) {
      try {
        callback(payload)
      } catch (err) {
        console.error(`Error publishing to subscription ${event}:`, err)
      }
    }
  }
}

export function subscribeToEvent(event: string, callback: SubscriptionCallback): () => void {
  if (!subscriptions.has(event)) {
    subscriptions.set(event, new Set())
  }
  subscriptions.get(event)!.add(callback)
  
  return () => {
    subscriptions.get(event)?.delete(callback)
  }
}

// QUERY EXECUTION ENGINE

interface ParsedQuery {
  type: 'query' | 'mutation' | 'subscription'
  operationName?: string
  selections: Selection[]
  variables: Record<string, any>
}

interface Selection {
  field: string
  args: Record<string, any>
  selections?: Selection[]
  alias?: string
}

/**
 * Simple GraphQL query parser (production would use graphql-js)
 */
function parseQuery(query: string, variables: Record<string, any> = {}): ParsedQuery {
  const trimmed = query.trim()
  
  let type: 'query' | 'mutation' | 'subscription' = 'query'
  if (trimmed.startsWith('mutation')) type = 'mutation'
  else if (trimmed.startsWith('subscription')) type = 'subscription'
  
  // Extract operation name
  const nameMatch = trimmed.match(/^(query|mutation|subscription)\s+(\w+)/)
  const operationName = nameMatch?.[2]
  
  // Parse selections (simplified - real impl would use graphql-js)
  const bodyMatch = trimmed.match(/\{([^}]+)\}/)
  const body = bodyMatch?.[1] || ''
  
  const selections: Selection[] = body
    .split(/\s+/)
    .filter(s => s && !s.startsWith('#'))
    .map(field => ({ field: field.replace(/[{}]/g, ''), args: {}, selections: [] }))
  
  return { type, operationName, selections, variables }
}

/**
 * Execute a parsed GraphQL query
 */
async function executeQuery(
  parsed: ParsedQuery,
  context: ResolverContext
): Promise<GraphQLResponse> {
  const data: Record<string, any> = {}
  const errors: GraphQLError[] = []
  
  const resolverMap = parsed.type === 'mutation' ? resolvers.Mutation : resolvers.Query
  
  for (const selection of parsed.selections) {
    const resolver = resolverMap[selection.field]
    if (!resolver) {
      errors.push({
        message: `Cannot query field "${selection.field}" on type "${parsed.type === 'mutation' ? 'Mutation' : 'Query'}"`,
        path: [selection.field],
      })
      continue
    }
    
    try {
      const result = await resolver(null, selection.args, context)
      data[selection.alias || selection.field] = result
    } catch (err: any) {
      errors.push({
        message: err.message,
        path: [selection.field],
        extensions: { code: err.code || 'INTERNAL_ERROR' },
      })
    }
  }
  
  return {
    data: Object.keys(data).length > 0 ? data : undefined,
    errors: errors.length > 0 ? errors : undefined,
  }
}

// TRANSFORM FUNCTIONS

function transformReport(row: any): any {
  if (!row) return null
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    hazardType: row.hazard_type,
    status: row.status,
    severity: row.severity,
    location: row.location,
    address: row.address,
    images: row.images || [],
    reporterId: row.reporter_id,
    assignedResponderId: row.assigned_responder_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    resolvedAt: row.resolved_at,
  }
}

function transformUser(row: any): any {
  if (!row) return null
  return {
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    role: row.role,
    avatar: row.avatar,
    phone: row.phone,
    isVerified: row.is_verified,
    createdAt: row.created_at,
    lastActive: row.last_active,
  }
}

function transformAlert(row: any): any {
  if (!row) return null
  return {
    id: row.id,
    title: row.title,
    message: row.message,
    severity: row.severity,
    affectedArea: row.affected_area,
    isActive: row.is_active,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    createdById: row.created_by_id,
  }
}

// EXPRESS MIDDLEWARE / ROUTER

/**
 * GraphQL endpoint middleware
 */
export function graphqlMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return next()
  }
  
  handleGraphQL(req, res).catch(next)
}

async function handleGraphQL(req: Request, res: Response): Promise<void> {
  const startTime = Date.now()
  
  // Parse request
  let graphqlRequest: GraphQLRequest
  
  if (req.method === 'GET') {
    graphqlRequest = {
      query: req.query.query as string,
      operationName: req.query.operationName as string,
      variables: req.query.variables 
        ? JSON.parse(req.query.variables as string) 
        : {},
    }
  } else {
    graphqlRequest = req.body as GraphQLRequest
  }
  
  // Handle persisted queries (APQ)
  if (graphqlRequest.extensions?.persistedQuery) {
    const { sha256Hash } = graphqlRequest.extensions.persistedQuery
    const persisted = getPersistedQuery(sha256Hash)
    
    if (!persisted && !graphqlRequest.query) {
      res.status(200).json({
        errors: [{ message: 'PersistedQueryNotFound', extensions: { code: 'PERSISTED_QUERY_NOT_FOUND' } }],
      })
      return
    }
    
    if (persisted) {
      graphqlRequest.query = persisted.query
    } else if (graphqlRequest.query) {
      // Register new persisted query
      registerPersistedQuery(graphqlRequest.query, graphqlRequest.operationName)
    }
  }
  
  if (!graphqlRequest.query) {
    res.status(400).json({ errors: [{ message: 'Query is required' }] })
    return
  }
  
  // Create resolver context
  const context: ResolverContext = {
    req,
    res,
    dataloaders: createDataLoaders(),
    user: (req as any).user,
    traceId: req.headers['x-trace-id'] as string,
  }
  
  // Parse and execute query
  const parsed = parseQuery(graphqlRequest.query, graphqlRequest.variables)
  const response = await executeQuery(parsed, context)
  
  // Add timing extension
  const duration = Date.now() - startTime
  response.extensions = {
    ...response.extensions,
    timing: { durationMs: duration },
    tracing: context.traceId ? { traceId: context.traceId } : undefined,
  }
  
  // Set cache headers for queries (not mutations)
  if (parsed.type === 'query') {
    res.setHeader('Cache-Control', 'private, max-age=0')
    res.setHeader('X-GraphQL-Cache', 'MISS')
  }
  
  res.status(200).json(response)
}

/**
 * Create GraphQL router with all endpoints
 */
export function createGraphQLRouter(): Router {
  const router = Router()
  
  // GraphQL endpoint
  router.all('/', graphqlMiddleware)
  
  // Introspection endpoint
  router.get('/schema', (_req, res) => {
    res.setHeader('Content-Type', 'text/plain')
    res.send(FEDERATED_SDL)
  })
  
  // Health check
  router.get('/health', (_req, res) => {
    res.json({
      status: 'healthy',
      persistedQueries: persistedQueries.size,
      activeSubscriptions: Array.from(subscriptions.keys()).reduce(
        (acc, key) => acc + (subscriptions.get(key)?.size || 0),
        0
      ),
    })
  })
  
  return router
}

// STATS & MONITORING

let queryStats = {
  totalQueries: 0,
  totalMutations: 0,
  totalErrors: 0,
  averageLatencyMs: 0,
  persistedQueryHits: 0,
  persistedQueryMisses: 0,
}

/**
 * Initialize GraphQL Federation
 * This is a no-op as the service initializes on first request, but provides
 * a consistent API with other enterprise services
 */
export async function initGraphQLFederation(): Promise<void> {
  console.log('[GraphQL] Federation service initialized')
}

export function getGraphQLStats(): typeof queryStats & {
  persistedQueriesCount: number
  activeSubscriptions: number
  topOperations: { name: string; count: number }[]
} {
  return {
    ...queryStats,
    persistedQueriesCount: persistedQueries.size,
    activeSubscriptions: Array.from(subscriptions.values()).reduce((acc, set) => acc + set.size, 0),
    topOperations: Array.from(persistedQueries.values())
      .sort((a, b) => b.usageCount - a.usageCount)
      .slice(0, 10)
      .map(pq => ({ name: pq.operationName || 'anonymous', count: pq.usageCount })),
  }
}

export { FEDERATED_SDL, resolvers }

export default {
  createGraphQLRouter,
  graphqlMiddleware,
  registerPersistedQuery,
  subscribeToEvent,
  getGraphQLStats,
  initGraphQLFederation,
  FEDERATED_SDL,
}
