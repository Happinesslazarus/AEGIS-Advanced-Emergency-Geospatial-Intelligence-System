/**
 * Express middleware -- binds an AsyncLocalStorage correlation context
 * to every incoming request so any service, AI call, or event subscriber
 * spawned during the request inherits the same correlationId without
 * having to thread it through every function signature.
 */
import { Request, Response, NextFunction } from 'express'
import { runWithCorrelation } from '../events/correlationContext.js'

export function correlationMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  // requestIdMiddleware (registered earlier in the chain) sets req.requestId.
  const correlationId = req.requestId ?? String(req.headers['x-request-id'] ?? '')
  const actor =
    (req as Request & { user?: { id?: string } }).user?.id ?? undefined

  runWithCorrelation({ correlationId, actor }, () => next())
}
