/**
 * Device fingerprinting and trust management — generates SHA-256 fingerprints
 * from User-Agent + IP subnet + operator ID and tracks trusted devices with
 * 30-day expiry (max 10 per user).
 *
 * - Called by auth routes during login to check/register devices
 * - Reads/writes the trusted_devices table
 * - Logs trust events through securityLogger
 * */

import crypto from 'crypto'
import pool from '../models/db.js'
import { logSecurityEvent } from './securityLogger.js'

const TRUST_DURATION_DAYS = 30
const MAX_TRUSTED_DEVICES = 10

// Device Fingerprinting

/**
 * Generate a deterministic device fingerprint hash.
 * Components: user-agent + operator ID (IP excluded so trust persists across
 * dynamic IPs, VPNs, and network changes — consistent with browser "remember me").
 */
export function generateDeviceFingerprint(
  userAgent: string,
  _ipAddress: string,
  operatorId: string
): string {
  const raw = `${userAgent}|${operatorId}`
  return crypto.createHash('sha256').update(raw).digest('hex')
}

/**
 * Extract the /24 subnet from an IP address for loose matching.
 * "192.168.1.123" ? "192.168.1"
 * IPv6 or missing ? full string (no subnet extraction)
 */
function extractSubnet(ip: string): string {
  if (!ip) return 'unknown'
  // IPv4
  const v4Parts = ip.replace(/^::ffff:/, '').split('.')
  if (v4Parts.length === 4) {
    return v4Parts.slice(0, 3).join('.')
  }
  // IPv6: use first 4 groups
  const v6Parts = ip.split(':')
  if (v6Parts.length >= 4) {
    return v6Parts.slice(0, 4).join(':')
  }
  return ip
}

/**
 * Derive a human-readable device name from the User-Agent string.
 */
export function deriveDeviceName(userAgent: string): string {
  if (!userAgent) return 'Unknown Device'

  let browser = 'Browser'
  if (/Edg\//i.test(userAgent)) browser = 'Edge'
  else if (/Chrome\//i.test(userAgent)) browser = 'Chrome'
  else if (/Firefox\//i.test(userAgent)) browser = 'Firefox'
  else if (/Safari\//i.test(userAgent) && !/Chrome/i.test(userAgent)) browser = 'Safari'

  let os = 'Unknown OS'
  if (/Windows NT 10/i.test(userAgent)) os = 'Windows'
  else if (/Macintosh/i.test(userAgent)) os = 'macOS'
  else if (/Linux/i.test(userAgent)) os = 'Linux'
  else if (/iPhone/i.test(userAgent)) os = 'iPhone'
  else if (/Android/i.test(userAgent)) os = 'Android'
  else if (/iPad/i.test(userAgent)) os = 'iPad'

  return `${browser} on ${os}`
}

// Trust Management

/**
 * Check if a device is currently trusted for a given operator.
 * Returns the trusted device record if valid, null otherwise.
 */
export async function isDeviceTrusted(
  operatorId: string,
  userAgent: string,
  ipAddress: string
): Promise<{ id: string; deviceName: string } | null> {
  const deviceHash = generateDeviceFingerprint(userAgent, ipAddress, operatorId)

  const result = await pool.query(
    `SELECT id, device_name
     FROM trusted_devices
     WHERE operator_id = $1
       AND device_hash = $2
       AND revoked = false
       AND expires_at > NOW()
     LIMIT 1`,
    [operatorId, deviceHash]
  )

  if (result.rows.length === 0) return null

  // Update last_used_at
  await pool.query(
    'UPDATE trusted_devices SET last_used_at = NOW() WHERE id = $1',
    [result.rows[0].id]
  ).catch(() => {}) // non-critical

  return { id: result.rows[0].id, deviceName: result.rows[0].device_name }
}

/**
 * Trust the current device for the operator. Limits to MAX_TRUSTED_DEVICES.
 */
export async function trustDevice(
  operatorId: string,
  userAgent: string,
  ipAddress: string
): Promise<{ deviceId: string; expiresAt: Date }> {
  const deviceHash = generateDeviceFingerprint(userAgent, ipAddress, operatorId)
  const deviceName = deriveDeviceName(userAgent)
  const expiresAt = new Date(Date.now() + TRUST_DURATION_DAYS * 24 * 60 * 60 * 1000)

  // Upsert: if device already trusted, refresh expiry
  const result = await pool.query(
    `INSERT INTO trusted_devices (operator_id, device_hash, device_name, ip_address, expires_at)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT ON CONSTRAINT trusted_devices_pkey DO NOTHING
     RETURNING id`,
    [operatorId, deviceHash, deviceName, ipAddress, expiresAt]
  )

  // If insert failed due to no unique constraint on (operator_id, device_hash),
  // try update existing
  if (result.rows.length === 0) {
    const updateResult = await pool.query(
      `UPDATE trusted_devices
       SET expires_at = $1, last_used_at = NOW(), revoked = false, revoked_at = NULL, device_name = $2
       WHERE operator_id = $3 AND device_hash = $4
       RETURNING id`,
      [expiresAt, deviceName, operatorId, deviceHash]
    )

    if (updateResult.rows.length > 0) {
      return { deviceId: updateResult.rows[0].id, expiresAt }
    }

    // Fresh insert (no existing record)
    const insertResult = await pool.query(
      `INSERT INTO trusted_devices (operator_id, device_hash, device_name, ip_address, expires_at)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [operatorId, deviceHash, deviceName, ipAddress, expiresAt]
    )

    // Enforce max devices limit - remove oldest
    await enforceDeviceLimit(operatorId)

    return { deviceId: insertResult.rows[0].id, expiresAt }
  }

  await enforceDeviceLimit(operatorId)

  await logSecurityEvent({
    userId: operatorId, userType: 'operator',
    eventType: 'device_trusted' as any,
    ipAddress, userAgent,
    metadata: { device_name: deviceName },
  })

  return { deviceId: result.rows[0].id, expiresAt }
}

/**
 * Enforce the maximum number of trusted devices per operator.
 * Removes the oldest (by last_used_at) devices beyond the limit.
 */
async function enforceDeviceLimit(operatorId: string): Promise<void> {
  await pool.query(
    `DELETE FROM trusted_devices
     WHERE id IN (
       SELECT id FROM trusted_devices
       WHERE operator_id = $1 AND revoked = false
       ORDER BY last_used_at DESC
       OFFSET $2
     )`,
    [operatorId, MAX_TRUSTED_DEVICES]
  )
}

/**
 * Revoke a specific trusted device.
 */
export async function revokeDevice(
  operatorId: string,
  deviceId: string,
  ipAddress?: string,
  userAgent?: string
): Promise<boolean> {
  const result = await pool.query(
    `UPDATE trusted_devices
     SET revoked = true, revoked_at = NOW()
     WHERE id = $1 AND operator_id = $2 AND revoked = false
     RETURNING id`,
    [deviceId, operatorId]
  )

  if (result.rows.length > 0) {
    await logSecurityEvent({
      userId: operatorId, userType: 'operator',
      eventType: 'device_revoked' as any,
      ipAddress, userAgent,
      metadata: { device_id: deviceId },
    })
    return true
  }
  return false
}

/**
 * Revoke ALL trusted devices for an operator (e.g., on password change or 2FA disable).
 */
export async function revokeAllDevices(
  operatorId: string,
  ipAddress?: string,
  userAgent?: string
): Promise<number> {
  const result = await pool.query(
    `UPDATE trusted_devices
     SET revoked = true, revoked_at = NOW()
     WHERE operator_id = $1 AND revoked = false
     RETURNING id`,
    [operatorId]
  )

  if (result.rowCount && result.rowCount > 0) {
    await logSecurityEvent({
      userId: operatorId, userType: 'operator',
      eventType: 'all_devices_revoked' as any,
      ipAddress, userAgent,
      metadata: { devices_revoked: result.rowCount },
    })
  }

  return result.rowCount || 0
}

/**
 * List all trusted devices for an operator (for the settings UI).
 */
export async function listTrustedDevices(operatorId: string): Promise<Array<{
  id: string
  deviceName: string
  ipAddress: string | null
  trustedAt: string
  expiresAt: string
  lastUsedAt: string
  isExpired: boolean
}>> {
  const result = await pool.query(
    `SELECT id, device_name, ip_address, trusted_at, expires_at, last_used_at
     FROM trusted_devices
     WHERE operator_id = $1 AND revoked = false
     ORDER BY last_used_at DESC`,
    [operatorId]
  )

  return result.rows.map(r => ({
    id: r.id,
    deviceName: r.device_name,
    ipAddress: r.ip_address,
    trustedAt: r.trusted_at,
    expiresAt: r.expires_at,
    lastUsedAt: r.last_used_at,
    isExpired: new Date(r.expires_at) < new Date(),
  }))
}

/**
 * Cleanup expired and revoked devices older than 90 days.
 * Call from a cron job.
 */
export async function cleanupExpiredDevices(): Promise<number> {
  const result = await pool.query(
    `DELETE FROM trusted_devices
     WHERE (revoked = true AND revoked_at < NOW() - INTERVAL '90 days')
        OR (expires_at < NOW() - INTERVAL '90 days')
     RETURNING id`
  )
  return result.rowCount || 0
}
