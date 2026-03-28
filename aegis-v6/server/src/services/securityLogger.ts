/*
 * securityLogger.ts - Security Event Logging Service
 *
 * Records all authentication and security events in the security_events table
 * for audit trail, suspicious activity detection, and compliance.
 *
 * Event types:
 *   login_success, login_failed, account_locked, account_unlocked,
 *   register, email_verified, password_changed, password_reset_requested,
 *   password_reset_completed, session_created, session_revoked,
 *   token_refreshed, suspicious_activity
 */

import pool from '../models/db.js'
import { logger } from './logger.js'

export type SecurityEventType =
  | 'login_success'
  | 'login_failed'
  | 'account_locked'
  | 'account_unlocked'
  | 'register'
  | 'email_verified'
  | 'email_verification_sent'
  | 'password_changed'
  | 'password_reset_requested'
  | 'password_reset_completed'
  | 'session_created'
  | 'session_revoked'
  | 'session_revoked_all'
  | 'token_refreshed'
  | 'logout'
  | 'suspicious_activity'
  | '2fa_setup_initiated'
  | '2fa_enabled'
  | '2fa_verify_failed'
  | '2fa_disabled'
  | '2fa_backup_code_used'
  | '2fa_backup_codes_regenerated'
  | '2fa_auth_success'
  | '2fa_auth_failed'
  | '2fa_temp_token_expired'
  | 'device_trusted'
  | 'device_revoked'
  | 'all_devices_revoked'
  | 'security_alert_sent'
  | 'risk_elevated'

interface SecurityEventOptions {
  userId?: string
  userType?: 'citizen' | 'operator'
  eventType: SecurityEventType
  ipAddress?: string
  userAgent?: string
  metadata?: Record<string, unknown>
}

 /**
 * Log a security event to the database.
 * Non-blocking — errors are caught and logged, never thrown.
 */
export async function logSecurityEvent(options: SecurityEventOptions): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO security_events (user_id, user_type, event_type, ip_address, user_agent, metadata)
       VALUES ($1, $2, $3, $4::inet, $5, $6::jsonb)`,
      [
        options.userId || null,
        options.userType || null,
        options.eventType,
        options.ipAddress || null,
        options.userAgent || null,
        JSON.stringify(options.metadata || {}),
      ]
    )
  } catch (err: any) {
    // Security logging must never crash the main flow
    logger.error({ err, eventType: options.eventType }, '[SecurityLogger] Failed to log event')
  }
}

 /**
 * Check for suspicious login patterns:
 * Multiple failed logins from different IPs for the same user
 * Rapid logins from the same IP for different accounts
 * Returns true if suspicious activity is detected.
 */
export async function checkSuspiciousActivity(
  userId: string,
  userType: 'citizen' | 'operator',
  ipAddress: string
): Promise<boolean> {
  try {
    // Check: 10+ failed logins in the last hour from different IPs
    const multiIpResult = await pool.query(
      `SELECT COUNT(DISTINCT ip_address) as ip_count
       FROM security_events
       WHERE user_id = $1 AND user_type = $2 AND event_type = 'login_failed'
       AND created_at > NOW() - INTERVAL '1 hour'`,
      [userId, userType]
    )

    if (parseInt(multiIpResult.rows[0]?.ip_count || '0') >= 5) {
      await logSecurityEvent({
        userId,
        userType,
        eventType: 'suspicious_activity',
        ipAddress,
        metadata: { reason: 'Failed logins from 5+ different IPs in 1 hour' },
      })
      return true
    }

    // Check: 20+ failed logins from this IP in the last hour (credential stuffing)
    const sameIpResult = await pool.query(
      `SELECT COUNT(*) as attempt_count
       FROM security_events
       WHERE ip_address = $1::inet AND event_type = 'login_failed'
       AND created_at > NOW() - INTERVAL '1 hour'`,
      [ipAddress]
    )

    if (parseInt(sameIpResult.rows[0]?.attempt_count || '0') >= 20) {
      await logSecurityEvent({
        userId,
        userType,
        eventType: 'suspicious_activity',
        ipAddress,
        metadata: { reason: 'IP has 20+ failed logins in 1 hour (possible credential stuffing)' },
      })
      return true
    }

    return false
  } catch {
    return false // Don't block login on logging errors
  }
}
