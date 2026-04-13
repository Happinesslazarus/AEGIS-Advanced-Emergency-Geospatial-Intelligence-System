/**
 * File: requestId.ts
 *
 * What this file does:
 * Assigns a unique correlation ID (UUID v4) to every incoming request.
 * If the client or upstream proxy already set X-Request-ID, that value
 * is preserved. Otherwise a new one is generated.
 *
 * How it connects:
 * - Registered early in the middleware chain (index.ts) before the logger
 * - The request ID appears in all log entries, error responses, and the
 *   X-Request-ID response header, making it easy to trace a single request
 *   across services and logs
 *
 * Simple explanation:
 * Every request gets a unique ID so you can find all log entries for
 * that request when debugging.
 */

import { Request, Response, NextFunction } from 'express'
import crypto from 'crypto'

declare global {
  namespace Express {
    interface Request {
      /* Unique correlation ID for this request (UUID v4) */
      requestId: string
    }
  }
}

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incomingId = req.headers['x-request-id']

  // Accept forwarded IDs only if they look like a UUID or safe alphanumeric string (max 128 chars).
  // This prevents header injection via crafted X-Request-ID values.
  const isSafe = typeof incomingId === 'string'
    && incomingId.length > 0
    && incomingId.length <= 128
    && /^[\w-]+$/.test(incomingId)

  const id = isSafe ? incomingId as string : crypto.randomUUID()

  req.requestId = id
  res.setHeader('X-Request-ID', id)
  next()
}
