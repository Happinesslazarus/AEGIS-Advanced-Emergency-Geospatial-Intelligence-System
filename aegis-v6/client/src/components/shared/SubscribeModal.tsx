/**
 * Unified alert subscription modal used by both the anonymous citizen page
 * (/citizen) and the authenticated citizen dashboard (/citizen/dashboard).
 *
 * When `user` prop is supplied the modal pre-fills the email, shows a
 * "Subscribing as <name>" badge, and apiSubscribe will automatically
 * attach the citizen JWT so the server can link the row to a citizen_id.
 *
 * Without `user` the subscription is stored anonymously (no citizen_id).
 */

import { useState } from 'react'
import {
  Bell, X, Mail, Smartphone, Send, MessageSquare, Wifi, CheckCircle,
} from 'lucide-react'
import { apiSubscribe } from '../../utils/api'
import { useWebPush } from '../../hooks/useWebPush'
import { useLanguage } from '../../hooks/useLanguage'
import { t } from '../../utils/i18n'
import CountrySearch from './CountrySearch'
import ALL_COUNTRY_CODES from '../../data/allCountryCodes'
import { type CountryCode, formatPhoneWithCountry } from '../../data/countryCodes'

interface SubscribeUser {
  id: string
  email?: string | null
  firstName?: string | null
  lastName?: string | null
  displayName?: string | null
}

interface SubscribeModalProps {
  isOpen: boolean
  onClose: () => void
  /** When provided the subscription is linked to this citizen account */
  user?: SubscribeUser | null
  pushNotification?: (msg: string, type: 'success' | 'warning' | 'error' | 'info') => void
}

const TOPICS = ['flood', 'fire', 'storm', 'earthquake', 'heatwave', 'tsunami', 'general'] as const
type Topic = typeof TOPICS[number]

const CHANNELS = [
  { key: 'email',   label: 'Email',    icon: Mail,          gradient: 'from-red-400 to-rose-600'       },
  { key: 'sms',     label: 'SMS',      icon: Smartphone,    gradient: 'from-green-400 to-emerald-600'  },
  { key: 'telegram',label: 'Telegram', icon: Send,          gradient: 'from-blue-400 to-blue-600'      },
  { key: 'whatsapp',label: 'WhatsApp', icon: MessageSquare, gradient: 'from-green-500 to-green-700'    },
  { key: 'webpush', label: 'Web Push', icon: Wifi,          gradient: 'from-purple-400 to-violet-600'  },
] as const

export default function SubscribeModal({ isOpen, onClose, user, pushNotification }: SubscribeModalProps) {
  const lang = useLanguage()
  const { status: webPushStatus, subscribe: subscribeToWebPush, loading: webPushLoading } = useWebPush()

  const [subChannels, setSubChannels] = useState<string[]>([])
  const [subEmail, setSubEmail] = useState(() => user?.email || '')
  const [subPhone, setSubPhone] = useState('')
  const [subTelegramId, setSubTelegramId] = useState('')
  const [selectedCountry, setSelectedCountry] = useState<CountryCode>(
    ALL_COUNTRY_CODES.find(c => c.code === 'GB') || ALL_COUNTRY_CODES[0]
  )
  const [subTopics, setSubTopics] = useState<Topic[]>([...TOPICS])

  const toggleChannel = (key: string) =>
    setSubChannels(prev => prev.includes(key) ? prev.filter(c => c !== key) : [...prev, key])

  const toggleTopic = (topic: Topic) =>
    setSubTopics(prev => prev.includes(topic) ? prev.filter(t => t !== topic) : [...prev, topic])

  const handleSubscribe = async () => {
    if (subChannels.length === 0) return
    try {
      const normalizedChannels = subChannels.map(ch => ch === 'webpush' ? 'web' : ch)
      const formattedPhone = subPhone ? formatPhoneWithCountry(selectedCountry, subPhone) : ''

      if (subChannels.includes('webpush') && webPushStatus.enabled) {
        try {
          await subscribeToWebPush(subEmail)
          pushNotification?.('Web push notifications enabled', 'success')
        } catch (err: any) {
          const msg: string = err?.message || ''
          if (!msg.includes('not configured') && !msg.includes('public key')) {
            pushNotification?.('Web push setup failed', 'warning')
          }
        }
      }

      await apiSubscribe({
        email:         subEmail || null,
        phone:         formattedPhone || null,
        whatsapp:      formattedPhone || null,
        telegram_id:   subTelegramId || undefined,
        channels:      normalizedChannels,
        severity_filter: ['critical', 'warning', 'info'],
        topic_filter:  subTopics.length > 0 ? [...subTopics] : [...TOPICS],
      })

      pushNotification?.(
        `${'Subscribed to'}: ${normalizedChannels.join(', ')}`,
        'success'
      )
      onClose()
      //Reset form for next open
      setSubChannels([])
      setSubPhone('')
      setSubTelegramId('')
      setSubTopics([...TOPICS])
    } catch (err: any) {
      pushNotification?.(err?.message || 'Subscription failed', 'error')
    }
  }

  if (!isOpen) return null

  const displayName = user
    ? (user.displayName || [user.firstName, user.lastName].filter(Boolean).join(' ') || user.email || 'You')
    : null

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-md animate-scale-in"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-5 border-b border-gray-200/50 dark:border-gray-700/50 flex items-center justify-between">
          <h3 className="font-bold text-lg text-gray-900 dark:text-white flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-aegis-400 to-aegis-600 flex items-center justify-center">
              <Bell className="w-4 h-4 text-white" />
            </div>
            {'Subscribe to Alerts'}
          </h3>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-xl transition-all"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-3 max-h-[80vh] overflow-y-auto">
          {/* Signed-in badge */}
          {user && displayName && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-aegis-50 dark:bg-aegis-950/20 border border-aegis-200/60 dark:border-aegis-700/40">
              <CheckCircle className="w-4 h-4 text-aegis-500 shrink-0" />
              <p className="text-xs font-medium text-aegis-700 dark:text-aegis-300">
                Subscribing as <span className="font-semibold">{displayName}</span>
              </p>
            </div>
          )}

          {/* Channel picker */}
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {'Choose your notification channels'}
          </p>
          {CHANNELS.map(ch => (
            <button
              key={ch.key}
              onClick={() => toggleChannel(ch.key)}
              className={`w-full p-3.5 rounded-xl border-2 flex items-center gap-3 transition-all duration-200 ${
                subChannels.includes(ch.key)
                  ? 'border-aegis-500 bg-aegis-50/80 dark:bg-aegis-950/20 shadow-sm'
                  : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
              }`}
            >
              <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${ch.gradient} flex items-center justify-center`}>
                <ch.icon className="w-4 h-4 text-white" />
              </div>
              <span className="text-sm font-semibold flex-1 text-left">{ch.label}</span>
              {subChannels.includes(ch.key) && <CheckCircle className="w-5 h-5 text-aegis-500" />}
            </button>
          ))}

          {/* Email input */}
          {subChannels.includes('email') && (
            <input
              className="w-full px-4 py-2.5 text-sm bg-gray-100/80 dark:bg-gray-800/80 rounded-xl border border-gray-200/50 dark:border-gray-700/50 focus:ring-2 focus:ring-aegis-500/30 transition-all"
              placeholder={'your@email.com'}
              type="email"
              value={subEmail}
              onChange={e => setSubEmail(e.target.value)}
            />
          )}

          {/* Phone input (SMS / WhatsApp) */}
          {(subChannels.includes('sms') || subChannels.includes('whatsapp')) && (
            <div className="space-y-2">
              <div className="flex gap-2">
                <CountrySearch
                  countries={ALL_COUNTRY_CODES}
                  selected={selectedCountry}
                  onChange={setSelectedCountry}
                />
                <input
                  className="flex-1 px-4 py-2.5 text-sm bg-gray-100/80 dark:bg-gray-800/80 rounded-xl border border-gray-200/50 dark:border-gray-700/50 focus:ring-2 focus:ring-aegis-500/30 transition-all"
                  placeholder={selectedCountry.format}
                  type="tel"
                  value={subPhone}
                  onChange={e => setSubPhone(e.target.value)}
                />
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Example: {selectedCountry.dial} {selectedCountry.format}
              </p>
            </div>
          )}

          {/* Telegram ID input */}
          {subChannels.includes('telegram') && (
            <div className="space-y-2">
              <input
                className="w-full px-4 py-2.5 text-sm bg-gray-100/80 dark:bg-gray-800/80 rounded-xl border border-gray-200/50 dark:border-gray-700/50 focus:ring-2 focus:ring-aegis-500/30 transition-all"
                placeholder={'Your Telegram user ID'}
                type="text"
                value={subTelegramId}
                onChange={e => setSubTelegramId(e.target.value)}
              />
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {'Find your Telegram ID via @userinfobot'}
              </p>
            </div>
          )}

          {/* Web push status */}
          {subChannels.includes('webpush') && (
            <div className="bg-purple-50/80 dark:bg-purple-950/30 border border-purple-200/50 dark:border-purple-800/50 p-3.5 rounded-xl">
              {!webPushStatus.supported ? (
                <p className="text-xs text-red-700 dark:text-red-300">
                  {'Web push not supported in this browser'}
                </p>
              ) : webPushStatus.subscribed ? (
                <p className="text-xs text-green-700 dark:text-green-300">
                  {'Web push already enabled'}
                </p>
              ) : webPushStatus.enabled ? (
                <p className="text-xs text-purple-700 dark:text-purple-300">
                  {'Ready to enable'}
                </p>
              ) : (
                <p className="text-xs text-amber-700 dark:text-amber-300">
                  {'Setting up...'}
                </p>
              )}
            </div>
          )}

          {/* Alert topics */}
          <div>
            <p className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">
              {'Alert Topics'}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {TOPICS.map(topic => (
                <button
                  key={topic}
                  onClick={() => toggleTopic(topic)}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-medium border transition-all ${
                    subTopics.includes(topic)
                      ? 'border-aegis-500 bg-aegis-50 dark:bg-aegis-950/20 text-aegis-700 dark:text-aegis-300'
                      : 'border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:border-gray-300 dark:hover:border-gray-600'
                  }`}
                >
                  {topic.charAt(0).toUpperCase() + topic.slice(1)}
                </button>
              ))}
            </div>
          </div>

          {/* Submit */}
          <button
            onClick={handleSubscribe}
            disabled={subChannels.length === 0 || (subChannels.includes('webpush') && !webPushStatus.supported)}
            className="w-full bg-gradient-to-r from-aegis-500 to-aegis-700 hover:from-aegis-400 hover:to-aegis-600 disabled:from-gray-300 disabled:to-gray-400 disabled:cursor-not-allowed text-white py-3 rounded-xl font-bold text-sm transition-all shadow-lg shadow-aegis-600/20 hover:shadow-xl hover:scale-[1.01] active:scale-[0.99]"
          >
            {webPushLoading
              ? ('Setting up Web Push...')
              : ('Subscribe to Alerts')}
          </button>
        </div>
      </div>
    </div>
  )
}
