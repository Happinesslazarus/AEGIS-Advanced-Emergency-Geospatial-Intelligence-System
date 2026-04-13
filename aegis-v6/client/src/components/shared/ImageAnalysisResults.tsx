/**
 * Module: ImageAnalysisResults.tsx
 *
 * Displays the AI image analysis output produced when a citizen attaches a
 * photo to an incident report.  The analysis object contains up to four
 * sections, all optional depending on whether the server-side pipeline ran
 * each step:
 *
 *   photoValidation  — Computer-vision output: water detection confidence,
 *                       disaster confidence score (0–100), top classifications
 *                       from the HuggingFace pipeline, and object detections.
 *   exifAnalysis     — GPS and timestamp cross-check: does the image EXIF
 *                       location match the reported location?  Is the capture
 *                       time plausible for the incident window?
 *   manipulationCheck — Forgery indicators: riskLevel (low/medium/high) and
 *                       a list of specific signals that triggered the check.
 *   damageAssessment  — Severity classification (minor/moderate/severe),
 *                       flood depth estimate, and structural damage flag.
 *
 * The panel is collapsible; compact=true collapses it by default so it can
 * sit in a sidebar without dominating the layout.
 *
 * How it connects:
 * - Used across both admin and citizen interfaces */

import { useState } from 'react'
import {
  Camera, CheckCircle, XCircle, AlertTriangle, Eye,
  MapPin, Clock, Shield, ChevronDown, Droplets,
  Flame, Search, Image as ImageIcon, Zap,
} from 'lucide-react'
import { t } from '../../utils/i18n'
import { useLanguage } from '../../hooks/useLanguage'

interface Classification {
  label: string
  score: number
}

interface Detection {
  label: string
  score: number
  box?: { xmin: number; ymin: number; xmax: number; ymax: number }
}

interface PhotoValidation {
  isFloodRelated?: boolean
  waterDetected?: boolean
  waterConfidence?: number
  objectsDetected?: string[]
  imageQuality?: string
  disasterConfidence?: number
  classifications?: Classification[]
  detections?: Detection[]
}

interface ExifAnalysis {
  hasExif?: boolean
  locationMatch?: boolean | null
  timeMatch?: boolean | null
  temporalPlausibility?: boolean | null
  cameraModel?: string
  capturedAt?: string
  gpsLat?: number
  gpsLng?: number
  distanceFromReportKm?: number
}

interface DamageAssessment {
  severity?: string
  estimatedDamageLevel?: string
  affectedArea?: string
  structuralDamage?: boolean
  floodDepthEstimate?: string
}

interface ManipulationCheck {
  riskLevel?: string
  indicators?: string[]
  isLikelyAuthentic?: boolean
}

export interface ImageAnalysis {
  photoValidation?: PhotoValidation
  exifAnalysis?: ExifAnalysis
  damageAssessment?: DamageAssessment
  manipulationCheck?: ManipulationCheck
  modelUsed?: string
  processingTimeMs?: number
  sceneType?: string
}

interface Props {
  analysis: ImageAnalysis | null
  loading?: boolean
  className?: string
  compact?: boolean
}

/**
 * ConfidenceBar — thin horizontal bar representing a 0–100 confidence value.
 * The value is clamped to 0–100 so out-of-range API values never break the bar.
 * The colour prop maps to a pre-approved Tailwind bg class via the lookup object,
 * falling back to blue for unknown colour keys.
 */
function ConfidenceBar({ value, colour = 'blue' }: { value: number; colour?: string }) {
  const colours: Record<string, string> = {
    blue: 'bg-blue-500',
    green: 'bg-green-500',
    red: 'bg-red-500',
    amber: 'bg-amber-500',
    purple: 'bg-purple-500',
  }
  return (
    <div className="w-full h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
      <div
        className={`h-full rounded-full transition-all duration-500 ${colours[colour] || colours.blue}`}
        style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
      />
    </div>
  )
}

/**
 * BooleanBadge — three-state badge for boolean analysis flags.
 * null/undefined → "N/A" (data not available from that analysis step)
 * true  → green success pill with custom trueLabel
 * false → red failure pill with custom falseLabel
 */
function BooleanBadge({ value, trueLabel, falseLabel }: { value?: boolean | null; trueLabel: string; falseLabel: string }) {
  if (value === null || value === undefined) return <span className="text-[9px] text-gray-400">N/A</span>
  return value
    ? <span className="inline-flex items-center gap-0.5 text-[9px] text-green-400 bg-green-500/20 px-1.5 py-0.5 rounded-full"><CheckCircle className="w-2.5 h-2.5" />{trueLabel}</span>
    : <span className="inline-flex items-center gap-0.5 text-[9px] text-red-400 bg-red-500/20 px-1.5 py-0.5 rounded-full"><XCircle className="w-2.5 h-2.5" />{falseLabel}</span>
}

export default function ImageAnalysisResults({ analysis, loading = false, className = '', compact = false }: Props): JSX.Element {
  const lang = useLanguage()
  // compact=true collapses the panel by default; expanded starts as !compact
  const [expanded, setExpanded] = useState(!compact)

  if (loading) {
    return (
      <div className={`bg-white dark:bg-gray-900/95 backdrop-blur-md border border-gray-200 dark:border-gray-700/60 rounded-xl p-4 ${className}`}>
        <div className="flex items-center gap-2 text-xs text-gray-400">
          <Search className="w-4 h-4 animate-pulse" />
          {t('imgAnalysis.processing', lang)}
        </div>
      </div>
    )
  }

  if (!analysis) {
    return (
      <div className={`bg-white dark:bg-gray-900/95 backdrop-blur-md border border-gray-200 dark:border-gray-700/60 rounded-xl p-4 ${className}`}>
        <div className="flex items-center gap-2 text-xs text-gray-400">
          <ImageIcon className="w-4 h-4" />
          {t('imgAnalysis.noAnalysis', lang)}
        </div>
      </div>
    )
  }

  const pv = analysis.photoValidation
  const exif = analysis.exifAnalysis
  const damage = analysis.damageAssessment
  const manip = analysis.manipulationCheck

  // manipRiskColour maps risk level string to a Tailwind text colour.
  // Defaults to green (low / unknown) so unlabeled results look safe.
  const manipRiskColour = (manip?.riskLevel || '').toLowerCase() === 'high' ? 'text-red-400'
    : (manip?.riskLevel || '').toLowerCase() === 'medium' ? 'text-amber-400'
    : 'text-green-400'

  return (
    <div className={`bg-white dark:bg-gray-900/95 backdrop-blur-md border border-gray-200 dark:border-gray-700/60 rounded-xl shadow-lg overflow-hidden ${className}`}>
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-4 py-2.5 flex items-center gap-2 hover:bg-gray-100 dark:hover:bg-gray-800/50 transition-colors"
      >
        <div className="p-1.5 rounded-lg bg-purple-600">
          <Camera className="w-4 h-4 text-white" />
        </div>
        <div className="flex-1 text-left">
          <h3 className="text-sm font-bold text-gray-900 dark:text-white">{t('imgAnalysis.title', lang)}</h3>
          <p className="text-[10px] text-gray-500 dark:text-gray-300">
            {pv?.disasterConfidence != null && `${Math.round(pv.disasterConfidence)}% disaster conf`}
            {analysis.processingTimeMs && ` — ${analysis.processingTimeMs}ms`}
            {analysis.modelUsed && ` — ${analysis.modelUsed}`}
          </p>
        </div>
        <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${expanded ? '' : '-rotate-90'}`} />
      </button>

      {expanded && (
        <div className="border-t border-gray-100 dark:border-gray-700/30">
          {/* Photo Validation section */}
          {pv && (
            <div className="px-4 py-3 space-y-2">
              <p className="text-[9px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Photo Validation</p>

              {/* Quick badges */}
              <div className="flex flex-wrap gap-1.5">
                <BooleanBadge value={pv.waterDetected} trueLabel="Water detected" falseLabel="No water" />
                {pv.imageQuality && (
                  <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${
                    pv.imageQuality === 'high' ? 'bg-green-500/20 text-green-400'
                    : pv.imageQuality === 'medium' ? 'bg-amber-500/20 text-amber-400'
                    : 'bg-red-500/20 text-red-400'
                  }`}>
                    <Eye className="w-2.5 h-2.5 inline mr-0.5" />{pv.imageQuality} quality
                  </span>
                )}
              </div>

              {/* Disaster confidence bar */}
              {pv.disasterConfidence != null && (
                <div>
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="text-[9px] text-gray-500 dark:text-gray-300">{t('imgAnalysis.disasterConfidence', lang)}</span>
                    <span className="text-[10px] font-bold text-gray-900 dark:text-white">{Math.round(pv.disasterConfidence)}%</span>
                  </div>
                  <ConfidenceBar value={pv.disasterConfidence} colour={pv.disasterConfidence > 70 ? 'red' : pv.disasterConfidence > 40 ? 'amber' : 'green'} />
                </div>
              )}

              {/* Water confidence */}
              {pv.waterConfidence != null && pv.waterDetected && (
                <div>
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="text-[9px] text-gray-500 dark:text-gray-300">{t('imgAnalysis.waterDetected', lang)}</span>
                    <span className="text-[10px] font-bold text-blue-400">{Math.round(pv.waterConfidence)}%</span>
                  </div>
                  <ConfidenceBar value={pv.waterConfidence} colour="blue" />
                </div>
              )}

              {/* Top classifications */}
              {pv.classifications && pv.classifications.length > 0 && (
                <div>
                  <p className="text-[9px] text-gray-500 dark:text-gray-400 mb-1">{t('imgAnalysis.classifications', lang)}</p>
                  <div className="space-y-1">
                    {pv.classifications.slice(0, 5).map((cls, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <span className="text-[9px] text-gray-300 dark:text-gray-400 w-24 truncate">{cls.label}</span>
                        <div className="flex-1">
                          <ConfidenceBar value={cls.score * 100} colour="purple" />
                        </div>
                        <span className="text-[9px] font-mono text-gray-400 w-10 text-right">{(cls.score * 100).toFixed(0)}%</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Object detections */}
              {pv.detections && pv.detections.length > 0 && (
                <div>
                  <p className="text-[9px] text-gray-500 dark:text-gray-400 mb-1">{t('imgAnalysis.detections', lang)}</p>
                  <div className="flex flex-wrap gap-1">
                    {pv.detections.slice(0, 10).map((det, i) => (
                      <span key={i} className="text-[9px] bg-blue-500/10 text-blue-400 px-1.5 py-0.5 rounded">
                        {det.label} ({(det.score * 100).toFixed(0)}%)
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* EXIF Verification */}
          {exif && exif.hasExif && (
            <div className="px-4 py-3 border-t border-gray-100 dark:border-gray-700/30 space-y-2">
              <p className="text-[9px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{t('imgAnalysis.exifVerification', lang)}</p>
              <div className="grid grid-cols-2 gap-2">
                <div className="flex items-center gap-1">
                  <MapPin className="w-3 h-3 text-gray-400" />
                  <BooleanBadge value={exif.locationMatch} trueLabel="Loc verified" falseLabel="Loc mismatch" />
                </div>
                <div className="flex items-center gap-1">
                  <Clock className="w-3 h-3 text-gray-400" />
                  <BooleanBadge value={exif.timeMatch} trueLabel="Time OK" falseLabel="Old photo" />
                </div>
              </div>
              {exif.distanceFromReportKm != null && (
                <p className="text-[9px] text-gray-400">
                  📍 {exif.distanceFromReportKm.toFixed(1)}km from reported location
                </p>
              )}
              {exif.cameraModel && (
                <p className="text-[9px] text-gray-400">📷 {exif.cameraModel}</p>
              )}
            </div>
          )}

          {/* Manipulation check */}
          {manip && (
            <div className="px-4 py-3 border-t border-gray-100 dark:border-gray-700/30 space-y-1.5">
              <div className="flex items-center gap-1.5">
                <Shield className="w-3 h-3 text-gray-400" />
                <span className="text-[9px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{t('imgAnalysis.manipulationRisk', lang)}</span>
                <span className={`text-[9px] font-bold ${manipRiskColour}`}>{manip.riskLevel || 'LOW'}</span>
              </div>
              {manip.indicators && manip.indicators.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {manip.indicators.map((ind, i) => (
                    <span key={i} className="text-[8px] bg-red-500/10 text-red-400 px-1.5 py-0.5 rounded">
                      {ind}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Damage assessment */}
          {damage && damage.severity && (
            <div className="px-4 py-3 border-t border-gray-100 dark:border-gray-700/30 space-y-1.5">
              <p className="text-[9px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{t('imgAnalysis.damageAssessment', lang)}</p>
              <div className="flex flex-wrap gap-1.5">
                <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium ${
                  damage.severity === 'severe' ? 'bg-red-500/20 text-red-400'
                  : damage.severity === 'moderate' ? 'bg-amber-500/20 text-amber-400'
                  : 'bg-green-500/20 text-green-400'
                }`}>
                  {damage.severity}
                </span>
                {damage.structuralDamage && (
                  <span className="text-[9px] bg-red-500/10 text-red-400 px-1.5 py-0.5 rounded">Structural damage</span>
                )}
                {damage.floodDepthEstimate && (
                  <span className="text-[9px] bg-blue-500/10 text-blue-400 px-1.5 py-0.5 rounded">
                    <Droplets className="w-2.5 h-2.5 inline mr-0.5" /> ~{damage.floodDepthEstimate}
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Scene type */}
          {analysis.sceneType && (
            <div className="px-4 py-2 border-t border-gray-100 dark:border-gray-700/30">
              <p className="text-[9px] text-gray-400">
                {t('imgAnalysis.sceneType', lang)}: <span className="font-medium text-gray-300">{analysis.sceneType}</span>
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

