# AEGIS Frontend i18n Architecture (React + TypeScript)

## Goals
- Fully translatable UI across `LandingPage`, `CitizenPage`, `CitizenDashboard`, and `AdminPage`.
- Feature-scoped translation keys that scale with large modules.
- Type-safe key usage to prevent runtime key typos.
- Browser translator compatibility without DOM-rewrite hacks.

## Recommended structure

```text
src/
  i18n/
    locales/
      en/
        common.json
        landing.json
        citizen.json
        admin.json
        dashboard.json
      es/
        common.json
        landing.json
        citizen.json
        admin.json
        dashboard.json
    index.ts
    resources.ts
    types.ts
```

## Key naming convention
- `common.*` for global/shared labels
- `landing.*` for landing route
- `citizen.*` for citizen public/auth pages
- `dashboard.citizen.*` for signed-in citizen dashboard
- `admin.*` for operator/admin pages

Examples:
- `admin.reports.filters.severity.all`
- `admin.reports.actions.share`
- `dashboard.citizen.messages.empty.title`
- `landing.hero.subtitle`

## Browser translation compatibility
- Keep document attributes updated:
  - `html[lang]` set from active app language
  - `html[dir]` from RTL/LTR language rules
  - `html[translate="yes"]`
- Avoid canvas-only labels for critical text; mirror meaningful labels in regular DOM.
- Keep text as real text nodes where possible (not image text).

## Dynamic UI guidance
- Build map/chart legends and labels through `t(...)` keys.
- Keep status/category values canonical in data model (`High`, `Medium`, `Low`) and map to localized labels in UI.
- For notifications and toast content, never inline user-facing text.

## Type-safe usage
- Keep `en` dictionary as the source of truth.
- Derive `I18nKey = keyof typeof en`.
- Overload `t()` so `t('known.key', lang)` is typed.

## Quality gates
- Run hardcoded scanner:
  - `npm run i18n:scan`
- Add CI gate to fail if scanner finds violations.
- Add missing-key checks by comparing each locale against English base keys.

## Migration strategy
1. Migrate route by route (`landing` -> `citizen` -> `citizen dashboard` -> `admin`).
2. Start with visible labels/buttons/placeholders/alerts.
3. Migrate print/export templates and modal messages.
4. Add locale coverage incrementally; fallback to English remains safe.
