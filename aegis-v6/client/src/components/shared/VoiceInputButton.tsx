/**
 * Record button component for adding voice-to-text to any AEGIS form field.
 *
 * Features:
 *  - Animated waveform indicator during recording (uses audioLevel from hook)
 *  - Real-time partial transcript display as server returns chunks
 *  - Detected hazard badge (e.g. "flood") auto-populated from transcription
 *  - Accessibility: keyboard-activatable, ARIA labels, screen reader announcements
 *  - Graceful degradation: shows plain message if browser lacks MediaRecorder
 *
 * Usage:
 *  <VoiceInputButton
 *    onTranscript={(text) => setDescription(prev => `${prev} ${text}`.trim())}
 *    placeholder="Hold to record your incident description"
 *  />
 *
 * - Uses useVoiceInput hook -> WebSocket -> voice_transcription.py
 *  - Hazard output feeds into the incident report classification pipeline
 *  - Positioned inside citizen/ReportIncidentForm.tsx and
 *    admin/IncidentDetailPanel.tsx
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import { Mic, MicOff, Square, AlertTriangle, Volume2 } from 'lucide-react'
import { useVoiceInput } from '../../hooks/useVoiceInput.js'

//Hazard badge colours

const HAZARD_COLOURS: Record<string, string> = {
  flood:                    'bg-blue-100 text-blue-800',
  wildfire:                 'bg-orange-100 text-orange-800',
  severe_storm:             'bg-purple-100 text-purple-800',
  heatwave:                 'bg-red-100 text-red-800',
  drought:                  'bg-yellow-100 text-yellow-800',
  landslide:                'bg-stone-100 text-stone-800',
  power_outage:             'bg-gray-100 text-gray-800',
  water_supply_disruption:  'bg-cyan-100 text-cyan-800',
  infrastructure_damage:    'bg-amber-100 text-amber-800',
  public_safety_incident:   'bg-rose-100 text-rose-800',
  environmental_hazard:     'bg-green-100 text-green-800',
}

//Props

interface VoiceInputButtonProps {
  /** Called each time a new transcript chunk arrives */
  onTranscript?: (text: string, detectedHazard: string | null) => void
  /** Placeholder text shown when idle */
  placeholder?:  string
  /**
   * If true, the full transcript panel is shown below the button.
   * Set false to use the button as a compact inline trigger only.
   */
  showTranscript?: boolean
  /** Additional Tailwind classes for the outer container */
  className?:      string
  /** Disable the button (e.g., while the form is submitting) */
  disabled?:       boolean
}

//Animated waveform bars

function WaveformBars({ level }: { level: number }): JSX.Element {
  //5 bars whose heights are driven by the audio level
  const heights = [
    Math.max(4, level * 0.6),
    Math.max(4, level * 1.0),
    Math.max(4, level * 0.8),
    Math.max(4, level * 1.0),
    Math.max(4, level * 0.6),
  ]
  return (
    <span
      aria-hidden="true"
      className="inline-flex items-end gap-[2px] h-5 mx-1"
    >
      {heights.map((h, i) => (
        <span
          key={i}
          className="w-1 rounded-sm bg-red-500 transition-all duration-75"
          style={{ height: `${Math.min(h, 20)}px` }}
        />
      ))}
    </span>
  )
}

//Component

export function VoiceInputButton({
  onTranscript,
  placeholder   = 'Tap to record your incident description',
  showTranscript = true,
  className      = '',
  disabled       = false,
}: VoiceInputButtonProps): JSX.Element {
  const announcerRef = useRef<HTMLDivElement>(null)

  const handleTranscript = useCallback(
    (text: string, hazard: string | null) => {
      onTranscript?.(text, hazard)
    },
    [onTranscript],
  )

  const {
    isSupported,
    isRecording,
    isTranscribing,
    transcript,
    error,
    primaryHazard,
    transcriptConfidence,
    audioLevel,
    startRecording,
    stopRecording,
    clearTranscript,
  } = useVoiceInput(handleTranscript)

  //Screen-reader live region announcements
  const [announcement, setAnnouncement] = useState('')

  useEffect(() => {
    if (isRecording)     setAnnouncement('Recording started. Speak your incident description.')
    if (!isRecording && transcript) setAnnouncement('Recording stopped. Transcript ready.')
  }, [isRecording, transcript])

  const handleButtonClick = async () => {
    if (disabled) return
    if (isRecording) {
      stopRecording()
    } else {
      await startRecording()
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      void handleButtonClick()
    }
  }

  if (!isSupported) {
    return (
      <div className={`flex items-center gap-2 text-sm text-gray-500 ${className}`}>
        <MicOff className="w-4 h-4" aria-hidden="true" />
        <span>Voice input not supported in this browser.</span>
      </div>
    )
  }

  const buttonBaseClasses =
    'inline-flex items-center gap-2 px-4 py-2 rounded-lg font-medium ' +
    'transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 '

  const recordingClasses =
    'bg-red-600 text-white hover:bg-red-700 focus-visible:ring-red-500 ' +
    'animate-pulse'

  const idleClasses =
    'bg-blue-600 text-white hover:bg-blue-700 focus-visible:ring-blue-500 '

  const disabledClasses = 'opacity-50 cursor-not-allowed'

  return (
    <div className={`flex flex-col gap-2 ${className}`} role="group" aria-label="Voice input">

      {/* Live region for screen reader announcements */}
      <div
        ref={announcerRef}
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {announcement}
      </div>

      {/* Record / Stop button */}
      <button
        type="button"
        onClick={() => void handleButtonClick()}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        aria-pressed={isRecording}
        aria-label={isRecording ? 'Stop recording' : 'Start voice recording'}
        className={
          buttonBaseClasses +
          (isRecording ? recordingClasses : idleClasses) +
          (disabled ? disabledClasses : '')
        }
      >
        {isRecording ? (
          <>
            <Square className="w-4 h-4" aria-hidden="true" />
            <WaveformBars level={audioLevel} />
            Stop recording
          </>
        ) : (
          <>
            <Mic className="w-4 h-4" aria-hidden="true" />
            {placeholder}
          </>
        )}
      </button>

      {/* Transcribing indicator */}
      {isTranscribing && (
        <div className="flex items-center gap-1.5 text-sm text-gray-600" aria-live="polite">
          <Volume2 className="w-4 h-4 animate-spin text-blue-500" aria-hidden="true" />
          <span>Transcribing...</span>
        </div>
      )}

      {/* Error */}
      {error && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-700"
        >
          <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      {/* Transcript display */}
      {showTranscript && transcript && (
        <div className="rounded-md bg-gray-50 border border-gray-200 p-3 text-sm space-y-2">
          <div className="flex items-start justify-between gap-2">
            <p className="text-gray-800 leading-relaxed">{transcript}</p>
            <button
              type="button"
              onClick={clearTranscript}
              aria-label="Clear transcript"
              className="text-gray-400 hover:text-gray-600 flex-shrink-0 transition-colors"
            >
              &times;
            </button>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* Hazard badge */}
            {primaryHazard && (
              <span
                className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                  HAZARD_COLOURS[primaryHazard] ?? 'bg-gray-100 text-gray-700'
                }`}
                title="Detected incident type from voice description"
              >
                {primaryHazard.replace(/_/g, ' ')}
              </span>
            )}

            {/* Confidence score */}
            {transcriptConfidence > 0 && (
              <span className="text-xs text-gray-500">
                {Math.round(transcriptConfidence * 100)}% confidence
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default VoiceInputButton
