import type { IncidentCategory, DisasterSubtype, SeverityConfig, TrappedOptionConfig, CommunityHelpType, LanguageOption, IncidentCategoryKey } from '../types'

export const INCIDENT_CATEGORIES: IncidentCategory[] = [
  { key: 'natural_disaster', label: 'Natural Disaster', icon: 'Droplets', color: 'blue' },
  { key: 'infrastructure', label: 'Infrastructure Accident', icon: 'Building2', color: 'orange' },
  { key: 'public_safety', label: 'Public Safety', icon: 'ShieldAlert', color: 'red' },
  { key: 'community_safety', label: 'Community Safety', icon: 'Users', color: 'green' },
  { key: 'environmental', label: 'Environmental Hazard', icon: 'Radiation', color: 'yellow' },
  { key: 'medical', label: 'Medical Emergency', icon: 'HeartPulse', color: 'pink' },
]

export const DISASTER_SUBTYPES: Record<IncidentCategoryKey, DisasterSubtype[]> = {
  natural_disaster: [
    { key: 'flood', label: 'Flood', icon: 'Waves', implemented: true },
    { key: 'severe_storm', label: 'Severe Storm', icon: 'CloudLightning', implemented: true },
    { key: 'heatwave', label: 'Heatwave', icon: 'Sun', implemented: true },
    { key: 'wildfire', label: 'Wildfire', icon: 'Flame', implemented: true },
    { key: 'landslide', label: 'Landslide', icon: 'Mountain', implemented: true },
    { key: 'earthquake', label: 'Earthquake', icon: 'Activity', implemented: true },
    { key: 'storm', label: 'Storm / Hurricane', icon: 'CloudLightning', implemented: true },
    { key: 'tornado', label: 'Tornado', icon: 'Wind', implemented: true },
    { key: 'tsunami', label: 'Tsunami', icon: 'Waves', implemented: true },
    { key: 'volcanic', label: 'Volcanic Eruption', icon: 'Mountain', implemented: true },
    { key: 'drought', label: 'Drought', icon: 'Sun', implemented: true },
    { key: 'avalanche', label: 'Avalanche', icon: 'Snowflake', implemented: true },
    { key: 'other', label: 'Other (Please specify)', icon: 'HelpCircle', implemented: true },
  ],
  infrastructure: [
    { key: 'infrastructure_damage', label: 'Infrastructure Damage', icon: 'Building2', implemented: true },
    { key: 'road_damage', label: 'Road Damage / Collapse', icon: 'Construction', implemented: true },
    { key: 'bridge_damage', label: 'Bridge Damage / Closure', icon: 'Construction', implemented: true },
    { key: 'building_collapse', label: 'Building Collapse', icon: 'Building2', implemented: true },
    { key: 'gas_leak', label: 'Gas Leak', icon: 'Wind', implemented: true },
    { key: 'water_main', label: 'Water Main Break', icon: 'Droplets', implemented: true },
    { key: 'power_line', label: 'Power Line Down', icon: 'Zap', implemented: true },
    { key: 'debris', label: 'Debris Blocking Road', icon: 'TreePine', implemented: true },
    { key: 'sinkhole', label: 'Sinkhole', icon: 'CircleDot', implemented: true },
    { key: 'structural', label: 'Structural Damage', icon: 'Building2', implemented: true },
    { key: 'other', label: 'Other (Please specify)', icon: 'HelpCircle', implemented: true },
  ],
  public_safety: [
    { key: 'public_safety_incident', label: 'Public Safety Incident', icon: 'ShieldAlert', implemented: true },
    { key: 'person_trapped', label: 'Person Trapped', icon: 'Siren', implemented: true },
    { key: 'missing_person', label: 'Missing Person', icon: 'Search', implemented: true },
    { key: 'hazardous_area', label: 'Hazardous Area', icon: 'AlertTriangle', implemented: true },
    { key: 'other', label: 'Other', icon: 'HelpCircle', implemented: true },
  ],
  community_safety: [
    { key: 'power_outage', label: 'Power Outage', icon: 'Zap', implemented: true },
    { key: 'water_supply_disruption', label: 'Water Supply Disruption', icon: 'Droplets', implemented: true },
    { key: 'water_supply', label: 'Water Supply Issue', icon: 'Droplets', implemented: true },
    { key: 'evacuation', label: 'Evacuation Needed', icon: 'LogOut', implemented: true },
    { key: 'other', label: 'Other', icon: 'HelpCircle', implemented: true },
  ],
  environmental: [
    { key: 'environmental_hazard', label: 'Environmental Hazard', icon: 'Radiation', implemented: true },
    { key: 'pollution', label: 'Pollution / Spill', icon: 'Skull', implemented: true },
    { key: 'chemical', label: 'Chemical Hazard', icon: 'Radiation', implemented: true },
    { key: 'other', label: 'Other', icon: 'HelpCircle', implemented: true },
  ],
  medical: [
    { key: 'mass_casualty', label: 'Mass Casualty Event', icon: 'HeartPulse', implemented: true },
    { key: 'contamination', label: 'Water/Food Contamination', icon: 'FlaskConical', implemented: true },
    { key: 'other', label: 'Other', icon: 'HelpCircle', implemented: true },
  ],
}

export const SEVERITY_LEVELS: SeverityConfig[] = [
  { key: 'Low', label: 'Low', description: 'Minor issue, no immediate danger to life', color: 'blue', className: 'badge-low' },
  { key: 'Medium', label: 'Medium', description: 'Significant concern, potential risk to people or property', color: 'amber', className: 'badge-medium' },
  { key: 'High', label: 'High', description: 'Critical situation, immediate danger to life', color: 'red', className: 'badge-critical' },
]

export const TRAPPED_OPTIONS: TrappedOptionConfig[] = [
  { key: 'yes', label: 'Yes — People are trapped or in immediate danger', urgent: true },
  { key: 'property', label: 'No — But property or infrastructure at risk', urgent: false },
  { key: 'no', label: 'No — Situation is currently safe', urgent: false },
]

export const COMMUNITY_HELP_TYPES: CommunityHelpType[] = [
  { key: 'shelter', label: 'Shelter', icon: 'Home', description: 'Temporary housing' },
  { key: 'food', label: 'Food & Water', icon: 'Droplets', description: 'Meals or supplies' },
  { key: 'transport', label: 'Transport', icon: 'Car', description: 'Evacuation help' },
  { key: 'medical', label: 'First Aid', icon: 'HeartPulse', description: 'Medical assistance' },
  { key: 'clothing', label: 'Clothing', icon: 'Shirt', description: 'Dry clothes & blankets' },
]

export const LANGUAGES: LanguageOption[] = [
  { code: 'en', label: 'English' }, { code: 'es', label: 'Español' }, { code: 'fr', label: 'Français' },
  { code: 'ar', label: 'العربية' }, { code: 'zh', label: '中文' }, { code: 'hi', label: 'हिन्दी' },
  { code: 'pt', label: 'Português' }, { code: 'pl', label: 'Polski' }, { code: 'ur', label: 'اردو' },
]
