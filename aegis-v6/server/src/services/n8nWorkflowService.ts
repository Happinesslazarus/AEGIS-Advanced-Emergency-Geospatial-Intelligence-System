/**
 * File: n8nWorkflowService.ts
 *
 * n8n workflow registrar — loads JSON workflow definitions from the
 * n8n-workflows/ directory and registers (or updates) them in a connected
 * n8n instance via its REST API. Tracks registration state to avoid duplicates.
 *
 * How it connects:
 * - Called by n8nHealthCheck when the n8n server comes online
 * - Reads workflow JSON files from disk
 * - Pushes workflows to n8n via its REST API
 *
 * Simple explanation:
 * Automatically sets up automation workflows in n8n when the server starts.
 */

import { readFileSync, readdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { logger } from './logger.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const WORKFLOW_DIR = join(__dirname, '..', 'n8n-workflows')

interface WorkflowDef {
  name: string
  nodes: any[]
  connections: Record<string, any>
  settings?: Record<string, any>
  tags?: Array<{ name: string }>
  active?: boolean
}

// Module-level once-guard: registration only runs once per process lifetime.
// resetRegistration() sets this back to false when n8n goes down, so the
// workflows get re-registered automatically when n8n recovers.
let registrationDone = false

function n8nHeaders(): Record<string, string> {
  const apiKey = process.env.N8N_API_KEY
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  }
  if (apiKey) headers['X-N8N-API-KEY'] = apiKey
  return headers
}

/**
 * Load all workflow JSON files from the n8n-workflows directory.
 */
function loadWorkflowDefinitions(): WorkflowDef[] {
  try {
    const files = readdirSync(WORKFLOW_DIR).filter(f => f.endsWith('.json'))
    return files.map(f => {
      const content = readFileSync(join(WORKFLOW_DIR, f), 'utf-8')
      return JSON.parse(content) as WorkflowDef
    })
  } catch (err: any) {
    logger.warn({ err }, '[n8n-workflows] Cannot read workflow directory')
    return []
  }
}

/**
 * Fetch existing workflows from n8n.
 */
async function getExistingWorkflows(baseUrl: string): Promise<Map<string, string>> {
  const map = new Map<string, string>() // name ? id
  try {
    const res = await fetch(`${baseUrl}/api/v1/workflows?limit=200`, {
      headers: n8nHeaders(),
      signal: AbortSignal.timeout(10000),
    })
    if (!res.ok) return map
    const body = await res.json()
    const workflows = body.data || body || []
    if (Array.isArray(workflows)) {
      for (const wf of workflows) {
        if (wf.name) map.set(wf.name, String(wf.id))
      }
    }
  } catch (err: any) {
    logger.warn({ err }, '[n8n-workflows] Error fetching existing workflows')
  }
  return map
}

/**
 * Create a workflow in n8n.
 */
async function createWorkflow(baseUrl: string, def: WorkflowDef): Promise<string | null> {
  try {
    // Strip read-only and computed fields that the n8n POST endpoint rejects.
    // These fields are valid in exported JSON but must be absent on create.
    const {
      active: _active,
      tags: _tags,
      id: _id,
      createdAt: _createdAt,
      updatedAt: _updatedAt,
      versionId: _versionId,
      ...rest
    } = def as any
    const payload = {
      ...rest,
      settings: rest.settings ?? { executionOrder: 'v1' },
    }
    const res = await fetch(`${baseUrl}/api/v1/workflows`, {
      method: 'POST',
      headers: n8nHeaders(),
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000),
    })
    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      logger.warn({ name: def.name, status: res.status, error: errText }, '[n8n-workflows] Failed to create workflow')
      return null
    }
    const data = await res.json()
    return String(data.id || '')
  } catch (err: any) {
    logger.warn({ err, name: def.name }, '[n8n-workflows] Error creating workflow')
    return null
  }
}

/**
 * Activate a workflow in n8n.
 */
async function activateWorkflow(baseUrl: string, id: string): Promise<void> {
  try {
    await fetch(`${baseUrl}/api/v1/workflows/${id}/activate`, {
      method: 'POST',
      headers: n8nHeaders(),
      signal: AbortSignal.timeout(10000),
    })
  } catch { /* activation is optional */ }
}

/**
 * Register all AEGIS workflows into n8n (skipping existing ones).
 * Called by n8nHealthCheck when n8n transitions to 'connected'.
 */
export async function registerWorkflows(): Promise<{
  registered: number
  skipped: number
  failed: number
}> {
  const baseUrl = process.env.N8N_BASE_URL
  if (!baseUrl) return { registered: 0, skipped: 0, failed: 0 }

  const definitions = loadWorkflowDefinitions()
  if (definitions.length === 0) {
    logger.info('[n8n-workflows] No workflow definitions found — skipping registration')
    return { registered: 0, skipped: 0, failed: 0 }
  }

  const existing = await getExistingWorkflows(baseUrl)
  let registered = 0
  let skipped = 0
  let failed = 0

  for (const def of definitions) {
    if (existing.has(def.name)) {
      logger.info({ name: def.name, id: existing.get(def.name) }, '[n8n-workflows] Workflow already exists — skipping')
      skipped++
      continue
    }

    const id = await createWorkflow(baseUrl, def)
    if (id) {
      logger.info({ name: def.name, id }, '[n8n-workflows] Created workflow')
      if (def.active) {
        await activateWorkflow(baseUrl, id)
      }
      registered++
    } else {
      failed++
    }
  }

  logger.info({ registered, skipped, failed }, '[n8n-workflows] Registration complete')
  return { registered, skipped, failed }
}

/**
 * Try to register workflows (called once when n8n becomes healthy).
 * Safe to call multiple times — only runs once unless reset.
 */
export async function tryRegisterWorkflows(): Promise<void> {
  if (registrationDone) return
  registrationDone = true

  try {
    await registerWorkflows()
  } catch (err: any) {
    logger.error({ err }, '[n8n-workflows] Registration error')
    registrationDone = false // allow retry on next health check
  }
}

/**
 * Reset registration state (called when n8n goes down, so we re-register on recovery).
 */
export function resetRegistration(): void {
  registrationDone = false
}

/**
 * Get list of available workflow definitions (for the dashboard).
 */
export function getWorkflowDefinitions(): Array<{ name: string; nodeCount: number; active: boolean }> {
  return loadWorkflowDefinitions().map(def => ({
    name: def.name,
    nodeCount: def.nodes?.length || 0,
    active: def.active ?? false,
  }))
}
