/**
 * routes/chatRoutes.ts — LLM chatbot API endpoints (with image upload)
 *
 * Provides the REST API for the citizen-facing AI chatbot:
 *   POST /api/chat          — Send a message and get an AI response
 *   GET  /api/chat/sessions — List user's chat sessions
 *   GET  /api/chat/:id      — Get chat history for a session
 *   GET  /api/chat/status   — LLM provider health status
 *
 * Authentication is optional for chat (anonymous users can ask
 * questions) but authenticated users get persisted sessions.
 */

import { Router, Request, Response, NextFunction } from 'express'
import multer from 'multer'
import path from 'path'
import fs from 'fs'
import { processChat, processChatStream, getChatHistory, listSessions, verifySessionOwnership, getChatSessionBudget, endChatSession, logSuggestionClick } from '../services/chatService.js'
import { getProviderStatus } from '../services/llmRouter.js'
import { validate, chatMessageSchema } from '../middleware/validate.js'
import { verifyToken } from '../middleware/auth.js'
import { AppError } from '../utils/AppError.js'
import { sseConnectionsActive, chatStreamTotal, chatStreamLatency } from '../services/metrics.js'
import { logger } from '../services/logger.js'
import pool from '../models/db.js'

const router = Router()

// Per-user/IP rate limiting for chat endpoints
const chatRateLimits = new Map<string, { count: number; windowStart: number }>()
const CHAT_RATE_LIMIT = 20 // max requests per window
const CHAT_RATE_WINDOW = 60_000 // 1 minute window

function checkChatRateLimit(identifier: string): boolean {
  const now = Date.now()
  const entry = chatRateLimits.get(identifier)
  if (!entry || now - entry.windowStart >= CHAT_RATE_WINDOW) {
    chatRateLimits.set(identifier, { count: 1, windowStart: now })
    return true
  }
  if (entry.count >= CHAT_RATE_LIMIT) return false
  entry.count++
  return true
}

// Cleanup stale rate limit entries every 5 minutes
setInterval(() => {
  const now = Date.now()
  for (const [key, entry] of chatRateLimits) {
    if (now - entry.windowStart >= CHAT_RATE_WINDOW * 2) chatRateLimits.delete(key)
  }
}, 300_000)

 /**
 * Extract user from token if present (optional auth).
 * Doesn't reject unauthenticated requests — just returns null.
 */
function optionalAuth(req: Request): { id: string; type: 'citizen' | 'operator' } | null {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) return null

  try {
    const decoded = verifyToken<any>(header.split(' ')[1])
    const userId = typeof decoded?.id === 'string' ? decoded.id : null
    const role = String(decoded?.role || '').toLowerCase()
    if (!userId) return null
    if (role === 'citizen') return { id: userId, type: 'citizen' }
    if (['admin', 'operator', 'manager'].includes(role)) return { id: userId, type: 'operator' }
  } catch {
    // Invalid token — treat as anonymous
  }
  return null
}

 /**
 * POST /api/chat — Send a message to the AI chatbot
 *
 * Body: { message: string, sessionId?: string }
 * Returns: { sessionId, reply, model, tokensUsed, toolsUsed, sources, safetyFlags }
 */
router.post('/', validate(chatMessageSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = optionalAuth(req)
    const rateLimitKey = user?.id || req.ip || 'anonymous'
    if (!checkChatRateLimit(rateLimitKey)) {
      return res.status(429).json({ error: 'Rate limit exceeded. Please wait before sending more messages.' })
    }
    const { message, sessionId, preferredProvider } = req.body

    const result = await processChat({
      message,
      sessionId,
      citizenId: user?.type === 'citizen' ? user.id : undefined,
      operatorId: user?.type === 'operator' ? user.id : undefined,
      adminMode: user?.type === 'operator',
      preferredProvider: typeof preferredProvider === 'string' ? preferredProvider : undefined,
    })

    res.json(result)
  } catch (err) {
    next(err)
  }
})

 /**
 * POST /api/chat/upload-image — Upload an image for AI analysis in chat
 * Returns the image URL so the client can include it in a chat message.
 * Accepts: JPEG, PNG, GIF, WebP (max 10MB)
 */
const chatUploadDir = path.join(process.cwd(), 'uploads', 'chat')
if (!fs.existsSync(chatUploadDir)) {
  fs.mkdirSync(chatUploadDir, { recursive: true })
}

const chatImageStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, chatUploadDir),
  filename: (_req, file, cb) => {
    const ts = Date.now()
    const rand = Math.random().toString(36).substring(2, 8)
    const ext = path.extname(file.originalname).toLowerCase()
    cb(null, `${ts}-${rand}${ext}`)
  },
})

const chatImageUpload = multer({
  storage: chatImageStorage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
    if (!allowed.includes(file.mimetype)) {
      return cb(new Error('Only image files are allowed (JPEG, PNG, GIF, WebP)'))
    }
    cb(null, true)
  },
})

router.post('/upload-image', chatImageUpload.single('image'), (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.file) {
      throw AppError.badRequest('No image file provided')
    }
    const imageUrl = `/uploads/chat/${req.file.filename}`
    res.json({
      success: true,
      imageUrl,
      filename: req.file.filename,
      size: req.file.size,
      mimetype: req.file.mimetype,
    })
  } catch (err) {
    next(err)
  }
})

 /**
 * POST /api/chat/stream — Stream chat tokens with SSE
 * Body: { message: string, sessionId?: string }
 */
router.post('/stream', validate(chatMessageSchema), async (req: Request, res: Response) => {
  const user = optionalAuth(req)
  const rateLimitKey = user?.id || req.ip || 'anonymous'
  if (!checkChatRateLimit(rateLimitKey)) {
    res.setHeader('Content-Type', 'text/event-stream')
    res.write(`event: error\ndata: ${JSON.stringify({ error: 'Rate limit exceeded' })}\n\n`)
    res.end()
    return
  }
  const { message, sessionId, preferredProvider } = req.body
  const streamStart = Date.now()
  sseConnectionsActive.inc()

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')

  const writeEvent = (event: string, data: unknown): void => {
    res.write(`event: ${event}\n`)
    res.write(`data: ${JSON.stringify(data)}\n\n`)
  }

    // Silently absorb write errors (EPIPE) that occur when a client disconnects
    // mid-stream. Node.js 18+ fires req 'close' on normal request completion too,
    // so we guard writes with res.writableEnded instead of a clientClosed flag.
    res.on('error', () => { /* client disconnected */ })

  req.on('close', () => {
    sseConnectionsActive.dec()
  })

  try {
    writeEvent('start', { ok: true })

    const result = await processChatStream(
      {
        message,
        sessionId,
        citizenId: user?.type === 'citizen' ? user.id : undefined,
        operatorId: user?.type === 'operator' ? user.id : undefined,
        adminMode: user?.type === 'operator',
        preferredProvider: typeof preferredProvider === 'string' ? preferredProvider : undefined,
      },
      {
        onToken: (token) => {
            if (!res.writableEnded) writeEvent('token', { token })
        },
        onReplace: (text) => {
            if (!res.writableEnded) writeEvent('replace', { text })
        },
        onToolCall: (toolName, status) => {
            if (!res.writableEnded) writeEvent('tool_call', { name: toolName, status })
        },
        onThinking: (phase) => {
            if (!res.writableEnded) writeEvent('thinking', { phase })
        },
      },
    )

      if (!res.writableEnded) {
      writeEvent('done', {
        sessionId: result.sessionId,
        model: result.model,
        tokensUsed: result.tokensUsed,
        safetyFlags: result.safetyFlags,
        confidence: result.confidence,
        agent: result.agent,
        emotion: result.emotion,
        budgetUsed: result.budgetUsed,
        budgetLimit: result.budgetLimit,
        budgetRemaining: result.budgetRemaining,
        toolsUsed: result.toolsUsed,
        sources: result.sources,
        followUpQuestions: result.followUpQuestions,
        isEmergency: result.emergency?.isEmergency,
        emergencyType: result.emergency?.type,
        suggestedActions: result.emergency?.suggestedActions,
        qualityScore: result.qualityScore,
        smartSuggestions: result.smartSuggestions || [],
        isPersonalized: result.isPersonalized || false,
      })
      res.end()
    }
    chatStreamTotal.inc({ status: 'success' })
    chatStreamLatency.observe((Date.now() - streamStart) / 1000)
  } catch (err) {
      if (!res.writableEnded) {
      writeEvent('error', { error: 'Streaming failed' })
      res.end()
    }
    chatStreamTotal.inc({ status: 'error' })
    chatStreamLatency.observe((Date.now() - streamStart) / 1000)
    logger.error({ err }, '[Chat SSE] Streaming failed')
  }
})

 /**
 * GET /api/chat/sessions — List authenticated user's chat sessions
 */
router.get('/sessions', async (req: Request, res: Response, next: NextFunction) => {
  const user = optionalAuth(req)
  if (!user) {
    throw AppError.unauthorized('Authentication required to view chat sessions.')
  }

  try {
    const sessions = await listSessions(user.id, user.type)
    res.json({ sessions })
  } catch (err) {
    next(err)
  }
})

 /**
 * GET /api/chat/status — LLM provider health information
 * (Public endpoint for transparency dashboard)
 */
router.get('/status', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const status = getProviderStatus()
    res.json({
      providers: status,
      preferred: status.find((s) => !s.rateLimited && !s.backedOff)?.name || null,
    })
  } catch (err) {
    next(err)
  }
})

 /**
 * GET /api/chat/:id/budget — Session token budget state
 */
router.get('/:id/budget', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = optionalAuth(req)
    if (!user) {
      throw AppError.unauthorized('Authentication required to view chat budget.')
    }

    const isOwner = await verifySessionOwnership(req.params.id, user.id, user.type)
    if (!isOwner) {
      throw AppError.forbidden('Access denied. You do not own this chat session.')
    }

    const result = await getChatSessionBudget(req.params.id)
    res.json({
      sessionId: req.params.id,
      budgetUsed: result.budgetUsed,
      budgetLimit: result.budgetLimit,
      budgetRemaining: result.budgetRemaining,
    })
  } catch (err) {
    next(err)
  }
})

 /**
 * GET /api/chat/:id — Get message history for a session
 * SECURITY: Requires authentication and ownership verification
 */
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = optionalAuth(req)
    
    // Require authentication for chat history access
    if (!user) {
      throw AppError.unauthorized('Authentication required to view chat history.')
    }
    
    // Verify ownership of the session
    const isOwner = await verifySessionOwnership(req.params.id, user.id, user.type)
    if (!isOwner) {
      throw AppError.forbidden('Access denied. You do not own this chat session.')
    }
    
    const messages = await getChatHistory(req.params.id)
    res.json({ messages })
  } catch (err) {
    next(err)
  }
})

 /**
 * POST /api/chat/sessions/:id/end — End and summarize a chat session
 * Called when user closes the chatbot to trigger auto-summarization
 */
router.post('/sessions/:id/end', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = optionalAuth(req)
    if (!user) {
      throw AppError.unauthorized('Authentication required to end a chat session.')
    }

    const isOwner = await verifySessionOwnership(req.params.id, user.id, user.type)
    if (!isOwner) {
      throw AppError.forbidden('Access denied. You do not own this chat session.')
    }

    await endChatSession(req.params.id)
    res.json({ ok: true })
  } catch (err) {
    next(err)
  }
})

 /**
 * POST /api/chat/suggestion-click — Log when a user clicks a smart suggestion
 * Body: { sessionId: string, suggestionText: string, category: string }
 */
router.post('/suggestion-click', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = optionalAuth(req)
    const { sessionId: sId, suggestionText, category } = req.body
    if (!sId || !suggestionText) {
      return res.status(400).json({ error: 'sessionId and suggestionText required' })
    }

    await logSuggestionClick(sId, user?.id ?? undefined, suggestionText, category || 'general')
    res.json({ ok: true })
  } catch (err) {
    next(err)
  }
})

 /**
 * POST /api/chat/feedback — Submit feedback on a chat message
 * Body: { messageId: string, rating: 'up' | 'down', sessionId?: string }
 */
router.post('/feedback', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { messageId, rating, sessionId } = req.body
    if (!messageId || !['up', 'down'].includes(rating)) {
      return res.status(400).json({ error: 'messageId and rating (up/down) required' })
    }

    // Update cache boost score based on feedback
    try {
      if (sessionId) {
        const boostDelta = rating === 'up' ? 1 : -1
        await pool.query(
          `UPDATE response_cache SET hit_count = hit_count + $1
           WHERE query_hash IN (
             SELECT query_hash FROM response_cache
             WHERE expires_at > now()
             ORDER BY created_at DESC LIMIT 5
           )`,
          [boostDelta],
        )
      }
    } catch {
      // Best-effort cache update
    }

    logger.info({ messageId, rating, sessionId }, '[Chat] Feedback received')
    res.json({ ok: true })
  } catch (err) {
    next(err)
  }
})

export default router
