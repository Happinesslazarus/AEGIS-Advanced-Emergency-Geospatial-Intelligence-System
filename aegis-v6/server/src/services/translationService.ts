/**
 * Multi-provider translation service -- supports Azure Cognitive Translator,
 * DeepL, and LibreTranslate. Uses a three-tier caching strategy (process memory
 * -> PostgreSQL -> live API call) with inflight request deduplication to avoid
 * hammering paid APIs with identical simultaneous requests.
 *
 * How it works:
 * 1. Normalise and validate the input text and language codes
 * 2. Check process-memory cache first (fastest, ~0ms)
 * 3. If not there, deduplicate: check if an identical request is already in-flight
 *    (same text + languages). If yes, wait for that promise instead of calling again.
 * 4. Check PostgreSQL cache (30-day TTL)
 * 5. If still no hit, call providers in priority order (Azure -> DeepL -> LibreTranslate)
 *    stopping at the first success. Failed providers get a cooldown period.
 * 6. Store successful result in both memory and DB caches for future requests.
 *
 * - Called by server/src/routes/translationRoutes.ts (POST /api/translate)
 * - Called by server/src/services/chatService.ts to auto-translate LLM replies
 * - Requires environment variables: AZURE_TRANSLATOR_KEY, DEEPL_API_KEY, LIBRE_TRANSLATE_ENDPOINT
 * - translations_cache table in PostgreSQL stores results across restarts
 * */

import crypto from 'crypto'
import pool from '../models/db.js'
import { logger } from './logger.js'

export interface TranslationResult {
  originalText: string
  translatedText: string
  targetLanguage: string
  sourceLanguage: string | null
  detectedLanguage?: string
  provider: 'azure' | 'deepl' | 'libretranslate' | 'passthrough' | 'unavailable'
  cached: boolean
  available: boolean
  status: 'translated' | 'passthrough' | 'unavailable'
}

export interface SupportedLanguage {
  code: string
  name: string
}

type ProviderName = 'azure' | 'deepl' | 'libretranslate'

interface ProviderTranslation {
  translatedText: string
  detectedLanguage?: string
  sourceLanguage?: string
}

interface CacheEntry {
  result: TranslationResult
  expiresAt: number
}

interface ProviderCooldown {
  until: number
  reason: string
}

class ProviderRequestError extends Error {
  constructor(
    message: string,
    readonly kind: 'http' | 'network',
  ) {
    super(message)
    this.name = 'ProviderRequestError'
  }
}

//Shared constants

const CACHE_TTL_MS = 24 * 60 * 60 * 1000       // In-memory entries live for 24 hours
const MEMORY_CACHE_LIMIT = 5000                  // Evict oldest entry when we exceed this
const PROVIDER_TIMEOUT_MS = 10000               // 10 s hard timeout per provider API call
export const MAX_TRANSLATION_TEXT_LENGTH = 5000  // Characters accepted per single request
export const MAX_TRANSLATION_BATCH_ITEMS = 100   // Max texts in a single batch call
export const MAX_TRANSLATION_BATCH_CHARACTERS = 25_000 // Character budget for a batch

//How long to skip a provider after each failure type.
//Rate limits get a full minute; server errors 20 s; network blips 10 s.
const PROVIDER_COOLDOWNS: Record<'rate_limit' | 'server_error' | 'network', number> = {
  rate_limit: 60_000,
  server_error: 20_000,
  network: 10_000,
}

//Process-level in-memory cache -- fastest lookup, lost on restart.
const memoryCache = new Map<string, CacheEntry>()

//Prevents duplicate API calls for the same text requested simultaneously.
//Maps a cache key to the in-progress promise so all waiters share one result.
const inflightTranslations = new Map<string, Promise<TranslationResult>>()

//Tracks providers that have recently failed and should be skipped.
const providerCooldowns = new Map<ProviderName, ProviderCooldown>()

export const SUPPORTED_LANGUAGES: SupportedLanguage[] = [
  { code: 'en', name: 'English' },
  { code: 'ar', name: 'Arabic' },
  { code: 'bn', name: 'Bengali' },
  { code: 'cy', name: 'Welsh' },
  { code: 'de', name: 'German' },
  { code: 'es', name: 'Spanish' },
  { code: 'fr', name: 'French' },
  { code: 'gd', name: 'Scottish Gaelic' },
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
  { code: 'zh', name: 'Chinese (Simplified)' },
]

const SUPPORTED_CODES = new Set(SUPPORTED_LANGUAGES.map((language) => language.code))
const DEEPL_TARGET_LANGUAGE_MAP: Record<string, string> = {
  ar: 'AR',
  de: 'DE',
  en: 'EN',
  es: 'ES',
  fr: 'FR',
  hi: 'HI',
  it: 'IT',
  ja: 'JA',
  ko: 'KO',
  nl: 'NL',
  pl: 'PL',
  pt: 'PT-PT',
  ro: 'RO',
  ru: 'RU',
  sv: 'SV',
  tr: 'TR',
  uk: 'UK',
  zh: 'ZH',
}
const DEEPL_SOURCE_LANGUAGE_MAP: Record<string, string> = {
  ar: 'AR',
  de: 'DE',
  en: 'EN',
  es: 'ES',
  fr: 'FR',
  it: 'IT',
  ja: 'JA',
  ko: 'KO',
  nl: 'NL',
  pl: 'PL',
  pt: 'PT',
  ro: 'RO',
  ru: 'RU',
  sv: 'SV',
  tr: 'TR',
  uk: 'UK',
  zh: 'ZH',
}
const AZURE_LANGUAGE_MAP: Record<string, string> = {
  zh: 'zh-Hans',
}
const LIBRE_DEFAULT_ENDPOINTS = [
  'https://libretranslate.com/translate',
  'https://translate.argosopentech.com/translate',
]

//Normalisation helpers

//Convert caller-supplied language codes to our internal format (e.g. 'ZH-HANS' -> 'zh').
//Falls back to 'en' (or a caller-specified default) for unknown codes.
function normalizeLanguageCode(value?: string, fallback = 'en'): string {
  if (!value) return fallback
  const normalized = String(value).trim().toLowerCase().replace('_', '-')
 const base = normalized.split('-')[0] // strip regional variants like 'en-GB' -> 'en'
  return SUPPORTED_CODES.has(base) ? base : fallback
}

//Source language can legitimately be 'auto' (provider detects it); handle that sentinel.
function normalizeSourceLanguage(value?: string): string {
  if (!value) return 'auto'
  return String(value).trim().toLowerCase() === 'auto' ? 'auto' : normalizeLanguageCode(value, 'auto')
}

function trimText(text: string): string {
  return String(text || '').trim()
}

//Decide whether to skip translation and return the text as-is.
//Covers: URLs, email addresses, and text with no alphabetic characters
// (numbers-only, emoji-only, punctuation strings) -- pointless to translate those.
function shouldPassthroughText(text: string): boolean {
  if (!text) return true
  if (/^(https?:\/\/\S+|www\.\S+|\S+@\S+\.\S+)$/i.test(text)) return true // URLs or emails
  return !/\p{L}/u.test(text) // no Unicode letters found -- nothing to translate
}

//Cache key helpers

//SHA-256 of the full triplet: source lang + target lang + trimmed text.
//Used for both the in-memory Map key and the inflight deduplication map.
function createCacheKey(text: string, sourceLanguage: string, targetLanguage: string): string {
  return crypto
    .createHash('sha256')
    .update(`${sourceLanguage}:${targetLanguage}:${trimText(text)}`)
    .digest('hex')
}

//Separate MD5 for the DB source_text_hash column (just the text, no language prefix).
//MD5 is fine here -- it's not security-sensitive, just a fast lookup key.
function createDbTextHash(text: string): string {
  return crypto
    .createHash('md5')
    .update(trimText(text))
    .digest('hex')
}

function cloneResult(result: TranslationResult, cached: boolean): TranslationResult {
  return { ...result, cached }
}

function createPassthroughResult(text: string, targetLanguage: string, sourceLanguage: string): TranslationResult {
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

function createUnavailableResult(
  text: string,
  targetLanguage: string,
  sourceLanguage: string,
  detectedLanguage?: string,
): TranslationResult {
  return {
    originalText: text,
    translatedText: text,
    targetLanguage,
    sourceLanguage: sourceLanguage === 'auto' ? null : sourceLanguage,
    detectedLanguage,
    provider: 'unavailable',
    cached: false,
    available: false,
    status: 'unavailable',
  }
}

//Tier 1 -- in-memory cache (fastest: O(1) Map lookup, ~0ms)

function getMemoryCache(text: string, sourceLanguage: string, targetLanguage: string): TranslationResult | null {
  const key = createCacheKey(text, sourceLanguage, targetLanguage)
  const entry = memoryCache.get(key)
  if (!entry) return null
  if (entry.expiresAt <= Date.now()) {
    //Lazy expiry -- remove on read rather than running a background sweep
    memoryCache.delete(key)
    return null
  }
  return cloneResult(entry.result, true) // always return a clone so callers can't mutate the store
}

function setMemoryCache(text: string, sourceLanguage: string, targetLanguage: string, result: TranslationResult): void {
  const key = createCacheKey(text, sourceLanguage, targetLanguage)
  memoryCache.set(key, {
    result: cloneResult(result, false), // store with cached=false; getMemoryCache sets cached=true on read
    expiresAt: Date.now() + CACHE_TTL_MS,
  })

  //Simple LRU eviction: Maps preserve insertion order, so the first key is the oldest.
  if (memoryCache.size <= MEMORY_CACHE_LIMIT) return
  const oldestKey = memoryCache.keys().next().value
  if (oldestKey) memoryCache.delete(oldestKey)
}

//Tier 2 -- PostgreSQL cache (persists across restarts, ~30-day TTL)

async function getDbCache(text: string, sourceLanguage: string, targetLanguage: string): Promise<TranslationResult | null> {
  const textHash = createDbTextHash(text)
  const legacyText = text.slice(0, 2000) // truncated version for old schema that stored full text (2000 char)

  try {
    //Primary lookup: uses hash column for index performance
    const result = await pool.query(
      `SELECT translated_text, detected_language, provider
       FROM translations_cache
       WHERE source_text_hash = $1
         AND source_lang = $2
         AND target_lang = $3
       AND created_at > NOW() - INTERVAL '30 days'
       ORDER BY created_at DESC
       LIMIT 1`,
      [textHash, sourceLanguage, targetLanguage],
    )

    if (!result.rows[0]) return null

    const row = result.rows[0]
    const translation: TranslationResult = {
      originalText: text,
      translatedText: row.translated_text,
      targetLanguage,
      sourceLanguage: sourceLanguage === 'auto' ? null : sourceLanguage,
      detectedLanguage: row.detected_language || undefined,
      provider: row.provider || 'azure',
      cached: true,
      available: true,
      status: 'translated',
    }

    setMemoryCache(text, sourceLanguage, targetLanguage, translation)
    return translation
  } catch {
    //source_text_hash column may not exist on older schema -- fall back to text comparison
    try {
      const result = await pool.query(
        `SELECT translated_text, detected_language, provider
         FROM translations_cache
         WHERE source_lang = $1
           AND target_lang = $2
           AND (source_text = $3 OR source_text = $4)
           AND created_at > NOW() - INTERVAL '30 days'
         ORDER BY created_at DESC
         LIMIT 1`,
        [sourceLanguage, targetLanguage, text, legacyText],
      )

      if (!result.rows[0]) return null

      const row = result.rows[0]
      const translation: TranslationResult = {
        originalText: text,
        translatedText: row.translated_text,
        targetLanguage,
        sourceLanguage: sourceLanguage === 'auto' ? null : sourceLanguage,
        detectedLanguage: row.detected_language || undefined,
        provider: row.provider || 'azure',
        cached: true,
        available: true,
        status: 'translated',
      }

      setMemoryCache(text, sourceLanguage, targetLanguage, translation)
      return translation
    } catch {
      return null
    }
  }
}

//Tier 2 -- save to PostgreSQL cache (fire-and-forget; failures are non-fatal)

async function saveDbCache(
  text: string,
  sourceLanguage: string,
  targetLanguage: string,
  result: TranslationResult,
): Promise<void> {
  const textHash = createDbTextHash(text)

  try {
    //Modern schema: uses hash for the unique constraint (handles texts > 2000 chars cleanly)
    await pool.query(
      `INSERT INTO translations_cache (
         source_text, source_text_hash, source_lang, target_lang, translated_text, detected_language, provider
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (source_text_hash, source_lang, target_lang)
       DO UPDATE SET
         source_text = EXCLUDED.source_text,
         translated_text = EXCLUDED.translated_text,
         detected_language = EXCLUDED.detected_language,
         provider = EXCLUDED.provider,
         created_at = NOW()`, // refresh timestamp so the 30-day TTL restarts on re-use
      [
        text,
        textHash,
        sourceLanguage,
        targetLanguage,
        result.translatedText.slice(0, 5000),
        result.detectedLanguage || null,
        result.provider,
      ],
    )
  } catch {
    try {
      await pool.query(
        `INSERT INTO translations_cache (
           source_text, source_lang, target_lang, translated_text, detected_language, provider
         )
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (source_text, source_lang, target_lang)
         DO UPDATE SET
           translated_text = EXCLUDED.translated_text,
           detected_language = EXCLUDED.detected_language,
           provider = EXCLUDED.provider,
           created_at = NOW()`,
        [
          text,
          sourceLanguage,
          targetLanguage,
          result.translatedText.slice(0, 5000),
          result.detectedLanguage || null,
          result.provider,
        ],
      )
    } catch {
      //Optional cache table.
    }
  }
}

//Provider cooldown management
//When a provider errors (rate-limited, 5xx, network), we skip it for a while
//to avoid burning through retries and hammering an already-struggling service.

function isProviderCoolingDown(provider: ProviderName): boolean {
  const cooldown = providerCooldowns.get(provider)
  if (!cooldown) return false
  if (cooldown.until <= Date.now()) {
    providerCooldowns.delete(provider) // cooldown expired -- clean up and allow again
    return false
  }
  return true
}

function setProviderCooldown(provider: ProviderName, type: keyof typeof PROVIDER_COOLDOWNS, reason: string): void {
  providerCooldowns.set(provider, {
    until: Date.now() + PROVIDER_COOLDOWNS[type],
    reason,
  })
}

//URL builders -- tolerate several formats an operator might paste into .env
//Azure has both global and regional endpoints with varying path structures.

function getAzureTranslateUrl(): string {
  const base = (process.env.AZURE_TRANSLATOR_ENDPOINT || 'https://api.cognitive.microsofttranslator.com/')
    .trim()
    .replace(/\/+$/, '') // strip trailing slashes

  //Handle each common form the env var might arrive in
  if (/\/translate$/i.test(base)) return `${base}?api-version=3.0`
  if (/\/translator\/text\/v3\.0$/i.test(base)) return `${base}/translate?api-version=3.0`
  if (/api\.cognitive\.microsofttranslator\.com/i.test(base)) return `${base}/translate?api-version=3.0`
  return `${base}/translator/text/v3.0/translate?api-version=3.0` // safest fallback
}

function getAzureDetectUrl(): string {
  const base = (process.env.AZURE_TRANSLATOR_ENDPOINT || 'https://api.cognitive.microsofttranslator.com/')
    .trim()
    .replace(/\/+$/, '')

  if (/\/detect$/i.test(base)) return `${base}?api-version=3.0`
  if (/\/translator\/text\/v3\.0$/i.test(base)) return `${base}/detect?api-version=3.0`
  if (/api\.cognitive\.microsofttranslator\.com/i.test(base)) return `${base}/detect?api-version=3.0`
  return `${base}/translator/text/v3.0/detect?api-version=3.0`
}

function getDeepLTranslateUrl(): string {
  const base = (process.env.DEEPL_ENDPOINT || 'https://api-free.deepl.com/v2/translate')
    .trim()
    .replace(/\/+$/, '')

  if (/\/translate$/i.test(base)) return base
  if (/\/v2$/i.test(base)) return `${base}/translate`
  return `${base}/v2/translate`
}

function getLibreTranslateUrls(): string[] {
  const configured = (process.env.LIBRE_TRANSLATE_ENDPOINT || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)

  const urls = configured.length > 0 ? configured : LIBRE_DEFAULT_ENDPOINTS
  return urls.map((value) => (value.endsWith('/translate') ? value : `${value.replace(/\/+$/, '')}/translate`))
}

function mapAzureLanguage(code: string): string {
  return AZURE_LANGUAGE_MAP[code] || code
}

function mapDeepLTargetLanguage(code: string): string | null {
  return DEEPL_TARGET_LANGUAGE_MAP[code] || null
}

function mapDeepLSourceLanguage(code: string): string | null {
  return DEEPL_SOURCE_LANGUAGE_MAP[code] || null
}

async function fetchJson(url: string, init: RequestInit, timeoutMs = PROVIDER_TIMEOUT_MS): Promise<{ response: Response; data: any }> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(url, { ...init, signal: controller.signal })
    const data = await response.json().catch(() => null)
    return { response, data }
  } finally {
    clearTimeout(timeout)
  }
}

function extractErrorMessage(provider: ProviderName, response: Response, data: any): string {
  if (provider === 'azure') return data?.error?.message || `Azure ${response.status}`
  if (provider === 'deepl') return data?.message || data?.detail || `DeepL ${response.status}`
  return data?.error || data?.message || `LibreTranslate ${response.status}`
}

function handleProviderHttpError(provider: ProviderName, response: Response, data: any): never {
  const reason = extractErrorMessage(provider, response, data)
  if (response.status === 429) {
    setProviderCooldown(provider, 'rate_limit', reason)
  } else if (response.status >= 500) {
    setProviderCooldown(provider, 'server_error', reason)
  }
  throw new ProviderRequestError(reason, 'http')
}

function handleProviderNetworkError(provider: ProviderName, error: unknown): never {
  const reason = error instanceof Error ? error.message : 'network error'
  setProviderCooldown(provider, 'network', reason)
  throw new ProviderRequestError(reason, 'network')
}

//Individual provider implementations

export async function translateWithAzure(
  text: string,
  targetLanguage: string,
  sourceLanguage = 'auto',
): Promise<ProviderTranslation | null> {
  //Skip if not configured or currently in cooldown period
  if (!process.env.AZURE_TRANSLATOR_KEY || !process.env.AZURE_TRANSLATOR_ENDPOINT || isProviderCoolingDown('azure')) {
    return null
  }

  const url = new URL(getAzureTranslateUrl())
  url.searchParams.set('to', mapAzureLanguage(targetLanguage))
  if (sourceLanguage !== 'auto') {
    //Omitting 'from' lets Azure auto-detect; including it gives better accuracy when known
    url.searchParams.set('from', mapAzureLanguage(sourceLanguage))
  }

  try {
    const { response, data } = await fetchJson(url.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Ocp-Apim-Subscription-Key': process.env.AZURE_TRANSLATOR_KEY,
        ...(process.env.AZURE_TRANSLATOR_REGION ? { 'Ocp-Apim-Subscription-Region': process.env.AZURE_TRANSLATOR_REGION } : {}),
        'X-ClientTraceId': crypto.randomUUID(),
      },
      body: JSON.stringify([{ Text: text.slice(0, 5000) }]),
    })

    if (!response.ok) handleProviderHttpError('azure', response, data)

    const item = Array.isArray(data) ? data[0] : null
    const translation = item?.translations?.[0]
    if (!translation?.text) return null

    return {
      translatedText: translation.text,
      detectedLanguage: item?.detectedLanguage?.language || undefined,
      sourceLanguage: sourceLanguage === 'auto' ? item?.detectedLanguage?.language || undefined : sourceLanguage,
    }
  } catch (error) {
    if (error instanceof ProviderRequestError) throw error
    return handleProviderNetworkError('azure', error)
  }
}

export async function translateWithDeepL(
  text: string,
  targetLanguage: string,
  sourceLanguage = 'auto',
): Promise<ProviderTranslation | null> {
  if (!process.env.DEEPL_API_KEY || isProviderCoolingDown('deepl')) return null

  const mappedTarget = mapDeepLTargetLanguage(targetLanguage)
  if (!mappedTarget) return null

  const params = new URLSearchParams()
  params.append('text', text.slice(0, 5000))
  params.append('target_lang', mappedTarget)

  const mappedSource = sourceLanguage === 'auto' ? null : mapDeepLSourceLanguage(sourceLanguage)
  if (mappedSource) params.append('source_lang', mappedSource)

  try {
    const { response, data } = await fetchJson(getDeepLTranslateUrl(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `DeepL-Auth-Key ${process.env.DEEPL_API_KEY}`,
      },
      body: params.toString(),
    })

    if (!response.ok) handleProviderHttpError('deepl', response, data)

    const translation = data?.translations?.[0]
    if (!translation?.text) return null

    return {
      translatedText: translation.text,
      detectedLanguage: translation.detected_source_language
        ? normalizeLanguageCode(translation.detected_source_language)
        : undefined,
      sourceLanguage: translation.detected_source_language
        ? normalizeLanguageCode(translation.detected_source_language)
        : mappedSource?.toLowerCase(),
    }
  } catch (error) {
    if (error instanceof ProviderRequestError) throw error
    return handleProviderNetworkError('deepl', error)
  }
}

export async function translateWithLibre(
  text: string,
  targetLanguage: string,
  sourceLanguage = 'auto',
): Promise<ProviderTranslation | null> {
  if (isProviderCoolingDown('libretranslate')) return null

  const urls = getLibreTranslateUrls()
  let lastError: Error | null = null

  for (const url of urls) {
    try {
      const { response, data } = await fetchJson(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          q: text.slice(0, 5000),
          source: sourceLanguage === 'auto' ? 'auto' : sourceLanguage,
          target: targetLanguage,
          format: 'text',
        }),
      })

      if (!response.ok) {
        lastError = new Error(extractErrorMessage('libretranslate', response, data))
        if (response.status === 429) setProviderCooldown('libretranslate', 'rate_limit', lastError.message)
        continue
      }

      if (!data?.translatedText) continue

      return {
        translatedText: data.translatedText,
        detectedLanguage: data.detectedLanguage?.language
          ? normalizeLanguageCode(data.detectedLanguage.language)
          : undefined,
        sourceLanguage: data.detectedLanguage?.language
          ? normalizeLanguageCode(data.detectedLanguage.language)
          : sourceLanguage === 'auto'
            ? undefined
            : sourceLanguage,
      }
    } catch (error) {
      lastError = error instanceof Error ? error : new Error('network error')
    }
  }

  if (lastError) {
    setProviderCooldown('libretranslate', 'network', lastError.message)
  }

  return null
}

//Provider cascade -- the heart of the fallback strategy
//Try each translation API in priority order (Azure > DeepL > LibreTranslate).
//Returns the first successful result; if all fail, returns an 'unavailable' result
//that echoes the original text so the caller always has something usable.

async function translateWithFallbacks(
  text: string,
  sourceLanguage: string,
  targetLanguage: string,
): Promise<TranslationResult> {
  //Priority order: Azure (best quality, paid), DeepL (excellent quality, paid),
  //LibreTranslate (open-source, free, tries multiple public endpoints)
  const providers: Array<{
    name: ProviderName
    translate: (text: string, targetLanguage: string, sourceLanguage?: string) => Promise<ProviderTranslation | null>
  }> = [
    { name: 'azure', translate: translateWithAzure },
    { name: 'deepl', translate: translateWithDeepL },
    { name: 'libretranslate', translate: translateWithLibre },
  ]

  let detectedLanguage: string | undefined // carry detected lang forward in case a later provider succeeds

  for (const provider of providers) {
    try {
      const result = await provider.translate(text, targetLanguage, sourceLanguage)
      if (!result?.translatedText) continue // provider returned nothing -- move to next

      detectedLanguage = result.detectedLanguage || detectedLanguage

      return {
        originalText: text,
        translatedText: result.translatedText,
        targetLanguage,
        //If source was 'auto', use what the provider detected; otherwise echo the caller's value
        sourceLanguage: sourceLanguage === 'auto'
          ? result.sourceLanguage || null
          : sourceLanguage,
        detectedLanguage: result.detectedLanguage,
        provider: provider.name,
        cached: false,
        available: true,
        status: 'translated',
      }
    } catch (error) {
      //Log provider failures in dev (too noisy for prod logs)
      if (process.env.NODE_ENV !== 'production') {
        logger.warn({ err: error, provider: provider.name }, '[Translation] Provider failed')
      }
      //Continue to next provider -- exception already set cooldown inside the provider function
    }
  }

  //All providers exhausted -- return original text so the app degrades gracefully
  return createUnavailableResult(text, targetLanguage, sourceLanguage, detectedLanguage)
}

//Public API -- single text translation
//This is the main entry point. All the caching and fallback logic funnels through here.

export async function translateText(
  text: string,
  targetLanguage: string,
  sourceLanguage = 'auto',
): Promise<TranslationResult> {
  const trimmed = trimText(text)
  const normalizedTarget = normalizeLanguageCode(targetLanguage, 'en')
  const normalizedSource = normalizeSourceLanguage(sourceLanguage)

  //Early-exit cases that need no translation at all
  if (!trimmed) return createPassthroughResult('', normalizedTarget, normalizedSource)

  //Source and target are the same language -- nothing to do
  if (normalizedSource !== 'auto' && normalizedSource === normalizedTarget) {
    return createPassthroughResult(trimmed, normalizedTarget, normalizedSource)
  }

  //URLs, emails, numbers-only etc. -- skip translation
  if (shouldPassthroughText(trimmed)) {
    return createPassthroughResult(trimmed, normalizedTarget, normalizedSource)
  }

  //Tier 1: process-memory cache (fastest)
  const memoryHit = getMemoryCache(trimmed, normalizedSource, normalizedTarget)
  if (memoryHit) return memoryHit

  const cacheKey = createCacheKey(trimmed, normalizedSource, normalizedTarget)

  //Inflight deduplication: if another async call is already fetching this exact translation,
  //wait for that promise instead of firing a second API call.
  const inflight = inflightTranslations.get(cacheKey)
  if (inflight) {
    const result = await inflight
    return cloneResult(result, result.cached)
  }

  //Create the translation promise and register it in the inflight map immediately
  //so any concurrent calls for the same key will attach here.
  const translationPromise = (async (): Promise<TranslationResult> => {
    //Tier 2: PostgreSQL cache (persists across restarts)
    const dbHit = await getDbCache(trimmed, normalizedSource, normalizedTarget)
    if (dbHit) return cloneResult(dbHit, true)

    //Tier 3: live API call through provider cascade
    const translation = await translateWithFallbacks(trimmed, normalizedSource, normalizedTarget)

    //Warm the caches for next time (fire-and-forget DB write -- failure is non-fatal)
    if (translation.available && translation.status === 'translated') {
      setMemoryCache(trimmed, normalizedSource, normalizedTarget, translation)
      saveDbCache(trimmed, normalizedSource, normalizedTarget, translation).catch(() => {})
    }

    return translation
  })()

  inflightTranslations.set(cacheKey, translationPromise)

  try {
    const result = await translationPromise
    return cloneResult(result, result.cached)
  } finally {
    //Always remove from inflight map, even if the promise rejected
    inflightTranslations.delete(cacheKey)
  }
}

//Public API -- batch translation
//Translates an array of texts. Deduplicates identical strings before API calls
//and runs up to 4 translations concurrently to balance speed vs provider rate limits.

export async function translateTexts(
  texts: string[],
  targetLanguage: string,
  sourceLanguage = 'auto',
): Promise<TranslationResult[]> {
  const normalizedTexts = texts.map((text) => trimText(text))

  //Deduplicate: if the same phrase appears 10 times, translate it once and reuse the result
  const uniqueTexts = [...new Set(normalizedTexts.filter(Boolean))]
  const translated = new Map<string, TranslationResult>()
  const normalizedTarget = normalizeLanguageCode(targetLanguage, 'en')
  const normalizedSource = normalizeSourceLanguage(sourceLanguage)

  //Worker pool pattern: spawn `concurrency` promises that each pull from a shared index.
  //Cheaper than Promise.all(texts.map(...)) which would fire all requests simultaneously.
  let nextIndex = 0
  const concurrency = Math.min(4, uniqueTexts.length) // cap workers at 4

  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (nextIndex < uniqueTexts.length) {
        const currentIndex = nextIndex++ // atomic-ish: JS is single-threaded, no race here
        const text = uniqueTexts[currentIndex]
        if (!text) continue
        translated.set(text, await translateText(text, normalizedTarget, normalizedSource))
      }
    }),
  )

  //Map results back to the original array positions (preserving duplicates and order)
  return normalizedTexts.map((text) => {
    if (!text) return createPassthroughResult('', normalizedTarget, normalizedSource)
    return translated.get(text) || createUnavailableResult(text, normalizedTarget, normalizedSource)
  })
}

export async function detectLanguage(text: string): Promise<string | null> {
  const trimmed = trimText(text)
  if (!trimmed) return null

  if (!process.env.AZURE_TRANSLATOR_KEY || !process.env.AZURE_TRANSLATOR_ENDPOINT || isProviderCoolingDown('azure')) {
    return null
  }

  try {
    const { response, data } = await fetchJson(getAzureDetectUrl(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Ocp-Apim-Subscription-Key': process.env.AZURE_TRANSLATOR_KEY,
        ...(process.env.AZURE_TRANSLATOR_REGION ? { 'Ocp-Apim-Subscription-Region': process.env.AZURE_TRANSLATOR_REGION } : {}),
        'X-ClientTraceId': crypto.randomUUID(),
      },
      body: JSON.stringify([{ Text: trimmed.slice(0, 5000) }]),
    })

    if (!response.ok) handleProviderHttpError('azure', response, data)

    const detected = Array.isArray(data) ? data[0]?.language : null
    return detected ? normalizeLanguageCode(detected) : null
  } catch {
    return null
  }
}

//Test helpers

//Clears all in-process state so unit tests start from a clean slate.
//Named with __ prefix convention so linters can flag accidental production use.
export function __resetTranslationStateForTests(): void {
  memoryCache.clear()
  inflightTranslations.clear()
  providerCooldowns.clear()
}
