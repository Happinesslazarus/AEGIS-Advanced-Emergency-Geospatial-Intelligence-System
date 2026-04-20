/**
 * Instrumented PostgreSQL query wrapper -- wraps pg Pool to detect slow
 * queries, extract SQL operation/table names, fingerprint queries for
 * aggregation, and record Prometheus histograms for duration and pool usage.
 *
 * - Wraps the pg Pool used by all database queries
 * - Records query_duration_seconds Prometheus histogram
 * - Can run EXPLAIN in dev mode for slow query diagnosis
 * */

import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg'
import client from 'prom-client'
import { logger } from './logger.js'

//Thresholds
const SLOW_QUERY_MS = parseInt(process.env.SLOW_QUERY_THRESHOLD_MS || '500', 10)
const VERY_SLOW_QUERY_MS = parseInt(process.env.VERY_SLOW_QUERY_THRESHOLD_MS || '2000', 10)
const EXPLAIN_IN_DEV = process.env.NODE_ENV !== 'production'

//Prometheus metrics
export const dbQueryDuration = new client.Histogram({
  name: 'aegis_db_query_duration_seconds',
  help: 'Database query duration in seconds',
  labelNames: ['operation', 'table'] as const,
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
})

export const dbSlowQueriesTotal = new client.Counter({
  name: 'aegis_db_slow_queries_total',
  help: 'Total number of slow database queries',
  labelNames: ['operation', 'table'] as const,
})

export const dbQueryErrorsTotal = new client.Counter({
  name: 'aegis_db_query_errors_total',
  help: 'Total number of database query errors',
  labelNames: ['operation', 'error_code'] as const,
})

export const dbPoolUtilization = new client.Gauge({
  name: 'aegis_db_pool_utilization_ratio',
  help: 'Ratio of used connections to max pool size',
})

/**
 * Extract operation type from SQL query
 */
function extractOperation(sql: string): string {
  const trimmed = sql.trim().toUpperCase()
  if (trimmed.startsWith('SELECT')) return 'SELECT'
  if (trimmed.startsWith('INSERT')) return 'INSERT'
  if (trimmed.startsWith('UPDATE')) return 'UPDATE'
  if (trimmed.startsWith('DELETE')) return 'DELETE'
  if (trimmed.startsWith('BEGIN')) return 'BEGIN'
  if (trimmed.startsWith('COMMIT')) return 'COMMIT'
  if (trimmed.startsWith('ROLLBACK')) return 'ROLLBACK'
  if (trimmed.startsWith('WITH')) return 'CTE'
  return 'OTHER'
}

/**
 * Extract main table from SQL query (best effort)
 */
function extractTable(sql: string): string {
  const patterns = [
    /FROM\s+["']?(\w+)["']?/i,           // SELECT FROM table
    /INTO\s+["']?(\w+)["']?/i,           // INSERT INTO table
    /UPDATE\s+["']?(\w+)["']?/i,         // UPDATE table
    /DELETE\s+FROM\s+["']?(\w+)["']?/i,  // DELETE FROM table
  ]

  for (const pattern of patterns) {
    const match = sql.match(pattern)
    if (match) return match[1].toLowerCase()
  }

  return 'unknown'
}

/**
 * Fingerprint a query for aggregation (replace literals with placeholders)
 */
function fingerprintQuery(sql: string): string {
  return sql
    .replace(/\$\d+/g, '?')           // Replace $1, $2 with ?
    .replace(/'[^']*'/g, "'?'")       // Replace string literals
    .replace(/\b\d+\b/g, '?')         // Replace numbers
    .replace(/\s+/g, ' ')             // Normalize whitespace
    .trim()
    .slice(0, 200)                    // Limit length
}

/**
 * Create a query-logging wrapper around a pg Pool
 */
export function wrapPoolWithQueryLogging(pool: Pool): Pool {
  const originalQuery = pool.query.bind(pool)

  //Override query method with logging
  pool.query = async function <T extends QueryResultRow>(
    text: string | { text: string; values?: unknown[] },
    values?: unknown[],
  ): Promise<QueryResult<T>> {
    const sql = typeof text === 'string' ? text : text.text
    const params = typeof text === 'string' ? values : text.values

    const start = process.hrtime.bigint()
    const operation = extractOperation(sql)
    const table = extractTable(sql)

    try {
      //Execute original query
      const result = await (originalQuery as any)(text, values) as QueryResult<T>

      const durationNs = Number(process.hrtime.bigint() - start)
      const durationMs = durationNs / 1_000_000
      const durationSec = durationMs / 1000

      //Record metrics
      dbQueryDuration.labels(operation, table).observe(durationSec)

      //Log slow queries
      if (durationMs >= VERY_SLOW_QUERY_MS) {
        dbSlowQueriesTotal.labels(operation, table).inc()
        logger.warn({
          durationMs: Math.round(durationMs),
          operation,
          table,
          rows: result.rowCount,
          fingerprint: fingerprintQuery(sql),
          paramCount: params?.length || 0,
        }, `[DB] VERY SLOW QUERY (${Math.round(durationMs)}ms)`)

        //In dev mode, run EXPLAIN ANALYZE for SELECTs
        if (EXPLAIN_IN_DEV && operation === 'SELECT') {
          try {
            const explainResult = await originalQuery(`EXPLAIN ANALYZE ${sql}`, params)
            logger.info({
              explain: explainResult.rows.map((r: any) => r['QUERY PLAN']).join('\n'),
            }, '[DB] EXPLAIN ANALYZE for slow query')
          } catch {
            //Ignore EXPLAIN errors
          }
        }
      } else if (durationMs >= SLOW_QUERY_MS) {
        dbSlowQueriesTotal.labels(operation, table).inc()
        logger.info({
          durationMs: Math.round(durationMs),
          operation,
          table,
          rows: result.rowCount,
          fingerprint: fingerprintQuery(sql),
        }, `[DB] Slow query (${Math.round(durationMs)}ms)`)
      }

      return result
    } catch (err: any) {
      const durationNs = Number(process.hrtime.bigint() - start)
      const durationMs = durationNs / 1_000_000

      //Record error metrics
      const errorCode = err.code || 'UNKNOWN'
      dbQueryErrorsTotal.labels(operation, errorCode).inc()

      logger.error({
        durationMs: Math.round(durationMs),
        operation,
        table,
        errorCode,
        errorMessage: err.message,
        fingerprint: fingerprintQuery(sql),
      }, '[DB] Query error')

      throw err
    }
  } as typeof pool.query

  return pool
}

/**
 * Create a query-logging wrapper around a PoolClient (for transactions)
 */
export function wrapClientWithQueryLogging(client: PoolClient): PoolClient {
  const originalQuery = client.query.bind(client)

  client.query = async function <T extends QueryResultRow>(
    text: string | { text: string; values?: unknown[] },
    values?: unknown[],
  ): Promise<QueryResult<T>> {
    const sql = typeof text === 'string' ? text : text.text
    const operation = extractOperation(sql)
    const table = extractTable(sql)

    const start = process.hrtime.bigint()

    try {
      const result = await (originalQuery as any)(text, values) as QueryResult<T>

      const durationNs = Number(process.hrtime.bigint() - start)
      const durationMs = durationNs / 1_000_000
      const durationSec = durationMs / 1000

      dbQueryDuration.labels(operation, table).observe(durationSec)

      if (durationMs >= SLOW_QUERY_MS) {
        dbSlowQueriesTotal.labels(operation, table).inc()
        logger.info({
          durationMs: Math.round(durationMs),
          operation,
          table,
          fingerprint: fingerprintQuery(sql),
        }, `[DB] Slow query in transaction (${Math.round(durationMs)}ms)`)
      }

      return result
    } catch (err: any) {
      const errorCode = err.code || 'UNKNOWN'
      dbQueryErrorsTotal.labels(operation, errorCode).inc()
      throw err
    }
  } as typeof client.query

  return client
}

/**
 * Update pool utilization metric
 */
export function updatePoolMetrics(pool: Pool): void {
  const total = (pool as any).totalCount || 0
  const idle = (pool as any).idleCount || 0
  const max = parseInt(process.env.DB_POOL_MAX || '20', 10)

  const used = total - idle
  const utilization = max > 0 ? used / max : 0

  dbPoolUtilization.set(utilization)
}
