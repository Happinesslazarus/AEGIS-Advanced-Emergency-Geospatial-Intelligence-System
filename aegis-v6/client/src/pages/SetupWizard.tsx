/**
 * pages/SetupWizard.tsx — First-run onboarding wizard
 *
 * 4-step flow:
 *   1. Admin Account Confirmation
 *   2. Region Configuration
 *   3. Notification Channels
 *   4. Review & Activate
 *
 * Displayed for admin users when setup is incomplete.
 */

import React, { useState, useEffect, useCallback } from 'react'
import {
  Shield, ChevronRight, ChevronLeft, Check, MapPin, Bell,
  Globe, Loader2, AlertTriangle, CheckCircle2, Settings,
  Mail, MessageSquare, Smartphone, Radio, Wifi, Lock,
  Server, Zap, Eye, RefreshCw
} from 'lucide-react'
import { useTheme } from '../contexts/ThemeContext'
import { apiSetupRegion, apiSetupNotifications, apiSetupComplete } from '../utils/api'
import type { Operator } from '../types'
import { codeToFlag } from '../data/countryCodes'

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

const REGION_OPTIONS: RegionOption[] = [
  { id: 'uk-default', name: 'United Kingdom', country: 'GB', description: 'England, Scotland, Wales & Northern Ireland', icon: codeToFlag('GB') },
  { id: 'us-default', name: 'United States', country: 'US', description: 'CONUS & territorial coverage', icon: codeToFlag('US') },
  { id: 'eu-default', name: 'European Union', country: 'EU', description: 'EU member states coordination', icon: codeToFlag('EU') },
  { id: 'au-default', name: 'Australia', country: 'AU', description: 'Australian states & territories', icon: codeToFlag('AU') },
  { id: 'in-default', name: 'India', country: 'IN', description: 'Indian states & union territories', icon: codeToFlag('IN') },
  { id: 'jp-default', name: 'Japan', country: 'JP', description: 'Japanese prefectures', icon: codeToFlag('JP') },
  { id: 'custom', name: 'Custom Region', country: '', description: 'Configure a custom deployment region', icon: codeToFlag('UN') },
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

  // Notification state
  const [channels, setChannels] = useState<NotificationChannels>({
    email: true,
    sms: false,
    push: true,
    webhook: false,
  })
  const [webhookUrl, setWebhookUrl] = useState('')

  // Fetch server-side regions
  useEffect(() => {
    ;(async () => {
      try {
        const base = String(import.meta.env.VITE_API_BASE_URL || '')
        const res = await globalThis.fetch(`${base}/api/config/regions`)
        if (res.ok) {
          const data = await res.json()
          const serverRegions: RegionOption[] = []
          // Merge adapter regions
          if (data.adapterRegions?.length) {
            for (const r of data.adapterRegions) {
              if (!REGION_OPTIONS.find(o => o.id === r.id)) {
                serverRegions.push({
                  id: r.id,
                  name: r.name,
                  country: r.countryCode || r.country || '',
                  description: `${r.name} region`,
                  icon: '??',
                })
              }
            }
          }
          // Merge legacy regions
          if (data.regions?.length) {
            for (const r of data.regions) {
              if (!REGION_OPTIONS.find(o => o.id === r.id) && !serverRegions.find(o => o.id === r.id)) {
                serverRegions.push({
                  id: r.id,
                  name: r.name,
                  country: r.country || '',
                  description: `${r.name} region`,
                  icon: '??',
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
      } catch { /* Fallback to static list */ }
    })()
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
    <div className="flex items-center justify-center mb-8">
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
            <div className="flex flex-col items-center">
              <div className={`w-10 h-10 rounded-full flex items-center justify-center transition-all duration-300 ${
                isComplete
                  ? 'bg-green-500 text-white'
                  : isActive
                    ? 'bg-blue-600 text-white ring-4 ring-blue-200 dark:ring-blue-900'
                    : 'bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400'
              }`}>
                {isComplete ? <Check size={18} /> : <Icon size={18} />}
              </div>
              <span className={`text-xs mt-1.5 font-medium whitespace-nowrap ${
                isActive ? 'text-blue-600 dark:text-blue-400' : 'text-gray-500 dark:text-gray-400'
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
            <p className="text-gray-900 dark:text-white font-medium mt-1">{user.displayName || '—'}</p>
          </div>
          <div>
            <label className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Role</label>
            <div className="flex items-center gap-2 mt-1">
              <Shield size={14} className="text-blue-500" />
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

  const StepRegion = () => (
    <div className="space-y-6">
      <div className="text-center space-y-2">
        <h3 className="text-xl font-semibold text-gray-900 dark:text-white">Select Deployment Region</h3>
        <p className="text-gray-600 dark:text-gray-400 max-w-md mx-auto">
          Choose the primary operating region. This configures emergency contacts, map defaults, flood authorities, and hazard data sources.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {availableRegions.map(r => (
          <button
            key={r.id}
            onClick={() => setSelectedRegion(r.id)}
            className={`p-4 rounded-xl border text-left transition-all duration-200 ${
              selectedRegion === r.id
                ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 ring-2 ring-blue-500/30'
                : dark
                  ? 'border-gray-700 bg-gray-800/50 hover:border-gray-600 hover:bg-gray-800'
                  : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50'
            }`}
          >
            <div className="flex items-center gap-3">
              <span className="text-2xl">{r.icon}</span>
              <div className="min-w-0">
                <p className={`font-semibold ${selectedRegion === r.id ? 'text-blue-700 dark:text-blue-300' : 'text-gray-900 dark:text-white'}`}>
                  {r.name}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{r.description}</p>
              </div>
              {selectedRegion === r.id && (
                <Check size={18} className="text-blue-500 ml-auto flex-shrink-0" />
              )}
            </div>
          </button>
        ))}
      </div>

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
            className={`w-full px-4 py-2.5 rounded-lg border focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition ${
              dark ? 'bg-gray-900 border-gray-600 text-white placeholder:text-gray-500'
                   : 'bg-white border-gray-300 text-gray-900 placeholder:text-gray-400'
            }`}
          />
        </div>
      )}

      {selectedRegion && selectedRegion !== 'custom' && (
        <div className="rounded-lg p-4 flex items-start gap-3 bg-info-surface border border-muted">
          <MapPin size={18} className="text-blue-500 mt-0.5 flex-shrink-0" />
          <p className="text-sm text-blue-800 dark:text-blue-300">
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

        <div className="space-y-3">
          {channelDefs.map(ch => {
            const Icon = ch.icon
            const active = channels[ch.key]
            return (
              <button
                key={ch.key}
                onClick={() => setChannels(prev => ({ ...prev, [ch.key]: !prev[ch.key] }))}
                className={`w-full p-4 rounded-xl border text-left flex items-center gap-4 transition-all duration-200 ${
                  active
                    ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                    : dark
                      ? 'border-gray-700 bg-gray-800/50 hover:border-gray-600'
                      : 'border-gray-200 bg-white hover:border-gray-300'
                }`}
              >
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${
                  active ? 'bg-blue-100 dark:bg-blue-800/50' : 'bg-gray-100 dark:bg-gray-700'
                }`}>
                  <Icon size={20} className={active ? 'text-blue-600 dark:text-blue-400' : 'text-gray-400'} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className={`font-medium ${active ? 'text-blue-700 dark:text-blue-300' : 'text-gray-900 dark:text-white'}`}>
                    {ch.label}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">{ch.desc}</p>
                </div>
                <div className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 ${
                  active ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-600'
                }`}>
                  <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transform transition-transform ${
                    active ? 'translate-x-5.5 left-[1.375rem]' : 'left-0.5'
                  }`} />
                </div>
              </button>
            )
          })}
        </div>

        {channels.webhook && (
          <div className={`rounded-xl border p-4 ${dark ? 'bg-gray-800/50 border-gray-700' : 'bg-gray-50 border-gray-200'}`}>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Webhook URL (optional)
            </label>
            <input
              type="url"
              value={webhookUrl}
              onChange={e => setWebhookUrl(e.target.value)}
              placeholder="https://hooks.slack.com/services/..."
              className={`w-full px-4 py-2.5 rounded-lg border focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition ${
                dark ? 'bg-gray-900 border-gray-600 text-white placeholder:text-gray-500'
                     : 'bg-white border-gray-300 text-gray-900 placeholder:text-gray-400'
              }`}
            />
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1.5">
              You can configure this later in System Settings ? Webhooks.
            </p>
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
          <div className="w-16 h-16 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center mx-auto">
            <Eye className="text-blue-600 dark:text-blue-400" size={32} />
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
              <p className="text-xs text-gray-500 dark:text-gray-400">{user.email} — <span className="capitalize">{user.role}</span></p>
            </div>
            <CheckCircle2 size={18} className="text-green-500 flex-shrink-0" />
          </div>

          {/* Region */}
          <div className="p-4 flex items-center gap-4">
            <div className="w-9 h-9 rounded-lg bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center flex-shrink-0">
              <Globe size={18} className="text-blue-600 dark:text-blue-400" />
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
      dark ? 'bg-gray-950' : 'bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50'
    }`}>
      <div className={`w-full max-w-2xl rounded-2xl shadow-2xl border overflow-hidden ${
        dark ? 'bg-gray-900 border-gray-800' : 'bg-white border-gray-200'
      }`}>
        {/* Header */}
        <div className={`px-6 py-5 border-b ${dark ? 'border-gray-800 bg-gray-900' : 'border-gray-100 bg-gradient-to-r from-blue-600 to-indigo-600'}`}>
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${dark ? 'bg-blue-600' : 'bg-white/20'}`}>
              <Settings size={22} className="text-white" />
            </div>
            <div>
              <h1 className={`text-lg font-bold ${dark ? 'text-white' : 'text-white'}`}>AEGIS Platform Setup</h1>
              <p className={`text-sm ${dark ? 'text-gray-400' : 'text-blue-100'}`}>First-run configuration wizard</p>
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
          {step === 2 && <StepRegion />}
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
                  ? 'bg-blue-600 text-white hover:bg-blue-700 shadow-lg shadow-blue-500/25'
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
