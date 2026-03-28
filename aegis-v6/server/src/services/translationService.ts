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

const CACHE_TTL_MS = 24 * 60 * 60 * 1000
const MEMORY_CACHE_LIMIT = 5000
const PROVIDER_TIMEOUT_MS = 10000
export const MAX_TRANSLATION_TEXT_LENGTH = 5000
export const MAX_TRANSLATION_BATCH_ITEMS = 100
export const MAX_TRANSLATION_BATCH_CHARACTERS = 25_000
const PROVIDER_COOLDOWNS: Record<'rate_limit' | 'server_error' | 'network', number> = {
  rate_limit: 60_000,
  server_error: 20_000,
  network: 10_000,
}

const memoryCache = new Map<string, CacheEntry>()
const inflightTranslations = new Map<string, Promise<TranslationResult>>()
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

function normalizeLanguageCode(value?: string, fallback = 'en'): string {
  if (!value) return fallback
  const normalized = String(value).trim().toLowerCase().replace('_', '-')
  const base = normalized.split('-')[0]
  return SUPPORTED_CODES.has(base) ? base : fallback
}

function normalizeSourceLanguage(value?: string): string {
  if (!value) return 'auto'
  return String(value).trim().toLowerCase() === 'auto' ? 'auto' : normalizeLanguageCode(value, 'auto')
}

function trimText(text: string): string {
  return String(text || '').trim()
}

function shouldPassthroughText(text: string): boolean {
  if (!text) return true
  if (/^(https?:\/\/\S+|www\.\S+|\S+@\S+\.\S+)$/i.test(text)) return true
  return !/\p{L}/u.test(text)
}

function createCacheKey(text: string, sourceLanguage: string, targetLanguage: string): string {
  return crypto
    .createHash('sha256')
    .update(`${sourceLanguage}:${targetLanguage}:${trimText(text)}`)
    .digest('hex')
}

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

function getMemoryCache(text: string, sourceLanguage: string, targetLanguage: string): TranslationResult | null {
  const key = createCacheKey(text, sourceLanguage, targetLanguage)
  const entry = memoryCache.get(key)
  if (!entry) return null
  if (entry.expiresAt <= Date.now()) {
    memoryCache.delete(key)
    return null
  }
  return cloneResult(entry.result, true)
}

function setMemoryCache(text: string, sourceLanguage: string, targetLanguage: string, result: TranslationResult): void {
  const key = createCacheKey(text, sourceLanguage, targetLanguage)
  memoryCache.set(key, {
    result: cloneResult(result, false),
    expiresAt: Date.now() + CACHE_TTL_MS,
  })

  if (memoryCache.size <= MEMORY_CACHE_LIMIT) return

  const oldestKey = memoryCache.keys().next().value
  if (oldestKey) memoryCache.delete(oldestKey)
}

async function getDbCache(text: string, sourceLanguage: string, targetLanguage: string): Promise<TranslationResult | null> {
  const textHash = createDbTextHash(text)
  const legacyText = text.slice(0, 2000)

  try {
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

async function saveDbCache(
  text: string,
  sourceLanguage: string,
  targetLanguage: string,
  result: TranslationResult,
): Promise<void> {
  const textHash = createDbTextHash(text)

  try {
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
         created_at = NOW()`,
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
      // Optional cache table.
    }
  }
}

function isProviderCoolingDown(provider: ProviderName): boolean {
  const cooldown = providerCooldowns.get(provider)
  if (!cooldown) return false
  if (cooldown.until <= Date.now()) {
    providerCooldowns.delete(provider)
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

function getAzureTranslateUrl(): string {
  const base = (process.env.AZURE_TRANSLATOR_ENDPOINT || 'https://api.cognitive.microsofttranslator.com/')
    .trim()
    .replace(/\/+$/, '')

  if (/\/translate$/i.test(base)) return `${base}?api-version=3.0`
  if (/\/translator\/text\/v3\.0$/i.test(base)) return `${base}/translate?api-version=3.0`
  if (/api\.cognitive\.microsofttranslator\.com/i.test(base)) return `${base}/translate?api-version=3.0`
  return `${base}/translator/text/v3.0/translate?api-version=3.0`
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

export async function translateWithAzure(
  text: string,
  targetLanguage: string,
  sourceLanguage = 'auto',
): Promise<ProviderTranslation | null> {
  if (!process.env.AZURE_TRANSLATOR_KEY || !process.env.AZURE_TRANSLATOR_ENDPOINT || isProviderCoolingDown('azure')) {
    return null
  }

  const url = new URL(getAzureTranslateUrl())
  url.searchParams.set('to', mapAzureLanguage(targetLanguage))
  if (sourceLanguage !== 'auto') {
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

async function translateWithFallbacks(
  text: string,
  sourceLanguage: string,
  targetLanguage: string,
): Promise<TranslationResult> {
  const providers: Array<{
    name: ProviderName
    translate: (text: string, targetLanguage: string, sourceLanguage?: string) => Promise<ProviderTranslation | null>
  }> = [
    { name: 'azure', translate: translateWithAzure },
    { name: 'deepl', translate: translateWithDeepL },
    { name: 'libretranslate', translate: translateWithLibre },
  ]

  let detectedLanguage: string | undefined

  for (const provider of providers) {
    try {
      const result = await provider.translate(text, targetLanguage, sourceLanguage)
      if (!result?.translatedText) continue

      detectedLanguage = result.detectedLanguage || detectedLanguage

      return {
        originalText: text,
        translatedText: result.translatedText,
        targetLanguage,
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
      if (process.env.NODE_ENV !== 'production') {
        logger.warn({ err: error, provider: provider.name }, '[Translation] Provider failed')
      }
    }
  }

  return createUnavailableResult(text, targetLanguage, sourceLanguage, detectedLanguage)
}

export async function translateText(
  text: string,
  targetLanguage: string,
  sourceLanguage = 'auto',
): Promise<TranslationResult> {
  const trimmed = trimText(text)
  const normalizedTarget = normalizeLanguageCode(targetLanguage, 'en')
  const normalizedSource = normalizeSourceLanguage(sourceLanguage)

  if (!trimmed) return createPassthroughResult('', normalizedTarget, normalizedSource)

  if (normalizedSource !== 'auto' && normalizedSource === normalizedTarget) {
    return createPassthroughResult(trimmed, normalizedTarget, normalizedSource)
  }

  if (shouldPassthroughText(trimmed)) {
    return createPassthroughResult(trimmed, normalizedTarget, normalizedSource)
  }

  const memoryHit = getMemoryCache(trimmed, normalizedSource, normalizedTarget)
  if (memoryHit) return memoryHit

  const cacheKey = createCacheKey(trimmed, normalizedSource, normalizedTarget)
  const inflight = inflightTranslations.get(cacheKey)
  if (inflight) {
    const result = await inflight
    return cloneResult(result, result.cached)
  }

  const translationPromise = (async (): Promise<TranslationResult> => {
    const dbHit = await getDbCache(trimmed, normalizedSource, normalizedTarget)
    if (dbHit) return cloneResult(dbHit, true)

    const translation = await translateWithFallbacks(trimmed, normalizedSource, normalizedTarget)

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
    inflightTranslations.delete(cacheKey)
  }
}

export async function translateTexts(
  texts: string[],
  targetLanguage: string,
  sourceLanguage = 'auto',
): Promise<TranslationResult[]> {
  const normalizedTexts = texts.map((text) => trimText(text))
  const uniqueTexts = [...new Set(normalizedTexts.filter(Boolean))]
  const translated = new Map<string, TranslationResult>()
  const normalizedTarget = normalizeLanguageCode(targetLanguage, 'en')
  const normalizedSource = normalizeSourceLanguage(sourceLanguage)

  let nextIndex = 0
  const concurrency = Math.min(4, uniqueTexts.length)

  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (nextIndex < uniqueTexts.length) {
        const currentIndex = nextIndex++
        const text = uniqueTexts[currentIndex]
        if (!text) continue
        translated.set(text, await translateText(text, normalizedTarget, normalizedSource))
      }
    }),
  )

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

export function __resetTranslationStateForTests(): void {
  memoryCache.clear()
  inflightTranslations.clear()
  providerCooldowns.clear()
}
