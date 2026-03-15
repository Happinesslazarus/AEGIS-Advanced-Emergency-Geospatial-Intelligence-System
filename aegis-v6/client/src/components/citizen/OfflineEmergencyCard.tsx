/* OfflineEmergencyCard.tsx - Location-aware emergency survival card
   Professional upgrade � glass-card design, hero contacts, visual tips, status badges */

import { useEffect, useMemo, useRef, useState } from 'react'
import { Download, Shield, Phone, MapPin, Heart, Wifi, WifiOff, AlertTriangle, CheckCircle, Printer, Share2, Search, Loader2, Compass, ChevronDown, Globe, Zap, Clipboard } from 'lucide-react'
import { forwardGeocode, getDeviceLocation, reverseGeocode } from '../../utils/locationUtils'
import { t } from '../../utils/i18n'
import { useLanguage } from '../../hooks/useLanguage'

interface EmergencyContact {
  name: string
  number: string
  description: string
}

const EMERGENCY_NUMBERS: Record<string, EmergencyContact[]> = {
  GB: [
    { name: 'Emergency Services', number: '999 / 112', description: 'Police, Fire, Ambulance, Coastguard' },
    { name: 'Non-Emergency Police', number: '101', description: 'Non-urgent police matters' },
    { name: 'Health Advice (NHS)', number: '111', description: 'NHS non-emergency support' },
    { name: 'Samaritans', number: '116 123', description: '24/7 emotional support' },
    { name: 'Floodline', number: '0345 988 1188', description: 'EA flood warnings & advice' },
  ],
  US: [
    { name: 'Emergency Services', number: '911', description: 'Police, Fire, Ambulance' },
    { name: 'Poison Control', number: '1-800-222-1222', description: 'Poisoning emergencies' },
    { name: 'Mental Health Crisis', number: '988', description: '24/7 Suicide & Crisis Lifeline' },
    { name: 'FEMA Helpline', number: '1-800-621-3362', description: 'Disaster assistance' },
    { name: 'Red Cross', number: '1-800-733-2767', description: 'Disaster relief & shelter' },
  ],
  CA: [
    { name: 'Emergency Services', number: '911', description: 'Police, Fire, Ambulance' },
    { name: 'Health Information', number: '811', description: 'Non-emergency medical advice' },
    { name: 'Crisis Services Canada', number: '1-833-456-4566', description: '24/7 crisis support' },
    { name: 'Red Cross Canada', number: '1-800-418-1111', description: 'Disaster assistance' },
  ],
  AU: [
    { name: 'Emergency Services', number: '000', description: 'Police, Fire, Ambulance' },
    { name: 'SES Emergency', number: '132 500', description: 'Flood and storm assistance' },
    { name: 'Lifeline Australia', number: '13 11 14', description: '24/7 crisis support' },
    { name: 'Health Direct', number: '1800 022 222', description: 'Health advice 24/7' },
  ],
  FR: [
    { name: 'Medical (SAMU)', number: '15', description: 'Medical emergencies' },
    { name: 'Police', number: '17', description: 'Police emergencies' },
    { name: 'Fire (Pompiers)', number: '18', description: 'Fire and rescue' },
    { name: 'EU Emergency', number: '112', description: 'Universal emergency number' },
  ],
  DE: [
    { name: 'Police', number: '110', description: 'Police emergencies' },
    { name: 'Fire / Ambulance', number: '112', description: 'Fire and medical emergency' },
    { name: 'Poison Centre', number: '030 19240', description: 'Berlin Poison Centre 24/7' },
    { name: 'Telefonseelsorge', number: '0800 111 0111', description: '24/7 emotional support' },
  ],
  ES: [
    { name: 'Emergency Services', number: '112', description: 'Police, Fire, Ambulance' },
    { name: 'National Police', number: '091', description: 'Police support' },
    { name: 'Civil Guard', number: '062', description: 'Rural / highway emergencies' },
    { name: 'Telefono de la Esperanza', number: '717 003 717', description: 'Crisis line' },
  ],
  IT: [
    { name: 'Emergency Services', number: '112', description: 'General emergency coordination' },
    { name: 'Medical Emergency', number: '118', description: 'Ambulance' },
    { name: 'Fire (Vigili del Fuoco)', number: '115', description: 'Fire and rescue' },
    { name: 'Carabinieri', number: '112', description: 'Military police emergency' },
  ],
  NL: [
    { name: 'Emergency Services', number: '112', description: 'Police, Fire, Ambulance' },
    { name: 'Non-Emergency Police', number: '0900 8844', description: 'Non-urgent police support' },
    { name: 'Health Advice', number: '0800 1351', description: 'GGD health information' },
    { name: 'Crisis Line (113)', number: '113', description: '24/7 suicide prevention' },
  ],
  PL: [
    { name: 'Emergency Services', number: '112', description: 'Police, Fire, Ambulance' },
    { name: 'Medical Emergency', number: '999', description: 'Ambulance dispatch' },
    { name: 'Fire Brigade', number: '998', description: 'Fire services' },
    { name: 'Police', number: '997', description: 'Police emergency line' },
  ],
  IE: [
    { name: 'Emergency Services', number: '999 / 112', description: 'Police, Fire, Ambulance' },
    { name: 'Health Service Helpline', number: '1800 700 700', description: 'Public health support' },
    { name: 'Samaritans Ireland', number: '116 123', description: '24/7 emotional support' },
    { name: 'Coast Guard', number: '112', description: 'Maritime emergency' },
  ],
  IN: [
    { name: 'Unified Emergency', number: '112', description: 'Police, Fire, Ambulance' },
    { name: 'Police', number: '100', description: 'Police emergency' },
    { name: 'Fire', number: '101', description: 'Fire services' },
    { name: 'Ambulance', number: '102 / 108', description: 'Medical emergency' },
    { name: 'Disaster Helpline (NDMA)', number: '1078', description: 'National disaster response' },
  ],
  ZA: [
    { name: 'Emergency Services', number: '112 / 10111', description: 'Police and emergency response' },
    { name: 'Ambulance', number: '10177', description: 'Medical and fire dispatch' },
    { name: 'Childline SA', number: '116', description: 'Child protection 24/7' },
    { name: 'LifeLine South Africa', number: '0861 322 322', description: 'Crisis counselling' },
  ],
  NG: [
    { name: 'Unified Emergency', number: '112', description: 'National emergency number' },
    { name: 'Police', number: '199', description: 'Police support' },
    { name: 'Fire Services', number: '190', description: 'Fire emergency' },
    { name: 'NEMA Helpline', number: '0800 2255 3632', description: 'National emergency management' },
  ],
  KE: [
    { name: 'Emergency Services', number: '999 / 112', description: 'Police, Fire, Ambulance' },
    { name: 'St John Ambulance', number: '0800 723 253', description: 'Medical emergency' },
    { name: 'Kenya Red Cross', number: '1199', description: 'Disaster and emergency' },
    { name: 'Childline Kenya', number: '116', description: 'Child emergencies 24/7' },
  ],
  SG: [
    { name: 'Police', number: '999', description: 'Singapore Police Force' },
    { name: 'Fire / Ambulance', number: '995', description: 'SCDF emergency dispatch' },
    { name: 'Non-Emergency Police', number: '1800 255 0000', description: 'Police hotline' },
    { name: 'SG Secure', number: '1800 255 6868', description: 'Security threat reporting' },
  ],
  JP: [
    { name: 'Police', number: '110', description: 'Police emergencies' },
    { name: 'Fire / Ambulance', number: '119', description: 'Fire and ambulance' },
    { name: 'Coast Guard', number: '118', description: 'Maritime emergency' },
    { name: 'Disaster Helpline', number: '171', description: 'NTT disaster message dial' },
  ],
  CN: [
    { name: 'Police', number: '110', description: 'Public security emergency' },
    { name: 'Fire', number: '119', description: 'Fire emergency' },
    { name: 'Ambulance', number: '120', description: 'Medical emergency' },
    { name: 'Traffic Accident', number: '122', description: 'Road traffic emergency' },
  ],
  BR: [
    { name: 'Police', number: '190', description: 'Military police emergency' },
    { name: 'Fire', number: '193', description: 'Fire emergency' },
    { name: 'Ambulance (SAMU)', number: '192', description: 'SAMU medical response' },
    { name: 'Civil Defence', number: '199', description: 'Disaster and civil defence' },
  ],
  MX: [
    { name: 'Emergency Services', number: '911', description: 'Police, Fire, Ambulance' },
    { name: 'Red Cross', number: '065', description: 'Red Cross dispatch' },
    { name: 'Civil Protection', number: '800 00 413 00', description: 'Natural disasters' },
    { name: 'Tourist Emergency', number: '078', description: 'Tourist assistance 24/7' },
  ],
  DEFAULT: [
    { name: 'Universal Emergency', number: '112', description: 'Works in most countries worldwide' },
    { name: 'Emergency Services', number: '911', description: 'Used in North America and selected regions' },
    { name: 'International SOS', number: '+44 20 8762 8008', description: 'Global medical / security assistance' },
    { name: 'Red Cross (ICRC)', number: '+41 22 734 60 01', description: 'International humanitarian aid' },
  ],
}

const COUNTRY_LABELS: Record<string, string> = {
  GB: '???? United Kingdom', US: '???? United States', CA: '???? Canada', AU: '???? Australia',
  FR: '???? France', DE: '???? Germany', ES: '???? Spain', IT: '???? Italy',
  NL: '???? Netherlands', PL: '???? Poland', IE: '???? Ireland', IN: '???? India',
  ZA: '???? South Africa', NG: '???? Nigeria', KE: '???? Kenya', SG: '???? Singapore',
  JP: '???? Japan', CN: '???? China', BR: '???? Brazil', MX: '???? Mexico',
}

const BASE_TIPS = [
  'Stay calm and assess immediate danger first.',
  'Move to safer ground if flooding or surge risk is present.',
  'If trapped, signal clearly and keep your phone battery conserved.',
  'Turn off gas and electricity only if safe to do so.',
  'Use official alerts and local authority instructions.',
  'Avoid walking or driving through floodwater.',
  'Support vulnerable neighbors when conditions are safe.',
  'Keep medication, water, and ID ready for rapid evacuation.',
]

const REGIONAL_TIPS: Record<string, string> = {
  GB: 'In the UK, monitor Environment Agency and Met Office updates.',
  US: 'In the US, monitor FEMA and NOAA advisories for your county.',
  IN: 'In India, monitor IMD and district disaster authority bulletins.',
  JP: 'In Japan, monitor JMA emergency warnings and municipal guidance.',
}

export default function OfflineEmergencyCard(): JSX.Element {
  const lang = useLanguage()
  const cardRef = useRef<HTMLDivElement>(null)

  const [saved, setSaved] = useState(false)
  const [personalNotes, setPersonalNotes] = useState('')
  const [medicalInfo, setMedicalInfo] = useState('')
  const [showForm, setShowForm] = useState(false)

  const [countryCode, setCountryCode] = useState('DEFAULT')
  const [locationLabel, setLocationLabel] = useState(t('offline.searchOrGPS', lang))
  const [locationError, setLocationError] = useState('')
  const [locating, setLocating] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null)

  const contacts = useMemo(() => EMERGENCY_NUMBERS[countryCode] || EMERGENCY_NUMBERS.DEFAULT, [countryCode])
  const tips = useMemo(() => {
    const extra = REGIONAL_TIPS[countryCode]
    return extra ? [extra, ...BASE_TIPS] : BASE_TIPS
  }, [countryCode])

  const detectLocation = async () => {
    setLocating(true)
    setLocationError('')

    try {
      const coords = await getDeviceLocation({ enableHighAccuracy: true, timeout: 10000, maximumAge: 180000 })
      const place = await reverseGeocode(coords, 10)
      setLocationLabel(place.displayName)
      setCountryCode(place.countryCode || 'DEFAULT')
    } catch {
      setLocationError(t('offline.enableLocation', lang))
      setLocationLabel(t('offline.locationUnavailable', lang))
      setCountryCode('DEFAULT')
    }

    setLocating(false)
  }

  useEffect(() => {}, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleSearch = async () => {
    if (!searchQuery.trim()) return
    setSearching(true)
    const found = await forwardGeocode(searchQuery.trim())

    if (!found) {
      setSearching(false)
      setLocationError(t('offline.locationNotFound', lang))
      return
    }

    const place = await reverseGeocode({ lat: found.lat, lng: found.lng }, 10)
    setLocationLabel(found.label)
    setCountryCode(place.countryCode || 'DEFAULT')
    setLocationError('')
    setSearching(false)
  }

  const handleSave = () => {
    const card = {
      contacts,
      tips,
      personalNotes,
      medicalInfo,
      countryCode,
      locationLabel,
      savedAt: new Date().toISOString(),
    }

    try {
      localStorage.setItem('aegis-emergency-card', JSON.stringify(card))
      setSaved(true)
    } catch {
      // Ignore storage failures.
    }
  }

  const handlePrint = () => {
    const printContent = `
AEGIS EMERGENCY SURVIVAL CARD
================================
Saved: ${new Date().toLocaleDateString()}
Location: ${locationLabel}
Country: ${countryCode}

EMERGENCY CONTACTS
------------------
${contacts.map((c) => `${c.name}: ${c.number} - ${c.description}`).join('\n')}

SURVIVAL TIPS
-------------
${tips.map((tip, i) => `${i + 1}. ${tip}`).join('\n')}

${medicalInfo ? `MEDICAL INFO\n------------\n${medicalInfo}\n` : ''}
${personalNotes ? `PERSONAL NOTES\n--------------\n${personalNotes}\n` : ''}
================================
Generated by AEGIS
    `.trim()

    const w = window.open('', '_blank', 'width=600,height=800')
    if (!w) return

    w.document.write(`<pre style="font-family:monospace;font-size:12px;padding:20px;white-space:pre-wrap">${printContent}</pre>`)
    w.document.close()
    w.print()
  }

  const handleShare = async () => {
    const text = `AEGIS Emergency Card (${countryCode})\nLocation: ${locationLabel}\n\n${contacts.map((c) => `${c.name}: ${c.number}`).join('\n')}`

    if (navigator.share) {
      try {
        await navigator.share({ title: 'AEGIS Emergency Card', text })
      } catch {
        // User cancelled.
      }
      return
    }

    try {
      await navigator.clipboard.writeText(text)
    } catch {
      // Ignore clipboard failures.
    }
  }

  const handleCopyNumber = async (number: string, idx: number) => {
    try {
      await navigator.clipboard.writeText(number.replace(/\s/g, ''))
      setCopiedIdx(idx)
      setTimeout(() => setCopiedIdx(null), 1500)
    } catch { /* ignore */ }
  }

  const countryName = COUNTRY_LABELS[countryCode] || 'Other / Unknown'
  const isDetected = countryCode !== 'DEFAULT'

  return (
    <div className="animate-fade-in space-y-4" ref={cardRef}>

      {/* ----------- HEADER ----------- */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="relative">
            <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-red-500 to-rose-700 flex items-center justify-center shadow-lg shadow-red-500/20">
              <Shield className="w-5.5 h-5.5 text-white" />
            </div>
            {saved && (
              <span className="absolute -top-1 -right-1 flex h-4 w-4">
                <span className="relative inline-flex rounded-full h-4 w-4 bg-emerald-500 border-2 border-white dark:border-gray-900 items-center justify-center">
                  <CheckCircle className="w-2.5 h-2.5 text-white" />
                </span>
              </span>
            )}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-extrabold text-gray-900 dark:text-white tracking-tight">{t('offline.emergencySurvivalCard', lang)}</h2>
            </div>
            <p className="text-[10px] text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 font-medium mt-0.5">
              {isDetected ? countryName : t('offline.searchSavePrintShare', lang)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {saved ? (
            <span className="flex items-center gap-1 text-[9px] font-bold bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300 px-2.5 py-1.5 rounded-xl border border-emerald-200/50 dark:border-emerald-800/50">
              <WifiOff className="w-3 h-3" /> {t('offline.offlineReady', lang)}
            </span>
          ) : (
            <span className="flex items-center gap-1 text-[9px] font-bold bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-300 px-2.5 py-1.5 rounded-xl border border-blue-200/50 dark:border-blue-800/50">
              <Wifi className="w-3 h-3" /> {t('common.online', lang)}
            </span>
          )}
          <button
            onClick={detectLocation}
            disabled={locating}
            className="flex items-center gap-1.5 text-[10px] font-bold bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-300 px-3 py-2 rounded-xl hover:bg-blue-100 dark:hover:bg-blue-900/40 transition-all border border-blue-200/50 dark:border-blue-800/50"
          >
            {locating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Compass className="w-3.5 h-3.5" />}
            GPS
          </button>
        </div>
      </div>

      {/* ----------- SEARCH & COUNTRY ----------- */}
      <div className="glass-card rounded-2xl p-3 space-y-3">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              placeholder={t('offline.searchPlaceholder', lang)}
              className="w-full pl-9 pr-3 py-2.5 text-xs bg-gray-50 dark:bg-gray-800/60 rounded-xl border border-gray-200 dark:border-gray-700 focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 transition text-gray-900 dark:text-white placeholder-gray-400"
            />
          </div>
          <button onClick={handleSearch} disabled={searching || !searchQuery.trim()} className="px-4 py-2.5 bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-400 hover:to-indigo-500 text-white rounded-xl text-xs font-bold transition-all disabled:opacity-40 shadow-md shadow-blue-500/20">
            {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : t('offline.locate', lang)}
          </button>
        </div>
        {locationError && <p className="text-[10px] text-red-500 font-medium ml-1">{locationError}</p>}
        <div className="flex items-center gap-2">
          <Globe className="w-4 h-4 text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 flex-shrink-0" />
          <select
            value={countryCode}
            onChange={(e) => setCountryCode(e.target.value)}
            className="flex-1 px-3 py-2 text-xs bg-gray-50 dark:bg-gray-800/60 rounded-xl border border-gray-200 dark:border-gray-700 focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 transition text-gray-900 dark:text-white"
          >
            {Object.keys(EMERGENCY_NUMBERS).filter(c => c !== 'DEFAULT').map(code => (
              <option key={code} value={code}>{COUNTRY_LABELS[code] || code}</option>
            ))}
            <option value="DEFAULT">?? Other / Unknown</option>
          </select>
        </div>
        {isDetected && (
          <div className="flex items-center gap-1.5 text-[10px] text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300">
            <MapPin className="w-3 h-3" /> {locationLabel}
          </div>
        )}
      </div>

      {/* ----------- QUICK STATS ----------- */}
      <div className="grid grid-cols-3 gap-2">
        <div className="glass-card rounded-xl p-3 text-center">
          <div className="text-2xl font-black text-red-600 dark:text-red-400 leading-none">{contacts.length}</div>
          <div className="text-[9px] font-bold text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 uppercase mt-1">{t('offline.contacts', lang)}</div>
        </div>
        <div className="glass-card rounded-xl p-3 text-center">
          <div className="text-2xl font-black text-amber-600 dark:text-amber-400 leading-none">{tips.length}</div>
          <div className="text-[9px] font-bold text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 uppercase mt-1">{t('offline.tips', lang)}</div>
        </div>
        <div className="glass-card rounded-xl p-3 text-center">
          <div className="text-2xl font-black text-blue-600 dark:text-blue-400 leading-none">{Object.keys(COUNTRY_LABELS).length}</div>
          <div className="text-[9px] font-bold text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 uppercase mt-1">{t('offline.countries', lang)}</div>
        </div>
      </div>

      {/* ----------- EMERGENCY CONTACTS ----------- */}
      <div className="glass-card rounded-2xl overflow-hidden shadow-lg">
        <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-800/50 bg-red-50/30 dark:bg-red-950/10">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Phone className="w-4 h-4 text-red-600 dark:text-red-400" />
              <span className="text-xs font-extrabold text-gray-900 dark:text-white uppercase tracking-wider">{t('offline.emergencyContacts', lang)}</span>
            </div>
            <span className="text-[9px] font-bold text-red-600 dark:text-red-400 bg-red-100 dark:bg-red-950/40 px-2 py-0.5 rounded-full">{countryName}</span>
          </div>
        </div>
        <div className="divide-y divide-gray-100/80 dark:divide-gray-800/60">
          {contacts.map((c, i) => {
            const isPrimary = i === 0
            return (
              <div key={`${c.name}-${i}`} className={`p-4 flex items-center gap-3 transition-all hover:bg-gray-50/60 dark:hover:bg-gray-800/30 ${isPrimary ? 'bg-red-50/40 dark:bg-red-950/10' : ''}`}>
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 shadow-md ${isPrimary ? 'bg-gradient-to-br from-red-500 to-rose-600' : 'bg-gradient-to-br from-gray-200 to-gray-300 dark:from-gray-700 dark:to-gray-600'}`}>
                  <Phone className={`w-4.5 h-4.5 ${isPrimary ? 'text-white' : 'text-gray-600 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300'}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-gray-900 dark:text-white truncate">{c.name}</span>
                    {isPrimary && <span className="text-[7px] font-black px-1.5 py-0.5 rounded bg-red-100 dark:bg-red-950/40 text-red-600 dark:text-red-400 uppercase">{t('offline.primary', lang)}</span>}
                  </div>
                  <p className="text-[10px] text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 mt-0.5">{c.description}</p>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <a
                    href={`tel:${c.number.replace(/\s/g, '')}`}
                    className={`px-3 py-2 rounded-xl text-xs font-black transition-all shadow-sm ${isPrimary ? 'bg-gradient-to-r from-red-500 to-rose-600 text-white shadow-red-500/20 hover:from-red-400 hover:to-rose-500' : 'bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-white border border-gray-200 dark:border-gray-700 hover:bg-gray-200 dark:hover:bg-gray-700'}`}
                  >
                    {c.number}
                  </a>
                  <button
                    onClick={() => handleCopyNumber(c.number, i)}
                    className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-all text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 hover:text-gray-600 dark:hover:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300"
                    title={t('offline.copyNumber', lang)}
                  >
                    {copiedIdx === i ? <CheckCircle className="w-3.5 h-3.5 text-emerald-500" /> : <Clipboard className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* ----------- SURVIVAL TIPS ----------- */}
      <div className="glass-card rounded-2xl overflow-hidden shadow-lg">
        <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-800/50 bg-amber-50/30 dark:bg-amber-950/10">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-amber-600 dark:text-amber-400" />
              <span className="text-xs font-extrabold text-gray-900 dark:text-white uppercase tracking-wider">{t('offline.survivalTips', lang)}</span>
            </div>
            <span className="text-[9px] font-bold text-amber-600 dark:text-amber-400 bg-amber-100 dark:bg-amber-950/40 px-2 py-0.5 rounded-full">{tips.length} {t('offline.tips', lang)}</span>
          </div>
        </div>
        <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-2">
          {tips.map((tip, i) => {
            const isRegional = i === 0 && REGIONAL_TIPS[countryCode]
            return (
              <div
                key={`${tip}-${i}`}
                className={`flex items-start gap-3 p-3 rounded-xl transition-all ${isRegional ? 'bg-blue-50/60 dark:bg-blue-950/20 border border-blue-200/50 dark:border-blue-800/30' : 'bg-gray-50/60 dark:bg-gray-800/30 border border-gray-100 dark:border-gray-800/40'}`}
              >
                <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5 ${isRegional ? 'bg-gradient-to-br from-blue-500 to-indigo-600' : 'bg-gradient-to-br from-amber-400 to-orange-500'}`}>
                  <span className="text-[10px] font-black text-white">{i + 1}</span>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] text-gray-700 dark:text-gray-200 leading-relaxed font-medium">{tip}</p>
                  {isRegional && <span className="text-[8px] font-bold text-blue-600 dark:text-blue-400 uppercase mt-1 inline-block">{t('offline.regionSpecific', lang)}</span>}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* ----------- MEDICAL / NOTES (collapsible) ----------- */}
      <button
        onClick={() => setShowForm(!showForm)}
        className="w-full glass-card rounded-xl px-4 py-3 flex items-center justify-between transition-all hover:bg-gray-50/60 dark:hover:bg-gray-800/30"
      >
        <div className="flex items-center gap-2">
          <Heart className="w-4 h-4 text-pink-500" />
          <span className="text-xs font-bold text-gray-900 dark:text-white">{t('offline.personalMedicalNotes', lang)}</span>
          {(medicalInfo || personalNotes) && <span className="w-2 h-2 rounded-full bg-pink-500 animate-pulse" />}
        </div>
        <ChevronDown className={`w-4 h-4 text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 transition-transform ${showForm ? 'rotate-180' : ''}`} />
      </button>

      {showForm && (
        <div className="glass-card rounded-xl p-4 space-y-3">
          <div>
            <label className="text-[9px] font-bold text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 uppercase tracking-wider">{t('offline.medicalLabel', lang)}</label>
            <textarea
              value={medicalInfo}
              onChange={(e) => setMedicalInfo(e.target.value)}
              rows={2}
              placeholder={t('offline.medicalPlaceholder', lang)}
              className="w-full mt-1.5 px-3 py-2.5 text-xs bg-gray-50 dark:bg-gray-800/60 rounded-xl border border-gray-200 dark:border-gray-700 focus:ring-2 focus:ring-pink-500/30 focus:border-pink-400 transition resize-none text-gray-900 dark:text-white placeholder-gray-400"
            />
          </div>
          <div>
            <label className="text-[9px] font-bold text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 uppercase tracking-wider">{t('offline.personalNotesLabel', lang)}</label>
            <textarea
              value={personalNotes}
              onChange={(e) => setPersonalNotes(e.target.value)}
              rows={2}
              placeholder={t('offline.personalNotesPlaceholder', lang)}
              className="w-full mt-1.5 px-3 py-2.5 text-xs bg-gray-50 dark:bg-gray-800/60 rounded-xl border border-gray-200 dark:border-gray-700 focus:ring-2 focus:ring-pink-500/30 focus:border-pink-400 transition resize-none text-gray-900 dark:text-white placeholder-gray-400"
            />
          </div>
        </div>
      )}

      {/* ----------- ACTION BUTTONS ----------- */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={handleSave}
          className={`flex-1 min-w-[120px] flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-xs font-bold transition-all shadow-md ${saved ? 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/50 shadow-emerald-500/10' : 'bg-gradient-to-r from-red-500 to-rose-600 text-white shadow-red-500/20 hover:from-red-400 hover:to-rose-500'}`}
        >
          {saved ? <><CheckCircle className="w-4 h-4" /> {t('offline.savedOffline', lang)}</> : <><Download className="w-4 h-4" /> {t('offline.saveOffline', lang)}</>}
        </button>
        <button
          onClick={handlePrint}
          className="flex items-center gap-2 px-4 py-3 rounded-xl text-xs font-bold bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200 border border-gray-200 dark:border-gray-700 hover:bg-gray-200 dark:hover:bg-gray-700 transition-all shadow-sm"
        >
          <Printer className="w-4 h-4" /> {t('offline.print', lang)}
        </button>
        <button
          onClick={handleShare}
          className="flex items-center gap-2 px-4 py-3 rounded-xl text-xs font-bold bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200 border border-gray-200 dark:border-gray-700 hover:bg-gray-200 dark:hover:bg-gray-700 transition-all shadow-sm"
        >
          <Share2 className="w-4 h-4" /> {t('offline.share', lang)}
        </button>
      </div>

      {/* ----------- FOOTER ----------- */}
      <div className="flex items-center justify-between px-1 text-[9px] font-medium text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300">
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> {t('offline.aegisEmergencyData', lang)}
          </span>
          <span>·</span>
          <span>{Object.keys(COUNTRY_LABELS).length} {t('offline.countriesSupported', lang)}</span>
        </div>
        <span className="px-2 py-0.5 rounded bg-gray-200/60 dark:bg-gray-700/40 font-bold">{contacts.length} contacts � {tips.length} tips</span>
      </div>
    </div>
  )
}





