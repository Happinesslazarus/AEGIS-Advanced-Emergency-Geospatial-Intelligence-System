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

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:password@localhost:5432/aegis',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
})

// Log connection events for debugging (suppressed in production)
pool.on('connect', () => { if (process.env.NODE_ENV !== 'production') console.log('[DB] New client connected') })
pool.on('error', (err) => console.error('[DB] Unexpected pool error:', err.message))

export default pool
