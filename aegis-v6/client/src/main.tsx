/**
 * File: main.tsx
 *
 * What this file does:
 * The React app entry point. Initialises Sentry error tracking, wraps the
 * app in React.StrictMode and BrowserRouter, then mounts the root component.
 * Also handles PWA service worker registration (or deliberate unregistration
 * in development so stale caches never cause confusion).
 *
 * How it connects:
 * - Renders client/src/App.tsx which defines all application routes
 * - Loads client/src/i18n/config.ts (i18next) before any components render
 * - Loads client/src/styles/globals.css (Tailwind base + custom globals)
 * - BrowserRouter is declared here so all child components can use useNavigate/useLocation
 * - Sentry is initialised here (client-side) to capture React render errors
 *
 * Learn more:
 * - client/src/App.tsx            — route definitions and global provider tree
 * - client/src/contexts/AppProviders.tsx — all React Context providers wrapped together
 * - client/src/i18n/config.ts     — language configuration for react-i18next
 * - client/src/styles/globals.css — global CSS, Tailwind variables, dark mode
 *
 * Simple explanation:
 * The very first file that runs in the browser. It sets up error tracking,
 * enables translations, registers or clears the service worker, then
 * renders the whole React app into the page.
 */

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

// Render the React app into the root div. BrowserRouter enables routing throughout the app.
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
