/**
 * services/classifierRouter.ts — Text classification API rotation engine
 *
 * Routes classification tasks (sentiment, fake detection, severity,
 * category, language, urgency) through HuggingFace Inference API models.
 * Each task maps to a specific fine-tuned model.
 *
 * Falls back gracefully: if HF is down or rate-limited, returns a
 * low-confidence "unknown" label so the pipeline never blocks.
 */

import type { ClassifierRequest, ClassifierResponse } from '../types/index.js'

// ═══════════════════════════════════════════════════════════════════════════════
// Task → HuggingFace model mapping
// ═══════════════════════════════════════════════════════════════════════════════

const TASK_MODELS: Record<string, string> = {
  sentiment: process.env.HF_SENTIMENT_MODEL || 'cardiffnlp/twitter-roberta-base-sentiment-latest',
  fake_detection: process.env.HF_FAKE_MODEL || 'roberta-base-openai-detector',
  severity: process.env.HF_SEVERITY_MODEL || 'distilbert-base-uncased-finetuned-sst-2-english',
  category: process.env.HF_CATEGORY_MODEL || 'facebook/bart-large-mnli',
  language: process.env.HF_LANGUAGE_MODEL || 'papluca/xlm-roberta-base-language-detection',
  urgency: process.env.HF_URGENCY_MODEL || 'facebook/bart-large-mnli',
}

const HF_API_KEY = process.env.HF_API_KEY || ''
const HF_BASE_URL = 'https://router.huggingface.co'

// Rate-limit tracking
let requestCount = 0
let windowStart = Date.now()
const MAX_REQUESTS_PER_MINUTE = 30

function checkRateLimit(): boolean {
  const now = Date.now()
  if (now - windowStart >= 60_000) {
    requestCount = 0
    windowStart = now
  }
  return requestCount < MAX_REQUESTS_PER_MINUTE
}

// ═══════════════════════════════════════════════════════════════════════════════
// §1  SENTIMENT ANALYSIS
// ═══════════════════════════════════════════════════════════════════════════════

async function classifySentiment(text: string): Promise<ClassifierResponse> {
  const model = TASK_MODELS.sentiment
  const start = Date.now()

  const res = await fetch(`${HF_BASE_URL}/models/${model}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${HF_API_KEY}`,
    },
    body: JSON.stringify({ inputs: text, options: { wait_for_model: true } }),
  })

  if (!res.ok) throw new Error(`HF Sentiment ${res.status}: ${await res.text()}`)
  const data = await res.json() as any[]

  // Response format: [[{label, score}, ...]]
  const scores = (Array.isArray(data[0]) ? data[0] : data) as Array<{ label: string; score: number }>
  const best = scores.reduce((a, b) => (a.score > b.score ? a : b))
  const allScores: Record<string, number> = {}
  for (const s of scores) allScores[s.label] = s.score

  return {
    label: best.label,
    score: best.score,
    allScores,
    model,
    provider: 'huggingface',
    latencyMs: Date.now() - start,
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// §2  FAKE DETECTION
// ═══════════════════════════════════════════════════════════════════════════════

async function classifyFake(text: string): Promise<ClassifierResponse> {
  const model = TASK_MODELS.fake_detection
  const start = Date.now()

  const res = await fetch(`${HF_BASE_URL}/models/${model}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${HF_API_KEY}`,
    },
    body: JSON.stringify({ inputs: text, options: { wait_for_model: true } }),
  })

  if (!res.ok) throw new Error(`HF Fake ${res.status}: ${await res.text()}`)
  const data = await res.json() as any[]

  const scores = (Array.isArray(data[0]) ? data[0] : data) as Array<{ label: string; score: number }>
  const fakeScore = scores.find((s) => s.label === 'LABEL_0' || s.label.toLowerCase().includes('fake'))
  const allScores: Record<string, number> = {}
  for (const s of scores) allScores[s.label] = s.score

  return {
    label: (fakeScore?.score || 0) > 0.5 ? 'fake' : 'genuine',
    score: fakeScore?.score || 0,
    allScores,
    model,
    provider: 'huggingface',
    latencyMs: Date.now() - start,
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// §3  ZERO-SHOT CLASSIFICATION (severity, category, urgency)
// ═══════════════════════════════════════════════════════════════════════════════

async function classifyZeroShot(
  text: string,
  candidateLabels: string[],
  model: string,
): Promise<ClassifierResponse> {
  const start = Date.now()

  const res = await fetch(`${HF_BASE_URL}/models/${model}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${HF_API_KEY}`,
    },
    body: JSON.stringify({
      inputs: text,
      parameters: { candidate_labels: candidateLabels },
      options: { wait_for_model: true },
    }),
  })

  if (!res.ok) throw new Error(`HF ZeroShot ${res.status}: ${await res.text()}`)
  const data = await res.json() as { labels: string[]; scores: number[] }

  const allScores: Record<string, number> = {}
  for (let i = 0; i < data.labels.length; i++) {
    allScores[data.labels[i]] = data.scores[i]
  }

  return {
    label: data.labels[0],
    score: data.scores[0],
    allScores,
    model,
    provider: 'huggingface',
    latencyMs: Date.now() - start,
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// §4  LANGUAGE DETECTION
// ═══════════════════════════════════════════════════════════════════════════════

async function classifyLanguage(text: string): Promise<ClassifierResponse> {
  const model = TASK_MODELS.language
  const start = Date.now()

  const res = await fetch(`${HF_BASE_URL}/models/${model}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${HF_API_KEY}`,
    },
    body: JSON.stringify({ inputs: text, options: { wait_for_model: true } }),
  })

  if (!res.ok) throw new Error(`HF Language ${res.status}: ${await res.text()}`)
  const data = await res.json() as any[]

  const scores = (Array.isArray(data[0]) ? data[0] : data) as Array<{ label: string; score: number }>
  const best = scores.reduce((a, b) => (a.score > b.score ? a : b))
  const allScores: Record<string, number> = {}
  for (const s of scores) allScores[s.label] = s.score

  return {
    label: best.label,
    score: best.score,
    allScores,
    model,
    provider: 'huggingface',
    latencyMs: Date.now() - start,
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// §5  PUBLIC API
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Classify text for the given task. Routes to the appropriate model
 * and returns a standardised ClassifierResponse.
 *
 * Falls back to a low-confidence 'unknown' result if HF is unavailable.
 */
export async function classify(req: ClassifierRequest): Promise<ClassifierResponse> {
  if (!HF_API_KEY) {
    return {
      label: 'unknown',
      score: 0,
      allScores: {},
      model: 'none',
      provider: 'none',
      latencyMs: 0,
    }
  }

  if (!checkRateLimit()) {
    console.warn('[Classifier] Rate limited — returning fallback')
    return {
      label: 'unknown',
      score: 0,
      allScores: {},
      model: TASK_MODELS[req.task] || 'none',
      provider: 'huggingface',
      latencyMs: 0,
    }
  }

  requestCount++

  try {
    switch (req.task) {
      case 'sentiment':
        return await classifySentiment(req.text)

      case 'fake_detection':
        return await classifyFake(req.text)

      case 'severity':
        return await classifyZeroShot(
          req.text,
          ['low severity', 'medium severity', 'high severity', 'critical severity'],
          TASK_MODELS.severity,
        )

      case 'category':
        return await classifyZeroShot(
          req.text,
          ['flood', 'fire', 'storm', 'earthquake', 'medical emergency', 'infrastructure failure', 'other'],
          TASK_MODELS.category,
        )

      case 'language':
        return await classifyLanguage(req.text)

      case 'urgency':
        return await classifyZeroShot(
          req.text,
          ['not urgent', 'somewhat urgent', 'urgent', 'extremely urgent'],
          TASK_MODELS.urgency,
        )

      default:
        throw new Error(`Unknown classification task: ${req.task}`)
    }
  } catch (err: any) {
    console.error(`[Classifier] ${req.task} failed: ${err.message}`)
    return {
      label: 'unknown',
      score: 0,
      allScores: {},
      model: TASK_MODELS[req.task] || 'none',
      provider: 'huggingface',
      latencyMs: 0,
    }
  }
}

/**
 * Batch-classify multiple texts for the same task.
 * Processes sequentially to respect rate limits.
 */
export async function batchClassify(
  texts: string[],
  task: ClassifierRequest['task'],
): Promise<ClassifierResponse[]> {
  const results: ClassifierResponse[] = []
  for (const text of texts) {
    results.push(await classify({ text, task }))
  }
  return results
}
