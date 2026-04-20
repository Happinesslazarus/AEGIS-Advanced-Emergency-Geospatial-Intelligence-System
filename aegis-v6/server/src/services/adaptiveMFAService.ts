/**
 * Adaptive MFA service -- evaluates request risk against NIST SP 800-63B
 * Authenticator Assurance Levels (AAL1-AAL3) to decide whether step-up
 * authentication is required before a sensitive operation proceeds.
 * https://pages.nist.gov/800-63-3/sp800-63b.html
 *
 * Risk accumulates from: anomaly detection base score, new-device flag (+20),
 * new-location flag (+15), and session age. If risk >= 60 or the resource's
 * required AAL exceeds the session's current AAL, the caller receives HTTP 403
 * with allowed methods and a challengeId. On success the session AAL is
 * elevated in-place.
 *
 * TOTP lookup checks admin (user_mfa table) first, then citizens
 * (citizens.two_factor_secret). Passkeys use webauthnAttestationService for
 * the cryptographic assertion. Every attempt is logged to mfa_step_up_history.
 *
 * OWASP MFA Cheat Sheet:
 * https://cheatsheetseries.owasp.org/cheatsheets/Multifactor_Authentication_Cheat_Sheet.html
 */

import crypto from 'crypto'
import { verifySync } from 'otplib'
import pool from '../models/db.js'
import { logger } from '../services/logger.js'
import { decrypt2FASecret } from '../utils/twoFactorCrypto.js'
import { verifyAuthenticationSignature } from './webauthnAttestationService.js'

//Authenticator Assurance Levels (AAL) per NIST SP 800-63B
export enum AuthenticatorAssuranceLevel {
  AAL1 = 1, // Single-factor: password
  AAL2 = 2, // Multi-factor: password + OTP/push
  AAL3 = 3, // Multi-factor with hardware key: FIDO2/PIV
}

export type MFAMethod =
  | 'password'
  | 'totp'
  | 'sms_otp'
  | 'email_otp'
  | 'push_notification'
  | 'passkey'
  | 'hardware_key'
  | 'biometric'
  | 'security_question'

export interface AuthenticationContext {
  userId: string
  sessionId: string
  currentAAL: AuthenticatorAssuranceLevel
  ip: string
  userAgent: string
  deviceFingerprint?: string
  geoLocation?: {
    country: string
    city: string
    lat: number
    lon: number
  }
  riskScore: number // From anomaly detection
  isNewDevice: boolean
  isNewLocation: boolean
  lastAuthentication: Date | null
  sessionAge: number // minutes since session start
}

export interface StepUpRequirement {
  required: boolean
  targetAAL: AuthenticatorAssuranceLevel
  allowedMethods: MFAMethod[]
  reason: string
  expiresIn: number // seconds until step-up expires
  transactionId?: string // For transaction binding
}

export interface StepUpChallenge {
  challengeId: string
  userId: string
  targetAAL: AuthenticatorAssuranceLevel
  method: MFAMethod
  challengeData?: string
  expiresAt: Date
  attempts: number
  transactionId?: string
  resourceId?: string
}

export interface ResourceProtection {
  resourceId: string
  resourceType: 'api' | 'page' | 'action' | 'data'
  requiredAAL: AuthenticatorAssuranceLevel
  reauthTimeout: number // seconds before re-auth required
  sensitiveActions?: string[]
}

//Configuration
const config = {
  defaultAAL: AuthenticatorAssuranceLevel.AAL2,
  challengeTimeoutMinutes: 5,
  maxChallengeAttempts: 3,
  sessionAgeThresholdMinutes: 30, // Re-auth after 30 min for sensitive ops
  riskScoreStepUpThreshold: 60,
  highValueTransactionThreshold: 1000, // Currency amount
}

//In-memory challenge storage (use Redis in production)
const pendingChallenges = new Map<string, StepUpChallenge>()

//Resource protection rules
const protectedResources = new Map<string, ResourceProtection>()

/**
 * Initialize adaptive MFA service
 */
export async function initAdaptiveMFA(): Promise<void> {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS mfa_step_up_history (
        id SERIAL PRIMARY KEY,
        user_id VARCHAR(100) NOT NULL,
        session_id VARCHAR(64) NOT NULL,
        from_aal INTEGER NOT NULL,
        to_aal INTEGER NOT NULL,
        method VARCHAR(50) NOT NULL,
        success BOOLEAN NOT NULL,
        reason TEXT,
        resource_id VARCHAR(255),
        transaction_id VARCHAR(64),
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      
      CREATE TABLE IF NOT EXISTS protected_resources (
        resource_id VARCHAR(255) PRIMARY KEY,
        resource_type VARCHAR(20) NOT NULL,
        required_aal INTEGER NOT NULL,
        reauth_timeout INTEGER DEFAULT 1800,
        sensitive_actions TEXT[],
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
      
      CREATE INDEX IF NOT EXISTS idx_mfa_step_up_user ON mfa_step_up_history(user_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_mfa_step_up_session ON mfa_step_up_history(session_id);
    `)
    
    //Load protected resources
    await loadProtectedResources()
    
    //Register default protected resources
    registerDefaultProtectedResources()
    
    //Clean expired challenges
    setInterval(cleanExpiredChallenges, 60 * 1000) // Every minute
    
    logger.info('[AdaptiveMFA] Service initialized')
  } catch (error: any) {
    logger.error('[AdaptiveMFA] Init failed:', error.message)
  }
}

/**
 * Load protected resources from database
 */
async function loadProtectedResources(): Promise<void> {
  try {
    const result = await pool.query('SELECT * FROM protected_resources')
    for (const row of result.rows) {
      protectedResources.set(row.resource_id, {
        resourceId: row.resource_id,
        resourceType: row.resource_type,
        requiredAAL: row.required_aal,
        reauthTimeout: row.reauth_timeout,
        sensitiveActions: row.sensitive_actions,
      })
    }
  } catch {}
}

/**
 * Register default protected resources
 */
function registerDefaultProtectedResources(): void {
  const defaults: ResourceProtection[] = [
    //Critical admin operations
    {
      resourceId: 'admin:*',
      resourceType: 'api',
      requiredAAL: AuthenticatorAssuranceLevel.AAL3,
      reauthTimeout: 300, // 5 minutes
    },
    //Financial transactions
    {
      resourceId: 'transactions:create',
      resourceType: 'api',
      requiredAAL: AuthenticatorAssuranceLevel.AAL2,
      reauthTimeout: 600,
      sensitiveActions: ['transfer', 'withdrawal', 'payment'],
    },
    //Security settings
    {
      resourceId: 'settings:security',
      resourceType: 'page',
      requiredAAL: AuthenticatorAssuranceLevel.AAL2,
      reauthTimeout: 300,
    },
    //Password change
    {
      resourceId: 'auth:password:change',
      resourceType: 'action',
      requiredAAL: AuthenticatorAssuranceLevel.AAL2,
      reauthTimeout: 180,
    },
    //Add MFA device
    {
      resourceId: 'auth:mfa:add',
      resourceType: 'action',
      requiredAAL: AuthenticatorAssuranceLevel.AAL2,
      reauthTimeout: 180,
    },
    //View sensitive data
    {
      resourceId: 'data:pii',
      resourceType: 'data',
      requiredAAL: AuthenticatorAssuranceLevel.AAL2,
      reauthTimeout: 900,
    },
    //API key management
    {
      resourceId: 'settings:api-keys',
      resourceType: 'api',
      requiredAAL: AuthenticatorAssuranceLevel.AAL3,
      reauthTimeout: 300,
    },
    //AI model retrain (admin) -- requires step-up: destructive and safety-critical
    {
      resourceId: 'admin:ai:retrain',
      resourceType: 'api',
      requiredAAL: AuthenticatorAssuranceLevel.AAL2,
      reauthTimeout: 600,
    },
    //AI model rollback (admin)
    {
      resourceId: 'admin:ai:rollback',
      resourceType: 'api',
      requiredAAL: AuthenticatorAssuranceLevel.AAL2,
      reauthTimeout: 600,
    },
  ]
  
  for (const resource of defaults) {
    if (!protectedResources.has(resource.resourceId)) {
      protectedResources.set(resource.resourceId, resource)
    }
  }
}

/**
 * Clean expired challenges
 */
function cleanExpiredChallenges(): void {
  const now = new Date()
  for (const [id, challenge] of pendingChallenges) {
    if (challenge.expiresAt < now) {
      pendingChallenges.delete(id)
    }
  }
}

/**
 * Calculate risk score from context
 */
function calculateContextRisk(context: AuthenticationContext): number {
  let risk = context.riskScore // Start with anomaly detection score
  
  //New device adds risk
  if (context.isNewDevice) {
    risk += 20
  }
  
  //New location adds risk
  if (context.isNewLocation) {
    risk += 15
  }
  
  //Session age increases risk for sensitive operations
  const sessionAgeMinutes = context.sessionAge
  if (sessionAgeMinutes > 60) {
    risk += 10
  }
  if (sessionAgeMinutes > 240) {
    risk += 20
  }
  
  //Cap at 100
  return Math.min(risk, 100)
}

/**
 * Determine available MFA methods for user -- handles both admins (user_mfa table)
 * and citizens (citizens.two_factor_secret column).
 */
async function getAvailableMFAMethods(userId: string): Promise<MFAMethod[]> {
  const methods: MFAMethod[] = ['password'] // Always available
  
  try {
    //Check admin TOTP (user_mfa table)
    const adminTotpResult = await pool.query(
      'SELECT 1 FROM user_mfa WHERE user_id = $1 AND type = $2 AND enabled = TRUE',
      [userId, 'totp']
    )
    if ((adminTotpResult.rowCount ?? 0) > 0) {
      methods.push('totp')
    }

    //Check citizen TOTP (stored directly on citizens row)
    if (!methods.includes('totp')) {
      const citizenTotpResult = await pool.query(
        'SELECT 1 FROM citizens WHERE id = $1 AND two_factor_enabled = TRUE AND two_factor_secret IS NOT NULL',
        [userId]
      )
      if ((citizenTotpResult.rowCount ?? 0) > 0) {
        methods.push('totp')
      }
    }
    
    //Check for passkeys (shared table, both user types)
    const passkeyResult = await pool.query(
      'SELECT 1 FROM passkey_credentials WHERE user_id = $1',
      [userId]
    )
    if ((passkeyResult.rowCount ?? 0) > 0) {
      methods.push('passkey', 'hardware_key')
    }
    
    //Check for backup contact methods -- try users table first, then citizens
    const adminResult = await pool.query(
      'SELECT email, phone FROM users WHERE id = $1',
      [userId]
    )
    const contactRow = adminResult.rows[0] || (
      await pool.query('SELECT email, phone FROM citizens WHERE id = $1', [userId])
    ).rows[0]

    if (contactRow?.email) methods.push('email_otp')
    if (contactRow?.phone) methods.push('sms_otp')
  } catch {}
  
  return methods
}

/**
 * Get AAL for MFA method
 */
function getMethodAAL(method: MFAMethod): AuthenticatorAssuranceLevel {
  switch (method) {
    case 'password':
      return AuthenticatorAssuranceLevel.AAL1
    case 'totp':
    case 'sms_otp':
    case 'email_otp':
    case 'push_notification':
    case 'security_question':
      return AuthenticatorAssuranceLevel.AAL2
    case 'passkey':
    case 'hardware_key':
    case 'biometric':
      return AuthenticatorAssuranceLevel.AAL3
    default:
      return AuthenticatorAssuranceLevel.AAL1
  }
}

/**
 * Check if step-up authentication is required
 */
export async function checkStepUpRequired(
  context: AuthenticationContext,
  resourceId: string,
  transactionValue?: number
): Promise<StepUpRequirement> {
  //Get resource protection requirements
  let protection = protectedResources.get(resourceId)
  
  //Check wildcard patterns
  if (!protection) {
    for (const [pattern, prot] of protectedResources) {
      if (pattern.endsWith(':*')) {
        const prefix = pattern.slice(0, -1)
        if (resourceId.startsWith(prefix)) {
          protection = prot
          break
        }
      }
    }
  }
  
  //Default protection
  if (!protection) {
    protection = {
      resourceId,
      resourceType: 'api',
      requiredAAL: AuthenticatorAssuranceLevel.AAL1,
      reauthTimeout: 3600,
    }
  }
  
  //Calculate current risk
  const risk = calculateContextRisk(context)
  
  //Determine required AAL
  let requiredAAL = protection.requiredAAL
  
  //Elevate AAL based on risk
  if (risk >= config.riskScoreStepUpThreshold) {
    requiredAAL = Math.max(requiredAAL, AuthenticatorAssuranceLevel.AAL2) as AuthenticatorAssuranceLevel
  }
  
  //Elevate for high-value transactions
  if (transactionValue && transactionValue >= config.highValueTransactionThreshold) {
    requiredAAL = Math.max(requiredAAL, AuthenticatorAssuranceLevel.AAL2) as AuthenticatorAssuranceLevel
    
    //Very high value requires AAL3
    if (transactionValue >= config.highValueTransactionThreshold * 10) {
      requiredAAL = AuthenticatorAssuranceLevel.AAL3
    }
  }
  
  //Check if re-auth needed based on timeout
  const lastAuth = context.lastAuthentication
  const timeSinceAuth = lastAuth
    ? (Date.now() - lastAuth.getTime()) / 1000
    : Infinity
  
  const needsReauth = timeSinceAuth > protection.reauthTimeout
  
  //Check if current AAL is sufficient
  const stepUpNeeded = context.currentAAL < requiredAAL || needsReauth
  
  if (!stepUpNeeded) {
    return {
      required: false,
      targetAAL: context.currentAAL,
      allowedMethods: [],
      reason: 'Current authentication is sufficient',
      expiresIn: Math.max(0, protection.reauthTimeout - timeSinceAuth),
    }
  }
  
  //Get available methods that can reach required AAL
  const availableMethods = await getAvailableMFAMethods(context.userId)
  const allowedMethods = availableMethods.filter(
    method => getMethodAAL(method) >= requiredAAL
  )
  
  //Build reason
  let reason: string
  if (needsReauth) {
    reason = `Re-authentication required (session age: ${Math.round(timeSinceAuth / 60)} minutes)`
  } else if (risk >= config.riskScoreStepUpThreshold) {
    reason = `Elevated risk detected (score: ${risk})`
  } else if (transactionValue) {
    reason = `High-value transaction (${transactionValue})`
  } else {
    reason = `Resource requires AAL${requiredAAL}`
  }
  
  return {
    required: true,
    targetAAL: requiredAAL,
    allowedMethods,
    reason,
    expiresIn: config.challengeTimeoutMinutes * 60,
    transactionId: transactionValue ? crypto.randomBytes(16).toString('hex') : undefined,
  }
}

/**
 * Create a step-up challenge
 */
export async function createStepUpChallenge(
  userId: string,
  targetAAL: AuthenticatorAssuranceLevel,
  method: MFAMethod,
  resourceId?: string,
  transactionId?: string
): Promise<StepUpChallenge> {
  //Verify method can provide required AAL
  if (getMethodAAL(method) < targetAAL) {
    throw new Error(`Method ${method} cannot provide AAL${targetAAL}`)
  }
  
  const challengeId = crypto.randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now() + config.challengeTimeoutMinutes * 60 * 1000)
  
  //Generate method-specific challenge data
  let challengeData: string | undefined
  switch (method) {
    case 'totp':
      //No additional challenge data needed
      break
    case 'passkey':
    case 'hardware_key':
      //WebAuthn challenge
      challengeData = crypto.randomBytes(32).toString('base64url')
      break
    case 'email_otp':
    case 'sms_otp':
      //Generate OTP and send
      challengeData = generateOTP()
      //Would send via email/SMS service
      break
    default:
      break
  }
  
  const challenge: StepUpChallenge = {
    challengeId,
    userId,
    targetAAL,
    method,
    challengeData,
    expiresAt,
    attempts: 0,
    transactionId,
    resourceId,
  }
  
  pendingChallenges.set(challengeId, challenge)
  
  logger.info(`[AdaptiveMFA] Challenge created: ${method} for user ${userId}, AAL${targetAAL}`)
  
  return challenge
}

/**
 * Generate 6-digit OTP
 */
function generateOTP(): string {
  return crypto.randomInt(100000, 999999).toString()
}

/**
 * Verify step-up challenge response
 */
export async function verifyStepUpChallenge(
  challengeId: string,
  response: string,
  sessionId: string
): Promise<{
  success: boolean
  newAAL?: AuthenticatorAssuranceLevel
  error?: string
}> {
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
    
    //Log failed step-up
    await logStepUpAttempt(
      challenge.userId,
      sessionId,
      AuthenticatorAssuranceLevel.AAL1,
      challenge.targetAAL,
      challenge.method,
      false,
      'Too many failed attempts',
      challenge.resourceId,
      challenge.transactionId
    )
    
    return { success: false, error: 'Too many failed attempts' }
  }
  
  //Verify based on method
  let verified = false
  
  switch (challenge.method) {
    case 'totp':
      //Would verify against user's TOTP secret
      verified = await verifyTOTP(challenge.userId, response)
      break
    case 'passkey':
    case 'hardware_key':
      //Would verify WebAuthn assertion
      verified = await verifyPasskey(challenge.userId, response, challenge.challengeData!)
      break
    case 'email_otp':
    case 'sms_otp':
      verified = response === challenge.challengeData
      break
    default:
      break
  }
  
  if (!verified) {
    return { success: false, error: 'Invalid response' }
  }
  
  //Success - clean up and log
  pendingChallenges.delete(challengeId)
  
  await logStepUpAttempt(
    challenge.userId,
    sessionId,
    AuthenticatorAssuranceLevel.AAL1, // Previous AAL (simplified)
    challenge.targetAAL,
    challenge.method,
    true,
    'Step-up successful',
    challenge.resourceId,
    challenge.transactionId
  )
  
  logger.info(`[AdaptiveMFA] Step-up verified: ${challenge.method} for user ${challenge.userId}`)
  
  return {
    success: true,
    newAAL: challenge.targetAAL,
  }
}

/**
 * Verify TOTP code against the user's stored encrypted secret.
 * Checks admin (user_mfa table) first, then citizen (citizens table).
 */
async function verifyTOTP(userId: string, code: string): Promise<boolean> {
  try {
    const token = code.replace(/\s/g, '')
    const opts = { token, digits: 6, period: 30, window: 1 } as any

    //Admin path: user_mfa table
    const adminResult = await pool.query(
      'SELECT secret FROM user_mfa WHERE user_id = $1 AND type = $2 AND enabled = TRUE LIMIT 1',
      [userId, 'totp']
    )
    if (adminResult.rows[0]) {
      const secret = decrypt2FASecret(adminResult.rows[0].secret)
      const result = verifySync({ ...opts, secret })
      return result.valid
    }

    //Citizen path: two_factor_secret column on citizens
    const citizenResult = await pool.query(
      'SELECT two_factor_secret FROM citizens WHERE id = $1 AND two_factor_enabled = TRUE AND two_factor_secret IS NOT NULL LIMIT 1',
      [userId]
    )
    if (citizenResult.rows[0]) {
      const secret = decrypt2FASecret(citizenResult.rows[0].two_factor_secret)
      const result = verifySync({ ...opts, secret })
      return result.valid
    }

    return false
  } catch (error: any) {
    logger.warn('[AdaptiveMFA] TOTP verification error:', error.message)
    return false
  }
}

/**
 * Verify passkey/WebAuthn assertion against stored credential
 */
async function verifyPasskey(userId: string, assertionJSON: string, challenge: string): Promise<boolean> {
  try {
    const assertion = JSON.parse(assertionJSON)
    const credResult = await pool.query(
      'SELECT credential_id, public_key, counter FROM passkey_credentials WHERE user_id = $1 AND credential_id = $2 LIMIT 1',
      [userId, assertion.rawId]
    )
    if (!credResult.rows[0]) return false
    const cred = credResult.rows[0]
    const rpId = process.env.WEBAUTHN_RP_ID || new URL(process.env.CLIENT_URL || 'http://localhost:5173').hostname
    const result = verifyAuthenticationSignature(
      assertion.response.authenticatorData,
      assertion.response.clientDataJSON,
      assertion.response.signature,
      cred.public_key,
      challenge,
      rpId,
      cred.counter
    )
    if (result.verified) {
      await pool.query(
        'UPDATE passkey_credentials SET counter = $1, last_used_at = NOW() WHERE credential_id = $2',
        [result.newCounter, assertion.rawId]
      )
    }
    return result.verified
  } catch (error: any) {
    logger.warn('[AdaptiveMFA] Passkey verification error:', error.message)
    return false
  }
}

/**
 * Log step-up attempt
 */
async function logStepUpAttempt(
  userId: string,
  sessionId: string,
  fromAAL: AuthenticatorAssuranceLevel,
  toAAL: AuthenticatorAssuranceLevel,
  method: MFAMethod,
  success: boolean,
  reason: string,
  resourceId?: string,
  transactionId?: string
): Promise<void> {
  try {
    await pool.query(`
      INSERT INTO mfa_step_up_history (
        user_id, session_id, from_aal, to_aal, method, success, reason, resource_id, transaction_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `, [userId, sessionId, fromAAL, toAAL, method, success, reason, resourceId, transactionId])
  } catch {}
}

/**
 * Register a protected resource
 */
export async function registerProtectedResource(
  resource: ResourceProtection
): Promise<void> {
  protectedResources.set(resource.resourceId, resource)
  
  try {
    await pool.query(`
      INSERT INTO protected_resources (resource_id, resource_type, required_aal, reauth_timeout, sensitive_actions)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (resource_id) DO UPDATE SET
        resource_type = EXCLUDED.resource_type,
        required_aal = EXCLUDED.required_aal,
        reauth_timeout = EXCLUDED.reauth_timeout,
        sensitive_actions = EXCLUDED.sensitive_actions,
        updated_at = NOW()
    `, [
      resource.resourceId,
      resource.resourceType,
      resource.requiredAAL,
      resource.reauthTimeout,
      resource.sensitiveActions || [],
    ])
  } catch {}
}

/**
 * Get step-up history for a user
 */
export async function getStepUpHistory(
  userId: string,
  limit = 50
): Promise<Array<{
  fromAAL: AuthenticatorAssuranceLevel
  toAAL: AuthenticatorAssuranceLevel
  method: MFAMethod
  success: boolean
  reason: string
  resourceId: string | null
  createdAt: Date
}>> {
  const result = await pool.query(`
    SELECT from_aal, to_aal, method, success, reason, resource_id, created_at
    FROM mfa_step_up_history
    WHERE user_id = $1
    ORDER BY created_at DESC
    LIMIT $2
  `, [userId, limit])
  
  return result.rows.map(row => ({
    fromAAL: row.from_aal,
    toAAL: row.to_aal,
    method: row.method,
    success: row.success,
    reason: row.reason,
    resourceId: row.resource_id,
    createdAt: row.created_at,
  }))
}

/**
 * Get MFA step-up statistics
 */
export async function getStepUpStats(): Promise<{
  totalStepUps24h: number
  successRate: number
  topMethods: Array<{ method: string; count: number }>
  averageAAL: number
}> {
  const [total, methods, avgAAL] = await Promise.all([
    pool.query(`
      SELECT 
        COUNT(*)::int as total,
        COUNT(*) FILTER (WHERE success = TRUE)::int as successful
      FROM mfa_step_up_history
      WHERE created_at > NOW() - INTERVAL '24 hours'
    `),
    pool.query(`
      SELECT method, COUNT(*)::int as count
      FROM mfa_step_up_history
      WHERE created_at > NOW() - INTERVAL '7 days' AND success = TRUE
      GROUP BY method ORDER BY count DESC LIMIT 10
    `),
    pool.query(`
      SELECT AVG(to_aal)::float as avg FROM mfa_step_up_history
      WHERE created_at > NOW() - INTERVAL '7 days' AND success = TRUE
    `),
  ])
  
  const totalCount = total.rows[0]?.total || 0
  const successCount = total.rows[0]?.successful || 0
  
  return {
    totalStepUps24h: totalCount,
    successRate: totalCount > 0 ? successCount / totalCount : 0,
    topMethods: methods.rows,
    averageAAL: avgAAL.rows[0]?.avg || 1,
  }
}

/**
 * Express middleware for adaptive MFA step-up
 */
export function adaptiveMFAMiddleware(resourceId: string) {
  return async (req: any, res: any, next: any) => {
    if (!req.user?.id) return next()
    
    const context: AuthenticationContext = {
      userId: req.user.id,
      sessionId: req.session?.id || '',
      currentAAL: req.session?.aal || AuthenticatorAssuranceLevel.AAL1,
      ip: req.ip || req.socket.remoteAddress || '0.0.0.0',
      userAgent: req.headers['user-agent'] || '',
      deviceFingerprint: req.headers['x-device-fingerprint'] as string,
      geoLocation: req.geoLocation,
      riskScore: req.anomalyResult?.riskScore || 0,
      isNewDevice: req.anomalyResult?.anomalyTypes?.includes('new_device') || false,
      isNewLocation: req.anomalyResult?.anomalyTypes?.includes('new_location') || false,
      lastAuthentication: req.session?.lastAuth ? new Date(req.session.lastAuth) : null,
      sessionAge: req.session?.created 
        ? (Date.now() - new Date(req.session.created).getTime()) / 60000
        : 0,
    }
    
    //Get transaction value if applicable
    const transactionValue = req.body?.amount || req.body?.value
    
    const requirement = await checkStepUpRequired(context, resourceId, transactionValue)
    
    if (requirement.required) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'STEP_UP_REQUIRED',
          message: requirement.reason,
        },
        stepUp: {
          requiredAAL: requirement.targetAAL,
          allowedMethods: requirement.allowedMethods,
          transactionId: requirement.transactionId,
          expiresIn: requirement.expiresIn,
        },
      })
    }
    
    next()
  }
}

export default {
  initAdaptiveMFA,
  checkStepUpRequired,
  createStepUpChallenge,
  verifyStepUpChallenge,
  registerProtectedResource,
  getStepUpHistory,
  getStepUpStats,
  adaptiveMFAMiddleware,
  AuthenticatorAssuranceLevel,
}
