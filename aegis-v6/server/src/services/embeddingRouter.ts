/**
 * services/embeddingRouter.ts — Text embedding API rotation engine
 *
 * Generates vector embeddings for RAG (Retrieval-Augmented Generation).
 * Uses free-tier HuggingFace models by default, with Gemini and
 * OpenAI-compatible endpoints as fallbacks.
 *
 * Embeddings are stored in pgvector columns and used by the chat
 * system to find relevant documents for context injection.
 */

import type { EmbeddingRequest, EmbeddingResponse } from '../types/index.js'
import { devLog } from '../utils/logger.js'

interface EmbeddingProvider {
  name: string
  model: string
  apiKey: string
  baseUrl: string
  dimensions: number
  priority: number
  enabled: boolean
}

interface ProviderState {
  config: EmbeddingProvider
  requestCount: number
  windowStart: number
  consecutiveErrors: number
  lastErrorAt: number | null
}

const providers: ProviderState[] = []

function initProviders(): void {
  if (providers.length > 0) return

  const defs: EmbeddingProvider[] = [
    {
      name: 'huggingface',
      model: process.env.HF_EMBEDDING_MODEL || 'sentence-transformers/all-MiniLM-L6-v2',
      apiKey: process.env.HF_API_KEY || '',
      baseUrl: 'https://router.huggingface.co',
      dimensions: 384,
      priority: 1,
      enabled: !!process.env.HF_API_KEY,
    },
    {
      name: 'gemini',
      model: 'text-embedding-004',
      apiKey: process.env.GEMINI_API_KEY || '',
      baseUrl: 'https://generativelanguage.googleapis.com/v1',
      dimensions: 768,
      priority: 2,
      enabled: !!process.env.GEMINI_API_KEY,
    },
  ]

  for (const config of defs.sort((a, b) => a.priority - b.priority)) {
    if (!config.enabled) continue
    providers.push({
      config,
      requestCount: 0,
      windowStart: Date.now(),
      consecutiveErrors: 0,
      lastErrorAt: null,
    })
  }

  if (providers.length === 0) {
    console.error('[Embedding] ❌ No embedding providers configured. Set HF_API_KEY or GEMINI_API_KEY in .env')
  } else {
    devLog(`[Embedding] ✅ ${providers.length} provider(s): ${providers.map((p) => p.config.name).join(' → ')}`)
  }
}

async function callHuggingFace(config: EmbeddingProvider, texts: string[]): Promise<number[][]> {
  const res = await fetch(`${config.baseUrl}/pipeline/feature-extraction/${config.model}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({ inputs: texts, options: { wait_for_model: true } }),
  })

  if (!res.ok) throw new Error(`HF Embedding ${res.status}: ${await res.text()}`)
  const data = await res.json() as number[][][]

  // HF returns [batch][tokens][dims] — we need mean pooling over tokens
  return data.map((tokenEmbeddings) => {
    if (!Array.isArray(tokenEmbeddings[0])) return tokenEmbeddings as unknown as number[]
    const dims = (tokenEmbeddings[0] as number[]).length
    const result = new Array(dims).fill(0)
    for (const token of tokenEmbeddings) {
      for (let i = 0; i < dims; i++) result[i] += (token as number[])[i]
    }
    const len = tokenEmbeddings.length
    return result.map((v: number) => v / len)
  })
}

async function callGemini(config: EmbeddingProvider, texts: string[]): Promise<number[][]> {
  const url = `${config.baseUrl}/models/${config.model}:batchEmbedContents?key=${config.apiKey}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requests: texts.map((text) => ({
        model: `models/${config.model}`,
        content: { parts: [{ text }] },
      })),
    }),
  })

  if (!res.ok) throw new Error(`Gemini Embedding ${res.status}: ${await res.text()}`)
  const data = await res.json() as any
  return data.embeddings?.map((e: any) => e.values) || []
}

/**
 * Generate embeddings for one or more texts.
 * Rotates through providers on failure.
 */
export async function generateEmbeddings(req: EmbeddingRequest): Promise<EmbeddingResponse> {
  initProviders()

  if (providers.length === 0) {
    throw new Error('No embedding providers configured. Set HF_API_KEY or GEMINI_API_KEY.')
  }

  for (const state of providers) {
    // Skip if rate-limited or backed off
    const now = Date.now()
    if (now - state.windowStart >= 60_000) {
      state.requestCount = 0
      state.windowStart = now
    }
    if (state.requestCount >= 10) continue
    if (state.consecutiveErrors > 0) {
      const backoff = Math.min(2 ** state.consecutiveErrors * 1000, 120_000)
      if (now - (state.lastErrorAt || 0) < backoff) continue
    }

    try {
      let embeddings: number[][]
      if (state.config.name === 'huggingface') {
        embeddings = await callHuggingFace(state.config, req.texts)
      } else if (state.config.name === 'gemini') {
        embeddings = await callGemini(state.config, req.texts)
      } else {
        throw new Error(`Unknown embedding provider: ${state.config.name}`)
      }

      state.requestCount++
      state.consecutiveErrors = 0
      return {
        embeddings,
        model: state.config.model,
        provider: state.config.name,
        dimensions: state.config.dimensions,
      }
    } catch (err: any) {
      state.consecutiveErrors++
      state.lastErrorAt = Date.now()
      console.warn(`[Embedding] ⚠️  ${state.config.name} failed: ${err.message}`)
    }
  }

  throw new Error('All embedding providers failed.')
}

/**
 * Convenience: embed a single text and return its vector.
 */
export async function embedText(text: string): Promise<number[]> {
  const result = await generateEmbeddings({ texts: [text] })
  return result.embeddings[0]
}
