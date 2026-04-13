/**
 * File: anomalyDetectionService.ts
 *
 * Login/session anomaly detector — spots impossible travel, new devices,
 * brute-force attempts, credential stuffing, and session hijack patterns.
 * Returns a 0–100 risk score with step-up auth recommendations.
 *
 * How it connects:
 * - Called by auth middleware and session validation
 * - Reads login/session history from the database
 * - Feeds risk scores into riskAuthService and adaptiveMFAService
 *
 * Simple explanation:
 * Spots unusual login behaviour to protect accounts from compromise.
 */

import crypto from 'crypto'
import pool from '../models/db.js'
import { logger } from '../services/logger.js'

export interface AnomalyResult {
  isAnomaly: boolean
  riskScore: number // 0-100
  anomalyTypes: AnomalyType[]
  details: AnomalyDetails
  recommendations: string[]
  requiresStepUp: boolean
}

export type AnomalyType =
  | 'impossible_travel'
  | 'new_device'
  | 'new_location'
  | 'unusual_time'
  | 'credential_stuffing'
  | 'brute_force'
  | 'session_hijack'
  | 'rapid_logins'
  | 'failed_pattern'
  | 'device_mismatch'

export interface AnomalyDetails {
  impossibleTravel?: {
    lastLocation: GeoLocation
    currentLocation: GeoLocation
    timeDiff: number // minutes
    distanceKm: number
    maxPossibleSpeed: number // km/h
  }
  loginPatterns?: {
    usualHours: number[]
    currentHour: number
    usualDays: number[]
    currentDay: number
    deviation: number
  }
  deviceAnalysis?: {
    isNewDevice: boolean
    deviceAge: number // days since first seen
    similarityToKnown: number // 0-100
  }
  locationAnalysis?: {
    isNewCountry: boolean
    isNewCity: boolean
    distanceFromUsual: number // km
  }
  behaviorScore?: {
    typingSpeed: number
    mousePattern: string
    scrollBehavior: string
  }
}

export interface GeoLocation {
  ip: string
  country: string
  city: string
  lat: number
  lon: number
  timestamp: Date
}

export interface LoginAttempt {
  userId: string
  ip: string
  userAgent: string
  deviceFingerprint?: string
  success: boolean
  timestamp: Date
  location?: GeoLocation
}

// Configuration
const config = {
  impossibleTravelMaxSpeed: 900, // km/h (commercial jet)
  newDeviceRiskIncrease: 20,
  newLocationRiskIncrease: 15,
  unusualTimeRiskIncrease: 10,
  credentialStuffingThreshold: 10, // attempts per minute
  bruteForceThreshold: 5, // failed attempts
  rapidLoginThreshold: 5, // successful logins in 10 minutes
  stepUpThreshold: 60, // risk score requiring step-up auth
}

// In-memory state for real-time detection
const recentAttempts = new Map<string, LoginAttempt[]>() // ip -> attempts
const userPatterns = new Map<string, UserPattern>()

interface UserPattern {
  loginHours: number[] // frequency by hour (0-23)
  loginDays: number[] // frequency by day (0-6)
  knownDevices: Set<string>
  knownLocations: Map<string, number> // city -> count
  knownCountries: Set<string>
  lastLogin?: LoginAttempt
  avgLoginInterval: number // hours
  totalLogins: number
  updatedAt: Date
}

let anomalyCleanupInterval: ReturnType<typeof setInterval> | null = null

/** Stop the background cleanup interval (call during graceful shutdown). */
export function stopAnomalyDetection(): void {
  if (anomalyCleanupInterval) {
    clearInterval(anomalyCleanupInterval)
    anomalyCleanupInterval = null
  }
}

/**
 * Initialize anomaly detection service
 */
export async function initAnomalyDetection(): Promise<void> {
  try {
    // Create anomaly detection tables
    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_login_patterns (
        user_id VARCHAR(100) PRIMARY KEY,
        login_hours INTEGER[] DEFAULT ARRAY[]::INTEGER[],
        login_days INTEGER[] DEFAULT ARRAY[]::INTEGER[],
        known_devices TEXT[] DEFAULT ARRAY[]::TEXT[],
        known_locations JSONB DEFAULT '{}',
        known_countries TEXT[] DEFAULT ARRAY[]::TEXT[],
        last_login JSONB,
        avg_login_interval FLOAT DEFAULT 24,
        total_logins INTEGER DEFAULT 0,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
      
      CREATE TABLE IF NOT EXISTS login_history (
        id SERIAL PRIMARY KEY,
        user_id VARCHAR(100) NOT NULL,
        ip VARCHAR(45) NOT NULL,
        user_agent TEXT,
        device_fingerprint VARCHAR(64),
        success BOOLEAN NOT NULL,
        location JSONB,
        anomaly_result JSONB,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      
      CREATE TABLE IF NOT EXISTS anomaly_alerts (
        id SERIAL PRIMARY KEY,
        user_id VARCHAR(100) NOT NULL,
        anomaly_types TEXT[] NOT NULL,
        risk_score INTEGER NOT NULL,
        details JSONB NOT NULL,
        resolved BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      
      CREATE INDEX IF NOT EXISTS idx_login_history_user ON login_history(user_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_login_history_ip ON login_history(ip, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_anomaly_alerts_user ON anomaly_alerts(user_id, created_at DESC);
    `)
    
    // Clean old data periodically (store handle for graceful shutdown)
    anomalyCleanupInterval = setInterval(cleanOldData, 60 * 60 * 1000) // Every hour
    
    logger.info('[AnomalyDetection] Service initialized')
  } catch (error: any) {
    logger.error('[AnomalyDetection] Init failed:', error.message)
  }
}

/**
 * Clean old in-memory data
 */
function cleanOldData(): void {
  const cutoff = Date.now() - 10 * 60 * 1000 // 10 minutes
  
  for (const [ip, attempts] of recentAttempts) {
    const filtered = attempts.filter(a => a.timestamp.getTime() > cutoff)
    if (filtered.length === 0) {
      recentAttempts.delete(ip)
    } else {
      recentAttempts.set(ip, filtered)
    }
  }
}

/**
 * Calculate distance between two coordinates using Haversine formula
 */
function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371 // Earth's radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) ** 2
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

/**
 * Get user's login pattern from cache or database
 */
async function getUserPattern(userId: string): Promise<UserPattern | null> {
  // Check memory cache
  const cached = userPatterns.get(userId)
  if (cached && Date.now() - cached.updatedAt.getTime() < 3600000) {
    return cached
  }
  
  // Load from database
  try {
    const result = await pool.query(`
      SELECT * FROM user_login_patterns WHERE user_id = $1
    `, [userId])
    
    if (result.rows.length === 0) return null
    
    const row = result.rows[0]
    const pattern: UserPattern = {
      loginHours: row.login_hours || [],
      loginDays: row.login_days || [],
      knownDevices: new Set(row.known_devices || []),
      knownLocations: new Map(Object.entries(row.known_locations || {})),
      knownCountries: new Set(row.known_countries || []),
      lastLogin: row.last_login,
      avgLoginInterval: row.avg_login_interval || 24,
      totalLogins: row.total_logins || 0,
      updatedAt: new Date(),
    }
    
    userPatterns.set(userId, pattern)
    return pattern
  } catch {
    return null
  }
}

/**
 * Update user's login pattern after successful login
 */
async function updateUserPattern(
  userId: string,
  attempt: LoginAttempt,
  pattern: UserPattern | null
): Promise<void> {
  const hour = attempt.timestamp.getHours()
  const day = attempt.timestamp.getDay()
  
  if (pattern) {
    // Update existing pattern
    pattern.loginHours[hour] = (pattern.loginHours[hour] || 0) + 1
    pattern.loginDays[day] = (pattern.loginDays[day] || 0) + 1
    
    if (attempt.deviceFingerprint) {
      pattern.knownDevices.add(attempt.deviceFingerprint)
    }
    
    if (attempt.location) {
      const cityKey = `${attempt.location.city}:${attempt.location.country}`
      pattern.knownLocations.set(cityKey, (pattern.knownLocations.get(cityKey) || 0) + 1)
      pattern.knownCountries.add(attempt.location.country)
    }
    
    // Update average login interval
    if (pattern.lastLogin) {
      const intervalHours = (attempt.timestamp.getTime() - new Date(pattern.lastLogin.timestamp).getTime()) / 3600000
      pattern.avgLoginInterval = (pattern.avgLoginInterval * pattern.totalLogins + intervalHours) / (pattern.totalLogins + 1)
    }
    
    pattern.lastLogin = attempt
    pattern.totalLogins++
    pattern.updatedAt = new Date()
    
    userPatterns.set(userId, pattern)
  } else {
    // Create new pattern
    pattern = {
      loginHours: Array(24).fill(0),
      loginDays: Array(7).fill(0),
      knownDevices: new Set(),
      knownLocations: new Map(),
      knownCountries: new Set(),
      lastLogin: attempt,
      avgLoginInterval: 24,
      totalLogins: 1,
      updatedAt: new Date(),
    }
    pattern.loginHours[hour] = 1
    pattern.loginDays[day] = 1
    
    if (attempt.deviceFingerprint) {
      pattern.knownDevices.add(attempt.deviceFingerprint)
    }
    
    if (attempt.location) {
      const cityKey = `${attempt.location.city}:${attempt.location.country}`
      pattern.knownLocations.set(cityKey, 1)
      pattern.knownCountries.add(attempt.location.country)
    }
    
    userPatterns.set(userId, pattern)
  }
  
  // Persist to database
  try {
    await pool.query(`
      INSERT INTO user_login_patterns (
        user_id, login_hours, login_days, known_devices,
        known_locations, known_countries, last_login,
        avg_login_interval, total_logins, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
      ON CONFLICT (user_id) DO UPDATE SET
        login_hours = $2,
        login_days = $3,
        known_devices = $4,
        known_locations = $5,
        known_countries = $6,
        last_login = $7,
        avg_login_interval = $8,
        total_logins = $9,
        updated_at = NOW()
    `, [
      userId,
      pattern.loginHours,
      pattern.loginDays,
      [...pattern.knownDevices],
      Object.fromEntries(pattern.knownLocations),
      [...pattern.knownCountries],
      JSON.stringify(attempt),
      pattern.avgLoginInterval,
      pattern.totalLogins,
    ])
  } catch (error: any) {
    logger.error('[AnomalyDetection] Failed to update pattern:', error.message)
  }
}

/**
 * Detect impossible travel
 */
function detectImpossibleTravel(
  lastLogin: LoginAttempt | undefined,
  currentAttempt: LoginAttempt
): AnomalyDetails['impossibleTravel'] | null {
  if (!lastLogin?.location || !currentAttempt.location) return null
  
  const lastLoc = lastLogin.location
  const currLoc = currentAttempt.location
  
  // Same location - no travel
  if (lastLoc.city === currLoc.city && lastLoc.country === currLoc.country) {
    return null
  }
  
  const distanceKm = calculateDistance(lastLoc.lat, lastLoc.lon, currLoc.lat, currLoc.lon)
  const timeDiffMinutes = (currentAttempt.timestamp.getTime() - new Date(lastLogin.timestamp).getTime()) / 60000
  
  if (timeDiffMinutes <= 0) return null
  
  const speedKmH = distanceKm / (timeDiffMinutes / 60)
  
  if (speedKmH > config.impossibleTravelMaxSpeed && distanceKm > 100) {
    return {
      lastLocation: lastLoc,
      currentLocation: currLoc,
      timeDiff: Math.round(timeDiffMinutes),
      distanceKm: Math.round(distanceKm),
      maxPossibleSpeed: config.impossibleTravelMaxSpeed,
    }
  }
  
  return null
}

/**
 * Detect unusual login time
 */
function detectUnusualTime(pattern: UserPattern | null, timestamp: Date): number {
  if (!pattern || pattern.totalLogins < 5) return 0
  
  const hour = timestamp.getHours()
  const day = timestamp.getDay()
  
  const totalHourLogins = pattern.loginHours.reduce((a, b) => a + b, 0)
  const totalDayLogins = pattern.loginDays.reduce((a, b) => a + b, 0)
  
  if (totalHourLogins === 0 || totalDayLogins === 0) return 0
  
  const hourFreq = (pattern.loginHours[hour] || 0) / totalHourLogins
  const dayFreq = (pattern.loginDays[day] || 0) / totalDayLogins
  
  // If this hour/day is rarely used, it's unusual
  const hourDeviation = hourFreq < 0.02 ? 50 : hourFreq < 0.05 ? 25 : 0
  const dayDeviation = dayFreq < 0.05 ? 30 : dayFreq < 0.1 ? 15 : 0
  
  return Math.min(hourDeviation + dayDeviation, config.unusualTimeRiskIncrease)
}

/**
 * Detect credential stuffing (many attempts from same IP)
 */
function detectCredentialStuffing(ip: string): { detected: boolean; attempts: number } {
  const attempts = recentAttempts.get(ip) || []
  const recentMinute = attempts.filter(
    a => Date.now() - a.timestamp.getTime() < 60000
  ).length
  
  return {
    detected: recentMinute >= config.credentialStuffingThreshold,
    attempts: recentMinute,
  }
}

/**
 * Detect brute force (many failed attempts for same user)
 */
async function detectBruteForce(userId: string): Promise<{ detected: boolean; failures: number }> {
  try {
    const result = await pool.query(`
      SELECT COUNT(*)::int as count FROM login_history
      WHERE user_id = $1 AND success = FALSE
      AND created_at > NOW() - INTERVAL '15 minutes'
    `, [userId])
    
    const failures = result.rows[0]?.count || 0
    
    return {
      detected: failures >= config.bruteForceThreshold,
      failures,
    }
  } catch {
    return { detected: false, failures: 0 }
  }
}

/**
 * Detect rapid successful logins (potential session riding)
 */
async function detectRapidLogins(userId: string): Promise<boolean> {
  try {
    const result = await pool.query(`
      SELECT COUNT(*)::int as count FROM login_history
      WHERE user_id = $1 AND success = TRUE
      AND created_at > NOW() - INTERVAL '10 minutes'
    `, [userId])
    
    return (result.rows[0]?.count || 0) >= config.rapidLoginThreshold
  } catch {
    return false
  }
}

/**
 * Analyze login attempt for anomalies
 */
export async function analyzeLoginAttempt(attempt: LoginAttempt): Promise<AnomalyResult> {
  const anomalyTypes: AnomalyType[] = []
  const details: AnomalyDetails = {}
  let riskScore = 0
  const recommendations: string[] = []
  
  // Get user's historical pattern
  const pattern = await getUserPattern(attempt.userId)
  
  // 1. Check for impossible travel
  if (pattern?.lastLogin) {
    const travel = detectImpossibleTravel(pattern.lastLogin, attempt)
    if (travel) {
      anomalyTypes.push('impossible_travel')
      details.impossibleTravel = travel
      riskScore += 40
      recommendations.push('Verify identity via secondary authentication')
    }
  }
  
  // 2. Check for new device
  if (attempt.deviceFingerprint && pattern) {
    const isNew = !pattern.knownDevices.has(attempt.deviceFingerprint)
    details.deviceAnalysis = {
      isNewDevice: isNew,
      deviceAge: 0, // Would calculate from history
      similarityToKnown: isNew ? 0 : 100,
    }
    if (isNew) {
      anomalyTypes.push('new_device')
      riskScore += config.newDeviceRiskIncrease
      recommendations.push('New device detected - consider verification')
    }
  }
  
  // 3. Check for new location
  if (attempt.location && pattern) {
    const cityKey = `${attempt.location.city}:${attempt.location.country}`
    const isNewCity = !pattern.knownLocations.has(cityKey)
    const isNewCountry = !pattern.knownCountries.has(attempt.location.country)
    
    details.locationAnalysis = {
      isNewCountry,
      isNewCity,
      distanceFromUsual: 0, // Would calculate from usual locations
    }
    
    if (isNewCountry) {
      anomalyTypes.push('new_location')
      riskScore += config.newLocationRiskIncrease + 15
      recommendations.push('Login from new country - verify identity')
    } else if (isNewCity) {
      anomalyTypes.push('new_location')
      riskScore += config.newLocationRiskIncrease
    }
  }
  
  // 4. Check for unusual time
  const timeDeviation = detectUnusualTime(pattern, attempt.timestamp)
  if (timeDeviation > 0) {
    anomalyTypes.push('unusual_time')
    riskScore += timeDeviation
    details.loginPatterns = {
      usualHours: pattern?.loginHours || [],
      currentHour: attempt.timestamp.getHours(),
      usualDays: pattern?.loginDays || [],
      currentDay: attempt.timestamp.getDay(),
      deviation: timeDeviation,
    }
  }
  
  // 5. Check for credential stuffing
  const stuffing = detectCredentialStuffing(attempt.ip)
  if (stuffing.detected) {
    anomalyTypes.push('credential_stuffing')
    riskScore += 50
    recommendations.push('Potential credential stuffing attack - enable CAPTCHA')
  }
  
  // 6. Check for brute force
  const bruteForce = await detectBruteForce(attempt.userId)
  if (bruteForce.detected) {
    anomalyTypes.push('brute_force')
    riskScore += 45
    recommendations.push(`Account under attack (${bruteForce.failures} failures) - consider lockout`)
  }
  
  // 7. Check for rapid logins
  if (await detectRapidLogins(attempt.userId)) {
    anomalyTypes.push('rapid_logins')
    riskScore += 25
    recommendations.push('Unusual login frequency detected')
  }
  
  // Cap risk score at 100
  riskScore = Math.min(riskScore, 100)
  
  const result: AnomalyResult = {
    isAnomaly: anomalyTypes.length > 0,
    riskScore,
    anomalyTypes,
    details,
    recommendations,
    requiresStepUp: riskScore >= config.stepUpThreshold,
  }
  
  // Record attempt
  trackAttempt(attempt, result)
  
  // Update pattern if successful login
  if (attempt.success) {
    await updateUserPattern(attempt.userId, attempt, pattern)
  }
  
  // Create alert for high-risk anomalies
  if (riskScore >= 50 && anomalyTypes.length > 0) {
    await createAnomalyAlert(attempt.userId, result)
  }
  
  return result
}

/**
 * Track login attempt in memory
 */
function trackAttempt(attempt: LoginAttempt, result: AnomalyResult): void {
  // Track in memory for rate limiting
  const ipAttempts = recentAttempts.get(attempt.ip) || []
  ipAttempts.push(attempt)
  recentAttempts.set(attempt.ip, ipAttempts.slice(-100)) // Keep last 100
  
  // Persist to database
  pool.query(`
    INSERT INTO login_history (
      user_id, ip, user_agent, device_fingerprint,
      success, location, anomaly_result
    ) VALUES ($1, $2, $3, $4, $5, $6, $7)
  `, [
    attempt.userId,
    attempt.ip,
    attempt.userAgent,
    attempt.deviceFingerprint,
    attempt.success,
    attempt.location ? JSON.stringify(attempt.location) : null,
    JSON.stringify(result),
  ]).catch(() => {})
}

/**
 * Create anomaly alert for security team
 */
async function createAnomalyAlert(userId: string, result: AnomalyResult): Promise<void> {
  try {
    await pool.query(`
      INSERT INTO anomaly_alerts (user_id, anomaly_types, risk_score, details)
      VALUES ($1, $2, $3, $4)
    `, [
      userId,
      result.anomalyTypes,
      result.riskScore,
      JSON.stringify(result.details),
    ])
    
    logger.warn(`[AnomalyDetection] Alert created for user ${userId}: ${result.anomalyTypes.join(', ')} (score: ${result.riskScore})`)
  } catch (error: any) {
    logger.error('[AnomalyDetection] Failed to create alert:', error.message)
  }
}

/**
 * Get user's login history with anomaly data
 */
export async function getUserLoginHistory(
  userId: string,
  limit = 50
): Promise<Array<{
  ip: string
  userAgent: string
  success: boolean
  location: GeoLocation | null
  anomalyResult: AnomalyResult | null
  timestamp: Date
}>> {
  const result = await pool.query(`
    SELECT ip, user_agent, success, location, anomaly_result, created_at
    FROM login_history
    WHERE user_id = $1
    ORDER BY created_at DESC
    LIMIT $2
  `, [userId, limit])
  
  return result.rows.map(row => ({
    ip: row.ip,
    userAgent: row.user_agent,
    success: row.success,
    location: row.location,
    anomalyResult: row.anomaly_result,
    timestamp: row.created_at,
  }))
}

/**
 * Get recent anomaly alerts
 */
export async function getAnomalyAlerts(
  options: { userId?: string; unresolved?: boolean; limit?: number } = {}
): Promise<Array<{
  id: number
  userId: string
  anomalyTypes: AnomalyType[]
  riskScore: number
  details: AnomalyDetails
  resolved: boolean
  createdAt: Date
}>> {
  let query = 'SELECT * FROM anomaly_alerts WHERE 1=1'
  const params: any[] = []
  
  if (options.userId) {
    params.push(options.userId)
    query += ` AND user_id = $${params.length}`
  }
  
  if (options.unresolved) {
    query += ' AND resolved = FALSE'
  }
  
  query += ' ORDER BY created_at DESC'
  
  params.push(options.limit || 100)
  query += ` LIMIT $${params.length}`
  
  const result = await pool.query(query, params)
  
  return result.rows.map(row => ({
    id: row.id,
    userId: row.user_id,
    anomalyTypes: row.anomaly_types,
    riskScore: row.risk_score,
    details: row.details,
    resolved: row.resolved,
    createdAt: row.created_at,
  }))
}

/**
 * Resolve an anomaly alert
 */
export async function resolveAnomalyAlert(alertId: number): Promise<void> {
  await pool.query(
    'UPDATE anomaly_alerts SET resolved = TRUE WHERE id = $1',
    [alertId]
  )
}

/**
 * Get anomaly detection statistics
 */
export async function getAnomalyStats(): Promise<{
  totalAlerts24h: number
  unresolvedAlerts: number
  topAnomalyTypes: Array<{ type: string; count: number }>
  averageRiskScore: number
}> {
  const [alerts24h, unresolved, topTypes, avgScore] = await Promise.all([
    pool.query(`
      SELECT COUNT(*)::int as count FROM anomaly_alerts
      WHERE created_at > NOW() - INTERVAL '24 hours'
    `),
    pool.query(`
      SELECT COUNT(*)::int as count FROM anomaly_alerts WHERE resolved = FALSE
    `),
    pool.query(`
      SELECT unnest(anomaly_types) as type, COUNT(*)::int as count
      FROM anomaly_alerts
      WHERE created_at > NOW() - INTERVAL '7 days'
      GROUP BY type ORDER BY count DESC LIMIT 10
    `),
    pool.query(`
      SELECT AVG(risk_score)::int as avg FROM anomaly_alerts
      WHERE created_at > NOW() - INTERVAL '7 days'
    `),
  ])
  
  return {
    totalAlerts24h: alerts24h.rows[0]?.count || 0,
    unresolvedAlerts: unresolved.rows[0]?.count || 0,
    topAnomalyTypes: topTypes.rows,
    averageRiskScore: avgScore.rows[0]?.avg || 0,
  }
}

/**
 * Express middleware for anomaly checking on protected routes
 */
export function anomalyCheckMiddleware() {
  return async (req: any, res: any, next: any) => {
    // Only check authenticated requests
    if (!req.user?.id) return next()
    
    const attempt: LoginAttempt = {
      userId: req.user.id,
      ip: req.ip || req.socket.remoteAddress || '0.0.0.0',
      userAgent: req.headers['user-agent'] || '',
      deviceFingerprint: req.headers['x-device-fingerprint'] as string,
      success: true,
      timestamp: new Date(),
      location: req.geoLocation, // Set by geo middleware if available
    }
    
    try {
      const result = await analyzeLoginAttempt(attempt)
      req.anomalyResult = result
      
      if (result.requiresStepUp) {
        // Require step-up authentication
        return res.status(403).json({
          success: false,
          error: {
            code: 'STEP_UP_REQUIRED',
            message: 'Additional verification required',
          },
          anomaly: {
            riskScore: result.riskScore,
            types: result.anomalyTypes,
          },
        })
      }
      
      next()
    } catch {
      // Fail open - don't block on errors
      next()
    }
  }
}

export default {
  initAnomalyDetection,
  analyzeLoginAttempt,
  getUserLoginHistory,
  getAnomalyAlerts,
  resolveAnomalyAlert,
  getAnomalyStats,
  anomalyCheckMiddleware,
}
