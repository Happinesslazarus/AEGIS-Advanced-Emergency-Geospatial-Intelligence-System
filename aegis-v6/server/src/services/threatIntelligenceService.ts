/**
 * File: threatIntelligenceService.ts
 *
 * IP threat intelligence — queries AbuseIPDB, GreyNoise, Tor exit node lists,
 * and datacenter IP ranges to produce a 0–100 risk score per IP. Caches results
 * in memory + DB (threat_intel_cache, threat_feed) with 24-hour TTL.
 *
 * How it connects:
 * - Called by ipSecurityService and auth middleware on incoming requests
 * - Creates threat_intel_cache and threat_feed tables on init
 * - Auto-blocks IPs scoring above 90
 *
 * Simple explanation:
 * Looks up whether an IP address is known to be malicious before letting it in.
 */

import crypto from 'crypto'
import pool from '../models/db.js'
import { logger } from '../services/logger.js'

export interface ThreatIntelResult {
  ip: string
  isMalicious: boolean
  riskScore: number // 0-100
  categories: string[]
  sources: {
    abuseIPDB?: {
      confidence: number
      totalReports: number
      lastReported: Date | null
      categories: string[]
      countryCode: string
      isp: string
    }
    greyNoise?: {
      classification: 'benign' | 'malicious' | 'unknown'
      actor: string | null
      tags: string[]
    }
    torExitNode: boolean
    vpnProxy: boolean
    datacenter: boolean
  }
  cached: boolean
  queriedAt: Date
}

export interface ThreatFeedEntry {
  ip: string
  threatType: string
  confidence: number
  source: string
  addedAt: Date
  expiresAt: Date
}

// Configuration
const config = {
  abuseIPDBKey: process.env.ABUSEIPDB_API_KEY || '',
  greyNoiseKey: process.env.GREYNOISE_API_KEY || '',
  cacheHours: 24,
  highRiskThreshold: 70,
  blockThreshold: 90,
  enableAutoBlock: process.env.THREAT_INTEL_AUTO_BLOCK === 'true',
}

// In-memory cache with TTL
const threatCache = new Map<string, { result: ThreatIntelResult; expiresAt: number }>()

// Known Tor exit nodes (sample - production would use live feed)
const torExitNodes = new Set<string>()

// Known datacenter/VPN IP ranges (simplified)
const datacenterPrefixes = [
  '104.16.', '104.17.', '104.18.', '104.19.', '104.20.', // Cloudflare
  '13.', '52.', '54.', // AWS (partial)
  '35.', '34.', // GCP (partial)
  '20.', '40.', '51.', '52.', // Azure (partial)
]

/**
 * Initialize threat intelligence service
 */
export async function initThreatIntelligence(): Promise<void> {
  try {
    // Create threat intelligence tables
    await pool.query(`
      CREATE TABLE IF NOT EXISTS threat_feed (
        ip VARCHAR(45) PRIMARY KEY,
        threat_type VARCHAR(100) NOT NULL,
        confidence INTEGER DEFAULT 50,
        source VARCHAR(100) NOT NULL,
        added_at TIMESTAMPTZ DEFAULT NOW(),
        expires_at TIMESTAMPTZ NOT NULL,
        metadata JSONB DEFAULT '{}'
      );
      
      CREATE TABLE IF NOT EXISTS threat_intel_cache (
        ip VARCHAR(45) PRIMARY KEY,
        result JSONB NOT NULL,
        queried_at TIMESTAMPTZ DEFAULT NOW(),
        expires_at TIMESTAMPTZ NOT NULL
      );
      
      CREATE INDEX IF NOT EXISTS idx_threat_feed_expires ON threat_feed(expires_at);
      CREATE INDEX IF NOT EXISTS idx_threat_intel_cache_expires ON threat_intel_cache(expires_at);
    `)
    
    // Load Tor exit nodes (in production, fetch from https://check.torproject.org/torbulkexitlist)
    await loadTorExitNodes()
    
    // Clean expired entries periodically
    setInterval(cleanExpiredEntries, 60 * 60 * 1000) // Every hour
    
    logger.info('[ThreatIntel] Service initialized')
  } catch (error: any) {
    logger.error('[ThreatIntel] Init failed:', error.message)
  }
}

/**
 * Load Tor exit nodes list
 */
async function loadTorExitNodes(): Promise<void> {
  // In production, fetch from: https://check.torproject.org/torbulkexitlist
  // For now, use a small sample set
  const sampleTorNodes = [
    '185.220.101.', '185.220.102.', '185.220.103.',
    '45.153.160.', '51.75.64.', '62.210.105.',
  ]
  
  // Mark as prefix matches
  sampleTorNodes.forEach(prefix => torExitNodes.add(prefix))
}

/**
 * Clean expired cache entries
 */
async function cleanExpiredEntries(): Promise<void> {
  const now = Date.now()
  
  // Clean in-memory cache
  for (const [ip, entry] of threatCache) {
    if (entry.expiresAt < now) {
      threatCache.delete(ip)
    }
  }
  
  // Clean database cache
  await pool.query(`
    DELETE FROM threat_intel_cache WHERE expires_at < NOW();
    DELETE FROM threat_feed WHERE expires_at < NOW();
  `).catch(() => {})
}

/**
 * Check if IP is a Tor exit node
 */
function isTorExitNode(ip: string): boolean {
  for (const prefix of torExitNodes) {
    if (ip.startsWith(prefix)) return true
  }
  return false
}

/**
 * Check if IP is from a datacenter/VPN
 */
function isDatacenterIP(ip: string): boolean {
  for (const prefix of datacenterPrefixes) {
    if (ip.startsWith(prefix)) return true
  }
  return false
}

/**
 * Query AbuseIPDB for IP reputation
 */
async function queryAbuseIPDB(ip: string): Promise<ThreatIntelResult['sources']['abuseIPDB'] | null> {
  if (!config.abuseIPDBKey) return null
  
  try {
    const response = await fetch(`https://api.abuseipdb.com/api/v2/check?ipAddress=${ip}&maxAgeInDays=90`, {
      headers: {
        'Key': config.abuseIPDBKey,
        'Accept': 'application/json',
      },
    })
    
    if (!response.ok) return null
    
    const data = await response.json() as any
    const result = data.data
    
    return {
      confidence: result.abuseConfidenceScore || 0,
      totalReports: result.totalReports || 0,
      lastReported: result.lastReportedAt ? new Date(result.lastReportedAt) : null,
      categories: (result.categories || []).map((c: number) => abuseIPDBCategoryMap[c] || `Category ${c}`),
      countryCode: result.countryCode || 'XX',
      isp: result.isp || 'Unknown',
    }
  } catch {
    return null
  }
}

// AbuseIPDB category mapping
const abuseIPDBCategoryMap: Record<number, string> = {
  1: 'DNS Compromise',
  2: 'DNS Poisoning',
  3: 'Fraud Orders',
  4: 'DDoS Attack',
  5: 'FTP Brute-Force',
  6: 'Ping of Death',
  7: 'Phishing',
  8: 'Fraud VoIP',
  9: 'Open Proxy',
  10: 'Web Spam',
  11: 'Email Spam',
  12: 'Blog Spam',
  13: 'VPN IP',
  14: 'Port Scan',
  15: 'Hacking',
  16: 'SQL Injection',
  17: 'Spoofing',
  18: 'Brute-Force',
  19: 'Bad Web Bot',
  20: 'Exploited Host',
  21: 'Web App Attack',
  22: 'SSH',
  23: 'IoT Targeted',
}

/**
 * Query GreyNoise for IP classification
 */
async function queryGreyNoise(ip: string): Promise<ThreatIntelResult['sources']['greyNoise'] | null> {
  if (!config.greyNoiseKey) return null
  
  try {
    const response = await fetch(`https://api.greynoise.io/v3/community/${ip}`, {
      headers: {
        'key': config.greyNoiseKey,
        'Accept': 'application/json',
      },
    })
    
    if (!response.ok) return null
    
    const data = await response.json() as any
    
    return {
      classification: data.classification || 'unknown',
      actor: data.name || null,
      tags: data.tags || [],
    }
  } catch {
    return null
  }
}

/**
 * Get comprehensive threat intelligence for an IP
 */
export async function getThreatIntel(ip: string): Promise<ThreatIntelResult> {
  // Check memory cache
  const cached = threatCache.get(ip)
  if (cached && cached.expiresAt > Date.now()) {
    return { ...cached.result, cached: true }
  }
  
  // Check database cache
  try {
    const dbResult = await pool.query(`
      SELECT result FROM threat_intel_cache
      WHERE ip = $1 AND expires_at > NOW()
    `, [ip])
    
    if (dbResult.rows.length > 0) {
      const result = dbResult.rows[0].result as ThreatIntelResult
      result.cached = true
      threatCache.set(ip, { result, expiresAt: Date.now() + config.cacheHours * 60 * 60 * 1000 })
      return result
    }
  } catch {}
  
  // Query threat intelligence sources
  const [abuseIPDB, greyNoise] = await Promise.all([
    queryAbuseIPDB(ip),
    queryGreyNoise(ip),
  ])
  
  const torExitNode = isTorExitNode(ip)
  const datacenter = isDatacenterIP(ip)
  
  // Calculate aggregate risk score
  let riskScore = 0
  const categories: string[] = []
  
  if (abuseIPDB) {
    riskScore = Math.max(riskScore, abuseIPDB.confidence)
    categories.push(...abuseIPDB.categories)
  }
  
  if (greyNoise?.classification === 'malicious') {
    riskScore = Math.max(riskScore, 80)
    categories.push('Known Malicious Actor')
  }
  
  if (torExitNode) {
    riskScore = Math.max(riskScore, 50)
    categories.push('Tor Exit Node')
  }
  
  if (datacenter) {
    // Datacenter IPs are suspicious for user auth but not necessarily malicious
    riskScore = Math.max(riskScore, Math.min(riskScore + 10, 60))
    categories.push('Datacenter/VPN')
  }
  
  // Check local threat feed
  try {
    const feedResult = await pool.query(`
      SELECT threat_type, confidence FROM threat_feed
      WHERE ip = $1 AND expires_at > NOW()
    `, [ip])
    
    for (const row of feedResult.rows) {
      riskScore = Math.max(riskScore, row.confidence)
      categories.push(row.threat_type)
    }
  } catch {}
  
  const result: ThreatIntelResult = {
    ip,
    isMalicious: riskScore >= config.highRiskThreshold,
    riskScore,
    categories: [...new Set(categories)],
    sources: {
      abuseIPDB: abuseIPDB || undefined,
      greyNoise: greyNoise || undefined,
      torExitNode,
      vpnProxy: datacenter,
      datacenter,
    },
    cached: false,
    queriedAt: new Date(),
  }
  
  // Cache result
  threatCache.set(ip, { result, expiresAt: Date.now() + config.cacheHours * 60 * 60 * 1000 })
  
  // Persist to database
  try {
    const expiresAt = new Date(Date.now() + config.cacheHours * 60 * 60 * 1000)
    await pool.query(`
      INSERT INTO threat_intel_cache (ip, result, expires_at)
      VALUES ($1, $2, $3)
      ON CONFLICT (ip) DO UPDATE SET result = $2, queried_at = NOW(), expires_at = $3
    `, [ip, JSON.stringify(result), expiresAt])
  } catch {}
  
  return result
}

/**
 * Check IP against threat intelligence (lightweight version)
 */
export async function isIPThreat(ip: string): Promise<{
  isThreat: boolean
  riskScore: number
  shouldBlock: boolean
}> {
  const intel = await getThreatIntel(ip)
  
  return {
    isThreat: intel.isMalicious,
    riskScore: intel.riskScore,
    shouldBlock: intel.riskScore >= config.blockThreshold,
  }
}

/**
 * Add IP to local threat feed
 */
export async function addToThreatFeed(
  ip: string,
  threatType: string,
  options: {
    confidence?: number
    source?: string
    expiresInHours?: number
    metadata?: Record<string, any>
  } = {}
): Promise<void> {
  const expiresAt = new Date(Date.now() + (options.expiresInHours || 24) * 60 * 60 * 1000)
  
  await pool.query(`
    INSERT INTO threat_feed (ip, threat_type, confidence, source, expires_at, metadata)
    VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (ip) DO UPDATE SET
      threat_type = EXCLUDED.threat_type,
      confidence = GREATEST(threat_feed.confidence, EXCLUDED.confidence),
      expires_at = GREATEST(threat_feed.expires_at, EXCLUDED.expires_at),
      metadata = threat_feed.metadata || EXCLUDED.metadata
  `, [
    ip,
    threatType,
    options.confidence || 70,
    options.source || 'local',
    expiresAt,
    JSON.stringify(options.metadata || {}),
  ])
  
  // Invalidate cache
  threatCache.delete(ip)
}

/**
 * Remove IP from local threat feed
 */
export async function removeFromThreatFeed(ip: string): Promise<void> {
  await pool.query('DELETE FROM threat_feed WHERE ip = $1', [ip])
  threatCache.delete(ip)
}

/**
 * Get threat feed entries
 */
export async function getThreatFeed(limit = 100): Promise<ThreatFeedEntry[]> {
  const result = await pool.query(`
    SELECT ip, threat_type, confidence, source, added_at, expires_at
    FROM threat_feed
    WHERE expires_at > NOW()
    ORDER BY confidence DESC, added_at DESC
    LIMIT $1
  `, [limit])
  
  return result.rows.map(row => ({
    ip: row.ip,
    threatType: row.threat_type,
    confidence: row.confidence,
    source: row.source,
    addedAt: row.added_at,
    expiresAt: row.expires_at,
  }))
}

/**
 * Get threat intelligence statistics
 */
export async function getThreatIntelStats(): Promise<{
  cacheSize: number
  feedSize: number
  queriesLast24h: number
  threatsBlocked: number
  topThreats: Array<{ category: string; count: number }>
}> {
  const [cacheCount, feedCount] = await Promise.all([
    pool.query('SELECT COUNT(*)::int as count FROM threat_intel_cache WHERE expires_at > NOW()'),
    pool.query('SELECT COUNT(*)::int as count FROM threat_feed WHERE expires_at > NOW()'),
  ])
  
  return {
    cacheSize: cacheCount.rows[0]?.count || 0,
    feedSize: feedCount.rows[0]?.count || 0,
    queriesLast24h: threatCache.size, // Approximation
    threatsBlocked: 0, // Would integrate with blocking middleware
    topThreats: [], // Would aggregate from cache
  }
}

/**
 * Express middleware for threat intelligence checking
 */
export function threatIntelMiddleware(options: {
  blockHighRisk?: boolean
  logOnly?: boolean
} = {}) {
  return async (req: any, res: any, next: any) => {
    const ip = req.ip || req.socket.remoteAddress || '0.0.0.0'
    
    // Skip localhost
    if (ip === '127.0.0.1' || ip === '::1') {
      return next()
    }
    
    try {
      const threat = await isIPThreat(ip)
      
      // Attach to request for downstream use
      req.threatIntel = threat
      
      if (options.logOnly) {
        if (threat.isThreat) {
          logger.warn(`[ThreatIntel] Suspicious IP: ${ip} (score: ${threat.riskScore})`)
        }
        return next()
      }
      
      if (options.blockHighRisk && threat.shouldBlock) {
        logger.warn(`[ThreatIntel] Blocked threat IP: ${ip} (score: ${threat.riskScore})`)
        return res.status(403).json({
          success: false,
          error: { code: 'THREAT_DETECTED', message: 'Access denied' },
        })
      }
      
      next()
    } catch (error) {
      // Fail open - don't block legitimate users due to API errors
      next()
    }
  }
}

export default {
  initThreatIntelligence,
  getThreatIntel,
  isIPThreat,
  addToThreatFeed,
  removeFromThreatFeed,
  getThreatFeed,
  getThreatIntelStats,
  threatIntelMiddleware,
}
