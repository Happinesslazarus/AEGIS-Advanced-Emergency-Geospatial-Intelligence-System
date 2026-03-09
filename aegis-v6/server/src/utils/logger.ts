/**
 * Production-safe logging utility.
 * - `devLog()` only emits in non-production (replaces raw console.log).
 * - `auditLog()` always emits (for critical operational events).
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
  // In production, emit structured JSON; in dev, human-readable
  if (isProd) {
    process.stdout.write(JSON.stringify(entry) + '\n')
  } else {
    console.log(`[${tag}] ${message}`, meta ? JSON.stringify(meta) : '')
  }
}
