import { Link } from 'react-router-dom'
import { Eye, ArrowLeft, CheckCircle, AlertTriangle, Globe, Volume2, Monitor, Smartphone } from 'lucide-react'

const Section = ({ title, icon: Icon, children }: { title: string; icon: React.ElementType; children: React.ReactNode }) => (
  <section className="bg-white dark:bg-gray-900 rounded-2xl p-6 shadow-sm border border-gray-100 dark:border-gray-800">
    <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100 mb-3 flex items-center gap-2"><Icon className="w-5 h-5 text-aegis-500" />{title}</h2>
    <div className="text-sm text-gray-700 dark:text-gray-300 space-y-3 leading-relaxed">{children}</div>
  </section>
)

export default function AccessibilityPage(): JSX.Element {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <div className="bg-gradient-to-r from-aegis-800 to-blue-800 text-white py-12 px-6">
        <div className="max-w-3xl mx-auto">
          <Link to="/citizen" className="inline-flex items-center gap-2 text-aegis-200 hover:text-white text-sm mb-6 transition-colors"><ArrowLeft className="w-4 h-4" /> Back to AEGIS</Link>
          <div className="flex items-center gap-3 mb-3"><Eye className="w-7 h-7 text-blue-300" /><h1 className="text-2xl font-bold">Accessibility Statement</h1></div>
          <p className="text-aegis-200 text-sm">AEGIS Emergency Platform · Last reviewed: March 2026</p>
          <p className="text-white/80 text-sm mt-2">AEGIS is committed to ensuring digital accessibility for people with disabilities and diverse needs — especially during the high-stress context of emergencies.</p>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-6 py-10 space-y-6">

        <Section title="Compliance Status" icon={CheckCircle}>
          <p>AEGIS aims to conform to <strong>WCAG 2.1 Level AA</strong> as defined by the Web Content Accessibility Guidelines. It is partially conformant — some areas are still being improved.</p>
          <p>We strive to meet the four WCAG principles: <strong>Perceivable, Operable, Understandable, and Robust (POUR)</strong>.</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-2">
            {[
              { label: 'Perceivable', status: '✅ Good', detail: 'Alt text, colour contrast, text resize' },
              { label: 'Operable', status: '✅ Good', detail: 'Keyboard nav, no timing barriers' },
              { label: 'Understandable', status: '⚠️ Partial', detail: 'Plain language in progress' },
              { label: 'Robust', status: '✅ Good', detail: 'Semantic HTML, ARIA roles' },
            ].map(({ label, status, detail }) => (
              <div key={label} className="bg-gray-50 dark:bg-gray-800 rounded-xl p-3 text-center">
                <p className="font-bold text-xs mb-1">{label}</p>
                <p className="text-xs font-semibold mb-1">{status}</p>
                <p className="text-[10px] text-gray-500">{detail}</p>
              </div>
            ))}
          </div>
        </Section>

        <Section title="Language Support" icon={Globe}>
          <p>AEGIS supports <strong>12 languages</strong> with on-screen translation for key emergency content:</p>
          <div className="flex flex-wrap gap-2 mt-2">
            {['English', 'Scottish Gaelic', 'Welsh', 'French', 'Spanish', 'Arabic (RTL)', 'Chinese', 'Hindi', 'Portuguese', 'Polish', 'Urdu (RTL)', 'More coming'].map(lang => (
              <span key={lang} className="bg-aegis-50 dark:bg-aegis-950/30 text-aegis-700 dark:text-aegis-300 text-xs px-2.5 py-1 rounded-full border border-aegis-200 dark:border-aegis-800">{lang}</span>
            ))}
          </div>
          <p className="mt-3">Right-to-left (RTL) layout is automatically applied for Arabic and Urdu. Language can be selected at any time from the top of the dashboard.</p>
        </Section>

        <Section title="Visual Accessibility" icon={Eye}>
          <ul className="list-disc pl-5 space-y-1.5">
            <li><strong>Colour contrast:</strong> All text meets or exceeds WCAG AA 4.5:1 contrast ratio. Alert severity uses colour AND text labels simultaneously (never colour alone).</li>
            <li><strong>Dark mode:</strong> A full dark mode is available via the moon icon in the top-right corner. All components have been designed for both themes.</li>
            <li><strong>Text size:</strong> All text is defined in relative units (rem/em) to respect browser text-size preferences. Use Ctrl +/- or your browser's zoom to resize freely.</li>
            <li><strong>Icons:</strong> All icon-only buttons include descriptive aria-label attributes and title tooltips.</li>
            <li><strong>Status indicators:</strong> River gauge status uses colour, text labels (ALERT, WARNING, NORMAL), and icons — never colour alone.</li>
          </ul>
        </Section>

        <Section title="Motor & Keyboard Accessibility" icon={Monitor}>
          <ul className="list-disc pl-5 space-y-1.5">
            <li><strong>Keyboard navigation:</strong> All interactive elements (buttons, links, form fields) are reachable and operable via keyboard using Tab and Enter/Space.</li>
            <li><strong>Focus indicators:</strong> Visible focus outlines are present on all interactive elements (ring styles via Tailwind).</li>
            <li><strong>No time limits:</strong> No content on AEGIS auto-expires or requires timed interaction (except auto-refreshing data, which can be manually paused).</li>
            <li><strong>Touch targets:</strong> All interactive elements are at least 44×44px on mobile to meet WCAG 2.5.5 guidance.</li>
            <li><strong>Skip to content:</strong> Planned for a future release.</li>
          </ul>
        </Section>

        <Section title="Screen Reader Support" icon={Volume2}>
          <ul className="list-disc pl-5 space-y-1.5">
            <li>Semantic HTML5 elements are used throughout (header, main, nav, section, button, etc.)</li>
            <li>ARIA roles and landmarks are used for modal dialogs (role="dialog" aria-modal="true")</li>
            <li>Dynamic content changes use aria-live regions where appropriate to announce updates</li>
            <li>Form fields have associated labels — no placeholder-only inputs</li>
            <li>Tested with VoiceOver (macOS/iOS) and NVDA (Windows)</li>
          </ul>
        </Section>

        <Section title="Mobile & Responsive" icon={Smartphone}>
          <ul className="list-disc pl-5 space-y-1.5">
            <li>Fully responsive design — tested on screens from 320px to 4K</li>
            <li>Touch-friendly: gesture support for swipe (modals), large touch targets</li>
            <li>Installable as a Progressive Web App (PWA) on iOS and Android — add to home screen for an app-like experience</li>
            <li>Offline capability: Service Worker caches core assets and latest alert data</li>
            <li>Push notifications supported on mobile browsers (Chrome, Firefox, Edge)</li>
          </ul>
        </Section>

        <Section title="Known Limitations" icon={AlertTriangle}>
          <ul className="list-disc pl-5 space-y-1.5">
            <li>The real-time flood map widget does not support keyboard-only pan/zoom (third-party limitation) — text-based river gauge data is available as a full keyboard-accessible alternative.</li>
            <li>Some complex data tables may not be fully navigable by screen readers in older browsers (use Chrome or Firefox for best experience).</li>
            <li>Audio alerts for emergency notifications are planned but not yet implemented in this version.</li>
            <li>Automated captions for video content are not yet available (content is text-based).</li>
          </ul>
        </Section>

        <Section title="Feedback & Reporting Issues" icon={CheckCircle}>
          <p>We welcome accessibility feedback. If you experience a barrier while using AEGIS, please report it to us:</p>
          <p><strong>Robert Gordon University</strong> — Garthdee Campus, Aberdeen, AB10 7QB, Scotland</p>
          <p>We aim to respond to accessibility requests within <strong>5 working days</strong> and resolve critical barriers within <strong>30 days</strong>.</p>
          <p className="mt-2 text-gray-500 dark:text-gray-400">If you are not satisfied with our response, you may contact the <strong>Equality and Human Rights Commission (EHRC)</strong> or the <strong>Equality Advisory and Support Service (EASS)</strong>.</p>
        </Section>

        <div className="flex flex-wrap gap-4 text-sm justify-center pt-4 border-t border-gray-200 dark:border-gray-800">
          <Link to="/citizen" className="text-aegis-600 hover:underline">← Back to Dashboard</Link>
          <Link to="/about" className="text-gray-500 hover:text-aegis-600">About AEGIS</Link>
          <Link to="/privacy" className="text-gray-500 hover:text-aegis-600">Privacy Policy</Link>
          <Link to="/terms" className="text-gray-500 hover:text-aegis-600">Terms of Use</Link>
        </div>
      </div>
    </div>
  )
}
