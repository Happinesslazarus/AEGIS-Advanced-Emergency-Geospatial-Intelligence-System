/**
 * File: internalAuth.ts
 *
 * What this file does:
 * Authenticates internal service-to-service requests and n8n webhook calls.
 * Supports three authentication methods: API key header, HMAC webhook
 * signatures, and internal IP bypass (development only).
 *
 * How it connects:
 * - Used by internalRoutes.ts for inter-service communication
 * - Used by incident module routes for n8n workflow integration
 * - Works alongside auth.ts (which handles user-facing authentication)
 * - n8n workflows sign requests with HMAC-SHA256 via X-N8N-Signature header
 *
 * Key exports:
 * - internalApiKeyAuth — validates X-Internal-API-Key header
 * - n8nWebhookAuth — validates HMAC signature from n8n workflows
 * - internalAuth — combined: accepts API key OR webhook signature
 * - adminOnly / operatorOnly — role-based gates for internal routes
 *
 * Simple explanation:
 * Makes sure only trusted internal services (not random users) can call
 * internal API endpoints. Uses secret keys and cryptographic signatures.
 */

import { Request, Response, NextFunction } from 'express'
import crypto from 'crypto'
import { AuthRequest, authMiddleware } from './auth.js'
import { logger } from '../services/logger.js'

// Environment configuration with strict production enforcement
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || (() => {
  if (process.env.NODE_ENV === 'production') {
    logger.fatal('[FATAL] INTERNAL_API_KEY is required in production')
    process.exit(1)
  }
  // Development fallback - logged for visibility
  const devKey = 'dev-internal-key-' + crypto.randomBytes(16).toString('hex')
  logger.warn('[SECURITY] INTERNAL_API_KEY not set - using dev key')
  return devKey
})()

const N8N_WEBHOOK_SECRET = process.env.N8N_WEBHOOK_SECRET || (() => {
  if (process.env.NODE_ENV === 'production') {
    logger.fatal('[FATAL] N8N_WEBHOOK_SECRET is required in production')
    process.exit(1)
  }
  const devSecret = 'dev-n8n-secret-' + crypto.randomBytes(16).toString('hex')
  logger.warn('[SECURITY] N8N_WEBHOOK_SECRET not set - using dev secret')
  return devSecret
})()

// Allowed internal IP ranges (localhost, Docker networks)
const INTERNAL_IP_RANGES = [
  '127.0.0.1',
  '::1',
  '::ffff:127.0.0.1',
  /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/,      // 10.x.x.x
  /^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/, // 172.16-31.x.x
  /^192\.168\.\d{1,3}\.\d{1,3}$/,         // 192.168.x.x
  /^::ffff:10\./,
  /^::ffff:172\.(1[6-9]|2\d|3[01])\./,
  /^::ffff:192\.168\./,
]

/**
 * Check if IP is from internal network
 */
function isInternalIP(ip: string | undefined): boolean {
  if (!ip) return false
  return INTERNAL_IP_RANGES.some(range =>
    typeof range === 'string' ? ip === range : range.test(ip)
  )
}

/**
 * Validate HMAC signature from n8n webhooks
 */
function validateWebhookSignature(payload: string, signature: string): boolean {
  const expectedSignature = crypto
    .createHmac('sha256', N8N_WEBHOOK_SECRET)
    .update(payload)
    .digest('hex')
  
  // Timing-safe comparison to prevent timing attacks
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
 * Internal API Key middleware
 * Validates X-Internal-API-Key header
 */
export function internalApiKeyAuth(req: Request, res: Response, next: NextFunction): void {
  // Allow from internal IPs ONLY in local development — staging/production always require the key
  if (process.env.NODE_ENV === 'development' && isInternalIP(req.ip)) {
    return next()
  }

  const apiKey = req.headers['x-internal-api-key'] as string

  if (!apiKey) {
    res.status(401).json({
      error: 'Internal API key required',
      hint: 'Set X-Internal-API-Key header'
    })
    return
  }

  // Timing-safe comparison
  try {
    const isValid = crypto.timingSafeEqual(
      Buffer.from(apiKey),
      Buffer.from(INTERNAL_API_KEY)
    )
    if (!isValid) throw new Error()
  } catch {
    res.status(403).json({ error: 'Invalid internal API key' })
    return
  }

  next()
}

/**
 * n8n Webhook authentication middleware
 * Validates X-N8N-Signature header (HMAC-SHA256)
 */
export function n8nWebhookAuth(req: Request, res: Response, next: NextFunction): void {
  // Allow from internal IPs ONLY in local development — staging/production always require signature
  if (process.env.NODE_ENV === 'development' && isInternalIP(req.ip)) {
    return next()
  }

  const signature = req.headers['x-n8n-signature'] as string

  if (!signature) {
    res.status(401).json({
      error: 'Webhook signature required',
      hint: 'Configure n8n to send X-N8N-Signature header with HMAC-SHA256'
    })
    return
  }

  // Validate signature against raw body
  const payload = JSON.stringify(req.body)
  if (!validateWebhookSignature(payload, signature)) {
    logger.warn({ ip: req.ip }, '[Security] Invalid webhook signature')
    res.status(403).json({ error: 'Invalid webhook signature' })
    return
  }

  next()
}

/**
 * Combined internal auth: API key OR valid webhook signature OR internal IP (dev only)
 */
export function internalAuth(req: Request, res: Response, next: NextFunction): void {
  // Allow from internal IPs ONLY in local development — staging/production always authenticate
  if (process.env.NODE_ENV === 'development' && isInternalIP(req.ip)) {
    return next()
  }

  // Check API key first
  const apiKey = req.headers['x-internal-api-key'] as string
  if (apiKey) {
    try {
      const isValid = crypto.timingSafeEqual(
        Buffer.from(apiKey),
        Buffer.from(INTERNAL_API_KEY)
      )
      if (isValid) return next()
    } catch {}
  }

  // Check webhook signature
  const signature = req.headers['x-n8n-signature'] as string
  if (signature) {
    const payload = JSON.stringify(req.body)
    if (validateWebhookSignature(payload, signature)) {
      return next()
    }
  }

  logger.warn({ ip: req.ip, path: req.path }, '[Security] Unauthorized internal API access')
  res.status(401).json({ error: 'Authentication required for internal endpoints' })
}

/**
 * Admin-only middleware (requires auth + admin role)
 */
export function adminOnly(req: AuthRequest, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required' })
    return
  }
  
  if (req.user.role !== 'admin') {
    res.status(403).json({ error: 'Admin access required' })
    return
  }
  
  next()
}

/**
 * Operator-only middleware (admin or operator)
 */
export function operatorOnly(req: AuthRequest, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required' })
    return
  }
  
  if (!['admin', 'operator', 'manager'].includes(req.user.role)) {
    res.status(403).json({ error: 'Operator access required' })
    return
  }
  
  next()
}

/**
 * Combined middleware: authMiddleware + adminOnly
 */
export const requireAdmin = [authMiddleware, adminOnly]

/**
 * Combined middleware: authMiddleware + operatorOnly
 */
export const requireOperator = [authMiddleware, operatorOnly]
