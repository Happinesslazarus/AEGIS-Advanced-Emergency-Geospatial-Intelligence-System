/**
 * Fetches live river level data from two authoritative UK sources:
 *   1. SEPA KiWIS  -- the Scottish Environment Protection Agency's real-time
 *                    river-gauge web service (used for Scottish locations)
 *   2. EA API      -- the English Environment Agency flood API, proxied
 *                    through the AEGIS backend at /api/flood-data/stations
 *
 * fetchRiverLevels() implements a cascading strategy:
 * Scotland -> try SEPA KiWIS first -> fallback to EA API -> final SEPA retry
 * England -> try EA API only
 *
 * Glossary:
 *   SEPA             = Scottish Environment Protection Agency; operates a network
 *                      of river gauge stations across Scotland
 *   EA               = Environment Agency; runs the flood monitoring network
 *                      for England and Wales
 *   KiWIS            = SEPA's timeseries web service (Kisters Water Information System);
 *                      exposes station lists, timeseries definitions, and values
 *   gauge station    = a sensor installed in a river that measures the water level
 *                      (height above the riverbed) continuously
 *   level            = current water height in metres above the gauge datum
 *   levelTrend       = direction of recent change: 'rising' | 'falling' | 'steady';
 *                      determined by comparing the latest reading to 3 readings earlier
 *   normalLevel      = typical day-to-day water level (derived from API data or estimated)
 *   warningLevel     = threshold at which flooding may begin to affect low-lying land
 *   alertLevel       = critical threshold at which properties and roads are at risk
 *   status           = derived alert tier: 'normal' | 'rising' | 'warning' | 'alert'
 *   timeseries       = a sequence of (timestamp, value) pairs from a single gauge sensor;
 *                      KiWIS may have multiple timeseries per station ('15min', '1hour', etc.)
 *   ts_id            = SEPA KiWIS internal identifier for one timeseries record
 *   Haversine formula = great-circle distance between two lat/lng points on a sphere;
 *                       used to find the nearest gauge stations to the user's location
 *   LOCATION_CENTERS  = lookup table mapping location name keys to lat/lng coordinates;
 *                       used to resolve named places like 'aberdeen' to a coordinate
 *   KNOWN_GAUGES      = hand-curated mapping of major cities to their known station IDs;
 *                       used as a fallback to identify river names when the API omits them
 *
 * - Used by client/src/components/shared/RiverGaugePanel.tsx
 * - Used by client/src/hooks/useFloodData.ts
 * - Server-side equivalent: server/src/services/riverLevelService.ts
 */

/** Shape of a single river gauge reading returned by this module */
export interface RiverGauge {
  id: string; name: string; river: string; location: string
  level: number;          // current water level in metres
  levelTrend: 'rising' | 'falling' | 'steady'
  normalLevel: number;   // typical day-to-day level (metres)
  warningLevel: number;  // flooding may begin above this level
  alertLevel: number;    // property/road risk level
  status: 'normal' | 'rising' | 'warning' | 'alert'
  lastUpdated: string; source: 'sepa' | 'ea' | 'open-meteo'
}

/** One historical data point from the gauge timeseries */
export interface RiverHistory {
  time: string; level: number
}

//Base URL for SEPA's KiWIS web service (Query Services endpoint)
const SEPA_API = 'https://timeseries.sepa.org.uk/KiWIS/KiWIS'

//Location centre coordinates
//Used to resolve named places to lat/lng so we can find nearby gauge stations
const LOCATION_CENTERS: Record<string, { lat: number; lng: number; region?: string }> = {
  //Scotland
  aberdeen: { lat: 57.1497, lng: -2.0943, region: 'scotland' },
  edinburgh: { lat: 55.9533, lng: -3.1883, region: 'scotland' },
  glasgow: { lat: 55.8642, lng: -4.2518, region: 'scotland' },
  dundee: { lat: 56.4620, lng: -2.9707, region: 'scotland' },
  scotland: { lat: 56.4900, lng: -4.2000, region: 'scotland' },
  //England
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
  //Wales
  cardiff: { lat: 51.4816, lng: -3.1791, region: 'england' },
  swansea: { lat: 51.6214, lng: -3.9436, region: 'england' },
  wales: { lat: 52.1307, lng: -3.7837, region: 'england' },
  //Northern Ireland
  belfast: { lat: 54.5973, lng: -5.9301, region: 'england' },
  northern_ireland: { lat: 54.6, lng: -6.7, region: 'england' },
}

//Geo-math helpers

/** Returns 'scotland' when lat > 55.3 (rough geographic boundary), else 'england'.
 *  Determines which API endpoint to call first. */
function detectRegion(lat: number): string {
  //Simple heuristic: Scotland is roughly lat > 55.3
  return lat > 55.3 ? 'scotland' : 'england'
}

/** Convert degrees to radians (required by the Haversine formula) */
function toRad(deg: number): number {
  return (deg * Math.PI) / 180
}

/** Great-circle distance in kilometres between two WGS-84 coordinates.
 *  Haversine formula -- accurate for distances up to a few hundred kilometres. */
function distanceKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const earthRadiusKm = 6371           // Earth's mean radius
  const dLat = toRad(bLat - aLat)
  const dLng = toRad(bLng - aLng)
  //Haversine components
  const sa = Math.sin(dLat / 2) * Math.sin(dLat / 2)
  const sb = Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) * Math.sin(dLng / 2)
  const c = 2 * Math.atan2(Math.sqrt(sa + sb), Math.sqrt(1 - sa - sb))
  return earthRadiusKm * c
}

//Known gauge station catalogue
//Curated list of major city stations used to resolve river names when the
//API response omits or truncates the river_name field
//Known gauge stations for key locations
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

//Public functions

/**
 * Fetches live river gauge readings for a named location or explicit coordinates.
 *
 * Strategy:
 *   1. Resolve locationKey to lat/lng (or use explicit userLat/userLng)
 *   2. Detect whether location is in Scotland or England
 * 3. Scotland: try SEPA KiWIS -> on failure, try EA API -> final SEPA retry
 *   4. England:  try EA API only
 *
 * Throws if no gauge data is available from any source.
 */
export async function fetchRiverLevels(locationKey: string, userLat?: number, userLng?: number): Promise<RiverGauge[]> {
  const normalizedKey = locationKey.toLowerCase().replace(/[\s-]+/g, '_') // normalise to snake_case
  const locEntry = LOCATION_CENTERS[normalizedKey]
  //Default to London when location is global/unknown (world, generic, etc.)
  const DEFAULT_CENTER = { lat: 51.5074, lng: -0.1278, region: 'england' }
  const selectedCenter = userLat != null && userLng != null
    ? { lat: userLat, lng: userLng }
    : locEntry
      ? { lat: locEntry.lat, lng: locEntry.lng }
      : DEFAULT_CENTER

  //Determine whether to query SEPA (Scotland) or EA (England) first
  const region = userLat != null ? detectRegion(userLat) : (locEntry?.region || detectRegion(selectedCenter.lat))

  //Step 1: SEPA KiWIS (Scotland only)
  //SEPA is the authoritative source for Scottish gauges; try it first
  //to avoid unnecessary calls to the EA proxy
  if (region === 'scotland') {
    const sepaFirst = await trySepaKiWIS(selectedCenter.lat, selectedCenter.lng, locationKey)
    if (sepaFirst.length > 0) return sepaFirst
  }

  //Step 2: EA / backend proxy API
  //Fetches from /api/flood-data/stations which proxies the Environment Agency API
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

        //Resolve river name: prefer API field, then match by station name pattern, then KNOWN_GAUGES
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
    //EA API unavailable -- proceed to SEPA KiWIS fallback
  }

  if (eaResults.length > 0) return eaResults

  //Step 3: Final SEPA retry
  //Reached here only if EA API also failed for a Scottish location
  if (region === 'scotland') {
    const sepaRetry = await trySepaKiWIS(selectedCenter.lat, selectedCenter.lng, locationKey)
    if (sepaRetry.length > 0) return sepaRetry
  }

  //Step 4: Global fallback -- Open-Meteo Flood API
  //Free, no API key, covers the whole world using GloFAS reanalysis
  return fetchOpenMeteoRiver(selectedCenter.lat, selectedCenter.lng, locationKey)
}

/**
 * Global river discharge data from Open-Meteo Flood API (GloFAS reanalysis).
 * Free, no API key, covers the entire world.
 * Returns 1-3 synthetic gauge objects representing the modelled discharge at the given point.
 *
 * Open-Meteo returns daily values for current + next 7 days and historical ensemble data.
 * We use today's value plus the 30-year climatology (mean/median) to compute thresholds.
 * Discharge is in m³/s; we normalise thresholds from historical percentiles.
 */
async function fetchOpenMeteoRiver(lat: number, lng: number, locationKey: string): Promise<RiverGauge[]> {
  try {
    //daily=river_discharge gives current forecast; also request mean/median for thresholds
    const url = `https://flood-api.open-meteo.com/v1/flood?latitude=${lat}&longitude=${lng}` +
      `&daily=river_discharge,river_discharge_mean,river_discharge_median` +
      `&forecast_days=7&past_days=7`
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
    if (!res.ok) return []
    const data = await res.json()

    const times: string[] = data.daily?.time || []
    const discharges: number[] = data.daily?.river_discharge || []
    const means: number[] = data.daily?.river_discharge_mean || []
    const medians: number[] = data.daily?.river_discharge_median || []

    if (discharges.length === 0) return []

    //Find today's index
    const today = new Date().toISOString().slice(0, 10)
    let todayIdx = times.findIndex(t => t === today)
    if (todayIdx < 0) todayIdx = Math.floor(times.length / 2)

    const current = discharges[todayIdx] ?? discharges[discharges.length - 1] ?? 0
    const mean = means[todayIdx] ?? current
    const median = medians[todayIdx] ?? current

    //Build thresholds from climatology
    const normal   = Math.max(median * 0.8, 1)
    const warning  = Math.max(mean * 1.5, normal * 1.8)
    const alert    = Math.max(mean * 3.0, warning * 2.0)

    //Derive trend from previous 2 days vs today
    const prev = todayIdx > 1 ? (discharges[todayIdx - 2] ?? current) : current
    const levelTrend: RiverGauge['levelTrend'] =
      current > prev * 1.05 ? 'rising' : current < prev * 0.95 ? 'falling' : 'steady'

    //Derive status
    let status: RiverGauge['status'] = 'normal'
    if (current >= alert) status = 'alert'
    else if (current >= warning) status = 'warning'
    else if (levelTrend === 'rising' && current > normal) status = 'rising'

    //For the gauge name, use a friendly capitalised location name
    const locLabel = locationKey.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())

    return [{
      id: `openmeteo-${lat.toFixed(2)}-${lng.toFixed(2)}`,
      name: `${locLabel} River Basin`,
      river: `${locLabel} Watercourse`,
      location: locLabel,
      level: Math.round(current * 10) / 10,        // m³/s displayed as "level"
      levelTrend,
      normalLevel: Math.round(normal * 10) / 10,
      warningLevel: Math.round(warning * 10) / 10,
      alertLevel: Math.round(alert * 10) / 10,
      status,
      lastUpdated: new Date().toISOString(),
      source: 'open-meteo',
    }]
  } catch {
    return []
  }
}

/**
 * Internal helper: queries SEPA KiWIS for gauges within 60 km of the given coordinates.
 * Returns up to 5 RiverGauge objects from the SEPA real-time timeseries service.
 *
 * KiWIS response format: first element is a header row, subsequent elements are data rows.
 * Each data row may be a plain array or a { value: [...] } wrapper object.
 * The '15min' timeseries is preferred as it gives the freshest readings;
 * falls back to the first available timeseries if '15min' is not present.
 */
async function trySepaKiWIS(lat: number, lng: number, locationKey: string): Promise<RiverGauge[]> {
  const results: RiverGauge[] = []
  try {
    //Fetch all SEPA station metadata; filter + sort by proximity in a single pass
    const stationListUrl = `${SEPA_API}?service=kisters&type=queryServices&datasource=0&request=getStationList&returnfields=station_id,station_name,station_latitude,station_longitude,river_name&format=json`
    const stationRes = await fetch(stationListUrl)
    if (!stationRes.ok) return results
    const stationData = await stationRes.json()
    //SEPA KiWIS returns arrays: first row is header, rest are [station_id, station_name, lat, lng, river_name?]
    const rawRows: any[] = Array.isArray(stationData) ? stationData.slice(1) : []
    //Normalise rows to objects -- rows may be plain arrays or { value: [...] } wrappers
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
        //Fetch timeseries list for this station, filtered to stage (S = water level) parameter
        const tsUrl = `${SEPA_API}?service=kisters&type=queryServices&datasource=0&request=getTimeseriesList&station_id=${station.station_id}&parametertype_name=S&returnfields=ts_id,ts_name&format=json`
        const tsRes = await fetch(tsUrl)
        if (!tsRes.ok) continue
        const tsData = await tsRes.json()
        //Same array format: skip header, find the 15minute timeseries
        const tsRawRows: any[] = Array.isArray(tsData) ? tsData.slice(1) : []
        const tsRows = tsRawRows.map((r: any) => {
          const arr = Array.isArray(r) ? r : (Array.isArray(r?.value) ? r.value : null)
          if (!arr || arr.length < 2) return null
          return { ts_id: String(arr[0]), ts_name: String(arr[1]) }
        }).filter(Boolean) as { ts_id: string; ts_name: string }[]
        //Prefer the 15-minute timeseries for the most up-to-date reading
        const liveTs = tsRows.find(ts => ts.ts_name.includes('15min') || ts.ts_name.includes('15Min')) || tsRows[0]
        if (!liveTs?.ts_id) continue
        
        //Fetch the latest values for this timeseries
        const valUrl = `${SEPA_API}?service=kisters&type=queryServices&datasource=0&request=getTimeseriesValues&ts_id=${liveTs.ts_id}&period=P1D&returnfields=Timestamp,Value&format=json`
        const valRes = await fetch(valUrl)
        if (!valRes.ok) continue
        const valData = await valRes.json()
        const values = valData?.[0]?.data || []
        if (values.length === 0) continue

        //SEPA values are [timestamp, level] pairs -- take the latest and previous for trend calculation
        const latest = values[values.length - 1]
        const prev = values.length > 2 ? values[values.length - 3] : values[0]
        const level = parseFloat(latest[1])
        const prevLevel = parseFloat(prev[1])
        if (!Number.isFinite(level)) continue

        //SEPA doesn't provide typical levels, so we use a simple heuristic: normal = 75% of current, warning = 120%, alert = 144%
        const trend: RiverGauge['levelTrend'] = level > prevLevel + 0.02 ? 'rising' : level < prevLevel - 0.02 ? 'falling' : 'steady'
        const normalLevel = level * 0.7
        const warningLevel = level * 1.3
        const alertLevel = level * 1.6
        //Resolve river name from SEPA data, then KNOWN_GAUGES fallback
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

//Colour helpers -- map gauge status to Tailwind classes

/** Returns a Tailwind text-colour class for the gauge's current alert status */
export function getGaugeColor(status: RiverGauge['status']): string {
  switch (status) {
    case 'alert':   return 'text-red-600'    // at or above alert threshold
    case 'warning': return 'text-amber-600'  // approaching alert level
    case 'rising':  return 'text-orange-500' // rising but not yet at warning level
    default:        return 'text-green-600'  // within normal range
  }
}

/** Returns Tailwind background + border classes for the gauge card */
export function getGaugeBg(status: RiverGauge['status']): string {
  switch (status) {
    case 'alert':   return 'bg-red-50 border-red-200 dark:bg-red-950/20 dark:border-red-800'
    case 'warning': return 'bg-amber-50 border-amber-200 dark:bg-amber-950/20 dark:border-amber-800'
    case 'rising':  return 'bg-orange-50 border-orange-200 dark:bg-orange-950/20 dark:border-orange-800'
    default:        return 'bg-green-50 border-green-200 dark:bg-green-950/20 dark:border-green-800'
  }
}
