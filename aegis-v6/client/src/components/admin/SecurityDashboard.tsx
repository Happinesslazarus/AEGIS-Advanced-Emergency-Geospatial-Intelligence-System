/**
 * Security monitoring dashboard (threat indicators and alerts).
 *
 * - Rendered inside AdminPage.tsx based on active view */

import { useState, useEffect, useCallback } from 'react'
import {
  ShieldCheck, AlertTriangle, Lock, Monitor, RefreshCw,
  Trash2, Eye, Users, Activity, ChevronDown, ChevronUp,
  Shield, Smartphone, Settings,
} from 'lucide-react'
import { apiFetch } from '../../utils/api'
import { SECURITY_SEVERITY_CLASSES } from '../../utils/colorTokens'
import { t } from '../../utils/i18n'
import { useLanguage } from '../../hooks/useLanguage'

interface SecurityAlert {
  id: string
  operatorId: string | null
  alertType: string
  severity: string
  title: string
  message: string
  ipAddress: string | null
  createdAt: string
}

interface FailedOperator {
  operatorId: string
  email: string
  displayName: string
  failedAttempts: number
  lastFailedAt: string
}

interface TrustedDevice {
  id: string
  deviceName: string
  ipAddress: string | null
  trustedAt: string
  expiresAt: string
  lastUsedAt: string
  isExpired: boolean
}

interface AlertPreferences {
  alert_on_2fa_disabled: boolean
  alert_on_backup_code_used: boolean
  alert_on_new_device_login: boolean
  alert_on_suspicious_access: boolean
  alert_on_lockout: boolean
}

const SEVERITY_COLORS: Record<string, string> = SECURITY_SEVERITY_CLASSES

const SEVERITY_ICONS: Record<string, React.ElementType> = {
  critical: AlertTriangle,
  warning: Shield,
  info: Eye,
}

export default function SecurityDashboard(): JSX.Element {
  const lang = useLanguage()
  const [alerts, setAlerts] = useState<SecurityAlert[]>([])
  const [stats, setStats] = useState<Record<string, number>>({})
  const [failures, setFailures] = useState<FailedOperator[]>([])
  const [devices, setDevices] = useState<TrustedDevice[]>([])
  const [preferences, setPreferences] = useState<AlertPreferences | null>(null)
  const [loading, setLoading] = useState(true)
  const [expandedSections, setExpandedSections] = useState({
    alerts: true, stats: true, failures: true, devices: true, preferences: false,
  })
  const [error, setError] = useState('')

  const toggleSection = (section: keyof typeof expandedSections) => {
    setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }))
  }

  const loadData = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [alertsRes, statsRes, failuresRes, devicesRes, prefsRes] = await Promise.all([
        apiFetch<{ alerts: SecurityAlert[] }>('/api/security/dashboard/alerts?limit=50').catch(() => ({ alerts: [] as SecurityAlert[] })),
        apiFetch<{ stats: Record<string, number>; hours: number }>('/api/security/dashboard/stats?hours=24').catch(() => ({ stats: {} as Record<string, number>, hours: 24 })),
        apiFetch<{ operators: FailedOperator[] }>('/api/security/dashboard/failures?limit=10').catch(() => ({ operators: [] as FailedOperator[] })),
        apiFetch<{ devices: TrustedDevice[] }>('/api/security/devices').catch(() => ({ devices: [] as TrustedDevice[] })),
        apiFetch<AlertPreferences>('/api/security/preferences').catch(() => null),
      ])
      setAlerts(alertsRes.alerts || [])
      setStats(statsRes.stats || {})
      setFailures(failuresRes.operators || [])
      setDevices(devicesRes.devices || [])
      if (prefsRes) setPreferences(prefsRes)
    } catch {
      setError(t('security.loadFailed', lang))
    } finally {
      setLoading(false)
    }
  }, [lang])

  useEffect(() => { loadData() }, [loadData])

  //Keyboard shortcuts
  const [showKeyboard, setShowKeyboard] = useState(false)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      const key = e.key.toLowerCase()
      if (key === 'r' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); loadData() }
      else if (key === '?' || (e.shiftKey && key === '/')) { e.preventDefault(); setShowKeyboard(p => !p) }
      else if (key === 'escape') setShowKeyboard(false)
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [loadData])

  const revokeDevice = async (deviceId: string) => {
    try {
      await apiFetch(`/api/security/devices/${deviceId}`, { method: 'DELETE' })
      setDevices(prev => prev.filter(d => d.id !== deviceId))
    } catch {
      setError(t('security.revokeFailed', lang))
    }
  }

  const revokeAllDevices = async () => {
    if (!window.confirm(t('security.revokeAllConfirm', lang))) return
    try {
      await apiFetch('/api/security/devices', { method: 'DELETE' })
      setDevices([])
    } catch {
      setError(t('security.revokeAllFailed', lang))
    }
  }

  const updatePreference = async (key: keyof AlertPreferences, value: boolean) => {
    if (!preferences) return
    const updated = { ...preferences, [key]: value }
    setPreferences(updated)
    try {
      await apiFetch('/api/security/preferences', {
        method: 'PUT',
        body: JSON.stringify(updated),
      })
    } catch {
      setPreferences(preferences) // revert
      setError(t('security.prefFailed', lang))
    }
  }

  const formatDate = (d: string) => {
    try { return new Date(d).toLocaleString() } catch { return d }
  }

  const totalEvents = Object.values(stats).reduce((a, b) => a + b, 0)

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <RefreshCw className="w-6 h-6 animate-spin text-aegis-500" />
        <span className="ml-2 text-gray-500">{t('security.loading', lang)}</span>
      </div>
    )
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-red-500 to-red-700 flex items-center justify-center shadow-lg">
            <ShieldCheck className="w-5 h-5 text-white" />
          </div>
          <div>
            <h2 className="text-lg font-extrabold text-gray-900 dark:text-white">{t('security.title', lang)}</h2>
            <p className="text-xs text-gray-500 dark:text-gray-400">{t('security.subtitle', lang)}</p>
          </div>
        </div>
        <button onClick={loadData} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors" title={t('common.refresh', lang)}>
          <RefreshCw className="w-4 h-4 text-gray-500" />
        </button>
      </div>

      {error && (
        <div className="bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 px-3 py-2.5 rounded-xl text-sm">
          {error}
        </div>
      )}

      {/* Stats Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard icon={Activity} label={t('security.events24h', lang)} value={totalEvents} color="blue" />
        <StatCard icon={AlertTriangle} label={t('security.alertsLabel', lang)} value={alerts.length} color="red" />
        <StatCard icon={Users} label={t('security.failedOps', lang)} value={failures.length} color="amber" />
        <StatCard icon={Monitor} label={t('security.trustedDevices', lang)} value={devices.length} color="green" />
      </div>

      {/* Security Alerts */}
      <CollapsibleSection
        title={t('security.securityAlerts', lang)}
        icon={AlertTriangle}
        expanded={expandedSections.alerts}
        onToggle={() => toggleSection('alerts')}
        badge={alerts.filter(a => a.severity === 'critical').length}
        badgeColor="red"
      >
        {alerts.length === 0 ? (
          <p className="text-sm text-gray-400 dark:text-gray-400 py-4 text-center">{t('security.noAlerts', lang)}</p>
        ) : (
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {alerts.slice(0, 20).map(alert => {
              const SevIcon = SEVERITY_ICONS[alert.severity] || Eye
              return (
                <div key={alert.id} className={`p-3 rounded-lg border text-sm ${SEVERITY_COLORS[alert.severity] || SEVERITY_COLORS.info}`}>
                  <div className="flex items-start gap-2">
                    <SevIcon className="w-4 h-4 mt-0.5 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold">{alert.title}</div>
                      <p className="text-xs opacity-80 mt-0.5">{alert.message}</p>
                      <div className="flex items-center gap-3 mt-1 text-[10px] opacity-60">
                        <span>{formatDate(alert.createdAt)}</span>
                        {alert.ipAddress && <span>IP: {alert.ipAddress}</span>}
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </CollapsibleSection>

      {/* Event Stats */}
      <CollapsibleSection
        title={t('security.eventStats', lang)}
        icon={Activity}
        expanded={expandedSections.stats}
        onToggle={() => toggleSection('stats')}
      >
        {Object.keys(stats).length === 0 ? (
          <p className="text-sm text-gray-400 dark:text-gray-400 py-4 text-center">{t('security.noEvents', lang)}</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {Object.entries(stats).sort(([, a], [, b]) => b - a).map(([type, count]) => (
              <div key={type} className="bg-gray-50 dark:bg-gray-800/50 rounded-lg p-3 text-center">
                <div className="text-lg font-bold text-gray-900 dark:text-white">{count}</div>
                <div className="text-[10px] text-gray-500 dark:text-gray-400 truncate" title={type}>
                  {type.replace(/_/g, ' ')}
                </div>
              </div>
            ))}
          </div>
        )}
      </CollapsibleSection>

      {/* Failed Login Operators */}
      <CollapsibleSection
        title={t('security.failedOps24h', lang)}
        icon={Lock}
        expanded={expandedSections.failures}
        onToggle={() => toggleSection('failures')}
        badge={failures.length}
        badgeColor="amber"
      >
        {failures.length === 0 ? (
          <p className="text-sm text-gray-400 dark:text-gray-400 py-4 text-center">{t('security.noFailures', lang)}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                  <th className="pb-2 font-medium">{t('common.operator', lang)}</th>
                  <th className="pb-2 font-medium">{t('security.email', lang)}</th>
                  <th className="pb-2 font-medium text-center">{t('security.failures', lang)}</th>
                  <th className="pb-2 font-medium">{t('security.lastFailed', lang)}</th>
                </tr>
              </thead>
              <tbody>
                {failures.map(op => (
                  <tr key={op.operatorId} className="border-b border-gray-100 dark:border-gray-800">
                    <td className="py-2 font-medium text-gray-900 dark:text-white">{op.displayName}</td>
                    <td className="py-2 text-gray-500 dark:text-gray-400">{op.email}</td>
                    <td className="py-2 text-center">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${
                        op.failedAttempts >= 10 ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' :
                        op.failedAttempts >= 5 ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' :
                        'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'
                      }`}>
                        {op.failedAttempts}
                      </span>
                    </td>
                    <td className="py-2 text-xs text-gray-400">{formatDate(op.lastFailedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CollapsibleSection>

      {/* Trusted Devices */}
      <CollapsibleSection
        title={t('security.yourDevices', lang)}
        icon={Smartphone}
        expanded={expandedSections.devices}
        onToggle={() => toggleSection('devices')}
        badge={devices.length}
        badgeColor="green"
      >
        {devices.length === 0 ? (
          <p className="text-sm text-gray-400 dark:text-gray-400 py-4 text-center">{t('security.noDevices', lang)}</p>
        ) : (
          <>
            <div className="space-y-2">
              {devices.map(device => (
                <div key={device.id} className={`flex items-center justify-between p-3 rounded-lg border ${
                  device.isExpired
                    ? 'bg-gray-50 dark:bg-gray-800/30 border-gray-200 dark:border-gray-700 opacity-60'
                    : 'bg-white dark:bg-gray-800/50 border-gray-200 dark:border-gray-700'
                }`}>
                  <div className="flex items-center gap-3">
                    <Monitor className="w-5 h-5 text-gray-400" />
                    <div>
                      <div className="text-sm font-medium text-gray-900 dark:text-white">{device.deviceName}</div>
                      <div className="flex items-center gap-2 text-[10px] text-gray-400">
                        {device.ipAddress && <span>IP: {device.ipAddress}</span>}
                        <span>Last used: {formatDate(device.lastUsedAt)}</span>
                        {device.isExpired && <span className="text-red-400 font-semibold">{t('security.expired', lang)}</span>}
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => revokeDevice(device.id)}
                    className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 text-gray-400 hover:text-red-500 transition-colors"
                    title={t('security.revokeTrust', lang)}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
            {devices.length > 1 && (
              <button
                onClick={revokeAllDevices}
                className="mt-3 text-xs text-red-500 hover:text-red-600 flex items-center gap-1"
              >
                <Trash2 className="w-3 h-3" /> {t('security.revokeAll', lang)}
              </button>
            )}
          </>
        )}
      </CollapsibleSection>

      {/* Alert Preferences */}
      <CollapsibleSection
        title={t('security.alertPrefs', lang)}
        icon={Settings}
        expanded={expandedSections.preferences}
        onToggle={() => toggleSection('preferences')}
      >
        {preferences ? (
          <div className="space-y-3">
            <PreferenceToggle
              label={t('security.pref2faDisabled', lang)}
              description={t('security.pref2faDisabledDesc', lang)}
              checked={preferences.alert_on_2fa_disabled}
              onChange={v => updatePreference('alert_on_2fa_disabled', v)}
            />
            <PreferenceToggle
              label={t('security.prefBackupUsed', lang)}
              description={t('security.prefBackupUsedDesc', lang)}
              checked={preferences.alert_on_backup_code_used}
              onChange={v => updatePreference('alert_on_backup_code_used', v)}
            />
            <PreferenceToggle
              label={t('security.prefNewDevice', lang)}
              description={t('security.prefNewDeviceDesc', lang)}
              checked={preferences.alert_on_new_device_login}
              onChange={v => updatePreference('alert_on_new_device_login', v)}
            />
            <PreferenceToggle
              label={t('security.prefSuspicious', lang)}
              description={t('security.prefSuspiciousDesc', lang)}
              checked={preferences.alert_on_suspicious_access}
              onChange={v => updatePreference('alert_on_suspicious_access', v)}
            />
            <PreferenceToggle
              label={t('security.prefLockout', lang)}
              description={t('security.prefLockoutDesc', lang)}
              checked={preferences.alert_on_lockout}
              onChange={v => updatePreference('alert_on_lockout', v)}
            />
          </div>
        ) : (
          <p className="text-sm text-gray-400 py-4 text-center">{t('security.noPrefs', lang)}</p>
        )}
      </CollapsibleSection>

      {showKeyboard && (
        <div className="mt-3 bg-gray-900 text-white rounded-xl p-3 flex items-center gap-4 flex-wrap text-[10px] font-mono ring-1 ring-gray-700">
          <span className="font-bold text-gray-400 uppercase tracking-wider mr-1">{t('security.shortcuts', lang)}</span>
          <span><kbd className="px-1.5 py-0.5 bg-gray-700 rounded text-white">R</kbd> {t('common.refresh', lang)}</span>
          <span><kbd className="px-1.5 py-0.5 bg-gray-700 rounded text-white">?</kbd> {t('security.toggleShortcuts', lang)}</span>
          <span><kbd className="px-1.5 py-0.5 bg-gray-700 rounded text-white">{t('common.esc', lang)}</kbd> {t('common.close', lang)}</span>
        </div>
      )}
    </div>
  )
}

//Sub-components

function StatCard({ icon: Icon, label, value, color }: {
  icon: React.ElementType; label: string; value: number; color: string
}) {
  const colorMap: Record<string, string> = {
    blue: 'from-blue-500 to-blue-700',
    red: 'from-red-500 to-red-700',
    amber: 'from-amber-500 to-amber-700',
    green: 'from-emerald-500 to-emerald-700',
  }

  return (
    <div className="bg-white/80 dark:bg-gray-900/80 backdrop-blur-xl rounded-xl border border-gray-200/80 dark:border-gray-700/50 p-4 shadow-sm">
      <div className="flex items-center gap-2 mb-2">
        <div className={`w-7 h-7 rounded-lg bg-gradient-to-br ${colorMap[color] || colorMap.blue} flex items-center justify-center`}>
          <Icon className="w-3.5 h-3.5 text-white" />
        </div>
        <span className="text-[10px] font-medium text-gray-500 dark:text-gray-400">{label}</span>
      </div>
      <div className="text-2xl font-extrabold text-gray-900 dark:text-white">{value}</div>
    </div>
  )
}

function CollapsibleSection({ title, icon: Icon, expanded, onToggle, badge, badgeColor, children }: {
  title: string; icon: React.ElementType; expanded: boolean; onToggle: () => void
  badge?: number; badgeColor?: string; children: React.ReactNode
}) {
  const badgeColorMap: Record<string, string> = {
    red: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
    amber: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
    green: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  }

  return (
    <div className="bg-white/80 dark:bg-gray-900/80 backdrop-blur-xl rounded-xl border border-gray-200/80 dark:border-gray-700/50 shadow-sm overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between p-4 hover:bg-gray-50 dark:hover:bg-gray-800/30 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Icon className="w-4 h-4 text-gray-500" />
          <span className="text-sm font-bold text-gray-900 dark:text-white">{title}</span>
          {badge !== undefined && badge > 0 && (
            <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${badgeColorMap[badgeColor || 'red']}`}>
              {badge}
            </span>
          )}
        </div>
        {expanded ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
      </button>
      {expanded && <div className="px-4 pb-4">{children}</div>}
    </div>
  )
}

function PreferenceToggle({ label, description, checked, onChange }: {
  label: string; description: string; checked: boolean; onChange: (v: boolean) => void
}) {
  return (
    <label className="flex items-center justify-between p-3 rounded-lg bg-gray-50 dark:bg-gray-800/30 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800/50 transition-colors">
      <div>
        <div className="text-sm font-medium text-gray-900 dark:text-white">{label}</div>
        <div className="text-[10px] text-gray-500 dark:text-gray-400">{description}</div>
      </div>
      <div className="relative">
        <input
          type="checkbox"
          checked={checked}
          onChange={e => onChange(e.target.checked)}
          className="sr-only peer"
        />
        <div className="w-9 h-5 bg-gray-200 dark:bg-gray-700 peer-checked:bg-aegis-500 rounded-full transition-colors" />
        <div className="absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full peer-checked:translate-x-4 transition-transform shadow-sm" />
      </div>
    </label>
  )
}
