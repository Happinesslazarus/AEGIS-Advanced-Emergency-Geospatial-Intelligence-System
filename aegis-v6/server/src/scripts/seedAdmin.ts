#!/usr/bin/env ts-node
 /**
 * scripts/seedAdmin.ts — Idempotent first-run super-admin seeder
 *
 * Two modes:
 *   1. Environment: reads INITIAL_ADMIN_EMAIL, INITIAL_ADMIN_PASSWORD, INITIAL_ADMIN_NAME
 *   2. Interactive: prompts via stdin when env vars are absent
 *
 * Usage:
 *   npx ts-node server/src/scripts/seedAdmin.ts
 *   INITIAL_ADMIN_EMAIL=x INITIAL_ADMIN_PASSWORD=y node dist/scripts/seedAdmin.js
 *
 * Idempotent — if an operator with the given email already exists the script
 * logs a clear message and exits 0.
 */

import dotenv from 'dotenv'
import path from 'path'
import fs from 'fs'
import readline from 'readline'
import bcrypt from 'bcryptjs'
import pg from 'pg'

// Load .env robustly (same resolver as db.ts)
const envCandidates = [
  path.resolve('.env'),
  path.resolve('server', '.env'),
  path.resolve('aegis-v6', 'server', '.env'),
]
for (const envFile of envCandidates) {
  if (fs.existsSync(envFile)) {
    dotenv.config({ path: envFile })
    break
  }
}
if (!process.env.DATABASE_URL) dotenv.config()

// Helpers

function log(msg: string) { console.log(`[seed-admin] ${msg}`) }
function fail(msg: string): never {
  console.error(`[seed-admin] ERROR: ${msg}`)
  process.exit(1)
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function validateEmail(email: string): string | null {
  if (!email || !EMAIL_RE.test(email)) return 'Invalid email format.'
  return null
}

function validatePassword(password: string): string | null {
  if (!password || password.length < 12)
    return 'Password must be at least 12 characters.'
  if (!/[A-Z]/.test(password))
    return 'Password must contain at least one uppercase letter.'
  if (!/[a-z]/.test(password))
    return 'Password must contain at least one lowercase letter.'
  if (!/[0-9]/.test(password))
    return 'Password must contain at least one digit.'
  if (!/[!@#$%^&*()\-_=+[\]{};':"\\|,.<>/?`~]/.test(password))
    return 'Password must contain at least one special character.'
  return null
}

async function prompt(question: string, hidden = false): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  return new Promise((resolve) => {
    if (hidden && process.stdin.isTTY) {
      process.stdout.write(question)
      const stdin = process.stdin
      stdin.setRawMode(true)
      stdin.resume()
      stdin.setEncoding('utf8')
      let input = ''
      const onData = (ch: string) => {
        const c = ch.toString()
        if (c === '\n' || c === '\r' || c === '\u0004') {
          stdin.setRawMode(false)
          stdin.removeListener('data', onData)
          process.stdout.write('\n')
          rl.close()
          resolve(input)
        } else if (c === '\u007F' || c === '\b') {
          if (input.length > 0) {
            input = input.slice(0, -1)
            process.stdout.write('\b \b')
          }
        } else if (c === '\u0003') {
          // Ctrl+C
          process.exit(130)
        } else {
          input += c
          process.stdout.write('*')
        }
      }
      stdin.on('data', onData)
    } else {
      rl.question(question, (answer) => {
        rl.close()
        resolve(answer)
      })
    }
  })
}

// Main

async function main() {
  const dbUrl = process.env.DATABASE_URL
  if (!dbUrl) fail('DATABASE_URL is not set. Ensure server/.env is configured.')

  // Determine input mode
  let email = (process.env.INITIAL_ADMIN_EMAIL || '').trim()
  let password = (process.env.INITIAL_ADMIN_PASSWORD || '').trim()
  let name = (process.env.INITIAL_ADMIN_NAME || '').trim()
  const isEnvMode = !!(email && password)

  if (!isEnvMode) {
    log('No INITIAL_ADMIN_EMAIL / INITIAL_ADMIN_PASSWORD found — entering interactive mode.')
    email = await prompt('Admin email: ')
    password = await prompt('Admin password: ', true)
    if (!name) name = await prompt('Full name (Enter for "System Admin"): ')
  }

  email = email.toLowerCase().trim()
  if (!name) name = 'System Admin'

  // Validate
  const emailErr = validateEmail(email)
  if (emailErr) fail(emailErr)

  const pwErr = validatePassword(password)
  if (pwErr) fail(pwErr)

  // Connect to DB
  const pool = new pg.Pool({ connectionString: dbUrl })

  try {
    // Check for existing operator with this email
    const existing = await pool.query(
      `SELECT id, role, deleted_at FROM operators WHERE LOWER(email) = LOWER($1) LIMIT 1`,
      [email],
    )

    if (existing.rows.length > 0) {
      const row = existing.rows[0]
      if (row.deleted_at) {
        log(`Operator with email ${email} exists but was soft-deleted. Reactivating as admin...`)
        await pool.query(
          `UPDATE operators SET role = 'admin', deleted_at = NULL, deleted_by = NULL,
           is_active = true, is_suspended = false, updated_at = now()
           WHERE id = $1`,
          [row.id],
        )
        log(`? Reactivated existing operator ${email} as admin.`)
      } else {
        log(`? Admin already exists (${email}, role=${row.role}). Skipping seed.`)
      }
      return
    }

    // Hash password with bcrypt 12 rounds (matches authRoutes.ts)
    const passwordHash = await bcrypt.hash(password, 12)

    // Keep seed compatible across schema versions where optional auth columns may differ.
    const colsRes = await pool.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'operators'`,
    )
    const colSet = new Set<string>(colsRes.rows.map((r: any) => String(r.column_name)))

    const insertColumns = ['email', 'password_hash', 'display_name', 'role', 'department', 'is_active']
    const insertValues = ['$1', '$2', '$3', "'admin'", "'Command & Control'", 'true']
    if (colSet.has('email_verified')) {
      insertColumns.push('email_verified')
      insertValues.push('true')
    }
    if (colSet.has('password_changed_at')) {
      insertColumns.push('password_changed_at')
      insertValues.push('NOW()')
    }

    const result = await pool.query(
      `INSERT INTO operators (${insertColumns.join(', ')})
       VALUES (${insertValues.join(', ')})
       RETURNING id, email, display_name, role`,
      [email, passwordHash, name],
    )

    const admin = result.rows[0]
    log(`? Super admin created:`)
    log(`   id:    ${admin.id}`)
    log(`   email: ${admin.email}`)
    log(`   name:  ${admin.display_name}`)
    log(`   role:  ${admin.role}`)

    // Log activity
    try {
      await pool.query(
        `INSERT INTO activity_log (action, action_type, operator_id, operator_name)
         VALUES ($1, $2, $3, $4)`,
        [`Initial admin seeded: ${name}`, 'system_seed', admin.id, name],
      )
    } catch {
      // activity_log may not exist yet — non-fatal
    }
  } finally {
    await pool.end()
  }
}

main().then(() => {
  log('Seed complete.')
  process.exit(0)
}).catch((err) => {
  console.error('[seed-admin] Fatal:', err.message || err)
  process.exit(1)
})
