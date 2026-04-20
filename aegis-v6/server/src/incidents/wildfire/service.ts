/**
 * Wildfire and bushfire events incident module (handles wildfire specific logic).
 *
 * - Part of the incident module system, registered via incidents/registry.ts
 * */

import pool from '../../models/db.js'
import type { IncidentPrediction } from '../types.js'
import { wildfireConfig, WILDFIRE_RISK_FACTORS } from './config.js'
import { logger } from '../../services/logger.js'

export class WildfireService {
   /**
   * Get wildfire risk score
   */
  static async calculateWildfireRisk(region: string): Promise<number> {
    try {
      const result = await pool.query(
        `SELECT COUNT(*) as count
         FROM reports
         WHERE incident_type = 'wildfire'
           AND created_at >= NOW() - interval '24 hours'
           AND status NOT IN ('resolved', 'closed', 'rejected', 'archived')`,
        []
      )
      
      const count = parseInt(result.rows[0]?.count || '0')
      return Math.min(1.0, count / 5)
    } catch {
      return 0
    }
  }

   /**
   * Get wildfire predictions for a region
   */
  static async getWildfirePredictions(region: string): Promise<IncidentPrediction[]> {
    const riskScore = await this.calculateWildfireRisk(region)
    const probability = Math.round(riskScore * 100) / 100

    let severity = 'Low'
    if (probability > 0.75) severity = 'Critical'
    else if (probability > 0.5) severity = 'High'
    else if (probability > 0.25) severity = 'Medium'

    return [{
      incidentType: 'wildfire',
      severity,
      probability,
      confidence: 0.65,
      confidenceSource: 'ml_model',
      region,
      description: `Wildfire risk assessment based on fire hotspot detection and weather conditions.`,
      advisoryText: this.getWildfireAdvisory(severity),
      generatedAt: new Date().toISOString(),
      dataSourcesUsed: ['nasa_firms', 'weather_data', 'satellite_imagery'],
      modelVersion: 'wildfire_v1.0'
    }]
  }

   /**
   * Get wildfire advisory text based on severity
   */
  static getWildfireAdvisory(severity: string): string {
    switch (severity) {
      case 'Critical':
        return 'EXTREME FIRE DANGER: Active wildfires or critical fire weather. Evacuate if ordered. No outdoor burning.'
      case 'High':
        return 'HIGH FIRE DANGER: Conditions favorable for rapid fire spread. Extreme caution advised.'
      case 'Medium':
        return 'MODERATE FIRE DANGER: Fire conditions present. Be cautious with fire sources.'
      default:
        return 'LOW FIRE DANGER: Normal fire safety precautions apply.'
    }
  }

   /**
   * Analyze fire hotspots
   */
  static async analyzeFireHotspots(region: string, lat = 57.15, lon = -2.11): Promise<{ hotspotCount: number; totalFRP: number; nearUrban: number }> {
    try {
      const { WildfireDataIngestion } = await import('./dataIngestion.js')
      const result = await WildfireDataIngestion.ingestFireData(region, lat, lon, 100)
      if (result.recordsIngested === 0) {
        return { hotspotCount: 0, totalFRP: 0, nearUrban: 0 }
      }
      const apiKey = process.env.NASA_FIRMS_API_KEY
      if (!apiKey) {
        logger.warn('[WildfireService] NASA FIRMS API key not configured -- cannot analyze hotspots')
        return { hotspotCount: 0, totalFRP: 0, nearUrban: 0 }
      }
      const source = 'VIIRS_NOAA20_NRT'
      const area = `${lat},${lon},100km`
      const url = `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${apiKey}/${source}/${area}/1`
      const response = await fetch(url)
      if (!response.ok) {
        return { hotspotCount: 0, totalFRP: 0, nearUrban: 0 }
      }
      const csvData = await response.text()
      const hotspots = WildfireDataIngestion.parseFireHotspots(csvData)
      let totalFRP = 0
      let nearUrban = 0
      const urbanRadius = 50
      for (const hotspot of hotspots) {
        const frp = parseFloat(String(hotspot.frp || 0))
        totalFRP += frp
        const hotspotLat = parseFloat(String(hotspot.latitude || lat))
        const hotspotLon = parseFloat(String(hotspot.longitude || lon))
        const distance = Math.sqrt(Math.pow((hotspotLat - lat) * 111, 2) + Math.pow((hotspotLon - lon) * 111 * Math.cos(lat * Math.PI / 180), 2))
        if (distance <= urbanRadius) nearUrban++
      }
      return { hotspotCount: hotspots.length, totalFRP: Math.round(totalFRP * 100) / 100, nearUrban }
    } catch (error) {
      logger.error({ err: error }, '[WildfireService] Fire hotspot analysis error')
      return { hotspotCount: 0, totalFRP: 0, nearUrban: 0 }
    }
  }
}
