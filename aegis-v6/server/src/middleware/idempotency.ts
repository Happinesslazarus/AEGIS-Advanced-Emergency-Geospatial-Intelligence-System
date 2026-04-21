/**
 * Prevents duplicate operations when clients retry POST/PUT/PATCH requests.
 * Clients include an Idempotency-Key header; the middleware caches the
 * response and replays it on subsequent requests with the same key.
 *
 * - Registered globally in index.ts for all mutation endpoints
 * - Uses an in-memory LRU cache (5000 keys, 24h TTL)
 * - In distributed deployments, should be backed by Redis instead
 *
 * How it works:
 * 1. Key exists + completed -> return cached response (Idempotent-Replayed: true)
 * 2. Key exists + processing -> return 409 Conflict (request in flight)
 * 3. New key -> process request normally, cache the result if successful
 * */

import { Request, Response, NextFunction } from 'express'
import { logger } from '../services/logger.js'

interface IdempotentEntry {
  status: 'processing' | 'completed'
  response?: {
    statusCode: number
    headers: Record<string, string>
    body: unknown
  }
  createdAt: number
  completedAt?: number
}

//In-memory store (production should use Redis for distributed deployments)
const idempotencyStore = new Map<string, IdempotentEntry>()

//LRU eviction config
const MAX_ENTRIES = 5000
const TTL_MS = 24 * 60 * 60 * 1000 // 24 hours

/**
 * Cleanup expired entries and enforce LRU limit
 */
function pruneIdempotencyStore(): void {
  const now = Date.now()
  
  //Remove expired entries
  for (const [key, entry] of idempotencyStore) {
    if (now - entry.createdAt > TTL_MS) {
      idempotencyStore.delete(key)
    }
  }

  //Enforce size limit (evict oldest first)
  if (idempotencyStore.size > MAX_ENTRIES) {
    const entries = [...idempotencyStore.entries()]
      .sort((a, b) => a[1].createdAt - b[1].createdAt)
    
    const toRemove = entries.slice(0, idempotencyStore.size - MAX_ENTRIES + 500)
    for (const [key] of toRemove) {
      idempotencyStore.delete(key)
    }
  }
}

//Run cleanup every 5 minutes
setInterval(pruneIdempotencyStore, 5 * 60 * 1000)

/**
 * Build a scoped idempotency key (user-specific to prevent cross-user collisions)
 */
function buildIdempotencyKey(req: Request, clientKey: string): string {
  const userId = (req as any).user?.id || 'anonymous'
  const method = req.method
  const path = req.path
  return `idem:${userId}:${method}:${path}:${clientKey}`
}

/**
 * Idempotency middleware factory
 * @param options.enabled - Enable/disable idempotency (default: true for POST/PUT/PATCH)
 * @param options.requiredMethods - Methods that require idempotency keys (default: ['POST'])
 */
export function idempotencyMiddleware(options?: {
  enabled?: boolean
  requireKey?: boolean
}) {
  const { enabled = true, requireKey = false } = options || {}

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    //Skip if disabled or not a mutating method
    if (!enabled) {
      next()
      return
    }

    const mutatingMethods = ['POST', 'PUT', 'PATCH']
    if (!mutatingMethods.includes(req.method)) {
      next()
      return
    }

    //Get idempotency key from header
    const clientKey = req.headers['idempotency-key'] as string | undefined

    //If no key provided and not required, proceed normally
    if (!clientKey) {
      if (requireKey) {
        res.status(400).json({
          success: false,
          error: {
            code: 'IDEMPOTENCY_KEY_REQUIRED',
            message: 'Idempotency-Key header is required for this endpoint',
          }
        })
        return
      }
      next()
      return
    }

    //Validate key format (UUID or alphanumeric, max 256 chars)
    if (clientKey.length > 256 || !/^[\w-]+$/.test(clientKey)) {
      res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_IDEMPOTENCY_KEY',
          message: 'Idempotency-Key must be alphanumeric/UUID, max 256 characters',
        }
      })
      return
    }

    const fullKey = buildIdempotencyKey(req, clientKey)
    const existing = idempotencyStore.get(fullKey)

 //Case 1: Key exists and completed -> return cached response
    if (existing?.status === 'completed' && existing.response) {
      logger.info({ key: clientKey, path: req.path }, '[Idempotency] Returning cached response')
      res.setHeader('Idempotent-Replayed', 'true')
      res.status(existing.response.statusCode)
      
      for (const [header, value] of Object.entries(existing.response.headers)) {
        if (!['content-length', 'transfer-encoding'].includes(header.toLowerCase())) {
          res.setHeader(header, value)
        }
      }
      
      res.json(existing.response.body)
      return
    }

 //Case 2: Key exists and still processing -> conflict
    if (existing?.status === 'processing') {
      res.status(409).json({
        success: false,
        error: {
          code: 'IDEMPOTENCY_KEY_IN_USE',
          message: 'A request with this idempotency key is already being processed',
        }
      })
      return
    }

 //Case 3: New key -> mark as processing and proceed
    idempotencyStore.set(fullKey, {
      status: 'processing',
      createdAt: Date.now(),
    })

    //Capture the response
    const originalJson = res.json.bind(res)
    let capturedBody: unknown
    let capturedStatusCode: number

    res.json = function(body: unknown) {
      capturedBody = body
      capturedStatusCode = res.statusCode

      //Only cache successful responses (2xx)
      if (capturedStatusCode >= 200 && capturedStatusCode < 300) {
        const headers: Record<string, string> = {}
        const resHeaders = res.getHeaders()
        for (const [key, value] of Object.entries(resHeaders)) {
          if (typeof value === 'string') {
            headers[key] = value
          }
        }

        idempotencyStore.set(fullKey, {
          status: 'completed',
          response: {
            statusCode: capturedStatusCode,
            headers,
            body: capturedBody,
          },
          createdAt: existing?.createdAt || Date.now(),
          completedAt: Date.now(),
        })
      } else {
        //Don't cache error responses -- allow retry
        idempotencyStore.delete(fullKey)
      }

      return originalJson(body)
    } as typeof res.json

    next()
  }
}

/**
 * Get idempotency stats for monitoring
 */
export function getIdempotencyStats(): {
  totalKeys: number
  completedKeys: number
  processingKeys: number
} {
  let completed = 0
  let processing = 0
  
  for (const entry of idempotencyStore.values()) {
    if (entry.status === 'completed') completed++
    else processing++
  }

  return {
    totalKeys: idempotencyStore.size,
    completedKeys: completed,
    processingKeys: processing,
  }
}

export default idempotencyMiddleware
