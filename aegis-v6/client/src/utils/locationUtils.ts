/**
 * Geolocation and coordinate helpers: get the user GPS position, calculate
 * distance between points (haversine), format coordinates for display, and
 * reverse-geocode a lat/lng to a place name.
 *
 * - Used by report forms to pre-fill the location field
 * - Used by client/src/hooks/useIncidentLocation.ts
 * - Used by SOS distress beacon (needs accurate coordinates)
 */

export interface Coordinates {
  lat: number
  lng: number
}

export interface ReverseGeocodeResult {
  displayName: string
  city?: string
  region?: string
  country?: string
  countryCode?: string
}

const GEOCODE_HEADERS = {
  'Accept-Language': typeof navigator !== 'undefined' ? (navigator.language || 'en') : 'en',
}

async function fetchJsonFromUrls(urls: string[], init?: RequestInit): Promise<any | null> {
  for (const url of urls) {
    try {
      const res = await fetch(url, init)
      if (!res.ok) continue
      return await res.json()
    } catch {
      //try next provider
    }
  }
  return null
}

//haversineKm: calculates the straight-line distance (in km) between two
//GPS coordinates using the Haversine formula.
//Haversine accounts for the curvature of the Earth (a straight Pythagorean
//calculation would give wrong results over large distances).
//Accuracy is ~0.5% for distances < 10 000 km, well within our use case.
export function haversineKm(a: Coordinates, b: Coordinates): number {
  const earthRadiusKm = 6371
  //Convert degree differences to radians (Math functions use radians, not degrees).
  const dLat = (b.lat - a.lat) * (Math.PI / 180)
  const dLng = (b.lng - a.lng) * (Math.PI / 180)
  const lat1 = a.lat * (Math.PI / 180)
  const lat2 = b.lat * (Math.PI / 180)
  //Haversine intermediate value (q = sin²(Δlat/2) + cos(lat1)-cos(lat2)-sin²(Δlng/2))
  const q = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  //atan2(sqrt(q), sqrt(1-q)) = central angle in radians; multiply by radius for km.
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(q), Math.sqrt(1 - q))
}

export function getDeviceLocation(options: PositionOptions = { enableHighAccuracy: true, timeout: 10000, maximumAge: 180000 }): Promise<Coordinates> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      reject(new Error('geolocation_unavailable'))
      return
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        })
      },
      (error) => {
        reject(error)
      },
      options,
    )
  })
}

//reverseGeocode: converts raw GPS coordinates into a human-readable place name.
//Uses Nominatim (OpenStreetMap's free geocoding service) -- no API key required,
//but subject to usage limits (max 1 req/sec per IP; suitable for user-triggered calls).
export async function reverseGeocode(coords: Coordinates, zoom = 12): Promise<ReverseGeocodeResult> {
  try {
    //Try OpenStreetMap first, then a secondary reverse-geocoding provider.
    const nominatimUrl = `https://nominatim.openstreetmap.org/reverse?lat=${coords.lat}&lon=${coords.lng}&format=json&zoom=${zoom}&addressdetails=1`
    const bigDataCloudUrl = `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${coords.lat}&longitude=${coords.lng}&localityLanguage=en`
    const data = await fetchJsonFromUrls(
      [nominatimUrl, bigDataCloudUrl],
      { headers: GEOCODE_HEADERS },
    )
    if (!data) return { displayName: `${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)}` }

    const address = data?.address || {}
    //Pick the most specific place name available (city > town > village > hamlet).
    const city = address.city || address.town || address.village || address.hamlet || data.city || data.locality
    const region = address.state || address.county || address.region || data.principalSubdivision
    const country = address.country || data.countryName
    //country_code comes back as lowercase ISO 3166-1 alpha-2 (e.g. 'gb');
    //convert to uppercase for display (e.g. 'GB').
    const countryCodeRaw = address.country_code || data.countryCode
    const countryCode = typeof countryCodeRaw === 'string' ? countryCodeRaw.toUpperCase() : undefined
    const displayName = city || region || country || data?.display_name?.split(',')?.slice(0, 2)?.join(', ') || `${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)}`

    return { displayName, city, region, country, countryCode }
  } catch {
    return { displayName: `${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)}` }
  }
}

export interface ForwardGeocodeResult extends Coordinates {
  label: string
  boundingbox?: [number, number, number, number]  // [south, north, west, east]
  isArea?: boolean  // true for country/state/region-level results
}

export async function forwardGeocode(query: string): Promise<ForwardGeocodeResult | null> {
  const input = query.trim()
  if (!input) return null

  try {
    //Primary provider: Nominatim (OpenStreetMap). Secondary: Open-Meteo geocoder.
    const nominatimUrl = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(input)}&format=json&addressdetails=1&limit=1`
    const rows = await fetchJsonFromUrls([nominatimUrl], { headers: GEOCODE_HEADERS })
    if (Array.isArray(rows) && rows.length > 0) {
      const row = rows[0]

      //Detect area-level results (countries, states, regions)
      const areaTypes = ['country', 'state', 'region', 'county', 'city', 'town', 'administrative']
      const isArea = row.class === 'boundary' || (row.class === 'place' && areaTypes.includes(row.type))

      let boundingbox: [number, number, number, number] | undefined
      if (Array.isArray(row.boundingbox) && row.boundingbox.length === 4) {
        boundingbox = [
          Number(row.boundingbox[0]),  // south
          Number(row.boundingbox[1]),  // north
          Number(row.boundingbox[2]),  // west
          Number(row.boundingbox[3]),  // east
        ]
      }

      return {
        lat: Number(row.lat),
        lng: Number(row.lon),
        label: String(row.display_name || input).split(',').slice(0, 2).join(', '),
        boundingbox,
        isArea,
      }
    }

    const openMeteoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(input)}&count=1&language=en&format=json`
    const openMeteo = await fetchJsonFromUrls([openMeteoUrl])
    const result = Array.isArray(openMeteo?.results) ? openMeteo.results[0] : null
    if (!result) return null

    return {
      lat: Number(result.latitude),
      lng: Number(result.longitude),
      label: [result.name, result.admin1, result.country].filter(Boolean).slice(0, 2).join(', ') || input,
      isArea: false,
    }
  } catch {
    return null
  }
}
