import { Link } from 'react-router-dom'
import { Shield, Users, Settings, ArrowRight } from 'lucide-react'
import { t } from '../utils/i18n'
import { useLanguage } from '../hooks/useLanguage'

export default function LandingPage(): JSX.Element {
  const lang = useLanguage()

  return (
    <div className="min-h-screen bg-gradient-to-br from-aegis-950 via-gray-900 to-aegis-900 flex items-center justify-center p-4">
      <div className="max-w-2xl w-full text-center animate-fade-in">
        <div className="flex justify-center mb-6">
          <div className="w-20 h-20 bg-aegis-600 rounded-2xl flex items-center justify-center shadow-lg shadow-aegis-600/30">
            <Shield className="w-12 h-12 text-white" />
          </div>
        </div>
        <h1 className="text-5xl font-bold text-white mb-3 font-display">{t('landing.hero.title', lang)}</h1>
        <p className="text-lg text-aegis-200 mb-2">{t('landing.hero.subtitle', lang)}</p>
        <p className="text-sm text-gray-400 mb-10 max-w-md mx-auto">
          {t('landing.hero.description', lang)}
        </p>
        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <Link to="/citizen" className="group bg-aegis-600 hover:bg-aegis-500 text-white px-8 py-4 rounded-xl font-semibold text-lg flex items-center justify-center gap-3 transition-all shadow-lg shadow-aegis-600/30">
            <Users className="w-6 h-6" /> {t('landing.cta.citizen', lang)} <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
          </Link>
          <Link to="/admin" className="group bg-gray-800 hover:bg-gray-700 text-white px-8 py-4 rounded-xl font-semibold text-lg flex items-center justify-center gap-3 transition-all border border-gray-700">
            <Settings className="w-6 h-6" /> {t('landing.cta.operator', lang)} <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
          </Link>
        </div>
        <p className="text-xs text-gray-500 mt-10">{t('landing.meta.projectCredit', lang)}</p>
      </div>
    </div>
  )
}
