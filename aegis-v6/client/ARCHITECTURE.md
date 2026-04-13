# AEGIS Client Architecture

## Overview

The client is a React 18 + TypeScript single-page application built with Vite. It serves two distinct user roles from the same bundle:

- **Operators / Admins** — authenticated via JWT stored in-memory (XSS-resistant). Access `/admin/*` routes. See `src/components/admin/`.
- **Citizens** — authenticated via JWT in `localStorage` (accepted trade-off for offline-capable mobile UX). Access `/citizen/*` routes. See `src/components/citizen/`.

The token strategy is documented in `src/utils/api.ts`.

## Domain Model

The application is organized into the following bounded contexts:

### 1. Authentication
- **Operator auth**: `src/utils/api.ts` — in-memory `_accessToken`, httpOnly cookie refresh
- **Citizen auth**: `CitizenAuthContext` — `localStorage('aegis-citizen-token')`, auto-refresh
- **Pages**: `CitizenAuthPage`, `GuestDashboard`, `admin/LoginPage`
- **Hooks**: `useSetupStatus` (first-run detection)

### 2. Incidents
- **Context**: `IncidentContext`
- **Pages**: `AdminPage` (incident queue section)
- **Components**: `admin/IncidentQueue`, `admin/IncidentCommandConsole`
- **Hooks**: `useSocket` (live updates)

### 3. Reports
- **Context**: `ReportsContext`
- **Pages**: `AdminPage` (reports section), `CitizenPage` (submit)
- **Components**: `citizen/ReportForm` (6-step wizard), `admin/AllReportsManager`
- **Hooks**: `useApiQueries`

### 4. Alerts
- **Context**: `AlertsContext`
- **Pages**: `AlertsPage`
- **Components**: `shared/AlertCard`, `shared/EmergencyBanner`, `citizen/AlertSubscribe`
- **Hooks**: `useWebPush`, `useSocket`

### 5. Distress / SOS
- **Components**: `citizen/SOSButton`, `admin/DistressPanel`
- **Hooks**: `useDistress` — manages beacon lifecycle, GPS tracking, countdown, Socket.IO
- **API**: `POST /api/distress/activate` → `POST /api/distress/location` (live updates)

### 6. Maps and Spatial
- **Components**: `shared/LiveMap`, `shared/DisasterMap`, `shared/Map3D`, `shared/FloodLayerControl`, `shared/SpatialToolbar`
- Uses Leaflet + react-leaflet; spatial analysis via `POST /api/spatial/*`
- `SpatialToolbar` wraps all output in `SafeHtml` XSS sanitizer

### 7. AI and Chat
- **Components**: `citizen/Chatbot`, `admin/AITransparencyDashboard`, `admin/AITransparencyConsole`
- **Hooks**: `useFloodData`
- Chat routes to Ollama local-first LLM; streams token-by-token via WebSocket

### 8. Community
- **Components**: `citizen/CommunityChat`, `citizen/CommunityChatRoom`, `admin/AdminCommunityHub`
- **Context**: `SocketContext`
- Real-time via Socket.IO; escalation keywords trigger operator alerts

### 9. Shared Infrastructure
- **Theme**: `ThemeContext` — 7 accessibility modes (high contrast, dyslexia, large text, reduced motion, colour-blind, screen reader, captions)
- **Socket**: `SocketContext` — single shared Socket.IO connection
- **Location**: `LocationContext` — GPS + geocoded address
- **Region**: `RegionContext` — active deployment region (Scotland/England/Generic)
- **UI system**: `components/ui/` (Button, Modal, Toast, Skeleton, Navigation, FormElements, ...)

## Export Patterns

All modules use **named exports** for:
- Better tree-shaking
- Easier refactoring
- Clear import statements

```typescript
// ✅ Preferred
export { MyComponent } from './MyComponent'
export function useMyHook() { }

// ❌ Avoid
export default MyComponent
```

## Provider Composition

Provider tree is composed via `AppProviders.tsx`:

```typescript
import { AppProviders } from '@/contexts'

// Wraps all 8 contexts in correct dependency order
<AppProviders>
  <App />
</AppProviders>
```

Available provider presets:
- `AppProviders` - Full application (all contexts)
- `MinimalProviders` - Theme + Query only (for tests)
- `PublicProviders` - Theme + Query + Location (public pages)
- `CitizenProviders` - All except admin-specific contexts

## Type Safety

Replace `any` with typed utilities from `@/types/api`:

```typescript
import { typedFetch, safeGet, isApiError } from '@/types/api'

// Before
const data: any = await response.json()

// After
const result = await typedFetch<Incident[]>('/api/incidents')
if (isApiError(result)) return handleError(result)
```

## State Management Patterns

### Simple State → `useState`
```typescript
const [isOpen, setIsOpen] = useState(false)
```

### Complex State → `useReducerContext`
```typescript
import { createReducerContext, createAction } from '@/lib'

const increment = createAction<number>('INCREMENT')
const { Provider, useContext } = createReducerContext(reducer, initialState)
```

### Server State → React Query
```typescript
const { data, isLoading } = useQuery({
  queryKey: ['incidents'],
  queryFn: fetchIncidents
})
```

## Feature Folder Template

New features should follow this structure:

```
src/features/[feature-name]/
├── components/          # Feature-specific components
│   ├── FeatureList.tsx
│   └── FeatureCard.tsx
├── hooks/               # Feature-specific hooks
│   └── useFeature.ts
├── context/             # Feature context (if needed)
│   └── FeatureContext.tsx
├── types.ts             # Feature-specific types
├── api.ts               # API calls for this feature
└── index.ts             # Barrel export
```
