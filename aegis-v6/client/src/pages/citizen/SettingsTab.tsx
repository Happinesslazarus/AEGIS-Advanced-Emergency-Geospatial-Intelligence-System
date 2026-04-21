import React, { useState, useEffect, useRef, useCallback } from 'react'
import {
  Volume2, FileText, Eye, Settings, Trash2,
  AlertCircle as AlertCircleIcon, CheckCircle, Loader2, Save, Play,
} from 'lucide-react'
import { t, setLanguage } from '../../utils/i18n'
import { useLanguage } from '../../hooks/useLanguage'
import { useCitizenAuth } from '../../contexts/CitizenAuthContext'
import { useTheme } from '../../contexts/ThemeContext'
import { useAudioAlerts } from '../../hooks/useAudioAlerts'
import AlertCaptionOverlay, { showAlertCaption } from '../../components/shared/AlertCaptionOverlay'

export default function SettingsTab({ preferences, updatePreferences }: any) {
  const lang = useLanguage()
  const { token } = useCitizenAuth()
  const { setTheme } = useTheme()
  const { speakAlert, stop, speaking } = useAudioAlerts({
    enabled: true,
    volume: 0.8,
    autoPlayCritical: true,
    voice: preferences?.audio_voice ?? 'default',
  })
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const [msgType, setMsgType] = useState<'success' | 'error'>('success')
  const [deletionStatus, setDeletionStatus] = useState<{
    deletion_requested: boolean
    deletion_requested_at: string | null
    deletion_scheduled_at: string | null
  } | null>(null)
  const [deletionLoading, setDeletionLoading] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  const buildForm = (prefs: any) => ({
    audioAlertsEnabled: prefs?.audio_alerts_enabled ?? true,
    autoPlayCritical: prefs?.auto_play_critical ?? true,
    audioVolume: (() => {
      const raw = prefs?.audio_volume ?? 70
      return typeof raw === 'number' && raw <= 1 ? Math.round(raw * 100) : raw
    })(),
    captionsEnabled: prefs?.captions_enabled ?? false,
    captionFontSize: prefs?.caption_font_size ?? 'medium',
    darkMode: prefs?.dark_mode ?? false,
    compactView: prefs?.compact_view ?? false,
    language: prefs?.language ?? 'en',
  })

  const savedFormRef = useRef(buildForm(preferences))
  const [form, setForm] = useState(() => buildForm(preferences))

  useEffect(() => {
    if (preferences) {
      const built = buildForm(preferences)
      setForm(built)
      savedFormRef.current = built
    }
  }, [preferences])

  useEffect(() => {
    setTheme(form.darkMode ? 'default' : 'light')
  }, [form.darkMode])

  useEffect(() => {
    document.documentElement.classList.toggle('compact-view', form.compactView)
  }, [form.compactView])

  useEffect(() => {
    if (form.language) setLanguage(form.language)
  }, [form.language])

  const isDirty = JSON.stringify(form) !== JSON.stringify(savedFormRef.current)

  const handleSave = async () => {
    setSaving(true)
    const ok = await updatePreferences(form)
    if (ok) {
      savedFormRef.current = { ...form }
    }
    setSaving(false)
    setMsgType(ok ? 'success' : 'error')
    setMsg(ok ? t('cdash.settings.prefsSaved', lang) : t('cdash.settings.prefsFailed', lang))
    setTimeout(() => setMsg(''), 5000)
  }

  const handleCancel = () => {
    const reverted = { ...savedFormRef.current }
    setForm(reverted)
    setTheme(reverted.darkMode ? 'default' : 'light')
    document.documentElement.classList.toggle('compact-view', reverted.compactView)
    document.documentElement.setAttribute('data-caption-size', reverted.captionFontSize)
    if (reverted.language) setLanguage(reverted.language)
    const stored = JSON.parse(localStorage.getItem('aegis-audio-settings') || '{}')
    localStorage.setItem('aegis-audio-settings', JSON.stringify({
      ...stored, enabled: reverted.audioAlertsEnabled,
      volume: reverted.audioVolume / 100, autoPlayCritical: reverted.autoPlayCritical,
    }))
  }

  useEffect(() => {
    document.documentElement.setAttribute('data-caption-size', form.captionFontSize)
  }, [form.captionFontSize])

  useEffect(() => {
    const stored = JSON.parse(localStorage.getItem('aegis-audio-settings') || '{}')
    localStorage.setItem('aegis-audio-settings', JSON.stringify({
      ...stored, enabled: form.audioAlertsEnabled,
      volume: form.audioVolume / 100, autoPlayCritical: form.autoPlayCritical,
    }))
  }, [form.audioAlertsEnabled, form.audioVolume, form.autoPlayCritical])

  const handlePreviewAlert = useCallback(() => {
    showAlertCaption({
      id: 'settings-preview-alert',
      title: 'Flood warning preview',
      message: 'River levels are rising near your selected region. Review your route and prepare to move to higher ground.',
      severity: form.autoPlayCritical ? 'critical' : 'warning',
    })
    if (form.audioAlertsEnabled) {
      speakAlert({
        id: 'settings-preview-alert',
        title: 'Flood warning preview',
        message: 'River levels are rising near your selected region. Review your route and prepare to move to higher ground.',
        severity: form.autoPlayCritical ? 'critical' : 'warning',
      })
    } else {
      stop()
    }
  }, [form.audioAlertsEnabled, form.autoPlayCritical, speakAlert, stop])

  useEffect(() => {
    if (!token) return
    fetch('/api/citizen/deletion-status', {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) setDeletionStatus(data) })
      .catch(() => {})
  }, [token])

  const handleRequestDeletion = async () => {
    if (!token) return
    setDeletionLoading(true)
    try {
      const csrfTok = document.cookie.split('; ').find(c => c.startsWith('aegis_csrf='))?.split('=')[1]
      const res = await fetch('/api/citizen/request-deletion', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(csrfTok ? { 'X-CSRF-Token': csrfTok } : {}) }
      })
      if (res.ok) {
        const data = await res.json()
        setDeletionStatus({
          deletion_requested: true,
          deletion_requested_at: new Date().toISOString(),
          deletion_scheduled_at: data.deletion_scheduled_at
        })
        setShowDeleteConfirm(false)
      }
    } catch (err) {
      console.error('Deletion request failed:', err)
    } finally {
      setDeletionLoading(false)
    }
  }

  const handleCancelDeletion = async () => {
    if (!token) return
    setDeletionLoading(true)
    try {
      const csrfTok = document.cookie.split('; ').find(c => c.startsWith('aegis_csrf='))?.split('=')[1]
      const res = await fetch('/api/citizen/cancel-deletion', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(csrfTok ? { 'X-CSRF-Token': csrfTok } : {}) }
      })
      if (res.ok) {
        setDeletionStatus({ deletion_requested: false, deletion_requested_at: null, deletion_scheduled_at: null })
      }
    } catch (err) {
      console.error('Cancel deletion failed:', err)
    } finally {
      setDeletionLoading(false)
    }
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6 animate-fade-in">
      <AlertCaptionOverlay
        enabled={form.captionsEnabled}
        position="top"
        fontSize={form.captionFontSize === 'xlarge' ? 'xlarge' : form.captionFontSize === 'large' ? 'large' : form.captionFontSize === 'small' ? 'small' : 'medium'}
        onSpeak={form.audioAlertsEnabled ? (text) => speakAlert({ title: 'Preview', message: text }) : undefined}
      />

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-extrabold text-gray-900 dark:text-white flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-gray-600 to-gray-800 flex items-center justify-center shadow-md">
              <Settings className="w-4 h-4 text-white" />
            </div>
            {t('citizen.tab.settings', lang)}
          </h2>
        </div>
        <div className="flex items-center gap-2">
          {isDirty && (
            <>
              <span className="text-[10px] text-amber-600 dark:text-amber-400 font-semibold bg-amber-50 dark:bg-amber-950/30 px-2 py-1 rounded-lg">{t('cdash.settings.unsaved', lang)}</span>
              <button onClick={handleCancel} disabled={saving}
                className="flex items-center gap-1.5 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 text-xs font-bold px-4 py-2.5 rounded-xl transition-all">
                {t('cdash.settings.cancel', lang)}
              </button>
            </>
          )}
          <button onClick={handleSave} disabled={saving || !isDirty}
            className="flex items-center gap-1.5 bg-gradient-to-r from-aegis-600 to-aegis-700 hover:from-aegis-700 hover:to-aegis-800 disabled:from-gray-300 disabled:to-gray-400 disabled:cursor-not-allowed text-white text-xs font-bold px-4 py-2.5 rounded-xl transition-all shadow-sm hover:shadow-md">
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} {t('cdash.settings.save', lang)}
          </button>
        </div>
      </div>

      {msg && (
        <div className={`border p-3.5 rounded-xl text-sm flex items-center gap-2 animate-scale-in ${
          msgType === 'success'
            ? 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800 text-emerald-700'
            : 'bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800 text-red-700'
        }`}>
          <CheckCircle className="w-4 h-4 flex-shrink-0" />{msg}
        </div>
      )}

      {/* Audio Alerts */}
      <div className="glass-card rounded-2xl p-6 space-y-4">
        <h3 className="text-sm font-bold text-gray-900 dark:text-white flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center">
            <Volume2 className="w-3.5 h-3.5 text-white" />
          </div>
          {t('cdash.settings.audioAlerts', lang)}
        </h3>

        <div className="flex items-center justify-between py-1">
          <div>
            <p className="text-sm font-medium text-gray-900 dark:text-white">{t('cdash.settings.enableAudioAlerts', lang)}</p>
            <p className="text-[11px] text-gray-500 dark:text-gray-400">{t('cdash.settings.enableAudioAlertsDesc', lang)}</p>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input type="checkbox" checked={form.audioAlertsEnabled} onChange={e => setForm(f => ({ ...f, audioAlertsEnabled: e.target.checked }))} className="sr-only peer" />
            <div className="w-11 h-6 bg-gray-200 peer-focus:ring-2 peer-focus:ring-aegis-300 dark:bg-gray-700 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all after:shadow-sm peer-checked:bg-gradient-to-r peer-checked:from-aegis-500 peer-checked:to-aegis-600"></div>
          </label>
        </div>

        <div className="flex items-center justify-between py-1">
          <div>
            <p className="text-sm font-medium text-gray-900 dark:text-white">{t('cdash.settings.autoPlayCritical', lang)}</p>
            <p className="text-[11px] text-gray-500 dark:text-gray-400">{t('cdash.settings.autoPlayCriticalDesc', lang)}</p>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input type="checkbox" checked={form.autoPlayCritical} onChange={e => setForm(f => ({ ...f, autoPlayCritical: e.target.checked }))} className="sr-only peer" />
            <div className="w-11 h-6 bg-gray-200 peer-focus:ring-2 peer-focus:ring-aegis-300 dark:bg-gray-700 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all after:shadow-sm peer-checked:bg-gradient-to-r peer-checked:from-aegis-500 peer-checked:to-aegis-600"></div>
          </label>
        </div>

        <div className="py-1">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-medium text-gray-900 dark:text-white">{t('cdash.settings.volume', lang)}</p>
            <span className="text-xs font-bold text-aegis-600 bg-aegis-50 dark:bg-aegis-950/30 px-2 py-0.5 rounded-lg">{form.audioVolume}%</span>
          </div>
          <input type="range" min={0} max={100} value={form.audioVolume}
            onChange={e => setForm(f => ({ ...f, audioVolume: parseInt(e.target.value) }))}
            className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-full appearance-none cursor-pointer accent-aegis-600" />
        </div>
      </div>

      {/* Accessibility */}
      <div className="glass-card rounded-2xl p-6 space-y-4">
        <h3 className="text-sm font-bold text-gray-900 dark:text-white flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center">
            <FileText className="w-3.5 h-3.5 text-white" />
          </div>
          {t('cdash.settings.accessibility', lang)}
        </h3>

        <div className="flex items-center justify-between py-1">
          <div>
            <p className="text-sm font-medium text-gray-900 dark:text-white">{t('cdash.settings.captionOverlay', lang)}</p>
            <p className="text-[11px] text-gray-500 dark:text-gray-400">{t('cdash.settings.captionOverlayDesc', lang)}</p>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input type="checkbox" checked={form.captionsEnabled} onChange={e => setForm(f => ({ ...f, captionsEnabled: e.target.checked }))} className="sr-only peer" />
            <div className="w-11 h-6 bg-gray-200 peer-focus:ring-2 peer-focus:ring-aegis-300 dark:bg-gray-700 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all after:shadow-sm peer-checked:bg-gradient-to-r peer-checked:from-aegis-500 peer-checked:to-aegis-600"></div>
          </label>
        </div>

        <div>
          <label className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1.5">{t('cdash.settings.captionFontSize', lang)}</label>
          <select value={form.captionFontSize} onChange={e => setForm(f => ({ ...f, captionFontSize: e.target.value }))}
            className="w-full px-3.5 py-2.5 text-sm bg-gray-50 dark:bg-gray-800/60 rounded-xl border border-gray-200 dark:border-gray-700 focus:ring-2 focus:ring-aegis-500 focus:border-transparent appearance-none transition">
            <option value="small">{t('cdash.settings.small', lang)}</option>
            <option value="medium">{t('cdash.settings.medium', lang)}</option>
            <option value="large">{t('cdash.settings.large', lang)}</option>
            <option value="xlarge">{t('cdash.settings.extraLarge', lang)}</option>
          </select>
          <p className="caption-size-preview mt-2 px-3 py-1.5 bg-gray-100 dark:bg-gray-800 rounded-lg text-gray-700 dark:text-gray-300 italic">
            Caption preview text -- emergency alert overlay
          </p>
          <div className="mt-3 flex items-center gap-2">
            <button type="button" onClick={handlePreviewAlert}
              className="inline-flex items-center gap-2 rounded-xl bg-aegis-50 px-3 py-2 text-xs font-semibold text-aegis-700 transition hover:bg-aegis-100 dark:bg-aegis-950/40 dark:text-aegis-300 dark:hover:bg-aegis-950/60">
              {speaking ? <Volume2 className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
              Preview current alert settings
            </button>
            <span className="text-[11px] text-gray-500 dark:text-gray-400">
              Tests caption size, overlay visibility, and audio playback together.
            </span>
          </div>
        </div>
      </div>

      {/* Display */}
      <div className="glass-card rounded-2xl p-6 space-y-4">
        <h3 className="text-sm font-bold text-gray-900 dark:text-white flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center">
            <Eye className="w-3.5 h-3.5 text-white" />
          </div>
          {t('cdash.settings.display', lang)}
        </h3>

        <div className="flex items-center justify-between py-1">
          <div>
            <p className="text-sm font-medium text-gray-900 dark:text-white">{t('cdash.settings.darkMode', lang)}</p>
            <p className="text-[11px] text-gray-500 dark:text-gray-400">{t('cdash.settings.darkModeDesc', lang)}</p>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input type="checkbox" checked={form.darkMode} onChange={e => setForm(f => ({ ...f, darkMode: e.target.checked }))} className="sr-only peer" />
            <div className="w-11 h-6 bg-gray-200 peer-focus:ring-2 peer-focus:ring-aegis-300 dark:bg-gray-700 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all after:shadow-sm peer-checked:bg-gradient-to-r peer-checked:from-aegis-500 peer-checked:to-aegis-600"></div>
          </label>
        </div>

        <div className="flex items-center justify-between py-1">
          <div>
            <p className="text-sm font-medium text-gray-900 dark:text-white">{t('cdash.settings.compactView', lang)}</p>
            <p className="text-[11px] text-gray-500 dark:text-gray-400">{t('cdash.settings.compactViewDesc', lang)}</p>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input type="checkbox" checked={form.compactView} onChange={e => setForm(f => ({ ...f, compactView: e.target.checked }))} className="sr-only peer" />
            <div className="w-11 h-6 bg-gray-200 peer-focus:ring-2 peer-focus:ring-aegis-300 dark:bg-gray-700 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all after:shadow-sm peer-checked:bg-gradient-to-r peer-checked:from-aegis-500 peer-checked:to-aegis-600"></div>
          </label>
        </div>

        <div>
          <label className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1.5">{t('cdash.settings.language', lang)}</label>
          <select value={form.language} onChange={e => setForm(f => ({ ...f, language: e.target.value }))}
            className="w-full px-3.5 py-2.5 text-sm bg-gray-50 dark:bg-gray-800/60 rounded-xl border border-gray-200 dark:border-gray-700 focus:ring-2 focus:ring-aegis-500 focus:border-transparent appearance-none transition">
            <option value="en">English</option>
            <option value="es">Español (Spanish)</option>
            <option value="fr">Français (French)</option>
            <option value="ar">العربية (Arabic)</option>
            <option value="zh">中文 (Chinese)</option>
            <option value="hi">हिन्दी (Hindi)</option>
            <option value="pt">Português (Portuguese)</option>
            <option value="pl">Polski (Polish)</option>
            <option value="ur">اردو (Urdu)</option>
          </select>
        </div>
      </div>

      {/* Account Deletion */}
      <div className="glass-card rounded-2xl p-6 space-y-4 border-2 border-red-200/50 dark:border-red-900/30">
        <h3 className="text-sm font-bold text-red-600 dark:text-red-400 flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-red-500 to-rose-600 flex items-center justify-center">
            <Trash2 className="w-3.5 h-3.5 text-white" />
          </div>
          {t('cdash.settings.deleteAccount', lang)}
        </h3>

        {deletionStatus?.deletion_requested ? (
          <div className="space-y-3">
            <div className="bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800/30 rounded-lg p-4">
              <div className="flex items-start gap-2">
                <AlertCircleIcon className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-red-700 dark:text-red-400">{t('cdash.settings.deletionScheduled', lang)}</p>
                  <p className="text-xs text-red-600 dark:text-red-400 mt-1">
                    Your account will be permanently deleted on{' '}
                    <span className="font-bold">
                      {deletionStatus.deletion_scheduled_at
                        ? new Date(deletionStatus.deletion_scheduled_at).toLocaleDateString('en-GB', {
                            weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
                          })
                        : '30 days from request'}
                    </span>.
                  </p>
                  <p className="text-xs text-red-500 dark:text-red-300 mt-2">{t('cdash.settings.cancelDeleteInfo', lang)}</p>
                </div>
              </div>
            </div>
            <button onClick={handleCancelDeletion} disabled={deletionLoading}
              className="w-full px-4 py-2.5 bg-green-600 hover:bg-green-700 disabled:bg-gray-300 text-white rounded-lg font-medium transition text-sm flex items-center justify-center gap-2">
              {deletionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
              {t('cdash.settings.cancelDeletion', lang)}
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-gray-500 dark:text-gray-400">{t('cdash.settings.deleteDesc', lang)}</p>
            <ul className="text-xs text-gray-500 dark:text-gray-400 space-y-1 ml-4 list-disc">
              <li>{t('cdash.settings.deleteBullet1', lang)}</li>
              <li>{t('cdash.settings.deleteBullet2', lang)}</li>
              <li>{t('cdash.settings.deleteBullet3', lang)}</li>
              <li>{t('cdash.settings.deleteBullet4', lang)}</li>
            </ul>
            {showDeleteConfirm ? (
              <div className="bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800/30 rounded-lg p-4 space-y-3">
                <p className="text-sm font-semibold text-red-700 dark:text-red-400">{t('cdash.settings.areYouSure', lang)}</p>
                <p className="text-xs text-red-600 dark:text-red-400">{t('cdash.settings.confirmDeleteDesc', lang)}</p>
                <div className="flex gap-2">
                  <button onClick={handleRequestDeletion} disabled={deletionLoading}
                    className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-gray-300 text-white rounded-lg font-medium transition text-sm flex items-center justify-center gap-2">
                    {deletionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                    {t('cdash.settings.yesDelete', lang)}
                  </button>
                  <button onClick={() => setShowDeleteConfirm(false)}
                    className="px-4 py-2 bg-gray-200 dark:bg-gray-800 hover:bg-gray-300 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-400 rounded-lg font-medium transition text-sm">
                    {t('cdash.settings.cancel', lang)}
                  </button>
                </div>
              </div>
            ) : (
              <button onClick={() => setShowDeleteConfirm(true)}
                className="w-full px-4 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium transition text-sm flex items-center justify-center gap-2">
                <Trash2 className="w-4 h-4" /> {t('cdash.settings.requestDeletion', lang)}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
