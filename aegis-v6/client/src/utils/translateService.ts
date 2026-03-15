export interface TranslationResponse {
  originalText: string
  translatedText: string
  targetLanguage: string
  sourceLanguage: string | null
  detectedLanguage?: string
  provider: string
  cached: boolean
  available: boolean
  status: 'translated' | 'passthrough' | 'unavailable'
}

export const TRANSLATION_LANGUAGES: Array<{ code: string; name: string }> = [
  { code: 'en', name: 'English' },
  { code: 'ar', name: 'Arabic' },
  { code: 'bn', name: 'Bengali' },
  { code: 'de', name: 'German' },
  { code: 'es', name: 'Spanish' },
  { code: 'fr', name: 'French' },
  { code: 'hi', name: 'Hindi' },
  { code: 'it', name: 'Italian' },
  { code: 'ja', name: 'Japanese' },
  { code: 'ko', name: 'Korean' },
  { code: 'nl', name: 'Dutch' },
  { code: 'pl', name: 'Polish' },
  { code: 'pt', name: 'Portuguese' },
  { code: 'ro', name: 'Romanian' },
  { code: 'ru', name: 'Russian' },
  { code: 'sv', name: 'Swedish' },
  { code: 'sw', name: 'Swahili' },
  { code: 'tr', name: 'Turkish' },
  { code: 'uk', name: 'Ukrainian' },
  { code: 'ur', name: 'Urdu' },
  { code: 'zh', name: 'Chinese' },
]

const TRANSLATION_CODES = new Set(TRANSLATION_LANGUAGES.map((language) => language.code))
const CACHE_TTL_MS = 15 * 60 * 1000

const cache = new Map<string, { result: TranslationResponse; expiresAt: number }>()
const inflight = new Map<string, Promise<TranslationResponse>>()

function normalizeTranslationCode(value?: string, fallback = 'en'): string {
  if (!value) return fallback
  const normalized = String(value).trim().toLowerCase().replace('_', '-')
  const base = normalized.split('-')[0]
  return TRANSLATION_CODES.has(base) ? base : fallback
}

function normalizeSourceLanguage(value?: string): string {
  if (!value) return 'auto'
  return String(value).trim().toLowerCase() === 'auto'
    ? 'auto'
    : normalizeTranslationCode(value, 'auto')
}

function trimText(text: string): string {
  return String(text || '').trim()
}

function createCacheKey(text: string, sourceLanguage: string, targetLanguage: string): string {
  return `${sourceLanguage}:${targetLanguage}:${trimText(text)}`
}

function createPassthroughResult(text: string, sourceLanguage: string, targetLanguage: string): TranslationResponse {
  return {
    originalText: text,
    translatedText: text,
    targetLanguage,
    sourceLanguage: sourceLanguage === 'auto' ? null : sourceLanguage,
    detectedLanguage: sourceLanguage === 'auto' ? undefined : sourceLanguage,
    provider: 'passthrough',
    cached: false,
    available: true,
    status: 'passthrough',
  }
}

function createUnavailableResult(text: string, sourceLanguage: string, targetLanguage: string): TranslationResponse {
  return {
    originalText: text,
    translatedText: text,
    targetLanguage,
    sourceLanguage: sourceLanguage === 'auto' ? null : sourceLanguage,
    provider: 'unavailable',
    cached: false,
    available: false,
    status: 'unavailable',
  }
}

function getCachedResult(text: string, sourceLanguage: string, targetLanguage: string): TranslationResponse | null {
  const key = createCacheKey(text, sourceLanguage, targetLanguage)
  const entry = cache.get(key)
  if (!entry) return null
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key)
    return null
  }
  return { ...entry.result, cached: true }
}

function setCachedResult(text: string, sourceLanguage: string, targetLanguage: string, result: TranslationResponse): void {
  cache.set(createCacheKey(text, sourceLanguage, targetLanguage), {
    result: { ...result, cached: false },
    expiresAt: Date.now() + CACHE_TTL_MS,
  })
}

function shouldCacheResult(result: TranslationResponse): boolean {
  return result.available || result.status === 'passthrough'
}

async function requestTranslation(
  text: string,
  sourceLanguage: string,
  targetLanguage: string,
): Promise<TranslationResponse> {
  const response = await fetch('/api/translate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, sourceLanguage, targetLanguage }),
  })

  if (!response.ok) {
    throw new Error(`Translation API ${response.status}`)
  }

  return response.json()
}

export async function translateText(
  text: string,
  sourceLanguage = 'auto',
  targetLanguage = 'en',
): Promise<TranslationResponse> {
  const trimmed = trimText(text)
  const normalizedTarget = normalizeTranslationCode(targetLanguage, 'en')
  const normalizedSource = normalizeSourceLanguage(sourceLanguage)

  if (!trimmed) return createPassthroughResult('', normalizedSource, normalizedTarget)

  if (normalizedSource !== 'auto' && normalizedSource === normalizedTarget) {
    return createPassthroughResult(trimmed, normalizedSource, normalizedTarget)
  }

  const cached = getCachedResult(trimmed, normalizedSource, normalizedTarget)
  if (cached) return cached

  const cacheKey = createCacheKey(trimmed, normalizedSource, normalizedTarget)
  if (!inflight.has(cacheKey)) {
    inflight.set(
      cacheKey,
      requestTranslation(trimmed, normalizedSource, normalizedTarget)
        .then((result) => {
          if (shouldCacheResult(result)) {
            setCachedResult(trimmed, normalizedSource, normalizedTarget, result)
          }
          return result
        })
        .catch(() => createUnavailableResult(trimmed, normalizedSource, normalizedTarget))
        .finally(() => {
          inflight.delete(cacheKey)
        }),
    )
  }

  return inflight.get(cacheKey) as Promise<TranslationResponse>
}

export async function translateTexts(
  texts: string[],
  sourceLanguage = 'auto',
  targetLanguage = 'en',
): Promise<TranslationResponse[]> {
  const normalizedSource = normalizeSourceLanguage(sourceLanguage)
  const normalizedTarget = normalizeTranslationCode(targetLanguage, 'en')
  const trimmedTexts = texts.map((text) => trimText(text))
  const results = new Map<string, TranslationResponse>()
  const uncachedTexts: string[] = []

  for (const text of [...new Set(trimmedTexts.filter(Boolean))]) {
    const cached = getCachedResult(text, normalizedSource, normalizedTarget)
    if (cached) {
      results.set(text, cached)
    } else {
      uncachedTexts.push(text)
    }
  }

  if (uncachedTexts.length > 0) {
    try {
      const response = await fetch('/api/translate/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          texts: uncachedTexts,
          sourceLanguage: normalizedSource,
          targetLanguage: normalizedTarget,
        }),
      })

      if (!response.ok) throw new Error(`Translation batch API ${response.status}`)

      const data = await response.json()
      const translations = Array.isArray(data?.translations) ? data.translations : []
      translations.forEach((translation: TranslationResponse, index: number) => {
        const sourceText = uncachedTexts[index]
        if (!sourceText) return
        results.set(sourceText, translation)
        if (shouldCacheResult(translation)) {
          setCachedResult(sourceText, normalizedSource, normalizedTarget, translation)
        }
      })
    } catch {
      uncachedTexts.forEach((text) => {
        results.set(text, createUnavailableResult(text, normalizedSource, normalizedTarget))
      })
    }
  }

  return trimmedTexts.map((text) => {
    if (!text) return createPassthroughResult('', normalizedSource, normalizedTarget)
    return results.get(text) || createUnavailableResult(text, normalizedSource, normalizedTarget)
  })
}

export async function buildTranslationMap(
  texts: string[],
  sourceLanguage = 'auto',
  targetLanguage = 'en',
): Promise<Record<string, string>> {
  const trimmedTexts = [...new Set(texts.map((text) => trimText(text)).filter(Boolean))]
  if (trimmedTexts.length === 0) return {}

  const translations = await translateTexts(trimmedTexts, sourceLanguage, targetLanguage)
  return translations.reduce<Record<string, string>>((acc, result, index) => {
    const sourceText = trimmedTexts[index]
    if (!sourceText) return acc
    if (result.available && result.translatedText && result.translatedText !== sourceText) {
      acc[sourceText] = result.translatedText
    }
    return acc
  }, {})
}

export function clearTranslationCache(): void {
  cache.clear()
  inflight.clear()
}
