/**
 * services/imageAnalysisService.ts — CNN-based Image Analysis
 *
 * Feature #5: Photo/Image Validation (Computer Vision)
 * Feature #14: Photo Metadata Analysis (EXIF)
 * Feature #23: Photo CNN Analysis (Fusion input)
 *
 * Uses HuggingFace Inference API for:
 *   - Image classification (flood/disaster detection via google/vit-base-patch16-224)
 *   - Object detection (facebook/detr-resnet-50)
 *   - Image quality assessment
 *
 * Also extracts EXIF metadata for location/time verification.
 */

import pool from '../models/db.js'
import * as fs from 'fs'
import * as path from 'path'
import { devLog } from '../utils/logger.js'

const HF_API_KEY = process.env.HF_API_KEY || ''
const HF_BASE_URL = 'https://router.huggingface.co'

// Models for different tasks
const IMAGE_CLASSIFIER_MODEL = process.env.HF_IMAGE_CLASSIFIER || 'google/vit-base-patch16-224'
const OBJECT_DETECTOR_MODEL = process.env.HF_OBJECT_DETECTOR || 'facebook/detr-resnet-50'

// Disaster-related labels from ImageNet/ViT classification
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
}

export interface FullImageAnalysis {
  photoValidation: PhotoValidationResult
  exifAnalysis: ExifAnalysisResult
  modelUsed: string
  processingTimeMs: number
}

// ═══════════════════════════════════════════════════════════════════════════════
// §1  IMAGE CLASSIFICATION (ViT — Is this a disaster/flood image?)
// ═══════════════════════════════════════════════════════════════════════════════

async function classifyImage(imageBuffer: Buffer): Promise<Array<{ label: string; score: number }>> {
  if (!HF_API_KEY) {
    console.warn('[ImageAnalysis] No HF_API_KEY — using heuristic fallback')
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
      console.error(`[ImageAnalysis] Classification failed: ${res.status}`)
      return [{ label: 'unknown', score: 0 }]
    }

    const results = await res.json() as Array<{ label: string; score: number }>
    return results.slice(0, 10) // Top 10 predictions
  } catch (err: any) {
    console.error(`[ImageAnalysis] Classification error: ${err.message}`)
    return [{ label: 'unknown', score: 0 }]
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// §2  OBJECT DETECTION (DETR — What objects are in the image?)
// ═══════════════════════════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════════════════════════
// §3  EXIF METADATA EXTRACTION
// ═══════════════════════════════════════════════════════════════════════════════

function extractExif(imageBuffer: Buffer): ExifAnalysisResult {
  // Basic EXIF parsing — looks for GPS and DateTime markers
  const result: ExifAnalysisResult = {
    hasExif: false,
    exifLat: null,
    exifLng: null,
    exifTimestamp: null,
    locationMatch: null,
    timeMatch: null,
    locationDistanceKm: null,
  }

  try {
    // Search for EXIF header (0xFFE1)
    const exifHeader = imageBuffer.indexOf(Buffer.from([0xFF, 0xE1]))
    if (exifHeader === -1) return result
    result.hasExif = true

    // Look for GPS IFD markers in raw bytes
    const bufStr = imageBuffer.toString('binary')

    // GPS Latitude pattern: look for standard EXIF GPS tags
    const gpsLatRef = bufStr.indexOf('GPS')
    if (gpsLatRef > -1) {
      // Parse GPS data from surrounding bytes if found
      // This is a simplified parser — production would use a full EXIF library
      const nearbyBytes = imageBuffer.subarray(
        Math.max(0, gpsLatRef),
        Math.min(imageBuffer.length, gpsLatRef + 200),
      )

      // Extract float values near GPS marker
      for (let i = 0; i < nearbyBytes.length - 8; i++) {
        const val = nearbyBytes.readFloatBE(i)
        if (val > 45 && val < 65 && result.exifLat === null) {
          result.exifLat = val
        } else if (val > -10 && val < 5 && val !== 0 && result.exifLng === null) {
          result.exifLng = val
        }
      }
    }

    // DateTime pattern: YYYY:MM:DD HH:MM:SS
    const dateMatch = bufStr.match(/(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/)
    if (dateMatch) {
      const [, y, m, d, h, min, s] = dateMatch
      result.exifTimestamp = new Date(`${y}-${m}-${d}T${h}:${min}:${s}`)
    }
  } catch {
    // EXIF parsing failures are non-critical
  }

  return result
}

/** Haversine distance between two lat/lng points in km */
function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLng = ((lng2 - lng1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

// ═══════════════════════════════════════════════════════════════════════════════
// §4  IMAGE QUALITY ASSESSMENT
// ═══════════════════════════════════════════════════════════════════════════════

function assessImageQuality(imageBuffer: Buffer): 'low' | 'medium' | 'high' {
  const sizeKB = imageBuffer.length / 1024

  // Very small images are likely low quality
  if (sizeKB < 50) return 'low'
  if (sizeKB < 200) return 'medium'
  return 'high'
}

// ═══════════════════════════════════════════════════════════════════════════════
// §5  MAIN ANALYSIS FUNCTION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Analyse an uploaded image for disaster relevance, objects, EXIF metadata.
 * Used by the report pipeline (Feature #5) and fusion engine (Feature #23).
 *
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

  // Read image file
  let imageBuffer: Buffer
  try {
    const fullPath = path.resolve(imagePath)
    imageBuffer = fs.readFileSync(fullPath)
  } catch (err: any) {
    console.error(`[ImageAnalysis] Failed to read image: ${err.message}`)
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
      },
      modelUsed: 'none',
      processingTimeMs: Date.now() - start,
    }
  }

  // Run classification, detection, and EXIF extraction in parallel
  const [classifications, detections, exifRaw] = await Promise.all([
    classifyImage(imageBuffer),
    detectObjects(imageBuffer),
    Promise.resolve(extractExif(imageBuffer)),
  ])

  // Determine flood/disaster relevance from classification
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

  // Add detected objects from DETR
  for (const det of detections) {
    if (!objectsDetected.includes(det.label)) {
      objectsDetected.push(det.label)
    }
  }

  // EXIF location verification
  const exifAnalysis: ExifAnalysisResult = { ...exifRaw }
  if (exifRaw.exifLat !== null && exifRaw.exifLng !== null) {
    const distKm = haversineKm(reportLat, reportLng, exifRaw.exifLat, exifRaw.exifLng)
    exifAnalysis.locationDistanceKm = Math.round(distKm * 10) / 10
    exifAnalysis.locationMatch = distKm < 5 // Within 5km = match
  }

  // EXIF time verification (within 24 hours of submission)
  if (exifRaw.exifTimestamp) {
    const timeDiffHours = Math.abs(Date.now() - exifRaw.exifTimestamp.getTime()) / 3600000
    exifAnalysis.timeMatch = timeDiffHours < 24
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

  // Store results in database
  if (reportId) {
    try {
      await pool.query(
        `INSERT INTO image_analyses
         (report_id, image_url, is_disaster_related, water_detected, water_confidence,
          objects_detected, image_quality, exif_lat, exif_lng, exif_timestamp,
          exif_location_match, exif_time_match, model_used, confidence, raw_scores)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
        [
          reportId, imagePath,
          photoValidation.isFloodRelated,
          photoValidation.waterDetected,
          photoValidation.waterConfidence,
          photoValidation.objectsDetected,
          photoValidation.imageQuality,
          exifAnalysis.exifLat, exifAnalysis.exifLng, exifAnalysis.exifTimestamp,
          exifAnalysis.locationMatch, exifAnalysis.timeMatch,
          IMAGE_CLASSIFIER_MODEL,
          disasterConfidence,
          JSON.stringify({ classifications, detections }),
        ],
      )

      // Log AI execution
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
      console.error(`[ImageAnalysis] DB storage failed: ${err.message}`)
    }
  }

  devLog(`[ImageAnalysis] Completed in ${processingTimeMs}ms — disaster:${disasterConfidence.toFixed(2)} water:${waterConfidence.toFixed(2)}`)

  return {
    photoValidation,
    exifAnalysis,
    modelUsed: IMAGE_CLASSIFIER_MODEL,
    processingTimeMs,
  }
}
