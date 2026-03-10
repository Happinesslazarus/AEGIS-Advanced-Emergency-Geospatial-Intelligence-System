import { Routes, Route, Navigate } from 'react-router-dom'
import { ThemeProvider } from './contexts/ThemeContext'
import { LocationProvider } from './contexts/LocationContext'
import { ReportsProvider } from './contexts/ReportsContext'
import { AlertsProvider } from './contexts/AlertsContext'
import { CitizenAuthProvider } from './contexts/CitizenAuthContext'
import { IncidentProvider } from './contexts/IncidentContext'
import ErrorBoundary from './components/shared/ErrorBoundary'
import CitizenPage from './pages/CitizenPage'
import CitizenAuthPage from './pages/CitizenAuthPage'
import CitizenDashboard from './pages/CitizenDashboard'
import AdminPage from './pages/AdminPage'
import LandingPage from './pages/LandingPage'
import AboutPage from './pages/AboutPage'
import PrivacyPage from './pages/PrivacyPage'
import TermsPage from './pages/TermsPage'
import AccessibilityPage from './pages/AccessibilityPage'
import GuestDashboard from './pages/GuestDashboard'
import AccessibilityPanel from './components/shared/AccessibilityPanel'
import FloatingChatWidget from './components/FloatingChatWidget'
import LanguagePreferenceDialog from './components/shared/LanguagePreferenceDialog'
import OfflineIndicator from './components/shared/OfflineIndicator'

export default function App(): JSX.Element {
  return (
    <ErrorBoundary name="App">
      <ThemeProvider>
        <LocationProvider>
          <ReportsProvider>
            <AlertsProvider>
              <CitizenAuthProvider>
                <IncidentProvider>
                  <Routes>
                    <Route path="/" element={<LandingPage />} />
                    <Route path="/citizen/login" element={<CitizenAuthPage />} />
                    <Route path="/citizen/dashboard" element={<CitizenDashboard />} />
                    <Route path="/citizen/*" element={<CitizenPage />} />
                    <Route path="/admin/*" element={<AdminPage />} />
                    <Route path="/about" element={<AboutPage />} />
                    <Route path="/privacy" element={<PrivacyPage />} />
                    <Route path="/terms" element={<TermsPage />} />
                    <Route path="/accessibility" element={<AccessibilityPage />} />
                    <Route path="*" element={<Navigate to="/" replace />} />
                  </Routes>
                  <LanguagePreferenceDialog />
                  <AccessibilityPanel />
                  <FloatingChatWidget />
                  <OfflineIndicator />
                </IncidentProvider>
              </CitizenAuthProvider>
            </AlertsProvider>
          </ReportsProvider>
        </LocationProvider>
      </ThemeProvider>
    </ErrorBoundary>
  )
}
