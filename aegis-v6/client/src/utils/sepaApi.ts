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
  lastUpdated: string; source: 'sepa' | 'ea'
}

export interface RiverHistory {
  time: string; level: number
}

const SEPA_API = 'https://timeseries.sepa.org.uk/KiWIS/KiWIS'

const LOCATION_CENTERS: Record<string, { lat: number; lng: number; region?: string }> = {
  // Scotland
  aberdeen: { lat: 57.1497, lng: -2.0943, region: 'scotland' },
  edinburgh: { lat: 55.9533, lng: -3.1883, region: 'scotland' },
  glasgow: { lat: 55.8642, lng: -4.2518, region: 'scotland' },
  dundee: { lat: 56.4620, lng: -2.9707, region: 'scotland' },
  scotland: { lat: 56.4900, lng: -4.2000, region: 'scotland' },
  // England
  london: { lat: 51.5074, lng: -0.1278, region: 'england' },
  manchester: { lat: 53.4808, lng: -2.2426, region: 'england' },
  birmingham: { lat: 52.4862, lng: -1.8904, region: 'england' },
  leeds: { lat: 53.8008, lng: -1.5491, region: 'england' },
  liverpool: { lat: 53.4084, lng: -2.9916, region: 'england' },
  bristol: { lat: 51.4545, lng: -2.5879, region: 'england' },
  sheffield: { lat: 53.3811, lng: -1.4701, region: 'england' },
  newcastle: { lat: 54.9783, lng: -1.6174, region: 'england' },
  nottingham: { lat: 52.9548, lng: -1.1581, region: 'england' },
  york: { lat: 53.9591, lng: -1.0815, region: 'england' },
  oxford: { lat: 51.7520, lng: -1.2577, region: 'england' },
  cambridge: { lat: 52.2053, lng: 0.1218, region: 'england' },
  bath: { lat: 51.3811, lng: -2.3590, region: 'england' },
  exeter: { lat: 50.7184, lng: -3.5339, region: 'england' },
  england: { lat: 52.8, lng: -1.5, region: 'england' },
  uk: { lat: 53.0, lng: -1.5, region: 'england' },
  // Wales
  cardiff: { lat: 51.4816, lng: -3.1791, region: 'england' },
  swansea: { lat: 51.6214, lng: -3.9436, region: 'england' },
  wales: { lat: 52.1307, lng: -3.7837, region: 'england' },
  // Northern Ireland
  belfast: { lat: 54.5973, lng: -5.9301, region: 'england' },
  northern_ireland: { lat: 54.6, lng: -6.7, region: 'england' },
}

/* Determine which API region to use based on coordinates */
function detectRegion(lat: number): string {
  // Simple heuristic: Scotland is roughly lat > 55.3
  return lat > 55.3 ? 'scotland' : 'england'
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
      { id: '37930', name: 'Garthdee', river: 'River Dee' },
      { id: '37328', name: 'Haughton', river: 'River Don' },
      { id: '37448', name: 'Park', river: 'River Dee' },
      { id: '37452', name: 'Parkhill', river: 'River Don' },
      { id: '37282', name: 'Ellon', river: 'River Ythan' },
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
  const normalizedKey = locationKey.toLowerCase().replace(/[\s-]+/g, '_')
  const locEntry = LOCATION_CENTERS[normalizedKey]
  const selectedCenter = userLat != null && userLng != null
    ? { lat: userLat, lng: userLng }
    : locEntry
      ? { lat: locEntry.lat, lng: locEntry.lng }
      : null

  if (!selectedCenter) {
    throw new Error(`No river monitoring data available for "${locationKey}". Try selecting a UK location.`)
  }

  const region = userLat != null ? detectRegion(userLat) : (locEntry?.region || detectRegion(selectedCenter.lat))

  // For Scottish locations, try SEPA KiWIS first (it's the authoritative source)
  if (region === 'scotland') {
    const sepaFirst = await trySepaKiWIS(selectedCenter.lat, selectedCenter.lng, locationKey)
    if (sepaFirst.length > 0) return sepaFirst
  }

  // Step 1 — try UK EA / backend proxy API
  const eaResults: RiverGauge[] = []
  try {
    const stationsRes = await fetch(`/api/flood-data/stations?region=${region}&lat=${selectedCenter.lat}&lng=${selectedCenter.lng}&dist=80`)
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

        const readingsRes = await fetch(`/api/flood-data/stations/${encodeURIComponent(stationId)}/readings?hours=24&region=${region}`)
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
          source: 'ea',
        })
      }
    }
  } catch {
    // EA API unavailable — proceed to SEPA KiWIS fallback
  }

  if (eaResults.length > 0) return eaResults

  // Step 2 — final SEPA fallback (if Scotland SEPA-first also failed above, try again with EA-only path exhausted)
  if (region === 'scotland') {
    const sepaRetry = await trySepaKiWIS(selectedCenter.lat, selectedCenter.lng, locationKey)
    if (sepaRetry.length > 0) return sepaRetry
  }

  throw new Error('No live gauge data available — check your connection.')
}

/* Try SEPA KiWIS API for Scottish stations */
async function trySepaKiWIS(lat: number, lng: number, locationKey: string): Promise<RiverGauge[]> {
  const results: RiverGauge[] = []
  try {
    const stationListUrl = `${SEPA_API}?service=kisters&type=queryServices&datasource=0&request=getStationList&returnfields=station_id,station_name,station_latitude,station_longitude,river_name&format=json`
    const stationRes = await fetch(stationListUrl)
    if (!stationRes.ok) return results
    const stationData = await stationRes.json()
    // SEPA KiWIS returns arrays: first row is header, rest are [station_id, station_name, lat, lng, river_name?]
    const rawRows: any[] = Array.isArray(stationData) ? stationData.slice(1) : []
    // Normalise rows to objects — rows may be plain arrays or { value: [...] } wrappers
    const rows = rawRows.map((row: any) => {
      const arr = Array.isArray(row) ? row : (Array.isArray(row?.value) ? row.value : null)
      if (!arr || arr.length < 4) return null
      return { station_id: String(arr[0]), station_name: String(arr[1]), station_latitude: String(arr[2]), station_longitude: String(arr[3]), river_name: arr.length > 4 ? String(arr[4] || '') : '' }
    }).filter(Boolean) as { station_id: string; station_name: string; station_latitude: string; station_longitude: string; river_name: string }[]

    const nearbyStations = rows
      .filter(row => {
        const sLat = parseFloat(row.station_latitude)
        const sLng = parseFloat(row.station_longitude)
        if (!Number.isFinite(sLat) || !Number.isFinite(sLng)) return false
        return distanceKm(lat, lng, sLat, sLng) < 60
      })
      .sort((a, b) => {
        const dA = distanceKm(lat, lng, parseFloat(a.station_latitude), parseFloat(a.station_longitude))
        const dB = distanceKm(lat, lng, parseFloat(b.station_latitude), parseFloat(b.station_longitude))
        return dA - dB
      })
      .slice(0, 5)

    for (const station of nearbyStations) {
      try {
        const tsUrl = `${SEPA_API}?service=kisters&type=queryServices&datasource=0&request=getTimeseriesList&station_id=${station.station_id}&parametertype_name=S&returnfields=ts_id,ts_name&format=json`
        const tsRes = await fetch(tsUrl)
        if (!tsRes.ok) continue
        const tsData = await tsRes.json()
        // Same array format: skip header, find the 15minute timeseries
        const tsRawRows: any[] = Array.isArray(tsData) ? tsData.slice(1) : []
        const tsRows = tsRawRows.map((r: any) => {
          const arr = Array.isArray(r) ? r : (Array.isArray(r?.value) ? r.value : null)
          if (!arr || arr.length < 2) return null
          return { ts_id: String(arr[0]), ts_name: String(arr[1]) }
        }).filter(Boolean) as { ts_id: string; ts_name: string }[]
        // Prefer the "15minute" timeseries for live data, fall back to first available
        const liveTs = tsRows.find(ts => ts.ts_name.includes('15min') || ts.ts_name.includes('15Min')) || tsRows[0]
        if (!liveTs?.ts_id) continue

        const valUrl = `${SEPA_API}?service=kisters&type=queryServices&datasource=0&request=getTimeseriesValues&ts_id=${liveTs.ts_id}&period=P1D&returnfields=Timestamp,Value&format=json`
        const valRes = await fetch(valUrl)
        if (!valRes.ok) continue
        const valData = await valRes.json()
        const values = valData?.[0]?.data || []
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
        // Resolve river name from SEPA data, then KNOWN_GAUGES fallback
        const allKnown = Object.values(KNOWN_GAUGES).flatMap(loc => loc.stations)
        const knownByName = allKnown.find(s => station.station_name.toLowerCase().includes(s.name.toLowerCase().slice(0, 5)))
        const riverName = station.river_name || knownByName?.river || ''
        results.push({
          id: station.station_id,
          name: station.station_name || 'SEPA Station',
          river: riverName,
          location: locationKey, level, levelTrend: trend,
          normalLevel, warningLevel, alertLevel,
          status: level > alertLevel ? 'alert' : level > warningLevel ? 'warning' : level > normalLevel * 1.1 ? 'rising' : 'normal',
          lastUpdated: latest[0], source: 'sepa',
        })
      } catch { /* skip station */ }
    }
  } catch { /* SEPA unavailable */ }
  return results
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
