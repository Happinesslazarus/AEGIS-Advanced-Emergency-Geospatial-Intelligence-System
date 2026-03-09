/**
 * services/aiAnalysisPipeline.ts — Report AI analysis orchestrator
 *
 * When a new report is submitted, this pipeline runs every applicable
 * AI analysis step in parallel where possible:
 *
 *   1. Sentiment analysis (HuggingFace cardiffnlp/twitter-roberta-base)
 *   2. Fake/misinformation detection (roberta-base-openai-detector)
 *   3. Severity assessment (zero-shot BART-large-MNLI)
 *   4. Category classification (zero-shot BART-large-MNLI)
 *   5. Language detection (xlm-roberta-base-language-detection)
 *   6. Urgency scoring (zero-shot BART-large-MNLI)
 *   7. Image analysis (if media attached)
 *   8. Cross-referencing with recent reports in the same area
 *   9. Vulnerable person keyword detection
 *  10. Damage estimation via LLM
 *
 * Results are stored in the reports.ai_analysis JSONB column and
 * logged in the ai_executions table for transparency.
 *
 * The pipeline is non-blocking: if any step fails, the others still
 * complete and the failure is logged without stopping the report flow.
 */

import pool from '../models/db.js'
import { classify } from './classifierRouter.js'
import { chatCompletion } from './llmRouter.js'
import { analyseImage } from './imageAnalysisService.js'
import { enforceGovernance } from './governanceEngine.js'
import type { ClassifierResponse } from '../types/index.js'
import { devLog } from '../utils/logger.js'

// ═══════════════════════════════════════════════════════════════════════════════
// §1  PIPELINE TYPES
// ═══════════════════════════════════════════════════════════════════════════════

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
}

// ═══════════════════════════════════════════════════════════════════════════════
// §2  INDIVIDUAL ANALYSIS STEPS
// ═══════════════════════════════════════════════════════════════════════════════

/** Step 1: Sentiment analysis — detects emotional tone of report text */
async function analyseSentiment(text: string): Promise<{ score: number; label: string; panicLevel: string }> {
  const result = await classify({ text, task: 'sentiment' })
  const score = result.score

  // Map sentiment to panic level based on negative sentiment strength
  let panicLevel = 'None'
  const negativeLabels = ['negative', 'NEGATIVE', 'LABEL_0']
  if (negativeLabels.includes(result.label)) {
    if (score > 0.9) panicLevel = 'High'
    else if (score > 0.7) panicLevel = 'Moderate'
    else if (score > 0.4) panicLevel = 'Low'
  }

  return { score, label: result.label, panicLevel }
}

/** Step 2: Fake/misinformation detection */
async function detectFake(text: string): Promise<{ probability: number; label: string }> {
  const result = await classify({ text, task: 'fake_detection' })
  return { probability: result.score, label: result.label }
}

/** Step 3: Severity assessment via zero-shot classification */
async function assessSeverity(text: string): Promise<{ assessment: string; confidence: number }> {
  const result = await classify({ text, task: 'severity' })
  return { assessment: result.label, confidence: result.score }
}

/** Step 4: Category prediction */
async function predictCategory(text: string): Promise<{ category: string; confidence: number }> {
  const result = await classify({ text, task: 'category' })
  return { category: result.label, confidence: result.score }
}

/** Step 5: Language detection */
async function detectLanguage(text: string): Promise<{ language: string; confidence: number }> {
  const result = await classify({ text, task: 'language' })
  return { language: result.label, confidence: result.score }
}

/** Step 6: Urgency scoring */
async function scoreUrgency(text: string): Promise<{ level: string; score: number }> {
  const result = await classify({ text, task: 'urgency' })
  return { level: result.label, score: result.score }
}

/** Step 7: Vulnerable person keyword detection */
function detectVulnerablePersons(text: string): { alert: boolean; keywords: string[] } {
  const vulnerableKeywords = [
    'elderly', 'disabled', 'wheelchair', 'child', 'children', 'baby', 'infant',
    'pregnant', 'mobility', 'blind', 'deaf', 'oxygen', 'dialysis', 'dementia',
    'alzheimer', 'care home', 'nursing home', 'hospital', 'vulnerable', 'frail',
    'bedridden', 'oxygen tank', 'ventilator', 'medication', 'insulin',
  ]

  const lower = text.toLowerCase()
  const found = vulnerableKeywords.filter((kw) => lower.includes(kw))
  return { alert: found.length > 0, keywords: found }
}

/** Step 8: Cross-reference with nearby recent reports */
async function crossReference(
  lat: number, lng: number, reportId: string,
): Promise<{ reportIds: string[]; count: number }> {
  try {
    // Find reports within 5km submitted in the last 24 hours
    const result = await pool.query(
      `SELECT id::text, location_text
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
    return { reportIds: result.rows.map((r: any) => r.id), count: result.rows.length }
  } catch {
    return { reportIds: [], count: 0 }
  }
}

/** Step 9: Damage estimation via LLM (only for verified/urgent reports) */
async function estimateDamage(
  description: string, location: string, severity: string,
): Promise<{ estimatedCost: string; affectedProperties: number; confidence: number } | null> {
  try {
    const response = await chatCompletion({
      messages: [
        {
          role: 'system',
          content: 'You are a disaster damage assessment expert. Given an emergency report, estimate the potential damage. Respond ONLY with valid JSON: {"estimatedCost": "£X-£Y", "affectedProperties": N, "confidence": 0.0-1.0}. Be conservative in estimates.',
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

// ═══════════════════════════════════════════════════════════════════════════════
// §3  MAIN PIPELINE
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Run the complete AI analysis pipeline on a report.
 * Non-blocking: individual step failures don't cascade.
 *
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

  // Run independent steps in parallel for speed
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
    crossReference(lat, lng, reportId),
  ])

  // Extract results with fallbacks for failed steps
  const sentimentVal = sentiment.status === 'fulfilled' ? sentiment.value : { score: 0, label: 'unknown', panicLevel: 'None' }
  const fakeVal = fake.status === 'fulfilled' ? fake.value : { probability: 0, label: 'unknown' }
  const severityVal = severityResult.status === 'fulfilled' ? severityResult.value : { assessment: 'unknown', confidence: 0 }
  const categoryVal = category.status === 'fulfilled' ? category.value : { category: 'unknown', confidence: 0 }
  const languageVal = language.status === 'fulfilled' ? language.value : { language: 'en', confidence: 0 }
  const urgencyVal = urgency.status === 'fulfilled' ? urgency.value : { level: 'unknown', score: 0 }
  const vulnerableVal = vulnerable.status === 'fulfilled' ? vulnerable.value : { alert: false, keywords: [] }
  const crossRefVal = crossRef.status === 'fulfilled' ? crossRef.value : { reportIds: [], count: 0 }

  // Track which models were used
  if (sentiment.status === 'fulfilled') modelsUsed.push('sentiment-roberta')
  if (fake.status === 'fulfilled') modelsUsed.push('fake-detector')
  if (severityResult.status === 'fulfilled') modelsUsed.push('severity-bart-mnli')
  if (category.status === 'fulfilled') modelsUsed.push('category-bart-mnli')
  if (language.status === 'fulfilled') modelsUsed.push('language-xlm-roberta')
  if (urgency.status === 'fulfilled') modelsUsed.push('urgency-bart-mnli')

  // Damage estimation only for high-severity reports (expensive LLM call)
  let damageEstimate = null
  if (severity === 'high' || urgencyVal.level?.includes('urgent')) {
    damageEstimate = await estimateDamage(text, location, severity)
    if (damageEstimate) modelsUsed.push('damage-llm')
  }

  // Step 10: Photo analysis via CNN (if media attached)
  let photoVerified = false
  let photoValidation: AIAnalysisResult['photoValidation'] = null

  if (hasMedia) {
    try {
      // Look up media URL from DB
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
      console.warn(`[AI Pipeline] Image analysis failed for ${reportId}: ${imgErr.message}`)
    }
  }

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
    damageEstimate,
    photoVerified,
    photoValidation,
    modelsUsed,
    processingTimeMs: Date.now() - start,
  }

  // Run governance checks (human-in-the-loop enforcement)
  const governance = await enforceGovernance(
    reportId,
    Math.round(categoryVal.confidence * 100),
    fakeVal.probability,
    vulnerableVal.alert,
    severityVal.assessment,
  ).catch(() => null)

  // Persist results to the database
  try {
    const confidenceScore = Math.round(categoryVal.confidence * 100)
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

    // Log AI execution for transparency dashboard
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
    console.error(`[AI Pipeline] Failed to persist results for ${reportId}: ${err.message}`)
  }

  devLog(`[AI Pipeline] Report ${reportId} analysed in ${result.processingTimeMs}ms — ${modelsUsed.length} models used`)
  return result
}

/**
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
    console.error(`[AI Pipeline] Re-analysis failed for ${reportId}: ${err.message}`)
    return null
  }
}
