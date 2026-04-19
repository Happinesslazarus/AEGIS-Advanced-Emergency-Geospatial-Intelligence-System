/**
 * Live river level monitoring: current readings for all stations,
 * individual station details with 24-hour history, and river
 * configuration for the active region.
 *
 * - Mounted at /api/rivers in index.ts
 * - Uses riverLevelService which ingests SEPA data on a cron schedule
 * - Real-time level changes broadcast via Socket.IO
 * - Responses cached via cacheService
 *
 * GET /api/rivers/levels             — All station levels
 * GET /api/rivers/levels/:stationId  — Station with 24hr history
 * GET /api/rivers/history/:stationId — Extended history
 * GET /api/rivers/config             — Region river config
 * */

import { Router, Request, Response, NextFunction } from 'express'
import { getCurrentLevels, getStationWithHistory, getStationHistory } from '../services/riverLevelService.js'
import { getActiveCityRegion } from '../config/regions/index.js'
import { AppError } from '../utils/AppError.js'
import { remember, buildCacheKey, CACHE_TTL, type CacheResponseMeta } from '../services/cacheService.js'

const router = Router()

/**
 * GET /api/rivers/levels — Current levels for all stations in the active region
 */
router.get('/levels', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const region = getActiveCityRegion()
    const key = buildCacheKey('river', [region.id, 'levels'])
    const { data: result, meta } = await remember(key, CACHE_TTL.RIVER_LEVELS, async () => {
      const levels = await getCurrentLevels()
      return {
        regionId: region.id,
        regionName: region.name,
        stationCount: levels.length,
        levels,
        updatedAt: new Date().toISOString(),
      }
    }, { staleOnError: true, provider: 'sepa-openmeteo' })

    if (meta.stale) res.set('X-Cache-Stale', 'true')
    res.json(result)
  } catch (err) {
    next(err)
  }
})

/**
 * GET /api/rivers/levels/:stationId — Specific station with 24hr history
 */
router.get('/levels/:stationId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { stationId } = req.params
    const hours = Math.min(parseInt(req.query.hours as string) || 24, 168) // Max 7 days
    const region = getActiveCityRegion()
    const key = buildCacheKey('river', [region.id, 'station', stationId], { hours })

    const { data: result, meta } = await remember(key, CACHE_TTL.RIVER_LEVELS, async () => {
      const data = await getStationWithHistory(stationId, hours)
      if (!data.current) {
        throw AppError.notFound(`Station ${stationId} not found in active region`)
      }
      return {
        station: data.current,
        history: data.history,
        historyHours: hours,
      }
    }, { staleOnError: true, provider: 'sepa-openmeteo' })

    if (meta.stale) res.set('X-Cache-Stale', 'true')
    res.json(result)
  } catch (err) {
    next(err)
  }
})

/**
 * GET /api/rivers/history/:stationId — Historical readings for a station
 */
router.get('/history/:stationId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { stationId } = req.params
    const hours = Math.min(parseInt(req.query.hours as string) || 24, 168)
    const region = getActiveCityRegion()
    const key = buildCacheKey('river', [region.id, 'history', stationId], { hours })

    const { data: result, meta } = await remember(key, CACHE_TTL.RIVER_LEVELS, async () => {
      const history = await getStationHistory(stationId, hours)
      return {
        stationId,
        hours,
        readingCount: history.length,
        readings: history,
      }
    }, { staleOnError: true, provider: 'db' })

    if (meta.stale) res.set('X-Cache-Stale', 'true')
    res.json(result)
  } catch (err) {
    next(err)
  }
})

/**
 * GET /api/rivers/config — River configuration for the active region
 */
router.get('/config', async (_req: Request, res: Response) => {
  const region = getActiveCityRegion()
  const key = buildCacheKey('river', [region.id, 'config'])
  try {
    const { data: result } = await remember(key, CACHE_TTL.RIVER_CONFIG, async () => {
      return {
        regionId: region.id,
        regionName: region.name,
        rivers: region.rivers.map(r => ({
          name: r.name,
          stationId: r.stationId,
          dataProvider: r.dataProvider,
          thresholds: r.floodThresholds,
          historicalFloodLevel: r.historicalFloodLevel,
          coordinates: r.coordinates,
        })),
      }
    })
    res.json(result)
  } catch {
    res.json({
      regionId: region.id,
      regionName: region.name,
      rivers: region.rivers.map(r => ({
        name: r.name,
        stationId: r.stationId,
        dataProvider: r.dataProvider,
        thresholds: r.floodThresholds,
        historicalFloodLevel: r.historicalFloodLevel,
        coordinates: r.coordinates,
      })),
    })
  }
})

export default router
