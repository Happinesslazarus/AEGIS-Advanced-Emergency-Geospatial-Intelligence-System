import { Link } from 'react-router-dom'
import { Lock, ArrowLeft } from 'lucide-react'

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className="bg-white dark:bg-gray-900 rounded-2xl p-6 shadow-sm border border-gray-100 dark:border-gray-800">
    <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100 mb-3">{title}</h2>
    <div className="text-sm text-gray-700 dark:text-gray-300 space-y-3 leading-relaxed">{children}</div>
  </section>
)

export default function PrivacyPage(): JSX.Element {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <div className="bg-gradient-to-r from-gray-900 to-gray-800 text-white py-12 px-6">
        <div className="max-w-3xl mx-auto">
          <Link to="/citizen" className="inline-flex items-center gap-2 text-gray-400 hover:text-white text-sm mb-6 transition-colors"><ArrowLeft className="w-4 h-4" /> Back to AEGIS</Link>
          <div className="flex items-center gap-3 mb-3"><Lock className="w-7 h-7 text-blue-400" /><h1 className="text-2xl font-bold">Privacy Policy</h1></div>
          <p className="text-gray-400 text-sm">Last updated: March 2026 · AEGIS Emergency Platform</p>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-6 py-10 space-y-6">
        <Section title="1. Who We Are">
          <p>AEGIS (Adaptive Emergency &amp; Geospatial Intelligence System) is an academic emergency management platform developed at Robert Gordon University (RGU), Aberdeen, Scotland, as part of the CM4134 Honours Project.</p>
          <p>For privacy enquiries, contact the project team via Robert Gordon University, Garthdee Campus, Aberdeen, AB10 7QB, Scotland.</p>
        </Section>

        <Section title="2. What Data We Collect">
          <p><strong>Data you provide voluntarily:</strong></p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Community reports (location, description, photos) you submit through the platform</li>
            <li>Contact requests you initiate through the Community Help section</li>
            <li>Account details if you register as an operator or volunteer</li>
          </ul>
          <p><strong>Data collected automatically:</strong></p>
          <ul className="list-disc pl-5 space-y-1">
            <li>GPS location — only when you explicitly grant permission via the location buttons on the platform. We never collect location in the background.</li>
            <li>Browser type and operating system (for compatibility purposes only)</li>
            <li>Usage patterns (aggregated and anonymised) to improve the service</li>
          </ul>
          <p><strong>Data stored locally on your device only (not sent to any server):</strong></p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Emergency kit checklist progress (localStorage)</li>
            <li>Completed scenario records (localStorage)</li>
            <li>Family emergency plan information (localStorage)</li>
            <li>Quiz scores and badges (localStorage)</li>
          </ul>
        </Section>

        <Section title="3. How We Use Your Data">
          <ul className="list-disc pl-5 space-y-1">
            <li>To display community reports on the incident map and feed</li>
            <li>To provide location-specific weather, flood, and emergency alert data</li>
            <li>To improve the platform through aggregated, anonymised analytics</li>
            <li>To enable emergency service operators to coordinate responses</li>
            <li>We do NOT use your data for advertising, profiling, or commercial purposes</li>
          </ul>
        </Section>

        <Section title="4. Legal Basis for Processing (GDPR)">
          <p>We process your data under the following legal bases as defined by UK GDPR (retained post-Brexit) and the Data Protection Act 2018:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong>Legitimate interests</strong> — providing emergency information services</li>
            <li><strong>Consent</strong> — for location access (you explicitly grant via device prompt)</li>
            <li><strong>Vital interests</strong> — sharing data with emergency services when life is at risk</li>
          </ul>
        </Section>

        <Section title="5. Data Sharing">
          <p>We do not sell, rent, or trade your personal data. We may share data with:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong>Emergency services (Police Scotland, Fire and Rescue, Ambulance)</strong> — only when a report indicates immediate risk to life, and only with your knowledge or in exceptional circumstances</li>
            <li><strong>Academic supervisors at RGU</strong> — anonymised, aggregated data for research assessment purposes</li>
            <li><strong>No third-party advertisers or data brokers</strong></li>
          </ul>
        </Section>

        <Section title="6. Data Retention">
          <ul className="list-disc pl-5 space-y-1">
            <li>Community reports are retained for up to 12 months for incident analysis</li>
            <li>Anonymous usage logs are retained for 90 days</li>
            <li>Local device data (kit, plan, quiz) is retained indefinitely on your device until you clear browser storage</li>
          </ul>
        </Section>

        <Section title="7. Your Rights">
          <p>Under UK GDPR, you have the right to:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong>Access</strong> — request a copy of data we hold about you</li>
            <li><strong>Erasure</strong> — request deletion of your data ("right to be forgotten")</li>
            <li><strong>Rectification</strong> — correct inaccurate data we hold</li>
            <li><strong>Portability</strong> — receive your data in a machine-readable format</li>
            <li><strong>Objection</strong> — object to processing based on legitimate interests</li>
            <li><strong>Withdraw consent</strong> — at any time for consent-based processing (e.g. revoke location in browser settings)</li>
          </ul>
          <p>To exercise your rights, contact us at RGU via the address above. We respond within 30 days.</p>
        </Section>

        <Section title="8. Cookies & Local Storage">
          <p>AEGIS does not use tracking cookies. We use <strong>localStorage</strong> exclusively to store your preferences and training progress locally on your device. This data never leaves your browser.</p>
          <p>We may use a session cookie for logged-in operator accounts, which expires when you close the browser.</p>
        </Section>

        <Section title="9. Security">
          <p>We implement industry-standard security measures including HTTPS encryption, secure database connections, and access controls. Community reports containing sensitive information are encrypted in transit and at rest.</p>
          <p>However, no system is 100% secure. If you become aware of a security vulnerability, please report it to the RGU project team immediately.</p>
        </Section>

        <Section title="10. Changes to This Policy">
          <p>We may update this Privacy Policy as the platform evolves. Significant changes will be notified via an in-app banner. Continued use of AEGIS after changes constitutes acceptance of the updated policy.</p>
        </Section>

        <div className="flex flex-wrap gap-4 text-sm justify-center pt-4 border-t border-gray-200 dark:border-gray-800">
          <Link to="/citizen" className="text-aegis-600 hover:underline">← Back to Dashboard</Link>
          <Link to="/about" className="text-gray-500 hover:text-aegis-600">About AEGIS</Link>
          <Link to="/terms" className="text-gray-500 hover:text-aegis-600">Terms of Use</Link>
          <Link to="/accessibility" className="text-gray-500 hover:text-aegis-600">Accessibility</Link>
        </div>
      </div>
    </div>
  )
}
