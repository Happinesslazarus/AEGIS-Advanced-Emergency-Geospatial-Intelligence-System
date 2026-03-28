 /*
 * AdminAlertBroadcast.tsx — Professional Emergency Alert Broadcast Console
 * Enterprise-grade multi-channel alert broadcasting with:
 * Severity-reactive visual design (critical/warning/advisory)
 * Confirmation dialog before broadcast
 * Loading state + double-click protection
 * Channel selector with visual indicators
 * Live message preview matching each channel's format
 * Message character counter with SMS segment estimator
 * Delivery result summary panel
 * Recent broadcast history
  */

import { useState, useMemo, useCallback } from 'react'
import {
  Siren, AlertTriangle, Shield, CheckCircle, Clock, MapPin, Send, Bell,
  FileText, MessageSquare, Globe, History, Radio, ChevronDown, ChevronUp,
  X, Zap, Eye, Info, Users, Hash, Wifi, Target, Lock
} from 'lucide-react'
import { apiCreateAlert, apiAuditLog } from '../../utils/api'
import type { Alert, Operator } from '../../types'
import { t } from '../../utils/i18n'
import { useLanguage } from '../../hooks/useLanguage'

/*  Types  */

interface Props {
  alerts: Alert[]
  auditLog: any[]
  setAuditLog: (fn: (prev: any[]) => any[]) => void
  pushNotification: (msg: string, type?: 'success' | 'warning' | 'error' | 'info', duration?: number) => number
  refreshAlerts: () => Promise<void>
  setView: (v: string) => void
  user: Operator | null
  locationName: string
}

type Severity = 'critical' | 'warning' | 'info'

interface ChannelState {
  web: boolean
  telegram: boolean
  email: boolean
  sms: boolean
  whatsapp: boolean
}

interface DeliveryResult {
  attempted: number
  sent: number
  failed: number
  results?: Array<{ channel: string; recipient: string; success: boolean; error?: string }>
}

/*  Severity Config  */

const SEVERITY_CONFIG = {
  critical: {
    label: 'Critical',
    desc: 'Immediate life-threatening danger',
    gradient: 'from-red-800 via-red-900 to-rose-900',
    headerBg: 'bg-gradient-to-br from-red-800 via-red-900 to-rose-900',
    dot: 'bg-red-500',
    activeBg: 'bg-red-100 dark:bg-red-950/30',
    activeText: 'text-red-700 dark:text-red-300',
    activeBorder: 'border-red-400 dark:border-red-600',
    ring: 'ring-red-400',
    badge: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
    previewBorder: 'border-red-500',
    previewBg: 'bg-red-50 dark:bg-red-950/20',
    btnGradient: 'from-red-600 to-rose-700 hover:from-red-700 hover:to-rose-800',
    btnShadow: 'shadow-red-500/25',
    iconPulse: true,
  },
  warning: {
    label: 'Warning',
    desc: 'Potential threat — take precautions',
    gradient: 'from-amber-700 via-amber-800 to-orange-800',
    headerBg: 'bg-gradient-to-br from-amber-700 via-amber-800 to-orange-800',
    dot: 'bg-amber-500',
    activeBg: 'bg-amber-100 dark:bg-amber-950/30',
    activeText: 'text-amber-700 dark:text-amber-300',
    activeBorder: 'border-amber-400 dark:border-amber-600',
    ring: 'ring-amber-400',
    badge: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
    previewBorder: 'border-amber-500',
    previewBg: 'bg-amber-50 dark:bg-amber-950/20',
    btnGradient: 'from-amber-600 to-orange-700 hover:from-amber-700 hover:to-orange-800',
    btnShadow: 'shadow-amber-500/25',
    iconPulse: false,
  },
  info: {
    label: 'Advisory',
    desc: 'Situational awareness update',
    gradient: 'from-blue-800 via-blue-900 to-indigo-900',
    headerBg: 'bg-gradient-to-br from-blue-800 via-blue-900 to-indigo-900',
    dot: 'bg-blue-500',
    activeBg: 'bg-blue-100 dark:bg-blue-950/30',
    activeText: 'text-blue-700 dark:text-blue-300',
    activeBorder: 'border-blue-400 dark:border-blue-600',
    ring: 'ring-blue-400',
    badge: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
    previewBorder: 'border-blue-500',
    previewBg: 'bg-blue-50 dark:bg-blue-950/20',
    btnGradient: 'from-blue-600 to-indigo-700 hover:from-blue-700 hover:to-indigo-800',
    btnShadow: 'shadow-blue-500/25',
    iconPulse: false,
  },
}

/*  Channel Config  */

function getChannels(lang: string): { key: keyof ChannelState; label: string; icon: any; bg: string; text: string; border: string; desc: string }[] {
  return [
    { key: 'web',      label: t('broadcast.webPush', lang),  icon: Bell,           bg: 'bg-blue-100 dark:bg-blue-900/30',    text: 'text-blue-600',    border: 'border-blue-400', desc: t('admin.alertBroadcast.browserNotifications', lang) },
    { key: 'telegram', label: t('broadcast.telegram', lang),  icon: Send,           bg: 'bg-sky-100 dark:bg-sky-900/30',      text: 'text-sky-600',     border: 'border-sky-400',  desc: t('admin.alertBroadcast.telegramBot', lang) },
    { key: 'email',    label: t('broadcast.email', lang),     icon: FileText,       bg: 'bg-emerald-100 dark:bg-emerald-900/30', text: 'text-emerald-600', border: 'border-emerald-400', desc: t('admin.alertBroadcast.emailHtml', lang) },
    { key: 'sms',      label: t('broadcast.sms', lang),       icon: MessageSquare,  bg: 'bg-violet-100 dark:bg-violet-900/30', text: 'text-violet-600',  border: 'border-violet-400', desc: t('admin.alertBroadcast.smsDesc', lang) },
    { key: 'whatsapp', label: t('broadcast.whatsapp', lang),  icon: Globe,          bg: 'bg-green-100 dark:bg-green-900/30',  text: 'text-green-600',   border: 'border-green-400', desc: t('admin.alertBroadcast.whatsappMsg', lang) },
  ]
}

/*  SMS segment estimator  */

function smsSegments(text: string): number {
  if (!text) return 0
  const hasMB = /[^\x00-\x7F]/.test(text)
  return hasMB ? Math.ceil(text.length / 70) : Math.ceil(text.length / 160)
}

export default function AdminAlertBroadcast({
  alerts, auditLog, setAuditLog, pushNotification, refreshAlerts, setView, user, locationName
}: Props) {
  const lang = useLanguage()
  const channelOptions = useMemo(() => getChannels(lang), [lang])
  //  Form state
  const [form, setForm] = useState({ title: '', message: '', severity: 'warning' as Severity, location: '' })
  const [channels, setChannels] = useState<ChannelState>({ web: true, telegram: true, email: true, sms: true, whatsapp: true })
  const [sending, setSending] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [deliveryResult, setDeliveryResult] = useState<DeliveryResult | null>(null)
  const [previewChannel, setPreviewChannel] = useState<'sms' | 'email' | 'telegram' | 'whatsapp' | 'web'>('email')
  const [showHistory, setShowHistory] = useState(true)

  const cfg = SEVERITY_CONFIG[form.severity]
  const activeChannels = useMemo(() => Object.entries(channels).filter(([, v]) => v).map(([k]) => k), [channels])
  const canSend = form.title.trim().length > 0 && form.message.trim().length > 0 && activeChannels.length > 0

  // SMS info
  const fullSmsText = useMemo(() => {
    const sev = form.severity === 'critical' ? 'CRITICAL' : form.severity === 'warning' ? 'WARNING' : 'ADVISORY'
    return `AEGIS ALERT [${sev}]\n\n${form.title}\n${form.location || locationName}\n\n${form.message}`
  }, [form, locationName])
  const segments = smsSegments(fullSmsText)

  //  Send handler
  const handleSend = useCallback(async () => {
    if (!canSend || sending) return
    setSending(true)
    setDeliveryResult(null)
    try {
      const response: any = await apiCreateAlert({
        title: form.title,
        message: form.message,
        severity: form.severity,
        locationText: form.location,
        channels: activeChannels,
      })
      await refreshAlerts()
      apiAuditLog({
        operator_name: user?.displayName,
        action: `Broadcast alert: ${form.title} via ${activeChannels.join(', ')}`,
        action_type: 'alert_send',
        target_type: 'alert',
      }).catch(() => {})
      setAuditLog(prev => [{
        id: Date.now(),
        operator_name: user?.displayName,
        action: `Broadcast alert: ${form.title} via ${activeChannels.join(', ')}`,
        action_type: 'alert_send',
        created_at: new Date().toISOString(),
      }, ...prev])

      const delivered = response?.delivery?.sent ?? 0
      const attempted = response?.delivery?.attempted ?? 0
      const failed = response?.delivery?.failed ?? 0

      setDeliveryResult({ attempted, sent: delivered, failed, results: response?.delivery?.results })

      if (attempted === 0) {
        pushNotification('Alert saved but no subscribers found. Citizens need to subscribe first.', 'warning')
      } else if (failed > 0) {
        pushNotification(`Broadcast complete: ${delivered}/${attempted} delivered, ${failed} failed. Check Delivery Log.`, 'warning')
      } else {
        pushNotification(`Broadcast successful: ${delivered}/${attempted} delivered via ${activeChannels.join(', ')}`, 'success')
      }
      setForm({ title: '', message: '', severity: 'warning', location: '' })
      setShowConfirm(false)
    } catch (err: any) {
      pushNotification(err?.message || 'Failed to send alert', 'error')
      setShowConfirm(false)
    } finally {
      setSending(false)
    }
  }, [canSend, sending, form, activeChannels, user, refreshAlerts, setAuditLog, pushNotification])

  //  Channel message preview
  const previewText = useMemo(() => {
    const sev = form.severity.toUpperCase()
    const title = form.title || 'Alert Title'
    const msg = form.message || 'Alert message will appear here...'
    const area = form.location || locationName || 'All Regions'
    switch (previewChannel) {
      case 'sms':
        return `AEGIS ALERT [${sev}]\n\n${title}\nArea: ${area}\n\n${msg}`
      case 'telegram':
        return `*AEGIS ALERT* [${sev}]\n\n*${title}*\nArea: ${area}\n\n${msg}\n\n---\nAutomated alert from AEGIS Emergency Management System.`
      case 'whatsapp':
        return `*AEGIS ALERT* [${sev}]\n\n*${title}*\nArea: ${area}\n\n${msg}\n\n---\nAutomated alert from AEGIS Emergency Management System.`
      case 'web':
        return `${sev}: ${title}\n\nArea: ${area}\n${msg}`
      default: // email
        return `Subject: ${sev} ALERT - ${title}\n\nAEGIS Emergency Management System\n\n${title}\nArea: ${area}\n\n${msg}\n\nThis is an automated alert from the AEGIS Emergency Management System.`
    }
  }, [form, previewChannel, locationName])

  return (
    <div className="max-w-3xl mx-auto animate-fade-in space-y-5">

      {/*  HEADER  */}
      <div className={`${cfg.headerBg} rounded-2xl shadow-2xl overflow-hidden relative`}>
        <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGNpcmNsZSBjeD0iMjAiIGN5PSIyMCIgcj0iMSIgZmlsbD0icmdiYSgyNTUsMjU1LDI1NSwwLjAzKSIvPjwvc3ZnPg==')] opacity-50" />
        <div className="relative z-10 p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className={`w-12 h-12 rounded-xl flex items-center justify-center border border-white/20 ${form.severity === 'critical' ? 'bg-red-500/20' : 'bg-white/10'}`}>
              <Siren className={`w-6 h-6 ${cfg.iconPulse ? 'text-red-200 animate-pulse' : 'text-white'}`} />
            </div>
            <div>
              <h2 className="text-slate-900 dark:text-white font-bold text-xl tracking-tight">{t('broadcast.title', lang)}</h2>
              <p className="text-slate-600 dark:text-white/60 text-sm">{t('broadcast.subtitle', lang)} &middot; {locationName || t('common.all', lang)}</p>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: t('alerts.title', lang), value: alerts.filter(a => a.active).length, icon: Radio, color: 'text-red-300' },
              { label: t('broadcast.channels', lang), value: `${activeChannels.length}/5`, icon: Wifi, color: 'text-green-300' },
              { label: t('broadcast.affectedArea', lang), value: locationName || t('common.all', lang), icon: Target, color: 'text-cyan-300' },
              { label: t('common.operator', lang), value: user?.displayName?.split(' ')[0] || t('common.system', lang), icon: Lock, color: 'text-purple-300' },
            ].map((s, i) => (
              <div key={i} className="bg-white/5 rounded-xl p-3 border border-white/10 hover:border-white/20 transition-colors">
                <div className="flex items-center gap-1.5 mb-1">
                  <s.icon className={`w-3 h-3 ${s.color} opacity-70`} />
                  <p className="text-[10px] text-white/50 uppercase tracking-wider font-semibold">{s.label}</p>
                </div>
                <p className={`text-lg font-bold ${s.color} truncate`}>{s.value}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/*  ALERT FORM  */}
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-lg overflow-hidden">
        <div className="p-5 space-y-5">

          {/* Severity Selection */}
          <div>
            <label className="text-xs font-bold text-gray-600 dark:text-gray-300 uppercase tracking-wider block mb-2">{t('broadcast.severityLevel', lang)}</label>
            <div className="grid grid-cols-3 gap-2">
              {(['critical', 'warning', 'info'] as Severity[]).map(sev => {
                const sc = SEVERITY_CONFIG[sev]
                const selected = form.severity === sev
                return (
                  <button
                    key={sev}
                    onClick={() => setForm(f => ({ ...f, severity: sev }))}
                    className={`p-3 rounded-xl border-2 text-left transition-all ${
                      selected
                        ? `${sc.activeBg} ${sc.activeText} ${sc.activeBorder} ring-2 ring-offset-1 ${sc.ring} shadow-md`
                        : 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 hover:border-gray-300 dark:hover:border-gray-600'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <div className={`w-3 h-3 rounded-full ${sc.dot} ${selected && sev === 'critical' ? 'animate-pulse' : ''}`} />
                      <span className="text-xs font-bold">{t(`admin.alertBroadcast.${sev === 'critical' ? 'critical' : sev === 'warning' ? 'warning' : 'advisory'}`, lang)}</span>
                    </div>
                    <p className="text-[10px] text-gray-500 dark:text-gray-300">{t(`admin.alertBroadcast.${sev === 'critical' ? 'criticalDesc' : sev === 'warning' ? 'warningDesc' : 'advisoryDesc'}`, lang)}</p>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Title */}
          <div>
            <label className="text-xs font-bold text-gray-600 dark:text-gray-300 uppercase tracking-wider block mb-1.5">{t('broadcast.titleLabel', lang)} <span className="text-red-500">*</span></label>
            <input
              className="w-full px-4 py-3 text-sm bg-gray-50 dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 focus:ring-2 focus:ring-purple-500 outline-none font-medium"
              placeholder={t('broadcast.titlePlaceholder', lang)}
              value={form.title}
              onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
              maxLength={200}
            />
            <div className="flex justify-between mt-1">
              <span className="text-[10px] text-gray-400 dark:text-gray-300">{form.title.length}/200</span>
            </div>
          </div>

          {/* Message */}
          <div>
            <label className="text-xs font-bold text-gray-600 dark:text-gray-300 uppercase tracking-wider block mb-1.5">{t('broadcast.messageLabel', lang)} <span className="text-red-500">*</span></label>
            <textarea
              className="w-full px-4 py-3 text-sm bg-gray-50 dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 focus:ring-2 focus:ring-purple-500 outline-none min-h-[120px] leading-relaxed resize-y"
              placeholder={t('admin.alertBroadcast.messagePlaceholder', lang)}
              value={form.message}
              onChange={e => setForm(f => ({ ...f, message: e.target.value }))}
            />
            <div className="flex items-center justify-between mt-1">
              <div className="flex items-center gap-3">
                <span className="text-[10px] text-gray-400 dark:text-gray-300">{form.message.length} {t('admin.alertBroadcast.charCount', lang)}</span>
                {channels.sms && form.message.length > 0 && (
                  <span className={`text-[10px] font-medium ${segments > 1 ? 'text-amber-600' : 'text-gray-400 dark:text-gray-300'}`}>
                    SMS: {segments} {t('admin.alertBroadcast.smsSegments', lang)}
                  </span>
                )}
              </div>
              {form.message.length > 0 && form.message.length < 20 && (
                <span className="text-[10px] text-amber-600 font-medium flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" /> {t('broadcast.messageShort', lang)}
                </span>
              )}
            </div>
          </div>

          {/* Location */}
          <div>
            <label className="text-xs font-bold text-gray-600 dark:text-gray-300 uppercase tracking-wider block mb-1.5">{t('broadcast.affectedArea', lang)}</label>
            <div className="relative">
              <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-300" />
              <input
                className="w-full pl-10 pr-4 py-3 text-sm bg-gray-50 dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 focus:ring-2 focus:ring-purple-500 outline-none"
                placeholder={t('broadcast.areaPlaceholder', lang)}
                value={form.location}
                onChange={e => setForm(f => ({ ...f, location: e.target.value }))}
              />
            </div>
          </div>
        </div>

        {/*  Channel Selector  */}
        <div className="px-5 pb-5">
          <div className="bg-gradient-to-br from-gray-50 to-slate-50 dark:from-gray-800/50 dark:to-gray-800/30 rounded-xl p-4 border border-gray-200 dark:border-gray-700">
            <div className="flex items-center justify-between mb-3">
              <div>
                <p className="text-xs font-bold text-gray-700 dark:text-gray-300 flex items-center gap-1.5">
                  <Send className="w-3.5 h-3.5 text-purple-500" /> {t('broadcast.deliveryChannels', lang)}
                </p>
                <p className="text-[10px] text-gray-500 dark:text-gray-300 mt-0.5">{activeChannels.length}/5 {t('common.active', lang)}</p>
              </div>
              <button
                onClick={() => setChannels({ web: true, telegram: true, email: true, sms: true, whatsapp: true })}
                className="text-[10px] font-semibold text-purple-600 dark:text-purple-400 hover:underline"
              >
                {t('common.selectAll', lang)}
              </button>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              {channelOptions.map(ch => {
                const active = channels[ch.key]
                const Icon = ch.icon
                return (
                  <label
                    key={ch.key}
                    className={`flex flex-col items-center gap-1.5 p-3 rounded-xl border-2 cursor-pointer transition-all text-center ${
                      active ? `${ch.bg} ${ch.border} shadow-sm` : 'border-gray-200 dark:border-gray-700 hover:border-gray-300'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={active}
                      onChange={e => setChannels(prev => ({ ...prev, [ch.key]: e.target.checked }))}
                      className="sr-only"
                    />
                    <div className={`w-8 h-8 rounded-lg ${active ? ch.bg : 'bg-gray-100 dark:bg-gray-800'} flex items-center justify-center`}>
                      <Icon className={`w-4 h-4 ${active ? ch.text : 'text-gray-400 dark:text-gray-300'}`} />
                    </div>
                    <span className={`text-[10px] font-bold ${active ? ch.text : 'text-gray-500 dark:text-gray-300'}`}>{ch.label}</span>
                    <span className={`text-[8px] font-bold uppercase tracking-wide ${active ? 'text-emerald-600' : 'text-gray-400 dark:text-gray-300'}`}>
                      {active ? t('common.active', lang) : t('common.off', lang)}
                    </span>
                  </label>
                )
              })}
            </div>
            {activeChannels.length === 0 && (
              <div className="mt-3 flex items-center gap-1.5 text-red-600">
                <AlertTriangle className="w-3.5 h-3.5" />
                <p className="text-[10px] font-bold">{t('admin.alertBroadcast.selectChannel', lang)}</p>
              </div>
            )}
          </div>
        </div>

        {/*  Message Preview  */}
        {(form.title || form.message) && (
          <div className="px-5 pb-5">
            <div className="bg-gray-50 dark:bg-gray-800/50 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
              {/* Preview tabs */}
              <div className="flex items-center gap-0 border-b border-gray-200 dark:border-gray-700">
                <div className="flex items-center gap-1 px-4 py-2 text-[10px] font-bold text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                  <Eye className="w-3 h-3" /> {t('admin.alertBroadcast.preview', lang)}
                </div>
                <div className="flex-1 flex gap-0 overflow-x-auto">
                  {(['email', 'sms', 'telegram', 'whatsapp', 'web'] as const).map(ch => (
                    <button
                      key={ch}
                      onClick={() => setPreviewChannel(ch)}
                      className={`px-3 py-2 text-[10px] font-bold uppercase tracking-wider transition-colors whitespace-nowrap ${
                        previewChannel === ch
                          ? 'text-purple-600 border-b-2 border-purple-600 bg-purple-50/50 dark:bg-purple-900/10'
                          : 'text-gray-400 dark:text-gray-300 hover:text-gray-600'
                      }`}
                    >
                      {ch}
                    </button>
                  ))}
                </div>
              </div>

              {/* Preview content */}
              <div className="p-4">
                <div className={`rounded-lg p-4 border-l-4 ${cfg.previewBorder} ${cfg.previewBg}`}>
                  <pre className="text-xs text-gray-700 dark:text-gray-300 whitespace-pre-wrap font-sans leading-relaxed">{previewText}</pre>
                </div>
                {previewChannel === 'sms' && (
                  <p className="text-[10px] text-gray-500 dark:text-gray-300 mt-2">
                    {t('admin.alertBroadcast.charCount', lang)}: {fullSmsText.length} / {segments} {t('admin.alertBroadcast.smsSegments', lang)}
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        {/*  Send Button  */}
        <div className="px-5 pb-5">
          <button
            onClick={() => setShowConfirm(true)}
            disabled={!canSend || sending}
            className={`w-full py-4 rounded-xl font-bold text-sm flex items-center justify-center gap-2.5 transition-all shadow-lg text-white disabled:from-gray-400 disabled:to-gray-500 disabled:cursor-not-allowed disabled:shadow-none bg-gradient-to-r ${cfg.btnGradient} ${cfg.btnShadow}`}
          >
            {sending ? (
              <>
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                {t('broadcast.sending', lang)}
              </>
            ) : (
              <>
                <Siren className="w-5 h-5" />
                {t('broadcast.broadcastAlert', lang)}
              </>
            )}
          </button>
          {!canSend && !sending && (
            <p className="text-[10px] text-gray-400 dark:text-gray-300 text-center mt-2">
              {!form.title && !form.message ? t('broadcast.fillTitleMsg', lang) :
               !form.title ? t('admin.alertBroadcast.titleRequired', lang) :
               !form.message ? t('admin.alertBroadcast.messageRequired', lang) :
               t('admin.alertBroadcast.selectChannel', lang)}
            </p>
          )}
        </div>
      </div>

      {/*  CONFIRMATION DIALOG  */}
      {showConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm animate-fade-in" onClick={() => !sending && setShowConfirm(false)}>
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl max-w-lg w-full mx-4 overflow-hidden border border-gray-200 dark:border-gray-700" onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div className={`p-5 ${cfg.headerBg}`}>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-white/10 rounded-xl flex items-center justify-center">
                  <AlertTriangle className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h3 className="text-slate-900 dark:text-white font-bold text-lg">{t('broadcast.confirmBroadcast', lang)}</h3>
                  <p className="text-slate-600 dark:text-white/60 text-xs">{t('broadcast.confirmMsg', lang)}</p>
                </div>
              </div>
            </div>
            {/* Body */}
            <div className="p-5 space-y-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-500 dark:text-gray-300 font-semibold uppercase">{t('broadcast.severity', lang)}</span>
                  <span className={`text-xs font-bold px-2 py-0.5 rounded ${cfg.badge}`}>{t(`admin.alertBroadcast.${form.severity === 'critical' ? 'critical' : form.severity === 'warning' ? 'warning' : 'advisory'}`, lang)}</span>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-xs text-gray-500 dark:text-gray-300 font-semibold uppercase">{t('broadcast.titleLabel', lang)}</span>
                  <span className="text-sm font-bold text-gray-900 dark:text-white">{form.title}</span>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-xs text-gray-500 dark:text-gray-300 font-semibold uppercase">{t('broadcast.messageLabel', lang)}</span>
                  <span className="text-xs text-gray-700 dark:text-gray-300 line-clamp-3">{form.message}</span>
                </div>
                {form.location && (
                  <div className="flex items-center gap-1">
                    <MapPin className="w-3 h-3 text-gray-400 dark:text-gray-300" />
                    <span className="text-xs text-gray-500 dark:text-gray-300">{form.location}</span>
                  </div>
                )}
                <div className="flex items-center gap-1">
                  <Send className="w-3 h-3 text-gray-400 dark:text-gray-300" />
                  <span className="text-xs text-gray-500 dark:text-gray-300">{t('broadcast.channelsLabel', lang)}: {activeChannels.join(', ')}</span>
                </div>
              </div>

              {form.severity === 'critical' && (
                <div className="bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 rounded-lg p-3">
                  <p className="text-[10px] font-bold text-red-600 flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" />
                    {t('broadcast.criticalAlert', lang)}: {t('broadcast.criticalWarning', lang)}
                  </p>
                </div>
              )}
            </div>
            {/* Actions */}
            <div className="px-5 pb-5 flex gap-3">
              <button
                onClick={() => setShowConfirm(false)}
                disabled={sending}
                className="flex-1 py-3 px-4 rounded-xl text-sm font-semibold bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
              >
                {t('common.cancel', lang)}
              </button>
              <button
                onClick={handleSend}
                disabled={sending}
                className={`flex-1 py-3 px-4 rounded-xl text-sm font-bold text-white flex items-center justify-center gap-2 transition-all bg-gradient-to-r ${cfg.btnGradient} ${cfg.btnShadow} shadow-lg disabled:opacity-50`}
              >
                {sending ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    {t('broadcast.sending', lang)}
                  </>
                ) : (
                  <>
                    <Siren className="w-4 h-4" />
                    {t('broadcast.confirmBroadcast', lang)}
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/*  DELIVERY RESULT  */}
      {deliveryResult && (
        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-lg overflow-hidden animate-fade-in">
          <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
            <h3 className="text-sm font-bold text-gray-900 dark:text-white flex items-center gap-2">
              {deliveryResult.failed === 0 ? (
                <CheckCircle className="w-4 h-4 text-emerald-500" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-amber-500" />
              )}
              {t('broadcast.deliverySummary', lang)}
            </h3>
            <button onClick={() => setDeliveryResult(null)} className="text-gray-400 dark:text-gray-300 hover:text-gray-600"><X className="w-4 h-4" /></button>
          </div>
          <div className="p-5">
            <div className="grid grid-cols-3 gap-3 mb-4">
              <div className="bg-blue-50 dark:bg-blue-900/20 rounded-xl p-3 text-center">
                <p className="text-xl font-bold text-blue-600">{deliveryResult.attempted}</p>
                <p className="text-[10px] text-blue-500 font-semibold uppercase">{t('delivery.attempted', lang)}</p>
              </div>
              <div className="bg-emerald-50 dark:bg-emerald-900/20 rounded-xl p-3 text-center">
                <p className="text-xl font-bold text-emerald-600">{deliveryResult.sent}</p>
                <p className="text-[10px] text-emerald-500 font-semibold uppercase">{t('delivery.delivered', lang)}</p>
              </div>
              <div className={`rounded-xl p-3 text-center ${deliveryResult.failed > 0 ? 'bg-red-50 dark:bg-red-900/20' : 'bg-gray-50 dark:bg-gray-800'}`}>
                <p className={`text-xl font-bold ${deliveryResult.failed > 0 ? 'text-red-600' : 'text-gray-400 dark:text-gray-300'}`}>{deliveryResult.failed}</p>
                <p className={`text-[10px] font-semibold uppercase ${deliveryResult.failed > 0 ? 'text-red-500' : 'text-gray-400 dark:text-gray-300'}`}>{t('delivery.failed', lang)}</p>
              </div>
            </div>
            {deliveryResult.attempted > 0 && (
              <div className="w-full h-2 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-emerald-500 to-emerald-400 rounded-full transition-all"
                  style={{ width: `${Math.round((deliveryResult.sent / deliveryResult.attempted) * 100)}%` }}
                />
              </div>
            )}
            {deliveryResult.results && deliveryResult.results.length > 0 && (
              <div className="mt-4 space-y-1.5">
                <p className="text-[10px] font-bold text-gray-500 dark:text-gray-300 uppercase mb-2">{t('delivery.channelResults', lang)}</p>
                {deliveryResult.results.slice(0, 10).map((r, i) => (
                  <div key={i} className="flex items-center justify-between text-xs py-1.5 px-2 rounded-lg bg-gray-50 dark:bg-gray-800/50">
                    <div className="flex items-center gap-2">
                      <div className={`w-2 h-2 rounded-full ${r.success ? 'bg-emerald-500' : 'bg-red-500'}`} />
                      <span className="font-medium text-gray-700 dark:text-gray-300 capitalize">{r.channel}</span>
                      <span className="text-gray-400 dark:text-gray-300 font-mono text-[10px] truncate max-w-[150px]">{r.recipient}</span>
                    </div>
                    {r.success ? (
                      <span className="text-[10px] text-emerald-600 font-semibold">{t('delivery.delivered', lang)}</span>
                    ) : (
                      <span className="text-[10px] text-red-500 font-medium truncate max-w-[200px]">{r.error || t('delivery.failed', lang)}</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/*  RECENT BROADCASTS  */}
      {alerts.length > 0 && (
        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-lg overflow-hidden">
          <button
            onClick={() => setShowHistory(!showHistory)}
            className="w-full px-5 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-800/30 transition-colors"
          >
            <h3 className="text-sm font-bold text-gray-900 dark:text-white flex items-center gap-2">
              <History className="w-4 h-4 text-gray-500 dark:text-gray-300" /> {t('broadcast.recentBroadcasts', lang)}
            </h3>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-gray-500 dark:text-gray-300">{alerts.length} {t('common.total', lang)}</span>
              {showHistory ? <ChevronUp className="w-3.5 h-3.5 text-gray-400 dark:text-gray-300" /> : <ChevronDown className="w-3.5 h-3.5 text-gray-400 dark:text-gray-300" />}
            </div>
          </button>
          {showHistory && (
            <div className="divide-y divide-gray-100 dark:divide-gray-800 max-h-[250px] overflow-y-auto">
              {alerts.slice(0, 8).map(a => {
                const sev = (a.severity || '').toLowerCase()
                const sevCfg = sev === 'high' || sev === 'critical'
                  ? { dot: 'bg-red-500', badge: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300', label: sev }
                  : sev === 'medium' || sev === 'warning'
                  ? { dot: 'bg-amber-500', badge: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300', label: sev }
                  : { dot: 'bg-blue-500', badge: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300', label: sev }
                return (
                  <div key={a.id} className="px-5 py-3 flex items-center gap-3 hover:bg-gray-50 dark:hover:bg-gray-800/20 transition-colors">
                    <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${sevCfg.dot} ${(sev === 'high' || sev === 'critical') ? 'animate-pulse' : ''}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-gray-900 dark:text-white truncate">{a.title}</p>
                      <p className="text-[10px] text-gray-500 dark:text-gray-300 mt-0.5">
                        {new Date(a.timestamp || Date.now()).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                        {a.area ? ` \u00B7 ${a.area}` : ''}
                      </p>
                    </div>
                    <span className={`text-[9px] px-2 py-0.5 rounded-full font-bold ${sevCfg.badge}`}>
                      {sevCfg.label}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
