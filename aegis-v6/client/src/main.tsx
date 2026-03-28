import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import * as Sentry from '@sentry/react'
import App from './App'
import './i18n/config' // Initialize i18next before rendering
import './styles/globals.css'

// Sentry Error Tracking (only when DSN is configured)
const sentryDsn = import.meta.env.VITE_SENTRY_DSN
if (sentryDsn) {
  Sentry.init({
    dsn: sentryDsn,
    environment: import.meta.env.MODE,
    release: `aegis-client@6.9.0`,
    tracesSampleRate: import.meta.env.PROD ? 0.1 : 1.0,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: import.meta.env.PROD ? 0.5 : 0,
    initialScope: { tags: { service: 'client' } },
  })
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <App />
    </BrowserRouter>
  </React.StrictMode>
)

// PWA Service Worker
if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    const isProd = import.meta.env.PROD

    if (isProd) {
      navigator.serviceWorker.register('/sw.js').catch(() => {})
      return
    }

    // In development, always unregister SW to avoid stale caches / hard-refresh-only fixes.
    try {
      const regs = await navigator.serviceWorker.getRegistrations()
      await Promise.all(regs.map((r) => r.unregister()))
      if ('caches' in window) {
        const keys = await caches.keys()
        await Promise.all(keys.map((k) => caches.delete(k)))
      }
      // // console.log('[SW] Development mode: service workers and caches cleared')
    } catch {
      // no-op
    }
  })
}
