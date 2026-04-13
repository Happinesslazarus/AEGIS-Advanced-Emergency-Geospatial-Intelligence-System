/**
 * Module: useDistress.ts
 *
 * useDistress custom React hook (distress logic).
 *
 * How it connects:
 * - Used by React components that need this functionality */

import { useState, useEffect, useRef, useCallback } from 'react'

interface DistressState {
  isActive: boolean
  distressId: string | null
  status: 'idle' | 'countdown' | 'activating' | 'active' | 'acknowledged' | 'resolved' | 'cancelled'
  countdownSeconds: number
  latitude: number | null
  longitude: number | null
  accuracy: number | null
  acknowledgedBy: string | null
  triageLevel: string | null
  resolution: string | null
  error: string | null
}

interface UseDistressOptions {
  socket: any
  citizenId: string
  citizenName: string
  onActivated?: (id: string) => void
  onAcknowledged?: (operatorName: string) => void
  onResolved?: (resolution: string) => void
}

export function useDistress({ socket, citizenId, citizenName, onActivated, onAcknowledged, onResolved }: UseDistressOptions) {
  const [state, setState] = useState<DistressState>({
    isActive: false,
    distressId: null,
    status: 'idle',
    countdownSeconds: 0,
    latitude: null,
    longitude: null,
    accuracy: null,
    acknowledgedBy: null,
    triageLevel: null,
    resolution: null,
    error: null,
  })

  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const watchIdRef = useRef<number | null>(null)

  // Refs that hold the latest GPS coordinates.  Using refs (not state) here
  // prevents a stale closure problem: `activateSOS` is memoised with useCallback
  // but it reads GPS values that change over time.  Refs always give the latest
  // value without needing to be listed as dependencies.
  const latRef = useRef<number | null>(null)
  const lngRef = useRef<number | null>(null)

  // startCountdown: gives the user 5 seconds to change their mind before
  // sending the SOS signal.  This prevents accidental activations and mirrors
  // the confirmation delay used by smartphone emergency SOS features.
  const startCountdown = useCallback(() => {
    setState(prev => ({ ...prev, status: 'countdown', countdownSeconds: 5, error: null }))

    // Get initial GPS position
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          latRef.current = pos.coords.latitude
          lngRef.current = pos.coords.longitude
          setState(prev => ({
            ...prev,
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
          }))
        },
        () => {
          setState(prev => ({ ...prev, error: 'GPS unavailable. Please enable location services.' }))
        },
        { enableHighAccuracy: true, timeout: 10000 }
      )
    }

    let remaining = 5
    countdownRef.current = setInterval(() => {
      remaining--
      if (remaining <= 0) {
        if (countdownRef.current) clearInterval(countdownRef.current)
        countdownRef.current = null
        activateSOS()
      } else {
        setState(prev => ({ ...prev, countdownSeconds: remaining }))
      }
    }, 1000)
  }, [])

  // Cancel countdown
  const cancelCountdown = useCallback(() => {
    if (countdownRef.current) {
      clearInterval(countdownRef.current)
      countdownRef.current = null
    }
    setState(prev => ({ ...prev, status: 'idle', countdownSeconds: 0 }))
  }, [])

  // Activate SOS
  const activateSOS = useCallback(() => {
    if (!socket) {
      setState(prev => ({ ...prev, error: 'No connection', status: 'idle' }))
      return
    }

    // Read latest GPS coords from ref to avoid stale closure
    const lat = latRef.current
    const lng = lngRef.current

    if (lat === null || lng === null) {
      setState(prev => ({ ...prev, error: 'GPS position unavailable. Enable location services and try again.', status: 'idle' }))
      return
    }

    setState(prev => ({ ...prev, status: 'activating', error: null }))

    socket.emit('distress:activate', {
      latitude: lat,
      longitude: lng,
      message: 'SOS activated from AEGIS app',
    }, (response: any) => {
      if (response?.success) {
        const distressId = response.distress.id
        setState(p => ({
          ...p,
          isActive: true,
          distressId,
          status: 'active',
        }))
        onActivated?.(distressId)
        startGPSTracking(distressId)
        startHeartbeat(distressId)
      } else {
        setState(p => ({ ...p, error: response?.error || 'Activation failed', status: 'idle' }))
      }
    })
  }, [socket, onActivated])

  // startGPSTracking: uses `watchPosition` (continuous updates) rather than
  // `getCurrentPosition` (one-shot) so the operator dashboard sees the citizen
  // moving in real time.  maximumAge:5000 allows a cached position up to 5s
  // old to reduce battery drain; enableHighAccuracy tries to use GPS chips.
  const startGPSTracking = useCallback((distressId: string) => {
    if (!navigator.geolocation || !socket) return

    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude, longitude, accuracy, heading, speed } = pos.coords
        latRef.current = latitude
        lngRef.current = longitude
        setState(prev => ({ ...prev, latitude, longitude, accuracy }))

        socket.emit('distress:location_update', {
          distressId,
          latitude,
          longitude,
          accuracy,
          heading: heading ?? undefined,
          speed: speed ?? undefined,
        })
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
    )
  }, [socket])

  // startHeartbeat: a "dead-man switch" that emits a ping every 30 seconds.
  // The server can detect when the pings stop (e.g. app closed, phone off)
  // and escalate the distress incident to operators automatically.
  const startHeartbeat = useCallback((distressId: string) => {
    heartbeatRef.current = setInterval(() => {
      if (socket) {
        socket.emit('distress:heartbeat', { distressId })
      }
    }, 30000)
  }, [socket])

  // Cancel SOS
  const cancelSOS = useCallback(() => {
    if (!socket || !state.distressId) return

    socket.emit('distress:cancel', { distressId: state.distressId }, (response: any) => {
      if (response?.success) {
        cleanup()
        setState(prev => ({
          ...prev,
          isActive: false,
          distressId: null,
          status: 'cancelled',
        }))
      }
    })
  }, [socket, state.distressId])

  // Cleanup
  const cleanup = useCallback(() => {
    if (watchIdRef.current != null) {
      navigator.geolocation.clearWatch(watchIdRef.current)
      watchIdRef.current = null
    }
    if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current)
      heartbeatRef.current = null
    }
    if (countdownRef.current) {
      clearInterval(countdownRef.current)
      countdownRef.current = null
    }
  }, [])

  // Socket listeners
  useEffect(() => {
    if (!socket) return

    const onAck = (data: any) => {
      // Only process if this event is for OUR distress call (multiple tabs may
      // be open, so we filter by distressId).
      if (data.distressId === state.distressId) {
        setState(prev => ({
          ...prev,
          status: 'acknowledged',
          acknowledgedBy: data.operatorName,
          triageLevel: data.triageLevel,
        }))
        onAcknowledged?.(data.operatorName)
      }
    }

    const onResol = (data: any) => {
      if (data.distressId === state.distressId) {
        cleanup()
        setState(prev => ({
          ...prev,
          isActive: false,
          status: 'resolved',
          resolution: data.resolution,
        }))
        onResolved?.(data.resolution)
      }
    }

    socket.on('distress:acknowledged', onAck)
    socket.on('distress:resolved', onResol)

    return () => {
      socket.off('distress:acknowledged', onAck)
      socket.off('distress:resolved', onResol)
    }
  }, [socket, state.distressId, onAcknowledged, onResolved, cleanup])

  // Cleanup on unmount
  useEffect(() => {
    return () => { cleanup() }
  }, [cleanup])

  // Retry activation after error
  const retryActivation = useCallback(() => {
    if (state.status !== 'idle' || !state.error) return
    setState(prev => ({ ...prev, error: null }))
    startCountdown()
  }, [state.status, state.error, startCountdown])

  return {
    ...state,
    status: state.status as DistressState['status'],
    startCountdown,
    cancelCountdown,
    cancelSOS,
    retryActivation,
  }
}

