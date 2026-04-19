/**
 * In-memory feature flag engine — supports percentage-based rollouts,
 * multi-attribute targeting rules (role, region, userId), A/B test variants
 * with weighted distribution, and kill switches. Refreshes from DB every 30s.
 *
 * - Reads flag definitions from the database on a 30-second interval
 * - Express middleware available to gate endpoints behind flags
 * - Bootstrap defaults provided for core AEGIS features
 * */

import crypto from 'crypto'
import { logger } from './logger.js'
import pool from '../models/db.js'

// Feature flag types
export interface FeatureFlag {
  key: string
  name: string
  description?: string
  enabled: boolean
  rolloutPercentage: number  // 0-100
  targetingRules: TargetingRule[]
  variants?: Variant[]
  defaultVariant?: string
  metadata: Record<string, unknown>
  createdAt: Date
  updatedAt: Date
  killSwitch: boolean  // Emergency disable
}

interface TargetingRule {
  attribute: string      // e.g., 'role', 'region', 'userId'
  operator: 'equals' | 'contains' | 'startsWith' | 'in' | 'greaterThan' | 'lessThan'
  value: string | string[] | number
  enabled: boolean
  percentage?: number    // Override rollout percentage for this rule
}

interface Variant {
  key: string
  name: string
  weight: number  // Relative weight for A/B testing
  payload?: Record<string, unknown>
}

interface EvaluationContext {
  userId?: string
  role?: string
  region?: string
  email?: string
  registrationDate?: Date
  ip?: string
  userAgent?: string
  customAttributes?: Record<string, string | number | boolean>
}

interface EvaluationResult {
  enabled: boolean
  variant?: string
  reason: 'default' | 'targeting' | 'rollout' | 'killswitch' | 'override'
  ruleId?: string
}

// In-memory flag cache (refreshed periodically)
const flagCache = new Map<string, FeatureFlag>()
let lastRefresh = 0
const REFRESH_INTERVAL_MS = 30_000  // 30 seconds

// Default flags (bootstrap before DB connection)
const DEFAULT_FLAGS: FeatureFlag[] = [
  {
    key: 'ai_auto_verification',
    name: 'AI Auto-Verification',
    description: 'Automatically verify low-risk reports using AI classification',
    enabled: true,
    rolloutPercentage: 100,
    targetingRules: [],
    metadata: { owner: 'ai-team', jira: 'AEGIS-1234' },
    createdAt: new Date(),
    updatedAt: new Date(),
    killSwitch: false,
  },
  {
    key: 'real_time_flood_prediction',
    name: 'Real-time Flood Prediction',
    description: 'Enable ML-based flood prediction from river sensors',
    enabled: true,
    rolloutPercentage: 100,
    targetingRules: [],
    metadata: { owner: 'ml-team' },
    createdAt: new Date(),
    updatedAt: new Date(),
    killSwitch: false,
  },
  {
    key: 'community_chat',
    name: 'Community Chat Features',
    description: 'Enable community help and resource sharing',
    enabled: true,
    rolloutPercentage: 100,
    targetingRules: [],
    metadata: {},
    createdAt: new Date(),
    updatedAt: new Date(),
    killSwitch: false,
  },
  {
    key: 'distress_beacon',
    name: 'Distress Beacon / SOS',
    description: 'Enable one-tap SOS distress signal for trapped persons',
    enabled: true,
    rolloutPercentage: 100,
    targetingRules: [],
    metadata: { sdg: '3,11' },
    createdAt: new Date(),
    updatedAt: new Date(),
    killSwitch: false,
  },
  {
    key: 'vision_analysis',
    name: 'AI Vision Analysis',
    description: 'Analyze uploaded images for hazard detection',
    enabled: true,
    rolloutPercentage: 100,
    targetingRules: [],
    variants: [
      { key: 'gemini', name: 'Gemini Vision', weight: 50 },
      { key: 'clip', name: 'CLIP Model', weight: 50 },
    ],
    defaultVariant: 'gemini',
    metadata: {},
    createdAt: new Date(),
    updatedAt: new Date(),
    killSwitch: false,
  },
  {
    key: 'experimental_llm_router',
    name: 'Experimental LLM Router',
    description: 'Use intelligent LLM routing based on query complexity',
    enabled: false,
    rolloutPercentage: 10,
    targetingRules: [
      { attribute: 'role', operator: 'in', value: ['admin', 'operator'], enabled: true },
    ],
    metadata: { owner: 'ai-team', riskLevel: 'medium' },
    createdAt: new Date(),
    updatedAt: new Date(),
    killSwitch: false,
  },
]

// Initialize default flags
for (const flag of DEFAULT_FLAGS) {
  flagCache.set(flag.key, flag)
}

/**
 * Deterministic hash for consistent user bucketing
 * Same user always gets same bucket (0-99) for each flag
 */
function getUserBucket(userId: string, flagKey: string): number {
  const hash = crypto.createHash('md5').update(`${userId}:${flagKey}`).digest('hex')
  return parseInt(hash.slice(0, 8), 16) % 100
}

/**
 * Select variant based on weighted random selection
 */
function selectVariant(variants: Variant[], userId: string, flagKey: string): string {
  if (variants.length === 0) return ''
  if (variants.length === 1) return variants[0].key

  const totalWeight = variants.reduce((sum, v) => sum + v.weight, 0)
  const bucket = getUserBucket(userId, `${flagKey}:variant`)
  const threshold = (bucket / 100) * totalWeight

  let cumulative = 0
  for (const variant of variants) {
    cumulative += variant.weight
    if (threshold < cumulative) {
      return variant.key
    }
  }

  return variants[variants.length - 1].key
}

/**
 * Evaluate a targeting rule against context
 */
function evaluateRule(rule: TargetingRule, context: EvaluationContext): boolean {
  if (!rule.enabled) return false

  const contextValue = (context as any)[rule.attribute] 
    ?? context.customAttributes?.[rule.attribute]

  if (contextValue === undefined) return false

  switch (rule.operator) {
    case 'equals':
      return String(contextValue) === String(rule.value)
    case 'contains':
      return String(contextValue).includes(String(rule.value))
    case 'startsWith':
      return String(contextValue).startsWith(String(rule.value))
    case 'in':
      return Array.isArray(rule.value) && rule.value.includes(String(contextValue))
    case 'greaterThan':
      return Number(contextValue) > Number(rule.value)
    case 'lessThan':
      return Number(contextValue) < Number(rule.value)
    default:
      return false
  }
}

/**
 * Evaluate a feature flag for a given context
 */
export function evaluateFlag(flagKey: string, context: EvaluationContext = {}): EvaluationResult {
  const flag = flagCache.get(flagKey)

  // Flag not found - default to disabled
  if (!flag) {
    return { enabled: false, reason: 'default' }
  }

  // Kill switch overrides everything
  if (flag.killSwitch) {
    return { enabled: false, reason: 'killswitch' }
  }

  // Flag globally disabled
  if (!flag.enabled) {
    return { enabled: false, reason: 'default' }
  }

  // Check targeting rules (first matching rule wins)
  for (const rule of flag.targetingRules) {
    if (evaluateRule(rule, context)) {
      // Rule has custom percentage
      if (rule.percentage !== undefined && context.userId) {
        const bucket = getUserBucket(context.userId, flagKey)
        if (bucket >= rule.percentage) {
          continue // Not in this rule's rollout
        }
      }

      const variant = flag.variants && context.userId
        ? selectVariant(flag.variants, context.userId, flagKey)
        : flag.defaultVariant

      return {
        enabled: true,
        variant,
        reason: 'targeting',
        ruleId: rule.attribute,
      }
    }
  }

  // Check rollout percentage
  if (flag.rolloutPercentage < 100) {
    if (!context.userId) {
      // No user context - use default rollout behavior (disabled for partial rollouts)
      return { enabled: false, reason: 'rollout' }
    }

    const bucket = getUserBucket(context.userId, flagKey)
    if (bucket >= flag.rolloutPercentage) {
      return { enabled: false, reason: 'rollout' }
    }
  }

  // Flag is enabled
  const variant = flag.variants && context.userId
    ? selectVariant(flag.variants, context.userId, flagKey)
    : flag.defaultVariant

  return {
    enabled: true,
    variant,
    reason: flag.rolloutPercentage < 100 ? 'rollout' : 'default',
  }
}

/**
 * Check if a feature is enabled (simple boolean check)
 */
export function isFeatureEnabled(flagKey: string, context?: EvaluationContext): boolean {
  return evaluateFlag(flagKey, context).enabled
}

/**
 * Get variant for A/B testing
 */
export function getVariant(flagKey: string, context: EvaluationContext): string | undefined {
  const result = evaluateFlag(flagKey, context)
  return result.enabled ? result.variant : undefined
}

/**
 * Update a feature flag (admin operation)
 */
export async function updateFlag(
  flagKey: string,
  updates: Partial<Omit<FeatureFlag, 'key' | 'createdAt'>>
): Promise<FeatureFlag | null> {
  const existing = flagCache.get(flagKey)
  if (!existing) return null

  const updated: FeatureFlag = {
    ...existing,
    ...updates,
    updatedAt: new Date(),
  }

  flagCache.set(flagKey, updated)

  // Persist to database (if table exists)
  try {
    await pool.query(`
      INSERT INTO feature_flags (key, name, description, enabled, rollout_percentage, 
        targeting_rules, variants, default_variant, metadata, kill_switch, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
      ON CONFLICT (key) DO UPDATE SET
        name = EXCLUDED.name,
        description = EXCLUDED.description,
        enabled = EXCLUDED.enabled,
        rollout_percentage = EXCLUDED.rollout_percentage,
        targeting_rules = EXCLUDED.targeting_rules,
        variants = EXCLUDED.variants,
        default_variant = EXCLUDED.default_variant,
        metadata = EXCLUDED.metadata,
        kill_switch = EXCLUDED.kill_switch,
        updated_at = NOW()
    `, [
      updated.key,
      updated.name,
      updated.description,
      updated.enabled,
      updated.rolloutPercentage,
      JSON.stringify(updated.targetingRules),
      JSON.stringify(updated.variants || []),
      updated.defaultVariant,
      JSON.stringify(updated.metadata),
      updated.killSwitch,
    ])
  } catch (err) {
    // Table might not exist - that's OK, we use in-memory
    logger.debug({ flagKey }, '[FeatureFlags] DB persist skipped (table may not exist)')
  }

  logger.info({ flagKey, updates }, '[FeatureFlags] Flag updated')
  return updated
}

/**
 * Activate kill switch for emergency disable
 */
export async function activateKillSwitch(flagKey: string): Promise<boolean> {
  const updated = await updateFlag(flagKey, { killSwitch: true })
  if (updated) {
    logger.warn({ flagKey }, '[FeatureFlags] KILL SWITCH ACTIVATED')
  }
  return !!updated
}

/**
 * Deactivate kill switch
 */
export async function deactivateKillSwitch(flagKey: string): Promise<boolean> {
  const updated = await updateFlag(flagKey, { killSwitch: false })
  if (updated) {
    logger.info({ flagKey }, '[FeatureFlags] Kill switch deactivated')
  }
  return !!updated
}

/**
 * Get all feature flags
 */
export function getAllFlags(): FeatureFlag[] {
  return Array.from(flagCache.values())
}

/**
 * Get a single flag configuration
 */
export function getFlag(flagKey: string): FeatureFlag | undefined {
  return flagCache.get(flagKey)
}

/**
 * Refresh flags from database
 */
async function refreshFlags(): Promise<void> {
  try {
    const result = await pool.query(`
      SELECT key, name, description, enabled, rollout_percentage, 
             targeting_rules, variants, default_variant, metadata, 
             kill_switch, created_at, updated_at
      FROM feature_flags
    `)

    for (const row of result.rows) {
      const flag: FeatureFlag = {
        key: row.key,
        name: row.name,
        description: row.description,
        enabled: row.enabled,
        rolloutPercentage: row.rollout_percentage,
        targetingRules: row.targeting_rules || [],
        variants: row.variants,
        defaultVariant: row.default_variant,
        metadata: row.metadata || {},
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        killSwitch: row.kill_switch || false,
      }
      flagCache.set(flag.key, flag)
    }

    lastRefresh = Date.now()
  } catch {
    // Table might not exist - use defaults
  }
}

// Refresh flags periodically
setInterval(refreshFlags, REFRESH_INTERVAL_MS)

// Initial refresh
refreshFlags().catch(() => {})

/**
 * Initialize feature flags - refresh from database
 */
export async function initFlags(): Promise<void> {
  await refreshFlags()
  console.log('[FeatureFlags] Initialized with', flagCache.size, 'flags')
}

/**
 * Feature flag middleware - evaluates flags for request context
 */
export function featureFlagMiddleware(
  req: any,
  _res: any,
  next: () => void
): void {
  const context: EvaluationContext = {
    userId: req.user?.id,
    role: req.user?.role,
    region: req.headers['x-region'] as string,
    ip: req.ip,
    userAgent: req.headers['user-agent'] as string,
  }

  req.featureFlags = {
    isEnabled: (key: string) => isFeatureEnabled(key, context),
    getVariant: (key: string) => getVariant(key, context),
    evaluate: (key: string) => evaluateFlag(key, context),
  }

  next()
}

/**
 * Get feature flag statistics
 */
export function getFlagStats(): {
  totalFlags: number
  enabledFlags: number
  disabledFlags: number
  killSwitchesActive: number
  lastRefresh: Date | null
} {
  const flags = Array.from(flagCache.values())
  return {
    totalFlags: flags.length,
    enabledFlags: flags.filter(f => f.enabled && !f.killSwitch).length,
    disabledFlags: flags.filter(f => !f.enabled || f.killSwitch).length,
    killSwitchesActive: flags.filter(f => f.killSwitch).length,
    lastRefresh: lastRefresh ? new Date(lastRefresh) : null,
  }
}

export default {
  initFlags,
  evaluateFlag,
  isFeatureEnabled,
  getVariant,
  updateFlag,
  activateKillSwitch,
  deactivateKillSwitch,
  getAllFlags,
  getFlag,
  featureFlagMiddleware,
  getFlagStats,
}
