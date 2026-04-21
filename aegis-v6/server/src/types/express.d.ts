import 'express'

declare module 'express-serve-static-core' {
  interface Response {
    /** Send a successful JSON response. Defaults to HTTP 200. */
    success(data: unknown, status?: number): this
    /** Send a failure JSON response. Defaults to HTTP 400. */
    fail(message: string, status?: number): this
  }
}
