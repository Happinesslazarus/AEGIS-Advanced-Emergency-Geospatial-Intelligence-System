/**
 * Login risk scorer — evaluates each login attempt on a 0–100 scale using
 * known IPs, recent failures, User-Agent history, and time-of-day heuristics.
 *
 * - Called by auth routes before issuing tokens
 * - Reads login history from the security_events table via securityLogger
 * - Sets require2FA / alertAdmin flags based on computed risk level
 * */

import pool from '../models/db.js'
import { logSecurityEvent } from './securityLogger.js'

export type RiskLevel = 'low' | 'medium' | 'high'

export interface RiskAssessment {
  score: number
  level: RiskLevel
  factors: string[]
  require2FA: boolean
  alertAdmin: boolean
}

/**
 * Assess the risk of a login attempt for an operator.
 */
export async function assessLoginRisk(
  operatorId: string,
  ipAddress: string,
  userAgent: string
): Promise<RiskAssessment> {
  const factors: string[] = []
  let score = 0

  // 1. Check if this is a known IP for this operator
  const knownIpResult = await pool.query(
    `SELECT COUNT(*) as cnt
     FROM security_events
     WHERE user_id = $1 AND user_type = 'operator'
       AND event_type IN ('login_success', '2fa_auth_success')
       AND ip_address = $2::inet
       AND created_at > NOW() - INTERVAL '90 days'`,
    [operatorId, ipAddress]
  ).catch(() => ({ rows: [{ cnt: '0' }] }))

  const knownIpCount = parseInt(knownIpResult.rows[0]?.cnt || '0')
  if (knownIpCount === 0) {
    score += 25
    factors.push('new_ip_address')
  }

  // 2. Check recent failed login attempts for this user
  const recentFailures = await pool.query(
    `SELECT COUNT(*) as cnt
     FROM security_events
     WHERE user_id = $1 AND user_type = 'operator'
       AND event_type IN ('login_failed', '2fa_auth_failed')
       AND created_at > NOW() - INTERVAL '1 hour'`,
    [operatorId]
  ).catch(() => ({ rows: [{ cnt: '0' }] }))

  const failureCount = parseInt(recentFailures.rows[0]?.cnt || '0')
  if (failureCount >= 3) {
    score += 20
    factors.push('recent_failures')
  }
  if (failureCount >= 10) {
    score += 20
    factors.push('excessive_failures')
  }

  // 3. Check for suspicious activity from this IP
  const suspiciousIp = await pool.query(
    `SELECT COUNT(*) as cnt
     FROM security_events
     WHERE ip_address = $1::inet
       AND event_type = 'suspicious_activity'
       AND created_at > NOW() - INTERVAL '24 hours'`,
    [ipAddress]
  ).catch(() => ({ rows: [{ cnt: '0' }] }))

  if (parseInt(suspiciousIp.rows[0]?.cnt || '0') > 0) {
    score += 30
    factors.push('suspicious_ip')
  }

  // 4. Check if this User-Agent has been seen before
  const knownUaResult = await pool.query(
    `SELECT COUNT(*) as cnt
     FROM security_events
     WHERE user_id = $1 AND user_type = 'operator'
       AND event_type IN ('login_success', '2fa_auth_success')
       AND user_agent = $2
       AND created_at > NOW() - INTERVAL '90 days'`,
    [operatorId, userAgent]
  ).catch(() => ({ rows: [{ cnt: '0' }] }))

  if (parseInt(knownUaResult.rows[0]?.cnt || '0') === 0) {
    score += 15
    factors.push('new_user_agent')
  }

  // 5. Check for logins outside business hours (local time approximation)
  const hour = new Date().getUTCHours()
  if (hour < 5 || hour > 23) {
    score += 10
    factors.push('unusual_hours')
  }

  // Clamp to 0-100
  score = Math.min(100, Math.max(0, score))

  const level: RiskLevel = score <= 30 ? 'low' : score <= 60 ? 'medium' : 'high'
  const require2FA = level !== 'low' // Low risk with trusted device can skip 2FA
  const alertAdmin = level === 'high'

  if (level === 'high') {
    await logSecurityEvent({
      userId: operatorId, userType: 'operator',
      eventType: 'risk_elevated',
      ipAddress, userAgent,
      metadata: { score, factors, level },
    })
  }

  return { score, level, factors, require2FA, alertAdmin }
}

/**
 * Check if an action is high-risk and requires re-authentication.
 * Used for sensitive admin operations.
 */
export function isHighRiskAction(action: string): boolean {
  const highRiskActions = [
    'delete_operator',
    'change_role',
    'broadcast_alert',
    'delete_citizen_data',
    'modify_system_config',
    'disable_2fa_for_other',
    'export_all_data',
    'revoke_all_sessions',
  ]
  return highRiskActions.includes(action)
}

/**
 * Get a security summary for an operator (for the security dashboard).
 */
export async function getOperatorSecuritySummary(operatorId: string): Promise<{
  recentLogins: number
  recentFailures: number
  suspiciousEvents: number
  lastLoginAt: string | null
  lastLoginIp: string | null
  riskScore: number
}> {
  const [logins, failures, suspicious, lastLogin] = await Promise.all([
    pool.query(
      `SELECT COUNT(*) as cnt FROM security_events
       WHERE user_id = $1 AND event_type IN ('login_success', '2fa_auth_success')
       AND created_at > NOW() - INTERVAL '30 days'`,
      [operatorId]
    ).catch(() => ({ rows: [{ cnt: '0' }] })),

    pool.query(
      `SELECT COUNT(*) as cnt FROM security_events
       WHERE user_id = $1 AND event_type IN ('login_failed', '2fa_auth_failed')
       AND created_at > NOW() - INTERVAL '30 days'`,
      [operatorId]
    ).catch(() => ({ rows: [{ cnt: '0' }] })),

    pool.query(
      `SELECT COUNT(*) as cnt FROM security_events
       WHERE user_id = $1 AND event_type = 'suspicious_activity'
       AND created_at > NOW() - INTERVAL '30 days'`,
      [operatorId]
    ).catch(() => ({ rows: [{ cnt: '0' }] })),

    pool.query(
      `SELECT ip_address, created_at FROM security_events
       WHERE user_id = $1 AND event_type IN ('login_success', '2fa_auth_success')
       ORDER BY created_at DESC LIMIT 1`,
      [operatorId]
    ).catch(() => ({ rows: [] })),
  ])

  const failureCount = parseInt(failures.rows[0]?.cnt || '0')
  const suspiciousCount = parseInt(suspicious.rows[0]?.cnt || '0')
  const riskScore = Math.min(100, failureCount * 5 + suspiciousCount * 20)

  return {
    recentLogins: parseInt(logins.rows[0]?.cnt || '0'),
    recentFailures: failureCount,
    suspiciousEvents: suspiciousCount,
    lastLoginAt: lastLogin.rows[0]?.created_at || null,
    lastLoginIp: lastLogin.rows[0]?.ip_address || null,
    riskScore,
  }
}
