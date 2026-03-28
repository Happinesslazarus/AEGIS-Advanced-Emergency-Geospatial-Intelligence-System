 /*
 * notificationService.ts - Alert Delivery Service
 * Handles multi-channel alert delivery via:
 * Email (SMTP via nodemailer)
 * SMS (Twilio)
 * WhatsApp (Twilio)
 * Telegram (Bot API)
 * Web Push (VAPID)
  */

import nodemailer from 'nodemailer'
import twilio from 'twilio'
import webPush from 'web-push'
import { logger } from './logger.js'

// Configuration

const SMTP_CONFIG = {
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
  },
}

const TWILIO_CONFIG = {
  accountSid: process.env.TWILIO_ACCOUNT_SID || '',
  authToken: process.env.TWILIO_AUTH_TOKEN || '',
  phoneNumber: process.env.TWILIO_PHONE_NUMBER || '',
  whatsappNumber: process.env.TWILIO_WHATSAPP_NUMBER || 'whatsapp:+14155238886',
}

const TELEGRAM_CONFIG = {
  botToken: process.env.TELEGRAM_BOT_TOKEN || '',
}

let VAPID_CONFIG = {
  publicKey: process.env.VAPID_PUBLIC_KEY || '',
  privateKey: process.env.VAPID_PRIVATE_KEY || '',
  subject: process.env.VAPID_SUBJECT || 'mailto:admin@aegis.gov.uk',
}

const EMAIL_FROM = process.env.SMTP_FROM || 'alerts@aegis.gov.uk'
const EMAIL_FROM_NAME = process.env.SMTP_FROM_NAME || 'AEGIS Alert System'
const EMAIL_REPLY_TO = process.env.SMTP_REPLY_TO || process.env.SUPPORT_EMAIL || EMAIL_FROM
const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL || EMAIL_REPLY_TO

// Clients

let emailTransporter: nodemailer.Transporter | null = null
let twilioClient: twilio.Twilio | null = null

// Initialize email transporter
if (SMTP_CONFIG.auth.user && SMTP_CONFIG.auth.pass) {
  emailTransporter = nodemailer.createTransport(SMTP_CONFIG)
  logger.info('Email transporter initialized')
} else {
  logger.warn('SMTP credentials not configured - email alerts disabled')
}

// Initialize Twilio client
if (TWILIO_CONFIG.accountSid && TWILIO_CONFIG.authToken) {
  twilioClient = twilio(TWILIO_CONFIG.accountSid, TWILIO_CONFIG.authToken)
  logger.info('Twilio client initialized')
} else {
  logger.warn('Twilio credentials not configured - SMS/WhatsApp alerts disabled')
}

// Telegram Bot API base URL
const TELEGRAM_API_BASE = `https://api.telegram.org/bot${TELEGRAM_CONFIG.botToken}`

if (TELEGRAM_CONFIG.botToken) {
  logger.info('Telegram bot token configured')
} else {
  logger.warn('Telegram bot token not configured - Telegram alerts disabled')
}

// Initialize Web Push (VAPID)
if (!VAPID_CONFIG.publicKey || !VAPID_CONFIG.privateKey) {
  if (process.env.NODE_ENV !== 'production') {
    const generated = webPush.generateVAPIDKeys()
    VAPID_CONFIG = {
      ...VAPID_CONFIG,
      publicKey: generated.publicKey,
      privateKey: generated.privateKey,
    }
    logger.warn('VAPID keys not found in env. Generated ephemeral keys for development runtime.')
  }
}

if (VAPID_CONFIG.publicKey && VAPID_CONFIG.privateKey) {
  webPush.setVapidDetails(
    VAPID_CONFIG.subject,
    VAPID_CONFIG.publicKey,
    VAPID_CONFIG.privateKey
  )
  logger.info('Web Push (VAPID) configured')
} else {
  logger.warn('VAPID keys not configured - Web Push alerts disabled')
}

// Alert Types & Interfaces

export interface Alert {
  id: string
  type: 'flood' | 'drought' | 'heatwave' | 'storm' | 'general'
  severity: 'critical' | 'warning' | 'info'
  title: string
  message: string
  area: string
  actionRequired?: string
  expiresAt?: Date
  metadata?: Record<string, any>
}

export interface AlertRecipient {
  email?: string
  phone?: string
  telegram_id?: string
  whatsapp?: string
  web_push_subscription?: webPush.PushSubscription
}

export interface DeliveryResult {
  channel: 'email' | 'sms' | 'whatsapp' | 'telegram' | 'web'
  success: boolean
  messageId?: string
  error?: string
  timestamp: Date
}

// Simple E.164 validator
function isValidE164Number(v: string | undefined) {
  if (!v) return false
  return /^\+[1-9]\d{1,14}$/.test(v)
}

// Simple retry helper for transient failures
async function retry<T>(fn: () => Promise<T>, attempts?: number, baseDelayMs?: number): Promise<T> {
  const maxAttempts = attempts ?? parseInt(process.env.NOTIFICATION_RETRY_ATTEMPTS || '3')
  const baseDelay = baseDelayMs ?? parseInt(process.env.NOTIFICATION_RETRY_BASE_MS || '500')
  let lastErr: any
  for (let i = 0; i < maxAttempts; i++) {
    try {
      return await fn()
    } catch (err: any) {
      lastErr = err
      if (i < maxAttempts - 1) {
        const delay = Math.round(baseDelay * Math.pow(2, i))
        await new Promise(r => setTimeout(r, delay))
      }
    }
  }
  throw lastErr
}

// Email Delivery

export async function sendEmailAlert(
  recipient: string,
  alert: Alert
): Promise<DeliveryResult> {
  const startTime = Date.now()

  if (!emailTransporter) {
    return {
      channel: 'email',
      success: false,
      error: 'Email service not configured',
      timestamp: new Date(),
    }
  }

  try {
    const htmlContent = generateEmailHTML(alert)
    const textContent = generateEmailText(alert)

    const info = await emailTransporter.sendMail({
      from: `"${EMAIL_FROM_NAME}" <${EMAIL_FROM}>`,
      replyTo: EMAIL_REPLY_TO,
      to: recipient,
      subject: `[${alert.severity.toUpperCase()}] ${alert.title}`,
      text: textContent,
      html: htmlContent,
      priority: alert.severity === 'critical' ? 'high' : 'normal',
    })

    logger.info({ recipient, messageId: info.messageId, durationMs: Date.now() - startTime }, 'Email sent')

    return {
      channel: 'email',
      success: true,
      messageId: info.messageId,
      timestamp: new Date(),
    }
  } catch (error: any) {
    logger.error({ recipient, err: error }, 'Email delivery failed')
    return {
      channel: 'email',
      success: false,
      error: error.message,
      timestamp: new Date(),
    }
  }
}

function generateEmailHTML(alert: Alert): string {
  const severityColors: Record<string, string> = {
    critical: '#dc2626',
    high: '#ea580c',
    warning: '#d97706',
    info: '#2563eb',
  }

  const severityBg: Record<string, string> = {
    critical: '#fef2f2',
    high: '#fff7ed',
    warning: '#fffbeb',
    info: '#eff6ff',
  }

  const color = severityColors[alert.severity] || '#2563eb'
  const bg = severityBg[alert.severity] || '#eff6ff'
  const timestamp = new Date().toLocaleString('en-GB', { dateStyle: 'full', timeStyle: 'short' })

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #1f2937; margin: 0; padding: 0; background-color: #f3f4f6;">
  <div style="max-width: 600px; margin: 20px auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);">

    <!-- Header -->
    <div style="background-color: ${color}; color: #ffffff; padding: 28px 24px;">
      <table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
        <td><h1 style="margin: 0; font-size: 20px; font-weight: 700; letter-spacing: -0.3px;">${alert.severity.toUpperCase()} ALERT</h1></td>
        <td style="text-align: right;"><span style="font-size: 12px; opacity: 0.85;">AEGIS Emergency Management</span></td>
      </tr></table>
      <p style="margin: 8px 0 0 0; font-size: 12px; opacity: 0.8;">Issued: ${timestamp}</p>
    </div>

    <!-- Alert Title & Location -->
    <div style="background-color: ${bg}; border-left: 4px solid ${color}; padding: 18px 20px; margin: 20px 24px;">
      <h2 style="margin: 0 0 10px 0; font-size: 18px; font-weight: 700; color: ${color};">${alert.title}</h2>
      <table cellpadding="0" cellspacing="0" border="0" style="font-size: 13px; color: #4b5563;">
        <tr><td style="padding: 2px 12px 2px 0; font-weight: 600; color: #374151;">Location:</td><td>${alert.area}</td></tr>
        <tr><td style="padding: 2px 12px 2px 0; font-weight: 600; color: #374151;">Type:</td><td style="text-transform: capitalize;">${alert.type}</td></tr>
        <tr><td style="padding: 2px 12px 2px 0; font-weight: 600; color: #374151;">Severity:</td><td style="text-transform: uppercase; font-weight: 600; color: ${color};">${alert.severity}</td></tr>
      </table>
    </div>

    <!-- Message Body -->
    <div style="padding: 0 24px 20px 24px;">
      <p style="font-size: 14px; color: #374151; margin: 0 0 16px 0; line-height: 1.7;">${alert.message}</p>

      ${alert.actionRequired ? `
      <div style="background-color: #fef3c7; border-left: 4px solid #d97706; padding: 14px 16px; margin: 16px 0; border-radius: 6px;">
        <p style="margin: 0; font-weight: 700; color: #92400e; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px;">Action Required</p>
        <p style="margin: 6px 0 0 0; color: #78350f; font-size: 13px; line-height: 1.6;">${alert.actionRequired}</p>
      </div>
      ` : ''}

      ${alert.expiresAt ? `
      <p style="font-size: 12px; color: #6b7280; margin: 16px 0 0 0; padding: 8px 12px; background: #f9fafb; border-radius: 6px;">
        This alert expires: <strong>${new Date(alert.expiresAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}</strong>
      </p>
      ` : ''}
    </div>

    <!-- Footer -->
    <div style="background-color: #f9fafb; padding: 18px 24px; border-top: 1px solid #e5e7eb;">
      <p style="margin: 0; font-size: 11px; color: #9ca3af; text-align: center; line-height: 1.6;">
        AEGIS Emergency Management System<br>
        For assistance, contact <strong>${SUPPORT_EMAIL}</strong> or call your local emergency services.
      </p>
    </div>

  </div>
</body>
</html>
  `.trim()
}

function generateEmailText(alert: Alert): string {
  const timestamp = new Date().toLocaleString('en-GB', { dateStyle: 'full', timeStyle: 'short' })
  return `
AEGIS EMERGENCY MANAGEMENT
${alert.severity.toUpperCase()} ALERT
Issued: ${timestamp}

${alert.title}

Location: ${alert.area}
Type: ${alert.type}
Severity: ${alert.severity.toUpperCase()}

${alert.message}
${alert.actionRequired ? `\nACTION REQUIRED\n${alert.actionRequired}\n` : ''}${alert.expiresAt ? `\nThis alert expires: ${new Date(alert.expiresAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}\n` : ''}
AEGIS Emergency Management System
For assistance, contact ${SUPPORT_EMAIL} or call your local emergency services.
  `.trim()
}

// SMS Delivery (Twilio)

export async function sendSMSAlert(
  recipient: string,
  alert: Alert
): Promise<DeliveryResult> {
  const startTime = Date.now()

  if (!twilioClient || !TWILIO_CONFIG.phoneNumber) {
    return {
      channel: 'sms',
      success: false,
      error: 'SMS service not configured',
      timestamp: new Date(),
    }
  }

  try {
    if (!isValidE164Number(recipient)) {
      return {
        channel: 'sms',
        success: false,
        error: 'Invalid phone number format (expected E.164)',
        timestamp: new Date(),
      }
    }

    const smsBody = generateSMSText(alert)

    const message = await retry(async () => {
      return await twilioClient!.messages.create({
        body: smsBody,
        from: TWILIO_CONFIG.phoneNumber,
        to: recipient,
      })
    }, 2, 300)

    logger.info({ recipient, sid: message.sid, durationMs: Date.now() - startTime }, 'SMS sent')

    return {
      channel: 'sms',
      success: true,
      messageId: message.sid,
      timestamp: new Date(),
    }
  } catch (error: any) {
    logger.error({ recipient, err: error }, 'SMS delivery failed')
    // Helpful hint for Twilio trial accounts
    const hint = (error?.message || '').includes('Invalid') ? ' (check E.164 format or Twilio trial restrictions)' : ''
    return {
      channel: 'sms',
      success: false,
      error: `${error?.message || 'sms_delivery_failed'}${hint}`,
      timestamp: new Date(),
    }
  }
}

function generateSMSText(alert: Alert): string {
  return `AEGIS ${alert.severity.toUpperCase()} ALERT\n${alert.title}\nLocation: ${alert.area}\nType: ${alert.type}\n\n${alert.message}${alert.actionRequired ? `\n\nACTION REQUIRED: ${alert.actionRequired}` : ''}${alert.expiresAt ? `\nExpires: ${new Date(alert.expiresAt).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })}` : ''}`
}

// WhatsApp Delivery (Twilio)

export async function sendWhatsAppAlert(
  recipient: string,
  alert: Alert
): Promise<DeliveryResult> {
  const startTime = Date.now()

  if (!twilioClient || !TWILIO_CONFIG.whatsappNumber) {
    return {
      channel: 'whatsapp',
      success: false,
      error: 'WhatsApp service not configured',
      timestamp: new Date(),
    }
  }

  try {
    // WhatsApp requires recipient in whatsapp:+E164 format
    const rawRecipient = recipient.startsWith('whatsapp:') ? recipient.replace('whatsapp:', '') : recipient
    if (!isValidE164Number(rawRecipient)) {
      return {
        channel: 'whatsapp',
        success: false,
        error: 'Invalid WhatsApp/phone number format (expected E.164)',
        timestamp: new Date(),
      }
    }

    const whatsappRecipient = rawRecipient.startsWith('whatsapp:') ? rawRecipient : `whatsapp:${rawRecipient}`
    const whatsappBody = generateWhatsAppText(alert)

    const message = await retry(async () => {
      return await twilioClient!.messages.create({
        body: whatsappBody,
        from: TWILIO_CONFIG.whatsappNumber,
        to: whatsappRecipient,
      })
    }, 2, 300)

    logger.info({ recipient, sid: message.sid, durationMs: Date.now() - startTime }, 'WhatsApp sent')

    return {
      channel: 'whatsapp',
      success: true,
      messageId: message.sid,
      timestamp: new Date(),
    }
  } catch (error: any) {
    logger.error({ recipient, err: error }, 'WhatsApp delivery failed')
    return {
      channel: 'whatsapp',
      success: false,
      error: error?.message || 'whatsapp_delivery_failed',
      timestamp: new Date(),
    }
  }
}

function generateWhatsAppText(alert: Alert): string {
  const timestamp = new Date().toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })
  return `*AEGIS ${alert.severity.toUpperCase()} ALERT*
_Issued: ${timestamp}_

*${alert.title}*

Location: ${alert.area}
Type: ${alert.type}
Severity: ${alert.severity.toUpperCase()}

${alert.message}
${alert.actionRequired ? `\n*ACTION REQUIRED*\n${alert.actionRequired}\n` : ''}${alert.expiresAt ? `\n_Expires: ${new Date(alert.expiresAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}_\n` : ''}
_AEGIS Emergency Management System_`
}

// Telegram Delivery (Bot API)

export async function sendTelegramAlert(
  chatId: string,
  alert: Alert
): Promise<DeliveryResult> {
  const startTime = Date.now()

  if (!TELEGRAM_CONFIG.botToken) {
    return {
      channel: 'telegram',
      success: false,
      error: 'Telegram service not configured',
      timestamp: new Date(),
    }
  }

  try {
    const telegramText = generateTelegramText(alert)

    // If a username (@name) is provided, attempt to resolve it to a numeric id first
    let sendTo: string | number = chatId
    if (typeof chatId === 'string' && chatId.startsWith('@')) {
      const username = chatId.slice(1).toLowerCase()
      let resolved = false

      // Method 1: Try getChat (works for public channels/groups)
      try {
        const g = await fetch(`${TELEGRAM_API_BASE}/getChat?chat_id=${encodeURIComponent(chatId)}`)
        const gd = await g.json()
        if (gd?.ok && gd.result?.id) {
          sendTo = gd.result.id
          resolved = true
        }
      } catch { /* continue to fallback */ }

      // Method 2: Scan recent bot updates for a matching username (works for private chats)
      if (!resolved) {
        try {
          const u = await fetch(`${TELEGRAM_API_BASE}/getUpdates?limit=100`)
          const ud = await u.json()
          if (ud?.ok && Array.isArray(ud.result)) {
            for (const upd of ud.result) {
              const from = upd.message?.from
              if (from?.username?.toLowerCase() === username && from.id) {
                sendTo = from.id
                resolved = true
                logger.info({ username, resolvedId: from.id }, 'Resolved Telegram username via getUpdates')
                break
              }
            }
          }
        } catch { /* best effort */ }
      }

      if (!resolved) {
        // keep username; sendMessage will fail but error message will be clear
        sendTo = chatId
      }
    }

    const response = await fetch(`${TELEGRAM_API_BASE}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: sendTo,
        text: telegramText,
        parse_mode: 'MarkdownV2',
      }),
    })

    const data = await response.json()

    if (!data.ok) {
      throw new Error(data.description || 'Telegram API error')
    }

    logger.info({ chatId, messageId: data.result.message_id, durationMs: Date.now() - startTime }, 'Telegram sent')

    return {
      channel: 'telegram',
      success: true,
      messageId: data.result.message_id.toString(),
      timestamp: new Date(),
    }
  } catch (error: any) {
    logger.error({ chatId, err: error }, 'Telegram delivery failed')
    const desc = (error?.message || '').toString()
    let hint = ''
    if (desc.includes('bot is not a member')) {
      hint = ' (bot must be added to the channel/group or use a numeric chat_id for private chats)'
    } else if (desc.includes('chat not found') || desc.includes('Bad Request')) {
      hint = ' (user must /start the bot or use a valid chat_id)'
    }
    return {
      channel: 'telegram',
      success: false,
      error: `${desc}${hint}`,
      timestamp: new Date(),
    }
  }
}

function escapeMdV2(text: string): string {
  return text.replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, '\\$1')
}

function generateTelegramText(alert: Alert): string {
  const title = escapeMdV2(alert.title)
  const area = escapeMdV2(alert.area)
  const message = escapeMdV2(alert.message)
  const severity = escapeMdV2(alert.severity.toUpperCase())
  const type = escapeMdV2(alert.type)
  const timestamp = escapeMdV2(new Date().toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }))

  let text = `*AEGIS ${severity} ALERT*\n_Issued: ${timestamp}_\n\n*${title}*\n\nLocation: ${area}\nType: ${type}\nSeverity: ${severity}`

  text += `\n\n${message}`

  if (alert.actionRequired) {
    text += `\n\n*ACTION REQUIRED*\n${escapeMdV2(alert.actionRequired)}`
  }
  if (alert.expiresAt) {
    text += `\n\n_Expires: ${escapeMdV2(new Date(alert.expiresAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }))}_`
  }

  text += `\n\n_AEGIS Emergency Management System_`
  return text
}

// Web Push Delivery (VAPID)

export async function sendWebPushAlert(
  subscription: webPush.PushSubscription,
  alert: Alert
): Promise<DeliveryResult> {
  const startTime = Date.now()

  if (!VAPID_CONFIG.publicKey || !VAPID_CONFIG.privateKey) {
    return {
      channel: 'web',
      success: false,
      error: 'Web Push service not configured',
      timestamp: new Date(),
    }
  }

  try {
    const severityLabel = alert.severity === 'critical' ? 'CRITICAL'
      : alert.severity === 'warning' ? 'WARNING' : 'INFO'

    const payload = JSON.stringify({
      title: `AEGIS ${severityLabel}: ${alert.title}`,
      body: `Location: ${alert.area}\nType: ${alert.type}\n\n${alert.message}${alert.actionRequired ? '\n\nAction Required: ' + alert.actionRequired : ''}`,
      icon: '/icons/icon-192x192.png',
      badge: '/icons/icon-96x96.png',
      tag: alert.id,
      requireInteraction: alert.severity === 'critical',
      data: {
        alert_id: alert.id,
        severity: alert.severity,
        type: alert.type,
        url: `/citizen?tab=safety&alert=${alert.id}`,
      },
    })

    const result = await webPush.sendNotification(subscription, payload)

    logger.info({ statusCode: result.statusCode, durationMs: Date.now() - startTime }, 'Web Push sent')

    return {
      channel: 'web',
      success: true,
      messageId: `push-${Date.now()}`,
      timestamp: new Date(),
    }
  } catch (error: any) {
    logger.error({ err: error }, 'Web Push delivery failed')
    return {
      channel: 'web',
      success: false,
      error: error.message,
      timestamp: new Date(),
    }
  }
}

// Multi-Channel Delivery

export async function sendMultiChannelAlert(
  recipient: AlertRecipient,
  alert: Alert,
  channels: string[]
): Promise<DeliveryResult[]> {
  const results: DeliveryResult[] = []
  const promises: Promise<DeliveryResult>[] = []

  // Send to all requested channels in parallel
  if (channels.includes('email') && recipient.email) {
    promises.push(sendEmailAlert(recipient.email, alert))
  }

  if (channels.includes('sms') && recipient.phone) {
    promises.push(sendSMSAlert(recipient.phone, alert))
  }

  if (channels.includes('whatsapp') && recipient.whatsapp) {
    promises.push(sendWhatsAppAlert(recipient.whatsapp, alert))
  }

  if (channels.includes('telegram') && recipient.telegram_id) {
    promises.push(sendTelegramAlert(recipient.telegram_id, alert))
  }

  if (channels.includes('web') && recipient.web_push_subscription) {
    promises.push(sendWebPushAlert(recipient.web_push_subscription, alert))
  }

  // Wait for all deliveries
  const deliveryResults = await Promise.allSettled(promises)

  // Collect results
  for (const result of deliveryResults) {
    if (result.status === 'fulfilled') {
      results.push(result.value)
    } else {
      results.push({
        channel: 'email', // fallback
        success: false,
        error: result.reason?.message || 'Unknown error',
        timestamp: new Date(),
      })
    }
  }

  // Log summary
  const successful = results.filter(r => r.success).length
  const failed = results.length - successful
  logger.info({ alertId: alert.id, successful, failed }, 'Alert delivery summary')

  return results
}

// Subscription Matching & Batch Delivery

 /*
 * Broadcast an alert to all subscribers with concurrency-limited parallel delivery.
 * Uses a semaphore pattern (p-limit style via Promise pool) so we don't open
 * thousands of simultaneous connections during a major incident alert.
 * Default concurrency: 50 simultaneous deliveries (configurable via
 * NOTIFICATION_CONCURRENCY env var). With 50 concurrent and 5000 subscribers,
 * total delivery time ≈ (5000/50) × avg_latency_per_batch.
  */
export async function sendAlertToSubscribers(
  alert: Alert,
  subscriptions: any[]
): Promise<{ total: number; successful: number; failed: number; results: DeliveryResult[] }> {
  const concurrency = parseInt(process.env.NOTIFICATION_CONCURRENCY || '50', 10)
  logger.info({ alertId: alert.id, subscribers: subscriptions.length, concurrency }, 'Broadcasting alert to subscribers')

  const allResults: DeliveryResult[] = []

  // Process in batches of `concurrency` to avoid exhausting OS socket limits
  for (let i = 0; i < subscriptions.length; i += concurrency) {
    const batch = subscriptions.slice(i, i + concurrency)

    const batchPromises = batch.map((sub) => {
      const recipient: AlertRecipient = {
        email: sub.email,
        phone: sub.phone,
        telegram_id: sub.telegram_id,
        whatsapp: sub.whatsapp,
      }
      return sendMultiChannelAlert(recipient, alert, sub.channels || ['email'])
    })

    const batchSettled = await Promise.allSettled(batchPromises)
    for (const settled of batchSettled) {
      if (settled.status === 'fulfilled') {
        allResults.push(...settled.value)
      } else {
        logger.error({ err: settled.reason }, '[Notifications] Batch delivery error')
      }
    }
  }

  const successful = allResults.filter(r => r.success).length
  const failed = allResults.length - successful

  logger.info({ successful, total: allResults.length, failed }, 'Broadcast complete')

  return {
    total: allResults.length,
    successful,
    failed,
    results: allResults,
  }
}

// Health Check

export function getNotificationServiceStatus() {
  return {
    email: {
      enabled: !!emailTransporter,
      configured: !!(SMTP_CONFIG.auth.user && SMTP_CONFIG.auth.pass),
    },
    sms: {
      enabled: !!twilioClient,
      configured: !!(TWILIO_CONFIG.accountSid && TWILIO_CONFIG.authToken && TWILIO_CONFIG.phoneNumber),
    },
    whatsapp: {
      enabled: !!twilioClient,
      configured: !!(TWILIO_CONFIG.accountSid && TWILIO_CONFIG.authToken && TWILIO_CONFIG.whatsappNumber),
    },
    telegram: {
      enabled: !!TELEGRAM_CONFIG.botToken,
      configured: !!TELEGRAM_CONFIG.botToken,
    },
    web: {
      enabled: !!(VAPID_CONFIG.publicKey && VAPID_CONFIG.privateKey),
      configured: !!(VAPID_CONFIG.publicKey && VAPID_CONFIG.privateKey),
      publicKey: VAPID_CONFIG.publicKey, // Exposed for client subscription
    },
  }
}
