/**
 * Multi-provider vector embedding router for Retrieval-Augmented Generation (RAG).
 * Converts text into numeric vectors so semantically similar documents can be
 * found by comparing vector distances. Tries providers in priority order:
 *   0. Ollama (local, free, 768-dimensional nomic-embed-text)
 *   1. HuggingFace Inference API (all-MiniLM-L6-v2, 384d)
 *   2. Gemini (text-embedding-004, 768d)
 * Automatically backs off failed providers using exponential back-off.
 *
 * How it works:
 * Providers are sorted by priority once at startup (initProviders).
 * generateEmbeddings() iterates the list, skipping any provider that is
 * rate-limited or currently in a back-off window. On success it resets the
 * consecutive-error counter; on failure it increments it (capping backoff at 2 min).
 *
 * - Called by server/src/services/chatService.ts for RAG context retrieval
 * - Called by server/src/services/ragExpansionService.ts to embed queries
 * - embedText() is a thin convenience wrapper around generateEmbeddings()
 * - Vectors are stored in Postgres pgvector columns for cosine similarity search
 * */

import type { EmbeddingRequest, EmbeddingResponse } from '../types/index.js'
import { devLog } from '../utils/logger.js'
import { logger } from './logger.js'

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

// Providers are initialised lazily on first call to generateEmbeddings().
// Using a module-level array as a simple registry (no class needed).
const providers: ProviderState[] = []

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434'

// Build the provider list from environment variables.
// Called once and returns early if already populated.
function initProviders(): void {
  if (providers.length > 0) return

  const defs: EmbeddingProvider[] = []

  // Ollama local embedding — zero cost, highest priority; disabled via OLLAMA_ENABLED=false
  const ollamaEmbModel = process.env.OLLAMA_EMBEDDING_MODEL || 'nomic-embed-text'
  const ollamaEnabled = process.env.OLLAMA_ENABLED !== 'false'
  if (ollamaEnabled) {
    defs.push({
      name: 'ollama',
      model: ollamaEmbModel,
      apiKey: '',
      baseUrl: OLLAMA_BASE_URL,
      dimensions: 768,
      priority: 0,
      enabled: true,
    })
  }

  defs.push(
    {
      name: 'huggingface',
      model: process.env.HF_EMBEDDING_MODEL || 'sentence-transformers/all-MiniLM-L6-v2',
      apiKey: process.env.HF_API_KEY || '',
      baseUrl: 'https://router.huggingface.co/hf-inference',
      dimensions: 384,
      priority: 1,
      enabled: !!process.env.HF_API_KEY,
    },
    {
      name: 'gemini',
      model: 'text-embedding-004',
      apiKey: process.env.GEMINI_API_KEY || '',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      dimensions: 768,
      priority: 2,
      enabled: !!process.env.GEMINI_API_KEY,
    },
  )

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
    logger.error('[Embedding] No embedding providers configured. Set HF_API_KEY or GEMINI_API_KEY in .env')
  } else {
    devLog(`[Embedding] ? ${providers.length} provider(s): ${providers.map((p) => p.config.name).join(' ? ')}`)
  }
}

// Ollama API uses a different request shape: one text per call, no batch endpoint.
// We loop rather than batch because Ollama's /api/embeddings only accepts a single 'prompt'.
async function callOllamaEmbedding(config: EmbeddingProvider, texts: string[]): Promise<number[][]> {
  const results: number[][] = []
  for (const text of texts) {
    const res = await fetch(`${config.baseUrl}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: config.model, prompt: text }),
    })
    if (!res.ok) throw new Error(`Ollama Embedding ${res.status}: ${await res.text()}`)
    const data = await res.json() as { embedding: number[] }
    results.push(data.embedding)
  }
  return results
}

// HuggingFace returns a 3D tensor [batch_size][token_count][dimensions].
// We mean-pool across the token dimension to get a single fixed-size vector per text.
// This matches how sentence-transformers compute sentence embeddings.
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

  // HF returns [batch][tokens][dims] — mean-pool across the token axis to get [batch][dims]
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
 * Generate embeddings for one or more texts using the highest-priority available provider.
 * Automatically falls over to the next provider on rate-limit or error.
 * Returns the raw embedding matrix along with the provider and dimension count used.
 */
export async function generateEmbeddings(req: EmbeddingRequest): Promise<EmbeddingResponse> {
  initProviders()

  if (providers.length === 0) {
    throw new Error('No embedding providers configured. Set HF_API_KEY or GEMINI_API_KEY.')
  }

  for (const state of providers) {
    // Reset the per-minute request counter when the window has expired
    const now = Date.now()
    if (now - state.windowStart >= 60_000) {
      state.requestCount = 0
      state.windowStart = now
    }
    // Skip if this provider has hit its rate limit (10 req/min per provider)
    if (state.requestCount >= 10) continue
    // Exponential back-off: 2^errors seconds, capped at 2 minutes
    if (state.consecutiveErrors > 0) {
      const backoff = Math.min(2 ** state.consecutiveErrors * 1000, 120_000)
      if (now - (state.lastErrorAt || 0) < backoff) continue
    }

    try {
      let embeddings: number[][]
      if (state.config.name === 'ollama') {
        embeddings = await callOllamaEmbedding(state.config, req.texts)
      } else if (state.config.name === 'huggingface') {
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
      logger.warn({ err, provider: state.config.name }, '[Embedding] Provider failed')
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
