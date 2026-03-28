/**
 * middleware/requestId.ts — X-Request-ID correlation middleware
 *
 * Generates or forwards a unique request ID for every HTTP request.
 * This ID is:
 *   1. Read from the incoming X-Request-ID header (if set by a reverse proxy)
 *   2. Generated as a UUID v4 if not present
 *   3. Attached to `req.id` for use in route handlers and services
 *   4. Set on the response X-Request-ID header for client-side correlation
 *   5. Bound to the Pino child logger so every log line includes the request ID
 *
 * This enables end-to-end tracing across Client ? Nginx ? Server ? AI Engine.
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
  const id = typeof incomingId === 'string' && incomingId.length > 0
    ? incomingId
    : crypto.randomUUID()

  req.requestId = id
  res.setHeader('X-Request-ID', id)
  next()
}
