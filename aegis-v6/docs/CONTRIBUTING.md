# AEGIS Contributing Guide

This guide captures the coding conventions enforced across the AEGIS codebase. All new code must follow these rules; existing code is being migrated incrementally (see audit tasks A1–D2 in the Phase 1 Audit).

---

## Server-side Conventions

### 1. Error handling — always throw `AppError`

Never `res.status(4xx/5xx).json(...)` directly inside route handlers. Use `AppError` from `server/src/utils/AppError.ts`:

```typescript
// ❌ don't
if (!user) return res.status(404).json({ error: 'User not found' })

// ✅ do
if (!user) throw new AppError(404, 'User not found')
```

`errorHandler.ts` middleware converts `AppError` to a consistent `{ ok: false, error, code }` response and logs it centrally.

### 2. Response envelope — always use `res.success()` / `res.fail()`

All successful responses must use the helper from `server/src/middleware/responseHelpers.ts`:

```typescript
// ❌ don't
res.json({ success: true, data: reports })

// ✅ do
res.success(reports)
// or with pagination:
res.success(reports, { total, page, pageSize })
```

The envelope shape is `{ ok: true, data, meta? }`. The client's `apiFetch` expects this shape. Do **not** change the envelope without updating `client/src/utils/apiFetch.ts`.

### 3. Side-effects — always use `eventBus.publish()`

Never call `io.emit(...)`, `notificationService.*()`, or `auditLog(...)` directly from route handlers. Publish a typed event instead; subscribers react asynchronously:

```typescript
// ❌ don't
io.to('admins').emit('alert:new', alert)
auditLog('alerts', 'created', { alertId })
notificationService.sendAlertToSubscribers(alert, subscribers)

// ✅ do
await eventBus.publish(
  AegisEventNames.ALERT_CREATED,
  { alertId: String(alert.id), hazardType: alert.type, severity: alert.severity, … },
  { source: 'operator', severity: alert.severity },
)
// socketBroadcastSubscriber emits alert:new
// auditSubscriber writes the log entry
// future notifySubscriber sends push/SMS/e-mail
```

Adding a new event: add its name to `eventTypes.ts`, payload to `eventContracts.ts`, entry to `AegisEventMap`, then subscribers react without touching the publisher.

### 4. Correlation context

Every async operation spawned from a request must run inside the correlation context started by `requestId` middleware. Do not create bare `setImmediate`/`setTimeout` callbacks that escape the context. Use `runWithCorrelation` for background tasks:

```typescript
import { runWithCorrelation } from '../events/correlationContext.js'
import { randomUUID } from 'crypto'

// Inside a socket handler (no Express req):
runWithCorrelation({ correlationId: randomUUID(), actor: String(userId) }, () => {
  void eventBus.publish(AegisEventNames.SOS_ACTIVATED, payload)
})
```

### 5. Route / service separation

- Routes validate input, call services, publish events, return responses.
- Services contain business logic and DB queries.
- No DB queries inside routes (except trivial lookups in routes < 50 LOC).
- No `req`/`res` objects passed to services.

---

## Client-side Conventions

### 6. Data fetching — always use `useApiResource`

Never use raw `fetch()` inside components. Use the declarative hook:

```typescript
// ❌ don't
const [reports, setReports] = useState([])
useEffect(() => {
  fetch('/api/reports').then(r => r.json()).then(setReports)
}, [])

// ✅ do
import { useApiResource } from '../hooks/useApiResource'
import { apiFetch } from '../utils/apiFetch'

const { data: reports, loading, error } = useApiResource(
  () => apiFetch('/api/reports'),
  [],
)
```

`useApiResource` handles loading/error states, deduplication, and cancellation.

### 7. Socket events — always use `useEventCallbacks`

Never call `socket.on(...)` / `socket.off(...)` manually in components. Use the typed hook:

```typescript
// ❌ don't
useEffect(() => {
  const socket = getSocket()
  socket.on('report:new', handler)
  return () => socket.off('report:new', handler)
}, [])

// ✅ do
import { useEventCallbacks } from '../hooks/useEventCallbacks'

useEventCallbacks({
  'report:new': (report) => { /* handle */ },
  'report:updated': (update) => { /* handle */ },
})
```

### 8. API calls — always use `apiFetch`

Use `client/src/utils/apiFetch.ts` for all HTTP requests. It:
- Attaches the JWT `Authorization` header automatically.
- Parses the `{ ok, data, error }` envelope.
- Throws on non-OK responses so errors bubble to `useApiResource`.

```typescript
// ❌ don't
const res = await fetch('/api/reports', { headers: { Authorization: `Bearer ${token}` } })
const json = await res.json()

// ✅ do
const data = await apiFetch('/api/reports')
```

---

## General Rules

### Testing

- Unit tests live next to their source file: `chatService.test.ts` next to `chatService.ts`.
- Integration tests live in `server/tests/`.
- Client component tests use React Testing Library (`vitest`).
- Run all tests with `npm test` from the relevant workspace root.

### Imports

- Server TypeScript uses Node16 module resolution. **All local imports must include the `.js` extension** even though the source is `.ts`:
  ```typescript
  import { logger } from './logger.js'   // ✅
  import { logger } from './logger'      // ❌ breaks at runtime
  ```
- Barrel files (`index.ts`) are used inside multi-file directories (`chatTools/`, `socketHandlers/`, `subscribers/`). Import from the barrel, not the internal files.

### Commit messages

Follow Conventional Commits: `type(scope): description`

```
feat(reports): add bulk status update endpoint
fix(auth): token refresh race condition
refactor(chat): split chatTools.ts into chatTools/ directory
docs: add ARCHITECTURE.md and CONTRIBUTING.md
```

### Environment variables

- All secrets go in `.env` (never committed).
- Document every new env var in `README.md` under **Environment Variables**.
- Access via `process.env.VAR_NAME`; validate at startup, not at call-time.

---

## Phase 1 Audit Checklist

The following tasks track ongoing migration of pre-convention code. Completed tasks are marked ✅.

| ID | Task | Status |
|----|------|--------|
| A1 | Adopt `res.success()` / `res.fail()` across 508 res.json call-sites | 🔄 In progress |
| A2 | Add `AppError` middleware + replace raw status sends | ✅ Done |
| A3 | Centralise rate-limiting to `middleware/rateLimiter.ts` | ✅ Done |
| A4 | Migrate 53 raw-fetch components to `useApiResource` | 🔄 In progress |
| B1 | Implement typed event bus (`eventBus.ts`) | ✅ Done |
| B2 | Add `eventBus.publish()` alongside every imperative emit (dual-write) | ✅ Done |
| B3 | Remove imperative dual-write call-sites; event bus is single-write | ✅ Done |
| C1 | Split `socket.ts` (1863 LOC) into `socketHandlers/` directory | ✅ Done |
| C2 | Split `chatTools.ts` (2076 LOC) into `chatTools/` directory | ✅ Done |
| C3 | Split `extendedRoutes.ts` into per-resource route files | ✅ Done |
| C4 | Split `CitizenDashboard.tsx` into page + feature components | ✅ Done |
| D1 | Write `docs/ARCHITECTURE.md` | ✅ Done |
| D2 | Write `docs/CONTRIBUTING.md` | ✅ Done |
