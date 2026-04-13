import { FileText, MapPin, Clock, AlertTriangle } from 'lucide-react'

const SEV_COLORS: Record<string, string> = {
  High: 'bg-red-500', Medium: 'bg-amber-500', Low: 'bg-blue-500',
}
const STATUS_COLORS: Record<string, string> = {
  Urgent: 'bg-red-600 text-white', Unverified: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  Verified: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  Flagged: 'bg-orange-600 text-white', Resolved: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300',
}

interface Report {
  id: string; type: string; location: string; severity: string; status: string
  time: string; description: string; confidence?: number
}

export default function ReportCard({ report, onClick }: { report: Report; onClick?: () => void }) {
  return (
    <button onClick={onClick} className="w-full text-left card-hover p-4 animate-fade-up">
      <div className="flex items-start gap-3">
        <div className={`w-9 h-9 rounded-xl ${SEV_COLORS[report.severity] || 'bg-gray-500'} flex items-center justify-center flex-shrink-0`}>
          <AlertTriangle className="w-4 h-4 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className={`badge text-[10px] ${STATUS_COLORS[report.status] || 'bg-gray-100 text-gray-600'}`}>{report.status}</span>
            <span className="badge bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 text-[10px]">{report.severity}</span>
          </div>
          <h3 className="font-bold text-sm text-gray-900 dark:text-white truncate">{report.type}</h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 line-clamp-2 mt-0.5">{report.description}</p>
          <div className="flex items-center gap-3 mt-2 text-[10px] text-gray-400">
            <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{report.location}</span>
            <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{report.time}</span>
            {report.confidence != null && <span>AI: {report.confidence}%</span>}
          </div>
        </div>
      </div>
    </button>
  )
}
