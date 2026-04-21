/**
 * Telegram bot integration: receives webhook updates from the Telegram
 * Bot API, handles /start commands to capture chat IDs, and links
 * Telegram accounts to citizen profiles for alert delivery.
 *
 * - Mounted at /api/telegram in index.ts
 * - Receives POST webhooks from Telegram's Bot API
 * - Links Telegram chat IDs to citizen accounts in the database
 * - The notification service uses these chat IDs to send alerts
 * */

import { Router, Request, Response, NextFunction } from 'express'
import rateLimit from 'express-rate-limit'
import pool from '../models/db.js'
import { authMiddleware, requireRole, type AuthRequest } from '../middleware/auth.js'
import { getClientIp } from '../utils/securityUtils.js'
import { AppError } from '../utils/AppError.js'
import { logger } from '../services/logger.js'

const router = Router()

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || ''
const API = `https://api.telegram.org/bot${BOT_TOKEN}`

//Allowed webhook domains (comma-separated in env, or the server's own domain).
//If not set, any non-private HTTPS domain is accepted.
const ALLOWED_WEBHOOK_DOMAINS: string[] = (process.env.TELEGRAM_WEBHOOK_ALLOWED_DOMAINS || '')
  .split(',')
  .map(d => d.trim().toLowerCase())
  .filter(Boolean)

//Rate limit: 5 webhook configuration attempts per hour
const webhookConfigLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: { error: 'Too many webhook configuration attempts. Try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
})

//helpers

async function tgPost(method: string, body: object) {
  const r = await fetch(`${API}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return r.json()
}

/**
 * Process a single Telegram update object.
 * Captures the numeric chat_id for any user that messages the bot and
 * updates their subscription row (matched by @username or existing chat_id).
 */
async function processUpdate(update: any): Promise<void> {
  const msg = update.message || update.channel_post
  if (!msg) return

  const chatId   = msg.chat?.id
  const username = msg.chat?.username    // may be undefined
  const text     = msg.text || ''

  if (!chatId) return

  //Update subscriptions that have a matching @username OR the numeric chatId
  //stored as a string
  const lookups: string[] = [`${chatId}`]  // numeric id as string
  if (username) {
    lookups.push(`@${username}`)
    lookups.push(username)
  }

  const { rowCount } = await pool.query(
    `UPDATE alert_subscriptions
        SET telegram_id = $1, updated_at = NOW()
      WHERE telegram_id = ANY($2::text[])
        AND (telegram_id != $1 OR telegram_id IS DISTINCT FROM $1)`,
    [`${chatId}`, lookups]
  )

  if (rowCount && rowCount > 0) {
    logger.info({ rowCount, username, chatId }, '[Telegram] Updated subscription(s)')
  }

  //Respond to /start or any first contact with a welcome message
  if (text.startsWith('/start') || (rowCount && rowCount > 0)) {
    await tgPost('sendMessage', {
      chat_id: chatId,
      parse_mode: 'HTML',
      text:
        '? <b>AEGIS Alert System</b>\n\n' +
        'You are now connected to the AEGIS Emergency Management System.\n\n' +
        'You will receive emergency alerts directly in this chat.\n\n' +
        `?? Your Telegram chat ID is: <code>${chatId}</code>\n\n` +
        'No further action is required. Stay safe! ???',
    })
  }
}

//Webhook endpoint (Telegram ? server)

router.post('/webhook', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  //Always acknowledge immediately so Telegram doesn't retry
  res.sendStatus(200)

  if (!BOT_TOKEN) return

  try {
    await processUpdate(req.body)
  } catch (err: any) {
    logger.error({ err }, '[Telegram] Webhook error')
  }
})

//Manual poll (dev / fallback when webhook not configured)

let _lastOffset = 0

router.get('/updates', async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
  if (!BOT_TOKEN) {
    throw AppError.serviceUnavailable('Telegram bot token not configured.')
  }

    const r = await fetch(`${API}/getUpdates?offset=${_lastOffset}&limit=100&timeout=0`)
    const data: any = await r.json()

    if (!data.ok) {
      res.status(502).json({ error: data.description || 'Telegram API error' })
      return
    }

    let captured = 0
    for (const update of data.result || []) {
      if (update.update_id >= _lastOffset) _lastOffset = update.update_id + 1
      const before = captured
      await processUpdate(update)
      //processUpdate doesn't return a count; we trust the DB log
    }

    res.json({ ok: true, updates: data.result?.length || 0, nextOffset: _lastOffset })
})

//Register webhook with Telegram (admin-only, validated, audited)

/**
 * Validate that a webhook URL is safe to register.
 * Rejects non-HTTPS, localhost, private/reserved IPs, and non-allowlisted domains.
 */
function validateWebhookUrl(raw: string): { valid: boolean; reason?: string } {
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    return { valid: false, reason: 'Invalid URL format.' }
  }

  if (parsed.protocol !== 'https:') {
    return { valid: false, reason: 'Webhook URL must use HTTPS.' }
  }

  const host = parsed.hostname.toLowerCase()

  //Block localhost variants
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]' || host === '0.0.0.0') {
    return { valid: false, reason: 'Localhost webhook URLs are not allowed.' }
  }

  //Block IP literals (private ranges + any raw IP to prevent SSRF)
  const ipv4Match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (ipv4Match) {
    const [, a, b] = ipv4Match.map(Number)
    const isPrivate = (a === 10) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254) ||
      (a === 0) || (a === 127)
    if (isPrivate) {
      return { valid: false, reason: 'Private/reserved IP addresses are not allowed.' }
    }
    //Block all raw IPs unless domain allowlist explicitly includes it
    if (ALLOWED_WEBHOOK_DOMAINS.length > 0 && !ALLOWED_WEBHOOK_DOMAINS.includes(host)) {
      return { valid: false, reason: 'IP-literal webhook URLs are not in the allowed domain list.' }
    }
    if (ALLOWED_WEBHOOK_DOMAINS.length === 0) {
      return { valid: false, reason: 'Raw IP addresses are not allowed as webhook URLs. Use a domain name.' }
    }
  }

  //Domain allowlist enforcement
  if (ALLOWED_WEBHOOK_DOMAINS.length > 0) {
    const allowed = ALLOWED_WEBHOOK_DOMAINS.some(
      domain => host === domain || host.endsWith(`.${domain}`)
    )
    if (!allowed) {
      return { valid: false, reason: `Domain '${host}' is not in the allowed webhook domains list.` }
    }
  }

  return { valid: true }
}

router.post(
  '/set-webhook',
  webhookConfigLimiter,
  authMiddleware,
  requireRole('admin'),
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    const ip = getClientIp(req as any)
    const operatorId = req.user?.id || null
    const operatorEmail = req.user?.email || 'unknown'

    if (!BOT_TOKEN) {
      await auditWebhookAttempt(operatorId, ip, '', false, 'Bot token not configured')
      throw AppError.serviceUnavailable('Telegram bot token not configured.')
    }

    const { url } = req.body
    if (!url || typeof url !== 'string') {
      await auditWebhookAttempt(operatorId, ip, '', false, 'Missing or invalid url parameter')
      throw AppError.badRequest('A valid webhook url string is required.')
    }

    //Validate the URL before sending to Telegram
    const validation = validateWebhookUrl(url)
    if (!validation.valid) {
      await auditWebhookAttempt(operatorId, ip, url, false, validation.reason!)
      res.status(400).json({ error: validation.reason })
      return
    }

    try {
      const result = await tgPost('setWebhook', { url, allowed_updates: ['message', 'channel_post'] })

      const success = !!(result as any)?.ok
      await auditWebhookAttempt(
        operatorId, ip, url, success,
        success ? 'Webhook registered successfully' : `Telegram API rejected: ${(result as any)?.description || 'unknown'}`
      )

      if (success) {
        logger.info({ url, operatorEmail, ip }, '[Telegram] Webhook set')
      }

      res.json(result)
    } catch (err: any) {
      await auditWebhookAttempt(operatorId, ip, url, false, `Request failed: ${err.message}`)
      next(err)
    }
  }
)

/* Write a webhook configuration attempt to the audit trail. */
async function auditWebhookAttempt(
  operatorId: string | null, ip: string, url: string, success: boolean, detail: string
): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO activity_log (operator_id, action, action_type, metadata)
       VALUES ($1, $2, $3, $4)`,
      [
        operatorId,
        `Telegram webhook ${success ? 'configured' : 'config rejected'}: ${detail}`,
        success ? 'deploy' : 'note',
        JSON.stringify({ webhook_url: url, ip, success, detail }),
      ]
    )
  } catch {
    //Audit logging must never break the request flow
    logger.error('[Telegram] Failed to write audit log for webhook config attempt')
  }
}

export default router
