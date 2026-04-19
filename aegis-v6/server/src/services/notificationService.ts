/**
 * Multi-channel notification dispatcher — initialises and manages SMTP email
 * (nodemailer), SMS/WhatsApp (Twilio), Telegram Bot API, and Web Push (VAPID)
 * with graceful degradation when credentials are not configured.
 *
 * - Called by alert, auth, and admin routes to send notifications
 * - Configures channels based on available environment variables
 * - Uses logger for delivery status and errors
 * */

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
if (TWILIO_CONFIG.accountSid && TWILIO_CONFIG.accountSid.startsWith('AC') && TWILIO_CONFIG.authToken) {
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
  type: string
  severity: 'critical' | 'warning' | 'info'
  title: string
  message: string
  area: string
  actionRequired?: string
  expiresAt?: Date
  metadata?: Record<string, any>
  subscriberName?: string
  subscriberAuthStatus?: string
  issuedAt?: Date
}

function resolveRecipientIdentity(alert: Alert): {
  name?: string
  authStatus: string
  line: string
  greetingEmail: string
  greetingChat: string
} {
  const name = alert.subscriberName?.trim() || undefined
  const authStatus = alert.subscriberAuthStatus || (name ? 'Signed in user' : 'Anonymous / not signed in')
  const line = name
    ? `Recipient: ${name} (${authStatus})`
    : `Recipient status: ${authStatus}`

  return {
    name,
    authStatus,
    line,
    greetingEmail: name ? `Dear ${name},` : 'Dear Subscriber,',
    greetingChat: name ? `Hi ${name},` : 'Hello,',
  }
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
  expired?: boolean  // true when push subscription is gone (410/404) - should be deactivated
  statusCode?: number
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
      subject: `AEGIS ${alert.severity.toUpperCase()} ALERT: ${alert.title}`,
      text: textContent,
      html: htmlContent,
      priority: alert.severity === 'critical' ? 'high' : 'normal',
      headers: {
        'X-Mailer': 'AEGIS Emergency Management System',
        'X-Priority': alert.severity === 'critical' ? '1' : '3',
        'Precedence': 'bulk',
        'List-Unsubscribe': `<mailto:${EMAIL_REPLY_TO}?subject=unsubscribe>`,
      },
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

/**
 * Converts the structured plain-text alert message into clean HTML.
 *
 * alert.message is a SINGLE LINE string (no real newlines) using these inline conventions:
 *   --- SECTION NAME ---   → appears as delimiter between sections
 *   1. text 2. text 3.     → numbered items separated only by spaces
 *   - text - text - text   → bullet items separated only by " - "
 *
 * The preamble before the first --- (duplicates info in the header table) is stripped.
 */
function formatAlertMessageHTML(message: string, accentColor: string): string {
  const sectionColors: Record<string, string> = {
    'SITUATION ASSESSMENT':    '#1e40af',
    'IMPACT ANALYSIS':         '#b45309',
    'PROTECTIVE ACTIONS':      '#dc2626',
    'EVACUATION GUIDANCE':     '#7c3aed',
    'HEALTH & SAFETY RISKS':   '#b45309',
    'HEALTH AND SAFETY RISKS': '#b45309',
    'RECOVERY TIMELINE':       '#065f46',
    'CONTEXT':                 '#4b5563',
  }

  // Strip everything before the first section marker — that preamble just
  // repeats location / severity / ref which are already in the header table.
  const firstMarker = message.indexOf('---')
  const body = firstMarker > 0 ? message.substring(firstMarker) : message

  // Split on --- SECTION NAME --- tokens (keep the markers via capture group)
  const parts = body.split(/(---[^-]+---)/g)
  const html: string[] = []

  for (const part of parts) {
    const trimmed = part.trim()
    if (!trimmed) continue

    // --- SECTION HEADING ---
    const sectionMatch = trimmed.match(/^---\s*(.+?)\s*---$/)
    if (sectionMatch) {
      const label = sectionMatch[1].trim()
      if (label.toUpperCase() === 'END OF ALERT') continue
      const sColor = Object.entries(sectionColors)
        .find(([k]) => label.toUpperCase().includes(k))?.[1] ?? accentColor
      html.push(
        `<div style="margin:18px 0 6px 0;padding-bottom:5px;border-bottom:2px solid ${sColor}30">` +
        `<span style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:1px;color:${sColor}">${escapeHtml(label)}</span>` +
        `</div>`
      )
      continue
    }

    // CONTENT BLOCK — the text between section markers.
    // It is a single line; parse in priority order: numbered list → bullet list → paragraph.
    html.push(renderInlineContent(trimmed))
  }

  return html.join('\n') ||
    `<p style="font-size:13px;color:#374151;line-height:1.7;margin:0 0 8px 0">${escapeHtml(message)}</p>`
}

/**
 * Renders a single content block as HTML, handling three inline formats:
 *
 * Numbered list  – "1. text 2. text 3. text"
 *   split on whitespace immediately before a lone digit+dot/paren+space
 *
 * Bullet list    – "- text - text - text"  (starts with "- ")
 *   split on " - " (space-hyphen-space)
 *
 * Paragraph      – everything else, rendered as a single <p>
 */
function renderInlineContent(text: string): string {
  const t = text.trim()
  if (!t) return ''

  // ── Numbered list ────────────────────────────────────────────────────────
  // Match "1. text 2. text …" — split just before each new "N. " or "N) "
  // The lookbehind (?<!\d) prevents splitting inside numbers like "2-10km"
  const numParts = t.split(/\s+(?=\d+[.)]\s)/).map(s => s.trim()).filter(Boolean)
  const numItems = numParts.filter(s => /^\d+[.)]\s/.test(s))
  if (numItems.length >= 2) {
    const preamble = numParts.filter(s => !/^\d+[.)]\s/.test(s))
    const rows = numItems.map(s => s.replace(/^\d+[.)]\s+/, ''))
    const lines: string[] = []
    if (preamble.length) {
      lines.push(`<p style="font-size:13px;color:#374151;line-height:1.7;margin:0 0 8px 0">${escapeHtml(preamble.join(' '))}</p>`)
    }
    lines.push(`<ol style="margin:4px 0 14px 0;padding-left:22px;font-size:13px;color:#374151;line-height:1.7">`)
    rows.forEach(r => lines.push(`  <li style="margin-bottom:6px">${escapeHtml(r)}</li>`))
    lines.push(`</ol>`)
    return lines.join('\n')
  }

  // ── Bullet list ─────────────────────────────────────────────────────────
  // Convention: section content starts with "- item - item - item"
  if (t.startsWith('- ')) {
    // Split on " - " (space-hyphen-space); the first chunk starts with "- " so strip it
    const bParts = t.split(/ - /).map(s => s.replace(/^-\s*/, '').trim()).filter(Boolean)
    if (bParts.length >= 2) {
      const lines: string[] = []
      lines.push(`<ul style="margin:4px 0 14px 0;padding-left:22px;font-size:13px;color:#374151;line-height:1.7;list-style-type:disc">`)
      bParts.forEach(r => lines.push(`  <li style="margin-bottom:6px">${escapeHtml(r)}</li>`))
      lines.push(`</ul>`)
      return lines.join('\n')
    }
  }

  // ── Plain paragraph ──────────────────────────────────────────────────────
  return `<p style="font-size:13px;color:#374151;line-height:1.7;margin:0 0 12px 0">${escapeHtml(t)}</p>`
}

/** Minimal HTML entity escaping — prevent XSS in email body */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
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
  const issuedAt = alert.issuedAt || new Date()
  const timestamp = issuedAt.toLocaleString('en-GB', { dateStyle: 'full', timeStyle: 'short' })
  const refId = alert.id.substring(0, 8).toUpperCase()
  const recipient = resolveRecipientIdentity(alert)
  const greeting = recipient.greetingEmail

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
      <p style="margin: 4px 0 0 0; font-size: 11px; opacity: 0.7;">Ref: AEGIS-${refId}</p>
    </div>

    <!-- Greeting -->
    <div style="padding: 20px 24px 0 24px;">
      <p style="margin: 0; font-size: 14px; color: #374151;">${greeting}</p>
      <p style="margin: 8px 0 0 0; font-size: 14px; color: #374151;">An emergency alert has been issued for your area. Please read the details below carefully.</p>
    </div>

    <!-- Alert Title & Details -->
    <div style="background-color: ${bg}; border-left: 4px solid ${color}; padding: 18px 20px; margin: 16px 24px;">
      <h2 style="margin: 0 0 10px 0; font-size: 18px; font-weight: 700; color: ${color};">${alert.title}</h2>
      <table cellpadding="0" cellspacing="0" border="0" style="font-size: 13px; color: #4b5563;">
        <tr><td style="padding: 3px 12px 3px 0; font-weight: 600; color: #374151;">Location:</td><td>${alert.area}</td></tr>
        <tr><td style="padding: 3px 12px 3px 0; font-weight: 600; color: #374151;">Type:</td><td style="text-transform: capitalize;">${alert.type.replace(/_/g, ' ')}</td></tr>
        <tr><td style="padding: 3px 12px 3px 0; font-weight: 600; color: #374151;">Severity:</td><td style="text-transform: uppercase; font-weight: 600; color: ${color};">${alert.severity}</td></tr>
        <tr><td style="padding: 3px 12px 3px 0; font-weight: 600; color: #374151;">Recipient:</td><td>${recipient.name ? `${recipient.name} (${recipient.authStatus})` : recipient.authStatus}</td></tr>
        <tr><td style="padding: 3px 12px 3px 0; font-weight: 600; color: #374151;">Date & Time:</td><td>${timestamp}</td></tr>
        <tr><td style="padding: 3px 12px 3px 0; font-weight: 600; color: #374151;">Reference:</td><td>AEGIS-${refId}</td></tr>
      </table>
    </div>

    <!-- Message Body -->
    <div style="padding: 0 24px 20px 24px;">
      ${formatAlertMessageHTML(alert.message, color)}

      ${alert.actionRequired ? `
      <div style="background-color: #fef3c7; border-left: 4px solid #d97706; padding: 14px 16px; margin: 16px 0; border-radius: 6px;">
        <p style="margin: 0; font-weight: 700; color: #92400e; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px;">ACTION REQUIRED</p>
        <p style="margin: 6px 0 0 0; color: #78350f; font-size: 13px; line-height: 1.6;">${alert.actionRequired}</p>
      </div>
      ` : ''}

      ${alert.expiresAt ? `
      <p style="font-size: 12px; color: #6b7280; margin: 16px 0 0 0; padding: 8px 12px; background: #f9fafb; border-radius: 6px;">
        This alert expires: <strong>${new Date(alert.expiresAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}</strong>
      </p>
      ` : ''}
    </div>

    <!-- Safety tip -->
    <div style="padding: 0 24px 16px 24px;">
      <div style="background-color: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 12px 16px;">
        <p style="margin: 0; font-size: 12px; color: #166534; font-weight: 600;">Stay Safe</p>
        <p style="margin: 4px 0 0 0; font-size: 12px; color: #15803d; line-height: 1.5;">Follow official guidance, keep emergency supplies ready, and monitor updates on the AEGIS platform.</p>
      </div>
    </div>

    <!-- Footer -->
    <div style="background-color: #f9fafb; padding: 18px 24px; border-top: 1px solid #e5e7eb;">
      <p style="margin: 0; font-size: 11px; color: #9ca3af; text-align: center; line-height: 1.6;">
        AEGIS Emergency Management System<br>
        For assistance, contact <strong>${SUPPORT_EMAIL}</strong> or call your local emergency services.<br>
        <span style="font-size: 10px;">To unsubscribe, reply with "unsubscribe" or contact support.</span>
      </p>
    </div>

  </div>
</body>
</html>
  `.trim()
}

function generateEmailText(alert: Alert): string {
  const issuedAt = alert.issuedAt || new Date()
  const timestamp = issuedAt.toLocaleString('en-GB', { dateStyle: 'full', timeStyle: 'short' })
  const refId = alert.id.substring(0, 8).toUpperCase()
  const recipient = resolveRecipientIdentity(alert)
  const greeting = recipient.greetingEmail
  return `
AEGIS EMERGENCY MANAGEMENT
${alert.severity.toUpperCase()} ALERT
Issued: ${timestamp}
Reference: AEGIS-${refId}

${greeting}

An emergency alert has been issued for your area.

${alert.title}

Location: ${alert.area}
Type: ${alert.type.replace(/_/g, ' ')}
Severity: ${alert.severity.toUpperCase()}
${recipient.line}
Date & Time: ${timestamp}

${formatAlertMessagePlainText(alert.message)}
${alert.actionRequired ? `\nACTION REQUIRED\n${alert.actionRequired}\n` : ''}${alert.expiresAt ? `\nThis alert expires: ${new Date(alert.expiresAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}\n` : ''}
Stay safe. Follow official guidance and monitor updates.

AEGIS Emergency Management System
For assistance, contact ${SUPPORT_EMAIL} or call your local emergency services.
To unsubscribe, reply with "unsubscribe".
  `.trim()
}

// ─── Plain-text / channel-specific message formatters ────────────────────────

/**
 * Formats the raw alert.message string for plain-text channels (SMS, WhatsApp,
 * email plain-text fallback).
 *
 * The raw message is a single line containing inline markers:
 *   "--- SECTION NAME ---"  → section header
 *   "1. text 2. text …"    → numbered list (space-separated)
 *   "- item - item …"      → bullet list (' - ' separated)
 *   text before first '---' = preamble (stripped)
 */
function formatAlertMessagePlainText(message: string): string {
  // Strip preamble before first --- marker
  const firstMarker = message.indexOf('---')
  const body = firstMarker >= 0 ? message.slice(firstMarker) : message

  // Split on --- SECTION NAME --- delimiters
  const parts = body.split(/(---[^-]+---)/)

  const lines: string[] = []
  let inSection = false

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i].trim()
    if (!part) continue

    // Section header
    const sectionMatch = part.match(/^---\s*(.+?)\s*---$/)
    if (sectionMatch) {
      const sectionName = sectionMatch[1].trim()
      if (sectionName === 'END OF ALERT') break
      if (inSection) lines.push('')
      lines.push(`— ${sectionName} —`)
      inSection = true
      continue
    }

    const text = part.trim()
    if (!text) continue

    // Detect inline numbered list: "1. text 2. text 3. text"
    if (/\d+[.)]\s/.test(text)) {
      const items = text.split(/\s+(?=\d+[.)]\s)/).filter(Boolean)
      if (items.length > 1) {
        for (const item of items) lines.push(item.trim())
        continue
      }
    }

    // Detect inline bullet list: "- item - item" or "item - item - item"
    if (text.startsWith('- ') || text.split(' - ').length > 2) {
      const items = text.split(' - ')
      for (const item of items) {
        const trimmed = item.trim()
        if (trimmed) lines.push(`• ${trimmed}`)
      }
      continue
    }

    lines.push(text)
  }

  return lines.join('\n').trim()
}

/**
 * Formats alert.message for Telegram (MarkdownV2).
 * Builds the plain structure first then applies escaping, keeping
 * section headers bold.
 */
function formatAlertMessageTelegram(message: string): string {
  const plain = formatAlertMessagePlainText(message)
  return plain
    .split('\n')
    .map(line => {
      if (line.startsWith('— ') && line.endsWith(' —')) {
        return `*${escapeMdV2(line)}*`
      }
      return escapeMdV2(line)
    })
    .join('\n')
}

/**
 * Extracts a short summary of the alert message suitable for a push
 * notification body (browser push bodies are typically limited to ~120 chars).
 */
function extractAlertSummary(message: string, maxLen = 120): string {
  const clean = message.replace(/---[^-]+---/g, ' ').replace(/\s+/g, ' ').trim()
  return clean.length > maxLen ? clean.substring(0, maxLen - 1) + '…' : clean
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
  const issuedAt = alert.issuedAt || new Date()
  const ts = issuedAt.toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })
  const refId = alert.id.substring(0, 8).toUpperCase()
  const recipient = resolveRecipientIdentity(alert)
  const name = recipient.name ? `${recipient.name}, ` : ''
  return `AEGIS ${alert.severity.toUpperCase()} ALERT\n${name}${alert.title}\n${recipient.line}\nLocation: ${alert.area}\nType: ${alert.type.replace(/_/g, ' ')}\n${ts} | Ref: ${refId}\n\n${formatAlertMessagePlainText(alert.message)}${alert.actionRequired ? `\n\nACTION: ${alert.actionRequired}` : ''}${alert.expiresAt ? `\nExpires: ${new Date(alert.expiresAt).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })}` : ''}`
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
  const issuedAt = alert.issuedAt || new Date()
  const timestamp = issuedAt.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })
  const refId = alert.id.substring(0, 8).toUpperCase()
  const recipient = resolveRecipientIdentity(alert)
  const greeting = `${recipient.greetingChat}\n\n`
  return `*AEGIS ${alert.severity.toUpperCase()} ALERT*
_Issued: ${timestamp}_
_Ref: AEGIS-${refId}_

${greeting}*${alert.title}*

Location: ${alert.area}
Type: ${alert.type.replace(/_/g, ' ')}
Severity: ${alert.severity.toUpperCase()}
${recipient.line}
Date & Time: ${timestamp}

${formatAlertMessagePlainText(alert.message)}
${alert.actionRequired ? `\n*ACTION REQUIRED*\n${alert.actionRequired}\n` : ''}${alert.expiresAt ? `\n_Expires: ${new Date(alert.expiresAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}_\n` : ''}
Stay safe and follow official guidance.
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
  const message = formatAlertMessageTelegram(alert.message)
  const severity = escapeMdV2(alert.severity.toUpperCase())
  const type = escapeMdV2(alert.type.replace(/_/g, ' '))
  const issuedAt = alert.issuedAt || new Date()
  const timestamp = escapeMdV2(issuedAt.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }))
  const refId = alert.id.substring(0, 8).toUpperCase()
  const recipient = resolveRecipientIdentity(alert)
  const greeting = `${escapeMdV2(recipient.greetingChat)}\n\n`
  const recipientLine = escapeMdV2(recipient.line)

  let text = `*AEGIS ${severity} ALERT*\n_Issued: ${timestamp}_\n_Ref: AEGIS\\-${escapeMdV2(refId)}_\n\n${greeting}*${title}*\n\nLocation: ${area}\nType: ${type}\nSeverity: ${severity}\nDate \\& Time: ${timestamp}`

  text += `\n${recipientLine}`

  text += `\n\n${message}`

  if (alert.actionRequired) {
    text += `\n\n*ACTION REQUIRED*\n${escapeMdV2(alert.actionRequired)}`
  }
  if (alert.expiresAt) {
    text += `\n\n_Expires: ${escapeMdV2(new Date(alert.expiresAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }))}_`
  }

  text += `\n\nStay safe and follow official guidance\\.\n_AEGIS Emergency Management System_`
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

    const issuedAt = alert.issuedAt || new Date()
    const refId = alert.id.substring(0, 8).toUpperCase()
    const recipient = resolveRecipientIdentity(alert)
    const namePrefix = recipient.name ? `${recipient.name}, ` : ''

    const payload = JSON.stringify({
      title: `AEGIS ${severityLabel}: ${alert.title}`,
      body: `${namePrefix}${alert.area} — ${alert.type.replace(/_/g, ' ')} — ${issuedAt.toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })}\n${extractAlertSummary(alert.message)}${alert.actionRequired ? ' | ' + alert.actionRequired : ''}`,
      icon: '/icons/icon-192x192.png',
      badge: '/icons/icon-96x96.png',
      tag: alert.id,
      requireInteraction: alert.severity === 'critical',
      data: {
        alert_id: alert.id,
        severity: alert.severity,
        type: alert.type,
        ref: `AEGIS-${refId}`,
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
    // Detect expired/unregistered subscriptions (410 Gone, 404 Not Found)
    const statusCode = error?.statusCode as number | undefined
    const expired = statusCode === 410 || statusCode === 404
    return {
      channel: 'web',
      success: false,
      error: error.message,
      expired,
      statusCode,   // expose so callers can make finer-grained deactivation decisions
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
 * total delivery time - (5000/50) - avg_latency_per_batch.
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
      const perSubscriberAlert: Alert = {
        ...alert,
        subscriberName: sub.subscriber_name || undefined,
        subscriberAuthStatus: sub.subscriber_name ? 'Signed in user' : 'Anonymous / not signed in',
        issuedAt: new Date(),
      }
      return sendMultiChannelAlert(recipient, perSubscriberAlert, sub.channels || ['email'])
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

