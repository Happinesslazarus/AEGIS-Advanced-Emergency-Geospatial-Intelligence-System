import { Routes, Route, Navigate } from 'react-router-dom'
import { useEffect, lazy, Suspense } from 'react'
import { useTranslation } from 'react-i18next'
import { ThemeProvider } from './contexts/ThemeContext'
import { LocationProvider } from './contexts/LocationContext'
import { ReportsProvider } from './contexts/ReportsContext'
import { AlertsProvider } from './contexts/AlertsContext'
import { CitizenAuthProvider } from './contexts/CitizenAuthContext'
import { IncidentProvider } from './contexts/IncidentContext'
import { SocketProvider } from './contexts/SocketContext'
import ErrorBoundary from './components/shared/ErrorBoundary'
const CitizenPage = lazy(() => import('./pages/CitizenPage'))
const CitizenAuthPage = lazy(() => import('./pages/CitizenAuthPage'))
const CitizenDashboard = lazy(() => import('./pages/CitizenDashboard'))
const AdminPage = lazy(() => import('./pages/AdminPage'))
const LandingPage = lazy(() => import('./pages/LandingPage'))
const AboutPage = lazy(() => import('./pages/AboutPage'))
const PrivacyPage = lazy(() => import('./pages/PrivacyPage'))
const TermsPage = lazy(() => import('./pages/TermsPage'))
const AccessibilityPage = lazy(() => import('./pages/AccessibilityPage'))
const GuestDashboard = lazy(() => import('./pages/GuestDashboard'))
import AccessibilityPanel from './components/shared/AccessibilityPanel'
import FloatingChatWidget from './components/FloatingChatWidget'
import LanguagePreferenceDialog from './components/shared/LanguagePreferenceDialog'
import OfflineIndicator from './components/shared/OfflineIndicator'
import { SUPPORTED_LANGUAGES } from './i18n/config'

/** Synchronises document dir/lang attributes with the active i18next language. */
function RtlEnforcer(): null {
  const { i18n } = useTranslation()
  useEffect(() => {
    const lang = SUPPORTED_LANGUAGES.find(l => l.code === i18n.language)
    const dir = lang?.dir ?? 'ltr'
    document.documentElement.setAttribute('dir', dir)
    document.documentElement.setAttribute('lang', i18n.language)
  }, [i18n.language])
  return null
}

export default function App(): JSX.Element {
  return (
    <ErrorBoundary name="App">
      <RtlEnforcer />
      <ThemeProvider>
        <SocketProvider>
          <LocationProvider>
            <ReportsProvider>
              <AlertsProvider>
                <CitizenAuthProvider>
                  <IncidentProvider>
                    <Suspense fallback={<div className="min-h-screen bg-white dark:bg-gray-950" />}>
                      <Routes>
                        <Route path="/" element={<LandingPage />} />
                        <Route path="/citizen/login" element={<CitizenAuthPage />} />
                        <Route path="/citizen/dashboard" element={<CitizenDashboard />} />
                        <Route path="/citizen/*" element={<CitizenPage />} />
                        <Route path="/admin/*" element={<AdminPage />} />
                        <Route path="/guest" element={<GuestDashboard />} />
                        <Route path="/about" element={<AboutPage />} />
                        <Route path="/privacy" element={<PrivacyPage />} />
                        <Route path="/terms" element={<TermsPage />} />
                        <Route path="/accessibility" element={<AccessibilityPage />} />
                        <Route path="*" element={<Navigate to="/" replace />} />
                      </Routes>
                    </Suspense>
                  <LanguagePreferenceDialog />
                  <AccessibilityPanel />
                  <FloatingChatWidget />
                  <OfflineIndicator />
                  </IncidentProvider>
                </CitizenAuthProvider>
              </AlertsProvider>
            </ReportsProvider>
          </LocationProvider>
        </SocketProvider>
      </ThemeProvider>
    </ErrorBoundary>
  )
}
