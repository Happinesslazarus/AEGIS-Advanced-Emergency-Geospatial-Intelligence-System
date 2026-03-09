/**
 * iconMap.tsx — Maps string icon names from the database to Lucide
 * React components so we can render dynamic icons from category config.
 */

import type { LucideIcon as LucideIconType } from 'lucide-react'
import {
  Droplets, Building2, ShieldAlert, Users, Radiation, HeartPulse, Waves, Activity,
  Flame, Mountain, CloudLightning, Wind, Sun, Snowflake, HelpCircle, Construction,
  Zap, TreePine, CircleDot, Siren, Search, AlertTriangle, LogOut, Skull,
  FlaskConical, Home, Car, Shirt
} from 'lucide-react'

const ICON_MAP: Record<string, LucideIconType> = {
  Droplets, Building2, ShieldAlert, Users, Radiation, HeartPulse, Waves, Activity,
  Flame, Mountain, CloudLightning, Wind, Sun, Snowflake, HelpCircle, Construction,
  Zap, TreePine, CircleDot, Siren, Search, AlertTriangle, LogOut, Skull,
  FlaskConical, Home, Car, Shirt,
}

export function LucideIcon({ name, className }: { name: string; className?: string }): JSX.Element | null {
  const Icon = ICON_MAP[name]
  return Icon ? <Icon className={className || 'w-4 h-4'} /> : null
}

export function getIconComponent(name: string): LucideIconType {
  return ICON_MAP[name] || HelpCircle
}
