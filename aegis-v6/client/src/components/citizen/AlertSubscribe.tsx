import { useState } from 'react'
import { X, Bell, MessageCircle, Mail, Phone, Globe, CheckCircle } from 'lucide-react'
import { useAlerts } from '../../contexts/AlertsContext'
import { useLocation } from '../../contexts/LocationContext'
import { useWebPush } from '../../hooks/useWebPush'
import { t } from '../../utils/i18n'
import { apiSubscribe } from '../../utils/api'
import { useLanguage } from '../../hooks/useLanguage'

interface Props { onClose: () => void; lang?: string }

interface ChannelState { enabled: boolean; value: string }

export default function AlertSubscribe({ onClose, lang }: Props): JSX.Element {
  const activeLang = lang || useLanguage()
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
    if (active.length === 0) { pushNotification(t('alertSub.selectChannel', activeLang), 'warning'); return }

    if (channels.sms.enabled && !isValidE164(channels.sms.value)) {
      pushNotification(t('alertSub.smsValidation', activeLang), 'error')
      return
    }
    if (channels.whatsapp.enabled && !isValidE164(channels.whatsapp.value)) {
      pushNotification(t('alertSub.whatsappValidation', activeLang), 'error')
      return
    }

    try {
      // If Web Push is enabled, register the browser push subscription first
      if (channels.web.enabled) {
        try {
          await subscribeToWebPush(channels.email.enabled ? channels.email.value : undefined)
          pushNotification(t('alertSub.webPushEnabled', activeLang), 'success')
        } catch (err: any) {
          pushNotification(`${t('alertSub.webPushFailed', activeLang)}: ${err.message}`, 'warning')
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
      pushNotification(t('subscribe.success', activeLang), 'success')
    } catch (error: any) {
      pushNotification(error?.message || t('alertSub.subscriptionFailed', activeLang), 'error')
    }
  }

  const channelConfig = [
    { key: 'telegram', icon: MessageCircle, label: t('subscribe.telegram', activeLang), placeholder: t('subscribe.placeholder.telegram', activeLang), color: 'bg-blue-500' },
    { key: 'email', icon: Mail, label: t('subscribe.email', activeLang), placeholder: t('subscribe.placeholder.email', activeLang), color: 'bg-red-500' },
    { key: 'sms', icon: Phone, label: t('subscribe.sms', activeLang), placeholder: t('subscribe.placeholder.phone', activeLang), color: 'bg-green-500' },
    { key: 'whatsapp', icon: MessageCircle, label: t('subscribe.whatsapp', activeLang), placeholder: t('subscribe.placeholder.phone', activeLang), color: 'bg-emerald-500' },
    { key: 'web', icon: Globe, label: t('subscribe.web', activeLang), placeholder: '', color: 'bg-purple-500' },
  ]

  const areas = [
    { key: 'cityCentre', label: t('alertSub.area.cityCentre', activeLang) },
    { key: 'northDistrict', label: t('alertSub.area.northDistrict', activeLang) },
    { key: 'southDistrict', label: t('alertSub.area.southDistrict', activeLang) },
    { key: 'eastDistrict', label: t('alertSub.area.eastDistrict', activeLang) },
    { key: 'westDistrict', label: t('alertSub.area.westDistrict', activeLang) },
    { key: 'coastalRiverside', label: t('alertSub.area.coastalRiverside', activeLang) },
    { key: 'suburbanOutskirts', label: t('alertSub.area.suburbanOutskirts', activeLang) },
    { key: 'allAreas', label: t('alertSub.area.allAreas', activeLang) },
  ]

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50" role="dialog" aria-modal="true">
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto animate-fade-in">
        <div className="bg-amber-600 text-white p-5 rounded-t-2xl flex items-center justify-between">
          <h2 className="text-xl font-bold flex items-center gap-2"><Bell className="w-5 h-5" /> {t('subscribe.title', activeLang)}</h2>
          <button onClick={onClose} className="hover:bg-amber-700 p-2 rounded-lg" aria-label={t('common.close', activeLang)}><X className="w-5 h-5" /></button>
        </div>
        <div className="p-5 space-y-5">
          {subscribed ? (
            <div className="text-center py-8 animate-fade-in">
              <CheckCircle className="w-16 h-16 text-green-500 mx-auto mb-4" />
              <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100">{t('alertSub.subscribed', activeLang)}</h3>
              <p className="text-sm text-gray-600 dark:text-gray-300 mt-2">{t('alertSub.successDescription', activeLang)}</p>
              <button onClick={onClose} className="btn-primary mt-4">{t('common.done', activeLang)}</button>
            </div>
          ) : (
            <>
              <div>
                <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-3">{t('alertSub.channels', activeLang)}</h3>
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
                <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-3">{t('alertSub.areas', activeLang)} - {location.name}</h3>
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
                <p className="text-xs text-blue-700 dark:text-blue-300">{t('alertSub.info', activeLang)}</p>
              </div>
              <button onClick={handleSubscribe} className="btn-primary w-full py-3"><Bell className="w-4 h-4" /> {t('alertSub.subscribeToAlerts', activeLang)}</button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
