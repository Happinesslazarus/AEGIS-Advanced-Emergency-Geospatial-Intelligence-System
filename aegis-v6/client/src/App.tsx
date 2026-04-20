/**
 * The root React component. Defines every client-side URL route, wraps the
 * whole app in the global Context provider tree (auth, socket, alerts, theme,
 * etc.), and renders persistent UI layers (chat widget, cookie banner, offline
 * indicator, accessibility panel) that should be visible on every page.
 *
 * - Rendered by client/src/main.tsx (mounted into #root div)
 * - Wraps children in client/src/contexts/AppProviders.tsx (all Context providers)
 * - All pages are lazy-loaded (code-split by Vite) for faster initial load
 * - Route protection comes from client/src/components/shared/RouteGuards.tsx
 * - RTL language support handled by RtlEnforcer() inside this file
 *
 * Key routes:
 * /                    -- LandingPage
 * /citizen             -- CitizenPage (public safety map)
 * /citizen/auth        -- CitizenAuthPage (citizen login/signup)
 * /citizen/dashboard   -- CitizenDashboard (authenticated citizen view)
 * /admin               -- AdminPage (operator / admin dashboard)
 * /alerts              -- AlertsPage (live alert feed)
 * /guest               -- GuestDashboard (read-only view without login)
 *
 * - client/src/contexts/AppProviders.tsx      -- all Context providers in one place
 * - client/src/components/shared/RouteGuards.tsx -- role-based route protection
 * - client/src/pages/AdminPage.tsx            -- the main operator dashboard
 * - client/src/pages/CitizenDashboard.tsx     -- the citizen safety dashboard
 * - client/src/components/FloatingChatWidget  -- the persistent chat button/panel
 * */

import { Routes, Route } from 'react-router-dom'
import { useEffect, lazy, Suspense } from 'react'
import { useTranslation } from 'react-i18next'
import { AppProviders } from './contexts/AppProviders'
import ErrorBoundary from './components/shared/ErrorBoundary'
import { useErrorMonitor } from './hooks/useErrorMonitor'
import { useOfflinePrefetch } from './hooks/useOfflinePrefetch'
import { SkeletonCard } from './components/ui/Skeleton'
import PageTransition from './components/ui/PageTransition'
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
const OAuthCallback = lazy(() => import('./pages/OAuthCallback'))
const QRAuthPage = lazy(() => import('./pages/QRAuthPage'))
import AccessibilityPanel from './components/shared/AccessibilityPanel'
import CitizenPreferencesBridge from './components/shared/CitizenPreferencesBridge'
import FloatingChatWidget from './components/FloatingChatWidget'
import ScrollFab from './components/shared/ScrollFab'
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

/** Warms the React Query cache with critical safety data on first load. */
function OfflineCacheWarmer(): null {
  useOfflinePrefetch()
  return null
}

export default function App(): JSX.Element {
  useErrorMonitor()

  return (
    <ErrorBoundary name="App" fullPage>
      <AppProviders>
        <RtlEnforcer />
        <OfflineCacheWarmer />
        <CitizenPreferencesBridge />
        <Suspense fallback={<SuspenseFallback />}>
          <PageTransition>
            <Routes>
              <Route path="/" element={<LandingPage />} />
              <Route path="/citizen/login" element={<CitizenAuthPage />} />
              <Route path="/citizen/auth" element={<CitizenAuthPage />} />
              <Route path="/citizen/oauth/callback" element={<OAuthCallback />} />
              <Route path="/citizen/qr-auth" element={<QRAuthPage />} />
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
          </PageTransition>
        </Suspense>
        <LanguagePreferenceDialog />
        <AccessibilityPanel />
        <FloatingChatWidget />
        <ScrollFab />
        <OfflineIndicator />
        <CookieConsent />
      </AppProviders>
    </ErrorBoundary>
  )
}

