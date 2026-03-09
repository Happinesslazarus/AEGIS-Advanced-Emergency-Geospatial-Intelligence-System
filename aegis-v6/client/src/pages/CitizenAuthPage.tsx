/*
 * CitizenAuthPage.tsx - Citizen Login & Registration v6.9
 *
 * Full-featured authentication page with:
 * - Login / Register toggle with step wizard for registration
 * - Profile photo upload during signup
 * - Bio, address line, all citizen fields
 * - Global country/region selection
 * - Password strength indicator
 * - Vulnerability indicator (priority help)
 * - Status color selector (green/yellow/red)
 * - Form validation, loading states
 * - Direct redirect to dashboard on success
 */

import { useState, useRef, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import {
  Shield, Mail, Lock, User, Phone, MapPin, Eye, EyeOff,
  ArrowRight, ArrowLeft, AlertCircle, CheckCircle, Loader2,
  Globe, Calendar, Heart, Building2, Camera, FileText, Home,
  ChevronRight, CircleDot, Sun, Moon
} from 'lucide-react'
import { useCitizenAuth } from '../contexts/CitizenAuthContext'
import { useTheme } from '../contexts/ThemeContext'
import { t } from '../utils/i18n'
import { useLanguage } from '../hooks/useLanguage'
import IncomingAlertsWidget from '../components/shared/IncomingAlertsWidget'
import { ModernNotification } from '../components/shared/ModernNotification'
import LanguageSelector from '../components/shared/LanguageSelector'

// Use relative paths so Vite's proxy handles API requests (avoids CORS)
import { API_BASE, getPasswordStrength } from '../utils/helpers'
import { validateEmail } from '../utils/validation'

// ─── Global Country + Region data ─────────────────────────────────────────────

const COUNTRIES = [
  'United Kingdom', 'United States', 'Canada', 'Australia', 'Germany', 'France',
  'India', 'Japan', 'Brazil', 'South Africa', 'Nigeria', 'Kenya', 'Egypt',
  'Mexico', 'Italy', 'Spain', 'Netherlands', 'Sweden', 'Norway', 'Ireland',
  'New Zealand', 'Singapore', 'South Korea', 'Philippines', 'Indonesia',
  'Pakistan', 'Bangladesh', 'Thailand', 'Malaysia', 'Turkey', 'Poland',
  'Switzerland', 'Belgium', 'Austria', 'Denmark', 'Finland', 'Portugal',
  'Greece', 'Czech Republic', 'Romania', 'Hungary', 'Colombia', 'Argentina',
  'Chile', 'Peru', 'Venezuela', 'Ecuador', 'China', 'Russia', 'Ukraine',
  'UAE', 'Saudi Arabia', 'Qatar', 'Israel', 'Jamaica', 'Trinidad and Tobago',
]

const REGION_MAP: Record<string, { value: string; label: string }[]> = {
  'United Kingdom': [
    { value: 'aberdeen', label: 'Aberdeen' },
    { value: 'edinburgh', label: 'Edinburgh' },
    { value: 'glasgow', label: 'Glasgow' },
    { value: 'dundee', label: 'Dundee' },
    { value: 'inverness', label: 'Inverness' },
    { value: 'stirling', label: 'Stirling' },
    { value: 'perth', label: 'Perth' },
    { value: 'scotland', label: 'Scotland (General)' },
    { value: 'london', label: 'London' },
    { value: 'manchester', label: 'Manchester' },
    { value: 'birmingham', label: 'Birmingham' },
    { value: 'liverpool', label: 'Liverpool' },
    { value: 'cardiff', label: 'Cardiff' },
    { value: 'belfast', label: 'Belfast' },
    { value: 'england', label: 'England (General)' },
    { value: 'wales', label: 'Wales (General)' },
    { value: 'northern-ireland', label: 'Northern Ireland (General)' },
  ],
  'United States': [
    { value: 'new-york', label: 'New York' },
    { value: 'california', label: 'California' },
    { value: 'texas', label: 'Texas' },
    { value: 'florida', label: 'Florida' },
    { value: 'illinois', label: 'Illinois' },
    { value: 'us-general', label: 'United States (General)' },
  ],
  'Canada': [
    { value: 'ontario', label: 'Ontario' },
    { value: 'quebec', label: 'Quebec' },
    { value: 'british-columbia', label: 'British Columbia' },
    { value: 'alberta', label: 'Alberta' },
    { value: 'canada-general', label: 'Canada (General)' },
  ],
  'Australia': [
    { value: 'new-south-wales', label: 'New South Wales' },
    { value: 'victoria', label: 'Victoria' },
    { value: 'queensland', label: 'Queensland' },
    { value: 'western-australia', label: 'Western Australia' },
    { value: 'australia-general', label: 'Australia (General)' },
  ],
}

const STATUS_OPTIONS = [
  { value: 'green', labelKey: 'citizen.auth.status.available', descKey: 'citizen.auth.status.availableDesc', color: 'bg-green-500', ring: 'ring-green-300' },
  { value: 'yellow', labelKey: 'citizen.auth.status.caution', descKey: 'citizen.auth.status.cautionDesc', color: 'bg-amber-500', ring: 'ring-amber-300' },
  { value: 'red', labelKey: 'citizen.auth.status.needHelp', descKey: 'citizen.auth.status.needHelpDesc', color: 'bg-red-500', ring: 'ring-red-300' },
]

// getPasswordStrength imported from ../utils/helpers

export default function CitizenAuthPage(): JSX.Element {
  const { login, register, uploadAvatar, isAuthenticated, loading } = useCitizenAuth()
  const { dark, toggle } = useTheme()
  const navigate = useNavigate()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const lang = useLanguage()

  const [mode, setMode] = useState<'login' | 'register' | 'forgot'>('login')
  const [regStep, setRegStep] = useState(1) // 1: Account, 2: Personal Info, 3: Profile & Preferences
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [tosAccepted, setTosAccepted] = useState(false)
  const [forgotEmail, setForgotEmail] = useState('')
  const [forgotSent, setForgotSent] = useState(false)

  // Form fields — Step 1 (Account)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')

  // Form fields — Step 2 (Personal)
  const [phone, setPhone] = useState('')
  const [country, setCountry] = useState('United Kingdom')
  const [city, setCity] = useState('')
  const [region, setRegion] = useState('')
  const [addressLine, setAddressLine] = useState('')
  const [dateOfBirth, setDateOfBirth] = useState('')

  // Form fields — Step 3 (Profile & Preferences)
  const [bio, setBio] = useState('')
  const [avatarFile, setAvatarFile] = useState<File | null>(null)
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null)
  const [isVulnerable, setIsVulnerable] = useState(false)
  const [vulnerabilityDetails, setVulnerabilityDetails] = useState('')
  const [statusColor, setStatusColor] = useState('green')

  // Notification state
  const [notification, setNotification] = useState<{ message: string; type: 'success' | 'error' | 'warning' | 'info' } | null>(null)

  // Redirect if already authenticated
  useEffect(() => {
    if (isAuthenticated && !loading) {
      navigate('/citizen/dashboard', { replace: true })
    }
  }, [isAuthenticated, loading, navigate])

  // Show nothing while checking auth status
  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-aegis-50 via-blue-50 to-cyan-50 dark:from-gray-950 dark:via-gray-900 dark:to-gray-950 flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-aegis-600 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">{t('general.loading', lang)}</p>
        </div>
      </div>
    )
  }

  if (isAuthenticated) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-aegis-50 via-blue-50 to-cyan-50 dark:from-gray-950 dark:via-gray-900 dark:to-gray-950 flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 bg-aegis-600 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg shadow-aegis-600/30">
            <Shield className="w-8 h-8 text-white" />
          </div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2">{t('citizen.auth.alreadySignedIn', lang)}</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">{t('citizen.auth.redirectingDashboard', lang)}</p>
          <div className="w-8 h-8 border-3 border-aegis-600 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <Link to="/citizen/dashboard" className="text-sm text-aegis-600 hover:text-aegis-700 font-semibold underline">
            {t('citizen.auth.goDashboard', lang)}
          </Link>
        </div>
      </div>
    )
  }

  const pwStrength = getPasswordStrength(password, lang)
  const regions = REGION_MAP[country] || []

  const handleAvatarSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 2 * 1024 * 1024) {
      setError(t('citizen.auth.error.photoSize', lang))
      setNotification({ message: t('citizen.auth.error.photoSize', lang), type: 'error' })
      return
    }
    setAvatarFile(file)
    const reader = new FileReader()
    reader.onload = (ev) => setAvatarPreview(ev.target?.result as string)
    reader.readAsDataURL(file)
  }

  const validateStep1 = (): boolean => {
    if (!displayName.trim()) { 
      const msg = t('citizen.auth.error.displayNameRequired', lang)
      setError(msg)
      setNotification({ message: msg, type: 'warning' })
      return false 
    }
    if (!email.trim()) { 
      const msg = t('citizen.auth.error.emailRequired', lang)
      setError(msg)
      setNotification({ message: msg, type: 'warning' })
      return false 
    }
    // Client-side email format validation (#50)
    if (!validateEmail(email.trim())) {
      const msg = 'Please enter a valid email address (e.g. name@example.com)'
      setError(msg)
      setNotification({ message: msg, type: 'warning' })
      return false
    }
    if (password.length < 8) { 
      const msg = t('citizen.auth.error.passwordMinLength', lang)
      setError(msg)
      setNotification({ message: msg, type: 'warning' })
      return false 
    }
    if (password !== confirmPassword) { 
      const msg = t('citizen.auth.error.passwordsNoMatch', lang)
      setError(msg)
      setNotification({ message: msg, type: 'warning' })
      return false 
    }
    setError('')
    return true
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setSubmitting(true)

    try {
      if (mode === 'register') {
        if (!validateStep1()) { setSubmitting(false); return }
        // Check ToS acceptance (#27)
        if (!tosAccepted) {
          setError('You must accept the Terms of Service and Privacy Policy to register.')
          setNotification({ message: 'Please accept the Terms of Service and Privacy Policy.', type: 'warning' })
          setSubmitting(false)
          return
        }

        const result = await register({
          email: email.trim(),
          password,
          displayName: displayName.trim(),
          phone: phone.trim() || undefined,
          preferredRegion: region || undefined,
          country: country || undefined,
          city: city.trim() || undefined,
          addressLine: addressLine.trim() || undefined,
          dateOfBirth: dateOfBirth || undefined,
          bio: bio.trim() || undefined,
          isVulnerable,
          vulnerabilityDetails: isVulnerable ? vulnerabilityDetails.trim() : undefined,
          statusColor,
        })

        if (result.success) {
          setNotification({ message: t('citizen.auth.success.accountCreated', lang), type: 'success' })
          // Upload avatar if selected (after registration, user is now authenticated)
          if (avatarFile) {
            try {
              await uploadAvatar(avatarFile)
            } catch (avatarErr: any) {
              console.warn('[CitizenAuth] Avatar upload failed after registration:', avatarErr?.message)
              setNotification({ message: 'Account created, but profile photo upload failed. You can update it in your profile.', type: 'warning' })
            }
          }
          setTimeout(() => navigate('/citizen/dashboard', { replace: true }), 500)
        } else {
          const errorMsg = result.error || t('citizen.auth.error.registrationFailed', lang)
          setError(errorMsg)
          setNotification({ message: errorMsg, type: 'error' })
          setRegStep(1) // Go back to step 1 if it's an account error
        }
      } else {
        const result = await login(email.trim(), password)
        if (result.success) {
          setNotification({ message: t('citizen.auth.success.login', lang), type: 'success' })
          setTimeout(() => navigate('/citizen/dashboard', { replace: true }), 300)
        } else {
          const errorMsg = result.error || t('citizen.auth.error.loginFailed', lang)
          setError(errorMsg)
          setNotification({ message: errorMsg, type: 'error' })
        }
      }
    } catch (err: any) {
      const errorMsg = err.message || t('citizen.auth.error.generic', lang)
      setError(errorMsg)
      setNotification({ message: errorMsg, type: 'error' })
    } finally {
      setSubmitting(false)
    }
  }

  const STEPS = [
    { num: 1, label: t('citizen.auth.step.account', lang), icon: Lock },
    { num: 2, label: t('citizen.auth.step.details', lang), icon: User },
    { num: 3, label: t('citizen.auth.step.profile', lang), icon: Camera },
  ]

  return (
    <div className="min-h-screen bg-gradient-to-br from-aegis-50 via-blue-50 to-cyan-50 dark:from-gray-950 dark:via-gray-900 dark:to-gray-950 flex flex-col">
      {/* Navigation */}
      <nav className="bg-aegis-700 dark:bg-gray-900 text-white px-4 py-3 flex items-center justify-between shadow-lg">
        <Link to="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
          <Shield className="w-7 h-7" />
          <span className="font-bold">AEGIS</span>
        </Link>
        <div className="flex items-center gap-2">
          <LanguageSelector darkNav />
          <button onClick={toggle} className="p-2 hover:bg-white/10 rounded-lg transition-colors" aria-label="Toggle theme">
            {dark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
          <Link to="/citizen" className="text-xs bg-white/10 hover:bg-white/20 border border-white/20 px-3 py-1.5 rounded-lg transition-colors">
            {t('citizen.auth.guestContinue', lang)}
          </Link>
        </div>
      </nav>

      {/* Auth Form */}
      <div className="flex-1 flex items-center justify-center p-4 py-8">
        {/* Notification Toast */}
        {notification && (
          <div className="fixed top-4 right-4 z-50 animate-in fade-in slide-in-from-top-2">
            <ModernNotification
              message={notification.message}
              type={notification.type}
              duration={5000}
              onClose={() => setNotification(null)}
            />
          </div>
        )}

        <div className="w-full max-w-6xl flex gap-8 lg:flex-row flex-col">
          {/* Left Column - Incoming Alerts */}
          <div className="hidden lg:flex flex-col w-full lg:max-w-sm flex-1">
            <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-6 shadow-xl h-full flex flex-col">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-1">{t('citizen.auth.alerts.title', lang)}</h2>
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">{t('citizen.auth.alerts.subtitle', lang)}</p>
              <IncomingAlertsWidget />
            </div>
          </div>

          {/* Right Column - Auth Form */}
          <div className="w-full lg:max-w-md flex-1">
          {/* Header */}
          <div className="text-center mb-6">
            <div className="w-16 h-16 bg-aegis-600 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg shadow-aegis-600/30">
              <Shield className="w-8 h-8 text-white" />
            </div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
              {mode === 'login' ? t('auth.title', lang) : t('form.title', lang)}
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              {mode === 'login'
                ? t('citizen.auth.loginSubtitle', lang)
                : t('citizen.auth.registerSubtitle', lang)}
            </p>
          </div>

          {/* Mode Toggle */}
          <div className="flex bg-gray-100 dark:bg-gray-800 rounded-xl p-1 mb-6">
            <button
              onClick={() => { setMode('login'); setError(''); setRegStep(1) }}
              className={`flex-1 py-2.5 text-sm font-semibold rounded-lg transition-all ${
                mode === 'login'
                  ? 'bg-white dark:bg-gray-700 text-aegis-700 dark:text-aegis-300 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
              }`}
            >
              {t('auth.login', lang)}
            </button>
            <button
              onClick={() => { setMode('register'); setError('') }}
              className={`flex-1 py-2.5 text-sm font-semibold rounded-lg transition-all ${
                mode === 'register'
                  ? 'bg-white dark:bg-gray-700 text-aegis-700 dark:text-aegis-300 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
              }`}
            >
              {t('citizen.auth.register', lang)}
            </button>
          </div>

          {/* Forgot Password Mode */}
          {mode === 'forgot' && (
            <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-6 shadow-xl space-y-4">
              <div className="text-center">
                <Mail className="w-10 h-10 text-aegis-600 mx-auto mb-2" />
                <h3 className="text-lg font-bold text-gray-900 dark:text-white">Reset Your Password</h3>
                <p className="text-xs text-gray-500 mt-1">Enter your email address and we'll send you a reset link</p>
              </div>
              {forgotSent ? (
                <div className="bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 p-4 rounded-xl text-center">
                  <CheckCircle className="w-8 h-8 text-green-500 mx-auto mb-2" />
                  <p className="text-sm font-semibold text-green-800 dark:text-green-300">Reset link sent!</p>
                  <p className="text-xs text-green-600 dark:text-green-400 mt-1">If an account exists with that email, you'll receive reset instructions shortly.</p>
                </div>
              ) : (
                <form onSubmit={async (e) => {
                  e.preventDefault()
                  setError('')
                  setSubmitting(true)
                  try {
                    const res = await fetch('/api/citizen-auth/forgot-password', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ email: forgotEmail.trim() }),
                    })
                    // Always show success to prevent email enumeration
                    setForgotSent(true)
                  } catch {
                    setForgotSent(true)
                  } finally {
                    setSubmitting(false)
                  }
                }} className="space-y-3">
                  <div className="relative">
                    <Mail className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
                    <input type="email" value={forgotEmail} onChange={e => setForgotEmail(e.target.value)}
                      className="w-full pl-10 pr-3 py-2.5 text-sm bg-gray-50 dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 focus:ring-2 focus:ring-aegis-500 transition"
                      placeholder="your@email.com" required autoComplete="email" />
                  </div>
                  <button type="submit" disabled={submitting}
                    className="w-full bg-aegis-600 hover:bg-aegis-700 disabled:bg-gray-300 text-white py-3 rounded-xl font-semibold text-sm shadow flex items-center justify-center gap-2 transition-all">
                    {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
                    {submitting ? 'Sending...' : 'Send Reset Link'}
                  </button>
                </form>
              )}
              <button onClick={() => { setMode('login'); setError(''); setForgotSent(false); setForgotEmail('') }}
                className="w-full text-xs text-aegis-600 hover:text-aegis-700 font-semibold py-2">
                ← Back to Login
              </button>
            </div>
          )}

          {/* Step Indicator (register only) */}
          {mode === 'register' && (
            <div className="flex items-center justify-center gap-2 mb-5">
              {STEPS.map((s, i) => (
                <div key={s.num} className="flex items-center gap-2">
                  <button
                    onClick={() => { if (s.num < regStep || (s.num === 2 && validateStep1()) || s.num <= regStep) { setError(''); setRegStep(s.num) } }}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all ${
                      regStep === s.num
                        ? 'bg-aegis-600 text-white shadow-md'
                        : regStep > s.num
                        ? 'bg-green-100 dark:bg-green-950/30 text-green-700 dark:text-green-300'
                        : 'bg-gray-100 dark:bg-gray-800 text-gray-400'
                    }`}
                  >
                    {regStep > s.num ? <CheckCircle className="w-3.5 h-3.5" /> : <s.icon className="w-3.5 h-3.5" />}
                    <span className="hidden sm:inline">{s.label}</span>
                    <span className="sm:hidden">{s.num}</span>
                  </button>
                  {i < STEPS.length - 1 && <ChevronRight className="w-3.5 h-3.5 text-gray-300" />}
                </div>
              ))}
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 p-3 rounded-xl flex items-center gap-2 mb-4 text-sm">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />{error}
            </div>
          )}

          {/* Form — shown for login and register modes only */}
          {mode !== 'forgot' && (
          <form onSubmit={handleSubmit} className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-6 shadow-xl space-y-4">

            {/* ═══ LOGIN FORM ═══ */}
            {mode === 'login' && (
              <>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1.5">{t('citizen.auth.emailAddress', lang)}</label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
                    <input type="email" value={email} onChange={e => setEmail(e.target.value)} disabled={submitting}
                      className="w-full pl-10 pr-3 py-2.5 text-sm bg-gray-50 dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 focus:ring-2 focus:ring-aegis-500 focus:border-transparent transition disabled:opacity-50 disabled:cursor-not-allowed"
                      placeholder={t('subscribe.placeholder.email', lang)} required autoComplete="email" />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1.5">{t('citizen.auth.passwordLabel', lang)}</label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
                    <input type={showPassword ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} disabled={submitting}
                      className="w-full pl-10 pr-10 py-2.5 text-sm bg-gray-50 dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 focus:ring-2 focus:ring-aegis-500 focus:border-transparent transition disabled:opacity-50 disabled:cursor-not-allowed"
                      placeholder={t('citizen.auth.passwordPlaceholder', lang)} required autoComplete="current-password" />
                    <button type="button" onClick={() => setShowPassword(!showPassword)} disabled={submitting} className="absolute right-3 top-2.5 text-gray-400 hover:text-gray-600 disabled:cursor-not-allowed">
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
                <button type="submit" disabled={submitting}
                  className="w-full bg-aegis-600 hover:bg-aegis-700 active:bg-aegis-800 disabled:bg-gray-300 text-white py-3 rounded-xl font-semibold text-sm shadow-lg shadow-aegis-600/20 disabled:shadow-none flex items-center justify-center gap-2 transition-all duration-200 disabled:cursor-not-allowed">
                  {submitting ? (
                    <><Loader2 className="w-4 h-4 animate-spin" /> <span>{t('citizen.auth.signingIn', lang)}</span></>
                  ) : (
                    <><span>{t('citizen.auth.signIn', lang)}</span> <ArrowRight className="w-4 h-4" /></>
                  )}
                </button>
                {/* Forgot Password Link (#22) */}
                <div className="text-right">
                  <button type="button" onClick={() => { setMode('forgot'); setError(''); setForgotEmail(email); setForgotSent(false) }}
                    className="text-xs text-aegis-600 hover:text-aegis-700 font-semibold">
                    Forgot your password?
                  </button>
                </div>

                {/* ─── OAuth Divider & Google Sign-In (#26) ─── */}
                <div className="relative my-2">
                  <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-gray-200 dark:border-gray-700" /></div>
                  <div className="relative flex justify-center text-xs">
                    <span className="px-3 bg-white dark:bg-gray-900 text-gray-400">{t('citizen.auth.orContinueWith', lang) || 'or continue with'}</span>
                  </div>
                </div>
                <a
                  href={`${API_BASE}/api/auth/google`}
                  className="w-full flex items-center justify-center gap-3 py-2.5 px-4 border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-750 transition-colors text-sm font-medium text-gray-700 dark:text-gray-200 shadow-sm"
                >
                  <svg className="w-5 h-5" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
                  <span>{t('citizen.auth.signInGoogle', lang) || 'Sign in with Google'}</span>
                </a>
              </>
            )}

            {/* ═══ REGISTER STEP 1 — Account ═══ */}
            {mode === 'register' && regStep === 1 && (
              <>
                {/* Honeypot — hidden from real users, catches bots */}
                <div className="absolute -left-[9999px]" aria-hidden="true" tabIndex={-1}>
                  <label htmlFor="website">Website</label>
                  <input type="text" id="website" name="website" autoComplete="off" tabIndex={-1}
                    onChange={e => { (e.target as any)._hp = e.target.value }} />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1.5">{t('citizen.auth.displayName', lang)} *</label>
                  <div className="relative">
                    <User className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
                    <input type="text" value={displayName} onChange={e => setDisplayName(e.target.value)}
                      className="w-full pl-10 pr-3 py-2.5 text-sm bg-gray-50 dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 focus:ring-2 focus:ring-aegis-500 focus:border-transparent transition"
                      placeholder={t('citizen.auth.displayName', lang)} required autoComplete="name" />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1.5">{t('citizen.auth.emailAddress', lang)} *</label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
                    <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                      className="w-full pl-10 pr-3 py-2.5 text-sm bg-gray-50 dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 focus:ring-2 focus:ring-aegis-500 focus:border-transparent transition"
                      placeholder={t('subscribe.placeholder.email', lang)} required autoComplete="email" />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1.5">{t('citizen.auth.passwordLabel', lang)} *</label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
                    <input type={showPassword ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)}
                      className="w-full pl-10 pr-10 py-2.5 text-sm bg-gray-50 dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 focus:ring-2 focus:ring-aegis-500 focus:border-transparent transition"
                      placeholder={t('citizen.auth.passwordMin', lang)} required autoComplete="new-password" />
                    <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-2.5 text-gray-400 hover:text-gray-600">
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  {password.length > 0 && (
                    <div className="mt-2">
                      <div className="flex gap-1">
                        {[1,2,3,4,5].map(i => (
                          <div key={i} className={`h-1.5 flex-1 rounded-full transition-all ${i <= pwStrength.score ? pwStrength.color : 'bg-gray-200 dark:bg-gray-700'}`} />
                        ))}
                      </div>
                      <p className="text-[10px] text-gray-500 mt-1">{pwStrength.label}</p>
                    </div>
                  )}
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1.5">{t('citizen.auth.confirmPassword', lang)} *</label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
                    <input type={showPassword ? 'text' : 'password'} value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)}
                      className={`w-full pl-10 pr-10 py-2.5 text-sm bg-gray-50 dark:bg-gray-800 rounded-xl border focus:ring-2 focus:ring-aegis-500 focus:border-transparent transition ${
                        confirmPassword && confirmPassword !== password ? 'border-red-300 dark:border-red-700' :
                        confirmPassword && confirmPassword === password ? 'border-green-300 dark:border-green-700' :
                        'border-gray-200 dark:border-gray-700'
                      }`} placeholder={t('citizen.auth.repeatPassword', lang)} required autoComplete="new-password" />
                    {confirmPassword && confirmPassword === password && <CheckCircle className="absolute right-3 top-2.5 w-4 h-4 text-green-500" />}
                  </div>
                </div>
                <button type="button" onClick={() => { if (validateStep1()) setRegStep(2) }}
                  className="w-full bg-aegis-600 hover:bg-aegis-700 text-white py-3 rounded-xl font-semibold text-sm shadow-lg shadow-aegis-600/20 flex items-center justify-center gap-2 transition-all">
                  {t('citizen.auth.continue', lang)} <ArrowRight className="w-4 h-4" />
                </button>
              </>
            )}

            {/* ═══ REGISTER STEP 2 — Personal Details ═══ */}
            {mode === 'register' && regStep === 2 && (
              <>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1.5">{t('citizen.auth.phone', lang)} <span className="font-normal">({t('citizen.auth.optional', lang)})</span></label>
                  <div className="relative">
                    <Phone className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
                    <input type="tel" value={phone} onChange={e => setPhone(e.target.value)}
                      className="w-full pl-10 pr-3 py-2.5 text-sm bg-gray-50 dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 focus:ring-2 focus:ring-aegis-500 focus:border-transparent transition"
                      placeholder={t('subscribe.placeholder.phone', lang)} autoComplete="tel" />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1.5">{t('citizen.auth.country', lang)}</label>
                    <div className="relative">
                      <Globe className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
                      <select value={country} onChange={e => { setCountry(e.target.value); setRegion('') }}
                        className="w-full pl-10 pr-3 py-2.5 text-sm bg-gray-50 dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 focus:ring-2 focus:ring-aegis-500 focus:border-transparent transition appearance-none">
                        {COUNTRIES.sort().map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1.5">{t('citizen.auth.city', lang)} <span className="font-normal">({t('citizen.auth.optional', lang)})</span></label>
                    <div className="relative">
                      <Building2 className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
                      <input type="text" value={city} onChange={e => setCity(e.target.value)}
                        className="w-full pl-10 pr-3 py-2.5 text-sm bg-gray-50 dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 focus:ring-2 focus:ring-aegis-500 focus:border-transparent transition"
                        placeholder={t('citizen.auth.city', lang)} autoComplete="address-level2" />
                    </div>
                  </div>
                </div>

                {regions.length > 0 && (
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1.5">{t('citizen.auth.region', lang)} <span className="font-normal">({t('citizen.auth.optional', lang)})</span></label>
                    <div className="relative">
                      <MapPin className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
                      <select value={region} onChange={e => setRegion(e.target.value)}
                        className="w-full pl-10 pr-3 py-2.5 text-sm bg-gray-50 dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 focus:ring-2 focus:ring-aegis-500 focus:border-transparent transition appearance-none">
                        <option value="">{t('citizen.auth.selectRegion', lang)}</option>
                        {regions.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                      </select>
                    </div>
                  </div>
                )}

                <div>
                  <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1.5">{t('citizen.auth.addressLine', lang)} <span className="font-normal">({t('citizen.auth.optional', lang)})</span></label>
                  <div className="relative">
                    <Home className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
                    <input type="text" value={addressLine} onChange={e => setAddressLine(e.target.value)}
                      className="w-full pl-10 pr-3 py-2.5 text-sm bg-gray-50 dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 focus:ring-2 focus:ring-aegis-500 focus:border-transparent transition"
                      placeholder={t('citizen.auth.addressLine', lang)} autoComplete="street-address" />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1.5">{t('citizen.auth.dateOfBirth', lang)} <span className="font-normal">({t('citizen.auth.optional', lang)})</span></label>
                  <div className="relative">
                    <Calendar className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
                    <input type="date" value={dateOfBirth} onChange={e => setDateOfBirth(e.target.value)}
                      max={new Date().toISOString().split('T')[0]}
                      className="w-full pl-10 pr-3 py-2.5 text-sm bg-gray-50 dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 focus:ring-2 focus:ring-aegis-500 focus:border-transparent transition" />
                  </div>
                </div>

                <div className="flex gap-3">
                  <button type="button" onClick={() => setRegStep(1)}
                    className="flex-1 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 py-3 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 transition-all">
                    <ArrowLeft className="w-4 h-4" /> {t('citizen.auth.back', lang)}
                  </button>
                  <button type="button" onClick={() => { setError(''); setRegStep(3) }}
                    className="flex-1 bg-aegis-600 hover:bg-aegis-700 text-white py-3 rounded-xl font-semibold text-sm shadow-lg shadow-aegis-600/20 flex items-center justify-center gap-2 transition-all">
                    {t('citizen.auth.continue', lang)} <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              </>
            )}

            {/* ═══ REGISTER STEP 3 — Profile Photo, Bio, Vulnerability, Status ═══ */}
            {mode === 'register' && regStep === 3 && (
              <>
                {/* Profile Photo Upload */}
                <div className="flex flex-col items-center gap-3">
                  <p className="text-xs font-semibold text-gray-600 dark:text-gray-400">{t('citizen.auth.profilePhoto', lang)} <span className="font-normal">({t('citizen.auth.optional', lang)})</span></p>
                  <div className="relative group cursor-pointer" onClick={() => fileInputRef.current?.click()}>
                    {avatarPreview ? (
                      <img src={avatarPreview} className="w-24 h-24 rounded-full object-cover border-4 border-gray-100 dark:border-gray-800 shadow-lg" alt="Avatar preview" />
                    ) : (
                      <div className="w-24 h-24 rounded-full bg-aegis-50 dark:bg-aegis-950/30 border-4 border-gray-100 dark:border-gray-800 flex items-center justify-center shadow-lg">
                        <Camera className="w-8 h-8 text-aegis-400" />
                      </div>
                    )}
                    <div className="absolute inset-0 rounded-full bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                      <Camera className="w-6 h-6 text-white" />
                    </div>
                    <input ref={fileInputRef} type="file" accept="image/*" onChange={handleAvatarSelect} className="hidden" />
                  </div>
                  <p className="text-[10px] text-gray-400">{t('citizen.auth.clickUpload', lang)}</p>
                </div>

                {/* Bio */}
                <div>
                  <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1.5">{t('citizen.auth.bio', lang)} <span className="font-normal">({t('citizen.auth.optional', lang)})</span></label>
                  <div className="relative">
                    <FileText className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
                    <textarea value={bio} onChange={e => setBio(e.target.value)}
                      className="w-full pl-10 pr-3 py-2.5 text-sm bg-gray-50 dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 focus:ring-2 focus:ring-aegis-500 focus:border-transparent transition resize-none"
                      placeholder={t('citizen.auth.bioPlaceholder', lang)} rows={2} />
                  </div>
                </div>

                {/* Status Color */}
                <div>
                  <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-2">{t('citizen.auth.statusTitle', lang)}</label>
                  <div className="grid grid-cols-3 gap-2">
                    {STATUS_OPTIONS.map(s => (
                      <button key={s.value} type="button" onClick={() => setStatusColor(s.value)}
                        className={`p-3 rounded-xl border-2 transition-all text-center ${
                          statusColor === s.value
                            ? `border-current ${s.ring} ring-2 ring-offset-1`
                            : 'border-gray-200 dark:border-gray-700'
                        }`}>
                        <div className={`w-4 h-4 ${s.color} rounded-full mx-auto mb-1.5 ${statusColor === s.value ? 'animate-pulse' : ''}`} />
                        <p className="text-xs font-semibold text-gray-900 dark:text-white">{t(s.labelKey, lang)}</p>
                        <p className="text-[9px] text-gray-500 mt-0.5">{t(s.descKey, lang)}</p>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Vulnerability Indicator */}
                <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800/50 rounded-xl p-4">
                  <label className="flex items-start gap-3 cursor-pointer">
                    <input type="checkbox" checked={isVulnerable} onChange={e => setIsVulnerable(e.target.checked)}
                      className="mt-0.5 w-4 h-4 rounded border-amber-300 text-amber-600 focus:ring-amber-500" />
                    <div className="flex-1">
                      <div className="flex items-center gap-1.5">
                        <Heart className="w-4 h-4 text-amber-600" />
                        <span className="text-sm font-semibold text-amber-800 dark:text-amber-300">{t('citizen.auth.vulnerabilityTitle', lang)}</span>
                      </div>
                      <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1">
                        {t('citizen.auth.vulnerabilityHint', lang)}
                      </p>
                    </div>
                  </label>
                  {isVulnerable && (
                    <textarea value={vulnerabilityDetails} onChange={e => setVulnerabilityDetails(e.target.value)}
                      placeholder={t('citizen.auth.vulnerabilityPlaceholder', lang)}
                      className="w-full mt-3 p-2.5 text-sm bg-white dark:bg-gray-800 rounded-lg border border-amber-200 dark:border-amber-700 focus:ring-2 focus:ring-amber-500 focus:border-transparent transition resize-none" rows={2} />
                  )}
                </div>

                {/* Terms of Service & Privacy Policy consent (#27) */}
                <label className="flex items-start gap-3 p-3 bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl cursor-pointer">
                  <input type="checkbox" checked={tosAccepted} onChange={e => setTosAccepted(e.target.checked)}
                    className="mt-0.5 w-4 h-4 rounded border-gray-300 text-aegis-600 focus:ring-aegis-500" />
                  <div className="flex-1">
                    <p className="text-xs font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-1">
                      <Shield className="w-3.5 h-3.5 text-aegis-600" /> Terms of Service & Privacy Policy
                    </p>
                    <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5">
                      I agree to the <a href="/terms" target="_blank" className="text-aegis-600 underline">Terms of Service</a> and{' '}
                      <a href="/privacy" target="_blank" className="text-aegis-600 underline">Privacy Policy</a>. 
                      I understand my data will be processed in accordance with GDPR regulations.
                    </p>
                  </div>
                </label>

                <div className="flex gap-3">
                  <button type="button" onClick={() => setRegStep(2)}
                    className="flex-1 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 py-3 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 transition-all">
                    <ArrowLeft className="w-4 h-4" /> {t('citizen.auth.back', lang)}
                  </button>
                  <button type="submit" disabled={submitting}
                    className="flex-1 bg-aegis-600 hover:bg-aegis-700 disabled:bg-aegis-400 text-white py-3 rounded-xl font-semibold text-sm shadow-lg shadow-aegis-600/20 flex items-center justify-center gap-2 transition-all">
                    {submitting ? <><Loader2 className="w-4 h-4 animate-spin" /> {t('citizen.auth.creating', lang)}</> : <>{t('citizen.auth.createAccount', lang)} <CheckCircle className="w-4 h-4" /></>}
                  </button>
                </div>
              </>
            )}
          </form>
          )}

          {/* Footer links */}
          {mode !== 'forgot' && (
          <div className="text-center mt-4 text-xs text-gray-500 dark:text-gray-400">
            <p>
              {mode === 'login' ? t('citizen.auth.noAccount', lang) : t('citizen.auth.haveAccount', lang)}
              <button
                onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); setRegStep(1) }}
                className="text-aegis-600 hover:text-aegis-700 font-semibold"
              >
                {mode === 'login' ? t('citizen.auth.register', lang) : t('citizen.auth.signIn', lang)}
              </button>
            </p>
            <p className="mt-2">
              <Link to="/citizen" className="text-gray-400 hover:text-gray-600">{t('citizen.auth.continueWithout', lang)}</Link>
            </p>
          </div>
          )}
          </div>
        </div>
      </div>
    </div>
  )
}
