/**
 * middleware/errorHandler.ts — Centralised Express error middleware
 *
 * Registered AFTER all routes (and after Sentry's handler) so every
 * unhandled or next(err)'d error flows through a single code path.
 *
 * Responsibilities:
 *   1. Classify the error (AppError, ZodError, JWT, pg, Multer, —)
 *   2. Log with Pino (structured context: method, path, userId, requestId)
 *   3. Return a consistent JSON envelope:
 *        { success: false, error: { code, message, details? } }
 *   4. Never leak stack traces in production
 */

import { Request, Response, NextFunction } from 'express'
import { ZodError } from 'zod'
import { logger } from '../services/logger.js'
import { AppError } from '../utils/AppError.js'

const isProduction = process.env.NODE_ENV === 'production'

export function errorHandler(
  err: any,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  // If headers already sent, delegate to Express default handler
  if (res.headersSent) {
    _next(err)
    return
  }

  let statusCode = 500
  let errorCode = 'INTERNAL_ERROR'
  let message = 'Internal server error.'
  let details: unknown

  // AppError (our own typed errors)
  if (err instanceof AppError) {
    statusCode = err.statusCode
    errorCode = err.errorCode
    message = err.message
    details = err.details

  // Zod validation errors
  } else if (err instanceof ZodError) {
    statusCode = 400
    errorCode = 'VALIDATION_ERROR'
    message = 'Validation failed'
    details = err.issues.map((i) => {
      const p = (i.path || []).map(String).join('.')
      return p ? `${p}: ${i.message}` : i.message
    })

  // JWT errors
  } else if (err.name === 'TokenExpiredError') {
    statusCode = 401
    errorCode = 'TOKEN_EXPIRED'
    message = 'Token has expired.'
  } else if (err.name === 'JsonWebTokenError') {
    statusCode = 401
    errorCode = 'AUTH_ERROR'
    message = 'Invalid token.'

  // PostgreSQL constraint violations
  } else if (err.code === '23505') {
    statusCode = 409
    errorCode = 'CONFLICT'
    message = 'A record with this value already exists.'
  } else if (err.code === '23503') {
    statusCode = 400
    errorCode = 'VALIDATION_ERROR'
    message = 'Referenced record does not exist.'

  // Multer file upload errors
  } else if (err.name === 'MulterError') {
    statusCode = 400
    errorCode = 'VALIDATION_ERROR'
    message = err.message || 'File upload error.'

  // Malformed JSON body
  } else if (err.type === 'entity.parse.failed') {
    statusCode = 400
    errorCode = 'BAD_REQUEST'
    message = 'Invalid JSON in request body.'

  // Generic Error fallback
  } else if (err instanceof Error) {
    message = isProduction ? 'Internal server error.' : err.message
  }

  // Structured logging
  const logContext: Record<string, unknown> = {
    requestId: (req as any).requestId,
    statusCode,
    errorCode,
    method: req.method,
    path: req.originalUrl,
    userId: (req as any).user?.id,
  }

  if (statusCode >= 500) {
    // Include full error object (Pino serialises stack, message, etc.)
    logContext.err = err
    logger.error(logContext, message)
  } else {
    logger.warn(logContext, message)
  }

  // Send response
  res.status(statusCode).json({
    success: false,
    error: {
      code: errorCode,
      message,
      ...(details !== undefined && { details }),
      ...(!isProduction && err.stack && statusCode >= 500 && { stack: err.stack }),
    },
  })
}
