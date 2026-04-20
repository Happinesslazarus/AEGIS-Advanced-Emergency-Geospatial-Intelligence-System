/**
 * File: dynamicLocaleLoader.ts
 *
 * What this file does:
 * Dynamically loads i18next namespace bundles for any language that is not
 * statically bundled, by calling the AEGIS backend translation microservice.
 *
 * Flow:
 * 1. Flatten the English namespace JSON into leaf { dotPath: "string value" } pairs.
 * 2. Split into batches (≤100 strings, ≤25 000 characters each) to respect the
 *    server's /api/translate/batch limits.
 * 3. POST each batch to /api/translate/batch -- the server cascades through
 * Azure Cognitive Translator -> DeepL -> LibreTranslate and caches in PostgreSQL.
 * 4. Reassemble the translated leaf values back into the original nested structure.
 * 5. Persist the result in localStorage (7-day TTL) so subsequent language
 *    switches load instantly without another round-trip.
 *
 * Fallback: if the API is unreachable, the original English namespace is returned
 * unchanged -- the app stays fully functional, just in English.
 *
 * How it connects:
 * - Called by client/src/i18n/config.ts -> loadLanguage()
 * - Calls server/src/routes/translationRoutes.ts POST /api/translate/batch
 * - Reads/writes localStorage for client-side caching
 */

//Constants

/** Bump this when the English source changes significantly to bust all caches. */
const CACHE_VERSION = 1

/** How long a translated namespace is kept in localStorage before re-fetching. */
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

/** Must match MAX_TRANSLATION_BATCH_ITEMS in server/src/services/translationService.ts */
const BATCH_MAX_ITEMS = 100

/** Must match MAX_TRANSLATION_BATCH_CHARACTERS in server/src/services/translationService.ts */
const BATCH_MAX_CHARS = 25_000

//Flatten / Unflatten

/**
 * Recursively flatten a nested object to dot-path leaf strings.
 * { nav: { home: "Home" } } -> { "nav.home": "Home" }
 * Non-string leaves (arrays, numbers, booleans) are ignored -- they don't need
 * translation and will fall through to the English value automatically.
 */
function flattenObject(
  obj: Record<string, unknown>,
  prefix = '',
): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      Object.assign(result, flattenObject(value as Record<string, unknown>, path))
    } else if (typeof value === 'string') {
      result[path] = value
    }
  }
  return result
}

/**
 * Reassemble a flat dot-path map back into a nested object.
 * { "nav.home": "Accueil" } -> { nav: { home: "Accueil" } }
 */
function unflattenObject(flat: Record<string, string>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [path, value] of Object.entries(flat)) {
    const keys = path.split('.')
    let cursor: Record<string, unknown> = result
    for (let i = 0; i < keys.length - 1; i++) {
      if (!cursor[keys[i]] || typeof cursor[keys[i]] !== 'object') {
        cursor[keys[i]] = {}
      }
      cursor = cursor[keys[i]] as Record<string, unknown>
    }
    cursor[keys[keys.length - 1]] = value
  }
  return result
}

//Batching

/**
 * Split a flat entry array into chunks that each respect both the item-count
 * limit and the total-character-count limit of the batch translation API.
 */
function chunkBatch(entries: [string, string][]): [string, string][][] {
  const chunks: [string, string][][] = []
  let current: [string, string][] = []
  let currentChars = 0

  for (const entry of entries) {
    const len = entry[1].length
    if (
      current.length >= BATCH_MAX_ITEMS ||
      (current.length > 0 && currentChars + len > BATCH_MAX_CHARS)
    ) {
      chunks.push(current)
      current = []
      currentChars = 0
    }
    current.push(entry)
    currentChars += len
  }
  if (current.length > 0) chunks.push(current)
  return chunks
}

//localStorage Cache

const cacheKey = (lng: string, ns: string): string =>
  `aegis_i18n_v${CACHE_VERSION}_${lng}_${ns}`

function readCache(lng: string, ns: string): Record<string, unknown> | null {
  try {
    const raw = localStorage.getItem(cacheKey(lng, ns))
    if (!raw) return null
    const { data, expiresAt } = JSON.parse(raw) as { data: Record<string, unknown>; expiresAt: number }
    if (Date.now() > expiresAt) {
      localStorage.removeItem(cacheKey(lng, ns))
      return null
    }
    return data
  } catch {
    return null
  }
}

function writeCache(lng: string, ns: string, data: Record<string, unknown>): void {
  try {
    localStorage.setItem(
      cacheKey(lng, ns),
      JSON.stringify({ data, expiresAt: Date.now() + CACHE_TTL_MS }),
    )
  } catch {
    //localStorage quota exceeded -- silently skip caching; will re-fetch next time
  }
}

//Public API

/**
 * Translate a single i18next namespace bundle from English into `lng`.
 *
 * Returns the translated namespace object ready to pass to
 * `i18n.addResourceBundle(lng, ns, result, true, true)`.
 * Falls back to the original English bundle if the translation service is
 * unavailable, ensuring the app remains fully functional offline.
 */
export async function translateNamespace(
  enBundle: Record<string, unknown>,
  lng: string,
  ns: string,
): Promise<Record<string, unknown>> {
  //1. Check localStorage first -- fastest path (~0 ms)
  const cached = readCache(lng, ns)
  if (cached) return cached

  //2. Flatten English bundle to leaf string entries
  const flat = flattenObject(enBundle)
  const entries = Object.entries(flat)
  if (entries.length === 0) return enBundle

  //3. Send batches to the AEGIS translation microservice
  const chunks = chunkBatch(entries)
  const translatedFlat: Record<string, string> = {}

  try {
    for (const chunk of chunks) {
      const texts = chunk.map(([, v]) => v)
      const response = await fetch('/api/translate/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ texts, targetLanguage: lng, sourceLanguage: 'en' }),
      })

      if (!response.ok) throw new Error(`Translation API returned ${response.status}`)

      const { translations } = await response.json() as {
        translations: Array<{ translatedText: string }>
      }

      chunk.forEach(([path], i) => {
        //Fall back to English value if a particular string was not translated
        translatedFlat[path] = translations[i]?.translatedText ?? flat[path]
      })
    }

    //4. Reassemble flat translations back to nested namespace structure
    const result = unflattenObject(translatedFlat)

    //5. Persist to localStorage so future switches are instant
    writeCache(lng, ns, result)

    return result
  } catch {
    //API unreachable or quota exceeded -- return English, app stays functional
    return enBundle
  }
}
