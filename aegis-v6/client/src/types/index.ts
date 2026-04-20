/**
 * File: index.ts  (types barrel)
  *
  * What this file does:
  * Master TypeScript type definitions for the Aegis client: Report,
  * Alert, User, IncidentCategory, PreparednessTip, HistoricalEvent,
  * and all associated enums and helper types. All client components
  * import their types from here.
  *
  * How it connects:
  * - Imported across the entire client codebase
  * - API response shapes should mirror server/src/types/ definitions
  * - Sub-type files (api.ts, communityChat.ts) re-exported from here
 */

export type IncidentCategoryKey =
  | 'natural_disaster' | 'infrastructure' | 'public_safety'
  | 'community_safety' | 'environmental' | 'medical'

export type SeverityLevel = 'Low' | 'Medium' | 'High'
export type ReportStatus = 'Unverified' | 'Verified' | 'Urgent' | 'Flagged' | 'Resolved' | 'Archived' | 'False_Report'
export type AlertSeverity = 'low' | 'medium' | 'high' | 'critical'
export type TrappedOption = 'yes' | 'property' | 'no'
export type AlertChannel = 'web' | 'telegram' | 'email' | 'sms' | 'whatsapp'
export type SortField = 'time' | 'severity' | 'status'
export type SortOrder = 'asc' | 'desc'

export interface AdminUser {
  username: string; displayName: string
  role: 'operator' | 'supervisor' | 'admin'; lastLogin: string
}

export interface IncidentCategory { key: IncidentCategoryKey; label: string; icon: string; color: string }
export interface DisasterSubtype { key: string; label: string; icon: string; implemented: boolean }
export interface SeverityConfig { key: SeverityLevel; label: string; description: string; color: string; className: string }
export interface TrappedOptionConfig { key: TrappedOption; label: string; urgent: boolean }
export interface CommunityHelpType { key: string; label: string; icon: string; description: string }
export interface LanguageOption { code: string; label: string; dir?: 'ltr' | 'rtl' }

export interface PhotoValidation {
  isFloodRelated: boolean; waterDetected: boolean; waterConfidence: number
  objectsDetected: string[]; imageQuality: 'low' | 'medium' | 'high'
}

export interface AIAnalysis {
  sentimentScore: number; panicLevel: 'None' | 'Low' | 'Moderate' | 'High'
  fakeProbability: number; photoVerified: boolean; photoValidation?: PhotoValidation
  estimatedWaterDepth: string | null; vulnerablePersonAlert?: boolean; crossReferenced: string[]
  mlPowered?: boolean; modelsUsed?: string[]; predictedCategory?: string
  //snake_case aliases returned by backend
  panic_level?: string; fake_probability?: number; photo_verified?: boolean; water_depth?: string
  sources?: string; reasoning?: string
}

export type LocationSource = 'gps' | 'map_pin' | 'address_search' | 'manual_coordinates' | 'manual_text'

export interface MediaFile {
  id: string
  url: string
  type: 'photo' | 'video'
  filename?: string
  mimeType?: string
  size?: number
  uploadedAt?: string
  file_url?: string
  aiAnalysis?: {
    classification?: string
    waterDepth?: string
    authenticityScore?: number
  } | null
}

export interface LocationMetadata {
  lat: number
  lng: number
  accuracy: number | null
  source: LocationSource
  confidence: number
  user_corrected: boolean
}

export interface Report {
  id: string; incidentCategory: IncidentCategoryKey; incidentSubtype: string; type: string
  location: string; coordinates: [number, number]; severity: SeverityLevel; status: ReportStatus
  timestamp: string; displayTime: string; reporter: string; description: string
  trappedPersons: TrappedOption; hasMedia: boolean; mediaType?: 'photo' | 'video' | 'both'
  confidence: number | null; aiAnalysis: AIAnalysis | null
  reportNumber?: string; mediaUrl?: string; media?: MediaFile[]
  operatorNotes?: string | null; updatedAt?: string; verifiedAt?: string; resolvedAt?: string
  locationMetadata?: LocationMetadata | null
}

export interface ReportFormData {
  incidentCategory: string; incidentSubtype: string; description: string
  severity: string; trappedPersons: string; location: string
  otherSpecify: string; hasMedia: boolean; mediaType: string
}

export interface NewReportInput {
  incidentCategory: IncidentCategoryKey; incidentSubtype: string; type: string
  description: string; severity: SeverityLevel; trappedPersons: TrappedOption
  location: string; coordinates: [number, number]; hasMedia: boolean
  mediaType?: 'photo' | 'video' | 'both'
  customFields?: Record<string, boolean | number | string>
  locationMetadata?: LocationMetadata
}

/** Server API response shape for reports (before client normalization) */
export interface ServerReport {
  id: string
  report_number?: string
  incident_category: string
  incident_subtype: string
  type?: string
  description: string
  severity: string
  trapped_persons: string
  location_text: string
  coordinates?: [number, number]
  status: string
  created_at: string
  updated_at?: string
  has_media: boolean
  media_type?: string
  media_url?: string
  media?: MediaFile[]
  confidence?: number
  ai_analysis?: Record<string, unknown>
  location_metadata?: Record<string, unknown>
  reporter_id?: string
  reporter_name?: string
  operator_notes?: string
}

/** Server API response when creating a new report */
export interface NewReportResponse {
  id: string
  reportNumber: string
  createdAt: string
  confidence?: number
  aiAnalysis?: AIAnalysis
}

export interface Alert {
  id: string; severity: AlertSeverity; title: string; message: string
  area: string; source: string; timestamp: string; displayTime: string
  active: boolean; channels: AlertChannel[]; disasterType: string
  expiresAt?: string | null
}

export interface Notification { id: number; message: string; type: 'success' | 'warning' | 'error' | 'info' }

export interface AlertSubscription { channel: AlertChannel; destination: string; areas: string[]; active: boolean }

export interface FloodZone { name: string; coords: [number, number]; risk: 'high' | 'medium' | 'low' }
export interface EmergencyContacts { emergency: string; nhs: string; nonEmergency: string }
export interface LocationConfig {
  name: string; center: [number, number]; zoom: number
  bounds: [[number, number], [number, number]]; rivers: string[]
  floodZones: FloodZone[]; emergencyContacts: EmergencyContacts
}
export interface LocationOption { key: string; name: string }

export interface FloodPrediction {
  area: string; probability: number; timeToFlood: string; matchedPattern: string
  nextAreas: string[]; severity: SeverityLevel; confidence: number; dataSources: string[]
}

export interface ResourceAllocation {
  zone: string; priority: 'Critical' | 'High' | 'Medium' | 'Low'
  reports: number; recommendation: string; estimated: string; deployed: boolean
}

export interface WeatherWarning { type: string; message: string }
export interface WeatherForecast { time: string; rain: string; wind: string }
export interface WeatherData {
  location: string; temperature: number; condition: string; rainfall: string
  wind: string; humidity: string; visibility: string
  warnings: WeatherWarning[]; forecast: WeatherForecast[]
}

export interface CommunityOffer { id: number; type: string; name: string; description: string; location: string; time: string }
export interface ChatMessage { sender: 'user' | 'bot'; text: string; timestamp: Date; confidence?: number }
export interface ChatResponse { text: string; intent: string; confidence: number }

export interface PreparednessScenario {
  id: string; title: string; disasterType: string; duration: string
  difficulty: 'beginner' | 'intermediate' | 'advanced'; description: string; steps: string[]
}

export interface PreparednessTip {
  category: string; icon: string; title: string; before: string[]; during: string[]; after: string[]
}

export interface HistoricalEvent {
  id: string; date: string; type: string; location: string
  coordinates: [number, number]; severity: SeverityLevel
  description: string; affectedPeople: number; damage: string
}

export interface SeasonalTrend { month: string; floodCount: number; avgSeverity: number; rainfallMm: number }

export interface ConsentConfig { id: string; title: string; description: string; required: boolean; defaultValue: boolean }

export type TranslationKey = string
export type TranslationMap = Record<TranslationKey, string>
export type LanguageCode = 'en' | 'es' | 'fr' | 'ar' | 'zh' | 'hi' | 'pt' | 'pl' | 'ur'

export interface Operator {
  id: string; email: string; displayName: string
  role: 'admin' | 'operator' | 'viewer'
  avatarUrl?: string; department?: string; phone?: string
  isActive?: boolean; isSuspended?: boolean; lastLogin?: string
}
