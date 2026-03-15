import { Link } from 'react-router-dom'
import { Eye, ArrowLeft, CheckCircle, AlertTriangle, Globe, Volume2, Monitor, Smartphone } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { t } from '../utils/i18n'
import { useLanguage } from '../hooks/useLanguage'

const Section = ({ title, icon: Icon, children }: { title: string; icon: React.ElementType; children: React.ReactNode }) => (
  <section className="bg-white dark:bg-gray-900 rounded-2xl p-6 shadow-sm border border-gray-100 dark:border-gray-800">
    <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100 mb-3 flex items-center gap-2"><Icon className="w-5 h-5 text-aegis-500" />{title}</h2>
    <div className="text-sm text-gray-700 dark:text-gray-300 dark:text-gray-300 space-y-3 leading-relaxed">{children}</div>
  </section>
)

export default function AccessibilityPage(): JSX.Element {
  const { t: rt } = useTranslation('common')
  const lang = useLanguage()
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <div className="bg-gradient-to-r from-aegis-800 to-blue-800 text-white py-12 px-6">
        <div className="max-w-3xl mx-auto">
          <Link to="/citizen" className="inline-flex items-center gap-2 text-white/70 hover:text-white text-sm mb-6 transition-colors"><ArrowLeft className="w-4 h-4" /> {t('a11yPage.backToAegis', lang)}</Link>
          <div className="flex items-center gap-3 mb-3"><Eye className="w-7 h-7 text-blue-300" /><h1 className="text-2xl font-bold">{t('a11yPage.title', lang)}</h1></div>
          <p className="text-aegis-200 text-sm">{t('a11yPage.lastReviewed', lang)}</p>
          <p className="text-white/80 text-sm mt-2">{t('a11yPage.intro', lang)}</p>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-6 py-10 space-y-6">

        <Section title={t('a11yPage.s1.title', lang)} icon={CheckCircle}>
          <p dangerouslySetInnerHTML={{ __html: t('a11yPage.s1.p1', lang) }} />
          <p dangerouslySetInnerHTML={{ __html: t('a11yPage.s1.p2', lang) }} />
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-2">
            {[
              { label: t('a11yPage.s1.perceivable', lang), status: t('a11yPage.s1.good', lang), detail: t('a11yPage.s1.perceivableDetail', lang) },
              { label: t('a11yPage.s1.operable', lang), status: t('a11yPage.s1.good', lang), detail: t('a11yPage.s1.operableDetail', lang) },
              { label: t('a11yPage.s1.understandable', lang), status: t('a11yPage.s1.partial', lang), detail: t('a11yPage.s1.understandableDetail', lang) },
              { label: t('a11yPage.s1.robust', lang), status: t('a11yPage.s1.good', lang), detail: t('a11yPage.s1.robustDetail', lang) },
            ].map(({ label, status, detail }) => (
              <div key={label} className="bg-gray-50 dark:bg-gray-800 rounded-xl p-3 text-center">
                <p className="font-bold text-xs mb-1">{label}</p>
                <p className="text-xs font-semibold mb-1">{status}</p>
                <p className="text-[10px] text-gray-500 dark:text-gray-500 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300">{detail}</p>
              </div>
            ))}
          </div>
        </Section>

        <Section title={t('a11yPage.s2.title', lang)} icon={Globe}>
          <p dangerouslySetInnerHTML={{ __html: t('a11yPage.s2.p1', lang) }} />
          <div className="flex flex-wrap gap-2 mt-2">
            {[
              t('a11yPage.s2.english', lang), t('a11yPage.s2.gaelic', lang), t('a11yPage.s2.welsh', lang),
              t('a11yPage.s2.french', lang), t('a11yPage.s2.spanish', lang), t('a11yPage.s2.arabic', lang),
              t('a11yPage.s2.chinese', lang), t('a11yPage.s2.hindi', lang), t('a11yPage.s2.portuguese', lang),
              t('a11yPage.s2.polish', lang), t('a11yPage.s2.urdu', lang), t('a11yPage.s2.moreComing', lang),
            ].map(l => (
              <span key={l} className="bg-aegis-50 dark:bg-aegis-950/30 text-aegis-700 dark:text-aegis-300 text-xs px-2.5 py-1 rounded-full border border-aegis-200 dark:border-aegis-800">{l}</span>
            ))}
          </div>
          <p className="mt-3">{t('a11yPage.s2.rtl', lang)}</p>
        </Section>

        <Section title={t('a11yPage.s3.title', lang)} icon={Eye}>
          <ul className="list-disc pl-5 space-y-1.5">
            <li dangerouslySetInnerHTML={{ __html: t('a11yPage.s3.li1', lang) }} />
            <li dangerouslySetInnerHTML={{ __html: t('a11yPage.s3.li2', lang) }} />
            <li dangerouslySetInnerHTML={{ __html: t('a11yPage.s3.li3', lang) }} />
            <li dangerouslySetInnerHTML={{ __html: t('a11yPage.s3.li4', lang) }} />
            <li dangerouslySetInnerHTML={{ __html: t('a11yPage.s3.li5', lang) }} />
          </ul>
        </Section>

        <Section title={t('a11yPage.s4.title', lang)} icon={Monitor}>
          <ul className="list-disc pl-5 space-y-1.5">
            <li dangerouslySetInnerHTML={{ __html: t('a11yPage.s4.li1', lang) }} />
            <li dangerouslySetInnerHTML={{ __html: t('a11yPage.s4.li2', lang) }} />
            <li dangerouslySetInnerHTML={{ __html: t('a11yPage.s4.li3', lang) }} />
            <li dangerouslySetInnerHTML={{ __html: t('a11yPage.s4.li4', lang) }} />
            <li dangerouslySetInnerHTML={{ __html: t('a11yPage.s4.li5', lang) }} />
          </ul>
        </Section>

        <Section title={t('a11yPage.s5.title', lang)} icon={Volume2}>
          <ul className="list-disc pl-5 space-y-1.5">
            <li>{t('a11yPage.s5.li1', lang)}</li>
            <li>{t('a11yPage.s5.li2', lang)}</li>
            <li>{t('a11yPage.s5.li3', lang)}</li>
            <li>{t('a11yPage.s5.li4', lang)}</li>
            <li>{t('a11yPage.s5.li5', lang)}</li>
          </ul>
        </Section>

        <Section title={t('a11yPage.s6.title', lang)} icon={Smartphone}>
          <ul className="list-disc pl-5 space-y-1.5">
            <li>{t('a11yPage.s6.li1', lang)}</li>
            <li>{t('a11yPage.s6.li2', lang)}</li>
            <li>{t('a11yPage.s6.li3', lang)}</li>
            <li>{t('a11yPage.s6.li4', lang)}</li>
            <li>{t('a11yPage.s6.li5', lang)}</li>
          </ul>
        </Section>

        <Section title={t('a11yPage.s7.title', lang)} icon={AlertTriangle}>
          <ul className="list-disc pl-5 space-y-1.5">
            <li>{t('a11yPage.s7.li1', lang)}</li>
            <li>{t('a11yPage.s7.li2', lang)}</li>
            <li>{t('a11yPage.s7.li3', lang)}</li>
            <li>{t('a11yPage.s7.li4', lang)}</li>
          </ul>
        </Section>

        <Section title={t('a11yPage.s8.title', lang)} icon={CheckCircle}>
          <p>{t('a11yPage.s8.p1', lang)}</p>
          <p dangerouslySetInnerHTML={{ __html: t('a11yPage.s8.p2', lang) }} />
          <p dangerouslySetInnerHTML={{ __html: t('a11yPage.s8.p3', lang) }} />
          <p className="mt-2 text-gray-500 dark:text-gray-500 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300" dangerouslySetInnerHTML={{ __html: t('a11yPage.s8.p4', lang) }} />
        </Section>

        <div className="flex flex-wrap gap-4 text-sm justify-center pt-4 border-t border-gray-200 dark:border-gray-800">
          <Link to="/citizen" className="text-aegis-600 hover:underline">{t('a11yPage.backToDashboard', lang)}</Link>
          <Link to="/about" className="text-gray-500 dark:text-gray-500 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 hover:text-aegis-600 dark:hover:text-aegis-400">{t('a11yPage.aboutAegis', lang)}</Link>
          <Link to="/privacy" className="text-gray-500 dark:text-gray-500 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 hover:text-aegis-600 dark:hover:text-aegis-400">{t('a11yPage.privacyPolicy', lang)}</Link>
          <Link to="/terms" className="text-gray-500 dark:text-gray-500 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 hover:text-aegis-600 dark:hover:text-aegis-400">{t('a11yPage.termsOfUse', lang)}</Link>
        </div>
      </div>
    </div>
  )
}



