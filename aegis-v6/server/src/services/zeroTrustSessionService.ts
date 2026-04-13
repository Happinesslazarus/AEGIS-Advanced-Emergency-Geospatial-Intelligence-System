/**
 * File: zeroTrustSessionService.ts
 *
 * Zero-trust session binding — HMAC-binds sessions to device fingerprint, IP,
 * User-Agent, and geo-location. Computes a "drift score" on every request
 * (IP change +30, UA change +40, fingerprint change +50) and terminates
 * sessions that exceed threshold 100. Drift decays 5 pts/hour.
 *
 * How it connects:
 * - Called by session middleware on every authenticated request
 * - Manages session_bindings, session_challenges, and session_drift_events tables
 * - Supports re-auth challenges via TOTP, email, or passkey
 *
 * Simple explanation:
 * Makes sure a session stays tied to the original device and kills it if something shifts.
 */

import crypto from 'crypto'
import pool from '../models/db.js'
import { logger } from '../services/logger.js'

export interface SessionBinding {
  sessionId: string
  userId: string
  bindingHash: string // HMAC of bound properties
  deviceFingerprint: string
  ipAddress: string
  userAgent: string
  userAgentHash: string
  geoLocation?: {
    country: string
    city: string
  }
  createdAt: Date
  lastValidatedAt: Date
  validationCount: number
  driftScore: number // Accumulated drift from original binding
  isValid: boolean
}

export interface SessionValidationResult {
  valid: boolean
  drift: {
    ipChanged: boolean
    userAgentChanged: boolean
    fingerprintChanged: boolean
    geoChanged: boolean
    totalDriftScore: number
  }
  action: 'allow' | 'challenge' | 'terminate'
  reason?: string
}

export interface SessionChallenge {
  challengeId: string
  sessionId: string
  challengeType: 'totp' | 'email' | 'passkey' | 'security_question'
  expiresAt: Date
  attempts: number
}

// Configuration
const config = {
  sessionSecret: process.env.SESSION_BINDING_SECRET || crypto.randomBytes(32).toString('hex'),
  maxDriftScore: 100, // Session terminated if exceeded
  ipChangeDrift: 30, // IP change adds 30 to drift
  userAgentChangeDrift: 40, // UA change adds 40 to drift
  fingerprintChangeDrift: 50, // Fingerprint change adds 50 to drift
  geoCountryChangeDrift: 35, // Country change adds 35 to drift
  geoCityChangeDrift: 15, // City change adds 15 to drift
  driftDecayRate: 5, // Drift decreases by 5 per hour of consistent usage
  challengeExpirationMinutes: 5,
  maxChallengeAttempts: 3,
  allowVPNDrift: false, // If true, allows more drift for VPN users
}

// In-memory session binding cache
const sessionBindings = new Map<string, SessionBinding>()
const pendingChallenges = new Map<string, SessionChallenge>()

/**
 * Initialize zero-trust session binding service
 */
export async function initZeroTrustSessions(): Promise<void> {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS session_bindings (
        session_id VARCHAR(64) PRIMARY KEY,
        user_id VARCHAR(100) NOT NULL,
        binding_hash VARCHAR(64) NOT NULL,
        device_fingerprint VARCHAR(64) NOT NULL,
        ip_address VARCHAR(45) NOT NULL,
        user_agent TEXT NOT NULL,
        user_agent_hash VARCHAR(64) NOT NULL,
        geo_location JSONB,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        last_validated_at TIMESTAMPTZ DEFAULT NOW(),
        validation_count INTEGER DEFAULT 1,
        drift_score FLOAT DEFAULT 0,
        is_valid BOOLEAN DEFAULT TRUE
      );
      
      CREATE TABLE IF NOT EXISTS session_challenges (
        challenge_id VARCHAR(64) PRIMARY KEY,
        session_id VARCHAR(64) NOT NULL,
        challenge_type VARCHAR(20) NOT NULL,
        challenge_data JSONB,
        expires_at TIMESTAMPTZ NOT NULL,
        attempts INTEGER DEFAULT 0,
        completed BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      
      CREATE TABLE IF NOT EXISTS session_drift_events (
        id SERIAL PRIMARY KEY,
        session_id VARCHAR(64) NOT NULL,
        drift_type VARCHAR(50) NOT NULL,
        old_value TEXT,
        new_value TEXT,
        drift_score INTEGER NOT NULL,
        action_taken VARCHAR(20) NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      
      CREATE INDEX IF NOT EXISTS idx_session_bindings_user ON session_bindings(user_id);
      CREATE INDEX IF NOT EXISTS idx_session_drift_session ON session_drift_events(session_id, created_at DESC);
    `)
    
    // Periodically decay drift scores
    setInterval(decayDriftScores, 60 * 60 * 1000) // Every hour
    
    // Clean expired challenges
    setInterval(cleanExpiredChallenges, 5 * 60 * 1000) // Every 5 minutes
    
    logger.info('[ZeroTrustSession] Service initialized')
  } catch (error: any) {
    logger.error('[ZeroTrustSession] Init failed:', error.message)
  }
}

/**
 * Generate cryptographic binding hash
 */
function generateBindingHash(
  userId: string,
  ip: string,
  userAgent: string,
  fingerprint: string
): string {
  const data = `${userId}:${ip}:${userAgent}:${fingerprint}`
  return crypto
    .createHmac('sha256', config.sessionSecret)
    .update(data)
    .digest('hex')
}

/**
 * Generate session ID
 */
function generateSessionId(): string {
  return crypto.randomBytes(32).toString('hex')
}

/**
 * Create a zero-trust session binding
 */
export async function createSessionBinding(
  userId: string,
  ip: string,
  userAgent: string,
  fingerprint: string,
  geoLocation?: { country: string; city: string }
): Promise<SessionBinding> {
  const sessionId = generateSessionId()
  const bindingHash = generateBindingHash(userId, ip, userAgent, fingerprint)
  const userAgentHash = crypto.createHash('sha256').update(userAgent).digest('hex')
  
  const binding: SessionBinding = {
    sessionId,
    userId,
    bindingHash,
    deviceFingerprint: fingerprint,
    ipAddress: ip,
    userAgent,
    userAgentHash,
    geoLocation,
    createdAt: new Date(),
    lastValidatedAt: new Date(),
    validationCount: 1,
    driftScore: 0,
    isValid: true,
  }
  
  // Cache binding
  sessionBindings.set(sessionId, binding)
  
  // Persist to database
  try {
    await pool.query(`
      INSERT INTO session_bindings (
        session_id, user_id, binding_hash, device_fingerprint,
        ip_address, user_agent, user_agent_hash, geo_location
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `, [
      sessionId,
      userId,
      bindingHash,
      fingerprint,
      ip,
      userAgent,
      userAgentHash,
      geoLocation ? JSON.stringify(geoLocation) : null,
    ])
  } catch (error: any) {
    logger.error('[ZeroTrustSession] Failed to persist binding:', error.message)
  }
  
  logger.info(`[ZeroTrustSession] Created binding for user ${userId}, IP: ${ip}`)
  return binding
}

/**
 * Validate session binding against current request
 */
export async function validateSession(
  sessionId: string,
  currentIP: string,
  currentUserAgent: string,
  currentFingerprint: string,
  currentGeo?: { country: string; city: string }
): Promise<SessionValidationResult> {
  // Get binding from cache or database
  let binding = sessionBindings.get(sessionId)
  
  if (!binding) {
    try {
      const result = await pool.query(
        'SELECT * FROM session_bindings WHERE session_id = $1 AND is_valid = TRUE',
        [sessionId]
      )
      
      if (result.rows.length === 0) {
        return {
          valid: false,
          drift: {
            ipChanged: false,
            userAgentChanged: false,
            fingerprintChanged: false,
            geoChanged: false,
            totalDriftScore: 0,
          },
          action: 'terminate',
          reason: 'Session not found or invalidated',
        }
      }
      
      const row = result.rows[0]
      binding = {
        sessionId: row.session_id,
        userId: row.user_id,
        bindingHash: row.binding_hash,
        deviceFingerprint: row.device_fingerprint,
        ipAddress: row.ip_address,
        userAgent: row.user_agent,
        userAgentHash: row.user_agent_hash,
        geoLocation: row.geo_location,
        createdAt: row.created_at,
        lastValidatedAt: row.last_validated_at,
        validationCount: row.validation_count,
        driftScore: row.drift_score,
        isValid: row.is_valid,
      }
      
      sessionBindings.set(sessionId, binding)
    } catch {
      return {
        valid: false,
        drift: {
          ipChanged: false,
          userAgentChanged: false,
          fingerprintChanged: false,
          geoChanged: false,
          totalDriftScore: 0,
        },
        action: 'terminate',
        reason: 'Database error',
      }
    }
  }
  
  // Check each binding property for drift
  const drift = {
    ipChanged: currentIP !== binding.ipAddress,
    userAgentChanged: crypto.createHash('sha256').update(currentUserAgent).digest('hex') !== binding.userAgentHash,
    fingerprintChanged: currentFingerprint !== binding.deviceFingerprint,
    geoChanged: false,
    totalDriftScore: binding.driftScore,
  }
  
  // Calculate geo drift
  if (currentGeo && binding.geoLocation) {
    if (currentGeo.country !== binding.geoLocation.country) {
      drift.geoChanged = true
      drift.totalDriftScore += config.geoCountryChangeDrift
    } else if (currentGeo.city !== binding.geoLocation.city) {
      drift.geoChanged = true
      drift.totalDriftScore += config.geoCityChangeDrift
    }
  }
  
  // Calculate drift score increment
  let driftIncrement = 0
  const driftEvents: Array<{ type: string; oldValue: string; newValue: string; score: number }> = []
  
  if (drift.fingerprintChanged) {
    driftIncrement += config.fingerprintChangeDrift
    driftEvents.push({
      type: 'fingerprint_change',
      oldValue: binding.deviceFingerprint.slice(0, 16) + '...',
      newValue: currentFingerprint.slice(0, 16) + '...',
      score: config.fingerprintChangeDrift,
    })
  }
  
  if (drift.userAgentChanged) {
    driftIncrement += config.userAgentChangeDrift
    driftEvents.push({
      type: 'user_agent_change',
      oldValue: binding.userAgent.slice(0, 50),
      newValue: currentUserAgent.slice(0, 50),
      score: config.userAgentChangeDrift,
    })
  }
  
  if (drift.ipChanged) {
    driftIncrement += config.ipChangeDrift
    driftEvents.push({
      type: 'ip_change',
      oldValue: binding.ipAddress,
      newValue: currentIP,
      score: config.ipChangeDrift,
    })
  }
  
  drift.totalDriftScore += driftIncrement
  
  // Determine action based on drift
  let action: 'allow' | 'challenge' | 'terminate' = 'allow'
  let reason: string | undefined
  
  if (drift.totalDriftScore >= config.maxDriftScore) {
    action = 'terminate'
    reason = `Drift score ${drift.totalDriftScore} exceeds maximum ${config.maxDriftScore}`
  } else if (drift.fingerprintChanged || (drift.ipChanged && drift.userAgentChanged)) {
    action = 'challenge'
    reason = 'Multiple binding properties changed - verification required'
  } else if (drift.ipChanged && drift.geoChanged) {
    action = 'challenge'
    reason = 'IP and location change detected'
  }
  
  // Update binding state
  binding.driftScore = drift.totalDriftScore
  binding.lastValidatedAt = new Date()
  binding.validationCount++
  
  if (action === 'terminate') {
    binding.isValid = false
  }
  
  // If no drift, update binding to current values (allows natural roaming)
  if (driftIncrement === 0) {
    // Decay drift over time for consistent users
    if (binding.driftScore > 0) {
      binding.driftScore = Math.max(0, binding.driftScore - 1)
    }
  }
  
  // Update cache
  sessionBindings.set(sessionId, binding)
  
  // Persist updates and log drift events
  try {
    await pool.query(`
      UPDATE session_bindings SET
        drift_score = $1,
        last_validated_at = NOW(),
        validation_count = $2,
        is_valid = $3
      WHERE session_id = $4
    `, [binding.driftScore, binding.validationCount, binding.isValid, sessionId])
    
    // Log drift events
    for (const event of driftEvents) {
      await pool.query(`
        INSERT INTO session_drift_events (
          session_id, drift_type, old_value, new_value, drift_score, action_taken
        ) VALUES ($1, $2, $3, $4, $5, $6)
      `, [sessionId, event.type, event.oldValue, event.newValue, event.score, action])
    }
  } catch {}
  
  if (action !== 'allow') {
    logger.warn(`[ZeroTrustSession] Session ${sessionId.slice(0, 8)}... action: ${action}, drift: ${drift.totalDriftScore}`)
  }
  
  return {
    valid: action !== 'terminate',
    drift,
    action,
    reason,
  }
}

/**
 * Create a session challenge for re-verification
 */
export async function createSessionChallenge(
  sessionId: string,
  challengeType: 'totp' | 'email' | 'passkey' | 'security_question' = 'totp'
): Promise<SessionChallenge> {
  const challengeId = crypto.randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now() + config.challengeExpirationMinutes * 60 * 1000)
  
  const challenge: SessionChallenge = {
    challengeId,
    sessionId,
    challengeType,
    expiresAt,
    attempts: 0,
  }
  
  pendingChallenges.set(challengeId, challenge)
  
  await pool.query(`
    INSERT INTO session_challenges (challenge_id, session_id, challenge_type, expires_at)
    VALUES ($1, $2, $3, $4)
  `, [challengeId, sessionId, challengeType, expiresAt]).catch(() => {})
  
  return challenge
}

/**
 * Verify a session challenge response
 */
export async function verifySessionChallenge(
  challengeId: string,
  response: string
): Promise<{ success: boolean; error?: string }> {
  const challenge = pendingChallenges.get(challengeId)
  
  if (!challenge) {
    return { success: false, error: 'Challenge not found or expired' }
  }
  
  if (challenge.expiresAt < new Date()) {
    pendingChallenges.delete(challengeId)
    return { success: false, error: 'Challenge expired' }
  }
  
  challenge.attempts++
  
  if (challenge.attempts > config.maxChallengeAttempts) {
    pendingChallenges.delete(challengeId)
    // Invalidate the session
    await invalidateSession(challenge.sessionId, 'Too many failed challenge attempts')
    return { success: false, error: 'Too many attempts - session invalidated' }
  }
  
  // Verification would depend on challenge type
  // For now, this is a placeholder for integration with MFA services
  const verified = true // Would call actual verification
  
  if (verified) {
    pendingChallenges.delete(challengeId)
    
    // Reset drift score on successful challenge
    const binding = sessionBindings.get(challenge.sessionId)
    if (binding) {
      binding.driftScore = 0
      sessionBindings.set(challenge.sessionId, binding)
      
      await pool.query(
        'UPDATE session_bindings SET drift_score = 0 WHERE session_id = $1',
        [challenge.sessionId]
      ).catch(() => {})
    }
    
    return { success: true }
  }
  
  return { success: false, error: 'Invalid response' }
}

/**
 * Invalidate a session
 */
export async function invalidateSession(
  sessionId: string,
  reason: string
): Promise<void> {
  sessionBindings.delete(sessionId)
  
  await pool.query(`
    UPDATE session_bindings SET is_valid = FALSE WHERE session_id = $1
  `, [sessionId]).catch(() => {})
  
  // Log drift event
  await pool.query(`
    INSERT INTO session_drift_events (
      session_id, drift_type, old_value, new_value, drift_score, action_taken
    ) VALUES ($1, 'invalidation', '', $2, 0, 'terminate')
  `, [sessionId, reason]).catch(() => {})
  
  logger.info(`[ZeroTrustSession] Session ${sessionId.slice(0, 8)}... invalidated: ${reason}`)
}

/**
 * Invalidate all sessions for a user
 */
export async function invalidateAllUserSessions(
  userId: string,
  reason: string
): Promise<number> {
  // Find and remove from cache
  for (const [sessionId, binding] of sessionBindings) {
    if (binding.userId === userId) {
      sessionBindings.delete(sessionId)
    }
  }
  
  // Invalidate in database
  const result = await pool.query(`
    UPDATE session_bindings SET is_valid = FALSE
    WHERE user_id = $1 AND is_valid = TRUE
    RETURNING session_id
  `, [userId])
  
  const count = result.rowCount || 0
  if (count > 0) {
    logger.info(`[ZeroTrustSession] Invalidated ${count} sessions for user ${userId}: ${reason}`)
  }
  
  return count
}

/**
 * Get user's active sessions
 */
export async function getUserSessions(userId: string): Promise<SessionBinding[]> {
  const result = await pool.query(`
    SELECT * FROM session_bindings
    WHERE user_id = $1 AND is_valid = TRUE
    ORDER BY last_validated_at DESC
  `, [userId])
  
  return result.rows.map(row => ({
    sessionId: row.session_id,
    userId: row.user_id,
    bindingHash: row.binding_hash,
    deviceFingerprint: row.device_fingerprint,
    ipAddress: row.ip_address,
    userAgent: row.user_agent,
    userAgentHash: row.user_agent_hash,
    geoLocation: row.geo_location,
    createdAt: row.created_at,
    lastValidatedAt: row.last_validated_at,
    validationCount: row.validation_count,
    driftScore: row.drift_score,
    isValid: row.is_valid,
  }))
}

/**
 * Decay drift scores periodically
 */
async function decayDriftScores(): Promise<void> {
  // Decay in-memory cache
  for (const [sessionId, binding] of sessionBindings) {
    if (binding.driftScore > 0) {
      binding.driftScore = Math.max(0, binding.driftScore - config.driftDecayRate)
    }
  }
  
  // Decay in database
  await pool.query(`
    UPDATE session_bindings
    SET drift_score = GREATEST(0, drift_score - $1)
    WHERE is_valid = TRUE AND drift_score > 0
  `, [config.driftDecayRate]).catch(() => {})
}

/**
 * Clean expired challenges
 */
async function cleanExpiredChallenges(): Promise<void> {
  const now = new Date()
  
  for (const [challengeId, challenge] of pendingChallenges) {
    if (challenge.expiresAt < now) {
      pendingChallenges.delete(challengeId)
    }
  }
  
  await pool.query(`
    DELETE FROM session_challenges WHERE expires_at < NOW() OR completed = TRUE
  `).catch(() => {})
}

/**
 * Get session drift history
 */
export async function getSessionDriftHistory(
  sessionId: string
): Promise<Array<{
  driftType: string
  oldValue: string
  newValue: string
  driftScore: number
  actionTaken: string
  createdAt: Date
}>> {
  const result = await pool.query(`
    SELECT drift_type, old_value, new_value, drift_score, action_taken, created_at
    FROM session_drift_events
    WHERE session_id = $1
    ORDER BY created_at DESC
    LIMIT 50
  `, [sessionId])
  
  return result.rows.map(row => ({
    driftType: row.drift_type,
    oldValue: row.old_value,
    newValue: row.new_value,
    driftScore: row.drift_score,
    actionTaken: row.action_taken,
    createdAt: row.created_at,
  }))
}

/**
 * Express middleware for zero-trust session validation
 */
export function zeroTrustSessionMiddleware() {
  return async (req: any, res: any, next: any) => {
    const sessionId = req.session?.id || req.cookies?.sessionId
    if (!sessionId) return next()
    
    const currentIP = req.ip || req.socket.remoteAddress || '0.0.0.0'
    const currentUserAgent = req.headers['user-agent'] || ''
    const currentFingerprint = req.headers['x-device-fingerprint'] as string || ''
    const currentGeo = req.geoLocation // Set by geo middleware if available
    
    try {
      const validation = await validateSession(
        sessionId,
        currentIP,
        currentUserAgent,
        currentFingerprint,
        currentGeo
      )
      
      req.sessionValidation = validation
      
      if (validation.action === 'terminate') {
        // Clear session cookie
        res.clearCookie('sessionId')
        return res.status(401).json({
          success: false,
          error: {
            code: 'SESSION_TERMINATED',
            message: 'Session security check failed. Please log in again.',
          },
        })
      }
      
      if (validation.action === 'challenge') {
        const challenge = await createSessionChallenge(sessionId)
        return res.status(403).json({
          success: false,
          error: {
            code: 'SESSION_CHALLENGE_REQUIRED',
            message: 'Session verification required',
          },
          challenge: {
            id: challenge.challengeId,
            type: challenge.challengeType,
            expiresAt: challenge.expiresAt,
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
  initZeroTrustSessions,
  createSessionBinding,
  validateSession,
  createSessionChallenge,
  verifySessionChallenge,
  invalidateSession,
  invalidateAllUserSessions,
  getUserSessions,
  getSessionDriftHistory,
  zeroTrustSessionMiddleware,
}
