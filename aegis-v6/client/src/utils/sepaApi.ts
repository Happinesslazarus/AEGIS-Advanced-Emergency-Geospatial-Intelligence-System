/**
 * SEPA River Level API integration
 * Public API - no key required
 * https://timeseries.sepa.org.uk/KiWIS/KiWIS?
 */

export interface RiverGauge {
  id: string; name: string; river: string; location: string
  level: number; levelTrend: 'rising' | 'falling' | 'steady'
  normalLevel: number; warningLevel: number; alertLevel: number
  status: 'normal' | 'rising' | 'warning' | 'alert'
  lastUpdated: string; source: 'live'
}

export interface RiverHistory {
  time: string; level: number
}

const SEPA_API = 'https://timeseries.sepa.org.uk/KiWIS/KiWIS'

const LOCATION_CENTERS: Record<string, { lat: number; lng: number }> = {
  aberdeen: { lat: 57.1497, lng: -2.0943 },
  edinburgh: { lat: 55.9533, lng: -3.1883 },
  glasgow: { lat: 55.8642, lng: -4.2518 },
  dundee: { lat: 56.4620, lng: -2.9707 },
  scotland: { lat: 56.4900, lng: -4.2000 },
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180
}

function distanceKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const earthRadiusKm = 6371
  const dLat = toRad(bLat - aLat)
  const dLng = toRad(bLng - aLng)
  const sa = Math.sin(dLat / 2) * Math.sin(dLat / 2)
  const sb = Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) * Math.sin(dLng / 2)
  const c = 2 * Math.atan2(Math.sqrt(sa + sb), Math.sqrt(1 - sa - sb))
  return earthRadiusKm * c
}

// Known gauge stations for key locations
const KNOWN_GAUGES: Record<string, { stations: { id: string; name: string; river: string }[] }> = {
  aberdeen: {
    stations: [
      { id: '234234', name: 'Park Bridge', river: 'River Don' },
      { id: '234078', name: 'Cults', river: 'River Dee' },
      { id: '234250', name: 'Haughton', river: 'River Don' },
    ]
  },
  edinburgh: {
    stations: [
      { id: '234501', name: 'Murrayfield', river: 'Water of Leith' },
      { id: '234502', name: 'Musselburgh', river: 'River Esk' },
    ]
  },
  glasgow: {
    stations: [
      { id: '234601', name: 'Daldowie', river: 'River Clyde' },
      { id: '234602', name: 'Milngavie', river: 'River Kelvin' },
    ]
  },
  dundee: {
    stations: [
      { id: '234701', name: 'Ballathie', river: 'River Tay' },
    ]
  },
}

export async function fetchRiverLevels(locationKey: string, userLat?: number, userLng?: number): Promise<RiverGauge[]> {
  const selectedCenter = userLat != null && userLng != null
    ? { lat: userLat, lng: userLng }
    : (LOCATION_CENTERS[locationKey] || LOCATION_CENTERS.aberdeen)

  // Step 1 — try UK EA / backend proxy API
  const eaResults: RiverGauge[] = []
  try {
    const stationsRes = await fetch(`/api/flood-data/stations?region=scotland&lat=${selectedCenter.lat}&lng=${selectedCenter.lng}&dist=80`)
    if (stationsRes.ok) {
      const stationsData = await stationsRes.json()
      const stationFeatures: any[] = Array.isArray(stationsData?.features) ? stationsData.features : []

      const nearbyStations = stationFeatures
        .filter((f: any) => f?.geometry?.type === 'Point' && Array.isArray(f?.geometry?.coordinates))
        .map((f: any) => {
          const [lon, lat] = f.geometry.coordinates
          return {
            feature: f,
            distance: distanceKm(selectedCenter.lat, selectedCenter.lng, Number(lat), Number(lon)),
            stationId: String(f.properties?.station_id || ''),
          }
        })
        .filter(e => Number.isFinite(e.distance))
        .sort((a, b) => a.distance - b.distance)
        .slice(0, 4)

      const allKnownStations = Object.values(KNOWN_GAUGES).flatMap(loc => loc.stations)

      for (const entry of nearbyStations) {
        const props = entry.feature.properties || {}
        const stationId = String(props.station_id || '').trim()
        if (!stationId) continue

        const readingsRes = await fetch(`/api/flood-data/stations/${encodeURIComponent(stationId)}/readings?hours=24&region=scotland`)
        if (!readingsRes.ok) continue

        const readingsData = await readingsRes.json()
        const values = Array.isArray(readingsData?.readings) ? readingsData.readings : []
        if (values.length === 0) continue

        const latest = values[values.length - 1]
        const prev = values.length > 2 ? values[values.length - 3] : values[0]
        const level = Number(latest?.level_m)
        const prevLevel = Number(prev?.level_m)
        if (!Number.isFinite(level) || !Number.isFinite(prevLevel)) continue

        const trend: RiverGauge['levelTrend'] =
          level > prevLevel + 0.02 ? 'rising' :
          level < prevLevel - 0.02 ? 'falling' : 'steady'

        const typicalHigh = Number(props.typical_high_m)
        const warningLevel = Number.isFinite(typicalHigh) && typicalHigh > 0 ? typicalHigh : Math.max(level * 1.2, level + 0.2)
        const alertLevel = warningLevel * 1.2
        const normalLevel = warningLevel * 0.75
        const status: RiverGauge['status'] =
          level >= alertLevel ? 'alert' :
          level >= warningLevel ? 'warning' :
          trend === 'rising' ? 'rising' : 'normal'

        // Resolve river name: prefer API field, then match by station name pattern, then KNOWN_GAUGES
        const knownById = allKnownStations.find(s => s.id === stationId)
        const knownByName = allKnownStations.find(s =>
          props.station_name && s.name.toLowerCase().includes(props.station_name.toLowerCase().slice(0, 5))
        )
        const riverName = String(props.river_name || knownById?.river || knownByName?.river || '')

        eaResults.push({
          id: stationId,
          name: String(props.station_name || 'Station'),
          river: riverName,
          location: locationKey,
          level, levelTrend: trend, normalLevel, warningLevel, alertLevel, status,
          lastUpdated: String(latest?.timestamp || new Date().toISOString()),
          source: 'live',
        })
      }
    }
  } catch {
    // EA API unavailable — proceed to SEPA KiWIS fallback
  }

  if (eaResults.length > 0) return eaResults

  // Step 2 — SEPA KiWIS direct fallback (always has river names from KNOWN_GAUGES)
  const config = KNOWN_GAUGES[locationKey] || KNOWN_GAUGES.aberdeen
  const sepaResults: RiverGauge[] = []

  for (const station of config.stations) {
    try {
      const url = `${SEPA_API}?service=kisters&type=queryServices&datasource=0&request=getTimeseriesValues&ts_id=${station.id}&period=P1D&returnfields=Timestamp,Value&format=json`
      const res = await fetch(url)
      if (!res.ok) continue
      const data = await res.json()
      const values = data?.[0]?.data || []
      if (values.length === 0) continue
      const latest = values[values.length - 1]
      const prev = values.length > 2 ? values[values.length - 3] : values[0]
      const level = parseFloat(latest[1])
      const prevLevel = parseFloat(prev[1])
      if (!Number.isFinite(level)) continue
      const trend: RiverGauge['levelTrend'] = level > prevLevel + 0.02 ? 'rising' : level < prevLevel - 0.02 ? 'falling' : 'steady'
      const normalLevel = level * 0.7
      const warningLevel = level * 1.3
      const alertLevel = level * 1.6
      sepaResults.push({
        id: station.id, name: station.name, river: station.river,
        location: locationKey, level, levelTrend: trend,
        normalLevel, warningLevel, alertLevel,
        status: level > alertLevel ? 'alert' : level > warningLevel ? 'warning' : level > normalLevel * 1.1 ? 'rising' : 'normal',
        lastUpdated: latest[0], source: 'live'
      })
    } catch {
      // skip this station
    }
  }

  if (sepaResults.length > 0) return sepaResults

  throw new Error('No live gauge data available — check your connection.')
}

export function getGaugeColor(status: RiverGauge['status']): string {
  switch (status) {
    case 'alert': return 'text-red-600'
    case 'warning': return 'text-amber-600'
    case 'rising': return 'text-orange-500'
    default: return 'text-green-600'
  }
}

export function getGaugeBg(status: RiverGauge['status']): string {
  switch (status) {
    case 'alert': return 'bg-red-50 border-red-200 dark:bg-red-950/20 dark:border-red-800'
    case 'warning': return 'bg-amber-50 border-amber-200 dark:bg-amber-950/20 dark:border-amber-800'
    case 'rising': return 'bg-orange-50 border-orange-200 dark:bg-orange-950/20 dark:border-orange-800'
    default: return 'bg-green-50 border-green-200 dark:bg-green-950/20 dark:border-green-800'
  }
}
