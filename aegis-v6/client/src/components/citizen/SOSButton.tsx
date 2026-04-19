/**
 * Module: SOSButton.tsx
 *
 * S o s button citizen component (public-facing UI element).
 *
 * - Rendered inside CitizenPage.tsx or CitizenDashboard.tsx */

import { useState, useCallback, useRef, useEffect } from 'react'
import { Radio, X, MapPin, Shield, Phone, Loader2, AlertTriangle } from 'lucide-react'
import { useDistress } from '../../hooks/useDistress'
import { t } from '../../utils/i18n'
import { useLanguage } from '../../hooks/useLanguage'

// Audio/haptic feedback helpers (#60)
function vibrate(pattern: number | number[]): void {
  try { navigator.vibrate?.(pattern) } catch { /* not supported */ }
}

function playTone(freq: number, durationMs: number, type: OscillatorType = 'sine'): void {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = type
    osc.frequency.value = freq
    gain.gain.value = 0.3
    osc.connect(gain).connect(ctx.destination)
    osc.start()
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + durationMs / 1000)
    osc.stop(ctx.currentTime + durationMs / 1000)
  } catch { /* audio not available */ }
}

interface Props {
  socket: any
  citizenId: string
  citizenName: string
  className?: string
}

export default function SOSButton({ socket, citizenId, citizenName, className = '' }: Props): JSX.Element {
  const lang = useLanguage()
  const [showPanel, setShowPanel] = useState(false)
  const resolveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Clean up resolve timer on unmount
  useEffect(() => () => {
    if (resolveTimerRef.current) clearTimeout(resolveTimerRef.current)
  }, [])

  const {
    isActive,
    status: rawStatus,
    countdownSeconds,
    latitude,
    longitude,
    accuracy,
    acknowledgedBy,
    triageLevel,
    resolution,
    error,
    startCountdown,
    cancelCountdown,
    cancelSOS,
    retryActivation,
  } = useDistress({
    socket,
    citizenId,
    citizenName,
    onActivated: () => {
      setShowPanel(true)
      // Strong haptic + alarm tone when SOS goes active
      vibrate([300, 100, 300, 100, 500])
      playTone(880, 500, 'square')
    },
    onAcknowledged: () => {
      // Double pulse — help is on the way
      vibrate([200, 100, 200])
      playTone(660, 300)
    },
    onResolved: () => {
      // Gentle confirmation
      vibrate(100)
      playTone(523, 200)
      setTimeout(() => playTone(659, 200), 250)
      resolveTimerRef.current = setTimeout(() => setShowPanel(false), 5000)
    },
  })

  // Use a proper union type for safe template comparisons without losing type safety
  type SOSStatus = 'idle' | 'countdown' | 'activating' | 'active' | 'acknowledged' | 'resolved' | 'cancelled' | 'error'
  const status: SOSStatus = rawStatus as SOSStatus

  const handleSOSPress = () => {
    if (status === 'idle' || status === 'cancelled' || status === 'resolved') {
      startCountdown()
      setShowPanel(true)
      vibrate(50) // Haptic tick on countdown start
      playTone(440, 150) // Short beep
    } else if (status === 'countdown') {
      cancelCountdown()
      setShowPanel(false)
    } else if (isEmergencyActive) {
      // Toggle panel visibility instead of disabling the button
      setShowPanel(!showPanel)
    }
  }

  const handleCancel = () => {
    if (status === 'countdown') {
      cancelCountdown()
      setShowPanel(false)
    } else if (status === 'active' || status === 'acknowledged') {
      cancelSOS()
    }
  }

  const isEmergencyActive = status === 'active' || status === 'acknowledged' || status === 'activating'

  return (
    <>
      {/* Floating SOS button */}
      <button
        onClick={handleSOSPress}
        className={`
          fixed z-[9999]
          w-16 h-16 rounded-full
          flex items-center justify-center
          shadow-2xl transition-all duration-300
          ${isEmergencyActive
            ? 'bg-red-600 shadow-red-600/50 animate-pulse cursor-pointer'
            : status === 'countdown'
              ? 'bg-orange-500 shadow-orange-500/50 scale-110'
              : 'bg-red-600 hover:bg-red-500 hover:scale-110 shadow-red-600/30 active:scale-95'}
          ${className}
        `}
        style={{ bottom: 'max(1.5rem, calc(env(safe-area-inset-bottom, 0px) + 1.5rem))', right: 'max(1.5rem, calc(env(safe-area-inset-right, 0px) + 1.5rem))' }}
        title={t('sos.emergencySOS', lang)}
        aria-label={t('sos.emergencySOSButton', lang)}
      >
        {status === 'countdown' ? (
          <span className="text-2xl font-black text-white">{countdownSeconds}</span>
        ) : status === 'activating' ? (
          <Loader2 className="w-7 h-7 text-white animate-spin" />
        ) : (
          <Radio className="w-7 h-7 text-white" />
        )}
      </button>

      {/* Outer pulse rings when active */}
      {isEmergencyActive && (
        <>
          <div className="fixed z-[9998] w-16 h-16 rounded-full bg-red-600/30 animate-ping pointer-events-none" style={{ bottom: 'max(1.5rem, calc(env(safe-area-inset-bottom, 0px) + 1.5rem))', right: 'max(1.5rem, calc(env(safe-area-inset-right, 0px) + 1.5rem))' }} />
          <div className="fixed z-[9997] w-20 h-20 rounded-full border-2 border-red-500/20 animate-pulse pointer-events-none" style={{ bottom: 'max(1rem, calc(env(safe-area-inset-bottom, 0px) + 1rem))', right: 'max(1rem, calc(env(safe-area-inset-right, 0px) + 1rem))' }} />
        </>
      )}

      {/* SOS Panel */}
      {showPanel && (
        <div className="fixed bottom-24 right-4 left-4 sm:left-auto z-[9999] w-auto sm:w-72 max-w-[calc(100vw-2rem)] bg-gray-900/95 backdrop-blur-lg border border-gray-700/60 rounded-2xl shadow-2xl overflow-hidden">
          {/* Header */}
          <div className={`px-4 py-3 flex items-center gap-2 ${isEmergencyActive ? 'bg-red-900/50' : status === 'countdown' ? 'bg-orange-900/50' : status === 'resolved' ? 'bg-green-900/30' : 'bg-gray-800/50'}`}>
            <div className={`p-1.5 rounded-lg ${isEmergencyActive ? 'bg-red-600 animate-pulse' : status === 'resolved' ? 'bg-green-700' : 'bg-orange-600'}`}>
              {isEmergencyActive ? <Radio className="w-4 h-4 text-white" /> : status === 'resolved' ? <Shield className="w-4 h-4 text-white" /> : <AlertTriangle className="w-4 h-4 text-white" />}
            </div>
            <div className="flex-1">
              <h3 className="text-sm font-bold text-white">
                {status === 'countdown' ? t('sos.activating', lang) : status === 'activating' ? t('sos.activating', lang) : status === 'active' ? t('sos.sosActive', lang) : status === 'acknowledged' ? t('sos.helpComing', lang) : status === 'resolved' ? t('sos.resolved', lang) : status === 'cancelled' ? t('common.cancelled', lang) : t('sos.emergencySOS', lang)}
              </h3>
              <p className="text-[10px] text-gray-400 dark:text-gray-300">
                {status === 'countdown' ? `${t('sos.sendingDistress', lang)} ${countdownSeconds}s...` : status === 'active' ? t('sos.broadcasting', lang) : status === 'acknowledged' ? `${acknowledgedBy} ${t('sos.isResponding', lang)}` : status === 'resolved' ? resolution || t('sos.situationResolved', lang) : t('sos.pressToActivate', lang)}
              </p>
            </div>
            <button
              onClick={() => setShowPanel(false)}
              className="p-2 min-w-[44px] min-h-[44px] flex items-center justify-center text-gray-400 dark:text-gray-300 hover:text-white transition"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Body */}
          <div className="p-4 space-y-3">
            {/* GPS coordinates */}
            {(latitude != null && longitude != null) && (
              <div className="flex items-center gap-2 bg-gray-800/40 rounded-lg px-3 py-2">
                <MapPin className="w-4 h-4 text-blue-400 flex-shrink-0" />
                <div>
                  <p className="text-xs font-mono text-white">{latitude.toFixed(6)}, {longitude.toFixed(6)}</p>
                  {accuracy != null && (
                    <p className="text-[9px] text-gray-400 dark:text-gray-300">—{Math.round(accuracy)}m {t('sos.accuracy', lang)}</p>
                  )}
                </div>
              </div>
            )}

            {/* Triage level */}
            {triageLevel && (
              <div className="flex items-center gap-2 bg-gray-800/40 rounded-lg px-3 py-2">
                <Shield className="w-4 h-4 text-amber-400 flex-shrink-0" />
                <p className="text-xs text-white">{t('sos.triage', lang)}: <span className="font-bold capitalize">{triageLevel}</span></p>
              </div>
            )}

            {/* Status indicators */}
            <div className="space-y-1.5">
              <StatusDot active label={t('sos.gpsAcquired', lang)} done={latitude != null} />
              <StatusDot active={isEmergencyActive || status === 'resolved'} label={t('sos.beaconTransmitted', lang)} done={isEmergencyActive || (['resolved', 'acknowledged'] as string[]).includes(status)} />
              <StatusDot active={(['acknowledged', 'resolved'] as string[]).includes(status)} label={t('sos.operatorAcknowledged', lang)} done={(['acknowledged', 'resolved'] as string[]).includes(status)} />
              <StatusDot active={status === 'resolved'} label={t('sos.situationResolved', lang)} done={status === 'resolved'} />
            </div>

            {/* Error */}
            {error && (
              <div className="bg-red-900/30 border border-red-700/40 rounded-lg px-3 py-2 text-xs text-red-300">
                {error}
                <button
                  onClick={retryActivation}
                  className="mt-1.5 w-full py-1.5 min-h-[44px] bg-red-700/50 hover:bg-red-700/70 rounded-md text-xs font-medium text-white transition flex items-center justify-center gap-1.5"
                >
                  <Radio className="w-3 h-3" /> Retry SOS
                </button>
              </div>
            )}

            {/* Actions */}
            {(status === 'countdown' || isEmergencyActive) && (
              <button
                onClick={handleCancel}
                className="w-full py-2.5 min-h-[44px] bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-xl text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 hover:text-gray-900 dark:hover:text-white transition flex items-center justify-center gap-2"
              >
                <X className="w-4 h-4" />
                {status === 'countdown' ? t('common.cancel', lang) : t('sos.cancelSOS', lang)}
              </button>
            )}
          </div>
        </div>
      )}
    </>
  )
}

function StatusDot({ active, label, done }: { active: boolean; label: string; done: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <div className={`w-2 h-2 rounded-full flex-shrink-0 transition-all ${done ? 'bg-green-400' : active ? 'bg-yellow-400 animate-pulse' : 'bg-gray-600'}`} />
      <span className={`text-[11px] ${done ? 'text-green-300' : active ? 'text-white' : 'text-gray-500 dark:text-gray-300'}`}>{label}</span>
    </div>
  )
}

