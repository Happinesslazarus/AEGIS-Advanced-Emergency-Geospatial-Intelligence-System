/**
 * IP blocklist/allowlist middleware — maintains in-memory lists synced from
 * PostgreSQL (ip_blocklist, ip_allowlist, geo_restrictions) and auto-blocks
 * IPs after 20 failed attempts.
 *
 * - Express middleware that runs before route handlers
 * - Creates and manages three DB tables on init
 * - Periodically cleans expired block entries
 * */

import { Request, Response, NextFunction } from 'express'
import pool from '../models/db.js'
import { AppError } from '../utils/AppError.js'

export interface IPBlockEntry {
  ip: string
  reason: string
  blockedAt: Date
  expiresAt: Date | null
  blockedBy: string
  autoBlocked: boolean
}

export interface IPAllowEntry {
  ip: string
  description: string
  addedAt: Date
  addedBy: string
  scope: 'admin' | 'api' | 'all'
}

export interface GeoRestriction {
  countryCode: string
  action: 'allow' | 'block'
  scope: 'admin' | 'api' | 'all'
}

// In-memory caches for performance (synced with DB periodically)
const blocklist = new Map<string, IPBlockEntry>()
const allowlist = new Map<string, IPAllowEntry>()
const geoRestrictions = new Map<string, GeoRestriction>()
const tempBlocks = new Map<string, { expiresAt: number; reason: string }>()

// Configuration
const config = {
  enableGeoBlocking: process.env.ENABLE_GEO_BLOCKING === 'true',
  enableIPBlocking: process.env.ENABLE_IP_BLOCKING !== 'false', // Default enabled
  adminAllowlistOnly: process.env.ADMIN_ALLOWLIST_ONLY === 'true',
  autoBlockThreshold: 20, // Auto-block after 20 failed attempts in 5 min
  autoBlockDurationMs: 60 * 60 * 1000, // 1 hour auto-block
  syncIntervalMs: 60 * 1000, // Sync with DB every minute
}

// Suspicious activity tracking
const suspiciousActivity = new Map<string, { count: number; firstSeen: number }>()

/**
 * Initialize IP security service
 */
export async function initIPSecurity(): Promise<void> {
  try {
    // Create tables if they don't exist
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ip_blocklist (
        ip VARCHAR(45) PRIMARY KEY,
        reason TEXT NOT NULL,
        blocked_at TIMESTAMPTZ DEFAULT NOW(),
        expires_at TIMESTAMPTZ,
        blocked_by VARCHAR(255),
        auto_blocked BOOLEAN DEFAULT false
      );
      
      CREATE TABLE IF NOT EXISTS ip_allowlist (
        ip VARCHAR(45) PRIMARY KEY,
        description TEXT,
        added_at TIMESTAMPTZ DEFAULT NOW(),
        added_by VARCHAR(255),
        scope VARCHAR(20) DEFAULT 'all'
      );
      
      CREATE TABLE IF NOT EXISTS geo_restrictions (
        country_code CHAR(2) PRIMARY KEY,
        action VARCHAR(10) NOT NULL,
        scope VARCHAR(20) DEFAULT 'all',
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      
      CREATE INDEX IF NOT EXISTS idx_ip_blocklist_expires ON ip_blocklist(expires_at);
    `)
    
    // Load initial data
    await syncFromDatabase()
    
    // Start periodic sync
    setInterval(syncFromDatabase, config.syncIntervalMs)
    
    // Clean expired blocks periodically
    setInterval(cleanExpiredBlocks, 60 * 1000)
    
    console.log('[IPSecurity] Service initialized')
  } catch (error: any) {
    console.error('[IPSecurity] Init failed:', error.message)
  }
}

/**
 * Sync blocklist/allowlist from database
 */
async function syncFromDatabase(): Promise<void> {
  try {
    // Sync blocklist
    const blockResult = await pool.query(`
      SELECT ip, reason, blocked_at, expires_at, blocked_by, auto_blocked
      FROM ip_blocklist
      WHERE expires_at IS NULL OR expires_at > NOW()
    `)
    blocklist.clear()
    for (const row of blockResult.rows) {
      blocklist.set(row.ip, {
        ip: row.ip,
        reason: row.reason,
        blockedAt: row.blocked_at,
        expiresAt: row.expires_at,
        blockedBy: row.blocked_by,
        autoBlocked: row.auto_blocked,
      })
    }
    
    // Sync allowlist
    const allowResult = await pool.query(`
      SELECT ip, description, added_at, added_by, scope
      FROM ip_allowlist
    `)
    allowlist.clear()
    for (const row of allowResult.rows) {
      allowlist.set(row.ip, {
        ip: row.ip,
        description: row.description,
        addedAt: row.added_at,
        addedBy: row.added_by,
        scope: row.scope,
      })
    }
    
    // Sync geo restrictions
    const geoResult = await pool.query(`
      SELECT country_code, action, scope
      FROM geo_restrictions
    `)
    geoRestrictions.clear()
    for (const row of geoResult.rows) {
      geoRestrictions.set(row.country_code, {
        countryCode: row.country_code,
        action: row.action,
        scope: row.scope,
      })
    }
  } catch (error: any) {
    console.error('[IPSecurity] Sync failed:', error.message)
  }
}

/**
 * Clean expired temporary blocks
 */
function cleanExpiredBlocks(): void {
  const now = Date.now()
  for (const [ip, block] of tempBlocks) {
    if (block.expiresAt < now) {
      tempBlocks.delete(ip)
    }
  }
  
  // Clean old suspicious activity entries
  const cutoff = now - 5 * 60 * 1000 // 5 minutes
  for (const [ip, activity] of suspiciousActivity) {
    if (activity.firstSeen < cutoff) {
      suspiciousActivity.delete(ip)
    }
  }
}

/**
 * Check if IP is blocked
 */
export function isIPBlocked(ip: string): { blocked: boolean; reason?: string } {
  if (!config.enableIPBlocking) {
    return { blocked: false }
  }
  
  // Check temporary blocks first
  const tempBlock = tempBlocks.get(ip)
  if (tempBlock && tempBlock.expiresAt > Date.now()) {
    return { blocked: true, reason: tempBlock.reason }
  }
  
  // Check permanent/timed blocklist
  const entry = blocklist.get(ip)
  if (entry) {
    if (!entry.expiresAt || entry.expiresAt > new Date()) {
      return { blocked: true, reason: entry.reason }
    }
  }
  
  // Check CIDR ranges (simplified - exact match for now)
  // Production would use proper CIDR matching
  for (const [blockedIP, blockEntry] of blocklist) {
    if (blockedIP.includes('/')) {
      // Basic CIDR support
      const [network] = blockedIP.split('/')
      if (ip.startsWith(network.split('.').slice(0, 3).join('.'))) {
        return { blocked: true, reason: blockEntry.reason }
      }
    }
  }
  
  return { blocked: false }
}

/**
 * Check if IP is in allowlist for given scope
 */
export function isIPAllowed(ip: string, scope: 'admin' | 'api' | 'all'): boolean {
  if (allowlist.size === 0) {
    return true // No allowlist = allow all
  }
  
  const entry = allowlist.get(ip)
  if (!entry) {
    // Check if localhost/private always allowed
    if (ip === '127.0.0.1' || ip === '::1' || ip.startsWith('192.168.') || ip.startsWith('10.')) {
      return true
    }
    return false
  }
  
  return entry.scope === 'all' || entry.scope === scope
}

/**
 * Record suspicious activity and auto-block if threshold exceeded
 */
export async function recordSuspiciousActivity(
  ip: string,
  activity: string
): Promise<{ blocked: boolean }> {
  const now = Date.now()
  const existing = suspiciousActivity.get(ip) || { count: 0, firstSeen: now }
  
  // Reset if window expired
  if (now - existing.firstSeen > 5 * 60 * 1000) {
    existing.count = 0
    existing.firstSeen = now
  }
  
  existing.count++
  suspiciousActivity.set(ip, existing)
  
  // Auto-block if threshold exceeded
  if (existing.count >= config.autoBlockThreshold) {
    await blockIP(ip, `Auto-blocked: ${existing.count} ${activity} in 5 minutes`, {
      durationMs: config.autoBlockDurationMs,
      autoBlocked: true,
    })
    return { blocked: true }
  }
  
  return { blocked: false }
}

/**
 * Block an IP address
 */
export async function blockIP(
  ip: string,
  reason: string,
  options: {
    durationMs?: number
    blockedBy?: string
    autoBlocked?: boolean
  } = {}
): Promise<void> {
  const expiresAt = options.durationMs
    ? new Date(Date.now() + options.durationMs)
    : null
  
  // Add to memory cache immediately
  if (options.durationMs && options.durationMs < 24 * 60 * 60 * 1000) {
    // Temporary block - use in-memory only for short durations
    tempBlocks.set(ip, {
      expiresAt: Date.now() + options.durationMs,
      reason,
    })
  } else {
    // Persist to database
    await pool.query(`
      INSERT INTO ip_blocklist (ip, reason, expires_at, blocked_by, auto_blocked)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (ip) DO UPDATE SET
        reason = EXCLUDED.reason,
        blocked_at = NOW(),
        expires_at = EXCLUDED.expires_at,
        blocked_by = EXCLUDED.blocked_by,
        auto_blocked = EXCLUDED.auto_blocked
    `, [ip, reason, expiresAt, options.blockedBy || 'system', options.autoBlocked || false])
    
    blocklist.set(ip, {
      ip,
      reason,
      blockedAt: new Date(),
      expiresAt,
      blockedBy: options.blockedBy || 'system',
      autoBlocked: options.autoBlocked || false,
    })
  }
  
  console.log(`[IPSecurity] Blocked IP: ${ip} - ${reason}`)
}

/**
 * Unblock an IP address
 */
export async function unblockIP(ip: string): Promise<void> {
  await pool.query('DELETE FROM ip_blocklist WHERE ip = $1', [ip])
  blocklist.delete(ip)
  tempBlocks.delete(ip)
  console.log(`[IPSecurity] Unblocked IP: ${ip}`)
}

/**
 * Add IP to allowlist
 */
export async function addToAllowlist(
  ip: string,
  description: string,
  options: { scope?: 'admin' | 'api' | 'all'; addedBy?: string } = {}
): Promise<void> {
  const scope = options.scope || 'all'
  
  await pool.query(`
    INSERT INTO ip_allowlist (ip, description, added_by, scope)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (ip) DO UPDATE SET
      description = EXCLUDED.description,
      scope = EXCLUDED.scope
  `, [ip, description, options.addedBy || 'system', scope])
  
  allowlist.set(ip, {
    ip,
    description,
    addedAt: new Date(),
    addedBy: options.addedBy || 'system',
    scope,
  })
}

/**
 * Remove IP from allowlist
 */
export async function removeFromAllowlist(ip: string): Promise<void> {
  await pool.query('DELETE FROM ip_allowlist WHERE ip = $1', [ip])
  allowlist.delete(ip)
}

/**
 * Set geographic restriction
 */
export async function setGeoRestriction(
  countryCode: string,
  action: 'allow' | 'block',
  scope: 'admin' | 'api' | 'all' = 'all'
): Promise<void> {
  await pool.query(`
    INSERT INTO geo_restrictions (country_code, action, scope)
    VALUES ($1, $2, $3)
    ON CONFLICT (country_code) DO UPDATE SET
      action = EXCLUDED.action,
      scope = EXCLUDED.scope
  `, [countryCode.toUpperCase(), action, scope])
  
  geoRestrictions.set(countryCode.toUpperCase(), { countryCode, action, scope })
}

/**
 * Express middleware for IP blocking
 */
export function ipBlockMiddleware(req: Request, res: Response, next: NextFunction): void {
  const ip = req.ip || req.socket.remoteAddress || '0.0.0.0'
  
  const blockCheck = isIPBlocked(ip)
  if (blockCheck.blocked) {
    res.status(403).json({
      success: false,
      error: {
        code: 'IP_BLOCKED',
        message: 'Access denied from your IP address',
      },
    })
    return
  }
  
  next()
}

/**
 * Express middleware for admin allowlist enforcement
 */
export function adminAllowlistMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (!config.adminAllowlistOnly) {
    return next()
  }
  
  const ip = req.ip || req.socket.remoteAddress || '0.0.0.0'
  
  if (!isIPAllowed(ip, 'admin')) {
    res.status(403).json({
      success: false,
      error: {
        code: 'IP_NOT_ALLOWED',
        message: 'Admin access restricted to allowed IP addresses',
      },
    })
    return
  }
  
  next()
}

/**
 * Get IP security stats for admin dashboard
 */
export function getIPSecurityStats(): {
  blockedCount: number
  allowedCount: number
  tempBlockCount: number
  geoRestrictionsCount: number
  recentBlocks: IPBlockEntry[]
} {
  const recentBlocks = Array.from(blocklist.values())
    .sort((a, b) => b.blockedAt.getTime() - a.blockedAt.getTime())
    .slice(0, 10)
  
  return {
    blockedCount: blocklist.size,
    allowedCount: allowlist.size,
    tempBlockCount: tempBlocks.size,
    geoRestrictionsCount: geoRestrictions.size,
    recentBlocks,
  }
}

/**
 * Get full blocklist for admin
 */
export function getBlocklist(): IPBlockEntry[] {
  return Array.from(blocklist.values())
}

/**
 * Get full allowlist for admin
 */
export function getAllowlist(): IPAllowEntry[] {
  return Array.from(allowlist.values())
}

export default {
  initIPSecurity,
  isIPBlocked,
  isIPAllowed,
  recordSuspiciousActivity,
  blockIP,
  unblockIP,
  addToAllowlist,
  removeFromAllowlist,
  setGeoRestriction,
  ipBlockMiddleware,
  adminAllowlistMiddleware,
  getIPSecurityStats,
  getBlocklist,
  getAllowlist,
}
