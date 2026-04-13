/**
 * File: deviceManagementService.ts
 *
 * Device registry manager — tracks trusted devices per user with fingerprints,
 * user agents, locations, and trust expiry. Sends security alert emails on
 * new-device or suspicious logins.
 *
 * How it connects:
 * - Uses emailService for first-login and suspicious-device notifications
 * - Uses securityLogger for audit trail of device events
 * - Reads/writes device records in the database
 *
 * Simple explanation:
 * Keeps a registry of trusted devices and alerts users when something looks off.
 */

import crypto from 'crypto'
import pool from '../models/db.js'
import { sendSecurityAlertEmail } from '../services/emailService.js'
import { logSecurityEvent } from '../services/securityLogger.js'

export interface DeviceInfo {
  fingerprint: string
  userAgent: string
  ipAddress: string
  location?: {
    country?: string
    city?: string
    latitude?: number
    longitude?: number
  }
  browser?: string
  os?: string
  deviceType?: 'desktop' | 'mobile' | 'tablet' | 'unknown'
}

export interface TrustedDevice {
  id: string
  userId: string
  fingerprint: string
  deviceName: string
  browser: string
  os: string
  ipAddress: string
  location?: string
  firstSeenAt: Date
  lastSeenAt: Date
  trusted: boolean
  trustExpiresAt: Date | null
}

export interface LoginEvent {
  userId: string
  device: DeviceInfo
  loginTime: Date
  success: boolean
  riskScore: number
  newDevice: boolean
  newLocation: boolean
  notificationSent: boolean
}

// Configuration
const config = {
  alwaysNotifyNewDevice: true,
  alwaysNotifySuspiciousLogin: true,
  trustDurationDays: 30,
  maxTrustedDevices: 10,
  notifyOnDifferentCountry: true,
  notifyOnHighRiskLogin: true,
  highRiskThreshold: 70,
}

/**
 * Initialize device management tables
 */
export async function initDeviceManagement(): Promise<void> {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS trusted_devices (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        fingerprint VARCHAR(64) NOT NULL,
        device_name VARCHAR(255) DEFAULT 'Unknown Device',
        browser VARCHAR(100),
        os VARCHAR(100),
        ip_address VARCHAR(45),
        location VARCHAR(255),
        first_seen_at TIMESTAMPTZ DEFAULT NOW(),
        last_seen_at TIMESTAMPTZ DEFAULT NOW(),
        trusted BOOLEAN DEFAULT false,
        trust_expires_at TIMESTAMPTZ,
        UNIQUE(user_id, fingerprint)
      );
      
      CREATE TABLE IF NOT EXISTS login_events (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        device_fingerprint VARCHAR(64),
        ip_address VARCHAR(45) NOT NULL,
        user_agent TEXT,
        location VARCHAR(255),
        country VARCHAR(100),
        login_time TIMESTAMPTZ DEFAULT NOW(),
        success BOOLEAN DEFAULT true,
        risk_score INTEGER DEFAULT 0,
        new_device BOOLEAN DEFAULT false,
        new_location BOOLEAN DEFAULT false,
        notification_sent BOOLEAN DEFAULT false,
        failure_reason VARCHAR(255)
      );
      
      CREATE INDEX IF NOT EXISTS idx_trusted_devices_user ON trusted_devices(user_id);
      CREATE INDEX IF NOT EXISTS idx_login_events_user ON login_events(user_id);
      CREATE INDEX IF NOT EXISTS idx_login_events_time ON login_events(login_time DESC);
    `)
    
    console.log('[DeviceManagement] Service initialized')
  } catch (error: any) {
    console.error('[DeviceManagement] Init failed:', error.message)
  }
}

/**
 * Generate device fingerprint from request info
 */
export function generateDeviceFingerprint(device: Partial<DeviceInfo>): string {
  const components = [
    device.userAgent || '',
    device.browser || '',
    device.os || '',
    device.deviceType || '',
  ].join('|')
  
  return crypto.createHash('sha256').update(components).digest('hex').substring(0, 32)
}

/**
 * Parse user agent to extract device info
 */
export function parseUserAgent(userAgent: string): Partial<DeviceInfo> {
  const info: Partial<DeviceInfo> = { userAgent }
  
  // Browser detection
  if (userAgent.includes('Firefox/')) {
    info.browser = 'Firefox'
  } else if (userAgent.includes('Edg/')) {
    info.browser = 'Edge'
  } else if (userAgent.includes('Chrome/')) {
    info.browser = 'Chrome'
  } else if (userAgent.includes('Safari/') && !userAgent.includes('Chrome')) {
    info.browser = 'Safari'
  } else {
    info.browser = 'Unknown'
  }
  
  // OS detection
  if (userAgent.includes('Windows')) {
    info.os = 'Windows'
  } else if (userAgent.includes('Mac OS')) {
    info.os = 'macOS'
  } else if (userAgent.includes('Linux')) {
    info.os = 'Linux'
  } else if (userAgent.includes('Android')) {
    info.os = 'Android'
  } else if (userAgent.includes('iOS') || userAgent.includes('iPhone') || userAgent.includes('iPad')) {
    info.os = 'iOS'
  } else {
    info.os = 'Unknown'
  }
  
  // Device type detection
  if (userAgent.includes('Mobile') || userAgent.includes('Android') && !userAgent.includes('Tablet')) {
    info.deviceType = 'mobile'
  } else if (userAgent.includes('Tablet') || userAgent.includes('iPad')) {
    info.deviceType = 'tablet'
  } else {
    info.deviceType = 'desktop'
  }
  
  return info
}

/**
 * Record login and check for notifications
 */
export async function recordLogin(
  userId: string,
  userEmail: string,
  device: DeviceInfo,
  options: {
    success?: boolean
    riskScore?: number
    failureReason?: string
  } = {}
): Promise<{
  isNewDevice: boolean
  isNewLocation: boolean
  notificationSent: boolean
  riskLevel: 'low' | 'medium' | 'high'
}> {
  const fingerprint = device.fingerprint || generateDeviceFingerprint(device)
  const success = options.success !== false
  const riskScore = options.riskScore || 0
  
  // Check if device is known
  const existingDevice = await pool.query(`
    SELECT * FROM trusted_devices
    WHERE user_id = $1 AND fingerprint = $2
  `, [userId, fingerprint])
  
  const isNewDevice = existingDevice.rows.length === 0
  
  // Check if location is new
  const locationResult = await pool.query(`
    SELECT DISTINCT country
    FROM login_events
    WHERE user_id = $1 AND success = true AND country IS NOT NULL
    LIMIT 10
  `, [userId])
  
  const knownCountries = locationResult.rows.map(r => r.country)
  const isNewLocation = device.location?.country 
    ? !knownCountries.includes(device.location.country)
    : false
  
  // Determine if notification needed
  let shouldNotify = false
  let notificationReason = ''
  
  if (isNewDevice && config.alwaysNotifyNewDevice) {
    shouldNotify = true
    notificationReason = 'new_device'
  }
  
  if (isNewLocation && config.notifyOnDifferentCountry) {
    shouldNotify = true
    notificationReason = notificationReason ? 'new_device_new_location' : 'new_location'
  }
  
  if (riskScore >= config.highRiskThreshold && config.notifyOnHighRiskLogin) {
    shouldNotify = true
    notificationReason = 'high_risk'
  }
  
  // Record login event
  await pool.query(`
    INSERT INTO login_events (
      user_id, device_fingerprint, ip_address, user_agent, location, country,
      success, risk_score, new_device, new_location, notification_sent, failure_reason
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
  `, [
    userId,
    fingerprint,
    device.ipAddress,
    device.userAgent,
    device.location?.city || null,
    device.location?.country || null,
    success,
    riskScore,
    isNewDevice,
    isNewLocation,
    shouldNotify,
    options.failureReason || null,
  ])
  
  // Update or create device record
  if (success) {
    if (isNewDevice) {
      await pool.query(`
        INSERT INTO trusted_devices (
          user_id, fingerprint, device_name, browser, os, ip_address, location
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      `, [
        userId,
        fingerprint,
        `${device.browser || 'Unknown'} on ${device.os || 'Unknown'}`,
        device.browser,
        device.os,
        device.ipAddress,
        device.location?.city ? `${device.location.city}, ${device.location.country}` : null,
      ])
    } else {
      await pool.query(`
        UPDATE trusted_devices
        SET last_seen_at = NOW(), ip_address = $1
        WHERE user_id = $2 AND fingerprint = $3
      `, [device.ipAddress, userId, fingerprint])
    }
  }
  
  // Send notification email
  if (shouldNotify && success && userEmail) {
    await sendLoginNotification(userEmail, {
      isNewDevice,
      isNewLocation,
      device,
      loginTime: new Date(),
      riskScore,
    })
    
    // Log security event
    logSecurityEvent({
      userId,
      userType: 'citizen',
      eventType: 'suspicious_activity',
      ipAddress: device.ipAddress,
      metadata: {
        reason: 'new_device_login',
        fingerprint,
        browser: device.browser,
        os: device.os,
        country: device.location?.country,
        notificationSent: true,
      },
    })
  }
  
  // Determine risk level
  let riskLevel: 'low' | 'medium' | 'high' = 'low'
  if (riskScore >= 70) riskLevel = 'high'
  else if (riskScore >= 40 || isNewDevice || isNewLocation) riskLevel = 'medium'
  
  return {
    isNewDevice,
    isNewLocation,
    notificationSent: shouldNotify,
    riskLevel,
  }
}

/**
 * Send login notification email
 */
async function sendLoginNotification(
  email: string,
  info: {
    isNewDevice: boolean
    isNewLocation: boolean
    device: DeviceInfo
    loginTime: Date
    riskScore: number
  }
): Promise<void> {
  try {
    const locationStr = info.device.location 
      ? `${info.device.location.city || 'Unknown'}, ${info.device.location.country || 'Unknown'}`
      : 'Unknown location'
    
    const title = info.isNewDevice
      ? 'New Device Login Detected'
      : 'Login from New Location'
    
    const deviceInfo = `${info.device.browser || 'Unknown browser'} on ${info.device.os || 'Unknown OS'}`
    
    const message = `
We detected a login to your AEGIS account:

When: ${info.loginTime.toLocaleString()}
Device: ${deviceInfo}
Location: ${locationStr}
IP Address: ${info.device.ipAddress}

${info.isNewDevice ? '⚠️ This is a new device\n' : ''}${info.isNewLocation ? '⚠️ This is a new location\n' : ''}
If this was you, no action is needed.

If you didn't authorize this login:
1. Change your password immediately
2. Review your recent account activity
3. Enable two-factor authentication if not already enabled
    `.trim()
    
    // Determine severity based on risk score
    const severity = info.riskScore >= 70 ? 'critical' : info.riskScore >= 40 ? 'warning' : 'info'
    
    await sendSecurityAlertEmail(email, title, message, severity)
    
    console.log(`[DeviceManagement] Sent login notification to ${email}`)
  } catch (error: any) {
    console.error('[DeviceManagement] Failed to send notification:', error.message)
  }
}

/**
 * Get user's trusted devices
 */
export async function getUserDevices(userId: string): Promise<TrustedDevice[]> {
  const result = await pool.query(`
    SELECT id, user_id, fingerprint, device_name, browser, os, ip_address,
           location, first_seen_at, last_seen_at, trusted, trust_expires_at
    FROM trusted_devices
    WHERE user_id = $1
    ORDER BY last_seen_at DESC
  `, [userId])
  
  return result.rows.map(row => ({
    id: row.id,
    userId: row.user_id,
    fingerprint: row.fingerprint,
    deviceName: row.device_name,
    browser: row.browser,
    os: row.os,
    ipAddress: row.ip_address,
    location: row.location,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    trusted: row.trusted,
    trustExpiresAt: row.trust_expires_at,
  }))
}

/**
 * Trust a device (skip MFA for trusted devices)
 */
export async function trustDevice(
  userId: string,
  deviceId: string,
  durationDays: number = config.trustDurationDays
): Promise<boolean> {
  const expiresAt = new Date()
  expiresAt.setDate(expiresAt.getDate() + durationDays)
  
  const result = await pool.query(`
    UPDATE trusted_devices
    SET trusted = true, trust_expires_at = $1
    WHERE id = $2 AND user_id = $3
    RETURNING id
  `, [expiresAt, deviceId, userId])
  
  return (result.rowCount ?? 0) > 0
}

/**
 * Remove trust from device
 */
export async function untrustDevice(userId: string, deviceId: string): Promise<boolean> {
  const result = await pool.query(`
    UPDATE trusted_devices
    SET trusted = false, trust_expires_at = NULL
    WHERE id = $1 AND user_id = $2
    RETURNING id
  `, [deviceId, userId])
  
  return (result.rowCount ?? 0) > 0
}

/**
 * Remove a device from user's devices
 */
export async function removeDevice(userId: string, deviceId: string): Promise<boolean> {
  const result = await pool.query(`
    DELETE FROM trusted_devices
    WHERE id = $1 AND user_id = $2
    RETURNING id
  `, [deviceId, userId])
  
  return (result.rowCount ?? 0) > 0
}

/**
 * Check if device is trusted
 */
export async function isDeviceTrusted(userId: string, fingerprint: string): Promise<boolean> {
  const result = await pool.query(`
    SELECT trusted, trust_expires_at
    FROM trusted_devices
    WHERE user_id = $1 AND fingerprint = $2
  `, [userId, fingerprint])
  
  if (result.rows.length === 0) return false
  
  const device = result.rows[0]
  
  if (!device.trusted) return false
  if (device.trust_expires_at && new Date(device.trust_expires_at) < new Date()) return false
  
  return true
}

/**
 * Get recent login history for user
 */
export async function getLoginHistory(
  userId: string,
  limit: number = 20
): Promise<LoginEvent[]> {
  const result = await pool.query(`
    SELECT user_id, device_fingerprint, ip_address, user_agent, location, country,
           login_time, success, risk_score, new_device, new_location, notification_sent
    FROM login_events
    WHERE user_id = $1
    ORDER BY login_time DESC
    LIMIT $2
  `, [userId, limit])
  
  return result.rows.map(row => ({
    userId: row.user_id,
    device: {
      fingerprint: row.device_fingerprint,
      userAgent: row.user_agent,
      ipAddress: row.ip_address,
      location: {
        city: row.location,
        country: row.country,
      },
    },
    loginTime: row.login_time,
    success: row.success,
    riskScore: row.risk_score,
    newDevice: row.new_device,
    newLocation: row.new_location,
    notificationSent: row.notification_sent,
  }))
}

/**
 * Rename a device
 */
export async function renameDevice(
  userId: string,
  deviceId: string,
  newName: string
): Promise<boolean> {
  const result = await pool.query(`
    UPDATE trusted_devices
    SET device_name = $1
    WHERE id = $2 AND user_id = $3
    RETURNING id
  `, [newName, deviceId, userId])
  
  return (result.rowCount ?? 0) > 0
}

/**
 * Get device management stats for admin
 */
export async function getDeviceStats(): Promise<{
  totalDevices: number
  trustedDevices: number
  logins24h: number
  newDeviceLogins24h: number
  failedLogins24h: number
}> {
  const result = await pool.query(`
    SELECT
      (SELECT COUNT(*)::int FROM trusted_devices) as total_devices,
      (SELECT COUNT(*)::int FROM trusted_devices WHERE trusted = true) as trusted_devices,
      (SELECT COUNT(*)::int FROM login_events WHERE login_time > NOW() - INTERVAL '24 hours' AND success = true) as logins_24h,
      (SELECT COUNT(*)::int FROM login_events WHERE login_time > NOW() - INTERVAL '24 hours' AND new_device = true) as new_device_logins_24h,
      (SELECT COUNT(*)::int FROM login_events WHERE login_time > NOW() - INTERVAL '24 hours' AND success = false) as failed_logins_24h
  `)
  
  return {
    totalDevices: result.rows[0]?.total_devices || 0,
    trustedDevices: result.rows[0]?.trusted_devices || 0,
    logins24h: result.rows[0]?.logins_24h || 0,
    newDeviceLogins24h: result.rows[0]?.new_device_logins_24h || 0,
    failedLogins24h: result.rows[0]?.failed_logins_24h || 0,
  }
}

export default {
  initDeviceManagement,
  generateDeviceFingerprint,
  parseUserAgent,
  recordLogin,
  getUserDevices,
  trustDevice,
  untrustDevice,
  removeDevice,
  isDeviceTrusted,
  getLoginHistory,
  renameDevice,
  getDeviceStats,
}
