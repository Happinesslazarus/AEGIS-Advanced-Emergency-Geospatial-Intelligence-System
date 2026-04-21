import React, { useState } from 'react'
import {
  ShieldAlert, CheckCircle, CircleDot, AlertTriangle,
  Send, Loader2, MapPin, Clock, ChevronRight, Users,
} from 'lucide-react'
import { t } from '../../utils/i18n'
import { useLanguage } from '../../hooks/useLanguage'
import { timeAgo } from '../../utils/helpers'

export default function SafetyTab({ submitSafetyCheckIn, recentSafety, onFamilyCheckIn }: any) {
  const lang = useLanguage()
  const [status, setStatus] = useState<'safe' | 'help' | 'unsure'>('safe')
  const [message, setMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState(false)

  const handleSubmit = async () => {
    setSubmitting(true)
    setSuccess(false)
    let lat: number | undefined, lng: number | undefined
    try {
      const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 5000 })
      )
      lat = pos.coords.latitude
      lng = pos.coords.longitude
    } catch {}
    const ok = await submitSafetyCheckIn(status, message || undefined, lat, lng)
    setSubmitting(false)
    if (ok) { setSuccess(true); setMessage(''); setTimeout(() => setSuccess(false), 3000) }
  }

  const statusConfig = {
    safe: { gradient: 'from-emerald-500 to-green-600', bg: 'bg-emerald-50 dark:bg-emerald-950/20', border: 'border-emerald-500', text: 'text-emerald-700 dark:text-emerald-300', ring: 'ring-emerald-200 dark:ring-emerald-900' },
    unsure: { gradient: 'from-amber-500 to-orange-500', bg: 'bg-amber-50 dark:bg-amber-950/20', border: 'border-amber-500', text: 'text-amber-700 dark:text-amber-300', ring: 'ring-amber-200 dark:ring-amber-900' },
    help: { gradient: 'from-red-500 to-rose-600', bg: 'bg-red-50 dark:bg-red-950/20', border: 'border-red-500', text: 'text-red-700 dark:text-red-300', ring: 'ring-red-200 dark:ring-red-900' },
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-extrabold text-gray-900 dark:text-white flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-emerald-500 to-green-600 flex items-center justify-center shadow-md">
              <ShieldAlert className="w-4 h-4 text-white" />
            </div>
            {'Safety Check-in'}
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{'Let your community know you are safe'}</p>
        </div>
      </div>

      {/* Check-in Card */}
      <div className="glass-card rounded-2xl p-6 space-y-5">
        <p className="text-sm text-gray-600 dark:text-gray-400">{'Select your current safety status'}</p>

        {/* Status Buttons -- Large & Prominent */}
        <div className="grid grid-cols-3 gap-3">
          {[
            { key: 'safe' as const, label: 'I\'m Safe', icon: CheckCircle, desc: 'I am safe' },
            { key: 'unsure' as const, label: 'Unsure', icon: CircleDot, desc: 'I\'m not sure' },
            { key: 'help' as const, label: 'Need Help', icon: AlertTriangle, desc: 'I need help' },
          ].map(s => {
            const cfg = statusConfig[s.key]
            const isActive = status === s.key
            return (
              <button key={s.key} onClick={() => setStatus(s.key)}
                className={`relative p-5 rounded-2xl border-2 transition-all duration-300 text-center group ${
                  isActive
                    ? `${cfg.border} ${cfg.bg} shadow-lg`
                    : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600 bg-white dark:bg-gray-800/50'
                }`}>
                {isActive && <div className="absolute -top-px -left-px -right-px h-1 rounded-t-2xl bg-gradient-to-r ${cfg.gradient}" />}
                <div className={`w-12 h-12 rounded-2xl mx-auto mb-2 flex items-center justify-center transition-all ${
                  isActive ? `bg-gradient-to-br ${cfg.gradient} shadow-lg` : 'bg-gray-100 dark:bg-gray-700'
                }`}>
                  <s.icon className={`w-6 h-6 ${isActive ? 'text-white' : 'text-gray-400 dark:text-gray-400'}`} />
                </div>
                <p className={`text-sm font-bold ${isActive ? cfg.text : 'text-gray-600 dark:text-gray-400'}`}>{s.label}</p>
                <p className={`text-[10px] mt-0.5 ${isActive ? cfg.text.replace('700', '500').replace('300', '400') : 'text-gray-400 dark:text-gray-400'}`}>{s.desc}</p>
              </button>
            )
          })}
        </div>

        {/* Message Input */}
        <div className="relative">
          <textarea
            value={message}
            onChange={e => setMessage(e.target.value)}
            placeholder={'Optional message (e.g. at home, trapped, need medical help)'}
            className="w-full px-4 py-3 text-sm bg-gray-50 dark:bg-gray-800/60 rounded-xl border border-gray-200 dark:border-gray-700 focus:ring-2 focus:ring-aegis-500 focus:border-transparent transition resize-none"
            rows={2}
          />
          <MapPin className="absolute right-3 bottom-3 w-4 h-4 text-gray-300 dark:text-gray-400" />
        </div>

        {/* Submit Button */}
        <button onClick={handleSubmit} disabled={submitting}
          className={`w-full py-3.5 rounded-xl font-bold text-sm text-white flex items-center justify-center gap-2 transition-all duration-200 hover:scale-[1.01] active:scale-[0.99] shadow-lg ${
            status === 'help' ? 'bg-gradient-to-r from-red-600 to-rose-600 shadow-red-200/50 dark:shadow-red-900/30' : status === 'unsure' ? 'bg-gradient-to-r from-amber-500 to-orange-500 shadow-amber-200/50 dark:shadow-amber-900/30' : 'bg-gradient-to-r from-emerald-500 to-green-600 shadow-emerald-200/50 dark:shadow-emerald-900/30'
          } disabled:opacity-50 disabled:scale-100`}>
          {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          {'Submit Check-in'}
        </button>

        {/* Success Message */}
        {success && (
          <div className="bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 text-emerald-700 p-3.5 rounded-xl flex items-center gap-2 text-sm animate-scale-in">
            <CheckCircle className="w-4 h-4 flex-shrink-0" /> {'Check-in submitted successfully!'}
          </div>
        )}
      </div>

      {/* Family Check-In CTA */}
      {onFamilyCheckIn && (
        <button onClick={onFamilyCheckIn}
          className="w-full glass-card rounded-2xl p-5 text-left transition-all duration-300 group hover-lift border-2 border-transparent hover:border-pink-300 dark:hover:border-pink-800">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 bg-gradient-to-br from-pink-500 to-rose-500 rounded-2xl flex items-center justify-center text-white group-hover:scale-110 transition-transform shadow-lg shadow-pink-200/50 dark:shadow-pink-900/30">
              <Users className="w-7 h-7" />
            </div>
            <div className="flex-1">
              <p className="text-base font-bold text-pink-700 dark:text-pink-300 group-hover:text-pink-600">Family Check-In</p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Share your safety status with trusted contacts via SMS or share</p>
            </div>
            <ChevronRight className="w-5 h-5 text-gray-300 dark:text-gray-400 group-hover:text-pink-400 group-hover:translate-x-1 transition-all" />
          </div>
        </button>
      )}

      {/* Recent Check-ins Timeline */}
      {recentSafety && recentSafety.length > 0 && (
        <div className="glass-card rounded-2xl overflow-hidden">
          <h3 className="px-5 py-3.5 border-b border-gray-100 dark:border-gray-800/80 text-sm font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <Clock className="w-4 h-4 text-gray-400 dark:text-gray-400" /> {'Recent Check-ins'}
          </h3>
          <div className="divide-y divide-gray-100/80 dark:divide-gray-800/60">
            {recentSafety.map((c: any, idx: number) => (
              <div key={c.id} className="px-5 py-3.5 flex items-center gap-3.5 hover:bg-gray-50/50 dark:hover:bg-gray-800/30 transition-colors">
                <div className="flex flex-col items-center">
                  <div className={`w-3 h-3 rounded-full ring-4 ${
                    c.status === 'safe' ? 'bg-emerald-500 ring-emerald-100 dark:ring-emerald-950/50' : c.status === 'help' ? 'bg-red-500 ring-red-100 dark:ring-red-950/50' : 'bg-amber-500 ring-amber-100 dark:ring-amber-950/50'
                  }`} />
                  {idx < recentSafety.length - 1 && <div className="w-px h-full bg-gray-200 dark:bg-gray-700 mt-1" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900 dark:text-white capitalize">{c.status}</p>
                  {c.message && <p className="text-[11px] text-gray-500 dark:text-gray-400 truncate mt-0.5">{c.message}</p>}
                </div>
                <span className="text-[10px] text-gray-400 dark:text-gray-400 flex-shrink-0">{timeAgo(c.created_at)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
