/**
 * File: distributedTracing.ts
 *
 * W3C Trace Context-compatible distributed tracing — creates spans with
 * AsyncLocalStorage for per-request context, stores them in a ring buffer,
 * and supports configurable sampling rates. Compatible with Jaeger, Zipkin,
 * Datadog, and AWS X-Ray.
 *
 * How it connects:
 * - Reads/writes traceparent and tracestate headers on requests
 * - Express middleware applied in index.ts for automatic span creation
 * - Span data is exportable to any OpenTelemetry-compatible backend
 *
 * Simple explanation:
 * Traces requests across services so you can see where time is spent.
 */

import crypto from 'crypto'
import { Request, Response, NextFunction } from 'express'
import { logger } from './logger.js'

// W3C Trace Context types
export interface TraceContext {
  traceId: string      // 32 hex chars (128 bits)
  spanId: string       // 16 hex chars (64 bits)
  parentSpanId?: string
  traceFlags: number   // Bit field (01 = sampled)
  traceState?: string  // Vendor-specific key=value pairs
}

export interface Span {
  traceId: string
  spanId: string
  parentSpanId?: string
  operationName: string
  serviceName: string
  startTime: bigint     // nanoseconds since epoch
  endTime?: bigint
  duration?: number     // milliseconds
  status: 'OK' | 'ERROR' | 'UNSET'
  attributes: Record<string, string | number | boolean>
  events: SpanEvent[]
  links: SpanLink[]
}

interface SpanEvent {
  name: string
  timestamp: bigint
  attributes?: Record<string, string | number | boolean>
}

interface SpanLink {
  traceId: string
  spanId: string
  attributes?: Record<string, string | number | boolean>
}

// Configuration
const SERVICE_NAME = process.env.SERVICE_NAME || 'aegis-server'
const SAMPLING_RATE = parseFloat(process.env.TRACE_SAMPLING_RATE || '1.0')
const MAX_SPANS_IN_MEMORY = parseInt(process.env.TRACE_MAX_SPANS || '10000', 10)
const EXPORT_INTERVAL_MS = parseInt(process.env.TRACE_EXPORT_INTERVAL_MS || '5000', 10)

// Ring buffer for efficient span storage
class SpanBuffer {
  private spans: Span[] = []
  private head = 0
  private size = 0
  private maxSize: number

  constructor(maxSize: number) {
    this.maxSize = maxSize
    this.spans = new Array(maxSize)
  }

  push(span: Span): void {
    this.spans[this.head] = span
    this.head = (this.head + 1) % this.maxSize
    if (this.size < this.maxSize) this.size++
  }

  drain(): Span[] {
    const result = this.spans.slice(0, this.size).filter(Boolean)
    this.size = 0
    this.head = 0
    return result
  }

  get length(): number {
    return this.size
  }
}

const spanBuffer = new SpanBuffer(MAX_SPANS_IN_MEMORY)

// Active span context (per-request via AsyncLocalStorage)
import { AsyncLocalStorage } from 'async_hooks'

interface SpanContext {
  span: Span
  trace: TraceContext
}

const asyncContext = new AsyncLocalStorage<SpanContext>()

/**
 * Generate a random trace ID (32 hex chars = 128 bits)
 */
function generateTraceId(): string {
  return crypto.randomBytes(16).toString('hex')
}

/**
 * Generate a random span ID (16 hex chars = 64 bits)
 */
function generateSpanId(): string {
  return crypto.randomBytes(8).toString('hex')
}

/**
 * Parse W3C traceparent header
 * Format: {version}-{trace-id}-{parent-id}-{trace-flags}
 * Example: 00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01
 */
function parseTraceparent(header: string): TraceContext | null {
  const parts = header.split('-')
  if (parts.length !== 4) return null

  const [version, traceId, spanId, flags] = parts

  if (version !== '00') return null
  if (traceId.length !== 32 || !/^[0-9a-f]+$/.test(traceId)) return null
  if (spanId.length !== 16 || !/^[0-9a-f]+$/.test(spanId)) return null

  return {
    traceId,
    spanId,
    parentSpanId: spanId,
    traceFlags: parseInt(flags, 16),
  }
}

/**
 * Format W3C traceparent header
 */
function formatTraceparent(ctx: TraceContext): string {
  const flags = ctx.traceFlags.toString(16).padStart(2, '0')
  return `00-${ctx.traceId}-${ctx.spanId}-${flags}`
}

/**
 * Determine if this trace should be sampled
 */
function shouldSample(traceId: string): boolean {
  if (SAMPLING_RATE >= 1.0) return true
  if (SAMPLING_RATE <= 0.0) return false

  // Deterministic sampling based on trace ID (same trace always sampled/not sampled)
  const hash = parseInt(traceId.slice(0, 8), 16)
  return (hash / 0xffffffff) < SAMPLING_RATE
}

/**
 * Create a new span
 */
export function startSpan(
  operationName: string,
  attributes?: Record<string, string | number | boolean>
): Span {
  const parentContext = asyncContext.getStore()
  const now = process.hrtime.bigint()

  let traceId: string
  let parentSpanId: string | undefined

  if (parentContext) {
    traceId = parentContext.trace.traceId
    parentSpanId = parentContext.span.spanId
  } else {
    traceId = generateTraceId()
  }

  const span: Span = {
    traceId,
    spanId: generateSpanId(),
    parentSpanId,
    operationName,
    serviceName: SERVICE_NAME,
    startTime: now,
    status: 'UNSET',
    attributes: {
      'service.name': SERVICE_NAME,
      'service.version': '6.9.0',
      ...attributes,
    },
    events: [],
    links: [],
  }

  return span
}

/**
 * End a span and record it
 */
export function endSpan(span: Span, status?: 'OK' | 'ERROR'): void {
  span.endTime = process.hrtime.bigint()
  span.duration = Number(span.endTime - span.startTime) / 1_000_000 // ms
  span.status = status || 'OK'
  spanBuffer.push(span)
}

/**
 * Add an event to the current span
 */
export function addSpanEvent(
  span: Span,
  name: string,
  attributes?: Record<string, string | number | boolean>
): void {
  span.events.push({
    name,
    timestamp: process.hrtime.bigint(),
    attributes,
  })
}

/**
 * Record an error on a span
 */
export function recordError(span: Span, error: Error): void {
  span.status = 'ERROR'
  span.attributes['error'] = true
  span.attributes['error.type'] = error.name
  span.attributes['error.message'] = error.message
  if (process.env.NODE_ENV !== 'production') {
    span.attributes['error.stack'] = error.stack || ''
  }
  addSpanEvent(span, 'exception', {
    'exception.type': error.name,
    'exception.message': error.message,
  })
}

/**
 * Get the current active span
 */
export function getCurrentSpan(): Span | undefined {
  return asyncContext.getStore()?.span
}

/**
 * Get the current trace context
 */
export function getCurrentTraceContext(): TraceContext | undefined {
  return asyncContext.getStore()?.trace
}

/**
 * Run a function within a span context
 */
export async function withSpan<T>(
  operationName: string,
  fn: (span: Span) => Promise<T>,
  attributes?: Record<string, string | number | boolean>
): Promise<T> {
  const span = startSpan(operationName, attributes)
  const trace: TraceContext = {
    traceId: span.traceId,
    spanId: span.spanId,
    parentSpanId: span.parentSpanId,
    traceFlags: shouldSample(span.traceId) ? 1 : 0,
  }

  return asyncContext.run({ span, trace }, async () => {
    try {
      const result = await fn(span)
      endSpan(span, 'OK')
      return result
    } catch (error) {
      recordError(span, error as Error)
      endSpan(span, 'ERROR')
      throw error
    }
  })
}

/**
 * Express middleware for distributed tracing
 */
export function tracingMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  // Parse incoming trace context
  const traceparent = req.headers['traceparent'] as string | undefined
  const tracestate = req.headers['tracestate'] as string | undefined

  let trace: TraceContext
  let parentSpanId: string | undefined

  if (traceparent) {
    const parsed = parseTraceparent(traceparent)
    if (parsed) {
      trace = {
        ...parsed,
        spanId: generateSpanId(), // New span for this service
        traceState: tracestate,
      }
      parentSpanId = parsed.spanId
    } else {
      trace = {
        traceId: generateTraceId(),
        spanId: generateSpanId(),
        traceFlags: shouldSample(generateTraceId()) ? 1 : 0,
      }
    }
  } else {
    const traceId = generateTraceId()
    trace = {
      traceId,
      spanId: generateSpanId(),
      traceFlags: shouldSample(traceId) ? 1 : 0,
    }
  }

  // Create root span for this request
  const span: Span = {
    traceId: trace.traceId,
    spanId: trace.spanId,
    parentSpanId,
    operationName: `${req.method} ${req.path}`,
    serviceName: SERVICE_NAME,
    startTime: process.hrtime.bigint(),
    status: 'UNSET',
    attributes: {
      'http.method': req.method,
      'http.url': req.originalUrl,
      'http.target': req.path,
      'http.host': req.hostname,
      'http.scheme': req.protocol,
      'http.user_agent': req.headers['user-agent'] || '',
      'http.request_content_length': req.headers['content-length'] || 0,
      'net.peer.ip': req.ip || '',
      'service.name': SERVICE_NAME,
    },
    events: [],
    links: [],
  }

  // Propagate trace context in response headers
  res.setHeader('traceparent', formatTraceparent(trace))
  if (trace.traceState) {
    res.setHeader('tracestate', trace.traceState)
  }

  // Store trace ID for logging correlation
  const traceIdValue: string = trace.traceId
  const spanIdValue: string = trace.spanId
  ;(req as any).traceId = traceIdValue
  ;(req as any).spanId = spanIdValue

  // Capture response data
  res.on('finish', () => {
    span.attributes['http.status_code'] = res.statusCode
    const contentLength = res.getHeader('content-length')
    span.attributes['http.response_content_length'] = typeof contentLength === 'string' 
      ? parseInt(contentLength, 10) || 0 
      : typeof contentLength === 'number' 
        ? contentLength 
        : 0

    if (res.statusCode >= 500) {
      span.status = 'ERROR'
      span.attributes['error'] = true
    } else {
      span.status = 'OK'
    }

    endSpan(span)
  })

  // Run request in async context
  asyncContext.run({ span, trace }, () => {
    next()
  })
}

/**
 * Export spans to configured backend
 */
async function exportSpans(): Promise<void> {
  const spans = spanBuffer.drain()
  if (spans.length === 0) return

  const otlpEndpoint = process.env.OTLP_ENDPOINT

  if (otlpEndpoint) {
    // Export to OTLP-compatible backend (Jaeger, Zipkin, etc.)
    try {
      const payload = {
        resourceSpans: [{
          resource: {
            attributes: [
              { key: 'service.name', value: { stringValue: SERVICE_NAME } },
              { key: 'service.version', value: { stringValue: '6.9.0' } },
            ]
          },
          scopeSpans: [{
            scope: { name: 'aegis-tracing', version: '1.0.0' },
            spans: spans.map(span => ({
              traceId: span.traceId,
              spanId: span.spanId,
              parentSpanId: span.parentSpanId,
              name: span.operationName,
              kind: 2, // SERVER
              startTimeUnixNano: span.startTime.toString(),
              endTimeUnixNano: span.endTime?.toString(),
              attributes: Object.entries(span.attributes).map(([k, v]) => ({
                key: k,
                value: typeof v === 'string' ? { stringValue: v } :
                       typeof v === 'number' ? { intValue: v } :
                       { boolValue: v }
              })),
              events: span.events.map(e => ({
                name: e.name,
                timeUnixNano: e.timestamp.toString(),
                attributes: e.attributes ? Object.entries(e.attributes).map(([k, v]) => ({
                  key: k,
                  value: typeof v === 'string' ? { stringValue: v } :
                         typeof v === 'number' ? { intValue: v } :
                         { boolValue: v }
                })) : []
              })),
              status: {
                code: span.status === 'OK' ? 1 : span.status === 'ERROR' ? 2 : 0
              }
            }))
          }]
        }]
      }

      await fetch(`${otlpEndpoint}/v1/traces`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(5000),
      })
    } catch (err) {
      logger.warn({ error: (err as Error).message, spanCount: spans.length }, '[Tracing] Failed to export spans to OTLP')
    }
  } else if (process.env.NODE_ENV !== 'production') {
    // Dev mode: log spans to console
    for (const span of spans.slice(0, 5)) {
      logger.debug({
        traceId: span.traceId.slice(0, 8),
        spanId: span.spanId.slice(0, 8),
        operation: span.operationName,
        durationMs: span.duration?.toFixed(2),
        status: span.status,
      }, '[Tracing] Span completed')
    }
    if (spans.length > 5) {
      logger.debug({ count: spans.length - 5 }, '[Tracing] ... and more spans')
    }
  }
}

// Start export interval
setInterval(exportSpans, EXPORT_INTERVAL_MS)

/**
 * Get tracing statistics
 */
export function getTracingStats(): {
  spansInBuffer: number
  samplingRate: number
  serviceName: string
} {
  return {
    spansInBuffer: spanBuffer.length,
    samplingRate: SAMPLING_RATE,
    serviceName: SERVICE_NAME,
  }
}

export default tracingMiddleware
