/**
 * File: useReducerContext.tsx
  *
  * What this file does:
  * Generic factory that creates a paired React Context + useReducer
  * hook. Calling createReducerContext(reducer, initialState) returns
  * a [Provider, useContext] tuple that is fully TypeScript-typed without
  * any boilerplate.
  *
  * How it connects:
  * - Used by complex contexts in client/src/contexts/ that need
  *   reducer-pattern state (e.g. OfflineQueueContext)
  * - createAction() utility keeps the action creator pattern consistent
 */

import {
  createContext,
  useContext,
  useReducer,
  useCallback,
  useMemo,
  type ReactNode,
  type Dispatch,
  type Reducer,
} from 'react'

//GENERIC TYPES

/** Base action shape */
export interface Action<T extends string = string> {
  type: T
}

/** Action with payload */
export interface PayloadAction<T extends string, P> extends Action<T> {
  payload: P
}

/** Helper to create action creators */
export function createAction<T extends string>(type: T): () => Action<T>
export function createAction<T extends string, P>(type: T): (payload: P) => PayloadAction<T, P>
export function createAction<T extends string, P>(type: T) {
  return (payload?: P) => (payload !== undefined ? { type, payload } : { type })
}

//CONTEXT FACTORY

interface ReducerContextOptions<S, A extends Action> {
  /** Display name for React DevTools */
  name: string
  /** Initial state */
  initialState: S
  /** Reducer function */
  reducer: Reducer<S, A>
  /** Optional middleware */
  middleware?: Array<(state: S, action: A) => void>
}

interface ReducerContextValue<S, A extends Action> {
  state: S
  dispatch: Dispatch<A>
}

/**
 * Creates a typed context with reducer-based state management.
 * 
 * @example
 * const { Provider, useContextState, useContextDispatch } = createReducerContext({
 *   name: 'Counter',
 *   initialState: { count: 0 },
 *   reducer: counterReducer,
 * })
 */
export function createReducerContext<S, A extends Action>(
  options: ReducerContextOptions<S, A>
) {
  const { name, initialState, reducer, middleware = [] } = options
  
  const StateContext = createContext<S | undefined>(undefined)
  const DispatchContext = createContext<Dispatch<A> | undefined>(undefined)
  
  StateContext.displayName = `${name}State`
  DispatchContext.displayName = `${name}Dispatch`
  
  //Enhanced reducer with middleware
  const enhancedReducer: Reducer<S, A> = (state, action) => {
    const newState = reducer(state, action)
    
    //Run middleware after state update
    middleware.forEach(fn => {
      try {
        fn(newState, action)
      } catch (err) {
        console.error(`[${name}] Middleware error:`, err)
      }
    })
    
    return newState
  }
  
  function Provider({ children }: { children: ReactNode }) {
    const [state, dispatch] = useReducer(enhancedReducer, initialState)
    
    return (
      <StateContext.Provider value={state}>
        <DispatchContext.Provider value={dispatch}>
          {children}
        </DispatchContext.Provider>
      </StateContext.Provider>
    )
  }
  
  function useContextState(): S {
    const state = useContext(StateContext)
    if (state === undefined) {
      throw new Error(`use${name}State must be used within ${name}Provider`)
    }
    return state
  }
  
  function useContextDispatch(): Dispatch<A> {
    const dispatch = useContext(DispatchContext)
    if (dispatch === undefined) {
      throw new Error(`use${name}Dispatch must be used within ${name}Provider`)
    }
    return dispatch
  }
  
  function useContextValue(): ReducerContextValue<S, A> {
    return {
      state: useContextState(),
      dispatch: useContextDispatch(),
    }
  }
  
  return {
    Provider,
    useContextState,
    useContextDispatch,
    useContextValue,
    StateContext,
    DispatchContext,
  }
}

//MIDDLEWARE HELPERS

/** Logging middleware for development */
export function createLoggerMiddleware<S, A extends Action>(name: string) {
  return (state: S, action: A) => {
    if (process.env.NODE_ENV === 'development') {
      console.group(`[${name}] ${action.type}`)
      console.log('Payload:', 'payload' in action ? (action as PayloadAction<string, unknown>).payload : undefined)
      console.log('New State:', state)
      console.groupEnd()
    }
  }
}

/** LocalStorage persistence middleware */
export function createPersistMiddleware<S, A extends Action>(
  key: string,
  selector?: (state: S) => Partial<S>
) {
  return (state: S, _action: A) => {
    try {
      const toPersist = selector ? selector(state) : state
      localStorage.setItem(key, JSON.stringify(toPersist))
    } catch {
      //Ignore storage errors
    }
  }
}

/** Load persisted state from localStorage */
export function loadPersistedState<S>(key: string, defaultState: S): S {
  try {
    const stored = localStorage.getItem(key)
    if (stored) {
      return { ...defaultState, ...JSON.parse(stored) }
    }
  } catch {
    //Ignore parse errors
  }
  return defaultState
}

//SELECTOR HELPERS

/** Create a memoized selector hook */
export function createSelector<S, T>(
  useContextState: () => S,
  selector: (state: S) => T
): () => T {
  return function useSelectedState() {
    const state = useContextState()
    return useMemo(() => selector(state), [state])
  }
}

//ASYNC ACTION HELPERS

type AsyncActionState = 'idle' | 'loading' | 'success' | 'error'

interface AsyncState<T> {
  status: AsyncActionState
  data: T | null
  error: string | null
}

/** Create initial async state */
export function createAsyncState<T>(data: T | null = null): AsyncState<T> {
  return { status: 'idle', data, error: null }
}

/** Standard async action types */
export const asyncActions = {
  pending: <T extends string>(type: T) => `${type}_PENDING` as const,
  fulfilled: <T extends string>(type: T) => `${type}_FULFILLED` as const,
  rejected: <T extends string>(type: T) => `${type}_REJECTED` as const,
}

/** Create async thunk-like action */
export function createAsyncAction<T extends string, P, R>(
  type: T,
  asyncFn: (payload: P) => Promise<R>
) {
  type PendingAction = Action<`${T}_PENDING`>
  type FulfilledAction = PayloadAction<`${T}_FULFILLED`, R>
  type RejectedAction = PayloadAction<`${T}_REJECTED`, string>
  
  type AsyncActions = PendingAction | FulfilledAction | RejectedAction
  
  return function executeAsync(
    dispatch: Dispatch<AsyncActions>,
    payload: P
  ): Promise<R> {
    dispatch({ type: `${type}_PENDING` as const })
    
    return asyncFn(payload)
      .then(result => {
        dispatch({ type: `${type}_FULFILLED` as const, payload: result })
        return result
      })
      .catch(error => {
        const message = error instanceof Error ? error.message : 'Unknown error'
        dispatch({ type: `${type}_REJECTED` as const, payload: message })
        throw error
      })
  }
}
