/**
 * incidents/drought/service.ts — Business logic for drought incident management
 *
 * Provides higher-level operations beyond the BaseIncidentModule defaults:
 * Fetch and cache drought index from external data
 * Generate water conservation advisories
 * Aggregate regional drought status
 */

import { ingestDroughtData, classifyDroughtSeverity, type DroughtIngestionResult } from './dataIngestion.js'
import { DroughtAIClient } from './aiClient.js'
import { logger } from '../../services/logger.js'

// In-memory cache (cleared on restart; Redis would be used in production)
let _cache: { data: DroughtIngestionResult; expiresAt: number } | null = null
const CACHE_TTL_MS = 6 * 60 * 60 * 1000 // 6 hours

export class DroughtService {
   /**
   * Get current drought index, using cache if still fresh.
   */
  static async getDroughtIndex(latitude?: number, longitude?: number): Promise<DroughtIngestionResult> {
    const now = Date.now()
    if (_cache && _cache.expiresAt > now) return _cache.data

    try {
      const data = await ingestDroughtData(latitude, longitude)
      _cache = { data, expiresAt: now + CACHE_TTL_MS }
      return data
    } catch (err) {
      logger.error({ err }, '[DroughtService] Data ingestion failed')
      // Return safe default
      return {
        rainfall30dMm: 80,
        avgTempC: 12,
        maxTempC: 18,
        riverLevelNormal: true,
        droughtIndexScore: 10,
        dataSource: 'fallback',
        fetchedAt: new Date().toISOString(),
      }
    }
  }

   /**
   * Get drought severity label for a given region.
   */
  static async getDroughtSeverity(region: string): Promise<'Low' | 'Medium' | 'High' | 'Critical'> {
    const data = await DroughtService.getDroughtIndex()
    return classifyDroughtSeverity(data)
  }

   /**
   * Build water conservation advisory text based on drought index.
   */
  static getConservationAdvisory(severity: string): string {
    const advisories: Record<string, string> = {
      Critical: [
        'Severe drought conditions declared.',
        'Mandatory water restrictions are likely in your area.',
        'Limit all non-essential water use (gardening, car washing, pools).',
        'Store emergency drinking water supply.',
        'Report water wastage to your utility provider.',
      ].join(' '),
      High: [
        'Significant rainfall deficit detected.',
        'Voluntary water conservation strongly recommended.',
        'Shorten showers, fix leaks, avoid hosepipe use.',
        'Farmers: activate drought management plans.',
      ].join(' '),
      Medium: [
        'Below-normal precipitation recorded.',
        'Consider reducing non-essential water consumption.',
        'Monitor local water authority communications.',
      ].join(' '),
      Low: 'Precipitation within normal range. Continue routine monitoring.',
    }
    return advisories[severity] ?? advisories.Low
  }

   /**
   * Invalidate the ingestion cache (call after fresh data is forced).
   */
  static invalidateCache(): void {
    _cache = null
  }
}
