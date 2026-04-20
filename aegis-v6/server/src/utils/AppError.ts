/**
 * Custom error class for HTTP errors with status codes, error codes,
 * and optional detail payloads. Factory methods provide clean shortcuts
 * for common errors (400, 401, 403, 404, 409, 429, 500, etc.)
 *
 * - Thrown by route handlers and services when something goes wrong
 * - Caught by errorHandler.ts middleware which sends the structured response
 * - The errorCode field maps to frontend error handling logic
 * */

export class AppError extends Error {
  public readonly statusCode: number
  public readonly errorCode: string
  //isOperational: true = expected user-facing error; false = programmer error.
  //errorHandler only reveals details to the client for operational errors.
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
    //Required because TypeScript extends of built-in classes break prototype chain in ES5 targets.
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

