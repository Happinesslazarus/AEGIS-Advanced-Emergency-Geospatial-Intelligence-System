/**
 * translationService.ts — Server-side translation via MyMemory and LibreTranslate APIs
 *
 * Features:
 *   - Multi-provider fallback: MyMemory → LibreTranslate (free instances) → null
 *   - Language detection from MyMemory
 *   - In-memory + optional database cache (translations_cache table)
 *   - Rate limiting: max 10 calls per minute per provider
 *   - Thread-safe caching with content hash keys
 */

import pool from '../models/db.js'

// ═══════════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════════

export interface TranslationResult {
  translatedText: string
  detectedLanguage?: string
  provider: string
  cached: boolean
}

export interface SupportedLanguage {
  code: string
  name: string
}

// ═══════════════════════════════════════════════════════════════════════════════
// Supported Languages
// ═══════════════════════════════════════════════════════════════════════════════

export const SUPPORTED_LANGUAGES: SupportedLanguage[] = [
  { code: 'en', name: 'English' },
  { code: 'cy', name: 'Welsh' },
  { code: 'gd', name: 'Scottish Gaelic' },
  { code: 'fr', name: 'French' },
  { code: 'es', name: 'Spanish' },
  { code: 'de', name: 'German' },
  { code: 'it', name: 'Italian' },
  { code: 'pt', name: 'Portuguese' },
  { code: 'pl', name: 'Polish' },
  { code: 'ro', name: 'Romanian' },
  { code: 'ar', name: 'Arabic' },
  { code: 'ur', name: 'Urdu' },
  { code: 'hi', name: 'Hindi' },
  { code: 'zh', name: 'Chinese' },
  { code: 'bn', name: 'Bengali' },
  { code: 'ja', name: 'Japanese' },
  { code: 'ko', name: 'Korean' },
  { code: 'uk', name: 'Ukrainian' },
  { code: 'ru', name: 'Russian' },
  { code: 'tr', name: 'Turkish' },
  { code: 'nl', name: 'Dutch' },
  { code: 'sv', name: 'Swedish' },
]

const SUPPORTED_CODES = new Set(SUPPORTED_LANGUAGES.map((item) => item.code))

function looksLikeTranslationError(text?: string): boolean {
  if (!text) return true
  return /invalid language pair|please select two distinct languages|example: langpair=/i.test(text)
}

function normalizeLangCode(value?: string): string {
  if (!value) return 'en'
  const normalized = String(value).trim().toLowerCase().replace('_', '-')
  const base = normalized.split('-')[0]
  return SUPPORTED_CODES.has(base) ? base : 'en'
}

// ═══════════════════════════════════════════════════════════════════════════════
// In-Memory Cache
// ═══════════════════════════════════════════════════════════════════════════════

const memoryCache = new Map<string, { text: string; detectedLang?: string; provider: string; expiry: number }>()
const CACHE_TTL = 3600_000 // 1 hour

function cacheKey(text: string, from: string, to: string): string {
  return `${from}:${to}:${text.slice(0, 500)}`
}

function getFromCache(text: string, from: string, to: string): TranslationResult | null {
  const key = cacheKey(text, from, to)
  const entry = memoryCache.get(key)
  if (entry && entry.expiry > Date.now()) {
    return { translatedText: entry.text, detectedLanguage: entry.detectedLang, provider: entry.provider, cached: true }
  }
  if (entry) memoryCache.delete(key)
  return null
}

function setInCache(text: string, from: string, to: string, translated: string, detectedLang: string | undefined, provider: string): void {
  const key = cacheKey(text, from, to)
  memoryCache.set(key, { text: translated, detectedLang: detectedLang, provider, expiry: Date.now() + CACHE_TTL })
  // Evict if cache too large
  if (memoryCache.size > 5000) {
    const oldestKey = memoryCache.keys().next().value
    if (oldestKey) memoryCache.delete(oldestKey)
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Rate Limiting
// ═══════════════════════════════════════════════════════════════════════════════

const rateLimits: Record<string, { count: number; resetAt: number }> = {}
const MAX_CALLS_PER_MIN = 10

function checkRateLimit(provider: string): boolean {
  const now = Date.now()
  const rl = rateLimits[provider]
  if (!rl || rl.resetAt < now) {
    rateLimits[provider] = { count: 1, resetAt: now + 60_000 }
    return true
  }
  if (rl.count >= MAX_CALLS_PER_MIN) return false
  rl.count++
  return true
}

// ═══════════════════════════════════════════════════════════════════════════════
// Database Cache (optional — table may not exist)
// ═══════════════════════════════════════════════════════════════════════════════

async function getFromDbCache(text: string, from: string, to: string): Promise<TranslationResult | null> {
  try {
    const result = await pool.query(
      `SELECT translated_text, detected_language, provider FROM translations_cache
       WHERE source_text = $1 AND source_lang = $2 AND target_lang = $3
       AND created_at > NOW() - INTERVAL '24 hours'
       LIMIT 1`,
      [text.slice(0, 2000), from, to]
    )
    if (result.rows[0]) {
      const row = result.rows[0]
      // Also populate memory cache
      setInCache(text, from, to, row.translated_text, row.detected_language, row.provider)
      return { translatedText: row.translated_text, detectedLanguage: row.detected_language, provider: row.provider, cached: true }
    }
    return null
  } catch {
    // Table may not exist — that's fine
    return null
  }
}

async function saveToDbCache(text: string, from: string, to: string, translated: string, detectedLang: string | undefined, provider: string): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO translations_cache (source_text, source_lang, target_lang, translated_text, detected_language, provider)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (source_text, source_lang, target_lang) DO UPDATE SET
         translated_text = $4, detected_language = $5, provider = $6, created_at = NOW()`,
      [text.slice(0, 2000), from, to, translated.slice(0, 5000), detectedLang || null, provider]
    )
  } catch {
    // Table may not exist — silently skip
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Provider: MyMemory (free API, no key required)
// ═══════════════════════════════════════════════════════════════════════════════

async function translateWithMyMemory(text: string, from: string, to: string): Promise<{ translated: string; detected?: string } | null> {
  if (!checkRateLimit('mymemory')) return null

  try {
    const langPair = `${from === 'auto' ? '' : from}|${to}`
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text.slice(0, 500))}&langpair=${encodeURIComponent(langPair)}`

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 8000)

    const response = await fetch(url, { signal: controller.signal })
    clearTimeout(timeout)

    if (!response.ok) return null

    const data = await response.json()
    if (data?.responseData?.translatedText && !looksLikeTranslationError(data.responseData.translatedText)) {
      const detected = data.responseData?.detectedLanguage
      return {
        translated: data.responseData.translatedText,
        detected: detected || undefined,
      }
    }
    return null
  } catch {
    return null
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Provider: LibreTranslate (free instance)
// ═══════════════════════════════════════════════════════════════════════════════

const LIBRE_INSTANCES = [
  'https://libretranslate.de',
  'https://translate.argosopentech.com',
]

async function translateWithLibreTranslate(text: string, from: string, to: string): Promise<{ translated: string; detected?: string } | null> {
  if (!checkRateLimit('libretranslate')) return null

  for (const baseUrl of LIBRE_INSTANCES) {
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 8000)

      const response = await fetch(`${baseUrl}/translate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          q: text.slice(0, 1000),
          source: from === 'auto' ? 'auto' : from,
          target: to,
        }),
        signal: controller.signal,
      })
      clearTimeout(timeout)

      if (!response.ok) continue

      const data = await response.json()
      if (data?.translatedText) {
        return {
          translated: data.translatedText,
          detected: data.detectedLanguage?.language || undefined,
        }
      }
    } catch {
      continue
    }
  }
  return null
}

// ═══════════════════════════════════════════════════════════════════════════════
// Main Translation Function
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Translate text with multi-provider fallback and caching.
 *
 * @param text     - Source text to translate
 * @param from     - Source language code ('auto' for detection)
 * @param to       - Target language code
 * @returns        - Translation result or null if all providers fail
 */
export async function translateText(text: string, from: string = 'auto', to: string = 'en'): Promise<TranslationResult | null> {
  if (!text?.trim()) return null
  const normalizedTo = normalizeLangCode(to)
  const normalizedFrom = from === 'auto' ? 'auto' : normalizeLangCode(from)
  if (normalizedFrom === normalizedTo && normalizedFrom !== 'auto') {
    return { translatedText: text, provider: 'passthrough', cached: false }
  }

  // 1. Memory cache
  const memHit = getFromCache(text, normalizedFrom, normalizedTo)
  if (memHit) return memHit

  // 2. Database cache
  const dbHit = await getFromDbCache(text, normalizedFrom, normalizedTo)
  if (dbHit) return dbHit

  // 3. MyMemory
  const myMemoryResult = await translateWithMyMemory(text, normalizedFrom, normalizedTo)
  if (myMemoryResult) {
    setInCache(text, normalizedFrom, normalizedTo, myMemoryResult.translated, myMemoryResult.detected, 'mymemory')
    saveToDbCache(text, normalizedFrom, normalizedTo, myMemoryResult.translated, myMemoryResult.detected, 'mymemory').catch(() => {})
    return { translatedText: myMemoryResult.translated, detectedLanguage: myMemoryResult.detected, provider: 'mymemory', cached: false }
  }

  // 4. LibreTranslate
  const libreResult = await translateWithLibreTranslate(text, normalizedFrom, normalizedTo)
  if (libreResult) {
    setInCache(text, normalizedFrom, normalizedTo, libreResult.translated, libreResult.detected, 'libretranslate')
    saveToDbCache(text, normalizedFrom, normalizedTo, libreResult.translated, libreResult.detected, 'libretranslate').catch(() => {})
    return { translatedText: libreResult.translated, detectedLanguage: libreResult.detected, provider: 'libretranslate', cached: false }
  }

  return null
}

/**
 * Detect the language of the given text.
 */
export async function detectLanguage(text: string): Promise<string | null> {
  if (!text?.trim()) return null

  try {
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text.slice(0, 200))}&langpair=autodetect|en`
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5000)
    const response = await fetch(url, { signal: controller.signal })
    clearTimeout(timeout)

    if (!response.ok) return null
    const data = await response.json()
    return data?.responseData?.detectedLanguage || null
  } catch {
    return null
  }
}
