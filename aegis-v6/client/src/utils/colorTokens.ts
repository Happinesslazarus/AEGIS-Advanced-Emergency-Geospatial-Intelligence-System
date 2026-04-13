/**
 * File: colorTokens.ts
 *
 * Design-system colour tokens for the AEGIS frontend.  Provides a single
 * source of truth for colours used to represent severity levels, risk tiers,
 * alert states, incident types, status indicators, and feedback states.
 *
 * Three formats are exported for different rendering contexts:
 *   1. Hex strings  (#rrggbb)   — Leaflet / Mapbox GL map markers, SVG, Canvas
 *   2. RGBA tuples  [R,G,B,A]   — deck.gl GPU-accelerated layers
 *   3. Tailwind class strings   — JSX React components (theme-aware with dark: variants)
 *
 * Glossary:
 *   as const          = TypeScript modifier: makes the object a readonly literal type;
 *                       prevents accidental modification and enables precise types
 *   Tailwind          = utility-first CSS framework; classes like 'bg-red-100' compile
 *                       to CSS rules at build time
 *   dark: prefix      = Tailwind dark-mode variant; applies only when the root element
 *                       has the 'dark' class (controlled by ThemeContext)
 *   deck.gl           = GPU-accelerated geospatial visualisation library;
 *                       colours are passed as [R, G, B, A] arrays (0-255 range)
 *   RGBA alpha        = 4th array element; 0 = fully transparent, 255 = fully opaque;
 *                       these use 180-240 range for a semi-transparent map overlay effect
 *   SEVERITY          = how dangerous an incident is: critical > high > medium > low
 *   RISK              = predicted likelihood of a hazard event: CRITICAL/HIGH/MEDIUM/LOW/NONE
 *   STATUS            = operational state of a monitoring station: CRITICAL/HIGH/ELEVATED/NORMAL
 *   INCIDENT_HEX      = hex colours for each supported incident type on the map
 *   STATION_HEX       = colours for SEPA river gauge stations by alert level
 *   SEVERITY_CLASSES  = full badge-style Tailwind classes: bg + text + border (both themes)
 *   SEVERITY_PILL     = compact filled pill badges for table cells and chips
 *   SEVERITY_BG       = card border + background colour for report cards
 *   RISK_CLASSES      = text-only colour for risk level labels
 *   INCIDENT_CLASSES  = text-only colour for incident type labels
 *   FEEDBACK_CLASSES  = multi-property colour sets for toast / alert notifications
 *   ACTIVITY_COLORS   = icon text + background for the activity log panel
 *   STAT_CARD_COLORS  = left-border accent + heading text for dashboard statistic cards
 *
 * How it connects:
 * - Imported by ReportCard, AlertCard, and any component showing severity or status
 * - Works alongside client/src/styles/globals.css Tailwind CSS custom properties
 */

/* ---------------------------------------------------------------------------
   Hex color palette — raw #rrggbb strings for map/canvas/SVG rendering
---------------------------------------------------------------------------*/

/* Severity level colours (used on map markers, chart fills, etc.) */
export const SEVERITY_HEX = {
  critical: '#dc2626', // bold red   — life-threatening
  high:     '#f97316', // orange     — significant danger
  medium:   '#eab308', // amber/gold — moderate risk
  low:      '#3b82f6', // blue       — minor concern
  info:     '#0ea5e9', // sky blue   — informational only
} as const

/* Title-cased keys for Leaflet / Mapbox GL marker use (these APIs expect capitalised keys) */
export const SEVERITY_HEX_TITLE = {
  High:   '#ef4444',
  Medium: '#f59e0b',
  Low:    '#3b82f6',
} as const

/* Risk tier colours (for AI prediction overlays) */
export const RISK_HEX = {
  critical: '#dc2626',
  high:     '#f97316',
  medium:   '#eab308',
  low:      '#3b82f6',
  none:     '#22c55e', // green = no current risk
} as const

/* Station alert status colours (SEPA river monitoring stations) */
export const STATUS_HEX = {
  CRITICAL: '#dc2626',
  HIGH:     '#f97316',
  ELEVATED: '#eab308',
  NORMAL:   '#22c55e',
} as const

/* Per-incident-type colours for map layer icons */
export const INCIDENT_HEX = {
  flood:                   '#2563eb', // blue
  severe_storm:            '#7c3aed', // purple
  heatwave:                '#dc2626', // red
  wildfire:                '#f97316', // orange
  landslide:               '#92400e', // brown
  power_outage:            '#fbbf24', // yellow
  water_supply:            '#06b6d4', // cyan
  water_supply_disruption: '#06b6d4',
  infrastructure_damage:   '#78716c', // stone grey
  public_safety:           '#ef4444', // red
  public_safety_incident:  '#ef4444',
  environmental_hazard:    '#16a34a', // dark green
  drought:                 '#d97706', // dark amber
} as const

/* Colours for SEPA river/weather station icons: maps the station's current alert level to a hex colour */
export const STATION_HEX = {
  critical: '#dc2626', // above alert level — immediate danger
  high:     '#f97316',
  elevated: '#eab308', // above normal but below warning threshold
  normal:   '#22c55e', // within expected range
  active:   '#22c55e', // alias for 'normal' (station is live and healthy)
  warning:  '#eab308', // approaching alert threshold
  alert:    '#dc2626', // at or above alert threshold
  offline:  '#6b7280', // grey — station is not reporting data
} as const

/* ---------------------------------------------------------------------------
   RGBA tuple palette — [R, G, B, A] arrays for deck.gl GPU layers
   Alpha (A) is 0-255; lower values produce semi-transparent overlays
---------------------------------------------------------------------------*/

/* Severity as [R,G,B,A] for deck.gl ScatterplotLayer / ColumnLayer —
   Title-cased keys match the severity strings returned by the AI engine */
export const SEVERITY_RGBA: Record<string, [number, number, number, number]> = {
  High:   [239, 68, 68, 220],   // near-opaque red
  Medium: [245, 158, 11, 200],  // amber, slightly transparent
  Low:    [59, 130, 246, 180],  // blue, more transparent
}

/* Station alert status as [R,G,B,A] for the deck.gl map station layer */
export const STATUS_RGBA: Record<string, [number, number, number, number]> = {
  CRITICAL: [220, 38, 38, 240], // nearly opaque red
  HIGH:     [249, 115, 22, 220],
  ELEVATED: [234, 179, 8, 200],
  NORMAL:   [34, 197, 94, 180], // green, most transparent
}

/* ---------------------------------------------------------------------------
   Tailwind CSS class strings — used in JSX className props
   All include dark: variants so the colour adapts to the active theme
   (dark mode is toggled by adding the 'dark' class to <html> in ThemeContext)
---------------------------------------------------------------------------*/

/* Full badge-style classes: bg + text + border + dark variants
   Use when the full rounded badge/chip style is needed */
/* eslint-disable max-len */
export const SEVERITY_CLASSES = {
  critical: 'bg-red-100 border-red-300 text-red-900 dark:bg-red-950/30 dark:border-red-800 dark:text-red-200',
  high:     'bg-orange-100 border-orange-300 text-orange-900 dark:bg-orange-950/30 dark:border-orange-800 dark:text-orange-200',
  medium:   'bg-yellow-100 border-yellow-300 text-yellow-900 dark:bg-yellow-950/30 dark:border-yellow-800 dark:text-yellow-200',
  warning:  'bg-amber-100 border-amber-300 text-amber-900 dark:bg-amber-950/30 dark:border-amber-800 dark:text-amber-200',
  low:      'bg-blue-100 border-blue-300 text-blue-900 dark:bg-blue-950/30 dark:border-blue-800 dark:text-blue-200',
  info:     'bg-sky-100 border-sky-300 text-sky-900 dark:bg-sky-950/30 dark:border-sky-800 dark:text-sky-200',
} as const

/* Pill-style severity badges (filled bg, light text) */
export const SEVERITY_PILL = {
  critical: 'bg-red-600 text-white',
  high:     'bg-orange-500 text-white',
  medium:   'bg-amber-400 text-gray-900',
  low:      'bg-blue-400 text-white',
} as const

/* Card-border severity backgrounds */
export const SEVERITY_BG = {
  critical: 'border-red-500 bg-red-50 dark:bg-red-900/20',
  high:     'border-orange-500 bg-orange-50 dark:bg-orange-900/20',
  medium:   'border-amber-400 bg-amber-50 dark:bg-amber-900/20',
  low:      'border-blue-400 bg-blue-50 dark:bg-blue-900/20',
} as const

/* Report severity → Tailwind bg class for admin table severity pill badge
   Note: 'bg-aegis-400' is a custom brand colour defined in tailwind.config.js,
   not a built-in Tailwind colour */
export const SEVERITY_BG_PILL: Record<string, string> = {
  High:   'bg-red-500',
  Medium: 'bg-aegis-400', // custom AEGIS brand amber/orange — see tailwind.config.js
  Low:    'bg-blue-400',
}

/* Report status → Tailwind bg class for admin table status pill badge
   Keys match the 'status' field values returned by the reports API */
export const STATUS_BG_PILL: Record<string, string> = {
  Urgent:       'bg-red-600',
  Unverified:   'bg-gray-400',
  Verified:     'bg-green-500',
  Flagged:      'bg-aegis-500', // custom brand colour — see tailwind.config.js
  Resolved:     'bg-gray-300',
  Archived:     'bg-slate-500',
  False_Report: 'bg-rose-700',
}

/* ---------------------------------------------------------------------------
   Text-only colour classes — no background; used in label and heading text
---------------------------------------------------------------------------*/

/* Risk tier text colour — used in prediction and AI output labels */
export const RISK_CLASSES = {
  CRITICAL: 'text-red-600 dark:text-red-400',
  HIGH:     'text-orange-600 dark:text-orange-400',
  MEDIUM:   'text-amber-600 dark:text-amber-400',
  LOW:      'text-blue-600 dark:text-blue-400',
  NONE:     'text-green-600 dark:text-green-400',
} as const

/* Incident type text colour — used in incident-type labels and headings */
export const INCIDENT_CLASSES = {
  flood:                   'text-blue-600 dark:text-blue-400',
  severe_storm:            'text-purple-600 dark:text-purple-400',
  heatwave:                'text-red-600 dark:text-red-400',
  wildfire:                'text-orange-600 dark:text-orange-400',
  landslide:               'text-yellow-700 dark:text-yellow-600',
  power_outage:            'text-yellow-600 dark:text-yellow-400',
  water_supply:            'text-cyan-600 dark:text-cyan-400',
  water_supply_disruption: 'text-cyan-600 dark:text-cyan-400',
  infrastructure_damage:   'text-gray-600 dark:text-gray-300',
  public_safety:           'text-red-600 dark:text-red-500',
  public_safety_incident:  'text-red-600 dark:text-red-500',
  environmental_hazard:    'text-green-600 dark:text-green-400',
  drought:                 'text-amber-600 dark:text-amber-500',
} as const

/* ---------------------------------------------------------------------------
   Specialised colour sets for specific panels / widgets
---------------------------------------------------------------------------*/

/* Security dashboard alerts panel — severity badge (bg + text + border) */
export const SECURITY_SEVERITY_CLASSES = {
  critical: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300 border-red-200 dark:border-red-800',
  warning:  'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300 border-amber-200 dark:border-amber-800',
  info:     'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300 border-blue-200 dark:border-blue-800',
} as const

/* Toast / notification feedback colours — each state has 5 sub-properties:
   bg (gradient background), border, text, icon (icon tint), progress (progress bar fill) */
export const FEEDBACK_CLASSES = {
  success: {
    bg:       'bg-gradient-to-r from-green-50 to-emerald-50 dark:from-green-950/30 dark:to-emerald-950/30',
    border:   'border-green-200 dark:border-green-800',
    text:     'text-green-900 dark:text-green-200',
    icon:     'text-green-600 dark:text-green-400',
    progress: 'bg-green-500',
  },
  error: {
    bg:       'bg-gradient-to-r from-red-50 to-rose-50 dark:from-red-950/30 dark:to-rose-950/30',
    border:   'border-red-200 dark:border-red-800',
    text:     'text-red-900 dark:text-red-200',
    icon:     'text-red-600 dark:text-red-400',
    progress: 'bg-red-500',
  },
  warning: {
    bg:       'bg-gradient-to-r from-amber-50 to-yellow-50 dark:from-amber-950/30 dark:to-yellow-950/30',
    border:   'border-amber-200 dark:border-amber-800',
    text:     'text-amber-900 dark:text-amber-200',
    icon:     'text-amber-600 dark:text-amber-400',
    progress: 'bg-amber-500',
  },
  info: {
    bg:       'bg-gradient-to-r from-blue-50 to-cyan-50 dark:from-blue-950/30 dark:to-cyan-950/30',
    border:   'border-blue-200 dark:border-blue-800',
    text:     'text-blue-900 dark:text-blue-200',
    icon:     'text-blue-600 dark:text-blue-400',
    progress: 'bg-blue-500',
  },
} as const

/* Activity log event-type → icon text colour + icon background pill
   Used in the admin activity log list to visually distinguish event types */
export const ACTIVITY_COLORS: Record<string, string> = {
  verify:  'text-green-500 bg-green-50',
  flag:    'text-orange-500 bg-orange-50',
  urgent:  'text-red-500 bg-red-50',
  alert:   'text-red-600 bg-red-50',
  deploy:  'text-blue-500 bg-blue-50',
  login:   'text-gray-500 dark:text-gray-300 bg-gray-50',
  print:   'text-purple-500 bg-purple-50',
  export:  'text-cyan-500 bg-cyan-50',
}

/* Dashboard StatCard colour → left-border accent class + metric value text colour
   The 'border-l-*' class adds the coloured left border that distinguishes each card */
export const STAT_CARD_COLORS: Record<string, string> = {
  red:    'border-l-red-500 text-red-600 dark:text-red-400',
  amber:  'border-l-amber-500 text-amber-600 dark:text-amber-400',
  green:  'border-l-green-500 text-green-600 dark:text-green-400',
  blue:   'border-l-blue-500 text-blue-600 dark:text-blue-400',
  purple: 'border-l-purple-500 text-purple-600 dark:text-purple-400',
}

