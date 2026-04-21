import React, { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import {
  User, Camera, Pencil, Save, X, Mail, Shield, Heart,
  CheckCircle, Activity, Clock, Calendar, ChevronDown, MapPin, Loader2,
  Phone, Globe, Building2, Search, Plus,
} from 'lucide-react'
import { t } from '../../utils/i18n'
import { useLanguage } from '../../hooks/useLanguage'
import ALL_COUNTRY_CODES from '../../data/allCountryCodes'
import { REGION_MAP } from '../../data/allCountries'
import ProfileCountryPicker from '../../components/shared/ProfileCountryPicker'
import { getFlagUrl } from '../../data/worldRegions'
import { API_BASE } from '../../utils/helpers'

function ProfileRegionSelect({ value, onChange, country }: { value: string; onChange: (v: string) => void; country: string }) {
  const regions = REGION_MAP[country] || []
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const filtered = query.trim()
    ? regions.filter((r: any) => r.label.toLowerCase().includes(query.toLowerCase()))
    : regions

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50)
    else setQuery('')
  }, [open])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as Node
      if (ref.current && !ref.current.contains(target) && (!dropdownRef.current || !dropdownRef.current.contains(target))) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  if (regions.length === 0) {
    return (
      <input type="text" value={value} onChange={e => onChange(e.target.value)}
        placeholder="Type your region/city..."
        className="w-full px-3.5 py-2.5 text-sm bg-gray-50 dark:bg-gray-800/60 rounded-xl border border-gray-200 dark:border-gray-700 focus:ring-2 focus:ring-aegis-500 focus:border-transparent transition" />
    )
  }

  const selectedLabel = regions.find((r: any) => r.value === value || r.label === value)?.label || value

  const getPortalStyle = (): React.CSSProperties => {
    if (!ref.current) return {}
    const rect = ref.current.getBoundingClientRect()
    const spaceBelow = window.innerHeight - rect.bottom
    const goUp = spaceBelow < 260
    return {
      position: 'fixed',
      left: rect.left,
      width: rect.width,
      ...(goUp ? { bottom: window.innerHeight - rect.top + 4 } : { top: rect.bottom + 4 }),
      zIndex: 9999,
    }
  }

  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-3.5 py-2.5 text-sm bg-gray-50 dark:bg-gray-800/60 rounded-xl border border-gray-200 dark:border-gray-700 hover:border-aegis-400 transition text-left">
        <MapPin className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
        <span className="flex-1 text-gray-900 dark:text-white truncate">{selectedLabel || 'Select region...'}</span>
        <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && createPortal(
        <div ref={dropdownRef} className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-2xl overflow-hidden" style={getPortalStyle()}>
          <div className="p-2 border-b border-gray-100 dark:border-gray-800 flex items-center gap-2">
            <Search className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
            <input ref={inputRef} type="text" value={query} onChange={e => setQuery(e.target.value)}
              placeholder="Search or type region..." className="flex-1 bg-transparent text-sm outline-none text-gray-900 dark:text-white placeholder-gray-400" />
            {query && <button type="button" onClick={() => setQuery('')}><X className="w-3.5 h-3.5 text-gray-400" /></button>}
          </div>
          <div className="max-h-52 overflow-y-auto">
            {filtered.map((r: any) => (
              <button key={r.value} type="button"
                onClick={() => { onChange(r.label); setOpen(false) }}
                className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm hover:bg-aegis-50 dark:hover:bg-aegis-950/30 transition-colors text-left ${(r.value === value || r.label === value) ? 'bg-aegis-50 dark:bg-aegis-950/20 font-semibold' : ''}`}>
                <MapPin className="w-3 h-3 text-gray-400" />
                <span className="text-gray-900 dark:text-white">{r.label}</span>
              </button>
            ))}
            {filtered.length === 0 && query.trim() && (
              <button type="button" onClick={() => { onChange(query.trim()); setOpen(false) }}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm hover:bg-aegis-50 dark:hover:bg-aegis-950/30 transition-colors text-left text-aegis-600 font-medium">
                <Plus className="w-3.5 h-3.5" /> Use "{query.trim()}"
              </button>
            )}
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}

export default function ProfileTab({ user, updateProfile, uploadAvatar, refreshProfile }: any) {
  const lang = useLanguage()
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [msg, setMsg] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [form, setForm] = useState({
    displayName: user.displayName || '',
    phone: user.phone || '',
    bio: user.bio || '',
    country: user.country || 'United Kingdom',
    city: user.city || '',
    preferredRegion: user.preferredRegion || '',
    isVulnerable: user.isVulnerable || false,
    vulnerabilityDetails: user.vulnerabilityDetails || '',
    dateOfBirth: user.dateOfBirth || '',
  })

  const handleSave = async () => {
    setSaving(true)
    setMsg('')
    const ok = await updateProfile(form)
    setSaving(false)
    if (ok) {
      setMsg('Profile updated successfully')
      setEditing(false)
      refreshProfile()
      setTimeout(() => setMsg(''), 3000)
    } else {
      setMsg('Failed to update profile')
    }
  }

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    const result = await uploadAvatar(file)
    setUploading(false)
    if (result) {
      setMsg('Avatar updated successfully')
      refreshProfile()
      setTimeout(() => setMsg(''), 3000)
    } else {
      setMsg('Failed to update avatar')
    }
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6 animate-fade-in">
      {/* Profile Header with Cover */}
      <div className="glass-card rounded-2xl overflow-hidden">
        <div className="h-28 sm:h-36 bg-gradient-to-br from-aegis-500 via-aegis-600 to-aegis-800 relative">
          <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGRlZnM+PHBhdHRlcm4gaWQ9ImciIHdpZHRoPSI2MCIgaGVpZ2h0PSI2MCIgcGF0dGVyblVuaXRzPSJ1c2VyU3BhY2VPblVzZSI+PHBhdGggZD0iTTAgMGg2MHY2MEgweiIgZmlsbD0ibm9uZSIvPjxjaXJjbGUgY3g9IjMwIiBjeT0iMzAiIHI9IjEiIGZpbGw9InJnYmEoMjU1LDI1NSwyNTUsMC4wNSkiLz48L3BhdHRlcm4+PC9kZWZzPjxyZWN0IHdpZHRoPSIxMDAlIiBoZWlnaHQ9IjEwMCUiIGZpbGw9InVybCgjZykiLz48L3N2Zz4=')] opacity-40" />
          <div className="absolute top-3 right-3 flex gap-2">
            {!editing ? (
              <button onClick={() => setEditing(true)} className="flex items-center gap-1.5 bg-white/15 hover:bg-white/25 backdrop-blur-sm border border-white/20 text-white text-xs font-semibold px-3 py-2 rounded-xl transition-all">
                <Pencil className="w-3.5 h-3.5" /> {'Edit Profile'}
              </button>
            ) : (
              <>
                <button onClick={handleSave} disabled={saving} className="flex items-center gap-1.5 bg-white text-aegis-700 text-xs font-bold px-3 py-2 rounded-xl transition-all hover:bg-white/90 shadow-lg">
                  {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} {'Save'}
                </button>
                <button onClick={() => setEditing(false)} className="text-xs text-white/80 hover:text-white bg-white/15 backdrop-blur-sm border border-white/20 px-3 py-2 rounded-xl transition-all">{'Cancel'}</button>
              </>
            )}
          </div>
        </div>

        <div className="px-6 pb-5 -mt-12 sm:-mt-14 relative z-10">
          <div className="flex items-end gap-4">
            <div className="relative group flex-shrink-0">
              {user.avatarUrl ? (
                <img src={`${API_BASE}${user.avatarUrl}`} className="w-20 h-20 sm:w-24 sm:h-24 rounded-2xl object-cover border-4 border-white dark:border-gray-900 shadow-xl" alt="" />
              ) : (
                <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-2xl bg-gradient-to-br from-aegis-400 to-aegis-700 flex items-center justify-center text-white text-2xl sm:text-3xl font-bold border-4 border-white dark:border-gray-900 shadow-xl">
                  {user.displayName?.[0]?.toUpperCase()}
                </div>
              )}
              <button onClick={() => fileInputRef.current?.click()} disabled={uploading}
                className="absolute -bottom-1 -right-1 bg-aegis-600 hover:bg-aegis-700 text-white p-2 rounded-xl shadow-lg transition-all opacity-0 group-hover:opacity-100 hover:scale-110">
                {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Camera className="w-3.5 h-3.5" />}
              </button>
              <input ref={fileInputRef} type="file" accept="image/*" onChange={handleAvatarChange} className="hidden" />
            </div>
            <div className="min-w-0 pb-1">
              <h3 className="text-lg sm:text-xl font-extrabold text-gray-900 dark:text-white truncate">{user.displayName}</h3>
              <p className="text-sm text-gray-500 dark:text-gray-400 truncate">{user.email}</p>
              {user.isVulnerable && (
                <span className="inline-flex items-center gap-1 mt-1.5 text-[10px] font-semibold bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300 px-2 py-0.5 rounded-lg">
                  <Heart className="w-3 h-3" /> {'Priority Support'}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {msg && (
        <div className={`p-3.5 rounded-xl text-sm flex items-center gap-2 animate-scale-in ${msg.includes('success') || msg.includes('updated') ? 'bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 text-emerald-700' : 'bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 text-red-700'}`}>
          <CheckCircle className="w-4 h-4 flex-shrink-0" />{msg}
        </div>
      )}

      <div className="glass-card rounded-2xl p-6 space-y-4">
        <h3 className="text-sm font-bold text-gray-900 dark:text-white flex items-center gap-2">
          <User className="w-4 h-4 text-aegis-600" /> {'Personal Information'}
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[
            { label: 'Display Name', key: 'displayName', icon: User, value: user.displayName },
            { label: 'Phone', key: 'phone', icon: Phone, value: user.phone, placeholder: '+44 7700 900000' },
            { label: 'Country', key: 'country', icon: Globe, value: user.country },
            { label: 'City', key: 'city', icon: Building2, value: user.city, placeholder: 'Your city' },
            { label: 'Preferred Region', key: 'preferredRegion', icon: MapPin, value: user.preferredRegion, placeholder: 'Select your region' },
            { label: 'Date of Birth', key: 'dateOfBirth', icon: Calendar, type: 'date', value: user.dateOfBirth ? new Date(user.dateOfBirth).toLocaleDateString() : '' },
          ].map(field => (
            <div key={field.key}>
              <label className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1.5">
                <field.icon className="w-3 h-3" /> {field.label}
              </label>
              {editing ? (
                field.key === 'country' ? (
                  <ProfileCountryPicker value={form.country} onChange={(name: string) => setForm(f => ({ ...f, country: name, preferredRegion: '' }))} />
                ) : field.key === 'preferredRegion' ? (
                  <ProfileRegionSelect value={form.preferredRegion} onChange={(v: string) => setForm(f => ({ ...f, preferredRegion: v }))} country={form.country} />
                ) : (
                  <input
                    type={field.type || 'text'}
                    value={field.type === 'date' ? (form as any)[field.key]?.split?.('T')?.[0] || '' : (form as any)[field.key]}
                    onChange={e => setForm(f => ({ ...f, [field.key]: e.target.value }))}
                    className="w-full px-3.5 py-2.5 text-sm bg-gray-50 dark:bg-gray-800/60 rounded-xl border border-gray-200 dark:border-gray-700 focus:ring-2 focus:ring-aegis-500 focus:border-transparent transition"
                    placeholder={field.placeholder}
                  />
                )
              ) : (
                field.key === 'country' && field.value ? (
                  <p className="text-sm text-gray-900 dark:text-white py-2.5 px-1 flex items-center gap-2">
                    {(() => { const c = ALL_COUNTRY_CODES.find((cc: any) => cc.name === field.value); return c ? <img src={getFlagUrl(c.code.toLowerCase(), 20)} alt="" className="w-5 h-[14px] object-cover rounded-sm" /> : null })()}
                    {field.value}
                  </p>
                ) : (
                  <p className="text-sm text-gray-900 dark:text-white py-2.5 px-1 capitalize">{field.value || '--'}</p>
                )
              )}
            </div>
          ))}
        </div>

        <div>
          <label className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1.5">
            <Pencil className="w-3 h-3" /> {'Bio'}
          </label>
          {editing ? (
            <textarea value={form.bio} onChange={e => setForm(f => ({ ...f, bio: e.target.value }))}
              className="w-full px-3.5 py-2.5 text-sm bg-gray-50 dark:bg-gray-800/60 rounded-xl border border-gray-200 dark:border-gray-700 focus:ring-2 focus:ring-aegis-500 focus:border-transparent transition resize-none" rows={3}
              placeholder={'Tell us about yourself...'} />
          ) : (
            <p className="text-sm text-gray-900 dark:text-white py-2.5 px-1">{user.bio || '--'}</p>
          )}
        </div>
      </div>

      <div className="glass-card rounded-2xl p-6">
        <h3 className="text-sm font-bold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
          <Heart className="w-4 h-4 text-amber-500" /> {'Priority Assistance'}
        </h3>
        {editing ? (
          <div className="bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-950/20 dark:to-orange-950/10 border border-amber-200/80 dark:border-amber-800/40 rounded-xl p-4">
            <label className="flex items-start gap-3 cursor-pointer">
              <input type="checkbox" checked={form.isVulnerable} onChange={e => setForm(f => ({ ...f, isVulnerable: e.target.checked }))}
                className="mt-0.5 w-4 h-4 rounded border-amber-300 text-amber-600 focus:ring-amber-500" />
              <div>
                <div className="flex items-center gap-1.5">
                  <Heart className="w-4 h-4 text-amber-600" />
                  <span className="text-sm font-bold text-amber-800 dark:text-amber-300">{'I may need priority assistance during emergencies'}</span>
                </div>
                <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1">
                  {'Enable priority routing for faster emergency assistance'}
                </p>
              </div>
            </label>
            {form.isVulnerable && (
              <textarea value={form.vulnerabilityDetails} onChange={e => setForm(f => ({ ...f, vulnerabilityDetails: e.target.value }))}
                placeholder={'Describe any conditions or needs...'}
                className="w-full mt-3 p-3 text-sm bg-white dark:bg-gray-800 rounded-xl border border-amber-200 dark:border-amber-700 focus:ring-2 focus:ring-amber-500 resize-none" rows={2} />
            )}
          </div>
        ) : (
          <div className={`rounded-xl p-4 ${user.isVulnerable ? 'bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-950/20 dark:to-orange-950/10 border border-amber-200/80 dark:border-amber-800/40' : 'bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700'}`}>
            <div className="flex items-center gap-2">
              <Heart className={`w-4 h-4 ${user.isVulnerable ? 'text-amber-600' : 'text-gray-400 dark:text-gray-400'}`} />
              <span className={`text-sm font-semibold ${user.isVulnerable ? 'text-amber-800 dark:text-amber-300' : 'text-gray-500 dark:text-gray-400'}`}>
                {user.isVulnerable ? 'Priority support is active' : 'Priority support not active'}
              </span>
            </div>
            {user.isVulnerable && user.vulnerabilityDetails && (
              <p className="text-xs text-amber-600 dark:text-amber-400 mt-1.5 ml-6">{user.vulnerabilityDetails}</p>
            )}
          </div>
        )}
      </div>

      <div className="glass-card rounded-2xl p-6">
        <h3 className="text-sm font-bold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
          <Shield className="w-4 h-4 text-aegis-600" /> {'Account Information'}
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {[
            { label: 'Email', value: user.email, icon: Mail },
            { label: 'Verified', value: user.emailVerified ? 'Yes' : 'Not yet', icon: CheckCircle, color: user.emailVerified ? 'text-emerald-600' : 'text-amber-600' },
            { label: 'Role', value: user.role, icon: Shield, capitalize: true },
            { label: 'Login Count', value: user.loginCount || 0, icon: Activity },
            { label: 'Last Login', value: user.lastLogin ? new Date(user.lastLogin).toLocaleDateString() : '--', icon: Clock },
            { label: 'Member Since', value: user.createdAt ? new Date(user.createdAt).toLocaleDateString() : '--', icon: Calendar },
          ].map((item, i) => (
            <div key={i} className="bg-gray-50/80 dark:bg-gray-800/40 rounded-xl p-3">
              <div className="flex items-center gap-1.5 mb-1">
                <item.icon className="w-3 h-3 text-gray-400 dark:text-gray-400" />
                <p className="text-[10px] font-semibold text-gray-400 dark:text-gray-400 uppercase tracking-wider">{item.label}</p>
              </div>
              <p className={`text-sm font-semibold ${(item as any).color || 'text-gray-900 dark:text-white'} ${(item as any).capitalize ? 'capitalize' : ''} truncate`}>{item.value}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
