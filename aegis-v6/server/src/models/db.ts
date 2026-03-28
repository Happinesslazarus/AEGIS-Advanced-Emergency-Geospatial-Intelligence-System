/*
 * db.ts - PostgreSQL connection pool
 *
 * Creates and exports a connection pool to the PostgreSQL database.
 * Uses the pg library's Pool class which maintains a set of reusable
 * connections, avoiding the overhead of connecting on every query.
 *
 * PostGIS spatial queries work through this same pool since PostGIS
 * is a PostgreSQL extension that adds geographic types and functions.
 *
 * Connection string comes from the DATABASE_URL environment variable
 * which should be set in the .env file.
 */

import pg from 'pg'
import dotenv from 'dotenv'
import path from 'path'
import fs from 'fs'
import { logger } from '../services/logger.js'

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

const pool = new pg.Pool({
  connectionString,
  max: parseInt(process.env.DB_POOL_MAX || '20'),
  idleTimeoutMillis: parseInt(process.env.DB_IDLE_TIMEOUT_MS || '30000'),
  connectionTimeoutMillis: parseInt(process.env.DB_CONNECT_TIMEOUT_MS || '5000'),
  // Enforce TLS for database connections in production
  ...(process.env.NODE_ENV === 'production' && {
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

export default pool
