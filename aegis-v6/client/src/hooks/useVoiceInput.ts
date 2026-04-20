/**
 * React hook that wraps the browser MediaRecorder API and the AEGIS
 * voice-transcription WebSocket to provide real-time voice-to-text for
 * incident report forms.
 *
 * How it works:
 * 1. User presses the record button -> MediaRecorder captures audio in WebM
 *  2. Every CHUNK_INTERVAL_MS the WebM chunk is sent over a WebSocket to
 *     the AEGIS server (ws://.../api/voice/stream)
 *  3. The server forwards the chunk to the Python faster-whisper service
 *  4. The transcription text is streamed back and the hook appends it to
 *     the transcript state
 * 5. User presses stop -> MediaRecorder finalises; full transcript is ready
 *
 * Graceful degradation:
 *  - If the browser does not support MediaRecorder, isSupported = false
 *    and the component should show a plain text input instead
 *  - If the WebSocket fails, falls back to polling the POST endpoint with
 *    the entire accumulated audio blob on stop
 *
 *  - Used by VoiceInputButton.tsx (the record button component)
 *  - WebSocket connects to server/src/routes/voice.ts
 *  - Server routes to ai-engine/app/services/voice_transcription.py
 */

import {
  useState,
  useRef,
  useCallback,
  useEffect,
} from 'react'

//Constants

/** How often (ms) to send audio chunks to the server during recording */
const CHUNK_INTERVAL_MS = 1_500

/** Max recording time before auto-stop (2 minutes) */
const MAX_DURATION_MS = 120_000

//Types

export interface VoiceInputState {
  /** Is the browser capable of recording audio? */
  isSupported: boolean
  /** Is recording currently active? */
  isRecording: boolean
  /** Is the server processing the last chunk (partial results incoming)? */
  isTranscribing: boolean
  /** The accumulated transcription text so far */
  transcript: string
  /** Transient error message, or null */
  error: string | null
  /** Detected primary hazard keyword from the transcription */
  primaryHazard: string | null
  /** Approximate confidence from the last whisper segment (0-1) */
  transcriptConfidence: number
  /** Audio level for the animated waveform (0-100, updated frequently) */
  audioLevel: number
}

export interface VoiceInputHandlers {
  startRecording: () => Promise<void>
  stopRecording:  () => void
  clearTranscript: () => void
}

export type UseVoiceInputReturn = VoiceInputState & VoiceInputHandlers

//Server message shape

interface TranscriptionMessage {
  text:                string
  confidence?:         number
  primary_hazard?:     string
  severity_hint?:      string
  detected_hazards?:   Array<[string, number]>
  error?:              string
}

//Hook

/**
 * useVoiceInput
 *
 * @param onTranscript   Called each time the transcript is updated with new text.
 * @param wsUrl          WebSocket URL for the voice stream endpoint.
 *                       Defaults to the current page's origin with /api/voice/stream.
 */
export function useVoiceInput(
  onTranscript?: (text: string, hazard: string | null) => void,
  wsUrl?: string,
): UseVoiceInputReturn {
  const [state, setState] = useState<VoiceInputState>({
    isSupported:          false,
    isRecording:          false,
    isTranscribing:       false,
    transcript:           '',
    error:                null,
    primaryHazard:        null,
    transcriptConfidence: 0,
    audioLevel:           0,
  })

  const mediaRecorderRef  = useRef<MediaRecorder | null>(null)
  const wsRef             = useRef<WebSocket | null>(null)
  const chunksRef         = useRef<BlobPart[]>([])
  const autoStopTimerRef  = useRef<ReturnType<typeof setTimeout> | null>(null)
  const analyserRef       = useRef<AnalyserNode | null>(null)
  const animFrameRef      = useRef<number | null>(null)
  const streamRef         = useRef<MediaStream | null>(null)

  //Detect browser support
  useEffect(() => {
    const supported =
      typeof window !== 'undefined' &&
      typeof MediaRecorder !== 'undefined' &&
      !!navigator.mediaDevices?.getUserMedia
    setState(s => ({ ...s, isSupported: supported }))
  }, [])

  //Cleanup on unmount
  useEffect(() => {
    return () => {
      mediaRecorderRef.current?.stop()
      wsRef.current?.close()
      if (autoStopTimerRef.current) clearTimeout(autoStopTimerRef.current)
      if (animFrameRef.current)     cancelAnimationFrame(animFrameRef.current)
      streamRef.current?.getTracks().forEach(t => t.stop())
    }
  }, [])

  //WebSocket management

  const buildWsUrl = useCallback((): string => {
    if (wsUrl) return wsUrl
    const base  = window.location.origin.replace(/^http/, 'ws')
    return `${base}/api/voice/stream`
  }, [wsUrl])

  const openWebSocket = useCallback((): Promise<WebSocket> => {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(buildWsUrl())
      ws.binaryType = 'arraybuffer'

      ws.onopen = () => resolve(ws)
      ws.onerror = () => reject(new Error('WebSocket connection failed'))

      ws.onmessage = (event: MessageEvent) => {
        try {
          const msg: TranscriptionMessage = JSON.parse(event.data as string)
          if (msg.error) {
            setState(s => ({ ...s, error: msg.error ?? null, isTranscribing: false }))
            return
          }
          if (msg.text) {
            setState(s => {
              const newTranscript = s.transcript
                ? `${s.transcript} ${msg.text}`
                : msg.text
              return {
                ...s,
                transcript:           newTranscript,
                isTranscribing:       false,
                transcriptConfidence: msg.confidence ?? s.transcriptConfidence,
                primaryHazard:        msg.primary_hazard ?? s.primaryHazard,
                error:                null,
              }
            })
            onTranscript?.(msg.text, msg.primary_hazard ?? null)
          }
        } catch {
          //ignore malformed JSON
        }
      }

      wsRef.current = ws
    })
  }, [buildWsUrl, onTranscript])

  //Audio level monitor (for animated waveform)

  const startAudioLevelMonitor = useCallback((stream: MediaStream) => {
    try {
      const audioCtx = new AudioContext()
      const source   = audioCtx.createMediaStreamSource(stream)
      const analyser = audioCtx.createAnalyser()
      analyser.fftSize = 256
      source.connect(analyser)
      analyserRef.current = analyser

      const data = new Uint8Array(analyser.frequencyBinCount)
      const tick = () => {
        analyser.getByteFrequencyData(data)
        const avg = data.reduce((a, b) => a + b, 0) / data.length
        setState(s => ({ ...s, audioLevel: Math.round(avg) }))
        animFrameRef.current = requestAnimationFrame(tick)
      }
      animFrameRef.current = requestAnimationFrame(tick)
    } catch {
      //AudioContext not available (JSDOM / old browser)
    }
  }, [])

  //Start recording

  const startRecording = useCallback(async () => {
    if (state.isRecording || !state.isSupported) return
    setState(s => ({ ...s, error: null, transcript: '', primaryHazard: null }))

    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
    } catch (err) {
      const msg = err instanceof DOMException && err.name === 'NotAllowedError'
        ? 'Microphone access denied. Please allow microphone permissions.'
        : 'Could not access microphone.'
      setState(s => ({ ...s, error: msg }))
      return
    }
    streamRef.current = stream

    //Open WebSocket; fall back to buffered mode if it fails
    let ws: WebSocket | null = null
    try {
      ws = await openWebSocket()
    } catch {
      setState(s => ({
        ...s,
        error: 'Real-time transcription unavailable -- audio will be processed on stop.',
      }))
    }

    //Choose the best supported audio MIME type
    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : MediaRecorder.isTypeSupported('audio/ogg;codecs=opus')
      ? 'audio/ogg;codecs=opus'
      : 'audio/webm'

    const recorder = new MediaRecorder(stream, { mimeType })
    mediaRecorderRef.current = recorder
    chunksRef.current = []

    recorder.ondataavailable = (e: BlobEvent) => {
      if (e.data.size === 0) return
      chunksRef.current.push(e.data)
      if (ws?.readyState === WebSocket.OPEN) {
        setState(s => ({ ...s, isTranscribing: true }))
        ws.send(e.data)
      }
    }

    recorder.onstop = async () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current)
      stream.getTracks().forEach(t => t.stop())
      setState(s => ({ ...s, isRecording: false, audioLevel: 0 }))

      //Fallback: POST full audio blob if WebSocket was unavailable
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        await fallbackPostTranscription(
          new Blob(chunksRef.current, { type: mimeType }),
          onTranscript,
          setState,
        )
      }
      ws?.close()
      wsRef.current = null
    }

    recorder.start(CHUNK_INTERVAL_MS)
    startAudioLevelMonitor(stream)
    setState(s => ({ ...s, isRecording: true }))

    //Auto-stop after MAX_DURATION_MS
    autoStopTimerRef.current = setTimeout(() => {
      recorder.state === 'recording' && recorder.stop()
    }, MAX_DURATION_MS)
  }, [state.isRecording, state.isSupported, openWebSocket, startAudioLevelMonitor, onTranscript])

  //Stop recording

  const stopRecording = useCallback(() => {
    if (autoStopTimerRef.current) clearTimeout(autoStopTimerRef.current)
    mediaRecorderRef.current?.state === 'recording' &&
      mediaRecorderRef.current.stop()
  }, [])

  //Clear

  const clearTranscript = useCallback(() => {
    setState(s => ({
      ...s,
      transcript:           '',
      primaryHazard:        null,
      transcriptConfidence: 0,
      error:                null,
    }))
  }, [])

  return {
    ...state,
    startRecording,
    stopRecording,
    clearTranscript,
  }
}

//Fallback POST transcription

async function fallbackPostTranscription(
  audioBlob: Blob,
  onTranscript: ((text: string, hazard: string | null) => void) | undefined,
  setState:     React.Dispatch<React.SetStateAction<VoiceInputState>>,
): Promise<void> {
  setState(s => ({ ...s, isTranscribing: true }))
  try {
    const formData = new FormData()
    formData.append('audio', audioBlob, 'recording.webm')

    const resp = await fetch('/api/voice/transcribe', {
      method: 'POST',
      body:   formData,
    })
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`)

    const msg: TranscriptionMessage = await resp.json()
    if (msg.text) {
      setState(s => ({
        ...s,
        transcript:           msg.text,
        isTranscribing:       false,
        transcriptConfidence: msg.confidence ?? 0,
        primaryHazard:        msg.primary_hazard ?? null,
      }))
      onTranscript?.(msg.text, msg.primary_hazard ?? null)
    }
  } catch (err) {
    setState(s => ({
      ...s,
      isTranscribing: false,
      error: `Transcription failed: ${err instanceof Error ? err.message : String(err)}`,
    }))
  }
}
