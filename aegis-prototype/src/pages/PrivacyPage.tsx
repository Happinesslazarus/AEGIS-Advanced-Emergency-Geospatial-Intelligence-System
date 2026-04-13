import { Navbar } from '../components/Navbar'
import Footer from '../components/Footer'
import { Shield, Lock, Eye, Database, Globe, UserCheck, Cookie, Bell, Trash2, Mail } from 'lucide-react'

const SECTIONS = [
  { title: 'Information We Collect', icon: Database, items: [
    'Location data (GPS) — only when you explicitly share it or submit a report',
    'Account details (name, email) — for registered citizens only',
    'Report content (photos, descriptions) — submitted voluntarily',
    'Device information — browser type, OS for compatibility',
    'Usage analytics — anonymous, aggregated platform usage patterns',
  ]},
  { title: 'How We Use Your Data', icon: Eye, items: [
    'Emergency response coordination and resource deployment',
    'AI-powered disaster classification and severity assessment',
    'Generating public safety alerts for your area',
    'Improving platform accuracy and reliability',
    'Anonymous research to enhance disaster preparedness',
  ]},
  { title: 'Data Sharing', icon: Globe, items: [
    'Emergency services — when you submit an SOS or report',
    'Local authorities — aggregated incident data for response',
    'We NEVER sell personal data to third parties',
    'We NEVER share individual location data without consent',
    'Anonymised data may be shared for academic research purposes',
  ]},
  { title: 'Your Rights (GDPR)', icon: UserCheck, items: [
    'Right to access — request a copy of your personal data',
    'Right to rectification — correct inaccurate information',
    'Right to erasure — request deletion of your account and data',
    'Right to portability — export your data in a standard format',
    'Right to object — opt out of non-essential data processing',
  ]},
  { title: 'Cookies & Storage', icon: Cookie, items: [
    'Essential cookies — session management, authentication',
    'Functional cookies — theme preferences, language settings',
    'Analytics cookies — anonymous usage statistics (opt-in only)',
    'Local storage — offline-capable safety data cache',
    'No third-party tracking or advertising cookies',
  ]},
  { title: 'Data Security', icon: Lock, items: [
    'End-to-end encryption for all data in transit (TLS 1.3)',
    'AES-256 encryption for data at rest',
    'Regular security audits and penetration testing',
    'Role-based access control for all operator accounts',
    'Automated intrusion detection and anomaly monitoring',
  ]},
]

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-aegis-100/40 dark:from-gray-950 dark:via-gray-900 dark:to-aegis-950/30 text-gray-900 dark:text-gray-100">
      <Navbar />
      <main className="pt-20 pb-16">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 space-y-12">
          <section className="text-center space-y-4">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-aegis-500 to-blue-600 flex items-center justify-center mx-auto">
              <Shield className="w-7 h-7 text-white" />
            </div>
            <h1 className="text-3xl font-bold">Privacy Policy</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 max-w-lg mx-auto">How AEGIS collects, uses, and protects your personal data. GDPR compliant.</p>
            <p className="text-[10px] text-gray-400">Last updated: January 2026</p>
          </section>

          <div className="card p-6 border-l-4 border-aegis-500">
            <h3 className="text-sm font-bold mb-2">Our Commitment</h3>
            <p className="text-xs text-gray-600 dark:text-gray-400 leading-relaxed">AEGIS is committed to protecting your privacy and personal data. As a disaster management platform, we handle sensitive location and safety data with the highest security standards. We collect only what is necessary for emergency response and never monetise your data.</p>
          </div>

          <div className="space-y-6">
            {SECTIONS.map(s => (
              <section key={s.title} className="card p-6">
                <h2 className="text-sm font-bold flex items-center gap-2 mb-4"><s.icon className="w-4 h-4 text-aegis-500" /> {s.title}</h2>
                <ul className="space-y-2">
                  {s.items.map(item => (
                    <li key={item} className="text-xs text-gray-600 dark:text-gray-400 flex items-start gap-2">
                      <span className="w-1 h-1 rounded-full bg-aegis-500 mt-1.5 flex-shrink-0" />
                      {item}
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>

          <section className="card p-6">
            <h2 className="text-sm font-bold flex items-center gap-2 mb-3"><Mail className="w-4 h-4 text-aegis-500" /> Contact</h2>
            <p className="text-xs text-gray-600 dark:text-gray-400">For privacy inquiries or data requests, contact: <strong>privacy@aegis-platform.ac.uk</strong></p>
            <p className="text-xs text-gray-500 mt-2">Data Protection Officer: Robert Gordon University, Garthdee Road, Aberdeen, AB10 7GJ</p>
          </section>
        </div>
      </main>
      <Footer />
    </div>
  )
}
