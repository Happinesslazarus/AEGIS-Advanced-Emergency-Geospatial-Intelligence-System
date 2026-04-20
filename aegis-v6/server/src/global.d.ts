/**
 * TypeScript ambient declaration that merges our custom user type into the
 * Express.Request interface. Overrides the @types/passport augmentation so
 * that req.user is typed as our own AuthRequest.user shape throughout the
 * server codebase -- no more type assertions needed on route handlers.
 *
 * - Included automatically when TypeScript compiles server/src/ (tsconfig)
 * - Keeps type safety aligned with server/src/middleware/auth.ts
 */

//global.d.ts -- Override @types/passport's global Express.User augmentation
// @types/passport adds Express.User to Request.user, conflicting with our
//custom AuthRequest.user type. This declaration makes them compatible.

declare global {
  namespace Express {
    interface User {
      id: string
      email: string
      role: string
      displayName: string
      department?: string | null
    }
  }
}

export {}
