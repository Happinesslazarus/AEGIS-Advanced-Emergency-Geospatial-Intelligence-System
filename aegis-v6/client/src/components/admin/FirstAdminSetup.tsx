/**
 * Shown on fresh AEGIS installs when no admin account exists yet.
 * Lets the very first person to open the admin panel create an admin
 * account without needing SQL or a terminal.
 *
 * Security:
 * - The backend /api/auth/bootstrap endpoint that this calls is self-locking:
 *   it returns 403 the instant any admin already exists in the database.
 * - So this screen is permanently unreachable once the first admin is created.
 *
 * - Rendered by AdminPage.tsx when setupStatus.hasAdmin === false && !user
 * - On success: passes the new Operator object to onComplete so AdminPage
 *   sets the logged-in user and proceeds to the SetupWizard.
 */

import { useState } from 'react'
import { Shield, Eye, EyeOff, Loader2, CheckCircle2, Lock, Mail, User, AlertCircle } from 'lucide-react'
import { setToken, setUser } from '../../utils/api'
import type { Operator } from '../../types'
import { API_BASE } from '../../utils/helpers'

interface Props {
  onComplete: (user: Operator) => void
}

//Password strength indicator helper
function calcStrength(pw: string): { score: number; label: string; color: string } {
  let s = 0
  if (pw.length >= 12) s++
  if (/[A-Z]/.test(pw)) s++
  if (/[0-9]/.test(pw)) s++
  if (/[!@#$%^&*()\-_=+[\]{};':"\\|,.<>/?`~]/.test(pw)) s++
  const map: [string, string][] = [
    ['Too short', 'bg-red-500'],
    ['Weak', 'bg-orange-400'],
    ['Fair', 'bg-yellow-400'],
    ['Good', 'bg-blue-500'],
    ['Strong', 'bg-emerald-500'],
  ]
  return { score: s, label: map[s][0], color: map[s][1] }
}

export default function FirstAdminSetup({ onComplete }: Props) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  const strength = calcStrength(password)
  const passwordsMatch = password && confirm && password === confirm

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (!name.trim() || !email.trim() || !password) {
      setError('All fields are required.')
      return
    }
    if (password !== confirm) {
      setError('Passwords do not match.')
      return
    }
    if (strength.score < 4) {
      setError('Please choose a stronger password (see requirements below).')
      return
    }

    setLoading(true)
    try {
      const res = await fetch(`${API_BASE}/api/auth/bootstrap`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password, displayName: name.trim() }),
      })
      const data = await res.json()

      if (!res.ok) {
        setError(data.error || 'Setup failed. Please try again.')
        return
      }

      //Store token and user the same way LoginPage does
      setToken(data.token)
      setUser(data.user)
      setDone(true)
      setTimeout(() => onComplete(data.user as Operator), 1200)
    } catch {
      setError('Could not connect to the server. Is the backend running?')
    } finally {
      setLoading(false)
    }
  }

  if (done) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-aegis-900 via-aegis-800 to-slate-900 flex items-center justify-center p-4">
        <div className="text-center text-white space-y-4">
          <div className="w-20 h-20 bg-emerald-500 rounded-full flex items-center justify-center mx-auto shadow-2xl">
            <CheckCircle2 className="w-10 h-10" />
          </div>
          <h2 className="text-2xl font-bold">Account created!</h2>
          <p className="text-white/70">Taking you to the setup wizard...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-aegis-900 via-aegis-800 to-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-gradient-to-br from-aegis-400 to-aegis-600 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-2xl shadow-aegis-900/50">
            <Shield className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-3xl font-extrabold text-white tracking-tight">Welcome to AEGIS</h1>
          <p className="text-white/60 mt-2 text-sm">
            Create your administrator account to get started.
          </p>
          <div className="mt-3 inline-flex items-center gap-2 bg-amber-500/15 border border-amber-500/30 rounded-xl px-3.5 py-2 text-xs text-amber-300">
            <Lock className="w-3.5 h-3.5 flex-shrink-0" />
            This page is only shown once -- it disappears after your account is created.
          </div>
        </div>

        {/* Card */}
        <div className="bg-white/10 backdrop-blur-xl rounded-3xl border border-white/15 shadow-2xl p-6 sm:p-8 space-y-5">
          {error && (
            <div className="flex items-start gap-3 bg-red-500/15 border border-red-500/30 rounded-xl px-4 py-3 text-sm text-red-300">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Full name */}
            <div>
              <label className="block text-xs font-semibold text-white/70 mb-1.5 uppercase tracking-wide">
                Your full name
              </label>
              <div className="relative">
                <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
                <input
                  type="text"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="e.g. Alex Johnson"
                  autoComplete="name"
                  className="w-full bg-white/10 border border-white/20 rounded-xl pl-10 pr-4 py-3 text-white placeholder-white/30 text-sm focus:outline-none focus:ring-2 focus:ring-aegis-400 focus:border-transparent transition"
                />
              </div>
            </div>

            {/* Email */}
            <div>
              <label className="block text-xs font-semibold text-white/70 mb-1.5 uppercase tracking-wide">
                Email address
              </label>
              <div className="relative">
                <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="admin@yourorganisation.com"
                  autoComplete="email"
                  className="w-full bg-white/10 border border-white/20 rounded-xl pl-10 pr-4 py-3 text-white placeholder-white/30 text-sm focus:outline-none focus:ring-2 focus:ring-aegis-400 focus:border-transparent transition"
                />
              </div>
            </div>

            {/* Password */}
            <div>
              <label className="block text-xs font-semibold text-white/70 mb-1.5 uppercase tracking-wide">
                Password
              </label>
              <div className="relative">
                <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
                <input
                  type={showPw ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="Create a strong password"
                  autoComplete="new-password"
                  className="w-full bg-white/10 border border-white/20 rounded-xl pl-10 pr-10 py-3 text-white placeholder-white/30 text-sm focus:outline-none focus:ring-2 focus:ring-aegis-400 focus:border-transparent transition"
                />
                <button type="button" onClick={() => setShowPw(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/70 transition">
                  {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {/* Strength bar */}
              {password && (
                <div className="mt-2 space-y-1.5">
                  <div className="flex gap-1">
                    {[0, 1, 2, 3].map(i => (
                      <div key={i} className={`h-1 flex-1 rounded-full transition-all duration-300 ${i < strength.score ? strength.color : 'bg-white/15'}`} />
                    ))}
                  </div>
                  <p className="text-[11px] text-white/50">
                    Strength: <span className="font-semibold text-white/70">{strength.label}</span>
                    {' - '}Min 12 chars - uppercase - number - symbol
                  </p>
                </div>
              )}
            </div>

            {/* Confirm password */}
            <div>
              <label className="block text-xs font-semibold text-white/70 mb-1.5 uppercase tracking-wide">
                Confirm password
              </label>
              <div className="relative">
                <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
                <input
                  type={showConfirm ? 'text' : 'password'}
                  value={confirm}
                  onChange={e => setConfirm(e.target.value)}
                  placeholder="Type your password again"
                  autoComplete="new-password"
                  className={`w-full bg-white/10 border rounded-xl pl-10 pr-10 py-3 text-white placeholder-white/30 text-sm focus:outline-none focus:ring-2 focus:ring-aegis-400 focus:border-transparent transition ${
                    confirm && !passwordsMatch ? 'border-red-500/60' : 'border-white/20'
                  }`}
                />
                <button type="button" onClick={() => setShowConfirm(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/70 transition">
                  {showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
                {passwordsMatch && (
                  <CheckCircle2 className="absolute right-8 top-1/2 -translate-y-1/2 w-4 h-4 text-emerald-400" />
                )}
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-aegis-600 hover:bg-aegis-500 disabled:opacity-60 disabled:cursor-not-allowed text-white font-bold py-3.5 rounded-xl transition-all duration-200 hover:scale-[1.01] active:scale-[0.99] flex items-center justify-center gap-2 shadow-lg shadow-aegis-900/40 mt-2"
            >
              {loading ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Creating account...</>
              ) : (
                <><Shield className="w-4 h-4" /> Create admin account</>
              )}
            </button>
          </form>
        </div>

        <p className="text-center text-white/30 text-xs mt-6">
          AEGIS - Advanced Emergency Geospatial Intelligence System
        </p>
      </div>
    </div>
  )
}
