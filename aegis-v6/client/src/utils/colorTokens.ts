/**
 * Shared color tokens — single source of truth for severity / risk / status
 * colors used across the AEGIS frontend.
 *
 * Three layers:
 *   HEX     — for <canvas>, SVG, Leaflet, deck.gl  (raw color values)
 *   RGBA    — for deck.gl layers requiring [r,g,b,a] tuples
 *   TAILWIND — for JSX className strings            (theme-aware utility classes)
 */

/* Hex color palette (map / canvas / SVG) */

export const SEVERITY_HEX = {
  critical: '#dc2626',
  high:     '#f97316',
  medium:   '#eab308',
  low:      '#3b82f6',
  info:     '#0ea5e9',
} as const

/* Title-cased keys for Leaflet / Mapbox GL marker use */
export const SEVERITY_HEX_TITLE = {
  High:   '#ef4444',
  Medium: '#f59e0b',
  Low:    '#3b82f6',
} as const

export const RISK_HEX = {
  critical: '#dc2626',
  high:     '#f97316',
  medium:   '#eab308',
  low:      '#3b82f6',
  none:     '#22c55e',
} as const

export const STATUS_HEX = {
  CRITICAL: '#dc2626',
  HIGH:     '#f97316',
  ELEVATED: '#eab308',
  NORMAL:   '#22c55e',
} as const

export const INCIDENT_HEX = {
  flood:                   '#2563eb',
  severe_storm:            '#7c3aed',
  heatwave:                '#dc2626',
  wildfire:                '#f97316',
  landslide:               '#92400e',
  power_outage:            '#fbbf24',
  water_supply:            '#06b6d4',
  water_supply_disruption: '#06b6d4',
  infrastructure_damage:   '#78716c',
  public_safety:           '#ef4444',
  public_safety_incident:  '#ef4444',
  environmental_hazard:    '#16a34a',
  drought:                 '#d97706',
} as const

export const STATION_HEX = {
  critical: '#dc2626',
  high:     '#f97316',
  elevated: '#eab308',
  normal:   '#22c55e',
  active:   '#22c55e',
  warning:  '#eab308',
  alert:    '#dc2626',
  offline:  '#6b7280',
} as const

/* RGBA tuples for deck.gl layers */

/* Severity as [R,G,B,A] for deck.gl ScatterplotLayer / ColumnLayer */
export const SEVERITY_RGBA: Record<string, [number, number, number, number]> = {
  High:   [239, 68, 68, 220],
  Medium: [245, 158, 11, 200],
  Low:    [59, 130, 246, 180],
}

/* Station status as [R,G,B,A] for deck.gl layers */
export const STATUS_RGBA: Record<string, [number, number, number, number]> = {
  CRITICAL: [220, 38, 38, 240],
  HIGH:     [249, 115, 22, 220],
  ELEVATED: [234, 179, 8, 200],
  NORMAL:   [34, 197, 94, 180],
}

/* Tailwind class maps (JSX theme-aware) */

/* Full badge-style classes: bg + text + border, with dark: variants */
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

/* Report severity ? Tailwind bg class (admin table pill) */
export const SEVERITY_BG_PILL: Record<string, string> = {
  High:   'bg-red-500',
  Medium: 'bg-aegis-400',
  Low:    'bg-blue-400',
}

/* Report status ? Tailwind bg class (admin table pill) */
export const STATUS_BG_PILL: Record<string, string> = {
  Urgent:       'bg-red-600',
  Unverified:   'bg-gray-400',
  Verified:     'bg-green-500',
  Flagged:      'bg-aegis-500',
  Resolved:     'bg-gray-300',
  Archived:     'bg-slate-500',
  False_Report: 'bg-rose-700',
}

/* Risk level text colors (theme-aware) */
export const RISK_CLASSES = {
  CRITICAL: 'text-red-600 dark:text-red-400',
  HIGH:     'text-orange-600 dark:text-orange-400',
  MEDIUM:   'text-amber-600 dark:text-amber-400',
  LOW:      'text-blue-600 dark:text-blue-400',
  NONE:     'text-green-600 dark:text-green-400',
} as const

/* Incident type text colors (theme-aware) */
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

/* Security dashboard severity classes */
export const SECURITY_SEVERITY_CLASSES = {
  critical: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300 border-red-200 dark:border-red-800',
  warning:  'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300 border-amber-200 dark:border-amber-800',
  info:     'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300 border-blue-200 dark:border-blue-800',
} as const

/* Notification / feedback state classes (multi-property) */
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

/* Activity log type ? icon color + bg class */
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

/* StatCard named-color ? Tailwind classes (border-l + text) */
export const STAT_CARD_COLORS: Record<string, string> = {
  red:    'border-l-red-500 text-red-600 dark:text-red-400',
  amber:  'border-l-amber-500 text-amber-600 dark:text-amber-400',
  green:  'border-l-green-500 text-green-600 dark:text-green-400',
  blue:   'border-l-blue-500 text-blue-600 dark:text-blue-400',
  purple: 'border-l-purple-500 text-purple-600 dark:text-purple-400',
}
