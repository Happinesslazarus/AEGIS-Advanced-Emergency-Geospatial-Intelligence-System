/**
 * Routes every AI completion request to the best available LLM provider.
 * Prefers local Ollama models (free, fast, runs on-device), falling back to
 * cloud APIs (Gemini, Groq, OpenRouter, HuggingFace) when local is unavailable
 * or the query needs a stronger model. Tracks provider health, rate limits,
 * token usage, and latency history so it can make smart routing decisions.
 *
 * - Called by server/src/services/chatService.ts for all chat completions
 * - Called by server/src/services/aiAnalysisPipeline.ts for report severity scoring
 * - Calls Ollama at http://localhost:11434 (or AI_ENGINE_URL) for local models
 * - Calls cloud APIs using keys from env: GEMINI_API_KEY, GROQ_API_KEY, etc.
 * - startModelWarmup() is triggered at server startup (index.ts)
 *
 * - chatCompletion()        — single-call LLM request, returns JSON response
 * - chatCompletionStream()  — same but streams tokens via callback
 * - classifyQuery()         — lightweight classification of query intent
 * - getProviderStatus()     — health of all registered providers (used by GET /api/chat/status)
 * - startModelWarmup()      — pre-loads the primary model at startup
 *
 * - server/src/services/chatService.ts       — main caller of chatCompletion()
 * - server/src/services/aiAnalysisPipeline.ts — uses classifyQuery() for report scoring
 * - server/src/services/embeddingRouter.ts   — similar router but for embeddings
 * - ai-engine/main.py                        — the FastAPI AI engine (separate process)
 * */

import type { LLMRequest, LLMResponse, LLMProvider } from '../types/index.js'
import { devLog } from '../utils/logger.js'
import { fetchWithTimeout } from '../utils/fetchWithTimeout.js'
import { logger } from './logger.js'
import { regionRegistry } from '../adapters/regions/RegionRegistry.js'

interface StreamHandlers {
  onToken: (token: string) => Promise<void> | void
  signal?: AbortSignal
}

// —1  PROVIDER REGISTRY

interface ProviderState {
  config: LLMProvider
  requestCount: number
  windowStart: number
  lastError: string | null
  lastErrorAt: number | null
  consecutiveErrors: number
}

const providers: ProviderState[] = []

/* Per-provider latency history for health tracking (last 20 calls each) */
const latencyTracker = new Map<string, number[]>()

/* Token usage tracking for dashboard */
interface TokenUsageEntry {
  provider: string
  model: string
  tokensUsed: number
  timestamp: number
  isLocal: boolean
  queryClassification?: string
}
const tokenUsageLog: TokenUsageEntry[] = []
const TOKEN_USAGE_MAX = 10000

export function logTokenUsage(entry: TokenUsageEntry): void {
  tokenUsageLog.push(entry)
  if (tokenUsageLog.length > TOKEN_USAGE_MAX) tokenUsageLog.splice(0, tokenUsageLog.length - TOKEN_USAGE_MAX)
}

export function getTokenUsageStats(): {
  today: { local: number; api: number; totalTokens: number; cacheHits: number }
  week: { local: number; api: number; totalTokens: number }
  localRatio: number
  byProvider: Record<string, number>
} {
  const now = Date.now()
  const dayAgo = now - 86_400_000
  const weekAgo = now - 7 * 86_400_000

  const todayEntries = tokenUsageLog.filter(e => e.timestamp > dayAgo)
  const weekEntries = tokenUsageLog.filter(e => e.timestamp > weekAgo)

  const todayLocal = todayEntries.filter(e => e.isLocal).length
  const todayApi = todayEntries.filter(e => !e.isLocal).length
  const todayTokens = todayEntries.reduce((s, e) => s + e.tokensUsed, 0)

  const weekLocal = weekEntries.filter(e => e.isLocal).length
  const weekApi = weekEntries.filter(e => !e.isLocal).length
  const weekTokens = weekEntries.reduce((s, e) => s + e.tokensUsed, 0)

  const total = todayLocal + todayApi
  const localRatio = total > 0 ? todayLocal / total : 1

  const byProvider: Record<string, number> = {}
  for (const e of todayEntries) {
    byProvider[e.provider] = (byProvider[e.provider] || 0) + e.tokensUsed
  }

  return {
    today: { local: todayLocal, api: todayApi, totalTokens: todayTokens, cacheHits: 0 },
    week: { local: weekLocal, api: weekApi, totalTokens: weekTokens },
    localRatio,
    byProvider,
  }
}

// Ollama (Local) Configuration

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434'

/* Check if Ollama is available without throwing */
async function isOllamaAvailable(): Promise<boolean> {
  try {
    const res = await fetch(`${OLLAMA_BASE_URL}/api/tags`, { signal: AbortSignal.timeout(2000) })
    return res.ok
  } catch { return false }
}

// Model Preloading / Warmup
// Ollama loads models on first request (30-60s cold start on 8GB VRAM).
// Preloading sends a tiny request to force the model into VRAM ahead of time.
// Only one model fits in VRAM at once, so we preload the PRIMARY model
// (aegis-ai) on server startup and keep it warm.

let warmupDone = false
let lastWarmupModel = ''
const WARMUP_INTERVAL_MS = 4 * 60_000 // Re-warm every 4 min (Ollama default keep_alive = 5m)

/* Send a minimal request to load a model into GPU memory */
async function warmupModel(model: string): Promise<void> {
  try {
    const res = await fetch(`${OLLAMA_BASE_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt: 'hi', stream: false, options: { num_predict: 1 } }),
      signal: AbortSignal.timeout(120_000), // 2 min timeout for cold load
    })
    if (res.ok) {
      devLog(`[LLM] ?? Model ${model} warmed up — ready in VRAM`)
      lastWarmupModel = model
    }
  } catch (err: any) {
    devLog(`[LLM] ?? Warmup failed for ${model}: ${err.message}`)
  }
}

/* Pre-warm the primary model on server startup */
export async function startModelWarmup(): Promise<void> {
  if (warmupDone) return
  warmupDone = true

  const available = await isOllamaAvailable()
  if (!available) {
    devLog('[LLM] Ollama not available — skipping warmup')
    return
  }

  const primary = process.env.OLLAMA_PRIMARY_MODEL || 'qwen3:8b'
  devLog(`[LLM] ?? Pre-warming ${primary} into GPU...`)
  await warmupModel(primary)

  // Keep-alive ping: re-warm before Ollama evicts the model
  setInterval(async () => {
    const stillAvailable = await isOllamaAvailable()
    if (!stillAvailable) return
    try {
      // Just ping to reset keep_alive timer — no generation needed
      await fetch(`${OLLAMA_BASE_URL}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: lastWarmupModel || primary, prompt: '', stream: false, options: { num_predict: 0 } }),
        signal: AbortSignal.timeout(5000),
      })
    } catch {
      // Silent — non-critical
    }
  }, WARMUP_INTERVAL_MS)
}

/* Pre-warm a specific model before an expected request (e.g. after classification) */
export async function preloadModelForClassification(classification: QueryClassification): Promise<void> {
  const recommended = getRecommendedProviders(classification)
  const firstOllama = recommended.find(n => n.startsWith('ollama-'))
  if (!firstOllama) return

  // Determine which model this maps to
  const primary = process.env.OLLAMA_PRIMARY_MODEL || 'qwen3:8b'
  const fast = process.env.OLLAMA_FAST_MODEL || 'qwen3:4b'
  const specialist = process.env.OLLAMA_SPECIALIST_MODEL || 'qwen3:8b'

  const ultrafast = process.env.OLLAMA_ULTRAFAST_MODEL || 'qwen3:1.7b'

  const modelMap: Record<string, string> = {
    'ollama-primary': primary,
    'ollama-fast': fast,
    'ollama-specialist': specialist,
    'ollama-ultrafast': ultrafast,
  }

  const targetModel = modelMap[firstOllama]
  if (!targetModel || targetModel === lastWarmupModel) return // Already warm

  // Fire-and-forget — don't block the request pipeline
  warmupModel(targetModel).catch(() => {})
}

/* Ollama non-streaming chat */
async function callOllama(config: LLMProvider, req: LLMRequest): Promise<LLMResponse> {
  const start = Date.now()
  const isQwen3 = config.model.toLowerCase().includes('qwen3')

  // For qwen3 models: disable thinking mode to prevent German/wrong-language outputs
  // and prepend /no_think to system message as fallback
  const messages = isQwen3
    ? req.messages.map((m, i) => (
        i === 0 && m.role === 'system'
          ? { ...m, content: '/no_think\n\n' + m.content }
          : m
      ))
    : req.messages

  const body: Record<string, unknown> = {
    model: config.model,
    messages,
    stream: false,
    options: {
      temperature: req.temperature ?? 0.7,
      num_predict: req.maxTokens || config.maxTokens,
    },
  }
  if (isQwen3) (body as any).think = false

  const res = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const errBody = await res.text()
    throw new Error(`Ollama ${res.status}: ${errBody}`)
  }

  const data = await res.json() as any
  // Strip <think>...</think> blocks (qwen3 thinking mode leaks wrong-language reasoning)
  const raw = data.message?.content || ''
  const text = raw.replace(/<think>[\s\S]*?<\/think>/g, '').trim()
  const tokensUsed = (data.eval_count || 0) + (data.prompt_eval_count || 0)

  logTokenUsage({ provider: config.name, model: config.model, tokensUsed, timestamp: Date.now(), isLocal: true })

  return {
    content: text,
    model: config.model,
    provider: config.name as any,
    tokensUsed,
    latencyMs: Date.now() - start,
    finishReason: 'stop',
  }
}

/* Ollama SSE streaming chat */
async function callOllamaStream(config: LLMProvider, req: LLMRequest, handlers: StreamHandlers): Promise<LLMResponse> {
  const start = Date.now()
  let content = ''
  let tokensUsed = 0
  const isQwen3 = config.model.toLowerCase().includes('qwen3')

  // For qwen3 models: disable thinking mode to prevent German/wrong-language outputs
  const messages = isQwen3
    ? req.messages.map((m, i) => (
        i === 0 && m.role === 'system'
          ? { ...m, content: '/no_think\n\n' + m.content }
          : m
      ))
    : req.messages

  const body: Record<string, unknown> = {
    model: config.model,
    messages,
    stream: true,
    options: {
      temperature: req.temperature ?? 0.7,
      num_predict: req.maxTokens || config.maxTokens,
    },
  }
  if (isQwen3) (body as any).think = false

  const res = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: handlers.signal,
  })

  if (!res.ok || !res.body) {
    const errBody = await res.text()
    throw new Error(`Ollama stream ${res.status}: ${errBody}`)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    if (handlers.signal?.aborted) throw new Error('Streaming aborted')
    const { value, done } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''

    for (const line of lines) {
      if (!line.trim()) continue
      try {
        const data = JSON.parse(line)
        if (data.message?.content) {
          content += data.message.content
          // Strip <think>...</think> tokens from stream — qwen3 thinking leaks wrong-language text
          const cleaned = data.message.content.replace(/<think>[\s\S]*?<\/think>/g, '')
          if (cleaned) await handlers.onToken(cleaned)
        }
        if (data.done && data.eval_count) {
          tokensUsed = (data.eval_count || 0) + (data.prompt_eval_count || 0)
        }
      } catch { /* skip malformed JSON lines */ }
    }
  }

  logTokenUsage({ provider: config.name, model: config.model, tokensUsed, timestamp: Date.now(), isLocal: true })

  return {
    content,
    model: config.model,
    provider: config.name as any,
    tokensUsed,
    latencyMs: Date.now() - start,
    finishReason: 'stop',
  }
}

/* Build the provider list from environment variables at startup */
function initProviders(): void {
  if (providers.length > 0) return // already initialised

  // Ollama local models (zero cost — highest priority)
  const ollamaPrimary = process.env.OLLAMA_PRIMARY_MODEL || 'qwen3:8b'
  const ollamaFast = process.env.OLLAMA_FAST_MODEL || 'qwen3:4b'
  const ollamaSpecialist = process.env.OLLAMA_SPECIALIST_MODEL || 'qwen3:8b'
  const ollamaUltraFast = process.env.OLLAMA_ULTRAFAST_MODEL || 'qwen3:1.7b'
  const ollamaEnabled = process.env.OLLAMA_ENABLED !== 'false' // enabled by default

  const defs: LLMProvider[] = []

  if (ollamaEnabled) {
    defs.push(
      {
        name: 'ollama-primary',
        model: ollamaPrimary,
        apiKey: '',
        baseUrl: OLLAMA_BASE_URL,
        maxTokens: 8192,
        priority: 1,
        rateLimit: { requests: 1000, windowMs: 60_000 }, // effectively unlimited
        enabled: true,
      },
      {
        name: 'ollama-fast',
        model: ollamaFast,
        apiKey: '',
        baseUrl: OLLAMA_BASE_URL,
        maxTokens: 8192,
        priority: 2,
        rateLimit: { requests: 1000, windowMs: 60_000 },
        enabled: true,
      },
      {
        name: 'ollama-specialist',
        model: ollamaSpecialist,
        apiKey: '',
        baseUrl: OLLAMA_BASE_URL,
        maxTokens: 8192,
        priority: 3,
        rateLimit: { requests: 1000, windowMs: 60_000 },
        enabled: true,
      },
      {
        name: 'ollama-ultrafast',
        model: ollamaUltraFast,
        apiKey: '',
        baseUrl: OLLAMA_BASE_URL,
        maxTokens: 4096,
        priority: 4,
        rateLimit: { requests: 1000, windowMs: 60_000 },
        enabled: true,
      },
      {
        name: 'ollama-vision',
        model: process.env.OLLAMA_VISION_MODEL || 'llava:7b',
        apiKey: '',
        baseUrl: OLLAMA_BASE_URL,
        maxTokens: 4096,
        priority: 5,
        rateLimit: { requests: 1000, windowMs: 60_000 },
        enabled: true,
      },
    )
  }

  // Cloud fallbacks (free tiers) — upgraded April 2026 to most powerful free models
  defs.push(
    {
      name: 'gemini',
      model: process.env.GEMINI_MODEL || 'gemini-2.5-pro',           // Google's BEST model — free tier 25 RPD
      apiKey: process.env.GEMINI_API_KEY || '',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      maxTokens: 65536,
      priority: 10,
      rateLimit: { requests: 10, windowMs: 60_000 },     // 2.5 Pro free: ~10 RPM
      enabled: !!process.env.GEMINI_API_KEY,
    },
    {
      name: 'groq',
      model: process.env.GROQ_MODEL || 'qwen/qwen3-32b',            // Qwen3 32B — powerful reasoning on Groq
      apiKey: process.env.GROQ_API_KEY || '',
      baseUrl: 'https://api.groq.com/openai/v1',
      maxTokens: 32768,
      priority: 11,
      rateLimit: { requests: 30, windowMs: 60_000 },
      enabled: !!process.env.GROQ_API_KEY,
    },
    {
      name: 'openrouter',
      model: process.env.OPENROUTER_MODEL || 'nvidia/nemotron-3-super-120b-a12b:free', // 120B MoE — top free model
      apiKey: process.env.OPENROUTER_API_KEY || '',
      baseUrl: 'https://openrouter.ai/api/v1',
      maxTokens: 32768,
      priority: 12,
      rateLimit: { requests: 20, windowMs: 60_000 },
      enabled: !!process.env.OPENROUTER_API_KEY,
    },
    {
      name: 'huggingface',
      model: process.env.HF_LLM_MODEL || 'meta-llama/Meta-Llama-3-8B-Instruct',
      apiKey: process.env.HF_API_KEY || '',
      baseUrl: 'https://router.huggingface.co/hf-inference',
      maxTokens: 4096,
      priority: 13,
      rateLimit: { requests: 10, windowMs: 60_000 },
      enabled: !!process.env.HF_API_KEY,
    },
  )

  for (const config of defs.sort((a, b) => a.priority - b.priority)) {
    if (!config.enabled) continue
    providers.push({
      config,
      requestCount: 0,
      windowStart: Date.now(),
      lastError: null,
      lastErrorAt: null,
      consecutiveErrors: 0,
    })
  }

  if (providers.length === 0) {
    logger.error('[LLM] No LLM providers configured. Set GEMINI_API_KEY, GROQ_API_KEY, OPENROUTER_API_KEY, or HF_API_KEY in .env — chat/AI features will fail explicitly.')
  } else {
    devLog(`[LLM] ? ${providers.length} provider(s) ready: ${providers.map((p) => p.config.name).join(' ? ')}`)
  }
}

// —2  RATE-LIMIT TRACKING

function isRateLimited(state: ProviderState): boolean {
  const now = Date.now()
  const { requests, windowMs } = state.config.rateLimit

  // Reset window if expired
  if (now - state.windowStart >= windowMs) {
    state.requestCount = 0
    state.windowStart = now
  }

  return state.requestCount >= requests
}

function isBackedOff(state: ProviderState): boolean {
  if (state.consecutiveErrors === 0) return false
  // Circuit breaker: if 3+ consecutive failures, open circuit for 30s minimum
  if (state.consecutiveErrors >= 3) {
    const circuitOpenMs = 30_000
    return Date.now() - (state.lastErrorAt || 0) < circuitOpenMs
  }
  // Exponential backoff: 2^errors seconds, capped at 5 minutes
  const backoffMs = Math.min(2 ** state.consecutiveErrors * 1000, 300_000)
  return Date.now() - (state.lastErrorAt || 0) < backoffMs
}

function recordSuccess(state: ProviderState): void {
  state.requestCount++
  state.consecutiveErrors = 0
  state.lastError = null
}

function recordError(state: ProviderState, error: string): void {
  state.consecutiveErrors++
  state.lastError = error
  state.lastErrorAt = Date.now()
}

// —3  PROVIDER-SPECIFIC CALL IMPLEMENTATIONS

async function callGemini(config: LLMProvider, req: LLMRequest): Promise<LLMResponse> {
  const start = Date.now()

  // Convert messages to Gemini format
  const contents = req.messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }))

  const systemInstruction = req.messages.find((m) => m.role === 'system')

  const body: Record<string, unknown> = {
    contents,
    generationConfig: {
      maxOutputTokens: req.maxTokens || config.maxTokens,
      temperature: req.temperature ?? 0.7,
    },
  }

  if (systemInstruction) {
    body.systemInstruction = { parts: [{ text: systemInstruction.content }] }
  }

  const url = `${config.baseUrl}/models/${config.model}:generateContent?key=${config.apiKey}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const errBody = await res.text()
    throw new Error(`Gemini ${res.status}: ${errBody}`)
  }

  const data = await res.json() as any
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || ''
  const tokensUsed = data.usageMetadata?.totalTokenCount || 0

  return {
    content: text,
    model: config.model,
    provider: 'gemini',
    tokensUsed,
    latencyMs: Date.now() - start,
    finishReason: 'stop',
  }
}

async function parseSseStream(
  stream: ReadableStream<Uint8Array>,
  onEvent: (payload: string) => Promise<void> | void,
  signal?: AbortSignal,
): Promise<void> {
  const decoder = new TextDecoder()
  const reader = stream.getReader()
  let buffer = ''

  while (true) {
    if (signal?.aborted) {
      throw new Error('Streaming aborted')
    }

    const { value, done } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    let boundary = buffer.indexOf('\n\n')

    while (boundary !== -1) {
      const rawEvent = buffer.slice(0, boundary)
      buffer = buffer.slice(boundary + 2)

      const lines = rawEvent
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.startsWith('data:'))

      for (const line of lines) {
        const payload = line.replace(/^data:\s*/, '')
        if (!payload || payload === '[DONE]') continue
        await onEvent(payload)
      }

      boundary = buffer.indexOf('\n\n')
    }
  }
}

async function callGeminiStream(config: LLMProvider, req: LLMRequest, handlers: StreamHandlers): Promise<LLMResponse> {
  const start = Date.now()
  let content = ''

  const contents = req.messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }))

  const systemInstruction = req.messages.find((m) => m.role === 'system')

  const body: Record<string, unknown> = {
    contents,
    generationConfig: {
      maxOutputTokens: req.maxTokens || config.maxTokens,
      temperature: req.temperature ?? 0.7,
    },
  }

  if (systemInstruction) {
    body.systemInstruction = { parts: [{ text: systemInstruction.content }] }
  }

  const url = `${config.baseUrl}/models/${config.model}:streamGenerateContent?alt=sse&key=${config.apiKey}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: handlers.signal,
  })

  if (!res.ok || !res.body) {
    const errBody = await res.text()
    throw new Error(`Gemini ${res.status}: ${errBody}`)
  }

  await parseSseStream(res.body, async (payload) => {
    const data = JSON.parse(payload) as any
    const token = data.candidates?.[0]?.content?.parts?.[0]?.text || ''
    if (!token) return
    content += token
    await handlers.onToken(token)
  }, handlers.signal)

  return {
    content,
    model: config.model,
    provider: 'gemini',
    tokensUsed: Math.ceil(content.length / 4),
    latencyMs: Date.now() - start,
    finishReason: 'stop',
  }
}

async function callGroq(config: LLMProvider, req: LLMRequest): Promise<LLMResponse> {
  const start = Date.now()

  const body = {
    model: config.model,
    messages: req.messages,
    max_tokens: req.maxTokens || config.maxTokens,
    temperature: req.temperature ?? 0.7,
    stream: false,
  }

  const res = await fetch(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const errBody = await res.text()
    throw new Error(`Groq ${res.status}: ${errBody}`)
  }

  const data = await res.json() as any
  return {
    content: data.choices?.[0]?.message?.content || '',
    model: config.model,
    provider: 'groq',
    tokensUsed: data.usage?.total_tokens || 0,
    latencyMs: Date.now() - start,
    finishReason: data.choices?.[0]?.finish_reason || 'stop',
  }
}

async function callGroqStream(config: LLMProvider, req: LLMRequest, handlers: StreamHandlers): Promise<LLMResponse> {
  const start = Date.now()
  let content = ''

  const body = {
    model: config.model,
    messages: req.messages,
    max_tokens: req.maxTokens || config.maxTokens,
    temperature: req.temperature ?? 0.7,
    stream: true,
  }

  const res = await fetch(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(body),
    signal: handlers.signal,
  })

  if (!res.ok || !res.body) {
    const errBody = await res.text()
    throw new Error(`Groq ${res.status}: ${errBody}`)
  }

  await parseSseStream(res.body, async (payload) => {
    const data = JSON.parse(payload) as any
    const token = data.choices?.[0]?.delta?.content || ''
    if (!token) return
    content += token
    await handlers.onToken(token)
  }, handlers.signal)

  return {
    content,
    model: config.model,
    provider: 'groq',
    tokensUsed: Math.ceil(content.length / 4),
    latencyMs: Date.now() - start,
    finishReason: 'stop',
  }
}

async function callOpenRouter(config: LLMProvider, req: LLMRequest): Promise<LLMResponse> {
  const start = Date.now()

  const body = {
    model: config.model,
    messages: req.messages,
    max_tokens: req.maxTokens || config.maxTokens,
    temperature: req.temperature ?? 0.7,
  }

  const res = await fetch(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
      'HTTP-Referer': process.env.APP_URL || 'https://aegis.gov.uk',
      'X-Title': 'AEGIS Disaster Response',
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const errBody = await res.text()
    throw new Error(`OpenRouter ${res.status}: ${errBody}`)
  }

  const data = await res.json() as any
  return {
    content: data.choices?.[0]?.message?.content || '',
    model: config.model,
    provider: 'openrouter',
    tokensUsed: data.usage?.total_tokens || 0,
    latencyMs: Date.now() - start,
    finishReason: data.choices?.[0]?.finish_reason || 'stop',
  }
}

async function callOpenRouterStream(config: LLMProvider, req: LLMRequest, handlers: StreamHandlers): Promise<LLMResponse> {
  const start = Date.now()
  let content = ''

  const body = {
    model: config.model,
    messages: req.messages,
    max_tokens: req.maxTokens || config.maxTokens,
    temperature: req.temperature ?? 0.7,
    stream: true,
  }

  const res = await fetch(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
      'HTTP-Referer': process.env.APP_URL || 'https://aegis.gov.uk',
      'X-Title': 'AEGIS Disaster Response',
    },
    body: JSON.stringify(body),
    signal: handlers.signal,
  })

  if (!res.ok || !res.body) {
    const errBody = await res.text()
    throw new Error(`OpenRouter ${res.status}: ${errBody}`)
  }

  await parseSseStream(res.body, async (payload) => {
    const data = JSON.parse(payload) as any
    const token = data.choices?.[0]?.delta?.content || ''
    if (!token) return
    content += token
    await handlers.onToken(token)
  }, handlers.signal)

  return {
    content,
    model: config.model,
    provider: 'openrouter',
    tokensUsed: Math.ceil(content.length / 4),
    latencyMs: Date.now() - start,
    finishReason: 'stop',
  }
}

async function callHuggingFace(config: LLMProvider, req: LLMRequest): Promise<LLMResponse> {
  const start = Date.now()

  // HF Inference API uses a simpler text-generation format
  const prompt = req.messages.map((m) => {
    if (m.role === 'system') return `<|system|>\n${m.content}</s>\n`
    if (m.role === 'user') return `<|user|>\n${m.content}</s>\n`
    return `<|assistant|>\n${m.content}</s>\n`
  }).join('') + '<|assistant|>\n'

  const res = await fetch(`${config.baseUrl}/models/${config.model}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      inputs: prompt,
      parameters: {
        max_new_tokens: req.maxTokens || config.maxTokens,
        temperature: req.temperature ?? 0.7,
        return_full_text: false,
      },
    }),
  })

  if (!res.ok) {
    const errBody = await res.text()
    throw new Error(`HuggingFace ${res.status}: ${errBody}`)
  }

  const data = await res.json() as any
  const text = Array.isArray(data) ? data[0]?.generated_text || '' : data?.generated_text || ''

  return {
    content: text.trim(),
    model: config.model,
    provider: 'huggingface',
    tokensUsed: 0, // HF doesn't return token counts on free tier
    latencyMs: Date.now() - start,
    finishReason: 'stop',
  }
}

async function callHuggingFaceStream(
  config: LLMProvider,
  req: LLMRequest,
  handlers: StreamHandlers,
): Promise<LLMResponse> {
  const start = Date.now()

  // Format messages into a prompt
  const prompt = req.messages
    .map(m => {
      if (m.role === 'system') return `<|system|>\n${m.content}</s>`
      if (m.role === 'user') return `<|user|>\n${m.content}</s>`
      return `<|assistant|>\n${m.content}</s>`
    })
    .join('\n') + '\n<|assistant|>\n'

  const res = await fetchWithTimeout(`${config.baseUrl}/models/${config.model}`, {
    timeout: 30_000,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      inputs: prompt,
      parameters: {
        max_new_tokens: req.maxTokens || config.maxTokens,
        temperature: req.temperature || 0.7,
        return_full_text: false,
        stream: true,
      },
      stream: true,
    }),
    signal: handlers.signal,
  })

  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`HuggingFace stream ${res.status}: ${errText}`)
  }

  let fullText = ''
  const contentType = res.headers.get('content-type') || ''

  if (contentType.includes('text/event-stream') && res.body) {
    // Real SSE streaming
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        if (!line.startsWith('data:')) continue
        const data = line.slice(5).trim()
        if (data === '[DONE]') break

        try {
          const parsed = JSON.parse(data)
          const token = parsed.token?.text || parsed.generated_text || ''
          if (token && !token.includes('</s>') && !token.includes('<|')) {
            fullText += token
            await handlers.onToken(token)
          }
        } catch {
          // Skip unparseable SSE data lines
        }
      }
    }
  } else {
    // Non-streaming response (model doesn't support streaming) — simulate
    const data = await res.json() as any
    const text = Array.isArray(data) ? data[0]?.generated_text || '' : data?.generated_text || data?.[0]?.generated_text || ''
    fullText = text

    // Emit in small chunks to simulate streaming
    const words = text.split(/(\s+)/)
    for (const word of words) {
      if (word) await handlers.onToken(word)
    }
  }

  return {
    content: fullText,
    model: config.model,
    provider: config.name as any,
    tokensUsed: estimateTokens(fullText),
    latencyMs: Date.now() - start,
    finishReason: 'stop',
  }
}

/* Dispatch to the correct provider-specific implementation */
async function callProvider(config: LLMProvider, req: LLMRequest): Promise<LLMResponse> {
  switch (config.name) {
    case 'ollama-primary':
    case 'ollama-fast':
    case 'ollama-specialist':
    case 'ollama-ultrafast': return callOllama(config, req)
    case 'gemini': return callGemini(config, req)
    case 'groq': return callGroq(config, req)
    case 'openrouter': return callOpenRouter(config, req)
    case 'huggingface': return callHuggingFace(config, req)
    default: throw new Error(`Unknown LLM provider: ${config.name}`)
  }
}

async function callProviderStream(config: LLMProvider, req: LLMRequest, handlers: StreamHandlers): Promise<LLMResponse> {
  switch (config.name) {
    case 'ollama-primary':
    case 'ollama-fast':
    case 'ollama-specialist':
    case 'ollama-ultrafast': return callOllamaStream(config, req, handlers)
    case 'gemini': return callGeminiStream(config, req, handlers)
    case 'groq': return callGroqStream(config, req, handlers)
    case 'openrouter': return callOpenRouterStream(config, req, handlers)
    case 'huggingface': return callHuggingFaceStream(config, req, handlers)
    default: throw new Error(`Unknown LLM provider: ${config.name}`)
  }
}

// —3b  QUERY CLASSIFICATION & INTELLIGENT MODEL SELECTION
// Classifies incoming queries to route to the optimal Ollama model,
// or decide when cloud escalation is necessary.

export type QueryClassification =
  | 'LIFE_THREATENING'  // Must respond fast + accurately — use fastest available
  | 'EMERGENCY'         // Active emergency — prefer quality but speed matters
  | 'COMPLEX'           // Multi-step reasoning, tool use — prefer primary/cloud
  | 'REASONING'         // Deep analysis, comparisons — specialist (deepseek-r1)
  | 'CONVERSATIONAL'    // Follow-ups, clarifications — fast model is fine
  | 'SIMPLE_FACTUAL'    // Single-fact lookups — fast model or cache
  | 'TRAUMA'            // Post-traumatic distress — needs warmth + expertise
  | 'ABOUT_AEGIS'       // Questions about the platform, its creator, usage
  | 'GENERAL'           // Default bucket

// Enhanced Pattern Detection (multi-signal classification)

const LIFE_THREAT_PATTERNS = [
  /\b(drowning|can'?t breathe|heart attack|not breathing|choking|bleeding out|dying|dieing|dyin)\b/i,
  /\b(trapped|pinned|building collapsed|on fire|swept away)\b/i,
  /\b(overdose|seizure|unconscious|stroke|anaphyla)/i,
  /\b(electrocuted|hypotherm|frostbite|impaled|crush(ed|ing))\b/i,
  /\bgonna die\b/i,
]

const EMERGENCY_PATTERNS = [
  /\b(emergency|help me|sos|rescue|danger|urgent|evacuat)/i,
  /\b(flood(ing|ed)?|water rising|fire spreading|active shooter)\b/i,
  /\b(gas leak|explosion|tornado|tsunami|earthquake|landslide)\b/i,
  /\b(999|911|112|ambulance|fire brigade)\b/i,
]

const TRAUMA_PATTERNS = [
  /\b(can'?t sleep|nightmares?|flashback|ptsd|traumati[sz]ed)\b/i,
  /\b(lost everything|lost my home|lost my house)\b/i,
  /\b(survivor.?guilt|blame myself|should have done more)\b/i,
  /\b(scared|terrified|panic attack|anxiety|depressed|hopeless|suicid)/i,
  /\b(grief|griev|mourn|overwhelm|crying|can'?t cope|breaking down)\b/i,
  /\b(alone|isolated|no one to talk|don'?t know what to do)\b/i,
  // Mental health crisis — route to primary model for best quality
  /\b(kill myself|want to die|end it all|self.?harm|cutting|overdose)\b/i,
  /\b(don'?t want to live|no reason to live|better off dead|worth ?less)\b/i,
  /\b(therap|counsel|psycholog|mental health|mental illness)\b/i,
  /\b(domestic violence|abuse|abused|abusive|assault|raped?)\b/i,
  /\b(eating disorder|anorexia|bulimia|addict|substance abuse)\b/i,
  /\b(panic|dissociat|hyperventilat|intrusive thoughts|voices|paranoi)\b/i,
  /\b(hate myself|self loath|nobody cares|no one cares|unwanted|rejected)\b/i,
  /\b(empty|numb|falling apart|can'?t go on|giving up|no hope)\b/i,
  // Misspellings & variants people actually type in distress
  /\b(feel like dying|feel like dieing|wanna die|gonna die|ready to die)\b/i,
  /\b(di+e+i?n?g?|sui+ci+d|sel+f[- ]?ha?r+m|over ?dos)\b/i,
  /\b(hurt myself|hurting myself|harm myself|harming myself|end my life)\b/i,
  /\b(can'?t do this anymore|can'?t take this|don'?t care anymore)\b/i,
  /\b(life is not worth|what'?s the point|no point in living|tired of living)\b/i,
]

const COMPLEX_PATTERNS = [
  /\b(plan|strategy|checklist|step.?by.?step|comprehensive)\b/i,
  /\b(multiple|several|various|all the|everything)\b/i,
  /\band\b.*\band\b/i,  // Multiple conjunctions suggest multi-part query
]

const REASONING_PATTERNS = [
  /\b(compare|historical|analysis|explain why|how does|what causes)\b/i,
  /\b(difference between|pros and cons|trade.?off|evaluate|assess)\b/i,
  /\b(predict|forecast|likelihood|probability|risk assessment)\b/i,
  /\b(why did|what would happen|what if|scenario)\b/i,
]

const ABOUT_AEGIS_PATTERNS = [
  /\b(who (made|created|built|designed) (you|aegis|this))\b/i,
  /\b(what (is|are) (you|aegis))\b/i,
  /\b(about (you|aegis|this (platform|system|app|chatbot)))\b/i,
  /\b(your (creator|maker|developer|founder))\b/i,
  /\b(happiness|lazarus|shahana|robert gordon)\b/i,
  /\b(how (do|does|can) (i|we) use)\b/i,
  /\b(features?|capabilities|what can you do)\b/i,
  /\b(fav(ou?rite)?\s*(quote|saying|motto))\b/i,
  /\b(supervisor|dr\.?\s*shahana|shahana\s*bano)\b/i,
  /\b(who\s*(is|was)\s*(your|the)\s*(creator|maker|supervisor))\b/i,
  /\b(how old|age|birthday|born|nationality)\b/i,
  /\b(know (aegis|you|happiness))\b/i,
]

/**
 * Multi-signal query classification with confidence scoring.
 * Returns the classification with the highest weighted score.
 * Detects intent automatically — no manual logic required.
 */
export function classifyQuery(message: string): QueryClassification {
  const lower = message.toLowerCase()
  const len = message.length

  // PHASE 1: Hard priority — life-threatening always wins
  if (LIFE_THREAT_PATTERNS.some(p => p.test(lower))) return 'LIFE_THREATENING'

  // PHASE 2: Score-based classification for everything else
  const scores: Record<string, number> = {
    EMERGENCY: 0,
    TRAUMA: 0,
    REASONING: 0,
    COMPLEX: 0,
    ABOUT_AEGIS: 0,
    CONVERSATIONAL: 0,
    SIMPLE_FACTUAL: 0,
  }

  // Pattern matches (weighted)
  scores.EMERGENCY += EMERGENCY_PATTERNS.filter(p => p.test(lower)).length * 3
  scores.TRAUMA += TRAUMA_PATTERNS.filter(p => p.test(lower)).length * 2.5
  scores.REASONING += REASONING_PATTERNS.filter(p => p.test(lower)).length * 2
  scores.COMPLEX += COMPLEX_PATTERNS.filter(p => p.test(lower)).length * 2
  scores.ABOUT_AEGIS += ABOUT_AEGIS_PATTERNS.filter(p => p.test(lower)).length * 3

  // Message-length signals
  if (len < 30) scores.CONVERSATIONAL += 2
  if (len < 40 && /^(yes|no|ok|thanks|thank you|hello|hi|hey|sure|yep|nah|okay)\b/i.test(lower)) {
    scores.CONVERSATIONAL += 4
  }
  if (/^(what is|where is|when|how many|is there|do you know)\b/i.test(lower) && len < 120) {
    scores.SIMPLE_FACTUAL += 3
  }

  // Urgency signals boost EMERGENCY
  const excl = (message.match(/!/g) || []).length
  const capsRatio = message.replace(/[^A-Z]/g, '').length / Math.max(message.replace(/[^a-zA-Z]/g, '').length, 1)
  if (excl >= 2) scores.EMERGENCY += 1
  if (capsRatio > 0.5 && len > 10) scores.EMERGENCY += 1.5

  // Emotional language boosts TRAUMA
  const emotionalWords = lower.match(/\b(feel|feeling|felt|scared|afraid|worried|anxious|sad|empty|broken|numb|hopeless|helpless|desperate|miserable|suicidal)\b/g)
  if (emotionalWords) scores.TRAUMA += emotionalWords.length * 0.8

  // Crisis language safety net — dying/dieing/die with distress context
  if (/\b(die|dying|dieing|dyin|kill|suicid|harm|hurt)\b/i.test(lower) && /\b(i|my|me|myself|feel|want|gonna|wanna|going to)\b/i.test(lower)) {
    scores.TRAUMA += 5
  }

  // Long analytical queries boost REASONING/COMPLEX
  if (len > 150) {
    scores.REASONING += 0.5
    scores.COMPLEX += 0.5
  }
  if ((message.match(/\?/g) || []).length > 1) scores.COMPLEX += 1

  // Find the winner
  let best: string = 'GENERAL'
  let bestScore = 0
  for (const [cls, score] of Object.entries(scores)) {
    if (score > bestScore) {
      bestScore = score
      best = cls
    }
  }

  // Minimum threshold — need at least some signal
  if (bestScore < 1.5) return 'GENERAL'

  return best as QueryClassification
}

/**
 * Intelligent 4-tier model routing — matches query intent to optimal model:
 *   PRIMARY    (aegis-ai)             ? emergencies, trauma, identity — warm empathetic expert
 *   SPECIALIST (deepseek-r1:8b)      ? reasoning, analysis, complex comparisons — chain-of-thought
 *   FAST       (qwen3:8b)            ? balanced conversational, follow-ups, moderate complexity
 *   ULTRA-FAST (phi4-mini)            ? instant simple answers, greetings, factual lookups — 2.5GB lightning
 */
function getRecommendedProviders(classification: QueryClassification): string[] {
  switch (classification) {
    case 'LIFE_THREATENING':
      // No compromise — best model first, fast cloud backup
      return ['ollama-primary', 'gemini', 'groq', 'ollama-specialist']
    case 'EMERGENCY':
      // Quality + speed — primary local, cloud for overflow
      return ['ollama-primary', 'gemini', 'groq', 'ollama-specialist']
    case 'TRAUMA':
      // Warmth + expertise — needs the BEST model, never a small/fast one
      return ['ollama-primary', 'gemini', 'groq', 'openrouter', 'ollama-specialist']
    case 'REASONING':
      // Deep analysis — deepseek-r1 excels here with think-tokens
      return ['ollama-specialist', 'ollama-primary', 'gemini', 'groq']
    case 'COMPLEX':
      // Multi-step — specialist first, then primary, then cloud
      return ['ollama-specialist', 'ollama-primary', 'gemini', 'openrouter']
    case 'ABOUT_AEGIS':
      // Platform/creator/identity questions — MUST use primary (8b) model for full system prompt understanding
      return ['ollama-primary', 'ollama-specialist', 'gemini', 'groq']
    case 'CONVERSATIONAL':
      // Balanced conversation — qwen3 handles well, ultrafast as backup
      return ['ollama-fast', 'ollama-ultrafast', 'groq', 'ollama-primary']
    case 'SIMPLE_FACTUAL':
      // Minimal latency — phi4-mini loads in seconds, perfect for quick facts
      return ['ollama-ultrafast', 'ollama-fast', 'groq', 'ollama-primary']
    case 'GENERAL':
    default:
      return ['ollama-primary', 'ollama-fast', 'ollama-ultrafast', 'ollama-specialist', 'gemini', 'groq', 'openrouter', 'huggingface']
  }
}

/**
 * Get provider states ordered by recommendation for a classification.
 * Falls back to default priority order for any providers not in the recommendation list.
 */
function getOrderedProviders(classification?: QueryClassification): ProviderState[] {
  if (!classification) return providers

  const recommended = getRecommendedProviders(classification)
  const ordered: ProviderState[] = []
  const seen = new Set<string>()

  // First: add recommended providers in order
  for (const name of recommended) {
    const state = providers.find(p => p.config.name === name)
    if (state) {
      ordered.push(state)
      seen.add(name)
    }
  }

  // Then: add remaining providers in default priority order
  for (const state of providers) {
    if (!seen.has(state.config.name)) {
      ordered.push(state)
    }
  }

  return ordered
}

// —4  PUBLIC API

 /*
 * Send a chat completion request through the LLM rotation engine.
 * Tries providers in priority order, skipping rate-limited or
 * backed-off ones. Returns the first successful response.
 * @throws Error if ALL providers fail or none are configured.
  */
export async function chatCompletion(req: LLMRequest): Promise<LLMResponse> {
  initProviders()

  if (providers.length === 0) {
    throw new Error('No LLM providers configured. Please set at least one API key (GEMINI_API_KEY, GROQ_API_KEY, etc.) in .env')
  }

  const classification = (req as any).classification as QueryClassification | undefined
  const preferredProvider = req.preferredProvider
  let orderedProviders = getOrderedProviders(classification)

  if (preferredProvider) {
    const idx = orderedProviders.findIndex(p => p.config.name === preferredProvider)
    if (idx > 0) { const [p] = orderedProviders.splice(idx, 1); orderedProviders = [p, ...orderedProviders] }
  }

  const errors: string[] = []

  for (const state of orderedProviders) {
    if (isRateLimited(state)) {
      errors.push(`${state.config.name}: rate limited`)
      continue
    }
    if (isBackedOff(state)) {
      errors.push(`${state.config.name}: backed off (${state.consecutiveErrors} errors)`)
      continue
    }

    try {
      // Prepare messages for this provider's token budget
      const preparedReq = { ...req, messages: prepareMessagesForProvider(state.config.name, req.messages) }
      const response = await callProvider(state.config, preparedReq)
      recordSuccess(state)
      const isLocal = state.config.name.startsWith('ollama')
      logTokenUsage({ provider: state.config.name, model: state.config.model, tokensUsed: response.tokensUsed, timestamp: Date.now(), isLocal, queryClassification: (req as any).classification })
      devLog(`[LLM] ? ${state.config.name}/${state.config.model} — ${response.tokensUsed} tokens, ${response.latencyMs}ms${isLocal ? ' [LOCAL]' : ' [API]'}`)
      return response
    } catch (err: any) {
      const msg = err.message || String(err)
      recordError(state, msg)
      errors.push(`${state.config.name}: ${msg}`)
      logger.warn({ provider: state.config.name, error: msg }, '[LLM] Provider failed')
    }
  }

  throw new Error(`All LLM providers failed:\n${errors.join('\n')}`)
}

export async function chatCompletionStream(
  req: LLMRequest,
  handlers: StreamHandlers,
): Promise<LLMResponse> {
  initProviders()

  if (providers.length === 0) {
    throw new Error('No LLM providers configured. Please set at least one API key (GEMINI_API_KEY, GROQ_API_KEY, etc.) in .env')
  }

  const classification = (req as any).classification as QueryClassification | undefined
  const preferredProvider = req.preferredProvider
  let orderedProviders = getOrderedProviders(classification)

  if (preferredProvider) {
    const idx = orderedProviders.findIndex(p => p.config.name === preferredProvider)
    if (idx > 0) { const [p] = orderedProviders.splice(idx, 1); orderedProviders = [p, ...orderedProviders] }
  }

  const errors: string[] = []

  for (const state of orderedProviders) {
    if (isRateLimited(state)) {
      errors.push(`${state.config.name}: rate limited`)
      continue
    }
    if (isBackedOff(state)) {
      errors.push(`${state.config.name}: backed off (${state.consecutiveErrors} errors)`)
      continue
    }

    try {
      // Prepare messages for this provider's token budget
      const preparedReq = { ...req, messages: prepareMessagesForProvider(state.config.name, req.messages) }
      const response = await callProviderStream(state.config, preparedReq, handlers)
      recordSuccess(state)
      const isLocal = state.config.name.startsWith('ollama')
      logTokenUsage({ provider: state.config.name, model: state.config.model, tokensUsed: response.tokensUsed, timestamp: Date.now(), isLocal, queryClassification: (req as any).classification })
      devLog(`[LLM] ? stream ${state.config.name}/${state.config.model} — ${response.tokensUsed} tokens, ${response.latencyMs}ms${isLocal ? ' [LOCAL]' : ' [API]'}`)
      return response
    } catch (err: any) {
      const msg = err.message || String(err)
      if (msg === 'OUTPUT_MODERATION_BLOCK') {
        throw err
      }
      recordError(state, msg)
      errors.push(`${state.config.name}: ${msg}`)
      logger.warn({ provider: state.config.name, error: msg }, '[LLM] Stream provider failed')
    }
  }

  throw new Error(`All LLM providers failed:\n${errors.join('\n')}`)
}

 /*
 * Get status information about all configured providers.
 * Useful for the admin AI Transparency Dashboard.
  */
export function getProviderStatus(): Array<{
  name: string
  model: string
  enabled: boolean
  requestCount: number
  rateLimited: boolean
  backedOff: boolean
  consecutiveErrors: number
  lastError: string | null
}> {
  initProviders()
  return providers.map((s) => ({
    name: s.config.name,
    model: s.config.model,
    enabled: s.config.enabled,
    requestCount: s.requestCount,
    rateLimited: isRateLimited(s),
    backedOff: isBackedOff(s),
    consecutiveErrors: s.consecutiveErrors,
    lastError: s.lastError,
  }))
}

 /*
 * Get the name of the currently preferred (highest-priority available) provider.
  */
export function getPreferredProvider(): string | null {
  initProviders()
  for (const state of providers) {
    if (!isRateLimited(state) && !isBackedOff(state)) {
      return state.config.name
    }
  }
  return null
}

// —5  ENHANCED UTILITIES

/* Record a latency sample for a provider (keeps last 20) */
function trackLatency(providerName: string, latencyMs: number): void {
  let history = latencyTracker.get(providerName)
  if (!history) {
    history = []
    latencyTracker.set(providerName, history)
  }
  history.push(latencyMs)
  if (history.length > 20) {
    history.shift()
  }
}

// —5.1  STRUCTURED JSON OUTPUT MODE

/**
 * Send a chat completion that expects a JSON response.
 * Automatically instructs the LLM to respond with valid JSON,
 * parses the result, and retries once on parse failure.
 */
export async function chatCompletionJSON<T = any>(req: LLMRequest): Promise<{ parsed: T; raw: LLMResponse }> {
  const jsonInstruction = 'You MUST respond with valid JSON only. No markdown, no explanation, just a JSON object.'

  // Clone messages and prepend JSON instruction to system message
  const messages: LLMRequest['messages'] = req.messages.map((m) => ({ ...m }))
  const sysIdx = messages.findIndex((m) => m.role === 'system')
  if (sysIdx >= 0) {
    messages[sysIdx] = { ...messages[sysIdx], content: `${jsonInstruction}\n\n${messages[sysIdx].content}` }
  } else {
    messages.unshift({ role: 'system', content: jsonInstruction })
  }

  const modifiedReq: LLMRequest = { ...req, messages }
  const raw = await chatCompletion(modifiedReq)

  // Track latency
  trackLatency(raw.provider, raw.latencyMs)

  // Attempt to parse JSON from response
  const parsed = tryParseJSON<T>(raw.content)
  if (parsed !== undefined) {
    return { parsed, raw }
  }

  // Retry once with explicit correction
  const retryMessages: LLMRequest['messages'] = [
    ...modifiedReq.messages,
    { role: 'assistant', content: raw.content },
    { role: 'user', content: 'Your previous response was not valid JSON. Respond with ONLY a valid JSON object.' },
  ]

  const retryReq: LLMRequest = { ...req, messages: retryMessages }
  const retryRaw = await chatCompletion(retryReq)

  trackLatency(retryRaw.provider, retryRaw.latencyMs)

  const retryParsed = tryParseJSON<T>(retryRaw.content)
  if (retryParsed !== undefined) {
    return { parsed: retryParsed, raw: retryRaw }
  }

  throw new Error(`Failed to get valid JSON from LLM after retry. Last response: ${retryRaw.content.slice(0, 200)}`)
}

/* Try to parse JSON from a string, including extracting from markdown code blocks */
function tryParseJSON<T>(text: string): T | undefined {
  // Direct parse
  try {
    return JSON.parse(text) as T
  } catch {
    // ignore
  }

  // Try extracting from markdown code blocks: ```json ... ``` or ``` ...
  const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/)
  if (codeBlockMatch?.[1]) {
    try {
      return JSON.parse(codeBlockMatch[1].trim()) as T
    } catch {
      // ignore
    }
  }

  return undefined
}

// —5.1  PROVIDER-AWARE MESSAGE PREPARATION
// Cloud providers have much lower token budgets than local Ollama.
// This function condenses the system prompt and trims history to fit
// within the provider's input token limit, preserving the local-first
// architecture: local models get the full rich prompt, cloud APIs get
// a compact but equally effective version.

/* Token budget per provider (input tokens, not output) */
const PROVIDER_INPUT_LIMITS: Record<string, number> = {
  'ollama-primary': 32_000,
  'ollama-fast': 32_000,
  'ollama-specialist': 32_000,
  'ollama-ultrafast': 8_000,
  'gemini': 100_000,    // Gemini 2.5 Pro: 1M context — use generous budget
  'groq': 30_000,       // Qwen3-32B / Llama-3.3-70B: 131K context on Groq
  'openrouter': 30_000, // Nemotron-3 Super 120B: 262K context, free
  'huggingface': 6_000, // Llama-3-8B: 8K context on HF Inference
}

/* Condensed system prompt for token-constrained cloud providers */
function condenseSystemPrompt(fullPrompt: string): string {
  // Extract the non-overridable preamble (identity + safety)
  const preambleEnd = fullPrompt.indexOf('\n\nYou are AEGIS Assistant')
  const preamble = preambleEnd > 0 ? fullPrompt.slice(0, preambleEnd) : ''

  // Extract region info (last paragraph with emergency numbers)
  const regionMatch = fullPrompt.match(/Key facts about[\s\S]*?\.$/m)
  const regionInfo = regionMatch ? regionMatch[0] : ''

  // PRESERVE critical dynamic sections that must not be dropped
  // Image analysis results, emergency instructions, vision unavailability
  const preservedSections: string[] = []

  // Preserve image analysis context (vision AI results or unavailability notice)
  const imageAnalysisMatch = fullPrompt.match(/\n\n\[IMAGE (?:ANALYSIS COMPLETED|UPLOAD RECEIVED)[^\n]*\][\s\S]*?(?=\n\n\[|$)/)
  if (imageAnalysisMatch) preservedSections.push(imageAnalysisMatch[0])

  // Preserve emergency detection context
  const emergencyMatch = fullPrompt.match(/\n\n.{0,4}EMERGENCY DETECTED:[\s\S]*?(?=\n\n|$)/)
  if (emergencyMatch) preservedSections.push(emergencyMatch[0])

  // Preserve language instruction (both old and new format)
  const langMatch = fullPrompt.match(/\n\n=== LANGUAGE RULE ===[\s\S]*?===/) || fullPrompt.match(/\n\nIMPORTANT:.*(?:language code|respond.*English)[\s\S]*?(?=\n\n|$)/)
  if (langMatch) preservedSections.push(langMatch[0])

  const rAdapter = regionRegistry.getActiveRegion()
  const rMeta = rAdapter.getMetadata()
  const rLlm = rAdapter.getLLMContext()
  const crisisBlock = rLlm.crisisResources.map((r: { name: string; number: string }) => `${r.name}: ${r.number}`).join(', ')

  return `${preamble}

You are AEGIS Assistant — a smart, friendly AI for the AEGIS Universal Disaster Intelligence Platform. You specialise in emergency safety guidance for all hazard types (floods, storms, heatwaves, wildfires, landslides, earthquakes, power outages, water supply, chemical spills, public safety), but you can also answer general questions, math, greetings, and everyday queries helpfully.

Core rules:
- Lead with the most critical action first. Number all steps.
- NEVER give medical diagnoses or legal advice.
- Always recommend calling ${rMeta.emergencyNumber} for life-threatening emergencies.
- Be empathetic but factual — lives depend on accuracy.
- If unsure, say so and direct to official sources.
- Cite data sources when using tool results.
- Use bullet points. Be concise and specific.
- For non-emergency questions (math, greetings, general knowledge), answer naturally and helpfully.
- When image analysis results are provided below, trust and use them. NEVER fabricate image analysis.

Emergency Numbers (${rMeta.name}): ${rMeta.emergencyNumber} (emergency), ${crisisBlock}.

${regionInfo}${preservedSections.join('')}`.trim()
}

/**
 * Prepare LLM messages for a specific provider by:
 * 1. Condensing the system prompt for low-token providers
 * 2. Trimming conversation history to fit the token budget
 */
function prepareMessagesForProvider(
  providerName: string,
  messages: LLMRequest['messages'],
): LLMRequest['messages'] {
  const limit = PROVIDER_INPUT_LIMITS[providerName]
  if (!limit) return messages

  const isLocal = providerName.startsWith('ollama')

  // Local models: only trim if genuinely over limit
  if (isLocal) {
    const totalTokens = messages.reduce((s, m) => s + estimateTokens(m.content), 0)
    if (totalTokens <= limit) return messages
    return trimMessagesToFit([...messages], limit)
  }

  let prepared = [...messages]

  // Cloud providers with tight budgets (< 10k): ALWAYS condense the system prompt.
  // Estimators undercount by ~15%, so proactive condensing is required.
  const isTightBudget = limit < 10_000
  if (isTightBudget && prepared[0]?.role === 'system') {
    const systemTokens = estimateTokens(prepared[0].content)
    if (systemTokens > 500) {
      prepared[0] = { role: 'system', content: condenseSystemPrompt(prepared[0].content) }
      devLog(`[LLM] ?? Condensed system prompt for ${providerName}: ${systemTokens} ? ${estimateTokens(prepared[0].content)} tokens`)
    }
  }

  // Trim conversation history to fit remaining budget
  const totalAfterCondense = prepared.reduce((s, m) => s + estimateTokens(m.content), 0)
  if (totalAfterCondense > limit) {
    prepared = trimMessagesToFit(prepared, limit)
  }

  return prepared
}

// —5.2  TOKEN ESTIMATION & CONTEXT TRIMMING

/**
 * Estimate token count using improved heuristic.
 * Based on analysis of BPE tokenizer behavior across multiple models:
 * English text: ~1.3 tokens per word on average
 * Code/technical: ~1.5 tokens per word
 * URLs/paths: ~3 tokens per component
 * Numbers: 1 token per 1-3 digits
 * Punctuation: typically 1 token each
 * JSON/structured: ~1.8 tokens per word
 *
 * This approximates GPT-4/Claude tokenization within ~10% for typical text.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0

  // Count different token types
  const words = text.split(/\s+/).filter(Boolean)
  const codeIndicators = (text.match(/[{}\[\]();=<>]/g) || []).length
  const urlCount = (text.match(/https?:\/\/\S+/g) || []).length
  const jsonIndicators = (text.match(/"[^"]+"\s*:/g) || []).length
  const numberGroups = (text.match(/\d+/g) || []).length

  // Base: words * factor
  let factor = 1.3 // Default English text
  if (codeIndicators > words.length * 0.1) factor = 1.5   // Code-heavy
  if (jsonIndicators > 3) factor = 1.8                      // JSON-heavy

  let tokens = words.length * factor
  tokens += urlCount * 8         // URLs expand to ~10 tokens each
  tokens += numberGroups * 0.3   // Numbers add extra tokens
  tokens += codeIndicators * 0.2 // Punctuation adds tokens

  return Math.ceil(tokens)
}

/**
 * Trim a message array to fit within a token budget.
 * Always keeps the first (system) message and the last 4 messages.
 * Middle messages that exceed the budget are replaced with a summary.
 */
export function trimMessagesToFit(
  messages: LLMRequest['messages'],
  maxTokens: number,
): LLMRequest['messages'] {
  if (messages.length <= 5) return messages // Nothing to trim

  const totalTokens = messages.reduce((sum, m) => sum + estimateTokens(m.content), 0)
  if (totalTokens <= maxTokens) return messages

  // Always keep: first message (system) + last 4 messages (recent context)
  const systemMsg = messages[0]
  const recentMsgs = messages.slice(-4)
  const middleMsgs = messages.slice(1, -4)

  if (middleMsgs.length === 0) return messages

  // Summarize middle messages into a compact context note
  const topicKeywords = new Set<string>()
  for (const msg of middleMsgs) {
    // Extract key nouns/topics (simple heuristic: capitalized words + long words)
    const words = msg.content.split(/\s+/)
    for (const w of words) {
      const clean = w.replace(/[^a-zA-Z]/g, '')
      if (clean.length > 5 || (clean[0] === clean[0]?.toUpperCase() && clean.length > 2)) {
        topicKeywords.add(clean.toLowerCase())
      }
    }
  }

  const topics = [...topicKeywords].slice(0, 10).join(', ')
  const summaryMsg = {
    role: 'assistant' as const,
    content: `[Earlier in this conversation (${middleMsgs.length} messages omitted): Topics discussed included ${topics || 'general queries'}. The user has been asking about disaster preparedness and safety information.]`,
  }

  return [systemMsg, summaryMsg, ...recentMsgs]
}

// —5.3  INTELLIGENT PROVIDER SELECTION

/**
 * Score and select the best provider for a given request based on
 * latency, reliability, and query complexity.
 * Returns the provider name, or null if none available.
 */
export function selectBestProvider(req: LLMRequest): string | null {
  initProviders()

  const available = providers.filter((s) => !isRateLimited(s) && !isBackedOff(s))
  if (available.length === 0) return null

  // Estimate query complexity from total message token count
  const totalTokens = req.messages.reduce((sum, m) => sum + estimateTokens(m.content), 0)

  let bestScore = -1
  let bestProvider: string | null = null

  for (const state of available) {
    const name = state.config.name

    // Latency score: inverse of average latency (lower = better), default 500ms
    const history = latencyTracker.get(name)
    const avgLatency = history && history.length > 0
      ? history.reduce((a, b) => a + b, 0) / history.length
      : 500
    const latencyScore = 1000 / (avgLatency + 100) // Normalize, +100 to avoid division issues

    // Reliability score: inverse of consecutive errors
    const reliabilityScore = 1 / (1 + state.consecutiveErrors)

    // Capability score: higher for more capable models
    let capabilityScore: number
    switch (name) {
      case 'ollama-primary': // Llama 3.1 70B — GPT-3.5+ level
        capabilityScore = 1.2  // Prefer local over cloud
        break
      case 'gemini':
      case 'openrouter':
        capabilityScore = 1.0
        break
      case 'ollama-specialist': // Mistral Nemo 12B — excellent for drafts
        capabilityScore = 0.95
        break
      case 'groq':
        capabilityScore = 0.8
        break
      case 'ollama-fast': // Llama 3.2 3B — fast lookups only
        capabilityScore = 0.7
        break
      default:
        capabilityScore = 0.6
    }

    // Weight scores based on query complexity
    let score: number
    if (totalTokens > 500) {
      // Complex query: prefer capable, reliable providers
      score = capabilityScore * 0.5 + reliabilityScore * 0.3 + latencyScore * 0.2
    } else if (totalTokens < 200) {
      // Simple query: prefer fast providers
      score = latencyScore * 0.5 + reliabilityScore * 0.3 + capabilityScore * 0.2
    } else {
      // Medium: balanced
      score = latencyScore * 0.33 + reliabilityScore * 0.34 + capabilityScore * 0.33
    }

    if (score > bestScore) {
      bestScore = score
      bestProvider = name
    }
  }

  return bestProvider
}

// —5.4  RESPONSE QUALITY SCORING

/**
 * Score the quality of an LLM response on a 0-100 scale.
 * Checks for empty responses, truncation, refusals, and relevance.
 */
export function scoreResponseQuality(
  request: LLMRequest,
  response: LLMResponse,
): { score: number; issues: string[] } {
  const issues: string[] = []
  let score = 100

  // Check 1: Response length (not empty)
  if (response.content.length <= 10) {
    issues.push('Response is too short or empty')
    score -= 20
  }

  // Check 2: Doesn't end mid-sentence
  const trimmed = response.content.trim()
  const lastChar = trimmed[trimmed.length - 1]
  if (lastChar && !'.!?\n'.includes(lastChar)) {
    issues.push('Response appears truncated (ends mid-sentence)')
    score -= 20
  }

  // Check 3: No refusal patterns
  const lowerContent = response.content.toLowerCase()
  const refusalPatterns = ['i cannot', "i'm unable", 'i am unable', "i can't"]
  if (refusalPatterns.some((p) => lowerContent.includes(p))) {
    issues.push('Response contains a refusal pattern')
    score -= 20
  }

  // Check 4: Relevance — last user message shares at least 1 keyword with response
  const lastUserMsg = [...request.messages].reverse().find((m) => m.role === 'user')
  if (lastUserMsg) {
    const userWords = new Set(
      lastUserMsg.content
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w.length > 3) // Skip short words
    )
    const responseWords = response.content.toLowerCase().split(/\s+/)
    const sharedKeywords = responseWords.filter((w) => userWords.has(w))
    if (userWords.size > 0 && sharedKeywords.length === 0) {
      issues.push('Response may not be relevant to the query (no shared keywords)')
      score -= 20
    }
  }

  return { score: Math.max(0, score), issues }
}

// —5.5  PROVIDER HEALTH ENHANCED

/**
 * Get detailed health information for all configured providers,
 * including average latency, success rate, and health status.
 */
export function getProviderHealth(): Array<{
  name: string
  avgLatencyMs: number
  successRate: number
  isHealthy: boolean
}> {
  initProviders()

  return providers.map((state) => {
    const name = state.config.name
    const history = latencyTracker.get(name) || []

    const avgLatencyMs = history.length > 0
      ? Math.round(history.reduce((a, b) => a + b, 0) / history.length)
      : 0

    // Success rate: based on consecutive errors vs total tracked calls
    // If we have latency history, those were successes
    const successCount = history.length
    const totalCount = successCount + state.consecutiveErrors
    const successRate = totalCount > 0 ? successCount / totalCount : 1

    const isHealthy = successRate > 0.7 && avgLatencyMs < 10_000

    return { name, avgLatencyMs, successRate, isHealthy }
  })
}
