/*
 * CommunityGuidelines.tsx — Guidelines Modal
 * 
 * Displays community guidelines to users to prevent harmful content
 * and enforce respectful behavior in the community feed
 */

import React, { useState } from 'react'
import { AlertCircle, CheckCircle, X, Eye, EyeOff } from 'lucide-react'

interface GuidelinesModalProps {
  isOpen: boolean
  onClose: () => void
}

export function CommunityGuidelines({ isOpen, onClose }: GuidelinesModalProps) {
  const [understood, setUnderstood] = useState(false)

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-900 rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-2xl">
        {/* Header */}
        <div className="sticky top-0 bg-gradient-to-r from-aegis-600 to-aegis-700 text-white p-6 flex items-start justify-between">
          <div className="flex items-center gap-3">
            <AlertCircle className="w-6 h-6 flex-shrink-0" />
            <div>
              <h2 className="text-xl font-bold">Community Guidelines</h2>
              <p className="text-sm text-white/80">Please review our guidelines before posting</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-white/20 rounded-lg transition">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {/* Section 1: Respectful Communication */}
          <section className="space-y-3">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center flex-shrink-0 mt-0.5">
                <CheckCircle className="w-5 h-5 text-green-600 dark:text-green-400" />
              </div>
              <div>
                <h3 className="font-bold text-gray-900 dark:text-white mb-1">Be Respectful & Kind</h3>
                <ul className="text-sm text-gray-600 dark:text-gray-400 space-y-1">
                  <li>• Treat all community members with dignity and respect</li>
                  <li>• Listen to different viewpoints without judgment</li>
                  <li>• Disagree respectfully without personal attacks</li>
                  <li>• Don't use hurtful, offensive, or discriminatory language</li>
                </ul>
              </div>
            </div>
          </section>

          {/* Section 2: No Harmful Content */}
          <section className="space-y-3 border-l-4 border-red-500 pl-4">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center flex-shrink-0 mt-0.5">
                <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400" />
              </div>
              <div>
                <h3 className="font-bold text-gray-900 dark:text-white mb-1">Prohibited Content</h3>
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">Do NOT post:</p>
                <ul className="text-sm text-gray-600 dark:text-gray-400 space-y-1">
                  <li>• Hate speech, harassment, bullying, or threats</li>
                  <li>• Violence, gore, or self-harm content</li>
                  <li>• Sexual, adult, or explicit material</li>
                  <li>• Spam, scams, or misleading information</li>
                  <li>• Personal information (doxxing) of others</li>
                  <li>• Misinformation about emergencies or health</li>
                  <li>• Illegal content or activities</li>
                </ul>
              </div>
            </div>
          </section>

          {/* Section 3: Accurate Information */}
          <section className="space-y-3">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center flex-shrink-0 mt-0.5">
                <Eye className="w-5 h-5 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <h3 className="font-bold text-gray-900 dark:text-white mb-1">Post Accurate Information</h3>
                <ul className="text-sm text-gray-600 dark:text-gray-400 space-y-1">
                  <li>• Verify facts before sharing about emergencies or hazards</li>
                  <li>• For hazard updates, include specific location details</li>
                  <li>• Cite credible sources when possible</li>
                  <li>• Distinguish between confirmed facts and opinions</li>
                  <li>• Report verified issues to authorities when needed</li>
                </ul>
              </div>
            </div>
          </section>

          {/* Section 4: Privacy & Security */}
          <section className="space-y-3">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-full bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center flex-shrink-0 mt-0.5">
                <EyeOff className="w-5 h-5 text-purple-600 dark:text-purple-400" />
              </div>
              <div>
                <h3 className="font-bold text-gray-900 dark:text-white mb-1">Protect Privacy & Security</h3>
                <ul className="text-sm text-gray-600 dark:text-gray-400 space-y-1">
                  <li>• Don't share passwords, personal IDs, or financial info</li>
                  <li>• Don't share others' private information without consent</li>
                  <li>• Be cautious with location data in emergency situations</li>
                  <li>• Don't impersonate others or create fake accounts</li>
                </ul>
              </div>
            </div>
          </section>

          {/* Section 5: Community Values */}
          <section className="space-y-3 bg-aegis-50 dark:bg-aegis-900/20 rounded-lg p-4 border border-aegis-200 dark:border-aegis-800">
            <h3 className="font-bold text-gray-900 dark:text-white">Our Community Values</h3>
            <ul className="text-sm text-gray-600 dark:text-gray-400 space-y-1">
              <li>✓ <strong>Safety First:</strong> Prioritize everyone's wellbeing</li>
              <li>✓ <strong>Transparency:</strong> Be honest and clear in communications</li>
              <li>✓ <strong>Inclusivity:</strong> Welcome diverse perspectives and backgrounds</li>
              <li>✓ <strong>Responsibility:</strong> Think about the impact of your posts</li>
              <li>✓ <strong>Support:</strong> Help others during emergencies and difficulties</li>
            </ul>
          </section>

          {/* Consequences */}
          <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4">
            <p className="text-sm text-yellow-900 dark:text-yellow-100">
              <strong>⚠️ Important:</strong> Violations of these guidelines may result in content removal, account restrictions, or permanent ban. Serious violations may be reported to authorities.
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 bg-gray-50 dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 p-4 flex items-center justify-between">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={understood}
              onChange={e => setUnderstood(e.target.checked)}
              className="w-4 h-4 rounded accent-aegis-600"
            />
            <span className="text-sm text-gray-600 dark:text-gray-400">
              I understand and agree to follow these guidelines
            </span>
          </label>
          <button
            onClick={onClose}
            disabled={!understood}
            className="bg-aegis-600 hover:bg-aegis-700 disabled:bg-gray-300 dark:disabled:bg-gray-700 text-white px-6 py-2 rounded-lg font-semibold text-sm transition"
          >
            Got It
          </button>
        </div>
      </div>
    </div>
  )
}

export default CommunityGuidelines
