/**
 * Manages the active deployment region (UK, EU, AU, …). Reads the
 * VITE_REGION env var on startup and exposes region-specific config
 * (currency, date format, emergency numbers) to all components.
 */

import { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react'

// Types

export interface RegionEmergencyContact {
  name: string
  number: string
  type: string
  available?: string
}

export interface RegionPhoneFormat {
  countryCode: string
  dialCode: string
  nationalFormat: string
  example: string
}

export interface RegionFloodZone {
  id: string
  name: string
  riskLevel: 'high' | 'medium' | 'low'
  source: string
  wmsUrl?: string
  wmsLayers?: string
  attribution?: string
}

export interface RegionMonitoredCity {
  name: string
  lat: number
  lng: number
  cityRegionId?: string
}

export interface CrisisResource {
  name: string
  number: string
}

export interface RegionAdapterConfig {
  regionId: string
  name: string
  country: string
  countryCode: string
  timezone: string
  centre: { lat: number; lng: number }
  zoom: number
  bounds?: { north: number; south: number; east: number; west: number }
  emergencyNumber: string
  floodAuthority: string
  weatherAuthority: string
  languages: string[]
  units: 'metric' | 'imperial'
  emergencyContacts: RegionEmergencyContact[]
  phoneFormat: RegionPhoneFormat
  floodZones: RegionFloodZone[]
  supportedHazardTypes: string[]
  monitoredCities: RegionMonitoredCity[]
  llmContext: {
    floodAuthority: string
    weatherAuthority: string
    officialSourceAdvice: string
    crisisResources: CrisisResource[]
  }
}

interface RegionContextType {
  /* Full adapter config or null while loading */
  region: RegionAdapterConfig | null
  /* Loading state */
  loading: boolean
  /* Error message if fetch failed */
  error: string | null
  /* Manually refresh config from server */
  refresh: () => void
}

// Default context

const RegionContext = createContext<RegionContextType>({
  region: null,
  loading: true,
  error: null,
  refresh: () => {},
})

// Provider

export function RegionProvider({ children }: { children: ReactNode }) {
  const [region, setRegion] = useState<RegionAdapterConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchRegionConfig = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      // /api/config/region returns the adapter for the server's active region
      // (set via AEGIS_REGION env var on the server).  The adapter contains
      // emergency numbers, flood-zone GeoJSON sources, and language settings.
      const res = await fetch('/api/config/region')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      // The full adapter config is nested under data.adapter (the rest of the
      // response may contain version info or feature flags).
      if (data.adapter) {
        setRegion(data.adapter)
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load region config'
      setError(msg)
      console.warn('[RegionContext] Failed to fetch region config:', msg)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchRegionConfig()
  }, [fetchRegionConfig])

  return (
    <RegionContext.Provider value={{ region, loading, error, refresh: fetchRegionConfig }}>
      {children}
    </RegionContext.Provider>
  )
}

// Hook

export function useRegion(): RegionContextType {
  return useContext(RegionContext)
}

export default RegionContext

