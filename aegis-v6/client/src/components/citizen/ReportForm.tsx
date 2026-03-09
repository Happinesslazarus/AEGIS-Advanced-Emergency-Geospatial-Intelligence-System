import { useState, useRef, useEffect } from 'react'
import { X, ChevronRight, ChevronLeft, MapPin, Camera, Send, AlertTriangle, CheckCircle } from 'lucide-react'
import { INCIDENT_CATEGORIES, DISASTER_SUBTYPES, SEVERITY_LEVELS, TRAPPED_OPTIONS } from '../../data/disasterTypes'
import { LucideIcon } from '../../utils/iconMap'
import { useReports } from '../../contexts/ReportsContext'
import { useAlerts } from '../../contexts/AlertsContext'
import type { ReportFormData, IncidentCategoryKey, SeverityLevel, TrappedOption } from '../../types'

interface Props { onClose: () => void }

interface AddressSuggestion {
  label: string
  lat: number
  lng: number
}

export default function ReportForm({ onClose }: Props): JSX.Element {
  const { addReport } = useReports(); const { pushNotification } = useAlerts()
  const [step, setStep] = useState(1); const [errors, setErrors] = useState<Record<string, string>>({})
  const [mediaFiles, setMediaFiles] = useState<{file: File, preview: string}[]>([])
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [addressSuggestions, setAddressSuggestions] = useState<AddressSuggestion[]>([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [isSearchingAddress, setIsSearchingAddress] = useState(false)
  const [selectedCoords, setSelectedCoords] = useState<[number, number] | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [form, setForm] = useState<ReportFormData>({ incidentCategory: '', incidentSubtype: '', description: '', severity: '', trappedPersons: '', location: '', otherSpecify: '', hasMedia: false, mediaType: '' })

  const up = (f: keyof ReportFormData, v: string | boolean): void => { setForm(p => ({ ...p, [f]: v })); setErrors(p => { const n = { ...p }; delete n[f]; return n }) }

  const MAX_IMAGES = 3
  const MIN_IMAGES = 0
  const MAX_SIZE_MB = 10
  const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp']
  const defaultLat = Number(import.meta.env.VITE_DEFAULT_REPORT_LAT ?? 57.15)
  const defaultLng = Number(import.meta.env.VITE_DEFAULT_REPORT_LNG ?? -2.09)
  const nominatimCountryCodes = String(import.meta.env.VITE_NOMINATIM_COUNTRY_CODES || 'gb')

  const handleFiles = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const files = Array.from(e.target.files || [])
    const remaining = MAX_IMAGES - mediaFiles.length
    if (remaining <= 0) { pushNotification(`Maximum ${MAX_IMAGES} images allowed.`, 'warning'); return }
    const validFiles = files.slice(0, remaining).filter(f => {
      if (!ACCEPTED_TYPES.includes(f.type)) { pushNotification(`${f.name}: Only JPG, PNG, WEBP accepted.`, 'warning'); return false }
      if (f.size > MAX_SIZE_MB * 1024 * 1024) { pushNotification(`${f.name}: Max size ${MAX_SIZE_MB}MB.`, 'warning'); return false }
      return true
    })
    validFiles.forEach(file => {
      const reader = new FileReader()
      reader.onload = (ev) => {
        setMediaFiles(prev => [...prev, { file, preview: ev.target?.result as string }])
        up('hasMedia', true); up('mediaType', 'photo')
      }
      reader.readAsDataURL(file)
    })
    if (validFiles.length > 0) pushNotification(`${validFiles.length} image(s) attached.`, 'success')
    if (e.target) e.target.value = ''
  }

  const removeMedia = (idx: number): void => {
    setMediaFiles(prev => {
      const next = prev.filter((_, i) => i !== idx)
      if (next.length === 0) { up('hasMedia', false); up('mediaType', '') }
      return next
    })
  }

  const validate = (): boolean => {
    const e: Record<string, string> = {}
    if (step === 1 && !form.incidentCategory) e.incidentCategory = 'Select type'
    if (step === 2 && !form.incidentSubtype) e.incidentSubtype = 'Select subtype'
    if (step === 3 && form.description.length < 10) e.description = 'Min 10 chars'
    if (step === 4 && !form.severity) e.severity = 'Select severity'
    if (step === 5 && !form.trappedPersons) e.trappedPersons = 'Please answer'
    if (step === 6 && form.location.length < 3) e.location = 'Add location'
    setErrors(e); return Object.keys(e).length === 0
  }

  const next = (): void => { if (validate()) { let ns = step + 1; if (step === 1 && form.incidentCategory) { const hasSubs = (DISASTER_SUBTYPES[form.incidentCategory as IncidentCategoryKey]?.length ?? 0) > 0; if (!hasSubs) ns = 3 } setStep(Math.min(ns, 6)) } }
  const prev = (): void => { let ps = step - 1; if (step === 3 && form.incidentCategory) { const hasSubs = (DISASTER_SUBTYPES[form.incidentCategory as IncidentCategoryKey]?.length ?? 0) > 0; if (!hasSubs) ps = 1 } setStep(Math.max(ps, 1)) }

  const submit = (): void => {
    void (async () => {
      if (!validate() || isSubmitting) return
      if (mediaFiles.length < MIN_IMAGES) {
        pushNotification(`Please attach at least ${MIN_IMAGES} photos as evidence before submitting.`, 'warning')
        return
      }
      setIsSubmitting(true)
      try {
        const subs = DISASTER_SUBTYPES[form.incidentCategory as IncidentCategoryKey] || []
        const sub = subs.find(s => s.key === form.incidentSubtype)
        const cat = INCIDENT_CATEGORIES.find(c => c.key === form.incidentCategory)
        const parsed = parseCoordinateInput(form.location)
        const coords: [number, number] = selectedCoords || parsed || [defaultLat, defaultLng]

        await addReport({
          incidentCategory: form.incidentCategory as IncidentCategoryKey,
          incidentSubtype: form.incidentSubtype,
          type: `${cat?.label || ''} — ${sub?.label || form.incidentSubtype}`,
          description: form.description,
          severity: form.severity as SeverityLevel,
          trappedPersons: form.trappedPersons as TrappedOption,
          location: form.location,
          coordinates: coords,
          hasMedia: form.hasMedia,
          mediaType: form.hasMedia ? (form.mediaType as 'photo' | 'video') : undefined,
        }, mediaFiles.map(m => m.file))

        pushNotification(
          form.trappedPersons === 'yes'
            ? '🚨 URGENT report submitted. Emergency services notified.'
            : '✅ Report submitted. AI review in progress.',
          form.trappedPersons === 'yes' ? 'warning' : 'success'
        )
        onClose()
      } catch (err: any) {
        pushNotification(err?.message || 'Failed to submit report. Please try again.', 'error')
      } finally {
        setIsSubmitting(false)
      }
    })()
  }

  const [gpsStatus, setGpsStatus] = useState<'idle'|'requesting'|'success'|'denied'>('idle')
  const [gpsAccuracy, setGpsAccuracy] = useState<number|null>(null)

  const gps = (): void => {
    if (!('geolocation' in navigator)) { pushNotification('GPS not available on this device. Please enter address manually.', 'warning'); setGpsStatus('denied'); return }
    pushNotification('Requesting location to pin your report accurately...', 'info')
    setGpsStatus('requesting')
    navigator.geolocation.getCurrentPosition(
      p => {
        up('location', `${p.coords.latitude.toFixed(5)}, ${p.coords.longitude.toFixed(5)}`)
        setSelectedCoords([p.coords.latitude, p.coords.longitude])
        setGpsAccuracy(Math.round(p.coords.accuracy))
        setGpsStatus('success')
        pushNotification(`Location captured (±${Math.round(p.coords.accuracy)}m accuracy)`, 'success')
      },
      (err) => {
        setGpsStatus('denied')
        if (err.code === 1) pushNotification('Location permission denied. Please type your address or landmark instead.', 'warning')
        else pushNotification('Could not determine location. Please enter manually.', 'warning')
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    )
  }

  useEffect(() => {
    if (step !== 6) return
    const q = form.location.trim()
    if (q.length < 3) {
      setAddressSuggestions([])
      setShowSuggestions(false)
      return
    }

    const t = setTimeout(async () => {
      try {
        setIsSearchingAddress(true)
        const suggestions: AddressSuggestion[] = []
        const seen = new Set<string>()

        const postcodeLike = /^[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}$/i.test(q)
        if (postcodeLike) {
          const pcRes = await fetch(`https://api.postcodes.io/postcodes/${encodeURIComponent(q)}`)
          if (pcRes.ok) {
            const pcData = await pcRes.json()
            const r = pcData?.result
            if (r?.latitude && r?.longitude) {
              const label = `${(r.postcode || q).toUpperCase()}${r.admin_district ? `, ${r.admin_district}` : ''}${r.region ? `, ${r.region}` : ''}`
              seen.add(label)
              suggestions.push({ label, lat: Number(r.latitude), lng: Number(r.longitude) })
            }
          }
        }

        const nominatim = await fetch(`https://nominatim.openstreetmap.org/search?format=json&countrycodes=${encodeURIComponent(nominatimCountryCodes)}&addressdetails=1&limit=6&q=${encodeURIComponent(q)}`)
        if (nominatim.ok) {
          const rows = await nominatim.json()
          for (const row of rows || []) {
            const label = String(row.display_name || '').trim()
            if (!label || seen.has(label)) continue
            seen.add(label)
            suggestions.push({ label, lat: Number(row.lat), lng: Number(row.lon) })
          }
        }

        setAddressSuggestions(suggestions.slice(0, 6))
        setShowSuggestions(suggestions.length > 0)
      } catch {
        setAddressSuggestions([])
      } finally {
        setIsSearchingAddress(false)
      }
    }, 350)

    return () => clearTimeout(t)
  }, [form.location, step])

  const parseCoordinateInput = (value: string): [number, number] | null => {
    const m = value.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/)
    if (!m) return null
    const lat = Number(m[1])
    const lng = Number(m[2])
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
    return [lat, lng]
  }

  const pickSuggestion = (s: AddressSuggestion): void => {
    up('location', s.label)
    setSelectedCoords([s.lat, s.lng])
    setShowSuggestions(false)
  }
  const needsSub = form.incidentCategory && (DISASTER_SUBTYPES[form.incidentCategory as IncidentCategoryKey]?.length ?? 0) > 0

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 z-50" role="dialog" aria-modal="true">
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-lg max-h-[95vh] overflow-y-auto animate-fade-in">
        <div className="bg-red-600 text-white p-4 sm:p-5 rounded-t-2xl flex items-center justify-between sticky top-0 z-10">
          <div><h2 className="text-lg sm:text-xl font-bold flex items-center gap-2"><AlertTriangle className="w-5 h-5" /> Report Emergency</h2>
            <div className="flex items-center gap-2 mt-2">{Array.from({ length: 6 }).map((_, i) => <div key={i} className={`h-1.5 flex-1 rounded-full ${i < step ? 'bg-white' : 'bg-white/30'}`} />)}<span className="text-xs text-red-100 ml-2">{step}/6</span></div>
          </div>
          <button onClick={onClose} className="hover:bg-red-700 p-2 rounded-lg" aria-label="Close"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-4 sm:p-5">
          {step === 1 && <div className="space-y-3"><h3 className="text-lg font-semibold">What type of incident?</h3><select className="input w-full" value={form.incidentCategory} onChange={e=>{up('incidentCategory',e.target.value)}}><option value="">— Select incident type —</option>{INCIDENT_CATEGORIES.map(c=><option key={c.key} value={c.key}>{c.label}</option>)}</select>{form.incidentCategory&&<div className="flex items-center gap-2 p-3 bg-aegis-50 dark:bg-aegis-950/20 rounded-xl border border-aegis-200 dark:border-aegis-800"><LucideIcon name={INCIDENT_CATEGORIES.find(c=>c.key===form.incidentCategory)?.icon||'HelpCircle'} className="w-5 h-5 text-aegis-600"/><span className="text-sm font-medium">{INCIDENT_CATEGORIES.find(c=>c.key===form.incidentCategory)?.label}</span></div>}{errors.incidentCategory && <p className="text-red-500 text-sm">{errors.incidentCategory}</p>}</div>}
          {step === 2 && <div className="space-y-3"><h3 className="text-lg font-semibold">What specifically?</h3><select className="input" value={form.incidentSubtype} onChange={e => up('incidentSubtype', e.target.value)}><option value="">— Select —</option>{(DISASTER_SUBTYPES[form.incidentCategory as IncidentCategoryKey] || []).map(s => <option key={s.key} value={s.key}>{s.label}</option>)}</select>{form.incidentSubtype&&<div className="flex items-center gap-2 p-3 bg-gray-50 dark:bg-gray-800 rounded-xl"><LucideIcon name={(DISASTER_SUBTYPES[form.incidentCategory as IncidentCategoryKey]||[]).find(s=>s.key===form.incidentSubtype)?.icon||'HelpCircle'} className="w-5 h-5 text-aegis-600"/><span className="text-sm">{(DISASTER_SUBTYPES[form.incidentCategory as IncidentCategoryKey]||[]).find(s=>s.key===form.incidentSubtype)?.label}</span></div>}{errors.incidentSubtype && <p className="text-red-500 text-sm">{errors.incidentSubtype}</p>}</div>}
          {step === 3 && <div className="space-y-3"><h3 className="text-lg font-semibold">Describe what you see</h3><textarea className={`input min-h-[100px] ${errors.description ? 'input-error' : ''}`} placeholder="Water levels, damage, people affected..." value={form.description} onChange={e => up('description', e.target.value)} maxLength={2000} /><p className="text-xs text-gray-500 text-right">{form.description.length}/2000</p>{errors.description && <p className="text-red-500 text-sm">{errors.description}</p>}</div>}
          {step === 4 && <div className="space-y-3"><h3 className="text-lg font-semibold">How severe?</h3>{SEVERITY_LEVELS.map(sv => <button key={sv.key} onClick={() => { up('severity', sv.key); setStep(5) }} className={`w-full p-4 border-2 rounded-xl text-left hover:shadow-md ${sv.key === 'High' ? 'border-red-200 hover:border-red-500' : sv.key === 'Medium' ? 'border-amber-200 hover:border-amber-500' : 'border-blue-200 hover:border-blue-500'}`}><p className="font-semibold">{sv.label}</p><p className="text-sm text-gray-600">{sv.description}</p></button>)}</div>}
          {step === 5 && <div className="space-y-3"><h3 className="text-lg font-semibold">Anyone trapped?</h3>{TRAPPED_OPTIONS.map(o => <button key={o.key} onClick={() => { up('trappedPersons', o.key); setStep(6) }} className={`w-full p-4 border-2 rounded-xl text-left hover:shadow-md ${o.urgent ? 'border-red-200 hover:border-red-500' : 'border-gray-200 hover:border-aegis-300'}`}><p className="font-medium text-sm">{o.label}</p></button>)}</div>}
          {step === 6 && <div className="space-y-4"><h3 className="text-lg font-semibold">Location & Evidence</h3>
            <div className="relative">
              <div className="flex gap-2">
                <input
                  className={`input flex-1 ${errors.location ? 'input-error' : ''}`}
                  placeholder={gpsStatus==='denied'?'Type address or postcode...':'Address, postcode, or landmark...'}
                  value={form.location}
                  onChange={e => { up('location', e.target.value); setSelectedCoords(null); setShowSuggestions(true) }}
                  onFocus={() => setShowSuggestions(addressSuggestions.length > 0)}
                />
                <button onClick={gps} disabled={gpsStatus==='requesting'} className={`btn-outline flex-shrink-0 ${gpsStatus==='requesting'?'opacity-50':''}`}><MapPin className="w-4 h-4" /> {gpsStatus==='requesting'?'...':'GPS'}</button>
              </div>
              {isSearchingAddress && <p className="text-[10px] text-gray-500 mt-1">Searching address suggestions…</p>}
              {showSuggestions && addressSuggestions.length > 0 && (
                <div className="absolute z-20 mt-1 w-full bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg max-h-52 overflow-y-auto">
                  {addressSuggestions.map((s, i) => (
                    <button key={`${s.label}-${i}`} onClick={() => pickSuggestion(s)} className="w-full text-left px-3 py-2 text-xs hover:bg-gray-100 dark:hover:bg-gray-800 border-b border-gray-100 dark:border-gray-800 last:border-0">
                      {s.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {gpsAccuracy && <p className="text-[10px] text-green-600 flex items-center gap-1"><CheckCircle className="w-3 h-3"/> Location accuracy: ±{gpsAccuracy}m</p>}
            {gpsStatus==='denied' && <p className="text-[10px] text-amber-600">GPS unavailable — please type your location manually or select on map</p>}
            {errors.location && <p className="text-red-500 text-sm">{errors.location}</p>}
            {/* Multi-Image Upload — up to 3 images */}
            <div>
              <p className="text-sm font-medium mb-2">Evidence Photos <span className="text-xs text-gray-500 font-normal">(optional, max {MAX_IMAGES})</span></p>
              {mediaFiles.length > 0 && (
                <div className="grid grid-cols-3 gap-2 mb-2">
                  {mediaFiles.map((m, i) => (
                    <div key={i} className="relative group rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700">
                      <img src={m.preview} alt={`Evidence ${i+1}`} className="w-full h-20 object-cover" />
                      <button onClick={() => removeMedia(i)} className="absolute top-1 right-1 w-5 h-5 bg-red-600 text-white rounded-full flex items-center justify-center opacity-80 hover:opacity-100 transition-opacity" aria-label="Remove"><X className="w-3 h-3" /></button>
                      <p className="text-[9px] text-center text-gray-500 py-0.5 truncate px-1">{m.file.name}</p>
                    </div>
                  ))}
                </div>
              )}
              {mediaFiles.length < MAX_IMAGES && (
                <div className={`border-2 border-dashed rounded-xl p-4 text-center cursor-pointer transition-colors ${mediaFiles.length > 0 ? 'border-green-400 bg-green-50 dark:bg-green-950/20' : 'border-gray-300 dark:border-gray-600 hover:border-aegis-400'}`} onClick={() => fileRef.current?.click()}>
                  <input ref={fileRef} type="file" className="hidden" accept="image/jpeg,image/png,image/webp" multiple onChange={handleFiles} />
                  <Camera className="w-6 h-6 mx-auto text-gray-400 mb-1" />
                  <p className="text-sm font-medium">{mediaFiles.length > 0 ? `Add more (${MAX_IMAGES - mediaFiles.length} remaining)` : 'Add photo evidence'}</p>
                  <p className="text-xs text-gray-500">JPG, PNG, WEBP · Max {MAX_SIZE_MB}MB each</p>
                </div>
              )}
            </div>
            <div className="bg-gray-50 dark:bg-gray-800 rounded-xl p-3 space-y-1 text-sm"><p className="font-semibold">Summary</p><p className="text-gray-600 dark:text-gray-400">Type: {form.incidentCategory} / {form.incidentSubtype}</p><p className="text-gray-600 dark:text-gray-400">Severity: {form.severity} | Trapped: {form.trappedPersons}{mediaFiles.length > 0 ? ` | Photos: ${mediaFiles.length}` : ''}</p></div>
            <button onClick={submit} disabled={isSubmitting} className="btn-danger w-full py-3 text-base disabled:opacity-60"><Send className="w-5 h-5" /> {isSubmitting ? 'Submitting...' : 'Submit Emergency Report'}</button>
            <p className="text-xs text-center text-gray-500">Anonymous. Call 999 first for life-threatening emergencies.</p>
          </div>}
          {step > 1 && step < 6 && <div className="flex justify-between mt-5"><button onClick={prev} className="btn-ghost"><ChevronLeft className="w-4 h-4" /> Back</button><button onClick={next} className="btn-primary">Next <ChevronRight className="w-4 h-4" /></button></div>}
          {step === 1 && form.incidentCategory && <div className="flex justify-end mt-5"><button onClick={next} className="btn-primary">Next <ChevronRight className="w-4 h-4" /></button></div>}
          {step === 6 && <div className="mt-3"><button onClick={prev} className="btn-ghost"><ChevronLeft className="w-4 h-4" /> Back</button></div>}
        </div>
      </div>
    </div>
  )
}
