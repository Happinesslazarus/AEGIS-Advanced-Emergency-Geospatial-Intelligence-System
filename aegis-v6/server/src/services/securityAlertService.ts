/**
 * Operator security alert dispatcher — sends alerts (2FA disabled, new device,
 * backup code used, account locked, etc.) based on per-operator notification
 * preferences stored in operator_security_preferences.
 *
 * - Called by auth and security services when notable events occur
 * - Reads notification preferences from operator_security_preferences table
 * - Sends alerts via emailService and logs via securityLogger
 * */

import pool from '../models/db.js'
import { logSecurityEvent } from './securityLogger.js'
import { logger } from './logger.js'
import { sendSecurityAlertEmail } from './emailService.js'

export type SecurityAlertType =
  | '2fa_disabled'
  | 'backup_code_used'
  | 'new_device_login'
  | 'suspicious_access'
  | 'account_locked'
  | 'repeated_failures'

interface SecurityAlert {
  operatorId: string
  alertType: SecurityAlertType
  title: string
  message: string
  severity: 'info' | 'warning' | 'critical'
  metadata?: Record<string, unknown>
}

/**
 * Check if the operator wants to receive a specific alert type.
 */
async function shouldAlert(operatorId: string, alertType: SecurityAlertType): Promise<boolean> {
  const result = await pool.query(
    'SELECT * FROM operator_security_preferences WHERE operator_id = $1',
    [operatorId]
  ).catch(() => ({ rows: [] }))

  if (result.rows.length === 0) {
    // No preferences set - default to alerting on everything
    return true
  }

  const prefs = result.rows[0]
  const prefMap: Record<SecurityAlertType, string> = {
    '2fa_disabled': 'alert_on_2fa_disabled',
    'backup_code_used': 'alert_on_backup_code_used',
    'new_device_login': 'alert_on_new_device_login',
    'suspicious_access': 'alert_on_suspicious_access',
    'account_locked': 'alert_on_lockout',
    'repeated_failures': 'alert_on_lockout',
  }

  const column = prefMap[alertType]
  return column ? (prefs[column] !== false) : true
}

/**
 * Send a security alert to an operator.
 * Currently stores in security_events for in-app display.
 * Email integration can be added via emailService.
 */
export async function sendSecurityAlert(alert: SecurityAlert): Promise<void> {
  try {
    // Check preferences
    if (!(await shouldAlert(alert.operatorId, alert.alertType))) {
      return
    }

    // Store as a security event for in-app notifications
    await logSecurityEvent({
      userId: alert.operatorId,
      userType: 'operator',
      eventType: 'security_alert_sent',
      metadata: {
        alert_type: alert.alertType,
        title: alert.title,
        message: alert.message,
        severity: alert.severity,
        ...alert.metadata,
      },
    })

    // Insert into activity_log for dashboard visibility
    await pool.query(
      `INSERT INTO activity_log (action, action_type, operator_id, metadata)
       VALUES ($1, $2, $3, $4::jsonb)`,
      [
        `Security Alert: ${alert.title}`,
        'security_alert',
        alert.operatorId,
        JSON.stringify({
          alert_type: alert.alertType,
          severity: alert.severity,
          message: alert.message,
          ...alert.metadata,
        }),
      ]
    ).catch(() => {})

    // Send email notification via emailService
    try {
      const operator = await pool.query('SELECT email FROM operators WHERE id = $1', [alert.operatorId])
      if (operator.rows[0]?.email) {
        await sendSecurityAlertEmail(operator.rows[0].email, alert.title, alert.message, alert.severity)
      }
    } catch (emailErr) {
      logger.warn({ err: emailErr, alertType: alert.alertType }, '[SecurityAlerts] Email delivery failed (alert still stored in DB)')
    }
  } catch (err) {
    logger.error({ err, alertType: alert.alertType }, '[SecurityAlerts] Failed to send alert')
  }
}

// Pre-built Alert Factories

export async function alert2FADisabled(operatorId: string, ip: string): Promise<void> {
  await sendSecurityAlert({
    operatorId,
    alertType: '2fa_disabled',
    title: 'Two-Factor Authentication Disabled',
    message: 'Two-factor authentication was disabled on your account. If you did not perform this action, please re-enable 2FA immediately and change your password.',
    severity: 'critical',
    metadata: { ip },
  })
}

export async function alertBackupCodeUsed(operatorId: string, remaining: number, ip: string): Promise<void> {
  await sendSecurityAlert({
    operatorId,
    alertType: 'backup_code_used',
    title: 'Backup Recovery Code Used',
    message: `A backup recovery code was used to access your account. Consider regenerating your backup codes in Settings.`,
    severity: 'warning',
    metadata: { remaining_codes: remaining, ip },
  })
}

export async function alertNewDeviceLogin(operatorId: string, deviceName: string, ip: string): Promise<void> {
  await sendSecurityAlert({
    operatorId,
    alertType: 'new_device_login',
    title: 'Login from New Device',
    message: `Your account was accessed from a new device: ${deviceName}. If this was not you, change your password immediately.`,
    severity: 'info',
    metadata: { device_name: deviceName, ip },
  })
}

export async function alertSuspiciousAccess(operatorId: string, reason: string, ip: string): Promise<void> {
  await sendSecurityAlert({
    operatorId,
    alertType: 'suspicious_access',
    title: 'Suspicious Access Detected',
    message: `Suspicious activity was detected on your account: ${reason}. Please verify your recent activity.`,
    severity: 'critical',
    metadata: { reason, ip },
  })
}

export async function alertAccountLocked(operatorId: string, minutes: number, ip: string): Promise<void> {
  await sendSecurityAlert({
    operatorId,
    alertType: 'account_locked',
    title: 'Account Temporarily Locked',
    message: `Your account has been temporarily locked for ${minutes} minutes due to repeated failed login attempts.`,
    severity: 'warning',
    metadata: { lockout_minutes: minutes, ip },
  })
}

export async function alertRepeatedFailures(operatorId: string, count: number, ip: string): Promise<void> {
  await sendSecurityAlert({
    operatorId,
    alertType: 'repeated_failures',
    title: 'Multiple Failed Login Attempts',
    message: `There have been ${count} failed login attempts on your account in the last hour. If this was not you, consider changing your password.`,
    severity: 'warning',
    metadata: { failure_count: count, ip },
  })
}

// Security Dashboard Queries

/**
 * Get recent security alerts for the admin security dashboard.
 */
export async function getRecentSecurityAlerts(limit: number = 50): Promise<Array<{
  id: string
  operatorId: string | null
  alertType: string
  severity: string
  title: string
  message: string
  ipAddress: string | null
  createdAt: string
}>> {
  const result = await pool.query(
    `SELECT id, user_id, metadata, ip_address, created_at
     FROM security_events
     WHERE event_type = 'security_alert_sent'
     ORDER BY created_at DESC
     LIMIT $1`,
    [limit]
  )

  return result.rows.map(r => ({
    id: r.id,
    operatorId: r.user_id,
    alertType: r.metadata?.alert_type || 'unknown',
    severity: r.metadata?.severity || 'info',
    title: r.metadata?.title || '',
    message: r.metadata?.message || '',
    ipAddress: r.ip_address,
    createdAt: r.created_at,
  }))
}

/**
 * Get security event counts grouped by type for dashboard analytics.
 */
export async function getSecurityEventStats(hours: number = 24): Promise<Record<string, number>> {
  const result = await pool.query(
    `SELECT event_type, COUNT(*)::int as count
     FROM security_events
     WHERE created_at > NOW() - make_interval(hours => $1)
     GROUP BY event_type
     ORDER BY count DESC`,
    [hours]
  )

  const stats: Record<string, number> = {}
  for (const row of result.rows) {
    stats[row.event_type] = row.count
  }
  return stats
}

/**
 * Get operators with the most failed attempts (for admin monitoring).
 */
export async function getMostFailedOperators(limit: number = 10): Promise<Array<{
  operatorId: string
  email: string
  displayName: string
  failedAttempts: number
  lastFailedAt: string
}>> {
  const result = await pool.query(
    `SELECT se.user_id, o.email, o.display_name,
            COUNT(*)::int as failed_attempts,
            MAX(se.created_at) as last_failed_at
     FROM security_events se
     JOIN operators o ON o.id = se.user_id
     WHERE se.event_type IN ('login_failed', '2fa_auth_failed')
       AND se.created_at > NOW() - INTERVAL '24 hours'
     GROUP BY se.user_id, o.email, o.display_name
     ORDER BY failed_attempts DESC
     LIMIT $1`,
    [limit]
  )

  return result.rows.map(r => ({
    operatorId: r.user_id,
    email: r.email,
    displayName: r.display_name,
    failedAttempts: r.failed_attempts,
    lastFailedAt: r.last_failed_at,
  }))
}
