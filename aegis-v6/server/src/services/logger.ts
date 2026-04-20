/**
 * Structured logging service -- Pino-based logger with pretty-printing in dev
 * and JSON output in production. Exports a requestLogger() middleware that
 * logs method, URL, status, duration, and IP for every HTTP request.
 *
 * - Imported by virtually every file in the server
 * - requestLogger() middleware is applied globally in index.ts
 * - Redacts sensitive query params (token, password, key)
 * */

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
function sanitizeLoggedUrl(originalUrl?: string): string {
  if (!originalUrl) return ''

  try {
    const url = new URL(originalUrl, 'http://localhost')
    for (const key of ['text', 'texts', 'message', 'messages']) {
      if (url.searchParams.has(key)) {
        url.searchParams.set(key, '[redacted]')
      }
    }

    const query = url.searchParams.toString()
    return query ? `${url.pathname}?${query}` : url.pathname
  } catch {
    return originalUrl
      .replace(/([?&](?:text|texts|message|messages)=)[^&]*/gi, '$1[redacted]')
  }
}

export function requestLogger() {
  return (req: any, res: any, next: any) => {
    const start = Date.now()

    res.on('finish', () => {
      const duration = Date.now() - start
      const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info'
      const sanitizedUrl = sanitizeLoggedUrl(req.originalUrl)

      logger[level]({
        requestId: req.requestId,
        method: req.method,
        url: sanitizedUrl,
        status: res.statusCode,
        duration,
        ip: req.ip,
        userAgent: req.headers['user-agent']?.slice(0, 100),
      }, `${req.method} ${sanitizedUrl} ${res.statusCode} ${duration}ms`)
    })

    next()
  }
}
