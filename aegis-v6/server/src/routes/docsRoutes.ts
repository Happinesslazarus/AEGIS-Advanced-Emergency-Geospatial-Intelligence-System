/**
 * routes/docsRoutes.ts — Swagger/OpenAPI documentation
 *
 * Serves an interactive API documentation page at /api/docs.
 * The OpenAPI spec is defined inline — no separate YAML file needed.
 */

import { Router, Request, Response } from 'express'
import swaggerUi from 'swagger-ui-express'

const router = Router()

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
    { name: 'Citizen Auth', description: 'Citizen authentication and profiles' },
    { name: 'Reports', description: 'Incident report CRUD' },
    { name: 'Alerts', description: 'Emergency alert management' },
    { name: 'Chat', description: 'AI chatbot with RAG' },
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
        requestBody: {
          required: true,
          content: {
            'multipart/form-data': {
              schema: {
                type: 'object',
                required: ['title', 'description', 'type', 'latitude', 'longitude'],
                properties: {
                  title: { type: 'string' },
                  description: { type: 'string' },
                  type: { type: 'string', enum: ['flood', 'fire', 'earthquake', 'storm', 'infrastructure', 'medical', 'other'] },
                  severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
                  latitude: { type: 'number' },
                  longitude: { type: 'number' },
                  locationText: { type: 'string' },
                  image: { type: 'string', format: 'binary' },
                },
              },
            },
          },
        },
        responses: {
          201: { description: 'Report created with AI analysis results' },
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
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['title', 'message', 'severity'],
                properties: {
                  title: { type: 'string' },
                  message: { type: 'string' },
                  severity: { type: 'string', enum: ['critical', 'warning', 'info'] },
                  channels: {
                    type: 'array',
                    items: { type: 'string', enum: ['push', 'email', 'sms', 'telegram'] },
                  },
                },
              },
            },
          },
        },
        responses: { 201: { description: 'Alert created and broadcast' } },
      },
    },
    '/api/chat': {
      post: {
        tags: ['Chat'],
        summary: 'Send message to AI chatbot',
        description: 'Processes the message through RAG + LLM pipeline. Falls back to keyword-based responses if no LLM API keys are configured.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['message'],
                properties: {
                  message: { type: 'string', example: 'What should I do during a flood?' },
                  sessionId: { type: 'string', format: 'uuid', description: 'Existing session ID for conversation continuity' },
                },
              },
            },
          },
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
