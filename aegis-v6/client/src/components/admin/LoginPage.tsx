/* LoginPage.tsx — Operator authentication with login, register, and password reset forms. */

import { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Shield, Lock, Mail, Camera, User, Building2, Phone, LogIn, UserPlus, CheckCircle, Eye, EyeOff, X as XIcon, Check, ArrowLeft, Home, Loader2, AlertCircle, Fingerprint, Radio, Zap } from 'lucide-react'
import { apiLogin, apiRegister, apiGetDepartments, apiForgotPassword, setToken, setUser } from '../../utils/api'
import type { Operator } from '../../types'
import LanguageSelector from '../shared/LanguageSelector'
import ThemeSelector from '../../components/ui/ThemeSelector'
import { useLanguage } from '../../hooks/useLanguage'
import { useTheme } from '../../contexts/ThemeContext'

import { t } from '../../utils/i18n'

const DEFAULT_DEPARTMENTS = [
  'Emergency Operations', 'Fire & Rescue', 'Police', 'Health & Medical',
  'Infrastructure', 'Environmental', 'Community Liaison', 'IT & Communications',
  'Logistics', 'Command & Control'
]

interface Props { onLogin: (user: Operator) => void }

export default function LoginPage({ onLogin }: Props): JSX.Element {
  const lang = useLanguage()
  const { dark } = useTheme()
  const [mode, setMode] = useState<'login'|'register'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [displayName, setDisplayName] = useState('')
  const [department, setDepartment] = useState('')
  const [phone, setPhone] = useState('')
  const [avatar, setAvatar] = useState<File|null>(null)
  const [avatarPreview, setAvatarPreview] = useState('')
  const [error, setError] = useState('')
  const [regSuccess, setRegSuccess] = useState('')
  const [loading, setLoading] = useState(false)
  const [departments, setDepartments] = useState<string[]>(DEFAULT_DEPARTMENTS)

  useEffect(() => {
    apiGetDepartments().then(deps => {
      if (deps?.length > 0) setDepartments(deps.map((d: any) => d.name))
    }).catch(() => {})
  }, [])

  // Live password validation
  const pwChecks = useMemo(() => ({
    length: password.length >= 8,
    upper: /[A-Z]/.test(password),
    lower: /[a-z]/.test(password),
    number: /[0-9]/.test(password),
    special: /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?`~]/.test(password),
  }), [password])

  const allValid = Object.values(pwChecks).every(Boolean)
  const featureHighlights = [
    { icon: Radio, title: t('login.realTimeMonitoring', lang), desc: t('login.liveIncidentTracking', lang) },
    { icon: Zap, title: t('login.aiPoweredAnalysis', lang), desc: t('login.automatedSeverity', lang) },
    { icon: Fingerprint, title: t('login.secureAccess', lang), desc: t('login.endToEndEncrypted', lang) },
  ]

  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      setAvatar(file)
      const reader = new FileReader()
      reader.onload = (ev) => setAvatarPreview(ev.target?.result as string)
      reader.readAsDataURL(file)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      if (mode === 'login') {
        const res = await apiLogin(email, password) as { token: string; user: any }
        setToken(res.token)
        setUser(res.user)
        onLogin(res.user)
      } else {
        if (!displayName) { setError(t('login.nameRequired', lang)); setLoading(false); return }
        if (!allValid) { setError(t('login.passwordRequirements', lang)); setLoading(false); return }
        if (password !== confirmPassword) { setError(t('login.passwordsMismatchError', lang)); setLoading(false); return }
        const formData = new FormData()
        formData.append('email', email)
        formData.append('password', password)
        formData.append('displayName', displayName)
        formData.append('department', department)
        formData.append('phone', phone)
        if (avatar) formData.append('avatar', avatar)
        await apiRegister(formData)
        setMode('login'); setError('')
        setRegSuccess(t('login.accountCreated', lang))
        setEmail(email); setPassword(''); setConfirmPassword('')
        setDisplayName(''); setDepartment(''); setPhone('')
        setAvatar(null); setAvatarPreview('')
      }
    } catch (err: any) {
      setError(err.message || t('admin.login.invalidCredentials', lang))
    } finally { setLoading(false) }
  }

  const PwCheck = ({ ok, label }: { ok: boolean; label: string }) => (
    <div className="flex items-center gap-1.5">
      {ok ? <Check className="w-3.5 h-3.5 text-green-500" /> : <XIcon className="w-3.5 h-3.5 text-red-400" />}
      <span className={`text-xs ${ok ? 'text-green-500' : 'text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300'}`}>{label}</span>
    </div>
  )

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
      <nav className="relative bg-white/98 dark:bg-[#09090f] backdrop-blur-2xl text-gray-900 dark:text-white px-4 h-14 flex items-center justify-between shadow-md shadow-gray-200/50 dark:shadow-2xl dark:shadow-black/70 border-b border-gray-200 dark:border-aegis-500/15">
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-aegis-400/40 dark:via-aegis-400/60 to-transparent pointer-events-none" />
        <Link to="/" className="flex items-center gap-2.5 group">
          <div className="relative w-9 h-9 rounded-xl bg-gradient-to-br from-aegis-500 to-aegis-700 flex items-center justify-center shadow-lg shadow-aegis-500/30 group-hover:shadow-aegis-400/60 transition-all group-hover:scale-105">
            <Shield className="w-5 h-5 text-white drop-shadow-sm" />
            <div className="absolute inset-0 rounded-xl bg-gradient-to-tr from-white/25 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
          </div>
          <div className="hidden sm:block leading-none">
            <span className="font-black text-sm tracking-wide">
              <span className="text-aegis-600 dark:text-aegis-400">AEGIS</span>
              {' '}<span className="text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-white/80">OPS</span>
            </span>
            <span className="block text-[9px] text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-aegis-300 tracking-widest uppercase">{t('admin.portal.title', lang)}</span>
          </div>
        </Link>
        <div className="flex items-center gap-1.5">
          <LanguageSelector darkNav={dark} />
          <ThemeSelector darkNav={dark} />
          <Link to="/citizen" className="text-xs text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-white/50 hover:text-aegis-600 dark:hover:text-aegis-300 bg-gray-100 dark:bg-white/5 hover:bg-aegis-50 dark:hover:bg-aegis-500/10 border border-gray-200 dark:border-white/8 hover:border-aegis-300 dark:hover:border-aegis-500/25 px-3 py-1.5 rounded-xl transition-all flex items-center gap-1.5">
            <Home className="w-3.5 h-3.5" /> {t('admin.citizenPage', lang)}
          </Link>
          <Link to="/citizen/auth" className="relative text-xs font-bold px-3.5 py-1.5 rounded-xl overflow-hidden group bg-aegis-600 hover:bg-aegis-700 shadow-lg shadow-aegis-600/20 hover:shadow-aegis-400/40 transition-all hover:scale-[1.03] active:scale-[0.97] text-white">
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-700 ease-in-out" />
            <span className="relative z-10">{t('auth.login', lang)}</span>
          </Link>
        </div>
      </nav>

      <div className="flex-1 flex items-center justify-center p-4 relative z-10">
      <div className="w-full max-w-5xl flex lg:flex-row flex-col gap-8 items-center">
        {/* Left — Branding Hero (desktop only) */}
        <div className="hidden lg:flex flex-col flex-1 max-w-sm">
          <div className="mb-8">
            <div className="w-20 h-20 bg-gradient-to-br from-aegis-500 to-aegis-700 rounded-2xl flex items-center justify-center mb-6 shadow-2xl shadow-aegis-600/30">
              <Shield className="w-11 h-11 text-white" />
            </div>
            <h1 className="text-3xl font-black text-gray-900 dark:text-white leading-tight">{t('admin.portal.title', lang)}</h1>
            <p className="text-sm text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 mt-3 leading-relaxed">
              {mode === 'login' ? t('admin.portal.signin', lang) : t('admin.portal.register', lang)}
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
                  <p className="text-xs text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 mt-0.5">{f.desc}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-8 pt-6 border-t border-gray-200/60 dark:border-gray-800/60">
            <p className="text-[11px] text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 leading-relaxed">
              {t('admin.login.protectedSystem', lang)}
            </p>
          </div>
        </div>

        {/* Right — Auth Form */}
        <div className="w-full lg:max-w-md flex-1">
        <div className="text-center mb-6 lg:hidden">
          <div className="w-16 h-16 bg-gradient-to-br from-aegis-500 to-aegis-700 rounded-2xl flex items-center justify-center mx-auto mb-3 shadow-lg shadow-aegis-600/30">
            <Shield className="w-9 h-9 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{t('admin.portal.title', lang)}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-aegis-200 mt-1">{mode === 'login' ? t('admin.portal.signin', lang) : t('admin.portal.register', lang)}</p>
        </div>

        <div className="bg-white/80 dark:bg-gray-900/80 backdrop-blur-xl rounded-2xl border border-gray-200/80 dark:border-gray-700/50 shadow-2xl shadow-gray-300/20 dark:shadow-black/40 p-6" style={{ animation: 'aegis-fade-up 0.6s ease-out' }}>
          <div className="flex mb-5 bg-gray-100 dark:bg-gray-800 rounded-xl p-1">
            <button onClick={() => { setMode('login'); setError(''); setRegSuccess('') }} className={`flex-1 py-2 text-sm font-semibold rounded-lg flex items-center justify-center gap-1.5 transition-all ${mode === 'login' ? 'bg-white dark:bg-gray-700 shadow text-aegis-700' : 'text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300'}`}>
              <LogIn className="w-4 h-4" /> {t('login.signIn', lang)}
            </button>
            <button onClick={() => { setMode('register'); setError(''); setRegSuccess('') }} className={`flex-1 py-2 text-sm font-semibold rounded-lg flex items-center justify-center gap-1.5 transition-all ${mode === 'register' ? 'bg-white dark:bg-gray-700 shadow text-aegis-700' : 'text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300'}`}>
              <UserPlus className="w-4 h-4" /> {t('login.register', lang)}
            </button>
          </div>

          {regSuccess && <div className="bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800 text-green-700 dark:text-green-300 px-3 py-2.5 rounded-xl text-sm mb-4 flex items-center gap-2"><CheckCircle className="w-4 h-4 flex-shrink-0"/>{regSuccess}</div>}
          {error && <div key={error} role="alert" aria-live="assertive" className="bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 px-3 py-2.5 rounded-xl text-sm mb-4 flex items-center gap-2" style={{ animation: 'aegis-shake 0.5s ease-in-out' }}><AlertCircle className="w-4 h-4 flex-shrink-0"/>{error}</div>}

          <form onSubmit={handleSubmit} className="space-y-3">
            {mode === 'register' && (
              <div className="flex justify-center mb-2">
                <label className="cursor-pointer relative group">
                  <div className="w-20 h-20 rounded-full border-2 border-dashed border-gray-300 dark:border-gray-600 flex items-center justify-center overflow-hidden bg-gray-50 dark:bg-gray-800 group-hover:border-aegis-400 transition-colors">
                    {avatarPreview ? <img src={avatarPreview} alt="Avatar" className="w-full h-full object-cover" /> : <Camera className="w-6 h-6 text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300" />}
                  </div>
                  <div className="absolute bottom-0 right-0 w-6 h-6 bg-aegis-500 rounded-full flex items-center justify-center shadow"><Camera className="w-3 h-3 text-white" /></div>
                  <input type="file" accept="image/*" onChange={handleAvatarChange} className="hidden" />
                </label>
              </div>
            )}

            {mode === 'register' && (
              <div className="relative">
                <User className="absolute left-3 top-3 w-4 h-4 text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300" />
                <input type="text" placeholder={`${t('login.fullName', lang)} *`} value={displayName} onChange={e => setDisplayName(e.target.value)}
                  className="w-full pl-10 pr-3 py-2.5 text-sm bg-gray-50 dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 focus:border-aegis-500 focus:ring-1 focus:ring-aegis-500 outline-none" />
              </div>
            )}

            <div className="relative">
              <Mail className="absolute left-3 top-3 w-4 h-4 text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300" />
              <input type="email" placeholder={t('login.email', lang)} value={email} onChange={e => setEmail(e.target.value)} required
                className="w-full pl-10 pr-3 py-2.5 text-sm bg-gray-50 dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 focus:border-aegis-500 focus:ring-1 focus:ring-aegis-500 outline-none" />
            </div>

            <div>
              {mode === 'register' && <label className="block text-xs font-semibold text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 mb-1">{t('login.password', lang)}</label>}
              <div className="relative">
                <Lock className="absolute left-3 top-3 w-4 h-4 text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300" />
                <input type={showPassword ? 'text' : 'password'} placeholder={mode === 'register' ? t('login.createPassword', lang) : t('login.password', lang)} value={password} onChange={e => setPassword(e.target.value)} required
                  className="w-full pl-10 pr-10 py-2.5 text-sm bg-gray-50 dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 focus:border-aegis-500 focus:ring-1 focus:ring-aegis-500 outline-none" />
                <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-3 text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 hover:text-gray-600" aria-label={showPassword ? t('admin.login.hidePassword', lang) : t('admin.login.showPassword', lang)}>
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {mode === 'login' && (
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
              {password.length > 0 && (
                <div className="mt-2 space-y-0.5">
                  <PwCheck ok={pwChecks.length} label="8+ chars" />
                  <PwCheck ok={pwChecks.upper} label="Uppercase" />
                  <PwCheck ok={pwChecks.lower} label="Lowercase" />
                  <PwCheck ok={pwChecks.number} label="Number" />
                  <PwCheck ok={pwChecks.special} label="Special" />
                </div>
              )}
            </div>

            {mode === 'register' && (
              <div className="relative">
                <Lock className="absolute left-3 top-3 w-4 h-4 text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300" />
                <input type={showConfirmPassword ? 'text' : 'password'} placeholder={t('login.confirmPassword', lang)} value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} required
                  className="w-full pl-10 pr-10 py-2.5 text-sm bg-gray-50 dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 focus:border-aegis-500 focus:ring-1 focus:ring-aegis-500 outline-none" />
                <button type="button" onClick={() => setShowConfirmPassword(!showConfirmPassword)} className="absolute right-3 top-3 text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 hover:text-gray-600" aria-label={showConfirmPassword ? t('admin.login.hidePassword', lang) : t('admin.login.showPassword', lang)}>
                  {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
                {confirmPassword && password !== confirmPassword && <p className="text-xs text-red-400 mt-1 flex items-center gap-1"><XIcon className="w-3 h-3" /> {t('login.passwordsMismatch', lang)}</p>}
                {confirmPassword && password === confirmPassword && password.length > 0 && <p className="text-xs text-green-500 mt-1 flex items-center gap-1"><Check className="w-3 h-3" /> {t('login.passwordsMatch', lang)}</p>}
              </div>
            )}

            {mode === 'register' && (
              <>
                <div className="relative">
                  <Building2 className="absolute left-3 top-3 w-4 h-4 text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300" />
                  <select value={department} onChange={e => setDepartment(e.target.value)}
                    className="w-full pl-10 pr-3 py-2.5 text-sm bg-gray-50 dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 focus:border-aegis-500 appearance-none">
                    <option value="">{t('users.department', lang)}</option>
                    {departments.map(d => <option key={d} value={d}>{d}</option>)}
                  </select>
                </div>
                <div className="relative">
                  <Phone className="absolute left-3 top-3 w-4 h-4 text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300" />
                  <input type="tel" placeholder={`${t('common.phone', lang)} (${t('citizen.auth.optional', lang)})`} value={phone} onChange={e => setPhone(e.target.value)}
                    className="w-full pl-10 pr-3 py-2.5 text-sm bg-gray-50 dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 focus:border-aegis-500 outline-none" />
                </div>
              </>
            )}

            <button type="submit" disabled={loading || (mode === 'register' && !allValid)}
              className="w-full bg-gradient-to-r from-aegis-600 to-aegis-700 hover:from-aegis-500 hover:to-aegis-600 disabled:from-gray-400 disabled:to-gray-400 disabled:cursor-not-allowed py-3 rounded-xl font-bold text-sm text-white transition-all shadow-lg shadow-aegis-600/25 flex items-center justify-center gap-2">
              {loading
                ? <><Loader2 className="w-4 h-4 animate-spin" /> {mode === 'login' ? t('admin.login.signingIn', lang) : t('citizen.auth.creating', lang)}</>
                : mode === 'login'
                  ? t('login.signIn', lang)
                  : t('citizen.auth.createAccount', lang)}
            </button>
          </form>

          {mode === 'login' && <p className="text-center text-[10px] text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 mt-3">{t('admin.portal.signin', lang)}</p>}

          <div className="flex items-center justify-center gap-3 mt-4 pt-3 border-t border-gray-100 dark:border-gray-800">
            <span className="flex items-center gap-1 text-[10px] text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300"><Lock className="w-3 h-3"/>{t('admin.login.secureConnection', lang)}</span>
            <span className="text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-700">·</span>
            <span className="text-[10px] text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300">{t('users.sessions', lang)}</span>
            <span className="text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-700">·</span>
            <span className="text-[10px] text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300">{t('admin.login.protectedSystem', lang)}</span>
          </div>
        </div>
        </div>
      </div>
      </div>
    </div>
  )
}





