/**
 * routes/translationRoutes.ts — Translation API
 *
 *   POST /api/translate          — Translate text
 *   GET  /api/translate/languages — List supported languages
 */

import { Router, Request, Response } from 'express'
import { translateText, detectLanguage, SUPPORTED_LANGUAGES } from '../services/translationService.js'

const router = Router()

// POST /api/translate — Translate text
router.post('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const { text, from, to } = req.body

    if (!text || typeof text !== 'string') {
      res.status(400).json({ error: 'text is required' })
      return
    }
    if (!to || typeof to !== 'string') {
      res.status(400).json({ error: 'to (target language code) is required' })
      return
    }

    const result = await translateText(text, from || 'auto', to)
    if (!result) {
      res.status(503).json({ error: 'Translation service temporarily unavailable. Try again shortly.' })
      return
    }

    res.json(result)
  } catch (err: any) {
    console.error('[Translation] Error:', err.message)
    res.status(500).json({ error: 'Translation failed' })
  }
})

// POST /api/translate/detect — Detect language
router.post('/detect', async (req: Request, res: Response): Promise<void> => {
  try {
    const { text } = req.body
    if (!text) {
      res.status(400).json({ error: 'text is required' })
      return
    }
    const lang = await detectLanguage(text)
    res.json({ detectedLanguage: lang })
  } catch (err: any) {
    res.status(500).json({ error: 'Detection failed' })
  }
})

// GET /api/translate/languages — List supported languages
router.get('/languages', (_req: Request, res: Response): void => {
  res.json({ languages: SUPPORTED_LANGUAGES })
})

export default router
