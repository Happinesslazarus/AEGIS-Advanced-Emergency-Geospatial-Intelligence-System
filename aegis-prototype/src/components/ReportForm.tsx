import { useState } from 'react'
import { X, MapPin, Camera, ChevronRight, ChevronLeft, AlertTriangle, CheckCircle, Upload, Loader } from 'lucide-react'

const TYPES = ['Flood', 'Fire', 'Storm', 'Earthquake', 'Structural Damage', 'Power Outage', 'Road Blockage', 'Landslide', 'Hazardous Material', 'Other']
const SEVERITIES = [
  { level: 'Low', color: 'bg-blue-500', desc: 'Minor inconvenience, no immediate danger' },
  { level: 'Medium', color: 'bg-amber-500', desc: 'Some risk, attention needed' },
  { level: 'High', color: 'bg-orange-500', desc: 'Significant danger, urgent attention' },
  { level: 'Critical', color: 'bg-red-500', desc: 'Life-threatening, immediate response needed' },
]

interface Props { onClose: () => void; onSubmit?: (data: any) => void }

export default function ReportForm({ onClose, onSubmit }: Props) {
  const [step, setStep] = useState(0)
  const [type, setType] = useState('')
  const [severity, setSeverity] = useState('')
  const [description, setDescription] = useState('')
  const [location, setLocation] = useState('')
  const [useGPS, setUseGPS] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  const steps = ['Type', 'Details', 'Location', 'Review']

  const canNext = step === 0 ? !!type : step === 1 ? !!severity && description.length >= 10 : step === 2 ? !!location || useGPS : true

  const handleSubmit = () => {
    setSubmitting(true)
    setTimeout(() => {
      setSubmitting(false)
      setSubmitted(true)
      onSubmit?.({ type, severity, description, location: useGPS ? 'GPS: 57.1497° N, 2.0943° W' : location })
    }, 1500)
  }

  if (submitted) {
    return (
      <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
        <div className="bg-white dark:bg-gray-900 rounded-2xl p-8 max-w-md w-full text-center animate-scale-in border border-gray-200 dark:border-gray-700">
          <div className="w-16 h-16 rounded-2xl bg-green-500/10 flex items-center justify-center mx-auto mb-4">
            <CheckCircle className="w-8 h-8 text-green-500" />
          </div>
          <h2 className="text-xl font-bold mb-2">Report Submitted</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">Your report has been received and assigned ID <span className="font-mono font-bold text-aegis-500">#AEG-{Math.floor(1000 + Math.random() * 9000)}</span></p>
          <p className="text-xs text-gray-400 mb-6">Our AI system will classify and prioritise your report. Emergency responders will be notified if needed.</p>
          <button onClick={onClose} className="btn-primary px-6 py-2.5">Close</button>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white dark:bg-gray-900 rounded-2xl max-w-lg w-full max-h-[90vh] overflow-auto border border-gray-200 dark:border-gray-700 shadow-2xl animate-scale-in">
        {/* Header */}
        <div className="sticky top-0 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 px-5 py-4 flex items-center justify-between rounded-t-2xl z-10">
          <div>
            <h2 className="font-bold text-sm">Report Emergency</h2>
            <p className="text-[10px] text-gray-500 dark:text-gray-400">Step {step + 1} of {steps.length} — {steps[step]}</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg hover:bg-gray-100 dark:hover:bg-white/5 flex items-center justify-center">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Progress */}
        <div className="px-5 pt-4">
          <div className="flex gap-1">
            {steps.map((_, i) => (
              <div key={i} className={`h-1 flex-1 rounded-full transition-all ${i <= step ? 'bg-aegis-500' : 'bg-gray-200 dark:bg-gray-700'}`} />
            ))}
          </div>
        </div>

        {/* Step Content */}
        <div className="p-5 space-y-4">
          {step === 0 && (
            <div className="space-y-3 animate-fade-up">
              <h3 className="text-sm font-bold">What type of emergency?</h3>
              <div className="grid grid-cols-2 gap-2">
                {TYPES.map(t => (
                  <button key={t} onClick={() => setType(t)} className={`p-3 rounded-xl text-left text-xs font-semibold border-2 transition-all ${type === t ? 'border-aegis-500 bg-aegis-500/5 text-aegis-600 dark:text-aegis-400' : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'}`}>
                    {t}
                  </button>
                ))}
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-4 animate-fade-up">
              <div>
                <h3 className="text-sm font-bold mb-2">Severity Level</h3>
                <div className="space-y-2">
                  {SEVERITIES.map(s => (
                    <button key={s.level} onClick={() => setSeverity(s.level)} className={`w-full p-3 rounded-xl text-left border-2 transition-all flex items-center gap-3 ${severity === s.level ? 'border-aegis-500 bg-aegis-500/5' : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'}`}>
                      <span className={`w-3 h-3 rounded-full ${s.color} flex-shrink-0`} />
                      <div>
                        <p className="text-xs font-bold">{s.level}</p>
                        <p className="text-[10px] text-gray-500 dark:text-gray-400">{s.desc}</p>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs font-bold block mb-1.5">Description <span className="text-gray-400 font-normal">({description.length}/500)</span></label>
                <textarea value={description} onChange={e => setDescription(e.target.value.slice(0, 500))} rows={4} placeholder="Describe what you see — include details like water level, number of people affected, etc." className="input text-xs resize-none" />
              </div>
              <div>
                <label className="text-xs font-bold block mb-1.5">Photo Evidence (optional)</label>
                <div className="border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-xl p-6 text-center cursor-pointer hover:border-aegis-400 transition-colors">
                  <Upload className="w-6 h-6 text-gray-400 mx-auto mb-2" />
                  <p className="text-xs text-gray-500">Tap to upload a photo</p>
                  <p className="text-[10px] text-gray-400 mt-1">JPG, PNG up to 10MB</p>
                </div>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4 animate-fade-up">
              <h3 className="text-sm font-bold">Location</h3>
              <button onClick={() => setUseGPS(true)} className={`w-full p-4 rounded-xl text-left border-2 transition-all flex items-center gap-3 ${useGPS ? 'border-aegis-500 bg-aegis-500/5' : 'border-gray-200 dark:border-gray-700 hover:border-gray-300'}`}>
                <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center"><MapPin className="w-5 h-5 text-blue-500" /></div>
                <div>
                  <p className="text-xs font-bold">Use My Location (GPS)</p>
                  <p className="text-[10px] text-gray-500 dark:text-gray-400">{useGPS ? '📍 57.1497° N, 2.0943° W — Aberdeen' : 'Auto-detect your current position'}</p>
                </div>
              </button>
              <div className="text-center text-[10px] text-gray-400">— or —</div>
              <input value={location} onChange={e => { setLocation(e.target.value); setUseGPS(false) }} placeholder="Type an address or landmark..." className="input text-xs" />
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4 animate-fade-up">
              <h3 className="text-sm font-bold">Review Your Report</h3>
              <div className="space-y-3 p-4 rounded-xl bg-gray-50 dark:bg-white/[0.02] border border-gray-200 dark:border-gray-700">
                {[
                  { label: 'Type', value: type, icon: AlertTriangle },
                  { label: 'Severity', value: severity },
                  { label: 'Location', value: useGPS ? '📍 GPS: 57.1497° N, 2.0943° W' : location, icon: MapPin },
                ].map(r => (
                  <div key={r.label} className="flex justify-between items-center py-1.5 border-b border-gray-200/60 dark:border-gray-700/60 last:border-0">
                    <span className="text-xs text-gray-500 dark:text-gray-400">{r.label}</span>
                    <span className="text-xs font-bold">{r.value}</span>
                  </div>
                ))}
                <div className="pt-1.5">
                  <span className="text-xs text-gray-500 dark:text-gray-400 block mb-1">Description</span>
                  <p className="text-xs">{description}</p>
                </div>
              </div>
              <div className="p-3 rounded-xl bg-blue-500/5 border border-blue-500/10">
                <p className="text-[10px] text-blue-500 dark:text-blue-400 flex items-start gap-2">
                  <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                  Your report will be sent to emergency services and processed by our AI system. Anonymous reporting is enabled.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-800 px-5 py-4 flex items-center justify-between rounded-b-2xl">
          <button onClick={() => step > 0 && setStep(step - 1)} disabled={step === 0} className="btn-ghost text-xs px-4 py-2 disabled:opacity-30 flex items-center gap-1">
            <ChevronLeft className="w-3.5 h-3.5" /> Back
          </button>
          {step < 3 ? (
            <button onClick={() => setStep(step + 1)} disabled={!canNext} className="btn-primary text-xs px-6 py-2 disabled:opacity-40 flex items-center gap-1">
              Next <ChevronRight className="w-3.5 h-3.5" />
            </button>
          ) : (
            <button onClick={handleSubmit} disabled={submitting} className="btn-primary text-xs px-6 py-2 flex items-center gap-2">
              {submitting ? <><Loader className="w-3.5 h-3.5 animate-spin" /> Submitting...</> : <><CheckCircle className="w-3.5 h-3.5" /> Submit Report</>}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
