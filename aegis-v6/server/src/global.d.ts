// global.d.ts — Override @types/passport's global Express.User augmentation
// @types/passport adds Express.User to Request.user, conflicting with our
// custom AuthRequest.user type. This declaration makes them compatible.

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
