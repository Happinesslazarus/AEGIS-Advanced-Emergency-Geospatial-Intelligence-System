/**
 * Master TypeScript type definitions for the Aegis server: OperatorRole,
 * Report, Alert, DistressSignal, ChatMessage, User, and all associated
 * request/response payloads. All routes and services import their types
 * from here to ensure consistent shapes across the codebase.
 *
 * - Imported by every route, service, and middleware file in server/src/
 * - DB column names in these types must match server/sql/schema.sql columns
 * - Client-side equivalent: client/src/types/index.ts
 */

//ENUMS (mirror PostgreSQL ENUM types)

export type OperatorRole = 'admin' | 'operator' | 'viewer'
export type ReportStatus = 'unverified' | 'verified' | 'urgent' | 'flagged' | 'resolved'
export type ReportSeverity = 'high' | 'medium' | 'low'
export type AlertSeverity = 'critical' | 'warning' | 'info'
export type FloodType = 'river' | 'coastal' | 'surface'
export type FloodProbability = 'high' | 'medium' | 'low'
export type CommunityHelpType = 'offer' | 'request'
export type CommunityHelpStatus = 'active' | 'fulfilled' | 'expired' | 'cancelled'
export type CommunityHelpCategory = 'shelter' | 'food' | 'transport' | 'medical' | 'clothing' | 'other'
export type ActivityActionType = 'verify' | 'flag' | 'urgent' | 'resolve' | 'alert' | 'deploy' | 'login' | 'logout' | 'register' | 'print' | 'export' | 'note'
export type CitizenRole = 'citizen' | 'verified_citizen' | 'community_leader'
export type SafetyStatus = 'safe' | 'help' | 'unsure'
export type MessageSenderType = 'citizen' | 'operator'
export type ThreadStatus = 'open' | 'in_progress' | 'resolved' | 'closed'
export type EscalationStatus = 'pending' | 'acknowledged' | 'dispatched' | 'resolved'
export type AlertChannel = 'web' | 'email' | 'sms' | 'telegram' | 'whatsapp'
export type DeliveryStatus = 'pending' | 'sent' | 'delivered' | 'failed'
export type ChatSessionStatus = 'active' | 'archived' | 'expired'
export type ChatMessageRole = 'user' | 'assistant' | 'system' | 'tool'
export type ConsentType = 'data_processing' | 'location_tracking' | 'ai_analysis' | 'marketing' | 'research'

//DATABASE ROW TYPES

export interface OperatorRow {
  id: string
  email: string
  password_hash: string
  display_name: string
  role: OperatorRole
  avatar_url: string | null
  department: string | null
  phone: string | null
  is_active: boolean
  is_suspended: boolean
  suspended_until: string | null
  suspended_by: string | null
  anonymised_at: string | null
  anonymised_by: string | null
  last_login: string | null
  deleted_at: string | null
  deleted_by: string | null
  created_at: string
  updated_at: string
}

export interface CitizenRow {
  id: string
  email: string
  password_hash: string
  display_name: string
  phone: string | null
  role: CitizenRole
  avatar_url: string | null
  bio: string | null
  address_line: string | null
  status_color: string | null
  vulnerability_flag: boolean
  location_lat: number | null
  location_lng: number | null
  preferred_region: string | null
  email_verified: boolean
  verification_token: string | null
  otp_secret: string | null
  two_factor_enabled: boolean
  is_active: boolean
  last_login: string | null
  login_count: number
  deleted_at: string | null
  created_at: string
  updated_at: string
}

export interface ReportRow {
  id: string
  report_number: string
  incident_category: string
  incident_subtype: string
  display_type: string
  description: string
  severity: ReportSeverity
  status: ReportStatus
  trapped_persons: string
  location_text: string
  coordinates: string // PostGIS geometry WKT
  has_media: boolean
  media_type: string | null
  media_url: string | null
  reporter_name: string
  reporter_ip: string | null
  ai_confidence: number
  ai_analysis: Record<string, unknown>
  operator_notes: string | null
  assigned_to: string | null
  verified_by: string | null
  verified_at: string | null
  resolved_at: string | null
  deleted_at: string | null
  deleted_by: string | null
  search_vector: string | null
  created_at: string
  updated_at: string
}

export interface AlertRow {
  id: string
  title: string
  message: string
  severity: AlertSeverity
  alert_type: string
  location_text: string | null
  coordinates: string | null
  radius_km: number
  is_active: boolean
  created_by: string | null
  expires_at: string | null
  deleted_at: string | null
  deleted_by: string | null
  created_at: string
}

export interface ReportMediaRow {
  id: string
  report_id: string
  file_url: string
  file_type: string
  file_size: number
  original_filename: string | null
  ai_processed: boolean
  ai_classification: string | null
  ai_water_depth: string | null
  ai_authenticity_score: number | null
  ai_model_version: string | null
  ai_reasoning: string | null
  created_at: string
}

export interface FloodPredictionRow {
  id: string
  area: string
  probability: number
  time_to_flood: string | null
  matched_pattern: string | null
  next_areas: string[] | null
  severity: ReportSeverity
  confidence: number
  data_sources: string[] | null
  coordinates: string | null
  model_version: string | null
  pre_alert_sent: boolean
  pre_alert_sent_at: string | null
  pre_alert_sent_by: string | null
  created_at: string
  expires_at: string | null
}

export interface ResourceDeploymentRow {
  id: string
  zone: string
  priority: string
  active_reports: number
  estimated_affected: string | null
  ai_recommendation: string | null
  ambulances: number
  fire_engines: number
  rescue_boats: number
  deployed: boolean
  deployed_at: string | null
  deployed_by: string | null
  coordinates: string | null
  created_at: string
  updated_at: string
}

export interface MessageThreadRow {
  id: string
  citizen_id: string
  subject: string
  status: ThreadStatus
  priority: string
  assigned_to: string | null
  last_message_at: string | null
  citizen_unread: number
  operator_unread: number
  created_at: string
  updated_at: string
}

export interface MessageRow {
  id: string
  thread_id: string
  sender_type: MessageSenderType
  sender_id: string
  content: string
  read_at: string | null
  created_at: string
}

export interface SafetyCheckInRow {
  id: string
  citizen_id: string
  status: SafetyStatus
  location_lat: number | null
  location_lng: number | null
  message: string | null
  escalation_status: EscalationStatus
  escalated_at: string | null
  acknowledged_by: string | null
  acknowledged_at: string | null
  resolved_at: string | null
  resolution_notes: string | null
  created_at: string
}

export interface AlertSubscriptionRow {
  id: string
  email: string | null
  phone: string | null
  telegram_id: string | null
  whatsapp: string | null
  channels: string[]
  location_lat: number | null
  location_lng: number | null
  radius_km: number
  severity_filter: string[]
  verified: boolean
  verification_token: string | null
  consent_given: boolean
  consent_timestamp: string | null
  created_at: string
  updated_at: string
}

export interface CommunityHelpRow {
  id: string
  type: CommunityHelpType
  category: CommunityHelpCategory
  title: string
  description: string | null
  location_text: string | null
  location_lat: number | null
  location_lng: number | null
  contact_info: string | null
  capacity: number | null
  consent_given: boolean
  status: CommunityHelpStatus
  deleted_at: string | null
  created_at: string
  updated_at: string
}

export interface AIModelMetricsRow {
  id: number
  model_name: string
  model_version: string
  accuracy: number | null
  precision_score: number | null
  recall: number | null
  f1_score: number | null
  confusion_matrix: Record<string, unknown> | null
  feature_importance: Record<string, unknown> | null
  confidence_distribution: Record<string, unknown> | null
  training_samples: number | null
  last_trained: string | null
  notes: string | null
  created_at: string
}

export interface AIExecutionRow {
  id: string
  model_name: string
  model_version: string
  input_payload: Record<string, unknown> | null
  raw_response: Record<string, unknown> | null
  status: string
  execution_time_ms: number | null
  triggered_by: string | null
  target_type: string | null
  target_id: string | null
  created_at: string
}

export interface AlertDeliveryLogRow {
  id: string
  alert_id: string
  channel: AlertChannel
  recipient: string | null
  provider_id: string | null
  status: DeliveryStatus
  error_message: string | null
  sent_at: string | null
  delivered_at: string | null
  created_at: string
}

//NEW TABLES (production upgrade: chat sessions, RAG, consent, etc.)

export interface ChatSessionRow {
  id: string
  citizen_id: string | null
  operator_id: string | null
  title: string | null
  status: ChatSessionStatus
  model_used: string | null
  total_tokens: number
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
}

export interface ChatMessageRow {
  id: string
  session_id: string
  role: ChatMessageRole
  content: string
  model_used: string | null
  tokens_used: number
  latency_ms: number | null
  tool_calls: Record<string, unknown>[] | null
  metadata: Record<string, unknown>
  created_at: string
}

export interface RAGDocumentRow {
  id: string
  title: string
  content: string
  source: string
  doc_type: string
  embedding: number[] | null // pgvector
  chunk_index: number
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
}

export interface ResponseCacheRow {
  id: string
  query_hash: string
  query_text: string
  response_text: string
  model_used: string
  ttl_seconds: number
  hit_count: number
  created_at: string
  expires_at: string
}

export interface ConsentRecordRow {
  id: string
  citizen_id: string | null
  operator_id: string | null
  consent_type: ConsentType
  granted: boolean
  ip_address: string | null
  user_agent: string | null
  created_at: string
  withdrawn_at: string | null
}

export interface ExternalAlertRow {
  id: string
  source: string
  source_id: string
  title: string
  description: string | null
  severity: AlertSeverity
  area: string | null
  coordinates: string | null
  raw_data: Record<string, unknown>
  ingested_at: string
  expires_at: string | null
}

export interface HazardModuleRow {
  id: string
  hazard_type: string
  region_id: string
  enabled: boolean
  config: Record<string, unknown>
  api_sources: string[]
  model_version: string | null
  created_at: string
  updated_at: string
}

export interface ZoneRiskScoreRow {
  id: string
  zone_name: string
  hazard_type: string
  risk_score: number
  confidence: number
  contributing_factors: Record<string, unknown>
  geometry: string | null
  computed_at: string
  expires_at: string | null
}

export interface ModelDriftMetricRow {
  id: string
  model_name: string
  model_version: string
  metric_name: string
  baseline_value: number
  current_value: number
  drift_detected: boolean
  threshold: number
  computed_at: string
}

export interface DamageEstimateRow {
  id: string
  report_id: string | null
  zone_name: string | null
  estimated_cost_gbp: number
  affected_properties: number
  affected_people: number
  confidence: number
  model_version: string
  breakdown: Record<string, unknown>
  created_at: string
}

export interface TrainingLabelRow {
  id: string
  report_id: string | null
  label_type: string
  label_value: string
  labelled_by: string | null
  confidence: number | null
  created_at: string
}

//API REQUEST / RESPONSE TYPES

export interface PaginationParams {
  page: number
  limit: number
  sortBy?: string
  sortOrder?: 'asc' | 'desc'
}

export interface PaginatedResponse<T> {
  data: T[]
  pagination: {
    page: number
    limit: number
    total: number
    totalPages: number
    hasNext: boolean
    hasPrev: boolean
  }
}

export interface APIError {
  error: string
  code?: string
  details?: Record<string, string[]>
}

export interface HealthCheck {
  status: 'ok' | 'error'
  database: 'connected' | 'disconnected'
  timestamp: string
  version: string
  services: {
    ai_engine: boolean
    smtp: boolean
    twilio: boolean
    telegram: boolean
    web_push: boolean
  }
}

//AI SERVICE TYPES

export interface LLMProvider {
  name: string
  model: string
  apiKey: string
  baseUrl: string
  maxTokens: number
  priority: number
  rateLimit: { requests: number; windowMs: number }
  enabled: boolean
}

export interface LLMRequest {
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
  maxTokens?: number
  temperature?: number
  stream?: boolean
  tools?: LLMTool[]
  preferredProvider?: string
}

export interface LLMResponse {
  content: string
  model: string
  provider: string
  tokensUsed: number
  latencyMs: number
  finishReason: 'stop' | 'length' | 'tool_calls'
  toolCalls?: Array<{ name: string; arguments: Record<string, unknown> }>
}

export interface LLMTool {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

export interface EmbeddingRequest {
  texts: string[]
  model?: string
}

export interface EmbeddingResponse {
  embeddings: number[][]
  model: string
  provider: string
  dimensions: number
}

export interface ClassifierRequest {
  text: string
  task: 'sentiment' | 'fake_detection' | 'severity' | 'category' | 'language' | 'urgency'
  model?: string
}

export interface ClassifierResponse {
  label: string
  score: number
  allScores: Record<string, number>
  model: string
  provider: string
  latencyMs: number
}

export interface ImageAnalysisRequest {
  imageUrl: string
  tasks: ('classify' | 'detect_water' | 'estimate_depth' | 'authenticity')[]
}

export interface ImageAnalysisResult {
  classification: string | null
  waterDetected: boolean
  waterConfidence: number
  estimatedDepth: string | null
  authenticityScore: number
  objectsDetected: string[]
  model: string
  latencyMs: number
}

//CHAT SYSTEM TYPES

export interface ChatCompletionRequest {
  sessionId?: string
  message: string
  language?: string
  citizenId?: string
  operatorId?: string
  adminMode?: boolean
  preferredProvider?: string
  context?: {
    location?: { lat: number; lng: number }
    currentAlerts?: string[]
    reportId?: string
  }
}

export interface EmergencyDetection {
  isEmergency: boolean
  type?: 'medical' | 'trapped' | 'fire' | 'flood' | 'violence' | 'unknown'
  severity?: 'critical' | 'high' | 'medium' | 'low'
  suggestedActions: string[]
}

export interface ResponseQualityScore {
  relevance: number
  actionability: number
  dataRecency: number
  safetyCompliance: number
  overall: number
}

export interface ConversationAnalytics {
  responseLatencyMs: number
  toolsInvoked: string[]
  agentUsed: string
  emergencyDetected: boolean
  topicShiftDetected: boolean
  sessionMessageCount: number
}

export interface ChatCompletionResponse {
  sessionId: string
  reply: string
  model: string
  tokensUsed: number
  toolsUsed: string[]
  sources: Array<{ title: string; relevance: number }>
  safetyFlags: string[]
  confidence?: number
  agent?: string
  emotion?: string
  budgetUsed?: number
  budgetLimit?: number
  budgetRemaining?: number
  language?: string
  followUpQuestions?: string[]
  emergency?: EmergencyDetection
  qualityScore?: ResponseQualityScore
  analytics?: ConversationAnalytics
  smartSuggestions?: Array<{ text: string; category: string; icon?: string; priority: number }>
  isPersonalized?: boolean
}

//REGION / HAZARD CONFIG TYPES

export interface RegionConfig {
  id: string
  name: string
  country: string
  center: [number, number]
  zoom: number
  bounds: [[number, number], [number, number]]
  timezone: string
  emergencyNumber: string
  floodAuthority: string
  weatherApi: string
  gaugeApi: string
  wmsLayers: WMSLayerConfig[]
  rivers: string[]
}

export interface WMSLayerConfig {
  name: string
  url: string
  layers: string
  format: string
  transparent: boolean
  attribution: string
}

export interface HazardConfig {
  type: string
  displayName: string
  icon: string
  color: string
  enabled: boolean
  dataSources: string[]
  thresholds: Record<string, number>
  models: string[]
}

//SOCKET.IO EVENT TYPES

export interface ServerToClientEvents {
  'alert:new': (alert: AlertRow) => void
  'alert:update': (alert: Partial<AlertRow>) => void
  'report:new': (report: ReportRow) => void
  'report:update': (report: Partial<ReportRow>) => void
  'report:status_change': (data: { reportId: string; oldStatus: ReportStatus; newStatus: ReportStatus }) => void
  'chat:message': (message: MessageRow) => void
  'chat:typing': (data: { threadId: string; userId: string; isTyping: boolean }) => void
  'chat:read': (data: { threadId: string; userId: string }) => void
  'safety:update': (checkIn: SafetyCheckInRow) => void
  'safety:escalation': (data: { checkInId: string; citizenName: string; status: EscalationStatus }) => void
  'prediction:new': (prediction: FloodPredictionRow) => void
  'deployment:update': (deployment: ResourceDeploymentRow) => void
  'presence:online': (data: { userId: string; userType: 'citizen' | 'operator' }) => void
  'presence:offline': (data: { userId: string; userType: 'citizen' | 'operator' }) => void
  'ai:analysis_complete': (data: { reportId: string; analysis: Record<string, unknown> }) => void
  'error': (data: { message: string; code?: string }) => void
}

export interface ClientToServerEvents {
  'chat:send': (data: { threadId: string; content: string }) => void
  'chat:typing': (data: { threadId: string; isTyping: boolean }) => void
  'chat:read': (data: { threadId: string }) => void
  'chat:join': (data: { threadId: string }) => void
  'chat:leave': (data: { threadId: string }) => void
  'safety:checkin': (data: { status: SafetyStatus; lat?: number; lng?: number; message?: string }) => void
  'location:update': (data: { lat: number; lng: number }) => void
  'subscribe:alerts': (data: { area?: string; severity?: AlertSeverity[] }) => void
  'subscribe:reports': (data: { area?: string }) => void
}

//UTILITY TYPES

/* Omit password_hash and sensitive fields from user responses */
export type SafeOperator = Omit<OperatorRow, 'password_hash' | 'deleted_at' | 'deleted_by'>
export type SafeCitizen = Omit<CitizenRow, 'password_hash' | 'verification_token' | 'otp_secret' | 'deleted_at'>

/* Make all properties optional except the ones listed */
export type PartialExcept<T, K extends keyof T> = Partial<T> & Pick<T, K>

