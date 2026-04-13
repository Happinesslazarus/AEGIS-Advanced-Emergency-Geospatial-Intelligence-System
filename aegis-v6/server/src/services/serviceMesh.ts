/**
 * File: serviceMesh.ts
 *
 * Istio/Envoy service mesh integration — Express middleware that extracts
 * mTLS identity, propagates B3 tracing and x-request-id headers, tracks
 * mesh retries, and generates Istio VirtualService/DestinationRule configs.
 *
 * How it connects:
 * - Express middleware that reads/sets mesh-related headers
 * - Exposes Prometheus metrics for mesh traffic
 * - Provides mesh-aware health and readiness handlers
 *
 * Simple explanation:
 * Makes the app play nicely with Kubernetes service mesh infrastructure.
 */

import { Request, Response, NextFunction } from 'express'
import client from 'prom-client'
import { logger } from './logger.js'

// Prometheus metrics
const meshRequestsTotal = new client.Counter({
  name: 'aegis_mesh_requests_total',
  help: 'Requests processed with mesh integration',
  labelNames: ['source_service', 'destination_version'] as const,
})

const meshRetries = new client.Counter({
  name: 'aegis_mesh_retries_total',
  help: 'Retry attempts signaled by mesh',
  labelNames: ['source_service'] as const,
})

// Service identity
const SERVICE_NAME = process.env.SERVICE_NAME || 'aegis-server'
const SERVICE_VERSION = process.env.SERVICE_VERSION || process.env.APP_VERSION || '6.9.0'
const SERVICE_NAMESPACE = process.env.KUBERNETES_NAMESPACE || process.env.POD_NAMESPACE || 'default'
const POD_NAME = process.env.HOSTNAME || process.env.POD_NAME || 'unknown'

// Istio/Envoy headers
const MESH_HEADERS = {
  // Istio identity
  X_FORWARDED_CLIENT_CERT: 'x-forwarded-client-cert',
  X_ENVOY_PEER_METADATA: 'x-envoy-peer-metadata',
  X_ENVOY_PEER_METADATA_ID: 'x-envoy-peer-metadata-id',
  
  // Traffic management
  X_ENVOY_UPSTREAM_SERVICE_TIME: 'x-envoy-upstream-service-time',
  X_ENVOY_EXPECTED_RQ_TIMEOUT_MS: 'x-envoy-expected-rq-timeout-ms',
  X_ENVOY_MAX_RETRIES: 'x-envoy-max-retries',
  X_ENVOY_RETRY_ON: 'x-envoy-retry-on',
  X_ENVOY_RETRY_GRPC_ON: 'x-envoy-retry-grpc-on',
  
  // Routing
  X_ENVOY_DECORATOR_OPERATION: 'x-envoy-decorator-operation',
  X_ENVOY_ORIGINAL_PATH: 'x-envoy-original-path',
  
  // Tracing (B3 format for Zipkin/Jaeger)
  X_B3_TRACEID: 'x-b3-traceid',
  X_B3_SPANID: 'x-b3-spanid',
  X_B3_PARENTSPANID: 'x-b3-parentspanid',
  X_B3_SAMPLED: 'x-b3-sampled',
  X_B3_FLAGS: 'x-b3-flags',
  
  // Request metadata
  X_REQUEST_ID: 'x-request-id',
  X_OT_SPAN_CONTEXT: 'x-ot-span-context',
  
  // AEGIS custom headers
  X_AEGIS_VERSION: 'x-aegis-version',
  X_AEGIS_INSTANCE: 'x-aegis-instance',
  X_AEGIS_CANARY: 'x-aegis-canary',
} as const

// Headers to propagate to downstream services
const PROPAGATE_HEADERS = [
  MESH_HEADERS.X_REQUEST_ID,
  MESH_HEADERS.X_B3_TRACEID,
  MESH_HEADERS.X_B3_SPANID,
  MESH_HEADERS.X_B3_PARENTSPANID,
  MESH_HEADERS.X_B3_SAMPLED,
  MESH_HEADERS.X_B3_FLAGS,
  MESH_HEADERS.X_OT_SPAN_CONTEXT,
  MESH_HEADERS.X_ENVOY_EXPECTED_RQ_TIMEOUT_MS,
  'traceparent',
  'tracestate',
] as const

interface MeshContext {
  requestId: string
  sourceService?: string
  sourceVersion?: string
  traceId?: string
  spanId?: string
  parentSpanId?: string
  sampled: boolean
  expectedTimeout?: number
  maxRetries?: number
  isCanary: boolean
  mtlsEnabled: boolean
  clientCert?: string
}

/**
 * Extract mesh context from request headers
 */
export function extractMeshContext(req: Request): MeshContext {
  const requestId = (req.headers[MESH_HEADERS.X_REQUEST_ID] as string) || 
                    (req as any).requestId || 
                    generateRequestId()

  // Parse client cert for mTLS
  const clientCert = req.headers[MESH_HEADERS.X_FORWARDED_CLIENT_CERT] as string
  
  // Parse peer metadata for source service info
  let sourceService: string | undefined
  let sourceVersion: string | undefined
  
  const peerMetadataId = req.headers[MESH_HEADERS.X_ENVOY_PEER_METADATA_ID] as string
  if (peerMetadataId) {
    // Format: router~<ip>~<service>.<namespace>.<domain>~<namespace>.svc.cluster.local
    const parts = peerMetadataId.split('~')
    if (parts.length >= 3) {
      const servicePart = parts[2].split('.')[0]
      sourceService = servicePart
    }
  }

  // B3 tracing headers
  const traceId = req.headers[MESH_HEADERS.X_B3_TRACEID] as string
  const spanId = req.headers[MESH_HEADERS.X_B3_SPANID] as string
  const parentSpanId = req.headers[MESH_HEADERS.X_B3_PARENTSPANID] as string
  const sampled = req.headers[MESH_HEADERS.X_B3_SAMPLED] === '1'

  // Timeout and retry config from Envoy
  const expectedTimeout = req.headers[MESH_HEADERS.X_ENVOY_EXPECTED_RQ_TIMEOUT_MS] 
    ? parseInt(req.headers[MESH_HEADERS.X_ENVOY_EXPECTED_RQ_TIMEOUT_MS] as string, 10)
    : undefined

  const maxRetries = req.headers[MESH_HEADERS.X_ENVOY_MAX_RETRIES]
    ? parseInt(req.headers[MESH_HEADERS.X_ENVOY_MAX_RETRIES] as string, 10)
    : undefined

  // Canary detection
  const isCanary = req.headers[MESH_HEADERS.X_AEGIS_CANARY] === 'true' ||
                   SERVICE_VERSION.includes('canary') ||
                   process.env.DEPLOYMENT_TYPE === 'canary'

  return {
    requestId,
    sourceService,
    sourceVersion,
    traceId,
    spanId,
    parentSpanId,
    sampled,
    expectedTimeout,
    maxRetries,
    isCanary,
    mtlsEnabled: !!clientCert,
    clientCert,
  }
}

/**
 * Service mesh middleware — adds mesh headers and extracts context
 */
export function serviceMeshMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const meshContext = extractMeshContext(req)
  
  // Attach mesh context to request
  ;(req as any).meshContext = meshContext

  // Track mesh metrics
  if (meshContext.sourceService) {
    meshRequestsTotal.labels(meshContext.sourceService, SERVICE_VERSION).inc()
  }

  // Track retries
  const envoyRetryCount = req.headers['x-envoy-attempt-count'] as string
  if (envoyRetryCount && parseInt(envoyRetryCount, 10) > 1) {
    meshRetries.labels(meshContext.sourceService || 'unknown').inc()
  }

  // Add response headers
  res.setHeader(MESH_HEADERS.X_REQUEST_ID, meshContext.requestId)
  res.setHeader(MESH_HEADERS.X_AEGIS_VERSION, SERVICE_VERSION)
  res.setHeader(MESH_HEADERS.X_AEGIS_INSTANCE, POD_NAME)
  
  if (meshContext.isCanary) {
    res.setHeader(MESH_HEADERS.X_AEGIS_CANARY, 'true')
  }

  // Add upstream service time on response finish
  const requestStart = Date.now()
  res.on('finish', () => {
    const duration = Date.now() - requestStart
    // Note: setHeader won't work after finish, this is for logging
    logger.debug({
      requestId: meshContext.requestId,
      upstreamServiceTimeMs: duration,
      sourceService: meshContext.sourceService,
    }, '[ServiceMesh] Request completed')
  })

  next()
}

/**
 * Get headers to propagate to downstream services
 */
export function getPropagatableHeaders(req: Request): Record<string, string> {
  const headers: Record<string, string> = {}
  
  for (const header of PROPAGATE_HEADERS) {
    const value = req.headers[header]
    if (value && typeof value === 'string') {
      headers[header] = value
    }
  }

  // Ensure request ID is always propagated
  const meshContext = (req as any).meshContext as MeshContext | undefined
  if (meshContext?.requestId) {
    headers[MESH_HEADERS.X_REQUEST_ID] = meshContext.requestId
  }

  return headers
}

/**
 * Generate request ID (compatible with Istio format)
 */
function generateRequestId(): string {
  // UUID v4 format expected by most meshes
  const hex = Array.from({ length: 32 }, () => 
    Math.floor(Math.random() * 16).toString(16)
  ).join('')
  
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}

/**
 * Health check endpoint compatible with Istio/Envoy health probes
 */
export function meshHealthHandler(_req: Request, res: Response): void {
  res.status(200).json({
    status: 'healthy',
    service: SERVICE_NAME,
    version: SERVICE_VERSION,
    namespace: SERVICE_NAMESPACE,
    pod: POD_NAME,
  })
}

/**
 * Ready check endpoint for mesh traffic management
 */
export function meshReadyHandler(_req: Request, res: Response): void {
  // Add mesh-specific readiness checks
  const ready = true // Could check mesh sidecar connectivity
  
  if (ready) {
    res.status(200).json({
      status: 'ready',
      service: SERVICE_NAME,
      version: SERVICE_VERSION,
    })
  } else {
    res.status(503).json({
      status: 'not_ready',
      reason: 'Mesh sidecar not ready',
    })
  }
}

/**
 * Get service identity for mesh registration
 */
export function getServiceIdentity(): {
  name: string
  version: string
  namespace: string
  pod: string
  meshEnabled: boolean
} {
  return {
    name: SERVICE_NAME,
    version: SERVICE_VERSION,
    namespace: SERVICE_NAMESPACE,
    pod: POD_NAME,
    meshEnabled: !!process.env.ISTIO_META_MESH_ID || 
                 !!process.env.ENVOY_ADMIN_PORT,
  }
}

/**
 * Generate Istio VirtualService annotations for this service
 */
export function getVirtualServiceConfig(): Record<string, any> {
  return {
    apiVersion: 'networking.istio.io/v1beta1',
    kind: 'VirtualService',
    metadata: {
      name: SERVICE_NAME,
      namespace: SERVICE_NAMESPACE,
    },
    spec: {
      hosts: [SERVICE_NAME],
      http: [
        {
          // Canary routing
          match: [
            {
              headers: {
                [MESH_HEADERS.X_AEGIS_CANARY]: { exact: 'true' },
              },
            },
          ],
          route: [
            {
              destination: {
                host: SERVICE_NAME,
                subset: 'canary',
              },
            },
          ],
        },
        {
          // Default route with retry policy
          route: [
            {
              destination: {
                host: SERVICE_NAME,
                subset: 'stable',
              },
            },
          ],
          retries: {
            attempts: 3,
            perTryTimeout: '10s',
            retryOn: 'connect-failure,refused-stream,unavailable,cancelled,resource-exhausted,retriable-status-codes',
          },
          timeout: '30s',
        },
      ],
    },
  }
}

/**
 * Generate DestinationRule for traffic policies
 */
export function getDestinationRuleConfig(): Record<string, any> {
  return {
    apiVersion: 'networking.istio.io/v1beta1',
    kind: 'DestinationRule',
    metadata: {
      name: SERVICE_NAME,
      namespace: SERVICE_NAMESPACE,
    },
    spec: {
      host: SERVICE_NAME,
      trafficPolicy: {
        connectionPool: {
          tcp: {
            maxConnections: 100,
            connectTimeout: '10s',
          },
          http: {
            h2UpgradePolicy: 'UPGRADE',
            http1MaxPendingRequests: 100,
            http2MaxRequests: 1000,
            maxRequestsPerConnection: 10,
            maxRetries: 3,
          },
        },
        loadBalancer: {
          simple: 'LEAST_REQUEST',
        },
        outlierDetection: {
          consecutive5xxErrors: 5,
          interval: '10s',
          baseEjectionTime: '30s',
          maxEjectionPercent: 50,
        },
      },
      subsets: [
        {
          name: 'stable',
          labels: {
            version: 'stable',
          },
        },
        {
          name: 'canary',
          labels: {
            version: 'canary',
          },
        },
      ],
    },
  }
}

// Track stats for admin introspection
let meshStats = { requestsHandled: 0, lastRequest: null as Date | null }

/**
 * Get service mesh statistics for admin introspection
 */
export function getMeshStats(): {
  identity: ReturnType<typeof getServiceIdentity>
  requestsHandled: number
  lastRequest: Date | null
  headers: typeof MESH_HEADERS
} {
  return {
    identity: getServiceIdentity(),
    requestsHandled: meshStats.requestsHandled,
    lastRequest: meshStats.lastRequest,
    headers: MESH_HEADERS,
  }
}

// Increment stats counter (called internally by middleware)
export function incrementMeshStats(): void {
  meshStats.requestsHandled++
  meshStats.lastRequest = new Date()
}

export default {
  serviceMeshMiddleware,
  extractMeshContext,
  getPropagatableHeaders,
  meshHealthHandler,
  meshReadyHandler,
  getServiceIdentity,
  getVirtualServiceConfig,
  getDestinationRuleConfig,
  getMeshStats,
  MESH_HEADERS,
}
