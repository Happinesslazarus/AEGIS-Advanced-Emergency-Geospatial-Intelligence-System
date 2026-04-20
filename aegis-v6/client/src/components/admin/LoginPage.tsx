/**
 * Operator login page with three auth flows:
 * 1. Standard email/password -> calls apiLogin(), stores JWT on success
 * 2. Two-factor auth -> if the API returns requires2FA=true, swaps in TwoFactorChallenge
 *    with the tempToken from the initial response
 * 3. Google OAuth -> hard link to /api/auth/google (server-side redirect flow)
 * Also has an inline "forgot password" handler that triggers a reset email.
 *
 * - onLogin(user) callback passed in from AdminPage.tsx updates parent auth state
 * - apiLogin() / apiForgotPassword() live in client/src/utils/api.ts
 * - session=expired search param is set by the auth interceptor when a JWT expires
 * - TwoFactorChallenge.tsx handles TOTP/SMS code entry and completes the sign-in
 * */

import { useState, useRef, useEffect } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Shield, Lock, Mail, LogIn, CheckCircle, Eye, EyeOff, X as XIcon, Check, ArrowLeft, Home, Loader2, AlertCircle, Fingerprint, Radio, Zap, ChevronDown, ChevronRight, Users, ArrowRight, Globe, Info, Menu, X, QrCode, Wand2 } from 'lucide-react'
import { apiLogin, apiForgotPassword, setToken, setUser } from '../../utils/api'
import type { Operator } from '../../types'
import LanguageSelector from '../shared/LanguageSelector'
import ThemeSelector from '../../components/ui/ThemeSelector'
import TwoFactorChallenge from './TwoFactorChallenge'
import { useLanguage } from '../../hooks/useLanguage'
import { useTheme } from '../../contexts/ThemeContext'

import { t } from '../../utils/i18n'
import { API_BASE } from '../../utils/helpers'

interface Props { onLogin: (user: Operator) => void }

export default function LoginPage({ onLogin }: Props): JSX.Element {
  const lang = useLanguage()
  const { dark } = useTheme()
  const [searchParams, setSearchParams] = useSearchParams()
  //session=expired is appended to the URL by the API interceptor when a 401 fires.
  //We read it once on mount and clear it from the URL after showing the banner.
  const sessionExpired = searchParams.get('session') === 'expired'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [regSuccess, setRegSuccess] = useState('')
  const [loading, setLoading] = useState(false)
  const [twoFactorRequired, setTwoFactorRequired] = useState(false)
  const [tempToken, setTempToken] = useState('')
  const [navDropdownOpen, setNavDropdownOpen] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [magicLinkEmail, setMagicLinkEmail] = useState('')
  const [magicLinkSent, setMagicLinkSent] = useState(false)
  const [magicLinkLoading, setMagicLinkLoading] = useState(false)
  const [showMagicLink, setShowMagicLink] = useState(false)
  const [showMoreAuth, setShowMoreAuth] = useState(false)
  const navDropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (navDropdownRef.current && !navDropdownRef.current.contains(e.target as Node)) setNavDropdownOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const featureHighlights = [
    { icon: Radio, title: t('login.realTimeMonitoring', lang), desc: t('login.liveIncidentTracking', lang) },
    { icon: Zap, title: t('login.aiPoweredAnalysis', lang), desc: t('login.automatedSeverity', lang) },
    { icon: Fingerprint, title: t('login.secureAccess', lang), desc: t('login.endToEndEncrypted', lang) },
  ]

  const handleMagicLink = async () => {
    if (!magicLinkEmail) return
    setMagicLinkLoading(true)
    try {
      const res = await fetch(`${API_BASE}/api/auth/magic-link/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: magicLinkEmail }),
      })
      const data = await res.json()
      if (data.success) setMagicLinkSent(true)
      else setError(data.error || 'Failed to send magic link')
    } catch { setError('Failed to send magic link') }
    finally { setMagicLinkLoading(false) }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await apiLogin(email, password)
      if (res.requires2FA && res.tempToken) {
        //2FA required: server returned a short-lived tempToken instead of a full JWT.
        //Swap to the TwoFactorChallenge screen. The tempToken is exchanged for a
        //real JWT after the user enters their OTP code.
        setTwoFactorRequired(true)
        setTempToken(res.tempToken)
        setLoading(false)
        return
      }
      setToken(res.token!)
      setUser(res.user!)
      onLogin(res.user!)
    } catch (err: any) {
      setError(err.message || t('admin.login.invalidCredentials', lang))
    } finally { setLoading(false) }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50/30 to-slate-50 dark:from-gray-950 dark:via-slate-900 dark:to-gray-950 flex flex-col relative overflow-hidden">
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
        <div className="absolute -bottom-24 left-1/4 w-80 h-80 bg-indigo-300/6 dark:bg-indigo-500/4 rounded-full blur-3xl" style={{ animation: 'aegis-float 35s ease-in-out infinite 2s' }} />
      </div>
      {/* Navigation */}
      <nav className="relative z-50 bg-white/98 dark:bg-surface-ultra-dark backdrop-blur-2xl text-gray-900 dark:text-white shadow-md shadow-gray-200/50 dark:shadow-2xl dark:shadow-black/70 border-b border-gray-200 dark:border-aegis-500/15">
        {/* Top accent gradient bar */}
        <div className="h-[2px] bg-gradient-to-r from-aegis-600 via-amber-400 to-aegis-600 dark:from-aegis-500/60 dark:via-amber-400/80 dark:to-aegis-500/60" />
        <div className="px-4 sm:px-6 h-14 flex items-center justify-between">
        <div className="flex items-center gap-3">
        <Link to="/" className="flex items-center gap-2.5 group">
          <div className="relative w-10 h-10 rounded-xl bg-gradient-to-br from-aegis-500 via-aegis-600 to-aegis-700 flex items-center justify-center shadow-lg shadow-aegis-500/30 group-hover:shadow-aegis-400/60 transition-all group-hover:scale-105">
            <Shield className="w-5 h-5 text-white drop-shadow-sm" />
            <div className="absolute inset-0 rounded-xl bg-gradient-to-tr from-white/25 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
            <span className="absolute -top-0.5 -right-0.5 flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-400 border-2 border-white dark:border-surface-ultra-dark" />
            </span>
          </div>
          <div className="hidden sm:block leading-none">
            <div className="flex items-center gap-2">
              <span className="font-black text-sm tracking-wide">
                <span className="text-aegis-600 dark:text-aegis-400">AEGIS</span>
              </span>
            </div>
            <span className="block text-[9px] text-gray-400 dark:text-aegis-300 tracking-[0.2em] uppercase mt-0.5">{t('admin.portal.title', lang)}</span>
          </div>
        </Link>
        {/* Separator + System Status */}
        <div className="hidden md:block w-px h-8 bg-gradient-to-b from-transparent via-gray-300 dark:via-white/10 to-transparent" />
        <div className="hidden md:flex items-center gap-2">
          <div className="flex items-center gap-1.5 bg-green-50 dark:bg-green-500/10 border border-green-200 dark:border-green-500/20 px-2.5 py-1 rounded-lg">
            <span className="relative flex h-2 w-2"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" /><span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" /></span>
            <span className="text-[10px] font-bold text-green-600 dark:text-green-400">{t('common.systemOnline', lang)}</span>
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
              className="flex items-center gap-2 text-xs font-bold px-3.5 sm:px-4 py-2.5 rounded-xl bg-aegis-600 hover:bg-aegis-700 active:bg-aegis-800 shadow-lg shadow-aegis-600/20 hover:shadow-aegis-500/40 transition-all hover:scale-[1.02] active:scale-[0.97] text-white cursor-pointer select-none min-h-[40px]">
              <Menu className="w-4 h-4" />
              <span className="hidden sm:inline">{t('common.navigate', lang)}</span>
              <ChevronDown className={`w-3.5 h-3.5 opacity-80 transition-transform duration-200 ${navDropdownOpen ? 'rotate-180' : ''}`} />
            </button>
            {navDropdownOpen && (
              <div className="absolute right-0 top-full mt-2 w-72 bg-white dark:bg-gray-900 border border-gray-200/80 dark:border-white/10 rounded-2xl shadow-2xl shadow-black/15 dark:shadow-black/50 overflow-hidden z-[60]" style={{ animation: 'aegis-fade-up 0.18s ease-out' }}>
                <div className="px-4 py-3 bg-gradient-to-r from-aegis-50 to-blue-50/50 dark:from-aegis-950/40 dark:to-blue-950/20 border-b border-gray-200/60 dark:border-white/8">
                  <p className="text-[10px] text-aegis-600 dark:text-aegis-400 font-extrabold uppercase tracking-[0.18em]">{t('common.quickNavigation', lang)}</p>
                </div>
                <div className="p-2 space-y-0.5">
                  <Link to="/" onClick={() => setNavDropdownOpen(false)}
                    className="flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-gray-50 dark:hover:bg-white/5 transition-all duration-150 group cursor-pointer">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-gray-100 to-gray-200/80 dark:from-white/10 dark:to-white/5 flex items-center justify-center group-hover:from-aegis-100 group-hover:to-aegis-200/80 dark:group-hover:from-aegis-500/15 dark:group-hover:to-aegis-600/10 transition-all duration-150 flex-shrink-0">
                      <Globe className="w-[18px] h-[18px] text-gray-500 dark:text-white/60 group-hover:text-aegis-600 dark:group-hover:text-aegis-400 transition-colors duration-150" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-bold text-gray-900 dark:text-white group-hover:text-aegis-700 dark:group-hover:text-aegis-300 transition-colors">{t('common.home', lang)}</p>
                      <p className="text-[10px] text-gray-400 dark:text-white/40 mt-0.5 leading-tight">{t('common.returnToMain', lang)}</p>
                    </div>
                    <ArrowRight className="w-4 h-4 text-gray-300 dark:text-white/15 group-hover:text-aegis-500 dark:group-hover:text-aegis-400 group-hover:translate-x-1 transition-all duration-150 flex-shrink-0" />
                  </Link>
                  <Link to="/citizen" onClick={() => setNavDropdownOpen(false)}
                    className="flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-blue-50/70 dark:hover:bg-blue-500/5 transition-all duration-150 group cursor-pointer">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-50 to-blue-100/80 dark:from-blue-500/10 dark:to-blue-600/5 flex items-center justify-center group-hover:from-blue-100 group-hover:to-blue-200/80 dark:group-hover:from-blue-500/20 dark:group-hover:to-blue-600/10 transition-all duration-150 flex-shrink-0">
                      <Users className="w-[18px] h-[18px] text-blue-500 dark:text-blue-400 group-hover:text-blue-600 dark:group-hover:text-blue-300 transition-colors duration-150" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-bold text-gray-900 dark:text-white group-hover:text-blue-700 dark:group-hover:text-blue-300 transition-colors">{t('common.citizenPortal', lang)}</p>
                      <p className="text-[10px] text-gray-400 dark:text-white/40 mt-0.5 leading-tight">{t('common.publicSafetyDashboard', lang)}</p>
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
        </div>
        </div>
      </nav>

      <div className="flex-1 flex items-center justify-center p-4 relative z-10">
      {/* 2FA Challenge Screen: replaces the login form when the server says 2FA is required.
           onSuccess receives the real JWT + full user object from the OTP exchange endpoint.
           onCancel clears the tempToken and returns to the password form. */}
      {twoFactorRequired && tempToken ? (
        <TwoFactorChallenge
          tempToken={tempToken}
          onSuccess={(token, user) => {
            setToken(token)
            setUser(user as Operator)
            onLogin(user as Operator)
          }}
          onCancel={() => {
            setTwoFactorRequired(false)
            setTempToken('')
            setPassword('')
            setError('')
          }}
        />
      ) : (
      <div className="w-full max-w-6xl flex lg:flex-row flex-col gap-6 sm:gap-12 items-center">
        {/* Left -- Branding Hero */}
        <div className="hidden lg:flex flex-col flex-1 max-w-md">
          <div className="mb-8">
            <div className="w-20 h-20 bg-gradient-to-br from-aegis-500 to-aegis-700 rounded-2xl flex items-center justify-center mb-6 shadow-2xl shadow-aegis-600/30">
              <Shield className="w-11 h-11 text-white" />
            </div>
            <h1 className="text-3xl font-black text-gray-900 dark:text-white leading-tight">{t('admin.portal.title', lang)}</h1>
            <p className="text-sm text-gray-500 dark:text-gray-300 mt-3 leading-relaxed">
              {t('admin.portal.signin', lang)}
            </p>
          </div>
          <div className="space-y-4">
            {featureHighlights.map((f, i) => (
              <div key={i} className="flex items-start gap-3.5 group">
                <div className="w-10 h-10 rounded-xl bg-aegis-50 dark:bg-aegis-500/10 border border-aegis-200/50 dark:border-aegis-500/20 flex items-center justify-center flex-shrink-0 group-hover:border-aegis-400/50 transition-colors">
                  <f.icon className="w-5 h-5 text-aegis-600 dark:text-aegis-400" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-gray-900 dark:text-white">{f.title}</h3>
                  <p className="text-xs text-gray-500 dark:text-gray-300 mt-0.5">{f.desc}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-8 pt-6 border-t border-gray-200/60 dark:border-gray-800/60">
            <p className="text-[11px] text-gray-400 dark:text-gray-300 leading-relaxed">
              {t('admin.login.protectedSystem', lang)}
            </p>
          </div>
        </div>

        {/* Right -- Auth Form */}
        <div className="w-full max-w-lg mx-auto lg:mx-0 flex-1">
        {/* Mobile/Tablet: compact branding + feature highlights */}
        <div className="mb-6 lg:hidden">
          <div className="text-center mb-4">
            <div className="w-16 h-16 bg-gradient-to-br from-aegis-500 to-aegis-700 rounded-2xl flex items-center justify-center mx-auto mb-3 shadow-lg shadow-aegis-600/30">
              <Shield className="w-9 h-9 text-white" />
            </div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{t('admin.portal.title', lang)}</h1>
            <p className="text-sm text-gray-500 dark:text-gray-300 dark:text-aegis-200 mt-1">{t('admin.portal.signin', lang)}</p>
          </div>
          {/* Compact feature highlights for mobile */}
          <div className="grid grid-cols-3 gap-2 mt-4">
            {featureHighlights.map((f, i) => (
              <div key={i} className="bg-white/60 dark:bg-white/[0.03] backdrop-blur-sm rounded-xl border border-gray-200/60 dark:border-white/[0.06] p-3 text-center">
                <div className="w-8 h-8 rounded-lg bg-aegis-50 dark:bg-aegis-500/10 border border-aegis-200/50 dark:border-aegis-500/20 flex items-center justify-center mx-auto mb-2">
                  <f.icon className="w-4 h-4 text-aegis-600 dark:text-aegis-400" />
                </div>
                <h3 className="text-[10px] font-bold text-gray-900 dark:text-white leading-tight">{f.title}</h3>
                <p className="text-[9px] text-gray-400 dark:text-gray-300 mt-0.5 leading-tight hidden sm:block">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white/80 dark:bg-gray-900/80 backdrop-blur-xl rounded-2xl border border-gray-200/80 dark:border-gray-700/50 shadow-2xl shadow-gray-300/20 dark:shadow-black/40 p-8 sm:p-10" style={{ animation: 'aegis-fade-up 0.6s ease-out' }}>
          <div className="flex mb-6 items-center justify-center gap-2.5">
            <LogIn className="w-5 h-5 text-aegis-600" />
            <span className="text-base font-semibold text-aegis-700 dark:text-aegis-300">{t('login.signIn', lang)}</span>
          </div>

          {sessionExpired && (
            <div role="status" aria-live="polite" className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300 px-3 py-2.5 rounded-xl text-sm mb-4 flex items-center gap-2" style={{ animation: 'aegis-fade-up 0.4s ease-out' }}>
              <AlertCircle className="w-4 h-4 flex-shrink-0"/>{t('common.sessionExpired', lang)}
              <button onClick={() => { searchParams.delete('session'); setSearchParams(searchParams, { replace: true }) }} className="ml-auto text-amber-500 hover:text-amber-700 dark:hover:text-amber-200 transition-colors" aria-label={t('common.dismiss', lang)}>&times;</button>
            </div>
          )}
          {regSuccess && <div className="bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800 text-green-700 dark:text-green-300 px-3 py-2.5 rounded-xl text-sm mb-4 flex items-center gap-2"><CheckCircle className="w-4 h-4 flex-shrink-0"/>{regSuccess}</div>}
          {error && <div key={error} role="alert" aria-live="assertive" className="bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 px-3 py-2.5 rounded-xl text-sm mb-4 flex items-center gap-2" style={{ animation: 'aegis-shake 0.5s ease-in-out' }}><AlertCircle className="w-4 h-4 flex-shrink-0"/>{error}</div>}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="relative">
              <Mail className="absolute left-3.5 top-3.5 w-4.5 h-4.5 text-gray-400 dark:text-gray-300" />
              <input type="email" placeholder={t('login.email', lang)} value={email} onChange={e => setEmail(e.target.value)} required
                className="w-full pl-11 pr-4 py-3 text-sm bg-gray-50 dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 focus:border-aegis-500 focus:ring-1 focus:ring-aegis-500 outline-none" />
            </div>

            <div>
              <div className="relative">
                <Lock className="absolute left-3.5 top-3.5 w-4.5 h-4.5 text-gray-400 dark:text-gray-300" />
                <input type={showPassword ? 'text' : 'password'} placeholder={t('login.password', lang)} value={password} onChange={e => setPassword(e.target.value)} required
                  className="w-full pl-11 pr-11 py-3 text-sm bg-gray-50 dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 focus:border-aegis-500 focus:ring-1 focus:ring-aegis-500 outline-none" />
                <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3.5 top-3.5 text-gray-400 dark:text-gray-300 hover:text-gray-600" aria-label={showPassword ? t('admin.login.hidePassword', lang) : t('admin.login.showPassword', lang)}>
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {(
                <div className="mt-1 text-right">
                  <button
                    type="button"
                    onClick={async () => {
                      const targetEmail = email.trim()
                      if (!targetEmail) { setError(t('citizen.auth.forgot.subtitle', lang)); return }
                      setLoading(true)
                      try {
                        await apiForgotPassword(targetEmail)
                        setRegSuccess(t('citizen.auth.forgot.sentDesc', lang))
                        setError('')
                      } catch (err: any) {
                        setError(err?.message || t('common.error', lang))
                      } finally { setLoading(false) }
                    }}
                    className="text-[11px] text-aegis-600 hover:underline"
                  >
                    {t('login.forgotPassword', lang)}
                  </button>
                </div>
              )}
            </div>

            <button type="submit" disabled={loading}
              className="w-full bg-gradient-to-r from-aegis-600 to-aegis-700 hover:from-aegis-500 hover:to-aegis-600 disabled:from-gray-400 disabled:to-gray-400 disabled:cursor-not-allowed py-3.5 rounded-xl font-bold text-sm text-white transition-all shadow-lg shadow-aegis-600/25 flex items-center justify-center gap-2 mt-2">
              {loading
                ? <><Loader2 className="w-4 h-4 animate-spin" /> {t('admin.login.signingIn', lang)}</>
                : t('login.signIn', lang)}
            </button>
          </form>

          {/*  --- Alternative Sign-In Methods --- */}
          <div className="relative my-3">
            <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-gray-200 dark:border-gray-700" /></div>
            <div className="relative flex justify-center text-xs">
              <span className="px-3 bg-white dark:bg-gray-900 text-gray-400 dark:text-gray-300">{t('common.continueWith', lang)}</span>
            </div>
          </div>

          {/* Admin sign-in does not support social OAuth. */}

          {/* Expandable advanced methods */}
          <button type="button" onClick={() => setShowMoreAuth(prev => !prev)}
            className="w-full flex items-center justify-center gap-1.5 py-2 text-xs font-medium text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition">
            <span>{showMoreAuth ? 'Hide' : 'More sign-in options'}</span>
            <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showMoreAuth ? 'rotate-180' : ''}`} />
          </button>

          {showMoreAuth && (
            <div className="space-y-2 animate-[aegis-fade-up_0.25s_ease-out]">

              {/* Magic Link */}
              {!showMagicLink ? (
                <button type="button" onClick={() => setShowMagicLink(true)}
                  className="w-full flex items-center gap-3 py-2.5 px-4 border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-750 transition text-sm text-gray-700 dark:text-gray-200 shadow-sm">
                  <div className="w-8 h-8 rounded-lg bg-amber-100 dark:bg-amber-900/40 flex items-center justify-center flex-shrink-0">
                    <Wand2 className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                  </div>
                  <div className="text-left min-w-0">
                    <p className="font-medium text-sm">Magic Link</p>
                    <p className="text-[11px] text-gray-400 dark:text-gray-500">Passwordless sign-in via email</p>
                  </div>
                </button>
              ) : magicLinkSent ? (
                <div className="w-full p-3 rounded-xl border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/30 text-center">
                  <CheckCircle className="w-5 h-5 text-green-500 mx-auto mb-1" />
                  <p className="text-sm font-medium text-green-700 dark:text-green-300">Check your email!</p>
                  <p className="text-xs text-green-600 dark:text-green-400 mt-0.5">We sent a sign-in link to {magicLinkEmail}</p>
                </div>
              ) : (
                <div className="w-full p-3 rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-900/20 space-y-2">
                  <div className="flex items-center gap-2 mb-1">
                    <Wand2 className="w-4 h-4 text-amber-500" />
                    <span className="text-xs font-semibold text-amber-700 dark:text-amber-300">Magic Link</span>
                  </div>
                  <div className="relative">
                    <Mail className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
                    <input type="email" value={magicLinkEmail} onChange={e => setMagicLinkEmail(e.target.value)}
                      placeholder="Enter email for magic link" className="w-full pl-10 pr-3 py-2.5 text-sm bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 focus:ring-2 focus:ring-amber-500 focus:border-transparent transition" />
                  </div>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => setShowMagicLink(false)}
                      className="px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-xs font-medium text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800 transition">Cancel</button>
                    <button type="button" onClick={handleMagicLink} disabled={magicLinkLoading || !magicLinkEmail}
                      className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 disabled:bg-gray-300 disabled:cursor-not-allowed text-xs font-semibold text-white transition">
                      {magicLinkLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Wand2 className="w-3 h-3" />}
                      <span>Send Link</span>
                    </button>
                  </div>
                </div>
              )}

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

          <p className="text-center text-[10px] text-gray-400 dark:text-gray-300 mt-4">{t('admin.portal.signin', lang)}</p>

          <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 mt-5 pt-4 border-t border-gray-100 dark:border-gray-800">
            <span className="flex items-center gap-1 text-[10px] text-gray-400 dark:text-gray-300 whitespace-nowrap"><Lock className="w-3 h-3 flex-shrink-0"/>{t('admin.login.secureConnection', lang)}</span>
            <span className="text-gray-300 dark:text-gray-700 hidden sm:inline">-</span>
            <span className="text-[10px] text-gray-400 dark:text-gray-300 whitespace-nowrap">{t('users.sessions', lang)}</span>
            <span className="text-gray-300 dark:text-gray-700 hidden sm:inline">-</span>
            <span className="text-[10px] text-gray-400 dark:text-gray-300 whitespace-nowrap text-center">{t('admin.login.protectedSystem', lang)}</span>
          </div>
        </div>
        </div>
      </div>
      )}
      </div>
    </div>
  )
}

