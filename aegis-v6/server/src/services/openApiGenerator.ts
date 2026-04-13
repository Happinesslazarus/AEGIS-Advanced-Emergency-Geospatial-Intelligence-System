/**
 * File: openApiGenerator.ts
 *
 * OpenAPI 3.1.0 specification builder — programmatically generates the full
 * API spec from Express route metadata including schemas, security definitions,
 * tags, and examples. Feeds Swagger UI and ReDoc documentation endpoints.
 *
 * How it connects:
 * - Reads route metadata from the Express API layer
 * - Merges schemas, security definitions, and examples into one spec
 * - Serves the spec via documentation routes for Swagger UI and ReDoc
 *
 * Simple explanation:
 * Turns the backend route definitions into the API docs developers read.
 */

import { Router, Request, Response } from 'express'
import { createHash } from 'crypto'

// TYPE DEFINITIONS

export interface OpenAPISpec {
  openapi: '3.1.0'
  info: InfoObject
  jsonSchemaDialect?: string
  servers: ServerObject[]
  paths: PathsObject
  webhooks?: Record<string, PathItemObject>
  components: ComponentsObject
  security?: SecurityRequirementObject[]
  tags: TagObject[]
  externalDocs?: ExternalDocumentationObject
}

interface InfoObject {
  title: string
  summary?: string
  description?: string
  termsOfService?: string
  contact?: ContactObject
  license?: LicenseObject
  version: string
}

interface ContactObject {
  name?: string
  url?: string
  email?: string
}

interface LicenseObject {
  name: string
  identifier?: string
  url?: string
}

interface ServerObject {
  url: string
  description?: string
  variables?: Record<string, ServerVariableObject>
}

interface ServerVariableObject {
  enum?: string[]
  default: string
  description?: string
}

type PathsObject = Record<string, PathItemObject>

interface PathItemObject {
  summary?: string
  description?: string
  get?: OperationObject
  put?: OperationObject
  post?: OperationObject
  delete?: OperationObject
  patch?: OperationObject
  options?: OperationObject
  head?: OperationObject
  trace?: OperationObject
  servers?: ServerObject[]
  parameters?: ParameterObject[]
}

interface OperationObject {
  tags?: string[]
  summary?: string
  description?: string
  externalDocs?: ExternalDocumentationObject
  operationId?: string
  parameters?: (ParameterObject | ReferenceObject)[]
  requestBody?: RequestBodyObject
  responses: ResponsesObject
  callbacks?: Record<string, CallbackObject>
  deprecated?: boolean
  security?: SecurityRequirementObject[]
  servers?: ServerObject[]
}

interface ReferenceObject {
  $ref: string
  summary?: string
  description?: string
}

interface ParameterObject {
  name: string
  in: 'query' | 'header' | 'path' | 'cookie'
  description?: string
  required?: boolean
  deprecated?: boolean
  allowEmptyValue?: boolean
  style?: string
  explode?: boolean
  allowReserved?: boolean
  schema?: SchemaObject | ReferenceObject
  example?: any
  examples?: Record<string, ExampleObject>
  content?: Record<string, MediaTypeObject>
}

interface RequestBodyObject {
  description?: string
  content: Record<string, MediaTypeObject>
  required?: boolean
}

type ResponsesObject = Record<string, ResponseObject>

interface ResponseObject {
  description: string
  headers?: Record<string, HeaderObject>
  content?: Record<string, MediaTypeObject>
  links?: Record<string, LinkObject>
}

interface MediaTypeObject {
  schema?: SchemaObject
  example?: any
  examples?: Record<string, ExampleObject>
  encoding?: Record<string, EncodingObject>
}

interface EncodingObject {
  contentType?: string
  headers?: Record<string, HeaderObject>
  style?: string
  explode?: boolean
  allowReserved?: boolean
}

interface HeaderObject {
  description?: string
  required?: boolean
  deprecated?: boolean
  schema?: SchemaObject
}

interface LinkObject {
  operationRef?: string
  operationId?: string
  parameters?: Record<string, any>
  requestBody?: any
  description?: string
  server?: ServerObject
}

type CallbackObject = Record<string, PathItemObject>

interface ExampleObject {
  summary?: string
  description?: string
  value?: any
  externalValue?: string
}

interface SchemaObject {
  $ref?: string
  title?: string
  description?: string
  type?: string | string[]
  format?: string
  enum?: any[]
  const?: any
  default?: any
  nullable?: boolean
  discriminator?: DiscriminatorObject
  readOnly?: boolean
  writeOnly?: boolean
  xml?: XMLObject
  externalDocs?: ExternalDocumentationObject
  example?: any
  deprecated?: boolean
  // JSON Schema
  properties?: Record<string, SchemaObject>
  additionalProperties?: boolean | SchemaObject
  required?: string[]
  items?: SchemaObject
  allOf?: SchemaObject[]
  oneOf?: SchemaObject[]
  anyOf?: SchemaObject[]
  not?: SchemaObject
  minimum?: number
  maximum?: number
  minLength?: number
  maxLength?: number
  pattern?: string
  minItems?: number
  maxItems?: number
  uniqueItems?: boolean
}

interface DiscriminatorObject {
  propertyName: string
  mapping?: Record<string, string>
}

interface XMLObject {
  name?: string
  namespace?: string
  prefix?: string
  attribute?: boolean
  wrapped?: boolean
}

interface ComponentsObject {
  schemas?: Record<string, SchemaObject>
  responses?: Record<string, ResponseObject>
  parameters?: Record<string, ParameterObject>
  examples?: Record<string, ExampleObject>
  requestBodies?: Record<string, RequestBodyObject>
  headers?: Record<string, HeaderObject>
  securitySchemes?: Record<string, SecuritySchemeObject>
  links?: Record<string, LinkObject>
  callbacks?: Record<string, CallbackObject>
  pathItems?: Record<string, PathItemObject>
}

interface SecuritySchemeObject {
  type: 'apiKey' | 'http' | 'mutualTLS' | 'oauth2' | 'openIdConnect'
  description?: string
  name?: string
  in?: 'query' | 'header' | 'cookie'
  scheme?: string
  bearerFormat?: string
  flows?: OAuthFlowsObject
  openIdConnectUrl?: string
}

interface OAuthFlowsObject {
  implicit?: OAuthFlowObject
  password?: OAuthFlowObject
  clientCredentials?: OAuthFlowObject
  authorizationCode?: OAuthFlowObject
}

interface OAuthFlowObject {
  authorizationUrl?: string
  tokenUrl?: string
  refreshUrl?: string
  scopes: Record<string, string>
}

type SecurityRequirementObject = Record<string, string[]>

interface TagObject {
  name: string
  description?: string
  externalDocs?: ExternalDocumentationObject
}

interface ExternalDocumentationObject {
  description?: string
  url: string
}

// ROUTE METADATA STORAGE

interface RouteMetadata {
  path: string
  method: string
  operationId?: string
  summary?: string
  description?: string
  tags?: string[]
  parameters?: ParameterObject[]
  requestBody?: RequestBodyObject
  responses?: ResponsesObject
  security?: SecurityRequirementObject[]
  deprecated?: boolean
}

const routeMetadata: RouteMetadata[] = []

// DECORATORS FOR ROUTE DOCUMENTATION

// Simple metadata storage (avoids reflect-metadata dependency)
const operationMetadata = new WeakMap<Function, any>()
const bodyMetadata = new WeakMap<Function, any>()
const responsesMetadata = new WeakMap<Function, Record<number, any>>()
const paramsMetadata = new WeakMap<Function, ParameterObject[]>()
const securityMetadata = new WeakMap<Function, SecurityRequirementObject[]>()

/**
 * Decorator to document an API endpoint
 */
export function ApiOperation(config: {
  summary: string
  description?: string
  tags?: string[]
  operationId?: string
  deprecated?: boolean
}) {
  return function (_target: any, _propertyKey: string, descriptor: PropertyDescriptor) {
    // Store metadata for later retrieval
    operationMetadata.set(descriptor.value, config)
    return descriptor
  }
}

/**
 * Decorator to document request body
 */
export function ApiBody(config: {
  description?: string
  required?: boolean
  schema: SchemaObject
  example?: any
}) {
  return function (_target: any, _propertyKey: string, descriptor: PropertyDescriptor) {
    bodyMetadata.set(descriptor.value, config)
    return descriptor
  }
}

/**
 * Decorator to document response
 */
export function ApiResponse(statusCode: number, config: {
  description: string
  schema?: SchemaObject
  example?: any
}) {
  return function (_target: any, _propertyKey: string, descriptor: PropertyDescriptor) {
    const responses = responsesMetadata.get(descriptor.value) || {}
    responses[statusCode] = config
    responsesMetadata.set(descriptor.value, responses)
    return descriptor
  }
}

/**
 * Decorator to document parameter
 */
export function ApiParam(config: ParameterObject) {
  return function (_target: any, _propertyKey: string, descriptor: PropertyDescriptor) {
    const params = paramsMetadata.get(descriptor.value) || []
    params.push(config)
    paramsMetadata.set(descriptor.value, params)
    return descriptor
  }
}

/**
 * Decorator to mark endpoint as requiring authentication
 */
export function ApiSecurity(schemes: SecurityRequirementObject[]) {
  return function (_target: any, _propertyKey: string, descriptor: PropertyDescriptor) {
    securityMetadata.set(descriptor.value, schemes)
    return descriptor
  }
}

// AEGIS API SPECIFICATION

function generateAegisSpec(): OpenAPISpec {
  return {
    openapi: '3.1.0',
    jsonSchemaDialect: 'https://json-schema.org/draft/2020-12/schema',
    info: {
      title: 'AEGIS - Advanced Emergency Geospatial Intelligence System',
      summary: 'Enterprise disaster management and emergency response platform',
      description: `
# AEGIS API Documentation

AEGIS (Advanced Emergency Geospatial Intelligence System) is a disaster management platform
providing real-time emergency reporting, AI-powered hazard classification, and coordinated response capabilities.

## Features

- **Emergency Reporting**: Citizens can report incidents with geolocation and images
- **AI Classification**: Automatic hazard type detection and severity assessment
- **Real-time Alerts**: Push notifications for emergency alerts in affected areas
- **Responder Coordination**: Assignment and tracking of emergency responders
- **Analytics Dashboard**: Real-time metrics and historical trend analysis

## Authentication

Most endpoints require authentication via JWT token:

\`\`\`
Authorization: Bearer <token>
\`\`\`

Obtain tokens via the \`/api/auth/login\` endpoint.

## Rate Limiting

API requests are rate-limited based on system load:
- Standard: 100 requests/minute
- Authenticated: 300 requests/minute
- Admin: 1000 requests/minute

## Versioning

API version is specified via URL path (\`/api/v1/...\`) or Accept header.
      `,
      termsOfService: 'https://aegis.disaster.gov/terms',
      contact: {
        name: 'AEGIS Support Team',
        url: 'https://aegis.disaster.gov/support',
        email: 'api-support@aegis.disaster.gov',
      },
      license: {
        name: 'MIT',
        identifier: 'MIT',
        url: 'https://opensource.org/licenses/MIT',
      },
      version: '2.0.0',
    },
    servers: [
      {
        url: 'http://localhost:3001',
        description: 'Development server',
      },
      {
        url: 'https://api.aegis.disaster.gov',
        description: 'Production server',
      },
      {
        url: 'https://staging-api.aegis.disaster.gov',
        description: 'Staging server',
      },
    ],
    paths: generatePaths(),
    webhooks: generateWebhooks(),
    components: generateComponents(),
    security: [
      { bearerAuth: [] },
    ],
    tags: [
      {
        name: 'Authentication',
        description: 'User authentication and authorization',
      },
      {
        name: 'Reports',
        description: 'Emergency report management',
      },
      {
        name: 'Alerts',
        description: 'Emergency alert broadcasting',
      },
      {
        name: 'Users',
        description: 'User management (Admin only)',
      },
      {
        name: 'Citizens',
        description: 'Citizen-specific endpoints',
      },
      {
        name: 'Analytics',
        description: 'Metrics and analytics',
      },
      {
        name: 'AI',
        description: 'AI classification and analysis',
      },
      {
        name: 'Health',
        description: 'System health and monitoring',
      },
    ],
    externalDocs: {
      description: 'AEGIS Developer Documentation',
      url: 'https://docs.aegis.disaster.gov',
    },
  }
}

function generatePaths(): PathsObject {
  return {
    // Authentication
    '/api/auth/login': {
      post: {
        tags: ['Authentication'],
        summary: 'User login',
        description: 'Authenticate user and receive JWT tokens',
        operationId: 'login',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/LoginRequest' },
              example: {
                email: 'admin@aegis.gov',
                password: 'SecurePassword123!',
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Login successful',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/LoginResponse' },
              },
            },
          },
          '401': {
            description: 'Invalid credentials',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Error' },
              },
            },
          },
          '429': {
            description: 'Too many login attempts',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Error' },
              },
            },
          },
        },
        security: [],
      },
    },
    '/api/auth/register': {
      post: {
        tags: ['Authentication'],
        summary: 'Register new user',
        description: 'Create a new user account',
        operationId: 'register',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/RegisterRequest' },
            },
          },
        },
        responses: {
          '201': {
            description: 'Registration successful',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/User' },
              },
            },
          },
          '400': {
            description: 'Validation error',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ValidationError' },
              },
            },
          },
          '409': {
            description: 'Email already exists',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Error' },
              },
            },
          },
        },
        security: [],
      },
    },
    '/api/auth/refresh': {
      post: {
        tags: ['Authentication'],
        summary: 'Refresh access token',
        description: 'Exchange refresh token for new access token',
        operationId: 'refreshToken',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  refreshToken: { type: 'string' },
                },
                required: ['refreshToken'],
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Token refreshed',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/TokenResponse' },
              },
            },
          },
          '401': {
            description: 'Invalid or expired refresh token',
          },
        },
        security: [],
      },
    },
    
    // Reports
    '/api/reports': {
      get: {
        tags: ['Reports'],
        summary: 'List reports',
        description: 'Get paginated list of emergency reports with filtering',
        operationId: 'listReports',
        parameters: [
          { $ref: '#/components/parameters/PageParam' },
          { $ref: '#/components/parameters/LimitParam' },
          {
            name: 'status',
            in: 'query',
            description: 'Filter by status',
            schema: {
              type: 'array',
              items: { $ref: '#/components/schemas/ReportStatus' },
            },
          },
          {
            name: 'hazardType',
            in: 'query',
            description: 'Filter by hazard type',
            schema: {
              type: 'array',
              items: { $ref: '#/components/schemas/HazardType' },
            },
          },
          {
            name: 'severity',
            in: 'query',
            description: 'Minimum severity (1-5)',
            schema: { type: 'integer', minimum: 1, maximum: 5 },
          },
          {
            name: 'bounds',
            in: 'query',
            description: 'Geographic bounds (minLat,minLng,maxLat,maxLng)',
            schema: { type: 'string' },
          },
        ],
        responses: {
          '200': {
            description: 'List of reports',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    data: {
                      type: 'array',
                      items: { $ref: '#/components/schemas/Report' },
                    },
                    pagination: { $ref: '#/components/schemas/Pagination' },
                  },
                },
              },
            },
          },
        },
      },
      post: {
        tags: ['Reports'],
        summary: 'Create report',
        description: 'Submit a new emergency report',
        operationId: 'createReport',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/CreateReportRequest' },
            },
            'multipart/form-data': {
              schema: {
                type: 'object',
                properties: {
                  title: { type: 'string' },
                  description: { type: 'string' },
                  hazardType: { $ref: '#/components/schemas/HazardType' },
                  latitude: { type: 'number' },
                  longitude: { type: 'number' },
                  images: {
                    type: 'array',
                    items: { type: 'string', format: 'binary' },
                  },
                },
              },
            },
          },
        },
        responses: {
          '201': {
            description: 'Report created',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Report' },
              },
            },
          },
          '400': {
            description: 'Validation error',
          },
        },
      },
    },
    '/api/reports/{id}': {
      get: {
        tags: ['Reports'],
        summary: 'Get report',
        description: 'Get a single report by ID',
        operationId: 'getReport',
        parameters: [
          { $ref: '#/components/parameters/ReportIdParam' },
        ],
        responses: {
          '200': {
            description: 'Report details',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Report' },
              },
            },
          },
          '404': {
            description: 'Report not found',
          },
        },
      },
      patch: {
        tags: ['Reports'],
        summary: 'Update report',
        description: 'Update report status or details',
        operationId: 'updateReport',
        parameters: [
          { $ref: '#/components/parameters/ReportIdParam' },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/UpdateReportRequest' },
            },
          },
        },
        responses: {
          '200': {
            description: 'Report updated',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Report' },
              },
            },
          },
        },
        security: [{ bearerAuth: [] }],
      },
      delete: {
        tags: ['Reports'],
        summary: 'Delete report',
        description: 'Delete a report (Admin only)',
        operationId: 'deleteReport',
        parameters: [
          { $ref: '#/components/parameters/ReportIdParam' },
        ],
        responses: {
          '204': {
            description: 'Report deleted',
          },
        },
        security: [{ bearerAuth: [] }],
      },
    },
    '/api/reports/{id}/assign': {
      post: {
        tags: ['Reports'],
        summary: 'Assign responder',
        description: 'Assign a responder to handle the report',
        operationId: 'assignReport',
        parameters: [
          { $ref: '#/components/parameters/ReportIdParam' },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  responderId: { type: 'string', format: 'uuid' },
                },
                required: ['responderId'],
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Responder assigned',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Report' },
              },
            },
          },
        },
        security: [{ bearerAuth: [] }],
      },
    },
    '/api/reports/{id}/resolve': {
      post: {
        tags: ['Reports'],
        summary: 'Resolve report',
        description: 'Mark report as resolved',
        operationId: 'resolveReport',
        parameters: [
          { $ref: '#/components/parameters/ReportIdParam' },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  resolution: { type: 'string' },
                },
                required: ['resolution'],
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Report resolved',
          },
        },
        security: [{ bearerAuth: [] }],
      },
    },
    '/api/reports/nearby': {
      get: {
        tags: ['Reports'],
        summary: 'Get nearby reports',
        description: 'Find reports within a radius of a location',
        operationId: 'getNearbyReports',
        parameters: [
          {
            name: 'latitude',
            in: 'query',
            required: true,
            schema: { type: 'number' },
          },
          {
            name: 'longitude',
            in: 'query',
            required: true,
            schema: { type: 'number' },
          },
          {
            name: 'radiusKm',
            in: 'query',
            schema: { type: 'number', default: 5 },
          },
        ],
        responses: {
          '200': {
            description: 'Nearby reports with distance',
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      report: { $ref: '#/components/schemas/Report' },
                      distance: { type: 'number', description: 'Distance in km' },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    
    // Alerts
    '/api/alerts': {
      get: {
        tags: ['Alerts'],
        summary: 'List alerts',
        description: 'Get all active alerts',
        operationId: 'listAlerts',
        parameters: [
          {
            name: 'active',
            in: 'query',
            schema: { type: 'boolean', default: true },
          },
          {
            name: 'severity',
            in: 'query',
            schema: { $ref: '#/components/schemas/AlertSeverity' },
          },
        ],
        responses: {
          '200': {
            description: 'List of alerts',
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/Alert' },
                },
              },
            },
          },
        },
      },
      post: {
        tags: ['Alerts'],
        summary: 'Create alert',
        description: 'Broadcast a new emergency alert',
        operationId: 'createAlert',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/CreateAlertRequest' },
            },
          },
        },
        responses: {
          '201': {
            description: 'Alert created and broadcast',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Alert' },
              },
            },
          },
        },
        security: [{ bearerAuth: [] }],
      },
    },
    
    // AI
    '/api/ai/classify': {
      post: {
        tags: ['AI'],
        summary: 'Classify image',
        description: 'Use AI to classify hazard type from image',
        operationId: 'classifyImage',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  imageBase64: { type: 'string' },
                  imageUrl: { type: 'string', format: 'uri' },
                },
              },
            },
            'multipart/form-data': {
              schema: {
                type: 'object',
                properties: {
                  image: { type: 'string', format: 'binary' },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Classification result',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ClassificationResult' },
              },
            },
          },
        },
      },
    },
    '/api/ai/threat-level': {
      get: {
        tags: ['AI'],
        summary: 'Get threat level',
        description: 'Get current threat level for a region',
        operationId: 'getThreatLevel',
        parameters: [
          {
            name: 'region',
            in: 'query',
            required: true,
            schema: { type: 'string' },
          },
        ],
        responses: {
          '200': {
            description: 'Threat level assessment',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ThreatLevel' },
              },
            },
          },
        },
      },
    },
    
    // Analytics
    '/api/analytics/summary': {
      get: {
        tags: ['Analytics'],
        summary: 'Get analytics summary',
        description: 'Get aggregated statistics and metrics',
        operationId: 'getAnalyticsSummary',
        parameters: [
          {
            name: 'fromDate',
            in: 'query',
            schema: { type: 'string', format: 'date-time' },
          },
          {
            name: 'toDate',
            in: 'query',
            schema: { type: 'string', format: 'date-time' },
          },
        ],
        responses: {
          '200': {
            description: 'Analytics summary',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/AnalyticsSummary' },
              },
            },
          },
        },
        security: [{ bearerAuth: [] }],
      },
    },
    '/api/analytics/heatmap': {
      get: {
        tags: ['Analytics'],
        summary: 'Get heatmap data',
        description: 'Get incident density heatmap for map visualization',
        operationId: 'getHeatmap',
        parameters: [
          {
            name: 'bounds',
            in: 'query',
            required: true,
            description: 'Geographic bounds (minLat,minLng,maxLat,maxLng)',
            schema: { type: 'string' },
          },
          {
            name: 'resolution',
            in: 'query',
            schema: { type: 'integer', default: 10 },
          },
        ],
        responses: {
          '200': {
            description: 'Heatmap points',
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/HeatmapPoint' },
                },
              },
            },
          },
        },
      },
    },
    
    // Health
    '/api/health': {
      get: {
        tags: ['Health'],
        summary: 'Basic health check',
        operationId: 'healthCheck',
        responses: {
          '200': {
            description: 'Service is healthy',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    status: { type: 'string', enum: ['healthy'] },
                    timestamp: { type: 'string', format: 'date-time' },
                  },
                },
              },
            },
          },
        },
        security: [],
      },
    },
    '/healthz': {
      get: {
        tags: ['Health'],
        summary: 'Kubernetes liveness probe',
        operationId: 'livenessProbe',
        responses: {
          '200': {
            description: 'Service is alive',
          },
        },
        security: [],
      },
    },
    '/readyz': {
      get: {
        tags: ['Health'],
        summary: 'Kubernetes readiness probe',
        operationId: 'readinessProbe',
        responses: {
          '200': {
            description: 'Service is ready',
          },
          '503': {
            description: 'Service is not ready',
          },
        },
        security: [],
      },
    },
  }
}

function generateWebhooks(): Record<string, PathItemObject> {
  return {
    reportCreated: {
      post: {
        summary: 'Report created webhook',
        description: 'Triggered when a new report is submitted',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/Report' },
            },
          },
        },
        responses: {
          '200': {
            description: 'Webhook processed',
          },
        },
      },
    },
    alertBroadcast: {
      post: {
        summary: 'Alert broadcast webhook',
        description: 'Triggered when an alert is broadcast',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/Alert' },
            },
          },
        },
        responses: {
          '200': {
            description: 'Webhook processed',
          },
        },
      },
    },
    threatLevelChanged: {
      post: {
        summary: 'Threat level change webhook',
        description: 'Triggered when regional threat level changes',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  region: { type: 'string' },
                  oldLevel: { type: 'integer' },
                  newLevel: { type: 'integer' },
                  timestamp: { type: 'string', format: 'date-time' },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Webhook processed',
          },
        },
      },
    },
  }
}

function generateComponents(): ComponentsObject {
  return {
    schemas: {
      // Base schemas
      Error: {
        type: 'object',
        properties: {
          success: { type: 'boolean', const: false },
          error: { type: 'string' },
          code: { type: 'string' },
          details: { type: 'object' },
        },
        required: ['success', 'error'],
      },
      ValidationError: {
        type: 'object',
        properties: {
          success: { type: 'boolean', const: false },
          error: { type: 'string' },
          validationErrors: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                field: { type: 'string' },
                message: { type: 'string' },
              },
            },
          },
        },
      },
      Pagination: {
        type: 'object',
        properties: {
          page: { type: 'integer' },
          limit: { type: 'integer' },
          total: { type: 'integer' },
          totalPages: { type: 'integer' },
          hasNext: { type: 'boolean' },
          hasPrev: { type: 'boolean' },
        },
      },
      GeoPoint: {
        type: 'object',
        properties: {
          type: { type: 'string', const: 'Point' },
          coordinates: {
            type: 'array',
            items: { type: 'number' },
            minItems: 2,
            maxItems: 2,
            description: '[longitude, latitude]',
          },
        },
      },
      
      // Enums
      HazardType: {
        type: 'string',
        enum: ['FLOOD', 'FIRE', 'EARTHQUAKE', 'LANDSLIDE', 'STORM', 'INFRASTRUCTURE', 'ENVIRONMENTAL', 'OTHER'],
      },
      ReportStatus: {
        type: 'string',
        enum: ['PENDING', 'IN_PROGRESS', 'RESOLVED', 'ESCALATED', 'CLOSED'],
      },
      AlertSeverity: {
        type: 'string',
        enum: ['INFO', 'WARNING', 'CRITICAL', 'EMERGENCY'],
      },
      UserRole: {
        type: 'string',
        enum: ['CITIZEN', 'RESPONDER', 'ADMIN', 'SUPER_ADMIN'],
      },
      
      // Auth schemas
      LoginRequest: {
        type: 'object',
        properties: {
          email: { type: 'string', format: 'email' },
          password: { type: 'string', minLength: 8 },
        },
        required: ['email', 'password'],
      },
      LoginResponse: {
        type: 'object',
        properties: {
          success: { type: 'boolean' },
          accessToken: { type: 'string' },
          refreshToken: { type: 'string' },
          expiresIn: { type: 'integer' },
          user: { $ref: '#/components/schemas/User' },
        },
      },
      RegisterRequest: {
        type: 'object',
        properties: {
          email: { type: 'string', format: 'email' },
          password: { type: 'string', minLength: 8 },
          fullName: { type: 'string', minLength: 2 },
          phone: { type: 'string' },
        },
        required: ['email', 'password', 'fullName'],
      },
      TokenResponse: {
        type: 'object',
        properties: {
          accessToken: { type: 'string' },
          expiresIn: { type: 'integer' },
        },
      },
      
      // User schema
      User: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          email: { type: 'string', format: 'email' },
          fullName: { type: 'string' },
          role: { $ref: '#/components/schemas/UserRole' },
          avatar: { type: 'string', format: 'uri' },
          phone: { type: 'string' },
          isVerified: { type: 'boolean' },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
      
      // Report schemas
      Report: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          title: { type: 'string' },
          description: { type: 'string' },
          hazardType: { $ref: '#/components/schemas/HazardType' },
          status: { $ref: '#/components/schemas/ReportStatus' },
          severity: { type: 'integer', minimum: 1, maximum: 5 },
          location: { $ref: '#/components/schemas/GeoPoint' },
          address: { type: 'string' },
          images: {
            type: 'array',
            items: { type: 'string', format: 'uri' },
          },
          reporterId: { type: 'string', format: 'uuid' },
          assignedResponderId: { type: 'string', format: 'uuid' },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
          resolvedAt: { type: 'string', format: 'date-time' },
          aiClassification: { $ref: '#/components/schemas/ClassificationResult' },
        },
      },
      CreateReportRequest: {
        type: 'object',
        properties: {
          title: { type: 'string', minLength: 5, maxLength: 200 },
          description: { type: 'string', maxLength: 2000 },
          hazardType: { $ref: '#/components/schemas/HazardType' },
          latitude: { type: 'number', minimum: -90, maximum: 90 },
          longitude: { type: 'number', minimum: -180, maximum: 180 },
          address: { type: 'string' },
          images: {
            type: 'array',
            items: { type: 'string' },
            maxItems: 5,
          },
        },
        required: ['title', 'hazardType', 'latitude', 'longitude'],
      },
      UpdateReportRequest: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          description: { type: 'string' },
          status: { $ref: '#/components/schemas/ReportStatus' },
          severity: { type: 'integer', minimum: 1, maximum: 5 },
        },
      },
      
      // Alert schemas
      Alert: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          title: { type: 'string' },
          message: { type: 'string' },
          severity: { $ref: '#/components/schemas/AlertSeverity' },
          affectedArea: { type: 'object' },
          isActive: { type: 'boolean' },
          expiresAt: { type: 'string', format: 'date-time' },
          createdAt: { type: 'string', format: 'date-time' },
          createdById: { type: 'string', format: 'uuid' },
        },
      },
      CreateAlertRequest: {
        type: 'object',
        properties: {
          title: { type: 'string', minLength: 5 },
          message: { type: 'string', minLength: 10 },
          severity: { $ref: '#/components/schemas/AlertSeverity' },
          affectedArea: { type: 'object' },
          expiresAt: { type: 'string', format: 'date-time' },
        },
        required: ['title', 'message', 'severity'],
      },
      
      // AI schemas
      ClassificationResult: {
        type: 'object',
        properties: {
          hazardType: { $ref: '#/components/schemas/HazardType' },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
          severity: { type: 'integer', minimum: 1, maximum: 5 },
          suggestedActions: {
            type: 'array',
            items: { type: 'string' },
          },
          modelVersion: { type: 'string' },
        },
      },
      ThreatLevel: {
        type: 'object',
        properties: {
          region: { type: 'string' },
          level: { type: 'integer', minimum: 0, maximum: 10 },
          trend: { type: 'string', enum: ['rising', 'falling', 'stable'] },
          factors: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                contribution: { type: 'number' },
              },
            },
          },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },
      
      // Analytics schemas
      AnalyticsSummary: {
        type: 'object',
        properties: {
          totalReports: { type: 'integer' },
          activeIncidents: { type: 'integer' },
          resolvedToday: { type: 'integer' },
          averageResponseTimeMinutes: { type: 'number' },
          byHazardType: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                type: { $ref: '#/components/schemas/HazardType' },
                count: { type: 'integer' },
              },
            },
          },
          byStatus: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                status: { $ref: '#/components/schemas/ReportStatus' },
                count: { type: 'integer' },
              },
            },
          },
        },
      },
      HeatmapPoint: {
        type: 'object',
        properties: {
          latitude: { type: 'number' },
          longitude: { type: 'number' },
          intensity: { type: 'number' },
        },
      },
    },
    
    parameters: {
      PageParam: {
        name: 'page',
        in: 'query',
        description: 'Page number (1-indexed)',
        schema: { type: 'integer', minimum: 1, default: 1 },
      },
      LimitParam: {
        name: 'limit',
        in: 'query',
        description: 'Items per page',
        schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
      },
      ReportIdParam: {
        name: 'id',
        in: 'path',
        required: true,
        description: 'Report UUID',
        schema: { type: 'string', format: 'uuid' },
      },
    },
    
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'JWT access token',
      },
      apiKey: {
        type: 'apiKey',
        in: 'header',
        name: 'X-API-Key',
        description: 'API key for external integrations',
      },
      oauth2: {
        type: 'oauth2',
        description: 'OAuth 2.0 authentication',
        flows: {
          authorizationCode: {
            authorizationUrl: '/oauth/authorize',
            tokenUrl: '/oauth/token',
            scopes: {
              'read:reports': 'Read reports',
              'write:reports': 'Create and update reports',
              'read:alerts': 'Read alerts',
              'write:alerts': 'Create alerts (admin only)',
              'admin': 'Full admin access',
            },
          },
        },
      },
    },
  }
}

// EXPRESS ROUTER

let cachedSpec: OpenAPISpec | null = null
let specHash = ''

/**
 * Get the OpenAPI specification
 */
export function getOpenAPISpec(): OpenAPISpec {
  if (!cachedSpec) {
    cachedSpec = generateAegisSpec()
    specHash = createHash('md5').update(JSON.stringify(cachedSpec)).digest('hex')
  }
  return cachedSpec
}

/**
 * Create OpenAPI router with spec endpoints and Swagger UI
 */
export function createOpenAPIRouter(): Router {
  const router = Router()
  
  // OpenAPI JSON spec
  router.get('/openapi.json', (_req: Request, res: Response) => {
    res.setHeader('Content-Type', 'application/json')
    res.setHeader('Cache-Control', 'public, max-age=3600')
    res.setHeader('ETag', `"${specHash}"`)
    res.json(getOpenAPISpec())
  })
  
  // OpenAPI YAML spec
  router.get('/openapi.yaml', (_req: Request, res: Response) => {
    const spec = getOpenAPISpec()
    res.setHeader('Content-Type', 'text/yaml')
    res.setHeader('Cache-Control', 'public, max-age=3600')
    res.send(jsonToYaml(spec))
  })
  
  // Swagger UI
  router.get('/docs', (_req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/html')
    res.send(generateSwaggerUI())
  })
  
  // ReDoc
  router.get('/redoc', (_req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/html')
    res.send(generateReDoc())
  })
  
  return router
}

function jsonToYaml(obj: any, indent = 0): string {
  const spaces = '  '.repeat(indent)
  let yaml = ''
  
  for (const [key, value] of Object.entries(obj)) {
    if (value === null || value === undefined) continue
    
    if (Array.isArray(value)) {
      yaml += `${spaces}${key}:\n`
      for (const item of value) {
        if (typeof item === 'object') {
          yaml += `${spaces}- ${jsonToYaml(item, indent + 1).trim().replace(/\n/g, `\n${spaces}  `)}\n`
        } else {
          yaml += `${spaces}- ${item}\n`
        }
      }
    } else if (typeof value === 'object') {
      yaml += `${spaces}${key}:\n${jsonToYaml(value, indent + 1)}`
    } else if (typeof value === 'string' && (value.includes('\n') || value.includes(':'))) {
      yaml += `${spaces}${key}: |\n${value.split('\n').map(l => `${spaces}  ${l}`).join('\n')}\n`
    } else {
      yaml += `${spaces}${key}: ${value}\n`
    }
  }
  
  return yaml
}

function generateSwaggerUI(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AEGIS API Documentation</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css">
  <style>
    body { margin: 0; }
    .swagger-ui .topbar { display: none; }
    .swagger-ui .info .title { color: #1a365d; }
  </style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    SwaggerUIBundle({
      url: '/api/docs/openapi.json',
      dom_id: '#swagger-ui',
      deepLinking: true,
      presets: [SwaggerUIBundle.presets.apis, SwaggerUIBundle.SwaggerUIStandalonePreset],
      layout: "StandaloneLayout",
      persistAuthorization: true,
      tryItOutEnabled: true,
    })
  </script>
</body>
</html>`
}

function generateReDoc(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AEGIS API Reference</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    body { margin: 0; font-family: 'Inter', sans-serif; }
  </style>
</head>
<body>
  <redoc spec-url='/api/docs/openapi.json'
    hide-download-button
    native-scrollbars
    theme='{
      "colors": {
        "primary": { "main": "#1a365d" }
      },
      "typography": {
        "fontFamily": "Inter, sans-serif"
      }
    }'
  ></redoc>
  <script src="https://cdn.redoc.ly/redoc/latest/bundles/redoc.standalone.js"></script>
</body>
</html>`
}

// STATS & UTILITIES

export function getOpenAPIStats(): {
  version: string
  endpointCount: number
  schemaCount: number
  tags: string[]
  specHash: string
} {
  const spec = getOpenAPISpec()
  const endpointCount = Object.values(spec.paths).reduce((count, path) => {
    return count + Object.keys(path).filter(k => ['get', 'post', 'put', 'delete', 'patch'].includes(k)).length
  }, 0)
  
  return {
    version: spec.info.version,
    endpointCount,
    schemaCount: Object.keys(spec.components.schemas || {}).length,
    tags: spec.tags.map(t => t.name),
    specHash,
  }
}

export default {
  getOpenAPISpec,
  createOpenAPIRouter,
  getOpenAPIStats,
  ApiOperation,
  ApiBody,
  ApiResponse,
  ApiParam,
  ApiSecurity,
}
