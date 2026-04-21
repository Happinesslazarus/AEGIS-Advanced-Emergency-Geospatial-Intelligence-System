import React from 'react'
import { BookOpen, BookMarked, Play, ExternalLink, Droplets } from 'lucide-react'
import { t } from '../../utils/i18n'

export default function PreparednessTab({ lang, onOpenGuide }: { lang: string; onOpenGuide: () => void }) {
  return (
    <div className="max-w-4xl mx-auto space-y-5 animate-fade-in">
      {/* Header */}
      <div>
        <h2 className="text-xl font-extrabold text-gray-900 dark:text-white flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center shadow-md">
            <BookOpen className="w-4 h-4 text-white" />
          </div>
          {'Emergency Preparedness'}
        </h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 ml-[42px]">{'Learn how to prepare for, survive, and recover from natural disasters. Verified resources from national agencies.'}</p>
      </div>

      {/* Open Guide CTA */}
      <button onClick={onOpenGuide} className="w-full bg-gradient-to-r from-aegis-600 to-aegis-700 hover:from-aegis-700 hover:to-aegis-800 text-white rounded-2xl p-5 text-sm font-bold flex items-center justify-center gap-2.5 transition-all shadow-lg shadow-aegis-600/20 hover:shadow-aegis-600/30 hover:scale-[1.01] active:scale-[0.99]">
        <BookMarked className="w-5 h-5" /> {'Preparedness Guide'}
      </button>

      {/* Resources Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {[
          { title: 'SEPA Flood Warnings', source: 'SEPA', url: 'https://www.sepa.org.uk/environment/water/flooding/', type: 'article' },
          { title: 'Weather Warnings and Advice', source: 'Met Office', url: 'https://www.metoffice.gov.uk/weather/warnings-and-advice', type: 'article' },
          { title: 'Flood Preparation Guide', source: 'Scottish Government', url: 'https://www.floodscotland.org.uk/prepare-yourself/', type: 'article' },
          { title: 'Before the Flood Strikes', source: 'UK Environment Agency', url: 'https://www.youtube.com/watch?v=43M5mZuzHF8', type: 'video' },
          { title: 'Making an Emergency Kit', source: 'British Red Cross', url: 'https://www.youtube.com/watch?v=pFh-eEVadJU', type: 'video' },
          { title: 'Scottish Flood Resources', source: 'Scottish Flood Forum', url: 'https://scottishfloodforum.org/', type: 'article' },
        ].map((r, i) => (
          <a key={i} href={r.url} target="_blank" rel="noopener noreferrer" className="glass-card rounded-2xl p-4 hover-lift transition-all flex items-start gap-3.5 group">
            <div className={`w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 ${r.type === 'video' ? 'bg-gradient-to-br from-red-500 to-rose-600' : 'bg-gradient-to-br from-blue-500 to-indigo-600'} shadow-md`}>
              {r.type === 'video' ? <Play className="w-5 h-5 text-white" /> : <Droplets className="w-5 h-5 text-white" />}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-gray-900 dark:text-white group-hover:text-aegis-600 dark:group-hover:text-aegis-400 transition-colors flex items-center gap-1.5">{r.title}<ExternalLink className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" /></p>
              <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5">{r.source} - <span className={`font-semibold ${r.type === 'video' ? 'text-red-500' : 'text-blue-500'}`}>{r.type === 'video' ? 'Video' : 'Article'}</span></p>
            </div>
          </a>
        ))}
      </div>
    </div>
  )
}
