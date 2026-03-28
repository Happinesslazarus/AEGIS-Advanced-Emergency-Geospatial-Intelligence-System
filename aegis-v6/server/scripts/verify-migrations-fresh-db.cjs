#!/usr/bin/env node

const fs = require('fs')
const path = require('path')
const { Client } = require('pg')
require('dotenv').config({ path: path.join(__dirname, '..', '.env') })

const ROOT = path.join(__dirname, '..')
const SQL_DIR = path.join(ROOT, 'sql')
const MANIFEST = path.join(SQL_DIR, 'migration_manifest.txt')

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8')
}

function getMigrationList() {
  if (fs.existsSync(MANIFEST)) {
    return readText(MANIFEST)
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('#'))
      .map((line) => path.join(SQL_DIR, line))
  }

  return fs
    .readdirSync(SQL_DIR)
    .filter((name) => /^migration_.*\.sql$/i.test(name))
    .sort((a, b) => a.localeCompare(b, 'en'))
    .map((name) => path.join(SQL_DIR, name))
}

function requireDatabaseUrl() {
  const url = process.env.DATABASE_URL
  if (!url) {
    throw new Error('DATABASE_URL is required in server/.env for fresh migration verification')
  }
  return url
}

function buildAdminUrl(dbUrl) {
  const u = new URL(dbUrl)
  u.pathname = '/postgres'
  return u.toString()
}

function buildTempDbUrl(dbUrl, dbName) {
  const u = new URL(dbUrl)
  u.pathname = `/${dbName}`
  return u.toString()
}

async function queryOne(client, sql, params = []) {
  const res = await client.query(sql, params)
  return res.rows[0]
}

async function ensureDropped(client, dbName) {
  await client.query(
    `SELECT pg_terminate_backend(pid)
     FROM pg_stat_activity
     WHERE datname = $1 AND pid <> pg_backend_pid()`,
    [dbName]
  )
  await client.query(`DROP DATABASE IF EXISTS ${dbName}`)
}

async function applySqlFile(client, filePath) {
  const sql = readText(filePath)
  process.stdout.write(`Applying ${path.basename(filePath)} ... `)
  await client.query(sql)
  process.stdout.write('OK\n')
}

async function verifySchema(client) {
  const requiredTables = [
    'ai_predictions',
    'model_monitoring_snapshots',
    'alerts',
    'alert_delivery_log',
    'distress_calls',
    'reports',
    'community_reports',
    'community_post_reports',
    'community_posts',
    'audit_log'
  ]

  for (const t of requiredTables) {
    const row = await queryOne(client, `SELECT to_regclass($1) AS reg`, [`public.${t}`])
    if (!row || !row.reg) {
      throw new Error(`Missing required table: ${t}`)
    }
  }

  const requiredColumns = [
    ['ai_predictions', 'generated_at'],
    ['ai_predictions', 'model_version'],
    ['model_monitoring_snapshots', 'snapshot_time'],
    ['alerts', 'is_active'],
    ['alert_delivery_log', 'retry_count'],
    ['distress_calls', 'status'],
    ['distress_calls', 'last_gps_at'],
    ['reports', 'ai_confidence'],
    ['community_reports', 'status'],
    ['audit_log', 'action_type']
  ]

  for (const [table, column] of requiredColumns) {
    const row = await queryOne(
      client,
      `SELECT 1 AS ok
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2`,
      [table, column]
    )
    if (!row) {
      throw new Error(`Missing required column: ${table}.${column}`)
    }
  }

  const requiredIndexes = [
    'idx_ai_predictions_model_trace',
    'idx_model_monitoring_snapshots_lookup',
    'idx_alert_delivery_pending',
    'idx_distress_calls_active',
    'idx_audit_log_created'
  ]

  for (const idx of requiredIndexes) {
    const row = await queryOne(
      client,
      `SELECT 1 AS ok
       FROM pg_indexes
       WHERE schemaname = 'public' AND indexname = $1`,
      [idx]
    )
    if (!row) {
      throw new Error(`Missing required index: ${idx}`)
    }
  }

  // Validate FK from alert_delivery_log to alerts exists.
  const fkRow = await queryOne(
    client,
    `SELECT 1 AS ok
     FROM pg_constraint
     WHERE conrelid = 'alert_delivery_log'::regclass
       AND contype = 'f'`
  )
  if (!fkRow) {
    throw new Error('Missing foreign key on alert_delivery_log')
  }

  // Quick sanity check that migrations are tracked if table exists.
  const schemaMigrationsReg = await queryOne(client, `SELECT to_regclass('public.schema_migrations') AS reg`)
  if (schemaMigrationsReg && schemaMigrationsReg.reg) {
    const cnt = await queryOne(client, `SELECT COUNT(*)::int AS c FROM schema_migrations`)
    process.stdout.write(`schema_migrations rows: ${cnt.c}\n`)
  }
}

async function main() {
  const dbUrl = requireDatabaseUrl()
  const adminUrl = buildAdminUrl(dbUrl)
  const tempDbName = `aegis_verify_${Date.now()}_${Math.floor(Math.random() * 10000)}`
  const tempDbUrl = buildTempDbUrl(dbUrl, tempDbName)

  const admin = new Client({ connectionString: adminUrl })
  let verify = null

  try {
    await admin.connect()
    await ensureDropped(admin, tempDbName)
    await admin.query(`CREATE DATABASE ${tempDbName}`)
    process.stdout.write(`Created temp database: ${tempDbName}\n`)

    verify = new Client({ connectionString: tempDbUrl })
    await verify.connect()

    await applySqlFile(verify, path.join(SQL_DIR, 'schema.sql'))

    const migrations = getMigrationList()
    for (const file of migrations) {
      if (!fs.existsSync(file)) {
        throw new Error(`Manifest entry not found on disk: ${file}`)
      }
      await applySqlFile(verify, file)
    }

    await verifySchema(verify)
    process.stdout.write('\nFresh DB migration verification: PASS\n')
  } finally {
    if (verify) {
      await verify.end().catch(() => {})
    }

    await ensureDropped(admin, tempDbName).catch(() => {})
    await admin.end().catch(() => {})
  }
}

main().catch((err) => {
  process.stderr.write(`\nFresh DB migration verification: FAIL\n${err.message}\n`)
  process.exit(1)
})
