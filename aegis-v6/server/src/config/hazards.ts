/**
 * File: hazards.ts
 *
 * What this file does:
 * Defines the set of hazard types the platform monitors, including their
 * display config (icon, colour), enabled data sources, trigger thresholds,
 * and AI model names. `wildfire` is currently disabled (enabled: false)
 * because the satellite hot-spot feed integration is not yet live.
 *
 * How it connects:
 * - Imported by aiRoutes.ts and prediction services that filter by hazard type
 * - `getEnabledHazards()` drives the hazard selector in the admin dashboard
 * - Threshold values are referenced by the AI engine when deciding alert levels
 *
 * Simple explanation:
 * A lookup table of every natural hazard the system can monitor,
 * with the configuration that tells it when to raise an alert.
 */

import type { HazardConfig } from '../types/index.js'

export const HAZARD_MODULES: Record<string, HazardConfig> = {
  flood: {
    type: 'flood',
    displayName: 'Flood',
    icon: 'droplets',
    color: '#2563eb',
    enabled: true,
    dataSources: [
      'sepa_gauge_api',
      'met_office_rainfall',
      'openweathermap',
      'citizen_reports',
      'historical_records',
    ],
    thresholds: {
      gauge_warning_m: 1.5,
      gauge_critical_m: 2.5,
      rainfall_24h_mm: 40,
      rainfall_48h_mm: 60,
      probability_alert: 0.65,
      probability_critical: 0.85,
    },
    models: ['flood_classifier_v3', 'flood_fusion_engine'],
  },

  drought: {
    type: 'drought',
    displayName: 'Drought',
    icon: 'sun',
    color: '#d97706',
    enabled: true,
    dataSources: [
      'met_office_precipitation',
      'soil_moisture_api',
      'reservoir_levels',
      'citizen_reports',
    ],
    thresholds: {
      days_without_rain: 14,
      soil_moisture_pct: 20,
      reservoir_pct: 40,
      probability_alert: 0.60,
    },
    models: ['drought_predictor_v2'],
  },

  heatwave: {
    type: 'heatwave',
    displayName: 'Heatwave',
    icon: 'thermometer',
    color: '#dc2626',
    enabled: true,
    dataSources: [
      'met_office_temperature',
      'openweathermap',
      'citizen_reports',
    ],
    thresholds: {
      temp_day_c: 30,
      temp_night_c: 18,
      consecutive_days: 3,
      probability_alert: 0.70,
    },
    models: ['heatwave_predictor_v2'],
  },

  wildfire: {
    type: 'wildfire',
    displayName: 'Wildfire',
    icon: 'flame',
    color: '#ea580c',
    enabled: false,
    dataSources: [
      'satellite_hotspots',
      'met_office_wind',
      'citizen_reports',
    ],
    thresholds: {
      fire_weather_index: 50,
      wind_speed_kph: 30,
      humidity_pct: 20,
      probability_alert: 0.60,
    },
    models: ['wildfire_predictor_v1'],
  },
}

/**
 * Get enabled hazard types for the current deployment.
 */
export function getEnabledHazards(): HazardConfig[] {
  return Object.values(HAZARD_MODULES).filter((h) => h.enabled)
}

/**
 * Get a specific hazard config by type key.
 */
export function getHazardConfig(type: string): HazardConfig | undefined {
  return HAZARD_MODULES[type]
}

/**
 * List all hazard type keys regardless of enabled state.
 */
export function listHazardTypes(): string[] {
  return Object.keys(HAZARD_MODULES)
}
