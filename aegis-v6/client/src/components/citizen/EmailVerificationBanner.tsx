import React, { useState, useEffect } from 'react'
import { Mail } from 'lucide-react'
import { t } from '../../utils/i18n'
import { API_BASE } from '../../utils/helpers'

export default function EmailVerificationBanner({ token, lang, announce }: { token: string | null; lang: string; announce: (msg: string) => void }) {
  const [cooldown, setCooldown] = useState(0)
  const [sending, setSending] = useState(false)

  useEffect(() => {
    if (cooldown <= 0) return
    const timer = setTimeout(() => setCooldown(c => c - 1), 1000)
    return () => clearTimeout(timer)
  }, [cooldown])

  const handleResend = async () => {
    if (cooldown > 0 || sending) return
    setSending(true)
    try {
      const res = await fetch(`${API_BASE}/api/citizen-auth/resend-verification`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        credentials: 'include',
      })
      const data = await res.json()
      if (res.ok) { announce(t('cdash.verificationSent', lang)); setCooldown(60) }
      else announce(data.error || t('cdash.verificationFailed', lang))
    } catch { announce(t('cdash.verificationFailed', lang)) }
    finally { setSending(false) }
  }

  return (
    <div className="bg-amber-50 dark:bg-amber-950/40 border-b border-amber-200 dark:border-amber-800 px-4 py-2.5 flex items-center justify-between gap-3 rounded-xl mb-4">
      <div className="flex items-center gap-2 text-amber-800 dark:text-amber-200 text-sm">
        <Mail className="w-4 h-4 flex-shrink-0" />
        <span>{t('citizen.verifyEmail.banner', lang) || 'Please verify your email address to unlock all features.'}</span>
      </div>
      <button
        onClick={handleResend}
        disabled={cooldown > 0 || sending}
        className="text-xs font-semibold text-amber-700 dark:text-amber-300 bg-amber-100 dark:bg-amber-900/50 hover:bg-amber-200 dark:hover:bg-amber-900 disabled:opacity-60 disabled:cursor-not-allowed px-3 py-1 rounded-lg transition whitespace-nowrap"
      >
        {sending ? 'Sending...' : cooldown > 0 ? `Resend in ${cooldown}s` : (t('citizen.verifyEmail.resend', lang) || 'Resend Email')}
      </button>
    </div>
  )
}
