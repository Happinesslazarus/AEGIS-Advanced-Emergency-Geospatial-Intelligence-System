/**
 * File: readReplicas.ts
 *
 * Read replica router — manages primary + replica PostgreSQL pools, routes
 * reads to weighted replicas based on health and replication lag, supports
 * sticky sessions and explicit transactions, with per-replica circuit breakers.
 *
 * How it connects:
 * - Sits between the service layer and PostgreSQL pools
 * - Checks query intent, replica health, and lag before routing
 * - Falls back to the primary when consistency matters
 *
 * Simple explanation:
 * Decides which database connection to use so reads stay fast without serving stale data.
 */

import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg'
import { EventEmitter } from 'events'

// TYPE DEFINITIONS

export interface ReplicaConfig {
  name: string
  host: string
  port: number
  database: string
  user: string
  password: string
  weight?: number
  maxConnections?: number
  region?: string
  maxLagMs?: number
  role?: 'primary' | 'replica' | 'standby'
}

export interface ReplicaStatus {
  name: string
  host: string
  port: number
  isHealthy: boolean
  lagMs: number
  activeConnections: number
  totalConnections: number
  queriesProcessed: number
  averageQueryTimeMs: number
  lastHealthCheck: Date
  region?: string
  weight: number
}

interface ReplicaPool {
  config: ReplicaConfig
  pool: Pool
  status: ReplicaStatus
  circuitOpen: boolean
  failureCount: number
  lastFailure?: Date
}

interface QueryOptions {
  preferPrimary?: boolean
  maxLagMs?: number
  stickySession?: string
  timeout?: number
  retries?: number
}

type QueryType = 'read' | 'write' | 'unknown'

// READ REPLICA MANAGER

class ReadReplicaManager extends EventEmitter {
  private primaryPool: ReplicaPool | null = null
  private replicaPools: Map<string, ReplicaPool> = new Map()
  private stickySessionMap = new Map<string, string>() // sessionId -> replicaName
  private transactionContexts = new Map<string, string>() // txId -> poolName
  private healthCheckInterval: NodeJS.Timeout | null = null
  private lagCheckInterval: NodeJS.Timeout | null = null
  private roundRobinIndex = 0
  
  private config = {
    healthCheckIntervalMs: 5000,
    lagCheckIntervalMs: 10000,
    defaultMaxLagMs: 1000,
    circuitBreakerThreshold: 5,
    circuitBreakerResetMs: 30000,
    stickySessionTtlMs: 5000,
    queryTimeout: 30000,
    retries: 2,
  }
  
  /**
   * Initialize the read replica manager
   */
  async init(replicas: ReplicaConfig[]): Promise<void> {
    for (const config of replicas) {
      const pool = new Pool({
        host: config.host,
        port: config.port,
        database: config.database,
        user: config.user,
        password: config.password,
        max: config.maxConnections || 10,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 5000,
      })
      
      const replicaPool: ReplicaPool = {
        config,
        pool,
        status: {
          name: config.name,
          host: config.host,
          port: config.port,
          isHealthy: false,
          lagMs: 0,
          activeConnections: 0,
          totalConnections: config.maxConnections || 10,
          queriesProcessed: 0,
          averageQueryTimeMs: 0,
          lastHealthCheck: new Date(),
          region: config.region,
          weight: config.weight || 1,
        },
        circuitOpen: false,
        failureCount: 0,
      }
      
      if (config.role === 'primary') {
        this.primaryPool = replicaPool
      } else {
        this.replicaPools.set(config.name, replicaPool)
      }
      
      // Set up pool error handling
      pool.on('error', (err) => {
        console.error(`[ReadReplicas] Pool error on ${config.name}:`, err.message)
        this.handlePoolError(config.name)
      })
    }
    
    // Initial health check
    await this.checkAllHealth()
    
    // Start health check intervals
    this.healthCheckInterval = setInterval(
      () => this.checkAllHealth(),
      this.config.healthCheckIntervalMs
    )
    
    this.lagCheckInterval = setInterval(
      () => this.checkAllLag(),
      this.config.lagCheckIntervalMs
    )
    
    // Clean up sticky sessions periodically
    setInterval(() => this.cleanupStickySessions(), this.config.stickySessionTtlMs)
    
    console.log(`[ReadReplicas] Initialized with ${this.replicaPools.size} replicas`)
    this.emit('initialized', this.getAllStatus())
  }
  
  /**
   * Execute a query with automatic read/write routing
   */
  async query<T extends QueryResultRow = QueryResultRow>(
    sql: string,
    params?: any[],
    options: QueryOptions = {}
  ): Promise<QueryResult<T>> {
    const queryType = this.detectQueryType(sql)
    const startTime = Date.now()
    
    // Writes always go to primary
    if (queryType === 'write' || options.preferPrimary) {
      return this.queryPrimary(sql, params, options)
    }
    
    // Check sticky session
    if (options.stickySession) {
      const stickyReplica = this.stickySessionMap.get(options.stickySession)
      if (stickyReplica) {
        const pool = this.replicaPools.get(stickyReplica) || this.primaryPool
        if (pool && pool.status.isHealthy) {
          return this.executeQuery(pool, sql, params, options, startTime)
        }
      }
    }
    
    // Select healthy replica
    const replica = this.selectReplica(options.maxLagMs)
    
    if (!replica) {
      // Fallback to primary if no healthy replicas
      console.warn('[ReadReplicas] No healthy replicas, falling back to primary')
      return this.queryPrimary(sql, params, options)
    }
    
    // Update sticky session
    if (options.stickySession) {
      this.stickySessionMap.set(options.stickySession, replica.config.name)
    }
    
    return this.executeQuery(replica, sql, params, options, startTime)
  }
  
  /**
   * Execute query on primary (for writes or explicit primary reads)
   */
  async queryPrimary<T extends QueryResultRow = QueryResultRow>(
    sql: string,
    params?: any[],
    options: QueryOptions = {}
  ): Promise<QueryResult<T>> {
    if (!this.primaryPool) {
      throw new Error('Primary database not configured')
    }
    
    return this.executeQuery(this.primaryPool, sql, params, options, Date.now())
  }
  
  /**
   * Execute query on a specific replica
   */
  async queryReplica<T extends QueryResultRow = QueryResultRow>(
    replicaName: string,
    sql: string,
    params?: any[],
    options: QueryOptions = {}
  ): Promise<QueryResult<T>> {
    const replica = this.replicaPools.get(replicaName)
    
    if (!replica) {
      throw new Error(`Replica not found: ${replicaName}`)
    }
    
    if (!replica.status.isHealthy) {
      throw new Error(`Replica unhealthy: ${replicaName}`)
    }
    
    return this.executeQuery(replica, sql, params, options, Date.now())
  }
  
  /**
   * Get a client for transaction handling
   */
  async getClient(options: { preferReplica?: boolean } = {}): Promise<{
    client: PoolClient
    release: () => void
    poolName: string
  }> {
    const pool = options.preferReplica
      ? this.selectReplica()?.pool || this.primaryPool?.pool
      : this.primaryPool?.pool
    
    if (!pool) {
      throw new Error('No database pool available')
    }
    
    const client = await pool.connect()
    const poolName = options.preferReplica
      ? this.selectReplica()?.config.name || 'primary'
      : 'primary'
    
    return {
      client,
      release: () => client.release(),
      poolName,
    }
  }
  
  /**
   * Execute a transaction on primary
   */
  async transaction<T>(
    fn: (client: PoolClient) => Promise<T>
  ): Promise<T> {
    if (!this.primaryPool) {
      throw new Error('Primary database not configured')
    }
    
    const client = await this.primaryPool.pool.connect()
    
    try {
      await client.query('BEGIN')
      const result = await fn(client)
      await client.query('COMMIT')
      return result
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  }
  
  /**
   * Execute a read-only transaction on replica
   */
  async readTransaction<T>(
    fn: (client: PoolClient) => Promise<T>,
    options: QueryOptions = {}
  ): Promise<T> {
    const replica = this.selectReplica(options.maxLagMs)
    const pool = replica?.pool || this.primaryPool?.pool
    
    if (!pool) {
      throw new Error('No database pool available')
    }
    
    const client = await pool.connect()
    
    try {
      await client.query('BEGIN READ ONLY')
      const result = await fn(client)
      await client.query('COMMIT')
      return result
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  }
  
  // PRIVATE HELPERS
  
  private async executeQuery<T extends QueryResultRow>(
    pool: ReplicaPool,
    sql: string,
    params: any[] | undefined,
    options: QueryOptions,
    startTime: number
  ): Promise<QueryResult<T>> {
    const timeout = options.timeout || this.config.queryTimeout
    const retries = options.retries ?? this.config.retries
    
    let lastError: Error | null = null
    
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        // Check circuit breaker
        if (pool.circuitOpen) {
          throw new Error(`Circuit open for ${pool.config.name}`)
        }
        
        const result = await Promise.race([
          pool.pool.query<T>(sql, params),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Query timeout')), timeout)
          ),
        ])
        
        // Update stats
        const duration = Date.now() - startTime
        pool.status.queriesProcessed++
        pool.status.averageQueryTimeMs = 
          (pool.status.averageQueryTimeMs * (pool.status.queriesProcessed - 1) + duration) /
          pool.status.queriesProcessed
        
        // Reset failure count on success
        pool.failureCount = 0
        
        this.emit('queryCompleted', {
          pool: pool.config.name,
          duration,
          rowCount: result.rowCount,
        })
        
        return result
      } catch (err: any) {
        lastError = err
        pool.failureCount++
        
        console.warn(`[ReadReplicas] Query failed on ${pool.config.name} (attempt ${attempt + 1}):`, err.message)
        
        // Check if circuit should open
        if (pool.failureCount >= this.config.circuitBreakerThreshold) {
          this.openCircuit(pool)
        }
        
        // Don't retry on non-transient errors
        if (err.message.includes('syntax error') || err.code === '23505') {
          break
        }
      }
    }
    
    throw lastError || new Error('Query failed')
  }
  
  private detectQueryType(sql: string): QueryType {
    const normalized = sql.trim().toUpperCase()
    
    if (normalized.startsWith('SELECT') || 
        normalized.startsWith('WITH') ||
        normalized.startsWith('EXPLAIN')) {
      // Check for SELECT ... FOR UPDATE
      if (normalized.includes('FOR UPDATE') || normalized.includes('FOR SHARE')) {
        return 'write'
      }
      return 'read'
    }
    
    if (normalized.startsWith('INSERT') ||
        normalized.startsWith('UPDATE') ||
        normalized.startsWith('DELETE') ||
        normalized.startsWith('CREATE') ||
        normalized.startsWith('ALTER') ||
        normalized.startsWith('DROP') ||
        normalized.startsWith('TRUNCATE')) {
      return 'write'
    }
    
    return 'unknown'
  }
  
  private selectReplica(maxLagMs?: number): ReplicaPool | null {
    const maxLag = maxLagMs ?? this.config.defaultMaxLagMs
    
    // Filter healthy replicas with acceptable lag
    const candidates: ReplicaPool[] = []
    
    for (const pool of this.replicaPools.values()) {
      if (pool.status.isHealthy && !pool.circuitOpen && pool.status.lagMs <= maxLag) {
        candidates.push(pool)
      }
    }
    
    if (candidates.length === 0) {
      return null
    }
    
    // Weighted round-robin selection
    const totalWeight = candidates.reduce((sum, c) => sum + c.status.weight, 0)
    let random = Math.random() * totalWeight
    
    for (const candidate of candidates) {
      random -= candidate.status.weight
      if (random <= 0) {
        return candidate
      }
    }
    
    // Fallback to round-robin
    this.roundRobinIndex = (this.roundRobinIndex + 1) % candidates.length
    return candidates[this.roundRobinIndex]
  }
  
  private async checkAllHealth(): Promise<void> {
    const checks: Promise<void>[] = []
    
    if (this.primaryPool) {
      checks.push(this.checkHealth(this.primaryPool))
    }
    
    for (const pool of this.replicaPools.values()) {
      checks.push(this.checkHealth(pool))
    }
    
    await Promise.allSettled(checks)
  }
  
  private async checkHealth(pool: ReplicaPool): Promise<void> {
    try {
      const start = Date.now()
      await pool.pool.query('SELECT 1')
      const latency = Date.now() - start
      
      pool.status.isHealthy = true
      pool.status.lastHealthCheck = new Date()
      pool.status.activeConnections = pool.pool.totalCount - pool.pool.idleCount
      
      // Potentially close circuit if it was open
      if (pool.circuitOpen && pool.failureCount === 0) {
        this.closeCircuit(pool)
      }
      
      this.emit('healthCheckPassed', { name: pool.config.name, latency })
    } catch (err: any) {
      pool.status.isHealthy = false
      pool.status.lastHealthCheck = new Date()
      pool.failureCount++
      
      this.emit('healthCheckFailed', { name: pool.config.name, error: err.message })
    }
  }
  
  private async checkAllLag(): Promise<void> {
    for (const pool of this.replicaPools.values()) {
      try {
        // Query pg_stat_replication or use pg_last_xact_replay_timestamp
        const result = await pool.pool.query(`
          SELECT CASE 
            WHEN pg_last_wal_receive_lsn() = pg_last_wal_replay_lsn() THEN 0
            ELSE EXTRACT(EPOCH FROM (NOW() - pg_last_xact_replay_timestamp())) * 1000
          END AS lag_ms
        `)
        
        pool.status.lagMs = result.rows[0]?.lag_ms || 0
        
        this.emit('lagChecked', {
          name: pool.config.name,
          lagMs: pool.status.lagMs,
        })
      } catch (err: any) {
        // If we can't check lag, assume it's high
        pool.status.lagMs = Infinity
        console.warn(`[ReadReplicas] Lag check failed for ${pool.config.name}:`, err.message)
      }
    }
  }
  
  private openCircuit(pool: ReplicaPool): void {
    pool.circuitOpen = true
    pool.lastFailure = new Date()
    
    console.warn(`[ReadReplicas] Circuit opened for ${pool.config.name}`)
    this.emit('circuitOpened', { name: pool.config.name })
    
    // Schedule circuit reset
    setTimeout(() => {
      pool.failureCount = 0
      this.closeCircuit(pool)
    }, this.config.circuitBreakerResetMs)
  }
  
  private closeCircuit(pool: ReplicaPool): void {
    pool.circuitOpen = false
    console.log(`[ReadReplicas] Circuit closed for ${pool.config.name}`)
    this.emit('circuitClosed', { name: pool.config.name })
  }
  
  private handlePoolError(poolName: string): void {
    const pool = this.replicaPools.get(poolName) || 
      (this.primaryPool?.config.name === poolName ? this.primaryPool : null)
    
    if (pool) {
      pool.failureCount++
      pool.status.isHealthy = false
      
      if (pool.failureCount >= this.config.circuitBreakerThreshold) {
        this.openCircuit(pool)
      }
    }
  }
  
  private cleanupStickySessions(): void {
    // Clean up old sticky sessions
    // In production, use Redis with TTL instead
    const cutoff = Date.now() - this.config.stickySessionTtlMs
    // Note: This simplified version doesn't track timestamps
    // A real implementation would use a TTL cache like lru-cache
  }
  
  // PUBLIC STATUS / MANAGEMENT
  
  /**
   * Get status of all pools
   */
  getAllStatus(): ReplicaStatus[] {
    const statuses: ReplicaStatus[] = []
    
    if (this.primaryPool) {
      statuses.push({
        ...this.primaryPool.status,
        name: 'primary',
      })
    }
    
    for (const pool of this.replicaPools.values()) {
      statuses.push(pool.status)
    }
    
    return statuses
  }
  
  /**
   * Get status of a specific replica
   */
  getStatus(name: string): ReplicaStatus | undefined {
    if (name === 'primary') {
      return this.primaryPool?.status
    }
    return this.replicaPools.get(name)?.status
  }
  
  /**
   * Add a new replica dynamically
   */
  async addReplica(config: ReplicaConfig): Promise<void> {
    if (this.replicaPools.has(config.name)) {
      throw new Error(`Replica already exists: ${config.name}`)
    }
    
    const pool = new Pool({
      host: config.host,
      port: config.port,
      database: config.database,
      user: config.user,
      password: config.password,
      max: config.maxConnections || 10,
    })
    
    const replicaPool: ReplicaPool = {
      config,
      pool,
      status: {
        name: config.name,
        host: config.host,
        port: config.port,
        isHealthy: false,
        lagMs: 0,
        activeConnections: 0,
        totalConnections: config.maxConnections || 10,
        queriesProcessed: 0,
        averageQueryTimeMs: 0,
        lastHealthCheck: new Date(),
        region: config.region,
        weight: config.weight || 1,
      },
      circuitOpen: false,
      failureCount: 0,
    }
    
    this.replicaPools.set(config.name, replicaPool)
    await this.checkHealth(replicaPool)
    
    console.log(`[ReadReplicas] Added replica: ${config.name}`)
    this.emit('replicaAdded', { name: config.name })
  }
  
  /**
   * Remove a replica (with connection draining)
   */
  async removeReplica(name: string, drainTimeoutMs = 10000): Promise<void> {
    const pool = this.replicaPools.get(name)
    
    if (!pool) {
      throw new Error(`Replica not found: ${name}`)
    }
    
    // Mark as unhealthy to stop new queries
    pool.status.isHealthy = false
    
    // Wait for active connections to drain
    const startTime = Date.now()
    while (
      pool.pool.totalCount - pool.pool.idleCount > 0 &&
      Date.now() - startTime < drainTimeoutMs
    ) {
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    
    // Close pool
    await pool.pool.end()
    this.replicaPools.delete(name)
    
    console.log(`[ReadReplicas] Removed replica: ${name}`)
    this.emit('replicaRemoved', { name })
  }
  
  /**
   * Update replica weight for load balancing
   */
  setReplicaWeight(name: string, weight: number): void {
    const pool = this.replicaPools.get(name)
    
    if (!pool) {
      throw new Error(`Replica not found: ${name}`)
    }
    
    pool.status.weight = weight
    pool.config.weight = weight
    
    this.emit('weightUpdated', { name, weight })
  }
  
  /**
   * Shutdown all pools gracefully
   */
  async shutdown(): Promise<void> {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval)
    }
    
    if (this.lagCheckInterval) {
      clearInterval(this.lagCheckInterval)
    }
    
    const shutdowns: Promise<void>[] = []
    
    if (this.primaryPool) {
      shutdowns.push(this.primaryPool.pool.end())
    }
    
    for (const pool of this.replicaPools.values()) {
      shutdowns.push(pool.pool.end())
    }
    
    await Promise.allSettled(shutdowns)
    console.log('[ReadReplicas] Shutdown complete')
    this.emit('shutdown')
  }
}

// SINGLETON INSTANCE

const replicaManager = new ReadReplicaManager()

/**
 * Initialize read replicas from environment or config
 */
export async function initReadReplicas(config?: ReplicaConfig[]): Promise<void> {
  const replicas = config || getReplicasFromEnv()
  await replicaManager.init(replicas)
}

function getReplicasFromEnv(): ReplicaConfig[] {
  const replicas: ReplicaConfig[] = []
  
  // Primary database
  replicas.push({
    name: 'primary',
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    database: process.env.DB_NAME || 'aegis',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
    role: 'primary',
    maxConnections: parseInt(process.env.DB_POOL_MAX || '20', 10),
  })
  
  // Read replicas from environment
  // Format: DB_REPLICA_1_HOST, DB_REPLICA_1_PORT, etc.
  for (let i = 1; i <= 10; i++) {
    const host = process.env[`DB_REPLICA_${i}_HOST`]
    if (!host) continue
    
    replicas.push({
      name: `replica-${i}`,
      host,
      port: parseInt(process.env[`DB_REPLICA_${i}_PORT`] || '5432', 10),
      database: process.env[`DB_REPLICA_${i}_NAME`] || process.env.DB_NAME || 'aegis',
      user: process.env[`DB_REPLICA_${i}_USER`] || process.env.DB_USER || 'postgres',
      password: process.env[`DB_REPLICA_${i}_PASSWORD`] || process.env.DB_PASSWORD || '',
      role: 'replica',
      weight: parseInt(process.env[`DB_REPLICA_${i}_WEIGHT`] || '1', 10),
      region: process.env[`DB_REPLICA_${i}_REGION`],
      maxLagMs: parseInt(process.env[`DB_REPLICA_${i}_MAX_LAG_MS`] || '1000', 10),
    })
  }
  
  return replicas
}

// EXPORTS

/**
 * Query with automatic read/write routing
 */
export const query = replicaManager.query.bind(replicaManager)

/**
 * Query primary database directly
 */
export const queryPrimary = replicaManager.queryPrimary.bind(replicaManager)

/**
 * Query a specific replica
 */
export const queryReplica = replicaManager.queryReplica.bind(replicaManager)

/**
 * Get a client for manual transaction handling
 */
export const getClient = replicaManager.getClient.bind(replicaManager)

/**
 * Execute a transaction on primary
 */
export const transaction = replicaManager.transaction.bind(replicaManager)

/**
 * Execute a read-only transaction on replica
 */
export const readTransaction = replicaManager.readTransaction.bind(replicaManager)

/**
 * Get status of all replicas
 */
export const getReplicaStatus = replicaManager.getAllStatus.bind(replicaManager)

/**
 * Add a replica dynamically
 */
export const addReplica = replicaManager.addReplica.bind(replicaManager)

/**
 * Remove a replica
 */
export const removeReplica = replicaManager.removeReplica.bind(replicaManager)

/**
 * Update replica weight
 */
export const setReplicaWeight = replicaManager.setReplicaWeight.bind(replicaManager)

/**
 * Shutdown all connections
 */
export const shutdown = replicaManager.shutdown.bind(replicaManager)

/**
 * Event emitter for monitoring
 */
export const events = replicaManager as EventEmitter

/**
 * Get stats for admin introspection
 */
export function getReadReplicaStats(): {
  primary: ReplicaStatus | null
  replicas: ReplicaStatus[]
  totalQueries: number
  averageLagMs: number
  healthyCount: number
  totalCount: number
} {
  const statuses = replicaManager.getAllStatus()
  const primary = statuses.find(s => s.name === 'primary') || null
  const replicas = statuses.filter(s => s.name !== 'primary')
  
  const totalQueries = statuses.reduce((sum, s) => sum + s.queriesProcessed, 0)
  const healthyReplicas = replicas.filter(r => r.isHealthy)
  const averageLag = healthyReplicas.length > 0
    ? healthyReplicas.reduce((sum, r) => sum + r.lagMs, 0) / healthyReplicas.length
    : 0
  
  return {
    primary,
    replicas,
    totalQueries,
    averageLagMs: averageLag,
    healthyCount: healthyReplicas.length,
    totalCount: replicas.length,
  }
}

export default {
  initReadReplicas,
  query,
  queryPrimary,
  queryReplica,
  getClient,
  transaction,
  readTransaction,
  getReplicaStatus,
  addReplica,
  removeReplica,
  setReplicaWeight,
  shutdown,
  events,
  getReadReplicaStats,
}
