/**
 * The public citizen portal. Accessible without logging in, it shows the
 * live disaster map, active alerts, a report submission form, and links to
 * community help resources. It's the starting page citizens land on before
 * deciding to create an account or just browse.
 *
 * - Routed by client/src/App.tsx at /citizen
 * - Links to /citizen/auth for sign-in and /citizen/dashboard for signed-in users
 * - Alert data from client/src/contexts/AlertsContext.tsx (real-time)
 * - Map rendered via client/src/components/shared/DisasterMap.tsx
 * - Public report submission calls POST /api/reports (no auth required)
 *
 * - client/src/pages/CitizenDashboard.tsx        -- the authenticated follow-up page
 * - client/src/components/shared/DisasterMap.tsx -- the live map component
 * - server/src/routes/reportRoutes.ts            -- public report endpoints
 */

/* CitizenPage.tsx -- Public citizen portal with alerts, reports, map, and community help. */

import { useState, useMemo, useEffect, useCallback, useRef, lazy, Suspense } from 'react'
import type { ComponentType } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { usePageTitle } from '../hooks/usePageTitle'
import { Link, useSearchParams, useNavigate } from 'react-router-dom'
import {
  Shield, AlertTriangle, Users, MapPin, BookOpen, Bell, Sun, Moon,
  ArrowUpDown, Phone, CheckCircle, HelpCircle, X, Heart, Home, Car,
  HeartPulse, Shirt, Crosshair, ExternalLink, Newspaper, FileText,
  ShieldCheck, ThumbsUp, ThumbsDown, Mail, Smartphone, Wifi, MessageCircle,
  Send as SendIcon, Eye, MessageSquare, Droplets, Wind, Thermometer,
  BarChart3, Clock, ChevronLeft, ChevronRight, Info, Search,
  Waves, Building2, Flame, TreePine, Bot, RefreshCw, Mountain, ChevronDown,
  Printer, Share2, User, Radio, Filter, Activity,
  Sparkles, Satellite, TrendingUp, PhoneCall, Zap, Siren, Globe,
  CloudRain, Timer, Layers, AlertCircle, ScanEye, Map as MapIcon,
  Package, Banknote, Navigation
} from 'lucide-react'
import { useReports } from '../contexts/ReportsContext'
import { useCitizenAuth } from '../contexts/CitizenAuthContext'
import { useAlerts } from '../contexts/AlertsContext'
import { useLocation } from '../contexts/LocationContext'
import { useTheme } from '../contexts/ThemeContext'
import { t, getLanguage, isRtl } from '../utils/i18n'
import { useLanguage } from '../hooks/useLanguage'
import { useWebPush } from '../hooks/useWebPush'
import { apiGetNews, apiGetAlerts, type NewsItem } from '../utils/api'
import { getCitizenToken } from '../contexts/CitizenAuthContext'
import { type CountryCode } from '../data/countryCodes'
import ALL_COUNTRY_CODES from '../data/allCountryCodes'
import { getEmergencyInfo as getGlobalEmergencyFallback } from '../data/allCountries'
import ReportCard from '../components/shared/ReportCard'
import SubscribeModal from '../components/shared/SubscribeModal'
import ThemeSelector from '../components/ui/ThemeSelector'
import AppLayout from '../components/layout/AppLayout'
import ErrorBoundary from '../components/shared/ErrorBoundary'
import AlertsPanel from '../components/shared/AlertsPanel'
import { SkeletonCard, Skeleton } from '../components/ui/Skeleton'
import type { SidebarItem } from '../components/layout/Sidebar'
import { GLOBAL_EMERGENCY_DB, type GlobalEmergencyEntry } from '../config/globalEmergencyDB'

//Lazy load heavy components for bundle optimization
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

//Map region-picker city keys to ISO country codes for emergency number lookup
//Country-level keys (e.g. 'at', 'de') are ISO codes already and handled dynamically
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

/* -- Citizen Welcome Animations -- */
const CP_STYLE_ID = 'citizen-page-hero-animations'
function injectCPAnimations() {
  if (document.getElementById(CP_STYLE_ID)) return
  const style = document.createElement('style')
  style.id = CP_STYLE_ID
  style.textContent = `
    @keyframes cpFadeUp    { from { opacity:0; transform:translateY(28px) } to { opacity:1; transform:translateY(0) } }
    @keyframes cpScaleIn   { from { opacity:0; transform:scale(.9) } to { opacity:1; transform:scale(1) } }
    @keyframes cpSlideIn   { from { opacity:0; transform:translateX(-20px) } to { opacity:1; transform:translateX(0) } }
    @keyframes cpFloat     { 0%,100% { transform:translateY(0) } 50% { transform:translateY(-14px) } }
    @keyframes cpFloat2    { 0%,100% { transform:translateY(0) rotate(0deg) } 50% { transform:translateY(-10px) rotate(4deg) } }
    @keyframes cpOrbit     { from { transform:rotate(0deg) translateX(140px) rotate(0deg) } to { transform:rotate(360deg) translateX(140px) rotate(-360deg) } }
    @keyframes marquee     { from { transform:translateX(0) } to { transform:translateX(-50%) } }
    @keyframes cpPulseGlow { 0%,100% { box-shadow:0 0 20px rgba(59,130,246,0.3) } 50% { box-shadow:0 0 40px rgba(59,130,246,0.6) } }
    @keyframes cpShimmer   { from { background-position:-200% 0 } to { background-position:200% 0 } }
    @keyframes cpGradient  { 0%,100% { background-position:0% 50% } 50% { background-position:100% 50% } }
    @keyframes cpTyping    { from { width:0 } to { width:100% } }
    @keyframes cpBlink     { 0%,100% { opacity:1 } 50% { opacity:0 } }
    @keyframes cpCountUp   { from { opacity:0; transform:translateY(12px) } to { opacity:1; transform:translateY(0) } }
    @keyframes cpRipple    { 0% { transform:scale(1); opacity:0.4 } 100% { transform:scale(2.5); opacity:0 } }
    .cp-fade-up   { animation: cpFadeUp .7s cubic-bezier(.22,1,.36,1) both }
    .cp-scale-in  { animation: cpScaleIn .6s cubic-bezier(.22,1,.36,1) both }
    .cp-slide-in  { animation: cpSlideIn .5s cubic-bezier(.22,1,.36,1) both }
    .cp-float     { animation: cpFloat 6s ease-in-out infinite }
    .cp-float2    { animation: cpFloat2 8s ease-in-out infinite }
    .cp-orbit     { animation: cpOrbit 25s linear infinite }
    .cp-shimmer   { background:linear-gradient(90deg,transparent 30%,rgba(255,255,255,.12) 50%,transparent 70%); background-size:200% 100%; animation:cpShimmer 3s linear infinite }
    .cp-gradient  { background-size:200% 200%; animation:cpGradient 8s ease infinite }
    .cp-count-up  { animation: cpCountUp .5s ease-out both }
    .cp-pulse-glow { animation: cpPulseGlow 3s ease-in-out infinite }
    @keyframes cpGlowLine { 0%,100% { opacity:.3; box-shadow:0 0 15px rgba(6,182,212,.2) } 50% { opacity:1; box-shadow:0 0 30px rgba(6,182,212,.5) } }
    @keyframes cpScanline { from { transform:translateY(-100%) } to { transform:translateY(100vh) } }
    @keyframes cpMeshMove { 0%,100% { background-position:0% 50% } 50% { background-position:100% 50% } }
    @keyframes cpBreathePulse { 0%,100% { transform:scale(1); opacity:0.6 } 50% { transform:scale(1.05); opacity:1 } }
    @keyframes cpNeonFlicker { 0%,100% { opacity:1 } 92% { opacity:1 } 93% { opacity:.4 } 94% { opacity:1 } 96% { opacity:.7 } 97% { opacity:1 } }
    @keyframes cpRadarSweep { from { transform:rotate(0deg) } to { transform:rotate(360deg) } }
    @keyframes cpDataStream { from { transform:translateY(-100%) } to { transform:translateY(100%) } }
    .cp-glow-line { animation: cpGlowLine 2s ease-in-out infinite }
    .cp-scanline { animation: cpScanline 4s linear infinite }
    .cp-mesh { background-size:400% 400%; animation:cpMeshMove 12s ease infinite }
    .cp-breathe { animation: cpBreathePulse 4s ease-in-out infinite }
    .cp-neon-flicker { animation: cpNeonFlicker 5s ease-in-out infinite }
    .cp-radar-sweep { animation: cpRadarSweep 3s linear infinite }
  `
  document.head.appendChild(style)
}

/* -- Typing text for hero subtitle -- */
function HeroTypingText({ texts, speed = 55, pause = 3000, className = '' }: { texts: string[]; speed?: number; pause?: number; className?: string }) {
  const [textIdx, setTextIdx] = useState(0)
  const [charIdx, setCharIdx] = useState(0)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    const current = texts[textIdx]
    if (!deleting && charIdx < current.length) {
      const tm = setTimeout(() => setCharIdx(c => c + 1), speed)
      return () => clearTimeout(tm)
    }
    if (!deleting && charIdx === current.length) {
      const tm = setTimeout(() => setDeleting(true), pause)
      return () => clearTimeout(tm)
    }
    if (deleting && charIdx > 0) {
      const tm = setTimeout(() => setCharIdx(c => c - 1), speed / 2)
      return () => clearTimeout(tm)
    }
    if (deleting && charIdx === 0) {
      setDeleting(false)
      setTextIdx(i => (i + 1) % texts.length)
    }
  }, [charIdx, deleting, textIdx, texts, speed, pause])

  return (
    <span className={className}>
      {texts[textIdx].slice(0, charIdx)}
      <span className="inline-block w-[2px] h-[1em] bg-current ml-0.5 align-middle" style={{ animation: 'cpBlink 1s step-end infinite' }} />
    </span>
  )
}

/* -- Animated counter -- */
function CPAnimatedCounter({ value, duration = 1200, className = '', style }: { value: number; duration?: number; className?: string; style?: React.CSSProperties }) {
  const [display, setDisplay] = useState(0)
  const prevRef = useRef(0)
  useEffect(() => {
    const from = prevRef.current
    const diff = value - from
    if (diff === 0) return
    const steps = 35
    const stepTime = duration / steps
    let step = 0
    const timer = setInterval(() => {
      step++
      const progress = step / steps
      const eased = 1 - Math.pow(1 - progress, 3)
      setDisplay(Math.round(from + diff * eased))
      if (step >= steps) { setDisplay(value); clearInterval(timer); prevRef.current = value }
    }, stepTime)
    return () => clearInterval(timer)
  }, [value, duration])
  return <span className={`tabular-nums ${className}`} style={style}>{display.toLocaleString()}</span>
}

/* -- Severity donut ring -- */
function HeroSeverityRing({ alerts: alertList }: { alerts: Array<{ severity: string }> }) {
  const counts = useMemo(() => ({
    critical: alertList.filter(a => a.severity === 'critical').length,
    high: alertList.filter(a => a.severity === 'high' || a.severity === 'High').length,
    medium: alertList.filter(a => a.severity === 'medium' || a.severity === 'Medium').length,
    low: alertList.filter(a => a.severity === 'low' || a.severity === 'Low').length,
  }), [alertList])
  const total = counts.critical + counts.high + counts.medium + counts.low
  if (total === 0) return (
    <div className="flex items-center gap-3">
      <div className="w-16 h-16 rounded-full border-4 border-green-400/30 flex items-center justify-center">
        <ShieldCheck className="w-6 h-6 text-green-300" />
      </div>
      <div>
        <p className="text-sm font-bold text-green-300">All Clear</p>
        <p className="text-[10px] text-white/40">No active alerts</p>
      </div>
    </div>
  )
  const segments = [
    { pct: counts.critical / total, color: '#ef4444', label: 'Critical' },
    { pct: counts.high / total, color: '#f97316', label: 'High' },
    { pct: counts.medium / total, color: '#eab308', label: 'Medium' },
    { pct: counts.low / total, color: '#22c55e', label: 'Low' },
  ].filter(s => s.pct > 0)
  let offset = 0
  const r = 28, circ = 2 * Math.PI * r
  return (
    <div className="flex items-center gap-3">
      <svg width="68" height="68" viewBox="0 0 68 68" className="drop-shadow-lg flex-shrink-0">
        <circle cx="34" cy="34" r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="7" />
        {segments.map((seg, i) => {
          const dash = circ * seg.pct, gap = circ - dash, o = offset
          offset += seg.pct
          return <circle key={i} cx="34" cy="34" r={r} fill="none" stroke={seg.color} strokeWidth="7" strokeDasharray={`${dash} ${gap}`} strokeDashoffset={-circ * o} strokeLinecap="round" transform="rotate(-90 34 34)" className="transition-all duration-1000" />
        })}
        <text x="34" y="34" textAnchor="middle" dominantBaseline="central" className="fill-white font-black text-xs">{total}</text>
      </svg>
      <div className="flex flex-col gap-1">
        {segments.map((s, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: s.color }} />
            <span className="text-[10px] text-white/60 font-medium">{s.label}: {Math.round(s.pct * total)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

const NEWS_BATCH = 10

const HAZARD_META: Record<string, { gradient: string; bgFill: string; border: string; description: string; tips: string[]; watch: string[]; zones: string[] }> = {
  flood:         { gradient: 'from-blue-500 to-cyan-600',     bgFill: 'bg-blue-50 dark:bg-blue-950/30',    border: 'border-blue-200 dark:border-blue-700/40',    description: 'Rising water levels from heavy rain, storm surge or river overflow threatening low-lying communities and infrastructure.',  tips: ['Move to higher ground immediately', 'Never drive through floodwater -- even 15 cm can knock you over', 'Disconnect electrical appliances and turn off gas at the mains'],    watch: ['River levels rising rapidly after sustained rainfall', 'Storm drain overflow and road flooding', 'Official flood watch or warning issued'],      zones: ['Coastal and tidal areas', 'River floodplains', 'Low-lying urban zones'] },
  wildfire:      { gradient: 'from-orange-500 to-red-600',    bgFill: 'bg-orange-50 dark:bg-orange-950/30', border: 'border-orange-200 dark:border-orange-700/40', description: 'Fast-moving fires fuelled by dry vegetation, strong winds and low humidity threatening lives and homes in seconds.',          tips: ['Evacuate immediately when authorities advise', 'Close all windows and doors before leaving', 'Take medication, documents, phone charger and water'],   watch: ['Smoke visible on the horizon or ash falling', 'Strong hot dry winds developing', 'Fire danger rating reaching Extreme or Catastrophic'],          zones: ['Bushland and urban-forest interfaces', 'Dry forest and grassland areas', 'Regions in prolonged drought'] },
  environmental: { gradient: 'from-green-500 to-emerald-700', bgFill: 'bg-green-50 dark:bg-green-950/30',  border: 'border-green-200 dark:border-green-700/40',  description: 'Air quality emergencies, chemical spills, toxic releases and ecological events threatening human health and ecosystems.',    tips: ['Check air quality index before going outdoors', 'Seal windows and doors if chemical hazard is nearby', 'Follow instructions from environmental health authorities'], watch: ['Unusual odour or haze in the air', 'Reports of industrial or chemical accidents nearby', 'Government air quality emergency alert issued'],          zones: ['Industrial corridors and factory zones', 'Areas near refineries or chemical plants', 'Urban centres during atmospheric inversions'] },
  heatwave:      { gradient: 'from-amber-400 to-orange-500',  bgFill: 'bg-amber-50 dark:bg-amber-950/30',  border: 'border-amber-200 dark:border-amber-700/40',  description: 'Extreme heat causing serious health emergencies, particularly for the elderly, children and those without air conditioning.', tips: ['Drink water every 30 minutes without waiting for thirst', 'Avoid all outdoor activity between 11am and 3pm', 'Check on elderly, isolated and vulnerable neighbours'],  watch: ['Temperature forecast above 38 degrees', 'Overnight temperatures not dropping below 25 degrees', 'Official heat health warning issued'],             zones: ['Urban heat islands', 'Inland rural areas', 'Homes without air conditioning'] },
  storm:         { gradient: 'from-purple-500 to-indigo-600', bgFill: 'bg-purple-50 dark:bg-purple-950/30', border: 'border-purple-200 dark:border-purple-700/40', description: 'Severe storm systems bringing destructive winds, hail, heavy rain and risk of flash flooding or tornado formation.',          tips: ['Stay indoors well away from all windows', 'Secure outdoor furniture and loose objects before storm arrives', 'Keep battery-powered devices and a torch fully charged'],  watch: ['Rapidly falling barometric pressure', 'Darkening skies with rotation or wall clouds', 'Severe storm watch or warning issued'],                      zones: ['Coastal regions', 'Open plains and farmland', 'High-altitude and mountain areas'] },
  landslide:     { gradient: 'from-stone-500 to-amber-800',   bgFill: 'bg-stone-50 dark:bg-stone-950/30',  border: 'border-stone-200 dark:border-stone-700/40',  description: 'Rapid mass movement of saturated soil, rock and debris down slopes triggered by heavy rainfall, earthquakes or erosion.',   tips: ['Evacuate hillsides and valleys when prolonged heavy rain begins', 'Listen for cracking, rumbling sounds or unusual water flow', 'Do not re-enter area -- secondary slides frequently follow'], watch: ['Bulging ground or tilting trees on slopes', 'Murky or unusual water flow from hillsides', 'New cracks appearing in hillside terrain'],              zones: ['Steep hillsides and mountain valleys', 'Areas with saturated or recently burned soils', 'Regions with recent heavy rainfall'] },
  public_safety: { gradient: 'from-rose-500 to-red-700',      bgFill: 'bg-rose-50 dark:bg-rose-950/30',    border: 'border-rose-200 dark:border-rose-700/40',    description: 'Civil unrest, crowd emergencies, mass casualty incidents and security events requiring coordinated emergency response.',   tips: ['Move away from large crowds if unrest begins', 'Follow all police and emergency service instructions immediately', 'Stay indoors and away from windows during security incidents'],  watch: ['Large unusual crowds or demonstrations forming rapidly', 'Police or security forces mobilising', 'Official lockdown or shelter-in-place order issued'],  zones: ['Densely populated urban centres', 'Public venues, stadiums and event spaces', 'Government buildings and major transit hubs'] },
  infrastructure:{ gradient: 'from-slate-500 to-gray-700',    bgFill: 'bg-slate-50 dark:bg-slate-950/30',  border: 'border-slate-200 dark:border-slate-700/40',  description: 'Critical failures in bridges, roads, buildings and utility networks causing imminent danger to the public.',              tips: ['Avoid all damaged roads, bridges and structures', 'Report visible structural damage to authorities immediately', 'Have alternative routes planned for essential travel'],   watch: ['Visible cracks or sagging in bridges or buildings', 'Ground subsidence or sinkholes forming', 'Official road or structure closure notices'],         zones: ['Ageing infrastructure corridors', 'Areas under heavy rainfall or seismic stress', 'Mining and extraction activity zones'] },
  water_supply:  { gradient: 'from-cyan-500 to-teal-700',     bgFill: 'bg-cyan-50 dark:bg-cyan-950/30',    border: 'border-cyan-200 dark:border-cyan-700/40',    description: 'Contamination, shortage or disruption to drinking water and sewage systems threatening public health and sanitation.',     tips: ['Boil all water before drinking if advisory is issued', 'Store 3 litres of bottled water per person per day as emergency supply', 'Do not use tap water for cooking or oral hygiene during advisory'],  watch: ['Discoloured or unusual-smelling tap water', 'Official boil water advisory from utility provider', 'Flooding near water treatment facilities'],     zones: ['Areas reliant on a single water source', 'Flood-prone regions near treatment plants', 'Rural communities with private bores or tanks'] },
  drought:       { gradient: 'from-yellow-500 to-amber-600',  bgFill: 'bg-yellow-50 dark:bg-yellow-950/30', border: 'border-yellow-200 dark:border-yellow-700/40', description: 'Prolonged water shortage affecting agriculture, supply infrastructure, elevated fire risk and community health.',            tips: ['Conserve water strictly at every opportunity', 'Monitor fire danger ratings daily', 'Maintain at least 3 days of emergency drinking water supply at all times'],  watch: ['Reservoir and dam levels falling critically', 'Extended weeks without significant rainfall', 'Crop failures and livestock stress warnings'],         zones: ['Agricultural and farming regions', 'Regional water catchment areas', 'Semi-arid and inland zones'] },
  power_outage:  { gradient: 'from-yellow-400 to-amber-600',  bgFill: 'bg-yellow-50 dark:bg-yellow-950/30', border: 'border-yellow-200 dark:border-yellow-700/40', description: 'Extended electricity grid failures leaving homes, hospitals and critical services without power during extreme conditions.', tips: ['Keep torches, candles and portable battery banks charged at all times', 'Never use gas stoves or generators indoors for heating', 'Report extended outages to your energy provider immediately'],  watch: ['Transformer explosion sounds or visible flashes', 'Multiple streets losing power simultaneously', 'Severe storm or infrastructure damage in region'], zones: ['Rural grid areas far from substations', 'Areas affected by severe storms or wildfires', 'Urban centres during extreme heat demand surges'] },
}

export default function CitizenPage(): JSX.Element {
  usePageTitle('Dashboard')
  const lang = useLanguage()
  const navigate = useNavigate()
  const { reports, loading, refreshReports } = useReports()
  const { alerts, notifications, pushNotification, dismissNotification } = useAlerts()
  const { location: loc, availableLocations, activeLocation, setActiveLocation } = useLocation()
  const { dark, toggle } = useTheme()
  const { isAuthenticated: isCitizenLoggedIn, user: citizenUser } = useCitizenAuth()

  const [showReport, setShowReport] = useState(false)
  const [showCommunity, setShowCommunity] = useState(false)
  const [showChatbot, setShowChatbot] = useState(false)
  const [activeHazardIdx, setActiveHazardIdx] = useState(0)
  const [hazardFlipped, setHazardFlipped] = useState(false)
  const [activeTab, setActiveTab] = useState('map')
  const [sortField, setSortField] = useState('timestamp')
  const [sortOrder, setSortOrder] = useState('desc')
  const [safetyStatus, setSafetyStatus] = useState<string|null>(null)
  const [showSubscribe, setShowSubscribe] = useState(false)
  //selectedCountry is used for SOS handler and emergency-info fallback display
  const selectedCountry: CountryCode = ALL_COUNTRY_CODES.find(c => c.code === 'GB') || ALL_COUNTRY_CODES[0]
  const [userPosition, setUserPosition] = useState<[number,number]|null>(null)
  const [locationDenied, setLocationDenied] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [newsPool, setNewsPool] = useState<NewsItem[]>([])
  const [newsOffset, setNewsOffset] = useState(0)
  const [newsServerPage, setNewsServerPage] = useState(1)
  const [newsTotalPages, setNewsTotalPages] = useState(1)
  const [newsTotal, setNewsTotal] = useState(0)
  const [newsRefreshing, setNewsRefreshing] = useState(false)
  const [newsLastFetched, setNewsLastFetched] = useState<Date | null>(null)
  const newsLoadingRef = useRef(false)
  const tabContentRef = useRef<HTMLDivElement>(null)
  const [newsHazardFilter, setNewsHazardFilter] = useState('all')
  const [onboardingDismissed, setOnboardingDismissed] = useState(() =>
    localStorage.getItem('aegis_onboarding_v1') === 'true'
  )
  const [isOffline, setIsOffline] = useState(!navigator.onLine)
  const [prepExpanded, setPrepExpanded] = useState(false)
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
  const [heroMounted, setHeroMounted] = useState(false)
  const [activeAction, setActiveAction] = useState<string | null>(null)

  //Derive emergency info from region picker (activeLocation) or subscribe modal country
  const emergencyInfo = useMemo<GlobalEmergencyEntry | null>(() => {
    //1. Check explicit city-name mapping
    const cityCode = CITY_TO_COUNTRY[activeLocation]
    if (cityCode) {
      const entry = GLOBAL_EMERGENCY_DB.find(e => e.code === cityCode)
      if (entry) return entry
    }
    //2. Try activeLocation as ISO code directly (COUNTRY_DATA uses lowercase ISO codes)
    const directMatch = GLOBAL_EMERGENCY_DB.find(e => e.code === activeLocation.toUpperCase())
    if (directMatch) return directMatch
    //3. Fallback to subscribe modal's selected country
    return GLOBAL_EMERGENCY_DB.find(e => e.code === selectedCountry.code) || GLOBAL_EMERGENCY_DB.find(e => e.code === 'GB') || null
  }, [activeLocation, selectedCountry.code])

  const activeCountryCode = useMemo(() => {
    const cityCode = CITY_TO_COUNTRY[activeLocation]
    if (cityCode) return cityCode
    if (/^[a-z]{2}$/i.test(activeLocation)) return activeLocation.toUpperCase()
    return selectedCountry.code
  }, [activeLocation, selectedCountry.code])

  const emergencyFallback = useMemo(() => getGlobalEmergencyFallback(activeCountryCode), [activeCountryCode])

  useEffect(() => () => {
    if (sosTimerRef.current) clearInterval(sosTimerRef.current)
  }, [])

  //Redirect authenticated citizens to their dashboard when they land on /citizen
  // (e.g. coming from the LandingPage "Access Citizen Portal" button while signed in)
  useEffect(() => {
    if (isCitizenLoggedIn) {
      navigate('/citizen/dashboard', { replace: true })
    }
  }, [isCitizenLoggedIn, navigate])

  //Offline detection
  useEffect(() => {
    const up = () => setIsOffline(false)
    const dn = () => setIsOffline(true)
    window.addEventListener('online', up)
    window.addEventListener('offline', dn)
    return () => { window.removeEventListener('online', up); window.removeEventListener('offline', dn) }
  }, [])

  //Live clock for hero banner -- 1s tick for live seconds display
  useEffect(() => {
    injectCPAnimations()
    setHeroMounted(true)
    const timer = setInterval(() => setCurrentTime(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  //Handle URL params for deep-linking (e.g. from web push notifications)
  useEffect(() => {
    const tabParam = searchParams.get('tab')
    const alertParam = searchParams.get('alert')
    if (tabParam) {
      const validTabs = ['map', 'reports', 'shelters', 'news']
      if (validTabs.includes(tabParam)) setActiveTab(tabParam)
    }
    if (alertParam) {
      //Fetch the specific alert and show detail modal
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
      //Clean the URL param after handling
      searchParams.delete('alert')
      searchParams.delete('tab')
      setSearchParams(searchParams, { replace: true })
    }
  }, [searchParams, setSearchParams])

  //Derived: slice the pool at the current offset to show one batch
  const newsItems = useMemo(() => newsPool.slice(newsOffset, newsOffset + NEWS_BATCH), [newsPool, newsOffset])
  const hasNextBatchInPool = newsOffset + NEWS_BATCH < newsPool.length
  const hasMoreFromServer = newsServerPage < newsTotalPages

  const loadNews = useCallback(async (forceRefresh = false): Promise<void> => {
    if (newsLoadingRef.current) return
    newsLoadingRef.current = true
    setNewsRefreshing(true)
    try {
      const payload = await apiGetNews(forceRefresh, 1)
      if (Array.isArray(payload?.items) && payload.items.length > 0) {
        setNewsPool(payload.items)
        setNewsOffset(0)
        setNewsServerPage(1)
        setNewsTotalPages(payload.totalPages ?? 1)
        setNewsTotal(payload.total ?? payload.items.length)
        setNewsLastFetched(new Date())
      }
    } catch { /* silent */ } finally {
      setNewsRefreshing(false)
      newsLoadingRef.current = false
    }
  }, [])

  // "Next news" -- advances through pool; fetches next server page when pool runs low; cycles on wrap
  const nextNews = useCallback(async (): Promise<void> => {
    if (newsLoadingRef.current) return
    if (hasNextBatchInPool) {
      setNewsOffset(o => o + NEWS_BATCH)
      return
    }
    if (hasMoreFromServer) {
      newsLoadingRef.current = true
      setNewsRefreshing(true)
      try {
        const next = newsServerPage + 1
        const payload = await apiGetNews(false, next)
        if (Array.isArray(payload?.items) && payload.items.length > 0) {
          setNewsPool(prev => [...prev, ...payload.items])
          setNewsOffset(o => o + NEWS_BATCH)
          setNewsServerPage(next)
          setNewsTotalPages(payload.totalPages ?? 1)
        }
      } catch { /* silent */ } finally {
        setNewsRefreshing(false)
        newsLoadingRef.current = false
      }
      return
    }
    //Wrap around to start and fetch fresh from server
    newsLoadingRef.current = true
    setNewsRefreshing(true)
    try {
      const payload = await apiGetNews(true, 1)
      if (Array.isArray(payload?.items) && payload.items.length > 0) {
        setNewsPool(payload.items)
        setNewsOffset(0)
        setNewsServerPage(1)
        setNewsTotalPages(payload.totalPages ?? 1)
        setNewsTotal(payload.total ?? payload.items.length)
        setNewsLastFetched(new Date())
      }
    } catch { /* silent */ } finally {
      setNewsRefreshing(false)
      newsLoadingRef.current = false
    }
  }, [hasNextBatchInPool, hasMoreFromServer, newsServerPage, NEWS_BATCH])

  useEffect(() => {
    loadNews(false)
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

  //Guest SOS Handler
  const handleGuestSOS = () => {
    if (sosCountdown !== null) {
      //Cancel countdown
      if (sosTimerRef.current) {
        clearInterval(sosTimerRef.current)
        sosTimerRef.current = null
      }
      setSosCountdown(null)
      if (navigator.vibrate) navigator.vibrate(30)
      return
    }
    //Haptic feedback on tap
    if (navigator.vibrate) navigator.vibrate([50, 30, 50])
    //Start 5-second countdown
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
      //Get GPS location
      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        if (!navigator.geolocation) return reject(new Error('No GPS'))
        navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 10000, enableHighAccuracy: true })
      }).catch(() => null)

      const lat = position?.coords.latitude ?? userPosition?.[0] ?? loc.center?.[0] ?? 0
      const lng = position?.coords.longitude ?? userPosition?.[1] ?? loc.center?.[1] ?? 0

      //Reverse geocode for human-readable address
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
      const fullDesc = `GUEST SOS EMERGENCY -- Citizen requires immediate assistance.\n` +
        `Location: ${addressText}\n` +
        `Country: ${countryName}\n` +
        `Time: ${now.toLocaleString()} (${Intl.DateTimeFormat().resolvedOptions().timeZone})\n` +
        `Coordinates: ${lat.toFixed(6)}, ${lng.toFixed(6)}\n` +
        `Emergency Number: ${emergNum}\n` +
        `Activated from AEGIS public safety page.`

      //Submit emergency report via public reports API (field names match server validation)
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
      //Auto-clear after 60 seconds
      setTimeout(() => setSosActive(false), 60000)
    } catch (err: any) {
      console.error('SOS send error:', err)
      if (navigator.vibrate) navigator.vibrate([200, 100, 200])
      const emergNum = emergencyInfo?.emergencyNumber || '112'
      pushNotification(`${t('citizenPage.sosFailed', lang)} -- Please call ${emergNum} directly`, 'error')
      //Still show the SOS active panel so user can call emergency number
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

  //Time-based greeting
  const heroGreeting = useMemo(() => {
    const h = currentTime.getHours()
    if (h < 12) return { text: 'Good Morning', icon: Sun, period: 'morning' }
    if (h < 17) return { text: 'Good Afternoon', icon: CloudRain, period: 'afternoon' }
    return { text: 'Good Evening', icon: Sparkles, period: 'evening' }
  }, [currentTime.getHours()])

  //Threat level
  const criticalCount = alerts.filter((a: any) => a.severity === 'critical' || a.severity === 'high' || a.severity === 'High').length
  const heroThreatLevel = criticalCount > 3 ? 'SEVERE' : criticalCount > 0 ? 'ELEVATED' : alerts.length > 0 ? 'GUARDED' : 'LOW'
  const heroThreatColor = { SEVERE: 'text-red-300', ELEVATED: 'text-orange-300', GUARDED: 'text-amber-300', LOW: 'text-green-300' }[heroThreatLevel]
  const heroThreatBg = { SEVERE: 'bg-red-500/20 border-red-500/30', ELEVATED: 'bg-orange-500/20 border-orange-500/30', GUARDED: 'bg-amber-500/20 border-amber-500/30', LOW: 'bg-green-500/20 border-green-500/30' }[heroThreatLevel]

  //Crowd intelligence: reports in last 24h, last 7d, and last hour
  const reportsLast24h = useMemo(() => {
    const now = Date.now()
    return reports.filter(r => now - new Date(r.timestamp).getTime() < 86400000)
  }, [reports])
  const reportsLast7d = useMemo(() => {
    const now = Date.now()
    return reports.filter(r => now - new Date(r.timestamp).getTime() < 604800000)
  }, [reports])
  const reportsLastHour = useMemo(() => {
    const now = Date.now()
    return reports.filter(r => now - new Date(r.timestamp).getTime() < 3600000)
  }, [reports])

  //Stats trend: compare today vs yesterday same window
  const statsYesterdayTotal = useMemo(() => {
    const now = Date.now()
    return reports.filter(r => {
      const age = now - new Date(r.timestamp).getTime()
      return age > 86400000 && age < 172800000
    }).length
  }, [reports])
  const statsTrendPct = statsYesterdayTotal > 0
    ? Math.round(((stats.total - statsYesterdayTotal) / statsYesterdayTotal) * 100)
    : 0

  //AI hazard risk scores derived from alert severity + report frequency (0-95 cap)
  const hazardRisks = useMemo(() => {
    const score = (keywords: string[]) => {
      let s = 0
      alerts.forEach((a: any) => {
        const txt = ((a.hazardType || a.type || '') + ' ' + (a.title || '')).toLowerCase()
        if (keywords.some(k => txt.includes(k))) s += a.severity === 'critical' ? 30 : a.severity === 'high' ? 20 : 10
      })
      reportsLast24h.forEach((r: any) => {
        const txt = (r.type || '').toLowerCase()
        if (keywords.some(k => txt.includes(k))) s += 5
      })
      return Math.min(95, s)
    }
    return [
      { key: 'flood',         label: 'Flood',         icon: Waves,       pct: score(['flood', 'flooding', 'river', 'storm surge']),                   color: 'bg-blue-500',   emoji: '🌊' },
      { key: 'wildfire',      label: 'Wildfire',      icon: Flame,       pct: score(['wildfire', 'fire', 'bushfire', 'burn']),                        color: 'bg-orange-500', emoji: '🔥' },
      { key: 'environmental', label: 'Environmental', icon: TreePine,    pct: score(['environmental', 'chemical', 'air quality', 'toxic', 'spill']),  color: 'bg-green-500',  emoji: '☣️' },
      { key: 'heatwave',      label: 'Heatwave',      icon: Thermometer, pct: score(['heatwave', 'heat', 'extreme heat']),                            color: 'bg-amber-500',  emoji: '🌡️' },
      { key: 'storm',         label: 'Severe Storm',  icon: CloudRain,   pct: score(['storm', 'severe_storm', 'cyclone', 'hurricane', 'typhoon']),   color: 'bg-purple-500', emoji: '⛈️' },
      { key: 'landslide',     label: 'Landslide',     icon: Mountain,    pct: score(['landslide', 'mudslide', 'debris flow', 'rockfall']),            color: 'bg-stone-600',  emoji: '⛰️' },
      { key: 'public_safety', label: 'Public Safety', icon: Shield,      pct: score(['public safety', 'civil unrest', 'security', 'incident']),      color: 'bg-rose-500',   emoji: '🚨' },
      { key: 'infrastructure',label: 'Infra. Damage', icon: Building2,   pct: score(['infrastructure', 'bridge', 'structural', 'sinkhole', 'road']), color: 'bg-slate-500',  emoji: '🏗️' },
      { key: 'water_supply',  label: 'Water Supply',  icon: Droplets,    pct: score(['water', 'contamination', 'water supply', 'boil water']),       color: 'bg-cyan-500',   emoji: '💧' },
      { key: 'drought',       label: 'Drought',       icon: Sun,         pct: score(['drought', 'dry', 'water shortage']),                           color: 'bg-yellow-500', emoji: '☀️' },
      { key: 'power_outage',  label: 'Power Outage',  icon: Zap,         pct: score(['power outage', 'blackout', 'electricity', 'grid failure']),    color: 'bg-yellow-400', emoji: '⚡' },
    ]
  }, [alerts, reportsLast24h])

  //Connected users estimate: seeded from real activity signals
  const connectedUsers = useMemo(() =>
    Math.max(48, alerts.length * 12 + reports.length * 2 + 120), [alerts.length, reports.length])

  //News filtered by hazard type
  const filteredNewsItems = useMemo(() => {
    if (newsHazardFilter === 'all') return newsItems
    const KWMAP: Record<string, string[]> = {
      flood:      ['flood', 'flooding', 'river', 'surge', 'inundation'],
      earthquake: ['earthquake', 'quake', 'seismic', 'tremor', 'magnitude'],
      storm:      ['storm', 'hurricane', 'cyclone', 'tornado', 'typhoon', 'wind'],
      wildfire:   ['wildfire', 'fire', 'blaze', 'bushfire', 'burn'],
      drought:    ['drought', 'heatwave', 'heat wave', 'dry', 'arid'],
    }
    const kws = KWMAP[newsHazardFilter] || []
    return newsItems.filter(n => kws.some(k => (n.title + ' ' + n.source).toLowerCase().includes(k)))
  }, [newsItems, newsHazardFilter])

  //Activity timeline: prefer 24h data, fall back to 7d if empty
  const timeline24h = useMemo(() => {
    const source = reportsLast24h.length > 0 ? reportsLast24h : reportsLast7d
    return [...source]
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, 6)
  }, [reportsLast24h, reportsLast7d])
  const timelineLabel = reportsLast24h.length > 0 ? 'LAST 24H' : reportsLast7d.length > 0 ? 'LAST 7 DAYS' : 'ALL TIME'

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
        <title>AEGIS Report ${report.reportNumber || report.id}</title>
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
          <div class="report-id">${t('cdash.print.reportId', lang)}: ${report.reportNumber || report.id}</div>
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

    //Try native Web Share API first
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
      //Fallback: Copy to clipboard and show mailto option
      const reportText = `${shareData.title}\n\n${shareData.text}\n\nView on AEGIS: ${shareData.url}`
      try {
        await navigator.clipboard.writeText(reportText)
        pushNotification(t('citizenPage.copiedToClipboard', lang), 'success')
        
        //Also offer email option
        const mailtoLink = `mailto:?subject=${encodeURIComponent(shareData.title)}&body=${encodeURIComponent(reportText)}`
        window.open(mailtoLink, '_blank')
      } catch {
        pushNotification(t('citizenPage.unableToShare', lang), 'warning')
      }
    }
  }

  const TABS = [
    { id: 'map',      label: t('citizenPage.tab.disasterMap', lang),   icon: MapPin,     badge: 0 },
    { id: 'alerts',   label: t('alerts.pageTitle', lang) || 'Alerts',   icon: Bell,       badge: stats.alertCount },
    { id: 'reports',  label: t('citizenPage.tab.recentReports', lang),  icon: FileText,   badge: stats.urgent },
    { id: 'shelters', label: t('citizenPage.tab.safeZones', lang),      icon: Home,       badge: 0 },
    { id: 'news',     label: t('citizen.tab.news', lang),               icon: Newspaper,  badge: newsPool.length },
    { id: 'prepare',  label: 'Prepare',                                 icon: ShieldCheck, badge: 0 },
  ]

  const scrollToTabContent = () => {
    setTimeout(() => {
      tabContentRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 80)
  }

  const handleSidebarNav = (item: SidebarItem) => {
    if (item.key === 'report_emergency') { setShowReport(true); return }
    if (item.key === 'community') { setShowCommunity(true); return }
    if (item.key === 'home') { navigate('/citizen/dashboard'); return }
    if (item.key === 'alerts') { setActiveTab('alerts'); scrollToTabContent(); return }
    const validTabs = ['map', 'alerts', 'reports', 'shelters', 'news', 'prepare']
    if (validTabs.includes(item.key)) { setActiveTab(item.key); scrollToTabContent(); return }
    const dashboardTabs = ['risk', 'emergency', 'prepare', 'messages', 'safety', 'profile', 'settings']
    if (dashboardTabs.includes(item.key)) { navigate(`/citizen/dashboard?tab=${item.key}`); return }
  }

  return (
    <AppLayout activeKey={activeTab} onNavigate={handleSidebarNav}>

      <div className={`space-y-3 sm:space-y-4 md:space-y-6 ${isRtl(lang)?'rtl':'ltr'}`} dir={isRtl(lang)?'rtl':'ltr'}>
        {/* COMMAND HQ HERO -- AEGIS Blue Theme */}
        <div className={`relative overflow-hidden rounded-2xl shadow-2xl shadow-aegis-600/30 ring-1 ring-white/10 transition-opacity duration-500 ${heroMounted ? 'opacity-100' : 'opacity-0'}`}>
          <div className={`absolute inset-0 ${
            heroThreatLevel === 'SEVERE' ? 'bg-gradient-to-r from-red-900 via-aegis-800 to-red-900'
            : heroThreatLevel === 'ELEVATED' ? 'bg-gradient-to-r from-orange-900 via-aegis-800 to-orange-900'
            : 'bg-gradient-to-br from-aegis-700 via-aegis-600 to-blue-700 dark:from-gray-950 dark:via-aegis-950 dark:to-blue-950'
          } cp-gradient`} />
          {/* Hex overlay */}
          <div className="absolute inset-0 opacity-[0.04]">
            <svg width="100%" height="100%"><defs><pattern id="cmdHex" x="0" y="0" width="24" height="24" patternUnits="userSpaceOnUse"><polygon points="12,2 22,8 22,16 12,22 2,16 2,8" fill="none" stroke="white" strokeWidth="0.3"/></pattern></defs><rect width="100%" height="100%" fill="url(#cmdHex)"/></svg>
          </div>
          {/* Floating orbs */}
          <div className="absolute -top-20 -right-20 w-72 h-72 bg-white/[0.06] rounded-full blur-[80px] cp-float" />
          <div className="absolute -bottom-16 -left-16 w-48 h-48 bg-blue-400/[0.06] rounded-full blur-[60px] cp-float2" />
          {/* Animated scanline */}
          <div className="absolute inset-0 overflow-hidden pointer-events-none">
            <div className="w-full h-8 bg-gradient-to-b from-white/[0.03] to-transparent cp-scanline" />
          </div>

          <div className="relative z-10 px-6 py-5 sm:px-8 sm:py-6 text-white">
            {/* Top bar */}
            <div className="flex items-center justify-between gap-4 mb-4 cp-fade-up">
              <div className="flex items-center gap-3">
                <div className="relative">
                  <div className="w-12 h-12 rounded-xl bg-white/15 border border-white/20 flex items-center justify-center cp-pulse-glow">
                    <Shield className="w-6 h-6 text-white" />
                  </div>
                  <div className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-green-500 border-2 border-aegis-700 animate-pulse" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h1 className="text-xl sm:text-2xl font-black text-white tracking-[0.15em] uppercase">AEGIS</h1>
                    <span className="text-[8px] font-black text-aegis-200 bg-white/15 border border-white/20 px-2 py-0.5 rounded uppercase tracking-widest">COMMAND</span>
                  </div>
                  <p className="text-[10px] font-mono text-white/50 uppercase tracking-[0.15em]">EMERGENCY OPERATIONS CENTER</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div className="hidden sm:flex items-center gap-1.5 bg-white/[0.06] border border-white/[0.07] px-2.5 py-1.5 rounded-lg">
                  <Clock className="w-3 h-3 text-white/50" />
                  <span className="text-[10px] font-mono font-bold text-white/80 tabular-nums">{currentTime.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
                  <span className="text-[9px] text-white/35 hidden md:inline">{currentTime.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}</span>
                </div>
                <div className="flex items-center gap-1 bg-green-500/15 border border-green-500/15 px-2 py-1.5 rounded-lg">
                  <span className="relative flex h-1.5 w-1.5"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"/><span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-green-400"/></span>
                  <span className="text-[10px] font-bold text-green-300">LIVE</span>
                </div>
                <div className="hidden sm:flex items-center gap-1 bg-white/[0.06] border border-white/[0.07] px-2.5 py-1.5 rounded-lg">
                  <Users className="w-3 h-3 text-white/50" />
                  <span className="text-[10px] font-bold text-white/70">{connectedUsers.toLocaleString()}</span>
                </div>
                <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border backdrop-blur-sm flex-shrink-0 ${heroThreatBg}`}>
                  <Siren className={`w-3.5 h-3.5 ${heroThreatColor} ${heroThreatLevel === 'SEVERE' ? 'animate-pulse' : ''}`} />
                  <div>
                    <span className={`text-[10px] font-black uppercase tracking-wider ${heroThreatColor}`}>{heroThreatLevel}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Greeting + monitoring typing animation */}
            <div className="mb-3 cp-fade-up" style={{ animationDelay: '0.05s' }}>
              <div className="flex items-center gap-2 mb-0.5">
                <heroGreeting.icon className="w-3.5 h-3.5 text-white/70" />
                <span className="text-sm font-semibold text-white/90">{heroGreeting.text}</span>
                <span className="text-xs text-white/50">-- stay safe, stay informed</span>
              </div>
              <div className="flex items-center gap-1.5 text-[10px] font-mono text-aegis-200/80">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse flex-shrink-0" />
                <HeroTypingText texts={['MONITORING GLOBAL THREATS...', 'ANALYZING INCIDENT FEEDS...', 'PROCESSING CROWD INTELLIGENCE...', 'SCANNING EMERGENCY CHANNELS...', 'CROSS-REFERENCING HAZARD DATA...']} />
              </div>
            </div>

            {/* Quick actions row */}
            <div className="flex items-center gap-2 flex-wrap cp-fade-up" style={{ animationDelay: '0.1s' }}>
              <button onClick={()=>setShowReport(true)} className="group relative bg-white/20 hover:bg-white/30 border border-white/20 px-4 py-2 rounded-lg text-xs font-black text-white uppercase tracking-wider flex items-center gap-2 transition-all hover:scale-[1.02] active:scale-[0.98] overflow-hidden">
                <div className="absolute inset-0 cp-shimmer" />
                <AlertTriangle className="w-3.5 h-3.5 relative z-10"/> <span className="relative z-10">{t('report.title', lang)}</span>
              </button>
              <button onClick={()=>setActiveTab('map')} className="bg-white/10 hover:bg-white/20 border border-white/10 px-4 py-2 rounded-lg text-xs font-black text-white/80 uppercase tracking-wider flex items-center gap-2 transition-all hover:scale-[1.02] active:scale-[0.98]">
                <Satellite className="w-3.5 h-3.5"/> {t('map.title', lang) || 'Map'}
              </button>
              <a href={`tel:${emergencyInfo?.emergencyNumber || '999'}`} className="bg-red-500/20 hover:bg-red-500/30 border border-red-500/25 px-3 py-2 rounded-lg text-xs font-black text-red-200 uppercase tracking-wider flex items-center gap-2 transition-all hover:scale-[1.02] active:scale-[0.98]">
                <PhoneCall className="w-3.5 h-3.5 text-red-300"/> SOS {emergencyInfo?.emergencyNumber || '999'}
              </a>
              <button onClick={toggle} className="ml-auto bg-white/10 hover:bg-white/20 border border-white/10 p-2 rounded-lg transition-all">
                {dark ? <Sun className="w-3.5 h-3.5 text-white/60" /> : <Moon className="w-3.5 h-3.5 text-white/60" />}
              </button>
            </div>
          </div>
        </div>

        {/* OFFLINE BANNER */}
        {isOffline && (
          <div className="flex items-center gap-3 bg-gray-900 dark:bg-gray-950 border border-gray-700 rounded-2xl px-4 py-3 animate-fade-in">
            <Wifi className="w-4 h-4 text-gray-400 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-white">You are offline</p>
              <p className="text-xs text-gray-400">Showing cached data. Some features may be unavailable.</p>
            </div>
            <span className="text-[10px] font-bold text-gray-500 bg-gray-800 px-2 py-1 rounded-lg">CACHED</span>
          </div>
        )}

        {/* FIRST-TIME ONBOARDING BANNER */}
        {!onboardingDismissed && (
          <div className="relative overflow-hidden rounded-2xl border border-aegis-200/60 dark:border-aegis-800/40 bg-gradient-to-r from-aegis-50 via-white to-blue-50 dark:from-aegis-950/30 dark:via-gray-900 dark:to-blue-950/20 p-4 animate-fade-in">
            <button
              onClick={() => { setOnboardingDismissed(true); localStorage.setItem('aegis_onboarding_v1', 'true') }}
              className="absolute top-3 right-3 w-6 h-6 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
            ><X className="w-3.5 h-3.5 text-gray-500" /></button>
            <div className="flex items-start gap-3 pr-8">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-aegis-400 to-aegis-600 flex items-center justify-center flex-shrink-0 shadow-lg">
                <Shield className="w-4.5 h-4.5 text-white" />
              </div>
              <div>
                <p className="font-bold text-sm text-gray-900 dark:text-white mb-2">Welcome to AEGIS -- 3 steps to stay safe</p>
                <div className="flex flex-wrap gap-3">
                  {[
                    { n: '1', icon: MapPin, text: 'Check the Disaster Map for incidents near you' },
                    { n: '2', icon: Bell, text: 'Subscribe to Alerts to get notified instantly' },
                    { n: '3', icon: AlertTriangle, text: 'Report an Emergency if you witness an incident' },
                  ].map(step => (
                    <div key={step.n} className="flex items-center gap-2 bg-white/70 dark:bg-gray-800/60 border border-gray-200/60 dark:border-gray-700/60 rounded-xl px-3 py-2">
                      <div className="w-5 h-5 rounded-full bg-aegis-600 flex items-center justify-center flex-shrink-0">
                        <span className="text-[9px] font-black text-white">{step.n}</span>
                      </div>
                      <step.icon className="w-3.5 h-3.5 text-aegis-600 flex-shrink-0" />
                      <span className="text-[11px] text-gray-700 dark:text-gray-300 font-medium">{step.text}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* SITUATIONAL OVERVIEW PANEL */}
        <div className="glass-card rounded-2xl border border-gray-200/60 dark:border-gray-700/60 overflow-hidden cp-fade-up" style={{ animationDelay: '0.1s' }}>
          <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-200/60 dark:border-gray-700/40 bg-gray-50/50 dark:bg-gray-800/20">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-aegis-500 to-blue-600 flex items-center justify-center shadow-md flex-shrink-0">
              <BarChart3 className="w-3.5 h-3.5 text-white" />
            </div>
            <span className="text-xs font-black text-gray-900 dark:text-white uppercase tracking-wider">SITUATIONAL OVERVIEW</span>
            <span className="ml-auto flex items-center gap-1.5 text-[9px] font-bold text-green-600 dark:text-green-400">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse inline-block" />LIVE
            </span>
          </div>
          <div className="p-3">
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
              {[
                { label: t('stats.total', lang),       value: stats.total,      hexColor: '#2563eb', border: 'border-blue-200 dark:border-blue-500/30',    iconBg: 'from-blue-500 to-blue-700',     cardBg: 'bg-blue-50 dark:bg-blue-950/20',     icon: FileText,      trendPct: statsTrendPct },
                { label: t('stats.urgent', lang),       value: stats.urgent,     hexColor: '#dc2626', border: 'border-red-200 dark:border-red-500/30',     iconBg: 'from-red-500 to-red-700',       cardBg: 'bg-red-50 dark:bg-red-950/20',       icon: AlertTriangle },
                { label: t('citizen.stats.highSeverity', lang), value: stats.high, hexColor: '#ea580c', border: 'border-orange-200 dark:border-orange-500/30', iconBg: 'from-orange-500 to-orange-700', cardBg: 'bg-orange-50 dark:bg-orange-950/20', icon: Flame },
                { label: t('stats.verified', lang),     value: stats.verified,   hexColor: '#16a34a', border: 'border-green-200 dark:border-green-500/30',   iconBg: 'from-green-500 to-green-700',   cardBg: 'bg-green-50 dark:bg-green-950/20',   icon: CheckCircle },
                { label: t('stats.activeAlerts', lang), value: stats.alertCount, hexColor: '#9333ea', border: 'border-purple-200 dark:border-purple-500/30',  iconBg: 'from-purple-500 to-purple-700', cardBg: 'bg-purple-50 dark:bg-purple-950/20', icon: Bell },
              ].map((s, i) => (
                <div key={i} className={`border ${s.border} ${(s as any).cardBg} rounded-xl p-3 text-center hover:shadow-md transition-all group`}>
                  <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${s.iconBg} flex items-center justify-center shadow-md group-hover:scale-110 transition-transform duration-300 mx-auto mb-2`}>
                    <s.icon className="w-4 h-4 text-white" />
                  </div>
                  <CPAnimatedCounter value={s.value} className="text-2xl sm:text-3xl font-black font-mono tracking-tight" style={{ color: s.hexColor }} />
                  {(s as any).trendPct !== undefined && (s as any).trendPct !== 0 && (
                    <span className={`text-[9px] font-mono font-bold block ${(s as any).trendPct > 0 ? 'text-red-500' : 'text-green-500'}`}>
                      {(s as any).trendPct > 0 ? '▲' : '▼'} {Math.abs((s as any).trendPct)}%
                    </span>
                  )}
                  <p className="text-[8px] font-bold text-gray-500 dark:text-gray-400 mt-1 uppercase tracking-[0.15em]">{s.label}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* LIVE ALERT TICKER -- below Situational Overview */}
        {alerts.length > 0 && (
          <div className="glass-card border border-red-200/60 dark:border-red-500/20 rounded-2xl overflow-hidden cp-fade-up" style={{ animationDelay: '0.12s' }}>
            <div className="flex items-center">
              <div className="flex-shrink-0 bg-red-600 px-3 py-2.5 flex items-center gap-2 border-r border-red-500/20">
                <Radio className="w-3.5 h-3.5 text-white animate-pulse" />
                <span className="text-[9px] font-black text-white uppercase tracking-[0.15em]">LIVE</span>
              </div>
              <div className="flex-1 overflow-hidden py-2.5 px-4 bg-red-50/50 dark:bg-red-950/10">
                <div className="flex gap-10 whitespace-nowrap" style={{ animation: 'marquee 30s linear infinite' }}>
                  {[...alerts, ...alerts].map((a: any, i: number) => (
                    <span key={i} className="inline-flex items-center gap-2 text-[11px] font-semibold text-red-800 dark:text-red-200 flex-shrink-0">
                      <span className={`w-1.5 h-1.5 rounded-full ${a.severity === 'critical' ? 'bg-red-500 animate-pulse' : 'bg-amber-400'}`}/>
                      {a.title || a.type || 'Alert'} - {a.location || a.locationText || ''}
                      <span className="text-red-300 dark:text-red-600 mx-1">|</span>
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* INTELLIGENCE BRIEFING PANEL */}
        <div className="glass-card rounded-2xl border border-gray-200/60 dark:border-gray-700/60 overflow-hidden cp-fade-up" style={{ animationDelay: '0.15s' }}>
          <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-200/60 dark:border-gray-700/40 bg-gradient-to-r from-gray-50/80 via-aegis-50/30 to-blue-50/20 dark:from-gray-800/40 dark:via-aegis-950/20 dark:to-blue-950/10">
            <div className="relative w-7 h-7 rounded-lg bg-gradient-to-br from-aegis-500 to-blue-600 flex items-center justify-center shadow-md flex-shrink-0">
              <ScanEye className="w-3.5 h-3.5 text-white" />
              <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-green-400 border border-white dark:border-gray-900 animate-pulse" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-black text-gray-900 dark:text-white uppercase tracking-wider">INTELLIGENCE BRIEFING</span>
                <span className="text-[8px] font-black text-aegis-600 dark:text-aegis-400 bg-aegis-50 dark:bg-aegis-950/30 px-2 py-0.5 rounded border border-aegis-200 dark:border-aegis-800/50 flex items-center gap-1">
                  <span className="w-1 h-1 rounded-full bg-aegis-500 animate-pulse inline-block" />AI POWERED
                </span>
              </div>
              <p className="text-[9px] text-gray-400 dark:text-gray-500 font-mono hidden sm:block mt-0.5">Real-time threat analysis - 6 hazard types - crowd-sourced intel</p>
            </div>
            <div className="flex items-center gap-1.5 text-[9px] font-bold text-gray-500 dark:text-gray-400 flex-shrink-0">
              <Clock className="w-3 h-3" />
              <span>{timelineLabel}</span>
            </div>
          </div>
          <div className="p-2 sm:p-3 grid grid-cols-1 md:grid-cols-2 gap-2 sm:gap-3">
            {/* HAZARD ASSESSMENT -- interactive flip card */}
            <div className="rounded-xl border border-gray-200/70 dark:border-gray-700/50 bg-white/60 dark:bg-gray-800/30 p-3 flex flex-col gap-2.5">

              {/* Header */}
              <div className="flex items-center gap-2 pb-2 border-b border-gray-100 dark:border-gray-700/40">
                <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-aegis-500 to-blue-600 flex items-center justify-center shadow-sm flex-shrink-0">
                  <ScanEye className="w-3 h-3 text-white" />
                </div>
                <span className="text-[10px] font-black text-gray-700 dark:text-gray-200 uppercase tracking-wider">HAZARD ASSESSMENT</span>
                <span className="ml-auto text-[8px] text-gray-400 dark:text-gray-600 italic font-medium">tap card to flip</span>
              </div>

              {/* Flip card */}
              {(() => {
                const h = hazardRisks[activeHazardIdx]
                if (!h) return null
                const meta = HAZARD_META[h.key]
                if (!meta) return null
                const HazardIcon = h.icon
                const riskLabel = h.pct > 75 ? 'CRITICAL' : h.pct > 50 ? 'HIGH' : h.pct > 25 ? 'MODERATE' : h.pct > 0 ? 'LOW' : 'MINIMAL'
                const riskTextColor = h.pct > 75 ? 'text-red-500' : h.pct > 50 ? 'text-orange-500' : h.pct > 25 ? 'text-amber-600' : 'text-green-600'
                const riskBadge = h.pct > 75
                  ? 'text-red-600 bg-red-50 dark:bg-red-900/30 border-red-200 dark:border-red-700/40'
                  : h.pct > 50
                    ? 'text-orange-500 bg-orange-50 dark:bg-orange-900/30 border-orange-200 dark:border-orange-700/40'
                    : h.pct > 25
                      ? 'text-amber-600 bg-amber-50 dark:bg-amber-900/30 border-amber-200 dark:border-amber-700/40'
                      : 'text-green-600 bg-green-50 dark:bg-green-900/30 border-green-200 dark:border-green-700/40'
                return (
                  <div
                    className="relative cursor-pointer select-none"
                    style={{ perspective: '900px', height: '260px' }}
                    onClick={() => setHazardFlipped(f => !f)}
                  >
                    <div
                      className="absolute inset-0 transition-transform duration-500 ease-in-out"
                      style={{ transformStyle: 'preserve-3d', transform: hazardFlipped ? 'rotateY(180deg)' : 'rotateY(0deg)' }}
                    >
                      {/* FRONT -- risk overview */}
                      <div
                        className={`absolute inset-0 rounded-xl border ${meta.border} ${meta.bgFill} p-3 flex flex-col`}
                        style={{ backfaceVisibility: 'hidden' }}
                      >
                        <div className="flex items-start gap-3 mb-2.5">
                          <HazardIcon className="w-8 h-8 flex-shrink-0 mt-0.5" />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="text-sm font-black text-gray-900 dark:text-white">{h.label}</p>
                              <span className={`text-[8px] font-black px-1.5 py-0.5 rounded border ${riskBadge}`}>{riskLabel}</span>
                            </div>
                            <p className="text-[9px] text-gray-500 dark:text-gray-400 mt-0.5 leading-snug line-clamp-2">{meta.description}</p>
                          </div>
                          <div className="text-right flex-shrink-0">
                            <p className={`text-2xl font-black tabular-nums leading-none ${riskTextColor}`}>{h.pct > 0 ? `${h.pct}%` : '--'}</p>
                            <p className="text-[8px] text-gray-400 font-medium">risk index</p>
                          </div>
                        </div>
                        <div className="h-3 bg-gray-100 dark:bg-gray-800/60 rounded-full overflow-hidden mb-2.5">
                          <div
                            className={`h-full rounded-full bg-gradient-to-r ${meta.gradient} transition-all duration-1000`}
                            style={{ width: `${Math.max(h.pct, 4)}%` }}
                          />
                        </div>
                        <div className="flex flex-wrap gap-1 mt-auto">
                          {meta.watch.slice(0, 2).map((w, wi) => (
                            <span key={wi} className="text-[8px] font-medium px-1.5 py-0.5 rounded bg-white/60 dark:bg-gray-900/40 border border-gray-200 dark:border-gray-700/40 text-gray-500 dark:text-gray-400 flex items-center gap-1 max-w-[160px] truncate"><Eye className="w-2.5 h-2.5 flex-shrink-0" />{w}</span>
                          ))}
                        </div>
                        <p className="text-[8px] text-gray-400 dark:text-gray-600 mt-1.5 font-medium flex items-center justify-end gap-0.5">Tap for safety guide <ChevronRight className="w-3 h-3" /></p>
                      </div>

                      {/* BACK -- safety guide (scrollable) */}
                      <div
                        className={`absolute inset-0 rounded-xl border ${meta.border} ${meta.bgFill} p-3 flex flex-col`}
                        style={{ backfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}
                      >
                        <div className="flex items-center gap-1.5 mb-2 pb-1.5 border-b border-gray-200/60 dark:border-gray-700/40 flex-shrink-0">
                          <span className="text-base">{h.emoji}</span>
                          <p className="text-[9px] font-black text-gray-700 dark:text-gray-200 uppercase tracking-wider">{h.label} -- SAFETY GUIDE</p>
 <span className="ml-auto text-[7px] text-gray-400 italic">scroll v</span>
                        </div>
                        <div className="flex-1 overflow-y-auto space-y-2 pr-0.5" style={{ scrollbarWidth: 'thin' }}>
                          <div>
                            <p className="text-[7px] font-black text-gray-400 uppercase tracking-widest mb-1.5 flex items-center gap-1"><CheckCircle className="w-2.5 h-2.5 text-green-500 flex-shrink-0" /> What to do</p>
                            {meta.tips.map((tip, ti) => (
                              <div key={ti} className="flex items-start gap-1.5 mb-1.5">
                                <span className="w-3.5 h-3.5 rounded-full bg-green-100 dark:bg-green-900/40 flex items-center justify-center flex-shrink-0 mt-0.5">
                                  <span className="text-[7px] font-black text-green-600"></span>
                                </span>
                                <p className="text-[9px] text-gray-700 dark:text-gray-300 leading-snug">{tip}</p>
                              </div>
                            ))}
                          </div>
                          <div className="pt-1 border-t border-gray-200/60 dark:border-gray-700/40">
                            <p className="text-[7px] font-black text-gray-400 uppercase tracking-widest mb-1.5 flex items-center gap-1"><Eye className="w-2.5 h-2.5 text-amber-500 flex-shrink-0" /> Watch for</p>
                            {meta.watch.map((w, wi) => (
                              <div key={wi} className="flex items-start gap-1.5 mb-1.5">
                                <span className="w-3.5 h-3.5 rounded-full bg-amber-100 dark:bg-amber-900/40 flex items-center justify-center flex-shrink-0 mt-0.5">
                                  <span className="text-[7px] font-black text-amber-600">!</span>
                                </span>
                                <p className="text-[9px] text-gray-700 dark:text-gray-300 leading-snug">{w}</p>
                              </div>
                            ))}
                          </div>
                          <div className="pt-1 border-t border-gray-200/60 dark:border-gray-700/40">
                            <p className="text-[7px] font-black text-gray-400 uppercase tracking-widest mb-1.5 flex items-center gap-1"><MapPin className="w-2.5 h-2.5 text-blue-500 flex-shrink-0" /> At-risk zones</p>
                            <div className="flex flex-wrap gap-1">
                              {meta.zones.map((z, zi) => (
                                <span key={zi} className="text-[8px] font-medium px-1.5 py-0.5 rounded bg-white/70 dark:bg-gray-900/40 border border-gray-200 dark:border-gray-700/40 text-gray-600 dark:text-gray-400">{z}</span>
                              ))}
                            </div>
                          </div>
                        </div>
                        <p className="text-[8px] text-gray-400 dark:text-gray-600 mt-1.5 font-medium flex-shrink-0 flex items-center gap-0.5"><ChevronLeft className="w-3 h-3" /> Tap to go back</p>
                      </div>
                    </div>
                  </div>
                )
              })()}

              {/* Bottom navigation -- prev / hazard name + counter / next */}
              <div className="flex items-center justify-between pt-1.5 border-t border-gray-100 dark:border-gray-700/40">
                <button
                  onClick={() => { setActiveHazardIdx(idx => (idx - 1 + hazardRisks.length) % hazardRisks.length); setHazardFlipped(false) }}
                  className="flex items-center gap-1 text-[9px] font-bold text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 px-2.5 py-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700/40 transition-colors"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>
                <div className="flex items-center gap-2">
                  {hazardRisks[activeHazardIdx] && (
                    <>
                      {(() => { const NavIcon = hazardRisks[activeHazardIdx].icon; return <NavIcon className="w-4 h-4 text-gray-600 dark:text-gray-300 flex-shrink-0" /> })()}
                      <div className="text-center">
                        <p className="text-[10px] font-black text-gray-800 dark:text-gray-100 leading-none">{hazardRisks[activeHazardIdx].label}</p>
                        <p className="text-[8px] text-gray-400 tabular-nums">{activeHazardIdx + 1} / {hazardRisks.length}</p>
                      </div>
                      {hazardRisks[activeHazardIdx].pct > 0 && (
                        <span className={`text-[8px] font-black px-1.5 py-0.5 rounded border ${
                          hazardRisks[activeHazardIdx].pct > 75 ? 'text-red-600 bg-red-50 dark:bg-red-900/30 border-red-200' :
                          hazardRisks[activeHazardIdx].pct > 50 ? 'text-orange-500 bg-orange-50 dark:bg-orange-900/30 border-orange-200' :
                          hazardRisks[activeHazardIdx].pct > 25 ? 'text-amber-600 bg-amber-50 dark:bg-amber-900/30 border-amber-200' :
                          'text-green-600 bg-green-50 dark:bg-green-900/30 border-green-200'
                        }`}>{hazardRisks[activeHazardIdx].pct}%</span>
                      )}
                    </>
                  )}
                </div>
                <button
                  onClick={() => { setActiveHazardIdx(idx => (idx + 1) % hazardRisks.length); setHazardFlipped(false) }}
                  className="flex items-center gap-1 text-[9px] font-bold text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 px-2.5 py-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700/40 transition-colors"
                >
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>

            </div>

            {/* CROWD INTEL -- Advanced Redesign */}
            <div className="rounded-xl border border-teal-200/70 dark:border-teal-700/40 bg-gradient-to-b from-teal-50/40 to-white/60 dark:from-teal-950/20 dark:to-gray-800/30 p-3 flex flex-col gap-2.5">

              {/* Header */}
              <div className="flex items-center justify-between pb-2 border-b border-teal-100 dark:border-teal-800/40">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-teal-500 to-emerald-600 flex items-center justify-center shadow-sm flex-shrink-0">
                    <Activity className="w-3 h-3 text-white" />
                  </div>
                  <span className="text-[10px] font-black text-gray-700 dark:text-gray-200 uppercase tracking-wider">CROWD INTEL</span>
                  {reportsLastHour.length > 0 && (
                    <span className="text-[8px] font-black text-teal-600 dark:text-teal-400 bg-teal-50 dark:bg-teal-900/40 border border-teal-200 dark:border-teal-700/60 px-1.5 py-0.5 rounded-full animate-pulse">LIVE</span>
                  )}
                </div>
                <div className="flex items-center gap-1 bg-teal-50 dark:bg-teal-950/30 border border-teal-200/50 dark:border-teal-800/50 px-2 py-1 rounded-lg">
                  <Users className="w-3 h-3 text-teal-500" />
                  <span className="text-[9px] font-bold text-teal-600 dark:text-teal-400 tabular-nums">{connectedUsers.toLocaleString()}</span>
                </div>
              </div>

              {/* Community Activity Meter */}
              {(() => {
                const actPct = Math.min(100, Math.round((reportsLast7d.length / 20) * 100))
                const actLabel = actPct > 75 ? 'SURGE' : actPct > 50 ? 'ELEVATED' : actPct > 20 ? 'MODERATE' : 'QUIET'
                const actBar = actPct > 75
                  ? 'bg-gradient-to-r from-red-500 to-red-600'
                  : actPct > 50
                    ? 'bg-gradient-to-r from-amber-400 to-orange-500'
                    : actPct > 20
                      ? 'bg-gradient-to-r from-teal-400 to-emerald-500'
                      : 'bg-gradient-to-r from-green-400 to-green-500'
                const actTextColor = actPct > 75 ? 'text-red-600 dark:text-red-400' : actPct > 50 ? 'text-amber-600 dark:text-amber-400' : actPct > 20 ? 'text-teal-600 dark:text-teal-400' : 'text-green-600 dark:text-green-400'
                return (
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[8px] font-black text-gray-400 uppercase tracking-widest">COMMUNITY ACTIVITY</span>
                      <span className={`text-[8px] font-black ${actTextColor}`}>{actLabel} - {actPct}%</span>
                    </div>
                    <div className="h-2.5 bg-gray-100 dark:bg-gray-800/60 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full transition-all duration-1000 ${actBar}`} style={{ width: `${Math.max(actPct, 4)}%` }} />
                    </div>
                    <div className="flex justify-between mt-0.5">
                      <span className="text-[8px] text-gray-400 font-mono tabular-nums">{reportsLastHour.length} /hr</span>
                      <span className="text-[8px] text-gray-400 font-mono tabular-nums">{reportsLast7d.length} this week</span>
                    </div>
                  </div>
                )
              })()}

              {/* Incident Feed */}
              <div className="flex-1">
                {timeline24h.length > 0 ? (
                  <div>
                    <p className="text-[8px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-1.5">
                      {timelineLabel} - {timeline24h.length} incident{timeline24h.length !== 1 ? 's' : ''}
                    </p>
                    <div className="space-y-0.5">
                      {timeline24h.slice(0, 4).map((r: any, idx: number) => {
                        const ageMs = Date.now() - new Date(r.timestamp).getTime()
                        const ageD = Math.floor(ageMs / 86400000)
                        const ageH = Math.floor(ageMs / 3600000)
                        const ageM = Math.floor((ageMs % 3600000) / 60000)
                        const ago = ageD > 0 ? `${ageD}d ago` : ageH > 0 ? `${ageH}h ago` : `${ageM}m ago`
                        const sev = (r.severity || 'low').toLowerCase()
                        const leftBar = sev === 'critical' ? 'bg-red-500' : sev === 'high' ? 'bg-orange-500' : sev === 'medium' ? 'bg-amber-400' : 'bg-blue-400'
                        const sevChip = sev === 'critical'
                          ? 'bg-red-100 dark:bg-red-500/20 text-red-600 dark:text-red-400'
                          : sev === 'high'
                            ? 'bg-orange-100 dark:bg-orange-500/20 text-orange-600 dark:text-orange-400'
                            : sev === 'medium'
                              ? 'bg-amber-100 dark:bg-amber-500/20 text-amber-600 dark:text-amber-400'
                              : 'bg-blue-50 dark:bg-blue-500/15 text-blue-600 dark:text-blue-400'
                        return (
                          <div key={idx} className="flex items-center gap-2 py-1.5 rounded-lg hover:bg-teal-50/60 dark:hover:bg-teal-950/15 transition-colors px-1">
                            <div className={`w-0.5 h-8 rounded-full flex-shrink-0 ${leftBar}`} />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1 mb-0.5">
                                <span className={`text-[7px] font-black px-1 py-0.5 rounded ${sevChip}`}>{sev.toUpperCase().slice(0, 4)}</span>
                                <span className="text-[9px] font-bold text-gray-700 dark:text-gray-200 truncate">{r.type || 'Incident'}</span>
                              </div>
                              <div className="flex items-center gap-1">
                                <MapPin className="w-2.5 h-2.5 text-gray-400 flex-shrink-0" />
                                <span className="text-[9px] text-gray-500 dark:text-gray-400 truncate">{r.location || 'Unknown location'}</span>
                              </div>
                            </div>
                            <div className="text-right flex-shrink-0">
                              <span className="text-[9px] text-gray-400 tabular-nums font-bold block">{ago}</span>
                              {r.verified && <span className="text-[7px] font-black text-green-600 dark:text-green-400"> VFD</span>}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-4 text-center">
                    <div className="w-10 h-10 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center mb-2 ring-4 ring-green-50 dark:ring-green-900/20">
                      <ShieldCheck className="w-5 h-5 text-green-500" />
                    </div>
                    <p className="text-[11px] font-black text-green-700 dark:text-green-400">All Clear</p>
                    <p className="text-[9px] text-gray-400 mt-0.5">No incidents in the last 7 days</p>
                  </div>
                )}
              </div>

              {/* Footer stats row */}
              <div className="grid grid-cols-3 gap-1.5 pt-1.5 border-t border-teal-100 dark:border-teal-800/40 mt-auto">
                {[
                  { label: 'Per hour',  value: reportsLastHour.length, icon: Zap,         color: 'text-amber-500' },
                  { label: '24h total', value: reportsLast24h.length,  icon: Activity,    color: 'text-teal-500'  },
                  { label: 'Verified',  value: stats.verified,          icon: CheckCircle, color: 'text-green-500' },
                ].map((s, si) => (
                  <div key={si} className="flex flex-col items-center py-1.5 rounded-lg bg-white/50 dark:bg-gray-900/20 border border-gray-100 dark:border-gray-800/40">
                    <s.icon className={`w-3 h-3 mb-0.5 ${s.color}`} />
                    <span className={`text-sm font-black tabular-nums leading-none ${s.color}`}>{s.value}</span>
                    <span className="text-[7px] font-bold text-gray-400 uppercase tracking-wide mt-0.5">{s.label}</span>
                  </div>
                ))}
              </div>

            </div>
          </div>
        </div>

        {/* COMMUNITY & SUBSCRIPTIONS -- below situation overview */}
        <div className="glass-card rounded-2xl border border-gray-200/60 dark:border-gray-700/60 overflow-hidden cp-fade-up" style={{ animationDelay: '0.18s' }}>
          <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-200/60 dark:border-gray-700/40 bg-gray-50/50 dark:bg-gray-800/20">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-aegis-500 to-blue-600 flex items-center justify-center shadow-md flex-shrink-0">
              <Zap className="w-3.5 h-3.5 text-white" />
            </div>
            <span className="text-xs font-black text-gray-900 dark:text-white uppercase tracking-wider">ACTIONS</span>
            <span className="text-[10px] text-gray-500 dark:text-gray-400 ml-1">Stay connected &amp; get support</span>
          </div>
          <div className="p-4 flex flex-col gap-3">
            {/* 3 toggle buttons */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <button
                onClick={() => setActiveAction(a => a === 'report' ? null : 'report')}
                className={`group flex items-center gap-4 p-4 rounded-xl border transition-all hover:shadow-md active:scale-[0.99] ${
                  activeAction === 'report'
                    ? 'border-blue-400 dark:border-blue-500 bg-blue-100 dark:bg-blue-900/40 shadow-md'
                    : 'border-blue-200/60 dark:border-blue-700/40 bg-blue-50 dark:bg-blue-950/20 hover:bg-blue-100 dark:hover:bg-blue-900/30'
                }`}
              >
                <div className={`w-11 h-11 rounded-xl bg-gradient-to-br from-blue-500 to-aegis-700 flex items-center justify-center shadow-lg flex-shrink-0 transition-transform duration-300 ${activeAction === 'report' ? 'scale-110' : 'group-hover:scale-110'}`}>
                  <AlertTriangle className="w-5 h-5 text-white" />
                </div>
                <div className="text-left flex-1">
                  <p className="text-sm font-black text-gray-900 dark:text-white">Report Emergency</p>
                  <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">Submit an incident report</p>
                </div>
                <ChevronDown className={`w-4 h-4 text-gray-400 flex-shrink-0 transition-transform duration-200 ${activeAction === 'report' ? 'rotate-180' : ''}`} />
              </button>
              <button
                onClick={() => setActiveAction(a => a === 'subscribe' ? null : 'subscribe')}
                className={`group flex items-center gap-4 p-4 rounded-xl border transition-all hover:shadow-md active:scale-[0.99] ${
                  activeAction === 'subscribe'
                    ? 'border-amber-400 dark:border-amber-500 bg-amber-100 dark:bg-amber-900/40 shadow-md'
                    : 'border-amber-200/60 dark:border-amber-700/40 bg-amber-50 dark:bg-amber-950/20 hover:bg-amber-100 dark:hover:bg-amber-900/30'
                }`}
              >
                <div className={`w-11 h-11 rounded-xl bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center shadow-lg flex-shrink-0 transition-transform duration-300 ${activeAction === 'subscribe' ? 'scale-110' : 'group-hover:scale-110'}`}>
                  <Bell className="w-5 h-5 text-white" />
                </div>
                <div className="text-left flex-1">
                  <p className="text-sm font-black text-gray-900 dark:text-white">Subscribe to Alerts</p>
                  <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">Get instant push notifications</p>
                </div>
                <ChevronDown className={`w-4 h-4 text-gray-400 flex-shrink-0 transition-transform duration-200 ${activeAction === 'subscribe' ? 'rotate-180' : ''}`} />
              </button>
              <button
                onClick={() => setActiveAction(a => a === 'community' ? null : 'community')}
                className={`group flex items-center gap-4 p-4 rounded-xl border transition-all hover:shadow-md active:scale-[0.99] ${
                  activeAction === 'community'
                    ? 'border-teal-400 dark:border-teal-500 bg-teal-100 dark:bg-teal-900/40 shadow-md'
                    : 'border-teal-200/60 dark:border-teal-700/40 bg-teal-50 dark:bg-teal-950/20 hover:bg-teal-100 dark:hover:bg-teal-900/30'
                }`}
              >
                <div className={`w-11 h-11 rounded-xl bg-gradient-to-br from-teal-400 to-emerald-600 flex items-center justify-center shadow-lg flex-shrink-0 transition-transform duration-300 ${activeAction === 'community' ? 'scale-110' : 'group-hover:scale-110'}`}>
                  <Heart className="w-5 h-5 text-white" />
                </div>
                <div className="text-left flex-1">
                  <p className="text-sm font-black text-gray-900 dark:text-white">Community Support</p>
                  <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">Connect with neighbours</p>
                </div>
                <ChevronDown className={`w-4 h-4 text-gray-400 flex-shrink-0 transition-transform duration-200 ${activeAction === 'community' ? 'rotate-180' : ''}`} />
              </button>
            </div>

            {/* Inline full-width expanded panel -- opens below buttons like a page */}
            <AnimatePresence mode="wait">
              {activeAction === 'report' && (
                <motion.div key="action-report" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.2, ease: 'easeInOut' }} className="overflow-hidden">
                  <div className="rounded-xl border border-blue-200 dark:border-blue-700/40 bg-blue-50/80 dark:bg-blue-950/20 p-4">
                    <p className="text-sm font-bold text-gray-800 dark:text-gray-100 mb-1">Submit an Emergency Report</p>
                    <p className="text-[11px] text-gray-500 dark:text-gray-400 mb-4 leading-relaxed">Describe the situation, attach photos and share your location. Your report is immediately visible to emergency coordinators and citizens.</p>
                    <div className="grid grid-cols-3 gap-2 mb-4">
                      {([{ label: 'Incident type', icon: AlertTriangle }, { label: 'Location', icon: MapPin }, { label: 'Evidence', icon: Eye }] as const).map((f, i) => (
                        <div key={i} className="flex flex-col items-center gap-1.5 p-2.5 rounded-lg bg-white dark:bg-gray-800/50 border border-blue-100 dark:border-blue-800/40 text-center">
                          <f.icon className="w-4 h-4 text-blue-500" />
                          <p className="text-[9px] font-bold text-gray-600 dark:text-gray-400">{f.label}</p>
                        </div>
                      ))}
                    </div>
                    <button onClick={() => { setShowReport(true); setActiveAction(null) }} className="w-full bg-blue-600 hover:bg-blue-700 text-white rounded-xl py-2.5 text-sm font-black transition-colors flex items-center justify-center gap-2">
                      <AlertTriangle className="w-4 h-4" /> Open Report Form
                    </button>
                  </div>
                </motion.div>
              )}
              {activeAction === 'subscribe' && (
                <motion.div key="action-subscribe" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.2, ease: 'easeInOut' }} className="overflow-hidden">
                  <div className="rounded-xl border border-amber-200 dark:border-amber-700/40 bg-amber-50/80 dark:bg-amber-950/20 p-4">
                    <p className="text-sm font-bold text-gray-800 dark:text-gray-100 mb-1">Emergency Alert Subscriptions</p>
                    <p className="text-[11px] text-gray-500 dark:text-gray-400 mb-4 leading-relaxed">Get instant push notifications for emergencies near you -- even when the browser is closed. Free, secure and opt-out anytime.</p>
                    <div className="grid grid-cols-3 gap-2 mb-4">
                      {([{ label: 'Push alerts', icon: Bell }, { label: 'Your area', icon: MapPin }, { label: 'Real-time', icon: Activity }] as const).map((f, i) => (
                        <div key={i} className="flex flex-col items-center gap-1.5 p-2.5 rounded-lg bg-white dark:bg-gray-800/50 border border-amber-100 dark:border-amber-800/40 text-center">
                          <f.icon className="w-4 h-4 text-amber-500" />
                          <p className="text-[9px] font-bold text-gray-600 dark:text-gray-400">{f.label}</p>
                        </div>
                      ))}
                    </div>
                    <button onClick={() => { setShowSubscribe(true); setActiveAction(null) }} className="w-full bg-amber-500 hover:bg-amber-600 text-white rounded-xl py-2.5 text-sm font-black transition-colors flex items-center justify-center gap-2">
                      <Bell className="w-4 h-4" /> Enable Notifications
                    </button>
                  </div>
                </motion.div>
              )}
              {activeAction === 'community' && (
                <motion.div key="action-community" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.2, ease: 'easeInOut' }} className="overflow-hidden">
                  <div className="rounded-xl border border-teal-200 dark:border-teal-700/40 bg-teal-50/80 dark:bg-teal-950/20 p-4">
                    <p className="text-sm font-bold text-gray-800 dark:text-gray-100 mb-1">Community Support Hub</p>
                    <p className="text-[11px] text-gray-500 dark:text-gray-400 mb-4 leading-relaxed">Connect with neighbours, share resources and coordinate help during and after emergencies. Your community is your best first responder.</p>
                    <div className="grid grid-cols-3 gap-2 mb-4">
                      {([{ label: 'Neighbours', icon: Users }, { label: 'Resources', icon: Heart }, { label: 'Coordinate', icon: Radio }] as const).map((f, i) => (
                        <div key={i} className="flex flex-col items-center gap-1.5 p-2.5 rounded-lg bg-white dark:bg-gray-800/50 border border-teal-100 dark:border-teal-800/40 text-center">
                          <f.icon className="w-4 h-4 text-teal-500" />
                          <p className="text-[9px] font-bold text-gray-600 dark:text-gray-400">{f.label}</p>
                        </div>
                      ))}
                    </div>
                    <button onClick={() => { setShowCommunity(true); setActiveAction(null) }} className="w-full bg-teal-600 hover:bg-teal-700 text-white rounded-xl py-2.5 text-sm font-black transition-colors flex items-center justify-center gap-2">
                      <Heart className="w-4 h-4" /> Open Community Hub
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* SIGN IN UNLOCK BANNER -- only shown to guests */}
        {!isCitizenLoggedIn && (
          <div className="glass-card rounded-2xl border border-aegis-200/60 dark:border-aegis-700/40 overflow-hidden cp-fade-up" style={{ animationDelay: '0.22s' }}>
            <div className="flex items-center gap-2 px-4 py-3 border-b border-aegis-100/60 dark:border-aegis-800/40 bg-aegis-50/50 dark:bg-aegis-950/20">
              <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-aegis-500 to-blue-600 flex items-center justify-center shadow-md flex-shrink-0">
                <ShieldCheck className="w-3.5 h-3.5 text-white" />
              </div>
              <span className="text-xs font-black text-gray-900 dark:text-white uppercase tracking-wider">UNLOCK FULL ACCESS</span>
              <span className="ml-auto text-[8px] font-bold text-aegis-600 dark:text-aegis-400 bg-aegis-50 dark:bg-aegis-950/30 px-2 py-0.5 rounded border border-aegis-200 dark:border-aegis-800/50">FREE</span>
            </div>
            <div className="p-4 space-y-3">
              <p className="text-[11px] text-gray-500 dark:text-gray-400 leading-relaxed">Create a free citizen account to unlock your personal emergency dashboard with full access to all AEGIS features.</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {[
                  { icon: Bell,          label: 'Personal Alerts',     desc: 'Real-time alerts for your exact area', color: 'from-red-400 to-rose-600' },
                  { icon: MapPin,        label: 'Saved Locations',      desc: 'Monitor home, work and family zones', color: 'from-blue-400 to-aegis-600' },
                  { icon: FileText,      label: 'My Reports',           desc: 'Full history of all your submissions', color: 'from-teal-400 to-emerald-600' },
                  { icon: MessageSquare, label: 'Direct Messages',      desc: 'Message emergency coordinators', color: 'from-violet-400 to-purple-600' },
                  { icon: Activity,      label: 'Risk Assessment',      desc: 'Personal risk profile for your zones', color: 'from-amber-400 to-orange-600' },
                  { icon: Home,          label: 'Shelter Finder',       desc: 'Nearest emergency shelters to you', color: 'from-green-400 to-emerald-600' },
                  { icon: BookOpen,      label: 'Preparedness Plan',    desc: 'Customised household emergency plan', color: 'from-sky-400 to-blue-600' },
                  { icon: Bot,           label: 'AEGIS AI Assistant',   desc: 'Ask anything about emergencies', color: 'from-aegis-400 to-aegis-600' },
                ].map((f, i) => (
                  <div key={i} className="flex items-center gap-2 p-2.5 rounded-xl bg-gray-50 dark:bg-gray-800/40 border border-gray-200/60 dark:border-gray-700/40">
                    <div className={`w-7 h-7 rounded-lg bg-gradient-to-br ${f.color} flex items-center justify-center flex-shrink-0`}>
                      <f.icon className="w-3.5 h-3.5 text-white" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-[10px] font-black text-gray-800 dark:text-gray-100 leading-tight">{f.label}</p>
                      <p className="text-[9px] text-gray-500 dark:text-gray-400 leading-tight truncate">{f.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex gap-2 pt-1">
                <Link to="/citizen/auth?mode=register" className="flex-1 flex items-center justify-center gap-2 bg-aegis-600 hover:bg-aegis-700 text-white font-black text-xs px-5 py-2.5 rounded-xl transition-all hover:scale-[1.01] active:scale-[0.99] shadow-md shadow-aegis-600/20">
                  <User className="w-3.5 h-3.5" /> Create Free Account
                </Link>
                <Link to="/citizen/auth" className="flex-1 flex items-center justify-center gap-2 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 border border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-200 font-bold text-xs px-4 py-2.5 rounded-xl transition-all">
                  Sign In
                </Link>
              </div>
            </div>
          </div>
        )}

        {/* TAB NAV -- AEGIS themed */}
        <div ref={tabContentRef} className="glass-card rounded-2xl p-1.5 sm:p-2 overflow-x-auto tab-bar-scroll shadow-lg">
          <div className="flex gap-1 sm:gap-1.5 min-w-max">
            {TABS.map(tab => (
              <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                className={`relative flex items-center gap-1.5 px-3.5 py-2.5 sm:px-5 sm:py-3 rounded-xl text-xs sm:text-sm font-bold transition-all duration-200 whitespace-nowrap ${
                  activeTab === tab.id
                    ? 'bg-aegis-600 text-white tab-active-glow'
                    : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800/60 hover:text-gray-900 dark:hover:text-white'
                }`}>
                <tab.icon className={`w-4 h-4 flex-shrink-0 ${activeTab === tab.id ? '' : 'opacity-70'}`}/>
                <span className="hidden sm:inline">{tab.label}</span>
                <span className="sm:hidden">{tab.label.split(' ')[0]}</span>
                {tab.badge > 0 && (
                  <span className={`text-[9px] font-black px-1.5 py-0.5 rounded-full min-w-[18px] text-center ${activeTab === tab.id ? 'bg-white/25 text-white' : 'bg-red-500 text-white'}`}>
                    {tab.badge > 99 ? '99+' : tab.badge}
                  </span>
                )}
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
            {/* Panels below map -- full-width responsive grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <ErrorBoundary name="IntelligenceDashboard" fallback={<div className="p-4 text-center text-sm text-gray-500 dark:text-gray-400 bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-700">Failed to load intelligence</div>}>
                <Suspense fallback={<div className="h-40 bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-700 p-4 space-y-2"><Skeleton className="h-4 w-24" /><Skeleton className="h-3 w-full" /><Skeleton className="h-3 w-3/4" /><Skeleton className="h-8 w-20 mt-2 rounded-lg" /></div>}>
                  <IntelligenceDashboard collapsed={false} className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-lg" />
                </Suspense>
              </ErrorBoundary>
              <ErrorBoundary name="WeatherPanel" fallback={<div className="p-4 text-center text-sm text-gray-500 dark:text-gray-400 bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-700">Failed to load weather</div>}>
                <Suspense fallback={<div className="h-40 bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-700 p-4 space-y-2"><Skeleton className="h-4 w-20" /><Skeleton className="h-8 w-16" /><Skeleton className="h-3 w-full" /><Skeleton className="h-3 w-2/3" /></div>}>
                  <WeatherPanel/>
                </Suspense>
              </ErrorBoundary>
            </div>
            {/* River Levels -- full width */}
            <ErrorBoundary name="RiverGaugePanel" fallback={<div className="p-4 text-center text-sm text-gray-500 dark:text-gray-400 bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-700">Failed to load river data</div>}>
              <Suspense fallback={<div className="h-40 bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-700 p-4 space-y-2"><Skeleton className="h-4 w-24" /><Skeleton className="h-8 w-16" /><Skeleton className="h-3 w-full" /><Skeleton className="h-3 w-1/2" /></div>}>
                <RiverGaugePanel/>
              </Suspense>
            </ErrorBoundary>
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
            <div className="flex items-center justify-between flex-wrap gap-2">
              <h2 className="font-bold text-lg flex items-center gap-2.5 text-gray-900 dark:text-white">
                <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-aegis-400 to-aegis-600 flex items-center justify-center">
                  <Newspaper className="w-4 h-4 text-white"/>
                </div>
                {t('citizen.tab.news', lang) || 'News'}
                {newsPool.length > 0 && (
                  <span className="text-xs font-normal text-gray-400 dark:text-gray-500">({newsTotal || newsPool.length} articles)</span>
                )}
              </h2>
              <div className="flex items-center gap-2">
                {newsPool.length > 0 && (
                  <span className="text-xs text-gray-400 dark:text-gray-500">
                    {Math.floor(newsOffset / NEWS_BATCH) + 1}/{Math.ceil(newsPool.length / NEWS_BATCH)}
                    {newsLastFetched && ` - ${newsLastFetched.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`}
                  </span>
                )}
                {newsOffset > 0 && (
                  <button
                    onClick={() => setNewsOffset(o => Math.max(0, o - NEWS_BATCH))}
                    className="flex items-center gap-1 text-xs text-gray-500 hover:text-aegis-600 bg-gray-100/80 dark:bg-gray-800/60 border border-gray-200/60 dark:border-gray-700/60 px-3 py-2 rounded-xl transition-all hover:scale-[1.02] font-bold"
                  >
 {'<-'} Prev
                  </button>
                )}
                <button
                  onClick={nextNews}
                  disabled={newsRefreshing}
                  className="flex items-center gap-1.5 text-xs text-aegis-600 hover:text-aegis-700 bg-aegis-50/80 dark:bg-aegis-950/30 border border-aegis-200/60 dark:border-aegis-800/60 px-4 py-2 rounded-xl transition-all disabled:opacity-60 hover:scale-[1.02] active:scale-95 font-bold backdrop-blur-sm"
                >
                  <RefreshCw className={`w-3.5 h-3.5 transition-transform duration-500 ${newsRefreshing ? 'animate-spin' : 'group-hover:rotate-180'}`}/>
 {newsRefreshing ? 'Loading...' : hasNextBatchInPool || hasMoreFromServer ? 'Next ->' : 'Refresh ↺'}
                </button>
              </div>
            </div>
            {/* Hazard filter chips */}
            <div className="flex items-center gap-2 flex-wrap">
              {([
                { id: 'all',        label: 'All',        icon: Globe       },
                { id: 'flood',      label: 'Flood',      icon: Waves       },
                { id: 'earthquake', label: 'Earthquake', icon: AlertCircle },
                { id: 'storm',      label: 'Storm',      icon: Wind        },
                { id: 'wildfire',   label: 'Wildfire',   icon: Flame       },
                { id: 'drought',    label: 'Drought',    icon: Sun         },
              ] as { id: string; label: string; icon: ComponentType<{ className?: string }> }[]).map(f => (
                <button key={f.id} onClick={() => setNewsHazardFilter(f.id)}
                  className={`flex items-center gap-1 text-[11px] font-bold px-3 py-1.5 rounded-xl border transition-all hover:scale-[1.02] ${newsHazardFilter === f.id ? 'bg-aegis-600 text-white border-aegis-600 shadow-sm' : 'bg-white dark:bg-gray-800/60 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-700 hover:border-aegis-300'}`}
                >
                  <f.icon className="w-3 h-3" /> {f.label}
                </button>
              ))}
              {newsHazardFilter !== 'all' && <span className="text-[11px] text-gray-400">{filteredNewsItems.length} matching</span>}
            </div>

            <div key={`${newsOffset}-${newsHazardFilter}`} className="space-y-2.5 animate-fade-in">
              {newsRefreshing && newsPool.length === 0 && (
                <div className="space-y-2.5">
                  {[1,2,3,4,5].map(i => (
                    <div key={i} className="glass-card rounded-2xl p-4 flex items-start gap-3.5 animate-pulse">
                      <div className="w-3 h-3 rounded-full bg-gray-200 dark:bg-gray-700 flex-shrink-0 mt-1.5" />
                      <div className="flex-1 space-y-2">
                        <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-16" />
                        <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-3/4" />
                        <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-32" />
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {!newsRefreshing && filteredNewsItems.length === 0 && (
                <div className="glass-card rounded-2xl p-8 text-center">
                  <Newspaper className="w-10 h-10 text-gray-300 dark:text-gray-400 mx-auto mb-3"/>
                  <p className="text-sm text-gray-500 dark:text-gray-400 font-medium">
                    {newsHazardFilter !== 'all' ? `No ${newsHazardFilter} articles in this batch -- try Next ↺` : t('citizenPage.noNewsAvailable', lang)}
                  </p>
                </div>
              )}
              {filteredNewsItems.map((n,i)=>{
                const typeConfig: Record<string,{color:string,bg:string,label:string}> = {
                  alert: { color: 'bg-red-500', bg: 'bg-red-50 dark:bg-red-950/20 border-red-200/50 dark:border-red-800/50', label: t('cdash.news.alert', lang) },
                  warning: { color: 'bg-amber-500', bg: 'bg-amber-50 dark:bg-amber-950/20 border-amber-200/50 dark:border-amber-800/50', label: t('cdash.news.warning', lang) },
                  community: { color: 'bg-green-500', bg: 'bg-green-50 dark:bg-green-950/20 border-green-200/50 dark:border-green-800/50', label: t('cdash.news.community', lang) },
                  tech: { color: 'bg-purple-500', bg: 'bg-purple-50 dark:bg-purple-950/20 border-purple-200/50 dark:border-purple-800/50', label: t('cdash.news.tech', lang) },
                  info: { color: 'bg-blue-500', bg: 'bg-blue-50 dark:bg-blue-950/20 border-blue-200/50 dark:border-blue-800/50', label: t('cdash.news.info', lang) },
                }
                const cfg = typeConfig[n.type] || typeConfig.info
                const waUrl = `https://wa.me/?text=${encodeURIComponent(`🚨 ${n.title}\n${n.url}`)}`
                return (
                  <div key={i} className="glass-card rounded-2xl p-4 hover:shadow-lg transition-all duration-300 flex items-start gap-3.5 group hover-lift">
                    <div className={`w-3 h-3 rounded-full flex-shrink-0 mt-1.5 ${cfg.color} ring-4 ring-offset-2 ring-offset-white dark:ring-offset-gray-900 ${cfg.color}/20`}/>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`text-[8px] font-extrabold uppercase tracking-wider px-2 py-0.5 rounded-full ${cfg.bg} border`}>{cfg.label}</span>
                      </div>
                      <a href={n.url} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold hover:text-aegis-600 transition-colors block">{n.title}</a>
                      <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5">{n.source} - {n.time}</p>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-all">
                      <a href={waUrl} target="_blank" rel="noopener noreferrer" title="Share on WhatsApp"
                        className="w-7 h-7 flex items-center justify-center rounded-lg bg-green-50 dark:bg-green-950/30 border border-green-200/60 dark:border-green-800/60 hover:bg-green-100 transition-colors">
                        <Share2 className="w-3.5 h-3.5 text-green-600 dark:text-green-400" />
                      </a>
                      <a href={n.url} target="_blank" rel="noopener noreferrer"
                        className="flex items-center gap-1 text-[10px] text-aegis-600 hover:text-aegis-700 bg-aegis-50 dark:bg-aegis-950/20 border border-aegis-200/60 dark:border-aegis-800/60 px-3 py-1.5 rounded-xl transition-all font-bold">
                        <ExternalLink className="w-3 h-3"/> {t('citizen.news.source', lang)}
                      </a>
                    </div>
                  </div>
                )
              })}
              {newsPool.length > NEWS_BATCH && (
                <div className="flex items-center justify-center gap-2 pt-1 text-xs text-gray-400">
                  <span>{newsOffset + 1}-{Math.min(newsOffset + NEWS_BATCH, newsPool.length)} of {newsTotal || newsPool.length} articles</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* PREPARE TAB */}
        {activeTab==='prepare'&&(
          <div className="space-y-4 animate-fade-in">
            {/* Hero card */}
            <div className="glass-card rounded-2xl p-6 border border-emerald-200/60 dark:border-emerald-800/40 bg-gradient-to-br from-emerald-50/80 via-white to-teal-50/60 dark:from-emerald-950/20 dark:via-gray-900 dark:to-teal-950/10 relative overflow-hidden">
              <div className="absolute top-0 right-0 w-64 h-64 bg-emerald-200/20 dark:bg-emerald-500/5 rounded-full -translate-y-1/2 translate-x-1/3 blur-3xl"/>
              <div className="relative z-10 flex items-center gap-4">
                <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-xl cp-float">
                  <ShieldCheck className="w-7 h-7 text-white" />
                </div>
                <div>
                  <h3 className="font-extrabold text-lg text-gray-900 dark:text-white">Emergency Preparedness</h3>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Essential supplies and plans -- are you ready if disaster strikes?</p>
                </div>
              </div>
            </div>

            {/* Checklist grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {([
                { icon: Droplets,   color: 'from-blue-400 to-cyan-600',     label: 'Water: 3-day supply (3L/person/day)',      desc: 'Store sealed water bottles in a cool, dark place' },
                { icon: Package,    color: 'from-amber-400 to-orange-500',   label: 'Food: 3-day non-perishable supply',        desc: 'Canned goods, dried fruit, energy bars, pet food' },
                { icon: HeartPulse, color: 'from-red-400 to-rose-600',       label: 'First aid kit & prescription meds',        desc: 'Include bandages, antiseptic, painkillers, any prescriptions' },
                { icon: FileText,   color: 'from-teal-400 to-emerald-600',   label: 'ID documents in waterproof bag',           desc: 'Passport, insurance, medical records, emergency contacts' },
                { icon: Zap,        color: 'from-yellow-400 to-amber-500',   label: 'Torch, batteries & portable radio',        desc: 'Hand-crank or battery radio for emergency broadcasts' },
                { icon: Navigation, color: 'from-indigo-400 to-violet-600',  label: 'Evacuation route planned & shared',        desc: 'Plan 2 routes, share with family, set a meeting point' },
                { icon: Smartphone, color: 'from-slate-400 to-gray-600',     label: 'Emergency contacts saved offline',         desc: 'Write numbers on paper -- phones may not work' },
                { icon: Banknote,   color: 'from-green-400 to-emerald-600',  label: 'Emergency cash (ATMs may be offline)',     desc: 'Keep small denominations, enough for 3 days of essentials' },
              ] as { icon: ComponentType<{ className?: string }>; color: string; label: string; desc: string }[]).map((item, i) => (
                <div key={i} className="glass-card rounded-xl p-4 border border-emerald-100 dark:border-emerald-800/30 hover:shadow-lg hover:border-emerald-300 dark:hover:border-emerald-700 transition-all duration-300 group cp-fade-up" style={{ animationDelay: `${i * 0.05}s` }}>
                  <div className="flex items-start gap-3">
                    <div className={`w-9 h-9 rounded-xl bg-gradient-to-br ${item.color} flex items-center justify-center flex-shrink-0 group-hover:scale-110 transition-transform shadow-sm`}>
                      <item.icon className="w-4.5 h-4.5 text-white" />
                    </div>
                    <div>
                      <p className="text-sm font-bold text-gray-900 dark:text-white">{item.label}</p>
                      <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-1 leading-relaxed">{item.desc}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Sign in CTA */}
            <div className="flex items-center justify-center gap-3 py-2">
              <Link to="/citizen/login" className="flex items-center gap-2 text-sm font-bold text-emerald-700 dark:text-emerald-400 hover:text-emerald-600 transition-colors group">
 <BookOpen className="w-4 h-4 group-hover:scale-110 transition-transform"/> Full preparedness guide & training (sign in) {'>'}
              </Link>
            </div>
          </div>
        )}
        </div>

      {/* FOOTER -- dynamic emergency numbers based on selected country */}
      <footer className="relative overflow-hidden bg-gradient-to-b from-gray-100 to-gray-200 dark:from-gray-900 dark:to-gray-950 border-t border-gray-200/50 dark:border-gray-800/50 mt-10">
        <div className="absolute inset-0 opacity-[0.03]">
          <svg width="100%" height="100%"><defs><pattern id="footerGrid" x="0" y="0" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M 40 0 L 0 0 0 40" fill="none" stroke="currentColor" strokeWidth="0.5"/></pattern></defs><rect width="100%" height="100%" fill="url(#footerGrid)"/></svg>
        </div>
        <div className="relative max-w-7xl mx-auto px-4 py-12">
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

      {/* FLOATING SOS BUTTON -- hidden while chatbot is open (unless SOS is active) */}
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

      {/* SOS Countdown Overlay -- full-screen feedback */}
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

      {/* SOS Active Panel -- prominent, dynamic emergency numbers */}
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

      {/* SOS Label -- small text above the button */}
      {!sosActive && sosCountdown === null && (
        <div className="fixed z-[90] pointer-events-none text-center" style={{ bottom: 'max(10.5rem, calc(env(safe-area-inset-bottom, 0px) + 10.5rem))', right: '0.75rem', width: '4.5rem' }}>
          <span className="text-[9px] font-bold text-red-600 dark:text-red-400 bg-white/90 dark:bg-gray-900/90 px-1.5 py-0.5 rounded-md shadow-sm">SOS</span>
        </div>
      )}

      {/* FLOATING CHATBOT BUTTON -- only opens on click, never auto */}
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
          <Suspense fallback={null}><Chatbot onClose={()=>setShowChatbot(false)} lang={lang} authToken={getCitizenToken()} /></Suspense>
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
                  <span className="text-gray-500 dark:text-gray-400 font-mono text-xs">ID: {selectedReport.reportNumber || selectedReport.id}</span>
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
                    {selectedReport.trappedPersons === 'yes' ? 'Yes -- People are trapped or in immediate danger'
                      : selectedReport.trappedPersons === 'property' ? 'No -- But property or infrastructure at risk'
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

      <SubscribeModal
        isOpen={showSubscribe}
        onClose={() => setShowSubscribe(false)}
        pushNotification={pushNotification}
      />

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

//GuestReportsTab -- Professional-grade Recent Reports for guest page

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
      <div className="flex flex-wrap items-center justify-between gap-3">
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

