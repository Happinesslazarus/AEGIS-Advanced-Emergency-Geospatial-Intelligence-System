import { MapPin, Clock, CheckCircle, AlertTriangle, Camera, Bot } from 'lucide-react'
import { getSeverityClass, getStatusClass, truncate } from '../../utils/helpers'
import type { Report } from '../../types'
import { t } from '../../utils/i18n'
import { useLanguage } from '../../hooks/useLanguage'

interface Props {
  report: Report; onClick?: (r: Report) => void; showActions?: boolean
  onVerify?: (id: string) => void; onFlag?: (id: string) => void
}

export default function ReportCard({ report, onClick, showActions = false, onVerify, onFlag }: Props): JSX.Element {
  const lang = useLanguage()
  return (
    <div className="card-hover p-4 cursor-pointer" onClick={() => onClick?.(report)} role="button" tabIndex={0}
      aria-label={`Report ${report.id}: ${report.type}, ${report.severity} severity`}
      onKeyDown={(e) => e.key === 'Enter' && onClick?.(report)}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <span className={`badge ${getSeverityClass(report.severity)}`}>{report.severity}</span>
            <span className={`badge ${getStatusClass(report.status)}`}>{report.status}</span>
            {report.confidence != null && <span className="badge badge-info"><Bot className="w-3 h-3 mr-1" />{report.confidence}%</span>}
            {report.hasMedia && <Camera className="w-3.5 h-3.5 text-gray-400 dark:text-gray-300" aria-label="Has media" />}
            {report.aiAnalysis && report.aiAnalysis.fakeProbability > 0.6 && <span className="badge bg-orange-600 text-white">{t('report.possibleFake', lang)}</span>}
            {report.aiAnalysis?.vulnerablePersonAlert && <span className="badge bg-purple-600 text-white">{t('report.vulnerablePerson', lang)}</span>}
          </div>
          <p className="font-semibold text-gray-900 dark:text-gray-100 text-sm">{report.type}</p>
          <p className="text-sm text-gray-600 dark:text-gray-300 mt-1">{truncate(report.description, 120)}</p>
          <div className="flex items-center gap-4 mt-2 text-xs text-gray-500 dark:text-gray-300">
            <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{truncate(report.location, 40)}</span>
            <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{report.displayTime}</span>
            <span className="font-mono">{report.id}</span>
          </div>
        </div>
        {showActions && (
          <div className="flex flex-col gap-1.5 flex-shrink-0">
            <button onClick={e => { e.stopPropagation(); onVerify?.(report.id) }} className="btn-success text-xs px-2.5 py-1.5"><CheckCircle className="w-3.5 h-3.5" /> {t('report.verify', lang)}</button>
            <button onClick={e => { e.stopPropagation(); onFlag?.(report.id) }} className="btn-warning text-xs px-2.5 py-1.5"><AlertTriangle className="w-3.5 h-3.5" /> {t('report.flag', lang)}</button>
          </div>
        )}
      </div>
    </div>
  )
}
