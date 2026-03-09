import { Link } from 'react-router-dom'
import { FileText, ArrowLeft } from 'lucide-react'

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className="bg-white dark:bg-gray-900 rounded-2xl p-6 shadow-sm border border-gray-100 dark:border-gray-800">
    <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100 mb-3">{title}</h2>
    <div className="text-sm text-gray-700 dark:text-gray-300 space-y-3 leading-relaxed">{children}</div>
  </section>
)

export default function TermsPage(): JSX.Element {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <div className="bg-gradient-to-r from-gray-900 to-gray-800 text-white py-12 px-6">
        <div className="max-w-3xl mx-auto">
          <Link to="/citizen" className="inline-flex items-center gap-2 text-gray-400 hover:text-white text-sm mb-6 transition-colors"><ArrowLeft className="w-4 h-4" /> Back to AEGIS</Link>
          <div className="flex items-center gap-3 mb-3"><FileText className="w-7 h-7 text-blue-400" /><h1 className="text-2xl font-bold">Terms of Use</h1></div>
          <p className="text-gray-400 text-sm">Last updated: March 2026 · AEGIS Emergency Platform</p>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-6 py-10 space-y-6">
        <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-xl p-4 text-sm text-amber-800 dark:text-amber-200">
          <strong>Important:</strong> AEGIS is an academic research platform and is NOT a substitute for official emergency services. In any life-threatening emergency, always call <strong>999</strong> (UK) or <strong>112</strong> (EU) first.
        </div>

        <Section title="1. Acceptance of Terms">
          <p>By accessing or using the AEGIS platform ("the Service"), you agree to be bound by these Terms of Use. If you do not agree, please discontinue use immediately.</p>
          <p>AEGIS is operated by Robert Gordon University (RGU) as part of an academic Honours Project (CM4134). These terms govern your use of the web application available at the project's demonstration URL.</p>
        </Section>

        <Section title="2. Nature of the Service">
          <p>AEGIS is designed to:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Aggregate and display publicly available emergency and environmental data</li>
            <li>Enable community members to submit and view incident reports</li>
            <li>Provide public preparedness training and guidance materials</li>
            <li>Support emergency management operators with situational awareness tools</li>
          </ul>
          <p><strong>AEGIS does not replace official emergency services, government alert systems, or professional emergency management agencies.</strong> All official warnings from SEPA, the Met Office, the Environment Agency, or Police Scotland take precedence over information displayed on AEGIS.</p>
        </Section>

        <Section title="3. User Conduct">
          <p>When using AEGIS, you agree NOT to:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Submit false, misleading, or fabricated incident reports</li>
            <li>Impersonate emergency service personnel or government officials</li>
            <li>Use the platform to spread panic, disinformation, or harmful content</li>
            <li>Attempt to access administrator or operator functions without authorisation</li>
            <li>Scrape, crawl, or systematically extract data from the platform</li>
            <li>Attempt to disrupt, hack, or compromise the security of the Service</li>
            <li>Submit content that is defamatory, threatening, or discriminatory</li>
          </ul>
          <p>Violations may result in your access being suspended and, in serious cases, referral to relevant authorities.</p>
        </Section>

        <Section title="4. Community Reports">
          <p>When you submit a community report, you:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Confirm the information is accurate to the best of your knowledge</li>
            <li>Grant AEGIS a non-exclusive licence to display and share the report with emergency services</li>
            <li>Understand the report may be reviewed, edited, or removed by platform operators</li>
            <li>Accept that false reports may have serious consequences for emergency resource allocation</li>
          </ul>
        </Section>

        <Section title="5. Data Accuracy Disclaimer">
          <p>AEGIS integrates data from third-party APIs including the UK Environment Agency, SEPA, Met Office feeds, and news sources. While we make every effort to display current and accurate information:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Data may have delays or gaps due to sensor failures or API outages</li>
            <li>River gauge readings and weather data are indicative, not authoritative</li>
            <li>Community reports represent citizen observations and are unverified unless marked</li>
          </ul>
          <p>Always verify critical safety information through official channels before taking action.</p>
        </Section>

        <Section title="6. Intellectual Property">
          <p>The AEGIS platform design, source code, training content, and preparedness materials are the intellectual property of the development team and Robert Gordon University.</p>
          <p>Third-party data displayed (EA, SEPA, Met Office, RSS feeds) remains the property of their respective owners and is used under public access licences or fair use for non-commercial academic purposes.</p>
        </Section>

        <Section title="7. Limitation of Liability">
          <p>AEGIS and Robert Gordon University shall not be liable for:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Decisions made based on information displayed on the platform</li>
            <li>Loss of life, injury, or property damage resulting from reliance on AEGIS data</li>
            <li>Service interruptions, data inaccuracies, or API failures</li>
            <li>Actions taken by third parties based on community reports you submitted</li>
          </ul>
          <p>This platform is provided "as is" for academic demonstration purposes. It is not a production-grade, legally certified emergency management system.</p>
        </Section>

        <Section title="8. Availability">
          <p>We make no guarantees about the continuous availability of AEGIS. The service may be taken offline during maintenance, academic assessment periods, or infrastructure changes with or without notice.</p>
        </Section>

        <Section title="9. Governing Law">
          <p>These terms are governed by the laws of Scotland and the United Kingdom. Any disputes shall be subject to the jurisdiction of the Scottish courts.</p>
        </Section>

        <Section title="10. Changes to Terms">
          <p>We may update these terms at any time. Continued use of AEGIS after changes constitutes acceptance. Check this page periodically for updates.</p>
        </Section>

        <div className="flex flex-wrap gap-4 text-sm justify-center pt-4 border-t border-gray-200 dark:border-gray-800">
          <Link to="/citizen" className="text-aegis-600 hover:underline">← Back to Dashboard</Link>
          <Link to="/about" className="text-gray-500 hover:text-aegis-600">About AEGIS</Link>
          <Link to="/privacy" className="text-gray-500 hover:text-aegis-600">Privacy Policy</Link>
          <Link to="/accessibility" className="text-gray-500 hover:text-aegis-600">Accessibility</Link>
        </div>
      </div>
    </div>
  )
}
