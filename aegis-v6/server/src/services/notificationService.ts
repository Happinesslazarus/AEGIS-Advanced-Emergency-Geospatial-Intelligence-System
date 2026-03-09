/**
 * notificationService.ts - Alert Delivery Service
 * 
 * Handles multi-channel alert delivery via:
 * - Email (SMTP via nodemailer)
 * - SMS (Twilio)
 * - WhatsApp (Twilio)
 * - Telegram (Bot API)
 * - Web Push (VAPID)
 */

import nodemailer from 'nodemailer'
import twilio from 'twilio'
import webPush from 'web-push'

// ═══════════════════════════════════════════════════════════
// Configuration
// ═══════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════
// Clients
// ═══════════════════════════════════════════════════════════

let emailTransporter: nodemailer.Transporter | null = null
let twilioClient: twilio.Twilio | null = null

// Initialize email transporter
if (SMTP_CONFIG.auth.user && SMTP_CONFIG.auth.pass) {
  emailTransporter = nodemailer.createTransport(SMTP_CONFIG)
  console.log('✅ Email transporter initialized')
} else {
  console.warn('⚠️  SMTP credentials not configured - email alerts disabled')
}

// Initialize Twilio client
if (TWILIO_CONFIG.accountSid && TWILIO_CONFIG.authToken) {
  twilioClient = twilio(TWILIO_CONFIG.accountSid, TWILIO_CONFIG.authToken)
  console.log('✅ Twilio client initialized')
} else {
  console.warn('⚠️  Twilio credentials not configured - SMS/WhatsApp alerts disabled')
}

// Telegram Bot API base URL
const TELEGRAM_API_BASE = `https://api.telegram.org/bot${TELEGRAM_CONFIG.botToken}`

if (TELEGRAM_CONFIG.botToken) {
  console.log('✅ Telegram bot token configured')
} else {
  console.warn('⚠️  Telegram bot token not configured - Telegram alerts disabled')
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
    console.warn('⚠️  VAPID keys not found in env. Generated ephemeral keys for development runtime.')
  }
}

if (VAPID_CONFIG.publicKey && VAPID_CONFIG.privateKey) {
  webPush.setVapidDetails(
    VAPID_CONFIG.subject,
    VAPID_CONFIG.publicKey,
    VAPID_CONFIG.privateKey
  )
  console.log('✅ Web Push (VAPID) configured')
} else {
  console.warn('⚠️  VAPID keys not configured - Web Push alerts disabled')
}

// ═══════════════════════════════════════════════════════════
// Alert Types & Interfaces
// ═══════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════
// Email Delivery
// ═══════════════════════════════════════════════════════════

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

    console.log(`✅ Email sent to ${recipient} in ${Date.now() - startTime}ms (${info.messageId})`)

    return {
      channel: 'email',
      success: true,
      messageId: info.messageId,
      timestamp: new Date(),
    }
  } catch (error: any) {
    console.error(`❌ Email delivery failed to ${recipient}:`, error.message)
    return {
      channel: 'email',
      success: false,
      error: error.message,
      timestamp: new Date(),
    }
  }
}

function generateEmailHTML(alert: Alert): string {
  const severityColors = {
    critical: '#dc2626',
    warning: '#f59e0b',
    info: '#3b82f6',
  }

  const severityBg = {
    critical: '#fee2e2',
    warning: '#fef3c7',
    info: '#dbeafe',
  }

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #1f2937; margin: 0; padding: 0; background-color: #f3f4f6;">
  <div style="max-width: 600px; margin: 20px auto; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);">
    
    <!-- Header -->
    <div style="background-color: ${severityColors[alert.severity]}; color: #ffffff; padding: 24px; text-align: center;">
      <h1 style="margin: 0; font-size: 24px; font-weight: 600;">⚠️ ${alert.severity.toUpperCase()} ALERT</h1>
      <p style="margin: 8px 0 0 0; font-size: 14px; opacity: 0.9;">AEGIS Emergency Management System</p>
    </div>

    <!-- Alert Badge -->
    <div style="background-color: ${severityBg[alert.severity]}; border-left: 4px solid ${severityColors[alert.severity]}; padding: 16px; margin: 24px;">
      <h2 style="margin: 0 0 8px 0; font-size: 20px; color: ${severityColors[alert.severity]};">${alert.title}</h2>
      <p style="margin: 0; font-size: 14px; color: #6b7280;">📍 ${alert.area}</p>
    </div>

    <!-- Message Body -->
    <div style="padding: 0 24px 24px 24px;">
      <p style="font-size: 16px; color: #374151; margin: 0 0 16px 0;">${alert.message}</p>
      
      ${alert.actionRequired ? `
      <div style="background-color: #fef3c7; border-left: 4px solid #f59e0b; padding: 16px; margin: 16px 0;">
        <p style="margin: 0; font-weight: 600; color: #92400e;">⚡ Action Required:</p>
        <p style="margin: 8px 0 0 0; color: #78350f;">${alert.actionRequired}</p>
      </div>
      ` : ''}

      ${alert.expiresAt ? `
      <p style="font-size: 13px; color: #6b7280; margin: 16px 0 0 0;">
        ⏰ This alert expires: <strong>${new Date(alert.expiresAt).toLocaleString('en-GB')}</strong>
      </p>
      ` : ''}
    </div>

    <!-- Footer -->
    <div style="background-color: #f9fafb; padding: 16px 24px; border-top: 1px solid #e5e7eb;">
      <p style="margin: 0; font-size: 12px; color: #6b7280; text-align: center;">
        This is an automated alert from the AEGIS Emergency Management System.<br>
        For assistance, contact <strong>${SUPPORT_EMAIL}</strong> or your local emergency services.
      </p>
    </div>

  </div>
</body>
</html>
  `.trim()
}

function generateEmailText(alert: Alert): string {
  return `
═══════════════════════════════════════════════════════════
${alert.severity.toUpperCase()} ALERT from AEGIS
═══════════════════════════════════════════════════════════

${alert.title}

Location: ${alert.area}

${alert.message}

${alert.actionRequired ? `\n⚡ ACTION REQUIRED:\n${alert.actionRequired}\n` : ''}

${alert.expiresAt ? `⏰ Alert expires: ${new Date(alert.expiresAt).toLocaleString('en-GB')}\n` : ''}

───────────────────────────────────────────────────────────
This is an automated alert from the AEGIS Emergency Management System.
For assistance, contact ${SUPPORT_EMAIL} or your local emergency services.
  `.trim()
}

// ═══════════════════════════════════════════════════════════
// SMS Delivery (Twilio)
// ═══════════════════════════════════════════════════════════

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
    const smsBody = generateSMSText(alert)

    const message = await twilioClient.messages.create({
      body: smsBody,
      from: TWILIO_CONFIG.phoneNumber,
      to: recipient,
    })

    console.log(`✅ SMS sent to ${recipient} in ${Date.now() - startTime}ms (${message.sid})`)

    return {
      channel: 'sms',
      success: true,
      messageId: message.sid,
      timestamp: new Date(),
    }
  } catch (error: any) {
    console.error(`❌ SMS delivery failed to ${recipient}:`, error.message)
    return {
      channel: 'sms',
      success: false,
      error: error.message,
      timestamp: new Date(),
    }
  }
}

function generateSMSText(alert: Alert): string {
  const emoji = alert.severity === 'critical' ? '🚨' : alert.severity === 'warning' ? '⚠️' : 'ℹ️'
  return `${emoji} AEGIS ALERT [${alert.severity.toUpperCase()}]\n\n${alert.title}\n📍 ${alert.area}\n\n${alert.message}${alert.actionRequired ? `\n\n⚡ ACTION: ${alert.actionRequired}` : ''}`
}

// ═══════════════════════════════════════════════════════════
// WhatsApp Delivery (Twilio)
// ═══════════════════════════════════════════════════════════

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
    const whatsappRecipient = recipient.startsWith('whatsapp:') ? recipient : `whatsapp:${recipient}`
    const whatsappBody = generateWhatsAppText(alert)

    const message = await twilioClient.messages.create({
      body: whatsappBody,
      from: TWILIO_CONFIG.whatsappNumber,
      to: whatsappRecipient,
    })

    console.log(`✅ WhatsApp sent to ${recipient} in ${Date.now() - startTime}ms (${message.sid})`)

    return {
      channel: 'whatsapp',
      success: true,
      messageId: message.sid,
      timestamp: new Date(),
    }
  } catch (error: any) {
    console.error(`❌ WhatsApp delivery failed to ${recipient}:`, error.message)
    return {
      channel: 'whatsapp',
      success: false,
      error: error.message,
      timestamp: new Date(),
    }
  }
}

function generateWhatsAppText(alert: Alert): string {
  const emoji = alert.severity === 'critical' ? '🚨' : alert.severity === 'warning' ? '⚠️' : 'ℹ️'
  return `${emoji} *AEGIS ALERT* [${alert.severity.toUpperCase()}]

*${alert.title}*
📍 ${alert.area}

${alert.message}

${alert.actionRequired ? `⚡ *ACTION REQUIRED:*\n${alert.actionRequired}\n\n` : ''}${alert.expiresAt ? `⏰ Expires: ${new Date(alert.expiresAt).toLocaleString('en-GB')}\n\n` : ''}───────────────────────────
_This is an automated alert from the AEGIS Emergency Management System._`
}

// ═══════════════════════════════════════════════════════════
// Telegram Delivery (Bot API)
// ═══════════════════════════════════════════════════════════

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

    const response = await fetch(`${TELEGRAM_API_BASE}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: telegramText,
        parse_mode: 'Markdown',
      }),
    })

    const data = await response.json()

    if (!data.ok) {
      throw new Error(data.description || 'Telegram API error')
    }

    console.log(`✅ Telegram sent to ${chatId} in ${Date.now() - startTime}ms (${data.result.message_id})`)

    return {
      channel: 'telegram',
      success: true,
      messageId: data.result.message_id.toString(),
      timestamp: new Date(),
    }
  } catch (error: any) {
    console.error(`❌ Telegram delivery failed to ${chatId}:`, error.message)
    return {
      channel: 'telegram',
      success: false,
      error: error.message,
      timestamp: new Date(),
    }
  }
}

function generateTelegramText(alert: Alert): string {
  const emoji = alert.severity === 'critical' ? '🚨' : alert.severity === 'warning' ? '⚠️' : 'ℹ️'
  return `${emoji} *AEGIS ALERT* \\[${alert.severity.toUpperCase()}\\]

*${alert.title}*
📍 ${alert.area}

${alert.message}

${alert.actionRequired ? `⚡ *ACTION REQUIRED:*\n${alert.actionRequired}\n\n` : ''}${alert.expiresAt ? `⏰ Expires: ${new Date(alert.expiresAt).toLocaleString('en-GB')}\n\n` : ''}───────────────────────────
_This is an automated alert from the AEGIS Emergency Management System\\._`
}

// ═══════════════════════════════════════════════════════════
// Web Push Delivery (VAPID)
// ═══════════════════════════════════════════════════════════

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
      body: `Area: ${alert.area}\n${alert.message}${alert.actionRequired ? '\n\nAction: ' + alert.actionRequired : ''}`,
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

    console.log(`✅ Web Push sent in ${Date.now() - startTime}ms (status ${result.statusCode})`)

    return {
      channel: 'web',
      success: true,
      messageId: `push-${Date.now()}`,
      timestamp: new Date(),
    }
  } catch (error: any) {
    console.error(`❌ Web Push delivery failed:`, error.message)
    return {
      channel: 'web',
      success: false,
      error: error.message,
      timestamp: new Date(),
    }
  }
}

// ═══════════════════════════════════════════════════════════
// Multi-Channel Delivery
// ═══════════════════════════════════════════════════════════

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
  console.log(`📊 Alert ${alert.id} delivery: ${successful} successful, ${failed} failed`)

  return results
}

// ═══════════════════════════════════════════════════════════
// Subscription Matching & Batch Delivery
// ═══════════════════════════════════════════════════════════

export async function sendAlertToSubscribers(
  alert: Alert,
  subscriptions: any[]
): Promise<{ total: number; successful: number; failed: number; results: DeliveryResult[] }> {
  console.log(`📢 Broadcasting alert ${alert.id} to ${subscriptions.length} subscribers...`)

  const allResults: DeliveryResult[] = []

  // Send to each subscriber
  for (const sub of subscriptions) {
    const recipient: AlertRecipient = {
      email: sub.email,
      phone: sub.phone,
      telegram_id: sub.telegram_id,
      whatsapp: sub.whatsapp,
    }

    const results = await sendMultiChannelAlert(recipient, alert, sub.channels || ['email'])
    allResults.push(...results)
  }

  const successful = allResults.filter(r => r.success).length
  const failed = allResults.length - successful

  console.log(`✅ Broadcast complete: ${successful}/${allResults.length} deliveries successful`)

  return {
    total: allResults.length,
    successful,
    failed,
    results: allResults,
  }
}

// ═══════════════════════════════════════════════════════════
// Health Check
// ═══════════════════════════════════════════════════════════

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
