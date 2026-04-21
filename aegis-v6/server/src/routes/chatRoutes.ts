/**
 * Wires up the citizen-facing AI chatbot API. Authentication is optional:
 * anonymous users can ask questions, and signed-in users get persistent
 * chat sessions stored in the database. Supports both standard (JSON) and
 * streaming (SSE) responses. Rate-limited per user/IP without auth middleware
 * so it doesn't reject anonymous callers.
 *
 * - Mounted at /api/chat in server/src/index.ts
 * - Delegates message processing to server/src/services/chatService.ts
 * - chatService calls server/src/services/llmRouter.ts to pick the LLM provider
 * - Session data is persisted to the chat_sessions & chat_messages tables in PostgreSQL
 * - SSE streaming responses write directly to the response stream (no queue)
 * - Client UI: client/src/components/Chatbot.tsx (or FloatingChatWidget) sends POST /api/chat
 *
 * POST /api/chat          -- Send a message, receive an AI reply (JSON)
 * POST /api/chat/stream   -- Same, but streamed character-by-character (SSE)
 * GET  /api/chat/sessions -- List authenticated user's past chat sessions
 * GET  /api/chat/:id      -- Fetch message history for a specific session
 * GET  /api/chat/status   -- LLM provider health and availability
 * POST /api/chat/:id/end  -- Close and summarise a session
 *
 * - server/src/services/chatService.ts   -- where messages are stored and AI response built
 * - server/src/services/llmRouter.ts     -- picks Gemini/Groq/OpenRouter/Ollama at runtime
 * - server/src/services/chatPromptBuilder.ts -- shapes the prompt sent to the LLM
 * - server/src/middleware/validate.ts    -- chatMessageSchema validates message length/content
 * */

import { Router, Request, Response, NextFunction } from 'express'
import multer from 'multer'
import path from 'path'
import fs from 'fs'
import Tesseract from 'tesseract.js'
import { processChat, processChatStream, getChatHistory, listSessions, verifySessionOwnership, getChatSessionBudget, endChatSession } from '../services/chatService.js'
import { getProviderStatus } from '../services/llmRouter.js'
import { validate, chatMessageSchema } from '../middleware/validate.js'
import { verifyToken } from '../middleware/auth.js'
import { AppError } from '../utils/AppError.js'
import { sseConnectionsActive, chatStreamTotal, chatStreamLatency } from '../services/metrics.js'
import { logger } from '../services/logger.js'
import pool from '../models/db.js'

const router = Router()

//Per-user/IP rate limiting for chat endpoints
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

//Cleanup stale rate limit entries every 5 minutes
setInterval(() => {
  const now = Date.now()
  for (const [key, entry] of chatRateLimits) {
    if (now - entry.windowStart >= CHAT_RATE_WINDOW * 2) chatRateLimits.delete(key)
  }
}, 300_000)

/**
 * Extract user from token if present (optional auth).
 * Doesn't reject unauthenticated requests -- just returns null.
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
    //Invalid token -- treat as anonymous
  }
  return null
}

/**
 * POST /api/chat -- Send a message to the AI chatbot
 *
 * Body: { message: string, sessionId?: string }
 * Returns: { sessionId, reply, model, tokensUsed, toolsUsed, sources, safetyFlags }
 */
router.post('/', validate(chatMessageSchema), async (req: Request, res: Response, next: NextFunction) => {
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
})

/**
 * POST /api/chat/upload-image -- Upload an image for AI analysis in chat
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
    const rand = crypto.randomUUID().replace(/-/g, '').substring(0, 8)
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
})

/**
 * POST /api/chat/upload-file -- Upload a document (PDF, CSV, TXT) for contextual analysis
 * Extracts text content from the file so the chatbot can reason over it.
 * Accepts: PDF, CSV, TXT, JSON, Markdown (max 5MB)
 */
const chatFileStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, chatUploadDir),
  filename: (_req, file, cb) => {
    const ts = Date.now()
    const rand = crypto.randomUUID().replace(/-/g, '').substring(0, 8)
    const ext = path.extname(file.originalname).toLowerCase()
    cb(null, `${ts}-${rand}${ext}`)
  },
})

const chatFileUpload = multer({
  storage: chatFileStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = [
      'text/plain', 'text/csv', 'text/markdown',
      'application/pdf', 'application/json',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ]
    const extAllowed = ['.txt', '.csv', '.md', '.pdf', '.json', '.xlsx', '.xls']
    const ext = path.extname(file.originalname).toLowerCase()
    if (!allowed.includes(file.mimetype) && !extAllowed.includes(ext)) {
      return cb(new Error('Supported files: PDF, CSV, TXT, JSON, Markdown, Excel'))
    }
    cb(null, true)
  },
})

router.post('/upload-file', chatFileUpload.single('file'), async (req: Request, res: Response, next: NextFunction) => {
    if (!req.file) {
      throw AppError.badRequest('No file provided')
    }
    const filePath = req.file.path
    const ext = path.extname(req.file.originalname).toLowerCase()
    let extractedText = ''

    if (ext === '.pdf') {
      const buffer = fs.readFileSync(filePath)
      let rawText = ''
      let pageCount = 0

      //Quality gate
      const isGarbageText = (text: string, pages: number): boolean => {
        if (text.length < 30) return true
        const readable = (text.match(/[a-zA-Z0-9\s.,;:!?'"()\-\u00C0-\u024F]/g) || []).length
        if (readable / text.length < 0.4) return true
        const tokens = text.match(/\S+/g) || []
        if (tokens.length > 0 && tokens.filter(t => t.length <= 2).length / tokens.length > 0.55) return true
        if ((text.match(/[a-zA-Z]{4,}/g) || []).length < 10 * Math.max(pages, 1)) return true
        return false
      }

      //Strategy 1: pdfjs-dist text layer (no canvas -- pure text extraction)
      //Handles embedded-font PDFs that pdf-parse / BT-ET extraction can't read
      try {
        const { pathToFileURL } = await import('node:url')
        const { resolve } = await import('node:path')

        const pdfjsDistPath = pathToFileURL(resolve(process.cwd(),
          'node_modules/pdf-to-png-converter/node_modules/pdfjs-dist/legacy/build/pdf.mjs'
        )).href
        const pdfjsWorkerPath = pathToFileURL(resolve(process.cwd(),
          'node_modules/pdf-to-png-converter/node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs'
        )).href

        const { getDocument, GlobalWorkerOptions } = await import(pdfjsDistPath) as any

        GlobalWorkerOptions.workerSrc = pdfjsWorkerPath

        const cmapUrl = pathToFileURL(resolve(process.cwd(),
          'node_modules/pdf-to-png-converter/node_modules/pdfjs-dist/cmaps/'
        )).href + '/'
        const fontUrl = pathToFileURL(resolve(process.cwd(),
          'node_modules/pdf-to-png-converter/node_modules/pdfjs-dist/standard_fonts/'
        )).href + '/'

        const data = new Uint8Array(buffer)
        const doc = await getDocument({
          data, cMapUrl: cmapUrl, cMapPacked: true,
          standardFontDataUrl: fontUrl, disableFontFace: true,
        }).promise

        pageCount = doc.numPages

        const MAX_EXTRACT_PAGES = 50
        const textParts: string[] = []
        for (let i = 1; i <= Math.min(pageCount, MAX_EXTRACT_PAGES); i++) {
          const page = await doc.getPage(i)
          const tc = await page.getTextContent()
          const pageText = (tc.items as any[])
            .map((item: any) => item.str || '')
            .join(' ')
            .replace(/\s+/g, ' ')
            .trim()
          if (pageText.length > 0) textParts.push(pageText)
        }
        rawText = textParts.join('\n\n')
      } catch (pdfjsErr: any) {
        logger.warn({ err: pdfjsErr?.message }, 'pdfjs text extraction failed')
      }

      //Strategy 2: OCR (scanned / image-based PDFs where text layer is empty)
      if (rawText.length < 30 || isGarbageText(rawText, pageCount)) {
        logger.info('PDF text layer empty -- falling back to OCR')
        const MAX_OCR_PAGES = 8

        try {
          const worker = await Tesseract.createWorker('eng', 1, {
            cachePath: path.join(process.cwd(), '.tesseract-cache'),
            logger: () => {},
          })

          const totalPages = Math.min(pageCount || MAX_OCR_PAGES, MAX_OCR_PAGES)
          const ocrParts: string[] = []

          for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
            try {
              const rendered = await (await import('pdf-to-png-converter')).pdfToPng(filePath, {
                disableFontFace: true,
                useSystemFonts: false,
                viewportScale: 1.5,
                pagesToProcess: [pageNum],
                concurrencyLimit: 1,
              })
              if (rendered[0]?.content) {
                const { data } = await worker.recognize(rendered[0].content)
                if (data.text.trim()) ocrParts.push(data.text.trim())
              }
            } catch {
              //skip unrenderable pages
            }
          }

          await worker.terminate()
          rawText = ocrParts.join('\n\n---\n\n')
          if (pageCount > MAX_OCR_PAGES) {
            rawText += `\n\n[Note: Only the first ${MAX_OCR_PAGES} of ${pageCount} pages were OCR-processed.]`
          }
        } catch (ocrErr: any) {
          logger.warn({ err: ocrErr?.message }, 'OCR fallback failed')
        }
      }

      //Decide what to send the LLM
      if (rawText.length > 30 && !isGarbageText(rawText, pageCount)) {
        extractedText = rawText.slice(0, 50000)
      } else {
        extractedText = [
          '[This PDF appears to be image-based, scanned, or uses embedded fonts that prevent text extraction.',
          `It has ${pageCount} page${pageCount === 1 ? '' : 's'} but no readable text could be recovered.`,
          '',
          'What you can do:',
          '- Describe what the document contains and I will help you work with it',
          '- Take a screenshot and upload the image (📷) for visual analysis',
          '- If this is a typed document, re-export it as a text-based PDF from the original app',
          '- Paste key sections as plain text in the chat]',
        ].join('\n')
      }
    } else if (['.csv', '.txt', '.md', '.json'].includes(ext)) {
      extractedText = fs.readFileSync(filePath, 'utf-8').slice(0, 50000)
    } else if (['.xlsx', '.xls'].includes(ext)) {
      //Basic CSV-like output for Excel -- just read as buffer for now
      extractedText = '[Excel file uploaded -- please describe the data you want analyzed]'
    }

    //Limit total size to prevent overwhelming the LLM context
    if (extractedText.length > 50000) {
      extractedText = extractedText.slice(0, 50000) + '\n\n[...truncated -- file too large for full analysis]'
    }

    res.json({
      success: true,
      filename: req.file.originalname,
      size: req.file.size,
      mimetype: req.file.mimetype,
      extractedText,
      charCount: extractedText.length,
    })
})

/**
 * POST /api/chat/stream -- Stream chat tokens with SSE
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
  const { message, fileContent, sessionId, preferredProvider, language } = req.body
  //fileContent is sent separately by doc uploads to avoid message length issues;
  //merge it back so the rest of the pipeline sees one unified message.
  const fullMessage = fileContent ? `${message}\n\n${fileContent}` : message
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

    //Silently absorb write errors (EPIPE) that occur when a client disconnects
    //mid-stream. Node.js 18+ fires req 'close' on normal request completion too,
    //so we guard writes with res.writableEnded instead of a clientClosed flag.
    res.on('error', () => { /* client disconnected */ })

  req.on('close', () => {
    sseConnectionsActive.dec()
  })

  try {
    writeEvent('start', { ok: true })

    const result = await processChatStream(
      {
        message: fullMessage,
        sessionId,
        language: typeof language === 'string' ? language : undefined,
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

    //Audit trail: persist admin chat interactions for accountability.
    //Every operator message + AI response pair is written to audit_logs so
    //administrators' use of the Command AI is reviewable and non-repudiable.
    if (user?.type === 'operator' && result.sessionId) {
      pool.query(
        `INSERT INTO audit_logs
           (operator_id, operator_name, action, action_type, target_type, target_id,
            after_state, created_at)
         VALUES ($1, $2, $3, 'ai_chat', 'chat_session', $4, $5, NOW())`,
        [
          user.id,
          null, // operator_name resolved by caller context; null is acceptable
          `Admin AI chat: "${fullMessage.slice(0, 120)}${fullMessage.length > 120 ? '...' : ''}"`,
          result.sessionId,
          JSON.stringify({
            model: result.model,
            tokens: result.tokensUsed,
            tools: result.toolsUsed,
            quality: result.qualityScore,
          }),
        ],
      ).catch((err: Error) => logger.warn({ err }, '[Chat] Admin audit log write failed (non-fatal)'))
    }
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
 * GET /api/chat/sessions -- List authenticated user's chat sessions
 */
router.get('/sessions', async (req: Request, res: Response, next: NextFunction) => {
  const user = optionalAuth(req)
  if (!user) {
    throw AppError.unauthorized('Authentication required to view chat sessions.')
  }

    const sessions = await listSessions(user.id, user.type)
    res.json({ sessions })
})

/**
 * GET /api/chat/status -- LLM provider health information
 * (Public endpoint for transparency dashboard)
 */
router.get('/status', async (_req: Request, res: Response, next: NextFunction) => {
    const status = getProviderStatus()
    res.json({
      providers: status,
      preferred: status.find((s) => !s.rateLimited && !s.backedOff)?.name || null,
    })
})

/**
 * GET /api/chat/:id/budget -- Session token budget state
 */
router.get('/:id/budget', async (req: Request, res: Response, next: NextFunction) => {
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
})

/**
 * GET /api/chat/:id -- Get message history for a session
 * SECURITY: Requires authentication and ownership verification
 */
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
    const user = optionalAuth(req)
    
    //Require authentication for chat history access
    if (!user) {
      throw AppError.unauthorized('Authentication required to view chat history.')
    }
    
    //Verify ownership of the session
    const isOwner = await verifySessionOwnership(req.params.id, user.id, user.type)
    if (!isOwner) {
      throw AppError.forbidden('Access denied. You do not own this chat session.')
    }
    
    const messages = await getChatHistory(req.params.id)
    res.json({ messages })
})

/**
 * POST /api/chat/sessions/:id/end -- End and summarize a chat session
 * Called when user closes the chatbot to trigger auto-summarization
 */
router.post('/sessions/:id/end', async (req: Request, res: Response, next: NextFunction) => {
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
})

/**
 * POST /api/chat/feedback -- Submit feedback on a chat message
 * Body: { messageId: string, rating: 'up' | 'down', sessionId?: string }
 */
router.post('/feedback', async (req: Request, res: Response, next: NextFunction) => {
    const { messageId, rating, sessionId } = req.body
    if (!messageId || !['up', 'down'].includes(rating)) {
      return res.status(400).json({ error: 'messageId and rating (up/down) required' })
    }

    //Update cache boost score based on feedback
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
      //Best-effort cache update
    }

    logger.info({ messageId, rating, sessionId }, '[Chat] Feedback received')
    res.json({ ok: true })
})

export default router
