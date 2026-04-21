/**
 * Alert subscribe citizen component (public-facing UI element).
 *
 * - Rendered inside CitizenPage.tsx or CitizenDashboard.tsx */

import { useState } from 'react'
import { X, Bell, MessageCircle, Mail, Phone, Globe, CheckCircle, User, AlertCircle, Loader2 } from 'lucide-react'
import { useAlerts } from '../../contexts/AlertsContext'
import { useLocation } from '../../contexts/LocationContext'
import { useWebPush } from '../../hooks/useWebPush'
import { t } from '../../utils/i18n'
import { apiSubscribe } from '../../utils/api'
import { useLanguage } from '../../hooks/useLanguage'

interface Props { onClose: () => void; lang?: string }

interface ChannelState { enabled: boolean; value: string }

export default function AlertSubscribe({ onClose, lang }: Props): JSX.Element {
  const hookLang = useLanguage()
  const activeLang = lang || hookLang
  const { pushNotification } = useAlerts()
  const { location } = useLocation()
  const { subscribe: subscribeToWebPush, status: webPushStatus } = useWebPush()
  const [subscriberName, setSubscriberName] = useState('')
  const [channels, setChannels] = useState<Record<string, ChannelState>>({
    telegram: { enabled: false, value: '' }, email: { enabled: false, value: '' },
    sms: { enabled: false, value: '' }, whatsapp: { enabled: false, value: '' }, web: { enabled: false, value: 'enabled' },
  })
  const [selectedAreas, setSelectedAreas] = useState<Set<string>>(new Set())
  const [subscribed, setSubscribed] = useState(false)

  const toggleChannel = (ch: string): void => {
    setChannels(prev => ({ ...prev, [ch]: { ...prev[ch], enabled: !prev[ch].enabled } }))
  }
  const updateValue = (ch: string, val: string): void => {
    setChannels(prev => ({ ...prev, [ch]: { ...prev[ch], value: val } }))
  }
  const toggleArea = (area: string): void => {
    setSelectedAreas(prev => { const n = new Set(prev); n.has(area) ? n.delete(area) : n.add(area); return n })
  }

  const isValidE164 = (value: string): boolean => /^\+[1-9]\d{8,14}$/.test(value)
  const isValidEmail = (value: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
  const isTelegramId = (value: string): boolean => value.startsWith('@') ? value.length >= 2 : /^\d{5,}$/.test(value)

  const getFieldState = (key: string): 'idle' | 'valid' | 'invalid' => {
    const val = channels[key]?.value.trim()
    if (!channels[key]?.enabled || !val) return 'idle'
    if (key === 'email') return isValidEmail(val) ? 'valid' : 'invalid'
    if (key === 'sms' || key === 'whatsapp') return isValidE164(val) ? 'valid' : 'invalid'
    if (key === 'telegram') return isTelegramId(val) ? 'valid' : 'invalid'
    return 'idle'
  }

  const fieldHint: Record<string, string> = {
    email: 'e.g. you@example.com',
    sms: '+44 7700 900000 (E.164 format, include country code)',
    whatsapp: '+44 7700 900000 (E.164 format, include country code)',
    telegram: '@username or numeric chat ID',
  }

  const [submitting, setSubmitting] = useState(false)

  const handleSubscribe = async (): Promise<void> => {
    const active = Object.entries(channels).filter(([, v]) => v.enabled)
    if (active.length === 0) { pushNotification('Select a channel', 'warning'); return }
    if (submitting) return

    if (channels.sms.enabled && !isValidE164(channels.sms.value)) {
      pushNotification('SMS must be in international format, e.g. +447700900123', 'error')
      return
    }
    if (channels.whatsapp.enabled && !isValidE164(channels.whatsapp.value)) {
      pushNotification('WhatsApp must be in international format, e.g. +447700900123', 'error')
      return
    }
    if (channels.email.enabled && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(channels.email.value)) {
      pushNotification('Email Validation', 'error')
      return
    }

    setSubmitting(true)
    try {
      //If Web Push is enabled AND VAPID is configured on the server, register the browser push subscription
      if (channels.web.enabled && webPushStatus.enabled) {
        try {
          await subscribeToWebPush(channels.email.enabled ? channels.email.value : undefined)
          pushNotification('Web Push enabled successfully', 'success')
        } catch (err: any) {
          //Only show error for non-config issues (permission denied, etc.) -- missing VAPID key is silently skipped
          const msg: string = err?.message || ''
          if (!msg.includes('not configured') && !msg.includes('public key')) {
            pushNotification(`${'Web Push setup failed'}: ${msg}`, 'warning')
          }
        }
      }

      const payload = {
        subscriber_name: subscriberName.trim() || null,
        email: channels.email.enabled ? channels.email.value : null,
        phone: channels.sms.enabled ? channels.sms.value : null,
        telegram_id: channels.telegram.enabled ? channels.telegram.value : null,
        whatsapp: channels.whatsapp.enabled ? channels.whatsapp.value : null,
        channels: active.map(([name]) => name),
        areas: Array.from(selectedAreas),
        location_lat: location.center?.[0] || null,
        location_lng: location.center?.[1] || null,
        radius_km: 25,
        severity_filter: ['critical', 'warning', 'info']
      }

      await apiSubscribe(payload)
      setSubscribed(true)
      pushNotification('Subscribed successfully!', 'success')
    } catch (error: any) {
      pushNotification(error?.message || 'Subscription failed', 'error')
    } finally {
      setSubmitting(false)
    }
  }

  const channelConfig = [
    { key: 'telegram', icon: MessageCircle, label: 'Telegram', placeholder: '@your_username', color: 'bg-blue-500' },
    { key: 'email', icon: Mail, label: 'Email', placeholder: 'your@email.com', color: 'bg-red-500' },
    { key: 'sms', icon: Phone, label: 'SMS', placeholder: '+1 (555) 123-4567', color: 'bg-green-500' },
    { key: 'whatsapp', icon: MessageCircle, label: 'WhatsApp', placeholder: '+1 (555) 123-4567', color: 'bg-emerald-500' },
    { key: 'web', icon: Globe, label: 'Web Push', placeholder: '', color: 'bg-purple-500' },
  ]

  const areas = [
    { key: 'cityCentre', label: 'City Centre' },
    { key: 'northDistrict', label: 'North District' },
    { key: 'southDistrict', label: 'South District' },
    { key: 'eastDistrict', label: 'East District' },
    { key: 'westDistrict', label: 'West District' },
    { key: 'coastalRiverside', label: 'Coastal / Riverside' },
    { key: 'suburbanOutskirts', label: 'Suburban / Outskirts' },
    { key: 'allAreas', label: 'All Areas' },
  ]

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50" role="dialog" aria-modal="true">
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto animate-fade-in">
        <div className="bg-amber-600 text-white p-5 rounded-t-2xl flex items-center justify-between">
          <h2 className="text-xl font-bold flex items-center gap-2"><Bell className="w-5 h-5" /> {'Subscribe to Alerts'}</h2>
          <button onClick={onClose} className="hover:bg-amber-700 p-2 rounded-lg" aria-label={'Close'}><X className="w-5 h-5" /></button>
        </div>
        <div className="p-5 space-y-5">
          {subscribed ? (
            <div className="text-center py-8 animate-fade-in">
              <CheckCircle className="w-16 h-16 text-green-500 mx-auto mb-4" />
              <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100">{'Subscribed'}</h3>
              <p className="text-sm text-gray-600 dark:text-gray-300 mt-2">{'You\'ll receive alerts via your selected channels when emergencies are confirmed in your areas.'}</p>
              <button onClick={onClose} className="btn-primary mt-4">{'Done'}</button>
            </div>
          ) : (
            <>
              {/* Name field (optional) */}
              <div>
                <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-3 flex items-center gap-2">
                  <User className="w-4 h-4" /> {'Your Name'} <span className="text-xs text-gray-400 font-normal">({'Optional'})</span>
                </h3>
                <div className="relative">
                  <input
                    className="input text-sm w-full pr-16"
                    placeholder={'Name Placeholder'}
                    value={subscriberName}
                    onChange={e => setSubscriberName(e.target.value.slice(0, 80))}
                    maxLength={80}
                  />
                  {subscriberName.length > 0 && (
                    <span className={`absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-medium transition-colors ${subscriberName.length > 70 ? 'text-amber-500' : 'text-gray-400'}`}>
                      {subscriberName.length}/80
                    </span>
                  )}
                </div>
              </div>

              <div>
                <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-3">{'Alert Channels'}</h3>
                <div className="space-y-3">
                  {channelConfig.map(ch => {
                    const fieldState = getFieldState(ch.key)
                    return (
                    <div key={ch.key} className={`p-3 rounded-xl border-2 transition-all duration-200 ${
                      channels[ch.key].enabled
                        ? fieldState === 'invalid' ? 'border-red-400 bg-red-50 dark:bg-red-950/10'
                          : fieldState === 'valid' ? 'border-green-500 bg-green-50 dark:bg-green-950/10'
                          : 'border-aegis-500 bg-aegis-50 dark:bg-aegis-950/20'
                        : 'border-gray-200 dark:border-gray-700'
                    }`}>
                      <label className="flex items-center gap-3 cursor-pointer">
                        <input type="checkbox" checked={channels[ch.key].enabled} onChange={() => toggleChannel(ch.key)}
                          className="w-5 h-5 rounded border-gray-300 text-aegis-600" />
                        <div className={`w-8 h-8 ${ch.color} rounded-lg flex items-center justify-center`}>
                          <ch.icon className="w-4 h-4 text-white" />
                        </div>
                        <span className="font-medium text-sm">{ch.label}</span>
                        {fieldState === 'valid' && <CheckCircle className="w-3.5 h-3.5 text-green-500 ml-auto" />}
                        {fieldState === 'invalid' && <AlertCircle className="w-3.5 h-3.5 text-red-500 ml-auto" />}
                      </label>
                      {channels[ch.key].enabled && ch.placeholder && (
                        <div className="mt-2">
                          <div className="relative">
                            <input
                              className={`input text-sm w-full pr-8 transition-all ${
                                fieldState === 'invalid' ? 'border-red-400 focus:border-red-500 focus:ring-red-500/20' :
                                fieldState === 'valid' ? 'border-green-500 focus:border-green-500 focus:ring-green-500/20' : ''
                              }`}
                              placeholder={ch.placeholder}
                              value={channels[ch.key].value}
                              onChange={e => updateValue(ch.key, e.target.value)}
                            />
                            {fieldState === 'valid' && <CheckCircle className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-green-500" />}
                            {fieldState === 'invalid' && <AlertCircle className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-red-500" />}
                          </div>
                          {fieldHint[ch.key] && channels[ch.key].value && (
                            <p className={`text-[10px] mt-1 transition-colors ${
                              fieldState === 'invalid' ? 'text-red-500' :
                              fieldState === 'valid' ? 'text-green-600 dark:text-green-400' : 'text-gray-400'
                            }`}>
                              {fieldState === 'invalid' ? `Format: ${fieldHint[ch.key]}` : fieldState === 'valid' ? ' Valid format' : fieldHint[ch.key]}
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  )})}
                </div>
              </div>
              <div>
                <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-3">{'Areas'} - {location.name}</h3>
                <div className="flex flex-wrap gap-2">
                  {areas.map(area => (
                    <button key={area.key} onClick={() => toggleArea(area.key)}
                      className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${selectedAreas.has(area.key) ? 'bg-aegis-600 text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200'}`}>
                      {area.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="p-3 bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded-lg">
                <p className="text-xs text-blue-700 dark:text-blue-300">{'Alerts are sent when operators confirm an emergency. You can unsubscribe at any time. Your contact details are encrypted and never shared.'}</p>
              </div>
              <button onClick={handleSubscribe} disabled={submitting} className="btn-primary w-full py-3 disabled:opacity-60 disabled:cursor-not-allowed">{submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Bell className="w-4 h-4" />} {submitting ? 'Subscribing' : 'Subscribe to Alerts'}</button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

