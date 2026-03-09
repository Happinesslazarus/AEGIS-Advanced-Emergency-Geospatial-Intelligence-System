/**
 * routes/riverRoutes.ts — River level monitoring API endpoints
 *
 *   GET /api/rivers/levels             — Current levels for all stations
 *   GET /api/rivers/levels/:stationId  — Specific station with 24hr history
 *   GET /api/rivers/history/:stationId — Historical readings
 *   GET /api/rivers/config             — River configuration for active region
 */

import { Router, Request, Response } from 'express'
import { getCurrentLevels, getStationWithHistory, getStationHistory } from '../services/riverLevelService.js'
import { getActiveCityRegion } from '../config/regions/index.js'

const router = Router()

/**
 * GET /api/rivers/levels — Current levels for all stations in the active region
 */
router.get('/levels', async (_req: Request, res: Response) => {
  try {
    const levels = await getCurrentLevels()
    const region = getActiveCityRegion()

    res.json({
      regionId: region.id,
      regionName: region.name,
      stationCount: levels.length,
      levels,
      updatedAt: new Date().toISOString(),
    })
  } catch (err: any) {
    console.error('[Rivers] Failed to fetch levels:', err.message)
    res.status(500).json({ error: 'Failed to fetch river levels', details: err.message })
  }
})

/**
 * GET /api/rivers/levels/:stationId — Specific station with 24hr history
 */
router.get('/levels/:stationId', async (req: Request, res: Response) => {
  try {
    const { stationId } = req.params
    const hours = Math.min(parseInt(req.query.hours as string) || 24, 168) // Max 7 days

    const data = await getStationWithHistory(stationId, hours)

    if (!data.current) {
      res.status(404).json({ error: `Station ${stationId} not found in active region` })
      return
    }

    res.json({
      station: data.current,
      history: data.history,
      historyHours: hours,
    })
  } catch (err: any) {
    console.error('[Rivers] Station fetch failed:', err.message)
    res.status(500).json({ error: 'Failed to fetch station data', details: err.message })
  }
})

/**
 * GET /api/rivers/history/:stationId — Historical readings for a station
 */
router.get('/history/:stationId', async (req: Request, res: Response) => {
  try {
    const { stationId } = req.params
    const hours = Math.min(parseInt(req.query.hours as string) || 24, 168)

    const history = await getStationHistory(stationId, hours)

    res.json({
      stationId,
      hours,
      readingCount: history.length,
      readings: history,
    })
  } catch (err: any) {
    console.error('[Rivers] History fetch failed:', err.message)
    res.status(500).json({ error: 'Failed to fetch history', details: err.message })
  }
})

/**
 * GET /api/rivers/config — River configuration for the active region
 */
router.get('/config', (_req: Request, res: Response) => {
  const region = getActiveCityRegion()
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
})

export default router
