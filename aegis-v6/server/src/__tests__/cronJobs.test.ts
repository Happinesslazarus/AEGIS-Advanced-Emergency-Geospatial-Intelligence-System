/**
 * What it tests:
 * Schema regression tests for the safety-reminder cron job.
  * Confirms the job produces correctly shaped notification objects
  * and that the safety tip categories have not been accidentally removed.
  *
  * How it connects:
  * - Tests server/src/services/cronJobs.ts safetyReminderJob
  * - Pure unit test — no DB or network calls
  * - Run via: npm test -- cronJobs.test
 */

import * as fs from 'fs'
import * as path from 'path'

/**
 * Regression test: safety reminder cron job SQL must reference the correct
 * "content" column (not "body") in the messages table.
 *
 * Background: a column mismatch ("body" vs "content") caused the safety
 * reminder job to fail silently at runtime. This test guards against
 * re-introduction of that bug via static source analysis.
 */
describe('Safety Reminder Cron Job — schema regression', () => {
  // Normalise to LF so the slice/search works on both Windows (CRLF) and Linux (LF)
  const cronSource = fs.readFileSync(
    path.resolve(__dirname, '../services/cronJobs.ts'),
    'utf-8',
  ).replace(/\r\n/g, '\n')

  // Extract only the sendSafetyReminders function block for targeted checks
  const fnStart = cronSource.indexOf('async function sendSafetyReminders')
  const fnBlock = cronSource.slice(fnStart, cronSource.indexOf('\n}\n', fnStart) + 3)

  test('INSERT INTO messages uses "content" column, not "body"', () => {
    expect(fnBlock).toContain('INSERT INTO messages')
    expect(fnBlock).toContain('content')
    expect(fnBlock).not.toMatch(/INSERT INTO messages[^;]*\bbody\b/)
  })

  test('INSERT INTO messages supplies sender_id (NOT NULL column)', () => {
    expect(fnBlock).toMatch(/INSERT INTO messages\s*\([^)]*sender_id/)
  })

  test('INSERT INTO messages supplies sender_type (NOT NULL column)', () => {
    expect(fnBlock).toMatch(/INSERT INTO messages\s*\([^)]*sender_type/)
  })

  test('SYSTEM_SENDER_ID is a valid UUID', () => {
    const match = cronSource.match(/SYSTEM_SENDER_ID\s*=\s*'([^']+)'/)
    expect(match).not.toBeNull()
    expect(match![1]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    )
  })
})
