# AEGIS Prototype (Standalone UI Demo)

> **Status: Legacy / Reference Only**
>
> This folder contains the original standalone UI prototype used during the
> initial design phase. It is **not** part of the production build and is
> retained for historical reference only.

## Relationship to `aegis-v6/`

| Aspect | `aegis-prototype/` | `aegis-v6/client/` |
|--------|--------------------|--------------------|
| Purpose | Design exploration & rapid UI iteration | Production frontend |
| Backend | None — static pages only | Full Express/Node API + PostgreSQL |
| Auth | Mock / placeholder | JWT + OAuth + 2FA |
| AI features | None | Full multimodal fusion, CLIP, voice |
| Maps | Static placeholder | Leaflet + WMS + 3D + evacuation |
| Tests | None | 150+ unit + E2E tests |

## When to use this folder

- **UI designers** can reference page layouts and component patterns
- **New contributors** can understand the original UX intent
- **Do not** build from this folder for deployment — use `aegis-v6/client/`

## Running (for reference only)

```bash
cd aegis-prototype
npm install
npm run dev    # http://localhost:5173
```

## Future

This folder may be archived or removed in a future release. All active
development should target `aegis-v6/client/`.
