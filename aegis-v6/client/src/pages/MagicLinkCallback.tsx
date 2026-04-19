/**
 * MagicLinkCallback.tsx — Handles magic link token verification
 * 
 * When user clicks the magic link in their email, they arrive at:
 * /citizen/magic-link?token=...
 * This page verifies the token and logs them in.
 */

import { useEffect, useState } from 'react'
import { useSearchParams, useNavigate, Link } from 'react-router-dom'
import { Loader2, AlertCircle, CheckCircle, Shield, ArrowLeft } from 'lucide-react'
import { useCitizenAuth } from '../contexts/CitizenAuthContext'
import { API_BASE } from '../utils/helpers'

export default function MagicLinkCallback() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { oauthLogin } = useCitizenAuth()
  const [status, setStatus] = useState<'verifying' | 'success' | 'error'>('verifying')
  const [error, setError] = useState('')

  useEffect(() => {
    const token = searchParams.get('token')
    if (!token) { setStatus('error'); setError('No magic link token found'); return }

    const verify = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/auth/magic-link/verify`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
          credentials: 'include',
        })
        const data = await res.json()
        if (data.success && data.token) {
          setStatus('success')
          await oauthLogin(data.token)
          setTimeout(() => {
            navigate('/citizen/dashboard', { replace: true })
          }, 1500)
        } else {
          setStatus('error')
          setError(data.error || 'Magic link expired or invalid')
        }
      } catch {
        setStatus('error')
        setError('Failed to verify magic link')
      }
    }

    verify()
  }, [searchParams, navigate, oauthLogin])

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-950 dark:to-gray-900 flex items-center justify-center p-4">
      <div className="max-w-sm w-full">
        <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-xl border border-gray-200 dark:border-gray-800 p-8 text-center space-y-4">
          <Shield className="w-10 h-10 text-aegis-500 mx-auto" />

          {status === 'verifying' && (
            <>
              <Loader2 className="w-8 h-8 animate-spin text-aegis-500 mx-auto" />
              <p className="text-sm text-gray-600 dark:text-gray-400">Verifying magic link...</p>
            </>
          )}

          {status === 'success' && (
            <>
              <CheckCircle className="w-10 h-10 text-green-500 mx-auto" />
              <p className="text-sm font-medium text-green-600 dark:text-green-400">Signed in successfully!</p>
              <p className="text-xs text-gray-500">Redirecting to dashboard...</p>
            </>
          )}

          {status === 'error' && (
            <>
              <AlertCircle className="w-10 h-10 text-red-400 mx-auto" />
              <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
              <Link to="/citizen/login"
                className="inline-flex items-center gap-1 text-sm text-aegis-600 hover:underline">
                <ArrowLeft className="w-3 h-3" /> Back to sign in
              </Link>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
