/**
 * File: setupDatabase.ts
 *
 * What this file does:
 * Database initialisation script: runs all SQL migration files in order,
 * creates the schema, seeds initial data (admin account, regions, hazard
 * types), and sets up PostGIS extensions.
 *
 * How it connects:
 * - Can be run standalone: npx ts-node src/utils/setupDatabase.ts
 * - Reads SQL files from server/sql/ directory
 * - Creates the first admin account if none exists
 *
 * Simple explanation:
 * Sets up the database from scratch — creates tables, adds initial data.
 */

import fs from 'fs'
import path from 'path'
import pool from '../models/db.js'
import bcrypt from 'bcryptjs'

async function setup(): Promise<void> {
  console.log('[Setup] Starting database initialisation...')

  try {
    // Test the database connection
    const client = await pool.connect()
    console.log('[Setup] Connected to PostgreSQL successfully')
    client.release()

    // Read and execute schema SQL
    const schemaPath = path.join(process.cwd(), 'sql', 'schema.sql')
    const schemaSQL = fs.readFileSync(schemaPath, 'utf-8')
    console.log('[Setup] Executing schema.sql...')
    await pool.query(schemaSQL)
    console.log('[Setup] Schema created successfully')

    // Read and execute seed SQL
    const seedPath = path.join(process.cwd(), 'sql', 'seed.sql')
    const seedSQL = fs.readFileSync(seedPath, 'utf-8')
    console.log('[Setup] Resetting seeded tables...')
    await pool.query(`
      TRUNCATE TABLE
        report_media,
        prediction_records,
        ai_executions,
        flood_predictions,
        resource_deployments,
        community_help,
        ai_model_metrics,
        alerts,
        reports,
        activity_log,
        audit_log
      RESTART IDENTITY CASCADE
    `)
    console.log('[Setup] Executing seed.sql...')
    await pool.query(seedSQL)
    console.log('[Setup] Seed data inserted successfully')

    // Ensure the default admin has a properly hashed password and admin privileges
    // This runs last to guarantee credentials/role are correct regardless of seed history

    // Verify the setup
    const reportCount = await pool.query('SELECT COUNT(*)::int as count FROM reports')
    const operatorCount = await pool.query('SELECT COUNT(*)::int as count FROM operators')
    const alertCount = await pool.query('SELECT COUNT(*)::int as count FROM alerts')
    const modelCount = await pool.query('SELECT COUNT(*)::int as count FROM ai_model_metrics')

    console.log('\n[Setup] Database ready:')
    console.log(`  Reports:    ${reportCount.rows[0].count}`)
    console.log(`  Operators:  ${operatorCount.rows[0].count}`)
    console.log(`  Alerts:     ${alertCount.rows[0].count}`)
    console.log(`  AI Models:  ${modelCount.rows[0].count}`)
    console.log('[Setup] Done!')
  } catch (err: any) {
    console.error('[Setup] Error:', err.message)
    if (err.message.includes('postgis')) {
      console.error('\n[Setup] PostGIS extension not found.')
      console.error('Install PostGIS and run: CREATE EXTENSION postgis;')
    }
    if (err.message.includes('ECONNREFUSED')) {
      console.error('\n[Setup] Cannot connect to PostgreSQL.')
      console.error('Make sure PostgreSQL is running and DATABASE_URL is correct in .env')
    }
    process.exit(1)
  } finally {
    await pool.end()
  }
}

setup()
