/**
 * Two factor challenge admin component (operator dashboard panel).
 *
 * - Rendered inside AdminPage.tsx based on active view */

import { useState, useRef, useEffect } from 'react'
import { Shield, Key, ArrowLeft, Loader2, AlertCircle, CheckCircle, Monitor } from 'lucide-react'
import { api2FAAuthenticate } from '../../utils/api'
import type { Operator } from '../../types'
import { t } from '../../utils/i18n'
import { useLanguage } from '../../hooks/useLanguage'

interface Props {
  tempToken: string
  onSuccess: (token: string, user: Operator) => void
  onCancel: () => void
}

export default function TwoFactorChallenge({ tempToken, onSuccess, onCancel }: Props): JSX.Element {
  const lang = useLanguage()
  const [mode, setMode] = useState<'totp' | 'backup'>('totp')
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [backupWarning, setBackupWarning] = useState('')
  const [rememberDevice, setRememberDevice] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const formRef = useRef<HTMLFormElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [mode])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setBackupWarning('')

    const trimmedCode = code.trim()
    if (!trimmedCode) {
      setError(t('twofa.enterCode', lang))
      return
    }

    if (mode === 'totp' && (trimmedCode.length !== 6 || !/^\d{6}$/.test(trimmedCode))) {
      setError(t('twofa.invalidCode', lang))
      return
    }

    setLoading(true)
    try {
      const res = await api2FAAuthenticate(tempToken, trimmedCode, rememberDevice)
      if (res.backupCodeUsed && res.backupCodeWarning) {
        setBackupWarning(res.backupCodeWarning)
      }
      onSuccess(res.token, res.user)
    } catch (err: any) {
      const msg = err.message || t('twofa.verifyFailed', lang)
      if (msg.includes('expired') || msg.includes('log in again')) {
        setError(t('twofa.sessionExpired', lang))
      } else {
        setError(msg)
      }
      setCode('')
      inputRef.current?.focus()
    } finally {
      setLoading(false)
    }
  }

  const handleTOTPInput = (value: string) => {
    // Only allow digits, max 6
    const cleaned = value.replace(/\D/g, '').slice(0, 6)
    setCode(cleaned)
    setError('')
    // Auto-submit when all 6 digits entered
    if (cleaned.length === 6) {
      setTimeout(() => {
        formRef.current?.requestSubmit()
      }, 120)
    }
  }

  const handleBackupInput = (value: string) => {
    // Allow alphanumeric + dashes, max 9 (XXXX-XXXX)
    const cleaned = value.toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 9)
    setCode(cleaned)
    setError('')
  }

  return (
    <div className="w-full max-w-md mx-auto" style={{ animation: 'aegis-fade-up 0.4s ease-out' }}>
      <div className="bg-white/80 dark:bg-gray-900/80 backdrop-blur-xl rounded-2xl border border-gray-200/80 dark:border-gray-700/50 shadow-2xl shadow-gray-300/20 dark:shadow-black/40 p-6">
        {/* Header */}
        <div className="text-center mb-6">
          <div className="w-14 h-14 bg-gradient-to-br from-aegis-500 to-aegis-700 rounded-xl flex items-center justify-center mx-auto mb-3 shadow-lg shadow-aegis-600/30">
            <Shield className="w-7 h-7 text-white" />
          </div>
          <h2 className="text-lg font-bold text-gray-900 dark:text-white">{t('twofa.title', lang)}</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            {mode === 'totp'
              ? t('twofa.enterTotpDesc', lang)
              : t('twofa.enterBackupDesc', lang)}
          </p>
        </div>

        {/* Error */}
        {error && (
          <div className="bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 px-3 py-2.5 rounded-xl text-sm mb-4 flex items-center gap-2"
               role="alert" aria-live="assertive"
               style={{ animation: 'aegis-shake 0.5s ease-in-out' }}>
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            {error}
          </div>
        )}

        {/* Backup code warning */}
        {backupWarning && (
          <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300 px-3 py-2.5 rounded-xl text-sm mb-4 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            {backupWarning}
          </div>
        )}

        {/* Mode tabs */}
        <div className="flex mb-4 bg-gray-100 dark:bg-gray-800 rounded-xl p-1">
          <button
            type="button"
            onClick={() => { setMode('totp'); setCode(''); setError('') }}
            className={`flex-1 py-2 text-xs font-semibold rounded-lg flex items-center justify-center gap-1.5 transition-all ${
              mode === 'totp' ? 'bg-white dark:bg-gray-700 shadow text-aegis-700 dark:text-aegis-300' : 'text-gray-500 dark:text-gray-400'
            }`}
          >
            <Shield className="w-3.5 h-3.5" /> {t('twofa.authenticator', lang)}
          </button>
          <button
            type="button"
            onClick={() => { setMode('backup'); setCode(''); setError('') }}
            className={`flex-1 py-2 text-xs font-semibold rounded-lg flex items-center justify-center gap-1.5 transition-all ${
              mode === 'backup' ? 'bg-white dark:bg-gray-700 shadow text-aegis-700 dark:text-aegis-300' : 'text-gray-500 dark:text-gray-400'
            }`}
          >
            <Key className="w-3.5 h-3.5" /> {t('twofa.backupCode', lang)}
          </button>
        </div>

        {/* Code input form */}
        <form ref={formRef} onSubmit={handleSubmit} className="space-y-4">
          {mode === 'totp' ? (
            <div>
              <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1.5">
                {t('twofa.authCode', lang)}
              </label>
              <input
                ref={inputRef}
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="000000"
                value={code}
                onChange={e => handleTOTPInput(e.target.value)}
                maxLength={6}
                className={`w-full text-center text-2xl font-mono tracking-[0.5em] py-3 bg-gray-50 dark:bg-gray-800 rounded-xl border outline-none transition-all duration-200 ${
                  code.length === 6
                    ? 'border-green-500 ring-2 ring-green-500/20'
                    : 'border-gray-200 dark:border-gray-700 focus:border-aegis-500 focus:ring-2 focus:ring-aegis-500/20'
                }`}
                aria-label={t('twofa.aria.totpCode', lang)}
              />
              {/* Digit progress dots */}
              <div className="flex justify-center gap-2 mt-2.5" aria-hidden="true">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div
                    key={i}
                    className={`rounded-full transition-all duration-150 ${
                      i < code.length
                        ? code.length === 6
                          ? 'w-2.5 h-2.5 bg-green-500 scale-110'
                          : 'w-2.5 h-2.5 bg-aegis-500 scale-110'
                        : 'w-2 h-2 bg-gray-200 dark:bg-gray-700'
                    }`}
                  />
                ))}
              </div>
              {code.length === 6 && !loading && (
                <p className="text-center text-xs text-green-600 dark:text-green-400 mt-1.5 animate-pulse">Verifying…</p>
              )}
            </div>
          ) : (
            <div>
              <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1.5">
                {t('twofa.backupRecoveryCode', lang)}
              </label>
              <input
                ref={inputRef}
                type="text"
                autoComplete="off"
                placeholder="XXXX-XXXX"
                value={code}
                onChange={e => handleBackupInput(e.target.value)}
                maxLength={9}
                className="w-full text-center text-xl font-mono tracking-widest py-3 bg-gray-50 dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 focus:border-aegis-500 focus:ring-2 focus:ring-aegis-500/20 outline-none"
                aria-label={t('twofa.aria.backupCode', lang)}
              />
              <p className="text-[10px] text-gray-400 dark:text-gray-400 mt-1 text-center">
                {t('twofa.backupOnlyOnce', lang)}
              </p>
            </div>
          )}

          {/* Remember device checkbox */}
          <label className="flex items-center gap-2 cursor-pointer group">
            <input
              type="checkbox"
              checked={rememberDevice}
              onChange={e => setRememberDevice(e.target.checked)}
              className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-aegis-600 focus:ring-aegis-500 focus:ring-offset-0"
              aria-label={t('twofa.rememberDevice', lang)}
            />
            <span className="text-xs text-gray-500 dark:text-gray-400 group-hover:text-gray-700 dark:group-hover:text-gray-300 flex items-center gap-1">
              <Monitor className="w-3 h-3" /> {t('twofa.rememberDevice', lang)}
            </span>
          </label>

          <button
            type="submit"
            disabled={loading || !code.trim()}
            className="w-full bg-gradient-to-r from-aegis-600 to-aegis-700 hover:from-aegis-500 hover:to-aegis-600 disabled:from-gray-400 disabled:to-gray-400 disabled:cursor-not-allowed py-3 rounded-xl font-bold text-sm text-white transition-all shadow-lg shadow-aegis-600/25 flex items-center justify-center gap-2"
          >
            {loading ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> {t('twofa.verifying', lang)}</>
            ) : (
              <><CheckCircle className="w-4 h-4" /> {t('twofa.verifySignIn', lang)}</>
            )}
          </button>
        </form>

        {/* Back to login */}
        <div className="mt-4 pt-3 border-t border-gray-100 dark:border-gray-800">
          <button
            type="button"
            onClick={onCancel}
            className="w-full text-xs text-gray-500 dark:text-gray-400 hover:text-aegis-600 dark:hover:text-aegis-300 flex items-center justify-center gap-1.5 py-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-all"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> {t('twofa.backToLogin', lang)}
          </button>
        </div>
      </div>
    </div>
  )
}
