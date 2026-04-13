/**
 * File: db.ts
 *
 * What this file does:
 * Creates and exports a PostgreSQL connection pool with automatic retry
 * and exponential backoff. Every database query in the application goes
 * through this pool.
 *
 * How it connects:
 * - Imported by every route handler and service that needs database access
 * - PostGIS spatial queries also go through this pool (same Postgres instance)
 * - Wrapped with query logging via queryLogger.ts for observability
 *
 * Simple explanation:
 * The shared database connection that everything else uses to talk to Postgres.
 * If the database is temporarily unavailable, it retries automatically.
 */

import pg from 'pg'
import dotenv from 'dotenv'
import path from 'path'
import fs from 'fs'
import { logger } from '../services/logger.js'
import { wrapPoolWithQueryLogging } from '../services/queryLogger.js'

// Robustly find .env no matter what the CWD is
const envCandidates = [
  path.resolve('.env'),                          // CWD is server/
  path.resolve('server', '.env'),                // CWD is project root
  path.resolve('aegis-v6', 'server', '.env'),    // CWD is workspace root
]
for (const envFile of envCandidates) {
  if (fs.existsSync(envFile)) {
    dotenv.config({ path: envFile })
    break
  }
}
if (!process.env.DATABASE_URL) {
  dotenv.config() // last resort: default behavior
}

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  logger.error('[DB] FATAL: DATABASE_URL environment variable is not set.')
  logger.error('[DB] Set DATABASE_URL in server/.env before starting the server.')
  process.exit(1)
}

/**
 * PostgreSQL connection retry configuration
 * Uses exponential backoff for resilient connection handling
 */
const RETRY_CONFIG = {
  maxRetries: parseInt(process.env.DB_MAX_RETRIES || '5'),
  baseDelayMs: parseInt(process.env.DB_RETRY_BASE_DELAY_MS || '1000'),
  maxDelayMs: parseInt(process.env.DB_RETRY_MAX_DELAY_MS || '30000'),
}

const pool = new pg.Pool({
  connectionString,
  max: parseInt(process.env.DB_POOL_MAX || '20'),
  idleTimeoutMillis: parseInt(process.env.DB_IDLE_TIMEOUT_MS || '30000'),
  connectionTimeoutMillis: parseInt(process.env.DB_CONNECT_TIMEOUT_MS || '5000'),
  // Statement timeout prevents runaway queries (30 seconds default)
  statement_timeout: parseInt(process.env.DB_STATEMENT_TIMEOUT_MS || '30000'),
  // Query timeout at application level
  query_timeout: parseInt(process.env.DB_QUERY_TIMEOUT_MS || '30000'),
  // Enforce TLS for database connections in production unless explicitly disabled
  // (e.g. Docker-internal connections where PostgreSQL is not configured with SSL)
  ...(process.env.NODE_ENV === 'production' && process.env.DB_SSL !== 'false' && {
    ssl: {
      rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false',
    },
  }),
})

// Connection event monitoring
pool.on('connect', () => {
  if (process.env.NODE_ENV !== 'production') logger.info('[DB] New client connected')
})
pool.on('error', (err) => {
  logger.error({ err }, '[DB] Unexpected pool error — check DB connectivity')
})
pool.on('remove', () => {
  if (process.env.NODE_ENV !== 'production') logger.info('[DB] Client removed from pool')
})

/**
 * Execute a query with exponential backoff retry logic
 * Handles transient connection failures gracefully
 */
export async function queryWithRetry<T extends pg.QueryResultRow = any>(
  text: string,
  params?: any[],
  maxRetries = RETRY_CONFIG.maxRetries
): Promise<pg.QueryResult<T>> {
  let lastError: Error | null = null
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await pool.query<T>(text, params)
    } catch (err: any) {
      lastError = err
      
      // Only retry on connection-related errors
      const isRetryable = 
        err.code === 'ECONNREFUSED' ||
        err.code === 'ECONNRESET' ||
        err.code === 'ETIMEDOUT' ||
        err.code === '57P01' || // admin_shutdown
        err.code === '57P02' || // crash_shutdown
        err.code === '57P03' || // cannot_connect_now
        err.code === '08000' || // connection_exception
        err.code === '08003' || // connection_does_not_exist
        err.code === '08006'    // connection_failure
      
      if (!isRetryable || attempt === maxRetries) {
        throw err
      }
      
      // Exponential backoff with jitter
      const delay = Math.min(
        RETRY_CONFIG.baseDelayMs * Math.pow(2, attempt) + Math.random() * 1000,
        RETRY_CONFIG.maxDelayMs
      )
      
      logger.warn(
        { attempt: attempt + 1, maxRetries, code: err.code, delay },
        '[DB] Connection error, retrying...'
      )
      
      await new Promise(resolve => setTimeout(resolve, delay))
    }
  }
  
  throw lastError
}

/**
 * Check database connectivity - returns true if healthy
 */
export async function checkDbHealth(): Promise<{ healthy: boolean; latencyMs?: number; error?: string }> {
  const start = Date.now()
  try {
    await pool.query('SELECT 1')
    return { healthy: true, latencyMs: Date.now() - start }
  } catch (err: any) {
    return { healthy: false, error: err.message }
  }
}

/**
 * Get current pool statistics for monitoring
 */
export function getPoolStats() {
  return {
    totalCount: pool.totalCount,
    idleCount: pool.idleCount,
    waitingCount: pool.waitingCount,
  }
}

// Wrap pool with slow query logging and metrics
const monitoredPool = wrapPoolWithQueryLogging(pool)

export default monitoredPool
