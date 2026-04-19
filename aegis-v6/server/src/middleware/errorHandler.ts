/**
 * Centralised Express error handler. Catches all unhandled errors from route
 * handlers and middleware, logs them appropriately, and sends clean JSON
 * responses to the client.
 *
 * - Registered last in the middleware chain (index.ts), after all routes
 * - Catches errors from express-async-errors, Zod validation, JWT failures,
 *   PostgreSQL constraint violations, Multer uploads, and generic exceptions
 * - Uses AppError for intentional HTTP errors thrown by route handlers
 * - Redacts sensitive fields (passwords, tokens) before logging
 * */

import { Request, Response, NextFunction } from 'express'
import { ZodError } from 'zod'
import { logger } from '../services/logger.js'
import { AppError } from '../utils/AppError.js'

const isProduction = process.env.NODE_ENV === 'production'

const SENSITIVE_KEYS = new Set(['password', 'passwordHash', 'token', 'secret', 'key', 'hash', 'cookie', 'authorization', 'jwt', 'apiKey', 'api_key', 'privateKey', 'private_key'])

function redactSensitiveFields(obj: unknown): unknown {
  if (Array.isArray(obj)) return obj.map(redactSensitiveFields)
  if (obj !== null && typeof obj === 'object') {
    const sanitized: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      sanitized[k] = SENSITIVE_KEYS.has(k.toLowerCase()) ? '[REDACTED]' : redactSensitiveFields(v)
    }
    return sanitized
  }
  return obj
}

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
  let message = 'Something went wrong on our end. Please try again, or contact support if the problem persists.'
  let details: unknown

  // AppError (our own typed errors)
  if (err instanceof AppError) {
    statusCode = err.statusCode
    errorCode = err.errorCode
    message = err.message
    details = err.details

  // Zod validation errors — turn field paths into readable sentences
  } else if (err instanceof ZodError) {
    statusCode = 400
    errorCode = 'VALIDATION_ERROR'
    const fieldErrors = err.issues.map((i) => {
      const p = (i.path || []).map(String).join('.')
      return p ? `"${p}" — ${i.message}` : i.message
    })
    message = `Please fix the following before submitting: ${fieldErrors.join('; ')}.`
    details = fieldErrors

  // JWT errors
  } else if (err.name === 'TokenExpiredError') {
    statusCode = 401
    errorCode = 'TOKEN_EXPIRED'
    message = 'Your login session has expired. Please sign in again.'
  } else if (err.name === 'JsonWebTokenError') {
    statusCode = 401
    errorCode = 'AUTH_ERROR'
    message = 'Your authentication token is invalid. Please sign in again.'

  // PostgreSQL constraint violations
  } else if (err.code === '23505') {
    statusCode = 409
    errorCode = 'CONFLICT'
    // Extract the conflicting field name from the detail string if available
    const field = err.detail?.match(/\(([^)]+)\)/)?.[1] || 'value'
    message = `A record with this ${field} already exists. Please use a different value.`
  } else if (err.code === '23503') {
    statusCode = 400
    errorCode = 'VALIDATION_ERROR'
    message = 'A related record was not found. Please check your input and try again.'
  } else if (err.code === '23502') {
    statusCode = 400
    errorCode = 'VALIDATION_ERROR'
    const col = err.column || 'field'
    message = `A required field is missing: "${col}". Please fill in all required information.`
  } else if (err.code === '22P02') {
    statusCode = 400
    errorCode = 'BAD_REQUEST'
    message = 'One of the values provided is in the wrong format. Please check your input.'
  } else if (err.code === '42P01') {
    statusCode = 500
    errorCode = 'INTERNAL_ERROR'
    message = 'A database configuration error occurred. Please contact support.'

  // Multer file upload errors
  } else if (err.name === 'MulterError') {
    statusCode = 400
    errorCode = 'UPLOAD_ERROR'
    if (err.code === 'LIMIT_FILE_SIZE') {
      message = 'The file you uploaded is too large. Please upload a smaller file (max 10 MB).'
    } else if (err.code === 'LIMIT_FILE_COUNT') {
      message = 'Too many files uploaded at once. Please upload fewer files.'
    } else if (err.code === 'LIMIT_UNEXPECTED_FILE') {
      message = `Unexpected file field "${err.field}". Please upload using the correct form field.`
    } else {
      message = 'File upload failed. Please check the file and try again.'
    }

  // Malformed JSON body
  } else if (err.type === 'entity.parse.failed') {
    statusCode = 400
    errorCode = 'BAD_REQUEST'
    message = 'The request body contains invalid JSON. Please check your input and try again.'

  // Rate limit (express-rate-limit sets status 429)
  } else if (err.statusCode === 429 || err.status === 429) {
    statusCode = 429
    errorCode = 'RATE_LIMITED'
    message = 'You are sending requests too quickly. Please wait a moment and try again.'

  // Generic Error fallback — show actual message in dev, safe message in prod
  } else if (err instanceof Error) {
    message = isProduction
      ? 'Something went wrong on our end. Please try again, or contact support if the problem persists.'
      : err.message
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
      ...(details !== undefined && { details: redactSensitiveFields(details) }),
      ...(!isProduction && err.stack && statusCode >= 500 && { stack: err.stack }),
    },
  })
}

