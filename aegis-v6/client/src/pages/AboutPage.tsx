import { Link } from 'react-router-dom'
import { Shield, Globe, Users, BookOpen, Heart, Award, ArrowLeft, Zap, Bell, Map } from 'lucide-react'

export default function AboutPage(): JSX.Element {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      {/* Hero */}
      <div className="bg-gradient-to-br from-aegis-800 via-aegis-700 to-blue-700 text-white py-16 px-6">
        <div className="max-w-4xl mx-auto">
          <Link to="/citizen" className="inline-flex items-center gap-2 text-aegis-200 hover:text-white text-sm mb-6 transition-colors">
            <ArrowLeft className="w-4 h-4" /> Back to AEGIS
          </Link>
          <div className="flex items-center gap-4 mb-4">
            <div className="w-14 h-14 rounded-2xl bg-white/20 flex items-center justify-center">
              <Shield className="w-8 h-8 text-white" />
            </div>
            <div>
              <h1 className="text-3xl font-bold">About AEGIS</h1>
              <p className="text-aegis-200 text-sm mt-0.5">Adaptive Emergency & Geospatial Intelligence System</p>
            </div>
          </div>
          <p className="text-lg text-white/90 max-w-2xl leading-relaxed">
            AEGIS is a next-generation public emergency platform built to provide UK communities with real-time disaster awareness, flood monitoring, community-driven reporting, and advanced preparedness tools.
          </p>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-12 space-y-12">

        {/* Mission */}
        <section>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-4 flex items-center gap-2"><Heart className="w-6 h-6 text-red-500" /> Our Mission</h2>
          <div className="bg-white dark:bg-gray-900 rounded-2xl p-6 shadow-sm border border-gray-100 dark:border-gray-800">
            <p className="text-gray-700 dark:text-gray-300 leading-relaxed mb-4">
              AEGIS was built on a simple belief: every person deserves access to the information they need to stay safe during a disaster — regardless of language, disability, or digital literacy. We bring together live data, community knowledge, and AI-driven analysis to create a unified picture of risk for everyone.
            </p>
            <p className="text-gray-700 dark:text-gray-300 leading-relaxed">
              We are not a replacement for the emergency services. AEGIS augments the public's ability to self-inform, self-prepare, and assist their communities — filling the gaps that official channels simply cannot reach in real time.
            </p>
          </div>
        </section>

        {/* Key Features */}
        <section>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-4 flex items-center gap-2"><Zap className="w-6 h-6 text-amber-500" /> Key Features</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {[
              { icon: Bell, title: 'Live Emergency Alerts', desc: 'Real-time push notifications for floods, storms, and civil emergencies across the UK — sourced from SEPA, the Environment Agency, and Met Office.', color: 'text-red-500' },
              { icon: Map, title: 'Flood & River Monitoring', desc: 'Live river gauge readings from UK Environment Agency and SEPA KiWIS, showing levels, trends, and alert status for hundreds of stations.', color: 'text-blue-500' },
              { icon: Users, title: 'Community Reporting', desc: 'Verified citizen reports allow communities to share ground-truth information that official systems miss — road closures, shelter availability, and local conditions.', color: 'text-green-500' },
              { icon: BookOpen, title: 'Disaster Preparedness Training', desc: 'Interactive scenario training, emergency kit checklists, knowledge quizzes, and family emergency planning tools — always accessible, even offline.', color: 'text-purple-500' },
              { icon: Globe, title: '12 Languages', desc: 'AEGIS supports English, Gaelic, Welsh, French, Spanish, Arabic, Chinese, Hindi, Portuguese, Polish, Urdu and more — ensuring no community is left behind.', color: 'text-aegis-500' },
              { icon: Award, title: 'AI-Powered Analysis', desc: 'Our integrated AI engine analyses patterns across sensor data, weather, and community reports to predict and prioritise emerging incidents.', color: 'text-amber-500' },
            ].map(({ icon: Icon, title, desc, color }) => (
              <div key={title} className="bg-white dark:bg-gray-900 rounded-2xl p-5 shadow-sm border border-gray-100 dark:border-gray-800">
                <Icon className={`w-6 h-6 ${color} mb-3`} />
                <h3 className="font-bold text-gray-900 dark:text-gray-100 mb-2">{title}</h3>
                <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Research & Academic Background */}
        <section>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-4 flex items-center gap-2"><BookOpen className="w-6 h-6 text-blue-500" /> Research Background</h2>
          <div className="bg-white dark:bg-gray-900 rounded-2xl p-6 shadow-sm border border-gray-100 dark:border-gray-800 space-y-4">
            <p className="text-gray-700 dark:text-gray-300 leading-relaxed">
              AEGIS was developed as the capstone honours project for <strong>CM4134 — Advanced Software Engineering with AI</strong> at <strong>Robert Gordon University (RGU)</strong>, Aberdeen, Scotland.
            </p>
            <p className="text-gray-700 dark:text-gray-300 leading-relaxed">
              The project draws on academic literature in crisis informatics, public early warning systems, geospatial data integration, and human-computer interaction under stress. Key academic influences include the Sendai Framework for Disaster Risk Reduction (2015–2030), the UN's guidance on inclusive disaster communication, and FEMA's Community Resilience Planning Guide.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-4 pt-4 border-t border-gray-100 dark:border-gray-800">
              {[
                { label: 'Institution', value: 'Robert Gordon University' },
                { label: 'Module', value: 'CM4134 Honours Project' },
                { label: 'Location', value: 'Aberdeen, Scotland' },
              ].map(({ label, value }) => (
                <div key={label}>
                  <p className="text-xs text-gray-400 uppercase tracking-wider font-medium">{label}</p>
                  <p className="font-semibold text-gray-800 dark:text-gray-200 mt-0.5">{value}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Technology */}
        <section>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-4">Technology Stack</h2>
          <div className="bg-white dark:bg-gray-900 rounded-2xl p-6 shadow-sm border border-gray-100 dark:border-gray-800">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {[
                { label: 'Frontend', tech: 'React 18 + TypeScript + Vite' },
                { label: 'Styling', tech: 'Tailwind CSS + Custom Design System' },
                { label: 'Backend', tech: 'Node.js + Express + PostgreSQL' },
                { label: 'AI Engine', tech: 'Python + FastAPI + scikit-learn' },
                { label: 'Live Data', tech: 'SEPA KiWIS, EA Flood API, Open-Meteo' },
                { label: 'Mapping', tech: 'Geospatial GeoJSON APIs' },
                { label: 'Push Alerts', tech: 'Web Push (VAPID)' },
                { label: 'Offline', tech: 'Service Worker + PWA' },
              ].map(({ label, tech }) => (
                <div key={label} className="text-sm">
                  <p className="text-[11px] text-gray-400 uppercase tracking-wider font-medium mb-0.5">{label}</p>
                  <p className="text-gray-700 dark:text-gray-300 font-medium text-sm">{tech}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Contact */}
        <section>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-4">Contact</h2>
          <div className="bg-white dark:bg-gray-900 rounded-2xl p-6 shadow-sm border border-gray-100 dark:border-gray-800">
            <p className="text-gray-700 dark:text-gray-300 mb-4">AEGIS is an academic research project. For all enquiries regarding the platform, data sources, or collaboration opportunities:</p>
            <dl className="space-y-2 text-sm">
              <div className="flex gap-3"><dt className="font-semibold text-gray-500 w-24 flex-shrink-0">Institution</dt><dd className="text-gray-700 dark:text-gray-300">Robert Gordon University, Aberdeen</dd></div>
              <div className="flex gap-3"><dt className="font-semibold text-gray-500 w-24 flex-shrink-0">Module</dt><dd className="text-gray-700 dark:text-gray-300">CM4134 — Honours Project</dd></div>
              <div className="flex gap-3"><dt className="font-semibold text-gray-500 w-24 flex-shrink-0">Location</dt><dd className="text-gray-700 dark:text-gray-300">Garthdee Campus, Aberdeen, AB10 7QB</dd></div>
            </dl>
          </div>
        </section>

        {/* Footer nav */}
        <div className="flex flex-wrap gap-4 text-sm justify-center pt-4 border-t border-gray-200 dark:border-gray-800">
          <Link to="/citizen" className="text-aegis-600 hover:underline">← Back to Dashboard</Link>
          <Link to="/privacy" className="text-gray-500 hover:text-aegis-600">Privacy Policy</Link>
          <Link to="/terms" className="text-gray-500 hover:text-aegis-600">Terms of Use</Link>
          <Link to="/accessibility" className="text-gray-500 hover:text-aegis-600">Accessibility</Link>
        </div>
      </div>
    </div>
  )
}
