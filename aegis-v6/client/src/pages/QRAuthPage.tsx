/**
 * QRAuthPage.tsx — Emergency QR Code Authentication
 *
 * Two QR modes on the desktop (generator):
 *   📱 Phone Browser  — QR points to a server-side mini login page on the phone
 *   🔑 Authenticator  — QR encodes an otpauth:// URI; user scans with Google
 *                        Authenticator / Authy, then enters email + 6-digit code here
 *
 * The "approve" sub-page (when user arrives via /citizen/qr-auth?session=xxx) is
 * only used for the Phone Browser mode and is kept for backward compatibility.
 */

import { useState, useEffect, useRef } from 'react'
import { useSearchParams, useNavigate, Link } from 'react-router-dom'
import {
  QrCode, Loader2, CheckCircle, XCircle, Shield, RefreshCw,
  Smartphone, ArrowLeft, KeyRound,
} from 'lucide-react'
import { useCitizenAuth } from '../contexts/CitizenAuthContext'
import { API_BASE } from '../utils/helpers'

export default function QRAuthPage() {
  const [searchParams] = useSearchParams()
  const sessionId = searchParams.get('session')

  if (sessionId) return <QRApprove sessionId={sessionId} />
  return <QRGenerate />
}

// ─── Mode types ─────────────────────────────────────────────────────────────

type Mode = 'phone' | 'totp'

// ─── Combined generator wrapper ─────────────────────────────────────────────

function QRGenerate() {
  const [mode, setMode] = useState<Mode>('phone')

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-950 dark:to-gray-900 flex items-center justify-center p-4">
      <div className="max-w-md w-full space-y-4">

        {/* Header */}
        <div className="text-center">
          <div className="inline-flex items-center gap-2 mb-1">
            <Shield className="w-7 h-7 text-aegis-500" />
            <h1 className="text-xl font-bold text-gray-900 dark:text-white">Emergency QR Sign-In</h1>
          </div>
          <p className="text-xs text-gray-400">Choose how you want to scan and authenticate</p>
        </div>

        {/* Mode tabs */}
        <div className="flex bg-gray-100 dark:bg-gray-800 rounded-xl p-1 gap-1">
          <button
            onClick={() => setMode('phone')}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-sm font-medium transition-all ${
              mode === 'phone'
                ? 'bg-white dark:bg-gray-700 text-aegis-600 dark:text-aegis-400 shadow-sm'
                : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
            }`}
          >
            <Smartphone className="w-4 h-4" />
            Phone Browser
          </button>
          <button
            onClick={() => setMode('totp')}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-sm font-medium transition-all ${
              mode === 'totp'
                ? 'bg-white dark:bg-gray-700 text-indigo-600 dark:text-indigo-400 shadow-sm'
                : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
            }`}
          >
            <KeyRound className="w-4 h-4" />
            Authenticator App
          </button>
        </div>

        {/* Panel */}
        <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-xl border border-gray-200 dark:border-gray-800 p-8">
          {mode === 'phone' ? <PhoneBrowserMode /> : <AuthenticatorMode />}
        </div>

        <div className="text-center">
          <Link to="/citizen/login" className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 transition">
            <ArrowLeft className="w-3 h-3" /> Back to sign in
          </Link>
        </div>
      </div>
    </div>
  )
}

// ─── Mode 1: Phone Browser ───────────────────────────────────────────────────

function PhoneBrowserMode() {
  const [qrCode, setQrCode] = useState('')
  const [sessionId, setSessionId] = useState('')
  const [scanUrl, setScanUrl] = useState('')
  const [lanUrl, setLanUrl] = useState('')
  const [status, setStatus] = useState<'loading' | 'pending' | 'scanned' | 'approved' | 'expired' | 'error'>('loading')
  const [userData, setUserData] = useState<any>(null)
  const pollRef = useRef<ReturnType<typeof setInterval>>()
  const navigate = useNavigate()
  const { login } = useCitizenAuth()

  const generate = async () => {
    setStatus('loading')
    try {
      const res = await fetch(`${API_BASE}/api/auth/qr/generate`, { method: 'POST' })
      const data = await res.json()
      if (data.success) {
        setQrCode(data.data.qrCode)
        setSessionId(data.data.sessionId)
        setScanUrl(data.data.scanUrl)
        setLanUrl(data.data.lanUrl || '')
        setStatus('pending')
        startPolling(data.data.sessionId)
      } else setStatus('error')
    } catch { setStatus('error') }
  }

  const startPolling = (sid: string) => {
    if (pollRef.current) clearInterval(pollRef.current)
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`${API_BASE}/api/auth/qr/status/${sid}`)
        const data = await res.json()
        if (!data.success) { setStatus('expired'); clearInterval(pollRef.current); return }
        const s = data.data.status
        if (s === 'approved' && data.data.token) {
          setStatus('approved')
          setUserData(data.data.user)
          clearInterval(pollRef.current)
          setTimeout(() => {
            login({ token: data.data.token, user: data.data.user })
            navigate('/citizen/dashboard', { replace: true })
          }, 2000)
        } else if (s === 'scanned') {
          setStatus('scanned')
        } else if (data.data.expiresIn <= 0) {
          setStatus('expired'); clearInterval(pollRef.current)
        }
      } catch { /* ignore */ }
    }, 2000)
  }

  useEffect(() => {
    generate()
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [])

  const isLan = lanUrl && (lanUrl.includes('192.168') || lanUrl.includes('10.') || lanUrl.includes('172.'))

  return (
    <div className="space-y-5 text-center">
      <div>
        <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Scan with your phone camera</p>
        <p className="text-xs text-gray-400 mt-0.5">Opens a sign-in page on your phone — no app needed</p>
      </div>

      {status === 'loading' && (
        <div className="py-10">
          <Loader2 className="w-8 h-8 animate-spin text-aegis-500 mx-auto" />
          <p className="text-xs text-gray-400 mt-2">Generating QR code...</p>
        </div>
      )}

      {status === 'pending' && qrCode && (
        <>
          <div className="bg-white p-3 rounded-xl inline-block border-2 border-aegis-200">
            <img src={qrCode} alt="Scan to sign in" className="w-56 h-56" />
          </div>
          {isLan ? (
            <div className="bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 rounded-lg p-2.5 text-left">
              <p className="text-xs font-semibold text-blue-700 dark:text-blue-300">📱 Same WiFi required</p>
              <p className="text-xs text-blue-600 dark:text-blue-400 mt-0.5 break-all font-mono">{scanUrl}</p>
            </div>
          ) : (
            <div className="bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 rounded-lg p-2.5 text-left">
              <p className="text-xs font-semibold text-amber-700 dark:text-amber-300">⚠️ Restart needed for LAN mode</p>
              <p className="text-xs text-amber-600 dark:text-amber-400 mt-0.5">Re-run <span className="font-mono">node start-dev.mjs</span> to detect your network IP.</p>
            </div>
          )}
          <div className="flex items-center justify-center gap-1.5">
            <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
            <span className="text-xs text-gray-400">Waiting for scan...</span>
          </div>
        </>
      )}

      {status === 'scanned' && (
        <div className="py-8 space-y-2">
          <Smartphone className="w-10 h-10 text-blue-500 mx-auto" />
          <p className="text-sm font-medium text-blue-600 dark:text-blue-400">QR scanned!</p>
          <p className="text-xs text-gray-400">Waiting for approval on the phone...</p>
          <Loader2 className="w-5 h-5 animate-spin text-blue-500 mx-auto" />
        </div>
      )}

      {status === 'approved' && (
        <div className="py-8 space-y-2">
          <CheckCircle className="w-12 h-12 text-green-500 mx-auto" />
          <p className="text-sm font-medium text-green-600">Signed in as {userData?.displayName || userData?.email}</p>
          <p className="text-xs text-gray-400">Redirecting...</p>
        </div>
      )}

      {(status === 'expired' || status === 'error') && (
        <div className="py-8 space-y-3">
          <XCircle className="w-10 h-10 text-gray-400 mx-auto" />
          <p className="text-xs text-gray-500">{status === 'expired' ? 'QR code expired' : 'Failed to generate QR'}</p>
          <button onClick={generate}
            className="inline-flex items-center gap-2 px-4 py-2 bg-aegis-500 hover:bg-aegis-600 text-white rounded-xl text-sm font-medium transition">
            <RefreshCw className="w-3.5 h-3.5" /> Try again
          </button>
        </div>
      )}
    </div>
  )
}

// ─── Mode 2: Authenticator App (TOTP) ────────────────────────────────────────

function AuthenticatorMode() {
  const [qrCode, setQrCode] = useState('')
  const [sessionId, setSessionId] = useState('')
  const [status, setStatus] = useState<'loading' | 'ready' | 'verifying' | 'success' | 'error'>('loading')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [errorMsg, setErrorMsg] = useState('')
  const [timeLeft, setTimeLeft] = useState(180)
  const navigate = useNavigate()
  const { login } = useCitizenAuth()
  const timerRef = useRef<ReturnType<typeof setInterval>>()

  const generate = async () => {
    setStatus('loading')
    setCode('')
    setErrorMsg('')
    try {
      const res = await fetch(`${API_BASE}/api/auth/qr/totp/generate`, { method: 'POST' })
      const data = await res.json()
      if (data.success) {
        setQrCode(data.data.qrCode)
        setSessionId(data.data.sessionId)
        setTimeLeft(data.data.expiresIn)
        setStatus('ready')
        // Countdown
        if (timerRef.current) clearInterval(timerRef.current)
        timerRef.current = setInterval(() => {
          setTimeLeft(t => {
            if (t <= 1) { clearInterval(timerRef.current); setStatus('error'); setErrorMsg('Session expired'); return 0 }
            return t - 1
          })
        }, 1000)
      } else setStatus('error')
    } catch { setStatus('error'); setErrorMsg('Failed to generate QR') }
  }

  useEffect(() => {
    generate()
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [])

  const handleVerify = async () => {
    if (!email.trim() || code.replace(/\s/g, '').length !== 6) {
      setErrorMsg('Enter your email and the 6-digit code from the app')
      return
    }
    setStatus('verifying')
    setErrorMsg('')
    try {
      const res = await fetch(`${API_BASE}/api/auth/qr/totp/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, email: email.trim(), code: code.replace(/\s/g, '') }),
      })
      const data = await res.json()
      if (data.success) {
        if (timerRef.current) clearInterval(timerRef.current)
        setStatus('success')
        setTimeout(() => {
          login({ token: data.data.token, user: data.data.user })
          navigate('/citizen/dashboard', { replace: true })
        }, 1500)
      } else {
        setStatus('ready')
        setErrorMsg(data.error || 'Verification failed')
      }
    } catch {
      setStatus('ready')
      setErrorMsg('Network error — please try again')
    }
  }

  return (
    <div className="space-y-5 text-center">
      <div>
        <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Scan with Google Authenticator or Authy</p>
        <p className="text-xs text-gray-400 mt-0.5">Enter your email + the 6-digit code below</p>
      </div>

      {status === 'loading' && (
        <div className="py-10">
          <Loader2 className="w-8 h-8 animate-spin text-indigo-500 mx-auto" />
          <p className="text-xs text-gray-400 mt-2">Generating TOTP code...</p>
        </div>
      )}

      {(status === 'ready' || status === 'verifying') && qrCode && (
        <>
          {/* QR code */}
          <div className="bg-white p-3 rounded-xl inline-block border-2 border-indigo-200">
            <img src={qrCode} alt="Scan with authenticator app" className="w-56 h-56" />
          </div>

          {/* Timer */}
          <div className={`text-xs font-medium ${timeLeft < 30 ? 'text-red-500' : 'text-gray-400'}`}>
            Code expires in <span className="font-mono">{Math.floor(timeLeft / 60)}:{String(timeLeft % 60).padStart(2, '0')}</span>
          </div>

          {/* Steps hint */}
          <div className="bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800 rounded-lg p-3 text-left space-y-1">
            <p className="text-xs font-semibold text-indigo-700 dark:text-indigo-300">How to use:</p>
            <ol className="text-xs text-indigo-600 dark:text-indigo-400 space-y-0.5 list-decimal list-inside">
              <li>Open Google Authenticator or Authy on your phone</li>
              <li>Tap <strong>+</strong> → <strong>Scan QR code</strong></li>
              <li>Scan the code above — a 6-digit number will appear</li>
              <li>Enter your AEGIS email and that code below</li>
            </ol>
          </div>

          {/* Form */}
          <div className="space-y-2 text-left">
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="Your AEGIS email"
              autoComplete="email"
              className="w-full px-3 py-2.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-sm text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <input
              type="text"
              inputMode="numeric"
              maxLength={7}
              value={code}
              onChange={e => setCode(e.target.value.replace(/[^0-9 ]/g, ''))}
              placeholder="6-digit code"
              autoComplete="one-time-code"
              className="w-full px-3 py-2.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-sm text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono tracking-widest text-center"
            />
            {errorMsg && <p className="text-xs text-red-500 text-center">{errorMsg}</p>}
            <button
              onClick={handleVerify}
              disabled={status === 'verifying'}
              className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-xl text-sm font-semibold transition flex items-center justify-center gap-2"
            >
              {status === 'verifying' ? <><Loader2 className="w-4 h-4 animate-spin" /> Verifying...</> : <>
                <KeyRound className="w-4 h-4" /> Verify & Sign In
              </>}
            </button>
          </div>
        </>
      )}

      {status === 'success' && (
        <div className="py-8 space-y-2">
          <CheckCircle className="w-12 h-12 text-green-500 mx-auto" />
          <p className="text-sm font-medium text-green-600">Verified! Signing you in...</p>
        </div>
      )}

      {status === 'error' && (
        <div className="py-8 space-y-3">
          <XCircle className="w-10 h-10 text-gray-400 mx-auto" />
          <p className="text-xs text-gray-500">{errorMsg || 'Something went wrong'}</p>
          <button onClick={generate}
            className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-medium transition">
            <RefreshCw className="w-3.5 h-3.5" /> Generate new code
          </button>
        </div>
      )}
    </div>
  )
}

// ─── QR Approve (phone arrived via scan in Phone Browser mode) ───────────────

/** Approve a QR session (citizen scanned QR on their phone) */
function QRApprove({ sessionId }: { sessionId: string }) {
  const { isAuthenticated } = useCitizenAuth()
  const navigate = useNavigate()
  const [status, setStatus] = useState<'loading' | 'confirm' | 'approved' | 'error' | 'expired'>('loading')
  const [error, setError] = useState('')

  useEffect(() => {
    const scan = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/auth/qr/scan`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId }),
        })
        const data = await res.json()
        if (data.success) setStatus('confirm')
        else { setStatus('expired'); setError(data.error || 'QR code expired') }
      } catch { setStatus('error'); setError('Failed to process QR code') }
    }
    scan()
  }, [sessionId])

  const handleApprove = async () => {
    if (!isAuthenticated) {
      navigate(`/citizen/login?redirect=/citizen/qr-auth?session=${sessionId}`)
      return
    }
    setStatus('loading')
    try {
      const token = localStorage.getItem('citizen_token')
      const res = await fetch(`${API_BASE}/api/auth/qr/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ sessionId }),
      })
      const data = await res.json()
      if (data.success) setStatus('approved')
      else { setStatus('error'); setError(data.error || 'Failed to approve') }
    } catch { setStatus('error'); setError('Failed to approve session') }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-950 dark:to-gray-900 flex items-center justify-center p-4">
      <div className="max-w-sm w-full">
        <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-xl border border-gray-200 dark:border-gray-800 p-8 text-center space-y-6">
          <Shield className="w-10 h-10 text-aegis-500 mx-auto" />

          {status === 'loading' && (
            <><Loader2 className="w-8 h-8 animate-spin text-aegis-500 mx-auto" /><p className="text-sm text-gray-500">Processing...</p></>
          )}

          {status === 'confirm' && (
            <>
              <div>
                <h2 className="text-lg font-bold text-gray-900 dark:text-white">Confirm Sign-In</h2>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                  {isAuthenticated ? 'Approve this session to sign in on the other device' : 'Sign in first to approve this session'}
                </p>
              </div>
              <div className="flex gap-3">
                <button onClick={() => navigate('/citizen/login')}
                  className="flex-1 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition">
                  Cancel
                </button>
                <button onClick={handleApprove}
                  className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 text-white text-sm font-medium transition shadow-sm">
                  {isAuthenticated ? 'Approve' : 'Sign In First'}
                </button>
              </div>
            </>
          )}

          {status === 'approved' && (
            <>
              <CheckCircle className="w-12 h-12 text-green-500 mx-auto" />
              <p className="text-sm font-medium text-green-600">Session approved!</p>
              <p className="text-xs text-gray-500">The other device will be signed in shortly.</p>
            </>
          )}

          {(status === 'error' || status === 'expired') && (
            <>
              <XCircle className="w-12 h-12 text-red-400 mx-auto" />
              <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
              <Link to="/citizen/login" className="inline-flex items-center gap-1 text-sm text-aegis-600 hover:underline">
                <ArrowLeft className="w-3 h-3" /> Back to sign in
              </Link>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

