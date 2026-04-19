/**
 * Module: TwoFactorSettings.tsx
 *
 * Two factor settings admin component (operator dashboard panel).
 *
 * - Rendered inside AdminPage.tsx based on active view */

import { useState, useEffect, useRef } from 'react'
import {
  Shield, ShieldCheck, ShieldOff, Key, QrCode, Copy, Download,
  Loader2, AlertCircle, CheckCircle, Eye, EyeOff, Lock, RefreshCw
} from 'lucide-react'
import {
  api2FAGetStatus, api2FASetup, api2FAVerify, api2FADisable,
  api2FARegenerateBackupCodes, type TwoFactorStatusResponse
} from '../../utils/api'
import { t } from '../../utils/i18n'
import { useLanguage } from '../../hooks/useLanguage'

export default function TwoFactorSettings(): JSX.Element {
  const lang = useLanguage()
  const [status, setStatus] = useState<TwoFactorStatusResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  // Setup state
  const [setupData, setSetupData] = useState<{ manualKey: string; qrCodeDataUrl: string } | null>(null)
  const [setupCode, setSetupCode] = useState('')
  const [setupLoading, setSetupLoading] = useState(false)

  // Backup codes display
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null)
  const [backupCodesConfirmed, setBackupCodesConfirmed] = useState(false)

  // Disable state
  const [showDisable, setShowDisable] = useState(false)
  const [disablePassword, setDisablePassword] = useState('')
  const [disableCode, setDisableCode] = useState('')
  const [disableLoading, setDisableLoading] = useState(false)
  const [showDisablePassword, setShowDisablePassword] = useState(false)

  // Regenerate state
  const [showRegen, setShowRegen] = useState(false)
  const [regenPassword, setRegenPassword] = useState('')
  const [regenCode, setRegenCode] = useState('')
  const [regenLoading, setRegenLoading] = useState(false)
  const [showRegenPassword, setShowRegenPassword] = useState(false)

  const [copied, setCopied] = useState(false)
  const verifyInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    loadStatus()
  }, [])

  async function loadStatus() {
    try {
      const s = await api2FAGetStatus()
      setStatus(s)
    } catch (err: any) {
      setError(t('twofa.loadFailed', lang))
    } finally {
      setLoading(false)
    }
  }

  // Setup Flow

  async function handleStartSetup() {
    setError('')
    setSuccess('')
    setSetupLoading(true)
    try {
      const data = await api2FASetup()
      setSetupData({ manualKey: data.manualKey, qrCodeDataUrl: data.qrCodeDataUrl })
      setTimeout(() => verifyInputRef.current?.focus(), 100)
    } catch (err: any) {
      setError(err.message || t('twofa.setupFailed', lang))
    } finally {
      setSetupLoading(false)
    }
  }

  async function handleVerifySetup(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    const trimmed = setupCode.trim()
    if (!trimmed || trimmed.length !== 6 || !/^\d{6}$/.test(trimmed)) {
      setError(t('twofa.invalidSetupCode', lang))
      return
    }
    setSetupLoading(true)
    try {
      const res = await api2FAVerify(trimmed)
      setBackupCodes(res.backupCodes)
      setSetupData(null)
      setSetupCode('')
      setSuccess(t('twofa.enabled', lang))
      await loadStatus()
    } catch (err: any) {
      setError(err.message || t('twofa.verifyFreshCode', lang))
      setSetupCode('')
      verifyInputRef.current?.focus()
    } finally {
      setSetupLoading(false)
    }
  }

  function handleCancelSetup() {
    setSetupData(null)
    setSetupCode('')
    setError('')
  }

  // Disable Flow

  async function handleDisable(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!disablePassword.trim()) { setError(t('twofa.passwordRequired', lang)); return }
    if (!disableCode.trim()) { setError(t('twofa.codeRequired', lang)); return }
    setDisableLoading(true)
    try {
      await api2FADisable(disablePassword, disableCode.trim())
      setShowDisable(false)
      setDisablePassword('')
      setDisableCode('')
      setSuccess(t('twofa.disabled', lang))
      await loadStatus()
    } catch (err: any) {
      setError(err.message || t('twofa.disableFailed', lang))
    } finally {
      setDisableLoading(false)
    }
  }

  // Regenerate Backup Codes

  async function handleRegenerate(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!regenPassword.trim()) { setError('Password is required.'); return }
    if (!regenCode.trim() || regenCode.trim().length !== 6) { setError('A valid 6-digit TOTP code is required.'); return }
    setRegenLoading(true)
    try {
      const res = await api2FARegenerateBackupCodes(regenPassword, regenCode.trim())
      setBackupCodes(res.backupCodes)
      setBackupCodesConfirmed(false)
      setShowRegen(false)
      setRegenPassword('')
      setRegenCode('')
      setSuccess('New backup codes have been generated. Save them now!')
      await loadStatus()
    } catch (err: any) {
      setError(err.message || 'Failed to regenerate backup codes.')
    } finally {
      setRegenLoading(false)
    }
  }

  // Backup Code Helpers

  function handleCopyBackupCodes() {
    if (!backupCodes) return
    const text = `AEGIS 2FA Backup Codes\nGenerated: ${new Date().toISOString()}\n\n${backupCodes.map((c, i) => `${i + 1}. ${c}`).join('\n')}\n\nEach code can only be used once. Store these in a safe place.`
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  function handleDownloadBackupCodes() {
    if (!backupCodes) return
    const text = `AEGIS 2FA Backup Recovery Codes\nGenerated: ${new Date().toISOString()}\n${'='.repeat(40)}\n\n${backupCodes.map((c, i) => `${String(i + 1).padStart(2, ' ')}. ${c}`).join('\n')}\n\n${'='.repeat(40)}\nEach code can only be used once.\nStore these codes in a secure location.\nDo not share these codes with anyone.`
    const blob = new Blob([text], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `aegis-2fa-backup-codes-${new Date().toISOString().split('T')[0]}.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  function handleDismissBackupCodes() {
    setBackupCodes(null)
    setBackupCodesConfirmed(false)
  }

  // Render

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
          status?.enabled
            ? 'bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800'
            : 'bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700'
        }`}>
          {status?.enabled
            ? <ShieldCheck className="w-5 h-5 text-green-600 dark:text-green-400" />
            : <Shield className="w-5 h-5 text-gray-400" />}
        </div>
        <div>
          <h3 className="text-sm font-bold text-gray-900 dark:text-white">Two-Factor Authentication</h3>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {status?.enabled
              ? `Enabled since ${new Date(status.enabledAt!).toLocaleDateString()}`
              : 'Add an extra layer of security to your account'}
          </p>
        </div>
      </div>

      {/* Messages */}
      {error && (
        <div className="bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 px-3 py-2 rounded-xl text-xs flex items-center gap-2" role="alert">
          <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
          {error}
          <button onClick={() => setError('')} className="ml-auto text-red-400 hover:text-red-600">&times;</button>
        </div>
      )}
      {success && (
        <div className="bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800 text-green-700 dark:text-green-300 px-3 py-2 rounded-xl text-xs flex items-center gap-2">
          <CheckCircle className="w-3.5 h-3.5 flex-shrink-0" />
          {success}
          <button onClick={() => setSuccess('')} className="ml-auto text-green-400 hover:text-green-600">&times;</button>
        </div>
      )}

      {/* Backup Codes Display*/}
      {backupCodes && (
        <div className="bg-amber-50 dark:bg-amber-950/20 border-2 border-amber-300 dark:border-amber-700 rounded-xl p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Key className="w-4 h-4 text-amber-600 dark:text-amber-400" />
            <h4 className="text-sm font-bold text-amber-800 dark:text-amber-200">Backup Recovery Codes</h4>
          </div>
          <p className="text-xs text-amber-700 dark:text-amber-300">
            Save these codes in a secure location. Each code can only be used once.
            <strong> These will not be shown again.</strong>
          </p>
          <div className="grid grid-cols-2 gap-2">
            {backupCodes.map((code, i) => (
              <div key={i} className="bg-white dark:bg-gray-900 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-1.5 text-center font-mono text-sm text-gray-900 dark:text-white">
                {code}
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleCopyBackupCodes}
              className="flex-1 flex items-center justify-center gap-1.5 text-xs font-semibold py-2 rounded-lg bg-white dark:bg-gray-800 border border-amber-300 dark:border-amber-700 text-amber-800 dark:text-amber-200 hover:bg-amber-50 dark:hover:bg-amber-900/20 transition-colors"
            >
              <Copy className="w-3.5 h-3.5" />
              {copied ? 'Copied!' : 'Copy All'}
            </button>
            <button
              onClick={handleDownloadBackupCodes}
              className="flex-1 flex items-center justify-center gap-1.5 text-xs font-semibold py-2 rounded-lg bg-white dark:bg-gray-800 border border-amber-300 dark:border-amber-700 text-amber-800 dark:text-amber-200 hover:bg-amber-50 dark:hover:bg-amber-900/20 transition-colors"
            >
              <Download className="w-3.5 h-3.5" /> Download
            </button>
          </div>
          <label className="flex items-center gap-2 text-xs text-amber-700 dark:text-amber-300">
            <input
              type="checkbox"
              checked={backupCodesConfirmed}
              onChange={e => setBackupCodesConfirmed(e.target.checked)}
              className="rounded border-amber-400 text-aegis-600 focus:ring-aegis-500"
            />
            I have saved these backup codes in a secure location
          </label>
          <button
            onClick={handleDismissBackupCodes}
            disabled={!backupCodesConfirmed}
            className="w-full py-2 text-xs font-semibold rounded-lg bg-aegis-600 text-white hover:bg-aegis-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
          >
            Done — I&apos;ve Saved My Codes
          </button>
        </div>
      )}

      {/* Setup Flow*/}
      {!status?.enabled && !setupData && !backupCodes && (
        <button
          onClick={handleStartSetup}
          disabled={setupLoading}
          className="w-full flex items-center justify-center gap-2 py-2.5 text-sm font-semibold rounded-xl bg-aegis-600 text-white hover:bg-aegis-700 disabled:bg-gray-400 transition-colors shadow-lg shadow-aegis-600/20"
        >
          {setupLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <QrCode className="w-4 h-4" />}
          Enable Two-Factor Authentication
        </button>
      )}

      {setupData && (
        <div className="space-y-4 bg-gray-50 dark:bg-gray-800/50 rounded-xl p-4 border border-gray-200 dark:border-gray-700">
          <h4 className="text-sm font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <QrCode className="w-4 h-4 text-aegis-600" /> Scan QR Code
          </h4>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Scan this QR code with your authenticator app (Google Authenticator, Authy, 1Password, or Microsoft Authenticator).
          </p>
          {/* QR Code */}
          <div className="flex justify-center">
            <div className="bg-white p-3 rounded-xl shadow-inner">
              <img src={setupData.qrCodeDataUrl} alt="2FA QR Code" className="w-48 h-48" />
            </div>
          </div>
          {/* Manual key */}
          <div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Or enter this key manually:</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-xs font-mono bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-gray-900 dark:text-white break-all select-all">
                {setupData.manualKey}
              </code>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(setupData.manualKey)
                  setCopied(true)
                  setTimeout(() => setCopied(false), 2000)
                }}
                className="p-2 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-500 hover:text-aegis-600 hover:bg-aegis-50 dark:hover:bg-aegis-900/20 transition-colors"
                title="Copy key"
              >
                <Copy className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
          {/* Verify */}
          <form onSubmit={handleVerifySetup} className="space-y-3">
            <div>
              <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">
                Enter the 6-digit code from your app to verify:
              </label>
              <input
                ref={verifyInputRef}
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="000000"
                value={setupCode}
                onChange={e => setSetupCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                maxLength={6}
                className="w-full text-center text-xl font-mono tracking-[0.3em] py-2.5 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 focus:border-aegis-500 focus:ring-2 focus:ring-aegis-500/20 outline-none"
              />
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleCancelSetup}
                className="flex-1 py-2 text-xs font-semibold rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={setupLoading || setupCode.length !== 6}
                className="flex-1 py-2 text-xs font-semibold rounded-lg bg-aegis-600 text-white hover:bg-aegis-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-1.5"
              >
                {setupLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle className="w-3.5 h-3.5" />}
                Verify & Enable
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Enabled Actions*/}
      {status?.enabled && !backupCodes && !showDisable && !showRegen && (
        <div className="space-y-2">
          <button
            onClick={() => { setShowRegen(true); setShowDisable(false); setError(''); setSuccess('') }}
            className="w-full flex items-center gap-2 py-2 px-3 text-xs font-semibold rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Regenerate Backup Codes
          </button>
          <button
            onClick={() => { setShowDisable(true); setShowRegen(false); setError(''); setSuccess('') }}
            className="w-full flex items-center gap-2 py-2 px-3 text-xs font-semibold rounded-lg border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/20 transition-colors"
          >
            <ShieldOff className="w-3.5 h-3.5" /> Disable Two-Factor Authentication
          </button>
        </div>
      )}

      {/* Disable Form*/}
      {showDisable && (
        <form onSubmit={handleDisable} className="space-y-3 bg-red-50/50 dark:bg-red-950/10 rounded-xl p-4 border border-red-200 dark:border-red-800">
          <h4 className="text-sm font-bold text-red-700 dark:text-red-300 flex items-center gap-2">
            <ShieldOff className="w-4 h-4" /> Disable 2FA
          </h4>
          <p className="text-xs text-red-600 dark:text-red-400">
            This will remove two-factor authentication from your account. You must provide your password and a valid code.
          </p>
          <div className="relative">
            <Lock className="absolute left-3 top-2.5 w-3.5 h-3.5 text-gray-400" />
            <input
              type={showDisablePassword ? 'text' : 'password'}
              placeholder="Current password"
              value={disablePassword}
              onChange={e => setDisablePassword(e.target.value)}
              className="w-full pl-9 pr-9 py-2 text-sm bg-white dark:bg-gray-900 rounded-lg border border-red-200 dark:border-red-800 focus:border-red-500 outline-none"
            />
            <button type="button" onClick={() => setShowDisablePassword(!showDisablePassword)} className="absolute right-3 top-2.5 text-gray-400 hover:text-gray-600">
              {showDisablePassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            </button>
          </div>
          <input
            type="text"
            placeholder="6-digit TOTP code or backup code"
            value={disableCode}
            onChange={e => setDisableCode(e.target.value)}
            className="w-full px-3 py-2 text-sm bg-white dark:bg-gray-900 rounded-lg border border-red-200 dark:border-red-800 focus:border-red-500 outline-none text-center font-mono"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => { setShowDisable(false); setDisablePassword(''); setDisableCode(''); setError('') }}
              className="flex-1 py-2 text-xs font-semibold rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={disableLoading}
              className="flex-1 py-2 text-xs font-semibold rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-1.5"
            >
              {disableLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ShieldOff className="w-3.5 h-3.5" />}
              Confirm Disable
            </button>
          </div>
        </form>
      )}

      {/* Regenerate Backup Codes Form*/}
      {showRegen && (
        <form onSubmit={handleRegenerate} className="space-y-3 bg-gray-50 dark:bg-gray-800/50 rounded-xl p-4 border border-gray-200 dark:border-gray-700">
          <h4 className="text-sm font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <RefreshCw className="w-4 h-4 text-aegis-600" /> Regenerate Backup Codes
          </h4>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            This will invalidate all existing backup codes and generate 10 new ones.
          </p>
          <div className="relative">
            <Lock className="absolute left-3 top-2.5 w-3.5 h-3.5 text-gray-400" />
            <input
              type={showRegenPassword ? 'text' : 'password'}
              placeholder="Current password"
              value={regenPassword}
              onChange={e => setRegenPassword(e.target.value)}
              className="w-full pl-9 pr-9 py-2 text-sm bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 focus:border-aegis-500 outline-none"
            />
            <button type="button" onClick={() => setShowRegenPassword(!showRegenPassword)} className="absolute right-3 top-2.5 text-gray-400 hover:text-gray-600">
              {showRegenPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            </button>
          </div>
          <input
            type="text"
            inputMode="numeric"
            placeholder="6-digit TOTP code"
            value={regenCode}
            onChange={e => setRegenCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            maxLength={6}
            className="w-full px-3 py-2 text-sm bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 focus:border-aegis-500 outline-none text-center font-mono"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => { setShowRegen(false); setRegenPassword(''); setRegenCode(''); setError('') }}
              className="flex-1 py-2 text-xs font-semibold rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={regenLoading || regenCode.length !== 6}
              className="flex-1 py-2 text-xs font-semibold rounded-lg bg-aegis-600 text-white hover:bg-aegis-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-1.5"
            >
              {regenLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
              Generate New Codes
            </button>
          </div>
        </form>
      )}

      {/* Status details */}
      {status?.enabled && status.lastVerifiedAt && !showDisable && !showRegen && !backupCodes && (
        <div className="text-[10px] text-gray-400 dark:text-gray-400 space-y-0.5 pt-2 border-t border-gray-100 dark:border-gray-800">
          <p>Last verified: {new Date(status.lastVerifiedAt).toLocaleString()}</p>
          {status.recoveryCodesGeneratedAt && (
            <p>Recovery codes generated: {new Date(status.recoveryCodesGeneratedAt).toLocaleString()}</p>
          )}
        </div>
      )}
    </div>
  )
}

