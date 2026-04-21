/**
 * asyncRoute — eliminates the try/catch(err){next(err)} boilerplate
 * that would otherwise appear in every Express route handler.
 *
 * Usage:
 *   router.get('/path', asyncRoute(async (req, res) => {
 *     const data = await someService.getData()
 *     res.json(data)
 *   }))
 *
 * Any thrown error (including AppError instances) propagates directly to
 * the Express error-handling middleware via `next`, preserving HTTP
 * status codes and structured error bodies without any per-route ceremony.
 */
import { Request, Response, NextFunction } from 'express'
import { AuthRequest } from '../middleware/auth.js'

type Handler<R extends Request = Request> = (
  req: R,
  res: Response,
  next: NextFunction,
) => Promise<void>

export function asyncRoute<R extends Request = Request>(fn: Handler<R>) {
  return (req: R, res: Response, next: NextFunction): void => {
    fn(req, res, next).catch(next)
  }
}

/** Typed convenience alias for authenticated routes (AuthRequest). */
export const asyncAuthRoute = asyncRoute<AuthRequest>
