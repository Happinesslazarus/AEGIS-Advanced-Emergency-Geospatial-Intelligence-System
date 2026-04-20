/**
 * Simple development logging helpers. devLog prints to console only in
 * non-production environments. auditLog writes structured JSON entries
 * for audit-sensitive operations.
 *
 * - devLog used throughout the codebase for debug output
 * - auditLog used by admin routes (cache, community) to record actions
 * - In production, auditLog writes JSON to stdout for log aggregation
 *
 * Note: The main structured logger (Pino) lives in services/logger.ts.
 * This file provides lightweight helpers for simpler use cases.
 */
const isProd = process.env.NODE_ENV === 'production'

export function devLog(...args: unknown[]): void {
  if (!isProd) console.log(...args)
}

export function auditLog(tag: string, message: string, meta?: Record<string, unknown>): void {
  const entry = {
    ts: new Date().toISOString(),
    tag,
    message,
    ...(meta || {}),
  }
  //In production, emit structured JSON; in dev, human-readable
  if (isProd) {
    process.stdout.write(JSON.stringify(entry) + '\n')
  } else {
    console.log(`[${tag}] ${message}`, meta ? JSON.stringify(meta) : '')
  }
}

