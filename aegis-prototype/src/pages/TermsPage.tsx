import { Navbar } from '../components/Navbar'
import Footer from '../components/Footer'
import { Shield, FileText, AlertTriangle, Users, Lock, Globe, CheckCircle } from 'lucide-react'

const SECTIONS = [
  { title: '1. Acceptance of Terms', content: 'By accessing AEGIS, you agree to these Terms of Service. If you do not agree, please do not use the platform. AEGIS is a disaster management tool and should not be used as a sole source of emergency information.' },
  { title: '2. Service Description', content: 'AEGIS provides AI-powered disaster monitoring, citizen reporting, real-time alerts, and community safety tools. The platform aggregates data from multiple sources including Environment Agency, SEPA, Met Office, and citizen reports.' },
  { title: '3. User Responsibilities', content: 'Users must provide accurate information when submitting reports. False reports may result in account suspension. Users must not deliberately submit misleading or malicious disaster information. Emergency situations should always be reported to official services (999/112) first.' },
  { title: '4. Account Terms', content: 'Citizen accounts require a valid email address. Users are responsible for maintaining the confidentiality of their login credentials. Operator accounts are issued only to authorised emergency response personnel.' },
  { title: '5. Content & Reports', content: 'By submitting reports, you grant AEGIS a non-exclusive licence to use, process, and share report data with emergency services and relevant authorities. Reports may be anonymised for research purposes. Uploaded images become part of the incident record.' },
  { title: '6. AI & Automated Processing', content: 'AEGIS uses machine learning models to classify and prioritise disaster reports. While our AI achieves 94%+ accuracy, automated decisions are subject to human review. Users should not rely solely on AI classifications for life-safety decisions.' },
  { title: '7. Service Availability', content: 'AEGIS aims for 99.9% uptime but does not guarantee uninterrupted service. During severe emergencies, platform performance may be affected by high demand. AEGIS is not a replacement for official emergency services.' },
  { title: '8. Limitation of Liability', content: 'AEGIS is provided "as is" without warranty. The platform is an academic project developed at Robert Gordon University. AEGIS, its developers, and the university are not liable for any damages arising from the use or inability to use the service.' },
  { title: '9. Modifications', content: 'We reserve the right to modify these terms at any time. Users will be notified of significant changes via email or in-app notification. Continued use after changes constitutes acceptance of the new terms.' },
]

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-aegis-100/40 dark:from-gray-950 dark:via-gray-900 dark:to-aegis-950/30 text-gray-900 dark:text-gray-100">
      <Navbar />
      <main className="pt-20 pb-16">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 space-y-12">
          <section className="text-center space-y-4">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-aegis-500 to-blue-600 flex items-center justify-center mx-auto">
              <FileText className="w-7 h-7 text-white" />
            </div>
            <h1 className="text-3xl font-bold">Terms of Service</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 max-w-lg mx-auto">Please read these terms carefully before using the AEGIS platform.</p>
            <p className="text-[10px] text-gray-400">Effective: January 2026</p>
          </section>

          <div className="card p-6 border-l-4 border-amber-500">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
              <div>
                <h3 className="text-sm font-bold mb-1">Important Notice</h3>
                <p className="text-xs text-gray-600 dark:text-gray-400">AEGIS is a supplementary disaster management tool. In a life-threatening emergency, <strong>always call 999 (UK) or 112 (EU)</strong>. Do not rely solely on this platform for life-safety decisions.</p>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            {SECTIONS.map(s => (
              <section key={s.title} className="card p-6">
                <h2 className="text-sm font-bold mb-2">{s.title}</h2>
                <p className="text-xs text-gray-600 dark:text-gray-400 leading-relaxed">{s.content}</p>
              </section>
            ))}
          </div>

          <section className="card p-6">
            <h2 className="text-sm font-bold mb-2">10. Contact</h2>
            <p className="text-xs text-gray-600 dark:text-gray-400">For questions about these terms: <strong>legal@aegis-platform.ac.uk</strong></p>
            <p className="text-xs text-gray-500 mt-2">Robert Gordon University, Garthdee Road, Aberdeen, AB10 7GJ, Scotland, UK</p>
          </section>
        </div>
      </main>
      <Footer />
    </div>
  )
}
