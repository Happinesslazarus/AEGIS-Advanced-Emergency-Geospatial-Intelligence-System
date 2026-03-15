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

export function haversineKm(a: Coordinates, b: Coordinates): number {
  const earthRadiusKm = 6371
  const dLat = (b.lat - a.lat) * (Math.PI / 180)
  const dLng = (b.lng - a.lng) * (Math.PI / 180)
  const lat1 = a.lat * (Math.PI / 180)
  const lat2 = b.lat * (Math.PI / 180)
  const q = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
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

export async function reverseGeocode(coords: Coordinates, zoom = 12): Promise<ReverseGeocodeResult> {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${coords.lat}&lon=${coords.lng}&format=json&zoom=${zoom}&addressdetails=1`
    const res = await fetch(url, { headers: GEOCODE_HEADERS })
    if (!res.ok) {
      return { displayName: `${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)}` }
    }

    const data = await res.json()
    const address = data?.address || {}
    const city = address.city || address.town || address.village || address.hamlet
    const region = address.state || address.county || address.region
    const country = address.country
    const countryCode = typeof address.country_code === 'string' ? address.country_code.toUpperCase() : undefined
    const displayName = city || region || country || data?.display_name?.split(',')?.slice(0, 2)?.join(', ') || `${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)}`

    return { displayName, city, region, country, countryCode }
  } catch {
    return { displayName: `${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)}` }
  }
}

export async function forwardGeocode(query: string): Promise<(Coordinates & { label: string }) | null> {
  const input = query.trim()
  if (!input) return null

  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(input)}&format=json&addressdetails=1&limit=1`
    const res = await fetch(url, { headers: GEOCODE_HEADERS })
    if (!res.ok) return null
    const rows = await res.json()
    if (!Array.isArray(rows) || rows.length === 0) return null
    const row = rows[0]

    return {
      lat: Number(row.lat),
      lng: Number(row.lon),
      label: String(row.display_name || input).split(',').slice(0, 2).join(', '),
    }
  } catch {
    return null
  }
}
