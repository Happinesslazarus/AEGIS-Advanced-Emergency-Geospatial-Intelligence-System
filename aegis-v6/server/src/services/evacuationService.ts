/**
 * services/evacuationService.ts — Evacuation route calculator
 *
 * Calculates safe routes from a starting point to shelters or high ground,
 * avoiding active flood zones. Uses OpenRouteService API when configured,
 * with pre-calculated fallback routes for Aberdeen.
 */

import { getActiveCityRegion } from '../config/regions/index.js'
import pool from '../models/db.js'
import fs from 'fs'
import path from 'path'
import { IncidentIntelligenceCore } from './incidentIntelligenceCore.js'

const intelligenceCore = new IncidentIntelligenceCore(getActiveCityRegion())

// ═══════════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════════

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
}

export interface EvacuationResult {
  routes: EvacuationRoute[]
  nearestShelter: EvacuationRoute | null
  calculatedAt: string
  usingFallback: boolean
}

// ═══════════════════════════════════════════════════════════════════════════════
// Pre-calculated Routes (fallback) — Aberdeen, Edinburgh, Glasgow, Dundee
// ═══════════════════════════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════════════════════════
// Core Functions
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Calculate evacuation routes from a starting point.
 * Uses OpenRouteService if API key present, otherwise pre-calculated routes.
 */
export async function calculateEvacuationRoutes(
  startLat: number,
  startLng: number,
  floodExtentGeoJSON?: any,
  destinationType: 'shelter' | 'high_ground' | 'both' = 'both',
): Promise<EvacuationResult> {
  const orsKey = process.env.ORS_API_KEY

  if (orsKey) {
    try {
      return await calculateWithORS(startLat, startLng, floodExtentGeoJSON, destinationType, orsKey)
    } catch (err: any) {
      console.warn(`[Evacuation] ORS failed, using fallback: ${err.message}`)
    }
  }

  // Fallback to pre-calculated routes
  return getFallbackRoutes(startLat, startLng, destinationType)
}

async function calculateWithORS(
  startLat: number,
  startLng: number,
  floodExtentGeoJSON: any,
  destinationType: string,
  apiKey: string,
): Promise<EvacuationResult> {
  const dynamicHazardAvoidance = await buildDynamicAvoidPolygons(startLat, startLng)

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
    const avoidPolygons = dynamicHazardAvoidance || floodExtentGeoJSON
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

  return {
    routes,
    nearestShelter: routes[0] || null,
    calculatedAt: new Date().toISOString(),
    usingFallback: false,
  }
}

async function buildDynamicAvoidPolygons(lat: number, lng: number): Promise<any | null> {
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

    if (!rows.length) return null

    const evidence = intelligenceCore.buildEvidenceEvents(
      rows.map((r: any, idx: number) => ({
        id: `route-risk-${idx}`,
        signal_type: 'route_hazard',
        created_at: new Date().toISOString(),
        ai_confidence: Number(r.ai_confidence || 50),
        severity: r.severity,
        lat: Number(r.lat),
        lng: Number(r.lng),
      })),
    )

    return intelligenceCore.buildRouteRiskMask(evidence, {
      maxDistanceMeters: 10000,
      maxEvents: 20,
      lookbackHours: 4,
    })
  } catch {
    return null
  }
}

function getFallbackRoutes(
  _startLat: number,
  _startLng: number,
  destinationType: string,
): EvacuationResult {
  let routes = [...ABERDEEN_ROUTES]

  if (destinationType === 'shelter') {
    routes = routes.filter(r => r.toType === 'shelter')
  } else if (destinationType === 'high_ground') {
    routes = routes.filter(r => r.toType === 'high_ground')
  }

  return {
    routes,
    nearestShelter: routes.find(r => r.toType === 'shelter') || null,
    calculatedAt: new Date().toISOString(),
    usingFallback: true,
  }
}

/**
 * Get all pre-calculated evacuation routes for the active region.
 */
export function getPreCalculatedRoutes(): EvacuationRoute[] {
  return [...ABERDEEN_ROUTES, ...EDINBURGH_ROUTES, ...GLASGOW_ROUTES, ...DUNDEE_ROUTES]
}

// ═══════════════════════════════════════════════════════════════════════════════
// Edinburgh pre-calculated routes
// ═══════════════════════════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════════════════════════
// Glasgow pre-calculated routes
// ═══════════════════════════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════════════════════════
// Dundee pre-calculated routes
// ═══════════════════════════════════════════════════════════════════════════════

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
