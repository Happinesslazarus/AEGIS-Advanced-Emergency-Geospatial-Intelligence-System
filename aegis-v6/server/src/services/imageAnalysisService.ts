/**
 * Disaster photo analyser -- processes uploaded images through HuggingFace
 * vision models (ViT for classification, DETR for object detection), extracts
 * EXIF metadata (GPS, timestamps), and estimates flood damage severity.
 *
 * - Called by aiAnalysisPipeline when a report includes photos
 * - Calls HuggingFace Vision APIs (ViT, DETR) for classification/detection
 * - Parses EXIF data with the exifr library for geolocation and timestamps
 * */

import pool from '../models/db.js'
import * as fs from 'fs'
import * as path from 'path'
import exifr from 'exifr'
import { devLog } from '../utils/logger.js'
import { logger } from './logger.js'

const HF_API_KEY = process.env.HF_API_KEY || ''
const HF_BASE_URL = 'https://router.huggingface.co'

//Models for different tasks
const IMAGE_CLASSIFIER_MODEL = process.env.HF_IMAGE_CLASSIFIER || 'google/vit-base-patch16-224'
const OBJECT_DETECTOR_MODEL = process.env.HF_OBJECT_DETECTOR || 'facebook/detr-resnet-50'

//Disaster-related labels from ImageNet/ViT classification
const DISASTER_LABELS = new Set([
  'flood', 'dam', 'water', 'rain', 'storm', 'tornado', 'fire',
  'volcano', 'earthquake', 'landslide', 'tsunami', 'debris',
  'lakeside', 'river', 'waterfall', 'bridge', 'breakwater',
  'seashore', 'sandbar', 'cliff', 'geyser', 'valley',
])

const WATER_LABELS = new Set([
  'flood', 'dam', 'lakeside', 'river', 'waterfall', 'breakwater',
  'seashore', 'sandbar', 'fountain', 'swimming pool', 'water',
])

export interface PhotoValidationResult {
  isFloodRelated: boolean
  waterDetected: boolean
  waterConfidence: number
  objectsDetected: string[]
  imageQuality: 'low' | 'medium' | 'high'
  disasterConfidence: number
  classifications: Array<{ label: string; score: number }>
  detections: Array<{ label: string; score: number; box: any }>
}

export interface ExifAnalysisResult {
  hasExif: boolean
  exifLat: number | null
  exifLng: number | null
  exifTimestamp: Date | null
  locationMatch: boolean | null
  timeMatch: boolean | null
  locationDistanceKm: number | null
  /* Formal temporal plausibility score 0.0-1.0 (null if no EXIF timestamp) */
  temporalPlausibilityScore: number | null
  /* Human-readable plausibility classification */
  temporalPlausibilityLabel: 'verified' | 'recent' | 'outdated' | 'suspicious' | 'unknown'
  /* Signed delta in hours between EXIF capture time and submission time */
  temporalDeltaHours: number | null
}

export interface FullImageAnalysis {
  photoValidation: PhotoValidationResult
  exifAnalysis: ExifAnalysisResult
  modelUsed: string
  processingTimeMs: number
}


async function classifyImage(imageBuffer: Buffer): Promise<Array<{ label: string; score: number }>> {
  if (!HF_API_KEY) {
    logger.warn('[ImageAnalysis] No HF_API_KEY - using heuristic fallback')
    return [{ label: 'unknown', score: 0 }]
  }

  try {
    const res = await fetch(`${HF_BASE_URL}/models/${IMAGE_CLASSIFIER_MODEL}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${HF_API_KEY}`,
        'Content-Type': 'application/octet-stream',
      },
      body: new Uint8Array(imageBuffer),
    })

    if (!res.ok) {
      logger.error({ status: res.status }, '[ImageAnalysis] Classification failed')
      return [{ label: 'unknown', score: 0 }]
    }

    const results = await res.json() as Array<{ label: string; score: number }>
    return results.slice(0, 10) // Top 10 predictions
  } catch (err: any) {
    logger.error({ err }, '[ImageAnalysis] Classification error')
    return [{ label: 'unknown', score: 0 }]
  }
}


async function detectObjects(imageBuffer: Buffer): Promise<Array<{ label: string; score: number; box: any }>> {
  if (!HF_API_KEY) return []

  try {
    const res = await fetch(`${HF_BASE_URL}/models/${OBJECT_DETECTOR_MODEL}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${HF_API_KEY}`,
        'Content-Type': 'application/octet-stream',
      },
      body: new Uint8Array(imageBuffer),
    })

    if (!res.ok) return []

    const results = await res.json() as Array<{ label: string; score: number; box: any }>
    return results.filter(r => r.score > 0.3) // Only confident detections
  } catch {
    return []
  }
}


async function extractExif(imageBuffer: Buffer): Promise<ExifAnalysisResult> {
  const result: ExifAnalysisResult = {
    hasExif: false,
    exifLat: null,
    exifLng: null,
    exifTimestamp: null,
    locationMatch: null,
    timeMatch: null,
    locationDistanceKm: null,
    temporalPlausibilityScore: null,
    temporalPlausibilityLabel: 'unknown',
    temporalDeltaHours: null,
  }

  try {
    //Parse full EXIF data with exifr
    const parsed = await exifr.parse(imageBuffer, {
      gps: true,
      tiff: true,
      exif: true,
      //Return all available tags
      pick: ['GPSLatitude', 'GPSLatitudeRef', 'GPSLongitude', 'GPSLongitudeRef',
             'DateTimeOriginal', 'DateTime', 'CreateDate',
             'latitude', 'longitude'],
    })

    if (!parsed) return result
    result.hasExif = true

    //Extract GPS coordinates - exifr auto-converts DMS to decimal degrees
    //and applies N/S, E/W sign correction when returning latitude/longitude
    const lat = parsed.latitude ?? parsed.GPSLatitude ?? null
    const lng = parsed.longitude ?? parsed.GPSLongitude ?? null

    if (typeof lat === 'number' && isFinite(lat) && typeof lng === 'number' && isFinite(lng)) {
      result.exifLat = lat
      result.exifLng = lng
    }

    //Extract timestamp - exifr returns Date objects for date fields
    const rawDate = parsed.DateTimeOriginal ?? parsed.DateTime ?? parsed.CreateDate ?? null
    if (rawDate instanceof Date && !isNaN(rawDate.getTime())) {
      result.exifTimestamp = rawDate
    } else if (typeof rawDate === 'string') {
      //Handle string format "YYYY:MM:DD HH:MM:SS"
      const dateMatch = rawDate.match(/(\d{4}):(\d{2}):(\d{2})\s+(\d{2}):(\d{2}):(\d{2})/)
      if (dateMatch) {
        const [, y, m, d, h, min, s] = dateMatch
        const parsed2 = new Date(`${y}-${m}-${d}T${h}:${min}:${s}`)
        if (!isNaN(parsed2.getTime())) {
          result.exifTimestamp = parsed2
        }
      }
    }
  } catch {
    //EXIF parsing failures are non-critical - return default result
  }

  return result
}


 /*
 * Grades how plausible it is that an image was captured at the reported incident time.
 * Scoring rubric:
 * Future image (EXIF after submission)        ? 0.00  suspicious (fabricated/system clock error)
 * Captured within 1 hour of submission        ? 1.00  verified
 * 1h-6h before submission                     ? 0.90  verified  (minor gap, same event window)
 * 6h-24h before                               ? 0.72  recent    (same-day, plausible)
 * 1-3 days before                             ? 0.48  outdated  (possibly archived photo)
 * 3-7 days before                             ? 0.25  outdated  (low plausibility)
 * 7-30 days before                            ? 0.10  suspicious (archive, wrong event)
 * >30 days before                             ? 0.02  suspicious (clearly recycled)
 * @param exifTimestamp   DateTime extracted from EXIF (UTC)
 * @param submissionTime  When the report was submitted (defaults to now)
  */
function computeTemporalPlausibility(
  exifTimestamp: Date,
  submissionTime: Date = new Date(),
): {
  score: number
  label: ExifAnalysisResult['temporalPlausibilityLabel']
  deltaHours: number
} {
  //Positive deltaHours = image was taken BEFORE submission (normal)
  //Negative deltaHours = image timestamp is in the future relative to submission (anomalous)
  const deltaMs = submissionTime.getTime() - exifTimestamp.getTime()
  const deltaHours = deltaMs / 3_600_000

  let score: number
  let label: ExifAnalysisResult['temporalPlausibilityLabel']

  if (deltaHours < 0) {
    //EXIF timestamp is after submission - clock skew or fabrication
    score = 0.00
    label = 'suspicious'
  } else if (deltaHours <= 1) {
    score = 1.00
    label = 'verified'
  } else if (deltaHours <= 6) {
    //Linear decay from 1.00 ? 0.90 over the 1h-6h window
    score = Number((0.90 + (1 - (deltaHours - 1) / 5) * 0.10).toFixed(3))
    label = 'verified'
  } else if (deltaHours <= 24) {
    //Decay from 0.90 ? 0.72 over 6h-24h
    score = Number((0.72 + (1 - (deltaHours - 6) / 18) * 0.18).toFixed(3))
    label = 'recent'
  } else if (deltaHours <= 72) {
    //1-3 days
    score = Number((0.48 + (1 - (deltaHours - 24) / 48) * 0.24).toFixed(3))
    label = 'outdated'
  } else if (deltaHours <= 168) {
    //3-7 days
    score = Number((0.25 + (1 - (deltaHours - 72) / 96) * 0.23).toFixed(3))
    label = 'outdated'
  } else if (deltaHours <= 720) {
    //7-30 days
    score = Number((0.10 + (1 - (deltaHours - 168) / 552) * 0.15).toFixed(3))
    label = 'suspicious'
  } else {
    // >30 days
    score = 0.02
    label = 'suspicious'
  }

  return { score: Math.max(0, Math.min(1, score)), label, deltaHours: Math.round(deltaHours * 10) / 10 }
}

/* Haversine distance between two lat/lng points in km */
function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLng = ((lng2 - lng1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}


function assessImageQuality(imageBuffer: Buffer): 'low' | 'medium' | 'high' {
  const sizeKB = imageBuffer.length / 1024

  //Detect format
  const isJPEG = imageBuffer[0] === 0xFF && imageBuffer[1] === 0xD8
  const isPNG = imageBuffer[0] === 0x89 && imageBuffer[1] === 0x50

  //For JPEG: estimate dimensions from SOF0/SOF2 markers
  let estimatedPixels = 0
  if (isJPEG) {
    for (let i = 0; i < imageBuffer.length - 9; i++) {
      if (imageBuffer[i] === 0xFF && (imageBuffer[i + 1] === 0xC0 || imageBuffer[i + 1] === 0xC2)) {
        const height = imageBuffer.readUInt16BE(i + 5)
        const width = imageBuffer.readUInt16BE(i + 7)
        estimatedPixels = width * height
        break
      }
    }
  }

  //For PNG: dimensions are at fixed offset (bytes 16-23 in IHDR)
  if (isPNG && imageBuffer.length > 24) {
    const width = imageBuffer.readUInt32BE(16)
    const height = imageBuffer.readUInt32BE(20)
    estimatedPixels = width * height
  }

  //Quality scoring based on actual pixel count when available
  if (estimatedPixels > 0) {
    if (estimatedPixels < 100_000) return 'low'       // < ~316x316
    if (estimatedPixels < 500_000) return 'medium'     // < ~707x707
    return 'high'                                       // >= ~0.5MP
  }

  //Fallback to filesize if dimensions could not be extracted
  if (sizeKB < 30) return 'low'
  if (sizeKB < 150) return 'medium'
  return 'high'
}


 /*
 * Analyse an uploaded image for disaster relevance, objects, EXIF metadata.
 * Used by the report pipeline (Feature #5) and fusion engine (Feature #23).
 * @param imagePath   File path on disk (from multer upload)
 * @param reportLat   Reported latitude (for EXIF location verification)
 * @param reportLng   Reported longitude
 * @param reportId    UUID of the report (for DB storage)
  */
export async function analyseImage(
  imagePath: string,
  reportLat: number,
  reportLng: number,
  reportId?: string,
): Promise<FullImageAnalysis> {
  const start = Date.now()

  //Read image file
  let imageBuffer: Buffer
  try {
    const fullPath = path.resolve(imagePath)
    imageBuffer = fs.readFileSync(fullPath)
  } catch (err: any) {
    logger.error({ err }, '[ImageAnalysis] Failed to read image')
    return {
      photoValidation: {
        isFloodRelated: false,
        waterDetected: false,
        waterConfidence: 0,
        objectsDetected: [],
        imageQuality: 'low',
        disasterConfidence: 0,
        classifications: [],
        detections: [],
      },
      exifAnalysis: {
        hasExif: false,
        exifLat: null,
        exifLng: null,
        exifTimestamp: null,
        locationMatch: null,
        timeMatch: null,
        locationDistanceKm: null,
        temporalPlausibilityScore: null,
        temporalPlausibilityLabel: 'unknown',
        temporalDeltaHours: null,
      },
      modelUsed: 'none',
      processingTimeMs: Date.now() - start,
    }
  }

  //Run classification, detection, and EXIF extraction in parallel
  const [classifications, detections, exifRaw] = await Promise.all([
    classifyImage(imageBuffer),
    detectObjects(imageBuffer),
    extractExif(imageBuffer),
  ])

  //Determine flood/disaster relevance from classification
  let disasterConfidence = 0
  let waterConfidence = 0
  const objectsDetected: string[] = []

  for (const cls of classifications) {
    const labelLower = cls.label.toLowerCase()
    const labelWords = labelLower.split(/[\s,_]+/)

    for (const word of labelWords) {
      if (DISASTER_LABELS.has(word)) {
        disasterConfidence = Math.max(disasterConfidence, cls.score)
      }
      if (WATER_LABELS.has(word)) {
        waterConfidence = Math.max(waterConfidence, cls.score)
      }
    }
    if (cls.score > 0.1) {
      objectsDetected.push(cls.label)
    }
  }

  //Add detected objects from DETR
  for (const det of detections) {
    if (!objectsDetected.includes(det.label)) {
      objectsDetected.push(det.label)
    }
  }

  //EXIF location verification
  const exifAnalysis: ExifAnalysisResult = { ...exifRaw }
  if (exifRaw.exifLat !== null && exifRaw.exifLng !== null) {
    const distKm = haversineKm(reportLat, reportLng, exifRaw.exifLat, exifRaw.exifLng)
    exifAnalysis.locationDistanceKm = Math.round(distKm * 10) / 10
    exifAnalysis.locationMatch = distKm < 5 // Within 5km = match
  }

  //EXIF time verification - formal temporal plausibility scoring
  if (exifRaw.exifTimestamp) {
    const submissionTime = new Date()
    const timeDiffHours = (submissionTime.getTime() - exifRaw.exifTimestamp.getTime()) / 3_600_000
    exifAnalysis.timeMatch = timeDiffHours >= 0 && timeDiffHours < 24

    const temporal = computeTemporalPlausibility(exifRaw.exifTimestamp, submissionTime)
    exifAnalysis.temporalPlausibilityScore = temporal.score
    exifAnalysis.temporalPlausibilityLabel = temporal.label
    exifAnalysis.temporalDeltaHours = temporal.deltaHours
  } else {
    exifAnalysis.temporalPlausibilityScore = null
    exifAnalysis.temporalPlausibilityLabel = 'unknown'
    exifAnalysis.temporalDeltaHours = null
  }

  const imageQuality = assessImageQuality(imageBuffer)

  const photoValidation: PhotoValidationResult = {
    isFloodRelated: disasterConfidence > 0.3 || waterConfidence > 0.3,
    waterDetected: waterConfidence > 0.2,
    waterConfidence,
    objectsDetected: objectsDetected.slice(0, 10),
    imageQuality,
    disasterConfidence,
    classifications: classifications.slice(0, 5),
    detections: detections.slice(0, 10),
  }

  const processingTimeMs = Date.now() - start

  //Store results in database
  if (reportId) {
    try {
      await pool.query(
        `INSERT INTO image_analyses
         (report_id, image_url, is_disaster_related, water_detected, water_confidence,
          objects_detected, image_quality, exif_lat, exif_lng, exif_timestamp,
          exif_location_match, exif_time_match,
          temporal_plausibility_score, temporal_plausibility_label, temporal_delta_hours,
          model_used, confidence, raw_scores)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
         ON CONFLICT DO NOTHING`,
        [
          reportId, imagePath,
          photoValidation.isFloodRelated,
          photoValidation.waterDetected,
          photoValidation.waterConfidence,
          photoValidation.objectsDetected,
          photoValidation.imageQuality,
          exifAnalysis.exifLat, exifAnalysis.exifLng, exifAnalysis.exifTimestamp,
          exifAnalysis.locationMatch, exifAnalysis.timeMatch,
          exifAnalysis.temporalPlausibilityScore,
          exifAnalysis.temporalPlausibilityLabel,
          exifAnalysis.temporalDeltaHours,
          IMAGE_CLASSIFIER_MODEL,
          disasterConfidence,
          JSON.stringify({ classifications, detections }),
        ],
      )

      //Log AI execution
      await pool.query(
        `INSERT INTO ai_executions
         (model_name, model_version, input_payload, raw_response, execution_time_ms, target_type, target_id)
         VALUES ('image_analysis', 'v1.0', $1, $2, $3, 'report', $4)`,
        [
          JSON.stringify({ imagePath, reportLat, reportLng }),
          JSON.stringify(photoValidation),
          processingTimeMs,
          reportId,
        ],
      )
    } catch (err: any) {
      logger.error({ err }, '[ImageAnalysis] DB storage failed')
    }
  }

  devLog(`[ImageAnalysis] Completed in ${processingTimeMs}ms - disaster:${disasterConfidence.toFixed(2)} water:${waterConfidence.toFixed(2)}`)

  return {
    photoValidation,
    exifAnalysis,
    modelUsed: IMAGE_CLASSIFIER_MODEL,
    processingTimeMs,
  }
}


const FIRE_LABELS = new Set([
  'fire', 'volcano', 'wildfire', 'smoke', 'flame', 'blaze', 'torch',
])

const STRUCTURAL_DAMAGE_LABELS = new Set([
  'car', 'truck', 'bus', 'debris', 'wreck', 'ruin', 'rubble',
  'crane', 'bulldozer', 'container', 'barrier',
])

/**
 * Estimate damage severity from image classification and object detection results.
 * Combines water-related, fire-related, and structural indicators to produce
 * an overall severity grade with confidence score.
 */
export function estimateDamageSeverityFromImage(
  classifications: Array<{ label: string; score: number }>,
  detections: Array<{ label: string; score: number; box: any }>,
): { severity: 'low' | 'medium' | 'high' | 'critical'; confidence: number; indicators: string[] } {
  const indicators: string[] = []
  let maxWaterConf = 0
  let maxFireConf = 0
  let structuralCount = 0
  let disasterCategoryCount = 0

  //Scan classifications for water/fire/disaster labels
  for (const cls of classifications) {
    const words = cls.label.toLowerCase().split(/[\s,_]+/)
    for (const word of words) {
      if (WATER_LABELS.has(word) && cls.score > maxWaterConf) {
        maxWaterConf = cls.score
        indicators.push(`water:${word}(${cls.score.toFixed(2)})`)
      }
      if (FIRE_LABELS.has(word) && cls.score > maxFireConf) {
        maxFireConf = cls.score
        indicators.push(`fire:${word}(${cls.score.toFixed(2)})`)
      }
      if (DISASTER_LABELS.has(word) && cls.score > 0.2) {
        disasterCategoryCount++
      }
    }
  }

  //Scan detections for structural damage indicators
  for (const det of detections) {
    const labelLower = det.label.toLowerCase()
    if (STRUCTURAL_DAMAGE_LABELS.has(labelLower) && det.score > 0.4) {
      structuralCount++
      indicators.push(`structural:${labelLower}(${det.score.toFixed(2)})`)
    }
  }

  //Derive severity from strongest signal
  const dominantConf = Math.max(maxWaterConf, maxFireConf)
  let severity: 'low' | 'medium' | 'high' | 'critical'
  if (dominantConf < 0.3) severity = 'low'
  else if (dominantConf < 0.5) severity = 'medium'
  else if (dominantConf < 0.7) severity = 'high'
  else severity = 'critical'

  //Boost severity when multiple disaster categories are detected
  if (disasterCategoryCount >= 3 && severity !== 'critical') {
    const levels: Array<'low' | 'medium' | 'high' | 'critical'> = ['low', 'medium', 'high', 'critical']
    const idx = levels.indexOf(severity)
    severity = levels[Math.min(idx + 1, 3)]
    indicators.push('multi_disaster_boost')
  }

  //Boost severity when structural damage objects are present
  if (structuralCount >= 2 && severity !== 'critical') {
    const levels: Array<'low' | 'medium' | 'high' | 'critical'> = ['low', 'medium', 'high', 'critical']
    const idx = levels.indexOf(severity)
    severity = levels[Math.min(idx + 1, 3)]
    indicators.push('structural_damage_boost')
  }

  const confidence = Math.min(1.0, dominantConf * 0.6 + (structuralCount * 0.1) + (disasterCategoryCount * 0.05))

  return { severity, confidence: Number(confidence.toFixed(3)), indicators }
}


/* Known editor software signatures found in EXIF/metadata */
const EDITOR_SIGNATURES = [
  'Photoshop', 'GIMP', 'Paint.NET', 'Lightroom', 'Affinity',
  'Snapseed', 'PicsArt', 'Canva', 'FotoJet', 'Pixlr',
  'Adobe', 'CorelDRAW', 'Illustrator', 'FaceApp',
]

/**
 * Detect signs of image manipulation by inspecting the raw buffer for
 * editing software signatures, double-JPEG compression, EXIF stripping,
 * and suspicious file-size-to-format ratios.
 */
export function detectManipulation(imageBuffer: Buffer): {
  manipulationRisk: number; indicators: string[]; isLikelyAuthentic: boolean
} {
  const indicators: string[] = []
  let risk = 0

  const bufStr = imageBuffer.toString('binary')

  //1. Check for software editing tags
  for (const sig of EDITOR_SIGNATURES) {
    if (bufStr.includes(sig)) {
      risk += 0.3
      indicators.push(`editor_signature:${sig}`)
      break // One match is enough
    }
  }

  const isJPEG = imageBuffer[0] === 0xFF && imageBuffer[1] === 0xD8
  const isPNG = imageBuffer[0] === 0x89 && imageBuffer[1] === 0x50

  //2. Check for double JPEG compression (multiple SOI markers)
  if (isJPEG) {
    let soiCount = 0
    for (let i = 0; i < imageBuffer.length - 1; i++) {
      if (imageBuffer[i] === 0xFF && imageBuffer[i + 1] === 0xD8) {
        soiCount++
      }
    }
    if (soiCount > 1) {
      risk += 0.25
      indicators.push(`double_jpeg_compression(soi_count:${soiCount})`)
    }
  }

  //3. Check if EXIF was stripped (JPEG but no APP1 marker 0xFFE1)
  if (isJPEG) {
    const hasExifMarker = imageBuffer.indexOf(Buffer.from([0xFF, 0xE1])) !== -1
    if (!hasExifMarker) {
      risk += 0.15
      indicators.push('exif_stripped')
    }
  }

  //4. Check for unusually small file size (overcompressed)
  const sizeKB = imageBuffer.length / 1024
  if (isJPEG && sizeKB < 20) {
    risk += 0.2
    indicators.push(`overcompressed(${sizeKB.toFixed(0)}KB)`)
  } else if (isPNG && sizeKB < 10) {
    risk += 0.2
    indicators.push(`overcompressed_png(${sizeKB.toFixed(0)}KB)`)
  }

  risk = Math.min(1.0, risk)

  return {
    manipulationRisk: Number(risk.toFixed(3)),
    indicators,
    isLikelyAuthentic: risk < 0.4,
  }
}


const URBAN_LABELS = new Set([
  'building', 'skyscraper', 'office', 'apartment', 'church', 'mosque',
  'bridge', 'street', 'traffic', 'parking', 'car', 'bus', 'truck',
  'sidewalk', 'storefront', 'cinema', 'library', 'hospital',
])

const RURAL_LABELS = new Set([
  'field', 'farm', 'barn', 'meadow', 'pasture', 'crop', 'tractor',
  'forest', 'tree', 'woodland', 'grassland', 'hay',
])

const COASTAL_LABELS = new Set([
  'seashore', 'beach', 'coast', 'pier', 'lighthouse', 'sandbar',
  'cliff', 'breakwater', 'ocean', 'sea',
])

const RIVERSIDE_LABELS = new Set([
  'river', 'dam', 'waterfall', 'canal', 'lakeside', 'fountain',
])

const WEATHER_RAIN_LABELS = new Set(['rain', 'storm', 'overcast', 'fog', 'mist'])
const WEATHER_CLEAR_LABELS = new Set(['clear', 'sunny', 'blue sky'])

/**
 * Understand the scene depicted in an image by aggregating classification
 * and detection results into environment type, weather indicators, hazard
 * indicators, and a human-readable description.
 */
export function understandScene(
  classifications: Array<{ label: string; score: number }>,
  detections: Array<{ label: string; score: number; box: any }>,
): { description: string; environmentType: string; weatherIndicators: string[]; hazardIndicators: string[] } {
  const allLabels: string[] = []
  for (const cls of classifications) {
    allLabels.push(...cls.label.toLowerCase().split(/[\s,_]+/))
  }
  for (const det of detections) {
    allLabels.push(det.label.toLowerCase())
  }

  const labelSet = new Set(allLabels)

  //Classify environment type
  let urbanScore = 0
  let ruralScore = 0
  let coastalScore = 0
  let riversideScore = 0

  for (const label of labelSet) {
    if (URBAN_LABELS.has(label)) urbanScore++
    if (RURAL_LABELS.has(label)) ruralScore++
    if (COASTAL_LABELS.has(label)) coastalScore++
    if (RIVERSIDE_LABELS.has(label)) riversideScore++
  }

  const envScores: Array<[string, number]> = [
    ['urban', urbanScore],
    ['rural', ruralScore],
    ['coastal', coastalScore],
    ['riverside', riversideScore],
  ]
  envScores.sort((a, b) => b[1] - a[1])
  const environmentType = envScores[0][1] > 0 ? envScores[0][0] : 'suburban'

  //Weather indicators
  const weatherIndicators: string[] = []
  for (const label of labelSet) {
    if (WEATHER_RAIN_LABELS.has(label)) weatherIndicators.push(label)
    if (WEATHER_CLEAR_LABELS.has(label)) weatherIndicators.push(label)
  }
  if (weatherIndicators.length === 0) weatherIndicators.push('indeterminate')

  //Hazard indicators
  const hazardIndicators: string[] = []
  const hazardKeywords = ['water', 'flood', 'fire', 'smoke', 'debris', 'damage', 'storm', 'tornado', 'landslide']
  for (const label of labelSet) {
    if (hazardKeywords.includes(label)) hazardIndicators.push(label)
  }

  //Generate description
  const envDesc = environmentType.charAt(0).toUpperCase() + environmentType.slice(1)
  const weatherDesc = weatherIndicators[0] !== 'indeterminate' ? weatherIndicators.join(', ') : 'unclear weather'
  const hazardDesc = hazardIndicators.length > 0 ? hazardIndicators.join(', ') + ' detected' : 'no obvious hazards'
  const description = `${envDesc} area with ${allLabels.slice(0, 5).join(', ') || 'minimal features'}. ${weatherDesc} conditions. ${hazardDesc}.`

  return { description, environmentType, weatherIndicators, hazardIndicators }
}


/**
 * Compare two PhotoValidationResult analyses (e.g., before/after images) to
 * determine the magnitude, direction, and nature of change between frames.
 */
export function compareImageAnalyses(
  analysisA: PhotoValidationResult,
  analysisB: PhotoValidationResult,
): { changeMagnitude: number; changeType: string; description: string } {
  const waterDelta = analysisB.waterConfidence - analysisA.waterConfidence
  const disasterDelta = analysisB.disasterConfidence - analysisA.disasterConfidence

  //Overall change magnitude is the maximum absolute shift across signals
  const changeMagnitude = Math.max(Math.abs(waterDelta), Math.abs(disasterDelta))

  //Determine direction from the dominant signal
  const dominantDelta = Math.abs(waterDelta) >= Math.abs(disasterDelta) ? waterDelta : disasterDelta
  let changeType: string
  if (Math.abs(dominantDelta) < 0.05) {
    changeType = 'stable'
  } else if (dominantDelta > 0) {
    changeType = 'worsening'
  } else {
    changeType = 'improving'
  }

  //Build a human-readable description
  const parts: string[] = []
  if (Math.abs(waterDelta) >= 0.05) {
    parts.push(`water confidence ${waterDelta > 0 ? 'increased' : 'decreased'} by ${Math.abs(waterDelta).toFixed(2)}`)
  }
  if (Math.abs(disasterDelta) >= 0.05) {
    parts.push(`disaster confidence ${disasterDelta > 0 ? 'increased' : 'decreased'} by ${Math.abs(disasterDelta).toFixed(2)}`)
  }
  const description = parts.length > 0
    ? `Situation is ${changeType}: ${parts.join('; ')}.`
    : 'No significant change detected between frames.'

  return {
    changeMagnitude: Number(changeMagnitude.toFixed(3)),
    changeType,
    description,
  }
}


/**
 * Perform an enhanced quality assessment on a raw image buffer, checking
 * format, estimated resolution, aspect ratio hints, and common issues.
 * Returns a composite usability score (0-100).
 */
export function assessImageQualityEnhanced(imageBuffer: Buffer): {
  quality: 'low' | 'medium' | 'high'; resolution: string; issues: string[]; usabilityScore: number
} {
  const sizeKB = imageBuffer.length / 1024
  const issues: string[] = []
  let usabilityScore = 50 // Start at midpoint

  //Detect format
  const isJPEG = imageBuffer.length >= 2 && imageBuffer[0] === 0xFF && imageBuffer[1] === 0xD8
  const isPNG = imageBuffer.length >= 2 && imageBuffer[0] === 0x89 && imageBuffer[1] === 0x50
  const formatName = isJPEG ? 'JPEG' : isPNG ? 'PNG' : 'unknown'

  if (!isJPEG && !isPNG) {
    issues.push('unusual_format')
    usabilityScore -= 15
  }

  //Extract actual dimensions when possible
  let imgWidth = 0
  let imgHeight = 0
  if (isJPEG) {
    for (let i = 0; i < imageBuffer.length - 9; i++) {
      if (imageBuffer[i] === 0xFF && (imageBuffer[i + 1] === 0xC0 || imageBuffer[i + 1] === 0xC2)) {
        imgHeight = imageBuffer.readUInt16BE(i + 5)
        imgWidth = imageBuffer.readUInt16BE(i + 7)
        break
      }
    }
  } else if (isPNG && imageBuffer.length > 24) {
    imgWidth = imageBuffer.readUInt32BE(16)
    imgHeight = imageBuffer.readUInt32BE(20)
  }

  const pixels = imgWidth * imgHeight
  let resolution: string
  if (pixels > 0) {
    //Use actual dimensions
    resolution = `${imgWidth}x${imgHeight}`
    if (pixels < 100_000) {
      issues.push('too_small')
      usabilityScore -= 30
    } else if (pixels < 500_000) {
      usabilityScore -= 10
    } else if (pixels < 2_000_000) {
      usabilityScore += 10
    } else if (pixels < 8_000_000) {
      usabilityScore += 25
    } else {
      usabilityScore += 30
    }
  } else if (sizeKB < 30) {
    issues.push('too_small')
    resolution = 'very_low (<400px est.)'
    usabilityScore -= 30
  } else if (sizeKB < 100) {
    resolution = 'low (~640px est.)'
    usabilityScore -= 10
  } else if (sizeKB < 500) {
    resolution = 'medium (~1280px est.)'
    usabilityScore += 10
  } else if (sizeKB < 3000) {
    resolution = 'high (~2000px est.)'
    usabilityScore += 25
  } else {
    resolution = 'very_high (>2000px est.)'
    usabilityScore += 30
  }

  //Check for likely screenshot (PNG with small-to-medium size)
  if (isPNG && sizeKB < 300) {
    issues.push('likely_screenshot')
    usabilityScore -= 5
  }

  //Check EXIF presence for JPEGs (cameras usually embed EXIF)
  if (isJPEG) {
    const hasExif = imageBuffer.indexOf(Buffer.from([0xFF, 0xE1])) !== -1
    if (hasExif) {
      usabilityScore += 10 // Camera-sourced images are better evidence
    }
  }

  //Very small buffer might be corrupted
  if (imageBuffer.length < 500) {
    issues.push('corrupted')
    usabilityScore -= 20
  }

  //Clamp score
  usabilityScore = Math.max(0, Math.min(100, usabilityScore))

  let quality: 'low' | 'medium' | 'high'
  if (usabilityScore < 35) quality = 'low'
  else if (usabilityScore < 65) quality = 'medium'
  else quality = 'high'

  return {
    quality,
    resolution: `${formatName} ${resolution}`,
    issues,
    usabilityScore,
  }
}
