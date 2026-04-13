/**
 * File: openapi-spec.ts
 *
 * What this file does:
 * Serves the static OpenAPI 3.0.3 specification as JSON at
 * /api/docs/openapi.json. This is the machine-readable API contract
 * that Swagger UI and other tools consume.
 *
 * How it connects:
 * - Imported by docsRoutes.ts
 * - The spec describes all public API endpoints
 * - Used for client code generation and integration testing
 *
 * Simple explanation:
 * The JSON file that describes every API endpoint, its inputs, and outputs.
 */

import { Router, Request, Response } from 'express'

const router = Router()

const openApiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'AEGIS - Advanced Emergency Geospatial Intelligence System',
    description: 'AI-enabled disaster reporting, alerting, and community response platform.',
    version: '6.5.0',
    contact: {
      name: 'AEGIS Development Team',
      email: 'support@aegis-platform.com',
    },
    license: {
      name: 'MIT',
      url: 'https://opensource.org/licenses/MIT',
    },
  },
  servers: [
    { url: '/api', description: 'Production API' },
  ],
  tags: [
    { name: 'Auth', description: 'Authentication & authorization' },
    { name: 'Reports', description: 'Emergency report management' },
    { name: 'Flood', description: 'Flood warnings, gauges, river levels & evacuation' },
    { name: 'Alerts', description: 'Alert broadcasting & subscriptions' },
    { name: 'AI', description: 'AI analysis & predictions' },
    { name: 'Citizens', description: 'Citizen portal features' },
    { name: 'Community', description: 'Community help & chat' },
    { name: 'Governance', description: 'AI governance & fairness' },
  ],
  paths: {
    '/health': {
      get: {
        summary: 'Health check',
        tags: ['System'],
        responses: { 200: { description: 'Server is healthy' } },
      },
    },
    '/auth/login': {
      post: {
        summary: 'Operator login',
        tags: ['Auth'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email', 'password'],
                properties: {
                  email: { type: 'string', format: 'email' },
                  password: { type: 'string', minLength: 12 },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'Login successful, returns JWT token' },
          401: { description: 'Invalid credentials' },
          429: { description: 'Too many login attempts' },
        },
      },
    },
    '/reports': {
      get: {
        summary: 'List emergency reports',
        tags: ['Reports'],
        parameters: [
          { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 20, maximum: 100 } },
          { name: 'status', in: 'query', schema: { type: 'string', enum: ['unverified', 'verified', 'urgent', 'flagged', 'resolved'] } },
          { name: 'severity', in: 'query', schema: { type: 'string', enum: ['low', 'medium', 'high'] } },
        ],
        responses: {
          200: { description: 'Paginated list of reports' },
        },
      },
      post: {
        summary: 'Submit new emergency report',
        tags: ['Reports'],
        security: [],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/CreateReport' },
            },
          },
        },
        responses: {
          201: { description: 'Report created successfully' },
          400: { description: 'Validation error' },
          429: { description: 'Rate limited' },
        },
      },
    },
    '/reports/{id}/status': {
      put: {
        summary: 'Update report status',
        tags: ['Reports'],
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['status'],
                properties: {
                  status: { type: 'string', enum: ['Verified', 'Urgent', 'Flagged', 'Resolved', 'Archived', 'False_Report'] },
                  reason: { type: 'string', description: 'Required when overriding a decided report' },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'Status updated' },
          403: { description: 'Cannot override without admin rights' },
          404: { description: 'Report not found' },
        },
      },
    },
    '/ai/governance/bias': {
      get: {
        summary: 'Comprehensive AI bias report',
        tags: ['Governance'],
        security: [{ bearerAuth: [] }],
        responses: {
          200: {
            description: 'Bias metrics across location, severity, temporal, and language dimensions',
          },
        },
      },
    },
    '/ai/governance/health': {
      get: {
        summary: 'AI governance health check',
        tags: ['Governance'],
        security: [{ bearerAuth: [] }],
        responses: {
          200: { description: 'Auto-verification rates, backlog, model errors' },
        },
      },
    },
    '/ai/classifier/health': {
      get: {
        summary: 'Classifier model health',
        tags: ['AI'],
        security: [{ bearerAuth: [] }],
        responses: {
          200: { description: 'Circuit breaker status per HuggingFace model' },
        },
      },
    },
    // ── Flood data endpoints ──────────────────────────────────────────────
    '/incidents/flood/gauges': {
      get: {
        summary: 'River gauge readings',
        tags: ['Flood'],
        parameters: [
          { name: 'region', in: 'query', schema: { type: 'string' }, description: 'Region ID override (e.g. scotland, england)' },
        ],
        responses: {
          200: {
            description: 'Gauge data from the active region adapter',
            content: { 'application/json': { schema: {
              type: 'object',
              properties: {
                incidentType: { type: 'string', example: 'flood' },
                region: { type: 'string' },
                gauges: { type: 'array', items: { type: 'object' } },
                count: { type: 'integer' },
              },
            } } },
          },
        },
      },
    },
    '/incidents/flood/flood-warnings': {
      get: {
        summary: 'Active flood warnings from EA/SEPA',
        tags: ['Flood'],
        parameters: [
          { name: 'region', in: 'query', schema: { type: 'string' } },
        ],
        responses: {
          200: {
            description: 'Flood warnings from the regional authority',
            content: { 'application/json': { schema: {
              type: 'object',
              properties: {
                incidentType: { type: 'string' },
                region: { type: 'string' },
                warnings: { type: 'array', items: { type: 'object' } },
                count: { type: 'integer' },
              },
            } } },
          },
        },
      },
    },
    '/incidents/flood/river-levels': {
      get: {
        summary: 'Current river level readings',
        tags: ['Flood'],
        parameters: [
          { name: 'region', in: 'query', schema: { type: 'string' } },
        ],
        responses: {
          200: {
            description: 'River level data from monitored gauges',
            content: { 'application/json': { schema: {
              type: 'object',
              properties: {
                incidentType: { type: 'string' },
                region: { type: 'string' },
                riverLevels: { type: 'array', items: { type: 'object' } },
                count: { type: 'integer' },
              },
            } } },
          },
        },
      },
    },
    '/flood/prediction': {
      get: {
        summary: 'Flood risk predictions',
        tags: ['Flood'],
        responses: {
          200: { description: 'Flood prediction data with confidence scores and risk level' },
        },
      },
    },
    '/flood/threat': {
      get: {
        summary: 'Current flood threat assessment',
        tags: ['Flood'],
        responses: {
          200: { description: 'Threat level (low/medium/high/critical) with contributing factors' },
        },
      },
    },
    '/flood/evacuation/route': {
      post: {
        summary: 'Calculate optimal evacuation route',
        tags: ['Flood'],
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['origin', 'destination'],
                properties: {
                  origin: { type: 'object', properties: { lat: { type: 'number' }, lng: { type: 'number' } } },
                  destination: { type: 'object', properties: { lat: { type: 'number' }, lng: { type: 'number' } } },
                  profile: { type: 'string', enum: ['fastest', 'safest', 'balanced'], default: 'balanced' },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'Evacuation route GeoJSON with risk scoring' },
        },
      },
    },
    // ── Chat ──────────────────────────────────────────────────────────────
    '/chat': {
      post: {
        summary: 'Send a chat message to the AI assistant',
        tags: ['AI'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['message'],
                properties: {
                  message: { type: 'string', maxLength: 2000 },
                  sessionId: { type: 'string', format: 'uuid' },
                  lang: { type: 'string', example: 'en' },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'AI assistant response with contextual advice' },
          429: { description: 'Rate limited' },
        },
      },
    },
    // ── Alerts ────────────────────────────────────────────────────────────
    '/alerts': {
      get: {
        summary: 'List active alerts',
        tags: ['Alerts'],
        parameters: [
          { name: 'severity', in: 'query', schema: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 50 } },
        ],
        responses: {
          200: { description: 'List of active emergency alerts' },
        },
      },
    },
    '/alerts/broadcast': {
      post: {
        summary: 'Broadcast an emergency alert',
        tags: ['Alerts'],
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
                  severity: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
                  channels: { type: 'array', items: { type: 'string', enum: ['push', 'sms', 'email', 'telegram'] } },
                  targetArea: { type: 'object', properties: { lat: { type: 'number' }, lng: { type: 'number' }, radiusKm: { type: 'number' } } },
                },
              },
            },
          },
        },
        responses: {
          201: { description: 'Alert broadcast initiated' },
          403: { description: 'Insufficient permissions' },
        },
      },
    },
    // ── Community ─────────────────────────────────────────────────────────
    '/community/posts': {
      get: {
        summary: 'List community help posts',
        tags: ['Community'],
        parameters: [
          { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
        ],
        responses: {
          200: { description: 'Paginated community posts' },
        },
      },
    },
    // ── Spatial / AI Predictions ──────────────────────────────────────────
    '/ai/predict': {
      post: {
        summary: 'Multi-hazard AI prediction',
        tags: ['AI'],
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['hazard_type', 'latitude', 'longitude'],
                properties: {
                  hazard_type: { type: 'string', enum: ['flood', 'drought', 'wildfire', 'heatwave', 'severe_storm', 'landslide'] },
                  latitude: { type: 'number', minimum: -90, maximum: 90 },
                  longitude: { type: 'number', minimum: -180, maximum: 180 },
                  forecast_horizon: { type: 'integer', default: 48, description: 'Hours ahead to predict' },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'Prediction with probability, risk level, confidence, and contributing factors' },
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
      CreateReport: {
        type: 'object',
        required: ['incidentCategory', 'incidentSubtype', 'type', 'description', 'severity', 'location', 'coordinates'],
        properties: {
          incidentCategory: { type: 'string', example: 'flood' },
          incidentSubtype: { type: 'string', example: 'river' },
          type: { type: 'string', example: 'Flood - River (Fluvial)' },
          description: { type: 'string', minLength: 10, maxLength: 5000 },
          severity: { type: 'string', enum: ['low', 'medium', 'high'] },
          trappedPersons: { type: 'string', enum: ['yes', 'property', 'no'], default: 'no' },
          location: { type: 'string' },
          coordinates: {
            type: 'array',
            items: { type: 'number' },
            minItems: 2,
            maxItems: 2,
            example: [57.15, -2.11],
          },
          hasMedia: { type: 'boolean', default: false },
          mediaType: { type: 'string', enum: ['photo', 'video', 'both'] },
        },
      },
      Error: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: false },
          error: {
            type: 'object',
            properties: {
              code: { type: 'string' },
              message: { type: 'string' },
              details: { type: 'array', items: { type: 'string' } },
            },
          },
        },
      },
    },
  },
  security: [{ bearerAuth: [] }],
}

/**
 * GET /api/docs/openapi.json
 * Returns the full OpenAPI 3.0 specification.
 */
router.get('/openapi.json', (_req: Request, res: Response) => {
  res.json(openApiSpec)
})

/**
 * GET /api/docs
 * Returns a simple HTML page that loads Swagger UI to render the spec.
 */
router.get('/', (_req: Request, res: Response) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AEGIS API Documentation</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    SwaggerUIBundle({
      url: '/api/docs/openapi.json',
      dom_id: '#swagger-ui',
      deepLinking: true,
      presets: [SwaggerUIBundle.presets.apis],
    });
  </script>
</body>
</html>`)
})

export default router
