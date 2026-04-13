/**
 * File: CitizenPage.tsx
 *
 * What this file does:
 * The public citizen portal. Accessible without logging in, it shows the
 * live disaster map, active alerts, a report submission form, and links to
 * community help resources. It's the starting page citizens land on before
 * deciding to create an account or just browse.
 *
 * How it connects:
 * - Routed by client/src/App.tsx at /citizen
 * - Links to /citizen/auth for sign-in and /citizen/dashboard for signed-in users
 * - Alert data from client/src/contexts/AlertsContext.tsx (real-time)
 * - Map rendered via client/src/components/shared/DisasterMap.tsx
 * - Public report submission calls POST /api/reports (no auth required)
 *
 * Learn more:
 * - client/src/pages/CitizenDashboard.tsx        — the authenticated follow-up page
 * - client/src/components/shared/DisasterMap.tsx — the live map component
 * - server/src/routes/reportRoutes.ts            — public report endpoints
 */

/* CitizenPage.tsx — Public citizen portal with alerts, reports, map, and community help. */

import { useState, useMemo, useEffect, useCallback, useRef, lazy, Suspense } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { usePageTitle } from '../hooks/usePageTitle'
import { Link, useSearchParams, useNavigate } from 'react-router-dom'
import {
  Shield, AlertTriangle, Users, MapPin, BookOpen, Bell, Sun, Moon,
  ArrowUpDown, Phone, CheckCircle, HelpCircle, X, Heart, Home, Car,
  HeartPulse, Shirt, Crosshair, ExternalLink, Newspaper, FileText,
  ShieldCheck, ThumbsUp, ThumbsDown, Mail, Smartphone, Wifi, MessageCircle,
  Send as SendIcon, Eye, MessageSquare, Droplets, Wind, Thermometer,
  BarChart3, Clock, ChevronRight, Info, Search,
  Waves, Building2, Flame, TreePine, Bot, RefreshCw,
  Printer, Share2, User, Radio, Filter, Activity
} from 'lucide-react'
import { useReports } from '../contexts/ReportsContext'
import { useAlerts } from '../contexts/AlertsContext'
import { useLocation } from '../contexts/LocationContext'
import { useTheme } from '../contexts/ThemeContext'
import { t, getLanguage, isRtl } from '../utils/i18n'
import { useLanguage } from '../hooks/useLanguage'
import { useWebPush } from '../hooks/useWebPush'
import { apiSubscribe, apiGetNews, apiGetAlerts, type NewsItem } from '../utils/api'
import { COUNTRY_CODES, type CountryCode, formatPhoneWithCountry } from '../data/countryCodes'
import ALL_COUNTRY_CODES from '../data/allCountryCodes'
import { getEmergencyInfo as getGlobalEmergencyFallback } from '../data/allCountries'
import ReportCard from '../components/shared/ReportCard'
import CountrySearch from '../components/shared/CountrySearch'
import ThemeSelector from '../components/ui/ThemeSelector'
import AppLayout from '../components/layout/AppLayout'
import ErrorBoundary from '../components/shared/ErrorBoundary'
import AlertsPanel from '../components/shared/AlertsPanel'
import { SkeletonCard, Skeleton } from '../components/ui/Skeleton'
import type { SidebarItem } from '../components/layout/Sidebar'
import { GLOBAL_EMERGENCY_DB, type GlobalEmergencyEntry } from '../config/globalEmergencyDB'

// Lazy load heavy components for bundle optimization
const DisasterMap = lazy(() => import('../components/shared/DisasterMap'))
const WeatherPanel = lazy(() => import('../components/shared/WeatherPanel'))
const LiveIncidentMapPanel = lazy(() => import('../components/citizen/LiveIncidentMapPanel'))
const ReportForm = lazy(() => import('../components/citizen/ReportForm'))
const Chatbot = lazy(() => import('../components/citizen/Chatbot'))
const CommunityHelp = lazy(() => import('../components/citizen/CommunityHelp'))
const RiverGaugePanel = lazy(() => import('../components/shared/RiverGaugePanel'))
const IntelligenceDashboard = lazy(() => import('../components/shared/IntelligenceDashboard'))
const OnboardingTutorial = lazy(() => import('../components/citizen/OnboardingTutorial'))
const ShelterFinder = lazy(() => import('../components/citizen/ShelterFinder'))

// Map region-picker city keys to ISO country codes for emergency number lookup
// Country-level keys (e.g. 'at', 'de') are ISO codes already and handled dynamically
const CITY_TO_COUNTRY: Record<string, string> = {
  world: 'GB', generic: 'GB',
  uk: 'GB', scotland: 'GB', aberdeen: 'GB', edinburgh: 'GB', glasgow: 'GB', dundee: 'GB',
  mumbai: 'IN', dhaka: 'BD', shanghai: 'CN', tokyo: 'JP', jakarta: 'ID', manila: 'PH', bangkok: 'TH',
  amsterdam: 'NL', venice: 'IT', cologne: 'DE', paris: 'FR', budapest: 'HU',
  houston: 'US', neworleans: 'US', miami: 'US',
  portoalegre: 'BR',
  lagos: 'NG', khartoum: 'SD',
  brisbane: 'AU',
  asia: 'IN', europe: 'GB', northamerica: 'US', southamerica: 'BR', africa: 'NG', oceania: 'AU',
}

export default function CitizenPage(): JSX.Element {
  usePageTitle('Dashboard')
  const lang = useLanguage()
  const navigate = useNavigate()
  const { reports, loading, refreshReports } = useReports()
  const { alerts, notifications, pushNotification, dismissNotification } = useAlerts()
  const { location: loc, availableLocations, activeLocation, setActiveLocation } = useLocation()
  const { dark, toggle } = useTheme()
  const { status: webPushStatus, subscribe: subscribeToWebPush, loading: webPushLoading } = useWebPush()

  const [showReport, setShowReport] = useState(false)
  const [showCommunity, setShowCommunity] = useState(false)
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
  const [locationDenied, setLocationDenied] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [newsItems, setNewsItems] = useState<NewsItem[]>([])
  const [newsRefreshing, setNewsRefreshing] = useState(false)
  const newsLoadingRef = useRef(false)
  const [searchParams, setSearchParams] = useSearchParams()
  const [selectedAlert, setSelectedAlert] = useState<any>(null)
  const [selectedReport, setSelectedReport] = useState<any>(null)
  const [sosCountdown, setSosCountdown] = useState<number | null>(null)
  const [sosActive, setSosActive] = useState(false)
  const [sosSending, setSosSending] = useState(false)
  const sosTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const [sosAddress, setSosAddress] = useState('')
  const [sosLat, setSosLat] = useState<number | null>(null)
  const [sosLng, setSosLng] = useState<number | null>(null)
  const [sosTimestamp, setSosTimestamp] = useState<Date | null>(null)
  const [currentTime, setCurrentTime] = useState(new Date())

  // Derive emergency info from region picker (activeLocation) or subscribe modal country
  const emergencyInfo = useMemo<GlobalEmergencyEntry | null>(() => {
    // 1. Check explicit city-name mapping
    const cityCode = CITY_TO_COUNTRY[activeLocation]
    if (cityCode) {
      const entry = GLOBAL_EMERGENCY_DB.find(e => e.code === cityCode)
      if (entry) return entry
    }
    // 2. Try activeLocation as ISO code directly (COUNTRY_DATA uses lowercase ISO codes)
    const directMatch = GLOBAL_EMERGENCY_DB.find(e => e.code === activeLocation.toUpperCase())
    if (directMatch) return directMatch
    // 3. Fallback to subscribe modal's selected country
    return GLOBAL_EMERGENCY_DB.find(e => e.code === selectedCountry.code) || GLOBAL_EMERGENCY_DB.find(e => e.code === 'GB') || null
  }, [activeLocation, selectedCountry.code])

  const activeCountryCode = useMemo(() => {
    const cityCode = CITY_TO_COUNTRY[activeLocation]
    if (cityCode) return cityCode
    if (/^[a-z]{2}$/i.test(activeLocation)) return activeLocation.toUpperCase()
    return selectedCountry.code
  }, [activeLocation, selectedCountry.code])

  const emergencyFallback = useMemo(() => getGlobalEmergencyFallback(activeCountryCode), [activeCountryCode])

  // Cleanup SOS countdown timer on unmount to prevent memory leaks
  useEffect(() => () => {
    if (sosTimerRef.current) clearInterval(sosTimerRef.current)
  }, [])

  // Live clock for hero banner
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 60000)
    return () => clearInterval(timer)
  }, [])

  // Handle URL params for deep-linking (e.g. from web push notifications)
  useEffect(() => {
    const tabParam = searchParams.get('tab')
    const alertParam = searchParams.get('alert')
    if (tabParam) {
      const validTabs = ['map', 'reports', 'shelters', 'news']
      if (validTabs.includes(tabParam)) setActiveTab(tabParam)
    }
    if (alertParam) {
      // Fetch the specific alert and show detail modal
      apiGetAlerts()
        .then(list => {
          const found = (list as any[]).find((a: any) => String(a.id) === alertParam)
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
  }, [searchParams, setSearchParams])

  const loadNews = useCallback(async (forceRefresh = false): Promise<void> => {
    if (newsLoadingRef.current) return // prevent concurrent calls
    newsLoadingRef.current = true
    setNewsRefreshing(true)
    try {
      const payload = await apiGetNews(forceRefresh)
      if (Array.isArray(payload?.items) && payload.items.length > 0) {
        setNewsItems(payload.items)
        if (forceRefresh) pushNotification(t('citizenPage.newsRefreshed', lang) || 'News refreshed', 'success')
      } else if (forceRefresh) {
        pushNotification(t('citizenPage.noFreshNews', lang) || 'No new articles found', 'info')
      }
    } catch {
      if (forceRefresh) pushNotification('Could not refresh news. Please try again.', 'warning')
    } finally {
      setNewsRefreshing(false)
      newsLoadingRef.current = false
    }
  }, [lang, pushNotification])

  useEffect(() => {
    loadNews(false) // initial load — use cache
  }, [loadNews])

  const detectLocation = () => {
    if (navigator.geolocation) {
      setLocationDenied(false)
      navigator.geolocation.getCurrentPosition(p => {
        setUserPosition([p.coords.latitude, p.coords.longitude])
        setLocationDenied(false)
        pushNotification(t('citizenPage.locationDetected', lang), 'success')
      }, () => {
        setLocationDenied(true)
        pushNotification(t('citizenPage.locationDenied', lang), 'warning')
      })
    }
  }

  // Guest SOS Handler
  const handleGuestSOS = () => {
    if (sosCountdown !== null) {
      // Cancel countdown
      if (sosTimerRef.current) {
        clearInterval(sosTimerRef.current)
        sosTimerRef.current = null
      }
      setSosCountdown(null)
      if (navigator.vibrate) navigator.vibrate(30)
      return
    }
    // Haptic feedback on tap
    if (navigator.vibrate) navigator.vibrate([50, 30, 50])
    // Start 5-second countdown
    let count = 5
    setSosCountdown(count)
    sosTimerRef.current = setInterval(() => {
      count--
      if (navigator.vibrate) navigator.vibrate(40)
      if (count <= 0) {
        clearInterval(sosTimerRef.current!)
        sosTimerRef.current = null
        setSosCountdown(null)
        sendGuestSOS()
      } else {
        setSosCountdown(count)
      }
    }, 1000)
  }

  const sendGuestSOS = async () => {
    setSosSending(true)
    setSosAddress('')
    try {
      // Get GPS location
      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        if (!navigator.geolocation) return reject(new Error('No GPS'))
        navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 10000, enableHighAccuracy: true })
      }).catch(() => null)

      const lat = position?.coords.latitude ?? userPosition?.[0] ?? loc.center?.[0] ?? 0
      const lng = position?.coords.longitude ?? userPosition?.[1] ?? loc.center?.[1] ?? 0

      // Reverse geocode for human-readable address
      let addressText = `GPS: ${lat.toFixed(5)}, ${lng.toFixed(5)}`
      try {
        const geoRes = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=1`, { headers: { 'Accept-Language': 'en' } })
        if (geoRes.ok) {
          const geoData = await geoRes.json()
          if (geoData.display_name) addressText = geoData.display_name
        }
      } catch { /* keep GPS fallback */ }
      setSosAddress(addressText)
      setSosLat(lat)
      setSosLng(lng)
      setSosTimestamp(new Date())

      const now = new Date()
      const countryName = selectedCountry?.name || emergencyInfo?.name || 'Unknown'
      const emergNum = emergencyInfo?.emergencyNumber || '112'
      const fullDesc = `GUEST SOS EMERGENCY — Citizen requires immediate assistance.\n` +
        `Location: ${addressText}\n` +
        `Country: ${countryName}\n` +
        `Time: ${now.toLocaleString()} (${Intl.DateTimeFormat().resolvedOptions().timeZone})\n` +
        `Coordinates: ${lat.toFixed(6)}, ${lng.toFixed(6)}\n` +
        `Emergency Number: ${emergNum}\n` +
        `Activated from AEGIS public safety page.`

      // Submit emergency report via public reports API (field names match server validation)
      const csrfSos = document.cookie.split('; ').find(c => c.startsWith('aegis_csrf='))?.split('=')[1]
      const response = await fetch('/api/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(csrfSos ? { 'X-CSRF-Token': csrfSos } : {}) },
        body: JSON.stringify({
          incidentCategory: 'SOS_EMERGENCY',
          displayType: 'SOS Emergency',
          severity: 'High',
          description: fullDesc,
          locationText: addressText,
          lat,
          lng,
        })
      })

      if (!response.ok) {
        const errBody = await response.json().catch(() => ({}))
        throw new Error(errBody.error || `SOS failed: ${response.status}`)
      }

      if (navigator.vibrate) navigator.vibrate([100, 50, 100, 50, 100])
      setSosActive(true)
      pushNotification(t('citizenPage.sosSent', lang), 'error')
      // Auto-clear after 60 seconds
      setTimeout(() => setSosActive(false), 60000)
    } catch (err: any) {
      console.error('SOS send error:', err)
      if (navigator.vibrate) navigator.vibrate([200, 100, 200])
      const emergNum = emergencyInfo?.emergencyNumber || '112'
      pushNotification(`${t('citizenPage.sosFailed', lang)} — Please call ${emergNum} directly`, 'error')
      // Still show the SOS active panel so user can call emergency number
      setSosActive(true)
      setTimeout(() => setSosActive(false), 60000)
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

  const stats = { total: reports.length, urgent: reports.filter(r=>r.status==='Urgent').length, high: reports.filter(r=>r.severity==='High').length, verified: reports.filter(r=>r.status==='Verified').length, alertCount: alerts.length }

  const handleSubscribe = async () => {
    if (subChannels.length === 0) return
    try {
      const normalizedChannels = subChannels.map(ch => ch === 'webpush' ? 'web' : ch)
      const formattedPhone = subPhone ? formatPhoneWithCountry(selectedCountry, subPhone) : ''
      
      // Subscribe to Web Push first if selected AND VAPID is configured on the server
      if (subChannels.includes('webpush') && webPushStatus.enabled) {
        try {
          await subscribeToWebPush(subEmail)
          pushNotification(t('citizenPage.webPushEnabled', lang), 'success')
        } catch (err: any) {
          const msg: string = err?.message || ''
          if (!msg.includes('not configured') && !msg.includes('public key')) {
            pushNotification(t('citizenPage.webPushFailed', lang), 'warning')
          }
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
      pushNotification(`${t('citizenPage.subscribedTo', lang)}: ${normalizedChannels.join(', ')}`, 'success')
      setShowSubscribe(false)
    } catch (err: any) {
      pushNotification(err?.message || t('citizenPage.subscriptionFailed', lang), 'error')
    }
  }

  const handleViewReport = (report: any) => {
    setSelectedReport(report)
  }

  const handlePrintReport = (report: any) => {
    const printWindow = window.open('', '_blank')
    if (!printWindow) {
      pushNotification(t('citizenPage.printPopupBlocked', lang), 'warning')
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
          <div class="logo">${t('cdash.print.aegisTitle', lang)}</div>
          <div class="report-id">${t('cdash.print.reportId', lang)}: ${report.id}</div>
        </div>
        <div>
          <span class="badge severity-${report.severity.toLowerCase()}">${report.severity}</span>
          <span class="badge">${report.status}</span>
          ${report.confidence != null ? `<span class="badge">${t('citizenPage.aiConfidence', lang)}: ${report.confidence}%</span>` : ''}
        </div>
        <h2>${report.type}</h2>
        <div class="meta">
          <div>${t('citizenPage.location', lang)}: ${report.location}</div>
          <div>${t('citizenPage.reported', lang)}: ${report.displayTime || new Date(report.timestamp).toLocaleString()}</div>
          ${report.reporterName ? `<div>${t('citizenPage.reporter', lang)}: ${report.reporterName}</div>` : ''}
        </div>
        <div class="description">
          <h3>${t('cdash.print.description', lang)}</h3>
          <p>${report.description}</p>
        </div>
        ${report.aiAnalysis?.summary ? `
        <div>
          <h3>${t('citizenPage.aiAnalysis', lang)}</h3>
          <p>${report.aiAnalysis.summary}</p>
          ${report.aiAnalysis.vulnerablePersonAlert ? `<p><strong>${t('cdash.vulnerablePersonAlert', lang)}</strong></p>` : ''}
        </div>
        ` : ''}
        <div class="footer">
          <p>${t('cdash.print.generatedFrom', lang)} ${new Date().toLocaleString()}.</p>
          <p>${t('citizenPage.officialInquiries', lang)}</p>
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
      title: `${t('cdash.print.aegisTitle', lang)}: ${report.type}`,
      text: `${report.type} - ${report.severity}\n${report.location}\n\n${report.description}`,
      url: window.location.href,
    }

    // Try native Web Share API first
    if (navigator.share) {
      try {
        await navigator.share(shareData)
        pushNotification(t('citizenPage.reportShared', lang), 'success')
      } catch (err: any) {
        if (err.name !== 'AbortError') {
          pushNotification(t('citizenPage.shareCancelled', lang), 'info')
        }
      }
    } else {
      // Fallback: Copy to clipboard and show mailto option
      const reportText = `${shareData.title}\n\n${shareData.text}\n\nView on AEGIS: ${shareData.url}`
      try {
        await navigator.clipboard.writeText(reportText)
        pushNotification(t('citizenPage.copiedToClipboard', lang), 'success')
        
        // Also offer email option
        const mailtoLink = `mailto:?subject=${encodeURIComponent(shareData.title)}&body=${encodeURIComponent(reportText)}`
        window.open(mailtoLink, '_blank')
      } catch {
        pushNotification(t('citizenPage.unableToShare', lang), 'warning')
      }
    }
  }

  const TABS = [
    { id: 'map', label: t('citizenPage.tab.disasterMap', lang), icon: MapPin },
    { id: 'alerts', label: t('alerts.pageTitle', lang) || 'Alerts', icon: Bell },
    { id: 'reports', label: t('citizenPage.tab.recentReports', lang), icon: FileText },
    { id: 'shelters', label: t('citizenPage.tab.safeZones', lang), icon: Home },
    { id: 'news', label: t('citizen.tab.news', lang), icon: Newspaper },
  ]

  const handleSidebarNav = (item: SidebarItem) => {
    if (item.key === 'report_emergency') { setShowReport(true); return }
    if (item.key === 'community') { setShowCommunity(true); return }
    if (item.key === 'home') { navigate('/citizen/dashboard'); return }
    if (item.key === 'alerts') { setActiveTab('alerts'); return }
    const validTabs = ['map', 'alerts', 'reports', 'shelters', 'news']
    if (validTabs.includes(item.key)) { setActiveTab(item.key); return }
    // Citizen-only tabs — navigate to dashboard with tab param
    const dashboardTabs = ['risk', 'emergency', 'prepare', 'messages', 'safety', 'profile', 'settings']
    if (dashboardTabs.includes(item.key)) { navigate(`/citizen/dashboard?tab=${item.key}`); return }
  }

  return (
    <AppLayout activeKey={activeTab} onNavigate={handleSidebarNav}>
      <div className={`space-y-6 ${isRtl(lang)?'rtl':'ltr'}`} dir={isRtl(lang)?'rtl':'ltr'}>
        {/* HERO BANNER */}
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-aegis-600 via-aegis-500 to-aegis-700 dark:from-aegis-900 dark:via-aegis-800 dark:to-aegis-700 p-6 sm:p-8 text-white shadow-2xl shadow-aegis-600/20">
          <div className="absolute inset-0 opacity-10">
            <svg width="100%" height="100%"><defs><pattern id="guestDots" x="0" y="0" width="20" height="20" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1" fill="white"/></pattern></defs><rect width="100%" height="100%" fill="url(#guestDots)"/></svg>
          </div>
          <div className="absolute top-0 right-0 w-64 h-64 bg-white/5 rounded-full -translate-y-1/2 translate-x-1/3 blur-2xl"/>
          <div className="absolute bottom-0 left-0 w-48 h-48 bg-aegis-300/20 dark:bg-aegis-400/10 rounded-full translate-y-1/2 -translate-x-1/4 blur-2xl"/>
          <div className="relative z-10">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-8 h-8 rounded-xl bg-white/20 backdrop-blur-sm flex items-center justify-center">
                <Shield className="w-4.5 h-4.5"/>
              </div>
              <span className="text-xs font-bold bg-white/15 backdrop-blur-sm px-3 py-1 rounded-full">{t('citizen.hero.publicPortal', lang) || 'Public Safety Portal'}</span>
              <span className="text-xs font-bold bg-emerald-500/20 border border-emerald-300/30 text-emerald-100 px-3 py-1 rounded-full">Anonymous Mode Active</span>
            </div>
            <h1 className="text-xl sm:text-2xl font-extrabold mb-0.5 text-primary">Welcome to AEGIS</h1>
            <p className="text-xs text-white/60 mb-2 flex items-center gap-2">
              <Clock className="w-3 h-3" />
              {currentTime.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })} &bull; {currentTime.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
            </p>
            <p className="text-sm max-w-lg text-primary">{t('citizen.hero.subtitle', lang) || 'Monitor live incidents, report emergencies, check safety status, and stay informed with AI-powered alerts.'}</p>
            <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2 max-w-3xl">
              <div className="rounded-xl border border-white/15 bg-white/10 backdrop-blur-sm px-3 py-2">
                <p className="text-[10px] uppercase tracking-wider text-white/70">Response State</p>
                <p className="text-sm font-extrabold text-white">Live Monitoring</p>
              </div>
              <div className="rounded-xl border border-white/15 bg-white/10 backdrop-blur-sm px-3 py-2">
                <p className="text-[10px] uppercase tracking-wider text-white/70">Coverage</p>
                <p className="text-sm font-extrabold text-white">Global Multi-Hazard</p>
              </div>
              <div className="rounded-xl border border-white/15 bg-white/10 backdrop-blur-sm px-3 py-2">
                <p className="text-[10px] uppercase tracking-wider text-white/70">Privacy</p>
                <p className="text-sm font-extrabold text-white">No Sign-in Required</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 mt-4">
              <button onClick={()=>setShowReport(true)} className="bg-white/20 hover:bg-white/30 backdrop-blur-sm border border-white/20 px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all hover:scale-[1.02]">
                <AlertTriangle className="w-3.5 h-3.5"/> {t('report.title', lang)}
              </button>
              <button onClick={()=>setActiveTab('map')} className="bg-white/10 hover:bg-white/20 backdrop-blur-sm border border-white/10 px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all hover:scale-[1.02]">
                <MapPin className="w-3.5 h-3.5"/> {t('map.title', lang) || 'Live Map'}
              </button>
              <button
                onClick={toggle}
                aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
                className="bg-white/10 hover:bg-white/20 backdrop-blur-sm border border-white/10 p-2 rounded-xl transition-all hover:scale-[1.02] flex items-center justify-center"
                title={dark ? 'Light mode' : 'Dark mode'}
              >
                {dark ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
              </button>
              <Link to="/citizen/login" className="bg-gradient-to-r from-aegis-500 to-aegis-700 hover:from-aegis-400 hover:to-aegis-600 border border-aegis-400/30 px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all hover:scale-[1.02] shadow-lg shadow-aegis-600/20 sm:hidden">
                <User className="w-3.5 h-3.5"/> {t('citizen.auth.signIn', lang)}
              </Link>
            </div>
          </div>
        </div>

        {/* STATS */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {[
            { label: t('stats.total', lang),                value: stats.total,      icon: FileText,    gradient: 'from-blue-500 to-blue-700',     bg: 'bg-blue-50   dark:bg-blue-950/40',   border: 'border-blue-200   dark:border-blue-800/60',   num: 'text-blue-700   dark:text-blue-300',   lbl: 'text-blue-600   dark:text-blue-400' },
            { label: t('stats.urgent', lang),               value: stats.urgent,     icon: AlertTriangle, gradient: 'from-red-500 to-red-700',       bg: 'bg-red-50    dark:bg-red-950/40',    border: 'border-red-200    dark:border-red-800/60',    num: 'text-red-700    dark:text-red-300',    lbl: 'text-red-600    dark:text-red-400' },
            { label: t('citizen.stats.highSeverity', lang), value: stats.high,       icon: Flame,       gradient: 'from-orange-500 to-orange-700', bg: 'bg-orange-50 dark:bg-orange-950/40', border: 'border-orange-200 dark:border-orange-800/60', num: 'text-orange-700 dark:text-orange-300', lbl: 'text-orange-600 dark:text-orange-400' },
            { label: t('stats.verified', lang),             value: stats.verified,   icon: CheckCircle, gradient: 'from-green-500 to-green-700',   bg: 'bg-green-50  dark:bg-green-950/40',  border: 'border-green-200  dark:border-green-800/60',  num: 'text-green-700  dark:text-green-300',  lbl: 'text-green-600  dark:text-green-400' },
            { label: t('stats.activeAlerts', lang),         value: stats.alertCount, icon: Bell,        gradient: 'from-purple-500 to-purple-700', bg: 'bg-purple-50 dark:bg-purple-950/40', border: 'border-purple-200 dark:border-purple-800/60', num: 'text-purple-700 dark:text-purple-300', lbl: 'text-purple-600 dark:text-purple-400' },
          ].map((s,i)=>(
            <div key={i} className={`${s.bg} border ${s.border} rounded-2xl p-4 hover-lift transition-all duration-300`} style={{animationDelay:`${i*60}ms`}}>
              <div className="mb-3">
                <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${s.gradient} flex items-center justify-center shadow-md`}>
                  <s.icon className="w-5 h-5 text-white"/>
                </div>
              </div>
              <p className={`text-2xl font-extrabold tracking-tight ${s.num}`}>{s.value}</p>
              <p className={`text-[10px] font-bold uppercase tracking-wider mt-0.5 ${s.lbl}`}>{s.label}</p>
            </div>
          ))}
        </div>

        {/* ACTION BUTTONS */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {[
            {
              onClick: ()=>setShowReport(true),
              icon: AlertTriangle,
              label: t('report.title', lang),
              desc: t('citizen.quickAction.reportEmergencyDesc', lang) || 'Report an incident',
              gradient: 'from-rose-500 to-rose-700',
              bg: 'bg-rose-50 dark:bg-rose-950/40',
              border: 'border-rose-200 dark:border-rose-800/60',
              lbl: 'text-rose-800 dark:text-rose-200',
              desc2: 'text-rose-600 dark:text-rose-400',
            },
            {
              onClick: ()=>setShowSubscribe(true),
              icon: Bell,
              label: t('subscribe.title', lang) || 'Subscribe to Alerts',
              desc: t('citizen.subscribe.subscribeTo', lang) || 'Get notified instantly',
              gradient: 'from-sky-500 to-sky-700',
              bg: 'bg-sky-50 dark:bg-sky-950/40',
              border: 'border-sky-200 dark:border-sky-800/60',
              lbl: 'text-sky-800 dark:text-sky-200',
              desc2: 'text-sky-600 dark:text-sky-400',
            },
            {
              onClick: ()=>setShowCommunity(true),
              icon: Users,
              label: t('community.title', lang),
              desc: t('citizen.quickAction.communityHelpDesc', lang) || 'Volunteer or request aid',
              gradient: 'from-teal-500 to-teal-700',
              bg: 'bg-teal-50 dark:bg-teal-950/40',
              border: 'border-teal-200 dark:border-teal-800/60',
              lbl: 'text-teal-800 dark:text-teal-200',
              desc2: 'text-teal-600 dark:text-teal-400',
            },
          ].map((action, i) => (
            <button
              key={i}
              onClick={action.onClick}
              className={`${action.bg} border ${action.border} rounded-2xl p-5 text-center transition-all duration-300 group hover:scale-[1.02] hover:shadow-lg active:scale-[0.98]`}
            >
              <div className={`w-12 h-12 rounded-2xl bg-gradient-to-br ${action.gradient} mx-auto mb-3 flex items-center justify-center shadow-md transition-transform group-hover:scale-110`}>
                <action.icon className="w-6 h-6 text-white"/>
              </div>
              <p className={`text-sm font-bold ${action.lbl}`}>{action.label}</p>
              <p className={`text-[10px] mt-0.5 hidden sm:block ${action.desc2}`}>{action.desc}</p>
            </button>
          ))}
        </div>

        {/* CENTER TAB NAV */}
        <div className="glass-card rounded-2xl p-1.5 overflow-x-auto">
          <div className="flex gap-1 min-w-max">
            {TABS.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold transition-all duration-200 whitespace-nowrap ${
                  activeTab === tab.id
                    ? 'bg-aegis-600 text-white shadow-md shadow-aegis-600/30'
                    : 'text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800/60'
                }`}
              >
                <tab.icon className="w-4 h-4 flex-shrink-0"/>
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* MAP TAB */}
        {activeTab==='map'&&(
          <div className="space-y-4 animate-fade-in">
            {/* GPS denied retry banner */}
            {locationDenied && !userPosition && (
              <div className="flex items-center justify-between gap-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/60 rounded-2xl px-4 py-3 animate-fade-in">
                <div className="flex items-center gap-2 text-sm text-amber-800 dark:text-amber-300">
                  <Crosshair className="w-4 h-4 flex-shrink-0" />
                  <span>Location access was denied. Enable it in your browser settings or retry.</span>
                </div>
                <button
                  onClick={detectLocation}
                  className="flex items-center gap-1.5 text-xs font-bold text-amber-700 dark:text-amber-300 bg-amber-100 dark:bg-amber-900/40 hover:bg-amber-200 dark:hover:bg-amber-800/60 px-3 py-1.5 rounded-xl transition-all whitespace-nowrap"
                >
                  <RefreshCw className="w-3.5 h-3.5" /> Retry
                </button>
              </div>
            )}
            {/* Professional Live Incident Map Panel */}
            <ErrorBoundary name="LiveIncidentMapPanel" fallback={<div className="p-6 text-center text-sm text-gray-500 dark:text-gray-400 bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-700">Failed to load map</div>}>
              <Suspense fallback={<div className="h-64 bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-700 p-4 space-y-3"><Skeleton className="h-5 w-40" /><Skeleton className="h-48 w-full rounded-xl" /></div>}>
                <LiveIncidentMapPanel reports={reports} userPosition={userPosition} center={loc.center} zoom={loc.zoom} />
              </Suspense>
            </ErrorBoundary>
            {/* Panels below map — full-width responsive grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <ErrorBoundary name="IntelligenceDashboard" fallback={<div className="p-4 text-center text-sm text-gray-500 dark:text-gray-400 bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-700">Failed to load intelligence</div>}>
                <Suspense fallback={<div className="h-40 bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-700 p-4 space-y-2"><Skeleton className="h-4 w-24" /><Skeleton className="h-3 w-full" /><Skeleton className="h-3 w-3/4" /><Skeleton className="h-8 w-20 mt-2 rounded-lg" /></div>}>
                  <IntelligenceDashboard collapsed={true} className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-lg" />
                </Suspense>
              </ErrorBoundary>
              <ErrorBoundary name="WeatherPanel" fallback={<div className="p-4 text-center text-sm text-gray-500 dark:text-gray-400 bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-700">Failed to load weather</div>}>
                <Suspense fallback={<div className="h-40 bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-700 p-4 space-y-2"><Skeleton className="h-4 w-20" /><Skeleton className="h-8 w-16" /><Skeleton className="h-3 w-full" /><Skeleton className="h-3 w-2/3" /></div>}>
                  <WeatherPanel/>
                </Suspense>
              </ErrorBoundary>
              <ErrorBoundary name="RiverGaugePanel" fallback={<div className="p-4 text-center text-sm text-gray-500 dark:text-gray-400 bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-700">Failed to load river data</div>}>
                <Suspense fallback={<div className="h-40 bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-700 p-4 space-y-2"><Skeleton className="h-4 w-24" /><Skeleton className="h-8 w-16" /><Skeleton className="h-3 w-full" /><Skeleton className="h-3 w-1/2" /></div>}>
                  <RiverGaugePanel/>
                </Suspense>
              </ErrorBoundary>
            </div>
          </div>
        )}

        {/* ALERTS TAB */}
        {activeTab==='alerts'&&(
          <div className="animate-fade-in">
            <AlertsPanel />
          </div>
        )}

        {/* SAFE ZONES TAB */}
        {activeTab==='shelters'&&(
          <div className="animate-fade-in space-y-4">
            <ErrorBoundary name="ShelterFinder" fallback={<div className="p-6 text-center text-sm text-gray-500 dark:text-gray-400 bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-700">Failed to load shelters</div>}>
              <Suspense fallback={<div className="h-64 bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-700 p-4 space-y-3"><Skeleton className="h-5 w-32" /><SkeletonCard /><SkeletonCard /></div>}>
                <ShelterFinder/>
              </Suspense>
            </ErrorBoundary>
          </div>
        )}

        {/* REPORTS TAB */}
        {activeTab==='reports'&&(
          <GuestReportsTab reports={reports} sorted={sorted} loading={loading} searchTerm={searchTerm} setSearchTerm={setSearchTerm} sortField={sortField} setSortField={setSortField} sortOrder={sortOrder} setSortOrder={setSortOrder} onViewReport={handleViewReport} onShareReport={handleShareReport} onPrintReport={handlePrintReport} onNewReport={()=>setShowReport(true)} lang={lang} />
        )}

        {/* NEWS TAB */}
        {activeTab==='news'&&(
          <div className="space-y-4 animate-fade-in">
            <div className="flex items-center justify-between">
              <h2 className="font-bold text-lg flex items-center gap-2.5 text-gray-900 dark:text-white">
                <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-aegis-400 to-aegis-600 flex items-center justify-center">
                  <Newspaper className="w-4 h-4 text-white"/>
                </div>
                {t('citizen.tab.news', lang) || 'News'}
              </h2>
              <button
                onClick={() => loadNews(true)}
                disabled={newsRefreshing}
                className="flex items-center gap-1.5 text-xs text-aegis-600 hover:text-aegis-700 bg-aegis-50/80 dark:bg-aegis-950/30 border border-aegis-200/60 dark:border-aegis-800/60 px-4 py-2 rounded-xl transition-all disabled:opacity-60 hover:scale-[1.02] font-bold backdrop-blur-sm"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${newsRefreshing ? 'animate-spin' : ''}`}/> {t('citizen.news.refresh', lang)}
              </button>
            </div>
            <div className="space-y-2.5">
              {newsItems.length === 0 && (
                <div className="glass-card rounded-2xl p-8 text-center">
                  <Newspaper className="w-10 h-10 text-gray-300 dark:text-gray-400 mx-auto mb-3"/>
                  <p className="text-sm text-gray-500 dark:text-gray-400 font-medium">{t('citizenPage.noNewsAvailable', lang)}</p>
                  <p className="text-xs text-gray-400 dark:text-gray-400 mt-1">{t('citizenPage.clickRefresh', lang)}</p>
                </div>
              )}
              {newsItems.map((n,i)=>{
                const typeConfig: Record<string,{color:string,bg:string,label:string}> = {
                  alert: { color: 'bg-red-500', bg: 'bg-red-50 dark:bg-red-950/20 border-red-200/50 dark:border-red-800/50', label: t('cdash.news.alert', lang) },
                  warning: { color: 'bg-amber-500', bg: 'bg-amber-50 dark:bg-amber-950/20 border-amber-200/50 dark:border-amber-800/50', label: t('cdash.news.warning', lang) },
                  community: { color: 'bg-green-500', bg: 'bg-green-50 dark:bg-green-950/20 border-green-200/50 dark:border-green-800/50', label: t('cdash.news.community', lang) },
                  tech: { color: 'bg-purple-500', bg: 'bg-purple-50 dark:bg-purple-950/20 border-purple-200/50 dark:border-purple-800/50', label: t('cdash.news.tech', lang) },
                  info: { color: 'bg-blue-500', bg: 'bg-blue-50 dark:bg-blue-950/20 border-blue-200/50 dark:border-blue-800/50', label: t('cdash.news.info', lang) },
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
                      <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5">{n.source} · {n.time}</p>
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

        {/* SIGN-IN PROMO — Citizen-Only Features */}
        <div className="glass-card rounded-2xl p-6 border border-amber-200/60 dark:border-amber-800/40 bg-gradient-to-br from-amber-50/80 via-white to-orange-50/60 dark:from-amber-950/20 dark:via-gray-900 dark:to-orange-950/10">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-400 to-orange-600 flex items-center justify-center shadow-md">
              <User className="w-5 h-5 text-white" />
            </div>
            <div>
              <h3 className="font-extrabold text-base text-gray-900 dark:text-white">{t('citizenPage.unlockFull', lang)}</h3>
              <p className="text-[11px] text-gray-500 dark:text-gray-400">{t('citizenPage.unlockDesc', lang)}</p>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {/* Risk Assessment CTA */}
            <Link to="/citizen/login" className="group bg-white dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 rounded-xl p-4 hover:border-amber-400 dark:hover:border-amber-600 hover:shadow-lg transition-all duration-300">
              <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-rose-500 to-red-700 flex items-center justify-center mb-2.5 shadow-md group-hover:scale-110 transition-transform">
                <BarChart3 className="w-4.5 h-4.5 text-white" />
              </div>
              <p className="text-sm font-bold text-gray-900 dark:text-white">{t('citizenPage.riskAssessment', lang)}</p>
              <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5">{t('citizenPage.riskAssessmentDesc', lang)}</p>
              <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-600 dark:text-amber-400 mt-2">
                {t('citizenPage.signInAccess', lang)} <ChevronRight className="w-3 h-3" />
              </span>
            </Link>
            {/* Emergency Card CTA */}
            <Link to="/citizen/login" className="group bg-white dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 rounded-xl p-4 hover:border-amber-400 dark:hover:border-amber-600 hover:shadow-lg transition-all duration-300">
              <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-orange-500 to-amber-700 flex items-center justify-center mb-2.5 shadow-md group-hover:scale-110 transition-transform">
                <Shield className="w-4.5 h-4.5 text-white" />
              </div>
              <p className="text-sm font-bold text-gray-900 dark:text-white">{t('citizenPage.emergencyCard', lang)}</p>
              <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5">{t('citizenPage.emergencyCardDesc', lang)}</p>
              <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-600 dark:text-amber-400 mt-2">
                {t('citizenPage.signInAccess', lang)} <ChevronRight className="w-3 h-3" />
              </span>
            </Link>
            {/* Preparedness Training CTA */}
            <Link to="/citizen/login" className="group bg-white dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 rounded-xl p-4 hover:border-amber-400 dark:hover:border-amber-600 hover:shadow-lg transition-all duration-300">
              <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-700 flex items-center justify-center mb-2.5 shadow-md group-hover:scale-110 transition-transform">
                <BookOpen className="w-4.5 h-4.5 text-white" />
              </div>
              <p className="text-sm font-bold text-gray-900 dark:text-white">{t('citizenPage.prepTraining', lang)}</p>
              <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5">{t('citizenPage.prepTrainingDesc', lang)}</p>
              <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-600 dark:text-amber-400 mt-2">
                {t('citizenPage.signInAccess', lang)} <ChevronRight className="w-3 h-3" />
              </span>
            </Link>
          </div>
        </div>
        </div>

      {/* FOOTER — dynamic emergency numbers based on selected country */}
      <footer className="bg-gradient-to-b from-gray-100 to-gray-200 dark:from-gray-900 dark:to-gray-950 border-t border-gray-200/50 dark:border-gray-800/50 mt-10">
        <div className="max-w-7xl mx-auto px-4 py-10">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-8 text-xs text-gray-600 dark:text-gray-400">
            <div>
              <h4 className="font-extrabold mb-3 flex items-center gap-2 text-primary">
                <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-red-400 to-rose-600 flex items-center justify-center"><Phone className="w-3 h-3 text-white"/></div>
                {emergencyInfo?.flag || '🌍'} {t('citizenPage.footer.emergency', lang)}
              </h4>
              <div className="space-y-1.5">
                <>
                  <p>{t('citizenPage.footer.emergencyServices', lang)}: <strong className="text-primary">{emergencyInfo?.emergencyNumber || emergencyFallback.universal}</strong></p>
                  <p>Police: <strong className="text-primary">{emergencyInfo?.police || emergencyFallback.police}</strong></p>
                  <p>Ambulance: <strong className="text-primary">{emergencyInfo?.ambulance || emergencyFallback.ambulance}</strong></p>
                  <p>Fire: <strong className="text-primary">{emergencyInfo?.fire || emergencyFallback.fire}</strong></p>
                  {emergencyInfo?.mentalHealth && (
                    <p>{emergencyInfo.mentalHealth.name}: <strong className="text-primary">{emergencyInfo.mentalHealth.number}</strong></p>
                  )}
                  {emergencyInfo?.childLine && (
                    <p>{emergencyInfo.childLine.name}: <strong className="text-primary">{emergencyInfo.childLine.number}</strong></p>
                  )}
                  {emergencyInfo?.poisonControl && (
                    <p>Poison Control: <strong className="text-primary">{emergencyInfo.poisonControl}</strong></p>
                  )}
                </>
              </div>
            </div>
            <div>
              <h4 className="font-extrabold mb-3 flex items-center gap-2 text-primary">
                <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-aegis-400 to-aegis-600 flex items-center justify-center"><ExternalLink className="w-3 h-3 text-white"/></div>
                {t('admin.resources', lang)}
              </h4>
              <div className="space-y-1.5">
                <>
                  <p className="text-primary font-semibold">{emergencyInfo?.disasterAgency || `${selectedCountry.name || 'National'} Disaster Management`}</p>
                  <p className="text-primary">{emergencyInfo?.weatherService || `${selectedCountry.name || 'National'} Weather Service`}</p>
                  {emergencyInfo?.abuseHotline ? (
                    <p className="text-primary">{emergencyInfo.abuseHotline.name}: {emergencyInfo.abuseHotline.number}</p>
                  ) : emergencyFallback.extras && emergencyFallback.extras.length > 0 ? (
                    emergencyFallback.extras.slice(0, 2).map(e => (
                      <p key={e.name} className="text-primary text-[11px]">{e.name}: <strong className="text-primary">{e.number}</strong></p>
                    ))
                  ) : (
                    <p className="text-primary text-[11px]">IFRC &amp; ReliefWeb emergency resources</p>
                  )}
                </>
              </div>
            </div>
            <div>
              <h4 className="font-extrabold mb-3 flex items-center gap-2 text-primary">
                <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-aegis-400 to-aegis-600 flex items-center justify-center"><Shield className="w-3 h-3 text-white"/></div>
                {t('citizen.footer.platform', lang)}
              </h4>
              <div className="space-y-1.5">
                <Link to="/about" className="block hover:text-aegis-600 dark:hover:text-aegis-300 transition-colors">{t('citizenPage.footer.aboutAegis', lang)}</Link>
                <Link to="/accessibility" className="block hover:text-aegis-600 dark:hover:text-aegis-300 transition-colors">{t('citizenPage.footer.accessibility', lang)}</Link>
                <Link to="/privacy" className="block hover:text-aegis-600 dark:hover:text-aegis-300 transition-colors">{t('citizenPage.footer.privacyPolicy', lang)}</Link>
                <Link to="/terms" className="block hover:text-aegis-600 dark:hover:text-aegis-300 transition-colors">{t('citizenPage.footer.termsOfUse', lang)}</Link>
              </div>
            </div>
            <div>
              <h4 className="font-extrabold mb-3 flex items-center gap-2 text-primary">
                <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-aegis-500 to-aegis-700 flex items-center justify-center"><Building2 className="w-3 h-3 text-white"/></div>
                {t('citizen.footer.contact', lang)}
              </h4>
              <div className="space-y-1.5">
                <p className="text-primary">{t('citizenPage.footer.aegisPlatform', lang)}</p>
                <p className="text-primary">{t('citizenPage.footer.rgu', lang)}</p>
                <p className="text-primary">{t('citizenPage.footer.aberdeen', lang)}</p>
                <p className="mt-2 text-primary font-bold">{t('citizenPage.footer.honours', lang)}</p>
              </div>
            </div>
          </div>
          <div className="mt-6 pt-5 border-t border-gray-300/50 dark:border-gray-700/50 text-center text-[10px] text-primary">
            {t('landing.footerSignature', lang)}
          </div>
        </div>
      </footer>

      {/* FLOATING SOS BUTTON — hidden while chatbot is open (unless SOS is active) */}
      {(!showChatbot || sosActive || sosCountdown !== null) && (
      <button
        onClick={handleGuestSOS}
        disabled={sosSending}
        className={`fixed z-[91] w-16 h-16 rounded-full shadow-2xl flex items-center justify-center transition-all duration-300 ${
          sosActive ? 'bg-gradient-to-br from-red-500 to-rose-700 shadow-red-600/50 animate-pulse' :
          sosCountdown !== null ? 'bg-gradient-to-br from-orange-400 to-orange-600 shadow-orange-500/50 scale-110' :
          sosSending ? 'bg-gray-500' :
          'bg-gradient-to-br from-red-500 to-red-700 hover:from-red-400 hover:to-red-600 hover:scale-110 shadow-red-600/40 active:scale-90'
        }`}
        style={{ bottom: 'max(6rem, calc(env(safe-area-inset-bottom, 0px) + 6rem))', right: '1.5rem' }}
        aria-label={t('citizen.sos.aria', lang)}
      >
        {sosCountdown !== null ? (
          <span className="text-2xl font-black text-white">{sosCountdown}</span>
        ) : sosSending ? (
          <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin" />
        ) : (
          <>
            <Radio className="w-7 h-7 text-white" />
            <span className="absolute -top-1 -right-1 flex h-4 w-4">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-300 opacity-75" />
              <span className="relative inline-flex rounded-full h-4 w-4 bg-red-400 text-[8px] font-black text-white items-center justify-center">!</span>
            </span>
          </>
        )}
      </button>
      )}

      {/* SOS pulse rings */}
      {(sosCountdown !== null || sosActive) && (
        <>
          <div className="fixed z-[89] w-16 h-16 rounded-full bg-red-600/30 animate-ping pointer-events-none" style={{ bottom: 'max(6rem, calc(env(safe-area-inset-bottom, 0px) + 6rem))', right: '1.5rem' }} />
          <div className="fixed z-[88] w-20 h-20 rounded-full border-2 border-red-500/20 animate-pulse pointer-events-none" style={{ bottom: 'max(5.5rem, calc(env(safe-area-inset-bottom, 0px) + 5.5rem))', right: '1.25rem' }} />
        </>
      )}

      {/* SOS Countdown Overlay — full-screen feedback */}
      {sosCountdown !== null && (
        <div className="fixed inset-0 z-[95] bg-red-950/90 backdrop-blur-sm flex flex-col items-center justify-center animate-fade-in">
          <div className="text-center space-y-6">
            <div className="w-28 h-28 mx-auto rounded-full bg-red-600/30 flex items-center justify-center animate-pulse">
              <span className="text-7xl font-black text-white">{sosCountdown}</span>
            </div>
            <div>
              <p className="text-2xl font-black text-white">Sending Emergency SOS</p>
              <p className="text-sm text-red-200 mt-2">Your location will be shared with emergency responders</p>
            </div>
            <button
              onClick={handleGuestSOS}
              className="px-8 py-3 bg-white/10 hover:bg-white/20 border border-white/30 text-white font-bold rounded-2xl transition-all active:scale-95"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* SOS Active Panel — prominent, dynamic emergency numbers */}
      {sosActive && (
        <div className="fixed inset-x-4 bottom-28 z-[91] bg-gradient-to-br from-red-900 to-red-950 text-white rounded-2xl px-5 py-4 shadow-2xl shadow-red-900/50 max-w-sm mx-auto animate-scale-in border border-red-700/50">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-full bg-red-600 flex items-center justify-center flex-shrink-0 animate-pulse">
              <Radio className="w-5 h-5 text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-bold text-base">{t('citizen.sos.sent', lang)}</p>
              <p className="text-red-200 text-xs mt-1">Emergency report submitted. Responders notified with your location.</p>
              {sosAddress && <p className="text-red-300 text-[10px] mt-1 leading-relaxed">{sosAddress}</p>}
              {sosLat !== null && sosLng !== null && (
                <p className="text-red-400/80 text-[9px] mt-1 font-mono">GPS: {sosLat.toFixed(5)}, {sosLng.toFixed(5)}</p>
              )}
              {sosTimestamp && (
                <p className="text-red-400/80 text-[9px] mt-0.5">
                  {sosTimestamp.toLocaleDateString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' })} &mdash; {sosTimestamp.toLocaleTimeString()}
                </p>
              )}
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {emergencyInfo && (
                  <a href={`tel:${emergencyInfo.emergencyNumber.replace(/\s/g, '')}`} className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white/15 hover:bg-white/25 rounded-xl text-xs font-bold transition-colors">
                    <Phone className="w-3.5 h-3.5" /> {emergencyInfo.flag} Call {emergencyInfo.emergencyNumber}
                  </a>
                )}
                {emergencyInfo?.police && emergencyInfo.police !== emergencyInfo.emergencyNumber && (
                  <a href={`tel:${emergencyInfo.police.replace(/\s/g, '')}`} className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white/15 hover:bg-white/25 rounded-xl text-xs font-bold transition-colors">
                    <Phone className="w-3.5 h-3.5" /> Police {emergencyInfo.police}
                  </a>
                )}
                {emergencyInfo?.mentalHealth && (
                  <a href={`tel:${emergencyInfo.mentalHealth.number.replace(/\s/g, '')}`} className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white/10 hover:bg-white/20 rounded-xl text-[10px] font-semibold transition-colors">
                    <Phone className="w-3 h-3" /> {emergencyInfo.mentalHealth.name}
                  </a>
                )}
                <a href="tel:112" className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white/10 hover:bg-white/20 rounded-xl text-[10px] font-semibold transition-colors">
                  <Phone className="w-3 h-3" /> EU 112
                </a>
              </div>
            </div>
            <button onClick={() => setSosActive(false)} className="p-1.5 hover:bg-white/10 rounded-lg transition-colors flex-shrink-0">
              <X className="w-4 h-4 text-red-300" />
            </button>
          </div>
        </div>
      )}

      {/* SOS Label — small text above the button */}
      {!sosActive && sosCountdown === null && (
        <div className="fixed z-[90] pointer-events-none text-center" style={{ bottom: 'max(10.5rem, calc(env(safe-area-inset-bottom, 0px) + 10.5rem))', right: '0.75rem', width: '4.5rem' }}>
          <span className="text-[9px] font-bold text-red-600 dark:text-red-400 bg-white/90 dark:bg-gray-900/90 px-1.5 py-0.5 rounded-md shadow-sm">SOS</span>
        </div>
      )}

      {/* FLOATING CHATBOT BUTTON — only opens on click, never auto */}
      {!showChatbot && (
        <button onClick={()=>setShowChatbot(true)} className="fixed z-[90] w-16 h-16 bg-gradient-to-br from-aegis-500 to-aegis-700 hover:from-aegis-400 hover:to-aegis-600 text-white rounded-full shadow-2xl shadow-aegis-600/40 flex items-center justify-center transition-all duration-300 hover:scale-110 active:scale-90" style={{ bottom: 'max(1.5rem, calc(env(safe-area-inset-bottom, 0px) + 1.5rem))', right: '1.5rem' }} aria-label={t('nav.aiAssistant', lang)}>
          <MessageCircle className="w-6 h-6"/>
        </button>
      )}

      {/* MODALS */}
      <AnimatePresence>
      {showChatbot && (
        <motion.div key="chatbot" className="fixed inset-0 z-[90] pointer-events-none" initial={{ opacity: 0, y: 40 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 40 }} transition={{ type: 'spring', damping: 25, stiffness: 300 }}>
        <div className="pointer-events-auto">
        <ErrorBoundary name="Chatbot" fallback={<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"><div className="bg-white dark:bg-gray-900 rounded-2xl p-6 text-sm text-gray-500 dark:text-gray-400">AI assistant unavailable</div></div>}>
          <Suspense fallback={null}><Chatbot onClose={()=>setShowChatbot(false)} lang={lang}/></Suspense>
        </ErrorBoundary>
        </div>
        </motion.div>
      )}
      {showReport && (
        <motion.div key="report" className="fixed inset-0 z-50" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} transition={{ type: 'spring', damping: 25, stiffness: 300 }}>
        <ErrorBoundary name="ReportForm" fallback={<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"><div className="bg-white dark:bg-gray-900 rounded-2xl p-6 text-sm text-gray-500 dark:text-gray-400">Report form unavailable</div></div>}>
          <Suspense fallback={null}><ReportForm onClose={()=>setShowReport(false)}/></Suspense>
        </ErrorBoundary>
        </motion.div>
      )}
      {showCommunity && (
        <motion.div key="community" className="fixed inset-0 z-50" initial={{ opacity: 0, y: 40 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 40 }} transition={{ type: 'spring', damping: 25, stiffness: 300 }}>
        <ErrorBoundary name="CommunityHelp" fallback={<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"><div className="bg-white dark:bg-gray-900 rounded-2xl p-6 text-sm text-gray-500 dark:text-gray-400">Community help unavailable</div></div>}>
          <Suspense fallback={null}><CommunityHelp onClose={()=>setShowCommunity(false)}/></Suspense>
        </ErrorBoundary>
        </motion.div>
      )}
      </AnimatePresence>

      {/* Alert Detail Modal */}
      {selectedAlert && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50" onClick={() => setSelectedAlert(null)}>
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-lg max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="p-5 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
              <h3 className="font-bold text-lg text-gray-900 dark:text-white flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-red-600" />
                {t('citizenPage.alertDetails', lang)}
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
                  <span className="px-3 py-1 rounded-full text-xs font-medium bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-400">
                    {selectedAlert.hazardType}
                  </span>
                )}
              </div>
              <h4 className="text-xl font-bold text-gray-900 dark:text-white">{selectedAlert.title}</h4>
              <p className="text-sm text-gray-700 dark:text-gray-400 leading-relaxed">{selectedAlert.message}</p>
              <div className="bg-gray-50 dark:bg-gray-800/50 rounded-xl p-4 space-y-2">
                {selectedAlert.locationText && (
                  <div className="flex items-center gap-2 text-sm">
                    <MapPin className="w-4 h-4 text-gray-500 dark:text-gray-400 flex-shrink-0" />
                    <span className="text-gray-700 dark:text-gray-400">{selectedAlert.locationText}</span>
                  </div>
                )}
                <div className="flex items-center gap-2 text-sm">
                  <Clock className="w-4 h-4 text-gray-500 dark:text-gray-400 flex-shrink-0" />
                  <span className="text-gray-700 dark:text-gray-400">{new Date(selectedAlert.createdAt).toLocaleString()}</span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <Info className="w-4 h-4 text-gray-500 dark:text-gray-400 flex-shrink-0" />
                  <span className="text-gray-500 dark:text-gray-400 font-mono text-xs">ID: {selectedAlert.id}</span>
                </div>
              </div>
              <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-xl p-4">
                <h5 className="font-semibold text-sm text-amber-800 dark:text-amber-200 mb-1">{t('citizenPage.safetyAdvice', lang)}</h5>
                <p className="text-xs text-amber-700 dark:text-amber-300">{t('citizenPage.safetyAdviceText', lang)}</p>
              </div>
            </div>
            <div className="p-5 border-t border-gray-200 dark:border-gray-700 flex gap-3">
              <button onClick={() => setSelectedAlert(null)} className="flex-1 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-400 rounded-xl py-2.5 text-sm font-semibold transition-colors">{t('general.close', lang)}</button>
              <button onClick={() => { setSelectedAlert(null); setShowReport(true) }} className="flex-1 bg-red-600 hover:bg-red-700 text-white rounded-xl py-2.5 text-sm font-semibold transition-colors flex items-center justify-center gap-2">
                <AlertTriangle className="w-4 h-4" /> {t('citizenPage.reportRelated', lang)}
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
              <h3 className="font-bold text-lg text-gray-900 dark:text-white flex items-center gap-2">
                <FileText className="w-5 h-5 text-aegis-600" />
                {t('citizenPage.reportDetails', lang)}
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
                  'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400'
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
              <p className="text-sm text-gray-700 dark:text-gray-400 leading-relaxed">{selectedReport.description}</p>
              <div className="bg-gray-50 dark:bg-gray-800/50 rounded-xl p-4 space-y-2">
                <div className="flex items-center gap-2 text-sm">
                  <MapPin className="w-4 h-4 text-gray-500 dark:text-gray-400 flex-shrink-0" />
                  <span className="text-gray-700 dark:text-gray-400">{selectedReport.location}</span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <Clock className="w-4 h-4 text-gray-500 dark:text-gray-400 flex-shrink-0" />
                  <span className="text-gray-700 dark:text-gray-400">{selectedReport.displayTime || new Date(selectedReport.timestamp).toLocaleString()}</span>
                </div>
                {selectedReport.reporter && (
                  <div className="flex items-center gap-2 text-sm">
                    <User className="w-4 h-4 text-gray-500 dark:text-gray-400 flex-shrink-0" />
                    <span className="text-gray-700 dark:text-gray-400">{selectedReport.reporter}</span>
                  </div>
                )}
                <div className="flex items-center gap-2 text-sm">
                  <Info className="w-4 h-4 text-gray-500 dark:text-gray-400 flex-shrink-0" />
                  <span className="text-gray-500 dark:text-gray-400 font-mono text-xs">ID: {selectedReport.id}</span>
                </div>
              </div>
              {selectedReport.aiAnalysis && (
                <div className="bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded-xl p-4 space-y-2">
                  <h5 className="font-semibold text-sm text-blue-800 dark:text-blue-200 flex items-center gap-1.5"><Bot className="w-4 h-4" /> {t('citizenPage.aiAnalysis', lang)}</h5>
                  {selectedReport.aiAnalysis.summary && (
                    <p className="text-xs text-blue-700 dark:text-blue-300">{selectedReport.aiAnalysis.summary}</p>
                  )}
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="flex items-center gap-1.5">
                      <span className="text-blue-600 dark:text-blue-400 font-medium">{t('cdash.sentiment', lang)}:</span>
                      <span>{selectedReport.aiAnalysis.sentimentScore?.toFixed(2)}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-blue-600 dark:text-blue-400 font-medium">{t('cdash.panic', lang)}:</span>
                      <span>{selectedReport.aiAnalysis.panicLevel}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-blue-600 dark:text-blue-400 font-medium">{t('cdash.fakeRisk', lang)}:</span>
                      <span>{(selectedReport.aiAnalysis.fakeProbability * 100).toFixed(0)}%</span>
                    </div>
                    {selectedReport.aiAnalysis.estimatedWaterDepth && (
                      <div className="flex items-center gap-1.5">
                        <span className="text-blue-600 dark:text-blue-400 font-medium">{t('citizenPage.waterDepth', lang)}:</span>
                        <span>{selectedReport.aiAnalysis.estimatedWaterDepth}</span>
                      </div>
                    )}
                  </div>
                  {selectedReport.aiAnalysis.vulnerablePersonAlert && (
                    <div className="flex items-center gap-1.5 text-xs bg-purple-100 dark:bg-purple-900/30 text-purple-800 dark:text-purple-200 px-3 py-1.5 rounded-lg mt-1">
                      <AlertTriangle className="w-3.5 h-3.5" /> {t('cdash.vulnerablePersonAlert', lang)}
                    </div>
                  )}
                </div>
              )}
              {selectedReport.trappedPersons && selectedReport.trappedPersons !== 'no' && selectedReport.trappedPersons !== 'None' && (
                <div className="bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 rounded-xl p-4">
                  <h5 className="font-semibold text-sm text-red-800 dark:text-red-200">{t('citizenPage.trappedPersons', lang)}</h5>
                  <p className="text-xs text-red-700 dark:text-red-300 mt-1">
                    {selectedReport.trappedPersons === 'yes' ? 'Yes — People are trapped or in immediate danger'
                      : selectedReport.trappedPersons === 'property' ? 'No — But property or infrastructure at risk'
                      : selectedReport.trappedPersons}
                  </p>
                </div>
              )}
              {/* Media Attachments */}
              {(selectedReport.media?.length > 0 || selectedReport.mediaUrl) && (
                <div className="space-y-2">
                  <h5 className="font-semibold text-sm text-gray-800 dark:text-gray-200 flex items-center gap-1.5">
                    <Eye className="w-4 h-4" /> Media Attachments
                  </h5>
                  <div className="grid grid-cols-2 gap-2">
                    {selectedReport.media?.map((file: any, i: number) => (
                      <a key={file.id || i} href={file.url || file.file_url} target="_blank" rel="noopener noreferrer" className="group relative rounded-xl overflow-hidden border border-gray-200 dark:border-gray-700 hover:border-aegis-500 transition-colors">
                        {file.type === 'video' ? (
                          <video src={file.url || file.file_url} className="w-full h-32 object-cover" />
                        ) : (
                          <img src={file.url || file.file_url} alt={file.filename || `Attachment ${i + 1}`} className="w-full h-32 object-cover" loading="lazy" />
                        )}
                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                          <Eye className="w-5 h-5 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                        </div>
                      </a>
                    ))}
                    {!selectedReport.media?.length && selectedReport.mediaUrl && (
                      <a href={selectedReport.mediaUrl} target="_blank" rel="noopener noreferrer" className="group relative rounded-xl overflow-hidden border border-gray-200 dark:border-gray-700 hover:border-aegis-500 transition-colors">
                        <img src={selectedReport.mediaUrl} alt="Report attachment" className="w-full h-32 object-cover" loading="lazy" />
                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                          <Eye className="w-5 h-5 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                        </div>
                      </a>
                    )}
                  </div>
                </div>
              )}
            </div>
            <div className="p-5 border-t border-gray-200 dark:border-gray-700 flex gap-3">
              <button onClick={() => setSelectedReport(null)} className="flex-1 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-400 rounded-xl py-2.5 text-sm font-semibold transition-colors">{t('general.close', lang)}</button>
              <button onClick={() => { handleShareReport(selectedReport); }} className="flex-1 bg-blue-600 hover:bg-blue-700 text-white rounded-xl py-2.5 text-sm font-semibold transition-colors flex items-center justify-center gap-2">
                <Share2 className="w-4 h-4" /> {t('cdash.share', lang)}
              </button>
              <button onClick={() => { handlePrintReport(selectedReport); }} className="flex-1 bg-gray-600 hover:bg-gray-700 text-white rounded-xl py-2.5 text-sm font-semibold transition-colors flex items-center justify-center gap-2">
                <Printer className="w-4 h-4" /> {t('cdash.print', lang)}
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
              <h3 className="font-bold text-lg text-gray-900 dark:text-white flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-aegis-400 to-aegis-600 flex items-center justify-center">
                  <Bell className="w-4 h-4 text-white"/>
                </div>
                {t('subscribe.title', lang)}
              </h3>
              <button onClick={()=>setShowSubscribe(false)} className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-xl transition-all"><X className="w-5 h-5"/></button>
            </div>
            <div className="p-5 space-y-3">
              <p className="text-xs text-gray-500 dark:text-gray-400">{t('citizenPage.chooseChannels', lang)}</p>
              {[
                { key: 'email', label: t('subscribe.email', lang) || 'Email', icon: Mail, gradient: 'from-red-400 to-rose-600' },
                { key: 'sms', label: t('subscribe.sms', lang) || 'SMS', icon: Smartphone, gradient: 'from-green-400 to-emerald-600' },
                { key: 'telegram', label: t('subscribe.telegram', lang) || 'Telegram', icon: SendIcon, gradient: 'from-blue-400 to-blue-600' },
                { key: 'whatsapp', label: t('subscribe.whatsapp', lang) || 'WhatsApp', icon: MessageSquare, gradient: 'from-green-500 to-green-700' },
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
                  <p className="text-xs text-gray-500 dark:text-gray-400">Example: {selectedCountry.dial} {selectedCountry.format}</p>
                </div>
              )}
              {subChannels.includes('telegram') && (
                <div className="space-y-2">
                  <input 
                    className="w-full px-4 py-2.5 text-sm bg-gray-100/80 dark:bg-gray-800/80 rounded-xl border border-gray-200/50 dark:border-gray-700/50 focus:ring-2 focus:ring-aegis-500/30 transition-all" 
                    placeholder={t('citizenPage.telegramPlaceholder', lang)}
                    value={subTelegramId} 
                    onChange={e=>setSubTelegramId(e.target.value)}
                    type="text"
                  />
                  <p className="text-xs text-gray-500 dark:text-gray-400">{t('citizenPage.telegramHelp', lang)}</p>
                </div>
              )}
              {subChannels.includes('webpush') && (
                <div className="bg-purple-50/80 dark:bg-purple-950/30 border border-purple-200/50 dark:border-purple-800/50 p-3.5 rounded-xl">
                  {!webPushStatus.supported ? (
                    <p className="text-xs text-red-700 dark:text-red-300">{t('citizenPage.webPushNotSupported', lang)}</p>
                  ) : webPushStatus.subscribed ? (
                    <p className="text-xs text-green-700 dark:text-green-300">{t('citizenPage.webPushAlready', lang)}</p>
                  ) : webPushStatus.enabled ? (
                    <p className="text-xs text-purple-700 dark:text-purple-300">{t('citizenPage.webPushReady', lang)}</p>
                  ) : (
                    <p className="text-xs text-amber-700 dark:text-amber-300">{t('citizenPage.webPushLoading', lang)}</p>
                  )}
                </div>
              )}
              <button onClick={handleSubscribe} disabled={subChannels.length===0 || (subChannels.includes('webpush') && !webPushStatus.supported)} className="w-full bg-gradient-to-r from-aegis-500 to-aegis-700 hover:from-aegis-400 hover:to-aegis-600 disabled:from-gray-300 disabled:to-gray-400 disabled:cursor-not-allowed text-white py-3 rounded-xl font-bold text-sm transition-all shadow-lg shadow-aegis-600/20 hover:shadow-xl hover:scale-[1.01] active:scale-[0.99]">
                {webPushLoading ? t('citizenPage.settingUpWebPush', lang) : t('subscribe.title', lang)}
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

      {/* First-run onboarding tutorial */}
      <Suspense fallback={null}><OnboardingTutorial /></Suspense>
    </AppLayout>
  )
}

// GuestReportsTab — Professional-grade Recent Reports for guest page

function GuestReportsTab({ reports, sorted, loading, searchTerm, setSearchTerm, sortField, setSortField, sortOrder, setSortOrder, onViewReport, onShareReport, onPrintReport, onNewReport, lang }: any) {
  const [statusFilter, setStatusFilter] = useState<'all' | 'Unverified' | 'Verified' | 'Urgent' | 'Resolved'>('all')

  const filtered = useMemo(() => {
    let list = [...sorted]
    if (statusFilter !== 'all') list = list.filter((r: any) => r.status === statusFilter)
    return list
  }, [sorted, statusFilter])

  const stats = useMemo(() => {
    const urgent = reports.filter((r: any) => r.status === 'Urgent').length
    const verified = reports.filter((r: any) => r.status === 'Verified').length
    const unverified = reports.filter((r: any) => r.status === 'Unverified').length
    const resolved = reports.filter((r: any) => r.status === 'Resolved' || r.status === 'Archived').length
    return { total: reports.length, urgent, verified, unverified, resolved }
  }, [reports])

  return (
    <div className="animate-fade-in space-y-4">
      {/* HEADER */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="relative">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-aegis-500 to-aegis-700 flex items-center justify-center shadow-lg shadow-aegis-600/20">
              <FileText className="w-5 h-5 text-white" />
            </div>
            {stats.urgent > 0 && (
              <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red-500 border-2 border-white dark:border-gray-900 flex items-center justify-center">
                <span className="text-[7px] font-black text-white">{stats.urgent}</span>
              </span>
            )}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-extrabold text-gray-900 dark:text-white tracking-tight">{t('citizenPage.recentReports', lang)}</h2>
              <span className="px-2.5 py-0.5 rounded-full bg-aegis-100 dark:bg-aegis-900/40 text-aegis-700 dark:text-aegis-300 text-xs font-bold">{stats.total}</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1 px-2 py-1 rounded-full bg-green-100 dark:bg-green-900/40 text-[9px] font-bold text-green-700 dark:text-green-300 uppercase tracking-wider">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
            {t('cdash.reports.realTime', lang)}
          </span>
          <button onClick={onNewReport} className="text-xs bg-gradient-to-r from-red-500 to-rose-600 hover:from-red-400 hover:to-rose-500 text-white px-4 py-2 rounded-xl font-bold flex items-center gap-1.5 transition-all hover:scale-[1.02] shadow-lg shadow-red-500/20">
            <AlertTriangle className="w-3.5 h-3.5" /> {t('citizenPage.reportEmergency', lang)}
          </button>
        </div>
      </div>

      {/* STATUS PIPELINE */}
      <div className="flex items-center gap-1 overflow-x-auto no-scrollbar">
        {([
          { key: 'all' as const, label: t('cdash.reports.all', lang), count: stats.total, color: 'text-gray-600 dark:text-gray-400', activeBg: 'bg-gray-100 dark:bg-gray-700' },
          { key: 'Unverified' as const, label: t('cdash.reports.unverified', lang), count: stats.unverified, color: 'text-yellow-600', activeBg: 'bg-yellow-50 dark:bg-yellow-950/30' },
          { key: 'Verified' as const, label: t('cdash.reports.verifiedStatus', lang), count: stats.verified, color: 'text-emerald-600', activeBg: 'bg-emerald-50 dark:bg-emerald-950/30' },
          { key: 'Urgent' as const, label: t('cdash.reports.urgent', lang), count: stats.urgent, color: 'text-red-600', activeBg: 'bg-red-50 dark:bg-red-950/30' },
          { key: 'Resolved' as const, label: t('cdash.reports.resolved', lang), count: stats.resolved, color: 'text-blue-600', activeBg: 'bg-blue-50 dark:bg-blue-950/30' },
        ]).map(st => (
          <button
            key={st.key}
            onClick={() => setStatusFilter(st.key)}
            className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-bold whitespace-nowrap transition-all flex-shrink-0 ${
              statusFilter === st.key
                ? `${st.activeBg} ${st.color} ring-1 ring-current/20 shadow-sm`
                : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800/50'
            }`}
          >
            {st.label}
            {st.count > 0 && <span className={`ml-0.5 px-1.5 rounded-full text-[8px] ${statusFilter === st.key ? 'bg-current/10' : 'bg-gray-200/60 dark:bg-gray-700/40'}`}>{st.count}</span>}
          </button>
        ))}
      </div>

      {/* SEARCH + SORT + LIST */}
      <div className="glass-card rounded-2xl overflow-hidden shadow-lg">
        <div className="p-3 border-b border-gray-200/50 dark:border-gray-700/50 flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-400" />
            <input className="w-full pl-10 pr-3 py-2.5 text-xs bg-gray-50 dark:bg-gray-800/60 rounded-xl border border-gray-200 dark:border-gray-700 focus:ring-2 focus:ring-aegis-500 focus:border-transparent transition text-gray-900 dark:text-white placeholder-gray-400" placeholder={t('reports.search', lang) || 'Search reports...'} value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
          </div>
          <select value={sortField} onChange={e => setSortField(e.target.value)} className="text-xs bg-gray-50 dark:bg-gray-800/60 px-3 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 focus:ring-2 focus:ring-aegis-500 appearance-none text-gray-700 dark:text-gray-200">
            <option value="timestamp">{t('citizen.reports.newest', lang)}</option>
            <option value="severity">{t('reports.severity', lang)}</option>
            <option value="confidence">{t('citizen.reports.aiConfidence', lang)}</option>
          </select>
          <button onClick={() => setSortOrder((o: string) => o === 'desc' ? 'asc' : 'desc')} className="p-2.5 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-xl transition-colors" title={sortOrder === 'desc' ? t('cdash.reports.newestFirst', lang) : t('cdash.reports.oldestFirst', lang)}>
            <ArrowUpDown className="w-4 h-4 text-gray-500 dark:text-gray-400" />
          </button>
          <span className="text-[9px] font-medium text-gray-400 dark:text-gray-400 ml-auto">{filtered.length} of {stats.total}</span>
        </div>

        <div className="divide-y divide-gray-100/80 dark:divide-gray-800/60 max-h-[600px] overflow-y-auto custom-scrollbar">
          {loading ? (
            <p className="p-6 text-center text-sm text-gray-500 dark:text-gray-400">{t('general.loading', lang)}</p>
          ) : filtered.length === 0 ? (
            reports.length > 0 ? (
              <div className="py-12 text-center">
                <Filter className="w-8 h-8 text-gray-300 dark:text-gray-400 mx-auto mb-2" />
                <p className="text-sm font-bold text-gray-700 dark:text-gray-200">{t('cdash.reports.noMatching', lang)}</p>
                <p className="text-xs text-gray-400 dark:text-gray-400 mt-1">{t('cdash.reports.tryAdjusting', lang)} <button onClick={() => setStatusFilter('all')} className="text-aegis-600 dark:text-aegis-400 font-bold hover:underline">{t('cdash.reports.clearingFilters', lang)}</button></p>
              </div>
            ) : (
              <p className="p-6 text-center text-sm text-gray-500 dark:text-gray-400">{t('general.noResults', lang)}</p>
            )
          ) : (
            filtered.map((r: any) => {
              const sevColor = r.severity === 'High' ? 'border-l-red-500 bg-red-50/40 dark:bg-red-950/10' : r.severity === 'Medium' ? 'border-l-amber-500 bg-amber-50/40 dark:bg-amber-950/10' : 'border-l-blue-500 bg-blue-50/40 dark:bg-blue-950/10'
              const timeAgoMs = Date.now() - new Date(r.timestamp).getTime()
              const isRecent = timeAgoMs < 3600_000
              return (
                <div key={r.id} className={`relative group border-l-4 ${sevColor} transition-all hover:bg-gray-50/60 dark:hover:bg-gray-800/30`}>
                  {isRecent && (
                    <div className="absolute top-2.5 right-14 z-10">
                      <span className="px-1.5 py-0.5 rounded text-[7px] font-black bg-green-500 text-white uppercase tracking-wider animate-pulse">{t('cdash.reports.new', lang)}</span>
                    </div>
                  )}
                  <ReportCard report={r} onClick={onViewReport} />
                  <div className="absolute top-3 right-3 flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity z-10">
                    <button onClick={(e) => { e.stopPropagation(); onShareReport(r) }} className="p-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-950/20 transition-all shadow-sm" title="Share">
                      <Share2 className="w-4 h-4 text-blue-600" />
                    </button>
                    <button onClick={(e) => { e.stopPropagation(); onPrintReport(r) }} className="p-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-all shadow-sm" title="Print">
                      <Printer className="w-4 h-4 text-gray-600 dark:text-gray-400" />
                    </button>
                  </div>
                </div>
              )
            })
          )}
        </div>

        {filtered.length > 0 && (
          <div className="flex items-center justify-between px-3 py-2 border-t border-gray-100 dark:border-gray-800/50 bg-gray-50/50 dark:bg-gray-900/30">
            <div className="flex items-center gap-3 text-[9px] font-medium">
              <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                Real-time
              </span>
            </div>
            <span className="text-[9px] font-bold text-gray-400 dark:text-gray-400 px-2 py-0.5 rounded bg-gray-200/60 dark:bg-gray-700/40">{filtered.length} reports</span>
          </div>
        )}
      </div>
    </div>
  )
}

