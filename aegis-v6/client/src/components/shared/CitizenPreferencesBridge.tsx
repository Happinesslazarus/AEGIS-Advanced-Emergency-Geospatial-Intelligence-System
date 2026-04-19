import { useEffect } from 'react'
import { useCitizenAuth } from '../../contexts/CitizenAuthContext'
import { useTheme } from '../../contexts/ThemeContext'
import { getLanguage, setLanguage } from '../../utils/i18n'
import AlertCaptionOverlay from './AlertCaptionOverlay'

function syncAudioSettings(preferences: NonNullable<ReturnType<typeof useCitizenAuth>['preferences']>) {
  const parsedVolume = typeof preferences.audio_volume === 'number'
    ? preferences.audio_volume
    : Number(preferences.audio_volume)
  const normalizedVolume = Number.isFinite(parsedVolume)
    ? Math.max(0, Math.min(1, parsedVolume > 1 ? parsedVolume / 100 : parsedVolume))
    : 0.8
  const nextSettings = {
    enabled: preferences.audio_alerts_enabled ?? true,
    volume: normalizedVolume,
    autoPlayCritical: preferences.auto_play_critical ?? true,
    voice: preferences.audio_voice ?? 'default',
  }

  try {
    const stored = JSON.parse(localStorage.getItem('aegis-audio-settings') || '{}')
    localStorage.setItem('aegis-audio-settings', JSON.stringify({
      ...stored,
      ...nextSettings,
    }))
  } catch {
    localStorage.setItem('aegis-audio-settings', JSON.stringify(nextSettings))
  }
}

export default function CitizenPreferencesBridge(): JSX.Element | null {
  const { isAuthenticated, preferences } = useCitizenAuth()
  const { setTheme } = useTheme()

  useEffect(() => {
    if (!isAuthenticated || !preferences) return

    if (preferences.language && preferences.language !== getLanguage()) {
      setLanguage(preferences.language)
    }

    setTheme(preferences.dark_mode ? 'default' : 'light')

    const root = document.documentElement
    root.classList.toggle('compact-view', Boolean(preferences.compact_view))
    root.setAttribute('data-caption-size', preferences.caption_font_size || 'medium')
    root.setAttribute('data-caption-position', preferences.caption_position || 'bottom')
    root.setAttribute('data-captions-enabled', preferences.captions_enabled ? 'true' : 'false')

    syncAudioSettings(preferences)
  }, [isAuthenticated, preferences, setTheme])

  if (!isAuthenticated || !preferences) return null

  return (
    <AlertCaptionOverlay
      enabled={Boolean(preferences.captions_enabled)}
      position={preferences.caption_position === 'top' ? 'top' : 'bottom'}
      fontSize={preferences.caption_font_size === 'xlarge' ? 'xlarge' : preferences.caption_font_size === 'large' ? 'large' : preferences.caption_font_size === 'small' ? 'small' : 'medium'}
    />
  )
}