import React, { useState } from 'react'
import { Lock, Eye, EyeOff, CheckCircle, AlertTriangle, Loader2 } from 'lucide-react'
import { t } from '../../utils/i18n'
import { useLanguage } from '../../hooks/useLanguage'
import { getPasswordStrength } from '../../utils/helpers'
import CitizenTwoFactorSettings from '../../components/citizen/CitizenTwoFactorSettings'

export default function SecurityTab({ changePassword }: any) {
  const lang = useLanguage()
  const [currentPw, setCurrentPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [msg, setMsg] = useState('')
  const [msgType, setMsgType] = useState<'success' | 'error'>('success')

  const strength = getPasswordStrength(newPw, lang)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setMsg('')
    if (newPw !== confirmPw) { setMsg('Passwords do not match'); setMsgType('error'); return }
    if (newPw.length < 8) { setMsg('Password must be at least 8 characters'); setMsgType('error'); return }

    setSubmitting(true)
    const result = await changePassword(currentPw, newPw)
    setSubmitting(false)

    if (result.success) {
      setMsg('Password changed successfully')
      setMsgType('success')
      setCurrentPw(''); setNewPw(''); setConfirmPw('')
    } else {
      setMsg(result.error || 'Failed to change password')
      setMsgType('error')
    }
  }

  return (
    <div className="max-w-lg mx-auto space-y-6 animate-fade-in">
      {/* Header */}
      <div>
        <h2 className="text-xl font-extrabold text-gray-900 dark:text-white flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center shadow-md">
            <Lock className="w-4 h-4 text-white" />
          </div>
          {'Change Password'}
        </h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 ml-[42px]">{'Change your account password'}</p>
      </div>

      {msg && (
        <div className={`p-3.5 rounded-xl text-sm flex items-center gap-2 animate-scale-in ${
          msgType === 'success'
            ? 'bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 text-emerald-700'
            : 'bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 text-red-700'
        }`}>
          {msgType === 'success' ? <CheckCircle className="w-4 h-4 flex-shrink-0" /> : <AlertTriangle className="w-4 h-4 flex-shrink-0" />}
          {msg}
        </div>
      )}

      <form onSubmit={handleSubmit} className="glass-card rounded-2xl p-6 space-y-5">
        <div>
          <label className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 dark:text-gray-400 mb-2">
            <Lock className="w-3 h-3" /> {'Current Password'}
          </label>
          <div className="relative">
            <div className="absolute left-3.5 top-1/2 -translate-y-1/2 w-8 h-8 rounded-lg bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
              <Lock className="w-3.5 h-3.5 text-gray-400 dark:text-gray-400" />
            </div>
            <input
              type={showPw ? 'text' : 'password'}
              value={currentPw}
              onChange={e => setCurrentPw(e.target.value)}
              className="w-full pl-14 pr-12 py-3 text-sm bg-gray-50 dark:bg-gray-800/60 rounded-xl border border-gray-200 dark:border-gray-700 focus:ring-2 focus:ring-aegis-500 focus:border-transparent transition"
              required
            />
            <button type="button" onClick={() => setShowPw(!showPw)} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-400 hover:text-gray-600 transition-colors p-1">
              {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>

        <div>
          <label className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 dark:text-gray-400 mb-2">
            <Lock className="w-3 h-3" /> {'New Password'}
          </label>
          <div className="relative">
            <div className="absolute left-3.5 top-1/2 -translate-y-1/2 w-8 h-8 rounded-lg bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
              <Lock className="w-3.5 h-3.5 text-gray-400 dark:text-gray-400" />
            </div>
            <input
              type={showPw ? 'text' : 'password'}
              value={newPw}
              onChange={e => setNewPw(e.target.value)}
              className="w-full pl-14 pr-4 py-3 text-sm bg-gray-50 dark:bg-gray-800/60 rounded-xl border border-gray-200 dark:border-gray-700 focus:ring-2 focus:ring-aegis-500 focus:border-transparent transition"
              placeholder={'Minimum 8 characters'}
              required
            />
          </div>
          {newPw.length > 0 && (
            <div className="mt-2.5">
              <div className="flex gap-1">
                {[1, 2, 3, 4, 5].map(i => (
                  <div key={i} className={`h-1.5 flex-1 rounded-full transition-all duration-300 ${i <= strength.score ? strength.color : 'bg-gray-200 dark:bg-gray-700'}`} />
                ))}
              </div>
              <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-1 font-medium">{strength.label}</p>
            </div>
          )}
        </div>

        <div>
          <label className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 dark:text-gray-400 mb-2">
            <Lock className="w-3 h-3" /> {'Confirm New Password'}
          </label>
          <div className="relative">
            <div className="absolute left-3.5 top-1/2 -translate-y-1/2 w-8 h-8 rounded-lg bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
              <Lock className="w-3.5 h-3.5 text-gray-400 dark:text-gray-400" />
            </div>
            <input
              type={showPw ? 'text' : 'password'}
              value={confirmPw}
              onChange={e => setConfirmPw(e.target.value)}
              className={`w-full pl-14 pr-12 py-3 text-sm bg-gray-50 dark:bg-gray-800/60 rounded-xl border focus:ring-2 focus:ring-aegis-500 focus:border-transparent transition ${
                confirmPw && confirmPw !== newPw ? 'border-red-300 dark:border-red-700' : confirmPw && confirmPw === newPw ? 'border-emerald-300 dark:border-emerald-700' : 'border-gray-200 dark:border-gray-700'
              }`}
              required
            />
            {confirmPw && confirmPw === newPw && <CheckCircle className="absolute right-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-emerald-500" />}
          </div>
        </div>

        <button type="submit" disabled={submitting || !currentPw || !newPw || !confirmPw}
          className="w-full bg-gradient-to-r from-aegis-600 to-aegis-700 hover:from-aegis-700 hover:to-aegis-800 disabled:from-gray-300 disabled:to-gray-400 disabled:cursor-not-allowed text-white py-3.5 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all duration-200 shadow-lg shadow-aegis-600/20 hover:shadow-aegis-600/30 hover:scale-[1.01] active:scale-[0.99]">
          {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />}
          {'Change Password'}
        </button>
      </form>

      {/* Two-Factor Authentication */}
      <div className="glass-card rounded-2xl p-6">
        <CitizenTwoFactorSettings />
      </div>
    </div>
  )
}
