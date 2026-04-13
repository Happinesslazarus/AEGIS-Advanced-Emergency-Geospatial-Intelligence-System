/**
 * File: apiGateway.ts
 *
 * API gateway layer — manages API key registration/validation with per-key
 * rate limits and daily quotas, API versioning with deprecation sunset
 * tracking, standard JSON response envelopes, and HMAC webhook verification.
 *
 * How it connects:
 * - Express middleware applied before route handlers
 * - Works alongside JWT auth for API key-based access
 * - Tracks usage and deprecation metrics via Prometheus
 *
 * Simple explanation:
 * Validates, transforms, and meters all incoming API requests.
 */

import crypto from 'crypto'
import { Request, Response, NextFunction } from 'express'
import client from 'prom-client'
import { logger } from './logger.js'

// Prometheus metrics
const apiKeyUsage = new client.Counter({
  name: 'aegis_api_key_requests_total',
  help: 'API requests by key',
  labelNames: ['key_id', 'endpoint'] as const,
})

const apiVersionUsage = new client.Counter({
  name: 'aegis_api_version_requests_total',
  help: 'API requests by version',
  labelNames: ['version'] as const,
})

const deprecationWarnings = new client.Counter({
  name: 'aegis_api_deprecation_warnings_total',
  help: 'Deprecation warnings sent',
  labelNames: ['endpoint', 'version'] as const,
})

const quotaExceeded = new client.Counter({
  name: 'aegis_api_quota_exceeded_total',
  help: 'Quota exceeded events',
  labelNames: ['key_id'] as const,
})

// API Key management
interface ApiKey {
  id: string
  key: string
  name: string
  owner: string
  permissions: string[]
  rateLimit: number        // requests per minute
  dailyQuota: number       // requests per day
  enabled: boolean
  createdAt: Date
  expiresAt?: Date
  lastUsed?: Date
  metadata?: Record<string, any>
}

// Usage tracking
interface UsageRecord {
  keyId: string
  minuteCount: number
  dailyCount: number
  lastMinuteReset: number
  lastDailyReset: number
}

// Endpoint deprecation
interface DeprecationInfo {
  endpoint: string
  version: string
  deprecatedAt: Date
  sunsetAt: Date
  replacementEndpoint?: string
  message: string
}

// Storage
const apiKeys = new Map<string, ApiKey>()
const usageTracking = new Map<string, UsageRecord>()
const deprecations = new Map<string, DeprecationInfo>()

// Standard response envelope
interface ApiResponse<T = any> {
  success: boolean
  data?: T
  error?: {
    code: string
    message: string
    details?: any
  }
  meta?: {
    requestId: string
    version: string
    timestamp: string
    deprecation?: {
      message: string
      sunsetAt: string
      replacement?: string
    }
  }
}

/**
 * Register API key
 */
export function registerApiKey(config: Omit<ApiKey, 'key' | 'createdAt'>): ApiKey {
  const key = generateApiKey()
  
  const apiKey: ApiKey = {
    ...config,
    key,
    createdAt: new Date(),
  }
  
  apiKeys.set(key, apiKey)
  
  logger.info({
    keyId: apiKey.id,
    name: apiKey.name,
    owner: apiKey.owner,
  }, '[ApiGateway] API key registered')
  
  return apiKey
}

/**
 * Generate secure API key
 */
function generateApiKey(): string {
  const prefix = 'aegis'
  const random = crypto.randomBytes(24).toString('base64url')
  return `${prefix}_${random}`
}

/**
 * Validate API key and check quotas
 */
export function validateApiKey(key: string): {
  valid: boolean
  apiKey?: ApiKey
  error?: string
} {
  const apiKey = apiKeys.get(key)
  
  if (!apiKey) {
    return { valid: false, error: 'Invalid API key' }
  }
  
  if (!apiKey.enabled) {
    return { valid: false, error: 'API key is disabled' }
  }
  
  if (apiKey.expiresAt && apiKey.expiresAt < new Date()) {
    return { valid: false, error: 'API key has expired' }
  }
  
  // Check rate limit and quota
  const usage = getOrCreateUsage(apiKey.id)
  const now = Date.now()
  
  // Reset minute counter if needed
  if (now - usage.lastMinuteReset > 60_000) {
    usage.minuteCount = 0
    usage.lastMinuteReset = now
  }
  
  // Reset daily counter if needed
  const dayMs = 24 * 60 * 60 * 1000
  if (now - usage.lastDailyReset > dayMs) {
    usage.dailyCount = 0
    usage.lastDailyReset = now
  }
  
  if (usage.minuteCount >= apiKey.rateLimit) {
    quotaExceeded.labels(apiKey.id).inc()
    return { valid: false, error: 'Rate limit exceeded. Try again in a minute.' }
  }
  
  if (usage.dailyCount >= apiKey.dailyQuota) {
    quotaExceeded.labels(apiKey.id).inc()
    return { valid: false, error: 'Daily quota exceeded. Resets at midnight UTC.' }
  }
  
  // Update usage
  usage.minuteCount++
  usage.dailyCount++
  apiKey.lastUsed = new Date()
  
  return { valid: true, apiKey }
}

function getOrCreateUsage(keyId: string): UsageRecord {
  if (!usageTracking.has(keyId)) {
    usageTracking.set(keyId, {
      keyId,
      minuteCount: 0,
      dailyCount: 0,
      lastMinuteReset: Date.now(),
      lastDailyReset: Date.now(),
    })
  }
  return usageTracking.get(keyId)!
}

/**
 * API key authentication middleware
 */
export function apiKeyMiddleware(options: { required?: boolean } = {}) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const authHeader = req.headers.authorization
    const apiKeyHeader = req.headers['x-api-key'] as string
    
    let key: string | undefined
    
    if (authHeader?.startsWith('Bearer aegis_')) {
      key = authHeader.replace('Bearer ', '')
    } else if (apiKeyHeader?.startsWith('aegis_')) {
      key = apiKeyHeader
    }
    
    if (!key) {
      if (options.required) {
        res.status(401).json(createErrorResponse('API_KEY_MISSING', 'API key is required', req))
        return
      }
      next()
      return
    }
    
    const validation = validateApiKey(key)
    
    if (!validation.valid) {
      res.status(403).json(createErrorResponse('API_KEY_INVALID', validation.error!, req))
      return
    }
    
    // Attach API key info to request
    ;(req as any).apiKey = validation.apiKey
    apiKeyUsage.labels(validation.apiKey!.id, req.path).inc()
    
    next()
  }
}

/**
 * Register endpoint deprecation
 */
export function deprecateEndpoint(config: DeprecationInfo): void {
  deprecations.set(`${config.version}:${config.endpoint}`, config)
  
  logger.warn({
    endpoint: config.endpoint,
    version: config.version,
    sunsetAt: config.sunsetAt,
  }, '[ApiGateway] Endpoint deprecated')
}

/**
 * API versioning middleware
 */
export function versioningMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  // Extract version from URL, header, or query param
  let version = 'v1' // default
  
  // URL path versioning: /api/v2/reports
  const pathMatch = req.path.match(/\/api\/(v\d+)\//)
  if (pathMatch) {
    version = pathMatch[1]
  }
  
  // Header versioning: X-API-Version: 2
  const headerVersion = req.headers['x-api-version'] as string
  if (headerVersion) {
    version = `v${headerVersion}`
  }
  
  // Query param: ?api_version=2
  if (req.query.api_version) {
    version = `v${req.query.api_version}`
  }
  
  ;(req as any).apiVersion = version
  apiVersionUsage.labels(version).inc()
  
  // Check for deprecation
  const deprecation = deprecations.get(`${version}:${req.path}`) ||
                      deprecations.get(`${version}:*`)
  
  if (deprecation) {
    deprecationWarnings.labels(req.path, version).inc()
    
    res.setHeader('Deprecation', deprecation.deprecatedAt.toISOString())
    res.setHeader('Sunset', deprecation.sunsetAt.toISOString())
    
    if (deprecation.replacementEndpoint) {
      res.setHeader('Link', `<${deprecation.replacementEndpoint}>; rel="successor-version"`)
    }
    
    // Store deprecation info for response envelope
    ;(req as any).deprecationInfo = deprecation
  }
  
  // Add version to response
  res.setHeader('X-API-Version', version)
  
  next()
}

/**
 * Response envelope middleware — wraps all responses in standard format
 */
export function responseEnvelopeMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const originalJson = res.json.bind(res)
  
  res.json = function(data: any): Response {
    // Skip if already wrapped
    if (data && typeof data === 'object' && 'success' in data) {
      return originalJson(data)
    }
    
    const requestId = (req as any).requestId || 'unknown'
    const version = (req as any).apiVersion || 'v1'
    const deprecation = (req as any).deprecationInfo as DeprecationInfo | undefined
    
    const envelope: ApiResponse = {
      success: res.statusCode >= 200 && res.statusCode < 300,
      data,
      meta: {
        requestId,
        version,
        timestamp: new Date().toISOString(),
      },
    }
    
    if (deprecation) {
      envelope.meta!.deprecation = {
        message: deprecation.message,
        sunsetAt: deprecation.sunsetAt.toISOString(),
        replacement: deprecation.replacementEndpoint,
      }
    }
    
    return originalJson(envelope)
  }
  
  next()
}

/**
 * Create standard error response
 */
function createErrorResponse(
  code: string,
  message: string,
  req: Request,
  details?: any
): ApiResponse {
  const requestId = (req as any).requestId || 'unknown'
  const version = (req as any).apiVersion || 'v1'
  
  return {
    success: false,
    error: {
      code,
      message,
      details,
    },
    meta: {
      requestId,
      version,
      timestamp: new Date().toISOString(),
    },
  }
}

/**
 * Verify webhook signature (HMAC-SHA256)
 */
export function verifyWebhookSignature(
  payload: string | Buffer,
  signature: string,
  secret: string
): boolean {
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex')
  
  // Constant-time comparison
  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    )
  } catch {
    return false
  }
}

/**
 * Webhook verification middleware
 */
export function webhookVerificationMiddleware(secretEnvVar: string) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const signature = req.headers['x-webhook-signature'] as string ||
                      req.headers['x-hub-signature-256'] as string ||
                      req.headers['x-signature'] as string
    
    if (!signature) {
      res.status(401).json(createErrorResponse('WEBHOOK_SIGNATURE_MISSING', 'Webhook signature required', req))
      return
    }
    
    const secret = process.env[secretEnvVar]
    if (!secret) {
      logger.error({ secretEnvVar }, '[ApiGateway] Webhook secret not configured')
      res.status(500).json(createErrorResponse('WEBHOOK_CONFIG_ERROR', 'Webhook verification not configured', req))
      return
    }
    
    // Get raw body for verification
    const rawBody = (req as any).rawBody || JSON.stringify(req.body)
    
    // Handle different signature formats
    const signatureValue = signature.startsWith('sha256=') 
      ? signature.replace('sha256=', '')
      : signature
    
    if (!verifyWebhookSignature(rawBody, signatureValue, secret)) {
      res.status(403).json(createErrorResponse('WEBHOOK_SIGNATURE_INVALID', 'Invalid webhook signature', req))
      return
    }
    
    next()
  }
}

/**
 * Get API key usage statistics
 */
export function getApiKeyUsage(keyId: string): UsageRecord | undefined {
  return usageTracking.get(keyId)
}

/**
 * Get all registered deprecations
 */
export function getDeprecations(): DeprecationInfo[] {
  return Array.from(deprecations.values())
}

/**
 * Revoke API key
 */
export function revokeApiKey(key: string): boolean {
  const apiKey = apiKeys.get(key)
  if (!apiKey) return false
  
  apiKey.enabled = false
  
  logger.warn({
    keyId: apiKey.id,
    name: apiKey.name,
  }, '[ApiGateway] API key revoked')
  
  return true
}

/**
 * Get gateway statistics
 */
export function getGatewayStats(): {
  activeKeys: number
  totalKeys: number
  deprecatedEndpoints: number
} {
  const enabledKeys = Array.from(apiKeys.values()).filter(k => k.enabled).length
  
  return {
    activeKeys: enabledKeys,
    totalKeys: apiKeys.size,
    deprecatedEndpoints: deprecations.size,
  }
}

export default {
  registerApiKey,
  validateApiKey,
  apiKeyMiddleware,
  deprecateEndpoint,
  versioningMiddleware,
  responseEnvelopeMiddleware,
  verifyWebhookSignature,
  webhookVerificationMiddleware,
  getApiKeyUsage,
  getDeprecations,
  revokeApiKey,
  getGatewayStats,
}
