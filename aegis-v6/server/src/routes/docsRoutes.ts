/**
 * Serves interactive Swagger UI documentation at /api/docs. Builds the
 * OpenAPI spec from  Zod validation schemas so the docs stay in sync
 * with the actual request/response shapes.
 *
 * - Mounted at /api/docs in index.ts
 * - Reads Zod schemas from validate.ts to generate the spec dynamically
 * - Public endpoint (no auth required)
 * */

import { Router, Request, Response } from 'express'
import swaggerUi from 'swagger-ui-express'
import { z } from 'zod'
import {
  createReportSchema,
  createAlertSchema,
  chatMessageSchema,
  subscribeSchema,
  paginationSchema,
} from '../middleware/validate.js'

const router = Router()

/**
 * Convert a Zod schema to an OpenAPI 3.0-compatible JSON Schema object.
 * Strips the $schema key (OpenAPI 3.0 doesn't use it) and removes
 * additionalProperties: false (friendlier Swagger UI rendering).
 */
function zodToOpenApi(schema: z.ZodType): Record<string, unknown> {
  const jsonSchema = z.toJSONSchema(schema) as Record<string, unknown>
  delete jsonSchema.$schema
  // OpenAPI 3.0 prefers no additionalProperties restriction in docs
  delete jsonSchema.additionalProperties
  return jsonSchema
}

// Pre-generate schemas from Zod — these stay in sync with validation automatically
const ReportBodySchema = zodToOpenApi(createReportSchema)
const AlertBodySchema = zodToOpenApi(createAlertSchema)
const ChatBodySchema = zodToOpenApi(chatMessageSchema)
const SubscribeBodySchema = zodToOpenApi(subscribeSchema)
const PaginationQuerySchema = zodToOpenApi(paginationSchema)

const spec: object = {
  openapi: '3.0.3',
  info: {
    title: 'AEGIS Emergency Management API',
    version: '6.9.0',
    description:
      'REST API for the AEGIS disaster response platform. Covers report management, alert broadcasting, AI-powered chat, citizen authentication, real-time messaging, and hazard configuration.',
    contact: { email: 'admin@aegis.gov.uk' },
    license: { name: 'MIT' },
  },
  servers: [
    { url: 'http://localhost:3001', description: 'Local development' },
  ],
  tags: [
    { name: 'Health', description: 'System health and status' },
    { name: 'Auth', description: 'Operator authentication' },
    { name: '2FA', description: 'Two-Factor Authentication (TOTP + backup codes)' },
    { name: 'Security', description: 'Device trust, security dashboard, alert preferences' },
    { name: 'Citizen Auth', description: 'Citizen authentication and profiles' },
    { name: 'Reports', description: 'Incident report CRUD' },
    { name: 'Alerts', description: 'Emergency alert management' },
    { name: 'Chat', description: 'AI chatbot with RAG' },
    { name: 'Distress', description: 'SOS / distress beacon system' },
    { name: 'Rivers', description: 'Live river level monitoring' },
    { name: 'Flood', description: 'Flood prediction and evacuation' },
    { name: 'Incidents', description: 'Multi-hazard incident system (v1 API)' },
    { name: 'Community', description: 'Community posts, comments, likes' },
    { name: 'AI', description: 'AI model predictions and governance' },
    { name: 'Config', description: 'Region, hazard, and shelter configuration' },
  ],
  paths: {
    '/api/health': {
      get: {
        tags: ['Health'],
        summary: 'System health check',
        responses: {
          200: {
            description: 'System status',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    status: { type: 'string', example: 'ok' },
                    database: { type: 'string', example: 'connected' },
                    version: { type: 'string', example: '6.9.0' },
                    timestamp: { type: 'string', format: 'date-time' },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/api/auth/login': {
      post: {
        tags: ['Auth'],
        summary: 'Operator login',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email', 'password'],
                properties: {
                  email: { type: 'string', format: 'email', example: 'admin@aegis.gov.uk' },
                  password: { type: 'string', example: '********' },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'JWT token and user profile',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/LoginResponse' } } },
          },
          401: { description: 'Invalid credentials' },
        },
      },
    },
    '/api/citizen-auth/login': {
      post: {
        tags: ['Citizen Auth'],
        summary: 'Citizen login',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email', 'password'],
                properties: {
                  email: { type: 'string', format: 'email' },
                  password: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'JWT token, user profile, and preferences' },
          401: { description: 'Invalid credentials' },
        },
      },
    },
    '/api/citizen-auth/register': {
      post: {
        tags: ['Citizen Auth'],
        summary: 'Register a new citizen account',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email', 'password', 'fullName'],
                properties: {
                  email: { type: 'string', format: 'email' },
                  password: { type: 'string', minLength: 8 },
                  fullName: { type: 'string' },
                  phone: { type: 'string' },
                  location: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          201: { description: 'Account created with JWT token' },
          409: { description: 'Email already registered' },
        },
      },
    },
    '/api/reports': {
      get: {
        tags: ['Reports'],
        summary: 'List all reports',
        parameters: [
          { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
          { name: 'status', in: 'query', schema: { type: 'string', enum: ['pending', 'in_progress', 'resolved', 'dismissed'] } },
          { name: 'severity', in: 'query', schema: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] } },
        ],
        responses: {
          200: {
            description: 'Array of reports',
            content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/Report' } } } },
          },
        },
      },
      post: {
        tags: ['Reports'],
        summary: 'Submit a new incident report',
        description: 'Schema auto-generated from Zod createReportSchema',
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: ReportBodySchema },
          },
        },
        responses: {
          201: { description: 'Report created with AI analysis results' },
          400: { description: 'Validation failed', content: { 'application/json': { schema: { $ref: '#/components/schemas/ValidationError' } } } },
        },
      },
    },
    '/api/reports/{id}/status': {
      put: {
        tags: ['Reports'],
        summary: 'Update report status',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', properties: { status: { type: 'string' } } } } },
        },
        responses: { 200: { description: 'Status updated' } },
      },
    },
    '/api/alerts': {
      get: {
        tags: ['Alerts'],
        summary: 'List active alerts',
        responses: {
          200: {
            description: 'Array of alerts',
            content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/Alert' } } } },
          },
        },
      },
      post: {
        tags: ['Alerts'],
        summary: 'Create a new alert',
        description: 'Schema auto-generated from Zod createAlertSchema',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: AlertBodySchema } },
        },
        responses: {
          201: { description: 'Alert created and broadcast' },
          400: { description: 'Validation failed', content: { 'application/json': { schema: { $ref: '#/components/schemas/ValidationError' } } } },
        },
      },
    },
    '/api/chat': {
      post: {
        tags: ['Chat'],
        summary: 'Send message to AI chatbot',
        description: 'Processes the message through RAG + LLM pipeline. Schema auto-generated from Zod chatMessageSchema.',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: ChatBodySchema } },
        },
        responses: {
          200: {
            description: 'Chat response',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    sessionId: { type: 'string' },
                    reply: { type: 'string' },
                    model: { type: 'string', example: 'gemini-1.5-flash' },
                    tokensUsed: { type: 'integer' },
                    toolsUsed: { type: 'array', items: { type: 'string' } },
                    sources: { type: 'array', items: { type: 'object' } },
                    safetyFlags: { type: 'array', items: { type: 'string' } },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/api/chat/status': {
      get: {
        tags: ['Chat'],
        summary: 'LLM provider health status',
        responses: {
          200: {
            description: 'Provider availability',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    providers: { type: 'array', items: { type: 'object' } },
                    preferred: { type: 'string', nullable: true },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/api/chat/sessions': {
      get: {
        tags: ['Chat'],
        summary: 'List chat sessions for authenticated user',
        security: [{ bearerAuth: [] }],
        responses: { 200: { description: 'Array of session summaries' } },
      },
    },
    '/api/config/region': {
      get: {
        tags: ['Config'],
        summary: 'Get active region configuration',
        responses: {
          200: {
            description: 'Region config with WMS layers, rivers, bounds, emergency contacts',
          },
        },
      },
    },
    '/api/config/hazards': {
      get: {
        tags: ['Config'],
        summary: 'List available hazard modules',
        responses: {
          200: { description: 'Array of hazard module configurations' },
        },
      },
    },
    '/api/config/shelters': {
      get: {
        tags: ['Config'],
        summary: 'Find nearby shelters (PostGIS spatial query)',
        parameters: [
          { name: 'lat', in: 'query', required: true, schema: { type: 'number' }, example: 57.15 },
          { name: 'lng', in: 'query', required: true, schema: { type: 'number' }, example: -2.09 },
          { name: 'radius', in: 'query', schema: { type: 'number', default: 50 }, description: 'Search radius in km' },
        ],
        responses: {
          200: {
            description: 'Shelters with distance',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    shelters: {
                      type: 'array',
                      items: { $ref: '#/components/schemas/Shelter' },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },

    // Two-Factor Authentication
    '/api/auth/2fa/status': {
      get: {
        tags: ['2FA'],
        summary: 'Get 2FA status for current operator',
        security: [{ bearerAuth: [] }],
        responses: {
          200: {
            description: '2FA status',
            content: { 'application/json': { schema: {
              type: 'object',
              properties: {
                enabled: { type: 'boolean' },
                enabledAt: { type: 'string', format: 'date-time', nullable: true },
                lastVerifiedAt: { type: 'string', format: 'date-time', nullable: true },
                recoveryCodesGeneratedAt: { type: 'string', format: 'date-time', nullable: true },
                backupCodesRemaining: { type: 'integer', nullable: true },
              },
            } } },
          },
        },
      },
    },
    '/api/auth/2fa/setup': {
      post: {
        tags: ['2FA'],
        summary: 'Initiate 2FA setup — generates TOTP secret + QR code',
        security: [{ bearerAuth: [] }],
        responses: {
          200: {
            description: 'TOTP secret and QR code',
            content: { 'application/json': { schema: {
              type: 'object',
              properties: {
                success: { type: 'boolean' },
                manualKey: { type: 'string', description: 'Base32 TOTP secret for manual entry' },
                otpAuthUrl: { type: 'string', description: 'otpauth:// URI' },
                qrCodeDataUrl: { type: 'string', description: 'Data URL of QR code image' },
              },
            } } },
          },
          409: { description: '2FA already enabled' },
        },
      },
    },
    '/api/auth/2fa/verify': {
      post: {
        tags: ['2FA'],
        summary: 'Verify first TOTP code and enable 2FA',
        security: [{ bearerAuth: [] }],
        requestBody: { required: true, content: { 'application/json': { schema: {
          type: 'object', required: ['code'],
          properties: { code: { type: 'string', example: '123456', description: '6-digit TOTP code' } },
        } } } },
        responses: {
          200: { description: '2FA enabled with backup codes', content: { 'application/json': { schema: {
            type: 'object',
            properties: { success: { type: 'boolean' }, backupCodes: { type: 'array', items: { type: 'string' } } },
          } } } },
          401: { description: 'Invalid code' },
        },
      },
    },
    '/api/auth/2fa/authenticate': {
      post: {
        tags: ['2FA'],
        summary: 'Complete 2FA login with TOTP or backup code',
        description: 'Called after password auth when 2FA is enabled. Accepts a temp token from the login response.',
        requestBody: { required: true, content: { 'application/json': { schema: {
          type: 'object', required: ['tempToken', 'code'],
          properties: {
            tempToken: { type: 'string', description: 'Temp token from /api/auth/login' },
            code: { type: 'string', description: '6-digit TOTP or backup code (XXXX-XXXX)' },
            rememberDevice: { type: 'boolean', description: 'Trust this device for 30 days' },
          },
        } } } },
        responses: {
          200: { description: 'Full JWT + user profile', content: { 'application/json': { schema: {
            type: 'object',
            properties: {
              success: { type: 'boolean' }, token: { type: 'string' },
              user: { $ref: '#/components/schemas/OperatorProfile' },
              backupCodeUsed: { type: 'boolean' }, deviceTrusted: { type: 'boolean' },
            },
          } } } },
          401: { description: 'Invalid code or expired token' },
          429: { description: 'Account locked (too many failed attempts)' },
        },
      },
    },
    '/api/auth/2fa/disable': {
      post: {
        tags: ['2FA'],
        summary: 'Disable 2FA (requires password + code)',
        security: [{ bearerAuth: [] }],
        requestBody: { required: true, content: { 'application/json': { schema: {
          type: 'object', required: ['password', 'code'],
          properties: { password: { type: 'string' }, code: { type: 'string' } },
        } } } },
        responses: {
          200: { description: '2FA disabled' },
          401: { description: 'Invalid password or code' },
        },
      },
    },
    '/api/auth/2fa/regenerate-backup-codes': {
      post: {
        tags: ['2FA'],
        summary: 'Regenerate backup recovery codes',
        security: [{ bearerAuth: [] }],
        requestBody: { required: true, content: { 'application/json': { schema: {
          type: 'object', required: ['password', 'code'],
          properties: { password: { type: 'string' }, code: { type: 'string', description: '6-digit TOTP code' } },
        } } } },
        responses: { 200: { description: 'New backup codes' } },
      },
    },

    // Security
    '/api/security/devices': {
      get: {
        tags: ['Security'],
        summary: 'List trusted devices for current operator',
        security: [{ bearerAuth: [] }],
        responses: { 200: { description: 'Array of trusted devices' } },
      },
      delete: {
        tags: ['Security'],
        summary: 'Revoke all trusted devices',
        security: [{ bearerAuth: [] }],
        responses: { 200: { description: 'All devices revoked' } },
      },
    },
    '/api/security/devices/{id}': {
      delete: {
        tags: ['Security'],
        summary: 'Revoke a specific trusted device',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: { 200: { description: 'Device revoked' }, 404: { description: 'Device not found' } },
      },
    },
    '/api/security/summary': {
      get: {
        tags: ['Security'],
        summary: 'Security summary for current operator',
        security: [{ bearerAuth: [] }],
        responses: { 200: { description: 'Login counts, failure counts, risk score' } },
      },
    },
    '/api/security/preferences': {
      get: {
        tags: ['Security'],
        summary: 'Get security alert preferences',
        security: [{ bearerAuth: [] }],
        responses: { 200: { description: 'Alert preference flags' } },
      },
      put: {
        tags: ['Security'],
        summary: 'Update security alert preferences',
        security: [{ bearerAuth: [] }],
        requestBody: { required: true, content: { 'application/json': { schema: {
          type: 'object',
          properties: {
            alert_on_2fa_disabled: { type: 'boolean' },
            alert_on_backup_code_used: { type: 'boolean' },
            alert_on_new_device_login: { type: 'boolean' },
            alert_on_suspicious_access: { type: 'boolean' },
            alert_on_lockout: { type: 'boolean' },
          },
        } } } },
        responses: { 200: { description: 'Preferences updated' } },
      },
    },
    '/api/security/dashboard/alerts': {
      get: {
        tags: ['Security'],
        summary: 'Recent security alerts (admin only)',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'limit', in: 'query', schema: { type: 'integer', default: 50 } }],
        responses: { 200: { description: 'Array of security alerts' } },
      },
    },
    '/api/security/dashboard/stats': {
      get: {
        tags: ['Security'],
        summary: 'Security event statistics (admin only)',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'hours', in: 'query', schema: { type: 'integer', default: 24 } }],
        responses: { 200: { description: 'Event counts by type' } },
      },
    },
    '/api/security/dashboard/failures': {
      get: {
        tags: ['Security'],
        summary: 'Operators with most failed login attempts (admin only)',
        security: [{ bearerAuth: [] }],
        responses: { 200: { description: 'Array of operators with failure counts' } },
      },
    },

    // Distress / SOS
    '/api/distress/activate': {
      post: {
        tags: ['Distress'],
        summary: 'Activate SOS distress beacon',
        requestBody: { required: true, content: { 'application/json': { schema: {
          type: 'object',
          properties: {
            latitude: { type: 'number' }, longitude: { type: 'number' },
            accuracy: { type: 'number' }, message: { type: 'string' },
          },
        } } } },
        responses: { 201: { description: 'Distress beacon activated' } },
      },
    },
    '/api/distress/{id}/acknowledge': {
      post: {
        tags: ['Distress'],
        summary: 'Acknowledge a distress beacon (operator)',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: { 200: { description: 'Beacon acknowledged' } },
      },
    },

    // Rivers
    '/api/rivers/levels': {
      get: {
        tags: ['Rivers'],
        summary: 'Get live river level readings',
        responses: { 200: { description: 'Array of river gauge readings' } },
      },
    },
    '/api/rivers/stations': {
      get: {
        tags: ['Rivers'],
        summary: 'List river monitoring stations',
        responses: { 200: { description: 'Array of monitoring stations with metadata' } },
      },
    },

    // Flood
    '/api/flood/predict': {
      post: {
        tags: ['Flood'],
        summary: 'Get flood risk prediction for a location',
        security: [{ bearerAuth: [] }],
        requestBody: { required: true, content: { 'application/json': { schema: {
          type: 'object', required: ['latitude', 'longitude'],
          properties: { latitude: { type: 'number' }, longitude: { type: 'number' } },
        } } } },
        responses: { 200: { description: 'Flood risk assessment with confidence score' } },
      },
    },
    '/api/flood/warnings': {
      get: {
        tags: ['Flood'],
        summary: 'Active flood warnings from EA/SEPA',
        responses: { 200: { description: 'Array of flood warnings' } },
      },
    },

    // Incidents (v1 API)
    '/api/v1/incidents/all/active': {
      get: {
        tags: ['Incidents'],
        summary: 'List all active incidents across hazard types',
        responses: { 200: { description: 'Array of active incidents' } },
      },
    },
    '/api/v1/incidents/{type}/recent': {
      get: {
        tags: ['Incidents'],
        summary: 'Recent incidents for a specific hazard type',
        parameters: [
          { name: 'type', in: 'path', required: true, schema: {
            type: 'string',
            enum: ['flood', 'severe_storm', 'heatwave', 'wildfire', 'landslide', 'power_outage', 'water_supply', 'infrastructure_damage', 'public_safety', 'environmental_hazard', 'drought'],
          } },
        ],
        responses: { 200: { description: 'Array of recent incidents' } },
      },
    },

    // Community
    '/api/community/posts': {
      get: {
        tags: ['Community'],
        summary: 'List community posts',
        parameters: [
          { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
        ],
        responses: { 200: { description: 'Array of community posts' } },
      },
    },

    // AI Predictions
    '/api/ai/predict': {
      post: {
        tags: ['AI'],
        summary: 'Request AI prediction for a hazard type',
        security: [{ bearerAuth: [] }],
        requestBody: { required: true, content: { 'application/json': { schema: {
          type: 'object', required: ['hazardType', 'latitude', 'longitude'],
          properties: {
            hazardType: { type: 'string', enum: ['flood', 'drought', 'heatwave', 'wildfire', 'severe_storm', 'landslide'] },
            latitude: { type: 'number' }, longitude: { type: 'number' },
          },
        } } } },
        responses: { 200: { description: 'Prediction with confidence, severity, and explainability metadata' } },
      },
    },
    '/api/ai/registry': {
      get: {
        tags: ['AI'],
        summary: 'List registered AI models and their status',
        security: [{ bearerAuth: [] }],
        responses: { 200: { description: 'Model registry entries' } },
      },
    },

    // Auth (additional)
    '/api/auth/register': {
      post: {
        tags: ['Auth'],
        summary: 'Register new operator account',
        requestBody: { required: true, content: { 'multipart/form-data': { schema: {
          type: 'object', required: ['email', 'password', 'displayName'],
          properties: {
            email: { type: 'string', format: 'email' },
            password: { type: 'string', minLength: 12 },
            displayName: { type: 'string' },
            department: { type: 'string' },
            phone: { type: 'string' },
            avatar: { type: 'string', format: 'binary' },
          },
        } } } },
        responses: { 201: { description: 'Account created with JWT' }, 409: { description: 'Email taken' } },
      },
    },
    '/api/auth/me': {
      get: {
        tags: ['Auth'],
        summary: 'Get current operator profile',
        security: [{ bearerAuth: [] }],
        responses: { 200: { description: 'Operator profile', content: { 'application/json': { schema: { $ref: '#/components/schemas/OperatorProfile' } } } } },
      },
    },
    '/api/auth/refresh': {
      post: {
        tags: ['Auth'],
        summary: 'Refresh access token using httpOnly cookie',
        responses: { 200: { description: 'New access token' }, 401: { description: 'Expired or revoked session' } },
      },
    },
    '/api/auth/logout': {
      post: {
        tags: ['Auth'],
        summary: 'Logout and revoke session',
        responses: { 200: { description: 'Logged out' } },
      },
    },
    '/api/auth/forgot-password': {
      post: {
        tags: ['Auth'],
        summary: 'Request password reset email',
        requestBody: { required: true, content: { 'application/json': { schema: {
          type: 'object', required: ['email'],
          properties: { email: { type: 'string', format: 'email' } },
        } } } },
        responses: { 200: { description: 'Generic success (prevents user enumeration)' } },
      },
    },
    '/api/auth/reset-password': {
      post: {
        tags: ['Auth'],
        summary: 'Reset password with one-time token',
        requestBody: { required: true, content: { 'application/json': { schema: {
          type: 'object', required: ['token', 'password'],
          properties: { token: { type: 'string' }, password: { type: 'string', minLength: 12 } },
        } } } },
        responses: { 200: { description: 'Password reset successful' }, 400: { description: 'Invalid/expired token' } },
      },
    },
  },
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
      },
    },
    schemas: {
      LoginResponse: {
        type: 'object',
        properties: {
          token: { type: 'string' },
          user: {
            type: 'object',
            properties: {
              id: { type: 'string', format: 'uuid' },
              email: { type: 'string', format: 'email' },
              displayName: { type: 'string' },
              role: { type: 'string', enum: ['admin', 'operator', 'viewer'] },
            },
          },
        },
      },
      Report: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          title: { type: 'string' },
          description: { type: 'string' },
          type: { type: 'string' },
          severity: { type: 'string' },
          status: { type: 'string' },
          latitude: { type: 'number' },
          longitude: { type: 'number' },
          location_text: { type: 'string' },
          image_url: { type: 'string' },
          ai_severity: { type: 'string' },
          ai_category: { type: 'string' },
          ai_confidence: { type: 'number' },
          created_at: { type: 'string', format: 'date-time' },
        },
      },
      Alert: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          title: { type: 'string' },
          message: { type: 'string' },
          severity: { type: 'string', enum: ['critical', 'warning', 'info'] },
          is_active: { type: 'boolean' },
          channels: { type: 'array', items: { type: 'string' } },
          created_at: { type: 'string', format: 'date-time' },
        },
      },
      Shelter: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          name: { type: 'string' },
          address: { type: 'string' },
          capacity: { type: 'integer' },
          current_occupancy: { type: 'integer' },
          shelter_type: { type: 'string' },
          amenities: { type: 'array', items: { type: 'string' } },
          phone: { type: 'string' },
          lat: { type: 'number' },
          lng: { type: 'number' },
          distance_km: { type: 'number' },
        },
      },
      OperatorProfile: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          email: { type: 'string', format: 'email' },
          displayName: { type: 'string' },
          role: { type: 'string', enum: ['admin', 'operator', 'viewer'] },
          avatarUrl: { type: 'string', nullable: true },
          department: { type: 'string', nullable: true },
          phone: { type: 'string', nullable: true },
          twoFactorEnabled: { type: 'boolean' },
          createdAt: { type: 'string', format: 'date-time' },
          lastLogin: { type: 'string', format: 'date-time', nullable: true },
        },
      },
      Error: {
        type: 'object',
        properties: {
          error: { type: 'string', description: 'Human-readable error message' },
          code: { type: 'string', description: 'Machine-readable error code' },
        },
      },
      ValidationError: {
        type: 'object',
        description: 'Returned when Zod request validation fails (400)',
        properties: {
          error: { type: 'string', example: 'Validation failed' },
          details: {
            type: 'object',
            properties: {
              body: { type: 'array', items: { type: 'string' } },
              query: { type: 'array', items: { type: 'string' } },
              params: { type: 'array', items: { type: 'string' } },
            },
          },
        },
      },
      // Auto-generated from Zod schemas (middleware/validate.ts)
      CreateReport: ReportBodySchema,
      CreateAlert: AlertBodySchema,
      ChatMessage: ChatBodySchema,
      Subscribe: SubscribeBodySchema,
      Pagination: PaginationQuerySchema,
    },
  },
}

// Serve Swagger UI
router.use('/', swaggerUi.serve)
router.get('/', swaggerUi.setup(spec, {
  customCss: '.swagger-ui .topbar { display: none }',
  customSiteTitle: 'AEGIS API Documentation',
}))

// Serve raw OpenAPI JSON
router.get('/openapi.json', (_req: Request, res: Response) => {
  res.json(spec)
})

export default router
