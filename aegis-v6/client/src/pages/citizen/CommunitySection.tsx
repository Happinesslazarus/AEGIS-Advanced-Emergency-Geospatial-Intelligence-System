import React, { useState } from 'react'
import { Users, MessageSquare, FileText } from 'lucide-react'
import type { Socket } from 'socket.io-client'
import { t } from '../../utils/i18n'
import { useLanguage } from '../../hooks/useLanguage'
import CommunityChatRoom from '../../components/citizen/CommunityChatRoom'
import CommunityChat from '../../components/citizen/CommunityChat'

export default function CommunitySection({ parentSocket }: { parentSocket?: Socket | null }) {
  const lang = useLanguage()
  const [subTab, setSubTab] = useState<'chat' | 'posts'>('chat')
  return (
    <div className="max-w-5xl mx-auto space-y-4">
      {/* Premium Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-aegis-500 via-indigo-600 to-violet-600 flex items-center justify-center shadow-lg shadow-aegis-500/20">
            <Users className="w-5 h-5 text-white" />
          </div>
          <div>
            <h2 className="font-bold text-lg text-gray-900 dark:text-white">{t('citizen.tab.community', lang)}</h2>
            <p className="text-xs text-gray-500 dark:text-gray-400">{ t('cdash.community.subtitle', lang)}</p>
          </div>
        </div>
      </div>

      {/* Sub-tab bar */}
      <div className="flex gap-1 bg-gray-100/80 dark:bg-gray-800/60 p-1 rounded-xl w-fit backdrop-blur-sm shadow-inner">
        <button
          onClick={() => setSubTab('chat')}
          className={`px-5 py-2.5 rounded-lg text-xs font-bold transition-all duration-200 ${
            subTab === 'chat'
              ? 'bg-white dark:bg-gray-700 text-aegis-700 dark:text-white shadow-md'
              : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 dark:text-gray-400'
          }`}
        >
          <span className="flex items-center gap-1.5">
            <MessageSquare className="w-3.5 h-3.5" />
            {t('citizen.community.liveChat', lang)}
          </span>
        </button>
        <button
          onClick={() => setSubTab('posts')}
          className={`px-5 py-2.5 rounded-lg text-xs font-bold transition-all duration-200 ${
            subTab === 'posts'
              ? 'bg-white dark:bg-gray-700 text-aegis-700 dark:text-white shadow-md'
              : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 dark:text-gray-400'
          }`}
        >
          <span className="flex items-center gap-1.5">
            <FileText className="w-3.5 h-3.5" />
            {t('citizen.community.postsFeed', lang)}
          </span>
        </button>
      </div>

      {subTab === 'chat' && <CommunityChatRoom parentSocket={parentSocket} />}
      {subTab === 'posts' && <CommunityChat parentSocket={parentSocket} />}
    </div>
  )
}
