/**
 * File: index.ts  (lib barrel)
  *
  * What this file does:
  * Re-exports the shared library primitives: queryClient (TanStack
  * Query instance), createReducerContext (typed context+reducer factory),
  * and createAction (type-safe action creator).
  *
  * How it connects:
  * - queryClient: wrapped by AppProviders.tsx and used across all hooks
  * - createReducerContext: used to build typed state machines in contexts
 */

export { queryClient } from './queryClient'
export {
  createReducerContext,
  createAction,
  createLoggerMiddleware,
  createPersistMiddleware,
  createAsyncAction,
  type Action
} from './useReducerContext'
