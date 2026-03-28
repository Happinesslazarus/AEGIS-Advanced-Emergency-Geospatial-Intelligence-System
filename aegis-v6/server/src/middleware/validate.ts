 /*
 * middleware/validate.ts — Zod request validation middleware
 * Wraps Zod schemas into Express middleware that validates request
 * body, query params, or route params. Returns 400 with detailed
 * error messages on validation failure.
 * Usage:
 *   router.post('/reports', validate(createReportSchema), handler)
  */

import { Request, Response, NextFunction } from 'express'
import { z, ZodSchema, ZodError } from 'zod'

interface ValidateOptions {
  body?: ZodSchema
  query?: ZodSchema
  params?: ZodSchema
}

 /*
 * Create validation middleware from Zod schema(s).
 * Validates body, query, and/or params. Attaches parsed data back
 * to the request so handlers get typed, sanitised input.
  */
export function validate(schemas: ValidateOptions | ZodSchema) {
  // Allow passing a single schema for body validation
  const opts: ValidateOptions = schemas instanceof z.ZodType
    ? { body: schemas }
    : schemas

  return (req: Request, res: Response, next: NextFunction): void => {
    const errors: Record<string, string[]> = {}

    if (opts.body) {
      const result = opts.body.safeParse(req.body)
      if (!result.success) {
        errors.body = formatErrors(result.error)
      } else {
        req.body = result.data
      }
    }

    if (opts.query) {
      const result = opts.query.safeParse(req.query)
      if (!result.success) {
        errors.query = formatErrors(result.error)
      } else {
        (req as any).validatedQuery = result.data
      }
    }

    if (opts.params) {
      const result = opts.params.safeParse(req.params)
      if (!result.success) {
        errors.params = formatErrors(result.error)
      } else {
        (req as any).validatedParams = result.data
      }
    }

    if (Object.keys(errors).length > 0) {
      res.status(400).json({
        error: 'Validation failed',
        details: errors,
      })
      return
    }

    next()
  }
}

function formatErrors(error: ZodError): string[] {
  return error.issues.map((e: any) => {
    const path = (e.path || []).map(String).join('.')
    return path ? `${path}: ${e.message}` : e.message
  })
}

// COMMON VALIDATION SCHEMAS

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  sortBy: z.string().optional(),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
})

export const uuidParam = z.object({
  id: z.string().uuid('Invalid UUID format'),
})

export const createReportSchema = z.object({
  incidentCategory: z.string().min(1, 'Incident category is required'),
  incidentSubtype: z.string().min(1, 'Incident subtype is required'),
  type: z.string().min(1),
  description: z.string().min(10, 'Description must be at least 10 characters').max(5000),
  severity: z.enum(['low', 'medium', 'high']),
  trappedPersons: z.enum(['yes', 'property', 'no']).default('no'),
  location: z.string().min(1, 'Location is required'),
  coordinates: z.tuple([z.number().min(-90).max(90), z.number().min(-180).max(180)]),
  hasMedia: z.boolean().default(false),
  mediaType: z.enum(['photo', 'video', 'both']).optional(),
})

export const createAlertSchema = z.object({
  title: z.string().min(1).max(200),
  message: z.string().min(1).max(5000),
  severity: z.enum(['critical', 'warning', 'info']),
  alertType: z.string().default('flood_warning'),
  locationText: z.string().optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  radiusKm: z.number().min(0.1).max(500).default(10),
  expiresAt: z.string().datetime().optional(),
})

export const chatMessageSchema = z.object({
  message: z.string().min(1, 'Message is required').max(2000),
  sessionId: z.string().uuid().optional(),
  preferredProvider: z.string().optional(),
})

export const subscribeSchema = z.object({
  email: z.string().email().optional(),
  phone: z.string().min(10).max(20).optional(),
  telegramId: z.string().optional(),
  channels: z.array(z.enum(['web', 'email', 'sms', 'telegram', 'whatsapp'])).min(1),
  severityFilter: z.array(z.enum(['critical', 'warning', 'info'])).default(['critical', 'warning', 'info']),
  consent: z.boolean().refine((v) => v === true, 'Consent is required'),
})
