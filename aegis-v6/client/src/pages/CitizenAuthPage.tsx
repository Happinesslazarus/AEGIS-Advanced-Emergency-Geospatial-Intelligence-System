/**
 * The citizen login and registration page. Handles both flows with a
 * toggled form -- sign up (name, email, phone, location, password) or
 * sign in (email + password). On success, navigates to CitizenDashboard.
 * Also supports Google OAuth and shows 2FA challenge when applicable.
 *
 * - Routed by client/src/App.tsx at /citizen/auth
 * - Auth state written to client/src/contexts/CitizenAuthContext.tsx
 * - Calls POST /api/citizen-auth/register and POST /api/citizen-auth/login
 * - On 2FA required, renders TwoFactorChallenge component inline
 * - Redirects to /citizen/dashboard after successful login
 *
 * - server/src/routes/citizenAuthRoutes.ts    -- the backend login/register endpoints
 * - client/src/contexts/CitizenAuthContext.tsx -- token storage and auth state
 * - client/src/pages/CitizenDashboard.tsx     -- destination after login
 */

import { useState, useRef, useEffect } from 'react'
import { usePageTitle } from '../hooks/usePageTitle'
import { useNavigate, Link } from 'react-router-dom'
import {
  Shield, Mail, Lock, User, Phone, MapPin, Eye, EyeOff,
  ArrowRight, ArrowLeft, AlertCircle, CheckCircle, Loader2,
  Globe, Calendar, Heart, Building2, Camera, FileText, Home,
  ChevronRight, ChevronDown, Menu, Users, Info, QrCode,
  Smartphone
} from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import { useCitizenAuth } from '../contexts/CitizenAuthContext'
import type { CitizenUser, CitizenPreferences } from '../contexts/CitizenAuthContext'
import { t } from '../utils/i18n'
import { useLanguage } from '../hooks/useLanguage'
import { ModernNotification } from '../components/shared/ModernNotification'
import LanguageSelector from '../components/shared/LanguageSelector'
import ThemeSelector from '../components/ui/ThemeSelector'
import { useTheme } from '../contexts/ThemeContext'

import { API_BASE, getPasswordStrength } from '../utils/helpers'
import { validateEmail } from '../utils/validation'
import { apiCheckAvailability, apiCitizen2FAAuthenticate } from '../utils/api'
import ProfileCountryPicker, { ProfileRegionPicker } from '../components/shared/ProfileCountryPicker'
import { REGION_MAP as FULL_REGION_MAP, getCountryEntryByName } from '../data/allCountries'
import { getFlagUrl } from '../data/worldRegions'

//Max local subscriber digits (after the dial prefix) by ISO-3166-1 alpha-2 country code.
//Falls back to 15 − dial-prefix-digit-count (ITU-T E.164 maximum) for unlisted countries.
const PHONE_LOCAL_MAX: Record<string, number> = {
  //North America (+1)
  US:10, CA:10, AG:10, BB:10, BS:10, DM:10, DO:10, GD:10, JM:10, KN:10, LC:10, TT:10, VC:10,
  //Europe
  GB:10, FR:9, DE:11, IT:10, ES:9, PT:9, NL:9, BE:9, CH:9, AT:10, SE:10, NO:8, DK:8,
  FI:10, PL:9, CZ:9, SK:9, HU:9, RO:9, BG:9, HR:9, RS:9, UA:9, GR:10, IE:9, RU:10,
  //Asia
  IN:10, CN:11, JP:11, KR:10, SG:8, MY:10, PH:10, ID:12, TH:9, VN:10, PK:10, BD:10,
  LK:9, NP:10, AE:9, SA:9, QA:8, KW:8, BH:8, OM:8, JO:9, LB:8, IQ:10, IR:10, IL:9, TR:10,
  //Africa
  NG:10, ZA:9, KE:9, GH:9, ET:9, TZ:9, UG:9, RW:9, SN:9, CI:10, CM:9, EG:10, MA:9, DZ:9,
  //Americas
  BR:11, MX:10, AR:10, CO:10, CL:9, PE:9, VE:10, EC:9, BO:8, GT:8, HN:8, CR:8, PA:8, CU:8,
  //Pacific
  AU:9, NZ:9,
}

const STATUS_OPTIONS = [
  { value: 'green', labelKey: 'citizen.auth.status.available', descKey: 'citizen.auth.status.availableDesc', color: 'bg-green-500', ring: 'ring-green-300' },
  { value: 'yellow', labelKey: 'citizen.auth.status.caution', descKey: 'citizen.auth.status.cautionDesc', color: 'bg-aegis-500', ring: 'ring-aegis-300' },
  { value: 'red', labelKey: 'citizen.auth.status.needHelp', descKey: 'citizen.auth.status.needHelpDesc', color: 'bg-red-500', ring: 'ring-red-300' },
]

export default function CitizenAuthPage(): JSX.Element {
  usePageTitle('Sign In')
  const { login, complete2FA, register, uploadAvatar, isAuthenticated, loading } = useCitizenAuth()
  const navigate = useNavigate()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const navDropdownRef = useRef<HTMLDivElement>(null)
  const lang = useLanguage()
  const { dark } = useTheme()

  const [searchParams, setSearchParams] = useSearchParams()
  const sessionExpired = searchParams.get('session') === 'expired'
  const authError = searchParams.get('error')
  const socialEmail = searchParams.get('social_email')
  const [mode, setMode] = useState<'login' | 'register' | 'forgot'>('login')
  const [regStep, setRegStep] = useState(1)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [tosAccepted, setTosAccepted] = useState(false)
  const [forgotEmail, setForgotEmail] = useState('')
  const [forgotSent, setForgotSent] = useState(false)
  const [navDropdownOpen, setNavDropdownOpen] = useState(false)
  const [showMoreAuth, setShowMoreAuth] = useState(false)

  useEffect(() => {
    if (!authError) return

    const oauthErrorMap: Record<string, string> = {
      oauth_account_not_found: 'No account found for this email. Please register first, then use social sign-in.',
      oauth_failed: 'Social sign-in failed. Please try again.',
      oauth_not_configured: 'Social sign-in is not configured right now. Please use email and password.',
    }

    const message = oauthErrorMap[authError]
    if (message) {
      if (authError === 'oauth_account_not_found') {
        setMode('register')
        if (socialEmail) setEmail(socialEmail)
      } else {
        setMode('login')
      }
      setError('')
      setNotification({ message, type: 'warning' })

      const nextParams = new URLSearchParams(searchParams)
      nextParams.delete('error')
      nextParams.delete('social_email')
      setSearchParams(nextParams, { replace: true })
    }
  }, [authError, searchParams, setSearchParams, socialEmail])

  //Close dropdown on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (navDropdownRef.current && !navDropdownRef.current.contains(e.target as Node)) setNavDropdownOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  //Form fields -- Step 1 (Account)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')

  //Form fields -- Step 2 (Personal)
  const [dialCode, setDialCode] = useState('')
  const [localPhone, setLocalPhone] = useState('')
  const [country, setCountry] = useState('')
  const [city, setCity] = useState('')
  const [region, setRegion] = useState('')
  const [addressLine, setAddressLine] = useState('')
  const [dateOfBirth, setDateOfBirth] = useState('')

  //When country changes, look up the calling code and pre-fill the prefix
  useEffect(() => {
    if (!country) { setDialCode(''); setLocalPhone(''); return }
    const entry = getCountryEntryByName(country)
    if (entry?.dial) { setDialCode(entry.dial); setLocalPhone('') }
  }, [country])

  //Form fields -- Step 3 (Profile & Preferences)
  const [bio, setBio] = useState('')
  const [avatarFile, setAvatarFile] = useState<File | null>(null)
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null)
  const [isVulnerable, setIsVulnerable] = useState(false)
  const [vulnerabilityDetails, setVulnerabilityDetails] = useState('')
  const [statusColor, setStatusColor] = useState('green')

  //Notification state
  const [notification, setNotification] = useState<{ message: string; type: 'success' | 'error' | 'warning' | 'info' } | null>(null)
  //Field-level validation errors (shown onBlur and real-time)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  //2FA challenge state
  const [twoFactorRequired, setTwoFactorRequired] = useState(false)
  const [tempToken, setTempToken] = useState('')
  const [twoFactorCode, setTwoFactorCode] = useState('')
  const [twoFactorError, setTwoFactorError] = useState('')
  const [twoFactorLoading, setTwoFactorLoading] = useState(false)
  const [twoFactorMode, setTwoFactorMode] = useState<'totp' | 'backup'>('totp')
  const [rememberDevice, setRememberDevice] = useState(false)
  const twoFactorInputRef = useRef<HTMLInputElement>(null)

  //Redirect if already authenticated
  useEffect(() => {
    if (isAuthenticated && !loading) {
      const returnTo = sessionStorage.getItem('aegis_qr_return_to')
      if (returnTo) {
        sessionStorage.removeItem('aegis_qr_return_to')
        sessionStorage.setItem('aegis_qr_just_logged_in', '1')
        navigate(returnTo, { replace: true })
      } else {
        navigate('/citizen/dashboard', { replace: true })
      }
    }
  }, [isAuthenticated, loading, navigate])

  //Show nothing while checking auth status
  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 via-blue-50/30 to-gray-50 dark:from-gray-950 dark:via-gray-900 dark:to-gray-950 flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-aegis-500 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="mt-3 text-sm text-gray-500 dark:text-gray-300">{t('general.loading', lang)}</p>
        </div>
      </div>
    )
  }

  if (isAuthenticated) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 via-blue-50/30 to-gray-50 dark:from-gray-950 dark:via-gray-900 dark:to-gray-950 flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 bg-aegis-600 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg shadow-aegis-500/40">
            <Shield className="w-8 h-8 text-white" />
          </div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2">{t('citizen.auth.alreadySignedIn', lang)}</h2>
          <p className="text-sm text-gray-500 dark:text-gray-300 mb-4">{t('citizen.auth.redirectingDashboard', lang)}</p>
          <div className="w-8 h-8 border-3 border-aegis-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <Link to="/citizen/dashboard" className="text-sm text-aegis-600 hover:text-aegis-700 font-semibold underline">
            {t('citizen.auth.goDashboard', lang)}
          </Link>
        </div>
      </div>
    )
  }

  const pwStrength = getPasswordStrength(password, lang)
  const regions = FULL_REGION_MAP[country] || []

  //Derive full phone from dial prefix + local number
  const fullPhone = dialCode ? `${dialCode}${localPhone.replace(/\s/g, '')}` : localPhone

  //Compute max local digits for the selected country
  const phoneCountryEntry = getCountryEntryByName(country)
  const phoneMaxLocal = phoneCountryEntry
    ? (PHONE_LOCAL_MAX[phoneCountryEntry.code.toUpperCase()] ?? (15 - phoneCountryEntry.dial.replace('+', '').length))
    : 15

  //Real-time password requirement checks (matches server requirements)
  const pwRequirements = [
    { met: password.length >= 12, label: t('citizen.auth.pwReq.minLength', lang) || 'At least 12 characters' },
    { met: /[A-Z]/.test(password), label: t('citizen.auth.pwReq.uppercase', lang) || 'One uppercase letter' },
    { met: /[a-z]/.test(password), label: t('citizen.auth.pwReq.lowercase', lang) || 'One lowercase letter' },
    { met: /[0-9]/.test(password), label: t('citizen.auth.pwReq.digit', lang) || 'One digit' },
    { met: /[^A-Za-z0-9]/.test(password), label: t('citizen.auth.pwReq.special', lang) || 'One special character' },
    { met: !email || !password.toLowerCase().includes(email.split('@')[0]?.toLowerCase() || '___'), label: t('citizen.auth.pwReq.noEmail', lang) || 'Must not contain your email' },
  ]
  const allPwReqsMet = password.length > 0 && pwRequirements.every(r => r.met)

  //Field blur validation
  const validateFieldOnBlur = async (field: string) => {
    const errors = { ...fieldErrors }
    switch (field) {
      case 'displayName':
        if (!displayName.trim()) errors.displayName = t('citizen.auth.error.displayNameRequired', lang)
        else delete errors.displayName
        break
      case 'email':
        if (!email.trim()) errors.email = t('citizen.auth.error.emailRequired', lang)
        else if (!validateEmail(email.trim())) errors.email = t('citizen.auth.error.invalidEmail', lang)
        else {
          delete errors.email
          //Check server-side availability
          try {
            const avail = await apiCheckAvailability({ email: email.trim() })
            if (avail.emailAvailable === false) {
              errors.email = t('citizen.auth.error.emailTaken', lang) || 'This email is already registered'
            }
          } catch { /* ignore network errors during check */ }
        }
        //Re-validate password if it contains email
        if (password && email && password.toLowerCase().includes(email.split('@')[0]?.toLowerCase() || '___')) {
          errors.password = t('citizen.auth.error.passwordContainsEmail', lang) || 'Password must not contain your email address'
        } else if (password.length >= 12) {
          delete errors.password
        }
        break
      case 'password':
        if (password.length > 0 && password.length < 12) errors.password = t('citizen.auth.error.passwordMin12', lang) || 'Password must be at least 12 characters'
        else if (password && email && password.toLowerCase().includes(email.split('@')[0]?.toLowerCase() || '___')) errors.password = t('citizen.auth.error.passwordContainsEmail', lang) || 'Password must not contain your email address'
        else delete errors.password
        if (confirmPassword && confirmPassword !== password) errors.confirmPassword = t('citizen.auth.error.passwordsNoMatch', lang)
        else if (confirmPassword) delete errors.confirmPassword
        break
      case 'confirmPassword':
        if (confirmPassword && confirmPassword !== password) errors.confirmPassword = t('citizen.auth.error.passwordsNoMatch', lang)
        else delete errors.confirmPassword
        break
      case 'phone':
        if (!localPhone.trim()) {
          errors.phone = t('citizen.auth.error.phoneRequired', lang) || 'Phone number is required'
        } else if (fullPhone.trim().length >= 6) {
          try {
            const avail = await apiCheckAvailability({ phone: fullPhone.trim() })
            if (avail.phoneAvailable === false) {
              errors.phone = t('citizen.auth.error.phoneTaken', lang) || 'This phone number is already registered'
            } else {
              delete errors.phone
            }
          } catch { delete errors.phone }
        } else {
          delete errors.phone
        }
        break
    }
    setFieldErrors(errors)
  }

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
    if (displayName.trim().length < 2) {
      const msg = 'Display name must be at least 2 characters.'
      setError(msg); setNotification({ message: msg, type: 'warning' }); return false
    }
    if (!email.trim()) {
      const msg = t('citizen.auth.error.emailRequired', lang)
      setError(msg)
      setNotification({ message: msg, type: 'warning' })
      return false
    }
    //Client-side email format validation (#50)
    if (!validateEmail(email.trim())) {
      const msg = t('citizen.auth.error.invalidEmail', lang)
      setError(msg)
      setNotification({ message: msg, type: 'warning' })
      return false
    }
    if (password.length < 12) {
      const msg = t('citizen.auth.error.passwordMin12', lang) || 'Password must be at least 12 characters'
      setError(msg)
      setNotification({ message: msg, type: 'warning' })
      return false
    }
    if (!/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password) || !/[^A-Za-z0-9]/.test(password)) {
      const msg = t('citizen.auth.error.passwordComplexity', lang) || 'Password must contain uppercase, lowercase, digit, and special character'
      setError(msg)
      setNotification({ message: msg, type: 'warning' })
      return false
    }
    if (email && password.toLowerCase().includes(email.split('@')[0]?.toLowerCase() || '___')) {
      const msg = t('citizen.auth.error.passwordContainsEmail', lang) || 'Password must not contain your email address'
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

  const validateStep2 = (): boolean => {
    if (!localPhone.trim()) {
      const msg = t('citizen.auth.error.phoneRequired', lang) || 'Phone number is required'
      setError(msg); setNotification({ message: msg, type: 'warning' }); return false
    }
    if (!country) {
      const msg = t('citizen.auth.error.countryRequired', lang) || 'Country is required'
      setError(msg); setNotification({ message: msg, type: 'warning' }); return false
    }
    if (!region) {
      const msg = t('citizen.auth.error.regionRequired', lang) || 'Region is required'
      setError(msg); setNotification({ message: msg, type: 'warning' }); return false
    }
    if (!addressLine.trim()) {
      const msg = t('citizen.auth.error.addressRequired', lang) || 'Address is required'
      setError(msg); setNotification({ message: msg, type: 'warning' }); return false
    }
    //Date of birth smart validation
    if (dateOfBirth) {
      const dob = new Date(dateOfBirth)
      const today = new Date(); today.setHours(0, 0, 0, 0)
      if (dob >= today) {
        const msg = 'Date of birth cannot be today or in the future.'
        setError(msg); setNotification({ message: msg, type: 'warning' }); return false
      }
      const minAgeDate = new Date(today); minAgeDate.setFullYear(minAgeDate.getFullYear() - 13)
      if (dob > minAgeDate) {
        const msg = 'You must be at least 13 years old to create an account.'
        setError(msg); setNotification({ message: msg, type: 'warning' }); return false
      }
      const maxAgeDate = new Date(today); maxAgeDate.setFullYear(maxAgeDate.getFullYear() - 120)
      if (dob < maxAgeDate) {
        const msg = 'Please enter a valid date of birth.'
        setError(msg); setNotification({ message: msg, type: 'warning' }); return false
      }
    }
    setError('')
    return true
  }

  //Translates raw server/network error messages into user-friendly text.
  //Catches CSRF token mismatch and auto-reloads the page so the user never sees
  //a technical security error -- they just get a fresh session cookie automatically.
  const sanitizeError = (msg: string): string | null => {
    if (!msg) return null
    if (msg.includes('CSRF') || msg.includes('Security token') || msg.includes('token mismatch')) {
      //Auto-reload will get a fresh CSRF cookie -- no need to show anything
      window.location.reload()
      return null
    }
    if (msg === 'Request failed' || msg === 'Failed to fetch') return 'Could not reach the server. Please check your connection and try again.'
    if (msg.includes('[object')) return 'An unexpected error occurred. Please try again.'
    return msg
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setSubmitting(true)

    try {
      if (mode === 'register') {
        if (!validateStep1()) { setSubmitting(false); return }
        //Check ToS acceptance (#27)
        if (!tosAccepted) {
          setError(t('citizen.auth.error.tosRequired', lang))
          setNotification({ message: t('citizen.auth.error.tosAccept', lang), type: 'warning' })
          setSubmitting(false)
          return
        }

        const result = await register({
          email: email.trim(),
          password,
          displayName: displayName.trim(),
          phone: fullPhone.trim() || undefined,
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
          //Upload avatar if selected (after registration, user is now authenticated)
          if (avatarFile) {
            try {
              await uploadAvatar(avatarFile)
            } catch (avatarErr: any) {
              console.warn('[CitizenAuth] Avatar upload failed after registration:', avatarErr?.message)
              setNotification({ message: t('citizen.auth.error.avatarUploadFailed', lang), type: 'warning' })
            }
          }
          setTimeout(() => navigate('/citizen/dashboard', { replace: true }), 500)
        } else {
          const raw = result.error || t('citizen.auth.error.registrationFailed', lang)
          const errorMsg = sanitizeError(raw) ?? t('citizen.auth.error.registrationFailed', lang)
          setError(errorMsg)
          setNotification({ message: errorMsg, type: 'error' })
          setRegStep(1) // Go back to step 1 if it's an account error
        }
      } else {
        const result = await login(email.trim(), password)
        if (result.requires2FA && result.tempToken) {
          setTwoFactorRequired(true)
          setTempToken(result.tempToken)
          setTwoFactorCode('')
          setTwoFactorError('')
          setTimeout(() => twoFactorInputRef.current?.focus(), 100)
        } else if (result.success) {
          setNotification({ message: t('citizen.auth.success.login', lang), type: 'success' })
          const returnTo = sessionStorage.getItem('aegis_qr_return_to')
          if (returnTo) {
            sessionStorage.removeItem('aegis_qr_return_to')
            sessionStorage.setItem('aegis_qr_just_logged_in', '1')
          }
          setTimeout(() => navigate(returnTo || '/citizen/dashboard', { replace: true }), 300)
        } else {
          const raw = result.error || t('citizen.auth.error.loginFailed', lang)
          const errorMsg = sanitizeError(raw) ?? t('citizen.auth.error.loginFailed', lang)
          setError(errorMsg)
          setNotification({ message: errorMsg, type: 'error' })
        }
      }
    } catch (err: any) {
      const raw = err.message || t('citizen.auth.error.generic', lang)
      const errorMsg = sanitizeError(raw) ?? t('citizen.auth.error.generic', lang)
      setError(errorMsg)
      setNotification({ message: errorMsg, type: 'error' })
    } finally {
      setSubmitting(false)
    }
  }

  //2FA Challenge handler
  const handle2FASubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setTwoFactorError('')
    const trimmed = twoFactorCode.trim()
    if (!trimmed) { setTwoFactorError('Enter your authentication code.'); return }
    if (twoFactorMode === 'totp' && (trimmed.length !== 6 || !/^\d{6}$/.test(trimmed))) {
      setTwoFactorError('Enter a valid 6-digit code.'); return
    }
    setTwoFactorLoading(true)
    try {
      const res = await apiCitizen2FAAuthenticate(tempToken, trimmed, rememberDevice)
      const returnTo = sessionStorage.getItem('aegis_qr_return_to')
      if (returnTo) {
        sessionStorage.removeItem('aegis_qr_return_to')
        sessionStorage.setItem('aegis_qr_just_logged_in', '1')
      }
      complete2FA(res.token, res.user as CitizenUser, res.preferences as CitizenPreferences | undefined)
      setNotification({ message: t('citizen.auth.success.login', lang), type: 'success' })
      setTimeout(() => navigate(returnTo || '/citizen/dashboard', { replace: true }), 300)
    } catch (err: any) {
      const msg = err.message || 'Verification failed.'
      if (msg.includes('expired') || msg.includes('log in again')) {
        setTwoFactorRequired(false); setTempToken('')
        setError('Session expired. Please log in again.')
      } else {
        setTwoFactorError(msg)
        setTwoFactorCode('')
        twoFactorInputRef.current?.focus()
      }
    } finally { setTwoFactorLoading(false) }
  }

  const handle2FACancel = () => {
    setTwoFactorRequired(false); setTempToken(''); setTwoFactorCode('')
    setTwoFactorError(''); setTwoFactorMode('totp'); setRememberDevice(false)
  }

  const STEPS = [
    { num: 1, label: t('citizen.auth.step.account', lang), icon: Lock },
    { num: 2, label: t('citizen.auth.step.details', lang), icon: User },
    { num: 3, label: t('citizen.auth.step.profile', lang), icon: Camera },
  ]

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-blue-50/30 to-gray-50 dark:from-gray-950 dark:via-gray-900 dark:to-gray-950 flex flex-col relative overflow-hidden">
      {/* Animated atmosphere */}
      <style>{`
        @keyframes aegis-float { 0%, 100% { transform: translate(0, 0) scale(1); } 33% { transform: translate(30px, -25px) scale(1.05); } 66% { transform: translate(-20px, 15px) scale(0.95); } }
        @keyframes aegis-float-r { 0%, 100% { transform: translate(0, 0) scale(1); } 50% { transform: translate(-35px, -20px) scale(1.08); } }
        @keyframes aegis-shake { 0%, 100% { transform: translateX(0); } 10%, 30%, 50%, 70%, 90% { transform: translateX(-4px); } 20%, 40%, 60%, 80% { transform: translateX(4px); } }
        @keyframes aegis-fade-up { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>
      <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden" aria-hidden="true">
        <div className="absolute -top-32 -left-32 w-[500px] h-[500px] bg-aegis-400/8 dark:bg-aegis-500/5 rounded-full blur-3xl" style={{ animation: 'aegis-float 25s ease-in-out infinite' }} />
        <div className="absolute top-1/3 -right-24 w-96 h-96 bg-blue-400/6 dark:bg-blue-500/4 rounded-full blur-3xl" style={{ animation: 'aegis-float-r 30s ease-in-out infinite' }} />
        <div className="absolute -bottom-24 left-1/4 w-80 h-80 bg-amber-300/6 dark:bg-amber-500/4 rounded-full blur-3xl" style={{ animation: 'aegis-float 35s ease-in-out infinite 2s' }} />
      </div>
      {/* Navigation */}
      <nav className="relative bg-white/98 dark:bg-surface-ultra-dark backdrop-blur-2xl text-gray-900 dark:text-white px-4 h-14 flex items-center justify-between shadow-md shadow-gray-200/50 dark:shadow-2xl dark:shadow-black/70 border-b border-gray-200 dark:border-aegis-500/15">
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-aegis-400/40 dark:via-aegis-400/60 to-transparent pointer-events-none" />
        <div className="flex items-center gap-3">
        <Link to="/" className="flex items-center gap-2.5 group">
          <div className="relative w-9 h-9 rounded-xl bg-gradient-to-br from-aegis-500 to-aegis-700 flex items-center justify-center shadow-lg shadow-aegis-500/30 group-hover:shadow-aegis-400/60 transition-all group-hover:scale-105">
            <Shield className="w-5 h-5 text-white drop-shadow-sm" />
            <div className="absolute inset-0 rounded-xl bg-gradient-to-tr from-white/25 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
          </div>
          <div className="hidden sm:block leading-none">
            <div className="flex items-center gap-2">
              <span className="font-black text-sm tracking-wide"><span className="text-aegis-600 dark:text-aegis-400">AEGIS</span></span>
            </div>
            <span className="block text-[9px] text-gray-400 dark:text-aegis-300 tracking-[0.2em] uppercase mt-0.5">{t('citizen.auth.citizenPortal', lang)}</span>
          </div>
        </Link>
        {/* Separator + System Status */}
        <div className="hidden md:block w-px h-8 bg-gradient-to-b from-transparent via-gray-300 dark:via-white/10 to-transparent" />
        <div className="hidden md:flex items-center gap-2">
          <div className="flex items-center gap-1.5 bg-green-50 dark:bg-green-500/10 border border-green-200 dark:border-green-500/20 px-2.5 py-1 rounded-lg">
            <span className="relative flex h-2 w-2"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" /><span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" /></span>
            <span className="text-[10px] font-bold text-green-600 dark:text-green-400">SYSTEM ONLINE</span>
          </div>
          <div className="flex items-center gap-1.5 bg-aegis-50 dark:bg-aegis-500/10 border border-aegis-200 dark:border-aegis-500/20 px-2.5 py-1 rounded-lg">
            <Lock className="w-3 h-3 text-aegis-500" />
            <span className="text-[10px] font-bold text-aegis-600 dark:text-aegis-400">ENCRYPTED</span>
          </div>
        </div>
        </div>
        <div className="flex items-center gap-1.5 sm:gap-2">
          <LanguageSelector darkNav={dark} />
          <ThemeSelector darkNav={dark} />

          {/* Navigate dropdown */}
          <div className="relative" ref={navDropdownRef}>
            <button
              type="button"
              onClick={() => setNavDropdownOpen(v => !v)}
              className="flex items-center gap-2 text-xs font-bold px-3.5 sm:px-4 py-2.5 rounded-xl bg-gray-100 dark:bg-white/5 hover:bg-gray-200 dark:hover:bg-white/10 border border-gray-200 dark:border-white/8 hover:border-aegis-300 dark:hover:border-aegis-500/25 shadow-sm hover:shadow-md transition-all hover:scale-[1.02] active:scale-[0.97] text-gray-700 dark:text-white cursor-pointer select-none min-h-[40px]">
              <Menu className="w-4 h-4" />
              <span className="hidden sm:inline">Navigate</span>
              <ChevronDown className={`w-3.5 h-3.5 opacity-80 transition-transform duration-200 ${navDropdownOpen ? 'rotate-180' : ''}`} />
            </button>
            {navDropdownOpen && (
              <div className="absolute right-0 top-full mt-2 w-72 bg-white dark:bg-gray-900 border border-gray-200/80 dark:border-white/10 rounded-2xl shadow-2xl shadow-black/15 dark:shadow-black/50 overflow-hidden z-[60]" style={{ animation: 'aegis-fade-up 0.18s ease-out' }}>
                <div className="px-4 py-3 bg-gradient-to-r from-aegis-50 to-blue-50/50 dark:from-aegis-950/40 dark:to-blue-950/20 border-b border-gray-200/60 dark:border-white/8">
                  <p className="text-[10px] text-aegis-600 dark:text-aegis-400 font-extrabold uppercase tracking-[0.18em]">Quick Navigation</p>
                </div>
                <div className="p-2 space-y-0.5">
                  <Link to="/" onClick={() => setNavDropdownOpen(false)}
                    className="flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-gray-50 dark:hover:bg-white/5 transition-all duration-150 group cursor-pointer">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-gray-100 to-gray-200/80 dark:from-white/10 dark:to-white/5 flex items-center justify-center group-hover:from-aegis-100 group-hover:to-aegis-200/80 dark:group-hover:from-aegis-500/15 dark:group-hover:to-aegis-600/10 transition-all duration-150 flex-shrink-0">
                      <Home className="w-[18px] h-[18px] text-gray-500 dark:text-white/60 group-hover:text-aegis-600 dark:group-hover:text-aegis-400 transition-colors duration-150" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-bold text-gray-900 dark:text-white group-hover:text-aegis-700 dark:group-hover:text-aegis-300 transition-colors">Home</p>
                      <p className="text-[10px] text-gray-400 dark:text-white/40 mt-0.5 leading-tight">Return to the main landing page</p>
                    </div>
                    <ArrowRight className="w-4 h-4 text-gray-300 dark:text-white/15 group-hover:text-aegis-500 dark:group-hover:text-aegis-400 group-hover:translate-x-1 transition-all duration-150 flex-shrink-0" />
                  </Link>
                  <Link to="/citizen" onClick={() => setNavDropdownOpen(false)}
                    className="flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-aegis-50/70 dark:hover:bg-aegis-500/5 transition-all duration-150 group cursor-pointer">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-aegis-50 to-aegis-100/80 dark:from-aegis-500/10 dark:to-aegis-600/5 flex items-center justify-center group-hover:from-aegis-100 group-hover:to-aegis-200/80 dark:group-hover:from-aegis-500/20 dark:group-hover:to-aegis-600/10 transition-all duration-150 flex-shrink-0">
                      <MapPin className="w-[18px] h-[18px] text-aegis-500 dark:text-aegis-400 group-hover:text-aegis-600 dark:group-hover:text-aegis-300 transition-colors duration-150" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-bold text-gray-900 dark:text-white group-hover:text-aegis-700 dark:group-hover:text-aegis-300 transition-colors">Disaster Map</p>
                      <p className="text-[10px] text-gray-400 dark:text-white/40 mt-0.5 leading-tight">Live incident map &amp; public alerts</p>
                    </div>
                    <ArrowRight className="w-4 h-4 text-gray-300 dark:text-white/15 group-hover:text-aegis-500 dark:group-hover:text-aegis-400 group-hover:translate-x-1 transition-all duration-150 flex-shrink-0" />
                  </Link>
                  <Link to="/admin" onClick={() => setNavDropdownOpen(false)}
                    className="flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-blue-50/70 dark:hover:bg-blue-500/5 transition-all duration-150 group cursor-pointer">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-50 to-blue-100/80 dark:from-blue-500/10 dark:to-blue-600/5 flex items-center justify-center group-hover:from-blue-100 group-hover:to-blue-200/80 dark:group-hover:from-blue-500/20 dark:group-hover:to-blue-600/10 transition-all duration-150 flex-shrink-0">
                      <Shield className="w-[18px] h-[18px] text-blue-500 dark:text-blue-400 group-hover:text-blue-600 dark:group-hover:text-blue-300 transition-colors duration-150" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-bold text-gray-900 dark:text-white group-hover:text-blue-700 dark:group-hover:text-blue-300 transition-colors">Operator Portal</p>
                      <p className="text-[10px] text-gray-400 dark:text-white/40 mt-0.5 leading-tight">Admin operations & management</p>
                    </div>
                    <ArrowRight className="w-4 h-4 text-gray-300 dark:text-white/15 group-hover:text-blue-500 dark:group-hover:text-blue-400 group-hover:translate-x-1 transition-all duration-150 flex-shrink-0" />
                  </Link>
                </div>
                <div className="px-4 py-2.5 border-t border-gray-100 dark:border-white/5 flex items-center gap-2">
                  <span className="relative flex h-1.5 w-1.5"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" /><span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-green-500" /></span>
                  <span className="text-[9px] font-bold text-green-600/70 dark:text-green-400/60">ONLINE</span>
                  <span className="text-gray-200 dark:text-white/10">-</span>
                  <Lock className="w-2.5 h-2.5 text-aegis-400/50" />
                  <span className="text-[9px] font-bold text-aegis-500/50 dark:text-aegis-400/40">ENCRYPTED</span>
                </div>
              </div>
            )}
          </div>

          {/* Explore (guest access) */}
          <Link to="/citizen" className="relative text-xs font-bold px-3.5 py-2.5 rounded-xl overflow-hidden group bg-aegis-600 hover:bg-aegis-700 shadow-lg shadow-aegis-600/20 hover:shadow-aegis-400/40 transition-all hover:scale-[1.03] active:scale-[0.97] text-white min-h-[40px] flex items-center">
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-700 ease-in-out" />
            <span className="relative z-10">{t('citizen.auth.guestContinue', lang)}</span>
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

        <div className="w-full max-w-md mx-auto">
          {/* 2FA Challenge Screen */}
          {twoFactorRequired ? (
            <div className="space-y-6" style={{ animation: 'aegis-fade-up 0.3s ease-out' }}>
              <div className="text-center">
                <div className="w-16 h-16 bg-gradient-to-br from-aegis-500 to-aegis-700 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg shadow-aegis-600/30">
                  <Shield className="w-8 h-8 text-white" />
                </div>
                <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Two-Factor Authentication</h2>
                <p className="text-sm text-gray-500 dark:text-gray-300 mt-1">
                  {twoFactorMode === 'totp' ? 'Enter the 6-digit code from your authenticator app' : 'Enter one of your backup recovery codes'}
                </p>
              </div>

              {twoFactorError && (
                <div className="bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 px-3 py-2 rounded-xl text-sm flex items-center gap-2" role="alert">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />{twoFactorError}
                </div>
              )}

              <form onSubmit={handle2FASubmit} className="bg-white dark:bg-gray-900/60 border border-gray-200 dark:border-gray-700/50 rounded-2xl p-6 shadow-xl shadow-gray-200/30 dark:shadow-black/20 space-y-4">
                {/* Mode tabs */}
                <div className="flex bg-gray-100 dark:bg-gray-800 rounded-xl p-1">
                  <button type="button" onClick={() => { setTwoFactorMode('totp'); setTwoFactorCode(''); setTwoFactorError('') }}
                    className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-all ${twoFactorMode === 'totp' ? 'bg-white dark:bg-gray-700 text-aegis-700 dark:text-aegis-300 shadow-sm' : 'text-gray-500 dark:text-gray-400'}`}>
                    Authenticator Code
                  </button>
                  <button type="button" onClick={() => { setTwoFactorMode('backup'); setTwoFactorCode(''); setTwoFactorError('') }}
                    className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-all ${twoFactorMode === 'backup' ? 'bg-white dark:bg-gray-700 text-aegis-700 dark:text-aegis-300 shadow-sm' : 'text-gray-500 dark:text-gray-400'}`}>
                    Backup Code
                  </button>
                </div>

                {/* Code input */}
                <div>
                  <input
                    ref={twoFactorInputRef}
                    type="text"
                    inputMode={twoFactorMode === 'totp' ? 'numeric' : 'text'}
                    autoComplete="one-time-code"
                    placeholder={twoFactorMode === 'totp' ? '000000' : 'XXXX-XXXX'}
                    value={twoFactorCode}
                    onChange={e => setTwoFactorCode(twoFactorMode === 'totp' ? e.target.value.replace(/\D/g, '').slice(0, 6) : e.target.value)}
                    maxLength={twoFactorMode === 'totp' ? 6 : 20}
                    className="w-full text-center text-xl font-mono tracking-[0.3em] py-3 bg-gray-50 dark:bg-gray-800/60 rounded-xl border border-gray-200 dark:border-gray-700 focus:border-aegis-500 focus:ring-2 focus:ring-aegis-500/20 outline-none"
                  />
                </div>

                {/* Remember device */}
                <label className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                  <input type="checkbox" checked={rememberDevice} onChange={e => setRememberDevice(e.target.checked)} className="rounded border-gray-300 text-aegis-600 focus:ring-aegis-500" />
                  Trust this device for 30 days
                </label>

                {/* Buttons */}
                <div className="flex gap-2">
                  <button type="button" onClick={handle2FACancel}
                    className="flex-1 py-3 text-sm font-semibold rounded-xl border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
                    <ArrowLeft className="w-4 h-4 inline mr-1" />Back
                  </button>
                  <button type="submit" disabled={twoFactorLoading || !twoFactorCode.trim()}
                    className="flex-1 py-3 text-sm font-semibold rounded-xl bg-gradient-to-r from-aegis-600 to-aegis-700 text-white hover:from-aegis-700 hover:to-aegis-800 disabled:from-gray-300 disabled:to-gray-400 disabled:cursor-not-allowed transition-all shadow-lg shadow-aegis-600/20 flex items-center justify-center gap-2">
                    {twoFactorLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Shield className="w-4 h-4" />}
                    Verify
                  </button>
                </div>
              </form>
            </div>
          ) : (
          <>
          {/* Auth Form */}
          {/* Header */}
          <div className="text-center mb-6">
            <div className="w-16 h-16 bg-gradient-to-br from-aegis-500 to-aegis-700 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg shadow-aegis-600/30">
              <Shield className="w-8 h-8 text-white" />
            </div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
              {mode === 'login' ? t('citizen.auth.loginTitle', lang) : t('citizen.auth.registerTitle', lang)}
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-300 mt-1">
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
                  : 'text-gray-500 dark:text-gray-300 hover:text-gray-700 dark:hover:text-gray-300 dark:text-gray-300'
              }`}
            >
              {t('auth.login', lang)}
            </button>
            <button
              onClick={() => { setMode('register'); setError('') }}
              className={`flex-1 py-2.5 text-sm font-semibold rounded-lg transition-all ${
                mode === 'register'
                  ? 'bg-white dark:bg-gray-700 text-aegis-700 dark:text-aegis-300 shadow-sm'
                  : 'text-gray-500 dark:text-gray-300 hover:text-gray-700 dark:hover:text-gray-300 dark:text-gray-300'
              }`}
            >
              {t('citizen.auth.register', lang)}
            </button>
          </div>

          {/* Forgot Password Mode */}
          {mode === 'forgot' && (
            <div className="bg-white/80 dark:bg-gray-900/80 backdrop-blur-xl rounded-2xl border border-gray-200/80 dark:border-gray-700/50 p-6 shadow-2xl shadow-gray-300/20 dark:shadow-black/40 space-y-4" style={{ animation: 'aegis-fade-up 0.6s ease-out' }}>
              <div className="text-center">
                <Mail className="w-10 h-10 text-aegis-600 mx-auto mb-2" />
                <h3 className="text-lg font-bold text-gray-900 dark:text-white">{t('citizen.auth.forgot.title', lang)}</h3>
                <p className="text-xs text-gray-500 dark:text-gray-300 mt-1">{t('citizen.auth.forgot.subtitle', lang)}</p>
              </div>
              {forgotSent ? (
                <div className="bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 p-4 rounded-xl text-center">
                  <CheckCircle className="w-8 h-8 text-green-500 mx-auto mb-2" />
                  <p className="text-sm font-semibold text-green-800 dark:text-green-300">{t('citizen.auth.forgot.sent', lang)}</p>
                  <p className="text-xs text-green-600 dark:text-green-400 mt-1">{t('citizen.auth.forgot.sentDesc', lang)}</p>
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
                    //Always show success to prevent email enumeration
                    setForgotSent(true)
                  } catch {
                    setForgotSent(true)
                  } finally {
                    setSubmitting(false)
                  }
                }} className="space-y-3">
                  <div className="relative">
                    <Mail className="absolute left-3 top-2.5 w-4 h-4 text-gray-400 dark:text-gray-300" />
                    <input type="email" value={forgotEmail} onChange={e => setForgotEmail(e.target.value)}
                      className="w-full pl-10 pr-3 py-2.5 text-sm bg-gray-50 dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 focus:ring-2 focus:ring-aegis-500 transition"
                      placeholder="your@email.com" required autoComplete="email" />
                  </div>
                  <button type="submit" disabled={submitting}
                    className="w-full bg-gradient-to-r from-amber-400 via-yellow-300 to-amber-400 hover:from-amber-500 hover:via-yellow-400 hover:to-amber-500 text-black disabled:bg-gray-300 disabled:bg-none disabled:text-gray-500 dark:text-gray-300 py-3 rounded-xl font-semibold text-sm shadow flex items-center justify-center gap-2 transition-all">
                    {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
                    {submitting ? t('citizen.auth.forgot.sending', lang) : t('citizen.auth.forgot.sendResetLink', lang)}
                  </button>
                </form>
              )}
              <button onClick={() => { setMode('login'); setError(''); setForgotSent(false); setForgotEmail('') }}
                className="w-full text-xs text-aegis-600 hover:text-aegis-700 font-semibold py-2">
 {'<-'} {t('citizen.auth.forgot.backToLogin', lang)}
              </button>
            </div>
          )}

          {/* Step Indicator (register only) */}
          {mode === 'register' && (
            <div className="flex items-center justify-center gap-2 mb-5" role="list" aria-label="Registration steps">
              {STEPS.map((s, i) => (
                <div key={s.num} className="flex items-center gap-2" role="listitem">
                  <button
                    onClick={() => { if (s.num < regStep || (s.num === 2 && validateStep1()) || s.num <= regStep) { setError(''); setRegStep(s.num) } }}
                    aria-current={regStep === s.num ? 'step' : undefined}
                    aria-label={`Step ${s.num} of ${STEPS.length}: ${s.label}${regStep > s.num ? ' (completed)' : regStep === s.num ? ' (current)' : ''}`}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all ${
                      regStep === s.num
                        ? 'bg-aegis-600 text-white shadow-md'
                        : regStep > s.num
                        ? 'bg-green-100 dark:bg-green-950/30 text-green-700 dark:text-green-300'
                        : 'bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-300'
                    }`}
                  >
                    {regStep > s.num ? <CheckCircle className="w-3.5 h-3.5" /> : <s.icon className="w-3.5 h-3.5" />}
                    <span className="hidden sm:inline">{s.label}</span>
                    <span className="sm:hidden">{s.num}</span>
                  </button>
                  {i < STEPS.length - 1 && <ChevronRight className="w-3.5 h-3.5 text-gray-300 dark:text-gray-300" />}
                </div>
              ))}
            </div>
          )}

          {/* Session expired banner */}
          {sessionExpired && (
            <div role="status" aria-live="polite" className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300 p-3 rounded-xl flex items-center gap-2 mb-4 text-sm" style={{ animation: 'aegis-fade-up 0.4s ease-out' }}>
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              Your session has expired. Please sign in again.
              <button onClick={() => { searchParams.delete('session'); setSearchParams(searchParams, { replace: true }) }} className="ml-auto text-amber-500 hover:text-amber-700 dark:hover:text-amber-200 transition-colors" aria-label="Dismiss">&times;</button>
            </div>
          )}

          {/* Error */}
          {error && (
            <div key={error} role="alert" aria-live="assertive" className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 p-3 rounded-xl flex items-center gap-2 mb-4 text-sm" style={{ animation: 'aegis-shake 0.5s ease-in-out' }}>
              <AlertCircle className="w-4 h-4 flex-shrink-0" />{error}
            </div>
          )}

          {/* Form -- shown for login and register modes only */}
          {mode !== 'forgot' && (
          <form onSubmit={handleSubmit} className="bg-white/80 dark:bg-gray-900/80 backdrop-blur-xl rounded-2xl border border-gray-200/80 dark:border-gray-700/50 p-6 shadow-2xl shadow-gray-300/20 dark:shadow-black/40 space-y-4" style={{ animation: 'aegis-fade-up 0.6s ease-out' }}>

            {/*  LOGIN FORM  */}
            {mode === 'login' && (
              <>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1.5">{t('citizen.auth.emailAddress', lang)}</label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-2.5 w-4 h-4 text-gray-400 dark:text-gray-300" />
                    <input type="email" value={email} onChange={e => setEmail(e.target.value)} disabled={submitting}
                      className="w-full pl-10 pr-3 py-2.5 text-sm bg-gray-50 dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 focus:ring-2 focus:ring-aegis-500 focus:border-transparent transition disabled:opacity-50 disabled:cursor-not-allowed"
                      placeholder={t('subscribe.placeholder.email', lang)} required aria-required="true" autoComplete="email" />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1.5">{t('citizen.auth.passwordLabel', lang)}</label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-2.5 w-4 h-4 text-gray-400 dark:text-gray-300" />
                    <input type={showPassword ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} disabled={submitting}
                      className="w-full pl-10 pr-10 py-2.5 text-sm bg-gray-50 dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 focus:ring-2 focus:ring-aegis-500 focus:border-transparent transition disabled:opacity-50 disabled:cursor-not-allowed"
                      placeholder={t('citizen.auth.passwordPlaceholder', lang)} required aria-required="true" autoComplete="current-password" />
                    <button type="button" onClick={() => setShowPassword(!showPassword)} disabled={submitting} className="absolute right-3 top-2.5 text-gray-400 dark:text-gray-300 hover:text-gray-600 disabled:cursor-not-allowed" aria-label={showPassword ? 'Hide password' : 'Show password'}>
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
                <button type="submit" disabled={submitting}
                  className="w-full bg-gradient-to-r from-amber-400 via-yellow-300 to-amber-400 hover:from-amber-500 hover:via-yellow-400 hover:to-amber-500 text-black active:brightness-90 disabled:bg-gray-300 disabled:bg-none disabled:text-gray-500 dark:text-gray-300 py-3 rounded-xl font-semibold text-sm shadow-lg shadow-amber-500/30 disabled:shadow-none flex items-center justify-center gap-2 transition-all duration-200 disabled:cursor-not-allowed">
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
                    {t('citizen.auth.forgotPassword', lang)}
                  </button>
                </div>

                {/*  --- Alternative Sign-In Methods --- */}
                <div className="relative my-3">
                  <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-gray-200 dark:border-gray-700" /></div>
                  <div className="relative flex justify-center text-xs">
                    <span className="px-3 bg-white dark:bg-gray-900 text-gray-400 dark:text-gray-300">{t('citizen.auth.orContinueWith', lang) || 'or continue with'}</span>
                  </div>
                </div>

                {/* Google OAuth */}
                <div>
                  <a href={`${API_BASE}/api/auth/google`}
                    className="w-full flex items-center justify-center gap-2 py-2.5 px-3 border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-750 transition text-sm font-medium text-gray-700 dark:text-gray-200 shadow-sm">
                    <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
                    <span className="truncate">Sign in with Google</span>
                  </a>
                </div>

                {/* Expandable advanced methods */}
                <button type="button" onClick={() => setShowMoreAuth(prev => !prev)}
                  className="w-full flex items-center justify-center gap-1.5 py-2 text-xs font-medium text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition">
                  <span>{showMoreAuth ? 'Hide' : 'More sign-in options'}</span>
                  <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showMoreAuth ? 'rotate-180' : ''}`} />
                </button>

                {showMoreAuth && (
                  <div className="space-y-2 animate-[aegis-fade-up_0.25s_ease-out]">

                    {/* Emergency QR */}
                    <Link to="/citizen/qr-auth"
                      className="w-full flex items-center gap-3 py-2.5 px-4 border border-red-200 dark:border-red-800/60 rounded-xl bg-red-50/50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-900/30 transition text-sm text-red-700 dark:text-red-300 shadow-sm">
                      <div className="w-8 h-8 rounded-lg bg-red-100 dark:bg-red-900/40 flex items-center justify-center flex-shrink-0">
                        <QrCode className="w-4 h-4 text-red-600 dark:text-red-400" />
                      </div>
                      <div className="text-left min-w-0">
                        <p className="font-medium text-sm">Emergency QR</p>
                        <p className="text-[11px] text-red-500/70 dark:text-red-400/60">Scan from kiosk or phone -- no password needed</p>
                      </div>
                      <ChevronRight className="w-4 h-4 text-red-300 dark:text-red-600 ml-auto flex-shrink-0" />
                    </Link>
                  </div>
                )}
              </>
            )}

            {/*  REGISTER STEP 1 -- Account  */}
            {mode === 'register' && regStep === 1 && (
              <>
                {/* Honeypot -- hidden from real users, catches bots */}
                <div className="absolute -left-[9999px]" aria-hidden="true" tabIndex={-1}>
                  <label htmlFor="website">Website</label>
                  <input type="text" id="website" name="website" autoComplete="off" tabIndex={-1}
                    onChange={e => { (e.target as any)._hp = e.target.value }} />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1.5">{t('citizen.auth.displayName', lang)} *</label>
                  <div className="relative">
                    <User className="absolute left-3 top-2.5 w-4 h-4 text-gray-400 dark:text-gray-300" />
                    <input type="text" value={displayName} onChange={e => setDisplayName(e.target.value)} onBlur={() => validateFieldOnBlur('displayName')}
                      className={`w-full pl-10 pr-3 py-2.5 text-sm bg-gray-50 dark:bg-gray-800 rounded-xl border focus:ring-2 focus:ring-aegis-500 focus:border-transparent transition ${fieldErrors.displayName ? 'border-red-300 dark:border-red-700' : 'border-gray-200 dark:border-gray-700'}`}
                      placeholder={t('citizen.auth.displayName', lang)} required autoComplete="name" />
                  </div>
                  {fieldErrors.displayName && <p className="text-[10px] text-red-500 mt-1">{fieldErrors.displayName}</p>}
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1.5">{t('citizen.auth.emailAddress', lang)} *</label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-2.5 w-4 h-4 text-gray-400 dark:text-gray-300" />
                    <input type="email" value={email} onChange={e => setEmail(e.target.value)} onBlur={() => validateFieldOnBlur('email')}
                      className={`w-full pl-10 pr-3 py-2.5 text-sm bg-gray-50 dark:bg-gray-800 rounded-xl border focus:ring-2 focus:ring-aegis-500 focus:border-transparent transition ${fieldErrors.email ? 'border-red-300 dark:border-red-700' : 'border-gray-200 dark:border-gray-700'}`}
                      placeholder={t('subscribe.placeholder.email', lang)} required aria-required="true" autoComplete="email" />
                  </div>
                  {fieldErrors.email && <p className="text-[10px] text-red-500 mt-1">{fieldErrors.email}</p>}
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1.5">{t('citizen.auth.passwordLabel', lang)} *</label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-2.5 w-4 h-4 text-gray-400 dark:text-gray-300" />
                    <input type={showPassword ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} onBlur={() => validateFieldOnBlur('password')}
                      className={`w-full pl-10 pr-10 py-2.5 text-sm bg-gray-50 dark:bg-gray-800 rounded-xl border focus:ring-2 focus:ring-aegis-500 focus:border-transparent transition ${fieldErrors.password ? 'border-red-300 dark:border-red-700' : password && allPwReqsMet ? 'border-green-300 dark:border-green-700' : 'border-gray-200 dark:border-gray-700'}`}
                      placeholder={t('citizen.auth.passwordMin', lang)} required aria-required="true" autoComplete="new-password" />
                    <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-2.5 text-gray-400 dark:text-gray-300 hover:text-gray-600" aria-label={showPassword ? 'Hide password' : 'Show password'}>
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  {password.length > 0 && (
                    <div className="mt-2 space-y-1.5" aria-live="polite" aria-atomic="true">
                      <div className="flex gap-1" role="progressbar" aria-valuemin={0} aria-valuemax={5} aria-valuenow={pwStrength.score} aria-label={`Password strength: ${pwStrength.label}`}>
                        {[1,2,3,4,5].map(i => (
                          <div key={i} className={`h-1.5 flex-1 rounded-full transition-all ${i <= pwStrength.score ? pwStrength.color : 'bg-gray-200 dark:bg-gray-700'}`} />
                        ))}
                      </div>
                      <p className="text-[10px] text-gray-600 dark:text-gray-300">{pwStrength.label}</p>
                      <div className="grid grid-cols-2 gap-x-2 gap-y-0.5">
                        {pwRequirements.map((req, ri) => (
                          <p key={ri} className={`text-[10px] flex items-center gap-1 ${req.met ? 'text-green-600 dark:text-green-400' : 'text-gray-400 dark:text-gray-500'}`}>
                            {req.met ? <CheckCircle className="w-2.5 h-2.5 flex-shrink-0" /> : <span className="w-2.5 h-2.5 rounded-full border border-current flex-shrink-0" />}
                            {req.label}
                          </p>
                        ))}
                      </div>
                    </div>
                  )}
                  {fieldErrors.password && <p className="text-[10px] text-red-500 mt-1">{fieldErrors.password}</p>}
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1.5">{t('citizen.auth.confirmPassword', lang)} *</label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-2.5 w-4 h-4 text-gray-400 dark:text-gray-300" />
                    <input type={showPassword ? 'text' : 'password'} value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} onBlur={() => validateFieldOnBlur('confirmPassword')}
                      className={`w-full pl-10 pr-10 py-2.5 text-sm bg-gray-50 dark:bg-gray-800 rounded-xl border focus:ring-2 focus:ring-aegis-500 focus:border-transparent transition ${
                        confirmPassword && confirmPassword !== password ? 'border-red-300 dark:border-red-700' :
                        confirmPassword && confirmPassword === password ? 'border-green-300 dark:border-green-700' :
                        'border-gray-200 dark:border-gray-700'
                      }`} placeholder={t('citizen.auth.repeatPassword', lang)} required autoComplete="new-password" />
                    {confirmPassword && confirmPassword === password && <CheckCircle className="absolute right-3 top-2.5 w-4 h-4 text-green-500" />}
                  </div>
                  {fieldErrors.confirmPassword && <p className="text-[10px] text-red-500 mt-1">{fieldErrors.confirmPassword}</p>}
                </div>
                <button type="button" onClick={() => { if (validateStep1()) setRegStep(2) }}
                  disabled={!allPwReqsMet || !displayName.trim() || !email.trim() || password !== confirmPassword}
                  className="w-full bg-gradient-to-r from-amber-400 via-yellow-300 to-amber-400 hover:from-amber-500 hover:via-yellow-400 hover:to-amber-500 text-black disabled:opacity-50 disabled:cursor-not-allowed py-3 rounded-xl font-semibold text-sm shadow-lg shadow-amber-500/30 flex items-center justify-center gap-2 transition-all">
                  {t('citizen.auth.continue', lang)} <ArrowRight className="w-4 h-4" />
                </button>
              </>
            )}

            {/*  REGISTER STEP 2 -- Personal Details  */}
            {mode === 'register' && regStep === 2 && (
              <>
                {/* Country + City -- must come FIRST so dial code can auto-fill phone */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1.5">{t('citizen.auth.country', lang)} *</label>
                    <ProfileCountryPicker
                      value={country}
                      onChange={(c) => { setCountry(c); setRegion('') }}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1.5">{t('citizen.auth.city', lang)} <span className="font-normal">({t('citizen.auth.optional', lang)})</span></label>
                    <div className="relative">
                      <Building2 className="absolute left-3 top-2.5 w-4 h-4 text-gray-400 dark:text-gray-300" />
                      <input type="text" value={city} onChange={e => setCity(e.target.value)}
                        className="w-full pl-10 pr-3 py-2.5 text-sm bg-gray-50 dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 focus:ring-2 focus:ring-aegis-500 focus:border-transparent transition"
                        placeholder={t('citizen.auth.city', lang)} autoComplete="address-level2" />
                    </div>
                  </div>
                </div>

                {/* Phone -- split dial-prefix + local number */}
                <div>
                  <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1.5">
                    {t('citizen.auth.phone', lang)} *
                    {country && <span className="font-normal text-gray-400 dark:text-gray-500 ml-1">({phoneMaxLocal} digits)</span>}
                  </label>
                  <div className={`flex rounded-xl border overflow-hidden focus-within:ring-2 focus-within:ring-aegis-500 transition ${
                    fieldErrors.phone ? 'border-red-300 dark:border-red-700' : 'border-gray-200 dark:border-gray-700'
                  }`}>
                    {/* Dial-code prefix badge */}
                    <div className="flex items-center gap-1.5 px-3 py-2.5 bg-gray-100 dark:bg-gray-700 border-r border-gray-200 dark:border-gray-600 select-none whitespace-nowrap">
                      {phoneCountryEntry ? (
                        <><img src={getFlagUrl(phoneCountryEntry.code.toLowerCase(), 16)} className="w-4 h-3 object-cover rounded-sm flex-shrink-0" alt="" />
                        <span className="text-sm font-semibold text-gray-700 dark:text-gray-200">{dialCode}</span></>
                      ) : (
                        <Phone className="w-4 h-4 text-gray-400" />
                      )}
                    </div>
                    {/* Local number input */}
                    <input
                      type="tel"
                      value={localPhone}
                      onChange={e => {
                        const raw = e.target.value.replace(/[^\d\s\-\(\)]/g, '')
                        if (raw.replace(/\D/g, '').length <= phoneMaxLocal) setLocalPhone(raw)
                      }}
                      onBlur={() => validateFieldOnBlur('phone')}
                      className="flex-1 min-w-0 px-3 py-2.5 text-sm bg-gray-50 dark:bg-gray-800 focus:outline-none text-gray-900 dark:text-gray-100 placeholder-gray-400"
                      placeholder={country ? `Local number (max ${phoneMaxLocal} digits)` : 'Select a country first'}
                      autoComplete="tel-national"
                      required
                      disabled={!country}
                    />
                  </div>
                  {fieldErrors.phone && <p className="text-[10px] text-red-500 mt-1">{fieldErrors.phone}</p>}
                </div>

                {country && (
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1.5">{t('citizen.auth.region', lang)} *</label>
                    <div className="relative">
                      <MapPin className="absolute left-3 top-2.5 w-4 h-4 text-gray-400 dark:text-gray-300 z-10" />
                      <div className="pl-10">
                        <ProfileRegionPicker
                          country={country}
                          value={region}
                          onChange={setRegion}
                        />
                      </div>
                    </div>
                  </div>
                )}

                <div>
                  <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1.5">{t('citizen.auth.addressLine', lang)} *</label>
                  <div className="relative">
                    <Home className="absolute left-3 top-2.5 w-4 h-4 text-gray-400 dark:text-gray-300" />
                    <input type="text" value={addressLine} onChange={e => setAddressLine(e.target.value)}
                      className="w-full pl-10 pr-3 py-2.5 text-sm bg-gray-50 dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 focus:ring-2 focus:ring-aegis-500 focus:border-transparent transition"
                      placeholder={t('citizen.auth.addressLine', lang)} autoComplete="street-address" required />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1.5">{t('citizen.auth.dateOfBirth', lang)} <span className="font-normal">({t('citizen.auth.optional', lang)})</span></label>
                  <div className="relative">
                    <Calendar className="absolute left-3 top-2.5 w-4 h-4 text-gray-400 dark:text-gray-300" />
                    <input type="date" value={dateOfBirth} onChange={e => setDateOfBirth(e.target.value)}
                      max={(() => { const d = new Date(); d.setDate(d.getDate() - 1); return d.toISOString().split('T')[0] })()}
                      min={(() => { const d = new Date(); d.setFullYear(d.getFullYear() - 120); return d.toISOString().split('T')[0] })()}
                      className="w-full pl-10 pr-3 py-2.5 text-sm bg-gray-50 dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 focus:ring-2 focus:ring-aegis-500 focus:border-transparent transition" />
                  </div>
                </div>

                <div className="flex gap-3">
                  <button type="button" onClick={() => setRegStep(1)}
                    className="flex-1 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 py-3 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 transition-all">
                    <ArrowLeft className="w-4 h-4" /> {t('citizen.auth.back', lang)}
                  </button>
                  <button type="button" onClick={() => { if (validateStep2()) { setError(''); setRegStep(3) } }}
                    className="flex-1 bg-gradient-to-r from-amber-400 via-yellow-300 to-amber-400 hover:from-amber-500 hover:via-yellow-400 hover:to-amber-500 text-black py-3 rounded-xl font-semibold text-sm shadow-lg shadow-amber-500/30 flex items-center justify-center gap-2 transition-all">
                    {t('citizen.auth.continue', lang)} <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              </>
            )}

            {/*  REGISTER STEP 3 -- Profile Photo, Bio, Vulnerability, Status  */}
            {mode === 'register' && regStep === 3 && (
              <>
                {/* Profile Photo Upload */}
                <div className="flex flex-col items-center gap-3">
                  <p className="text-xs font-semibold text-gray-600 dark:text-gray-300">{t('citizen.auth.profilePhoto', lang)} <span className="font-normal">({t('citizen.auth.optional', lang)})</span></p>
                  <div className="relative group cursor-pointer" onClick={() => fileInputRef.current?.click()}>
                    {avatarPreview ? (
                      <img src={avatarPreview} className="w-24 h-24 rounded-full object-cover border-4 border-gray-100 dark:border-gray-800 shadow-lg" alt="Avatar preview" />
                    ) : (
                      <div className="w-24 h-24 rounded-full bg-aegis-50 dark:bg-amber-950/30 border-4 border-gray-100 dark:border-gray-800 flex items-center justify-center shadow-lg">
                        <Camera className="w-8 h-8 text-aegis-400" />
                      </div>
                    )}
                    <div className="absolute inset-0 rounded-full bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                      <Camera className="w-6 h-6 text-white" />
                    </div>
                    <input ref={fileInputRef} type="file" accept="image/*" onChange={handleAvatarSelect} className="hidden" />
                  </div>
                  <p className="text-[10px] text-gray-400 dark:text-gray-300">{t('citizen.auth.clickUpload', lang)}</p>
                </div>

                {/* Bio */}
                <div>
                  <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1.5">{t('citizen.auth.bio', lang)} <span className="font-normal">({t('citizen.auth.optional', lang)})</span></label>
                  <div className="relative">
                    <FileText className="absolute left-3 top-2.5 w-4 h-4 text-gray-400 dark:text-gray-300" />
                    <textarea value={bio} onChange={e => setBio(e.target.value)}
                      className="w-full pl-10 pr-3 py-2.5 text-sm bg-gray-50 dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 focus:ring-2 focus:ring-aegis-500 focus:border-transparent transition resize-none"
                      placeholder={t('citizen.auth.bioPlaceholder', lang)} rows={2} />
                  </div>
                </div>

                {/* Status Color */}
                <div>
                  <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-2">{t('citizen.auth.statusTitle', lang)}</label>
                  <div className="grid grid-cols-3 gap-1.5 sm:gap-2">
                    {STATUS_OPTIONS.map(s => (
                      <button key={s.value} type="button" onClick={() => setStatusColor(s.value)}
                        className={`p-2 sm:p-3 rounded-xl border-2 transition-all text-center min-h-[60px] ${
                          statusColor === s.value
                            ? `border-current ${s.ring} ring-2 ring-offset-1`
                            : 'border-gray-200 dark:border-gray-700'
                        }`}>
                        <div className={`w-4 h-4 ${s.color} rounded-full mx-auto mb-1.5 ${statusColor === s.value ? 'animate-pulse' : ''}`} />
                        <p className="text-xs font-semibold text-gray-900 dark:text-white">{t(s.labelKey, lang)}</p>
                        <p className="text-[9px] text-gray-500 dark:text-gray-300 mt-0.5">{t(s.descKey, lang)}</p>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Vulnerability Indicator */}
                <div className="bg-aegis-50 dark:bg-amber-950/20 border border-aegis-200 dark:border-aegis-800/50 rounded-xl p-4">
                  <label className="flex items-start gap-3 cursor-pointer">
                    <input type="checkbox" checked={isVulnerable} onChange={e => setIsVulnerable(e.target.checked)}
                      className="mt-0.5 w-4 h-4 rounded border-aegis-300 text-aegis-600 focus:ring-aegis-500" />
                    <div className="flex-1">
                      <div className="flex items-center gap-1.5">
                        <Heart className="w-4 h-4 text-aegis-600" />
                        <span className="text-sm font-semibold text-aegis-800 dark:text-aegis-300">{t('citizen.auth.vulnerabilityTitle', lang)}</span>
                      </div>
                      <p className="text-[11px] text-aegis-600 dark:text-aegis-400 mt-1">
                        {t('citizen.auth.vulnerabilityHint', lang)}
                      </p>
                    </div>
                  </label>
                  {isVulnerable && (
                    <textarea value={vulnerabilityDetails} onChange={e => setVulnerabilityDetails(e.target.value)}
                      placeholder={t('citizen.auth.vulnerabilityPlaceholder', lang)}
                      className="w-full mt-3 p-2.5 text-sm bg-white dark:bg-gray-800 rounded-lg border border-aegis-200 dark:border-aegis-700 focus:ring-2 focus:ring-aegis-500 focus:border-transparent transition resize-none" rows={2} />
                  )}
                </div>

                {/* Terms of Service & Privacy Policy consent (#27) */}
                <label className="flex items-start gap-3 p-3 bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl cursor-pointer">
                  <input type="checkbox" checked={tosAccepted} onChange={e => setTosAccepted(e.target.checked)}
                    className="mt-0.5 w-4 h-4 rounded border-gray-300 text-aegis-600 focus:ring-aegis-500" />
                  <div className="flex-1">
                    <p className="text-xs font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-1">
                      <Shield className="w-3.5 h-3.5 text-aegis-600" /> {t('citizen.auth.tos.heading', lang)}
                    </p>
                    <p className="text-[10px] text-gray-500 dark:text-gray-300 mt-0.5">
                      {t('citizen.auth.tos.iAgree', lang)} <a href="/terms" target="_blank" className="text-aegis-600 underline">{t('citizen.auth.tos.termsOfService', lang)}</a> {t('citizen.auth.tos.and', lang)}{' '}
                      <a href="/privacy" target="_blank" className="text-aegis-600 underline">{t('citizen.auth.tos.privacyPolicy', lang)}</a>.
                      {t('citizen.auth.tos.gdpr', lang)}
                    </p>
                  </div>
                </label>

                <div className="flex gap-3">
                  <button type="button" onClick={() => setRegStep(2)}
                    className="flex-1 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 py-3 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 transition-all">
                    <ArrowLeft className="w-4 h-4" /> {t('citizen.auth.back', lang)}
                  </button>
                  <button type="submit" disabled={submitting}
                    className="flex-1 bg-gradient-to-r from-amber-400 via-yellow-300 to-amber-400 hover:from-amber-500 hover:via-yellow-400 hover:to-amber-500 text-black disabled:bg-amber-200 disabled:text-aegis-700 py-3 rounded-xl font-semibold text-sm shadow-lg shadow-amber-500/30 flex items-center justify-center gap-2 transition-all">
                    {submitting ? <><Loader2 className="w-4 h-4 animate-spin" /> {t('citizen.auth.creating', lang)}</> : <>{t('citizen.auth.createAccount', lang)} <CheckCircle className="w-4 h-4" /></>}
                  </button>
                </div>
              </>
            )}
          </form>
          )}

          {/* Footer links */}
          {mode !== 'forgot' && (
          <div className="text-center mt-4 text-xs text-gray-500 dark:text-gray-300">
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
              <Link to="/citizen" className="text-gray-400 dark:text-gray-300 hover:text-gray-600">{t('citizen.auth.continueWithout', lang)}</Link>
            </p>
          </div>
          )}
          </>
          )}
        </div>
      </div>
    </div>
  )
}

