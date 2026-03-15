import { Link } from 'react-router-dom'
import { Shield, Globe, Users, BookOpen, Heart, Award, ArrowLeft, Zap, Bell, Map } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { t } from '../utils/i18n'
import { useLanguage } from '../hooks/useLanguage'

export default function AboutPage(): JSX.Element {
  const { t: rt } = useTranslation('common')
  const lang = useLanguage()
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      {/* Hero */}
      <div className="bg-gradient-to-br from-aegis-800 via-aegis-700 to-blue-700 text-white py-16 px-6">
        <div className="max-w-4xl mx-auto">
          <Link to="/citizen" className="inline-flex items-center gap-2 text-white/70 hover:text-white text-sm mb-6 transition-colors">
            <ArrowLeft className="w-4 h-4" /> {t('about.backToAegis', lang)}
          </Link>
          <div className="flex items-center gap-4 mb-4">
            <div className="w-14 h-14 rounded-2xl bg-white/20 flex items-center justify-center">
              <Shield className="w-8 h-8 text-white" />
            </div>
            <div>
              <h1 className="text-3xl font-bold">{t('about.title', lang)}</h1>
              <p className="text-aegis-200 text-sm mt-0.5">{t('about.fullName', lang)}</p>
            </div>
          </div>
          <p className="text-lg text-white/90 max-w-2xl leading-relaxed">
            {t('about.heroDesc', lang)}
          </p>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-12 space-y-12">

        {/* Mission */}
        <section>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-4 flex items-center gap-2"><Heart className="w-6 h-6 text-red-500" /> {t('about.ourMission', lang)}</h2>
          <div className="bg-white dark:bg-gray-900 rounded-2xl p-6 shadow-sm border border-gray-100 dark:border-gray-800">
            <p className="text-gray-700 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 leading-relaxed mb-4">
              {t('about.missionP1', lang)}
            </p>
            <p className="text-gray-700 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 leading-relaxed">
              {t('about.missionP2', lang)}
            </p>
          </div>
        </section>

        {/* Key Features */}
        <section>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-4 flex items-center gap-2"><Zap className="w-6 h-6 text-amber-500" /> {t('about.keyFeatures', lang)}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {[
              { icon: Bell, title: t('about.feat.liveAlerts', lang), desc: t('about.feat.liveAlertsDesc', lang), color: 'text-red-500' },
              { icon: Map, title: t('about.feat.floodMonitoring', lang), desc: t('about.feat.floodMonitoringDesc', lang), color: 'text-blue-500' },
              { icon: Users, title: t('about.feat.communityReporting', lang), desc: t('about.feat.communityReportingDesc', lang), color: 'text-green-500' },
              { icon: BookOpen, title: t('about.feat.preparedness', lang), desc: t('about.feat.preparednessDesc', lang), color: 'text-purple-500' },
              { icon: Globe, title: t('about.feat.languages', lang), desc: t('about.feat.languagesDesc', lang), color: 'text-aegis-500' },
              { icon: Award, title: t('about.feat.aiAnalysis', lang), desc: t('about.feat.aiAnalysisDesc', lang), color: 'text-amber-500' },
            ].map(({ icon: Icon, title, desc, color }) => (
              <div key={title} className="bg-white dark:bg-gray-900 rounded-2xl p-5 shadow-sm border border-gray-100 dark:border-gray-800">
                <Icon className={`w-6 h-6 ${color} mb-3`} />
                <h3 className="font-bold text-gray-900 dark:text-gray-100 mb-2">{title}</h3>
                <p className="text-sm text-gray-600 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Research & Academic Background */}
        <section>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-4 flex items-center gap-2"><BookOpen className="w-6 h-6 text-blue-500" /> {t('about.researchBg', lang)}</h2>
          <div className="bg-white dark:bg-gray-900 rounded-2xl p-6 shadow-sm border border-gray-100 dark:border-gray-800 space-y-4">
            <p className="text-gray-700 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 leading-relaxed">
              {t('about.researchP1', lang)}
            </p>
            <p className="text-gray-700 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 leading-relaxed">
              {t('about.researchP2', lang)}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-4 pt-4 border-t border-gray-100 dark:border-gray-800">
              {[
                { label: t('about.institution', lang), value: t('about.institutionVal', lang) },
                { label: t('about.module', lang), value: t('about.moduleVal', lang) },
                { label: t('about.location', lang), value: t('about.locationVal', lang) },
              ].map(({ label, value }) => (
                <div key={label}>
                  <p className="text-xs text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 uppercase tracking-wider font-medium">{label}</p>
                  <p className="font-semibold text-gray-800 dark:text-gray-200 mt-0.5">{value}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Technology */}
        <section>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-4">{t('about.techStack', lang)}</h2>
          <div className="bg-white dark:bg-gray-900 rounded-2xl p-6 shadow-sm border border-gray-100 dark:border-gray-800">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {[
                { label: t('about.tech.frontend', lang), tech: 'React 18 + TypeScript + Vite' },
                { label: t('about.tech.styling', lang), tech: 'Tailwind CSS + Custom Design System' },
                { label: t('about.tech.backend', lang), tech: 'Node.js + Express + PostgreSQL' },
                { label: t('about.tech.aiEngine', lang), tech: 'Python + FastAPI + scikit-learn' },
                { label: t('about.tech.liveData', lang), tech: 'SEPA KiWIS, EA Flood API, Open-Meteo' },
                { label: t('about.tech.mapping', lang), tech: 'Geospatial GeoJSON APIs' },
                { label: t('about.tech.pushAlerts', lang), tech: 'Web Push (VAPID)' },
                { label: t('about.tech.offline', lang), tech: 'Service Worker + PWA' },
              ].map(({ label, tech }) => (
                <div key={label} className="text-sm">
                  <p className="text-[11px] text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 uppercase tracking-wider font-medium mb-0.5">{label}</p>
                  <p className="text-gray-700 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 font-medium text-sm">{tech}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Contact */}
        <section>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-4">{t('about.contact', lang)}</h2>
          <div className="bg-white dark:bg-gray-900 rounded-2xl p-6 shadow-sm border border-gray-100 dark:border-gray-800">
            <p className="text-gray-700 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 mb-4">{t('about.contactDesc', lang)}</p>
            <dl className="space-y-2 text-sm">
              <div className="flex gap-3"><dt className="font-semibold text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 w-24 flex-shrink-0">{t('about.institution', lang)}</dt><dd className="text-gray-700 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300">{t('about.contactInstitution', lang)}</dd></div>
              <div className="flex gap-3"><dt className="font-semibold text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 w-24 flex-shrink-0">{t('about.module', lang)}</dt><dd className="text-gray-700 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300">{t('about.contactModule', lang)}</dd></div>
              <div className="flex gap-3"><dt className="font-semibold text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 w-24 flex-shrink-0">{t('about.location', lang)}</dt><dd className="text-gray-700 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300">{t('about.contactLocation', lang)}</dd></div>
            </dl>
          </div>
        </section>

        {/* Footer nav */}
        <div className="flex flex-wrap gap-4 text-sm justify-center pt-4 border-t border-gray-200 dark:border-gray-800">
          <Link to="/citizen" className="text-aegis-600 hover:underline">{t('about.backToDashboard', lang)}</Link>
          <Link to="/privacy" className="text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 hover:text-aegis-600 dark:hover:text-aegis-400">{t('about.privacyPolicy', lang)}</Link>
          <Link to="/terms" className="text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 hover:text-aegis-600 dark:hover:text-aegis-400">{t('about.termsOfUse', lang)}</Link>
          <Link to="/accessibility" className="text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 hover:text-aegis-600 dark:hover:text-aegis-400">{t('about.accessibility', lang)}</Link>
        </div>
      </div>
    </div>
  )
}




