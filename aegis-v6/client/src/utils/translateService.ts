/**
 * File: translateService.ts
 *
 * Client-side translation helper that calls the AEGIS translation API,
 * which proxies one of several backends (Azure Translator, DeepL, or LibreTranslate).
 * Includes an in-memory LRU-style cache with a 15-minute TTL to avoid
 * re-translating the same text within a session.
 * Also supports in-flight deduplication: if the same text is being translated
 * concurrently, only one API request is made and all callers share the result.
 *
 * Glossary:
 *   translation API  = POST /api/translate on the AEGIS server;
 *                      the server chooses the provider and returns a unified response
 *   passthrough      = no translation needed (text is already in the target language
 *                      or both source and target are the same); original text is returned
 *   unavailable      = the translation API could not be reached or returned an error;
 *                      original text is returned so the UI never breaks
 *   cache TTL        = Time-To-Live: how long (15 minutes) a cached translation is
 *                      considered fresh before being discarded
 * in-flight map = a Map from cacheKey -> pending Promise; ensures that two
 *                      simultaneous requests for the same text share one HTTP call
 *   cacheKey         = compact string '{source}:{target}:{text}' used as the Map key;
 *                      includes the source language so 'auto' and 'fr' are stored separately
 *   normalise        = standardise: convert language codes to lowercase BCP-47 base tags
 * (e.g. 'en-GB' -> 'en', 'FR' -> 'fr')
 *   BCP-47           = RFC 5646 language tag standard; 'en', 'fr', 'zh' are base tags
 *   batch endpoint   = POST /api/translate/batch; translates multiple texts in one request
 * buildTranslationMap = returns a {original -> translated} lookup object;
 *                         used by pages that need to translate many strings at once
 *
 * How it connects:
 * - Used by client/src/pages/AdminPage.tsx (inline report translation)
 * - Used by client/src/pages/CitizenDashboard.tsx for community content
 * - Calls POST /api/translate and POST /api/translate/batch on the AEGIS server
 * - Server backend: server/src/services/translationService.ts
 */

/** Shape of the response from POST /api/translate and POST /api/translate/batch */
export interface TranslationResponse {
  originalText: string
  translatedText: string
  targetLanguage: string
  sourceLanguage: string | null  // null when 'auto' was specified and detection was skipped
  detectedLanguage?: string      // set by the provider when source was 'auto'
  provider: string               // 'azure' | 'deepl' | 'libretranslate' | 'passthrough' | 'unavailable'
  cached: boolean                // true if the result came from the server's own cache
  available: boolean             // false when the translation service could not be reached
  status: 'translated' | 'passthrough' | 'unavailable'
}

//List of supported translation languages with their BCP-47 codes and English names
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

//Module-level configuration constants

//Set of valid target language codes for fast O(1) membership tests
const TRANSLATION_CODES = new Set(TRANSLATION_LANGUAGES.map((language) => language.code))

//How long (milliseconds) a cached translation stays fresh before being evicted
const CACHE_TTL_MS = 15 * 60 * 1000 // 15 minutes

//In-memory cache and in-flight request tracker

//Stores completed translations keyed by '{source}:{target}:{text}'
const cache = new Map<string, { result: TranslationResponse; expiresAt: number }>()

//Tracks pending fetch promises to deduplicate concurrent identical requests
const inflight = new Map<string, Promise<TranslationResponse>>()

//Normalisation helpers

/**
 * Normalises a target language code to a lowercase BCP-47 base tag.
 * Falls back to 'en' if the code is empty or unrecognised.
 * Examples: 'EN' -> 'en', 'en-GB' -> 'en', 'xx' -> 'en' (fallback)
 */
function normalizeTranslationCode(value?: string, fallback = 'en'): string {
  if (!value) return fallback
 const normalized = String(value).trim().toLowerCase().replace('_', '-') // 'zh_TW' -> 'zh-TW'
  const base = normalized.split('-')[0] // take only the primary language tag ('en', not 'en-GB')
  return TRANSLATION_CODES.has(base) ? base : fallback
}

/**
 * Normalises the source language, preserving the special 'auto' sentinel
 * that tells the provider to detect the source language automatically.
 */
function normalizeSourceLanguage(value?: string): string {
  if (!value) return 'auto'
  return String(value).trim().toLowerCase() === 'auto'
    ? 'auto'
    : normalizeTranslationCode(value, 'auto')
}

/** Trims whitespace from text, converting non-string values to '' */
function trimText(text: string): string {
  return String(text || '').trim()
}

//Result factory helpers

/** Creates a cache key that uniquely identifies a (text, source, target) tuple */
function createCacheKey(text: string, sourceLanguage: string, targetLanguage: string): string {
  return `${sourceLanguage}:${targetLanguage}:${trimText(text)}`
}

/** Returns a passthrough result (no translation needed) with consistent shape */
function createPassthroughResult(text: string, sourceLanguage: string, targetLanguage: string): TranslationResponse {
  return {
    originalText: text,
    translatedText: text,       // unchanged -- source equals target
    targetLanguage,
    sourceLanguage: sourceLanguage === 'auto' ? null : sourceLanguage,
    detectedLanguage: sourceLanguage === 'auto' ? undefined : sourceLanguage,
    provider: 'passthrough',
    cached: false,
    available: true,
    status: 'passthrough',
  }
}

/** Returns an unavailable result when the translation API could not be reached */
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

//Cache read/write helpers

/**
 * Returns a cached translation if one exists and has not expired.
 * Marks the returned result as cached:true so the UI can distinguish API calls.
 */
function getCachedResult(text: string, sourceLanguage: string, targetLanguage: string): TranslationResponse | null {
  const key = createCacheKey(text, sourceLanguage, targetLanguage)
  const entry = cache.get(key)
  if (!entry) return null
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key) // evict expired entry
    return null
  }
  return { ...entry.result, cached: true } // spread so caller gets cached:true without mutating stored value
}

/**
 * Stores a successful translation result with a TTL-based expiry timestamp.
 * The stored record always has cached:false; getCachedResult sets it to true on retrieval.
 */
function setCachedResult(text: string, sourceLanguage: string, targetLanguage: string, result: TranslationResponse): void {
  cache.set(createCacheKey(text, sourceLanguage, targetLanguage), {
    result: { ...result, cached: false },
    expiresAt: Date.now() + CACHE_TTL_MS,
  })
}

/** Only cache successful or passthrough results; don't cache 'unavailable' responses */
function shouldCacheResult(result: TranslationResponse): boolean {
  return result.available || result.status === 'passthrough'
}

//HTTP call

/** Makes the actual POST request to the translation proxy.
 *  Throws on non-200 responses so the caller can handle retries or fallbacks. */
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

//Public API

/**
 * Translates a single piece of text.
 * 
 * Logic:
 *   1. Short-circuit: return passthrough if text is empty
 *   2. Short-circuit: return passthrough if source === target (no work needed)
 *   3. Check in-memory cache; return hit immediately
 *   4. Check in-flight map; if a request for this text is already pending,
 *      return the shared Promise (deduplication)
 *   5. Otherwise start a new fetch, cache the result on success,
 *      and return 'unavailable' on any error
 */
export async function translateText(
  text: string,
  sourceLanguage = 'auto',
  targetLanguage = 'en',
): Promise<TranslationResponse> {
  const trimmed = trimText(text)
  const normalizedTarget = normalizeTranslationCode(targetLanguage, 'en')
  const normalizedSource = normalizeSourceLanguage(sourceLanguage)

  //Empty text -- nothing to translate
  if (!trimmed) return createPassthroughResult('', normalizedSource, normalizedTarget)

  //Source and target are the same known language -- skip the API call
  if (normalizedSource !== 'auto' && normalizedSource === normalizedTarget) {
    return createPassthroughResult(trimmed, normalizedSource, normalizedTarget)
  }

  //Return a cached result if still fresh
  const cached = getCachedResult(trimmed, normalizedSource, normalizedTarget)
  if (cached) return cached

  //Deduplicate: if the same request is already in-flight, share its Promise
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
          inflight.delete(cacheKey) // remove from in-flight map once settled
        }),
    )
  }

  return inflight.get(cacheKey) as Promise<TranslationResponse>
}

/**
 * Translates an array of texts in one batch API call.
 * Cache hits are resolved immediately without a network call.
 * All texts that miss the cache are sent in a single POST to /api/translate/batch.
 * On a batch API failure, every uncached text falls back to createUnavailableResult.
 */
export async function translateTexts(
  texts: string[],
  sourceLanguage = 'auto',
  targetLanguage = 'en',
): Promise<TranslationResponse[]> {
  const normalizedSource = normalizeSourceLanguage(sourceLanguage)
  const normalizedTarget = normalizeTranslationCode(targetLanguage, 'en')
  const trimmedTexts = texts.map((text) => trimText(text))
  const results = new Map<string, TranslationResponse>() // accumulates per-text results
  const uncachedTexts: string[] = []                     // texts that need an API call

  //Resolve cache hits first to minimise the batch request size
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

/**
 * Convenience wrapper that converts translateTexts output into a plain
 * {originalText -> translatedText} lookup object.
 * Only includes texts where translation actually changed the content
 * (skips passthrough and unavailable results where translatedText === originalText).
 */
export async function buildTranslationMap(
  texts: string[],
  sourceLanguage = 'auto',
  targetLanguage = 'en',
): Promise<Record<string, string>> {
  const trimmedTexts = [...new Set(texts.map((text) => trimText(text)).filter(Boolean))]
  if (trimmedTexts.length === 0) return {} // nothing to translate

  const translations = await translateTexts(trimmedTexts, sourceLanguage, targetLanguage)
  return translations.reduce<Record<string, string>>((acc, result, index) => {
    const sourceText = trimmedTexts[index]
    if (!sourceText) return acc
    //Only include entries where the text was actually changed by the provider
    if (result.available && result.translatedText && result.translatedText !== sourceText) {
      acc[sourceText] = result.translatedText
    }
    return acc
  }, {})
}

/** Clears all cached and in-flight translation state.
 *  Used in tests to start with a clean slate; rarely needed in production. */
export function clearTranslationCache(): void {
  cache.clear()
  inflight.clear()
}
