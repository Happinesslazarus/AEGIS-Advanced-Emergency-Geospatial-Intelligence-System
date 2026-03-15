import { Link } from 'react-router-dom'
import { FileText, ArrowLeft } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { t } from '../utils/i18n'
import { useLanguage } from '../hooks/useLanguage'

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className="bg-white dark:bg-gray-900 rounded-2xl p-6 shadow-sm border border-gray-100 dark:border-gray-800">
    <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100 mb-3">{title}</h2>
    <div className="text-sm text-gray-700 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 space-y-3 leading-relaxed">{children}</div>
  </section>
)

export default function TermsPage(): JSX.Element {
  const { t: rt } = useTranslation('common')
  const lang = useLanguage()
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <div className="bg-gradient-to-r from-gray-900 to-gray-800 text-white py-12 px-6">
        <div className="max-w-3xl mx-auto">
          <Link to="/citizen" className="inline-flex items-center gap-2 text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 hover:text-white text-sm mb-6 transition-colors"><ArrowLeft className="w-4 h-4" /> {t('terms.backToAegis', lang)}</Link>
          <div className="flex items-center gap-3 mb-3"><FileText className="w-7 h-7 text-blue-400" /><h1 className="text-2xl font-bold">{t('terms.title', lang)}</h1></div>
          <p className="text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 text-sm">{t('terms.lastUpdated', lang)}</p>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-6 py-10 space-y-6">
        <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-xl p-4 text-sm text-amber-800 dark:text-amber-200" dangerouslySetInnerHTML={{ __html: t('terms.important', lang) }} />

        <Section title={t('terms.s1.title', lang)}>
          <p>{t('terms.s1.p1', lang)}</p>
          <p>{t('terms.s1.p2', lang)}</p>
        </Section>

        <Section title={t('terms.s2.title', lang)}>
          <p>{t('terms.s2.intro', lang)}</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>{t('terms.s2.li1', lang)}</li>
            <li>{t('terms.s2.li2', lang)}</li>
            <li>{t('terms.s2.li3', lang)}</li>
            <li>{t('terms.s2.li4', lang)}</li>
          </ul>
          <p dangerouslySetInnerHTML={{ __html: t('terms.s2.disclaimer', lang) }} />
        </Section>

        <Section title={t('terms.s3.title', lang)}>
          <p>{t('terms.s3.intro', lang)}</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>{t('terms.s3.li1', lang)}</li>
            <li>{t('terms.s3.li2', lang)}</li>
            <li>{t('terms.s3.li3', lang)}</li>
            <li>{t('terms.s3.li4', lang)}</li>
            <li>{t('terms.s3.li5', lang)}</li>
            <li>{t('terms.s3.li6', lang)}</li>
            <li>{t('terms.s3.li7', lang)}</li>
          </ul>
          <p>{t('terms.s3.violations', lang)}</p>
        </Section>

        <Section title={t('terms.s4.title', lang)}>
          <p>{t('terms.s4.intro', lang)}</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>{t('terms.s4.li1', lang)}</li>
            <li>{t('terms.s4.li2', lang)}</li>
            <li>{t('terms.s4.li3', lang)}</li>
            <li>{t('terms.s4.li4', lang)}</li>
          </ul>
        </Section>

        <Section title={t('terms.s5.title', lang)}>
          <p>{t('terms.s5.p1', lang)}</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>{t('terms.s5.li1', lang)}</li>
            <li>{t('terms.s5.li2', lang)}</li>
            <li>{t('terms.s5.li3', lang)}</li>
          </ul>
          <p>{t('terms.s5.verify', lang)}</p>
        </Section>

        <Section title={t('terms.s6.title', lang)}>
          <p>{t('terms.s6.p1', lang)}</p>
          <p>{t('terms.s6.p2', lang)}</p>
        </Section>

        <Section title={t('terms.s7.title', lang)}>
          <p>{t('terms.s7.intro', lang)}</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>{t('terms.s7.li1', lang)}</li>
            <li>{t('terms.s7.li2', lang)}</li>
            <li>{t('terms.s7.li3', lang)}</li>
            <li>{t('terms.s7.li4', lang)}</li>
          </ul>
          <p>{t('terms.s7.asIs', lang)}</p>
        </Section>

        <Section title={t('terms.s8.title', lang)}>
          <p>{t('terms.s8.p1', lang)}</p>
        </Section>

        <Section title={t('terms.s9.title', lang)}>
          <p>{t('terms.s9.p1', lang)}</p>
        </Section>

        <Section title={t('terms.s10.title', lang)}>
          <p>{t('terms.s10.p1', lang)}</p>
        </Section>

        <div className="flex flex-wrap gap-4 text-sm justify-center pt-4 border-t border-gray-200 dark:border-gray-800">
          <Link to="/citizen" className="text-aegis-600 hover:underline">{t('terms.backToDashboard', lang)}</Link>
          <Link to="/about" className="text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 hover:text-aegis-600 dark:hover:text-aegis-400">{t('terms.aboutAegis', lang)}</Link>
          <Link to="/privacy" className="text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 hover:text-aegis-600 dark:hover:text-aegis-400">{t('terms.privacyPolicy', lang)}</Link>
          <Link to="/accessibility" className="text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 hover:text-aegis-600 dark:hover:text-aegis-400">{t('terms.accessibility', lang)}</Link>
        </div>
      </div>
    </div>
  )
}




