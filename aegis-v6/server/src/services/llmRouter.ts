/**
 * services/llmRouter.ts — Free LLM API rotation engine
 *
 * Routes LLM requests through a priority-ordered list of free API
 * providers. When a provider hits its rate limit or errors, the router
 * automatically falls through to the next one. This ensures the
 * chatbot and AI analysis features stay online without paid API keys.
 *
 * Provider priority (configurable via env):
 *   1. Google Gemini 1.5 Flash (free tier: 15 RPM / 1M tokens/day)
 *   2. Groq (Llama 3.1 8B — free tier: 30 RPM / 14.4K tokens/min)
 *   3. OpenRouter (free models — varies by model)
 *   4. HuggingFace Inference API (free tier: rate-limited)
 *
 * Each provider implements a common interface. The router tracks
 * rate-limit state per-provider and skips exhausted ones.
 */

import type { LLMRequest, LLMResponse, LLMProvider } from '../types/index.js'
import { devLog } from '../utils/logger.js'

// ═══════════════════════════════════════════════════════════════════════════════
// §1  PROVIDER REGISTRY
// ═══════════════════════════════════════════════════════════════════════════════

interface ProviderState {
  config: LLMProvider
  requestCount: number
  windowStart: number
  lastError: string | null
  lastErrorAt: number | null
  consecutiveErrors: number
}

const providers: ProviderState[] = []

/** Build the provider list from environment variables at startup */
function initProviders(): void {
  if (providers.length > 0) return // already initialised

  const defs: LLMProvider[] = [
    {
      name: 'gemini',
      model: process.env.GEMINI_MODEL || 'gemini-2.0-flash',
      apiKey: process.env.GEMINI_API_KEY || '',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      maxTokens: 8192,
      priority: 1,
      rateLimit: { requests: 15, windowMs: 60_000 },
      enabled: !!process.env.GEMINI_API_KEY,
    },
    {
      name: 'groq',
      model: process.env.GROQ_MODEL || 'llama-3.1-8b-instant',
      apiKey: process.env.GROQ_API_KEY || '',
      baseUrl: 'https://api.groq.com/openai/v1',
      maxTokens: 8192,
      priority: 2,
      rateLimit: { requests: 30, windowMs: 60_000 },
      enabled: !!process.env.GROQ_API_KEY,
    },
    {
      name: 'openrouter',
      model: process.env.OPENROUTER_MODEL || 'meta-llama/llama-3.1-8b-instruct:free',
      apiKey: process.env.OPENROUTER_API_KEY || '',
      baseUrl: 'https://openrouter.ai/api/v1',
      maxTokens: 4096,
      priority: 3,
      rateLimit: { requests: 20, windowMs: 60_000 },
      enabled: !!process.env.OPENROUTER_API_KEY,
    },
    {
      name: 'huggingface',
      model: process.env.HF_LLM_MODEL || 'mistralai/Mistral-7B-Instruct-v0.3',
      apiKey: process.env.HF_API_KEY || '',
      baseUrl: 'https://router.huggingface.co',
      maxTokens: 2048,
      priority: 4,
      rateLimit: { requests: 10, windowMs: 60_000 },
      enabled: !!process.env.HF_API_KEY,
    },
  ]

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
    console.error('[LLM] ❌ No LLM providers configured. Set GEMINI_API_KEY, GROQ_API_KEY, OPENROUTER_API_KEY, or HF_API_KEY in .env — chat/AI features will fail explicitly.')
  } else {
    devLog(`[LLM] ✅ ${providers.length} provider(s) ready: ${providers.map((p) => p.config.name).join(' → ')}`)
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// §2  RATE-LIMIT TRACKING
// ═══════════════════════════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════════════════════════
// §3  PROVIDER-SPECIFIC CALL IMPLEMENTATIONS
// ═══════════════════════════════════════════════════════════════════════════════

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

/** Dispatch to the correct provider-specific implementation */
async function callProvider(config: LLMProvider, req: LLMRequest): Promise<LLMResponse> {
  switch (config.name) {
    case 'gemini': return callGemini(config, req)
    case 'groq': return callGroq(config, req)
    case 'openrouter': return callOpenRouter(config, req)
    case 'huggingface': return callHuggingFace(config, req)
    default: throw new Error(`Unknown LLM provider: ${config.name}`)
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// §4  PUBLIC API
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Send a chat completion request through the LLM rotation engine.
 * Tries providers in priority order, skipping rate-limited or
 * backed-off ones. Returns the first successful response.
 *
 * @throws Error if ALL providers fail or none are configured.
 */
export async function chatCompletion(req: LLMRequest): Promise<LLMResponse> {
  initProviders()

  if (providers.length === 0) {
    throw new Error('No LLM providers configured. Please set at least one API key (GEMINI_API_KEY, GROQ_API_KEY, etc.) in .env')
  }

  const errors: string[] = []

  for (const state of providers) {
    if (isRateLimited(state)) {
      errors.push(`${state.config.name}: rate limited`)
      continue
    }
    if (isBackedOff(state)) {
      errors.push(`${state.config.name}: backed off (${state.consecutiveErrors} errors)`)
      continue
    }

    try {
      const response = await callProvider(state.config, req)
      recordSuccess(state)
      devLog(`[LLM] ✅ ${state.config.name}/${state.config.model} — ${response.tokensUsed} tokens, ${response.latencyMs}ms`)
      return response
    } catch (err: any) {
      const msg = err.message || String(err)
      recordError(state, msg)
      errors.push(`${state.config.name}: ${msg}`)
      console.warn(`[LLM] ⚠️  ${state.config.name} failed: ${msg}`)
    }
  }

  throw new Error(`All LLM providers failed:\n${errors.join('\n')}`)
}

/**
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

/**
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
