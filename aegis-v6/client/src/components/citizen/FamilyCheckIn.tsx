/**
 * FamilyCheckIn -- Family/trusted contact safety check-in component.
 * Allows citizens to share their safety status with pre-configured contacts
 * via SMS, WhatsApp, or in-app messaging.
 */

import { useState, useCallback } from 'react'
import { X, Heart, Send, UserPlus, Phone, MessageCircle, Check, Shield, AlertTriangle, Clock, Trash2, Users } from 'lucide-react'
import { t } from '../../utils/i18n'
import { useLanguage } from '../../hooks/useLanguage'
import { useAlerts } from '../../contexts/AlertsContext'

type SafetyStatus = 'safe' | 'need_help' | 'evacuating' | 'sheltering'

interface TrustedContact {
  id: string
  name: string
  phone: string
  relationship: string
  lastNotified?: string
}

interface Props {
  onClose: () => void
  userName?: string
}

const STATUS_OPTIONS: { key: SafetyStatus; label: string; icon: typeof Shield; color: string; bg: string }[] = [
  { key: 'safe', label: "I'm Safe", icon: Shield, color: 'text-green-700 dark:text-green-300', bg: 'bg-green-50 dark:bg-green-900/30 border-green-200 dark:border-green-800' },
  { key: 'need_help', label: 'I Need Help', icon: AlertTriangle, color: 'text-red-700 dark:text-red-300', bg: 'bg-red-50 dark:bg-red-900/30 border-red-200 dark:border-red-800' },
  { key: 'evacuating', label: 'Evacuating', icon: Clock, color: 'text-amber-700 dark:text-amber-300', bg: 'bg-amber-50 dark:bg-amber-900/30 border-amber-200 dark:border-amber-800' },
  { key: 'sheltering', label: 'At Shelter', icon: Heart, color: 'text-blue-700 dark:text-blue-300', bg: 'bg-blue-50 dark:bg-blue-900/30 border-blue-200 dark:border-blue-800' },
]

const STORAGE_KEY = 'aegis_trusted_contacts'

function loadContacts(): TrustedContact[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
  } catch { return [] }
}

function saveContacts(contacts: TrustedContact[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(contacts))
}

export default function FamilyCheckIn({ onClose, userName = 'Citizen' }: Props): JSX.Element {
  const lang = useLanguage()
  const { pushNotification } = useAlerts()
  const [contacts, setContacts] = useState<TrustedContact[]>(loadContacts)
  const [selectedStatus, setSelectedStatus] = useState<SafetyStatus | null>(null)
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [showAddContact, setShowAddContact] = useState(false)
  const [newContact, setNewContact] = useState({ name: '', phone: '', relationship: '' })

  const addContact = useCallback(() => {
    if (!newContact.name.trim() || !newContact.phone.trim()) return
    const contact: TrustedContact = {
      id: `tc-${Date.now()}`,
      name: newContact.name.trim(),
      phone: newContact.phone.trim(),
      relationship: newContact.relationship.trim() || 'Other',
    }
    const updated = [...contacts, contact]
    setContacts(updated)
    saveContacts(updated)
    setNewContact({ name: '', phone: '', relationship: '' })
    setShowAddContact(false)
  }, [contacts, newContact])

  const removeContact = useCallback((id: string) => {
    const updated = contacts.filter(c => c.id !== id)
    setContacts(updated)
    saveContacts(updated)
  }, [contacts])

  const sendCheckIn = useCallback(async () => {
    if (!selectedStatus || contacts.length === 0) return
    setSending(true)

    const statusLabel = STATUS_OPTIONS.find(s => s.key === selectedStatus)?.label || selectedStatus
    const fullMessage = `[AEGIS Safety Check-In] ${userName}: ${statusLabel}${message ? ` -- ${message}` : ''}`

    //For each contact, attempt to share via Web Share API or SMS fallback
    for (const contact of contacts) {
      try {
        if (navigator.share) {
          await navigator.share({
            title: 'AEGIS Safety Check-In',
            text: fullMessage,
          })
        } else {
          //SMS fallback
          const smsBody = encodeURIComponent(fullMessage)
          window.open(`sms:${contact.phone}?body=${smsBody}`, '_blank')
        }

        //Update last notified
        contact.lastNotified = new Date().toISOString()
      } catch {
        //User cancelled share or error -- continue to next contact
      }
    }

    saveContacts(contacts)
    setContacts([...contacts])
    setSending(false)
    pushNotification?.(`Safety status shared with ${contacts.length} contact(s)`, 'success')
  }, [selectedStatus, contacts, message, userName, pushNotification])

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 z-50" role="dialog" aria-modal="true">
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto animate-fade-in">
        {/* Header */}
        <div className="bg-gradient-to-r from-pink-600 to-rose-500 text-white p-5 rounded-t-2xl flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center">
              <Users className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold">Family Check-In</h2>
              <p className="text-xs text-pink-100">Share your safety status</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-lg transition-colors" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-5">
          {/* Safety Status Selection */}
          <div>
            <h3 className="text-sm font-bold text-gray-700 dark:text-gray-300 mb-3">Your Current Status</h3>
            <div className="grid grid-cols-2 gap-2">
              {STATUS_OPTIONS.map(opt => {
                const Icon = opt.icon
                const isActive = selectedStatus === opt.key
                return (
                  <button
                    key={opt.key}
                    onClick={() => setSelectedStatus(opt.key)}
                    className={`p-3 rounded-xl border-2 transition-all text-left ${
                      isActive
                        ? `${opt.bg} ring-2 ring-offset-1 ring-current scale-[1.02]`
                        : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                    }`}
                  >
                    <Icon className={`w-5 h-5 mb-1 ${isActive ? opt.color : 'text-gray-400 dark:text-gray-500'}`} />
                    <span className={`text-xs font-bold ${isActive ? opt.color : 'text-gray-600 dark:text-gray-400'}`}>
                      {opt.label}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Optional message */}
          <div>
            <label className="text-sm font-bold text-gray-700 dark:text-gray-300 mb-1 block">
              Additional Message <span className="font-normal text-gray-400">(optional)</span>
            </label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="E.g., I'm at the community center on Main St..."
              className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-sm resize-none focus:ring-2 focus:ring-pink-500/30 focus:border-pink-500 outline-none"
              rows={2}
              maxLength={200}
            />
          </div>

          {/* Trusted Contacts */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-gray-700 dark:text-gray-300">Trusted Contacts</h3>
              <button
                onClick={() => setShowAddContact(!showAddContact)}
                className="text-xs font-bold text-pink-600 dark:text-pink-400 flex items-center gap-1 hover:underline"
              >
                <UserPlus className="w-3.5 h-3.5" /> Add
              </button>
            </div>

            {/* Add contact form */}
            {showAddContact && (
              <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-xl mb-3 space-y-2 border border-gray-200 dark:border-gray-700">
                <input
                  type="text"
                  value={newContact.name}
                  onChange={(e) => setNewContact(p => ({ ...p, name: e.target.value }))}
                  placeholder="Name"
                  className="w-full px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-900 text-sm focus:outline-none focus:ring-1 focus:ring-pink-500"
                />
                <input
                  type="tel"
                  value={newContact.phone}
                  onChange={(e) => setNewContact(p => ({ ...p, phone: e.target.value }))}
                  placeholder="Phone number"
                  className="w-full px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-900 text-sm focus:outline-none focus:ring-1 focus:ring-pink-500"
                />
                <select
                  value={newContact.relationship}
                  onChange={(e) => setNewContact(p => ({ ...p, relationship: e.target.value }))}
                  className="w-full px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-900 text-sm focus:outline-none focus:ring-1 focus:ring-pink-500"
                >
                  <option value="">Relationship</option>
                  <option value="Spouse">Spouse / Partner</option>
                  <option value="Parent">Parent</option>
                  <option value="Child">Child</option>
                  <option value="Sibling">Sibling</option>
                  <option value="Friend">Friend</option>
                  <option value="Neighbor">Neighbor</option>
                  <option value="Other">Other</option>
                </select>
                <div className="flex gap-2">
                  <button onClick={() => setShowAddContact(false)} className="flex-1 text-xs py-1.5 rounded-lg bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300 font-bold">Cancel</button>
                  <button onClick={addContact} disabled={!newContact.name || !newContact.phone} className="flex-1 text-xs py-1.5 rounded-lg bg-pink-600 text-white font-bold disabled:opacity-40">Save</button>
                </div>
              </div>
            )}

            {/* Contact list */}
            {contacts.length === 0 ? (
              <div className="py-8 text-center animate-enter">
                <div className="w-14 h-14 rounded-full bg-pink-50 dark:bg-pink-950/20 flex items-center justify-center mx-auto mb-3">
                  <Users className="w-7 h-7 text-pink-300 dark:text-pink-700" />
                </div>
                <p className="text-sm font-medium text-gray-600 dark:text-gray-300 mb-1">No trusted contacts yet</p>
                <p className="text-xs text-gray-400 dark:text-gray-500 max-w-xs mx-auto">Add family or friends above so you can quickly notify them of your safety status during an emergency.</p>
                <button
                  onClick={() => setShowAddContact(true)}
                  className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-pink-50 dark:bg-pink-950/20 text-pink-600 dark:text-pink-400 border border-pink-200 dark:border-pink-800 hover:bg-pink-100 dark:hover:bg-pink-950/40 transition-colors"
                >
                  <UserPlus className="w-3.5 h-3.5" /> Add your first contact
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                {contacts.map(c => (
                  <div key={c.id} className="flex items-center gap-3 p-2.5 bg-gray-50 dark:bg-gray-800 rounded-xl">
                    <div className="w-8 h-8 rounded-full bg-pink-100 dark:bg-pink-900/30 flex items-center justify-center flex-shrink-0">
                      <span className="text-sm font-bold text-pink-600 dark:text-pink-400">{c.name[0]}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-gray-800 dark:text-gray-200 truncate">{c.name}</p>
                      <p className="text-[10px] text-gray-400 dark:text-gray-500">{c.relationship} - {c.phone}</p>
                      {c.lastNotified && (
                        <p className="text-[9px] text-green-600 dark:text-green-400 flex items-center gap-0.5 mt-0.5">
                          <Check className="w-2.5 h-2.5" /> Last notified {new Date(c.lastNotified).toLocaleString()}
                        </p>
                      )}
                    </div>
                    <button onClick={() => removeContact(c.id)} className="p-1 hover:bg-red-50 dark:hover:bg-red-900/20 rounded text-gray-400 hover:text-red-500 transition-colors">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Send button */}
          <button
            onClick={sendCheckIn}
            disabled={!selectedStatus || contacts.length === 0 || sending}
            className="w-full bg-gradient-to-r from-pink-600 to-rose-500 hover:from-pink-500 hover:to-rose-400 text-white font-bold py-3 rounded-xl flex items-center justify-center gap-2 transition-all disabled:opacity-40 disabled:cursor-not-allowed shadow-lg shadow-pink-600/20"
          >
            {sending ? (
              <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              <>
                <Send className="w-4 h-4" />
                Share Safety Status
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
