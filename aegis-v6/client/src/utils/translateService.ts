/**
 * translateService.ts — Real-time text translation with server-side API + client fallback.
 *
 * Primary: Server-side /api/translate endpoint (MyMemory + LibreTranslate, DB cache).
 * Fallback: Direct client-side MyMemory API calls if server is unavailable.
 *
 * Includes an in-memory cache so repeated translations aren't re-fetched.
 */

// ─── Cache ───────────────────────────────────────────────────────────────────

const cache = new Map<string, string>()

function cacheKey(text: string, from: string, to: string): string {
  return `${from}|${to}|${text.slice(0, 200)}`
}

// ─── Language codes supported by MyMemory ────────────────────────────────────

export const TRANSLATION_LANGUAGES: Array<{ code: string; name: string }> = [
  { code: 'en', name: 'English' },
  { code: 'es', name: 'Spanish' },
  { code: 'fr', name: 'French' },
  { code: 'de', name: 'German' },
  { code: 'it', name: 'Italian' },
  { code: 'pt', name: 'Portuguese' },
  { code: 'ar', name: 'Arabic' },
  { code: 'zh', name: 'Chinese' },
  { code: 'ja', name: 'Japanese' },
  { code: 'ko', name: 'Korean' },
  { code: 'hi', name: 'Hindi' },
  { code: 'ur', name: 'Urdu' },
  { code: 'bn', name: 'Bengali' },
  { code: 'pl', name: 'Polish' },
  { code: 'ro', name: 'Romanian' },
  { code: 'uk', name: 'Ukrainian' },
  { code: 'ru', name: 'Russian' },
  { code: 'tr', name: 'Turkish' },
  { code: 'nl', name: 'Dutch' },
  { code: 'sv', name: 'Swedish' },
]

const TRANSLATION_CODES = new Set(TRANSLATION_LANGUAGES.map((item) => item.code))

const PROVIDER_CODE_MAP: Record<string, string> = {
  zh: 'zh-CN',
}

/**
 * Normalize a language code for translation (NOT the same as i18n normalize,
 * since translation supports more languages than the UI).
 */
function normalizeTranslationCode(value?: string): string {
  if (!value) return 'en'
  const normalized = String(value).trim().toLowerCase().replace('_', '-')
  const base = normalized.split('-')[0]
  if (TRANSLATION_CODES.has(normalized)) return normalized
  if (TRANSLATION_CODES.has(base)) return base
  return 'en'
}

function looksLikeTranslationError(text?: string): boolean {
  if (!text) return true
  return /invalid language pair|please select two distinct languages|example: langpair=/i.test(text)
}

function normalizeForProvider(code: string): string {
  return PROVIDER_CODE_MAP[code] || code
}

function normalizeText(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ')
}

function isRealTranslation(source: string, translated?: string): boolean {
  if (!translated) return false
  if (looksLikeTranslationError(translated)) return false
  return normalizeText(source) !== normalizeText(translated)
}

// ─── Translation function ────────────────────────────────────────────────────

/**
 * Translate text using the MyMemory API.
 *
 * @param text - Source text to translate (max 500 chars per request)
 * @param sourceLang - Source language code (e.g. 'en', 'auto' for detection)
 * @param targetLang - Target language code (e.g. 'fr')
 * @returns Translated text, or original text on error
 */
export async function translateText(
  text: string,
  sourceLang: string = 'en',
  targetLang: string = 'en',
): Promise<{ translatedText: string; detectedLang?: string; match?: number }> {
  // Use our own normalizer (supports all 20 translation languages, not just i18n's 9)
  const normalizedTarget = normalizeTranslationCode(targetLang)
  let from = sourceLang === 'auto' ? 'auto' : normalizeTranslationCode(sourceLang)
  const to = normalizedTarget

  // Skip if empty text
  if (!text.trim()) {
    return { translatedText: text }
  }

  // If source is 'auto', detect language first (MyMemory needs explicit source)
  if (from === 'auto') {
    try {
      const detected = await detectLanguage(text)
      from = normalizeTranslationCode(detected)
    } catch {
      from = 'en' // fallback 
    }
  }

  // Skip if same language after detection
  if (from === to) {
    return { translatedText: text, detectedLang: from }
  }

  // Check cache
  const key = cacheKey(text, from, to)
  const cached = cache.get(key)
  if (cached) return { translatedText: cached, detectedLang: from, match: 1 }

  try {
    // Try server-side translation API first (has multi-provider + DB caching)
    try {
      const serverRes = await fetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: text.slice(0, 500), from, to }),
      })
      if (serverRes.ok) {
        const serverData = await serverRes.json()
        if (isRealTranslation(text, serverData.translatedText)) {
          cache.set(key, serverData.translatedText)
          return {
            translatedText: serverData.translatedText,
            detectedLang: serverData.detectedLanguage || from,
            match: 1,
          }
        }
      }
    } catch {
      // Server API unavailable — fall through to client-side
    }

    // Fallback: MyMemory API directly from client (always use explicit from|to pair)
    const encoded = encodeURIComponent(text.slice(0, 500))
    const langPair = `${normalizeForProvider(from)}|${normalizeForProvider(to)}`
    const url = `https://api.mymemory.translated.net/get?q=${encoded}&langpair=${langPair}`

    const res = await fetch(url)
    if (!res.ok) throw new Error(`Translation API returned ${res.status}`)

    const data = await res.json()

    if (data.responseStatus === 200 && isRealTranslation(text, data.responseData?.translatedText)) {
      const translated = data.responseData.translatedText
      const match = data.responseData.match ?? undefined
      const detected = data.responseData.detectedLanguage ?? from

      // Cache the result
      cache.set(key, translated)

      return {
        translatedText: translated,
        detectedLang: detected,
        match,
      }
    }

    // API returned an error message
    throw new Error(data.responseDetails || 'Translation failed')
  } catch (err) {
    console.warn('[Translate] Error:', err)
    return { translatedText: text }
  }
}

/**
 * Detect the language of a text using server-side API, falling back to MyMemory.
 */
export async function detectLanguage(text: string): Promise<string> {
  try {
    // Try server-side detection first
    try {
      const serverRes = await fetch('/api/translate/detect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: text.slice(0, 200) }),
      })
      if (serverRes.ok) {
        const serverData = await serverRes.json()
        if (serverData.detectedLanguage) return serverData.detectedLanguage
      }
    } catch {
      // Server unavailable — fall through
    }

    // Fallback: MyMemory detect via en→fr translation (API returns detectedLanguage)
    const encoded = encodeURIComponent(text.slice(0, 200))
    const url = `https://api.mymemory.translated.net/get?q=${encoded}&langpair=en|fr`
    const res = await fetch(url)
    if (!res.ok) return 'en'
    const data = await res.json()
    return data.responseData?.detectedLanguage || 'en'
  } catch {
    return 'en'
  }
}

/**
 * Clear the translation cache (useful when changing target language).
 */
export function clearTranslationCache(): void {
  cache.clear()
}
