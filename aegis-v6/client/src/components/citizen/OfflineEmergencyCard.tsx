/**
 * Offline emergency card citizen component (public-facing UI element).
 *
 * - Rendered inside CitizenPage.tsx or CitizenDashboard.tsx */

/* OfflineEmergencyCard.tsx - Location-aware emergency survival card
   Covers all countries worldwide with emergency numbers, survival tips, GPS detection */

import { useMemo, useRef, useState } from 'react'
import { Download, Shield, Phone, MapPin, Heart, Wifi, WifiOff, CheckCircle, Printer, Share2, Search, Loader2, Compass, ChevronDown, Zap, Clipboard } from 'lucide-react'
import { forwardGeocode, getDeviceLocation, reverseGeocode } from '../../utils/locationUtils'
import { t } from '../../utils/i18n'
import { escapeHtml } from '../../utils/helpers'
import { useLanguage } from '../../hooks/useLanguage'
import {
  ALL_COUNTRIES,
  getEmergencyInfo, getSurvivalTips, getCountryEntryByCode,
  type EmergencyInfo } from '../../data/allCountries'
import ProfileCountryPicker from '../shared/ProfileCountryPicker'

interface EmergencyContact {
  name: string
  number: string
  description: string
}

function emergencyInfoToContacts(info: EmergencyInfo, code: string): EmergencyContact[] {
  const contacts: EmergencyContact[] = []
  if (info.universal) {
    contacts.push({ name: 'Emergency Services', number: info.universal, description: `Police, Fire, Ambulance (${code})` })
  }
  if (info.police !== info.universal) {
    contacts.push({ name: 'Police', number: info.police, description: 'Police emergency' })
  }
  if (info.fire !== info.universal && info.fire !== info.police) {
    contacts.push({ name: 'Fire', number: info.fire, description: 'Fire services' })
  }
  if (info.ambulance !== info.universal && info.ambulance !== info.police && info.ambulance !== info.fire) {
    contacts.push({ name: 'Ambulance', number: info.ambulance, description: 'Medical emergency' })
  }
  if (info.extras) {
    for (const e of info.extras) {
      contacts.push({ name: e.name, number: e.number, description: e.desc })
    }
  }
  return contacts
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

//Build flat country label map for all countries
const COUNTRY_LABELS: Record<string, string> = Object.fromEntries(
  ALL_COUNTRIES.map(c => [c.code, `${c.flag} ${c.name}`])
)

//Total number of supported countries
const TOTAL_COUNTRIES = ALL_COUNTRIES.length

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

  const contacts = useMemo(() => {
    if (countryCode === 'DEFAULT') {
      return [
        { name: 'Universal Emergency', number: '112', description: 'Works in most countries worldwide' },
        { name: 'Emergency Services', number: '911', description: 'Used in North America and selected regions' },
        { name: 'International SOS', number: '+44 20 8762 8008', description: 'Global medical / security assistance' },
        { name: 'Red Cross (ICRC)', number: '+41 22 734 60 01', description: 'International humanitarian aid' },
      ]
    }
    const info = getEmergencyInfo(countryCode)
    return emergencyInfoToContacts(info, countryCode)
  }, [countryCode])

  const tips = useMemo(() => {
    if (countryCode === 'DEFAULT') return BASE_TIPS
    const regional = getSurvivalTips(countryCode)
    return [...regional, ...BASE_TIPS]
  }, [countryCode])

  const detectLocation = async () => {
    setLocating(true)
    setLocationError('')

    try {
      const coords = await getDeviceLocation({ enableHighAccuracy: true, timeout: 10000, maximumAge: 180000 })
      const place = await reverseGeocode(coords, 10)
      setLocationLabel(place.displayName)
      const code = place.countryCode || 'DEFAULT'
      setCountryCode(code)
      setSearchQuery('')
    } catch {
      setLocationError(t('offline.enableLocation', lang))
      setLocationLabel(t('offline.locationUnavailable', lang))
      setCountryCode('DEFAULT')
    }

    setLocating(false)
  }

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
      //Ignore storage failures.
    }
  }

  const handlePrint = () => {
    const entry = getCountryEntryByCode(countryCode)
    const countryName = entry ? entry.name : 'International'
    const countryCodeStr = entry ? entry.code : 'INTL'
    const generated = new Date().toLocaleString()
    const cardId = `AEG-${Date.now().toString(36).toUpperCase().slice(-8)}`

    //Inline Lucide-compatible SVG helper -- no Unicode emojis
    const svg = (paths: string, size = 12, color = 'currentColor', sw = 2) =>
      `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" ` +
      `fill="none" stroke="${color}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" ` +
      `style="display:inline-block;vertical-align:middle;flex-shrink:0">${paths}</svg>`

    const ICON = {
      shieldLg:     svg('<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/>', 38, '#fff', 1.5),
      shieldSm:     svg('<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>', 14, '#b91c1c'),
      shieldFooter: svg('<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>', 14, '#f87171'),
      phone:        svg('<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 13.57 19.79 19.79 0 0 1 1.62 4.9 2 2 0 0 1 3.56 3h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 10.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 20z"/>', 14, '#b91c1c'),
      flame:        svg('<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>', 14, '#b91c1c'),
      heart:        svg('<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>', 14, '#b91c1c'),
      heartGreen:   svg('<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>', 12, '#15803d'),
      alertTri:     svg('<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>', 14, '#b91c1c'),
      mapPin:       svg('<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>', 11, '#991b1b'),
      clock:        svg('<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>', 11, '#991b1b'),
      globe:        svg('<circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>', 11, '#991b1b'),
      hash:         svg('<line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/>', 11, '#991b1b'),
      info:         svg('<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>', 12, '#374151'),
      user:         svg('<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>', 12, '#1d4ed8'),
    }

    const contactIcon = (name: string) => {
      const n = name.toLowerCase()
      if (n.includes('police') || n.includes('security') || n.includes('gendarm')) return ICON.shieldSm
      if (n.includes('fire')) return ICON.flame
      if (n.includes('ambulance') || n.includes('medical') || n.includes('health')) return ICON.heart
      if (n.includes('sos') || n.includes('cross') || n.includes('icrc') || n.includes('humanitarian')) return ICON.alertTri
      return ICON.phone
    }

    const contactRows = contacts.map((c, i) =>
      `<div class="contact-row${i === 0 ? ' primary' : ''}">`
      + `<div class="contact-icon">${contactIcon(c.name)}</div>`
      + `<div class="contact-left">`
      + `<span class="contact-badge">${escapeHtml(c.name)}</span>`
      + `<span class="contact-desc">${escapeHtml(c.description)}</span>`
      + `</div>`
      + `<div class="contact-number">${escapeHtml(c.number)}</div>`
      + `</div>`
    ).join('')

    const tipItems = tips.map((tip, i) =>
      `<li><span class="tip-num">${i + 1}</span><span>${escapeHtml(tip)}</span></li>`
    ).join('')

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<title>AEGIS Emergency Survival Card &mdash; ${escapeHtml(countryName)} (${escapeHtml(countryCodeStr)})</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  @page { size: A4; margin: 12mm 14mm; }
  body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 11px; color: #111; background: #fff; }
  .header { display: flex; align-items: stretch; background: #b91c1c; color: #fff; border-radius: 8px 8px 0 0; overflow: hidden; }
  .header-main { display: flex; align-items: center; gap: 12px; padding: 14px 16px; flex: 1; }
  .header-title { font-size: 17px; font-weight: 900; letter-spacing: 0.3px; line-height: 1.1; }
  .header-sub { font-size: 9px; opacity: 0.82; margin-top: 3px; }
  .header-country { background: rgba(0,0,0,0.22); padding: 12px 18px; display: flex; flex-direction: column; align-items: center; justify-content: center; min-width: 96px; text-align: center; gap: 3px; border-left: 1px solid rgba(255,255,255,0.15); }
  .country-iso { font-size: 26px; font-weight: 900; letter-spacing: 3px; line-height: 1; font-family: 'Courier New', monospace; }
  .country-fullname { font-size: 9.5px; font-weight: 600; opacity: 0.9; line-height: 1.3; max-width: 80px; text-align: center; }
  .country-label { font-size: 7px; opacity: 0.6; letter-spacing: 1px; text-transform: uppercase; margin-top: 2px; }
  .meta { display: grid; grid-template-columns: 1fr 1fr; background: #fef2f2; border-left: 3px solid #b91c1c; border-right: 3px solid #b91c1c; padding: 7px 14px; gap: 5px 20px; }
  .meta-item { display: flex; align-items: center; gap: 5px; font-size: 9px; color: #7f1d1d; }
  .meta-item strong { font-weight: 700; color: #991b1b; }
  .section { border: 1.5px solid #e5e7eb; border-radius: 6px; margin-top: 9px; overflow: hidden; }
  .section-hdr { background: #f3f4f6; padding: 6px 12px; font-size: 8.5px; font-weight: 800; letter-spacing: 1.3px; text-transform: uppercase; color: #374151; display: flex; align-items: center; gap: 6px; border-bottom: 1px solid #e5e7eb; }
  .section-hdr.red   { background: #fef2f2; color: #b91c1c; border-bottom-color: #fecaca; }
  .section-hdr.green { background: #f0fdf4; color: #15803d; border-bottom-color: #bbf7d0; }
  .section-hdr.blue  { background: #eff6ff; color: #1d4ed8; border-bottom-color: #bfdbfe; }
  .contact-row { display: flex; align-items: center; gap: 10px; padding: 8px 12px; border-bottom: 1px solid #f3f4f6; }
  .contact-row:last-child { border-bottom: none; }
  .contact-row.primary { background: #fff7f7; padding: 10px 12px; }
  .contact-icon { display: flex; align-items: center; justify-content: center; width: 28px; height: 28px; border-radius: 6px; background: #f3f4f6; flex-shrink: 0; }
  .contact-row.primary .contact-icon { background: #fee2e2; width: 32px; height: 32px; border-radius: 8px; }
  .contact-left { flex: 1; display: flex; flex-direction: column; gap: 1px; }
  .contact-badge { font-size: 10.5px; font-weight: 700; color: #111; }
  .contact-row.primary .contact-badge { color: #b91c1c; font-size: 11.5px; }
  .contact-desc { font-size: 8.5px; color: #6b7280; }
  .contact-number { font-size: 20px; font-weight: 900; color: #b91c1c; letter-spacing: 1px; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .contact-row:not(.primary) .contact-number { font-size: 15px; color: #1f2937; font-weight: 800; }
  .tips-body { padding: 8px 12px; }
  .tips-body ol { list-style: none; display: grid; grid-template-columns: 1fr 1fr; gap: 4px 20px; }
  .tips-body li { display: flex; align-items: flex-start; gap: 5px; font-size: 8.5px; color: #374151; line-height: 1.45; }
  .tip-num { min-width: 15px; height: 15px; background: #b91c1c; color: #fff; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 7.5px; font-weight: 800; flex-shrink: 0; margin-top: 1px; }
  .personal-body { padding: 8px 12px; font-size: 9.5px; color: #374151; line-height: 1.55; white-space: pre-wrap; }
  .footer { margin-top: 9px; display: flex; align-items: center; justify-content: space-between; padding: 8px 14px; background: #111827; border-radius: 0 0 8px 8px; color: #d1d5db; font-size: 8.5px; gap: 12px; }
  .footer-brand { font-weight: 800; color: #fff; font-size: 10px; letter-spacing: 0.3px; display: flex; align-items: center; gap: 6px; white-space: nowrap; }
  .footer-mid { display: flex; flex-direction: column; align-items: center; text-align: center; gap: 1px; }
  .footer-112 { font-size: 18px; font-weight: 900; color: #f87171; letter-spacing: 2px; }
  .footer-112-label { font-size: 7px; opacity: 0.65; }
  .footer-right { font-size: 7.5px; opacity: 0.6; text-align: right; line-height: 1.5; }
  @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
</style>
</head>
<body>

<div class="header">
  <div class="header-main">
    ${ICON.shieldLg}
    <div>
      <div class="header-title">AEGIS EMERGENCY SURVIVAL CARD</div>
      <div class="header-sub">Keep this card accessible at all times &mdash; Official emergency reference document &mdash; Valid globally</div>
    </div>
  </div>
  <div class="header-country">
    <div class="country-iso">${escapeHtml(countryCodeStr)}</div>
    <div class="country-fullname">${escapeHtml(countryName)}</div>
    <div class="country-label">Country</div>
  </div>
</div>

<div class="meta">
  <div class="meta-item">${ICON.mapPin}&nbsp;<strong>Location:</strong>&nbsp;${escapeHtml(locationLabel)}</div>
  <div class="meta-item">${ICON.hash}&nbsp;<strong>Card ID:</strong>&nbsp;${escapeHtml(cardId)}</div>
  <div class="meta-item">${ICON.clock}&nbsp;<strong>Generated:</strong>&nbsp;${escapeHtml(generated)}</div>
  <div class="meta-item">${ICON.globe}&nbsp;<strong>Coverage:</strong>&nbsp;${TOTAL_COUNTRIES} countries worldwide</div>
</div>

<div class="section">
  <div class="section-hdr red">${ICON.phone}&nbsp;EMERGENCY CONTACTS &mdash; CALL IMMEDIATELY</div>
  ${contactRows}
</div>

<div class="section">
  <div class="section-hdr">${ICON.info}&nbsp;SURVIVAL TIPS FOR YOUR REGION (${tips.length})</div>
  <div class="tips-body"><ol>${tipItems}</ol></div>
</div>

${medicalInfo ? `<div class="section">
  <div class="section-hdr green">${ICON.heartGreen}&nbsp;MEDICAL INFORMATION</div>
  <div class="personal-body">${escapeHtml(medicalInfo)}</div>
</div>` : ''}

${personalNotes ? `<div class="section">
  <div class="section-hdr blue">${ICON.user}&nbsp;PERSONAL NOTES</div>
  <div class="personal-body">${escapeHtml(personalNotes)}</div>
</div>` : ''}

<div class="footer">
  <div class="footer-brand">${ICON.shieldFooter}&nbsp;AEGIS Emergency Management System</div>
  <div class="footer-mid">
    <div class="footer-112">112</div>
    <div class="footer-112-label">Universal emergency &mdash; works in most countries</div>
  </div>
  <div class="footer-right">Card ID: ${escapeHtml(cardId)}<br/>For emergency reference only</div>
</div>

</body>
</html>`

    const w = window.open('', '_blank', 'width=720,height=960')
    if (!w) return
    w.document.write(html)
    w.document.close()
    w.print()
  }

  const handleShare = async () => {
    const text = `AEGIS Emergency Card (${countryCode})\nLocation: ${locationLabel}\n\n${contacts.map((c) => `${c.name}: ${c.number}`).join('\n')}`

    if (navigator.share) {
      try {
        await navigator.share({ title: 'AEGIS Emergency Card', text })
      } catch {
        //User cancelled.
      }
      return
    }

    try {
      await navigator.clipboard.writeText(text)
    } catch {
      //Ignore clipboard failures.
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

      {/* HEADER*/}
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
            <p className="text-[10px] text-gray-500 dark:text-gray-300 font-medium mt-0.5">
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
            //GPS
          </button>
        </div>
      </div>

      {/* SEARCH & COUNTRY*/}
      <div className="glass-card rounded-2xl p-3 space-y-3 relative z-20">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-300" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              placeholder={t('offline.searchPlaceholder', lang)}
              className="w-full pl-9 pr-3 py-2.5 text-xs bg-gray-50 dark:bg-gray-800/60 rounded-xl border border-gray-200 dark:border-gray-700 focus:ring-2 focus:ring-aegis-500/30 focus:border-aegis-400 transition text-gray-900 dark:text-white placeholder-gray-400"
            />
          </div>
          <button onClick={handleSearch} disabled={searching || !searchQuery.trim()} className="px-4 py-2.5 bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-400 hover:to-indigo-500 text-white rounded-xl text-xs font-bold transition-all disabled:opacity-40 shadow-md shadow-blue-500/20">
            {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : t('offline.locate', lang)}
          </button>
        </div>
        {locationError && <p className="text-[10px] text-red-500 font-medium ml-1">{locationError}</p>}
        <ProfileCountryPicker
          value={countryCode === 'DEFAULT' ? '' : countryCode.toLowerCase()}
          valueType="code"
          onChange={(_name, code) => {
            setCountryCode(code.toUpperCase())
            setSearchQuery('')
          }}
        />
        {isDetected && (
          <div className="flex items-center gap-1.5 text-[10px] text-gray-500 dark:text-gray-300">
            <MapPin className="w-3 h-3" /> {locationLabel}
          </div>
        )}
      </div>

      {/* QUICK STATS*/}
      <div className="grid grid-cols-3 gap-2">
        <div className="glass-card rounded-xl p-3 text-center">
          <div className="text-2xl font-black text-red-600 dark:text-red-400 leading-none">{contacts.length}</div>
          <div className="text-[9px] font-bold text-gray-500 dark:text-gray-300 uppercase mt-1">{t('offline.contacts', lang)}</div>
        </div>
        <div className="glass-card rounded-xl p-3 text-center">
          <div className="text-2xl font-black text-amber-600 dark:text-amber-400 leading-none">{tips.length}</div>
          <div className="text-[9px] font-bold text-gray-500 dark:text-gray-300 uppercase mt-1">{t('offline.tips', lang)}</div>
        </div>
        <div className="glass-card rounded-xl p-3 text-center">
          <div className="text-2xl font-black text-blue-600 dark:text-blue-400 leading-none">{TOTAL_COUNTRIES}</div>
          <div className="text-[9px] font-bold text-gray-500 dark:text-gray-300 uppercase mt-1">{t('offline.countries', lang)}</div>
        </div>
      </div>

      {/* EMERGENCY CONTACTS*/}
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
                  <Phone className={`w-4.5 h-4.5 ${isPrimary ? 'text-white' : 'text-gray-600 dark:text-gray-300'}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-gray-900 dark:text-white truncate">{c.name}</span>
                    {isPrimary && <span className="text-micro font-black px-1.5 py-0.5 rounded bg-red-100 dark:bg-red-950/40 text-red-600 dark:text-red-400 uppercase">{t('offline.primary', lang)}</span>}
                  </div>
                  <p className="text-[10px] text-gray-500 dark:text-gray-300 mt-0.5">{c.description}</p>
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
                    className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-all text-gray-400 dark:text-gray-300 hover:text-gray-600 dark:hover:text-gray-300 dark:text-gray-300"
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

      {/* SURVIVAL TIPS*/}
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
              const isRegional = i === 0 && countryCode !== 'DEFAULT' && getSurvivalTips(countryCode) !== getSurvivalTips('__none__')
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

      {/* MEDICAL / NOTES (collapsible)*/}
      <button
        onClick={() => setShowForm(!showForm)}
        className="w-full glass-card rounded-xl px-4 py-3 flex items-center justify-between transition-all hover:bg-gray-50/60 dark:hover:bg-gray-800/30"
      >
        <div className="flex items-center gap-2">
          <Heart className="w-4 h-4 text-pink-500" />
          <span className="text-xs font-bold text-gray-900 dark:text-white">{t('offline.personalMedicalNotes', lang)}</span>
          {(medicalInfo || personalNotes) && <span className="w-2 h-2 rounded-full bg-pink-500 animate-pulse" />}
        </div>
        <ChevronDown className={`w-4 h-4 text-gray-400 dark:text-gray-300 transition-transform ${showForm ? 'rotate-180' : ''}`} />
      </button>

      {showForm && (
        <div className="glass-card rounded-xl p-4 space-y-3">
          <div>
            <label className="text-[9px] font-bold text-gray-500 dark:text-gray-300 uppercase tracking-wider">{t('offline.medicalLabel', lang)}</label>
            <textarea
              value={medicalInfo}
              onChange={(e) => setMedicalInfo(e.target.value)}
              rows={2}
              placeholder={t('offline.medicalPlaceholder', lang)}
              className="w-full mt-1.5 px-3 py-2.5 text-xs bg-gray-50 dark:bg-gray-800/60 rounded-xl border border-gray-200 dark:border-gray-700 focus:ring-2 focus:ring-pink-500/30 focus:border-pink-400 transition resize-none text-gray-900 dark:text-white placeholder-gray-400"
            />
          </div>
          <div>
            <label className="text-[9px] font-bold text-gray-500 dark:text-gray-300 uppercase tracking-wider">{t('offline.personalNotesLabel', lang)}</label>
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

      {/* ACTION BUTTONS*/}
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

      {/* FOOTER*/}
      <div className="flex items-center justify-between px-1 text-[9px] font-medium text-gray-400 dark:text-gray-300">
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> {t('offline.aegisEmergencyData', lang)}
          </span>
          <span>{TOTAL_COUNTRIES} {t('offline.countriesSupported', lang)}</span>
        </div>
        <span className="px-2 py-0.5 rounded bg-gray-200/60 dark:bg-gray-700/40 font-bold">{contacts.length} contacts | {tips.length} tips</span>
      </div>
    </div>
  )
}
