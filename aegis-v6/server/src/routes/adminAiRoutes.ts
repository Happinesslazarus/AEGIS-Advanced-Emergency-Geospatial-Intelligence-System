/**
 * Admin AI management: token usage analytics, LLM provider health
 * monitoring, chat session analytics, and canned reply templates
 * for admin messaging.
 *
 * - Mounted at /api/admin/ai in index.ts
 * - Reads AI analytics from the database and LLM provider APIs
 * - Requires admin authentication
 *
 * GET  /api/admin/ai/token-usage     -- Token usage stats
 * GET  /api/admin/ai/provider-health -- LLM provider statuses
 * GET  /api/admin/ai/analytics       -- Session analytics
 * CRUD /api/admin/ai/canned-replies  -- Canned reply management
 * POST /api/admin/ai/draft-reply     -- AI-drafted reply
 * */

import { Router, Response, NextFunction } from 'express'
import pool from '../models/db.js'
import { authMiddleware, requireRole, AuthRequest } from '../middleware/auth.js'
import { AppError } from '../utils/AppError.js'
import { getTokenUsageStats, getProviderStatus, classifyQuery } from '../services/llmRouter.js'
import { chatCompletion } from '../services/llmRouter.js'
import { logger } from '../services/logger.js'

const router = Router()

//All routes require at least operator role
router.use(authMiddleware)
router.use(requireRole('admin', 'operator', 'super_admin', 'superadmin'))

/**
 * GET /api/admin/ai/token-usage -- Token usage statistics
 * Returns today/week breakdown of local vs API usage, per-provider totals.
 */
router.get('/token-usage', async (_req: AuthRequest, res: Response, next: NextFunction) => {
    const stats = getTokenUsageStats()
    res.json(stats)
})

/**
 * GET /api/admin/ai/provider-health -- All LLM provider health statuses
 */
router.get('/provider-health', async (_req: AuthRequest, res: Response, next: NextFunction) => {
    const status = getProviderStatus()
    const preferred = status.find(s => !s.rateLimited && !s.backedOff)?.name || null
    const localProviders = status.filter(s => s.name.startsWith('ollama'))
    const cloudProviders = status.filter(s => !s.name.startsWith('ollama'))

    res.json({
      providers: status,
      preferred,
      local: {
        count: localProviders.length,
        allHealthy: localProviders.every(p => p.consecutiveErrors === 0),
        models: localProviders.map(p => ({ name: p.name, model: p.model, healthy: p.consecutiveErrors === 0 })),
      },
      cloud: {
        count: cloudProviders.length,
        configured: cloudProviders.filter(p => p.enabled).length,
      },
    })
})

/**
 * GET /api/admin/ai/analytics -- Aggregated chat analytics
 * Returns conversation metrics: total sessions, avg quality, agent distribution, etc.
 */
router.get('/analytics', async (_req: AuthRequest, res: Response, next: NextFunction) => {
    //Aggregate from chat_sessions and chat_messages
    const [sessionStats, recentMessages, modelDistribution] = await Promise.all([
      pool.query(`
        SELECT 
          COUNT(*) AS total_sessions,
          AVG(total_tokens) AS avg_tokens_per_session,
          COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours') AS sessions_today,
          COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days') AS sessions_week
        FROM chat_sessions
      `),
      pool.query(`
        SELECT COUNT(*) AS total_messages,
          COUNT(*) FILTER (WHERE role = 'user') AS user_messages,
          COUNT(*) FILTER (WHERE role = 'assistant') AS ai_messages,
          AVG(tokens_used) FILTER (WHERE role = 'assistant' AND tokens_used > 0) AS avg_tokens_per_response,
          AVG(latency_ms) FILTER (WHERE role = 'assistant' AND latency_ms > 0) AS avg_latency_ms
        FROM chat_messages
        WHERE created_at > NOW() - INTERVAL '24 hours'
      `),
      pool.query(`
        SELECT model_used, COUNT(*) AS count
        FROM chat_messages
        WHERE role = 'assistant' AND model_used IS NOT NULL
          AND created_at > NOW() - INTERVAL '24 hours'
        GROUP BY model_used
        ORDER BY count DESC
        LIMIT 10
      `),
    ])

    const tokenUsage = getTokenUsageStats()

    res.json({
      sessions: sessionStats.rows[0],
      recentActivity: recentMessages.rows[0],
      modelDistribution: modelDistribution.rows,
      tokenUsage,
    })
})

/**
 * GET /api/admin/ai/canned-replies -- List all canned reply templates
 */
router.get('/canned-replies', async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { rows } = await pool.query(`
      SELECT id, title, content, category, shortcut, usage_count, created_at, updated_at
      FROM canned_replies
      WHERE deleted_at IS NULL
      ORDER BY usage_count DESC, title ASC
    `)
    res.json({ replies: rows })
  } catch (err: any) {
    //Table may not exist yet
    if (err.code === '42P01') {
      return res.json({ replies: [], notice: 'canned_replies table not yet created. Run migration.' })
    }
    next(err)
  }
})

/**
 * POST /api/admin/ai/canned-replies -- Create a new canned reply
 * Body: { title: string, content: string, category?: string, shortcut?: string }
 */
router.post('/canned-replies', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { title, content, category, shortcut } = req.body
    if (!title || !content) {
      return res.fail('Both a title and content are required to save a canned reply.', 400)
    }

    const { rows } = await pool.query(
      `INSERT INTO canned_replies (title, content, category, shortcut, created_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, title, content, category, shortcut, created_at`,
      [title.trim().slice(0, 200), content.trim().slice(0, 5000), 
       (category || 'general').trim().slice(0, 50), shortcut?.trim().slice(0, 20) || null,
       req.user?.id],
    )
    res.status(201).json(rows[0])
  } catch (err: any) {
    if (err.code === '42P01') {
      return next(AppError.serviceUnavailable('The canned replies feature is not yet set up. A database migration needs to be run -- please contact your system administrator.'))
    }
    next(err)
  }
})

/**
 * PUT /api/admin/ai/canned-replies/:id -- Update a canned reply
 */
router.put('/canned-replies/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
    const { title, content, category, shortcut } = req.body
    const { rows } = await pool.query(
      `UPDATE canned_replies
       SET title = COALESCE($1, title),
           content = COALESCE($2, content),
           category = COALESCE($3, category),
           shortcut = COALESCE($4, shortcut),
           updated_at = NOW()
       WHERE id = $5 AND deleted_at IS NULL
       RETURNING id, title, content, category, shortcut, updated_at`,
      [title?.trim().slice(0, 200), content?.trim().slice(0, 5000), 
       category?.trim().slice(0, 50), shortcut?.trim().slice(0, 20),
       req.params.id],
    )
    if (rows.length === 0) return res.fail('Canned reply not found', 404)
    res.json(rows[0])
})

/**
 * DELETE /api/admin/ai/canned-replies/:id -- Soft-delete a canned reply
 */
router.delete('/canned-replies/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
    const { rowCount } = await pool.query(
      `UPDATE canned_replies SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL`,
      [req.params.id],
    )
    if (rowCount === 0) return res.fail('Canned reply not found', 404)
    res.json({ ok: true })
})

/**
 * POST /api/admin/ai/draft-reply -- Generate AI draft reply for admin messaging
 * Body: { threadId: string, citizenMessage: string, context?: string }
 * Returns: { draft: string, model: string, tokensUsed: number }
 */
router.post('/draft-reply', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { threadId, citizenMessage, context } = req.body
    if (!citizenMessage) {
      return res.fail('A citizen message is required to generate a suggested reply.', 400)
    }

    //Load thread context if threadId provided
    let threadContext = ''
    if (threadId) {
      try {
        const { rows } = await pool.query(
          `SELECT sender_type, content FROM messages
           WHERE thread_id = $1
           ORDER BY created_at DESC
           LIMIT 10`,
          [threadId],
        )
        if (rows.length > 0) {
          threadContext = '\n\nRecent thread messages:\n' +
            rows.reverse().map((m: any) => `[${m.sender_type}]: ${m.content?.slice(0, 200)}`).join('\n')
        }
      } catch {
        //Thread lookup failure is non-critical
      }
    }

    const systemPrompt = `You are an emergency management operator AI assistant. Draft a professional, empathetic response to a citizen's message.

Guidelines:
- Be professional but warm -- these are real people in potential distress
- Provide actionable information and next steps
- Reference specific resources (shelters, emergency numbers) when relevant
- Keep responses concise but thorough (2-4 paragraphs)
- Never promise outcomes you can't guarantee
- If the citizen is in immediate danger, prioritize safety instructions

${context ? `Additional context from operator: ${context}` : ''}${threadContext}`

    const classification = classifyQuery(citizenMessage)
    const response = await chatCompletion({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Draft a reply to this citizen message:\n\n"${citizenMessage.slice(0, 2000)}"` },
      ],
      maxTokens: 1024,
      temperature: 0.6,
      classification,
    } as any)

    res.json({
      draft: response.content,
      model: response.model,
      provider: response.provider,
      tokensUsed: response.tokensUsed,
      latencyMs: response.latencyMs,
      isLocal: response.provider?.startsWith('ollama') || false,
    })
  } catch (err: any) {
    logger.error({ err }, '[AdminAI] Draft reply failed')
    next(err)
  }
})

export default router
