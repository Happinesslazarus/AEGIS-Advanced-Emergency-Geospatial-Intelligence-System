/* CitizenPage.tsx — Public citizen portal with alerts, reports, map, and community help. */

import { useState, useMemo, useEffect } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  Shield, AlertTriangle, Users, MapPin, BookOpen, Bell, Sun, Moon,
  ArrowUpDown, Phone, CheckCircle, HelpCircle, X, Heart, Home, Car,
  HeartPulse, Shirt, Crosshair, ExternalLink, Newspaper, Video, FileText,
  ShieldCheck, ThumbsUp, ThumbsDown, Mail, Smartphone, Wifi, MessageCircle,
  Send as SendIcon, Eye, MessageSquare, Droplets, Wind, Thermometer,
  BarChart3, Clock, ChevronRight, Info, Search, Play, BookMarked,
  Waves, Building2, Flame, TreePine, CloudLightning, Bot, RefreshCw,
  Printer, Share2, User, Radio
} from 'lucide-react'
import { useReports } from '../contexts/ReportsContext'
import { useAlerts } from '../contexts/AlertsContext'
import { useLocation } from '../contexts/LocationContext'
import { useTheme } from '../contexts/ThemeContext'
import { t, getLanguage, isRtl } from '../utils/i18n'
import { useLanguage } from '../hooks/useLanguage'
import { useWebPush } from '../hooks/useWebPush'
import { apiSubscribe, apiGetNews, type NewsItem } from '../utils/api'
import { COUNTRY_CODES, type CountryCode, formatPhoneWithCountry } from '../data/countryCodes'
import ALL_COUNTRY_CODES from '../data/allCountryCodes'
import DisasterMap from '../components/shared/DisasterMap'
import WeatherPanel from '../components/shared/WeatherPanel'
import ReportCard from '../components/shared/ReportCard'
import ReportForm from '../components/citizen/ReportForm'
import Chatbot from '../components/citizen/Chatbot'
import CommunityHelp from '../components/citizen/CommunityHelp'
import PreparednessGuide from '../components/citizen/PreparednessGuide'
import RiverGaugePanel from '../components/shared/RiverGaugePanel'
import IntelligenceDashboard from '../components/shared/IntelligenceDashboard'
import CountrySearch from '../components/shared/CountrySearch'
import LanguageSelector from '../components/shared/LanguageSelector'

const PREP_RESOURCES_BY_REGION: Record<string, any[]> = {
  aberdeen: [
    { title: 'Aberdeen Flood Risk Map', type: 'article', source: 'SEPA', url: 'https://www.sepa.org.uk/environment/water/flooding/', icon: Droplets },
    { title: 'What To Do Before A Flood', type: 'video', source: 'UK Environment Agency', url: 'https://www.youtube.com/watch?v=43M5mZuzHF8', icon: Waves },
    { title: 'Aberdeen Emergency Contacts', type: 'article', source: 'Aberdeen City Council', url: 'https://www.aberdeencity.gov.uk/', icon: Phone },
    { title: 'Storm Surge & Coastal Flooding', type: 'video', source: 'Met Office', url: 'https://www.youtube.com/watch?v=pcCCfQDK3cI', icon: CloudLightning },
  ],
  edinburgh: [
    { title: 'Edinburgh Flood Risk', type: 'article', source: 'SEPA', url: 'https://www.sepa.org.uk/environment/water/flooding/', icon: Droplets },
    { title: 'City of Edinburgh Council Emergency Guide', type: 'article', source: 'Edinburgh Council', url: 'https://www.edinburgh.gov.uk/', icon: FileText },
    { title: 'What To Do Before A Flood', type: 'video', source: 'UK Environment Agency', url: 'https://www.youtube.com/watch?v=43M5mZuzHF8', icon: Waves },
    { title: 'Scottish Flood Forum', type: 'article', source: 'Scottish Flood Forum', url: 'https://scottishfloodforum.org/', icon: Users },
  ],
  glasgow: [
    { title: 'Glasgow Flood Warnings', type: 'article', source: 'SEPA', url: 'https://www.sepa.org.uk/environment/water/flooding/', icon: Droplets },
    { title: 'Glasgow City Council Emergency', type: 'article', source: 'Glasgow Council', url: 'https://www.glasgow.gov.uk/', icon: FileText },
    { title: 'River Clyde Flood Risk', type: 'article', source: 'Scottish Government', url: 'https://www.floodscotland.org.uk/', icon: Waves },
    { title: 'How to Make an Emergency Kit', type: 'video', source: 'British Red Cross', url: 'https://www.youtube.com/watch?v=pFh-eEVadJU', icon: Video },
  ],
  dundee: [
    { title: 'Dundee Flood Risk', type: 'article', source: 'SEPA', url: 'https://www.sepa.org.uk/environment/water/flooding/', icon: Droplets },
    { title: 'Tay Estuary Flooding', type: 'article', source: 'Scottish Government', url: 'https://www.floodscotland.org.uk/', icon: Waves },
    { title: 'Dundee City Council Emergency', type: 'article', source: 'Dundee Council', url: 'https://www.dundeecity.gov.uk/', icon: FileText },
    { title: 'Coastal Flooding Safety', type: 'video', source: 'Met Office', url: 'https://www.metoffice.gov.uk/', icon: CloudLightning },
  ],
  scotland: [
    { title: 'Flood Preparation Guide', type: 'article', source: 'Scottish Government', url: 'https://www.floodscotland.org.uk/prepare-yourself/', icon: FileText },
    { title: 'SEPA Flood Warning System', type: 'article', source: 'SEPA', url: 'https://www.sepa.org.uk/environment/water/flooding/', icon: Droplets },
    { title: 'What To Do Before A Flood', type: 'video', source: 'UK Environment Agency', url: 'https://www.youtube.com/watch?v=43M5mZuzHF8', icon: Waves },
    { title: 'Storm Surge & Coastal Flooding', type: 'video', source: 'Met Office', url: 'https://www.youtube.com/watch?v=pcCCfQDK3cI', icon: CloudLightning },
  ],
}

export default function CitizenPage(): JSX.Element {
  const lang = useLanguage()
  const { reports, loading, refreshReports } = useReports()
  const { alerts, notifications, pushNotification, dismissNotification } = useAlerts()
  const { location: loc, availableLocations, activeLocation, setActiveLocation } = useLocation()
  const { dark, toggle } = useTheme()
  const { status: webPushStatus, subscribe: subscribeToWebPush, loading: webPushLoading } = useWebPush()

  const [showReport, setShowReport] = useState(false)
  const [showCommunity, setShowCommunity] = useState(false)
  const [showPreparedness, setShowPreparedness] = useState(false)
  const [showChatbot, setShowChatbot] = useState(false)
  const [activeTab, setActiveTab] = useState('map')
  const [sortField, setSortField] = useState('timestamp')
  const [sortOrder, setSortOrder] = useState('desc')
  const [safetyStatus, setSafetyStatus] = useState<string|null>(null)
  const [showSubscribe, setShowSubscribe] = useState(false)
  const [subChannels, setSubChannels] = useState<string[]>([])
  const [subEmail, setSubEmail] = useState('')
  const [subPhone, setSubPhone] = useState('')
  const [subTelegramId, setSubTelegramId] = useState('')
  const [selectedCountry, setSelectedCountry] = useState<CountryCode>(ALL_COUNTRY_CODES.find(c => c.code === 'GB') || ALL_COUNTRY_CODES[0])
  const [userPosition, setUserPosition] = useState<[number,number]|null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [newsItems, setNewsItems] = useState<NewsItem[]>([])
  const [newsRefreshing, setNewsRefreshing] = useState(false)
  const [searchParams, setSearchParams] = useSearchParams()
  const [selectedAlert, setSelectedAlert] = useState<any>(null)
  const [selectedReport, setSelectedReport] = useState<any>(null)
  const [sosCountdown, setSosCountdown] = useState<number | null>(null)
  const [sosActive, setSosActive] = useState(false)
  const [sosSending, setSosSending] = useState(false)

  // Handle URL params for deep-linking (e.g. from web push notifications)
  useEffect(() => {
    const tabParam = searchParams.get('tab')
    const alertParam = searchParams.get('alert')
    if (tabParam) {
      const validTabs = ['map', 'reports', 'community', 'prepare', 'news']
      if (validTabs.includes(tabParam)) setActiveTab(tabParam)
    }
    if (alertParam) {
      // Fetch the specific alert and show detail modal
      fetch(`/api/alerts`)
        .then(r => r.json())
        .then(data => {
          const list = Array.isArray(data) ? data : (data.alerts || data.data || [])
          const found = list.find((a: any) => String(a.id) === alertParam)
          if (found) {
            setSelectedAlert({
              ...found,
              locationText: found.locationText || found.location || '',
              hazardType: found.hazardType || found.type || 'default',
            })
          }
        })
        .catch(() => {})
      // Clean the URL param after handling
      searchParams.delete('alert')
      searchParams.delete('tab')
      setSearchParams(searchParams, { replace: true })
    }
  }, [])

  const loadNews = async (notify = false): Promise<void> => {
    setNewsRefreshing(true)
    try {
      const payload = await apiGetNews()
      if (Array.isArray(payload?.items) && payload.items.length > 0) {
        setNewsItems(payload.items)
        if (notify) pushNotification('News refreshed with latest sources', 'success')
      } else if (notify) {
        pushNotification('No fresh news available right now', 'warning')
      }
    } catch {
      if (notify) pushNotification('Using cached news sources', 'warning')
    } finally {
      setNewsRefreshing(false)
    }
  }

  useEffect(() => {
    loadNews(false)
  }, [])

  const detectLocation = () => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(p => {
        setUserPosition([p.coords.latitude, p.coords.longitude])
        pushNotification('Location detected', 'success')
      }, () => pushNotification('Location access denied', 'warning'))
    }
  }

  // ── Guest SOS Handler ──
  const handleGuestSOS = () => {
    if (sosCountdown !== null) {
      // Cancel countdown
      setSosCountdown(null)
      return
    }
    // Start 5-second countdown
    let count = 5
    setSosCountdown(count)
    const timer = setInterval(() => {
      count--
      if (count <= 0) {
        clearInterval(timer)
        setSosCountdown(null)
        sendGuestSOS()
      } else {
        setSosCountdown(count)
      }
    }, 1000)
  }

  const sendGuestSOS = async () => {
    setSosSending(true)
    try {
      // Get GPS location
      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        if (!navigator.geolocation) return reject(new Error('No GPS'))
        navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 10000, enableHighAccuracy: true })
      }).catch(() => null)

      const lat = position?.coords.latitude ?? userPosition?.[0] ?? loc.center?.[0] ?? 57.15
      const lng = position?.coords.longitude ?? userPosition?.[1] ?? loc.center?.[1] ?? -2.11

      // Submit emergency report via public reports API
      const response = await fetch('/api/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'SOS Emergency',
          severity: 'High',
          description: 'GUEST SOS EMERGENCY — Citizen requires immediate assistance. Activated from public safety page.',
          location: `GPS: ${lat.toFixed(5)}, ${lng.toFixed(5)}`,
          latitude: lat,
          longitude: lng,
          timestamp: new Date().toISOString(),
          category: 'SOS_EMERGENCY',
          reporterName: 'Anonymous Guest',
        })
      })

      if (!response.ok) throw new Error('Failed to send SOS')

      setSosActive(true)
      pushNotification('SOS SENT — Emergency services have been notified. If in immediate danger, call 999.', 'error')
      // Auto-clear after 30 seconds
      setTimeout(() => setSosActive(false), 30000)
    } catch (err: any) {
      pushNotification('SOS failed to send. Please call 999 directly.', 'error')
    } finally {
      setSosSending(false)
    }
  }

  const sorted = useMemo(() => {
    let arr = [...reports]
    if (searchTerm) { const s = searchTerm.toLowerCase(); arr = arr.filter(r => r.type?.toLowerCase().includes(s) || r.location?.toLowerCase().includes(s) || r.description?.toLowerCase().includes(s)) }
    const SEV = { High: 3, Medium: 2, Low: 1 }
    arr.sort((a, b) => {
      let cmp = 0
      if (sortField === 'severity') cmp = (SEV[b.severity]||0) - (SEV[a.severity]||0)
      else if (sortField === 'confidence') cmp = (b.confidence||0) - (a.confidence||0)
      else cmp = new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      return sortOrder === 'asc' ? -cmp : cmp
    })
    return arr
  }, [reports, sortField, sortOrder, searchTerm])

  const prepResources = useMemo(() => 
    PREP_RESOURCES_BY_REGION[activeLocation] || PREP_RESOURCES_BY_REGION.scotland, 
    [activeLocation]
  )

  const stats = { total: reports.length, urgent: reports.filter(r=>r.status==='Urgent').length, high: reports.filter(r=>r.severity==='High').length, verified: reports.filter(r=>r.status==='Verified').length, alertCount: alerts.length }

  const handleSubscribe = async () => {
    if (subChannels.length === 0) return
    try {
      const normalizedChannels = subChannels.map(ch => ch === 'webpush' ? 'web' : ch)
      const formattedPhone = subPhone ? formatPhoneWithCountry(selectedCountry, subPhone) : ''
      
      // Subscribe to Web Push first if selected
      if (subChannels.includes('webpush')) {
        try {
          await subscribeToWebPush(subEmail)
          pushNotification('✅ Web Push enabled successfully', 'success')
        } catch (err: any) {
          console.error('Web Push subscription failed:', err)
          pushNotification(`Web Push setup failed: ${err.message}. Other channels will still be active.`, 'warning')
        }
      }
      
      // Register subscription preferences on server
      await apiSubscribe({ 
        email: subEmail, 
        phone: formattedPhone, 
        whatsapp: formattedPhone, 
        telegram_id: subTelegramId || undefined,
        channels: normalizedChannels, 
        severity_filter: ['critical','warning','info'] 
      })
      pushNotification(`Subscribed to: ${normalizedChannels.join(', ')}`, 'success')
      setShowSubscribe(false)
    } catch (err: any) {
      pushNotification(err?.message || 'Subscription failed. Check contact format and selected channels.', 'error')
    }
  }

  const handleViewReport = (report: any) => {
    setSelectedReport(report)
  }

  const handlePrintReport = (report: any) => {
    const printWindow = window.open('', '_blank')
    if (!printWindow) {
      pushNotification('Unable to open print window. Please allow popups.', 'warning')
      return
    }

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>AEGIS Report ${report.id}</title>
        <style>
          body { font-family: system-ui, -apple-system, sans-serif; max-width: 800px; margin: 40px auto; padding: 20px; line-height: 1.6; }
          .header { border-bottom: 3px solid #1e40af; padding-bottom: 20px; margin-bottom: 20px; }
          .logo { font-size: 24px; font-weight: bold; color: #1e40af; }
          .report-id { color: #666; font-family: monospace; }
          .badge { display: inline-block; padding: 4px 12px; border-radius: 4px; font-size: 12px; font-weight: 600; margin-right: 8px; }
          .severity-high { background: #fee; color: #c00; }
          .severity-medium { background: #ffc; color: #860; }
          .severity-low { background: #efe; color: #060; }
          .meta { color: #666; font-size: 14px; margin: 10px 0; }
          .description { margin: 20px 0; }
          .footer { margin-top: 40px; padding-top: 20px; border-top: 1px solid #ddd; color: #666; font-size: 12px; }
          @media print { body { margin: 0; } }
        </style>
      </head>
      <body>
        <div class="header">
          <div class="logo">🛡️ AEGIS Emergency Management</div>
          <div class="report-id">Report ID: ${report.id}</div>
        </div>
        <div>
          <span class="badge severity-${report.severity.toLowerCase()}">${report.severity}</span>
          <span class="badge">${report.status}</span>
          ${report.confidence != null ? `<span class="badge">AI Confidence: ${report.confidence}%</span>` : ''}
        </div>
        <h2>${report.type}</h2>
        <div class="meta">
          <div>📍 Location: ${report.location}</div>
          <div>⏰ Reported: ${report.displayTime || new Date(report.timestamp).toLocaleString()}</div>
          ${report.reporterName ? `<div>👤 Reporter: ${report.reporterName}</div>` : ''}
        </div>
        <div class="description">
          <h3>Description</h3>
          <p>${report.description}</p>
        </div>
        ${report.aiAnalysis?.summary ? `
        <div>
          <h3>AI Analysis</h3>
          <p>${report.aiAnalysis.summary}</p>
          ${report.aiAnalysis.vulnerablePersonAlert ? '<p><strong>⚠️ Vulnerable Person Alert</strong></p>' : ''}
        </div>
        ` : ''}
        <div class="footer">
          <p>This report was generated from the AEGIS Emergency Management System on ${new Date().toLocaleString()}.</p>
          <p>For official inquiries, contact your local emergency services.</p>
        </div>
      </body>
      </html>
    `

    printWindow.document.write(html)
    printWindow.document.close()
    setTimeout(() => {
      printWindow.print()
    }, 250)
  }

  const handleShareReport = async (report: any) => {
    const shareData = {
      title: `AEGIS Report: ${report.type}`,
      text: `${report.type} - ${report.severity} severity\n📍 ${report.location}\n\n${report.description}`,
      url: window.location.href,
    }

    // Try native Web Share API first
    if (navigator.share) {
      try {
        await navigator.share(shareData)
        pushNotification('Report shared successfully', 'success')
      } catch (err: any) {
        if (err.name !== 'AbortError') {
          pushNotification('Share cancelled', 'info')
        }
      }
    } else {
      // Fallback: Copy to clipboard and show mailto option
      const reportText = `${shareData.title}\n\n${shareData.text}\n\nView on AEGIS: ${shareData.url}`
      try {
        await navigator.clipboard.writeText(reportText)
        pushNotification('Report details copied to clipboard!', 'success')
        
        // Also offer email option
        const mailtoLink = `mailto:?subject=${encodeURIComponent(shareData.title)}&body=${encodeURIComponent(reportText)}`
        window.open(mailtoLink, '_blank')
      } catch {
        pushNotification('Unable to share. Please copy the report details manually.', 'warning')
      }
    }
  }

  /* ── Tabs include Community Support ── */
  const TABS = [
    { id: 'map', label: t('map.title', lang) || 'Live Map', icon: MapPin },
    { id: 'reports', label: t('reports.title', lang) || 'Reports', icon: FileText },
    { id: 'prepare', label: t('prep.title', lang), icon: BookOpen },
    { id: 'news', label: t('citizen.tab.news', lang), icon: Newspaper },
  ]

  return (
    <div className={`min-h-screen bg-gradient-to-br from-gray-50 via-white to-aegis-50/30 dark:from-gray-950 dark:via-gray-900 dark:to-gray-950 text-gray-900 dark:text-gray-100 ${isRtl(lang)?'rtl':'ltr'}`} dir={isRtl(lang)?'rtl':'ltr'}>
      {/* ═══ NAVIGATION ═══ */}
      <nav className="glass-nav bg-gradient-to-r from-aegis-700 via-aegis-600 to-aegis-700 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900 text-white sticky top-0 z-40 shadow-xl border-b border-white/10">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link to="/" className="flex items-center gap-2.5 hover:opacity-90 transition-opacity group">
              <div className="w-9 h-9 rounded-xl bg-white/15 backdrop-blur-sm flex items-center justify-center group-hover:bg-white/25 transition-all">
                <Shield className="w-5 h-5" />
              </div>
              <div className="hidden sm:block">
                <span className="font-bold text-sm block leading-tight">{t('app.title', lang)}</span>
                <span className="text-[9px] text-white/60 leading-none">{t('app.subtitle', lang)}</span>
              </div>
            </Link>
            <select value={activeLocation} onChange={e=>setActiveLocation(e.target.value)} className="bg-white/10 backdrop-blur-sm text-white text-xs px-3 py-2 rounded-xl border border-white/20 ml-2 hover:bg-white/20 transition-colors cursor-pointer">
              {availableLocations.map(l=><option key={l.key} value={l.key} className="text-gray-900">{l.name}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <LanguageSelector darkNav />
            <button onClick={toggle} className="p-2.5 hover:bg-white/15 rounded-xl transition-all active:scale-95" aria-label="Toggle theme">
              {dark ? <Sun className="w-4 h-4"/> : <Moon className="w-4 h-4"/>}
            </button>
            <Link to="/admin" className="text-xs bg-white/10 hover:bg-white/20 backdrop-blur-sm border border-white/20 px-3.5 py-2 rounded-xl hidden sm:block transition-all hover:scale-[1.02] font-medium">{t('auth.title', lang)}</Link>
            <Link to="/citizen/login" className="text-xs bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-400 hover:to-emerald-500 border border-emerald-400/30 px-4 py-2 rounded-xl hidden sm:flex items-center gap-1.5 transition-all hover:scale-[1.02] font-bold shadow-lg shadow-emerald-600/20"><User className="w-3.5 h-3.5"/>{t('citizen.auth.signIn', lang)}</Link>
          </div>
        </div>
      </nav>

      {/* Alerts are displayed contextually within the page, not as a top banner */}

      <main className="max-w-7xl mx-auto px-4 py-6 space-y-6">
        {/* ═══ HERO BANNER ═══ */}
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-aegis-600 via-aegis-500 to-blue-600 dark:from-aegis-800 dark:via-aegis-700 dark:to-blue-900 p-6 sm:p-8 text-white shadow-2xl shadow-aegis-600/20">
          <div className="absolute inset-0 opacity-10">
            <svg width="100%" height="100%"><defs><pattern id="guestDots" x="0" y="0" width="20" height="20" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1" fill="white"/></pattern></defs><rect width="100%" height="100%" fill="url(#guestDots)"/></svg>
          </div>
          <div className="absolute top-0 right-0 w-64 h-64 bg-white/5 rounded-full -translate-y-1/2 translate-x-1/3 blur-2xl"/>
          <div className="absolute bottom-0 left-0 w-48 h-48 bg-blue-400/10 rounded-full translate-y-1/2 -translate-x-1/4 blur-2xl"/>
          <div className="relative z-10">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-8 h-8 rounded-xl bg-white/20 backdrop-blur-sm flex items-center justify-center">
                <Shield className="w-4.5 h-4.5"/>
              </div>
              <span className="text-xs font-bold bg-white/15 backdrop-blur-sm px-3 py-1 rounded-full">{t('citizen.hero.publicPortal', lang) || 'Public Safety Portal'}</span>
            </div>
            <h1 className="text-xl sm:text-2xl font-extrabold mb-1">{t('citizen.hero.title', lang) || 'Real-Time Emergency Awareness'}</h1>
            <p className="text-sm text-white/70 max-w-lg">{t('citizen.hero.subtitle', lang) || 'Monitor live incidents, report emergencies, check safety status, and stay informed with AI-powered alerts.'}</p>
            <div className="flex flex-wrap gap-2 mt-4">
              <button onClick={()=>setShowReport(true)} className="bg-white/20 hover:bg-white/30 backdrop-blur-sm border border-white/20 px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all hover:scale-[1.02]">
                <AlertTriangle className="w-3.5 h-3.5"/> {t('report.title', lang)}
              </button>
              <button onClick={()=>setActiveTab('map')} className="bg-white/10 hover:bg-white/20 backdrop-blur-sm border border-white/10 px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all hover:scale-[1.02]">
                <MapPin className="w-3.5 h-3.5"/> {t('map.title', lang) || 'Live Map'}
              </button>
              <Link to="/citizen/login" className="bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-400 hover:to-emerald-500 border border-emerald-400/30 px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all hover:scale-[1.02] shadow-lg shadow-emerald-600/20 sm:hidden">
                <User className="w-3.5 h-3.5"/> {t('citizen.auth.signIn', lang)}
              </Link>
            </div>
          </div>
        </div>

        {/* ═══ SAFETY CHECK-IN ═══ */}
        <div className="glass-card rounded-2xl p-5 shadow-lg">
          <h3 className="font-bold text-sm mb-4 flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-aegis-400 to-aegis-600 flex items-center justify-center">
              <ShieldCheck className="w-4 h-4 text-white"/>
            </div>
            {t('safety.title', lang)}
          </h3>
          {safetyStatus ? (
            <div className={`p-4 rounded-2xl text-sm font-semibold flex items-center gap-3 ${safetyStatus==='safe'?'bg-gradient-to-r from-green-50 to-emerald-50 dark:from-green-950/30 dark:to-emerald-950/20 text-green-700 dark:text-green-300 border border-green-200/50 dark:border-green-800/50':safetyStatus==='help'?'bg-gradient-to-r from-red-50 to-rose-50 dark:from-red-950/30 dark:to-rose-950/20 text-red-700 dark:text-red-300 border border-red-200/50 dark:border-red-800/50':'bg-gradient-to-r from-amber-50 to-yellow-50 dark:from-amber-950/30 dark:to-yellow-950/20 text-amber-700 dark:text-amber-300 border border-amber-200/50 dark:border-amber-800/50'}`}>
              {safetyStatus==='safe'&&<><CheckCircle className="w-5 h-5"/>{t('citizen.safety.safeMsg', lang)}</>}
              {safetyStatus==='help'&&<><AlertTriangle className="w-5 h-5"/>{t('citizen.safety.helpMsg', lang)}</>}
              {safetyStatus==='unsure'&&<><HelpCircle className="w-5 h-5"/>{t('citizen.safety.unsureMsg', lang)}</>}
              <button onClick={()=>setSafetyStatus(null)} className="ml-auto text-xs font-bold bg-white/60 dark:bg-white/10 hover:bg-white/80 dark:hover:bg-white/20 px-3 py-1.5 rounded-lg transition-all">{t('citizen.safety.update', lang)}</button>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-3">
              <button onClick={()=>setSafetyStatus('safe')} className="bg-gradient-to-br from-green-50 to-emerald-100 dark:from-green-900/30 dark:to-emerald-900/20 hover:from-green-100 hover:to-emerald-200 dark:hover:from-green-900/50 dark:hover:to-emerald-900/40 text-green-800 dark:text-green-200 rounded-2xl py-4 text-sm font-bold flex flex-col items-center justify-center gap-2 transition-all border border-green-200/60 dark:border-green-800/50 hover:shadow-lg hover:shadow-green-500/10 hover:scale-[1.02] active:scale-[0.98]">
                <CheckCircle className="w-6 h-6"/> {t('safety.safe', lang)}
              </button>
              <button onClick={()=>setSafetyStatus('help')} className="bg-gradient-to-br from-red-50 to-rose-100 dark:from-red-900/30 dark:to-rose-900/20 hover:from-red-100 hover:to-rose-200 dark:hover:from-red-900/50 dark:hover:to-rose-900/40 text-red-800 dark:text-red-200 rounded-2xl py-4 text-sm font-bold flex flex-col items-center justify-center gap-2 transition-all border border-red-200/60 dark:border-red-800/50 hover:shadow-lg hover:shadow-red-500/10 hover:scale-[1.02] active:scale-[0.98]">
                <AlertTriangle className="w-6 h-6"/> {t('safety.help', lang)}
              </button>
              <button onClick={()=>setSafetyStatus('unsure')} className="bg-gradient-to-br from-amber-50 to-yellow-100 dark:from-amber-900/30 dark:to-yellow-900/20 hover:from-amber-100 hover:to-yellow-200 dark:hover:from-amber-900/50 dark:hover:to-yellow-900/40 text-amber-800 dark:text-amber-200 rounded-2xl py-4 text-sm font-bold flex flex-col items-center justify-center gap-2 transition-all border border-amber-200/60 dark:border-amber-800/50 hover:shadow-lg hover:shadow-amber-500/10 hover:scale-[1.02] active:scale-[0.98]">
                <HelpCircle className="w-6 h-6"/> {t('safety.unsure', lang)}
              </button>
            </div>
          )}
        </div>

        {/* ═══ STATS ═══ */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {[
            { label: t('stats.total', lang), value: stats.total, icon: FileText, gradient: 'from-gray-400 to-gray-600', bg: 'bg-gray-100 dark:bg-gray-800' },
            { label: t('stats.urgent', lang), value: stats.urgent, icon: AlertTriangle, gradient: 'from-red-400 to-red-600', bg: 'bg-red-50 dark:bg-red-950/20' },
            { label: t('citizen.stats.highSeverity', lang), value: stats.high, icon: Flame, gradient: 'from-amber-400 to-orange-600', bg: 'bg-amber-50 dark:bg-amber-950/20' },
            { label: t('stats.verified', lang), value: stats.verified, icon: CheckCircle, gradient: 'from-green-400 to-emerald-600', bg: 'bg-green-50 dark:bg-green-950/20' },
            { label: t('stats.activeAlerts', lang), value: stats.alertCount, icon: Bell, gradient: 'from-blue-400 to-blue-600', bg: 'bg-blue-50 dark:bg-blue-950/20' },
          ].map((s,i)=>(
            <div key={i} className="glass-card rounded-2xl p-4 hover-lift transition-all duration-300" style={{animationDelay:`${i*60}ms`}}>
              <div className="flex items-center justify-between mb-2">
                <div className={`w-9 h-9 rounded-xl bg-gradient-to-br ${s.gradient} flex items-center justify-center shadow-sm`}>
                  <s.icon className="w-4.5 h-4.5 text-white"/>
                </div>
              </div>
              <p className="text-2xl font-extrabold text-gray-900 dark:text-white">{s.value}</p>
              <p className="text-[10px] text-gray-500 dark:text-gray-400 font-bold uppercase tracking-wider mt-0.5">{s.label}</p>
            </div>
          ))}
        </div>

        {/* ═══ ACTION BUTTONS ═══ */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { onClick: ()=>setShowReport(true), icon: AlertTriangle, label: t('report.title', lang), desc: t('citizen.action.reportDesc', lang) || 'Report an incident', gradient: 'from-red-500 to-rose-600', shadow: 'shadow-red-500/25' },
            { onClick: ()=>setShowSubscribe(true), icon: Bell, label: t('subscribe.title', lang) || 'Alerts', desc: t('citizen.action.alertDesc', lang) || 'Get notified instantly', gradient: 'from-blue-500 to-indigo-600', shadow: 'shadow-blue-500/25' },
            { onClick: ()=>setShowCommunity(true), icon: Users, label: t('community.title', lang), desc: t('citizen.action.communityDesc', lang) || 'Help your neighbors', gradient: 'from-emerald-500 to-green-600', shadow: 'shadow-emerald-500/25' },
            { onClick: ()=>{ window.location.href='/admin' }, icon: Shield, label: t('auth.title', lang) || 'Operator Login', desc: t('citizen.action.operatorDesc', lang) || 'Emergency operators', gradient: 'from-aegis-500 to-aegis-700', shadow: 'shadow-aegis-500/25' },
          ].map((action, i) => (
            <button key={i} onClick={action.onClick} className={`bg-gradient-to-br ${action.gradient} text-white rounded-2xl p-5 text-center transition-all duration-300 shadow-xl ${action.shadow} group hover:scale-[1.03] hover:shadow-2xl active:scale-[0.98]`}>
              <div className="w-12 h-12 rounded-2xl bg-white/20 backdrop-blur-sm mx-auto mb-2.5 flex items-center justify-center group-hover:bg-white/30 transition-all group-hover:scale-110">
                <action.icon className="w-6 h-6"/>
              </div>
              <p className="text-sm font-bold">{action.label}</p>
              <p className="text-[10px] text-white/60 mt-0.5 hidden sm:block">{action.desc}</p>
            </button>
          ))}
        </div>

        {/* ═══ TABS ═══ */}
        <div className="glass-card rounded-2xl p-1.5 flex gap-1 overflow-x-auto">
          {TABS.map(tab=>(
            <button key={tab.id} onClick={()=>setActiveTab(tab.id)} className={`px-5 py-3 text-xs font-bold flex items-center gap-2 whitespace-nowrap rounded-xl transition-all duration-200 ${activeTab===tab.id?'bg-gradient-to-r from-aegis-500 to-aegis-600 text-white shadow-lg shadow-aegis-500/20':'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-700 dark:hover:text-gray-200'}`}>
              <tab.icon className="w-4 h-4"/> {tab.label}
            </button>
          ))}
        </div>

        {/* ═══ MAP TAB ═══ */}
        {activeTab==='map'&&(
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 animate-fade-in">
            <div className="lg:col-span-2">
              <div className="glass-card rounded-2xl overflow-hidden shadow-lg">
                <div className="p-4 border-b border-gray-200/50 dark:border-gray-700/50 flex items-center justify-between">
                  <h2 className="font-bold text-sm flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-aegis-400 to-blue-600 flex items-center justify-center">
                      <MapPin className="w-4 h-4 text-white"/>
                    </div>
                    {t('citizen.map.liveIncidentMap', lang)}
                  </h2>
                  <button onClick={detectLocation} className="text-xs bg-gray-100/80 dark:bg-gray-800/80 hover:bg-gray-200 dark:hover:bg-gray-700 px-3.5 py-2 rounded-xl flex items-center gap-1.5 transition-all hover:scale-[1.02] font-medium border border-gray-200/50 dark:border-gray-700/50">
                    <Crosshair className="w-3.5 h-3.5"/> {t('citizen.map.myLocation', lang)}
                  </button>
                </div>
                <div className="h-[300px] sm:h-[400px] lg:h-[500px]"><DisasterMap reports={reports} center={userPosition||loc.center} zoom={userPosition?14:loc.zoom} showDistress showPredictions showRiskLayer showFloodMonitoring/></div>
                {userPosition&&<div className="px-4 py-2.5 bg-gradient-to-r from-green-50 to-emerald-50 dark:from-green-950/20 dark:to-emerald-950/20 text-xs text-green-700 dark:text-green-300 flex items-center gap-1.5 font-medium"><Crosshair className="w-3.5 h-3.5"/> Location: {userPosition[0].toFixed(4)}, {userPosition[1].toFixed(4)}</div>}
              </div>
            </div>
            <div className="space-y-4">
              <IntelligenceDashboard collapsed={true} className="bg-gray-900 rounded-2xl border border-gray-700 shadow-lg" />
              <WeatherPanel/>
              <RiverGaugePanel/>
            </div>
          </div>
        )}

        {/* ═══ REPORTS TAB ═══ */}
        {activeTab==='reports'&&(
          <div className="animate-fade-in space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-bold text-lg flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-blue-400 to-indigo-600 flex items-center justify-center">
                  <FileText className="w-4 h-4 text-white"/>
                </div>
                {t('reports.title', lang) || 'Reports'}
                <span className="text-xs font-bold bg-aegis-100 dark:bg-aegis-900/30 text-aegis-700 dark:text-aegis-300 px-2.5 py-1 rounded-full">{sorted.length}</span>
              </h2>
              <button onClick={()=>setShowReport(true)} className="text-xs bg-gradient-to-r from-red-500 to-rose-600 hover:from-red-400 hover:to-rose-500 text-white px-4 py-2 rounded-xl font-bold flex items-center gap-1.5 transition-all hover:scale-[1.02] shadow-lg shadow-red-500/20">
                <AlertTriangle className="w-3.5 h-3.5"/> {t('report.title', lang)}
              </button>
            </div>
            <div className="glass-card rounded-2xl overflow-hidden shadow-lg">
              <div className="p-4 border-b border-gray-200/50 dark:border-gray-700/50 flex flex-wrap items-center gap-2.5">
                <div className="relative flex-1 min-w-[200px]"><Search className="absolute left-3.5 top-2.5 w-4 h-4 text-gray-400"/><input className="w-full pl-10 pr-3 py-2.5 text-xs bg-gray-100/80 dark:bg-gray-800/80 rounded-xl border border-gray-200/50 dark:border-gray-700/50 focus:ring-2 focus:ring-aegis-500/30 focus:border-aegis-400 transition-all" placeholder={t('reports.search', lang) || 'Search reports...'} value={searchTerm} onChange={e=>setSearchTerm(e.target.value)}/></div>
                <select value={sortField} onChange={e=>setSortField(e.target.value)} className="text-xs bg-gray-100/80 dark:bg-gray-800/80 px-3 py-2.5 rounded-xl border border-gray-200/50 dark:border-gray-700/50 cursor-pointer"><option value="timestamp">{t('citizen.reports.newest', lang)}</option><option value="severity">{t('reports.severity', lang)}</option><option value="confidence">{t('citizen.reports.aiConfidence', lang)}</option></select>
                <button onClick={()=>setSortOrder(o=>o==='desc'?'asc':'desc')} className="p-2.5 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-xl transition-all border border-gray-200/50 dark:border-gray-700/50"><ArrowUpDown className="w-4 h-4"/></button>
              </div>
              <div className="divide-y divide-gray-100 dark:divide-gray-800 max-h-[600px] overflow-y-auto custom-scrollbar">
                {loading?<p className="p-6 text-center text-sm text-gray-500">{t('general.loading', lang)}</p>:
                  sorted.length===0?<p className="p-6 text-center text-sm text-gray-500">{t('general.noResults', lang)}</p>:
                  sorted.map(r=>(
                    <div key={r.id} className="relative group">
                      <ReportCard report={r} onClick={handleViewReport}/>
                      <div className="absolute top-3 right-3 flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={(e)=>{e.stopPropagation();handleShareReport(r)}}
                          className="p-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-950/20 hover:border-blue-300 transition-all shadow-sm"
                          title={t('citizen.reports.shareReport', lang)}
                        >
                          <Share2 className="w-4 h-4 text-blue-600"/>
                        </button>
                        <button
                          onClick={(e)=>{e.stopPropagation();handlePrintReport(r)}}
                          className="p-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 hover:border-gray-400 transition-all shadow-sm"
                          title={t('citizen.reports.printReport', lang)}
                        >
                          <Printer className="w-4 h-4 text-gray-600 dark:text-gray-400"/>
                        </button>
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          </div>
        )}

        {/* ═══ PREPAREDNESS TAB — both V5 guide and V6 resources ═══ */}
        {activeTab==='prepare'&&(
          <div className="space-y-5 animate-fade-in">
            <div>
              <h2 className="font-bold text-lg flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-amber-400 to-orange-600 flex items-center justify-center">
                  <BookOpen className="w-4 h-4 text-white"/>
                </div>
                {t('prep.title', lang)}
              </h2>
              <p className="text-sm text-gray-600 dark:text-gray-400 mt-1.5 ml-[42px]">{t('citizen.prep.description', lang)}</p>
            </div>

            {/* V5 Preparedness Guide (full interactive modal) */}
            <button onClick={()=>setShowPreparedness(true)} className="w-full bg-gradient-to-r from-aegis-500 to-aegis-700 hover:from-aegis-400 hover:to-aegis-600 text-white rounded-2xl p-5 text-sm font-bold flex items-center justify-center gap-2.5 transition-all shadow-xl shadow-aegis-600/20 hover:scale-[1.01] active:scale-[0.99]">
              <BookMarked className="w-5 h-5"/> {t('nav.preparedness', lang) || 'Open Full Preparedness Guide'}
            </button>

            {/* V6 Resource links - Location-aware */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {prepResources.map((r, i) => (
                <a key={i} href={r.url} target="_blank" rel="noopener noreferrer" className="glass-card rounded-2xl p-4 hover:shadow-xl hover:border-aegis-300 dark:hover:border-aegis-700 transition-all duration-300 flex items-start gap-3.5 group hover-lift">
                  <div className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 ${r.type==='video'?'bg-gradient-to-br from-red-400 to-rose-600':'bg-gradient-to-br from-blue-400 to-indigo-600'}`}>
                    {r.type==='video'?<Play className="w-5 h-5 text-white"/>:<r.icon className="w-5 h-5 text-white"/>}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold group-hover:text-aegis-600 transition-colors flex items-center gap-1">{r.title}<ExternalLink className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity"/></p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className={`text-[9px] font-bold uppercase px-2 py-0.5 rounded-full ${r.type==='video'?'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400':'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400'}`}>{r.type==='video'?'Video':'Article'}</span>
                      <span className="text-[10px] text-gray-500">{r.source}</span>
                    </div>
                  </div>
                </a>
              ))}
            </div>
          </div>
        )}

        {/* ═══ NEWS TAB ═══ */}
        {activeTab==='news'&&(
          <div className="space-y-4 animate-fade-in">
            <div className="flex items-center justify-between">
              <h2 className="font-bold text-lg flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-aegis-400 to-aegis-600 flex items-center justify-center">
                  <Newspaper className="w-4 h-4 text-white"/>
                </div>
                {t('citizen.tab.news', lang)}
              </h2>
              <button
                onClick={async()=>{await loadNews(true);await refreshReports?.()}}
                disabled={newsRefreshing}
                className="flex items-center gap-1.5 text-xs text-aegis-600 hover:text-aegis-700 bg-aegis-50/80 dark:bg-aegis-950/30 border border-aegis-200/60 dark:border-aegis-800/60 px-4 py-2 rounded-xl transition-all disabled:opacity-60 hover:scale-[1.02] font-bold backdrop-blur-sm"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${newsRefreshing ? 'animate-spin' : ''}`}/> {t('citizen.news.refresh', lang)}
              </button>
            </div>
            <div className="space-y-2.5">
              {newsItems.length === 0 && (
                <div className="glass-card rounded-2xl p-8 text-center">
                  <Newspaper className="w-10 h-10 text-gray-300 dark:text-gray-600 mx-auto mb-3"/>
                  <p className="text-sm text-gray-500 font-medium">No news available right now</p>
                  <p className="text-xs text-gray-400 mt-1">Click refresh to check for updates</p>
                </div>
              )}
              {newsItems.map((n,i)=>{
                const typeConfig: Record<string,{color:string,bg:string,label:string}> = {
                  alert: { color: 'bg-red-500', bg: 'bg-red-50 dark:bg-red-950/20 border-red-200/50 dark:border-red-800/50', label: 'ALERT' },
                  warning: { color: 'bg-amber-500', bg: 'bg-amber-50 dark:bg-amber-950/20 border-amber-200/50 dark:border-amber-800/50', label: 'WARNING' },
                  community: { color: 'bg-green-500', bg: 'bg-green-50 dark:bg-green-950/20 border-green-200/50 dark:border-green-800/50', label: 'COMMUNITY' },
                  tech: { color: 'bg-purple-500', bg: 'bg-purple-50 dark:bg-purple-950/20 border-purple-200/50 dark:border-purple-800/50', label: 'TECH' },
                  info: { color: 'bg-blue-500', bg: 'bg-blue-50 dark:bg-blue-950/20 border-blue-200/50 dark:border-blue-800/50', label: 'INFO' },
                }
                const cfg = typeConfig[n.type] || typeConfig.info
                return (
                  <div key={i} className="glass-card rounded-2xl p-4 hover:shadow-lg transition-all duration-300 flex items-start gap-3.5 group hover-lift">
                    <div className={`w-3 h-3 rounded-full flex-shrink-0 mt-1.5 ${cfg.color} ring-4 ring-offset-2 ring-offset-white dark:ring-offset-gray-900 ${cfg.color}/20`}/>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`text-[8px] font-extrabold uppercase tracking-wider px-2 py-0.5 rounded-full ${cfg.bg} border`}>{cfg.label}</span>
                      </div>
                      <a href={n.url} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold hover:text-aegis-600 transition-colors block">
                        {n.title}
                      </a>
                      <p className="text-[10px] text-gray-500 mt-0.5">{n.source} · {n.time}</p>
                    </div>
                    <a href={n.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-[10px] text-aegis-600 hover:text-aegis-700 bg-aegis-50 dark:bg-aegis-950/20 border border-aegis-200/60 dark:border-aegis-800/60 px-3 py-1.5 rounded-xl flex-shrink-0 transition-all opacity-0 group-hover:opacity-100 font-bold">
                      <ExternalLink className="w-3 h-3"/> {t('citizen.news.source', lang)}
                    </a>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </main>

      {/* ═══ FOOTER ═══ */}
      <footer className="bg-gradient-to-b from-gray-100 to-gray-200 dark:from-gray-900 dark:to-gray-950 border-t border-gray-200/50 dark:border-gray-800/50 mt-10">
        <div className="max-w-7xl mx-auto px-4 py-10">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-8 text-xs text-gray-600 dark:text-gray-400">
            <div>
              <h4 className="font-extrabold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
                <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-red-400 to-rose-600 flex items-center justify-center"><Phone className="w-3 h-3 text-white"/></div>
                Emergency
              </h4>
              <div className="space-y-1.5">
                <p>Emergency Services: <strong className="text-gray-900 dark:text-white">999</strong></p>
                <p>NHS: <strong className="text-gray-900 dark:text-white">111</strong></p>
                <p>Samaritans: <strong className="text-gray-900 dark:text-white">116 123</strong></p>
                <p>Floodline: <strong className="text-gray-900 dark:text-white">0345 988 1188</strong></p>
              </div>
            </div>
            <div>
              <h4 className="font-extrabold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
                <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-blue-400 to-indigo-600 flex items-center justify-center"><ExternalLink className="w-3 h-3 text-white"/></div>
                {t('admin.resources', lang)}
              </h4>
              <div className="space-y-1.5">
                <a href="https://www.sepa.org.uk" target="_blank" rel="noopener noreferrer" className="block hover:text-aegis-600 transition-colors">SEPA</a>
                <a href="https://www.metoffice.gov.uk" target="_blank" rel="noopener noreferrer" className="block hover:text-aegis-600 transition-colors">Met Office</a>
                <a href="https://www.gov.scot" target="_blank" rel="noopener noreferrer" className="block hover:text-aegis-600 transition-colors">Scottish Government</a>
                <a href="https://www.redcross.org.uk" target="_blank" rel="noopener noreferrer" className="block hover:text-aegis-600 transition-colors">British Red Cross</a>
              </div>
            </div>
            <div>
              <h4 className="font-extrabold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
                <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-aegis-400 to-aegis-600 flex items-center justify-center"><Shield className="w-3 h-3 text-white"/></div>
                {t('citizen.footer.platform', lang)}
              </h4>
              <div className="space-y-1.5">
                <Link to="/about" className="block hover:text-aegis-600 transition-colors">About AEGIS</Link>
                <Link to="/accessibility" className="block hover:text-aegis-600 transition-colors">Accessibility</Link>
                <Link to="/privacy" className="block hover:text-aegis-600 transition-colors">Privacy Policy</Link>
                <Link to="/terms" className="block hover:text-aegis-600 transition-colors">Terms of Use</Link>
              </div>
            </div>
            <div>
              <h4 className="font-extrabold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
                <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-violet-400 to-purple-600 flex items-center justify-center"><Building2 className="w-3 h-3 text-white"/></div>
                {t('citizen.footer.contact', lang)}
              </h4>
              <div className="space-y-1.5">
                <p>AEGIS Emergency Platform</p>
                <p>Robert Gordon University</p>
                <p>Aberdeen, Scotland</p>
                <p className="mt-2 text-aegis-600 font-bold">CM4134 Honours Project</p>
              </div>
            </div>
          </div>
          <div className="mt-6 pt-5 border-t border-gray-300/50 dark:border-gray-700/50 text-center text-[10px] text-gray-500 dark:text-gray-500">
            {t('landing.footerSignature', lang)}
          </div>
        </div>
      </footer>

      {/* ═══ FLOATING SOS BUTTON ═══ */}
      <button
        onClick={handleGuestSOS}
        disabled={sosSending}
        className={`fixed bottom-24 left-6 z-[90] w-16 h-16 rounded-2xl shadow-2xl flex items-center justify-center transition-all duration-300 ${
          sosActive ? 'bg-gradient-to-br from-red-500 to-rose-700 shadow-red-600/50 animate-pulse' :
          sosCountdown !== null ? 'bg-gradient-to-br from-orange-400 to-orange-600 shadow-orange-500/50 scale-110' :
          sosSending ? 'bg-gray-500' :
          'bg-gradient-to-br from-red-500 to-red-700 hover:from-red-400 hover:to-red-600 hover:scale-110 shadow-red-600/40 active:scale-95'
        }`}
        aria-label={t('citizen.sos.aria', lang)}
        title={sosActive ? t('citizen.sos.active', lang) : sosCountdown !== null ? `${t('citizen.sos.sendingIn', lang)} ${sosCountdown}s — ${t('citizen.sos.tapCancel', lang)}` : t('citizen.sos.holdSend', lang)}
      >
        {sosCountdown !== null ? (
          <span className="text-2xl font-black text-white">{sosCountdown}</span>
        ) : sosSending ? (
          <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin" />
        ) : (
          <Radio className="w-6 h-6 text-white" />
        )}
      </button>
      {sosActive && (
        <div className="fixed bottom-44 left-6 z-[90] glass-card bg-red-900/95 text-white text-xs rounded-2xl px-5 py-3.5 shadow-2xl max-w-[220px] animate-scale-in">
          <p className="font-bold text-sm">{t('citizen.sos.sent', lang)}</p>
          <p className="text-red-200 mt-1">{t('citizen.sos.call999', lang)} <strong className="text-white">999</strong></p>
          <button onClick={() => setSosActive(false)} className="text-red-300 hover:text-white text-[10px] underline mt-1.5 font-medium">{t('general.close', lang)}</button>
        </div>
      )}

      {/* ═══ FLOATING CHATBOT BUTTON — only opens on click, never auto ═══ */}
      {!showChatbot && (
        <button onClick={()=>setShowChatbot(true)} className="fixed bottom-6 right-6 z-[90] w-16 h-16 bg-gradient-to-br from-aegis-500 to-aegis-700 hover:from-aegis-400 hover:to-aegis-600 text-white rounded-2xl shadow-2xl shadow-aegis-600/40 flex items-center justify-center transition-all duration-300 hover:scale-110 active:scale-95" aria-label={t('nav.aiAssistant', lang)}>
          <MessageCircle className="w-6 h-6"/>
        </button>
      )}

      {/* ═══ MODALS ═══ */}
      {showChatbot && <Chatbot onClose={()=>setShowChatbot(false)} lang={lang}/>}
      {showReport && <ReportForm onClose={()=>setShowReport(false)}/>}
      {showCommunity && <CommunityHelp onClose={()=>setShowCommunity(false)}/>}
      {showPreparedness && <PreparednessGuide onClose={()=>setShowPreparedness(false)} lang={lang}/>}

      {/* Alert Detail Modal */}
      {selectedAlert && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50" onClick={() => setSelectedAlert(null)}>
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-lg max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="p-5 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
              <h3 className="font-bold text-lg flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-red-600" />
                Alert Details
              </h3>
              <button onClick={() => setSelectedAlert(null)} className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`px-3 py-1 rounded-full text-xs font-bold uppercase ${
                  selectedAlert.severity === 'critical' ? 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300' :
                  selectedAlert.severity === 'high' ? 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300' :
                  selectedAlert.severity === 'warning' ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300' :
                  'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300'
                }`}>
                  {selectedAlert.severity?.toUpperCase()}
                </span>
                {selectedAlert.hazardType && selectedAlert.hazardType !== 'default' && (
                  <span className="px-3 py-1 rounded-full text-xs font-medium bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300">
                    {selectedAlert.hazardType}
                  </span>
                )}
              </div>
              <h4 className="text-xl font-bold text-gray-900 dark:text-white">{selectedAlert.title}</h4>
              <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">{selectedAlert.message}</p>
              <div className="bg-gray-50 dark:bg-gray-800/50 rounded-xl p-4 space-y-2">
                {selectedAlert.locationText && (
                  <div className="flex items-center gap-2 text-sm">
                    <MapPin className="w-4 h-4 text-gray-500 flex-shrink-0" />
                    <span className="text-gray-700 dark:text-gray-300">{selectedAlert.locationText}</span>
                  </div>
                )}
                <div className="flex items-center gap-2 text-sm">
                  <Clock className="w-4 h-4 text-gray-500 flex-shrink-0" />
                  <span className="text-gray-700 dark:text-gray-300">{new Date(selectedAlert.createdAt).toLocaleString()}</span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <Info className="w-4 h-4 text-gray-500 flex-shrink-0" />
                  <span className="text-gray-500 font-mono text-xs">ID: {selectedAlert.id}</span>
                </div>
              </div>
              <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-xl p-4">
                <h5 className="font-semibold text-sm text-amber-800 dark:text-amber-200 mb-1">Safety Advice</h5>
                <p className="text-xs text-amber-700 dark:text-amber-300">Follow local authority guidance. If in immediate danger, call 999. Monitor updates from SEPA, Met Office, and your local council.</p>
              </div>
            </div>
            <div className="p-5 border-t border-gray-200 dark:border-gray-700 flex gap-3">
              <button onClick={() => setSelectedAlert(null)} className="flex-1 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-xl py-2.5 text-sm font-semibold transition-colors">Close</button>
              <button onClick={() => { setSelectedAlert(null); setShowReport(true) }} className="flex-1 bg-red-600 hover:bg-red-700 text-white rounded-xl py-2.5 text-sm font-semibold transition-colors flex items-center justify-center gap-2">
                <AlertTriangle className="w-4 h-4" /> Report Related Incident
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Report Detail Modal */}
      {selectedReport && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50" onClick={() => setSelectedReport(null)}>
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-lg max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="p-5 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
              <h3 className="font-bold text-lg flex items-center gap-2">
                <FileText className="w-5 h-5 text-aegis-600" />
                Report Details
              </h3>
              <button onClick={() => setSelectedReport(null)} className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`px-3 py-1 rounded-full text-xs font-bold ${
                  selectedReport.severity === 'High' ? 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300' :
                  selectedReport.severity === 'Medium' ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300' :
                  'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300'
                }`}>
                  {selectedReport.severity}
                </span>
                <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                  selectedReport.status === 'Urgent' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' :
                  selectedReport.status === 'Verified' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' :
                  'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'
                }`}>
                  {selectedReport.status}
                </span>
                {selectedReport.confidence != null && (
                  <span className="px-3 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 flex items-center gap-1">
                    <Bot className="w-3 h-3" /> AI: {selectedReport.confidence}%
                  </span>
                )}
              </div>
              <h4 className="text-xl font-bold text-gray-900 dark:text-white">{selectedReport.type}</h4>
              <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">{selectedReport.description}</p>
              <div className="bg-gray-50 dark:bg-gray-800/50 rounded-xl p-4 space-y-2">
                <div className="flex items-center gap-2 text-sm">
                  <MapPin className="w-4 h-4 text-gray-500 flex-shrink-0" />
                  <span className="text-gray-700 dark:text-gray-300">{selectedReport.location}</span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <Clock className="w-4 h-4 text-gray-500 flex-shrink-0" />
                  <span className="text-gray-700 dark:text-gray-300">{selectedReport.displayTime || new Date(selectedReport.timestamp).toLocaleString()}</span>
                </div>
                {selectedReport.reporter && (
                  <div className="flex items-center gap-2 text-sm">
                    <User className="w-4 h-4 text-gray-500 flex-shrink-0" />
                    <span className="text-gray-700 dark:text-gray-300">{selectedReport.reporter}</span>
                  </div>
                )}
                <div className="flex items-center gap-2 text-sm">
                  <Info className="w-4 h-4 text-gray-500 flex-shrink-0" />
                  <span className="text-gray-500 font-mono text-xs">ID: {selectedReport.id}</span>
                </div>
              </div>
              {selectedReport.aiAnalysis && (
                <div className="bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded-xl p-4 space-y-2">
                  <h5 className="font-semibold text-sm text-blue-800 dark:text-blue-200 flex items-center gap-1.5"><Bot className="w-4 h-4" /> AI Analysis</h5>
                  {selectedReport.aiAnalysis.summary && (
                    <p className="text-xs text-blue-700 dark:text-blue-300">{selectedReport.aiAnalysis.summary}</p>
                  )}
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="flex items-center gap-1.5">
                      <span className="text-blue-600 dark:text-blue-400 font-medium">Sentiment:</span>
                      <span>{selectedReport.aiAnalysis.sentimentScore?.toFixed(2)}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-blue-600 dark:text-blue-400 font-medium">Panic:</span>
                      <span>{selectedReport.aiAnalysis.panicLevel}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-blue-600 dark:text-blue-400 font-medium">Fake Risk:</span>
                      <span>{(selectedReport.aiAnalysis.fakeProbability * 100).toFixed(0)}%</span>
                    </div>
                    {selectedReport.aiAnalysis.estimatedWaterDepth && (
                      <div className="flex items-center gap-1.5">
                        <span className="text-blue-600 dark:text-blue-400 font-medium">Water Depth:</span>
                        <span>{selectedReport.aiAnalysis.estimatedWaterDepth}</span>
                      </div>
                    )}
                  </div>
                  {selectedReport.aiAnalysis.vulnerablePersonAlert && (
                    <div className="flex items-center gap-1.5 text-xs bg-purple-100 dark:bg-purple-900/30 text-purple-800 dark:text-purple-200 px-3 py-1.5 rounded-lg mt-1">
                      <AlertTriangle className="w-3.5 h-3.5" /> Vulnerable Person Alert
                    </div>
                  )}
                </div>
              )}
              {selectedReport.trappedPersons && selectedReport.trappedPersons !== 'None' && (
                <div className="bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 rounded-xl p-4">
                  <h5 className="font-semibold text-sm text-red-800 dark:text-red-200">Trapped Persons</h5>
                  <p className="text-xs text-red-700 dark:text-red-300 mt-1">{selectedReport.trappedPersons}</p>
                </div>
              )}
            </div>
            <div className="p-5 border-t border-gray-200 dark:border-gray-700 flex gap-3">
              <button onClick={() => setSelectedReport(null)} className="flex-1 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-xl py-2.5 text-sm font-semibold transition-colors">Close</button>
              <button onClick={() => { handleShareReport(selectedReport); }} className="flex-1 bg-blue-600 hover:bg-blue-700 text-white rounded-xl py-2.5 text-sm font-semibold transition-colors flex items-center justify-center gap-2">
                <Share2 className="w-4 h-4" /> Share
              </button>
              <button onClick={() => { handlePrintReport(selectedReport); }} className="flex-1 bg-gray-600 hover:bg-gray-700 text-white rounded-xl py-2.5 text-sm font-semibold transition-colors flex items-center justify-center gap-2">
                <Printer className="w-4 h-4" /> Print
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Subscribe Modal */}
      {showSubscribe&&(
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50" onClick={()=>setShowSubscribe(false)}>
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-md animate-scale-in" onClick={e=>e.stopPropagation()}>
            <div className="p-5 border-b border-gray-200/50 dark:border-gray-700/50 flex items-center justify-between">
              <h3 className="font-bold text-lg flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-blue-400 to-indigo-600 flex items-center justify-center">
                  <Bell className="w-4 h-4 text-white"/>
                </div>
                {t('subscribe.title', lang)}
              </h3>
              <button onClick={()=>setShowSubscribe(false)} className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-xl transition-all"><X className="w-5 h-5"/></button>
            </div>
            <div className="p-5 space-y-3">
              <p className="text-xs text-gray-500">Choose your alert channels and provide contact details:</p>
              {[
                { key: 'email', label: t('subscribe.email', lang) || 'Email', icon: Mail, gradient: 'from-red-400 to-rose-600' },
                { key: 'sms', label: t('subscribe.sms', lang) || 'SMS', icon: Smartphone, gradient: 'from-green-400 to-emerald-600' },
                { key: 'telegram', label: t('subscribe.telegram', lang) || 'Telegram', icon: SendIcon, gradient: 'from-blue-400 to-blue-600' },
                { key: 'whatsapp', label: 'WhatsApp', icon: MessageSquare, gradient: 'from-green-500 to-green-700' },
                { key: 'webpush', label: t('subscribe.web', lang) || 'Web Push', icon: Wifi, gradient: 'from-purple-400 to-violet-600' },
              ].map(ch=>(
                <button key={ch.key} onClick={()=>setSubChannels(p=>p.includes(ch.key)?p.filter(c=>c!==ch.key):[...p,ch.key])}
                  className={`w-full p-3.5 rounded-xl border-2 flex items-center gap-3 transition-all duration-200 ${subChannels.includes(ch.key)?'border-aegis-500 bg-aegis-50/80 dark:bg-aegis-950/20 shadow-sm':'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'}`}>
                  <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${ch.gradient} flex items-center justify-center`}><ch.icon className="w-4 h-4 text-white"/></div>
                  <span className="text-sm font-semibold flex-1 text-left">{ch.label}</span>
                  {subChannels.includes(ch.key)&&<CheckCircle className="w-5 h-5 text-aegis-500"/>}
                </button>
              ))}
              {subChannels.includes('email')&&<input className="w-full px-4 py-2.5 text-sm bg-gray-100/80 dark:bg-gray-800/80 rounded-xl border border-gray-200/50 dark:border-gray-700/50 focus:ring-2 focus:ring-aegis-500/30 transition-all" placeholder={t('subscribe.placeholder.email', lang)} value={subEmail} onChange={e=>setSubEmail(e.target.value)}/>}
              {(subChannels.includes('sms')||subChannels.includes('whatsapp'))&&(
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
                      value={subPhone} 
                      onChange={e=>setSubPhone(e.target.value)}
                      type="tel"
                    />
                  </div>
                  <p className="text-xs text-gray-500">Example: {selectedCountry.dial} {selectedCountry.format}</p>
                </div>
              )}
              {subChannels.includes('telegram') && (
                <div className="space-y-2">
                  <input 
                    className="w-full px-4 py-2.5 text-sm bg-gray-100/80 dark:bg-gray-800/80 rounded-xl border border-gray-200/50 dark:border-gray-700/50 focus:ring-2 focus:ring-aegis-500/30 transition-all" 
                    placeholder="Telegram User ID (get from @userinfobot)"
                    value={subTelegramId} 
                    onChange={e=>setSubTelegramId(e.target.value)}
                    type="text"
                  />
                  <p className="text-xs text-gray-500">💡 Open Telegram, search for @userinfobot, start chat, and copy your ID number</p>
                </div>
              )}
              {subChannels.includes('webpush') && (
                <div className="bg-purple-50/80 dark:bg-purple-950/30 border border-purple-200/50 dark:border-purple-800/50 p-3.5 rounded-xl">
                  {!webPushStatus.supported ? (
                    <p className="text-xs text-red-700 dark:text-red-300">⚠️ Your browser does not support Web Push. Try Chrome, Firefox, or Edge.</p>
                  ) : webPushStatus.subscribed ? (
                    <p className="text-xs text-green-700 dark:text-green-300">✅ Already subscribed to push notifications on this device.</p>
                  ) : webPushStatus.enabled ? (
                    <p className="text-xs text-purple-700 dark:text-purple-300">✅ Ready — clicking Subscribe will request permission for browser notifications.</p>
                  ) : (
                    <p className="text-xs text-amber-700 dark:text-amber-300">⚠️ Server push key loading... If this persists, try refreshing.</p>
                  )}
                </div>
              )}
              <button onClick={handleSubscribe} disabled={subChannels.length===0 || (subChannels.includes('webpush') && !webPushStatus.supported)} className="w-full bg-gradient-to-r from-aegis-500 to-aegis-700 hover:from-aegis-400 hover:to-aegis-600 disabled:from-gray-300 disabled:to-gray-400 disabled:cursor-not-allowed text-white py-3 rounded-xl font-bold text-sm transition-all shadow-lg shadow-aegis-600/20 hover:shadow-xl hover:scale-[1.01] active:scale-[0.99]">
                {webPushLoading ? 'Setting up Web Push...' : t('subscribe.title', lang) || 'Subscribe to Alerts'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toasts */}
      <div className="fixed top-16 right-4 z-50 space-y-2.5">
        {notifications.map(n=>(
          <div key={n.id} onClick={()=>dismissNotification(n.id)} className={`px-4 py-3 rounded-2xl text-sm shadow-2xl cursor-pointer animate-scale-in max-w-xs backdrop-blur-md border font-medium ${
            n.type==='success'?'bg-green-600/95 text-white border-green-500/30':
            n.type==='warning'?'bg-amber-500/95 text-white border-amber-400/30':
            n.type==='error'?'bg-red-600/95 text-white border-red-500/30':
            'bg-blue-600/95 text-white border-blue-500/30'
          }`}>{n.message}</div>
        ))}
      </div>
    </div>
  )
}
