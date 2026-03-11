import { useState } from 'react'
import { X, Bell, MessageCircle, Mail, Phone, Globe, CheckCircle } from 'lucide-react'
import { useAlerts } from '../../contexts/AlertsContext'
import { useLocation } from '../../contexts/LocationContext'
import { useWebPush } from '../../hooks/useWebPush'
import { t } from '../../utils/i18n'
import { apiSubscribe } from '../../utils/api'

interface Props { onClose: () => void; lang?: string }

interface ChannelState { enabled: boolean; value: string }

export default function AlertSubscribe({ onClose, lang = 'en' }: Props): JSX.Element {
  const { pushNotification } = useAlerts()
  const { location } = useLocation()
  const { subscribe: subscribeToWebPush } = useWebPush()
  const [channels, setChannels] = useState<Record<string, ChannelState>>({
    telegram: { enabled: false, value: '' }, email: { enabled: false, value: '' },
    sms: { enabled: false, value: '' }, whatsapp: { enabled: false, value: '' }, web: { enabled: true, value: 'enabled' },
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

  const handleSubscribe = async (): Promise<void> => {
    const active = Object.entries(channels).filter(([, v]) => v.enabled)
    if (active.length === 0) { pushNotification('Select at least one alert channel.', 'warning'); return }

    if (channels.sms.enabled && !isValidE164(channels.sms.value)) {
      pushNotification('SMS must be in international format, e.g. +447700900123', 'error')
      return
    }
    if (channels.whatsapp.enabled && !isValidE164(channels.whatsapp.value)) {
      pushNotification('WhatsApp must be in international format, e.g. +447700900123', 'error')
      return
    }

    try {
      // If Web Push is enabled, register the browser push subscription first
      if (channels.web.enabled) {
        try {
          await subscribeToWebPush(channels.email.enabled ? channels.email.value : undefined)
          pushNotification('Web Push enabled successfully', 'success')
        } catch (err: any) {
          pushNotification(`Web Push setup failed: ${err.message}`, 'warning')
        }
      }

      const payload = {
        email: channels.email.enabled ? channels.email.value : null,
        phone: channels.sms.enabled ? channels.sms.value : null,
        telegram_id: channels.telegram.enabled ? channels.telegram.value : null,
        whatsapp: channels.whatsapp.enabled ? channels.whatsapp.value : null,
        channels: active.map(([name]) => name),
        location_lat: location.center?.[0] || null,
        location_lng: location.center?.[1] || null,
        radius_km: 25,
        severity_filter: ['critical', 'warning', 'info']
      }

      await apiSubscribe(payload)
      setSubscribed(true)
      pushNotification(t('subscribe.success', lang), 'success')
    } catch (error: any) {
      pushNotification(error?.message || 'Subscription failed', 'error')
    }
  }

  const channelConfig = [
    { key: 'telegram', icon: MessageCircle, label: 'Telegram', placeholder: '@your_username', color: 'bg-blue-500' },
    { key: 'email', icon: Mail, label: 'Email', placeholder: 'your@email.com', color: 'bg-red-500' },
    { key: 'sms', icon: Phone, label: 'SMS', placeholder: '+44 7xxx xxxxxx', color: 'bg-green-500' },
    { key: 'whatsapp', icon: MessageCircle, label: 'WhatsApp', placeholder: '+44 7xxx xxxxxx', color: 'bg-emerald-500' },
    { key: 'web', icon: Globe, label: 'Web Push', placeholder: '', color: 'bg-purple-500' },
  ]

  const areas = ['City Centre', 'Bridge of Don', 'Old Aberdeen', 'Riverside / Dee Valley', 'Coastal / Beach', 'Westburn / Rosemount', 'All Areas']

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50" role="dialog" aria-modal="true">
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto animate-fade-in">
        <div className="bg-amber-600 text-white p-5 rounded-t-2xl flex items-center justify-between">
          <h2 className="text-xl font-bold flex items-center gap-2"><Bell className="w-5 h-5" /> {t('subscribe.title', lang)}</h2>
          <button onClick={onClose} className="hover:bg-amber-700 p-2 rounded-lg" aria-label="Close"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-5 space-y-5">
          {subscribed ? (
            <div className="text-center py-8 animate-fade-in">
              <CheckCircle className="w-16 h-16 text-green-500 mx-auto mb-4" />
              <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100">Subscribed!</h3>
              <p className="text-sm text-gray-600 dark:text-gray-400 mt-2">You'll receive alerts via your selected channels when emergencies are confirmed in your areas.</p>
              <button onClick={onClose} className="btn-primary mt-4">Done</button>
            </div>
          ) : (
            <>
              <div>
                <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-3">Alert Channels</h3>
                <div className="space-y-3">
                  {channelConfig.map(ch => (
                    <div key={ch.key} className={`p-3 rounded-xl border-2 transition-all ${channels[ch.key].enabled ? 'border-aegis-500 bg-aegis-50 dark:bg-aegis-950/20' : 'border-gray-200 dark:border-gray-700'}`}>
                      <label className="flex items-center gap-3 cursor-pointer">
                        <input type="checkbox" checked={channels[ch.key].enabled} onChange={() => toggleChannel(ch.key)}
                          className="w-5 h-5 rounded border-gray-300 text-aegis-600" />
                        <div className={`w-8 h-8 ${ch.color} rounded-lg flex items-center justify-center`}>
                          <ch.icon className="w-4 h-4 text-white" />
                        </div>
                        <span className="font-medium text-sm">{ch.label}</span>
                      </label>
                      {channels[ch.key].enabled && ch.placeholder && (
                        <input className="input mt-2 text-sm" placeholder={ch.placeholder}
                          value={channels[ch.key].value} onChange={e => updateValue(ch.key, e.target.value)} />
                      )}
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-3">Alert Areas — {location.name}</h3>
                <div className="flex flex-wrap gap-2">
                  {areas.map(area => (
                    <button key={area} onClick={() => toggleArea(area)}
                      className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${selectedAreas.has(area) ? 'bg-aegis-600 text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200'}`}>
                      {area}
                    </button>
                  ))}
                </div>
              </div>
              <div className="p-3 bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded-lg">
                <p className="text-xs text-blue-700 dark:text-blue-300">Alerts are sent when operators confirm an emergency. You can unsubscribe at any time. Your contact details are encrypted and never shared.</p>
              </div>
              <button onClick={handleSubscribe} className="btn-primary w-full py-3"><Bell className="w-4 h-4" /> Subscribe to Alerts</button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
