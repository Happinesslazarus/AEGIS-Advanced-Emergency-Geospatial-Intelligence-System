/* LoginPage.tsx — Operator authentication with login, register, and password reset forms. */

import { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Shield, Lock, Mail, Camera, User, Building2, Phone, LogIn, UserPlus, CheckCircle, Eye, EyeOff, X as XIcon, Check, Sun, Moon, ArrowLeft, Home } from 'lucide-react'
import { apiLogin, apiRegister, apiGetDepartments, apiForgotPassword, setToken, setUser } from '../../utils/api'
import type { Operator } from '../../types'
import LanguageSelector from '../shared/LanguageSelector'
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
  const { dark, toggle } = useTheme()
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
        if (!displayName) { setError('Full name is required.'); setLoading(false); return }
        if (!allValid) { setError('Password does not meet all requirements.'); setLoading(false); return }
        if (password !== confirmPassword) { setError('Passwords do not match.'); setLoading(false); return }
        const formData = new FormData()
        formData.append('email', email)
        formData.append('password', password)
        formData.append('displayName', displayName)
        formData.append('department', department)
        formData.append('phone', phone)
        if (avatar) formData.append('avatar', avatar)
        await apiRegister(formData)
        setMode('login'); setError('')
        setRegSuccess('Account created successfully! Please sign in with your credentials.')
        setEmail(email); setPassword(''); setConfirmPassword('')
        setDisplayName(''); setDepartment(''); setPhone('')
        setAvatar(null); setAvatarPreview('')
      }
    } catch (err: any) {
      setError(err.message || 'Authentication failed.')
    } finally { setLoading(false) }
  }

  const PwCheck = ({ ok, label }: { ok: boolean; label: string }) => (
    <div className="flex items-center gap-1.5">
      {ok ? <Check className="w-3.5 h-3.5 text-green-500" /> : <XIcon className="w-3.5 h-3.5 text-red-400" />}
      <span className={`text-xs ${ok ? 'text-green-500' : 'text-gray-400'}`}>{label}</span>
    </div>
  )

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-100 via-amber-50/30 to-gray-100 dark:from-[#08080f] dark:via-[#0a0a15] dark:to-[#08080f] flex flex-col">
      {/* Navigation */}
      <nav className="relative bg-[#09090f] backdrop-blur-2xl text-white px-4 h-14 flex items-center justify-between shadow-2xl shadow-black/70 border-b border-amber-500/15">
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-amber-400/60 to-transparent pointer-events-none" />
        <Link to="/" className="flex items-center gap-2.5 group">
          <div className="relative w-9 h-9 rounded-xl bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center shadow-lg shadow-amber-500/40 group-hover:shadow-amber-400/60 transition-all group-hover:scale-105">
            <Shield className="w-5 h-5 text-white drop-shadow-sm" />
            <div className="absolute inset-0 rounded-xl bg-gradient-to-tr from-white/25 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
          </div>
          <div className="hidden sm:block leading-none">
            <span className="font-black text-sm tracking-wide">
              <span className="bg-gradient-to-r from-amber-300 via-yellow-200 to-amber-300 bg-clip-text text-transparent">AEGIS</span>
              {' '}<span className="text-white/80">OPS</span>
            </span>
            <span className="block text-[9px] text-amber-500/50 tracking-widest uppercase">Operator Portal</span>
          </div>
        </Link>
        <div className="flex items-center gap-1.5">
          <LanguageSelector darkNav />
          <button onClick={toggle} className="p-2 hover:bg-amber-500/10 rounded-xl transition-all active:scale-95 group" aria-label="Toggle theme">
            {dark ? <Sun className="w-4 h-4 text-amber-300 group-hover:text-amber-200 transition-colors" /> : <Moon className="w-4 h-4 text-white/50 group-hover:text-white/80 transition-colors" />}
          </button>
          <Link to="/citizen" className="text-xs text-white/50 hover:text-amber-300 bg-white/5 hover:bg-amber-500/10 border border-white/8 hover:border-amber-500/25 px-3 py-1.5 rounded-xl transition-all flex items-center gap-1.5">
            <Home className="w-3.5 h-3.5" /> {t('admin.citizenPage', lang)}
          </Link>
          <Link to="/citizen/auth" className="relative text-xs font-bold px-3.5 py-1.5 rounded-xl overflow-hidden group bg-gradient-to-r from-amber-400 via-yellow-300 to-amber-400 text-black shadow-lg shadow-amber-500/30 hover:shadow-amber-400/50 transition-all hover:scale-[1.03] active:scale-[0.97]">
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-700 ease-in-out" />
            <span className="relative z-10">{t('auth.login', lang)}</span>
          </Link>
        </div>
      </nav>

      <div className="flex-1 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-6">
          <div className="w-16 h-16 bg-gradient-to-br from-amber-400 to-amber-600 rounded-2xl flex items-center justify-center mx-auto mb-3 shadow-lg shadow-amber-500/40">
            <Shield className="w-9 h-9 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{t('admin.portal.title', lang)}</h1>
          <p className="text-sm text-gray-500 dark:text-amber-200/60 mt-1">{mode === 'login' ? t('admin.portal.signin', lang) : t('admin.portal.register', lang)}</p>
        </div>

        <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl p-6">
          <div className="flex mb-5 bg-gray-100 dark:bg-gray-800 rounded-xl p-1">
            <button onClick={() => { setMode('login'); setError(''); setRegSuccess('') }} className={`flex-1 py-2 text-sm font-semibold rounded-lg flex items-center justify-center gap-1.5 transition-all ${mode === 'login' ? 'bg-white dark:bg-gray-700 shadow text-aegis-700' : 'text-gray-500'}`}>
              <LogIn className="w-4 h-4" /> Sign In
            </button>
            <button onClick={() => { setMode('register'); setError(''); setRegSuccess('') }} className={`flex-1 py-2 text-sm font-semibold rounded-lg flex items-center justify-center gap-1.5 transition-all ${mode === 'register' ? 'bg-white dark:bg-gray-700 shadow text-aegis-700' : 'text-gray-500'}`}>
              <UserPlus className="w-4 h-4" /> Register
            </button>
          </div>

          {regSuccess && <div className="bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800 text-green-700 dark:text-green-300 px-3 py-2.5 rounded-xl text-sm mb-4 flex items-center gap-2"><CheckCircle className="w-4 h-4 flex-shrink-0"/>{regSuccess}</div>}
          {error && <div className="bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 px-3 py-2.5 rounded-xl text-sm mb-4">{error}</div>}

          <form onSubmit={handleSubmit} className="space-y-3">
            {mode === 'register' && (
              <div className="flex justify-center mb-2">
                <label className="cursor-pointer relative group">
                  <div className="w-20 h-20 rounded-full border-2 border-dashed border-gray-300 dark:border-gray-600 flex items-center justify-center overflow-hidden bg-gray-50 dark:bg-gray-800 group-hover:border-aegis-400 transition-colors">
                    {avatarPreview ? <img src={avatarPreview} alt="Avatar" className="w-full h-full object-cover" /> : <Camera className="w-6 h-6 text-gray-400" />}
                  </div>
                  <div className="absolute bottom-0 right-0 w-6 h-6 bg-aegis-600 rounded-full flex items-center justify-center shadow"><Camera className="w-3 h-3 text-white" /></div>
                  <input type="file" accept="image/*" onChange={handleAvatarChange} className="hidden" />
                </label>
              </div>
            )}

            {mode === 'register' && (
              <div className="relative">
                <User className="absolute left-3 top-3 w-4 h-4 text-gray-400" />
                <input type="text" placeholder="Full Name *" value={displayName} onChange={e => setDisplayName(e.target.value)}
                  className="w-full pl-10 pr-3 py-2.5 text-sm bg-gray-50 dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 focus:border-aegis-500 focus:ring-1 focus:ring-aegis-500 outline-none" />
              </div>
            )}

            <div className="relative">
              <Mail className="absolute left-3 top-3 w-4 h-4 text-gray-400" />
              <input type="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} required
                className="w-full pl-10 pr-3 py-2.5 text-sm bg-gray-50 dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 focus:border-aegis-500 focus:ring-1 focus:ring-aegis-500 outline-none" />
            </div>

            <div>
              {mode === 'register' && <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1">Password</label>}
              <div className="relative">
                <Lock className="absolute left-3 top-3 w-4 h-4 text-gray-400" />
                <input type={showPassword ? 'text' : 'password'} placeholder={mode === 'register' ? 'Create Password' : 'Password'} value={password} onChange={e => setPassword(e.target.value)} required
                  className="w-full pl-10 pr-10 py-2.5 text-sm bg-gray-50 dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 focus:border-aegis-500 focus:ring-1 focus:ring-aegis-500 outline-none" />
                <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-3 text-gray-400 hover:text-gray-600">
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {mode === 'login' && (
                <div className="mt-1 text-right">
                  <button
                    type="button"
                    onClick={async () => {
                      const targetEmail = email || window.prompt('Enter your account email for password reset:') || ''
                      if (!targetEmail) return
                      try {
                        await apiForgotPassword(targetEmail)
                        setRegSuccess('Reset link generated. Check your email provider integration or backend response.')
                        setError('')
                      } catch (err: any) {
                        setError(err?.message || 'Failed to request password reset.')
                      }
                    }}
                    className="text-[11px] text-aegis-600 hover:underline"
                  >
                    Forgot Password?
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
                <Lock className="absolute left-3 top-3 w-4 h-4 text-gray-400" />
                <input type={showConfirmPassword ? 'text' : 'password'} placeholder="Confirm Password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} required
                  className="w-full pl-10 pr-10 py-2.5 text-sm bg-gray-50 dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 focus:border-aegis-500 focus:ring-1 focus:ring-aegis-500 outline-none" />
                <button type="button" onClick={() => setShowConfirmPassword(!showConfirmPassword)} className="absolute right-3 top-3 text-gray-400 hover:text-gray-600">
                  {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
                {confirmPassword && password !== confirmPassword && <p className="text-xs text-red-400 mt-1 flex items-center gap-1"><XIcon className="w-3 h-3" /> Passwords do not match</p>}
                {confirmPassword && password === confirmPassword && password.length > 0 && <p className="text-xs text-green-500 mt-1 flex items-center gap-1"><Check className="w-3 h-3" /> Passwords match</p>}
              </div>
            )}

            {mode === 'register' && (
              <>
                <div className="relative">
                  <Building2 className="absolute left-3 top-3 w-4 h-4 text-gray-400" />
                  <select value={department} onChange={e => setDepartment(e.target.value)}
                    className="w-full pl-10 pr-3 py-2.5 text-sm bg-gray-50 dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 focus:border-aegis-500 appearance-none">
                    <option value="">Select Department</option>
                    {departments.map(d => <option key={d} value={d}>{d}</option>)}
                  </select>
                </div>
                <div className="relative">
                  <Phone className="absolute left-3 top-3 w-4 h-4 text-gray-400" />
                  <input type="tel" placeholder="Phone (optional)" value={phone} onChange={e => setPhone(e.target.value)}
                    className="w-full pl-10 pr-3 py-2.5 text-sm bg-gray-50 dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 focus:border-aegis-500 outline-none" />
                </div>
              </>
            )}

            <button type="submit" disabled={loading || (mode === 'register' && !allValid)}
              className="w-full bg-aegis-600 hover:bg-aegis-700 disabled:bg-gray-400 disabled:cursor-not-allowed text-white py-3 rounded-xl font-bold text-sm transition-all shadow-lg shadow-aegis-600/30">
              {loading ? 'Please wait...' : mode === 'login' ? 'Sign In' : 'Create Account'}
            </button>
          </form>

          {mode === 'login' && <p className="text-center text-[10px] text-gray-400 mt-3">Use your operator account credentials.</p>}

          <div className="flex items-center justify-center gap-3 mt-4 pt-3 border-t border-gray-100 dark:border-gray-800">
            <span className="flex items-center gap-1 text-[10px] text-gray-400"><Lock className="w-3 h-3"/> SHA-256 encrypted</span>
            <span className="text-gray-300 dark:text-gray-700">·</span>
            <span className="text-[10px] text-gray-400">1-hour sessions</span>
            <span className="text-gray-300 dark:text-gray-700">·</span>
            <span className="text-[10px] text-gray-400">Rate limited</span>
          </div>
        </div>
      </div>
      </div>
    </div>
  )
}
