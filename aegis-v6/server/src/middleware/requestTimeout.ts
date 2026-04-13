/**
 * File: requestTimeout.ts
 *
 * What this file does:
 * Sets a timeout on every HTTP request. If the handler doesn't finish
 * in time, the middleware sends a 504 Gateway Timeout and logs a warning.
 * Different route patterns get different limits (uploads get 2 min,
 * AI calls get 1 min, health checks get 5 sec, everything else 30 sec).
 *
 * How it connects:
 * - Registered early in the middleware chain (index.ts)
 * - Prevents slow or hanging handlers from exhausting the connection pool
 * - The timeout is cleared automatically when the response completes
 *
 * Simple explanation:
 * Kills requests that take too long so they don't pile up and slow
 * down the server for everyone.
 */

import { Request, Response, NextFunction } from 'express'
import { logger } from '../services/logger.js'

// Default timeouts by route pattern
const TIMEOUT_MS_DEFAULT = 30_000  // 30 seconds
const TIMEOUT_MS_UPLOAD = 120_000  // 2 minutes for uploads
const TIMEOUT_MS_AI = 60_000      // 1 minute for AI operations
const TIMEOUT_MS_HEALTH = 5_000   // 5 seconds for health checks

/**
 * Get timeout for a specific request based on route pattern
 */
function getTimeoutForRequest(req: Request): number {
  const path = req.path.toLowerCase()

  // Upload endpoints get longer timeout
  if (path.includes('/upload') || path.includes('/media')) {
    return TIMEOUT_MS_UPLOAD
  }

  // AI/Chat endpoints get moderate timeout
  if (path.includes('/ai/') || path.includes('/chat')) {
    return TIMEOUT_MS_AI
  }

  // Health checks should be fast
  if (path === '/api/health' || path === '/health') {
    return TIMEOUT_MS_HEALTH
  }

  // Check for client-requested timeout (trusted internal services only)
  const clientTimeout = req.headers['x-timeout-ms']
  if (clientTimeout && req.headers['x-internal-key'] === process.env.INTERNAL_API_KEY) {
    const parsed = parseInt(clientTimeout as string, 10)
    if (!isNaN(parsed) && parsed > 0 && parsed <= 300_000) {
      return parsed
    }
  }

  return TIMEOUT_MS_DEFAULT
}

/**
 * Request timeout middleware
 *
 * Wraps requests with a timeout that triggers if the response isn't sent
 * within the configured time limit.
 */
export function requestTimeoutMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const timeoutMs = getTimeoutForRequest(req)
  let timedOut = false

  const timeout = setTimeout(() => {
    timedOut = true

    logger.warn({
      path: req.path,
      method: req.method,
      timeoutMs,
      requestId: req.requestId,
    }, '[Timeout] Request timed out')

    // Only send response if not already sent
    if (!res.headersSent) {
      res.status(504).json({
        success: false,
        error: {
          code: 'REQUEST_TIMEOUT',
          message: `Request timed out after ${timeoutMs}ms. Please try again.`,
          details: {
            path: req.path,
            method: req.method,
          },
        },
      })
    }
  }, timeoutMs)

  // Clear timeout when response finishes or connection closes
  function cleanup(): void {
    clearTimeout(timeout)
  }
  // Use process.nextTick to avoid TypeScript's parsing confusion with event emitter
  process.nextTick(() => {
    res.on('finish', cleanup)
    res.on('close', cleanup)
  })

  // Expose timeout status to downstream handlers
  Object.defineProperty(req, 'timedOut', {
    value: () => timedOut,
    writable: false,
  })

  // Set response header indicating timeout configured
  res.setHeader('X-Request-Timeout-Ms', String(timeoutMs))

  next()
}

export default requestTimeoutMiddleware
