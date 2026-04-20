/**
 * OAuthCallback.tsx -- Handles OAuth exchange code from Google
 * 
 * The server redirects to /citizen/oauth/callback?code=...
 * This page exchanges the one-time code for a JWT, then redirects to dashboard.
 */

import { useEffect, useState } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { Loader2, AlertCircle, Shield } from 'lucide-react'
import { useCitizenAuth, getCitizenToken } from '../contexts/CitizenAuthContext'
import { API_BASE } from '../utils/helpers'

export default function OAuthCallback() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { oauthLogin } = useCitizenAuth()
  const [error, setError] = useState('')

  useEffect(() => {
    const code = searchParams.get('code')
    if (!code) {
      setError('No authorization code received')
      return
    }

    const exchange = async () => {
      const dedupeKey = `aegis-oauth-exchanged:google:${code}`
      if (sessionStorage.getItem(dedupeKey) === '1') {
        return
      }
      sessionStorage.setItem(dedupeKey, '1')

      try {
        const endpoint = `${API_BASE}/api/auth/oauth/exchange`

        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code }),
          credentials: 'include',
        })
        const data = await res.json()
        const token = data?.token || data?.data?.token
        const user = data?.user || data?.data?.user
        const errorMessage = typeof data?.error === 'string'
          ? data.error
          : data?.error?.message

        if (data?.success && token && user) {
          const result = await oauthLogin(token)
          if (result.success) {
            //If the user arrived here from scanning a Phone Browser QR code,
            //auto-approve that QR session before going to the dashboard.
            const pendingQrSession = sessionStorage.getItem('aegis_pending_qr_session')
            if (pendingQrSession) {
              sessionStorage.removeItem('aegis_pending_qr_session')
              const tok = getCitizenToken()
              if (tok) {
                try {
                  await fetch(`${API_BASE}/api/auth/qr/approve`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${tok}` },
                    body: JSON.stringify({ sessionId: pendingQrSession }),
                  })
                } catch {
                  //Non-fatal: user is still logged in, QR approve just didn't fire
                }
              }
            }
            navigate('/citizen/dashboard', { replace: true })
          } else {
            setError(result.error || 'Failed to load account profile')
            sessionStorage.removeItem(dedupeKey)
          }
        } else {
          setError(errorMessage || 'Failed to complete sign-in')
          sessionStorage.removeItem(dedupeKey)
        }
      } catch {
        setError('Failed to complete sign-in')
        sessionStorage.removeItem(dedupeKey)
      }
    }

    exchange()
  }, [searchParams, navigate, oauthLogin])

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-950 dark:to-gray-900 flex items-center justify-center p-4">
      <div className="text-center space-y-4">
        <Shield className="w-12 h-12 text-aegis-500 mx-auto" />
        {error ? (
          <>
            <div className="flex items-center gap-2 text-red-600 dark:text-red-400">
              <AlertCircle className="w-5 h-5" />
              <span className="text-sm font-medium">{error}</span>
            </div>
            <button onClick={() => navigate('/citizen/login')}
              className="text-sm text-aegis-600 hover:underline">
              Return to sign in
            </button>
          </>
        ) : (
          <>
            <Loader2 className="w-8 h-8 animate-spin text-aegis-500 mx-auto" />
            <p className="text-sm text-gray-600 dark:text-gray-400">Completing sign-in...</p>
          </>
        )}
      </div>
    </div>
  )
}
