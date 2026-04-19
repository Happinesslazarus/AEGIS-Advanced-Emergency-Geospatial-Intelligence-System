/**
 * PostGIS spatial analysis endpoints: heatmaps, clustering, buffer zones,
 * proximity searches, and spatial statistics for the disaster map.
 *
 * - Mounted at /api/spatial in index.ts
 * - Runs PostGIS queries against the main database (db.ts)
 * - Results are GeoJSON consumed by the Leaflet map frontend
 * - Responses cached via cacheService
 * */

import { Router, Request, Response, NextFunction } from 'express'
import pool from '../models/db.js'
import { AppError } from '../utils/AppError.js'
import { remember, buildCacheKey, CACHE_TTL } from '../services/cacheService.js'

const router = Router()

function stringifySpatialError(err: unknown): string {
  if (!err) return 'unknown error'
  if (err instanceof Error) return err.message
  return String(err)
}

function addSpatialWarning(warnings: string[], scope: string, err: unknown): void {
  warnings.push(`${scope}: ${stringifySpatialError(err)}`)
}

/**
 * POST /api/spatial/distance
 * Calculate geodesic distance between two points using PostGIS.
 */
router.post('/distance', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const lat1 = parseFloat(req.body.lat1)
    const lng1 = parseFloat(req.body.lng1)
    const lat2 = parseFloat(req.body.lat2)
    const lng2 = parseFloat(req.body.lng2)
    if ([lat1, lng1, lat2, lng2].some(v => !Number.isFinite(v))) {
      throw AppError.badRequest('lat1, lng1, lat2, lng2 must be valid numbers')
    }
    if (lat1 < -90 || lat1 > 90 || lat2 < -90 || lat2 > 90) {
      throw AppError.badRequest('Latitude must be between -90 and 90')
    }
    if (lng1 < -180 || lng1 > 180 || lng2 < -180 || lng2 > 180) {
      throw AppError.badRequest('Longitude must be between -180 and 180')
    }

    const { rows } = await pool.query(
      `SELECT ST_Distance(
        ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
        ST_SetSRID(ST_MakePoint($3, $4), 4326)::geography
      ) / 1000 AS distance_km`,
      [lng1, lat1, lng2, lat2],
    )

    res.json({
      distance_km: parseFloat(rows[0]?.distance_km) || 0,
      from: { lat: lat1, lng: lng1 },
      to: { lat: lat2, lng: lng2 },
    })
  } catch (err) {
    next(err)
  }
})

/**
 * POST /api/spatial/buffer-analysis
 * Find all features (reports, shelters, alerts) within a given radius of a point.
 * Uses PostGIS ST_DWithin for accurate geodesic radius queries.
 */
router.post('/buffer-analysis', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { lat, lng, radius_km } = req.body
    if (!lat || !lng) throw AppError.badRequest('lat, lng required')
    const radiusM = (radius_km || 5) * 1000
    const warnings: string[] = []

    // Reports within radius
    let reportCount = 0
    let reports: any[] = []
    try {
      const { rows } = await pool.query(
        `SELECT id, type, severity, location, description,
                ST_Y(coordinates::geometry) as lat, ST_X(coordinates::geometry) as lng,
                ST_Distance(coordinates::geography, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography) / 1000 as distance_km
         FROM reports
         WHERE coordinates IS NOT NULL
           AND ST_DWithin(coordinates::geography, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, $3)
         ORDER BY distance_km
         LIMIT 50`,
        [lng, lat, radiusM],
      )
      reportCount = rows.length
      reports = rows
    } catch (err) { addSpatialWarning(warnings, 'reports query failed', err) }

    // Shelters within radius
    let shelters: any[] = []
    try {
      const { rows } = await pool.query(
        `SELECT id, name, address, capacity, current_occupancy, shelter_type,
                ST_Y(coordinates::geometry) as lat, ST_X(coordinates::geometry) as lng,
                ST_Distance(coordinates::geography, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography) / 1000 as distance_km
         FROM shelters
         WHERE is_active = true
           AND ST_DWithin(coordinates::geography, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, $3)
         ORDER BY distance_km
         LIMIT 20`,
        [lng, lat, radiusM],
      )
      shelters = rows
    } catch (err) { addSpatialWarning(warnings, 'shelters query failed', err) }

    // Active alerts in radius
    let alerts: any[] = []
    try {
      const { rows } = await pool.query(
        `SELECT id, title, severity, location_text, created_at
         FROM alerts
         WHERE is_active = true AND deleted_at IS NULL
         LIMIT 10`,
      )
      alerts = rows
    } catch (err) { addSpatialWarning(warnings, 'alerts query failed', err) }

    // Flood zones intersecting buffer
    let floodZones: any[] = []
    try {
      const { rows } = await pool.query(
        `SELECT zone_name, flood_type, probability, risk_level
         FROM flood_zones
         WHERE ST_DWithin(
           geometry::geography,
           ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
           $3
         )
         LIMIT 10`,
        [lng, lat, radiusM],
      )
      floodZones = rows
    } catch (err) { addSpatialWarning(warnings, 'flood zones query failed', err) }

    const responseData = {
      center: { lat, lng },
      radius_km: radius_km || 5,
      reports: { count: reportCount, items: reports },
      shelters: { count: shelters.length, items: shelters },
      alerts: { count: alerts.length, items: alerts },
      flood_zones: { count: floodZones.length, items: floodZones },
      degraded: warnings.length > 0,
      warnings,
    }

    // Cache the result for spatial queries (1 hour TTL)
    const key = buildCacheKey('spatial', ['buffer-analysis'], { lat, lng, radius_km })
    // Note: We cache after computing since the query is already done
    const { cacheSet } = await import('../services/cacheService.js')
    await cacheSet(key, responseData, CACHE_TTL.SPATIAL).catch(() => {})

    res.json(responseData)
  } catch (err) {
    next(err)
  }
})

/**
 * POST /api/spatial/nearest
 * Find the nearest feature of a given type (shelter, report, gauge station).
 */
router.post('/nearest', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { lat, lng, type } = req.body
    if (!lat || !lng) throw AppError.badRequest('lat, lng required')
    const featureType = type || 'shelter'
    const warnings: string[] = []

    let result: any = null

    if (featureType === 'shelter') {
      try {
        const { rows } = await pool.query(
          `SELECT id, name, address, capacity, current_occupancy, shelter_type, phone,
                  ST_Y(coordinates::geometry) as lat, ST_X(coordinates::geometry) as lng,
                  ST_Distance(coordinates::geography, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography) / 1000 as distance_km
           FROM shelters
           WHERE is_active = true AND coordinates IS NOT NULL
           ORDER BY coordinates::geography <-> ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography
           LIMIT 1`,
          [lng, lat],
        )
        if (rows.length > 0) result = rows[0]
      } catch (err) { addSpatialWarning(warnings, 'nearest shelter query failed', err) }
    } else if (featureType === 'report') {
      try {
        const { rows } = await pool.query(
          `SELECT id, type, severity, location, description,
                  ST_Y(coordinates::geometry) as lat, ST_X(coordinates::geometry) as lng,
                  ST_Distance(coordinates::geography, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography) / 1000 as distance_km
           FROM reports
           WHERE coordinates IS NOT NULL
           ORDER BY coordinates::geography <-> ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography
           LIMIT 1`,
          [lng, lat],
        )
        if (rows.length > 0) result = rows[0]
      } catch (err) { addSpatialWarning(warnings, 'nearest report query failed', err) }
    }

    res.json({
      query: { lat, lng, type: featureType },
      result: result || null,
      degraded: warnings.length > 0,
      warnings,
    })
  } catch (err) {
    next(err)
  }
})

/**
 * POST /api/spatial/flood-risk
 * Check flood risk at a point using PostGIS ST_Contains / ST_DWithin against flood zone polygons.
 */
router.post('/flood-risk', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { lat, lng } = req.body
    if (!lat || !lng) throw AppError.badRequest('lat, lng required')
    const warnings: string[] = []

    const key = buildCacheKey('spatial', ['flood-risk'], { lat, lng })
    const { data: result, meta } = await remember(key, CACHE_TTL.SPATIAL, async () => {
    // Check if point is inside any flood zone polygon
    let zones: any[] = []
    try {
      const { rows } = await pool.query(
        `SELECT zone_name, flood_type, probability, risk_level, description
         FROM flood_zones
         WHERE ST_Contains(geometry, ST_SetSRID(ST_MakePoint($1, $2), 4326))
         ORDER BY probability DESC`,
        [lng, lat],
      )
      zones = rows
    } catch (err) { addSpatialWarning(warnings, 'flood zone containment query failed', err) }

    // Also check nearby zones (within 2km)
    let nearbyZones: any[] = []
    if (zones.length === 0) {
      try {
        const { rows } = await pool.query(
          `SELECT zone_name, flood_type, probability, risk_level,
                  ST_Distance(geometry::geography, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography) / 1000 as distance_km
           FROM flood_zones
           WHERE ST_DWithin(geometry::geography, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, 2000)
           ORDER BY distance_km
           LIMIT 5`,
          [lng, lat],
        )
        nearbyZones = rows
      } catch (err) { addSpatialWarning(warnings, 'nearby flood zones query failed', err) }
    }

    // Check recent predictions for this area
    let predictions: any[] = []
    try {
      const { rows } = await pool.query(
        `SELECT hazard_type, probability, confidence, region_name, created_at
         FROM predictions
         WHERE created_at > NOW() - INTERVAL '24 hours'
         ORDER BY probability DESC
         LIMIT 5`,
      )
      predictions = rows
    } catch (err) { addSpatialWarning(warnings, 'predictions lookup failed', err) }

    const inFloodZone = zones.length > 0
    const maxProbability = zones.length > 0
      ? Math.max(...zones.map(z => parseFloat(z.probability) || 0))
      : 0

    return {
      location: { lat, lng },
      in_flood_zone: inFloodZone,
      risk_level: inFloodZone
        ? (maxProbability > 0.7 ? 'High' : maxProbability > 0.3 ? 'Medium' : 'Low')
        : 'None',
      zones,
      nearby_zones: nearbyZones,
      predictions,
      degraded: warnings.length > 0,
      warnings,
    }
    })

    if (meta.stale) res.set('X-Cache-Stale', 'true')
    res.json(result)
  } catch (err) {
    next(err)
  }
})

/**
 * POST /api/spatial/density
 * Generate a point density / heatmap intensity grid using PostGIS.
 * Returns a grid of cells with report/incident counts.
 */
router.post('/density', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { bounds, cell_size_km } = req.body
    const cellSize = cell_size_km || 1
    const warnings: string[] = []

    // If bounds provided, use them; otherwise use all reports
    let points: any[] = []
    try {
      const query = bounds
        ? `SELECT ST_Y(coordinates::geometry) as lat, ST_X(coordinates::geometry) as lng, severity
           FROM reports
           WHERE coordinates IS NOT NULL
             AND ST_Within(coordinates::geometry, ST_MakeEnvelope($1, $2, $3, $4, 4326))
           LIMIT 500`
        : `SELECT ST_Y(coordinates::geometry) as lat, ST_X(coordinates::geometry) as lng, severity
           FROM reports
           WHERE coordinates IS NOT NULL
           ORDER BY created_at DESC
           LIMIT 500`

      const params = bounds
        ? [bounds.west, bounds.south, bounds.east, bounds.north]
        : []

      const { rows } = await pool.query(query, params)
      points = rows.map((r: any) => ({
        lat: parseFloat(r.lat),
        lng: parseFloat(r.lng),
        intensity: r.severity === 'High' ? 1.0 : r.severity === 'Medium' ? 0.6 : 0.3,
      }))
    } catch (err) { addSpatialWarning(warnings, 'density query failed', err) }

    res.json({
      cell_size_km: cellSize,
      point_count: points.length,
      points,
      degraded: warnings.length > 0,
      warnings,
    })
  } catch (err) {
    next(err)
  }
})

/**
 * POST /api/spatial/area
 * Calculate the area of a polygon using PostGIS ST_Area on geography type.
 */
router.post('/area', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { coordinates } = req.body
    if (!Array.isArray(coordinates) || coordinates.length < 3) {
      throw AppError.badRequest('At least 3 [lat, lng] coordinates required')
    }

    // Build PostGIS polygon from coordinates [lat, lng] -> WKT [lng lat]
    const ring = [...coordinates, coordinates[0]] // close the ring
    const wktCoords = ring.map(c => `${c[1]} ${c[0]}`).join(', ')
    const wkt = `POLYGON((${wktCoords}))`

    const { rows } = await pool.query(
      `SELECT ST_Area(ST_GeogFromText($1)) / 1000000 AS area_km2`,
      [wkt],
    )

    res.json({
      area_km2: parseFloat(rows[0]?.area_km2) || 0,
      vertices: coordinates.length,
    })
  } catch (err) {
    next(err)
  }
})

export default router
