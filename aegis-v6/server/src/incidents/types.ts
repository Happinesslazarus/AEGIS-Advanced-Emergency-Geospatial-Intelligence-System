/**
 * Module: types.ts
 *
 * Types incident component.
 *
 * How it connects:
 * - Part of the incident module system, registered via incidents/registry.ts
 *
 * Simple explanation:
 * Part of the incident management system.
 */

import type { Router } from 'express'

// Operational Status

export type IncidentOperationalStatus =
  | 'fully_operational'
  | 'partial'
  | 'configured_only'
  | 'disabled'

// AI Tier Strategy

export type AITier = 'rule_based' | 'statistical' | 'ml'

// Incident Prediction

export interface IncidentPrediction {
  incidentType: string
  severity: string
  probability: number
  confidence: number
  confidenceSource: 'ml_model' | 'statistical' | 'rule_based'
  location?: { lat: number; lng: number }
  region?: string
  description: string
  advisoryText: string
  generatedAt: string
  expiresAt?: string
  dataSourcesUsed: string[]
  modelVersion?: string
}

// Incident Alert

export interface IncidentAlert {
  id: string
  incidentType: string
  severity: 'advisory' | 'warning' | 'critical'
  title: string
  description: string
  location?: { lat: number; lng: number; radius_km?: number }
  region: string
  issuedAt: string
  expiresAt?: string
  source: string
  acknowledged: boolean
}

// Incident Map Data

export interface IncidentMapMarker {
  id: string
  incidentType: string
  lat: number
  lng: number
  severity: string
  title: string
  description?: string
  timestamp: string
  icon?: string
  color?: string
}

export interface IncidentMapData {
  markers: IncidentMapMarker[]
  layers?: Array<{ type: string; name: string; data: Record<string, unknown> }>
  heatmapPoints?: Array<{ lat: number; lng: number; intensity: number }>
}

// Incident Registry Entry (metadata)

export interface IncidentRegistryEntry {
  id: string
  name: string
  category: string
  icon: string
  color: string
  severityLevels: string[]
  dataSources: string[]
  aiEndpoint: string | null
  aiTier: AITier
  enabledRegions: string[] | 'all'
  operationalStatus: IncidentOperationalStatus
  fieldSchema: Array<{
    key: string
    label: string
    type: 'text' | 'number' | 'boolean' | 'select' | 'multiselect'
    required: boolean
    options?: string[]
  }>
  widgets: string[]
  alertThresholds: { advisory: number; warning: number; critical: number }
}

// Alert Rules — evaluates conditions to generate alerts

export interface AlertRuleContext {
  incidentType: string
  region: string
  recentReports: Array<{
    id: string
    severity: string
    location?: { lat: number; lng: number }
    created_at: string
    incident_type: string
    customFields?: Record<string, any>
  }>
  weatherData?: any
  sensorData?: any
  predictions?: IncidentPrediction[]
}

export interface AlertRuleResult {
  shouldAlert: boolean
  severity: 'advisory' | 'warning' | 'critical'
  title: string
  description: string
}

// Incident Module Interface — every incident plugin must implement this

export interface IncidentModule {
  /* Unique incident type identifier */
  id: string

  /* Registry metadata */
  registry: IncidentRegistryEntry

  /* Express router with incident-specific routes */
  router: Router

  /* Generate predictions using the incident's AI tier strategy */
  getPredictions(region: string): Promise<IncidentPrediction[]>

  /* Get active alerts for this incident type */
  getAlerts(region: string): Promise<IncidentAlert[]>

  /* Get map visualization data */
  getMapData(region: string): Promise<IncidentMapData>

  /* Evaluate alert rules against current conditions */
  evaluateAlertRules(context: AlertRuleContext): Promise<AlertRuleResult[]>

  /* Ingest data from external sources (called by cron/n8n) */
  ingestData(region: string): Promise<{ recordsIngested: number; source: string }>

  /* Get incident history */
  getHistory(region: string, days?: number): Promise<any[]>
}

