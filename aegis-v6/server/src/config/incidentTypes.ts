/**
 * File: incidentTypes.ts
 *
 * What this file does:
 * Defines the canonical list of incident types the system can handle,
 * including their display names, AI model assignments, severity levels,
 * custom field schemas, dashboard widgets, and alert thresholds.
 *
 * Override mechanism:
 * At startup, `loadOverrides()` checks for `incident-types.override.json`
 * (path from INCIDENT_TYPES_OVERRIDE_PATH env var or cwd default). Any
 * entries in that file are deep-merged over the defaults so deployments
 * can tune thresholds and enable/disable types without code changes.
 * `upsertIncidentType()` writes changes back to that file at runtime.
 *
 * How it connects:
 * - Imported by services and routes that validate or describe incident types
 * - AI model names here must match models registered in the AI engine registry
 * - alertThresholds are used by alerting rules in model monitoring
 *
 * Simple explanation:
 * A central registry of every kind of emergency the system knows about,
 * with configuration that controls how each one is tracked and displayed.
 */

import fs from 'fs'
import path from 'path'
import { logger } from '../services/logger.js'

export interface IncidentFieldSchema {
  key: string
  label: string
  type: 'text' | 'number' | 'boolean' | 'select' | 'multiselect'
  required: boolean
  options?: string[]
}

export interface IncidentThresholds {
  advisory: number
  warning: number
  critical: number
}

export interface IncidentTypeConfig {
  id: string
  name: string
  category: string
  enabled: boolean
  severityLevels: string[]
  fieldSchema: IncidentFieldSchema[]
  widgets: string[]
  aiModel: string
  alertThresholds: IncidentThresholds
}

// Built-in incident type catalogue. Each entry defines:
// - fieldSchema: extra structured fields the UI collects for this incident type
// - widgets: which dashboard panels activate when this type is active
// - aiModel: the AI engine model used to score predictions for this type
// - alertThresholds: confidence % at which advisory/warning/critical alerts fire
const DEFAULT_INCIDENT_TYPES: Record<string, IncidentTypeConfig> = {
  flood: {
    id: 'flood', name: 'Flood', category: 'natural_disaster', enabled: true,
    severityLevels: ['Low', 'Medium', 'High', 'Critical'],
    fieldSchema: [
      { key: 'waterDepthCm', label: 'Estimated Water Depth (cm)', type: 'number', required: false },
      { key: 'waterSpeed', label: 'Water Speed', type: 'select', required: false, options: ['slow', 'moderate', 'fast'] },
      { key: 'blockedRoutes', label: 'Blocked Routes', type: 'boolean', required: false },
    ],
    widgets: ['live_map', 'river_gauges', 'rainfall_trend', 'threat_level'],
    aiModel: 'flood_uk-default_v2026.03.03.093011',
    alertThresholds: { advisory: 30, warning: 55, critical: 75 },
  },
  severe_storm: {
    id: 'severe_storm', name: 'Severe Storm', category: 'natural_disaster', enabled: true,
    severityLevels: ['Low', 'Medium', 'High', 'Critical'],
    fieldSchema: [
      { key: 'windDamage', label: 'Wind Damage Observed', type: 'boolean', required: false },
      { key: 'hailPresent', label: 'Hail Present', type: 'boolean', required: false },
      { key: 'powerLinesDown', label: 'Power Lines Down', type: 'boolean', required: false },
    ],
    widgets: ['weather_panel', 'live_map', 'incident_timeline'],
    aiModel: 'severity',
    alertThresholds: { advisory: 28, warning: 52, critical: 74 },
  },
  heatwave: {
    id: 'heatwave', name: 'Heatwave', category: 'natural_disaster', enabled: true,
    severityLevels: ['Low', 'Medium', 'High', 'Critical'],
    fieldSchema: [
      { key: 'temperatureC', label: 'Observed Temperature (°C)', type: 'number', required: false },
      { key: 'vulnerablePeopleAffected', label: 'Vulnerable People Affected', type: 'boolean', required: false },
      { key: 'waterAccessIssues', label: 'Water Access Issues', type: 'boolean', required: false },
    ],
    widgets: ['weather_panel', 'preparedness', 'health_advisory'],
    aiModel: 'heatwave_uk-default_v2026.03.03.080725',
    alertThresholds: { advisory: 35, warning: 58, critical: 78 },
  },
  wildfire: {
    id: 'wildfire', name: 'Wildfire', category: 'natural_disaster', enabled: true,
    severityLevels: ['Low', 'Medium', 'High', 'Critical'],
    fieldSchema: [
      { key: 'smokeIntensity', label: 'Smoke Intensity', type: 'select', required: false, options: ['light', 'moderate', 'heavy'] },
      { key: 'flameVisible', label: 'Visible Flames', type: 'boolean', required: false },
      { key: 'evacuationNeeded', label: 'Evacuation Needed', type: 'boolean', required: false },
    ],
    widgets: ['live_map', 'air_quality', 'evacuation_routes'],
    aiModel: 'severity',
    alertThresholds: { advisory: 33, warning: 56, critical: 80 },
  },
  landslide: {
    id: 'landslide', name: 'Landslide', category: 'natural_disaster', enabled: true,
    severityLevels: ['Low', 'Medium', 'High', 'Critical'],
    fieldSchema: [
      { key: 'roadBlocked', label: 'Road Blocked', type: 'boolean', required: false },
      { key: 'slopeFailureExtent', label: 'Slope Failure Extent', type: 'select', required: false, options: ['small', 'moderate', 'large'] },
      { key: 'ongoingMovement', label: 'Ongoing Ground Movement', type: 'boolean', required: false },
    ],
    widgets: ['live_map', 'terrain_risk', 'road_closures'],
    aiModel: 'severity',
    alertThresholds: { advisory: 31, warning: 54, critical: 76 },
  },
  power_outage: {
    id: 'power_outage', name: 'Power Outage', category: 'community_safety', enabled: true,
    severityLevels: ['Low', 'Medium', 'High', 'Critical'],
    fieldSchema: [
      { key: 'outageDurationHours', label: 'Outage Duration (hours)', type: 'number', required: false },
      { key: 'criticalServicesImpacted', label: 'Critical Services Impacted', type: 'boolean', required: false },
      { key: 'areaWide', label: 'Area-wide Outage', type: 'boolean', required: false },
    ],
    widgets: ['incident_timeline', 'resource_allocation', 'community_help'],
    aiModel: 'severity',
    alertThresholds: { advisory: 26, warning: 50, critical: 70 },
  },
  water_supply_disruption: {
    id: 'water_supply_disruption', name: 'Water Supply Disruption', category: 'community_safety', enabled: true,
    severityLevels: ['Low', 'Medium', 'High', 'Critical'],
    fieldSchema: [
      { key: 'waterUnavailable', label: 'No Running Water', type: 'boolean', required: false },
      { key: 'contaminationSuspected', label: 'Contamination Suspected', type: 'boolean', required: false },
      { key: 'durationHours', label: 'Duration (hours)', type: 'number', required: false },
    ],
    widgets: ['incident_timeline', 'community_help', 'alerts'],
    aiModel: 'severity',
    alertThresholds: { advisory: 27, warning: 48, critical: 72 },
  },
  infrastructure_damage: {
    id: 'infrastructure_damage', name: 'Infrastructure Damage', category: 'infrastructure', enabled: true,
    severityLevels: ['Low', 'Medium', 'High', 'Critical'],
    fieldSchema: [
      { key: 'assetType', label: 'Asset Type', type: 'select', required: true, options: ['road', 'bridge', 'building', 'utility'] },
      { key: 'serviceDisruption', label: 'Service Disruption', type: 'boolean', required: false },
      { key: 'accessRestricted', label: 'Access Restricted', type: 'boolean', required: false },
    ],
    widgets: ['live_map', 'resource_allocation', 'repair_queue'],
    aiModel: 'severity',
    alertThresholds: { advisory: 25, warning: 47, critical: 71 },
  },
  public_safety_incident: {
    id: 'public_safety_incident', name: 'Public Safety Incident', category: 'public_safety', enabled: true,
    severityLevels: ['Low', 'Medium', 'High', 'Critical'],
    fieldSchema: [
      { key: 'injuriesReported', label: 'Injuries Reported', type: 'boolean', required: false },
      { key: 'crowdSize', label: 'Crowd Size', type: 'select', required: false, options: ['small', 'medium', 'large'] },
      { key: 'policeRequired', label: 'Police Required', type: 'boolean', required: false },
    ],
    widgets: ['incident_timeline', 'live_map', 'operator_assignments'],
    aiModel: 'severity',
    alertThresholds: { advisory: 30, warning: 53, critical: 77 },
  },
  environmental_hazard: {
    id: 'environmental_hazard', name: 'Environmental Hazard', category: 'environmental', enabled: true,
    severityLevels: ['Low', 'Medium', 'High', 'Critical'],
    fieldSchema: [
      { key: 'hazardMaterial', label: 'Hazard Material', type: 'text', required: false },
      { key: 'airOrWaterImpact', label: 'Air/Water Impact', type: 'select', required: false, options: ['air', 'water', 'soil', 'mixed'] },
      { key: 'containmentNeeded', label: 'Containment Needed', type: 'boolean', required: false },
    ],
    widgets: ['live_map', 'environmental_monitor', 'alerts'],
    aiModel: 'severity',
    alertThresholds: { advisory: 29, warning: 51, critical: 75 },
  },
}

// Override file path: can be set by INCIDENT_TYPES_OVERRIDE_PATH env var.
// If absent, defaults to incident-types.override.json in the process working directory.
const overridePath = process.env.INCIDENT_TYPES_OVERRIDE_PATH
  ? path.resolve(process.env.INCIDENT_TYPES_OVERRIDE_PATH)
  : path.resolve(process.cwd(), 'incident-types.override.json')

const registry = new Map<string, IncidentTypeConfig>(Object.values(DEFAULT_INCIDENT_TYPES).map(v => [v.id, v]))

function loadOverrides(): void {
  try {
    if (!fs.existsSync(overridePath)) return
    const raw = fs.readFileSync(overridePath, 'utf8')
    const parsed = JSON.parse(raw) as IncidentTypeConfig[]
    for (const row of parsed || []) {
      if (!row?.id) continue
      registry.set(row.id, { ...registry.get(row.id), ...row })
    }
  } catch (err: any) {
    logger.warn({ err }, '[incident-types] Failed loading overrides')
  }
}

function saveOverrides(): void {
  try {
    fs.writeFileSync(overridePath, JSON.stringify(listIncidentTypes(), null, 2), 'utf8')
  } catch (err: any) {
    logger.warn({ err }, '[incident-types] Failed saving overrides')
  }
}

loadOverrides()

export function listIncidentTypes(): IncidentTypeConfig[] {
  return Array.from(registry.values())
}

export function getIncidentType(id: string): IncidentTypeConfig | undefined {
  return registry.get(id)
}

export function upsertIncidentType(id: string, patch: Partial<IncidentTypeConfig>): IncidentTypeConfig {
  const current = registry.get(id) || {
    id,
    name: id,
    category: 'public_safety',
    enabled: true,
    severityLevels: ['Low', 'Medium', 'High', 'Critical'],
    fieldSchema: [],
    widgets: ['incident_timeline'],
    aiModel: 'severity',
    alertThresholds: { advisory: 30, warning: 55, critical: 75 },
  }

  const next: IncidentTypeConfig = {
    ...current,
    ...patch,
    id,
    alertThresholds: { ...current.alertThresholds, ...(patch.alertThresholds || {}) },
  }

  registry.set(id, next)
  saveOverrides()
  return next
}
