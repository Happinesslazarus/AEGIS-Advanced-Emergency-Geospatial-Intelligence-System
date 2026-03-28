import { Routes, Route, Navigate } from 'react-router-dom'
import { useEffect, lazy, Suspense } from 'react'
import { useTranslation } from 'react-i18next'
import { ThemeProvider } from './contexts/ThemeContext'
import { LocationProvider } from './contexts/LocationContext'
import { RegionProvider } from './contexts/RegionContext'
import { ReportsProvider } from './contexts/ReportsContext'
import { AlertsProvider } from './contexts/AlertsContext'
import { CitizenAuthProvider } from './contexts/CitizenAuthContext'
import { IncidentProvider } from './contexts/IncidentContext'
import { SocketProvider } from './contexts/SocketContext'
import ErrorBoundary from './components/shared/ErrorBoundary'
import { useErrorMonitor } from './hooks/useErrorMonitor'
import { SkeletonCard } from './components/ui/Skeleton'
const CitizenPage = lazy(() => import('./pages/CitizenPage'))
const CitizenAuthPage = lazy(() => import('./pages/CitizenAuthPage'))
const CitizenDashboard = lazy(() => import('./pages/CitizenDashboard'))
const AdminPage = lazy(() => import('./pages/AdminPage'))
const LandingPage = lazy(() => import('./pages/LandingPage'))
const AboutPage = lazy(() => import('./pages/AboutPage'))
const PrivacyPage = lazy(() => import('./pages/PrivacyPage'))
const TermsPage = lazy(() => import('./pages/TermsPage'))
const AccessibilityPage = lazy(() => import('./pages/AccessibilityPage'))
const AlertsPage = lazy(() => import('./pages/AlertsPage'))
const CreatorPage = lazy(() => import('./pages/CreatorPage'))
const GuestDashboard = lazy(() => import('./pages/GuestDashboard'))
const NotFoundPage = lazy(() => import('./pages/NotFoundPage'))
import AccessibilityPanel from './components/shared/AccessibilityPanel'
import FloatingChatWidget from './components/FloatingChatWidget'
import LanguagePreferenceDialog from './components/shared/LanguagePreferenceDialog'
import OfflineIndicator from './components/shared/OfflineIndicator'
import CookieConsent from './components/shared/CookieConsent'
import { SUPPORTED_LANGUAGES } from './i18n/config'

/* Synchronises document dir/lang attributes with the active i18next language. */
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

/* Branded loading fallback for route-level Suspense. */
function SuspenseFallback() {
  return (
    <div className="min-h-screen bg-white dark:bg-gray-950 flex items-center justify-center p-8">
      <div className="w-full max-w-md space-y-4">
        <SkeletonCard />
        <SkeletonCard />
      </div>
    </div>
  )
}

export default function App(): JSX.Element {
  useErrorMonitor()

  return (
    <ErrorBoundary name="App" fullPage>
      <RtlEnforcer />
      <ThemeProvider>
        <SocketProvider>
          <LocationProvider>
            <RegionProvider>
            <CitizenAuthProvider>
            <ReportsProvider>
              <AlertsProvider>
                  <IncidentProvider>
                    <Suspense fallback={<SuspenseFallback />}>
                      <Routes>
                        <Route path="/" element={<LandingPage />} />
                        <Route path="/citizen/login" element={<CitizenAuthPage />} />
                        <Route path="/citizen/dashboard" element={
                          <ErrorBoundary name="CitizenDashboard">
                            <CitizenDashboard />
                          </ErrorBoundary>
                        } />
                        <Route path="/citizen/*" element={
                          <ErrorBoundary name="CitizenPortal">
                            <CitizenPage />
                          </ErrorBoundary>
                        } />
                        <Route path="/admin/*" element={
                          <ErrorBoundary name="AdminPanel">
                            <AdminPage />
                          </ErrorBoundary>
                        } />
                        <Route path="/guest" element={
                          <ErrorBoundary name="GuestDashboard">
                            <GuestDashboard />
                          </ErrorBoundary>
                        } />
                        <Route path="/about" element={<AboutPage />} />
                        <Route path="/creator" element={<CreatorPage />} />
                        <Route path="/privacy" element={<PrivacyPage />} />
                        <Route path="/terms" element={<TermsPage />} />
                        <Route path="/accessibility" element={<AccessibilityPage />} />
                        <Route path="/alerts" element={<AlertsPage />} />
                        <Route path="*" element={<NotFoundPage />} />
                      </Routes>
                    </Suspense>
                  <LanguagePreferenceDialog />
                  <AccessibilityPanel />
                  <FloatingChatWidget />
                  <OfflineIndicator />
                  <CookieConsent />
                  </IncidentProvider>
              </AlertsProvider>
            </ReportsProvider>
            </CitizenAuthProvider>
            </RegionProvider>
          </LocationProvider>
        </SocketProvider>
      </ThemeProvider>
    </ErrorBoundary>
  )
}

