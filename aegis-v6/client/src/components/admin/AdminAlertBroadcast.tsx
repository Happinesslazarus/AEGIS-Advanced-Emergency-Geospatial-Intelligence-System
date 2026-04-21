/**
 * Alert broadcast panel (compose and send emergency alerts). */

import { useState, useMemo, useCallback, useEffect } from 'react'
import {
  Siren, AlertTriangle, CheckCircle, MapPin, Send, Bell,
  FileText, MessageSquare, Globe, History, Radio, ChevronDown, ChevronUp,
  X, Eye, Wifi, Target, Lock,
  Calendar, ToggleLeft, ToggleRight,
  FileWarning, Search, Zap, Link2, Unlink, Clock,
  Flame, Droplets, Wind, Mountain, Thermometer, Power, Shield,
  Building2, ShieldAlert, Waves, HeartPulse, FlaskConical, Radiation, CloudRain
} from 'lucide-react'
import { apiCreateAlert, apiAuditLog } from '../../utils/api'
import type { Alert, Operator, Report } from '../../types'
import AlertCard from '../shared/AlertCard'
import { t } from '../../utils/i18n'
import { useLanguage } from '../../hooks/useLanguage'

/*  Types  */

interface Props {
  alerts: Alert[]
  reports: Report[]
  auditLog: any[]
  setAuditLog: (fn: (prev: any[]) => any[]) => void
  pushNotification: (msg: string, type?: 'success' | 'warning' | 'error' | 'info', duration?: number) => number
  refreshAlerts: () => Promise<void>
  setView: (v: string) => void
  user: Operator | null
  locationName: string
}

/* Report -> Alert mapping helpers */

const SUBTYPE_TO_ALERT_TYPE: Record<string, string> = {
  flood: 'flood', river_flood: 'flood', flash_flood: 'flood', coastal_flood: 'flood',
  surface_water: 'flood', groundwater: 'flood',
  severe_storm: 'severe_storm', storm: 'severe_storm', tornado: 'severe_storm', hurricane: 'severe_storm',
  wildfire: 'wildfire', fire: 'wildfire',
  earthquake: 'earthquake',
  heatwave: 'heatwave',
  landslide: 'landslide', avalanche: 'landslide',
  drought: 'drought',
  power_outage: 'power_outage', power_line: 'power_outage',
  water_supply: 'water_supply', water_supply_disruption: 'water_supply', water_main: 'water_supply',
  infrastructure_damage: 'infrastructure_damage', road_damage: 'infrastructure_damage',
  bridge_damage: 'infrastructure_damage', building_collapse: 'infrastructure_damage',
  structural: 'infrastructure_damage', sinkhole: 'infrastructure_damage', debris: 'infrastructure_damage',
  public_safety_incident: 'public_safety', person_trapped: 'public_safety',
  missing_person: 'public_safety', hazardous_area: 'public_safety',
  environmental_hazard: 'environmental_hazard', pollution: 'environmental_hazard',
  chemical: 'chemical_spill', gas_leak: 'chemical_spill',
  tsunami: 'tsunami', volcanic: 'volcanic',
  mass_casualty: 'pandemic', contamination: 'pandemic',
  evacuation: 'public_safety',
}

const REPORT_SEV_TO_ALERT_SEV: Record<string, 'critical' | 'warning' | 'info'> = {
  High: 'critical', Medium: 'warning', Low: 'info',
  high: 'critical', medium: 'warning', low: 'info',
}

const ALERT_TYPE_LABELS: Record<string, string> = {
  flood: 'Flood', severe_storm: 'Severe Storm', wildfire: 'Wildfire', earthquake: 'Earthquake',
  heatwave: 'Heatwave', landslide: 'Landslide', drought: 'Drought', power_outage: 'Power Outage',
  water_supply: 'Water Supply', infrastructure_damage: 'Infrastructure', public_safety: 'Public Safety',
  environmental_hazard: 'Environmental Hazard', tsunami: 'Tsunami', volcanic: 'Volcanic',
  pandemic: 'Medical Emergency', chemical_spill: 'Chemical Spill', nuclear: 'Nuclear', general: 'General',
}

const DISASTER_ICONS: Record<string, React.ElementType> = {
  flood: Droplets, severe_storm: Wind, wildfire: Flame, earthquake: Zap,
  heatwave: Thermometer, landslide: Mountain, drought: CloudRain, power_outage: Power,
  water_supply: Droplets, infrastructure_damage: Building2, public_safety: ShieldAlert,
  environmental_hazard: Radiation, tsunami: Waves, volcanic: Mountain,
  pandemic: HeartPulse, chemical_spill: FlaskConical, nuclear: Radiation, general: Shield,
}

/* Disaster-specific guidance database for intelligent report generation */
const DISASTER_GUIDANCE: Record<string, {
  impactProfile: string
  protectiveActions: string[]
  evacuationGuidance?: string
  healthRisks: string[]
  infrastructureImpact: string
  estimatedImpactRadius: string
  historicalContext: string
  recoveryTimeline: string
}> = {
  flood: {
    impactProfile: 'Floodwater inundation with potential for rapid water-level rise, structural undermining, and contaminated water hazards.',
    protectiveActions: [
      'Move immediately to higher ground -- do not walk, swim, or drive through floodwaters',
      'Turn off gas, electricity, and water at mains if safe to do so',
      'Avoid contact with floodwater -- risk of sewage contamination and waterborne disease',
      'Do not return to flood-damaged buildings until assessed by structural engineers',
      'Prepare emergency supplies: drinking water, medications, torch, charged phone',
    ],
    evacuationGuidance: 'Evacuate via designated routes AWAY from watercourses. Do not cross flooded roads -- 15cm of fast-flowing water can knock an adult off their feet; 60cm can float a vehicle.',
    healthRisks: ['Hypothermia from cold water exposure', 'Waterborne diseases (E. coli, Leptospirosis)', 'Electrical hazards from submerged wiring', 'Carbon monoxide from generator misuse'],
    infrastructureImpact: 'Roads, bridges, and culverts may be compromised. Water treatment systems may be overwhelmed. Power substations at risk of inundation.',
    estimatedImpactRadius: '2-10km from primary watercourse depending on topography and rainfall intensity',
    historicalContext: 'Ireland experiences significant flood events on average every 5-7 years. OPW flood defences may mitigate but cannot eliminate all risk.',
    recoveryTimeline: '48-72 hours for water recession; 1-4 weeks for structural drying; 2-6 months for full property restoration',
  },
  severe_storm: {
    impactProfile: 'High-velocity winds, heavy precipitation, potential for flying debris, fallen trees, and structural damage to exposed buildings.',
    protectiveActions: [
      'Stay indoors -- shelter in an interior room away from windows',
      'Secure or bring in loose outdoor objects (bins, garden furniture, trampolines)',
      'Avoid coastal areas, exposed headlands, and clifftop walks',
      'Do not shelter under trees or near overhead power lines',
      'Keep emergency kit ready: torch, blankets, battery radio, first aid supplies',
    ],
    evacuationGuidance: 'Evacuation typically not required unless coastal storm surge is expected. If instructed to evacuate, move inland to designated emergency shelters.',
    healthRisks: ['Impact injuries from flying debris', 'Electrocution from downed power lines', 'Hypothermia from exposure', 'Crush injuries from structural collapse'],
    infrastructureImpact: 'Widespread power outages expected. Road blockages from fallen trees. Public transport likely suspended. Mobile networks may be intermittent.',
    estimatedImpactRadius: '50-200km storm track width; localised damage zones within 500m of exposed terrain',
    historicalContext: 'Atlantic storm systems regularly impact Ireland Oct-Mar. Named storms (Storm Eowyn, Storm Darragh) can bring winds exceeding 130km/h.',
    recoveryTimeline: '24-48 hours for immediate debris clearance; 3-7 days for power restoration; 2-8 weeks for structural repairs',
  },
  wildfire: {
    impactProfile: 'Rapid fire spread driven by wind and dry conditions. Smoke inhalation is the primary immediate health threat. Ember transport can ignite spot fires up to 2km ahead of the fire front.',
    protectiveActions: [
      'Evacuate immediately if instructed -- do not delay to protect property',
      'Close all windows and doors to reduce smoke ingress',
      'Wear a damp cloth over nose and mouth if caught in smoke',
      'If trapped, move to a cleared area such as a road, car park, or bare ground',
      'Keep vehicle headlights on and drive slowly if visibility is reduced by smoke',
    ],
    evacuationGuidance: 'Evacuate perpendicular to the fire front -- never try to outrun a wildfire uphill. Follow designated evacuation routes. Assemble at community evacuation points.',
    healthRisks: ['Smoke inhalation -- particulate matter PM2.5 dangerous to respiratory system', 'Burns from radiant heat and direct flame contact', 'Carbon monoxide poisoning', 'Exacerbation of asthma and cardiovascular conditions'],
    infrastructureImpact: 'Power lines at risk of thermal damage. Roads may be blocked by fire fronts. Water pressure may drop as fire services draw supply.',
    estimatedImpactRadius: '1-5km active fire perimeter; smoke hazard extends 20-50km downwind',
    historicalContext: 'Gorse and heather fires are an increasing risk in Ireland during prolonged dry spells, particularly in upland areas.',
    recoveryTimeline: '1-3 days for fire containment; 2-4 weeks for area safety assessment; 1-3 years for ecosystem recovery',
  },
  earthquake: {
    impactProfile: 'Ground shaking with potential for structural damage, aftershocks, and secondary hazards including gas leaks and landslides.',
    protectiveActions: [
      'DROP, COVER, HOLD ON -- shelter under sturdy furniture, protect head and neck',
      'If outdoors, move to an open area away from buildings, trees, and power lines',
      'After shaking stops, check for gas leaks (smell, hissing) -- if detected, leave immediately',
      'Expect aftershocks -- do not re-enter damaged buildings',
      'Check on neighbours, especially elderly or mobility-impaired persons',
    ],
    healthRisks: ['Crush injuries from structural collapse', 'Cuts and lacerations from broken glass', 'Gas inhalation from ruptured lines', 'Psychological trauma and acute stress'],
    infrastructureImpact: 'Buildings may have hidden structural damage. Water and gas mains may rupture. Roads may crack or subside. Bridges require inspection before use.',
    estimatedImpactRadius: '10-50km from epicentre depending on magnitude and depth',
    historicalContext: 'Ireland experiences minor seismic activity (typically M2-M3). While rare, felt earthquakes do occur and can cause localised damage.',
    recoveryTimeline: '1-7 days for structural assessments; 2-12 weeks for repairs depending on damage scale',
  },
  heatwave: {
    impactProfile: 'Sustained high temperatures exceeding physiological tolerance thresholds, particularly dangerous for vulnerable populations.',
    protectiveActions: [
      'Stay hydrated -- drink water regularly even if not thirsty',
      'Avoid outdoor exertion between 11:00-15:00',
      'Keep living spaces cool -- close curtains on sun-facing windows',
      'Check on elderly neighbours, those living alone, and those with chronic conditions',
      'Never leave children or animals in parked vehicles',
    ],
    healthRisks: ['Heat exhaustion and heatstroke', 'Dehydration', 'Cardiovascular strain in vulnerable populations', 'UV radiation burns', 'Ozone-related respiratory issues'],
    infrastructureImpact: 'Rail tracks may buckle. Road surfaces may soften. Increased power demand may cause grid stress. Water supply may be restricted.',
    estimatedImpactRadius: 'Regional -- typically affects entire counties or provinces simultaneously',
    historicalContext: 'Climate change is increasing heatwave frequency and intensity in Ireland. 2022 and 2023 saw record-breaking temperatures exceeding 33C.',
    recoveryTimeline: 'Health impacts resolve within 24-48 hours of temperature drop; drought conditions may persist 2-6 weeks',
  },
  landslide: {
    impactProfile: 'Mass movement of earth, rock, or debris which can bury structures, block roads, and dam waterways causing secondary flooding.',
    protectiveActions: [
      'Move away from the path of the slide immediately -- move uphill or to the side',
      'Listen for unusual sounds: cracking trees, rumbling, or sudden water flow changes',
      'Avoid river valleys and low-lying drainage channels during heavy rain',
      'Do not attempt to cross a landslide area -- the ground may still be unstable',
      'Report any new cracks in ground, walls, or foundations to emergency services',
    ],
    healthRisks: ['Burial and asphyxiation', 'Crush injuries', 'Drowning if watercourse is dammed', 'Exposure if roads are blocked'],
    infrastructureImpact: 'Roads and railways may be completely blocked. Utility pipes and cables may be severed. Buildings on or below slopes at extreme risk.',
    estimatedImpactRadius: '100m-2km depending on slope angle, material volume, and saturation',
    historicalContext: 'Peat slides and bog bursts are specific to Irish conditions. Heavy rainfall on saturated uplands is the primary trigger.',
    recoveryTimeline: '1-5 days for road clearance; 2-8 weeks for slope stabilisation; 3-12 months for full remediation',
  },
  drought: {
    impactProfile: 'Prolonged precipitation deficit leading to water supply stress, agricultural impacts, and increased wildfire risk.',
    protectiveActions: [
      'Conserve water -- fix leaks, take shorter showers, reuse greywater for gardens',
      'Follow any water restrictions or hosepipe bans issued by Irish Water',
      'Be aware of increased wildfire risk -- do not burn rubbish or light campfires',
      'Farmers should engage with DAFM drought support measures',
      'Monitor water supply updates from your local authority',
    ],
    healthRisks: ['Dehydration in vulnerable populations', 'Reduced air quality from dust', 'Mental health impacts on farming communities', 'Waterborne disease risk from low reservoir levels'],
    infrastructureImpact: 'Water treatment plants may operate at reduced capacity. Ground subsidence risk to foundations. Agriculture sector heavily impacted.',
    estimatedImpactRadius: 'Regional to national -- drought conditions typically affect large areas simultaneously',
    historicalContext: 'Ireland experienced notable droughts in 2018 and 2022. Climate projections suggest increasing frequency of summer drought periods.',
    recoveryTimeline: '2-8 weeks of sustained rainfall needed for water table recovery; agricultural impact lasts one growing season',
  },
  power_outage: {
    impactProfile: 'Loss of electrical supply affecting domestic, commercial, and critical infrastructure systems.',
    protectiveActions: [
      'Report the outage to ESB Networks (1800 372 999) if not already logged',
      'Unplug sensitive electronics to protect from power surges when supply is restored',
      'Use torches instead of candles to reduce fire risk',
      'Keep fridge and freezer doors closed -- food stays safe for 4hrs (fridge) / 24-48hrs (freezer)',
      'Check on medically vulnerable neighbours who depend on powered equipment',
    ],
    healthRisks: ['Hypothermia in cold weather without heating', 'Carbon monoxide from indoor generator use', 'Food safety risks from spoilage', 'Medical device failure for home-care patients'],
    infrastructureImpact: 'Traffic lights may fail. Water pumping stations may lose pressure. Broadband and phone networks may fail as backup batteries deplete.',
    estimatedImpactRadius: '500m-20km depending on cause (local transformer vs regional grid fault)',
    historicalContext: 'Storm-related power outages in Ireland can affect tens of thousands of customers. ESB Networks typically restores supply within 24-72 hours.',
    recoveryTimeline: 'Minor faults: 2-6 hours. Storm damage: 24-72 hours. Major grid events: up to 1 week for remote areas.',
  },
  infrastructure_damage: {
    impactProfile: 'Structural compromise to built infrastructure including roads, bridges, buildings, or utility networks.',
    protectiveActions: [
      'Do not enter or approach damaged structures -- risk of further collapse',
      'Follow road closure diversions and barrier instructions',
      'Report any structural damage you observe to your local authority',
      'If you hear cracking or groaning from a structure, evacuate the area immediately',
      'Photograph damage from a safe distance for insurance documentation',
    ],
    healthRisks: ['Crush injuries from collapse', 'Exposure to asbestos or hazardous materials in older buildings', 'Falls into sinkholes or void spaces'],
    infrastructureImpact: 'Transport routes may require significant diversions. Adjacent buildings may need precautionary evacuation. Utility services may be disrupted.',
    estimatedImpactRadius: '50-500m exclusion zone typical for structural collapse; sinkhole zones may extend further',
    historicalContext: 'Aging infrastructure and increasingly extreme weather events are accelerating structural degradation across Ireland.',
    recoveryTimeline: 'Emergency shoring: 24-48 hours. Temporary repairs: 1-4 weeks. Full reconstruction: 3-18 months depending on scale.',
  },
  public_safety: {
    impactProfile: 'Incident affecting public safety requiring emergency response coordination and potential area restrictions.',
    protectiveActions: [
      'Follow all instructions from An Garda Siochana and emergency services',
      'Avoid the incident area -- do not approach out of curiosity',
      'If you have information relevant to a missing person, contact Gardai immediately',
      'Keep phone lines clear for emergency communications',
      'Share only verified information -- do not spread rumours on social media',
    ],
    healthRisks: ['Varies by incident type', 'Psychological impact on witnesses and community', 'Secondary risks from crowd dynamics'],
    infrastructureImpact: 'Road closures and cordons likely. Public spaces may be restricted. Transport services may be rerouted.',
    estimatedImpactRadius: '200m-2km cordon zone typical; wider area for search operations',
    historicalContext: 'Multi-agency response protocols (MARR) are activated for significant public safety incidents in Ireland.',
    recoveryTimeline: 'Active phase: hours to days depending on incident. Community impact: weeks to months for serious incidents.',
  },
  environmental_hazard: {
    impactProfile: 'Release of pollutants or hazardous substances into the environment affecting air, water, or soil quality.',
    protectiveActions: [
      'Stay away from the contamination source -- maintain safe distance upwind/upstream',
      'Close windows and doors, switch off ventilation systems',
      'Do not consume water from potentially affected sources (rivers, wells)',
      'If exposed to unknown substances, wash skin thoroughly and seek medical advice',
      'Keep pets indoors and away from affected areas',
    ],
    healthRisks: ['Respiratory irritation from airborne contaminants', 'Skin and eye irritation', 'Long-term health effects from chronic exposure', 'Contaminated water supply risks'],
    infrastructureImpact: 'Water treatment may need emergency filtration. Agricultural land may be quarantined. Fisheries may be closed.',
    estimatedImpactRadius: 'Airborne: 1-10km downwind. Waterborne: entire downstream catchment. Soil: localised to deposition zone.',
    historicalContext: 'EPA Ireland monitors environmental incidents. Significant events require statutory notification under the Environmental Protection Act.',
    recoveryTimeline: 'Air quality: hours to days. Water contamination: days to weeks. Soil remediation: months to years.',
  },
  chemical_spill: {
    impactProfile: 'Release of hazardous chemical substances with potential for toxic exposure, fire, or explosion risk.',
    protectiveActions: [
      'EVACUATE IMMEDIATELY if instructed -- move upwind and uphill from the spill',
      'Do not touch, smell, or taste any unidentified substances',
      'Remove contaminated clothing and bag it separately',
      'If exposed: wash skin with copious water for 20 minutes minimum',
      'Inform emergency services of any known chemical names or HAZCHEM codes',
    ],
    evacuationGuidance: 'Evacuate at minimum 300m upwind. For volatile chemicals, extend to 1km. Follow HAZCHEM board guidance on container/vehicle if visible.',
    healthRisks: ['Acute chemical burns', 'Toxic inhalation syndrome', 'Chemical sensitisation', 'Delayed onset organ damage depending on substance'],
    infrastructureImpact: 'Road closures for HAZMAT response. Waterways may need emergency booming. Drainage systems may need to be isolated.',
    estimatedImpactRadius: '300m-3km evacuation zone depending on substance volatility and quantity',
    historicalContext: 'SEVESO directive sites in Ireland are mapped and have emergency plans. Transport incidents are managed under ADR regulations.',
    recoveryTimeline: 'Neutralisation: 6-48 hours. Decontamination: 1-4 weeks. Environmental monitoring: 3-12 months.',
  },
  tsunami: {
    impactProfile: 'Ocean wave event with potential for coastal inundation, powerful currents, and debris-laden water impact.',
    protectiveActions: [
      'Move immediately to high ground or inland -- 30m elevation or 3km from coast minimum',
      'Do not wait for visual confirmation -- act on warnings immediately',
      'Waves may arrive in a series over hours -- do not return to coast after first wave',
      'If caught in water, grab a floating object and allow current to carry you',
      'Stay away from harbours, marinas, and river mouths',
    ],
    evacuationGuidance: 'Evacuate ALL coastal areas below 30m elevation. Move inland via routes perpendicular to the coast. Do not use coastal roads.',
    healthRisks: ['Drowning', 'Crush injuries from debris', 'Hypothermia', 'Waterborne disease from contaminated floodwater'],
    infrastructureImpact: 'Coastal infrastructure may be destroyed. Ports and harbours inoperable. Salt water intrusion to freshwater systems.',
    estimatedImpactRadius: 'Coastal zone to 5km inland depending on topography. All areas below 30m elevation at risk.',
    historicalContext: 'While rare, tsunami risk exists for Ireland from Atlantic seismic sources (e.g., Azores-Gibraltar fault). The 1755 Lisbon earthquake generated waves that reached Ireland.',
    recoveryTimeline: 'Water recession: hours. Search and rescue: 1-7 days. Infrastructure rebuild: months to years.',
  },
  pandemic: {
    impactProfile: 'Public health emergency with potential for mass casualty, healthcare system strain, and communal resource depletion.',
    protectiveActions: [
      'Follow all HSE and public health guidance',
      'Maintain hygiene protocols -- handwashing, respiratory etiquette',
      'If symptomatic, self-isolate and contact your GP by phone',
      'Keep essential medications stocked for 2 weeks minimum',
      'Check on vulnerable neighbours while maintaining appropriate precautions',
    ],
    healthRisks: ['Direct illness from pathogen exposure', 'Healthcare system overwhelm', 'Mental health decline from isolation', 'Delayed treatment for other conditions'],
    infrastructureImpact: 'Hospitals may activate surge capacity. Schools and public buildings may close. Supply chains may be disrupted.',
    estimatedImpactRadius: 'Community-wide to national depending on transmission dynamics',
    historicalContext: 'COVID-19 demonstrated the severe impact pandemics can have on Irish society and healthcare systems.',
    recoveryTimeline: 'Acute wave: 4-12 weeks. Healthcare recovery: 3-6 months. Societal normalisation: 6-24 months.',
  },
  general: {
    impactProfile: 'Emergency incident requiring coordinated response and public awareness.',
    protectiveActions: [
      'Follow instructions from emergency services and local authorities',
      'Stay clear of the affected area',
      'Monitor official channels for updates (local radio, council website)',
      'Share only verified information',
      'Prepare a personal emergency kit as a precautionary measure',
    ],
    healthRisks: ['Dependent on specific incident type', 'Stress and anxiety from uncertainty'],
    infrastructureImpact: 'Localised disruption possible to transport and utilities.',
    estimatedImpactRadius: 'Variable -- follow exclusion zone instructions from responding agencies',
    historicalContext: 'Ireland maintains comprehensive emergency management frameworks through the National Emergency Coordination Group.',
    recoveryTimeline: 'Variable depending on incident scope and severity.',
  },
}

function generateSmartTitle(report: Report): string {
  const sevWord = report.severity === 'High' ? 'CRITICAL' : report.severity === 'Medium' ? 'WARNING' : 'ADVISORY'
  const subtype = report.incidentSubtype || ''
  const alertType = SUBTYPE_TO_ALERT_TYPE[subtype] || 'general'
  const typeLabel = ALERT_TYPE_LABELS[alertType] || report.type || subtype.replace(/_/g, ' ') || 'Incident'
  const capType = typeLabel.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ')
  const locParts = (report.location || '').split(',').map(s => s.trim()).filter(Boolean)
  const loc = locParts.length >= 2 ? `${locParts[0]}, ${locParts[1]}` : locParts[0] || 'Affected Area'
  const time = new Date().toLocaleTimeString('en-IE', { hour: '2-digit', minute: '2-digit' })
  return `${sevWord}: ${capType} Alert -- ${loc} [${time}]`
}

function generateSmartMessage(report: Report): string {
  const lines: string[] = []
  const subtype = report.incidentSubtype || ''
  const alertType = SUBTYPE_TO_ALERT_TYPE[subtype] || 'general'
  const typeLabel = ALERT_TYPE_LABELS[alertType] || report.type || subtype.replace(/_/g, ' ') || 'Incident'
  const guidance = DISASTER_GUIDANCE[alertType] || DISASTER_GUIDANCE.general
  const sevLabel = report.severity === 'High' ? 'CRITICAL' : report.severity === 'Medium' ? 'WARNING' : 'ADVISORY'
  const sevDesc = report.severity === 'High' ? 'Immediate life-threatening danger' : report.severity === 'Medium' ? 'Elevated threat -- take precautions' : 'Situational awareness -- monitor developments'
  const locParts = (report.location || '').split(',').map(s => s.trim()).filter(Boolean)
  const loc = locParts.length >= 2 ? `${locParts[0]}, ${locParts[1]}` : locParts[0] || 'Affected Area'
  const now = new Date()
  const timestamp = now.toLocaleDateString('en-IE', { day: 'numeric', month: 'short', year: 'numeric' }) + ' ' + now.toLocaleTimeString('en-IE', { hour: '2-digit', minute: '2-digit' })

  lines.push(`AEGIS EMERGENCY ALERT -- ${sevLabel}`)
  lines.push(`Type: ${typeLabel} | Severity: ${sevDesc}`)
  lines.push(`Location: ${report.location || 'Affected Area'}`)
  lines.push(`Issued: ${timestamp}`)
  lines.push(`Ref: ${report.reportNumber || 'N/A'}`)

  lines.push('')
  lines.push('--- SITUATION ASSESSMENT ---')
  lines.push(guidance.impactProfile)

  if (report.description) {
    const desc = report.description.length > 400 ? report.description.slice(0, 400) + '...' : report.description
    lines.push('')
    lines.push(`Field Report: ${desc}`)
  }

  if (report.trappedPersons === 'yes') {
    lines.push('')
    lines.push('PERSONS REPORTED TRAPPED -- Search and rescue operations are being coordinated. If you are trapped: make noise, conserve energy, and cover your mouth to filter dust.')
  }

  lines.push('')
  lines.push('--- IMPACT ANALYSIS ---')
  lines.push(`Estimated Impact Radius: ${guidance.estimatedImpactRadius}`)
  lines.push(`Infrastructure Risk: ${guidance.infrastructureImpact}`)

  lines.push('')
  lines.push('--- PROTECTIVE ACTIONS (REQUIRED) ---')
  guidance.protectiveActions.forEach((action, i) => {
    lines.push(`${i + 1}. ${action}`)
  })

  if (guidance.evacuationGuidance && (report.severity === 'High' || report.severity === 'Medium')) {
    lines.push('')
    lines.push('--- EVACUATION GUIDANCE ---')
    lines.push(guidance.evacuationGuidance)
  }

  lines.push('')
  lines.push('--- HEALTH & SAFETY RISKS ---')
  guidance.healthRisks.forEach(risk => {
    lines.push(`- ${risk}`)
  })

  lines.push('')
  lines.push('--- RECOVERY TIMELINE ---')
  lines.push(guidance.recoveryTimeline)

  lines.push('')
  lines.push('--- CONTEXT ---')
  lines.push(guidance.historicalContext)

  lines.push('')
  lines.push('--- END OF ALERT ---')
  lines.push(`This is an official emergency communication from AEGIS.`)
  lines.push(`Monitor aegis.ie and local radio for updates.`)
  lines.push(`Emergency Services: 999 / 112`)

  return lines.join('\n')
}

type Severity = 'critical' | 'warning' | 'info'

interface ChannelState {
  web: boolean
  telegram: boolean
  email: boolean
  sms: boolean
  whatsapp: boolean
}

interface DeliveryResult {
  attempted: number
  sent: number
  failed: number
  results?: Array<{ channel: string; recipient: string; success: boolean; error?: string }>
}

/*  Severity Config  */

const SEVERITY_CONFIG = {
  critical: {
    label: 'Critical',
    desc: 'Immediate life-threatening danger',
    gradient: 'from-red-800 via-red-900 to-rose-900',
    headerBg: 'bg-gradient-to-br from-red-800 via-red-900 to-rose-900',
    dot: 'bg-red-500',
    activeBg: 'bg-red-100 dark:bg-red-950/30',
    activeText: 'text-red-700 dark:text-red-300',
    activeBorder: 'border-red-400 dark:border-red-600',
    ring: 'ring-red-400',
    badge: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
    previewBorder: 'border-red-500',
    previewBg: 'bg-red-50 dark:bg-red-950/20',
    btnGradient: 'from-red-600 to-rose-700 hover:from-red-700 hover:to-rose-800',
    btnShadow: 'shadow-red-500/25',
    iconPulse: true,
  },
  warning: {
    label: 'Warning',
    desc: 'Potential threat -- take precautions',
    gradient: 'from-amber-700 via-amber-800 to-orange-800',
    headerBg: 'bg-gradient-to-br from-amber-700 via-amber-800 to-orange-800',
    dot: 'bg-amber-500',
    activeBg: 'bg-amber-100 dark:bg-amber-950/30',
    activeText: 'text-amber-700 dark:text-amber-300',
    activeBorder: 'border-amber-400 dark:border-amber-600',
    ring: 'ring-amber-400',
    badge: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
    previewBorder: 'border-amber-500',
    previewBg: 'bg-amber-50 dark:bg-amber-950/20',
    btnGradient: 'from-amber-600 to-orange-700 hover:from-amber-700 hover:to-orange-800',
    btnShadow: 'shadow-amber-500/25',
    iconPulse: false,
  },
  info: {
    label: 'Advisory',
    desc: 'Situational awareness update',
    gradient: 'from-blue-800 via-blue-900 to-indigo-900',
    headerBg: 'bg-gradient-to-br from-blue-800 via-blue-900 to-indigo-900',
    dot: 'bg-blue-500',
    activeBg: 'bg-blue-100 dark:bg-blue-950/30',
    activeText: 'text-blue-700 dark:text-blue-300',
    activeBorder: 'border-blue-400 dark:border-blue-600',
    ring: 'ring-blue-400',
    badge: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
    previewBorder: 'border-blue-500',
    previewBg: 'bg-blue-50 dark:bg-blue-950/20',
    btnGradient: 'from-blue-600 to-indigo-700 hover:from-blue-700 hover:to-indigo-800',
    btnShadow: 'shadow-blue-500/25',
    iconPulse: false,
  },
}

/*  Channel Config  */

function getChannels(lang: string): { key: keyof ChannelState; label: string; icon: any; bg: string; text: string; border: string; desc: string }[] {
  return [
    { key: 'web',      label: 'Web Push',  icon: Bell,           bg: 'bg-blue-100 dark:bg-blue-900/30',    text: 'text-blue-600',    border: 'border-blue-400', desc: 'Browser notifications' },
    { key: 'telegram', label: 'Telegram',  icon: Send,           bg: 'bg-sky-100 dark:bg-sky-900/30',      text: 'text-sky-600',     border: 'border-sky-400',  desc: 'Telegram bot message' },
    { key: 'email',    label: 'Email',     icon: FileText,       bg: 'bg-emerald-100 dark:bg-emerald-900/30', text: 'text-emerald-600', border: 'border-emerald-400', desc: 'Email with HTML template' },
    { key: 'sms',      label: 'SMS',       icon: MessageSquare,  bg: 'bg-violet-100 dark:bg-violet-900/30', text: 'text-violet-600',  border: 'border-violet-400', desc: 'Text message (160 char)' },
    { key: 'whatsapp', label: 'WhatsApp',  icon: Globe,          bg: 'bg-green-100 dark:bg-green-900/30',  text: 'text-green-600',   border: 'border-green-400', desc: 'WhatsApp message' },
  ]
}

/*  SMS segment estimator  */

function smsSegments(text: string): number {
  if (!text) return 0
  const hasMB = /[^\x00-\x7F]/.test(text)
  return hasMB ? Math.ceil(text.length / 70) : Math.ceil(text.length / 160)
}

export default function AdminAlertBroadcast({
  alerts, reports, auditLog, setAuditLog, pushNotification, refreshAlerts, setView, user, locationName
}: Props) {
  const lang = useLanguage()
  const channelOptions = useMemo(() => getChannels(lang), [lang])

  //Report-linked mode state
  const [mode, setMode] = useState<'report' | 'custom'>('report')
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null)
  const [reportSearch, setReportSearch] = useState('')

  // Form state
  const [form, setForm] = useState({ title: '', message: '', severity: 'warning' as Severity, location: '', alertType: 'general', expiresAt: '' })
  const [channels, setChannels] = useState<ChannelState>({ web: true, telegram: true, email: true, sms: true, whatsapp: true })
  const [sending, setSending] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [deliveryResult, setDeliveryResult] = useState<DeliveryResult | null>(null)
  const [previewChannel, setPreviewChannel] = useState<'card' | 'sms' | 'email' | 'telegram' | 'whatsapp' | 'web'>('card')
  const [showHistory, setShowHistory] = useState(true)

  //Filtered & sorted reports for picker
  const actionableReports = useMemo(() => {
    const active = reports.filter(r =>
      r.status !== 'Resolved' && r.status !== 'Archived' && r.status !== 'False_Report'
    )
    const q = reportSearch.toLowerCase().trim()
    const filtered = q
      ? active.filter(r =>
          (r.reportNumber || '').toLowerCase().includes(q) ||
          (r.location || '').toLowerCase().includes(q) ||
          (r.type || '').toLowerCase().includes(q) ||
          (r.description || '').toLowerCase().includes(q) ||
          (r.incidentSubtype || '').toLowerCase().includes(q)
        )
      : active
    return filtered.sort((a, b) => {
      const sevOrder: Record<string, number> = { High: 0, Medium: 1, Low: 2 }
      const statusOrder: Record<string, number> = { Urgent: 0, Flagged: 1, Verified: 2, Unverified: 3 }
      const sDiff = (sevOrder[a.severity] ?? 3) - (sevOrder[b.severity] ?? 3)
      if (sDiff !== 0) return sDiff
      return (statusOrder[a.status] ?? 9) - (statusOrder[b.status] ?? 9)
    })
  }, [reports, reportSearch])

  const selectedReport = useMemo(() =>
    selectedReportId ? reports.find(r => r.id === selectedReportId) || null : null,
  [reports, selectedReportId])

  //When a report is selected, auto-populate all form fields
  const handleSelectReport = useCallback((report: Report) => {
    setSelectedReportId(report.id)
    const alertType = SUBTYPE_TO_ALERT_TYPE[report.incidentSubtype] || SUBTYPE_TO_ALERT_TYPE[report.type?.toLowerCase()] || 'general'
    const severity = REPORT_SEV_TO_ALERT_SEV[report.severity] || 'warning'
    setForm({
      title: generateSmartTitle(report),
      message: generateSmartMessage(report),
      severity,
      location: report.location || '',
      alertType,
      expiresAt: (() => {
        const d = new Date()
        d.setHours(d.getHours() + (severity === 'critical' ? 6 : severity === 'warning' ? 12 : 24))
        return d.toISOString().slice(0, 16)
      })(),
    })
  }, [])

  const handleUnlinkReport = useCallback(() => {
    setSelectedReportId(null)
  }, [])

  const cfg = SEVERITY_CONFIG[form.severity]
  const activeChannels = useMemo(() => Object.entries(channels).filter(([, v]) => v).map(([k]) => k), [channels])
  const canSend = form.title.trim().length > 0 && form.message.trim().length > 0 && activeChannels.length > 0

  //Keyboard shortcuts
  const [showKeyboard, setShowKeyboard] = useState(false)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      const key = e.key.toLowerCase()
      if (key === 'h') { e.preventDefault(); setShowHistory(p => !p) }
      else if (key === '?' || (e.shiftKey && key === '/')) { e.preventDefault(); setShowKeyboard(p => !p) }
      else if (key === 'escape') { e.preventDefault(); setShowKeyboard(false); setShowConfirm(false) }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [])

  //SMS info
  const fullSmsText = useMemo(() => {
    const sev = form.severity === 'critical' ? 'CRITICAL' : form.severity === 'warning' ? 'WARNING' : 'ADVISORY'
    const area = form.location || ''
    return `AEGIS ALERT [${sev}]\n\n${form.title}${area ? `\n${area}` : ''}\n\n${form.message}`
  }, [form])
  const segments = smsSegments(fullSmsText)

  // Send handler
  const handleSend = useCallback(async () => {
    if (!canSend || sending) return
    setSending(true)
    setDeliveryResult(null)
    try {
      const response: any = await apiCreateAlert({
        title: form.title,
        message: form.message,
        severity: form.severity,
        alertType: form.alertType,
        locationText: form.location,
        channels: activeChannels,
        ...(form.expiresAt ? { expiresAt: new Date(form.expiresAt).toISOString() } : {}),
      })
      await refreshAlerts()
      apiAuditLog({
        operator_name: user?.displayName,
        action: `Broadcast alert: ${form.title} via ${activeChannels.join(', ')}${selectedReport ? ` (from ${selectedReport.reportNumber || `RPT-${selectedReport.id.slice(0, 6).toUpperCase()}`})` : ''}`,
        action_type: 'alert_send',
        target_type: 'alert',
      }).catch(() => {})
      setAuditLog(prev => [{
        id: Date.now(),
        operator_name: user?.displayName,
        action: `Broadcast alert: ${form.title} via ${activeChannels.join(', ')}${selectedReport ? ` (from ${selectedReport.reportNumber || `RPT-${selectedReport.id.slice(0, 6).toUpperCase()}`})` : ''}`,
        action_type: 'alert_send',
        created_at: new Date().toISOString(),
      }, ...prev])

      const delivered = response?.delivery?.sent ?? 0
      const attempted = response?.delivery?.attempted ?? 0
      const failed = response?.delivery?.failed ?? 0

      setDeliveryResult({ attempted, sent: delivered, failed, results: response?.delivery?.results })

      if (attempted === 0) {
        pushNotification('Alert saved but no subscribers found. Citizens need to subscribe first.', 'warning')
      } else if (failed > 0) {
        pushNotification(`${'Broadcast complete -- some deliveries failed'}: ${delivered}/${attempted} -- ${failed} ${'Failed'}`, 'warning')
      } else {
        pushNotification(`${'Broadcast successful'}: ${delivered}/${attempted} via ${activeChannels.join(', ')}`, 'success')
      }
      setForm({ title: '', message: '', severity: 'warning', location: '', alertType: 'general', expiresAt: '' })
      setSelectedReportId(null)
      setShowConfirm(false)
    } catch (err: any) {
      pushNotification(err?.message || 'Failed to broadcast alert', 'error')
      setShowConfirm(false)
    } finally {
      setSending(false)
    }
  }, [canSend, sending, form, activeChannels, user, refreshAlerts, setAuditLog, pushNotification])

  //Mock alert for live card preview
  const previewAlert = useMemo((): Alert => ({
    id: 'preview',
    severity: form.severity === 'critical' ? 'critical' : form.severity === 'warning' ? 'medium' : 'low',
    title: form.title || 'e.g. Flash Flood Warning -- River District',
    message: form.message || '',
    area: form.location || '',
    source: 'operator',
    timestamp: new Date().toISOString(),
    displayTime: 'Just now',
    active: true,
    channels: activeChannels as any[],
    disasterType: form.alertType || 'general',
    expiresAt: form.expiresAt ? new Date(form.expiresAt).toISOString() : null,
  }), [form, activeChannels, lang])

  // Channel message preview
  const previewText = useMemo(() => {
    const sev = form.severity.toUpperCase()
    const title = form.title || 'Alert Title'
    const msg = form.message || 'Alert message will appear here...'
    const area = form.location || ''
    const areaLine = area ? `\nArea: ${area}` : ''
    switch (previewChannel) {
      case 'sms':
        return `AEGIS ALERT [${sev}]\n\n${title}${areaLine}\n\n${msg}`
      case 'telegram':
        return `*AEGIS ALERT* [${sev}]\n\n*${title}*${areaLine}\n\n${msg}\n\n---\nAutomated alert from AEGIS Emergency Management System.`
      case 'whatsapp':
        return `*AEGIS ALERT* [${sev}]\n\n*${title}*${areaLine}\n\n${msg}\n\n---\nAutomated alert from AEGIS Emergency Management System.`
      case 'web':
        return `${sev}: ${title}\n${areaLine ? areaLine + '\n' : ''}${msg}`
      default: // email
        return `Subject: ${sev} ALERT - ${title}\n\nAEGIS Emergency Management System\n\n${title}${areaLine}\n\n${msg}\n\nThis is an automated alert from the AEGIS Emergency Management System.`
    }
  }, [form, previewChannel])

  return (
    <div className="max-w-3xl mx-auto animate-fade-in space-y-5">

      {/*  HEADER  */}
      <div className={`${cfg.headerBg} rounded-2xl shadow-2xl overflow-hidden relative`}>
        <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGNpcmNsZSBjeD0iMjAiIGN5PSIyMCIgcj0iMSIgZmlsbD0icmdiYSgyNTUsMjU1LDI1NSwwLjAzKSIvPjwvc3ZnPg==')] opacity-50" />
        <div className="relative z-10 p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className={`w-12 h-12 rounded-xl flex items-center justify-center border border-white/20 ${form.severity === 'critical' ? 'bg-red-500/20' : 'bg-white/10'}`}>
              <Siren className={`w-6 h-6 ${cfg.iconPulse ? 'text-red-200 animate-pulse' : 'text-white'}`} />
            </div>
            <div>
              <h2 className="text-white font-bold text-xl tracking-tight">{'Alert Broadcast Centre'}</h2>
              <p className="text-white/60 text-sm">{'Multi-channel emergency alert distribution'}</p>
            </div>
          </div>

          {/* Header stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {/* Active Alerts */}
            <div className="bg-white/5 rounded-xl p-3 border border-white/10 hover:border-white/20 transition-colors">
              <div className="flex items-center gap-1.5 mb-1">
                <Radio className="w-3 h-3 text-red-300 opacity-70" />
                <p className="text-[10px] text-white/50 uppercase tracking-wider font-semibold">{'Alerts'}</p>
              </div>
              <p className="text-lg font-bold text-red-300">{alerts.filter(a => a.active).length}</p>
            </div>
            {/* Channels */}
            <div className="bg-white/5 rounded-xl p-3 border border-white/10 hover:border-white/20 transition-colors">
              <div className="flex items-center gap-1.5 mb-1">
                <Wifi className="w-3 h-3 text-green-300 opacity-70" />
                <p className="text-[10px] text-white/50 uppercase tracking-wider font-semibold">{'Delivery Channels'}</p>
              </div>
              <p className="text-lg font-bold text-green-300">{activeChannels.length}/5</p>
            </div>
            {/* Affected Area */}
            <div className="bg-white/5 rounded-xl p-3 border border-white/10 hover:border-white/20 transition-colors" title={form.location || undefined}>
              <div className="flex items-center gap-1.5 mb-1">
                <Target className={`w-3 h-3 ${form.location ? 'text-cyan-300' : 'text-white/30'} opacity-70`} />
                <p className="text-[10px] text-white/50 uppercase tracking-wider font-semibold">{'Affected Area'}</p>
              </div>
              {form.location ? (
                <p className="text-sm font-bold text-cyan-300 leading-tight line-clamp-2 break-words">
                  {form.location.split(',').slice(0, 2).join(',').trim()}
                </p>
              ) : (
                <p className="text-lg font-bold text-white/30">--</p>
              )}
            </div>
            {/* Operator */}
            <div className="bg-white/5 rounded-xl p-3 border border-white/10 hover:border-white/20 transition-colors" title={user?.displayName || ''}>
              <div className="flex items-center gap-1.5 mb-1">
                <Lock className="w-3 h-3 text-purple-300 opacity-70" />
                <p className="text-[10px] text-white/50 uppercase tracking-wider font-semibold">{'Operator'}</p>
              </div>
              <p className="text-xs font-bold text-purple-300 leading-tight break-words line-clamp-2">
                {user?.displayName || 'System'}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/*  REPORT SOURCE PICKER  */}
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-lg overflow-hidden">
        <div className="p-5">
          {/* Mode Toggle */}
          <div className="flex items-center gap-2 mb-4">
            <label className="text-xs font-bold text-gray-600 dark:text-gray-300 uppercase tracking-wider">{'Alert Source'}</label>
            <div className="flex-1" />
            <div className="flex bg-gray-100 dark:bg-gray-800 rounded-xl p-0.5">
              <button
                onClick={() => { setMode('report'); setSelectedReportId(null) }}
                className={`px-3 py-1.5 rounded-lg text-[11px] font-bold transition-all flex items-center gap-1.5 ${
                  mode === 'report'
                    ? 'bg-white dark:bg-gray-700 text-purple-700 dark:text-purple-300 shadow-sm'
                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-700'
                }`}
              >
                <Link2 className="w-3 h-3" /> {'From Report'}
              </button>
              <button
                onClick={() => { setMode('custom'); setSelectedReportId(null); setForm({ title: '', message: '', severity: 'warning', location: '', alertType: 'general', expiresAt: '' }) }}
                className={`px-3 py-1.5 rounded-lg text-[11px] font-bold transition-all flex items-center gap-1.5 ${
                  mode === 'custom'
                    ? 'bg-white dark:bg-gray-700 text-purple-700 dark:text-purple-300 shadow-sm'
                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-700'
                }`}
              >
                <FileText className="w-3 h-3" /> {'Custom Alert'}
              </button>
            </div>
          </div>

          {/* Report Picker (only in report mode) */}
          {mode === 'report' && (
            <div className="space-y-3">
              {/* Selected report badge */}
              {selectedReport && (
                <div className={`flex items-center gap-3 p-3 rounded-xl border-2 ${
                  selectedReport.severity === 'High' ? 'border-red-300 bg-red-50 dark:border-red-700 dark:bg-red-950/20'
                  : selectedReport.severity === 'Medium' ? 'border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/20'
                  : 'border-blue-300 bg-blue-50 dark:border-blue-700 dark:bg-blue-950/20'
                }`}>
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                    selectedReport.severity === 'High' ? 'bg-red-100 dark:bg-red-900/40' : selectedReport.severity === 'Medium' ? 'bg-amber-100 dark:bg-amber-900/40' : 'bg-blue-100 dark:bg-blue-900/40'
                  }`}>
                    {(() => { const Icon = DISASTER_ICONS[SUBTYPE_TO_ALERT_TYPE[selectedReport.incidentSubtype] || 'general'] || Shield; return <Icon className="w-4 h-4 text-gray-700 dark:text-gray-300" /> })()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-bold text-purple-600 dark:text-purple-400 bg-purple-100 dark:bg-purple-900/30 px-1.5 py-0.5 rounded font-mono">
                        {selectedReport.reportNumber || `RPT-${selectedReport.id.slice(0, 6).toUpperCase()}`}
                      </span>
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                        selectedReport.severity === 'High' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
                        : selectedReport.severity === 'Medium' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
                        : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
                      }`}>{selectedReport.severity}</span>
                      <span className="text-[10px] font-medium text-gray-500 dark:text-gray-400 capitalize">{(selectedReport.type || selectedReport.incidentSubtype || '').replace(/_/g, ' ')}</span>
                    </div>
                    <p className="text-xs font-semibold text-gray-800 dark:text-gray-200 truncate mt-0.5">{selectedReport.location}</p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-bold flex items-center gap-1"><Link2 className="w-3 h-3" /> {'Linked'}</span>
                    <button onClick={handleUnlinkReport} className="p-1 rounded-lg hover:bg-white/50 dark:hover:bg-gray-700 transition-colors" title={'Unlink report'}>
                      <Unlink className="w-3.5 h-3.5 text-gray-400 hover:text-red-500" />
                    </button>
                  </div>
                </div>
              )}

              {/* Report search + list (only when no report selected) */}
              {!selectedReport && (
                <>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <input
                      className="w-full pl-10 pr-4 py-2.5 text-sm bg-gray-50 dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 focus:ring-2 focus:ring-purple-500 outline-none"
                      placeholder={'Search reports by ID, location, or type...'}
                      value={reportSearch}
                      onChange={e => setReportSearch(e.target.value)}
                    />
                  </div>

                  {actionableReports.length === 0 ? (
                    <div className="text-center py-6">
                      <FileWarning className="w-8 h-8 text-gray-300 dark:text-gray-400 mx-auto mb-2" />
                      <p className="text-xs text-gray-500 dark:text-gray-400">{reportSearch ? 'No reports match your search' : 'No active reports available'}</p>
                      <button onClick={() => setMode('custom')} className="text-[11px] text-purple-600 dark:text-purple-400 font-semibold mt-2 hover:underline">
                        {'Switch to custom alert instead'}
                      </button>
                    </div>
                  ) : (
                    <div className="max-h-[240px] overflow-y-auto space-y-1 pr-1">
                      {actionableReports.slice(0, 15).map(r => {
                        const Icon = DISASTER_ICONS[SUBTYPE_TO_ALERT_TYPE[r.incidentSubtype] || 'general'] || Shield
                        return (
                          <button
                            key={r.id}
                            onClick={() => handleSelectReport(r)}
                            className="w-full flex items-center gap-3 p-3 rounded-xl border border-gray-200 dark:border-gray-700 hover:border-purple-400 dark:hover:border-purple-600 hover:bg-purple-50/50 dark:hover:bg-purple-950/10 transition-all text-left group"
                          >
                            <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
                              r.severity === 'High' ? 'bg-red-100 dark:bg-red-900/30' : r.severity === 'Medium' ? 'bg-amber-100 dark:bg-amber-900/30' : 'bg-blue-100 dark:bg-blue-900/30'
                            }`}>
                              <Icon className={`w-4 h-4 ${r.severity === 'High' ? 'text-red-600' : r.severity === 'Medium' ? 'text-amber-600' : 'text-blue-600'}`} />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-0.5">
                                <span className="text-[10px] font-bold text-purple-600 dark:text-purple-400 font-mono">{r.reportNumber || `RPT-${r.id.slice(0, 6).toUpperCase()}`}</span>
                                <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold ${
                                  r.severity === 'High' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
                                  : r.severity === 'Medium' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
                                  : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
                                }`}>{r.severity}</span>
                                <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold ${
                                  r.status === 'Urgent' ? 'bg-red-100 text-red-600' : r.status === 'Verified' ? 'bg-emerald-100 text-emerald-600' : r.status === 'Flagged' ? 'bg-amber-100 text-amber-600' : 'bg-gray-100 text-gray-600'
                                }`}>{r.status}</span>
                              </div>
                              <p className="text-xs font-medium text-gray-800 dark:text-gray-200 truncate capitalize">{(r.type || r.incidentSubtype || '').replace(/_/g, ' ')}</p>
                              <div className="flex items-center gap-2 mt-0.5">
                                <span className="text-[10px] text-gray-500 dark:text-gray-400 flex items-center gap-0.5 truncate"><MapPin className="w-2.5 h-2.5" />{r.location}</span>
                                <span className="text-[10px] text-gray-400 dark:text-gray-400 flex items-center gap-0.5"><Clock className="w-2.5 h-2.5" />{r.displayTime}</span>
                              </div>
                            </div>
                            <Zap className="w-4 h-4 text-gray-300 group-hover:text-purple-500 transition-colors flex-shrink-0" />
                          </button>
                        )
                      })}
                    </div>
                  )}
                </>
              )}

              {/* Auto-populated indicator */}
              {selectedReport && (
                <div className="flex items-center gap-2 px-3 py-2 bg-emerald-50 dark:bg-emerald-950/20 rounded-xl border border-emerald-200 dark:border-emerald-800">
                  <Zap className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                  <p className="text-[10px] text-emerald-700 dark:text-emerald-300 font-medium">{'Title, severity, area, type, and message auto-populated from report. You can edit any field.'}</p>
                </div>
              )}
            </div>
          )}

          {/* Custom mode hint */}
          {mode === 'custom' && (
            <div className="flex items-center gap-2 px-3 py-2 bg-blue-50 dark:bg-blue-950/20 rounded-xl border border-blue-200 dark:border-blue-800">
              <FileText className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
              <p className="text-[10px] text-blue-700 dark:text-blue-300 font-medium">{'Compose a custom alert manually. Fill in all fields below.'}</p>
            </div>
          )}
        </div>
      </div>

      {/*  ALERT FORM  */}
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-lg overflow-hidden">
        <div className="p-5 space-y-5">

          {/* Severity Selection */}
          <div>
            <label className="text-xs font-bold text-gray-600 dark:text-gray-300 uppercase tracking-wider block mb-2">{'Severity Level'}</label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {(['critical', 'warning', 'info'] as Severity[]).map(sev => {
                const sc = SEVERITY_CONFIG[sev]
                const selected = form.severity === sev
                return (
                  <button
                    key={sev}
                    onClick={() => setForm(f => ({ ...f, severity: sev }))}
                    className={`p-3 rounded-xl border-2 text-left transition-all ${
                      selected
                        ? `${sc.activeBg} ${sc.activeText} ${sc.activeBorder} ring-2 ring-offset-1 ${sc.ring} shadow-md`
                        : 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 hover:border-gray-300 dark:hover:border-gray-600'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <div className={`w-3 h-3 rounded-full ${sc.dot} ${selected && sev === 'critical' ? 'animate-pulse' : ''}`} />
                      <span className="text-xs font-bold">{sev === 'critical' ? 'Critical' : sev === 'warning' ? 'Warning' : 'Advisory'}</span>
                    </div>
                    <p className="text-[10px] text-gray-500 dark:text-gray-300">{sev === 'critical' ? 'Immediate life-threatening danger' : sev === 'warning' ? 'Potential threat — take precautions' : 'Situational awareness update'}</p>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Title */}
          <div>
            <label className="text-xs font-bold text-gray-600 dark:text-gray-300 uppercase tracking-wider block mb-1.5">{'Title'} <span className="text-red-500">*</span></label>
            <input
              className="w-full px-4 py-3 text-sm bg-gray-50 dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 focus:ring-2 focus:ring-purple-500 outline-none font-medium"
              placeholder={'e.g. Flash Flood Warning -- River District'}
              value={form.title}
              onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
              maxLength={200}
            />
            <div className="flex justify-between mt-1">
              <span className="text-[10px] text-gray-400 dark:text-gray-300">{form.title.length}/200</span>
            </div>
          </div>

          {/* Message */}
          <div>
            <label className="text-xs font-bold text-gray-600 dark:text-gray-300 uppercase tracking-wider block mb-1.5">{'Message'} <span className="text-red-500">*</span></label>
            <textarea
              className="w-full px-4 py-3 text-sm bg-gray-50 dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 focus:ring-2 focus:ring-purple-500 outline-none min-h-[120px] leading-relaxed resize-y"
              placeholder={'Describe the emergency situation, affected areas and recommended actions...'}
              value={form.message}
              onChange={e => setForm(f => ({ ...f, message: e.target.value }))}
            />
            <div className="flex items-center justify-between mt-1">
              <div className="flex items-center gap-3">
                <span className="text-[10px] text-gray-400 dark:text-gray-300">{form.message.length} {'characters'}</span>
                {channels.sms && form.message.length > 0 && (
                  <span className={`text-[10px] font-medium ${segments > 1 ? 'text-amber-600' : 'text-gray-400 dark:text-gray-300'}`}>
                    SMS: {segments} {'SMS segments'}
                  </span>
                )}
              </div>
              {form.message.length > 0 && form.message.length < 20 && (
                <span className="text-[10px] text-amber-600 font-medium flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" /> {'Message is very short'}
                </span>
              )}
            </div>
          </div>

          {/* Location */}
          <div>
            <label className="text-xs font-bold text-gray-600 dark:text-gray-300 uppercase tracking-wider block mb-1.5">{'Affected Area'}</label>
            <div className="relative">
              <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-300" />
              <input
                className="w-full pl-10 pr-4 py-3 text-sm bg-gray-50 dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 focus:ring-2 focus:ring-purple-500 outline-none"
                placeholder={'e.g. City Centre, Bridge of Don, Coastal areas'}
                value={form.location}
                onChange={e => setForm(f => ({ ...f, location: e.target.value }))}
              />
            </div>
          </div>

          {/* Alert Type */}
          <div>
            <label className="text-xs font-bold text-gray-600 dark:text-gray-300 uppercase tracking-wider block mb-1.5">{'Alert Type'}</label>
            <div className="relative">
              <Bell className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-300" />
              <select
                className="w-full pl-10 pr-4 py-3 text-sm bg-gray-50 dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 focus:ring-2 focus:ring-purple-500 outline-none font-medium appearance-none cursor-pointer"
                value={form.alertType}
                onChange={e => setForm(f => ({ ...f, alertType: e.target.value }))}
              >
                <option value="general">{'General'}</option>
                <option value="flood">{'Flood'}</option>
                <option value="severe_storm">{'Severe Storm'}</option>
                <option value="wildfire">{'Wildfire'}</option>
                <option value="earthquake">{'Earthquake'}</option>
                <option value="heatwave">{'Heatwave'}</option>
                <option value="landslide">{'Landslide'}</option>
                <option value="drought">{'Drought'}</option>
                <option value="power_outage">{'Power Outage'}</option>
                <option value="water_supply">{'Water Supply Emergency'}</option>
                <option value="infrastructure_damage">{'Infrastructure Damage'}</option>
                <option value="public_safety">{'Public Safety'}</option>
                <option value="environmental_hazard">{'Environmental Hazard'}</option>
                <option value="tsunami">{'Tsunami'}</option>
                <option value="volcanic">{'Volcanic Eruption'}</option>
                <option value="pandemic">{'Pandemic / Health Emergency'}</option>
                <option value="chemical_spill">{'Chemical / HazMat Spill'}</option>
                <option value="nuclear">{'Nuclear / Radiological'}</option>
              </select>
              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-300 pointer-events-none" />
            </div>
          </div>

          {/* Expiration */}
          <div>
            <label className="text-xs font-bold text-gray-600 dark:text-gray-300 uppercase tracking-wider block mb-1.5">{'Expiration (optional)'}</label>
            <div className="relative">
              <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-300" />
              <input
                type="datetime-local"
                className="w-full pl-10 pr-4 py-3 text-sm bg-gray-50 dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 focus:ring-2 focus:ring-purple-500 outline-none"
                value={form.expiresAt}
                onChange={e => setForm(f => ({ ...f, expiresAt: e.target.value }))}
                min={new Date().toISOString().slice(0, 16)}
              />
            </div>
            <p className="text-[10px] text-gray-400 dark:text-gray-400 mt-1">{'Leave blank for no expiration. Alert will be auto-deactivated after this time.'}</p>
          </div>
        </div>

        {/*  Channel Selector  */}
        <div className="px-5 pb-5">
          <div className="bg-gradient-to-br from-gray-50 to-slate-50 dark:from-gray-800/50 dark:to-gray-800/30 rounded-xl p-4 border border-gray-200 dark:border-gray-700">
            <div className="flex items-center justify-between mb-3">
              <div>
                <p className="text-xs font-bold text-gray-700 dark:text-gray-300 flex items-center gap-1.5">
                  <Send className="w-3.5 h-3.5 text-purple-500" /> {'Delivery Channels'}
                </p>
                <p className="text-[10px] text-gray-500 dark:text-gray-300 mt-0.5">{activeChannels.length}/5 {'Active'}</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setChannels({ web: true, telegram: true, email: true, sms: true, whatsapp: true })}
                  className="text-[10px] font-semibold text-purple-600 dark:text-purple-400 hover:underline flex items-center gap-1"
                >
                  <ToggleRight className="w-3 h-3" /> {'Select All'}
                </button>
                <span className="text-gray-300 dark:text-gray-400">|</span>
                <button
                  onClick={() => setChannels({ web: false, telegram: false, email: false, sms: false, whatsapp: false })}
                  className="text-[10px] font-semibold text-gray-500 dark:text-gray-400 hover:underline flex items-center gap-1"
                >
                  <ToggleLeft className="w-3 h-3" /> {'Deselect All'}
                </button>
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              {channelOptions.map(ch => {
                const active = channels[ch.key]
                const Icon = ch.icon
                return (
                  <label
                    key={ch.key}
                    className={`flex flex-col items-center gap-1.5 p-3 rounded-xl border-2 cursor-pointer transition-all text-center ${
                      active ? `${ch.bg} ${ch.border} shadow-sm` : 'border-gray-200 dark:border-gray-700 hover:border-gray-300'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={active}
                      onChange={e => setChannels(prev => ({ ...prev, [ch.key]: e.target.checked }))}
                      className="sr-only"
                    />
                    <div className={`w-8 h-8 rounded-lg ${active ? ch.bg : 'bg-gray-100 dark:bg-gray-800'} flex items-center justify-center`}>
                      <Icon className={`w-4 h-4 ${active ? ch.text : 'text-gray-400 dark:text-gray-300'}`} />
                    </div>
                    <span className={`text-[10px] font-bold ${active ? ch.text : 'text-gray-500 dark:text-gray-300'}`}>{ch.label}</span>
                    <span className={`text-[8px] font-bold uppercase tracking-wide ${active ? 'text-emerald-600' : 'text-gray-400 dark:text-gray-300'}`}>
                      {active ? 'Active' : 'Off'}
                    </span>
                  </label>
                )
              })}
            </div>
            {activeChannels.length === 0 && (
              <div className="mt-3 flex items-center gap-1.5 text-red-600">
                <AlertTriangle className="w-3.5 h-3.5" />
                <p className="text-[10px] font-bold">{'Select at least one channel'}</p>
              </div>
            )}
          </div>
        </div>

        {/*  Message Preview  */}
        {(form.title || form.message) && (
          <div className="px-5 pb-5">
            <div className="bg-gray-50 dark:bg-gray-800/50 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
              {/* Preview tabs */}
              <div className="flex items-center gap-0 border-b border-gray-200 dark:border-gray-700">
                <div className="flex items-center gap-1 px-4 py-2 text-[10px] font-bold text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                  <Eye className="w-3 h-3" /> {'Live Preview'}
                </div>
                <div className="flex-1 flex gap-0 overflow-x-auto">
                  {(['card', 'email', 'sms', 'telegram', 'whatsapp', 'web'] as const).map(ch => (
                    <button
                      key={ch}
                      onClick={() => setPreviewChannel(ch)}
                      className={`px-3 py-2 text-[10px] font-bold uppercase tracking-wider transition-colors whitespace-nowrap ${
                        previewChannel === ch
                          ? 'text-purple-600 border-b-2 border-purple-600 bg-purple-50/50 dark:bg-purple-900/10'
                          : 'text-gray-400 dark:text-gray-300 hover:text-gray-600'
                      }`}
                    >
                      {ch === 'card' ? 'Live Card' : ch}
                    </button>
                  ))}
                </div>
              </div>

              {/* Preview content */}
              <div className="p-4">
                {previewChannel === 'card' ? (
                  <div className="max-w-md mx-auto">
                    <p className="text-[10px] text-gray-500 dark:text-gray-400 text-center mb-3 font-medium">{'This is how citizens will see this alert'}</p>
                    <AlertCard alert={previewAlert} />
                  </div>
                ) : (
                  <div className={`rounded-lg p-4 border-l-4 ${cfg.previewBorder} ${cfg.previewBg}`}>
                    <pre className="text-xs text-gray-700 dark:text-gray-300 whitespace-pre-wrap font-sans leading-relaxed">{previewText}</pre>
                  </div>
                )}
                {previewChannel === 'sms' && (
                  <p className="text-[10px] text-gray-500 dark:text-gray-300 mt-2">
                    {'characters'}: {fullSmsText.length} / {segments} {'SMS segments'}
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        {/*  Send Button  */}
        <div className="px-5 pb-5">
          <button
            onClick={() => setShowConfirm(true)}
            disabled={!canSend || sending}
            className={`w-full py-4 rounded-xl font-bold text-sm flex items-center justify-center gap-2.5 transition-all shadow-lg text-white disabled:from-gray-400 disabled:to-gray-500 disabled:cursor-not-allowed disabled:shadow-none bg-gradient-to-r ${cfg.btnGradient} ${cfg.btnShadow}`}
          >
            {sending ? (
              <>
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                {'Broadcasting...'}
              </>
            ) : (
              <>
                <Siren className="w-5 h-5" />
                {'Broadcast Emergency Alert'}
              </>
            )}
          </button>
          {!canSend && !sending && (
            <p className="text-[10px] text-gray-400 dark:text-gray-300 text-center mt-2">
              {!form.title && !form.message ? 'Fill in title and message to enable broadcast' :
               !form.title ? 'Alert title is required' :
               !form.message ? 'Alert message is required' :
               'Select at least one channel'}
            </p>
          )}
        </div>
      </div>

      {/*  CONFIRMATION DIALOG  */}
      {showConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm animate-fade-in" onClick={() => !sending && setShowConfirm(false)}>
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl max-w-lg w-full mx-4 overflow-hidden border border-gray-200 dark:border-gray-700" onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div className={`p-5 ${cfg.headerBg}`}>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-white/10 rounded-xl flex items-center justify-center">
                  <AlertTriangle className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h3 className="text-white font-bold text-lg">{'Confirm Broadcast'}</h3>
                  <p className="text-white/60 text-xs">{'This will send to all subscribed citizens'}</p>
                </div>
              </div>
            </div>
            {/* Body */}
            <div className="p-5 space-y-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-500 dark:text-gray-300 font-semibold uppercase">{'Severity'}</span>
                  <span className={`text-xs font-bold px-2 py-0.5 rounded ${cfg.badge}`}>{form.severity === 'critical' ? 'Critical' : form.severity === 'warning' ? 'Warning' : 'Advisory'}</span>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-xs text-gray-500 dark:text-gray-300 font-semibold uppercase">{'Title'}</span>
                  <span className="text-sm font-bold text-gray-900 dark:text-white">{form.title}</span>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-xs text-gray-500 dark:text-gray-300 font-semibold uppercase">{'Message'}</span>
                  <span className="text-xs text-gray-700 dark:text-gray-300 line-clamp-3">{form.message}</span>
                </div>
                {form.location && (
                  <div className="flex items-center gap-1">
                    <MapPin className="w-3 h-3 text-gray-400 dark:text-gray-300" />
                    <span className="text-xs text-gray-500 dark:text-gray-300">{form.location}</span>
                  </div>
                )}
                <div className="flex items-center gap-1">
                  <Send className="w-3 h-3 text-gray-400 dark:text-gray-300" />
                  <span className="text-xs text-gray-500 dark:text-gray-300">{'Channels'}: {activeChannels.join(', ')}</span>
                </div>
                {form.alertType !== 'general' && (
                  <div className="flex items-center gap-1">
                    <Bell className="w-3 h-3 text-gray-400 dark:text-gray-300" />
                    <span className="text-xs text-gray-500 dark:text-gray-300">{'Alert Type'}: {ALERT_TYPE_LABELS[form.alertType] || form.alertType}</span>
                  </div>
                )}
                {selectedReport && (
                  <div className="flex items-center gap-1">
                    <Link2 className="w-3 h-3 text-purple-400" />
                    <span className="text-xs text-purple-600 dark:text-purple-400 font-medium">{'Source Report'}: {selectedReport.reportNumber || `RPT-${selectedReport.id.slice(0, 6).toUpperCase()}`}</span>
                  </div>
                )}
                {form.expiresAt && (
                  <div className="flex items-center gap-1">
                    <Calendar className="w-3 h-3 text-gray-400 dark:text-gray-300" />
                    <span className="text-xs text-gray-500 dark:text-gray-300">{'Expiration (optional)'}: {new Date(form.expiresAt).toLocaleString()}</span>
                  </div>
                )}
              </div>

              {form.severity === 'critical' && (
                <div className="bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 rounded-lg p-3">
                  <p className="text-[10px] font-bold text-red-600 flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" />
                    {'CRITICAL ALERT'}: {'This will trigger high-priority notifications on all selected channels.'}
                  </p>
                </div>
              )}
            </div>
            {/* Actions */}
            <div className="px-5 pb-5 flex gap-3">
              <button
                onClick={() => setShowConfirm(false)}
                disabled={sending}
                className="flex-1 py-3 px-4 rounded-xl text-sm font-semibold bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
              >
                {'Cancel'}
              </button>
              <button
                onClick={handleSend}
                disabled={sending}
                className={`flex-1 py-3 px-4 rounded-xl text-sm font-bold text-white flex items-center justify-center gap-2 transition-all bg-gradient-to-r ${cfg.btnGradient} ${cfg.btnShadow} shadow-lg disabled:opacity-50`}
              >
                {sending ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    {'Broadcasting...'}
                  </>
                ) : (
                  <>
                    <Siren className="w-4 h-4" />
                    {'Confirm Broadcast'}
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/*  DELIVERY RESULT  */}
      {deliveryResult && (
        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-lg overflow-hidden animate-fade-in">
          <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
            <h3 className="text-sm font-bold text-gray-900 dark:text-white flex items-center gap-2">
              {deliveryResult.failed === 0 ? (
                <CheckCircle className="w-4 h-4 text-emerald-500" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-amber-500" />
              )}
              {'Delivery Summary'}
            </h3>
            <button onClick={() => setDeliveryResult(null)} className="text-gray-400 dark:text-gray-300 hover:text-gray-600"><X className="w-4 h-4" /></button>
          </div>
          <div className="p-5">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
              <div className="bg-blue-50 dark:bg-blue-900/20 rounded-xl p-3 text-center">
                <p className="text-xl font-bold text-blue-600">{deliveryResult.attempted}</p>
                <p className="text-[10px] text-blue-500 font-semibold uppercase">{'Attempted'}</p>
              </div>
              <div className="bg-emerald-50 dark:bg-emerald-900/20 rounded-xl p-3 text-center">
                <p className="text-xl font-bold text-emerald-600">{deliveryResult.sent}</p>
                <p className="text-[10px] text-emerald-500 font-semibold uppercase">{'Delivered'}</p>
              </div>
              <div className={`rounded-xl p-3 text-center ${deliveryResult.failed > 0 ? 'bg-red-50 dark:bg-red-900/20' : 'bg-gray-50 dark:bg-gray-800'}`}>
                <p className={`text-xl font-bold ${deliveryResult.failed > 0 ? 'text-red-600' : 'text-gray-400 dark:text-gray-300'}`}>{deliveryResult.failed}</p>
                <p className={`text-[10px] font-semibold uppercase ${deliveryResult.failed > 0 ? 'text-red-500' : 'text-gray-400 dark:text-gray-300'}`}>{'Failed'}</p>
              </div>
            </div>
            {deliveryResult.attempted > 0 && (
              <div className="w-full h-2 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-emerald-500 to-emerald-400 rounded-full transition-all"
                  style={{ width: `${Math.round((deliveryResult.sent / deliveryResult.attempted) * 100)}%` }}
                />
              </div>
            )}
            {deliveryResult.results && deliveryResult.results.length > 0 && (
              <div className="mt-4 space-y-1.5">
                <p className="text-[10px] font-bold text-gray-500 dark:text-gray-300 uppercase mb-2">{'Channel Results'}</p>
                {deliveryResult.results.slice(0, 10).map((r, i) => (
                  <div key={i} className="flex items-center justify-between text-xs py-1.5 px-2 rounded-lg bg-gray-50 dark:bg-gray-800/50">
                    <div className="flex items-center gap-2">
                      <div className={`w-2 h-2 rounded-full ${r.success ? 'bg-emerald-500' : 'bg-red-500'}`} />
                      <span className="font-medium text-gray-700 dark:text-gray-300 capitalize">{r.channel}</span>
                      <span className="text-gray-400 dark:text-gray-300 font-mono text-[10px] truncate max-w-[150px]">{r.recipient}</span>
                    </div>
                    {r.success ? (
                      <span className="text-[10px] text-emerald-600 font-semibold">{'Delivered'}</span>
                    ) : (
                      <span className="text-[10px] text-red-500 font-medium truncate max-w-[200px]">{r.error || 'Failed'}</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/*  RECENT BROADCASTS  */}
      {alerts.length > 0 && (
        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-lg overflow-hidden">
          <button
            onClick={() => setShowHistory(!showHistory)}
            className="w-full px-5 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-800/30 transition-colors"
          >
            <h3 className="text-sm font-bold text-gray-900 dark:text-white flex items-center gap-2">
              <History className="w-4 h-4 text-gray-500 dark:text-gray-300" /> {'Recent Broadcasts'}
            </h3>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-gray-500 dark:text-gray-300">{alerts.length} {'Total'}</span>
              {showHistory ? <ChevronUp className="w-3.5 h-3.5 text-gray-400 dark:text-gray-300" /> : <ChevronDown className="w-3.5 h-3.5 text-gray-400 dark:text-gray-300" />}
            </div>
          </button>
          {showHistory && (
            <div className="divide-y divide-gray-100 dark:divide-gray-800 max-h-[250px] overflow-y-auto">
              {alerts.slice(0, 8).map(a => {
                const sev = (a.severity || '').toLowerCase()
                const sevCfg = sev === 'high' || sev === 'critical'
                  ? { dot: 'bg-red-500', badge: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300', label: sev }
                  : sev === 'medium' || sev === 'warning'
                  ? { dot: 'bg-amber-500', badge: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300', label: sev }
                  : { dot: 'bg-blue-500', badge: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300', label: sev }
                return (
                  <div key={a.id} className="px-5 py-3 flex items-center gap-3 hover:bg-gray-50 dark:hover:bg-gray-800/20 transition-colors">
                    <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${sevCfg.dot} ${(sev === 'high' || sev === 'critical') ? 'animate-pulse' : ''}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-gray-900 dark:text-white truncate">{a.title}</p>
                      <p className="text-[10px] text-gray-500 dark:text-gray-300 mt-0.5">
                        {new Date(a.timestamp || Date.now()).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                        {a.area ? ` \u00B7 ${a.area}` : ''}
                      </p>
                    </div>
                    <span className={`text-[9px] px-2 py-0.5 rounded-full font-bold ${sevCfg.badge}`}>
                      {sevCfg.label}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {showKeyboard && (
        <div className="mt-3 bg-gray-900 text-white rounded-xl p-3 flex items-center gap-4 flex-wrap text-[10px] font-mono ring-1 ring-gray-700">
          <span className="font-bold text-gray-400 uppercase tracking-wider mr-1">{'Shortcuts'}</span>
          <span><kbd className="px-1.5 py-0.5 bg-gray-700 rounded text-white">H</kbd> {'Toggle History'}</span>
          <span><kbd className="px-1.5 py-0.5 bg-gray-700 rounded text-white">?</kbd> {'Toggle Shortcuts'}</span>
          <span><kbd className="px-1.5 py-0.5 bg-gray-700 rounded text-white">{'Esc'}</kbd> {'Close'}</span>
        </div>
      )}
    </div>
  )
}
