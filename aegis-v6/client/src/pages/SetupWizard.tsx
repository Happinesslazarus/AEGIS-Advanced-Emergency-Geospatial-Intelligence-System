/**
 * The first-run onboarding wizard for new AEGIS installations. Walks the
 * first administrator through initial configuration: region settings,
 * notification channels (email, SMS, Telegram), map source selection,
 * and admin account creation. Calls the setup API which seeds the database.
 *
 * - Routed by client/src/App.tsx at /admin (shown when setup is incomplete)
 * - Calls GET /api/admin/setup/status and POST /api/admin/setup/complete
 * - After completion, reloads to the main AdminPage dashboard
 *
 * - server/src/routes/setupRoutes.ts  — the setup completion API endpoints
 * - server/src/utils/setupDatabase.ts — database seeding logic
 */

import React, { useState, useEffect, useCallback } from 'react'
import {
  Shield, ChevronRight, ChevronLeft, Check, MapPin, Bell,
  Globe, Loader2, AlertTriangle, CheckCircle2, Settings,
  Mail, MessageSquare, Smartphone, Radio, Wifi, Lock,
  Server, Zap, Eye, RefreshCw, Search
} from 'lucide-react'
import { useTheme } from '../contexts/ThemeContext'
import { apiSetupRegion, apiSetupNotifications, apiSetupComplete } from '../utils/api'
import type { Operator } from '../types'
import { codeToFlag, COUNTRY_CODES } from '../data/countryCodes'
import LanguageDropdown from '../components/shared/LanguageDropdown'
import ThemeSelector from '../components/ui/ThemeSelector'
import { useLanguage } from '../hooks/useLanguage'

/* Types */

interface SetupWizardProps {
  user: Operator
  onComplete: () => void
  setupStatus: {
    isFirstRun: boolean
    setupCompleted: boolean
    hasAdmin: boolean
    configuredRegion: string | null
    notificationChannelsConfigured: boolean
  }
}

interface RegionOption {
  id: string
  name: string
  country: string
  description: string
  icon: string
}

interface NotificationChannels {
  email: boolean
  sms: boolean
  push: boolean
  webhook: boolean
}

type Step = 1 | 2 | 3 | 4

/* Constants */

// Build region list from all countries + EU bloc + Custom
const _countryRegions: RegionOption[] = [...COUNTRY_CODES]
  .sort((a, b) => a.name.localeCompare(b.name))
  .map(c => ({
    id: `${c.code.toLowerCase()}-default`,
    name: c.name,
    country: c.code,
    description: `${c.name} deployment region`,
    icon: c.flag,
  }))

const REGION_OPTIONS: RegionOption[] = [
  { id: 'eu-default', name: 'European Union', country: 'EU', description: 'EU member states coordination', icon: codeToFlag('EU') },
  ..._countryRegions,
  { id: 'custom', name: 'Custom Region', country: 'UN', description: 'Configure a custom deployment region', icon: codeToFlag('UN') },
]

const STEPS: { label: string; icon: React.ElementType }[] = [
  { label: 'Admin Account', icon: Shield },
  { label: 'Region', icon: Globe },
  { label: 'Notifications', icon: Bell },
  { label: 'Review', icon: Check },
]

/* Component */

export default function SetupWizard({ user, onComplete, setupStatus }: SetupWizardProps): JSX.Element {
  const { dark } = useTheme()

  // Wizard state
  const [step, setStep] = useState<Step>(1)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Region state
  const [selectedRegion, setSelectedRegion] = useState<string>(setupStatus.configuredRegion ?? '')
  const [customRegionName, setCustomRegionName] = useState('')
  const [availableRegions, setAvailableRegions] = useState<RegionOption[]>(REGION_OPTIONS)
  const [regionSearch, setRegionSearch] = useState('')
  const lang = useLanguage()

  // Notification state
  const [channels, setChannels] = useState<NotificationChannels>({
    email: true,
    sms: false,
    push: true,
    webhook: false,
  })
  const [webhookUrl, setWebhookUrl] = useState('')

  // Fetch server-side regions with proper cancellation
  useEffect(() => {
    const controller = new AbortController()
    ;(async () => {
      try {
        const base = String(import.meta.env.VITE_API_BASE_URL || '')
        const res = await globalThis.fetch(`${base}/api/config/regions`, { signal: controller.signal })
        if (controller.signal.aborted) return
        if (res.ok) {
          const data = await res.json()
          if (controller.signal.aborted) return
          const serverRegions: RegionOption[] = []
          // Map known region IDs to ISO-2 country codes for flag emoji lookup
          const REGION_COUNTRY_MAP: Record<string, string> = {
            scotland: 'GB', england: 'GB', wales: 'GB', 'northern-ireland': 'GB',
            ireland: 'IE', france: 'FR', germany: 'DE', spain: 'ES',
            italy: 'IT', netherlands: 'NL', 'united-states': 'US', canada: 'CA',
            australia: 'AU', 'new-zealand': 'NZ', japan: 'JP', china: 'CN',
            india: 'IN', brazil: 'BR', 'south-africa': 'ZA', nigeria: 'NG',
          }
          const resolveFlag = (id: string, country: string): string => {
            const iso = (country || REGION_COUNTRY_MAP[id.toLowerCase()] || '').toUpperCase()
            if (iso.length === 2 && /^[A-Z]{2}$/.test(iso)) return codeToFlag(iso)
            return '\uD83C\uDF0D' // 🌍 globe fallback
          }
          // Merge adapter regions
          if (data.adapterRegions?.length) {
            for (const r of data.adapterRegions) {
              if (!REGION_OPTIONS.find(o => o.id === r.id)) {
                const country = r.countryCode || r.country || ''
                serverRegions.push({
                  id: r.id,
                  name: r.name,
                  country,
                  description: `${r.name} region`,
                  icon: resolveFlag(r.id, country),
                })
              }
            }
          }
          // Merge legacy regions
          if (data.regions?.length) {
            for (const r of data.regions) {
              if (!REGION_OPTIONS.find(o => o.id === r.id) && !serverRegions.find(o => o.id === r.id)) {
                const country = r.country || ''
                serverRegions.push({
                  id: r.id,
                  name: r.name,
                  country,
                  description: `${r.name} region`,
                  icon: resolveFlag(r.id, country),
                })
              }
            }
          }
          if (serverRegions.length) {
            setAvailableRegions([...REGION_OPTIONS.filter(r => r.id !== 'custom'), ...serverRegions, REGION_OPTIONS[REGION_OPTIONS.length - 1]])
          }
          // Auto-select active region from server if none chosen
          if (!selectedRegion && data.activeRegion) {
            setSelectedRegion(data.activeRegion)
          }
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return
        /* Fallback to static list */
      }
    })()
    return () => controller.abort()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  /* Navigation */

  const canGoNext = useCallback((): boolean => {
    switch (step) {
      case 1: return true // Admin confirmed by virtue of being here
      case 2: return !!selectedRegion && (selectedRegion !== 'custom' || customRegionName.trim().length > 0)
      case 3: return Object.values(channels).some(Boolean)
      case 4: return true
      default: return false
    }
  }, [step, selectedRegion, customRegionName, channels])

  const goNext = async () => {
    if (!canGoNext()) return
    setError(null)

    // Save state at each step
    if (step === 2) {
      try {
        setSaving(true)
        const regionToSave = selectedRegion === 'custom' ? `custom:${customRegionName.trim()}` : selectedRegion
        await apiSetupRegion(regionToSave)
      } catch (e: any) {
        setError(e.message || 'Failed to save region')
        return
      } finally {
        setSaving(false)
      }
    }

    if (step === 3) {
      try {
        setSaving(true)
        await apiSetupNotifications({
          ...channels,
          ...(channels.webhook && webhookUrl ? { webhookUrl } : {}),
        })
      } catch (e: any) {
        setError(e.message || 'Failed to save notification settings')
        return
      } finally {
        setSaving(false)
      }
    }

    if (step < 4) setStep((step + 1) as Step)
  }

  const goPrev = () => {
    setError(null)
    if (step > 1) setStep((step - 1) as Step)
  }

  const finalize = async () => {
    try {
      setSaving(true)
      setError(null)
      await apiSetupComplete()
      onComplete()
    } catch (e: any) {
      setError(e.message || 'Failed to complete setup')
    } finally {
      setSaving(false)
    }
  }

  /* Stepper */

  const Stepper = () => (
    <div className="flex items-center justify-center mb-8" role="list" aria-label="Setup steps">
      {STEPS.map((s, i) => {
        const stepNum = (i + 1) as Step
        const Icon = s.icon
        const isActive = step === stepNum
        const isComplete = step > stepNum
        return (
          <React.Fragment key={i}>
            {i > 0 && (
              <div className={`h-0.5 w-12 sm:w-20 mx-1 transition-colors duration-300 ${
                isComplete ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-700'
              }`} />
            )}
            <div className="flex flex-col items-center" role="listitem">
              <div
                aria-current={isActive ? 'step' : undefined}
                aria-label={`Step ${stepNum} of ${STEPS.length}: ${s.label}${isComplete ? ' (completed)' : isActive ? ' (current)' : ''}`}
                className={`w-10 h-10 rounded-full flex items-center justify-center transition-all duration-300 ${
                isComplete
                  ? 'bg-green-500 text-white'
                  : isActive
                    ? 'bg-aegis-600 text-white ring-4 ring-aegis-200 dark:ring-aegis-900'
                    : 'bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400'
              }`}>
                {isComplete ? <Check size={18} /> : <Icon size={18} />}
              </div>
              <span className={`text-xs mt-1.5 font-medium whitespace-nowrap ${
                isActive ? 'text-aegis-600 dark:text-aegis-400' : 'text-gray-500 dark:text-gray-400'
              }`}>{s.label}</span>
            </div>
          </React.Fragment>
        )
      })}
    </div>
  )

  /* Step 1: Admin account confirmation */

  const StepAdmin = () => (
    <div className="space-y-6">
      <div className="text-center space-y-2">
        <div className="w-16 h-16 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center mx-auto">
          <CheckCircle2 className="text-green-600 dark:text-green-400" size={32} />
        </div>
        <h3 className="text-xl font-semibold text-gray-900 dark:text-white">Admin Account Active</h3>
        <p className="text-gray-600 dark:text-gray-400 max-w-md mx-auto">
          Your administrator account has been created and is ready. This account has full system privileges.
        </p>
      </div>

      <div className={`rounded-xl border p-6 ${dark ? 'bg-gray-800/50 border-gray-700' : 'bg-gray-50 border-gray-200'}`}>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Email</label>
            <p className="text-gray-900 dark:text-white font-medium mt-1">{user.email}</p>
          </div>
          <div>
            <label className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Display Name</label>
            <p className="text-gray-900 dark:text-white font-medium mt-1">{user.displayName || '-'}</p>
          </div>
          <div>
            <label className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Role</label>
            <div className="flex items-center gap-2 mt-1">
              <Shield size={14} className="text-aegis-500" />
              <span className="text-gray-900 dark:text-white font-medium capitalize">{user.role}</span>
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Security</label>
            <div className="flex items-center gap-2 mt-1">
              <Lock size={14} className="text-green-500" />
              <span className="text-green-700 dark:text-green-400 text-sm">Password policy enforced</span>
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-lg p-4 flex items-start gap-3 bg-warning-surface border border-muted">
        <AlertTriangle size={18} className="text-amber-500 mt-0.5 flex-shrink-0" />
        <div className="text-sm">
          <p className="font-medium text-amber-800 dark:text-amber-300">Security Reminder</p>
          <p className="text-amber-700 dark:text-amber-400 mt-1">
            Store your admin credentials securely. After setup, you can create additional operator accounts from the User Management panel.
          </p>
        </div>
      </div>
    </div>
  )

  /* Step 2: Region selection */

  const StepRegion = () => {
    const q = regionSearch.toLowerCase().trim()
    const filtered = q
      ? availableRegions.filter(r =>
          r.name.toLowerCase().includes(q) ||
          r.country.toLowerCase().includes(q) ||
          r.description.toLowerCase().includes(q)
        )
      : availableRegions

    return (
    <div className="space-y-5">
      <div className="text-center space-y-1">
        <h3 className="text-xl font-semibold text-gray-900 dark:text-white">Select Deployment Region</h3>
        <p className="text-gray-600 dark:text-gray-400 max-w-md mx-auto text-sm">
          Choose the primary operating region for emergency contacts, map defaults, and hazard data.
        </p>
      </div>

      {/* Search */}
      <div className="relative">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
        <input
          type="text"
          value={regionSearch}
          onChange={e => setRegionSearch(e.target.value)}
          placeholder={`Search ${availableRegions.length} countries…`}
          aria-label="Search deployment regions"
          className={`w-full pl-9 pr-4 py-2.5 rounded-lg border text-sm outline-none transition focus:ring-2 focus:ring-aegis-500/40 focus:border-aegis-400 ${
            dark
              ? 'bg-gray-800 border-gray-700 text-white placeholder-gray-500'
              : 'bg-white border-gray-200 text-gray-900 placeholder-gray-400'
          }`}
        />
      </div>

      {/* Results count */}
      {q && (
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {filtered.length} result{filtered.length !== 1 ? 's' : ''} for &ldquo;{regionSearch}&rdquo;
        </p>
      )}

      <div className="grid gap-2 sm:grid-cols-2 max-h-64 overflow-y-auto pr-0.5 -mr-0.5">
        {filtered.map(r => (
          <button
            key={r.id}
            onClick={() => setSelectedRegion(r.id)}
            className={`p-3 rounded-xl border text-left transition-all duration-150 ${
              selectedRegion === r.id
                ? 'border-aegis-500 bg-aegis-50 dark:bg-aegis-900/20 ring-2 ring-aegis-500/30'
                : dark
                  ? 'border-gray-700 bg-gray-800/50 hover:border-gray-600 hover:bg-gray-800'
                  : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50'
            }`}
          >
            <div className="flex items-center gap-2.5">
              <span className="text-xl flex-shrink-0">{r.icon}</span>
              <div className="min-w-0 flex-1">
                <p className={`text-sm font-semibold leading-tight ${
                  selectedRegion === r.id ? 'text-aegis-700 dark:text-aegis-300' : 'text-gray-900 dark:text-white'
                }`}>
                  {r.name}
                </p>
                <p className="text-[11px] text-gray-500 dark:text-gray-400 truncate">{r.country}</p>
              </div>
              {selectedRegion === r.id && (
                <Check size={16} className="text-aegis-500 flex-shrink-0" />
              )}
            </div>
          </button>
        ))}
        {filtered.length === 0 && (
          <div className="col-span-2 py-8 text-center text-sm text-gray-400 dark:text-gray-500">
            No regions match &ldquo;{regionSearch}&rdquo;
          </div>
        )}
      </div>
    </div>
    )
  }

  // Continuation of StepRegion JSX (custom input + info banner)
  const StepRegionExtras = () => (
    <div className="space-y-4 mt-4">
      {selectedRegion === 'custom' && (
        <div className={`rounded-xl border p-4 ${dark ? 'bg-gray-800/50 border-gray-700' : 'bg-gray-50 border-gray-200'}`}>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Custom Region Name
          </label>
          <input
            type="text"
            value={customRegionName}
            onChange={e => setCustomRegionName(e.target.value)}
            placeholder="e.g., Southeast Asia Flood Network"
            className={`w-full px-4 py-2.5 rounded-lg border focus:ring-2 focus:ring-aegis-500 focus:border-aegis-500 outline-none transition ${
              dark ? 'bg-gray-900 border-gray-600 text-white placeholder:text-gray-500'
                   : 'bg-white border-gray-300 text-gray-900 placeholder:text-gray-400'
            }`}
          />
        </div>
      )}

      {selectedRegion && selectedRegion !== 'custom' && (
        <div className="rounded-lg p-4 flex items-start gap-3 bg-info-surface border border-muted">
          <MapPin size={18} className="text-aegis-500 mt-0.5 flex-shrink-0" />
          <p className="text-sm text-aegis-800 dark:text-aegis-300">
            Region adapter will configure emergency numbers, flood zone data, weather authorities, and geospatial defaults
            for <strong>{availableRegions.find(r => r.id === selectedRegion)?.name}</strong>.
          </p>
        </div>
      )}
    </div>
  )

  /* Step 3: Notification channels */

  const StepNotifications = () => {
    const channelDefs: { key: keyof NotificationChannels; label: string; desc: string; icon: React.ElementType }[] = [
      { key: 'email', label: 'Email Alerts', desc: 'Send critical alerts and daily digests via email', icon: Mail },
      { key: 'sms', label: 'SMS Notifications', desc: 'Urgent incident alerts via SMS gateway', icon: Smartphone },
      { key: 'push', label: 'Push Notifications', desc: 'Browser and mobile push for real-time updates', icon: Radio },
      { key: 'webhook', label: 'Webhook Integration', desc: 'HTTP callbacks to external systems (Slack, Teams)', icon: Wifi },
    ]

    return (
      <div className="space-y-6">
        <div className="text-center space-y-2">
          <h3 className="text-xl font-semibold text-gray-900 dark:text-white">Notification Channels</h3>
          <p className="text-gray-600 dark:text-gray-400 max-w-md mx-auto">
            Enable the notification channels you want active. These can be refined later in System Settings.
          </p>
        </div>

        <fieldset className="space-y-3 border-0 p-0 m-0">
          <legend className="sr-only">Notification Channels</legend>
          {channelDefs.map(ch => {
            const Icon = ch.icon
            const active = channels[ch.key]
            return (
              <button
                key={ch.key}
                role="switch"
                aria-checked={active}
                onClick={() => setChannels(prev => ({ ...prev, [ch.key]: !prev[ch.key] }))}
                className={`w-full p-4 rounded-xl border text-left flex items-center gap-4 transition-all duration-200 ${
                  active
                    ? 'border-aegis-500 bg-aegis-50 dark:bg-aegis-900/20'
                    : dark
                      ? 'border-gray-700 bg-gray-800/50 hover:border-gray-600'
                      : 'border-gray-200 bg-white hover:border-gray-300'
                }`}
              >
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${
                  active ? 'bg-aegis-100 dark:bg-aegis-800/50' : 'bg-gray-100 dark:bg-gray-700'
                }`}>
                  <Icon size={20} className={active ? 'text-aegis-600 dark:text-aegis-400' : 'text-gray-400'} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className={`font-medium ${active ? 'text-aegis-700 dark:text-aegis-300' : 'text-gray-900 dark:text-white'}`}>
                    {ch.label}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">{ch.desc}</p>
                </div>
                <div className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 ${
                  active ? 'bg-aegis-600' : 'bg-gray-300 dark:bg-gray-600'
                }`}>
                  <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transform transition-transform ${
                    active ? 'translate-x-5.5 left-[1.375rem]' : 'left-0.5'
                  }`} />
                </div>
              </button>
            )
          })}
        </fieldset>

        {channels.webhook && (
          <div className={`rounded-xl border p-4 ${dark ? 'bg-gray-800/50 border-gray-700' : 'bg-gray-50 border-gray-200'}`}>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Webhook URL <span className="font-normal text-gray-400">(optional)</span>
            </label>
            {(() => {
              const isValidWebhookUrl = (url: string) => {
                if (!url) return null
                try { const u = new URL(url); return u.protocol === 'https:' ? 'valid' : 'invalid' }
                catch { return 'invalid' }
              }
              const webhookState = isValidWebhookUrl(webhookUrl)
              return (
                <>
                  <div className="relative">
                    <input
                      type="url"
                      value={webhookUrl}
                      onChange={e => setWebhookUrl(e.target.value)}
                      placeholder="https://hooks.slack.com/services/..."
                      className={`w-full px-4 py-2.5 rounded-lg border focus:ring-2 outline-none transition ${
                        webhookState === 'invalid' ? 'border-red-400 focus:ring-red-500/20 focus:border-red-500' :
                        webhookState === 'valid' ? 'border-green-500 focus:ring-green-500/20 focus:border-green-500' :
                        'focus:ring-aegis-500 focus:border-aegis-500'
                      } ${dark ? 'bg-gray-900 border-gray-600 text-white placeholder:text-gray-500' : 'bg-white border-gray-300 text-gray-900 placeholder:text-gray-400'}`}
                    />
                  </div>
                  {webhookState === 'invalid' && (
                    <p className="text-xs text-red-500 mt-1">Must be a valid HTTPS URL (e.g. https://hooks.slack.com/…)</p>
                  )}
                  {webhookState === 'valid' && (
                    <p className="text-xs text-green-600 dark:text-green-400 mt-1">✓ Valid HTTPS webhook URL</p>
                  )}
                  {!webhookState && (
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1.5">You can configure this later in System Settings → Webhooks.</p>
                  )}
                </>
              )
            })()}
          </div>
        )}
      </div>
    )
  }

  /* Step 4: Review & Activate */

  const StepReview = () => {
    const regionLabel = selectedRegion === 'custom'
      ? customRegionName || 'Custom Region'
      : availableRegions.find(r => r.id === selectedRegion)?.name || selectedRegion

    const activeChannels = (Object.entries(channels) as [keyof NotificationChannels, boolean][])
      .filter(([, v]) => v)
      .map(([k]) => k)

    return (
      <div className="space-y-6">
        <div className="text-center space-y-2">
          <div className="w-16 h-16 rounded-full bg-aegis-100 dark:bg-aegis-900/30 flex items-center justify-center mx-auto">
            <Eye className="text-aegis-600 dark:text-aegis-400" size={32} />
          </div>
          <h3 className="text-xl font-semibold text-gray-900 dark:text-white">Review Configuration</h3>
          <p className="text-gray-600 dark:text-gray-400 max-w-md mx-auto">
            Confirm your settings below, then activate to complete first-run setup.
          </p>
        </div>

        <div className={`rounded-xl border divide-y ${dark ? 'bg-gray-800/50 border-gray-700 divide-gray-700' : 'bg-white border-gray-200 divide-gray-100'}`}>
          {/* Admin */}
          <div className="p-4 flex items-center gap-4">
            <div className="w-9 h-9 rounded-lg bg-green-100 dark:bg-green-900/40 flex items-center justify-center flex-shrink-0">
              <Shield size={18} className="text-green-600 dark:text-green-400" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900 dark:text-white">Admin Account</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">{user.email} - <span className="capitalize">{user.role}</span></p>
            </div>
            <CheckCircle2 size={18} className="text-green-500 flex-shrink-0" />
          </div>

          {/* Region */}
          <div className="p-4 flex items-center gap-4">
            <div className="w-9 h-9 rounded-lg bg-aegis-100 dark:bg-aegis-900/40 flex items-center justify-center flex-shrink-0">
              <Globe size={18} className="text-aegis-600 dark:text-aegis-400" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900 dark:text-white">Region</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">{regionLabel}</p>
            </div>
            <CheckCircle2 size={18} className="text-green-500 flex-shrink-0" />
          </div>

          {/* Notifications */}
          <div className="p-4 flex items-center gap-4">
            <div className="w-9 h-9 rounded-lg bg-purple-100 dark:bg-purple-900/40 flex items-center justify-center flex-shrink-0">
              <Bell size={18} className="text-purple-600 dark:text-purple-400" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900 dark:text-white">Notifications</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {activeChannels.length ? activeChannels.map(c => c.charAt(0).toUpperCase() + c.slice(1)).join(', ') : 'None enabled'}
              </p>
            </div>
            {activeChannels.length > 0
              ? <CheckCircle2 size={18} className="text-green-500 flex-shrink-0" />
              : <AlertTriangle size={18} className="text-amber-500 flex-shrink-0" />
            }
          </div>
        </div>

        <div className={`rounded-lg p-4 flex items-start gap-3 ${dark ? 'bg-emerald-900/20 border border-emerald-800/30' : 'bg-emerald-50 border border-emerald-200'}`}>
          <Zap size={18} className="text-emerald-500 mt-0.5 flex-shrink-0" />
          <div className="text-sm">
            <p className="font-medium text-emerald-800 dark:text-emerald-300">Ready to Activate</p>
            <p className="text-emerald-700 dark:text-emerald-400 mt-1">
              Activating will mark the platform as operational. The setup wizard will not appear again unless explicitly reset from System Settings.
            </p>
          </div>
        </div>
      </div>
    )
  }

  /* Main render */

  return (
    <div className={`min-h-screen flex items-center justify-center p-4 sm:p-6 ${
      dark ? 'bg-gray-950' : 'bg-gradient-to-br from-slate-50 via-aegis-50 to-indigo-50'
    }`}>
      <div className={`w-full max-w-2xl rounded-2xl shadow-2xl border overflow-hidden ${
        dark ? 'bg-gray-900 border-gray-800' : 'bg-white border-gray-200'
      }`}>
        {/* Header */}
        <div className={`px-6 py-5 border-b ${dark ? 'border-gray-800 bg-gray-900' : 'border-gray-100 bg-gradient-to-r from-aegis-600 to-indigo-600'}`}>
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${dark ? 'bg-aegis-600' : 'bg-white/20'}`}>
              <Settings size={22} className="text-white" />
            </div>
            <div className="flex-1">
              <h1 className={`text-lg font-bold ${dark ? 'text-white' : 'text-white'}`}>AEGIS Platform Setup</h1>
              <p className={`text-sm ${dark ? 'text-gray-400' : 'text-aegis-100'}`}>First-run configuration wizard</p>
            </div>
            <div className="flex items-center gap-2 ml-auto">
              <LanguageDropdown darkNav={true} />
              <ThemeSelector darkNav={true} />
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="px-6 py-6">
          <Stepper />

          {/* Error */}
          {error && (
            <div className="mb-6 p-3 rounded-lg bg-danger-surface border border-muted flex items-center gap-2">
              <AlertTriangle size={16} className="text-red-500 flex-shrink-0" />
              <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
              <button onClick={() => setError(null)} className="ml-auto text-red-400 hover:text-red-600 text-sm">&times;</button>
            </div>
          )}

          {/* Step content */}
          {step === 1 && <StepAdmin />}
          {step === 2 && <><StepRegion /><StepRegionExtras /></>}
          {step === 3 && <StepNotifications />}
          {step === 4 && <StepReview />}
        </div>

        {/* Footer nav */}
        <div className={`px-6 py-4 border-t flex items-center justify-between ${dark ? 'border-gray-800 bg-gray-900/50' : 'border-gray-100 bg-gray-50'}`}>
          <button
            onClick={goPrev}
            disabled={step === 1}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
              step === 1
                ? 'text-gray-400 cursor-not-allowed'
                : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
            }`}
          >
            <ChevronLeft size={16} /> Back
          </button>

          <span className="text-xs text-gray-500 dark:text-gray-400">Step {step} of 4</span>

          {step < 4 ? (
            <button
              onClick={goNext}
              disabled={!canGoNext() || saving}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold transition-all ${
                canGoNext() && !saving
                  ? 'bg-aegis-600 text-white hover:bg-aegis-700 shadow-lg shadow-aegis-500/25'
                  : 'bg-gray-300 dark:bg-gray-700 text-gray-500 cursor-not-allowed'
              }`}
            >
              {saving ? <Loader2 size={16} className="animate-spin" /> : null}
              {saving ? 'Saving...' : 'Continue'}
              {!saving && <ChevronRight size={16} />}
            </button>
          ) : (
            <button
              onClick={finalize}
              disabled={saving}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold transition-all ${
                saving
                  ? 'bg-gray-300 dark:bg-gray-700 text-gray-500 cursor-not-allowed'
                  : 'bg-green-600 text-white hover:bg-green-700 shadow-lg shadow-green-500/25'
              }`}
            >
              {saving ? <Loader2 size={16} className="animate-spin" /> : <Zap size={16} />}
              {saving ? 'Activating...' : 'Activate Platform'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

