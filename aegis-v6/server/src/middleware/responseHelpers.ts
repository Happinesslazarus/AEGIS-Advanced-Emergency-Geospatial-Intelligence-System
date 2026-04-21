import type { Response, Request, NextFunction } from 'express'

/**
 * Attach res.success() and res.fail() convenience helpers to every response.
 *
 * res.success(data, code?)  → { ok: true,  data }  with 200 (or custom code)
 * res.fail(message, code?)  → { ok: false, error } with 400 (or custom code)
 *
 * These are additive — no existing res.json() calls are affected.
 */
export function responseHelpersMiddleware(_req: Request, res: Response, next: NextFunction): void {
  res.success = function (data: unknown, status = 200) {
    return this.status(status).json({ ok: true, data })
  }
  res.fail = function (message: string, status = 400) {
    return this.status(status).json({ ok: false, error: message })
  }
  next()
}
