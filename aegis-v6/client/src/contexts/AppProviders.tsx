/**
 * Module: AppProviders.tsx
 *
 * App providers React context provider (shares state across components).
 *
 * - Wraps components in App.tsx via AppProviders */

import { type ReactNode, type ComponentType, type FC } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from '../lib/queryClient'
import { ThemeProvider } from './ThemeContext'
import { LocationProvider } from './LocationContext'
import { RegionProvider } from './RegionContext'
import { ReportsProvider } from './ReportsContext'
import { AlertsProvider } from './AlertsContext'
import { CitizenAuthProvider } from './CitizenAuthContext'
import { IncidentProvider } from './IncidentContext'
import { SocketProvider } from './SocketContext'
import { ToastProvider } from './ToastContext'

// PROVIDER COMPOSITION UTILITY

type ProviderComponent = ComponentType<{ children: ReactNode }>

/**
 * Composes multiple providers into a single component.
 * Providers are applied from left to right (first provider wraps outermost).
 * 
 * @example
 * const AppProviders = composeProviders([
 *   ThemeProvider,
 *   AuthProvider,
 *   DataProvider,
 * ])
 */
export function composeProviders(providers: ProviderComponent[]): FC<{ children: ReactNode }> {
  return function ComposedProviders({ children }: { children: ReactNode }) {
    // reduceRight iterates the array from RIGHT to LEFT, wrapping each
    // provider around the accumulated tree.  The last provider in the
    // array ends up as the INNERMOST wrapper (closest to the children),
    // and the first provider is the OUTERMOST (rendered first on screen).
    // Example: [A, B, C].reduceRight wraps as A > B > C > children
    return providers.reduceRight(
      (acc, Provider) => <Provider>{acc}</Provider>,
      children
    )
  }
}

// PROVIDER LAYERS

/**
 * Core providers that don't depend on other contexts.
 * These form the foundation of the app.
 */
const CoreProviders: ProviderComponent[] = [
  // Query client for data fetching
  ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
  // Theme (dark/light mode, color schemes)
  ThemeProvider,
  // WebSocket connection
  SocketProvider,
]

/**
 * Data providers that may depend on core providers.
 * Location and region are foundational for data filtering.
 */
const DataProviders: ProviderComponent[] = [
  // User's geographic location
  LocationProvider,
  // Active region configuration (UK, Scotland, etc.)
  RegionProvider,
]

/**
 * Feature providers that depend on core and data providers.
 * These provide domain-specific state management.
 */
const FeatureProviders: ProviderComponent[] = [
  // Citizen authentication state
  CitizenAuthProvider,
  // Emergency reports management
  ReportsProvider,
  // Alert/broadcast management
  AlertsProvider,
  // Incident lifecycle management
  IncidentProvider,
  // Global toast notifications
  ToastProvider,
]

// COMPOSED PROVIDER COMPONENT

/**
 * All application providers composed in the correct order.
 * 
 * Provider hierarchy (outermost to innermost):
 * 1. QueryClientProvider - React Query cache
 * 2. ThemeProvider - UI theme state
 * 3. SocketProvider - WebSocket connection
 * 4. LocationProvider - User location
 * 5. RegionProvider - Active region config
 * 6. CitizenAuthProvider - User auth state
 * 7. ReportsProvider - Reports state
 * 8. AlertsProvider - Alerts state
 * 9. IncidentProvider - Incident state
 */
const AllProviders = composeProviders([
  ...CoreProviders,
  ...DataProviders,
  ...FeatureProviders,
])

/**
 * Main app providers wrapper.
 * Use this in App.tsx to wrap all application routes.
 * 
 * @example
 * function App() {
 *   return (
 *     <AppProviders>
 *       <Routes>...</Routes>
 *     </AppProviders>
 *   )
 * }
 */
export function AppProviders({ children }: { children: ReactNode }): JSX.Element {
  return <AllProviders>{children}</AllProviders>
}

// SELECTIVE PROVIDER COMPOSITIONS

/**
 * Minimal providers for testing or lightweight components.
 * Includes only theme and location.
 */
export const MinimalProviders = composeProviders([
  ThemeProvider,
])

/**
 * Providers for the public/guest pages.
 * Doesn't include auth or admin-specific providers.
 */
export const PublicProviders = composeProviders([
  ...CoreProviders,
  ...DataProviders,
  AlertsProvider,
])

/**
 * Providers for citizen-facing pages.
 * Includes auth but not full admin capabilities.
 */
export const CitizenProviders = composeProviders([
  ...CoreProviders,
  ...DataProviders,
  CitizenAuthProvider,
  ReportsProvider,
  AlertsProvider,
])

// PROVIDER DEBUGGING (development only)

/**
 * Debug wrapper that logs when providers mount/unmount.
 * Only active in development mode.
 */
export function withProviderDebug<P extends object>(
  Provider: ComponentType<P>,
  name: string
): ComponentType<P> {
  if (process.env.NODE_ENV !== 'development') {
    return Provider
  }
  
  return function DebugProvider(props: P) {
    console.log(`[Provider] ${name} mounting`)
    return <Provider {...props} />
  }
}

export default AppProviders
