import { Link } from 'react-router-dom'
import { Lock, ArrowLeft } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { t } from '../utils/i18n'
import { useLanguage } from '../hooks/useLanguage'

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className="bg-white dark:bg-gray-900 rounded-2xl p-6 shadow-sm border border-gray-100 dark:border-gray-800">
    <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100 mb-3">{title}</h2>
    <div className="text-sm text-gray-700 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 space-y-3 leading-relaxed">{children}</div>
  </section>
)

export default function PrivacyPage(): JSX.Element {
  const { t: rt } = useTranslation('common')
  const lang = useLanguage()
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <div className="bg-gradient-to-r from-gray-900 to-gray-800 text-white py-12 px-6">
        <div className="max-w-3xl mx-auto">
          <Link to="/citizen" className="inline-flex items-center gap-2 text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 hover:text-white text-sm mb-6 transition-colors"><ArrowLeft className="w-4 h-4" /> {t('privacy.backToAegis', lang)}</Link>
          <div className="flex items-center gap-3 mb-3"><Lock className="w-7 h-7 text-blue-400" /><h1 className="text-2xl font-bold">{t('privacy.title', lang)}</h1></div>
          <p className="text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 text-sm">{t('privacy.lastUpdated', lang)}</p>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-6 py-10 space-y-6">
        <Section title={t('privacy.s1.title', lang)}>
          <p>{t('privacy.s1.p1', lang)}</p>
          <p>{t('privacy.s1.p2', lang)}</p>
        </Section>

        <Section title={t('privacy.s2.title', lang)}>
          <p dangerouslySetInnerHTML={{ __html: t('privacy.s2.voluntary', lang) }} />
          <ul className="list-disc pl-5 space-y-1">
            <li>{t('privacy.s2.vol1', lang)}</li>
            <li>{t('privacy.s2.vol2', lang)}</li>
            <li>{t('privacy.s2.vol3', lang)}</li>
          </ul>
          <p dangerouslySetInnerHTML={{ __html: t('privacy.s2.automatic', lang) }} />
          <ul className="list-disc pl-5 space-y-1">
            <li>{t('privacy.s2.auto1', lang)}</li>
            <li>{t('privacy.s2.auto2', lang)}</li>
            <li>{t('privacy.s2.auto3', lang)}</li>
          </ul>
          <p dangerouslySetInnerHTML={{ __html: t('privacy.s2.local', lang) }} />
          <ul className="list-disc pl-5 space-y-1">
            <li>{t('privacy.s2.local1', lang)}</li>
            <li>{t('privacy.s2.local2', lang)}</li>
            <li>{t('privacy.s2.local3', lang)}</li>
            <li>{t('privacy.s2.local4', lang)}</li>
          </ul>
        </Section>

        <Section title={t('privacy.s3.title', lang)}>
          <ul className="list-disc pl-5 space-y-1">
            <li>{t('privacy.s3.li1', lang)}</li>
            <li>{t('privacy.s3.li2', lang)}</li>
            <li>{t('privacy.s3.li3', lang)}</li>
            <li>{t('privacy.s3.li4', lang)}</li>
            <li>{t('privacy.s3.li5', lang)}</li>
          </ul>
        </Section>

        <Section title={t('privacy.s4.title', lang)}>
          <p>{t('privacy.s4.p1', lang)}</p>
          <ul className="list-disc pl-5 space-y-1">
            <li dangerouslySetInnerHTML={{ __html: t('privacy.s4.li1', lang) }} />
            <li dangerouslySetInnerHTML={{ __html: t('privacy.s4.li2', lang) }} />
            <li dangerouslySetInnerHTML={{ __html: t('privacy.s4.li3', lang) }} />
          </ul>
        </Section>

        <Section title={t('privacy.s5.title', lang)}>
          <p>{t('privacy.s5.p1', lang)}</p>
          <ul className="list-disc pl-5 space-y-1">
            <li dangerouslySetInnerHTML={{ __html: t('privacy.s5.li1', lang) }} />
            <li dangerouslySetInnerHTML={{ __html: t('privacy.s5.li2', lang) }} />
            <li dangerouslySetInnerHTML={{ __html: t('privacy.s5.li3', lang) }} />
          </ul>
        </Section>

        <Section title={t('privacy.s6.title', lang)}>
          <ul className="list-disc pl-5 space-y-1">
            <li>{t('privacy.s6.li1', lang)}</li>
            <li>{t('privacy.s6.li2', lang)}</li>
            <li>{t('privacy.s6.li3', lang)}</li>
          </ul>
        </Section>

        <Section title={t('privacy.s7.title', lang)}>
          <p>{t('privacy.s7.p1', lang)}</p>
          <ul className="list-disc pl-5 space-y-1">
            <li dangerouslySetInnerHTML={{ __html: t('privacy.s7.li1', lang) }} />
            <li dangerouslySetInnerHTML={{ __html: t('privacy.s7.li2', lang) }} />
            <li dangerouslySetInnerHTML={{ __html: t('privacy.s7.li3', lang) }} />
            <li dangerouslySetInnerHTML={{ __html: t('privacy.s7.li4', lang) }} />
            <li dangerouslySetInnerHTML={{ __html: t('privacy.s7.li5', lang) }} />
            <li dangerouslySetInnerHTML={{ __html: t('privacy.s7.li6', lang) }} />
          </ul>
          <p>{t('privacy.s7.contact', lang)}</p>
        </Section>

        <Section title={t('privacy.s8.title', lang)}>
          <p dangerouslySetInnerHTML={{ __html: t('privacy.s8.p1', lang) }} />
          <p>{t('privacy.s8.p2', lang)}</p>
        </Section>

        <Section title={t('privacy.s9.title', lang)}>
          <p>{t('privacy.s9.p1', lang)}</p>
          <p>{t('privacy.s9.p2', lang)}</p>
        </Section>

        <Section title={t('privacy.s10.title', lang)}>
          <p>{t('privacy.s10.p1', lang)}</p>
        </Section>

        <div className="flex flex-wrap gap-4 text-sm justify-center pt-4 border-t border-gray-200 dark:border-gray-800">
          <Link to="/citizen" className="text-aegis-600 hover:underline">{t('privacy.backToDashboard', lang)}</Link>
          <Link to="/about" className="text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 hover:text-aegis-600 dark:hover:text-aegis-400">{t('privacy.aboutAegis', lang)}</Link>
          <Link to="/terms" className="text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 hover:text-aegis-600 dark:hover:text-aegis-400">{t('privacy.termsOfUse', lang)}</Link>
          <Link to="/accessibility" className="text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 hover:text-aegis-600 dark:hover:text-aegis-400">{t('privacy.accessibility', lang)}</Link>
        </div>
      </div>
    </div>
  )
}




