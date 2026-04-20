/**
 * QRAuthPage.tsx -- Emergency QR Code Authentication
 *
 * Two QR modes on the desktop (generator):
 *   📱 Phone Browser  -- QR points to a server-side mini login page on the phone
 *   🔑 Authenticator  -- QR encodes an otpauth:// URI; user scans with Google
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
import { useCitizenAuth, getCitizenToken } from '../contexts/CitizenAuthContext'
import { API_BASE } from '../utils/helpers'

export default function QRAuthPage() {
  const [searchParams] = useSearchParams()
  const sessionId = searchParams.get('session')

  if (sessionId) return <QRApprove sessionId={sessionId} />
  return <QRGenerate />
}

//Mode types

type Mode = 'phone' | 'totp'

//Combined generator wrapper

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
        <div className="flex bg-gray-100 dark:bg-gray-800 rounded-xl p-1 gap-1" role="tablist" aria-label="Authentication mode">
          <button
            role="tab"
            aria-selected={mode === 'phone'}
            aria-controls="qr-panel"
            id="tab-phone"
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
            role="tab"
            aria-selected={mode === 'totp'}
            aria-controls="qr-panel"
            id="tab-totp"
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
        <div id="qr-panel" role="tabpanel" aria-labelledby={mode === 'phone' ? 'tab-phone' : 'tab-totp'} className="bg-white dark:bg-gray-900 rounded-2xl shadow-xl border border-gray-200 dark:border-gray-800 p-8">
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

//Mode 1: Phone Browser

function PhoneBrowserMode() {
  const [qrCode, setQrCode] = useState('')
  const [sessionId, setSessionId] = useState('')
  const [scanUrl, setScanUrl] = useState('')
  const [lanUrl, setLanUrl] = useState('')
  const [status, setStatus] = useState<'loading' | 'pending' | 'scanned' | 'approved' | 'expired' | 'error'>('loading')
  const [userData, setUserData] = useState<any>(null)
  const pollRef = useRef<ReturnType<typeof setInterval>>()
  const navigate = useNavigate()
  const { complete2FA } = useCitizenAuth()

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
            complete2FA(data.data.token, data.data.user)
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
        <p className="text-xs text-gray-400 mt-0.5">Opens a sign-in page on your phone -- no app needed</p>
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
 <p className="text-xs font-semibold text-amber-700 dark:text-amber-300">!️ Restart needed for LAN mode</p>
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

//Mode 2: Authenticator App (TOTP)

function AuthenticatorMode() {
  const [qrCode, setQrCode] = useState('')
  const [sessionId, setSessionId] = useState('')
  const [label, setLabel] = useState('')
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'verifying' | 'success' | 'error'>('idle')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [errorMsg, setErrorMsg] = useState('')
  const [timeLeft, setTimeLeft] = useState(0)
  const navigate = useNavigate()
  const { complete2FA } = useCitizenAuth()
  const timerRef = useRef<ReturnType<typeof setInterval>>()
  //Default false: assume user already has the entry in their authenticator.
  //Showing the QR every time causes duplicate entries in Google Authenticator.
  const [showQr, setShowQr] = useState(false)
  const [isNewSetup, setIsNewSetup] = useState(false)

  const generate = async () => {
    const normalizedEmail = email.trim().toLowerCase()
    if (!normalizedEmail) {
      setErrorMsg('Enter your account email first')
      return
    }

    setStatus('loading')
    setCode('')
    setErrorMsg('')
    setShowQr(false)
    setIsNewSetup(false)
    try {
      const res = await fetch(`${API_BASE}/api/auth/qr/totp/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: normalizedEmail }),
      })
      const data = await res.json()
      if (data.success) {
        setQrCode(data.data.qrCode)
        setSessionId(data.data.sessionId)
        setLabel(data.data.label || '')
        setTimeLeft(data.data.expiresIn)
        setEmail(normalizedEmail)
        //First-time setup: auto-show QR so user can scan it
        if (data.data.isNewSetup) {
          setShowQr(true)
          setIsNewSetup(true)
        }
        setStatus('ready')
        //Countdown
        if (timerRef.current) clearInterval(timerRef.current)
        timerRef.current = setInterval(() => {
          setTimeLeft(t => {
            if (t <= 1) { clearInterval(timerRef.current); setStatus('error'); setErrorMsg('Session expired'); return 0 }
            return t - 1
          })
        }, 1000)
      } else {
        setStatus('error')
        const errMsg = typeof data.error === 'string' ? data.error : data.error?.message || 'Failed to generate QR code'
        setErrorMsg(errMsg)
      }
    } catch {
      setStatus('error')
      setErrorMsg('Network error -- could not connect to server. Try again.')
    }
  }

  useEffect(() => {
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [])

  const handleVerify = async () => {
    if (!sessionId) {
      setErrorMsg('Generate a QR code first')
      return
    }
    if (code.replace(/\s/g, '').length !== 6) {
      setErrorMsg('Enter the 6-digit code from your authenticator app')
      return
    }
    setStatus('verifying')
    setErrorMsg('')
    try {
      const res = await fetch(`${API_BASE}/api/auth/qr/totp/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        //Include email for backward compatibility with older backend nodes.
        body: JSON.stringify({ sessionId, email: email.trim(), code: code.replace(/\s/g, '') }),
      })
      const data = await res.json()
      if (data.success) {
        if (timerRef.current) clearInterval(timerRef.current)
        setStatus('success')
        setTimeout(() => {
          complete2FA(data.data.token, data.data.user)
          navigate('/citizen/dashboard', { replace: true })
        }, 1500)
      } else {
        setStatus('ready')
        const errMsg = typeof data.error === 'string' ? data.error : data.error?.message || 'Verification failed -- please try again'
        setErrorMsg(errMsg)
      }
    } catch {
      setStatus('ready')
      setErrorMsg('Network error -- please try again')
    }
  }

  return (
    <div className="space-y-5 text-center">
      <div>
        <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Sign in with your authenticator app</p>
        <p className="text-xs text-gray-400 mt-0.5">Enter your email, then type the 6-digit code from your app</p>
      </div>

      {(status === 'idle' || (!qrCode && status !== 'loading')) && (
        <div className="space-y-2 text-left">
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="Your AEGIS email"
            autoComplete="email"
            className="w-full px-3 py-2.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-sm text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          {errorMsg && <p className="text-xs text-red-500 text-center">{errorMsg}</p>}
          <button
            onClick={generate}
            className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-semibold transition"
          >
            Continue
          </button>
        </div>
      )}

      {status === 'loading' && (
        <div className="py-10">
          <Loader2 className="w-8 h-8 animate-spin text-indigo-500 mx-auto" />
          <p className="text-xs text-gray-400 mt-2">Preparing session...</p>
        </div>
      )}

      {(status === 'ready' || status === 'verifying') && qrCode && (
        <>
          {/* First-time setup banner */}
          {isNewSetup && (
            <div className="bg-indigo-50 dark:bg-indigo-900/30 border border-indigo-300 dark:border-indigo-700 rounded-lg px-3 py-2 text-xs text-indigo-800 dark:text-indigo-300 font-medium">
              Authenticator has been set up for your account. Scan the QR code below with Google Authenticator, Authy, or any TOTP app.
            </div>
          )}

          {/* Timer */}
          <div className={`text-xs font-medium ${timeLeft < 30 ? 'text-red-500' : 'text-gray-400'}`}>
            Session expires in <span className="font-mono">{Math.floor(timeLeft / 60)}:{String(timeLeft % 60).padStart(2, '0')}</span>
          </div>

          {/* QR code -- shown automatically for first-time, hidden by default for returning users */}
          {showQr && (
            <div className="space-y-2 border-t border-gray-200 dark:border-gray-700 pt-3 mt-1">
              {!isNewSetup && <p className="text-xs text-amber-600 dark:text-amber-400 font-medium">Only scan this if you don't already have an AEGIS entry -- scanning again creates a duplicate.</p>}
              <div className="bg-white p-3 rounded-xl inline-block border-2 border-indigo-200">
                <img src={qrCode} alt="Scan with authenticator app" className="w-48 h-48" />
              </div>
              <p className="text-xs text-gray-500">Entry: <span className="font-mono font-bold text-indigo-600 dark:text-indigo-400">{label}</span></p>
            </div>
          )}

          {/* Code entry */}
          <div className="space-y-2 text-left">
            <div className="text-xs text-gray-500 dark:text-gray-400 text-center mb-1">
              {isNewSetup ? 'After scanning, enter' : 'Open your authenticator app and enter'} the 6-digit code for <span className="font-mono font-bold text-indigo-600 dark:text-indigo-400">{label}</span>
            </div>
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

          {/* Toggle QR visibility for returning users */}
          {!isNewSetup && !showQr && (
            <button onClick={() => setShowQr(true)} className="text-xs text-indigo-500 hover:text-indigo-600 underline">
              Don't have AEGIS in your authenticator yet? Show QR code
            </button>
          )}

          <button onClick={generate} type="button"
            className="text-xs text-gray-400 hover:text-gray-600">
            <RefreshCw className="w-3 h-3 inline mr-1" />Refresh session
          </button>
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

//QR Approve (phone arrived via scan in Phone Browser mode)

/** Approve a QR session (citizen scanned QR on their phone) */
function QRApprove({ sessionId }: { sessionId: string }) {
  const { isAuthenticated } = useCitizenAuth()
  const navigate = useNavigate()
  const [status, setStatus] = useState<'loading' | 'confirm' | 'approved' | 'error' | 'expired'>('loading')
  const [error, setError] = useState('')

  useEffect(() => {
    const justLoggedIn = sessionStorage.getItem('aegis_qr_just_logged_in') === '1'

    if (isAuthenticated && justLoggedIn) {
      //User just came back after logging in via the QR flow -- session was
      //already auto-approved inside complete2FA / login. Show success & go to app.
      sessionStorage.removeItem('aegis_pending_qr_session')
      sessionStorage.removeItem('aegis_qr_return_to')
      sessionStorage.removeItem('aegis_qr_just_logged_in')
      setStatus('approved')
      setTimeout(() => navigate('/citizen/dashboard', { replace: true }), 2500)
      return
    }

    //Normal path (user was already logged in, or not logged in yet):
    //  aegis_pending_qr_session -- auto-approve fetch in complete2FA / login
    //  aegis_qr_return_to       -- tells CitizenAuthPage to come back here after sign-in
    sessionStorage.setItem('aegis_pending_qr_session', sessionId)
    sessionStorage.setItem('aegis_qr_return_to', `/citizen/qr-auth?session=${sessionId}`)

    const scan = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/auth/qr/scan`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId }),
        })
        const data = await res.json()
        if (data.success) setStatus('confirm')
        else {
          setStatus('expired')
          setError(typeof data.error === 'string' ? data.error : data.error?.message || 'QR code expired or invalid')
        }
      } catch {
        setStatus('error')
        setError('Could not process QR code. Check your connection and try again.')
      }
    }
    scan()
  }, [sessionId])

  const handleApprove = async () => {
    const token = getCitizenToken()
    if (!token) {
      setError('Please sign in first to approve this session.')
      return
    }
    setStatus('loading')
    try {
      const res = await fetch(`${API_BASE}/api/auth/qr/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ sessionId }),
      })
      const data = await res.json()
      if (data.success) {
        sessionStorage.removeItem('aegis_pending_qr_session')
        setStatus('approved')
        setTimeout(() => navigate('/citizen/dashboard', { replace: true }), 2500)
      } else {
        setStatus('error')
        setError(typeof data.error === 'string' ? data.error : data.error?.message || 'Could not approve session. Please try again.')
      }
    } catch {
      setStatus('error')
      setError('Could not approve session. Check your connection and try again.')
    }
  }

  const handleGoogleSignIn = () => {
    //Pass the current page URL as ?next= so the OAuth callback redirects
    //back to THIS origin (handles LAN IP phones, localhost desktop, etc.)
    const next = encodeURIComponent(window.location.href)
    window.location.href = `${API_BASE}/api/auth/google?next=${next}`
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-950 dark:to-gray-900 flex items-center justify-center p-4">
      <div className="max-w-sm w-full">
        <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-xl border border-gray-200 dark:border-gray-800 p-8 text-center space-y-6">
          <Shield className="w-10 h-10 text-aegis-500 mx-auto" />

          {status === 'loading' && (
            <><Loader2 className="w-8 h-8 animate-spin text-aegis-500 mx-auto" /><p className="text-sm text-gray-500">Processing...</p></>
          )}

          {status === 'confirm' && isAuthenticated && (
            <>
              <div>
                <h2 className="text-lg font-bold text-gray-900 dark:text-white">Confirm Sign-In</h2>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                  Approve this session to sign in on the other device
                </p>
              </div>
              {error && <p className="text-xs text-red-500">{error}</p>}
              <div className="flex gap-3">
                <button onClick={() => { sessionStorage.removeItem('aegis_pending_qr_session'); window.history.back() }}
                  className="flex-1 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition">
                  Cancel
                </button>
                <button onClick={handleApprove}
                  className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 text-white text-sm font-medium transition shadow-sm">
                  Approve
                </button>
              </div>
            </>
          )}

          {status === 'confirm' && !isAuthenticated && (
            <>
              <div>
                <h2 className="text-lg font-bold text-gray-900 dark:text-white">Sign In to Approve</h2>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                  Sign in on this device to authorize the session on the other screen
                </p>
              </div>
              <div className="space-y-3">
                <button
                  onClick={handleGoogleSignIn}
                  className="w-full flex items-center justify-center gap-3 py-3 px-4 border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-750 transition text-sm font-semibold text-gray-700 dark:text-gray-200 shadow-sm"
                >
                  <svg className="w-5 h-5 flex-shrink-0" viewBox="0 0 24 24">
                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                  </svg>
                  Continue with Google
                </button>
                <div className="relative">
                  <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-gray-200 dark:border-gray-700" /></div>
                  <div className="relative flex justify-center"><span className="bg-white dark:bg-gray-900 px-2 text-xs text-gray-400">or</span></div>
                </div>
                <Link to={`/citizen/login`}
                  className="block w-full py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition text-center">
                  Sign in with email &amp; password
                </Link>
              </div>
              <p className="text-[11px] text-gray-400">After signing in, the session will be approved automatically.</p>
            </>
          )}

          {status === 'approved' && (
            <>
              <CheckCircle className="w-12 h-12 text-green-500 mx-auto" />
              <p className="text-lg font-bold text-green-600 dark:text-green-400">Session approved!</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">The other device is now signed in.</p>
              <p className="text-xs text-gray-400">Taking you to your dashboard...</p>
              <button
                onClick={() => navigate('/citizen/dashboard', { replace: true })}
                className="w-full py-2.5 rounded-xl bg-gradient-to-r from-aegis-500 to-aegis-600 hover:from-aegis-600 hover:to-aegis-700 text-white text-sm font-medium transition shadow-sm"
              >
                Open AEGIS
              </button>
            </>
          )}

          {(status === 'error' || status === 'expired') && (
            <>
              <XCircle className="w-12 h-12 text-red-400 mx-auto" />
              <p className="text-sm text-red-600 dark:text-red-400">{error || 'Something went wrong'}</p>
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

