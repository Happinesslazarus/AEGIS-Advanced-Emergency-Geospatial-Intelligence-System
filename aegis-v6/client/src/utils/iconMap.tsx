/**
 * File: iconMap.tsx
 *
 * Maps incident-type string names (as stored in the database) to Lucide React
 * icon components, providing a single lookup table so every part of the UI
 * renders the same icon for the same incident type.
 *
 * Glossary:
 *   LucideIcon       = a React component from the 'lucide-react' package that
 *                      renders an SVG icon; each icon is a named export
 *   LucideIconType   = the TypeScript type of any Lucide icon component
 *                      (imported as a type-only import to avoid a runtime import)
 *   ICON_MAP         = a plain object (dictionary) keyed by icon name string;
 *                      values are the imported Lucide component references
 *   LucideIcon()     = JSX wrapper: looks up the icon in ICON_MAP and renders
 *                      <Icon className=…/> or null if the name is unknown
 *   getIconComponent = non-JSX accessor: returns the icon component reference
 *                      (useful in contexts that need the class, not the element)
 *   HelpCircle       = fallback icon used when the requested name is not in the map
 *   className prop   = optional Tailwind/CSS class string applied to the <svg>;
 *                      defaults to 'w-4 h-4' (16 × 16 px)
 *
 * How it connects:
 * - Used by ReportCard, AlertCard, and any incident list component
 * - Icon names come from server/src/services/incidentTypeService.ts
 * - Icons sourced from the lucide-react package (see client/package.json)
 */

import type { LucideIcon as LucideIconType } from 'lucide-react'
import {
  Droplets, Building2, ShieldAlert, Users, Radiation, HeartPulse, Waves, Activity,
  Flame, Mountain, CloudLightning, Wind, Sun, Snowflake, HelpCircle, Construction,
  Zap, TreePine, CircleDot, Siren, Search, AlertTriangle, LogOut, Skull,
  FlaskConical, Home, Car, Shirt
} from 'lucide-react'

// ---------------------------------------------------------------------------
// Icon name → Lucide component lookup table
// Adding a new icon: import it above, then add it here with the same key name
// that the server uses in incidentTypeService.ts
// ---------------------------------------------------------------------------
const ICON_MAP: Record<string, LucideIconType> = {
  Droplets, Building2, ShieldAlert, Users, Radiation, HeartPulse, Waves, Activity,
  Flame, Mountain, CloudLightning, Wind, Sun, Snowflake, HelpCircle, Construction,
  Zap, TreePine, CircleDot, Siren, Search, AlertTriangle, LogOut, Skull,
  FlaskConical, Home, Car, Shirt,
}

// ---------------------------------------------------------------------------
// JSX component — renders the icon inline; returns null when name is unknown
// so callers can conditionally render without a visible broken-icon fallback
// ---------------------------------------------------------------------------
export function LucideIcon({ name, className }: { name: string; className?: string }): JSX.Element | null {
  const Icon = ICON_MAP[name]
  // Return null (nothing rendered) if the incident type has no matching icon yet
  return Icon ? <Icon className={className || 'w-4 h-4'} /> : null
}

// ---------------------------------------------------------------------------
// Non-JSX accessor — returns the component class itself (not a rendered element)
// Falls back to HelpCircle (question mark) so callers always receive a valid icon
// ---------------------------------------------------------------------------
export function getIconComponent(name: string): LucideIconType {
  return ICON_MAP[name] || HelpCircle
}
