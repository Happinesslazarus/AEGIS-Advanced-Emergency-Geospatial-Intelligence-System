/**
 * useIncidentLocation custom React hook (incident location logic).
 *
 * - Used by React components that need this functionality */

import { useMemo, useState } from 'react'
import type { LocationSource } from '../types'

export type IncidentLocationConfidence = 'high' | 'medium' | 'poor'

export interface IncidentLocationPoint {
  lat: number
  lng: number
}

export interface IncidentLocationState {
  inputValue: string
  suggestions: Array<{ label: string; lat: number; lng: number }>
  selectedLocation: IncidentLocationPoint | null
  gpsLocation: IncidentLocationPoint | null
  manualPin: IncidentLocationPoint | null
  accuracy: number | null
  source: LocationSource
  confidence: IncidentLocationConfidence
  confirmed: boolean
}

//confidenceFromAccuracy: maps the Geolocation API's accuracy radius (metres)
//to a human-readable confidence band.
// < 50 m  = GPS lock inside a building or outdoors -- 'high' (usable for street-level address)
// ≤ 150 m  = typical urban GPS with partial sky view -- 'medium' (usable for neighbourhood)
// > 150 m  = cell tower / WiFi triangulation -- 'poor' (only good for city-level dispatch)
export function confidenceFromAccuracy(accuracy: number | null): IncidentLocationConfidence {
  if (accuracy == null) return 'medium'
  if (accuracy < 50) return 'high'
  if (accuracy <= 150) return 'medium'
  return 'poor'
}

export function useIncidentLocation(initial?: Partial<IncidentLocationState>) {
  const [state, setState] = useState<IncidentLocationState>({
    inputValue: '',
    suggestions: [],
    selectedLocation: null,
    gpsLocation: null,
    manualPin: null,
    accuracy: null,
    source: 'manual_text',
    confidence: 'medium',
    confirmed: false,
    ...initial,
  })

  const setInput = (inputValue: string): void => {
    setState((prev) => ({ ...prev, inputValue, confirmed: false }))
  }

  const setGpsLocation = (lat: number, lng: number, accuracy: number | null): void => {
    const confidence = confidenceFromAccuracy(accuracy)
    setState((prev) => ({
      ...prev,
      gpsLocation: { lat, lng },
      selectedLocation: { lat, lng },
      manualPin: null,
      accuracy,
      source: 'gps',
      confidence,
      confirmed: false,
    }))
  }

  const setManualPin = (lat: number, lng: number): void => {
    setState((prev) => ({
      ...prev,
      manualPin: { lat, lng },
      selectedLocation: { lat, lng },
      source: 'map_pin',
      confidence: 'high',
      confirmed: false,
    }))
  }

  const selectSuggestion = (label: string, lat: number, lng: number): void => {
    setState((prev) => ({
      ...prev,
      inputValue: label,
      selectedLocation: { lat, lng },
      manualPin: null,
      source: 'address_search',
      confidence: 'medium',
      suggestions: [],
      confirmed: false,
    }))
  }

  const confirm = (): void => {
    setState((prev) => ({ ...prev, confirmed: true, suggestions: [] }))
  }

  const model = useMemo(() => ({ state, setState, setInput, setGpsLocation, setManualPin, selectSuggestion, confirm }), [state])
  return model
}
