/**
 * useEventStream + domain hooks
 *
 * Generic typed Socket.IO subscription hook backed by SocketContext.
 * Eliminates per-component socket.on/off boilerplate and gives typed
 * payloads to consumers.
 *
 *   const latest = useEventStream('hazard:predicted')
 *   const score = useHazardPrediction('forth-river:7-stations')
 */
import { useEffect, useState, useMemo } from 'react'
import { useSharedSocket } from '../contexts/SocketContext'
import {
  type AegisChannel,
  type AegisChannelMap,
  type HazardPredictedEvent,
  type RiskUpdatedEvent,
  subscribeChannel,
} from '../lib/eventClient'

/** Subscribe to a typed Aegis channel; return the most recent payload (or null). */
export function useEventStream<C extends AegisChannel>(
  channel: C,
): AegisChannelMap[C] | null {
  const { socket } = useSharedSocket()
  const [latest, setLatest] = useState<AegisChannelMap[C] | null>(null)

  useEffect(() => {
    if (!socket) return
    return subscribeChannel(socket, channel, (payload) => setLatest(payload))
  }, [socket, channel])

  return latest
}

/** Subscribe and accumulate a bounded buffer of recent events. */
export function useEventBuffer<C extends AegisChannel>(
  channel: C,
  maxSize = 50,
): Array<AegisChannelMap[C]> {
  const { socket } = useSharedSocket()
  const [buffer, setBuffer] = useState<Array<AegisChannelMap[C]>>([])

  useEffect(() => {
    if (!socket) return
    return subscribeChannel(socket, channel, (payload) => {
      setBuffer((prev) => {
        const next = [payload, ...prev]
        return next.length > maxSize ? next.slice(0, maxSize) : next
      })
    })
  }, [socket, channel, maxSize])

  return buffer
}

/**
 * Live hazard prediction for a single region. Returns the latest score,
 * confidence and model version, updating automatically as the AI tick
 * publishes new predictions.
 */
export function useHazardPrediction(regionId: string): HazardPredictedEvent | null {
  const buffer = useEventBuffer('hazard:predicted', 100)
  return useMemo(
    () => buffer.find((e) => e.regionId === regionId) ?? null,
    [buffer, regionId],
  )
}

/** Live risk-score delta stream for a single region. */
export function useRiskUpdates(regionId: string): RiskUpdatedEvent | null {
  const buffer = useEventBuffer('risk:updated', 100)
  return useMemo(
    () => buffer.find((e) => e.regionId === regionId) ?? null,
    [buffer, regionId],
  )
}
