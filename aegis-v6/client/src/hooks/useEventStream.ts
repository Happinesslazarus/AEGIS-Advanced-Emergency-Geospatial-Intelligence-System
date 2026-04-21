/**
 * useEventStream + domain hooks
 *
 * Generic typed Socket.IO subscription hooks backed by SocketContext.
 * Eliminates per-component socket.on/off boilerplate and gives typed
 * payloads to consumers.
 *
 *   const latest    = useEventStream('hazard:predicted')
 *   const score     = useHazardPrediction('forth-river:7-stations')
 *   useEventCallback('distress:new_alert', () => bumpCounter())
 *   useEventCallbacks({
 *     'incident:alert':  onAlert,
 *     'distress:cancelled': onCancel,
 *   })
 */
import { useEffect, useState, useMemo, useRef } from 'react'
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
 * Fire-and-forget subscription -- runs `handler` for every payload but
 * doesn't store anything. Handler is captured via ref so it can close
 * over fresh state without re-subscribing on every render.
 */
export function useEventCallback<C extends AegisChannel>(
  channel: C,
  handler: (payload: AegisChannelMap[C]) => void,
): void {
  const { socket } = useSharedSocket()
  const ref = useRef(handler)
  ref.current = handler

  useEffect(() => {
    if (!socket) return
    return subscribeChannel(socket, channel, (payload) => ref.current(payload))
  }, [socket, channel])
}

/**
 * Multi-channel subscription -- subscribes to every (channel -> handler)
 * pair in the map. Replaces the classic `useEffect` block of 6 socket.on
 * + 6 socket.off calls with a single declarative object.
 */
export function useEventCallbacks(
  handlers: Partial<{ [C in AegisChannel]: (payload: AegisChannelMap[C]) => void }>,
): void {
  const { socket } = useSharedSocket()
  const ref = useRef(handlers)
  ref.current = handlers

  useEffect(() => {
    if (!socket) return
    const unsubs: Array<() => void> = []
    for (const channel of Object.keys(handlers) as AegisChannel[]) {
      unsubs.push(
        subscribeChannel(socket, channel, (payload) => {
          // Look up via ref so callers don't need useCallback
          const h = ref.current[channel]
          if (h) (h as (p: unknown) => void)(payload)
        }),
      )
    }
    return () => unsubs.forEach((u) => u())
    // Re-subscribe only when the *set* of channels changes, not the handlers
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket, Object.keys(handlers).join('|')])
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
