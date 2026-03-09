/**
 * routes/chatRoutes.ts — LLM chatbot API endpoints
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

import { Router, Request, Response } from 'express'
import { processChat, getChatHistory, listSessions } from '../services/chatService.js'
import { getProviderStatus } from '../services/llmRouter.js'
import { validate, chatMessageSchema } from '../middleware/validate.js'
import jwt from 'jsonwebtoken'

const router = Router()
// Re-use the shared JWT secret (see auth.ts for production guard)
const JWT_SECRET = process.env.JWT_SECRET || (() => {
  const crypto = require('crypto') as typeof import('crypto')
  return crypto.randomBytes(64).toString('hex')
})()

/**
 * Extract user from token if present (optional auth).
 * Doesn't reject unauthenticated requests — just returns null.
 */
function optionalAuth(req: Request): { id: string; type: 'citizen' | 'operator' } | null {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) return null

  try {
    const decoded = jwt.verify(header.split(' ')[1], JWT_SECRET) as any
    // Citizen tokens have citizenId, operator tokens have id
    if (decoded.citizenId) return { id: decoded.citizenId, type: 'citizen' }
    if (decoded.id) return { id: decoded.id, type: 'operator' }
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
router.post('/', validate(chatMessageSchema), async (req: Request, res: Response) => {
  try {
    const user = optionalAuth(req)
    const { message, sessionId } = req.body

    const result = await processChat({
      message,
      sessionId,
      citizenId: user?.type === 'citizen' ? user.id : undefined,
      operatorId: user?.type === 'operator' ? user.id : undefined,
    })

    res.json(result)
  } catch (err: any) {
    console.error('[Chat API] Error:', err.message)
    res.status(500).json({
       error: 'Chat service is temporarily unavailable. Please try again.',
       details: process.env.NODE_ENV !== 'production' ? err.message : undefined,
    })
  }
})

/**
 * GET /api/chat/sessions — List authenticated user's chat sessions
 */
router.get('/sessions', async (req: Request, res: Response) => {
  const user = optionalAuth(req)
  if (!user) {
    res.status(401).json({ error: 'Authentication required to view chat sessions.' })
    return
  }

  try {
    const sessions = await listSessions(user.id, user.type)
    res.json({ sessions })
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to load chat sessions.' })
  }
})

/**
 * GET /api/chat/status — LLM provider health information
 * (Public endpoint for transparency dashboard)
 */
router.get('/status', async (_req: Request, res: Response) => {
  try {
    const status = getProviderStatus()
    res.json({
      providers: status,
      preferred: status.find((s) => !s.rateLimited && !s.backedOff)?.name || null,
    })
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to get provider status.' })
  }
})

/**
 * GET /api/chat/:id — Get message history for a session
 */
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const messages = await getChatHistory(req.params.id)
    res.json({ messages })
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to load chat history.' })
  }
})

export default router
