/**
 * Index React context provider (shares state across components).
 *
 * How it connects:
 * - Wraps components in App.tsx via AppProviders */

export { AppProviders, MinimalProviders, PublicProviders, CitizenProviders, composeProviders } from './AppProviders'
export { AlertsProvider, useAlerts } from './AlertsContext'
export { CitizenAuthProvider, useCitizenAuth, type CitizenUser, type CitizenPreferences } from './CitizenAuthContext'
export { IncidentProvider, useIncidents } from './IncidentContext'
export { LocationProvider, useLocation } from './LocationContext'
export { RegionProvider, useRegion } from './RegionContext'
export { ReportsProvider, useReports } from './ReportsContext'
export { SocketProvider, useSharedSocket } from './SocketContext'
export { ThemeProvider, useTheme, type ThemeName, THEMES } from './ThemeContext'
