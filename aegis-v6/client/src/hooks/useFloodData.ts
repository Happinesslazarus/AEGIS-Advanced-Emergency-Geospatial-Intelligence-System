/**
 * useFloodData custom React hook (flood data logic).
 *
 * How it connects:
 * - Used by React components that need this functionality */

import { useState, useEffect, useCallback } from 'react'
import { apiGetFloodRiskOverlay, apiGetEnabledRegions } from '../utils/api'
import type { FloodRiskOverlayResponse, RegionInfo } from '../utils/api'

interface UseFloodDataResult {
  data: FloodRiskOverlayResponse | null
  loading: boolean
  error: string | null
  regions: RegionInfo[]
  currentRegion: string
  setRegion: (regionId: string) => void
  refresh: () => void
}

/**
 * React hook for fetching and managing flood monitoring data
/**
 * Provides flood areas, stations, alerts, and risk overlay with region switching
 */
export function useFloodData(initialRegion = 'scotland'): UseFloodDataResult {
  const [data, setData] = useState<FloodRiskOverlayResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [regions, setRegions] = useState<RegionInfo[]>([])
  const [currentRegion, setCurrentRegion] = useState(initialRegion)

  const fetchRegions = useCallback(async () => {
    try {
      const response = await apiGetEnabledRegions()
      setRegions(response.regions || [])
    } catch (err) {
      console.warn('Failed to load regions:', err)
    }
  }, [])

  const fetchFloodData = useCallback(async (regionId: string) => {
    setLoading(true)
    setError(null)
    try {
      const overlay = await apiGetFloodRiskOverlay(regionId)
      setData(overlay)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load flood data'
      setError(message)
      console.error('Flood data fetch error:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  //Load enabled regions on mount
  useEffect(() => {
    fetchRegions()
  }, [fetchRegions])

  //Load flood data for current region
  useEffect(() => {
    fetchFloodData(currentRegion)
  }, [currentRegion, fetchFloodData])

  const refresh = useCallback(() => {
    fetchFloodData(currentRegion)
  }, [currentRegion, fetchFloodData])

  const setRegion = useCallback((regionId: string) => {
    setCurrentRegion(regionId)
  }, [])

  return {
    data,
    loading,
    error,
    regions,
    currentRegion,
    setRegion,
    refresh,
  }
}

