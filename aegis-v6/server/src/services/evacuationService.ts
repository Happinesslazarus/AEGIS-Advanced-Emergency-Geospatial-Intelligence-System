 /*
 * services/evacuationService.ts — Evacuation route calculator
 * Calculates safe routes from a starting point to shelters or high ground,
 * avoiding active flood zones. Uses OpenRouteService API when configured,
 * with pre-calculated fallback routes for monitored cities.
  */

import { getActiveCityRegion } from '../config/regions/index.js'
import pool from '../models/db.js'
import fs from 'fs'
import path from 'path'
import { IncidentIntelligenceCore } from './incidentIntelligenceCore.js'
import { logger } from './logger.js'

const intelligenceCore = new IncidentIntelligenceCore(getActiveCityRegion())

// Types

export interface EvacuationRoute {
  id: string
  fromDescription: string
  toDescription: string
  toType: 'shelter' | 'high_ground'
  distanceKm: number
  durationMinutes: number
  geometry: any
  shelterInfo?: {
    name: string
    address: string
    capacity: number
    currentOccupancy: number
  }
  isBlocked: boolean
  blockedReason?: string
  riskScore?: number
  recommendationScore?: number
  etaConfidence?: number
  closureProximityM?: number
  explanation?: RouteExplanation
}

export interface EvacuationResult {
  routes: EvacuationRoute[]
  nearestShelter: EvacuationRoute | null
  calculatedAt: string
  usingFallback: boolean
  rankingModel?: string
  routeRefreshSeconds?: number
  riskSignalsUsed?: number
}

export interface EvacuationRoutingOptions {
  optimizeFor?: 'fastest' | 'safest' | 'balanced'
  refreshWindowSeconds?: number
  liveClosures?: Array<{
    lat: number
    lng: number
    radiusMeters?: number
    severity?: 'low' | 'medium' | 'high' | 'critical'
    reason?: string
  }>
}

type RouteHazardSignal = {
  lat: number
  lng: number
  severity: 'low' | 'medium' | 'high' | 'critical'
  confidence: number
  source: 'live_report' | 'closure'
  reason?: string
}

type RouteHazardHit = {
  source: 'live_report' | 'closure'
  severity: 'low' | 'medium' | 'high' | 'critical'
  confidence: number
  distanceM: number
  reason?: string
}

type RouteBlockedSegment = {
  from: { lat: number; lng: number }
  to: { lat: number; lng: number }
  hazardSeverity: string
  hazardDistanceM: number
}

type RouteScoreBreakdown = {
  timeScore: number
  riskPenalty: number
  profile: 'fastest' | 'safest' | 'balanced'
  timeWeight: number
  riskWeight: number
}

type RouteExplanation = {
  topHazards: RouteHazardHit[]
  blockedSegments: RouteBlockedSegment[]
  scoreBreakdown: RouteScoreBreakdown
}

// Pre-calculated Routes (fallback) — Aberdeen, Edinburgh, Glasgow, Dundee

const ABERDEEN_ROUTES: EvacuationRoute[] = [
  {
    id: 'abd-route-1',
    fromDescription: 'Bridge of Don (flood-prone)',
    toDescription: 'Jesmond Community Centre',
    toType: 'shelter',
    distanceKm: 2.3,
    durationMinutes: 8,
    geometry: {
      type: 'LineString',
      coordinates: [
        [-2.0550, 57.1740], [-2.0580, 57.1730], [-2.0620, 57.1710],
        [-2.0680, 57.1690], [-2.0730, 57.1660], [-2.0770, 57.1640],
        [-2.0810, 57.1620], [-2.0837, 57.1599],
      ],
    },
    shelterInfo: {
      name: 'Jesmond Community Centre',
      address: 'Jesmond Drive, Aberdeen AB22 8UR',
      capacity: 200,
      currentOccupancy: 0,
    },
    isBlocked: false,
  },
  {
    id: 'abd-route-2',
    fromDescription: 'Grandholm (flood-prone)',
    toDescription: 'Danestone Community Centre',
    toType: 'shelter',
    distanceKm: 1.8,
    durationMinutes: 6,
    geometry: {
      type: 'LineString',
      coordinates: [
        [-2.0950, 57.1720], [-2.0920, 57.1710], [-2.0880, 57.1690],
        [-2.0840, 57.1670], [-2.0800, 57.1650], [-2.0770, 57.1640],
      ],
    },
    shelterInfo: {
      name: 'Danestone Community Centre',
      address: 'Fairview Street, Aberdeen AB22 8ZJ',
      capacity: 150,
      currentOccupancy: 0,
    },
    isBlocked: false,
  },
  {
    id: 'abd-route-3',
    fromDescription: 'Tillydrone (flood-prone)',
    toDescription: 'St Machar Academy (High Ground)',
    toType: 'high_ground',
    distanceKm: 1.2,
    durationMinutes: 4,
    geometry: {
      type: 'LineString',
      coordinates: [
        [-2.1100, 57.1660], [-2.1080, 57.1640], [-2.1050, 57.1620],
        [-2.1020, 57.1600], [-2.1010, 57.1580],
      ],
    },
    isBlocked: false,
  },
  {
    id: 'abd-route-4',
    fromDescription: 'Woodside (flood-prone)',
    toDescription: 'Woodside Community Centre',
    toType: 'shelter',
    distanceKm: 0.9,
    durationMinutes: 3,
    geometry: {
      type: 'LineString',
      coordinates: [
        [-2.1150, 57.1640], [-2.1130, 57.1620], [-2.1100, 57.1600],
        [-2.1080, 57.1585],
      ],
    },
    shelterInfo: {
      name: 'Woodside Community Centre',
      address: 'Clifton Road, Aberdeen AB24 4RH',
      capacity: 120,
      currentOccupancy: 0,
    },
    isBlocked: false,
  },
  {
    id: 'abd-route-5',
    fromDescription: 'King Street Corridor',
    toDescription: 'Pittodrie Sports Complex',
    toType: 'high_ground',
    distanceKm: 1.5,
    durationMinutes: 5,
    geometry: {
      type: 'LineString',
      coordinates: [
        [-2.0900, 57.1580], [-2.0880, 57.1560], [-2.0850, 57.1540],
        [-2.0820, 57.1530], [-2.0800, 57.1520],
      ],
    },
    isBlocked: false,
  },
  {
    id: 'abd-route-6',
    fromDescription: 'Donmouth Area',
    toDescription: 'King Street Community Centre',
    toType: 'shelter',
    distanceKm: 2.0,
    durationMinutes: 7,
    geometry: {
      type: 'LineString',
      coordinates: [
        [-2.0450, 57.1750], [-2.0500, 57.1730], [-2.0560, 57.1710],
        [-2.0620, 57.1690], [-2.0680, 57.1670], [-2.0730, 57.1650],
        [-2.0780, 57.1630], [-2.0820, 57.1610],
      ],
    },
    shelterInfo: {
      name: 'King Street Community Centre',
      address: 'King Street, Aberdeen AB24 5AX',
      capacity: 200,
      currentOccupancy: 0,
    },
    isBlocked: false,
  },
]

// Core Functions

 /*
 * Calculate evacuation routes from a starting point.
 * Uses OpenRouteService if API key present, otherwise pre-calculated routes.
  */
export async function calculateEvacuationRoutes(
  startLat: number,
  startLng: number,
  floodExtentGeoJSON?: any,
  destinationType: 'shelter' | 'high_ground' | 'both' = 'both',
  options?: EvacuationRoutingOptions,
): Promise<EvacuationResult> {
  const orsKey = process.env.ORS_API_KEY

  if (orsKey) {
    try {
      return await calculateWithORS(startLat, startLng, floodExtentGeoJSON, destinationType, orsKey, options)
    } catch (err: any) {
      logger.warn({ err }, '[Evacuation] ORS failed, using fallback')
    }
  }

  // Fallback to pre-calculated routes
  return getFallbackRoutes(startLat, startLng, destinationType, options)
}

export async function getOperationalEvacuationOverview(
  destinationType: 'shelter' | 'high_ground' | 'both' = 'both',
  options?: EvacuationRoutingOptions,
): Promise<EvacuationResult> {
  const region = getActiveCityRegion()
  const dynamicHazard = await buildDynamicAvoidPolygons(region.centre.lat, region.centre.lng, options)
  let routes = getPreCalculatedRoutes()

  if (destinationType === 'shelter') {
    routes = routes.filter((r) => r.toType === 'shelter')
  } else if (destinationType === 'high_ground') {
    routes = routes.filter((r) => r.toType === 'high_ground')
  }

  const ranked = rankEvacuationRoutes(routes, dynamicHazard.hazards, options)
  return {
    routes: ranked,
    nearestShelter: ranked.find((r) => r.toType === 'shelter') || ranked[0] || null,
    calculatedAt: new Date().toISOString(),
    usingFallback: true,
    rankingModel: 'risk-aware-v2-operational-overview',
    routeRefreshSeconds: Math.max(15, options?.refreshWindowSeconds || 30),
    riskSignalsUsed: dynamicHazard.hazards.length,
  }
}

async function calculateWithORS(
  startLat: number,
  startLng: number,
  floodExtentGeoJSON: any,
  destinationType: string,
  apiKey: string,
  options?: EvacuationRoutingOptions,
): Promise<EvacuationResult> {
  const dynamicHazard = await buildDynamicAvoidPolygons(startLat, startLng, options)

  // Get nearest shelters from DB
  const { rows: shelters } = await pool.query(`
    SELECT id, name, address, capacity, current_occupancy,
           ST_Y(coordinates::geometry) as lat, ST_X(coordinates::geometry) as lng
    FROM shelters
    WHERE is_active = true
    ORDER BY coordinates <-> ST_SetSRID(ST_MakePoint($1, $2), 4326)
    LIMIT 3
  `, [startLng, startLat]).catch(() => ({ rows: [] }))

  const routes: EvacuationRoute[] = []

  for (const shelter of shelters) {
    const body: any = {
      coordinates: [[startLng, startLat], [parseFloat(shelter.lng), parseFloat(shelter.lat)]],
    }

    // Add hazard avoidance polygons (dynamic incidents + optional flood extent)
    const avoidPolygons = dynamicHazard.avoidPolygons || floodExtentGeoJSON
    if (avoidPolygons) {
      body.options = { avoid_polygons: avoidPolygons }
    }

    try {
      const res = await fetch('https://api.openrouteservice.org/v2/directions/driving-car/geojson', {
        method: 'POST',
        headers: {
          'Authorization': apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      })

      if (res.ok) {
        const data = await res.json()
        const feature = data.features?.[0]
        if (feature) {
          routes.push({
            id: `ors-${shelter.id}`,
            fromDescription: `Your Location (${startLat.toFixed(4)}, ${startLng.toFixed(4)})`,
            toDescription: shelter.name,
            toType: 'shelter',
            distanceKm: Math.round((feature.properties?.summary?.distance || 0) / 100) / 10,
            durationMinutes: Math.ceil((feature.properties?.summary?.duration || 0) / 60),
            geometry: feature.geometry,
            shelterInfo: {
              name: shelter.name,
              address: shelter.address,
              capacity: shelter.capacity,
              currentOccupancy: shelter.current_occupancy || 0,
            },
            isBlocked: false,
          })
        }
      }
    } catch {
      // Skip this shelter if routing fails
    }
  }

  const ranked = rankEvacuationRoutes(routes, dynamicHazard.hazards, options)

  return {
    routes: ranked,
    nearestShelter: ranked.find((r) => r.toType === 'shelter') || ranked[0] || null,
    calculatedAt: new Date().toISOString(),
    usingFallback: false,
    rankingModel: 'risk-aware-v2',
    routeRefreshSeconds: Math.max(15, options?.refreshWindowSeconds || 30),
    riskSignalsUsed: dynamicHazard.hazards.length,
  }
}

async function buildDynamicAvoidPolygons(
  lat: number,
  lng: number,
  options?: EvacuationRoutingOptions,
): Promise<{ avoidPolygons: any | null; hazards: RouteHazardSignal[] }> {
  try {
    const { rows } = await pool.query(
      `SELECT ST_Y(coordinates::geometry) AS lat,
              ST_X(coordinates::geometry) AS lng,
              COALESCE(ai_confidence, 50) AS ai_confidence,
              severity
       FROM reports
       WHERE coordinates IS NOT NULL
         AND deleted_at IS NULL
         AND status NOT IN ('resolved', 'archived', 'false_report')
         AND created_at >= NOW() - INTERVAL '4 hours'
         AND ST_DWithin(coordinates, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, 10000)
         AND (severity IN ('high', 'critical') OR COALESCE(ai_confidence, 0) >= 70)
       LIMIT 20`,
      [lng, lat],
    )

    const closures = (options?.liveClosures || []).filter((c) =>
      Number.isFinite(c.lat) && Number.isFinite(c.lng),
    )

    const hazards: RouteHazardSignal[] = [
      ...rows.map((r: any) => ({
        lat: Number(r.lat),
        lng: Number(r.lng),
        severity: (String(r.severity || 'medium').toLowerCase() as RouteHazardSignal['severity']),
        confidence: Math.max(0.35, Math.min(0.99, Number(r.ai_confidence || 50) / 100)),
        source: 'live_report' as const,
        reason: 'Recent high-risk incident',
      })),
      ...closures.map((c, idx) => ({
        lat: Number(c.lat),
        lng: Number(c.lng),
        severity: c.severity || 'high',
        confidence: 0.95,
        source: 'closure' as const,
        reason: c.reason || `Live road closure ${idx + 1}`,
      })),
    ]

    if (!hazards.length) return { avoidPolygons: null, hazards: [] }

    const evidence = intelligenceCore.buildEvidenceEvents(
      hazards.map((h: RouteHazardSignal, idx: number) => ({
        id: `route-risk-${idx}`,
        signal_type: 'route_hazard',
        created_at: new Date().toISOString(),
        ai_confidence: Math.round(h.confidence * 100),
        severity: h.severity,
        lat: h.lat,
        lng: h.lng,
      })),
    )

    return {
      avoidPolygons: intelligenceCore.buildRouteRiskMask(evidence, {
      maxDistanceMeters: 10000,
      maxEvents: 20,
      lookbackHours: 4,
      }),
      hazards,
    }
  } catch {
    return { avoidPolygons: null, hazards: [] }
  }
}

function getFallbackRoutes(
  _startLat: number,
  _startLng: number,
  destinationType: string,
  options?: EvacuationRoutingOptions,
): EvacuationResult {
  // Select pre-calculated routes from all available cities, closest first
  const allRoutes = getPreCalculatedRoutes()
  let routes = allRoutes.length > 0 ? [...allRoutes] : [...ABERDEEN_ROUTES]

  // Sort by distance from the starting point (closest routes first)
  routes.sort((a, b) => {
    const aCoord = a.geometry.coordinates[0]
    const bCoord = b.geometry.coordinates[0]
    const aDist = Math.hypot(aCoord[1] - _startLat, aCoord[0] - _startLng)
    const bDist = Math.hypot(bCoord[1] - _startLat, bCoord[0] - _startLng)
    return aDist - bDist
  })

  // Keep the 10 closest routes
  routes = routes.slice(0, 10)

  if (destinationType === 'shelter') {
    routes = routes.filter(r => r.toType === 'shelter')
  } else if (destinationType === 'high_ground') {
    routes = routes.filter(r => r.toType === 'high_ground')
  }

  const closureHazards: RouteHazardSignal[] = (options?.liveClosures || []).map((c, idx) => ({
    lat: Number(c.lat),
    lng: Number(c.lng),
    severity: c.severity || 'high',
    confidence: 0.95,
    source: 'closure',
    reason: c.reason || `Fallback closure ${idx + 1}`,
  }))

  const ranked = rankEvacuationRoutes(routes, closureHazards, options)

  return {
    routes: ranked,
    nearestShelter: ranked.find(r => r.toType === 'shelter') || null,
    calculatedAt: new Date().toISOString(),
    usingFallback: true,
    rankingModel: 'risk-aware-v2-fallback',
    routeRefreshSeconds: Math.max(15, options?.refreshWindowSeconds || 30),
    riskSignalsUsed: closureHazards.length,
  }
}

function rankEvacuationRoutes(
  routes: EvacuationRoute[],
  hazards: RouteHazardSignal[],
  options?: EvacuationRoutingOptions,
): EvacuationRoute[] {
  if (!routes.length) return []

  const optimizeFor = options?.optimizeFor || 'balanced'
  const profile = optimizeFor === 'safest'
    ? { timeWeight: 0.25, riskWeight: 0.75 }
    : optimizeFor === 'fastest'
      ? { timeWeight: 0.75, riskWeight: 0.25 }
      : { timeWeight: 0.5, riskWeight: 0.5 }

  const longestDuration = Math.max(...routes.map((r) => r.durationMinutes || 1), 1)

  const ranked = routes.map((route) => {
    const points = extractRoutePoints(route.geometry)

    let minDistance = Number.POSITIVE_INFINITY
    let weightedHazard = 0
    let severeProximityHits = 0
    const hazardHits: RouteHazardHit[] = []

    for (const h of hazards) {
      const severityWeight = hazardSeverityWeight(h.severity)
      const nearest = points.reduce((best, p) => {
        const d = haversineMeters(p.lat, p.lng, h.lat, h.lng)
        return Math.min(best, d)
      }, Number.POSITIVE_INFINITY)

      minDistance = Math.min(minDistance, nearest)

      const proximityRisk = nearest <= 50
        ? 1.0
        : nearest <= 150
          ? 0.7
          : nearest <= 300
            ? 0.45
            : nearest <= 600
              ? 0.2
              : 0

      if (nearest <= 150 && (h.severity === 'high' || h.severity === 'critical')) {
        severeProximityHits += 1
      }

      if (nearest <= 800) {
        hazardHits.push({
          source: h.source,
          severity: h.severity,
          confidence: h.confidence,
          distanceM: Math.round(nearest),
          reason: h.reason,
        })
      }

      weightedHazard += proximityRisk * severityWeight * h.confidence
    }

    const hazardDenominator = Math.max(1, hazards.length)
    const riskScore = Number(Math.min(1, weightedHazard / hazardDenominator).toFixed(3))
    const timeScore = 1 - Math.min(1, (route.durationMinutes || longestDuration) / longestDuration)
    const recommendationScore = Number((
      timeScore * profile.timeWeight + (1 - riskScore) * profile.riskWeight
    ).toFixed(3))

    const isBlocked = severeProximityHits > 0
    const etaConfidence = Number(Math.max(0.3, Math.min(0.99, 0.92 - riskScore * 0.5)).toFixed(2))
    const blockedSegments = computeBlockedSegments(points, hazards)
    hazardHits.sort((a, b) => a.distanceM - b.distanceM)

    return {
      ...route,
      isBlocked,
      blockedReason: isBlocked ? 'High-severity hazard or closure intersects route corridor' : route.blockedReason,
      riskScore,
      recommendationScore,
      etaConfidence,
      closureProximityM: Number.isFinite(minDistance) ? Math.round(minDistance) : undefined,
      explanation: {
        topHazards: hazardHits.slice(0, 5),
        blockedSegments,
        scoreBreakdown: {
          timeScore: Number(timeScore.toFixed(3)),
          riskPenalty: Number(riskScore.toFixed(3)),
          profile: optimizeFor,
          timeWeight: profile.timeWeight,
          riskWeight: profile.riskWeight,
        },
      },
    }
  })

  return ranked.sort((a, b) => {
    if (a.isBlocked !== b.isBlocked) return a.isBlocked ? 1 : -1
    return (b.recommendationScore || 0) - (a.recommendationScore || 0)
  })
}

function extractRoutePoints(geometry: any): Array<{ lat: number; lng: number }> {
  if (!geometry || !Array.isArray(geometry.coordinates)) return []

  const coords = geometry.type === 'LineString'
    ? geometry.coordinates
    : geometry.type === 'MultiLineString'
      ? geometry.coordinates.flat()
      : []

  return coords
    .filter((c: any) => Array.isArray(c) && c.length >= 2)
    .map((c: any) => ({ lng: Number(c[0]), lat: Number(c[1]) }))
    .filter((p: any) => Number.isFinite(p.lat) && Number.isFinite(p.lng))
}

function computeBlockedSegments(
  points: Array<{ lat: number; lng: number }>,
  hazards: RouteHazardSignal[],
): RouteBlockedSegment[] {
  if (points.length < 2 || hazards.length === 0) return []

  const segments: RouteBlockedSegment[] = []
  for (let i = 0; i < points.length - 1; i++) {
    const from = points[i]
    const to = points[i + 1]

    for (const hazard of hazards) {
      const d1 = haversineMeters(from.lat, from.lng, hazard.lat, hazard.lng)
      const d2 = haversineMeters(to.lat, to.lng, hazard.lat, hazard.lng)
      const nearest = Math.min(d1, d2)

      const threshold = hazard.severity === 'critical'
        ? 220
        : hazard.severity === 'high'
          ? 170
          : 120

      if (nearest <= threshold) {
        segments.push({
          from,
          to,
          hazardSeverity: hazard.severity,
          hazardDistanceM: Math.round(nearest),
        })
        break
      }
    }
  }

  return segments.slice(0, 8)
}

function hazardSeverityWeight(severity: string): number {
  const s = String(severity || 'medium').toLowerCase()
  if (s === 'critical') return 1.0
  if (s === 'high') return 0.8
  if (s === 'low') return 0.35
  return 0.55
}

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (v: number): number => (v * Math.PI) / 180
  const earthRadiusM = 6371000
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2)
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2))
    /*
    * Math.sin(dLon / 2) * Math.sin(dLon / 2)
     */
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return earthRadiusM * c
}

 /*
 * Get all pre-calculated evacuation routes for the active region.
  */
export function getPreCalculatedRoutes(): EvacuationRoute[] {
  return [...ABERDEEN_ROUTES, ...EDINBURGH_ROUTES, ...GLASGOW_ROUTES, ...DUNDEE_ROUTES]
}

// Edinburgh pre-calculated routes

const EDINBURGH_ROUTES: EvacuationRoute[] = [
  {
    id: 'edi-route-1',
    fromDescription: 'Stockbridge / Water of Leith (flood-prone)',
    toDescription: 'Drummond Community High School',
    toType: 'shelter',
    distanceKm: 1.4,
    durationMinutes: 5,
    geometry: {
      type: 'LineString',
      coordinates: [
        [-3.2100, 55.9580], [-3.2050, 55.9570], [-3.1990, 55.9560],
        [-3.1930, 55.9550], [-3.1870, 55.9540],
      ],
    },
    shelterInfo: {
      name: 'Drummond Community High School',
      address: 'Cochran Terrace, Edinburgh EH7 4PZ',
      capacity: 300,
      currentOccupancy: 0,
    },
    isBlocked: false,
  },
  {
    id: 'edi-route-2',
    fromDescription: 'Roseburn / Murrayfield (flood-prone)',
    toDescription: 'Tynecastle High School',
    toType: 'shelter',
    distanceKm: 1.1,
    durationMinutes: 4,
    geometry: {
      type: 'LineString',
      coordinates: [
        [-3.2400, 55.9430], [-3.2350, 55.9420], [-3.2290, 55.9410],
        [-3.2240, 55.9400],
      ],
    },
    shelterInfo: {
      name: 'Tynecastle High School',
      address: 'McLeod Street, Edinburgh EH11 2NJ',
      capacity: 250,
      currentOccupancy: 0,
    },
    isBlocked: false,
  },
  {
    id: 'edi-route-3',
    fromDescription: 'Shore / Leith Docks (flood-prone)',
    toDescription: 'Leith Community Centre',
    toType: 'shelter',
    distanceKm: 0.8,
    durationMinutes: 3,
    geometry: {
      type: 'LineString',
      coordinates: [
        [-3.1700, 55.9760], [-3.1720, 55.9740], [-3.1750, 55.9720],
        [-3.1770, 55.9700],
      ],
    },
    shelterInfo: {
      name: 'Leith Community Centre',
      address: '12A Newkirkgate, Edinburgh EH6 6AD',
      capacity: 180,
      currentOccupancy: 0,
    },
    isBlocked: false,
  },
  {
    id: 'edi-route-4',
    fromDescription: 'Inverleith / Botanical Gardens (flood-prone)',
    toDescription: 'Calton Hill (High Ground)',
    toType: 'high_ground',
    distanceKm: 2.0,
    durationMinutes: 7,
    geometry: {
      type: 'LineString',
      coordinates: [
        [-3.2100, 55.9650], [-3.2050, 55.9640], [-3.2000, 55.9620],
        [-3.1950, 55.9600], [-3.1900, 55.9580], [-3.1850, 55.9565],
      ],
    },
    isBlocked: false,
  },
]

// Glasgow pre-calculated routes

const GLASGOW_ROUTES: EvacuationRoute[] = [
  {
    id: 'gla-route-1',
    fromDescription: 'Whiteinch / Clyde Tunnel (flood-prone)',
    toDescription: 'Scotstoun Community Centre',
    toType: 'shelter',
    distanceKm: 1.5,
    durationMinutes: 5,
    geometry: {
      type: 'LineString',
      coordinates: [
        [-4.3300, 55.8710], [-4.3260, 55.8700], [-4.3210, 55.8690],
        [-4.3160, 55.8675], [-4.3120, 55.8665],
      ],
    },
    shelterInfo: {
      name: 'Scotstoun Community Centre',
      address: '62 Balmoral Street, Glasgow G14 0BJ',
      capacity: 200,
      currentOccupancy: 0,
    },
    isBlocked: false,
  },
  {
    id: 'gla-route-2',
    fromDescription: 'Glasgow Green / Clyde Walkway (flood-prone)',
    toDescription: 'Calton Heritage Centre',
    toType: 'shelter',
    distanceKm: 0.9,
    durationMinutes: 3,
    geometry: {
      type: 'LineString',
      coordinates: [
        [-4.2300, 55.8490], [-4.2340, 55.8500], [-4.2380, 55.8510],
        [-4.2410, 55.8530],
      ],
    },
    shelterInfo: {
      name: 'Calton Heritage Centre',
      address: '100 London Road, Glasgow G1 5LA',
      capacity: 150,
      currentOccupancy: 0,
    },
    isBlocked: false,
  },
  {
    id: 'gla-route-3',
    fromDescription: 'Partick / Kelvin Confluence (flood-prone)',
    toDescription: 'University of Glasgow (High Ground)',
    toType: 'high_ground',
    distanceKm: 1.2,
    durationMinutes: 5,
    geometry: {
      type: 'LineString',
      coordinates: [
        [-4.3050, 55.8680], [-4.3010, 55.8700], [-4.2960, 55.8720],
        [-4.2920, 55.8740], [-4.2890, 55.8760],
      ],
    },
    isBlocked: false,
  },
  {
    id: 'gla-route-4',
    fromDescription: 'Govan Waterfront (flood-prone)',
    toDescription: 'Govan Community Hall',
    toType: 'shelter',
    distanceKm: 0.7,
    durationMinutes: 3,
    geometry: {
      type: 'LineString',
      coordinates: [
        [-4.3120, 55.8610], [-4.3080, 55.8620], [-4.3040, 55.8640],
        [-4.3010, 55.8650],
      ],
    },
    shelterInfo: {
      name: 'Govan Community Hall',
      address: 'Harmony Row, Glasgow G51 3BA',
      capacity: 160,
      currentOccupancy: 0,
    },
    isBlocked: false,
  },
]

// Dundee pre-calculated routes

const DUNDEE_ROUTES: EvacuationRoute[] = [
  {
    id: 'dun-route-1',
    fromDescription: 'Broughty Ferry Seafront (flood-prone)',
    toDescription: 'Broughty Ferry Community Library',
    toType: 'shelter',
    distanceKm: 0.6,
    durationMinutes: 2,
    geometry: {
      type: 'LineString',
      coordinates: [
        [-2.8700, 56.4640], [-2.8730, 56.4630], [-2.8760, 56.4620],
        [-2.8780, 56.4610],
      ],
    },
    shelterInfo: {
      name: 'Broughty Ferry Library',
      address: 'Queen Street, Broughty Ferry DD5 2HN',
      capacity: 100,
      currentOccupancy: 0,
    },
    isBlocked: false,
  },
  {
    id: 'dun-route-2',
    fromDescription: 'Dundee Waterfront / V&A Area (flood-prone)',
    toDescription: 'Caird Hall Emergency Centre',
    toType: 'shelter',
    distanceKm: 0.5,
    durationMinutes: 2,
    geometry: {
      type: 'LineString',
      coordinates: [
        [-2.9660, 56.4570], [-2.9680, 56.4580], [-2.9710, 56.4590],
        [-2.9730, 56.4600],
      ],
    },
    shelterInfo: {
      name: 'Caird Hall Conference Centre',
      address: 'City Square, Dundee DD1 3BB',
      capacity: 500,
      currentOccupancy: 0,
    },
    isBlocked: false,
  },
  {
    id: 'dun-route-3',
    fromDescription: 'Riverside / Tay River Edge (flood-prone)',
    toDescription: 'Dundee Law (High Ground)',
    toType: 'high_ground',
    distanceKm: 1.8,
    durationMinutes: 8,
    geometry: {
      type: 'LineString',
      coordinates: [
        [-2.9750, 56.4580], [-2.9770, 56.4600], [-2.9790, 56.4620],
        [-2.9810, 56.4640], [-2.9830, 56.4660], [-2.9850, 56.4680],
      ],
    },
    isBlocked: false,
  },
  {
    id: 'dun-route-4',
    fromDescription: 'Stannergate Coast (flood-prone)',
    toDescription: 'Eastern Primary Community Hall',
    toType: 'shelter',
    distanceKm: 1.0,
    durationMinutes: 4,
    geometry: {
      type: 'LineString',
      coordinates: [
        [-2.9300, 56.4590], [-2.9340, 56.4600], [-2.9380, 56.4610],
        [-2.9420, 56.4620],
      ],
    },
    shelterInfo: {
      name: 'Eastern Primary Community Hall',
      address: 'Arbroath Road, Dundee DD4',
      capacity: 120,
      currentOccupancy: 0,
    },
    isBlocked: false,
  },
]
