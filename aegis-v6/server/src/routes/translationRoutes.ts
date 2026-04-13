/**
 * File: translationRoutes.ts
 *
 * What this file does:
 * API for translating text between the 9 supported languages.
 * Supports single text, batch translation, and language detection.
 *
 * How it connects:
 * - Mounted at /api/translate in index.ts
 * - Uses translationService which routes to Azure, DeepL, or LibreTranslate
 * - Called by the frontend LanguageSelector component
 *
 * Simple explanation:
 * Translates text so the platform works in multiple languages.
 */
import { Router, Request, Response, NextFunction } from 'express'
import rateLimit from 'express-rate-limit'
import {
  translateText,
  translateTexts,
  detectLanguage,
  SUPPORTED_LANGUAGES,
  MAX_TRANSLATION_BATCH_CHARACTERS,
  MAX_TRANSLATION_BATCH_ITEMS,
  MAX_TRANSLATION_TEXT_LENGTH,
} from '../services/translationService.js'
import { AppError } from '../utils/AppError.js'

const router = Router()
const translateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  message: { error: 'Too many translation requests. Please try again shortly.' },
  standardHeaders: true,
  legacyHeaders: false,
})
const batchTranslateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { error: 'Too many batch translation requests. Please try again shortly.' },
  standardHeaders: true,
  legacyHeaders: false,
})
const detectLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: { error: 'Too many language-detection requests. Please try again shortly.' },
  standardHeaders: true,
  legacyHeaders: false,
})

router.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, private, max-age=0')
  res.setHeader('Pragma', 'no-cache')
  next()
})

function getTextTooLargeError(text: string): string | null {
  return text.trim().length > MAX_TRANSLATION_TEXT_LENGTH
    ? `text must be ${MAX_TRANSLATION_TEXT_LENGTH} characters or fewer`
    : null
}

function getSingleTextRequest(req: Request): { text: string; sourceLanguage: string; targetLanguage: string } | null {
  const input = req.method === 'GET' ? req.query : req.body
  const text = typeof input.text === 'string' ? input.text : ''
  const targetLanguage = typeof input.targetLanguage === 'string'
    ? input.targetLanguage
    : typeof input.target === 'string'
      ? input.target
      : typeof input.to === 'string'
        ? input.to
        : ''
  const sourceLanguage = typeof input.sourceLanguage === 'string'
    ? input.sourceLanguage
    : typeof input.source === 'string'
      ? input.source
      : typeof input.from === 'string'
        ? input.from
        : 'auto'

  if (!text.trim() || !targetLanguage.trim()) return null
  return { text, sourceLanguage, targetLanguage }
}

router.get('/', translateLimiter, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const payload = getSingleTextRequest(req)
    if (!payload) {
      throw AppError.badRequest('text and target language are required')
    }

    const lengthError = getTextTooLargeError(payload.text)
    if (lengthError) {
      res.status(413).json({ error: lengthError })
      return
    }

    res.json(await translateText(payload.text, payload.targetLanguage, payload.sourceLanguage))
  } catch (err) {
    next(err)
  }
})

router.post('/', translateLimiter, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const payload = getSingleTextRequest(req)
    if (!payload) {
      throw AppError.badRequest('text and target language are required')
    }

    const lengthError = getTextTooLargeError(payload.text)
    if (lengthError) {
      res.status(413).json({ error: lengthError })
      return
    }

    res.json(await translateText(payload.text, payload.targetLanguage, payload.sourceLanguage))
  } catch (err) {
    next(err)
  }
})

router.post('/batch', batchTranslateLimiter, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const texts: string[] = Array.isArray(req.body?.texts)
      ? req.body.texts.filter((value: unknown): value is string => typeof value === 'string')
      : []
    const targetLanguage = typeof req.body?.targetLanguage === 'string'
      ? req.body.targetLanguage
      : typeof req.body?.target === 'string'
        ? req.body.target
        : ''
    const sourceLanguage = typeof req.body?.sourceLanguage === 'string'
      ? req.body.sourceLanguage
      : typeof req.body?.source === 'string'
        ? req.body.source
        : 'auto'

    if (texts.length === 0 || !targetLanguage.trim()) {
      throw AppError.badRequest('texts and target language are required')
    }

    if (texts.length > MAX_TRANSLATION_BATCH_ITEMS) {
      throw AppError.badRequest(`batch requests are limited to ${MAX_TRANSLATION_BATCH_ITEMS} texts`)
    }

    const oversized = texts.find((text: string) => text.trim().length > MAX_TRANSLATION_TEXT_LENGTH)
    if (oversized) {
      throw AppError.payloadTooLarge(`each text must be ${MAX_TRANSLATION_TEXT_LENGTH} characters or fewer`)
    }

    const totalCharacters = texts.reduce((sum: number, text: string) => sum + text.trim().length, 0)
    if (totalCharacters > MAX_TRANSLATION_BATCH_CHARACTERS) {
      throw AppError.payloadTooLarge(`batch requests are limited to ${MAX_TRANSLATION_BATCH_CHARACTERS} total characters`)
    }

    const translations = await translateTexts(texts, targetLanguage, sourceLanguage)
    res.json({ translations })
  } catch (err) {
    next(err)
  }
})

router.post('/detect', detectLimiter, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const text = typeof req.body?.text === 'string' ? req.body.text : ''
    if (!text.trim()) {
      throw AppError.badRequest('text is required')
    }
    const lengthError = getTextTooLargeError(text)
    if (lengthError) {
      res.status(413).json({ error: lengthError })
      return
    }
    res.json({ detectedLanguage: await detectLanguage(text) })
  } catch (err) {
    next(err)
  }
})

router.get('/languages', (_req: Request, res: Response): void => {
  res.json({ languages: SUPPORTED_LANGUAGES })
})

export default router
