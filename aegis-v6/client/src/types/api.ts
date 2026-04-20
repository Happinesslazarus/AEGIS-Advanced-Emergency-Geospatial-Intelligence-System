/**
  * Generic TypeScript types for the HTTP API layer: ApiResponse<T>
  * envelope, PaginatedResponse<T>, ApiError, and request option types.
  * All fetch utilities in utils/api.ts return these shapes.
  *
  * - Used by client/src/utils/api.ts for response typing
  * - Imported by any hook or component that calls the REST API
  * - Should stay in sync with server response shapes in server/src/routes/
 */

//GENERIC API RESPONSE TYPES

/** Standard API response envelope */
export interface ApiResponse<T> {
  success: boolean
  data?: T
  error?: string
  message?: string
}

/** Paginated API response */
export interface PaginatedResponse<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
  hasMore: boolean
}

/** API error response */
export interface ApiError {
  code: string
  message: string
  details?: Record<string, string[]>
  status?: number
}

//TYPE GUARDS

/** Type guard for API error responses */
export function isApiError(value: unknown): value is ApiError {
  return (
    typeof value === 'object' &&
    value !== null &&
    'message' in value &&
    typeof (value as ApiError).message === 'string'
  )
}

/** Type guard for successful API responses */
export function isApiSuccess<T>(response: ApiResponse<T>): response is ApiResponse<T> & { data: T } {
  return response.success === true && response.data !== undefined
}

/** Type guard for arrays */
export function isArray<T>(value: unknown): value is T[] {
  return Array.isArray(value)
}

/** Type guard for non-null objects */
export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

//SAFE ACCESSORS

/** Safely access a nested property with type inference */
export function safeGet<T, K extends keyof T>(obj: T | null | undefined, key: K): T[K] | undefined {
  return obj?.[key]
}

/** Safely access a deeply nested property */
export function safeGetPath<T>(obj: unknown, path: string, defaultValue?: T): T | undefined {
  const keys = path.split('.')
  let current: unknown = obj
  
  for (const key of keys) {
    if (!isObject(current)) return defaultValue
    current = (current as Record<string, unknown>)[key]
  }
  
  return current as T | undefined
}

/** Safely parse a number from unknown input */
export function safeNumber(value: unknown, defaultValue = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = parseFloat(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return defaultValue
}

/** Safely parse a string from unknown input */
export function safeString(value: unknown, defaultValue = ''): string {
  if (typeof value === 'string') return value
  if (value === null || value === undefined) return defaultValue
  return String(value)
}

/** Safely parse a boolean from unknown input */
export function safeBoolean(value: unknown, defaultValue = false): boolean {
  if (typeof value === 'boolean') return value
  if (value === 'true' || value === 1) return true
  if (value === 'false' || value === 0) return false
  return defaultValue
}

/** Safely parse an array from unknown input */
export function safeArray<T>(value: unknown, itemGuard?: (item: unknown) => item is T): T[] {
  if (!Array.isArray(value)) return []
  if (!itemGuard) return value as T[]
  return value.filter(itemGuard)
}

//DATA TRANSFORMERS

/** Transform an object using a mapping function */
export function transformObject<S extends Record<string, unknown>, T>(
  source: S,
  transformer: (key: keyof S, value: S[keyof S]) => [string, unknown] | null
): T {
  const result: Record<string, unknown> = {}
  
  for (const key of Object.keys(source) as Array<keyof S>) {
    const transformed = transformer(key, source[key])
    if (transformed) {
      const [newKey, newValue] = transformed
      result[newKey] = newValue
    }
  }
  
  return result as T
}

/** Pick specified keys from an object with type safety */
export function pick<T extends object, K extends keyof T>(obj: T, keys: K[]): Pick<T, K> {
  const result = {} as Pick<T, K>
  for (const key of keys) {
    if (key in obj) {
      result[key] = obj[key]
    }
  }
  return result
}

/** Omit specified keys from an object with type safety */
export function omit<T extends object, K extends keyof T>(obj: T, keys: K[]): Omit<T, K> {
  const result = { ...obj }
  for (const key of keys) {
    delete result[key]
  }
  return result as Omit<T, K>
}

//FETCH WRAPPER WITH TYPED RESPONSES

/** Options for typed fetch */
export interface TypedFetchOptions<T> extends RequestInit {
  /** Transform the raw response data */
  transform?: (data: unknown) => T
  /** Validate the response data */
  validate?: (data: unknown) => data is T
  /** Default value if request fails */
  fallback?: T
}

/** Type-safe fetch wrapper */
export async function typedFetch<T>(
  url: string,
  options: TypedFetchOptions<T> = {}
): Promise<ApiResponse<T>> {
  const { transform, validate, fallback, ...fetchOptions } = options
  
  try {
    const response = await fetch(url, fetchOptions)
    
    if (!response.ok) {
      return {
        success: false,
        error: `HTTP ${response.status}: ${response.statusText}`,
      }
    }
    
    const rawData = await response.json()
    let data: T
    
    if (transform) {
      data = transform(rawData)
    } else if (validate && validate(rawData)) {
      data = rawData
    } else {
      data = rawData as T
    }
    
    return { success: true, data }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return {
      success: false,
      error: message,
      data: fallback,
    }
  }
}

//EVENT HANDLER TYPES

/** Typed event handler for form inputs */
export type InputChangeHandler = (e: React.ChangeEvent<HTMLInputElement>) => void

/** Typed event handler for textareas */
export type TextAreaChangeHandler = (e: React.ChangeEvent<HTMLTextAreaElement>) => void

/** Typed event handler for selects */
export type SelectChangeHandler = (e: React.ChangeEvent<HTMLSelectElement>) => void

/** Typed event handler for form submission */
export type FormSubmitHandler = (e: React.FormEvent<HTMLFormElement>) => void

/** Typed event handler for button clicks */
export type ButtonClickHandler = (e: React.MouseEvent<HTMLButtonElement>) => void

/** Typed event handler for div clicks */
export type DivClickHandler = (e: React.MouseEvent<HTMLDivElement>) => void

/** Typed keyboard event handler */
export type KeyboardHandler = (e: React.KeyboardEvent) => void

//COMMON COMPONENT PROP TYPES

/** Base props that all components should accept */
export interface BaseComponentProps {
  className?: string
  'data-testid'?: string
}

/** Props for components that can have children */
export interface WithChildrenProps extends BaseComponentProps {
  children?: React.ReactNode
}

/** Props for components that can be disabled */
export interface WithDisabledProps extends BaseComponentProps {
  disabled?: boolean
}

/** Props for components with loading state */
export interface WithLoadingProps extends BaseComponentProps {
  loading?: boolean
  loadingText?: string
}
