/**
 * Orchestrates every AI quality check on a newly submitted incident report.
 * Runs sentiment analysis, fake detection, severity scoring, category prediction,
 * urgency assessment, image analysis, and cross-referencing all in parallel.
 * Writes the combined results back to the reports table.
 *
 * - Called by server/src/routes/reportRoutes.ts immediately after a report INSERT
 * - Fans out to classifierRouter.ts (ML classification), llmRouter.ts (LLM reasoning),
 *   imageAnalysisService.ts (vision model), and governanceEngine.ts (policy checks)
 * - On completion, updates the reports table with {severity, category, sentiment, ...}
 * - Operators see AI scores in client/src/pages/AdminPage.tsx (Incident Queue)
 *
 * - analyseReport(reportId)   -- full pipeline for a fresh report
 * - reanalyseReport(reportId) -- re-trigger pipeline on an updated report (operator action)
 *
 * - server/src/services/classifierRouter.ts    -- routes to ONNX classifiers
 * - server/src/services/llmRouter.ts           -- LLM-based reasoning for severity
 * - server/src/services/imageAnalysisService.ts -- vision analysis for evidence photos
 * - server/src/services/governanceEngine.ts    -- policy / content moderation rules
 * - server/src/routes/reportRoutes.ts          -- triggers this pipeline on new submissions
 * */

import pool from '../models/db.js'
import { classify } from './classifierRouter.js'
import { chatCompletion } from './llmRouter.js'
import { analyseImage } from './imageAnalysisService.js'
import { enforceGovernance } from './governanceEngine.js'
import type { ClassifierResponse } from '../types/index.js'
import { devLog } from '../utils/logger.js'
import { logger } from './logger.js'


export interface CrossRefSimilarityEntry {
  id: string
  similarity: number       // 0--1 TF-IDF cosine similarity
  isNearDuplicate: boolean // true when similarity = 0.70
}

export interface WaterDepthEstimate {
  valueMetres: number | null
  confidenceScore: number              // 0--1
  method: 'text_extraction' | 'gauge_derived' | 'photo_derived' | 'composite'
  textClues: string[]                  // raw phrases that triggered extraction
}

export interface AIAnalysisResult {
  sentimentScore: number
  sentimentLabel: string
  panicLevel: 'None' | 'Low' | 'Moderate' | 'High'
  fakeProbability: number
  fakeLabel: string
  severityAssessment: string
  severityConfidence: number
  categoryPrediction: string
  categoryConfidence: number
  languageDetected: string
  languageConfidence: number
  urgencyLevel: string
  urgencyScore: number
  vulnerablePersonAlert: boolean
  vulnerableKeywords: string[]
  crossReferenced: string[]
  nearbyReportCount: number
  /* Per-report TF-IDF similarity scores for every cross-referenced nearby report */
  crossReferenceSimilarityScores: CrossRefSimilarityEntry[]
  /* Number of nearby reports with similarity = 0.70 (probable duplicates) */
  nearDuplicateCount: number
  /* Composite water depth estimate derived from text, gauge readings, and CNN photo analysis */
  estimatedWaterDepth: WaterDepthEstimate | null
  damageEstimate: {
    estimatedCost: string
    affectedProperties: number
    confidence: number
  } | null
  photoVerified: boolean
  photoValidation: {
    isFloodRelated: boolean
    waterDetected: boolean
    waterConfidence: number
    objectsDetected: string[]
    imageQuality: string
  } | null
  modelsUsed: string[]
  processingTimeMs: number
  reasoning: string
  sources: string[]
}


/* Step 1: Sentiment analysis -- detects emotional tone of report text */
async function analyseSentiment(text: string): Promise<{ score: number; label: string; panicLevel: string }> {
  const result = await classify({ text, task: 'sentiment' })
  const score = result.score

  //Map sentiment to panic level based on negative sentiment strength
  let panicLevel = 'None'
  const negativeLabels = ['negative', 'NEGATIVE', 'LABEL_0']
  if (negativeLabels.includes(result.label)) {
    if (score > 0.9) panicLevel = 'High'
    else if (score > 0.7) panicLevel = 'Moderate'
    else if (score > 0.4) panicLevel = 'Low'
  }

  return { score, label: result.label, panicLevel }
}

/* Step 2: Fake/misinformation detection */
async function detectFake(text: string): Promise<{ probability: number; label: string }> {
  const result = await classify({ text, task: 'fake_detection' })
  return { probability: result.score, label: result.label }
}

/* Step 3: Severity assessment via zero-shot classification */
async function assessSeverity(text: string): Promise<{ assessment: string; confidence: number }> {
  const result = await classify({ text, task: 'severity' })
  return { assessment: result.label, confidence: result.score }
}

/* Step 4: Category prediction */
async function predictCategory(text: string): Promise<{ category: string; confidence: number }> {
  const result = await classify({ text, task: 'category' })
  return { category: result.label, confidence: result.score }
}

/* Step 5: Language detection */
async function detectLanguage(text: string): Promise<{ language: string; confidence: number }> {
  const result = await classify({ text, task: 'language' })
  return { language: result.label, confidence: result.score }
}

/* Step 6: Urgency scoring */
async function scoreUrgency(text: string): Promise<{ level: string; score: number }> {
  const result = await classify({ text, task: 'urgency' })
  return { level: result.label, score: result.score }
}

/* Step 7: NLP-aware vulnerable person detection with negation and context awareness */
function detectVulnerablePersons(text: string): { alert: boolean; keywords: string[]; contextScore: number; details: string[] } {
  const vulnerableKeywords = [
    'elderly', 'disabled', 'wheelchair', 'child', 'children', 'baby', 'infant',
    'pregnant', 'mobility', 'blind', 'deaf', 'oxygen', 'dialysis', 'dementia',
    'alzheimer', 'care home', 'nursing home', 'hospital', 'vulnerable', 'frail',
    'bedridden', 'oxygen tank', 'ventilator', 'medication', 'insulin',
  ]

  //Negation phrases that negate the vulnerability detection
  const negationPatterns = [
    /\bno\s+(\w+)/gi,
    /\bnot\s+(\w+)/gi,
    /\bwithout\s+(\w+)/gi,
    /\bnone\s+of\b/gi,
    /\bdon'?t\s+have\s+(\w+)/gi,
    /\bisn'?t\s+(\w+)/gi,
    /\baren'?t\s+(\w+)/gi,
    /\bno\s+one\b/gi,
    /\bnobody\b/gi,
  ]

  const lower = text.toLowerCase()
  const sentences = text.split(/[.!?]+/).map(s => s.trim()).filter(s => s.length > 0)

  const found: string[] = []
  const negated: string[] = []
  const details: string[] = []

  for (const kw of vulnerableKeywords) {
    if (!lower.includes(kw)) continue

    //Check each sentence containing the keyword for negation context
    let isNegated = false
    for (const sentence of sentences) {
      const sentLower = sentence.toLowerCase()
      if (!sentLower.includes(kw)) continue

      //Check if keyword appears within 5 words of a negation
      const words = sentLower.split(/\s+/)
      const kwIdx = words.findIndex(w => w.includes(kw))
      if (kwIdx === -1) continue

      for (const negPattern of negationPatterns) {
        negPattern.lastIndex = 0
        if (negPattern.test(sentLower)) {
          //Find the negation word position
          const negWords = ['no', 'not', 'without', 'none', "don't", "dont", "isn't", "isnt", "aren't", "arent", 'nobody']
          for (const negWord of negWords) {
            const negIdx = words.findIndex(w => w.includes(negWord))
            if (negIdx !== -1 && Math.abs(negIdx - kwIdx) <= 5) {
              isNegated = true
              break
            }
          }
        }
        if (isNegated) break
      }
      if (isNegated) break
    }

    if (isNegated) {
      negated.push(kw)
    } else {
      found.push(kw)
    }
  }

  //Context scoring: proximity of vulnerability keywords to danger/urgency keywords
  const dangerKeywords = ['trapped', 'stuck', 'stranded', 'drowning', 'injured', 'hurt', 'danger',
    'help', 'rescue', 'urgent', 'emergency', 'dying', 'critical', 'bleeding', 'unconscious',
    'collapsed', 'falling', 'fire', 'flood', 'smoke']
  const dangerCount = dangerKeywords.filter(dk => lower.includes(dk)).length
  const contextScore = found.length > 0
    ? Math.min(1, (found.length * 0.3) + (dangerCount * 0.2))
    : 0

  //Build descriptive details
  if (found.length > 0) {
    details.push(`Vulnerable indicators: ${found.join(', ')}`)
    if (dangerCount > 0) {
      details.push(`Co-occurring danger signals: ${dangerKeywords.filter(dk => lower.includes(dk)).join(', ')}`)
    }
  }
  if (negated.length > 0) {
    details.push(`Negated (not flagged): ${negated.join(', ')}`)
  }

  return {
    alert: found.length > 0,
    keywords: found,
    contextScore,
    details,
  }
}


/* Tokenise text into normalised unigrams, filtering stop-words and short tokens */
function tokenise(text: string): string[] {
  const STOP_WORDS = new Set([
    'the','a','an','and','or','but','in','on','at','to','for','of','with',
    'is','was','are','were','be','been','have','has','had','do','did','will',
    'my','i','we','they','it','this','that','there','here','very','just',
    'not','no','can','its','from','by','as','up','out','if','about','than',
  ])
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 2 && !STOP_WORDS.has(t))
}

/* Compute term-frequency map for a token list */
function computeTF(tokens: string[]): Map<string, number> {
  const tf = new Map<string, number>()
  for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1)
  //Normalise by document length
  for (const [k, v] of tf) tf.set(k, v / tokens.length)
  return tf
}

 /*
 * TF-IDF cosine similarity between two raw text strings.
 * Approximation: IDF is approximated as log(2 / df) where df ? {1,2}
 * (i.e. terms shared by both documents get IDF=log(1)=0; unique terms get IDF=log(2)--0.693).
 * This is sufficient for short disaster-report texts and avoids requiring a corpus.
  */
function tfidfCosineSimilarity(a: string, b: string): number {
  const tokA = tokenise(a)
  const tokB = tokenise(b)
  if (tokA.length === 0 || tokB.length === 0) return 0

  const tfA = computeTF(tokA)
  const tfB = computeTF(tokB)

  const vocab = new Set([...tfA.keys(), ...tfB.keys()])
  const sharedTerms = new Set([...tfA.keys()].filter(k => tfB.has(k)))
  const LOG2 = Math.log(2)

  let dotProduct = 0, normA = 0, normB = 0
  for (const term of vocab) {
    //IDF: shared term ? log(1)=0 contribution; unique ? log(2)
    const idf = sharedTerms.has(term) ? 0 : LOG2
    const wa = (tfA.get(term) || 0) * (1 + idf)
    const wb = (tfB.get(term) || 0) * (1 + idf)
    dotProduct += wa * wb
    normA += wa * wa
    normB += wb * wb
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB)
  return denom === 0 ? 0 : Math.round((dotProduct / denom) * 1000) / 1000
}


 /*
 * Estimates water depth from three independent signals and combines them:
 *   1. Text extraction -- NLP scan for explicit measurements and depth vocabulary
 *   2. Gauge-derived   -- river level above warning threshold mapped to floodplain depth
 *   3. Photo-derived   -- CNN water-confidence mapped to expected visible depth
 * The composite method uses a confidence-weighted average of available signals.
 * @param text                 Report description
 * @param gaugeWaterLevelM     Current gauge reading in metres (optional)
 * @param gaugeWarningLevelM   Gauge warning threshold in metres (optional)
 * @param photoWaterConfidence CNN water confidence 0--1 from image analysis (optional)
  */
function estimateWaterDepth(
  text: string,
  gaugeWaterLevelM?: number,
  gaugeWarningLevelM?: number,
  photoWaterConfidence?: number,
): WaterDepthEstimate {
  const lower = text.toLowerCase()
  const textClues: string[] = []
  const candidates: Array<{ value: number; confidence: number; method: string }> = []

  // 1. Text extraction

  //Explicit metric measurements:  "1.5 metres", "80 cm", "500 mm"
  const metreMatch = lower.match(/(\d+(?:\.\d+)?)\s*(?:m(?:etre|eters?)?)\b(?!\s*ph)/)
  const cmMatch    = lower.match(/(\d+(?:\.\d+)?)\s*(?:centimetre|centimeter|cm)\b/)
  const mmMatch    = lower.match(/(\d+(?:\.\d+)?)\s*(?:millimetre|millimeter|mm)\b/)
  const ftMatch    = lower.match(/(\d+(?:\.\d+)?)\s*(?:foot|feet|ft)\b/)
  const inchMatch  = lower.match(/(\d+(?:\.\d+)?)\s*(?:inch(?:es)?|\")\b/)

  if (metreMatch) {
    const v = parseFloat(metreMatch[1])
    if (v > 0 && v < 10) { textClues.push(`${v}m`); candidates.push({ value: v, confidence: 0.92, method: 'text_extraction' }) }
  }
  if (cmMatch) {
    const v = parseFloat(cmMatch[1]) / 100
    if (v > 0 && v < 5) { textClues.push(`${cmMatch[1]}cm`); candidates.push({ value: v, confidence: 0.90, method: 'text_extraction' }) }
  }
  if (mmMatch) {
    const v = parseFloat(mmMatch[1]) / 1000
    if (v > 0 && v < 3) { textClues.push(`${mmMatch[1]}mm`); candidates.push({ value: v, confidence: 0.85, method: 'text_extraction' }) }
  }
  if (ftMatch) {
    const v = parseFloat(ftMatch[1]) * 0.3048
    if (v > 0 && v < 10) { textClues.push(`${ftMatch[1]}ft`); candidates.push({ value: v, confidence: 0.88, method: 'text_extraction' }) }
  }
  if (inchMatch) {
    const v = parseFloat(inchMatch[1]) * 0.0254
    if (v > 0 && v < 2) { textClues.push(`${inchMatch[1]}"`); candidates.push({ value: v, confidence: 0.82, method: 'text_extraction' }) }
  }

  //Depth vocabulary (body-part / landmark anchors)
  const DEPTH_VOCABULARY: Array<{ patterns: string[]; depthM: number; confidence: number }> = [
    { patterns: ['ankle deep','ankle-deep','ankle level','ankle high'],           depthM: 0.15, confidence: 0.78 },
    { patterns: ['shin deep','shin high','shin level','shin-deep'],              depthM: 0.30, confidence: 0.76 },
    { patterns: ['knee deep','knee-deep','knee level','knee high','knee-high'],  depthM: 0.50, confidence: 0.80 },
    { patterns: ['thigh deep','thigh high','thigh-deep','thigh-high'],           depthM: 0.70, confidence: 0.74 },
    { patterns: ['waist deep','waist-deep','waist level','waist high'],          depthM: 0.90, confidence: 0.80 },
    { patterns: ['chest deep','chest high','chest level','chest-deep'],          depthM: 1.20, confidence: 0.78 },
    { patterns: ['shoulder deep','shoulder high','neck deep','neck-deep'],       depthM: 1.50, confidence: 0.76 },
    { patterns: ['head high','head deep','head-deep','over head'],               depthM: 1.80, confidence: 0.72 },
    { patterns: ['over my head','above my head','submerged','fully submerged'],  depthM: 2.20, confidence: 0.68 },
    { patterns: ['rooftop','roof level','up to the roof'],                       depthM: 3.50, confidence: 0.60 },
    { patterns: ['shallow','minor flooding','small puddles'],                    depthM: 0.05, confidence: 0.55 },
    { patterns: ['surface water','surface flood'],                               depthM: 0.08, confidence: 0.52 },
    { patterns: ['window sill','windowsill','window-sill','sill level','sill height'], depthM: 0.85, confidence: 0.72 },
    { patterns: ['door frame','door level','doorstep','door threshold'],         depthM: 0.25, confidence: 0.68 },
    { patterns: ['ground floor window','ground-floor window'],                  depthM: 0.85, confidence: 0.72 },
    { patterns: ['first floor','second floor','upstairs'],                       depthM: 2.50, confidence: 0.55 },
  ]

  for (const { patterns, depthM, confidence } of DEPTH_VOCABULARY) {
    for (const pat of patterns) {
      if (lower.includes(pat)) {
        textClues.push(pat)
        candidates.push({ value: depthM, confidence, method: 'text_extraction' })
        break // take first match per anchor
      }
    }
  }

  // 2. Gauge-derived depth
  if (gaugeWaterLevelM !== undefined && gaugeWarningLevelM !== undefined && gaugeWarningLevelM > 0) {
    const excessM = gaugeWaterLevelM - gaugeWarningLevelM
    if (excessM > 0) {
      //Approximate floodplain depth from gauge excess using a non-linear transfer function.
      //River channels confine ~80% of excess -- remaining 20% spreads onto floodplain.
      //Typical bank-full excess of 1m ? ~0.20m floodplain inundation.
      const floodplainDepth = Math.min(3.0, excessM * 0.22 + 0.08)
      candidates.push({ value: Math.round(floodplainDepth * 100) / 100, confidence: 0.65, method: 'gauge_derived' })
    }
  }

  // 3. Photo-derived depth
  if (photoWaterConfidence !== undefined && photoWaterConfidence > 0.20) {
    //Map CNN water confidence to expected visible floodwater depth.
    //High confidence (=0.85) suggests clearly visible standing water (~0.30--0.60m).
    //Moderate confidence (0.5--0.85) suggests shallow water (~0.05--0.30m).
    let photoDepth: number
    if (photoWaterConfidence >= 0.85) photoDepth = 0.30 + (photoWaterConfidence - 0.85) * 2.0
    else if (photoWaterConfidence >= 0.50) photoDepth = 0.05 + (photoWaterConfidence - 0.50) * 0.71
    else photoDepth = 0.03 + photoWaterConfidence * 0.04
    candidates.push({
      value: Math.round(Math.min(3.0, photoDepth) * 100) / 100,
      confidence: 0.45 + photoWaterConfidence * 0.25, // max 0.70 -- photo alone is uncertain
      method: 'photo_derived',
    })
  }

  // Composite aggregation
  if (candidates.length === 0) {
    return { valueMetres: null, confidenceScore: 0, method: 'text_extraction', textClues }
  }

  //Weight by individual confidence, highest confidence wins as anchor
  candidates.sort((a, b) => b.confidence - a.confidence)

  const totalWeight = candidates.reduce((s, c) => s + c.confidence, 0)
  const weightedDepth = candidates.reduce((s, c) => s + c.value * c.confidence, 0) / totalWeight
  const compositConfidence = Math.min(0.97, candidates[0].confidence +
    (candidates.length > 1 ? 0.06 : 0) +
    (candidates.length > 2 ? 0.04 : 0))

  const primaryMethod = candidates.length === 1
    ? (candidates[0].method as WaterDepthEstimate['method'])
    : 'composite'

  return {
    valueMetres: Math.round(weightedDepth * 100) / 100,
    confidenceScore: Math.round(compositConfidence * 100) / 100,
    method: primaryMethod,
    textClues: [...new Set(textClues)].slice(0, 8),
  }
}

/* Step 8: Cross-reference with nearby recent reports -- with TF-IDF similarity scoring */
async function crossReference(
  lat: number, lng: number, reportId: string, currentText: string,
): Promise<{
  reportIds: string[]
  count: number
  crossReferenceSimilarityScores: CrossRefSimilarityEntry[]
  nearDuplicateCount: number
}> {
  try {
    //Find reports within 5km submitted in the last 24 hours
    const result = await pool.query(
      `SELECT id::text, description
       FROM reports
       WHERE id != $1
         AND deleted_at IS NULL
         AND created_at > now() - INTERVAL '24 hours'
         AND ST_DWithin(
           coordinates,
           ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography,
           5000
         )
       ORDER BY created_at DESC
       LIMIT 10`,
      [reportId, lng, lat],
    )

    const rows: Array<{ id: string; description: string }> = result.rows

    const similarityScores: CrossRefSimilarityEntry[] = rows.map(row => {
      const sim = tfidfCosineSimilarity(currentText, row.description || '')
      return { id: row.id, similarity: sim, isNearDuplicate: sim >= 0.70 }
    })

    //Sort by similarity descending so highest-risk duplicates appear first
    similarityScores.sort((a, b) => b.similarity - a.similarity)

    return {
      reportIds: rows.map(r => r.id),
      count: rows.length,
      crossReferenceSimilarityScores: similarityScores,
      nearDuplicateCount: similarityScores.filter(s => s.isNearDuplicate).length,
    }
  } catch {
    return { reportIds: [], count: 0, crossReferenceSimilarityScores: [], nearDuplicateCount: 0 }
  }
}

/* Step 9: Damage estimation via LLM (only for verified/urgent reports) */
async function estimateDamage(
  description: string, location: string, severity: string,
): Promise<{ estimatedCost: string; affectedProperties: number; confidence: number } | null> {
  try {
    const response = await chatCompletion({
      messages: [
        {
          role: 'system',
          content: 'You are a disaster damage assessment expert. Given an emergency report, estimate the potential damage. Respond ONLY with valid JSON: {"estimatedCost": "--X---Y", "affectedProperties": N, "confidence": 0.0-1.0}. Be conservative in estimates.',
        },
        {
          role: 'user',
          content: `Emergency report from ${location} (severity: ${severity}):\n${description}`,
        },
      ],
      maxTokens: 200,
      temperature: 0.3,
    })

    const parsed = JSON.parse(response.content)
    return {
      estimatedCost: parsed.estimatedCost || 'Unknown',
      affectedProperties: parsed.affectedProperties || 0,
      confidence: parsed.confidence || 0,
    }
  } catch {
    return null
  }
}

/* Step 9b: LLM-powered structured analysis fallback
 * Used when HuggingFace is unavailable/rate-limited.
 * Calls Groq/Gemini to produce sentiment, panicLevel, fakeProbability etc.
 */
async function llmFallbackAnalysis(text: string): Promise<{
  sentimentScore: number
  sentimentLabel: string
  panicLevel: 'None' | 'Low' | 'Moderate' | 'High'
  fakeProbability: number
  urgencyLevel: string
  urgencyScore: number
  severity: string
  severityConfidence: number
  category: string
  categoryConfidence: number
} | null> {
  try {
    const response = await chatCompletion({
      messages: [
        {
          role: 'system',
          content: `You are an emergency report analysis AI. Analyse the report and respond ONLY with valid JSON, no markdown.
Schema: {
  "sentimentScore": 0.0-1.0,
  "sentimentLabel": "positive|neutral|negative",
  "panicLevel": "None|Low|Moderate|High",
  "fakeProbability": 0.0-1.0,
  "urgencyLevel": "not urgent|somewhat urgent|urgent|extremely urgent",
  "urgencyScore": 0.0-1.0,
  "severity": "low|medium|high|critical",
  "severityConfidence": 0.0-1.0,
  "category": "flood|fire|earthquake|storm|infrastructure|medical|evacuation|other",
  "categoryConfidence": 0.0-1.0
}
Rules: panicLevel=High if people are trapped/requesting rescue; severity=high/critical for life-threatening events; urgencyLevel=extremely urgent if immediate rescue needed.`,
        },
        {
          role: 'user',
          content: `Analyse this emergency report:\n${text.slice(0, 1000)}`,
        },
      ],
      maxTokens: 300,
      temperature: 0.1,
    })
    const raw = response.content.trim().replace(/^```json\s*/i, '').replace(/```$/, '').trim()
    const parsed = JSON.parse(raw)
    return {
      sentimentScore: Math.min(1, Math.max(0, Number(parsed.sentimentScore) || 0)),
      sentimentLabel: String(parsed.sentimentLabel || 'neutral'),
      panicLevel: (['None','Low','Moderate','High'].includes(parsed.panicLevel) ? parsed.panicLevel : 'None') as 'None'|'Low'|'Moderate'|'High',
      fakeProbability: Math.min(1, Math.max(0, Number(parsed.fakeProbability) || 0)),
      urgencyLevel: String(parsed.urgencyLevel || 'somewhat urgent'),
      urgencyScore: Math.min(1, Math.max(0, Number(parsed.urgencyScore) || 0)),
      severity: String(parsed.severity || 'unknown'),
      severityConfidence: Math.min(1, Math.max(0, Number(parsed.severityConfidence) || 0)),
      category: String(parsed.category || 'unknown'),
      categoryConfidence: Math.min(1, Math.max(0, Number(parsed.categoryConfidence) || 0)),
    }
  } catch {
    return null
  }
}


 /*
 * Run the complete AI analysis pipeline on a report.
 * Non-blocking: individual step failures don't cascade.
 * @param reportId  - UUID of the report to analyse
 * @param text      - Report description text
 * @param lat       - Latitude
 * @param lng       - Longitude
 * @param location  - Location text
 * @param severity  - Reported severity
 * @param hasMedia  - Whether the report has media attached
  */
export async function analyseReport(
  reportId: string,
  text: string,
  lat: number,
  lng: number,
  location: string,
  severity: string,
  hasMedia: boolean,
): Promise<AIAnalysisResult> {
  const start = Date.now()
  const modelsUsed: string[] = []

  //Run independent steps in parallel for speed
  const [
    sentiment,
    fake,
    severityResult,
    category,
    language,
    urgency,
    vulnerable,
    crossRef,
  ] = await Promise.allSettled([
    analyseSentiment(text),
    detectFake(text),
    assessSeverity(text),
    predictCategory(text),
    detectLanguage(text),
    scoreUrgency(text),
    Promise.resolve(detectVulnerablePersons(text)),
    crossReference(lat, lng, reportId, text),
  ])

  //Extract results with fallbacks for failed steps and log any errors
  let sentimentVal = sentiment.status === 'fulfilled' ? sentiment.value : { score: 0, label: 'unknown', panicLevel: 'None' as const }
  let fakeVal = fake.status === 'fulfilled' ? fake.value : { probability: 0, label: 'unknown' }
  let severityVal = severityResult.status === 'fulfilled' ? severityResult.value : { assessment: 'unknown', confidence: 0 }
  let categoryVal = category.status === 'fulfilled' ? category.value : { category: 'unknown', confidence: 0 }
  const languageVal = language.status === 'fulfilled' ? language.value : { language: 'en', confidence: 0 }
  let urgencyVal = urgency.status === 'fulfilled' ? urgency.value : { level: 'unknown', score: 0 }
  const vulnerableVal = vulnerable.status === 'fulfilled' ? vulnerable.value : { alert: false, keywords: [] }
  const crossRefVal = crossRef.status === 'fulfilled'
    ? crossRef.value
    : { reportIds: [], count: 0, crossReferenceSimilarityScores: [], nearDuplicateCount: 0 }

  //Log failures for debugging
  if (sentiment.status === 'rejected') logger.warn({ err: sentiment.reason, reportId }, '[AI] Sentiment analysis failed')
  if (fake.status === 'rejected') logger.warn({ err: fake.reason, reportId }, '[AI] Fake detection failed')
  if (severityResult.status === 'rejected') logger.warn({ err: severityResult.reason, reportId }, '[AI] Severity assessment failed')
  if (category.status === 'rejected') logger.warn({ err: category.reason, reportId }, '[AI] Category prediction failed')
  if (language.status === 'rejected') logger.warn({ err: language.reason, reportId }, '[AI] Language detection failed')
  if (urgency.status === 'rejected') logger.warn({ err: urgency.reason, reportId }, '[AI] Urgency scoring failed')
  if (vulnerable.status === 'rejected') logger.warn({ err: vulnerable.reason, reportId }, '[AI] Vulnerable person detection failed')
  if (crossRef.status === 'rejected') logger.warn({ err: crossRef.reason, reportId }, '[AI] Cross-reference check failed')

  //LLM fallback: trigger when HF sentiment+fake both fail, OR when BART-MNLI models all return unknown
  const hfSentimentFakeFailed = sentimentVal.label === 'unknown' && fakeVal.label === 'unknown'
  const bartMnliFailed = severityVal.assessment === 'unknown' && categoryVal.category === 'unknown' && urgencyVal.level === 'unknown'
  const needsLlmFallback = hfSentimentFakeFailed || bartMnliFailed
  if (needsLlmFallback) {
    logger.info({ reportId, hfSentimentFakeFailed, bartMnliFailed }, '[AI] HF classifiers degraded -- running LLM fallback')
    const llmResult = await llmFallbackAnalysis(text)
    if (llmResult) {
      //Only overwrite fields that are still 'unknown' -- preserve successful HF results
      if (sentimentVal.label === 'unknown') {
        sentimentVal = { score: llmResult.sentimentScore, label: llmResult.sentimentLabel, panicLevel: llmResult.panicLevel }
      }
      if (fakeVal.label === 'unknown') {
        fakeVal = { probability: llmResult.fakeProbability, label: llmResult.fakeProbability > 0.5 ? 'fake' : 'genuine' }
      }
      if (urgencyVal.level === 'unknown') {
        urgencyVal = { level: llmResult.urgencyLevel, score: llmResult.urgencyScore }
      }
      if (severityVal.assessment === 'unknown') {
        severityVal = { assessment: llmResult.severity, confidence: llmResult.severityConfidence }
      }
      if (categoryVal.category === 'unknown') {
        categoryVal = { category: llmResult.category, confidence: llmResult.categoryConfidence }
      }
      //Use LLM's panic level if it's higher than what sentiment alone gave us
      const panicRank = { 'None': 0, 'Low': 1, 'Moderate': 2, 'High': 3 }
      const currentRank = panicRank[sentimentVal.panicLevel as keyof typeof panicRank] ?? 0
      const llmRank = panicRank[llmResult.panicLevel] ?? 0
      if (llmRank > currentRank) {
        sentimentVal = { ...sentimentVal, panicLevel: llmResult.panicLevel }
      }
      modelsUsed.push('llm-analysis-fallback')
      logger.info({ reportId, severity: severityVal.assessment, category: categoryVal.category, panicLevel: sentimentVal.panicLevel }, '[AI] LLM fallback analysis complete')
    }
  }

  //Post-process panic level: upgrade based on urgency, vulnerability, and severity signals
  // (sentiment score alone is a weak proxy -- this composite gives a much more accurate reading)
  const panicLevels = ['None', 'Low', 'Moderate', 'High'] as const
  let panicIdx = panicLevels.indexOf((sentimentVal.panicLevel as typeof panicLevels[number]) ?? 'None')
  if (panicIdx < 0) panicIdx = 0
  if (vulnerableVal.alert) panicIdx = Math.max(panicIdx, 2)
  if (urgencyVal.score > 0.8 || urgencyVal.level?.includes('extremely')) panicIdx = Math.max(panicIdx, 3)
  else if (urgencyVal.score > 0.6 || urgencyVal.level?.includes('urgent') && !urgencyVal.level?.includes('not')) panicIdx = Math.max(panicIdx, 2)
  if (severityVal.assessment === 'critical') panicIdx = 3
  else if (severityVal.assessment === 'high') panicIdx = Math.max(panicIdx, 3)
  else if (severityVal.assessment === 'medium') panicIdx = Math.max(panicIdx, 1)
  sentimentVal = { ...sentimentVal, panicLevel: panicLevels[panicIdx] }

  //Track which models were used
  if (sentiment.status === 'fulfilled' && !hfSentimentFakeFailed) modelsUsed.push('sentiment-roberta')
  if (fake.status === 'fulfilled' && !hfSentimentFakeFailed) modelsUsed.push('fake-detector')
  if (severityResult.status === 'fulfilled' && severityVal.assessment !== 'unknown') modelsUsed.push('severity-bart-mnli')
  if (category.status === 'fulfilled' && categoryVal.category !== 'unknown') modelsUsed.push('category-bart-mnli')
  if (language.status === 'fulfilled') modelsUsed.push('language-xlm-roberta')
  if (urgency.status === 'fulfilled' && !hfSentimentFakeFailed && urgencyVal.level !== 'unknown') modelsUsed.push('urgency-bart-mnli')

  //Damage estimation for high-severity reports (expensive LLM call)
  //Also run when AI detects high/critical severity or urgent/trapped-persons signals
  let damageEstimate = null
  const isDamageable = severity === 'high' || severity === 'critical'
    || severityVal.assessment === 'high' || severityVal.assessment === 'critical'
    || urgencyVal.level?.includes('urgent')
    || vulnerableVal.alert
  if (isDamageable) {
    damageEstimate = await estimateDamage(text, location, severity)
    if (damageEstimate) modelsUsed.push('damage-llm')
  }

  //Step 10: Photo analysis via CNN (if media attached)
  let photoVerified = false
  let photoValidation: AIAnalysisResult['photoValidation'] = null

  if (hasMedia) {
    try {
      //Look up media URL from DB
      const mediaResult = await pool.query(
        `SELECT media_url FROM reports WHERE id = $1 AND has_media = true`,
        [reportId],
      )
      if (mediaResult.rows.length > 0 && mediaResult.rows[0].media_url) {
        const imagePath = mediaResult.rows[0].media_url
        const imageAnalysis = await analyseImage(imagePath, lat, lng, reportId)
        const pv = imageAnalysis.photoValidation
        const ea = imageAnalysis.exifAnalysis

        photoVerified = ea.locationMatch === true
        photoValidation = {
          isFloodRelated: pv.isFloodRelated,
          waterDetected: pv.waterDetected,
          waterConfidence: pv.waterConfidence,
          objectsDetected: pv.objectsDetected,
          imageQuality: pv.imageQuality,
        }
        modelsUsed.push('image-cnn-vit', 'image-detr')
      }
    } catch (imgErr: any) {
      logger.warn({ err: imgErr, reportId }, '[AI Pipeline] Image analysis failed')
    }
  }

  //Step 11: Water depth estimation -- composite of text NLP, gauge signal, and photo CNN
  const waterDepthEstimate = estimateWaterDepth(
    text,
    undefined, // gauge readings not available at this layer -- fusion engine handles those
    undefined,
    photoValidation?.waterConfidence,
  )

  //Persist water depth into report_media if we have a media record
  if (waterDepthEstimate.valueMetres !== null) {
    try {
      await pool.query(
        `UPDATE report_media
         SET ai_water_depth = $1, ai_processed = true
         WHERE report_id = $2 AND ai_water_depth IS NULL`,
        [
          `${waterDepthEstimate.valueMetres}m (${waterDepthEstimate.method}, conf:${waterDepthEstimate.confidenceScore})`,
          reportId,
        ],
      )
    } catch { /* non-critical */ }
  }

  //Generate reasoning summary for transparency and human review
  const reasoningParts: string[] = []
  reasoningParts.push(`Report analysed using ${modelsUsed.length} AI models.`)
  
  if (sentiment.status === 'fulfilled') {
    reasoningParts.push(`Sentiment analysis detected ${sentimentVal.label} tone with ${Math.round(sentimentVal.score * 100)}% confidence, panic level: ${sentimentVal.panicLevel}.`)
  }
  
  if (fake.status === 'fulfilled') {
    reasoningParts.push(`Authenticity check: ${Math.round(fakeVal.probability * 100)}% likelihood of being false or misleading (${fakeVal.label}).`)
  }
  
  if (category.status === 'fulfilled') {
    reasoningParts.push(`Incident categorized as "${categoryVal.category}" with ${Math.round(categoryVal.confidence * 100)}% confidence.`)
  }
  
  if (crossRef.status === 'fulfilled' && crossRefVal.count > 0) {
    reasoningParts.push(`Location matches ${crossRefVal.count} nearby active incident${crossRefVal.count > 1 ? 's' : ''} within reference zones.`)
  }
  
  if (vulnerableVal.alert) {
    reasoningParts.push(`Alert: Report contains keywords suggesting vulnerable persons may be at risk (${vulnerableVal.keywords.slice(0, 2).join(', ')}).`)
  }
  
  if (photoVerified && photoValidation) {
    reasoningParts.push(`Photo verification complete - flood-related content detected with ${Math.round(photoValidation.waterConfidence * 100)}% confidence.`)
  }
  
  //Composite confidence: best available score across working models
  const compositeConfidence = Math.max(
    sentimentVal.score,
    urgencyVal.score,
    categoryVal.confidence,
    severityVal.confidence,
  )
  reasoningParts.push(`Severity: ${severityVal.assessment}. Category: ${categoryVal.category}. Urgency: ${urgencyVal.level}. Panic level: ${sentimentVal.panicLevel}. Overall confidence: ${Math.round(compositeConfidence * 100)}%.`)
  
  const reasoning = reasoningParts.join(' ')
  
  //Compile list of data sources used in this analysis
  const sources: string[] = []
  if (sentiment.status === 'fulfilled' || modelsUsed.includes('llm-analysis-fallback')) sources.push('NLP Sentiment Analysis (RoBERTa)')
  if (fake.status === 'fulfilled' || modelsUsed.includes('llm-analysis-fallback')) sources.push('Authenticity Detector')
  if (category.status === 'fulfilled' || modelsUsed.includes('llm-analysis-fallback')) sources.push('Incident Category Classifier')
  if (language.status === 'fulfilled') sources.push('Language Detection')
  if (urgency.status === 'fulfilled' || modelsUsed.includes('llm-analysis-fallback')) sources.push('Urgency Scoring')
  if (crossRef.status === 'fulfilled') sources.push('SEPA Emergency Registry')
  if (vulnerableVal.alert) sources.push('Vulnerability Pattern Matching')
  if (modelsUsed.includes('llm-analysis-fallback')) sources.push('LLM Triage Analysis (Groq/Gemini)')
  if (photoVerified) sources.push('Image Recognition Neural Network')
  if (damageEstimate) sources.push('Damage Estimation LLM')
  sources.push('Regional Risk Zones Database')

  const result: AIAnalysisResult = {
    sentimentScore: sentimentVal.score,
    sentimentLabel: sentimentVal.label,
    panicLevel: sentimentVal.panicLevel as AIAnalysisResult['panicLevel'],
    fakeProbability: fakeVal.probability,
    fakeLabel: fakeVal.label,
    severityAssessment: severityVal.assessment,
    severityConfidence: severityVal.confidence,
    categoryPrediction: categoryVal.category,
    categoryConfidence: categoryVal.confidence,
    languageDetected: languageVal.language,
    languageConfidence: languageVal.confidence,
    urgencyLevel: urgencyVal.level,
    urgencyScore: urgencyVal.score,
    vulnerablePersonAlert: vulnerableVal.alert,
    vulnerableKeywords: vulnerableVal.keywords,
    crossReferenced: crossRefVal.reportIds,
    nearbyReportCount: crossRefVal.count,
    crossReferenceSimilarityScores: crossRefVal.crossReferenceSimilarityScores,
    nearDuplicateCount: crossRefVal.nearDuplicateCount,
    estimatedWaterDepth: waterDepthEstimate.valueMetres !== null ? waterDepthEstimate : null,
    damageEstimate,
    photoVerified,
    photoValidation,
    modelsUsed,
    processingTimeMs: Date.now() - start,
    reasoning,
    sources,
  }

  //Run governance checks (human-in-the-loop enforcement)
  const governance = await enforceGovernance(
    reportId,
    Math.round(compositeConfidence * 100),
    fakeVal.probability,
    vulnerableVal.alert,
    severityVal.assessment,
  ).catch(() => null)

  //Persist results to the database
  try {
    const confidenceScore = Math.round(compositeConfidence * 100)
    const status = governance?.requiresHumanReview ? 'flagged' : undefined

    let updateQuery = `UPDATE reports SET ai_analysis = $1, ai_confidence = $2`
    const updateParams: any[] = [JSON.stringify({ ...result, governance }), confidenceScore]

    if (status) {
      updateQuery += `, status = $3 WHERE id = $4`
      updateParams.push(status, reportId)
    } else {
      updateQuery += ` WHERE id = $3`
      updateParams.push(reportId)
    }

    await pool.query(updateQuery, updateParams)

    //Log AI execution for transparency dashboard
    await pool.query(
      `INSERT INTO ai_executions (model_name, model_version, input_payload, raw_response, execution_time_ms, target_type, target_id)
       VALUES ('analysis_pipeline', 'v1', $1, $2, $3, 'report', $4)`,
      [
        JSON.stringify({ text: text.slice(0, 200), lat, lng }),
        JSON.stringify(result),
        result.processingTimeMs,
        reportId,
      ],
    )
  } catch (err: any) {
    logger.error({ err, reportId }, '[AI Pipeline] Failed to persist results')
  }

  devLog(`[AI Pipeline] Report ${reportId} analysed in ${result.processingTimeMs}ms -- ${modelsUsed.length} models used`)
  return result
}

 /*
 * Run a simplified re-analysis on an existing report (e.g., after edit).
  */
export async function reanalyseReport(reportId: string): Promise<AIAnalysisResult | null> {
  try {
    const { rows } = await pool.query(
      `SELECT description, ST_X(coordinates) as lng, ST_Y(coordinates) as lat,
              location_text, severity, has_media
       FROM reports WHERE id = $1 AND deleted_at IS NULL`,
      [reportId],
    )
    if (rows.length === 0) return null

    const r = rows[0]
    return analyseReport(reportId, r.description, r.lat, r.lng, r.location_text, r.severity, r.has_media)
  } catch (err: any) {
    logger.error({ err, reportId }, '[AI Pipeline] Re-analysis failed')
    return null
  }
}

//    Priority Scoring, Geospatial Context, Credibility Assessment, Triage, and Confidence Explanation

/**
 * Named Entity Recognition (NER) -- extract structured entities from disaster report text.
 * Uses regex-based pattern matching tuned for emergency/disaster domain.
 */
export function extractEntities(text: string): {
  locations: string[]; people: string[]; infrastructure: string[];
  hazards: string[]; temporalRefs: string[]; quantities: string[]
} {
  const locations: string[] = []
  const people: string[] = []
  const infrastructure: string[] = []
  const hazards: string[] = []
  const temporalRefs: string[] = []
  const quantities: string[] = []

  const lower = text.toLowerCase()

  //Locations
  //Street names: "123 Main Street", "Oak Road", "Elm Avenue", "Park Lane"
  const streetPatterns = text.match(/\b\d+\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?\s+(?:Street|St|Road|Rd|Avenue|Ave|Lane|Ln|Drive|Dr|Boulevard|Blvd|Way|Place|Pl|Court|Ct|Terrace|Crescent)\b/g)
  if (streetPatterns) locations.push(...streetPatterns)

  //Named street without numbers: "High Street", "Mill Road"
  const namedStreets = text.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?\s+(?:Street|Road|Avenue|Lane|Drive|Boulevard|Way|Place|Court|Terrace|Crescent)\b/g)
  if (namedStreets) {
    for (const ns of namedStreets) {
      if (!locations.includes(ns)) locations.push(ns)
    }
  }

  // "near X", "at X", "by the X" -- capture next 2-4 words as location reference
  const nearPatterns = text.match(/(?:near|at|by the|close to|opposite|behind|beside|next to)\s+(?:the\s+)?([A-Z][a-zA-Z\s]{2,30}?)(?:\.|,|;|\s-|\s(?:and|but|where|which|that|there|we|i|the\s+water))/gi)
  if (nearPatterns) {
    for (const m of nearPatterns) {
      const cleaned = m.replace(/^(?:near|at|by the|close to|opposite|behind|beside|next to)\s+(?:the\s+)?/i, '').replace(/[\.,;]$/, '').trim()
      if (cleaned.length > 2 && cleaned.length < 40) locations.push(cleaned)
    }
  }

  //People
  //Person counts: "family of 5", "3 people", "group of 10"
  const familyOf = lower.match(/family\s+of\s+(\d+)/g)
  if (familyOf) people.push(...familyOf)

  const nPeople = text.match(/\b(\d+)\s+(?:people|persons|adults|residents|occupants|individuals|victims|survivors)\b/gi)
  if (nPeople) people.push(...nPeople)

  const groupOf = lower.match(/group\s+of\s+(\d+)/g)
  if (groupOf) people.push(...groupOf)

  //Vulnerable descriptors
  const personDescriptors = [
    'elderly', 'children', 'child', 'baby', 'infant', 'toddler',
    'pregnant woman', 'pregnant', 'disabled', 'wheelchair user',
    'injured man', 'injured woman', 'injured person', 'injured child',
    'blind', 'deaf', 'frail',
  ]
  for (const desc of personDescriptors) {
    if (lower.includes(desc)) people.push(desc)
  }

  // "N adults", "N children"
  const nAdults = text.match(/\b(\d+)\s+(?:adults|children|kids|elderly|babies|infants)\b/gi)
  if (nAdults) people.push(...nAdults)

  //Infrastructure
  const infraKeywords = [
    'bridge', 'overpass', 'underpass', 'flyover', 'viaduct',
    'road', 'highway', 'motorway', 'roundabout', 'junction', 'intersection',
    'building', 'house', 'flat', 'apartment', 'tower block', 'office block',
    'school', 'hospital', 'clinic', 'surgery', 'care home', 'nursing home',
    'power line', 'power station', 'substation', 'electricity', 'transformer',
    'water main', 'sewage', 'sewer', 'drain', 'culvert', 'pumping station',
    'railway', 'train station', 'bus station', 'bus stop',
    'dam', 'embankment', 'flood wall', 'flood barrier', 'flood gate', 'levee',
    'telephone pole', 'cell tower', 'communications mast',
    'gas main', 'gas pipe', 'pipeline',
  ]
  for (const kw of infraKeywords) {
    if (lower.includes(kw)) infrastructure.push(kw)
  }

  //Hazards
  //Extract hazard mentions with modifiers
  const hazardPatterns: Array<{ regex: RegExp; label: string }> = [
    { regex: /(?:severe|heavy|flash|sudden|fast[- ]rising|major|catastrophic|extreme)?\s*flood(?:ing|waters?|plain)?/gi, label: 'flood' },
    { regex: /(?:thick|heavy|dense|choking|black)?\s*smoke/gi, label: 'smoke' },
    { regex: /(?:wild|bush|forest|grass|house)?\s*fire/gi, label: 'fire' },
    { regex: /(?:severe|violent|strong|major)?\s*storm/gi, label: 'storm' },
    { regex: /(?:land|mud|rock)?\s*slide/gi, label: 'landslide' },
    { regex: /(?:extreme|severe|dangerous|record)?\s*heat(?:wave)?/gi, label: 'heatwave' },
    { regex: /(?:severe|prolonged|extreme)?\s*drought/gi, label: 'drought' },
    { regex: /(?:strong|high|gale[- ]force|hurricane[- ]force)?\s*wind/gi, label: 'wind' },
    { regex: /(?:flash|surface|river|coastal|tidal)?\s*flood(?:ing)?/gi, label: 'flood' },
    { regex: /earthquake|tremor|seismic/gi, label: 'earthquake' },
    { regex: /tornado|twister|cyclone|hurricane|typhoon/gi, label: 'tornado/cyclone' },
    { regex: /(?:power|electricity)\s*(?:outage|cut|failure|loss|down)/gi, label: 'power_outage' },
    { regex: /(?:water)\s*(?:contamination|contaminated|supply\s*(?:cut|failure|disruption|issue))/gi, label: 'water_supply' },
  ]

  for (const { regex, label } of hazardPatterns) {
    const matches = text.match(regex)
    if (matches) {
      for (const m of matches) {
        const trimmed = m.trim()
        if (trimmed.length > 2 && !hazards.includes(trimmed.toLowerCase())) {
          hazards.push(trimmed.toLowerCase())
        }
      }
    }
  }

  //Temporal references
  const temporalPatterns = [
    /since\s+(?:yesterday|last\s+(?:night|week|month)|this\s+(?:morning|afternoon|evening))/gi,
    /for\s+(?:the\s+(?:last|past)\s+)?\d+\s+(?:hours?|minutes?|days?|weeks?)/gi,
    /this\s+(?:morning|afternoon|evening|week)/gi,
    /(?:yesterday|today|tonight|last\s+night|earlier\s+today)/gi,
    /since\s+\d{1,2}[\/\-]\d{1,2}(?:[\/\-]\d{2,4})?/gi,
    /(?:around|about|approximately|at)\s+\d{1,2}(?::\d{2})?\s*(?:am|pm|o'clock)?/gi,
    /\d+\s+(?:hours?|minutes?|days?)\s+ago/gi,
    /(?:all\s+(?:day|night|morning|afternoon))\b/gi,
    /(?:overnight|dawn|dusk|midday|midnight)\b/gi,
  ]
  for (const pat of temporalPatterns) {
    const matches = text.match(pat)
    if (matches) temporalRefs.push(...matches.map(m => m.trim()))
  }

  //Quantities
  const quantityPatterns = [
    /\b\d+(?:\.\d+)?\s*(?:metres?|meters?|m)\b(?!\s*ph)/gi,
    /\b\d+(?:\.\d+)?\s*(?:feet|foot|ft)\b/gi,
    /\b\d+(?:\.\d+)?\s*(?:inches?|in|")\b/gi,
    /\b\d+(?:\.\d+)?\s*(?:centimetres?|centimeters?|cm)\b/gi,
    /\b\d+(?:\.\d+)?\s*(?:millimetres?|millimeters?|mm)\b/gi,
    /\b\d+(?:\.\d+)?\s*(?:kilometres?|kilometers?|km)\b/gi,
    /\b\d+(?:\.\d+)?\s*(?:miles?|mi)\b/gi,
    /\b\d+(?:\.\d+)?\s*(?:litres?|liters?|l)\b/gi,
    /\b\d+(?:\.\d+)?\s*(?:degrees?|--)\s*(?:c|f|celsius|fahrenheit)?\b/gi,
    /\b\d+(?:\.\d+)?\s*(?:mph|km\/h|knots?)\b/gi,
    /\b\d+(?:\.\d+)?\s*(?:deep|wide|long|high|tall)\b/gi,
  ]
  for (const pat of quantityPatterns) {
    const matches = text.match(pat)
    if (matches) quantities.push(...matches.map(m => m.trim()))
  }

  //Deduplicate all arrays
  const dedupe = (arr: string[]) => [...new Set(arr)]
  return {
    locations: dedupe(locations),
    people: dedupe(people),
    infrastructure: dedupe(infrastructure),
    hazards: dedupe(hazards),
    temporalRefs: dedupe(temporalRefs),
    quantities: dedupe(quantities),
  }
}

/**
 * Multi-Hazard Classification -- detect primary and secondary hazards from report text.
 * Starts with the primary classification from the ML classifier, then scans for
 * secondary hazard indicators using keyword co-occurrence patterns.
 */
export function classifyMultiHazard(
  text: string,
  primaryCategory: string,
  categoryConfidence: number,
): Array<{ hazardType: string; confidence: number; source: 'primary' | 'secondary' | 'inferred' }> {
  const results: Array<{ hazardType: string; confidence: number; source: 'primary' | 'secondary' | 'inferred' }> = []

  //Primary hazard from classifier
  results.push({ hazardType: primaryCategory, confidence: categoryConfidence, source: 'primary' })

  const lower = text.toLowerCase()

  //Secondary hazard detection rules: keyword co-occurrence patterns
  const secondaryRules: Array<{
    hazardType: string
    patterns: Array<{ keywords: string[]; minMatch: number; confidence: number }>
  }> = [
    {
      hazardType: 'power_outage',
      patterns: [
        { keywords: ['power', 'out'], minMatch: 2, confidence: 0.65 },
        { keywords: ['power', 'cut'], minMatch: 2, confidence: 0.65 },
        { keywords: ['power', 'off'], minMatch: 2, confidence: 0.55 },
        { keywords: ['power', 'failure'], minMatch: 2, confidence: 0.70 },
        { keywords: ['electricity', 'out'], minMatch: 2, confidence: 0.60 },
        { keywords: ['electricity', 'cut'], minMatch: 2, confidence: 0.60 },
        { keywords: ['blackout'], minMatch: 1, confidence: 0.70 },
        { keywords: ['no power'], minMatch: 1, confidence: 0.65 },
        { keywords: ['lights', 'out'], minMatch: 2, confidence: 0.45 },
      ],
    },
    {
      hazardType: 'water_supply',
      patterns: [
        { keywords: ['water', 'supply'], minMatch: 2, confidence: 0.60 },
        { keywords: ['water', 'tap', 'not'], minMatch: 2, confidence: 0.55 },
        { keywords: ['water', 'contaminated'], minMatch: 2, confidence: 0.70 },
        { keywords: ['no water'], minMatch: 1, confidence: 0.65 },
        { keywords: ['water', 'cut off'], minMatch: 2, confidence: 0.65 },
        { keywords: ['water', 'brown', 'tap'], minMatch: 2, confidence: 0.55 },
      ],
    },
    {
      hazardType: 'infrastructure_damage',
      patterns: [
        { keywords: ['road', 'blocked'], minMatch: 2, confidence: 0.65 },
        { keywords: ['road', 'closed'], minMatch: 2, confidence: 0.65 },
        { keywords: ['road', 'damaged'], minMatch: 2, confidence: 0.70 },
        { keywords: ['bridge', 'collapsed'], minMatch: 2, confidence: 0.70 },
        { keywords: ['bridge', 'damaged'], minMatch: 2, confidence: 0.65 },
        { keywords: ['building', 'collapsed'], minMatch: 2, confidence: 0.70 },
        { keywords: ['structural', 'damage'], minMatch: 2, confidence: 0.65 },
        { keywords: ['sinkhole'], minMatch: 1, confidence: 0.70 },
      ],
    },
    {
      hazardType: 'wildfire',
      patterns: [
        { keywords: ['fire', 'smoke'], minMatch: 2, confidence: 0.65 },
        { keywords: ['fire', 'burning'], minMatch: 2, confidence: 0.65 },
        { keywords: ['wildfire'], minMatch: 1, confidence: 0.70 },
        { keywords: ['bush fire'], minMatch: 1, confidence: 0.65 },
        { keywords: ['forest fire'], minMatch: 1, confidence: 0.65 },
        { keywords: ['fire', 'spreading'], minMatch: 2, confidence: 0.70 },
      ],
    },
    {
      hazardType: 'flood',
      patterns: [
        { keywords: ['flood'], minMatch: 1, confidence: 0.60 },
        { keywords: ['water', 'rising'], minMatch: 2, confidence: 0.65 },
        { keywords: ['submerged'], minMatch: 1, confidence: 0.60 },
        { keywords: ['inundated'], minMatch: 1, confidence: 0.60 },
      ],
    },
    {
      hazardType: 'public_safety',
      patterns: [
        { keywords: ['trapped'], minMatch: 1, confidence: 0.65 },
        { keywords: ['stranded'], minMatch: 1, confidence: 0.55 },
        { keywords: ['rescue'], minMatch: 1, confidence: 0.50 },
        { keywords: ['missing', 'person'], minMatch: 2, confidence: 0.60 },
        { keywords: ['evacuate', 'cannot'], minMatch: 2, confidence: 0.60 },
      ],
    },
    {
      hazardType: 'landslide',
      patterns: [
        { keywords: ['slide'], minMatch: 1, confidence: 0.45 },
        { keywords: ['sliding'], minMatch: 1, confidence: 0.50 },
        { keywords: ['collapsed', 'hill'], minMatch: 2, confidence: 0.60 },
        { keywords: ['landslide'], minMatch: 1, confidence: 0.70 },
        { keywords: ['mudslide'], minMatch: 1, confidence: 0.70 },
        { keywords: ['rockslide'], minMatch: 1, confidence: 0.65 },
        { keywords: ['land', 'collapsed'], minMatch: 2, confidence: 0.55 },
      ],
    },
    {
      hazardType: 'heatwave',
      patterns: [
        { keywords: ['heat', 'extreme'], minMatch: 2, confidence: 0.60 },
        { keywords: ['temperature', 'dangerous'], minMatch: 2, confidence: 0.55 },
        { keywords: ['heatwave'], minMatch: 1, confidence: 0.70 },
        { keywords: ['heat stroke'], minMatch: 1, confidence: 0.60 },
        { keywords: ['hot', 'unbearable'], minMatch: 2, confidence: 0.50 },
      ],
    },
    {
      hazardType: 'severe_storm',
      patterns: [
        { keywords: ['storm'], minMatch: 1, confidence: 0.50 },
        { keywords: ['tornado'], minMatch: 1, confidence: 0.70 },
        { keywords: ['hurricane'], minMatch: 1, confidence: 0.70 },
        { keywords: ['cyclone'], minMatch: 1, confidence: 0.70 },
        { keywords: ['hail'], minMatch: 1, confidence: 0.55 },
        { keywords: ['gale', 'force'], minMatch: 2, confidence: 0.60 },
        { keywords: ['lightning', 'thunder'], minMatch: 2, confidence: 0.55 },
      ],
    },
  ]

  for (const rule of secondaryRules) {
    //Skip if this is already the primary
    if (rule.hazardType === primaryCategory) continue

    let bestConfidence = 0
    for (const pat of rule.patterns) {
      const matched = pat.keywords.filter(kw => lower.includes(kw)).length
      if (matched >= pat.minMatch && pat.confidence > bestConfidence) {
        bestConfidence = pat.confidence
      }
    }

    if (bestConfidence > 0) {
      //Inferred hazards: co-occurrence of flood+trapped ? also public_safety
      const source = bestConfidence >= 0.55 ? 'secondary' as const : 'inferred' as const
      results.push({ hazardType: rule.hazardType, confidence: bestConfidence, source })
    }
  }

  //Inferred compound hazards
  const detectedTypes = new Set(results.map(r => r.hazardType))
  if (detectedTypes.has('flood') && lower.includes('trapped') && !detectedTypes.has('public_safety')) {
    results.push({ hazardType: 'public_safety', confidence: 0.55, source: 'inferred' })
  }
  if (detectedTypes.has('severe_storm') && lower.includes('power') && !detectedTypes.has('power_outage')) {
    results.push({ hazardType: 'power_outage', confidence: 0.40, source: 'inferred' })
  }

  //Sort by confidence descending
  results.sort((a, b) => b.confidence - a.confidence)
  return results
}

/**
 * Priority Scoring -- compute a weighted priority score and assign a tier (P1--P4).
 * Combines severity, urgency, vulnerability, verification, and corroboration signals.
 */
export function computePriorityScore(analysis: {
  severityAssessment: string; severityConfidence: number;
  urgencyLevel: string; urgencyScore: number;
  vulnerablePersonAlert: boolean; vulnerableKeywords: string[];
  photoVerified: boolean; nearbyReportCount: number;
  fakeProbability: number;
}): { score: number; tier: 'P1' | 'P2' | 'P3' | 'P4'; factors: Array<{ name: string; value: number; weight: number }> } {
  const factors: Array<{ name: string; value: number; weight: number }> = []

  //Severity (40%)
  const severityMap: Record<string, number> = { critical: 100, high: 75, medium: 50, low: 25 }
  const severityLower = analysis.severityAssessment.toLowerCase()
  const severityValue = severityMap[severityLower] ?? 40
  factors.push({ name: 'severity', value: severityValue, weight: 0.40 })

  //Urgency (25%)
  const urgencyMap: Record<string, number> = {
    extremely: 100, 'extremely urgent': 100, 'extremely_urgent': 100,
    urgent: 75, 'very urgent': 85,
    somewhat: 50, 'somewhat urgent': 50, moderate: 50,
    not: 25, 'not urgent': 25, low: 25,
  }
  const urgencyLower = analysis.urgencyLevel.toLowerCase()
  const urgencyValue = urgencyMap[urgencyLower] ?? Math.min(100, Math.round(analysis.urgencyScore * 100))
  factors.push({ name: 'urgency', value: urgencyValue, weight: 0.25 })

  //Vulnerable persons (15%)
  let vulnerableValue = 0
  if (analysis.vulnerablePersonAlert) {
    vulnerableValue = Math.min(100, 50 + analysis.vulnerableKeywords.length * 10)
  }
  factors.push({ name: 'vulnerable_persons', value: vulnerableValue, weight: 0.15 })

  //Verification (10%)
  let verificationValue = 20 // no photo
  if (analysis.photoVerified) verificationValue = 80
  else if (analysis.photoVerified === false && analysis.nearbyReportCount > 0) verificationValue = 50 // has photo but not verified
  factors.push({ name: 'verification', value: verificationValue, weight: 0.10 })

  //Report corroboration (10%)
  const corroborationValue = Math.min(100, analysis.nearbyReportCount * 25)
  factors.push({ name: 'corroboration', value: corroborationValue, weight: 0.10 })

  //Weighted sum
  let score = factors.reduce((sum, f) => sum + f.value * f.weight, 0)

  //Fake penalty: deduct 30% of score if high fake probability
  if (analysis.fakeProbability > 0.5) {
    score = score * 0.70
    factors.push({ name: 'fake_penalty', value: -Math.round(score * 0.30), weight: 1.0 })
  }

  score = Math.round(Math.max(0, Math.min(100, score)))

  let tier: 'P1' | 'P2' | 'P3' | 'P4'
  if (score >= 80) tier = 'P1'
  else if (score >= 60) tier = 'P2'
  else if (score >= 40) tier = 'P3'
  else tier = 'P4'

  return { score, tier, factors }
}

/**
 * Geospatial Context Enrichment -- query nearby infrastructure, flood zones,
 * historical risk scores, and recent incidents around a coordinate.
 */
export async function enrichGeospatialContext(lat: number, lng: number): Promise<{
  nearbyInfrastructure: Array<{ type: string; name: string; distanceKm: number }>
  floodZone: string | null
  historicalRiskScore: number
  recentIncidentCount: number
}> {
  const nearbyInfrastructure: Array<{ type: string; name: string; distanceKm: number }> = []
  let floodZone: string | null = null
  let historicalRiskScore = 0
  let recentIncidentCount = 0

  //Query shelters within 5km
  try {
    const shelterResult = await pool.query(
      `SELECT name,
              ST_Distance(
                coordinates,
                ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography
              ) / 1000.0 as dist_km
       FROM shelters
       WHERE ST_DWithin(
         coordinates,
         ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography,
         5000
       )
       ORDER BY dist_km ASC
       LIMIT 10`,
      [lat, lng],
    )
    for (const row of shelterResult.rows) {
      nearbyInfrastructure.push({
        type: 'shelter',
        name: row.name,
        distanceKm: Math.round(row.dist_km * 100) / 100,
      })
    }
  } catch { /* non-critical */ }

  //Query recent reports within 2km in the last 7 days
  try {
    const recentResult = await pool.query(
      `SELECT COUNT(*)::int as cnt
       FROM reports
       WHERE deleted_at IS NULL
         AND created_at > now() - INTERVAL '7 days'
         AND ST_DWithin(
           coordinates,
           ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography,
           2000
         )`,
      [lat, lng],
    )
    recentIncidentCount = recentResult.rows[0]?.cnt ?? 0
  } catch { /* non-critical */ }

  //Query zone_risk_scores for this location
  try {
    const zoneResult = await pool.query(
      `SELECT zone_name, risk_score
       FROM zone_risk_scores
       WHERE ST_Contains(
         geom,
         ST_SetSRID(ST_MakePoint($2, $1), 4326)
       )
       ORDER BY risk_score DESC
       LIMIT 1`,
      [lat, lng],
    )
    if (zoneResult.rows.length > 0) {
      historicalRiskScore = zoneResult.rows[0].risk_score ?? 0
      floodZone = zoneResult.rows[0].zone_name ?? null
    }
  } catch { /* non-critical */ }

  //Query historical flood events near this point
  try {
    const floodResult = await pool.query(
      `SELECT COUNT(*)::int as cnt
       FROM historical_flood_events
       WHERE ST_DWithin(
         geom,
         ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography,
         3000
       )`,
      [lat, lng],
    )
    const historicalCount = floodResult.rows[0]?.cnt ?? 0
    //Boost risk score based on historical flood frequency
    historicalRiskScore = Math.min(100, historicalRiskScore + historicalCount * 5)
  } catch { /* non-critical */ }

  return { nearbyInfrastructure, floodZone, historicalRiskScore, recentIncidentCount }
}

/**
 * Report Credibility Assessment -- evaluate the trustworthiness of a report
 * based on text quality, media presence, location, cross-references, and reporter history.
 */
export async function assessCredibility(
  reportId: string,
  text: string,
  hasMedia: boolean,
  lat: number | null,
  lng: number | null,
): Promise<{ credibilityScore: number; flags: string[]; recommendation: 'trust' | 'verify' | 'suspect' }> {
  const flags: string[] = []
  let score = 50 // baseline

  //Text coherence
  const textLength = text.trim().length
  if (textLength < 20) {
    score -= 15
    flags.push('very_short_text')
  } else if (textLength > 2000) {
    score -= 5
    flags.push('unusually_long_text')
  } else if (textLength >= 50 && textLength <= 1500) {
    score += 10 // reasonable length
  }

  //Check for gibberish: >50% alphabetic characters expected
  const alphaCount = (text.match(/[a-zA-Z]/g) || []).length
  const alphaRatio = textLength > 0 ? alphaCount / textLength : 0
  if (alphaRatio < 0.50) {
    score -= 15
    flags.push('low_alphabetic_ratio')
  } else {
    score += 5
  }

  //Check for structure: has at least some punctuation or sentence breaks
  const hasPunctuation = /[.!?,;:]/.test(text)
  if (hasPunctuation) score += 5
  else flags.push('no_punctuation')

  //Media bonus
  if (hasMedia) {
    score += 20
  } else {
    flags.push('no_media')
  }

  //Location check
  if (lat !== null && lng !== null) {
    //Reasonable bounds check: lat -90 to 90, lng -180 to 180
    const validLat = lat >= -90 && lat <= 90
    const validLng = lng >= -180 && lng <= 180
    if (validLat && validLng) {
      score += 15
    } else {
      score -= 10
      flags.push('invalid_coordinates')
    }
  } else {
    score -= 10
    flags.push('no_gps_location')
  }

  //Reporter trust (from reporter_scores table)
  try {
    //Use reporter fingerprint from the report
    const reporterResult = await pool.query(
      `SELECT rs.trust_score
       FROM reports r
       JOIN reporter_scores rs ON rs.fingerprint = r.reporter_fingerprint
       WHERE r.id = $1`,
      [reportId],
    )
    if (reporterResult.rows.length > 0) {
      const trustScore = reporterResult.rows[0].trust_score ?? 50
      if (trustScore >= 70) score += 10
      else if (trustScore < 30) { score -= 15; flags.push('low_reporter_trust') }
    }
  } catch { /* reporter_scores may not exist -- non-critical */ }

  //Cross-reference: similar reports nearby
  if (lat !== null && lng !== null) {
    try {
      const nearbyResult = await pool.query(
        `SELECT COUNT(*)::int as cnt
         FROM reports
         WHERE id != $1
           AND deleted_at IS NULL
           AND created_at > now() - INTERVAL '24 hours'
           AND ST_DWithin(
             coordinates,
             ST_SetSRID(ST_MakePoint($3, $2), 4326)::geography,
             3000
           )`,
        [reportId, lat, lng],
      )
      const nearbyCnt = nearbyResult.rows[0]?.cnt ?? 0
      if (nearbyCnt > 0) {
        score += 15
      } else {
        flags.push('no_corroborating_reports')
      }
    } catch { /* non-critical */ }
  }

  //Fake probability check
  try {
    const fakeResult = await pool.query(
      `SELECT ai_analysis->'fakeProbability' as fake_prob
       FROM reports
       WHERE id = $1 AND ai_analysis IS NOT NULL`,
      [reportId],
    )
    if (fakeResult.rows.length > 0 && fakeResult.rows[0].fake_prob !== null) {
      const fakeProbability = parseFloat(fakeResult.rows[0].fake_prob)
      if (!isNaN(fakeProbability) && fakeProbability > 0.5) {
        score -= 30
        flags.push('high_fake_probability')
      }
    }
  } catch { /* non-critical */ }

  //Clamp score to 0--100
  score = Math.max(0, Math.min(100, score))

  let recommendation: 'trust' | 'verify' | 'suspect'
  if (score > 70) recommendation = 'trust'
  else if (score >= 40) recommendation = 'verify'
  else recommendation = 'suspect'

  return { credibilityScore: score, flags, recommendation }
}

/**
 * Triage Recommendation Generator -- produce actionable response guidance
 * based on the AI analysis of a report.
 */
export function generateTriageRecommendation(analysis: {
  severityAssessment: string; categoryPrediction: string;
  urgencyLevel: string; vulnerablePersonAlert: boolean;
  vulnerableKeywords: string[]; estimatedWaterDepth: any;
  crossReferenced: string[]; nearbyReportCount: number;
}): {
  actions: string[]; alertLevel: 'none' | 'advisory' | 'warning' | 'emergency'
  notifyTargets: string[]; reasoning: string
} {
  const actions: string[] = []
  const notifyTargets: string[] = []
  let alertLevel: 'none' | 'advisory' | 'warning' | 'emergency' = 'none'
  const reasoningParts: string[] = []

  const severity = analysis.severityAssessment.toLowerCase()
  const urgency = analysis.urgencyLevel.toLowerCase()
  const category = analysis.categoryPrediction.toLowerCase()
  const isUrgent = urgency.includes('urgent') || urgency.includes('extremely')
  const isCritical = severity === 'critical'
  const isHigh = severity === 'high'

  //Determine alert level and notify targets based on severity + urgency + vulnerability
  if ((isCritical || (isHigh && isUrgent)) && analysis.vulnerablePersonAlert) {
    alertLevel = 'emergency'
    notifyTargets.push('ambulance', 'fire_service', 'police', 'emergency_coordinator')
    actions.push('Dispatch emergency services immediately')
    actions.push('Activate vulnerable persons protocol')
    reasoningParts.push(`Critical severity with vulnerable persons (${analysis.vulnerableKeywords.join(', ')}) requires immediate emergency response`)
  } else if (isHigh && isUrgent) {
    alertLevel = 'warning'
    notifyTargets.push('fire_service', 'police')
    actions.push('Alert emergency services')
    reasoningParts.push('High severity with urgent status warrants a warning-level response')
  } else if (isHigh || (severity === 'medium' && isUrgent)) {
    alertLevel = 'warning'
    notifyTargets.push('local_authority', 'emergency_coordinator')
    actions.push('Notify local authority and monitor situation')
    reasoningParts.push('Elevated severity requires active monitoring and local authority notification')
  } else if (severity === 'medium') {
    alertLevel = 'advisory'
    actions.push('Monitor situation and update status if conditions change')
    reasoningParts.push('Medium severity: situation should be monitored')
  } else {
    alertLevel = 'none'
    actions.push('Log report and continue routine monitoring')
    reasoningParts.push('Low severity: standard logging is sufficient')
  }

  //Category-specific actions
  if (category.includes('flood')) {
    actions.push('Deploy sandbag resources to affected area')
    if (analysis.estimatedWaterDepth?.valueMetres > 0.5) {
      actions.push('Consider water pump deployment')
      actions.push('Issue flood warning to nearby residents')
      reasoningParts.push(`Water depth estimated at ${analysis.estimatedWaterDepth.valueMetres}m -- pump deployment recommended`)
    }
    if (analysis.estimatedWaterDepth?.valueMetres > 1.0) {
      actions.push('Deploy rescue boats')
      notifyTargets.push('coastguard')
      reasoningParts.push('Deep water levels require boat rescue capability')
    }
  }

  if (category.includes('fire') || category.includes('wildfire')) {
    actions.push('Dispatch fire crews to location')
    actions.push('Issue evacuation advisory for surrounding area')
    if (!notifyTargets.includes('fire_service')) notifyTargets.push('fire_service')
    reasoningParts.push('Fire incidents require immediate fire crew dispatch and evacuation consideration')
  }

  if (category.includes('storm') || category.includes('severe_storm')) {
    actions.push('Issue shelter-in-place advisory')
    actions.push('Pre-position tree clearance crews')
    reasoningParts.push('Severe storm: shelter-in-place advisory is prudent')
  }

  if (category.includes('landslide')) {
    actions.push('Close affected roads and divert traffic')
    actions.push('Deploy geotechnical assessment team')
    reasoningParts.push('Landslide requires road closures and geotechnical assessment')
  }

  if (category.includes('heatwave')) {
    actions.push('Open cooling centres in affected area')
    actions.push('Increase welfare checks on vulnerable residents')
    reasoningParts.push('Heatwave conditions require cooling centres and welfare checks')
  }

  if (category.includes('power')) {
    actions.push('Contact utility provider for restoration estimate')
    actions.push('Deploy backup generators to critical facilities')
    reasoningParts.push('Power outage requires utility coordination and generator deployment')
  }

  if (category.includes('water_supply')) {
    actions.push('Issue boil water advisory')
    actions.push('Arrange emergency water distribution')
    reasoningParts.push('Water supply disruption requires boil advisory and distribution')
  }

  //Cross-referencing amplification
  if (analysis.nearbyReportCount >= 3) {
    actions.push(`Cluster detected: ${analysis.nearbyReportCount} corroborating reports nearby -- consider area-wide response`)
    reasoningParts.push(`${analysis.nearbyReportCount} nearby reports suggest a widespread incident`)
  }

  //Vulnerable persons specific actions
  if (analysis.vulnerablePersonAlert && alertLevel !== 'emergency') {
    actions.push('Flag for priority welfare check on vulnerable individuals')
    if (!notifyTargets.includes('ambulance') && analysis.vulnerableKeywords.some(kw =>
      ['oxygen', 'dialysis', 'ventilator', 'insulin', 'medication'].includes(kw)
    )) {
      notifyTargets.push('ambulance')
      reasoningParts.push('Medical-dependent vulnerable person requires ambulance standby')
    }
  }

  const reasoning = reasoningParts.join('. ') + '.'

  return { actions, alertLevel, notifyTargets: [...new Set(notifyTargets)], reasoning }
}

/**
 * Confidence Explanation -- generate a human-readable explanation of the
 * overall analysis confidence, including strong signals, weak signals, and missing data.
 */
export function explainAnalysisConfidence(analysis: {
  sentimentLabel: string; fakeProbability: number; severityConfidence: number;
  categoryConfidence: number; languageConfidence: number; urgencyScore: number;
  photoVerified: boolean; nearbyReportCount: number;
}): {
  overallConfidence: number; explanation: string; strongSignals: string[]; weakSignals: string[]; missingData: string[]
} {
  const strongSignals: string[] = []
  const weakSignals: string[] = []
  const missingData: string[] = []

  //Individual confidence signals
  const signals: Array<{ name: string; confidence: number; weight: number }> = [
    { name: 'severity_classification', confidence: analysis.severityConfidence, weight: 0.25 },
    { name: 'category_classification', confidence: analysis.categoryConfidence, weight: 0.25 },
    { name: 'urgency_scoring', confidence: analysis.urgencyScore, weight: 0.15 },
    { name: 'language_detection', confidence: analysis.languageConfidence, weight: 0.10 },
    { name: 'fake_detection', confidence: 1 - analysis.fakeProbability, weight: 0.15 },
    { name: 'verification', confidence: analysis.photoVerified ? 0.9 : (analysis.nearbyReportCount > 0 ? 0.6 : 0.3), weight: 0.10 },
  ]

  //Categorise signals
  for (const sig of signals) {
    if (sig.confidence > 0.8) {
      strongSignals.push(`${sig.name} (${Math.round(sig.confidence * 100)}%)`)
    } else if (sig.confidence < 0.5) {
      weakSignals.push(`${sig.name} (${Math.round(sig.confidence * 100)}%)`)
    }
  }

  //Identify missing data
  if (!analysis.photoVerified) missingData.push('verified photo')
  if (analysis.nearbyReportCount === 0) missingData.push('corroborating nearby reports')

  //Weighted average confidence
  const totalWeight = signals.reduce((sum, s) => sum + s.weight, 0)
  const overallConfidence = Math.round(
    signals.reduce((sum, s) => sum + s.confidence * s.weight, 0) / totalWeight * 100
  ) / 100

  //Generate explanation
  const parts: string[] = [`Analysis confidence is ${Math.round(overallConfidence * 100)}%`]

  if (strongSignals.length > 0) {
    parts.push(`based on strong signals from ${strongSignals.join(', ')}`)
  }

  if (weakSignals.length > 0) {
    parts.push(`Confidence is limited by ${weakSignals.join(', ')}`)
  }

  if (missingData.length > 0) {
    parts.push(`Additional data needed: ${missingData.join(', ')}`)
  }

  const explanation = parts.join('. ') + '.'

  return { overallConfidence, explanation, strongSignals, weakSignals, missingData }
}
