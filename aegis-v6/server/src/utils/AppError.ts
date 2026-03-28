/**
 * utils/AppError.ts — Typed operational error for Express routes
 *
 * Every thrown / next()'d error that is an instance of AppError will be
 * serialised by errorHandler.ts into the standard envelope:
 *   { success: false, error: { code, message, details? } }
 *
 * Factory methods cover the most common HTTP error scenarios so route
 * code stays concise:
 *   throw AppError.badRequest('Email is required.')
 */

export class AppError extends Error {
  public readonly statusCode: number
  public readonly errorCode: string
  public readonly isOperational: boolean
  public readonly details?: unknown

  constructor(
    message: string,
    statusCode: number,
    errorCode: string,
    details?: unknown,
    isOperational = true,
  ) {
    super(message)
    this.statusCode = statusCode
    this.errorCode = errorCode
    this.isOperational = isOperational
    this.details = details
    Object.setPrototypeOf(this, AppError.prototype)
  }

  /* Factory helpers */

  static badRequest(message: string, details?: unknown) {
    return new AppError(message, 400, 'BAD_REQUEST', details)
  }

  static unauthorized(message = 'Authentication required.') {
    return new AppError(message, 401, 'AUTH_ERROR')
  }

  static forbidden(message = 'Access denied.') {
    return new AppError(message, 403, 'FORBIDDEN')
  }

  static notFound(message = 'Resource not found.') {
    return new AppError(message, 404, 'NOT_FOUND')
  }

  static conflict(message: string, details?: unknown) {
    return new AppError(message, 409, 'CONFLICT', details)
  }

  static payloadTooLarge(message: string) {
    return new AppError(message, 413, 'PAYLOAD_TOO_LARGE')
  }

  static locked(message: string, details?: unknown) {
    return new AppError(message, 423, 'ACCOUNT_LOCKED', details)
  }

  static tooMany(message = 'Too many requests.') {
    return new AppError(message, 429, 'RATE_LIMITED')
  }

  static internal(message = 'Internal server error.') {
    return new AppError(message, 500, 'INTERNAL_ERROR', undefined, false)
  }

  static notImplemented(message: string) {
    return new AppError(message, 501, 'NOT_IMPLEMENTED')
  }

  static badGateway(message: string) {
    return new AppError(message, 502, 'BAD_GATEWAY')
  }

  static serviceUnavailable(message: string) {
    return new AppError(message, 503, 'SERVICE_UNAVAILABLE')
  }
}
