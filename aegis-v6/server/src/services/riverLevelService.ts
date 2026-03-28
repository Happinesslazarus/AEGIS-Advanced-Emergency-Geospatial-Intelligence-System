 /*
 * services/riverLevelService.ts — Live river level monitoring service
 * Central service for fetching, caching, storing, and broadcasting
 * river level data. Uses the adapter pattern: primary data provider
 * (SEPA for Scotland) with automatic fallback to OpenMeteo, then to
 * realistic mock data so the map always renders.
 * Features:
 * 5 minute polling with in-memory cache
 * Trend calculation (rising/falling/stable)
 * Dynamic threshold calibration via percentage of historical flood level
 * Every reading stored in river_levels table for historical analysis
 * Socket.IO broadcast on update so clients refresh without page reload
 * Falls back gracefully through SEPA → OpenMeteo → mock data
  */

import pool from '../models/db.js'
import { getActiveCityRegion } from '../config/regions/index.js'
import { fetchWithFallback, fetchHistoryWithFallback } from '../adapters/riverData/index.js'
import { calculateFloodStatus, calculateTrend } from '../utils/floodStatus.js'
import type { RiverStation, FloodStatus } from '../config/regions/types.js'
import type { Server as IOServer } from 'socket.io'
import { logger } from './logger.js'

// Types

export interface RiverLevelReading {
  stationId: string
  stationName: string
  riverName: string
  levelMetres: number
  flowCumecs: number | null
  status: FloodStatus
  trend: 'rising' | 'falling' | 'stable'
  previousLevel: number | null
  percentageOfFloodLevel: number
  thresholdMethod: string
  dataSource: string
  timestamp: string
  coordinates?: { lat: number; lng: number }
}

// In-Memory Cache (5 minute TTL)

const CACHE_TTL_MS = 5 * 60 * 1000

interface CacheEntry {
  data: RiverLevelReading[]
  fetchedAt: number
}

let levelCache: CacheEntry | null = null

function isCacheValid(): boolean {
  return levelCache !== null && Date.now() - levelCache.fetchedAt < CACHE_TTL_MS
}

// Core Functions

 /*
 * Fetch current levels for all rivers in the active region.
 * Uses cache if fresh, otherwise fetches from providers.
  */
export async function getCurrentLevels(forceRefresh = false): Promise<RiverLevelReading[]> {
  if (!forceRefresh && isCacheValid()) {
    return levelCache!.data
  }

  const region = getActiveCityRegion()
  const readings: RiverLevelReading[] = []

  for (const river of region.rivers) {
    try {
      const reading = await fetchSingleRiverLevel(river, region.id)
      if (reading) readings.push(reading)
    } catch (err: any) {
      logger.error({ err, river: river.name }, '[RiverService] Failed to fetch')
    }
  }

  // Update cache
  levelCache = { data: readings, fetchedAt: Date.now() }

  return readings
}

 /*
 * Fetch a single river's current level, calculate status and trend,
 * and store the reading in the database.
  */
async function fetchSingleRiverLevel(
  station: RiverStation,
  regionId: string,
): Promise<RiverLevelReading | null> {
  // Fetch from provider with automatic fallback
  const reading = await fetchWithFallback(
    station.dataProvider,
    station.stationId,
    station.name,
    station.name,
    station.coordinates,
  )

  if (!reading || reading.levelMetres == null) return null

  // Get previous reading for trend calculation
  const previousLevel = await getPreviousLevel(station.stationId)

  // Calculate dynamic flood status
  const statusResult = calculateFloodStatus(reading.levelMetres, station)
  const trend = calculateTrend(reading.levelMetres, previousLevel)

  const result: RiverLevelReading = {
    stationId: station.stationId,
    stationName: station.name,
    riverName: station.name,
    levelMetres: reading.levelMetres,
    flowCumecs: reading.flowCumecs,
    status: statusResult.status,
    trend,
    previousLevel,
    percentageOfFloodLevel: statusResult.percentageOfFloodLevel,
    thresholdMethod: statusResult.thresholdUsed,
    dataSource: reading.dataSource,
    timestamp: reading.timestamp,
    coordinates: station.coordinates,
  }

  // Store in database (non-blocking)
  storeReading(result, regionId).catch(err => {
    logger.error({ err, stationId: station.stationId }, '[RiverService] DB store failed')
  })

  return result
}

 /*
 * Get the most recent level for a station from the database.
  */
async function getPreviousLevel(stationId: string): Promise<number | null> {
  try {
    const { rows } = await pool.query(
      `SELECT level_metres FROM river_levels
       WHERE station_id = $1 AND level_metres IS NOT NULL
       ORDER BY timestamp DESC LIMIT 1`,
      [stationId],
    )
    return rows.length > 0 ? parseFloat(rows[0].level_metres) : null
  } catch {
    return null
  }
}

 /*
 * Store a reading in the river_levels table.
  */
async function storeReading(reading: RiverLevelReading, regionId: string): Promise<void> {
  await pool.query(
    `INSERT INTO river_levels
       (region_id, station_id, station_name, river_name, level_metres, flow_cumecs,
        status, trend, previous_level, percentage_of_flood_level, threshold_method,
        timestamp, data_source)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
    [
      regionId,
      reading.stationId,
      reading.stationName,
      reading.riverName,
      reading.levelMetres,
      reading.flowCumecs,
      reading.status,
      reading.trend,
      reading.previousLevel,
      reading.percentageOfFloodLevel,
      reading.thresholdMethod,
      reading.timestamp,
      reading.dataSource,
    ],
  )
}

 /*
 * Get current levels for a specific station with history.
  */
export async function getStationWithHistory(
  stationId: string,
  hours = 24,
): Promise<{ current: RiverLevelReading | null; history: Array<{ timestamp: string; levelMetres: number }> }> {
  const levels = await getCurrentLevels()
  const current = levels.find(l => l.stationId === stationId) || null

  // Try to get history from the database first (real stored readings)
  const { rows } = await pool.query(
    `SELECT level_metres, timestamp FROM river_levels
     WHERE station_id = $1 AND timestamp > NOW() - INTERVAL '${hours} hours'
     ORDER BY timestamp ASC`,
    [stationId],
  )

  if (rows.length > 0) {
    return {
      current,
      history: rows.map(r => ({
        timestamp: r.timestamp,
        levelMetres: parseFloat(r.level_metres),
      })),
    }
  }

  // If no DB history, try to fetch from the provider
  const region = getActiveCityRegion()
  const station = region.rivers.find(r => r.stationId === stationId)
  if (station) {
    const providerHistory = await fetchHistoryWithFallback(
      station.dataProvider,
      stationId,
      hours,
      station.coordinates,
    )
    return {
      current,
      history: providerHistory.readings.map(r => ({
        timestamp: r.timestamp,
        levelMetres: r.levelMetres,
      })),
    }
  }

  return { current, history: [] }
}

 /*
 * Get historical readings from the database for a station.
  */
export async function getStationHistory(
  stationId: string,
  hours = 24,
): Promise<Array<{ timestamp: string; levelMetres: number; flowCumecs: number | null; status: string }>> {
  const { rows } = await pool.query(
    `SELECT level_metres, flow_cumecs, status, timestamp FROM river_levels
     WHERE station_id = $1 AND timestamp > NOW() - INTERVAL '${hours} hours'
     ORDER BY timestamp ASC`,
    [stationId],
  )

  return rows.map(r => ({
    timestamp: r.timestamp,
    levelMetres: parseFloat(r.level_metres),
    flowCumecs: r.flow_cumecs ? parseFloat(r.flow_cumecs) : null,
    status: r.status,
  }))
}

// Cron Integration — called every 5 minutes

let ioInstance: IOServer | null = null

export function setIOInstance(io: IOServer): void {
  ioInstance = io
}

 /*
 * Scheduled task: fetch all river levels, store in DB, emit Socket.IO event.
  */
export async function fetchAndBroadcastLevels(): Promise<number> {
  const levels = await getCurrentLevels(true)

  // Broadcast to all connected clients
  if (ioInstance && levels.length > 0) {
    ioInstance.emit('river:levels_updated', {
      levels,
      updatedAt: new Date().toISOString(),
      regionId: getActiveCityRegion().id,
    })
  }

  return levels.length
}
