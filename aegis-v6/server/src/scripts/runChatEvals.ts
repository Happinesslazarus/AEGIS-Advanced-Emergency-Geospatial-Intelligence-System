import 'dotenv/config'

import fs from 'fs'
import path from 'path'
import { performance } from 'perf_hooks'
import { randomUUID } from 'crypto'
import jwt from 'jsonwebtoken'

import pool from '../models/db.js'
import { DEFAULT_LOCAL_PROVIDER, chatEvalScenarios, type ChatEvalCheck, type ChatEvalScenario, type ChatEvalAuthMode } from '../evals/chatEvalScenarios.js'

interface ChatApiResponse {
  sessionId: string
  reply: string
  model: string
  tokensUsed: number
  safetyFlags?: string[]
  confidence?: number
  qualityScore?: { overall?: number }
  isPersonalized?: boolean
  emergency?: {
    isEmergency?: boolean
    type?: string
  }
}

interface TurnResult {
  turn: number
  message: string
  latencyMs: number
  status: number
  model?: string
  replyPreview?: string
  error?: string
}

interface CheckResult {
  description: string
  passed: boolean
  detail: string
}

interface ScenarioResult {
  id: string
  title: string
  auth: ChatEvalAuthMode
  passed: boolean
  passCount: number
  checkCount: number
  sessionId: string
  providerRequested?: string
  finalModel?: string
  finalReply?: string
  finalLatencyMs?: number
  checks: CheckResult[]
  turns: TurnResult[]
}

const BASE_URL = readArg('--base-url') || process.env.CHAT_EVAL_BASE_URL || 'http://localhost:3001'
const PROVIDER = readArg('--provider') || process.env.CHAT_EVAL_PROVIDER || DEFAULT_LOCAL_PROVIDER
const REPORT_DIR = path.join(process.cwd(), 'reports', 'chat-evals')

const EVAL_CITIZEN = {
  id: '10000000-0000-0000-0000-000000000001',
  email: 'eval-citizen@aegis.local',
  passwordHash: 'eval-password-hash',
  displayName: 'Eval Citizen',
}

const EVAL_OPERATOR = {
  id: '20000000-0000-0000-0000-000000000001',
  email: 'eval-operator@aegis.local',
  passwordHash: 'eval-password-hash',
  displayName: 'Eval Operator',
  department: 'Emergency Response',
}

async function main(): Promise<void> {
  if (!process.env.JWT_SECRET) {
    throw new Error('JWT_SECRET must be set before running chat evals.')
  }

  await ensureEvalUsers()

  const results: ScenarioResult[] = []
  for (const scenario of chatEvalScenarios) {
    results.push(await runScenario(scenario))
  }

  const passed = results.filter(result => result.passed).length
  const report = {
    createdAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    providerRequested: PROVIDER,
    summary: {
      scenarioCount: results.length,
      passed,
      failed: results.length - passed,
      passRate: Number(((passed / results.length) * 100).toFixed(1)),
    },
    results,
  }

  fs.mkdirSync(REPORT_DIR, { recursive: true })
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const reportPath = path.join(REPORT_DIR, `chat-evals-${timestamp}.json`)
  const latestPath = path.join(REPORT_DIR, 'latest.json')
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2))
  fs.writeFileSync(latestPath, JSON.stringify(report, null, 2))

  printSummary(report.summary, results, reportPath)
  process.exit(report.summary.failed > 0 ? 1 : 0)
}

async function ensureEvalUsers(): Promise<void> {
  await pool.query(
    `INSERT INTO citizens (id, email, password_hash, display_name, email_verified, is_active)
     VALUES ($1, $2, $3, $4, true, true)
     ON CONFLICT (id) DO UPDATE
     SET email = EXCLUDED.email,
         password_hash = EXCLUDED.password_hash,
         display_name = EXCLUDED.display_name,
         email_verified = true,
         is_active = true`,
    [EVAL_CITIZEN.id, EVAL_CITIZEN.email, EVAL_CITIZEN.passwordHash, EVAL_CITIZEN.displayName],
  )

  await pool.query(
    `INSERT INTO citizen_preferences (citizen_id)
     VALUES ($1)
     ON CONFLICT (citizen_id) DO NOTHING`,
    [EVAL_CITIZEN.id],
  )

  await pool.query(
    `INSERT INTO operators (id, email, password_hash, display_name, role, department, is_active)
     VALUES ($1, $2, $3, $4, 'operator', $5, true)
     ON CONFLICT (id) DO UPDATE
     SET email = EXCLUDED.email,
         password_hash = EXCLUDED.password_hash,
         display_name = EXCLUDED.display_name,
         department = EXCLUDED.department,
         is_active = true`,
    [EVAL_OPERATOR.id, EVAL_OPERATOR.email, EVAL_OPERATOR.passwordHash, EVAL_OPERATOR.displayName, EVAL_OPERATOR.department],
  )
}

async function runScenario(scenario: ChatEvalScenario): Promise<ScenarioResult> {
  const sessionId = randomUUID()
  const token = createToken(scenario.auth)
  const turns: TurnResult[] = []
  let lastResponse: ChatApiResponse | null = null
  let lastLatencyMs = 0

  for (let index = 0; index < scenario.turns.length; index++) {
    const turn = scenario.turns[index]
    const started = performance.now()
    const response = await fetch(`${BASE_URL}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        message: turn.message,
        sessionId,
        preferredProvider: PROVIDER,
      }),
    })

    lastLatencyMs = Math.round(performance.now() - started)
    if (!response.ok) {
      const errorText = await response.text()
      turns.push({
        turn: index + 1,
        message: turn.message,
        latencyMs: lastLatencyMs,
        status: response.status,
        error: errorText.slice(0, 500),
      })

      return finalizeScenarioResult(scenario, sessionId, turns, [], lastResponse, lastLatencyMs)
    }

    const payload = await response.json() as ChatApiResponse
    lastResponse = payload
    turns.push({
      turn: index + 1,
      message: turn.message,
      latencyMs: lastLatencyMs,
      status: response.status,
      model: payload.model,
      replyPreview: payload.reply.slice(0, 200),
    })
  }

  const checks = evaluateScenarioChecks(scenario.checks, lastResponse)
  return finalizeScenarioResult(scenario, sessionId, turns, checks, lastResponse, lastLatencyMs)
}

function finalizeScenarioResult(
  scenario: ChatEvalScenario,
  sessionId: string,
  turns: TurnResult[],
  checks: CheckResult[],
  lastResponse: ChatApiResponse | null,
  lastLatencyMs: number,
): ScenarioResult {
  const passCount = checks.filter(check => check.passed).length
  const checkCount = checks.length
  const hardFailure = turns.some(turn => turn.status >= 400)

  return {
    id: scenario.id,
    title: scenario.title,
    auth: scenario.auth,
    passed: !hardFailure && passCount === checkCount,
    passCount,
    checkCount,
    sessionId,
    providerRequested: PROVIDER,
    finalModel: lastResponse?.model,
    finalReply: lastResponse?.reply,
    finalLatencyMs: lastLatencyMs,
    checks,
    turns,
  }
}

function evaluateScenarioChecks(checks: ChatEvalCheck[], response: ChatApiResponse | null): CheckResult[] {
  return checks.map((check) => evaluateCheck(check, response))
}

function evaluateCheck(check: ChatEvalCheck, response: ChatApiResponse | null): CheckResult {
  if (!response) {
    return {
      description: check.description,
      passed: false,
      detail: 'No response available to score.',
    }
  }

  const reply = response.reply || ''
  const replyLower = reply.toLowerCase()

  switch (check.type) {
    case 'includesAny': {
      const match = check.values.find(value => replyLower.includes(value.toLowerCase()))
      return {
        description: check.description,
        passed: Boolean(match),
        detail: match ? `Matched "${match}".` : `Expected one of: ${check.values.join(', ')}`,
      }
    }
    case 'excludesAll': {
      const found = check.values.find(value => replyLower.includes(value.toLowerCase()))
      return {
        description: check.description,
        passed: !found,
        detail: found ? `Unexpectedly found "${found}".` : 'No excluded phrases found.',
      }
    }
    case 'fieldEquals': {
      const actual = getByPath(response, check.path)
      return {
        description: check.description,
        passed: actual === check.expected,
        detail: `Expected ${JSON.stringify(check.expected)}, got ${JSON.stringify(actual)}.`,
      }
    }
    case 'minLength': {
      return {
        description: check.description,
        passed: reply.trim().length >= check.min,
        detail: `Reply length ${reply.trim().length}, minimum ${check.min}.`,
      }
    }
  }
}

function getByPath(value: unknown, pathValue: string): unknown {
  return pathValue.split('.').reduce<unknown>((current, key) => {
    if (current && typeof current === 'object' && key in current) {
      return (current as Record<string, unknown>)[key]
    }
    return undefined
  }, value)
}

function createToken(auth: ChatEvalAuthMode): string | undefined {
  if (auth === 'anonymous') return undefined

  const payload = auth === 'citizen'
    ? { id: EVAL_CITIZEN.id, email: EVAL_CITIZEN.email, role: 'citizen', displayName: EVAL_CITIZEN.displayName }
    : { id: EVAL_OPERATOR.id, email: EVAL_OPERATOR.email, role: 'operator', displayName: EVAL_OPERATOR.displayName }

  return jwt.sign(payload, process.env.JWT_SECRET!, { expiresIn: '1h' })
}

function printSummary(
  summary: { scenarioCount: number; passed: number; failed: number; passRate: number },
  results: ScenarioResult[],
  reportPath: string,
): void {
  console.log(`Chat evals complete: ${summary.passed}/${summary.scenarioCount} passed (${summary.passRate}%).`)
  for (const result of results) {
    const status = result.passed ? 'PASS' : 'FAIL'
    const model = result.finalModel || 'n/a'
    const latency = typeof result.finalLatencyMs === 'number' ? `${result.finalLatencyMs}ms` : 'n/a'
    console.log(`- [${status}] ${result.id} :: ${model} :: ${latency}`)
    for (const check of result.checks.filter(item => !item.passed)) {
      console.log(`    * ${check.description} — ${check.detail}`)
    }
    for (const turn of result.turns.filter(item => item.error)) {
      console.log(`    * turn ${turn.turn} error — ${turn.error}`)
    }
  }
  console.log(`Report written to ${reportPath}`)
}

function readArg(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  if (index === -1) return undefined
  return process.argv[index + 1]
}

void main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
