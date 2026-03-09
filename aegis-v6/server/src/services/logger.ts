/**
 * services/logger.ts — Structured logging with Pino
 *
 * Replaces console.log throughout the server with structured JSON
 * logging. In development, pino-pretty formats output for readability.
 * In production, raw JSON is emitted for log aggregation tools.
 *
 * Usage:
 *   import { logger } from '../services/logger.js'
 *   logger.info({ reportId }, 'Report created')
 *   logger.error({ err }, 'Database query failed')
 */

import pino from 'pino'

const isProduction = process.env.NODE_ENV === 'production'

export const logger = pino({
  level: process.env.LOG_LEVEL || (isProduction ? 'info' : 'debug'),
  ...(isProduction
    ? {}
    : {
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'HH:MM:ss',
            ignore: 'pid,hostname',
          },
        },
      }),
  formatters: {
    level(label: string) {
      return { level: label }
    },
  },
  serializers: {
    err: pino.stdSerializers.err,
    req: pino.stdSerializers.req,
    res: pino.stdSerializers.res,
  },
})

/**
 * Express request logger middleware.
 * Logs method, url, status code, and response time for every request.
 */
export function requestLogger() {
  return (req: any, res: any, next: any) => {
    const start = Date.now()

    res.on('finish', () => {
      const duration = Date.now() - start
      const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info'

      logger[level]({
        method: req.method,
        url: req.originalUrl,
        status: res.statusCode,
        duration,
        ip: req.ip,
        userAgent: req.headers['user-agent']?.slice(0, 100),
      }, `${req.method} ${req.originalUrl} ${res.statusCode} ${duration}ms`)
    })

    next()
  }
}
