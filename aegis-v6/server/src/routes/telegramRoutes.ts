/**
 * telegramRoutes.ts - Telegram bot webhook & chat-id capture
 *
 * When a user subscribes with a Telegram username (@Zemphra), the bot cannot
 * message them until they send /start first.  This module:
 *
 *  POST /api/telegram/webhook  — Telegram calls this for every update
 *    • When a user sends /start (or any message), capture their numeric chat_id
 *    • Update alert_subscriptions rows whose telegram_id matches @username
 *    • Reply to the user confirming they're subscribed
 *
 *  GET  /api/telegram/updates  — Poll for recent /start messages (dev fallback)
 *    • Calls getUpdates, applies the same chat_id capture logic
 *
 *  POST /api/telegram/set-webhook — Register the webhook URL with Telegram
 */

import { Router, Request, Response } from 'express'
import pool from '../models/db.js'

const router = Router()

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || ''
const API = `https://api.telegram.org/bot${BOT_TOKEN}`

// ─── helpers ──────────────────────────────────────────────────────────────────

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

  // Update subscriptions that have a matching @username OR the numeric chatId
  // stored as a string
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
    console.log(`[Telegram] Updated ${rowCount} subscription(s) — @${username || 'unknown'} → chat_id ${chatId}`)
  }

  // Respond to /start or any first contact with a welcome message
  if (text.startsWith('/start') || (rowCount && rowCount > 0)) {
    await tgPost('sendMessage', {
      chat_id: chatId,
      parse_mode: 'HTML',
      text:
        '✅ <b>AEGIS Alert System</b>\n\n' +
        'You are now connected to the AEGIS Emergency Management System.\n\n' +
        'You will receive emergency alerts directly in this chat.\n\n' +
        `🆔 Your Telegram chat ID is: <code>${chatId}</code>\n\n` +
        'No further action is required. Stay safe! 🛡️',
    })
  }
}

// ─── Webhook endpoint (Telegram → server) ─────────────────────────────────────

router.post('/webhook', async (req: Request, res: Response): Promise<void> => {
  // Always acknowledge immediately so Telegram doesn't retry
  res.sendStatus(200)

  if (!BOT_TOKEN) return

  try {
    await processUpdate(req.body)
  } catch (err: any) {
    console.error('[Telegram] Webhook error:', err.message)
  }
})

// ─── Manual poll (dev / fallback when webhook not configured) ─────────────────

let _lastOffset = 0

router.get('/updates', async (_req: Request, res: Response): Promise<void> => {
  if (!BOT_TOKEN) {
    res.status(503).json({ error: 'Telegram bot token not configured.' })
    return
  }

  try {
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
      // processUpdate doesn't return a count; we trust the DB log
    }

    res.json({ ok: true, updates: data.result?.length || 0, nextOffset: _lastOffset })
  } catch (err: any) {
    console.error('[Telegram] Poll error:', err.message)
    res.status(500).json({ error: 'Failed to poll Telegram updates.' })
  }
})

// ─── Register webhook with Telegram ───────────────────────────────────────────

router.post('/set-webhook', async (req: Request, res: Response): Promise<void> => {
  if (!BOT_TOKEN) {
    res.status(503).json({ error: 'Telegram bot token not configured.' })
    return
  }

  const { url } = req.body
  if (!url) {
    res.status(400).json({ error: 'url is required (e.g. https://yourdomain.com/api/telegram/webhook)' })
    return
  }

  try {
    const result = await tgPost('setWebhook', { url, allowed_updates: ['message', 'channel_post'] })
    res.json(result)
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

export default router
