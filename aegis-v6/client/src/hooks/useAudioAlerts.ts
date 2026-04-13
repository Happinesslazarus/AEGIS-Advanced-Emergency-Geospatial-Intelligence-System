/**
 * Module: useAudioAlerts.ts
 *
 * useAudioAlerts custom React hook (audio alerts logic).
 *
 * How it connects:
 * - Used by React components that need this functionality */

import { useState, useEffect, useCallback, useRef } from 'react'

export interface AudioAlertSettings {
  enabled: boolean
  volume: number       // 0-1
  rate: number         // 0.5-2
  pitch: number        // 0-2
  voice: string        // voice name or 'default'
  autoPlayCritical: boolean
  autoPlayWarning: boolean
}

const DEFAULT_SETTINGS: AudioAlertSettings = {
  enabled: true,
  volume: 0.8,
  rate: 1.0,
  pitch: 1.0,
  voice: 'default',
  autoPlayCritical: true,
  autoPlayWarning: false,
}

export function useAudioAlerts(userSettings?: Partial<AudioAlertSettings>) {
  const [settings, setSettings] = useState<AudioAlertSettings>(() => {
    const stored = localStorage.getItem('aegis-audio-settings')
    return { ...DEFAULT_SETTINGS, ...(stored ? JSON.parse(stored) : {}), ...userSettings }
  })

  const [speaking, setSpeaking] = useState(false)
  const [supported, setSupported] = useState(false)
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([])
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null)
  const playedAlertsRef = useRef<Set<string>>(new Set())

  // Check browser support for the Web Speech Synthesis API.
  // Most modern browsers support this; Firefox requires a user gesture first;
  // JSDOM (used in tests) does not support it at all.
  useEffect(() => {
    const isSupported = 'speechSynthesis' in window
    setSupported(isSupported)

    if (isSupported) {
      const loadVoices = () => {
        const availableVoices = speechSynthesis.getVoices()
        setVoices(availableVoices)
      }

      loadVoices()
      // 'voiceschanged' fires asynchronously (especially in Chrome) when the
      // browser finishes loading the OS voice list.  We must listen for it or
      // the initial getVoices() call returns an empty array.
      speechSynthesis.addEventListener('voiceschanged', loadVoices)
      return () => speechSynthesis.removeEventListener('voiceschanged', loadVoices)
    }
  }, [])

  // Persist settings
  useEffect(() => {
    localStorage.setItem('aegis-audio-settings', JSON.stringify(settings))
  }, [settings])

  // getVoice: pick the best available voice.
  // en-GB is preferred for a Scottish emergency platform; en-US is the
  // fallback; if no English voice is found we use whatever is first in the list.
  const getVoice = useCallback((): SpeechSynthesisVoice | null => {
    if (settings.voice === 'default' || !voices.length) {
      // Prefer English UK/US voice
      return (
        voices.find(v => v.lang === 'en-GB') ||
        voices.find(v => v.lang.startsWith('en')) ||
        voices[0] || null
      )
    }
    return voices.find(v => v.name === settings.voice) || voices[0] || null
  }, [settings.voice, voices])

  // speak: low-level Text-to-Speech function.
  // `alertId` deduplication prevents the same alert from being read multiple
  // times if the component re-renders while the alert is still active.
  const speak = useCallback((text: string, options?: { priority?: 'critical' | 'warning' | 'info'; alertId?: string }) => {
    if (!supported || !settings.enabled) return

    // Don't repeat the same alert — store spoken alert IDs in a ref so the
    // check is synchronous and doesn't trigger a re-render.
    if (options?.alertId && playedAlertsRef.current.has(options.alertId)) return
    if (options?.alertId) playedAlertsRef.current.add(options.alertId)

    // Cancel any in-progress speech so the new message starts immediately.
    speechSynthesis.cancel()

    const utterance = new SpeechSynthesisUtterance(text)
    utterance.volume = settings.volume
    utterance.rate = settings.rate
    utterance.pitch = settings.pitch

    const voice = getVoice()
    if (voice) utterance.voice = voice

    utterance.onstart = () => setSpeaking(true)
    utterance.onend = () => setSpeaking(false)
    utterance.onerror = () => setSpeaking(false)

    utteranceRef.current = utterance
    speechSynthesis.speak(utterance)
  }, [supported, settings, getVoice])

  // Stop speaking
  const stop = useCallback(() => {
    speechSynthesis.cancel()
    setSpeaking(false)
  }, [])

  // Auto-play alert (respects settings)
  const playAlert = useCallback((alert: {
    id: string
    title: string
    message: string
    severity: string
    area?: string
  }) => {
    if (!settings.enabled) return

    const isCritical = alert.severity === 'critical' || alert.severity === 'high'
    const isWarning = alert.severity === 'warning' || alert.severity === 'medium'

    // Check auto-play settings
    if (isCritical && !settings.autoPlayCritical) return
    if (isWarning && !settings.autoPlayWarning) return
    if (!isCritical && !isWarning) return

    const prefix = isCritical
      ? 'CRITICAL ALERT.'
      : 'Warning alert.'

    const areaText = alert.area ? ` Area affected: ${alert.area}.` : ''
    const text = `${prefix} ${alert.title}. ${alert.message}${areaText}`

    speak(text, { priority: isCritical ? 'critical' : 'warning', alertId: alert.id })
  }, [settings, speak])

  // Speak alert manually (ignores auto-play settings)
  const speakAlert = useCallback((alert: {
    id?: string
    title: string
    message: string
    severity?: string
    area?: string
  }) => {
    const prefix = alert.severity === 'critical' || alert.severity === 'high'
      ? 'Critical alert.'
      : alert.severity === 'warning' || alert.severity === 'medium'
      ? 'Warning.'
      : 'Information.'

    const areaText = alert.area ? ` Area: ${alert.area}.` : ''
    speak(`${prefix} ${alert.title}. ${alert.message}${areaText}`, { alertId: alert.id })
  }, [speak])

  // Update settings
  const updateSettings = useCallback((partial: Partial<AudioAlertSettings>) => {
    setSettings(prev => ({ ...prev, ...partial }))
  }, [])

  // Toggle enabled
  const toggleEnabled = useCallback(() => {
    setSettings(prev => ({ ...prev, enabled: !prev.enabled }))
    if (speaking) stop()
  }, [speaking, stop])

  return {
    settings,
    updateSettings,
    toggleEnabled,
    speaking,
    supported,
    voices,
    speak,
    speakAlert,
    playAlert,
    stop,
  }
}

