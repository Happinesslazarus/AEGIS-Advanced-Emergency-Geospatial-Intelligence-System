/**
 * Api validation client utility (helper functions).
 *
 * How it connects:
 * - Wraps fetch calls in the API utility layer
 * - Schemas mirror the backend response contracts
 * Simple explanation:
 * Validates every API response at runtime so the UI never trusts raw JSON blindly. */

import { z } from 'zod'
import type { ApiResponse, ApiError } from '../types/api'

/**
 * Generic API response schema factory
 */
export function apiResponseSchema<T extends z.ZodType>(dataSchema: T) {
  return z.object({
    success: z.boolean(),
    data: dataSchema.optional(),
    error: z.string().optional(),
    message: z.string().optional(),
  })
}

/**
 * Paginated response schema factory
 */
export function paginatedSchema<T extends z.ZodType>(itemSchema: T) {
  return z.object({
    items: z.array(itemSchema),
    total: z.number().int().nonnegative(),
    page: z.number().int().positive(),
    pageSize: z.number().int().positive(),
    hasMore: z.boolean(),
  })
}

/**
 * Common data schemas
 */
export const schemas = {
  /** UUID v4 */
  uuid: z.string().uuid(),
  
  /** ISO 8601 datetime */
  datetime: z.string().datetime(),
  
  /** Email address */
  email: z.string().email(),
  
  /** Non-empty trimmed string */
  nonEmptyString: z.string().min(1).transform(s => s.trim()),
  
  /** Latitude coordinate */
  latitude: z.number().min(-90).max(90),
  
  /** Longitude coordinate */
  longitude: z.number().min(-180).max(180),
  
  /** Geographic coordinates */
  coordinates: z.object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
  }),
  
  /** Severity level */
  severity: z.enum(['low', 'medium', 'high', 'critical']),
  
  /** Report status */
  reportStatus: z.enum(['pending', 'verified', 'in_progress', 'resolved', 'closed']),
  
  /** Alert type */
  alertType: z.enum(['flood', 'wildfire', 'earthquake', 'storm', 'general']),
}

/**
 * Report schema
 */
export const reportSchema = z.object({
  id: schemas.uuid,
  title: z.string().max(200),
  description: z.string().max(5000),
  category: z.string(),
  severity: schemas.severity,
  status: schemas.reportStatus,
  location: z.object({
    latitude: schemas.latitude,
    longitude: schemas.longitude,
    address: z.string().optional(),
  }).optional(),
  created_at: schemas.datetime,
  updated_at: schemas.datetime,
  reporter_id: schemas.uuid.optional(),
  image_url: z.string().url().optional(),
})

export type Report = z.infer<typeof reportSchema>

/**
 * Alert schema
 */
export const alertSchema = z.object({
  id: schemas.uuid,
  title: z.string().max(200),
  message: z.string().max(2000),
  type: schemas.alertType,
  severity: schemas.severity,
  active: z.boolean(),
  expires_at: schemas.datetime.optional(),
  affected_areas: z.array(z.string()).optional(),
  created_at: schemas.datetime,
})

export type Alert = z.infer<typeof alertSchema>

/**
 * User schema (public profile)
 */
export const userProfileSchema = z.object({
  id: schemas.uuid,
  displayName: z.string().max(100),
  email: schemas.email.optional(),
  role: z.enum(['admin', 'operator', 'viewer', 'citizen']),
  avatar_url: z.string().url().optional(),
  created_at: schemas.datetime,
})

export type UserProfile = z.infer<typeof userProfileSchema>

/**
 * Weather data schema
 */
export const weatherDataSchema = z.object({
  temperature: z.number(),
  humidity: z.number().min(0).max(100),
  windSpeed: z.number().nonnegative(),
  windDirection: z.number().min(0).max(360),
  conditions: z.string(),
  icon: z.string().optional(),
  timestamp: schemas.datetime,
})

export type WeatherData = z.infer<typeof weatherDataSchema>

/**
 * Validated API fetch function
 * 
 * @example
 * const result = await validatedFetch('/api/reports', reportSchema)
 * if (result.success) {
 *   console.log(result.data) // Fully typed as Report
 * }
 */
export async function validatedFetch<T>(
  url: string,
  schema: z.ZodType<T>,
  options: RequestInit = {}
): Promise<ApiResponse<T>> {
  try {
    const response = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        ...options.headers,
      },
      ...options,
    })
    
    // Validate Content-Type header
    const contentType = response.headers.get('Content-Type')
    if (contentType && !contentType.includes('application/json')) {
      return {
        success: false,
        error: `Invalid content type: ${contentType}`,
      }
    }
    
    if (!response.ok) {
      const errorText = await response.text()
      let errorMessage = `HTTP ${response.status}`
      
      try {
        const errorJson = JSON.parse(errorText)
        errorMessage = errorJson.message || errorJson.error || errorMessage
      } catch {
        errorMessage = errorText || errorMessage
      }
      
      return {
        success: false,
        error: errorMessage,
      }
    }
    
    const rawData = await response.json()
    
    // Validate response against schema
    const parseResult = schema.safeParse(rawData)
    
    if (!parseResult.success) {
      console.error('[API Validation] Schema validation failed:', parseResult.error.issues)
      
      // In development, log detailed errors
      if (import.meta.env.DEV) {
        console.error('[API Validation] Raw data:', rawData)
        console.error('[API Validation] Validation errors:', parseResult.error.format())
      }
      
      return {
        success: false,
        error: 'Response validation failed',
      }
    }
    
    return {
      success: true,
      data: parseResult.data,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Network error'
    return {
      success: false,
      error: message,
    }
  }
}

/**
 * Validated array fetch (for list endpoints)
 */
export async function validatedArrayFetch<T>(
  url: string,
  itemSchema: z.ZodType<T>,
  options: RequestInit = {}
): Promise<ApiResponse<T[]>> {
  return validatedFetch(url, z.array(itemSchema), options)
}

/**
 * Validated paginated fetch
 */
export async function validatedPaginatedFetch<T>(
  url: string,
  itemSchema: z.ZodType<T>,
  options: RequestInit = {}
): Promise<ApiResponse<{ items: T[]; total: number; page: number; pageSize: number; hasMore: boolean }>> {
  return validatedFetch(url, paginatedSchema(itemSchema), options)
}

/**
 * Validate data against a schema with safe parsing
 */
export function validateData<T>(data: unknown, schema: z.ZodType<T>): T | null {
  const result = schema.safeParse(data)
  return result.success ? result.data : null
}

/**
 * Check if data matches a schema
 */
export function matchesSchema<T>(data: unknown, schema: z.ZodType<T>): data is T {
  return schema.safeParse(data).success
}

/**
 * Sanitize and validate user input
 */
export const inputSanitizers = {
  /** Sanitize string input - trim and limit length */
  string: (maxLength: number = 1000) => z.string()
    .transform(s => s.trim())
    .pipe(z.string().max(maxLength)),
  
  /** Sanitize integer input */
  integer: (min?: number, max?: number) => {
    let schema = z.coerce.number().int()
    if (min !== undefined) schema = schema.min(min)
    if (max !== undefined) schema = schema.max(max)
    return schema
  },
  
  /** Sanitize URL input */
  url: () => z.string().url().refine(url => {
    try {
      const parsed = new URL(url)
      return ['http:', 'https:'].includes(parsed.protocol)
    } catch {
      return false
    }
  }, 'Invalid URL protocol'),
  
  /** Sanitize email input */
  email: () => z.string()
    .transform(s => s.trim())
    .pipe(z.string().email().toLowerCase()),
}
