/**
 * Region config frontend module.
 *
 * How it connects:
 * - Imported by services and components that need this configuration */

import { codeToFlag } from '../data/countryCodes'

export interface EmergencyContact {
  name: string
  number: string
  type: 'emergency' | 'police' | 'health' | 'fire' | 'mental_health' | 'power' | 'gas' | 'flood' | 'coast_guard' | 'utility' | 'child' | 'abuse' | 'disaster' | 'animal' | 'poison'
  description?: string
  available?: string // e.g. "24/7"
}

export interface RegionConfig {
  id: string
  name: string
  flag: string
  language: string
  currency: string

  // Emergency numbers
  emergencyNumber: string       // Primary: 999, 911, 112, etc.
  policeNonEmergency?: string   // e.g. 101 (UK), non-emergency line
  healthHotline?: string        // e.g. NHS 111, 1-800-222-1222
  gasEmergency?: string         // e.g. 0800 111 999
  powerCuts?: string            // e.g. 105
  floodHotline?: string         // e.g. 0345 988 1188

  // Mental health
  mentalHealthLine: { name: string; number: string }
  crisisText?: { name: string; shortcode: string; keyword: string }
  childLine?: { name: string; number: string }
  abuseHotline?: { name: string; number: string }

  // Key organizations
  organizations: {
    redCross: { name: string; number?: string }
    disasterRelief: { name: string; number?: string }[]
    animalWelfare: { name: string; number?: string }[]
    shelterCharity: { name: string; number?: string }[]
    mentalHealthOrgs: { name: string; number?: string }[]
    bereavementSupport?: { name: string; number?: string }
    victimSupport?: { name: string; number?: string }
  }

  // Healthcare
  healthcare: {
    emergencyDept: string         // "A&E", "ER", "Emergency Room"
    primaryCare: string           // "GP", "Primary Care Physician", "Doctor"
    healthSystem: string          // "NHS", "Medicare", "Public Health"
    mentalHealthReferral: string  // "IAPT referral", "therapy referral"
    poisonControl?: string
  }

  // Government & institutions
  government: {
    floodAuthority: string        // "Environment Agency", "FEMA", "CWC"
    weatherService: string        // "Met Office", "NWS", "IMD"
    emergencyBroadcast: string    // "BBC Radio 4 (93.5 FM)", "NOAA Weather Radio"
    localAuthority: string        // "local council", "city/county government"
    disasterAgency: string        // "COBRA", "FEMA", "NDMA"
    financialAssistance: string   // "Bellwin scheme", "FEMA Individual Assistance"
  }

  // Insurance & financial
  insurance: {
    floodScheme?: string          // "Flood Re", "NFIP"
    floodSchemeDescription?: string
    uninsuredHelp: { name: string; detail: string }[]
  }

  // Infrastructure
  infrastructure: {
    waterUtility: string          // "local water company", "water district"
    electricUtility: string       // "energy supplier", "power company"
    priorityRegister?: string     // "Priority Services Register"
    sandbagProvider: string       // "local council", "county emergency management"
  }

  // Units & conventions
  units: {
    depth: 'cm' | 'inches'
    temperature: 'C' | 'F'
    distance: 'km' | 'miles'
    speed: 'km/h' | 'mph'
  }

  // Source attribution
  sourceAttribution: string       // "UK Government emergency guidelines, WHO, and FEMA"
}

/*  REGION DEFINITIONS                                                */

const REGIONS: Record<string, RegionConfig> = {

  /* United Kingdom */
  uk: {
    id: 'uk',
    name: 'United Kingdom',
    flag: codeToFlag('GB'),
    language: 'en',
    currency: 'GBP',

    emergencyNumber: '999',
    policeNonEmergency: '101',
    healthHotline: '111',
    gasEmergency: '0800 111 999',
    powerCuts: '105',
    floodHotline: '0345 988 1188',

    mentalHealthLine: { name: 'Samaritans', number: '116 123' },
    crisisText: { name: 'SHOUT', shortcode: '85258', keyword: 'SHOUT' },
    childLine: { name: 'Childline', number: '0800 1111' },
    abuseHotline: { name: 'National Domestic Abuse Helpline', number: '0808 2000 247' },

    organizations: {
      redCross: { name: 'Red Cross', number: '0800 068 4141' },
      disasterRelief: [
        { name: 'Salvation Army', number: '020 7367 4500' },
        { name: 'Citizens Advice', number: '0800 144 8848' },
      ],
      animalWelfare: [
        { name: 'RSPCA', number: '0300 1234 999' },
        { name: 'SSPCA (Scotland)', number: '03000 999 999' },
        { name: 'Dogs Trust', number: '020 7837 0006' },
      ],
      shelterCharity: [
        { name: 'Shelter', number: '0808 800 4444' },
      ],
      mentalHealthOrgs: [
        { name: 'Mind', number: '0300 123 3393' },
        { name: 'CALM (men\'s support)', number: '0800 58 58 58' },
        { name: 'Breathing Space (Scotland)', number: '0800 83 85 87' },
      ],
      bereavementSupport: { name: 'Cruse Bereavement', number: '0808 808 1677' },
      victimSupport: { name: 'Victim Support', number: '0808 168 9111' },
    },

    healthcare: {
      emergencyDept: 'A&E',
      primaryCare: 'GP',
      healthSystem: 'NHS',
      mentalHealthReferral: 'IAPT referral via your GP',
      poisonControl: '111',
    },

    government: {
      floodAuthority: 'Environment Agency / SEPA',
      weatherService: 'Met Office',
      emergencyBroadcast: 'BBC Radio 4 (93.5 FM)',
      localAuthority: 'local council',
      disasterAgency: 'COBR',
      financialAssistance: 'Bellwin scheme',
    },

    insurance: {
      floodScheme: 'Flood Re',
      floodSchemeDescription: 'Most UK home insurance includes flood cover through the **Flood Re** scheme. If refused flood insurance, contact Flood Re directly.',
      uninsuredHelp: [
        { name: 'Local council', detail: 'hardship grants' },
        { name: 'Red Cross', detail: '0800 068 4141 (emergency support)' },
        { name: 'Turn2us', detail: 'benefit entitlement checks — turn2us.org.uk' },
        { name: 'National Flood Forum', detail: '01299 403 055 (advice and advocacy)' },
      ],
    },

    infrastructure: {
      waterUtility: 'local water company',
      electricUtility: 'energy supplier',
      priorityRegister: 'Priority Services Register',
      sandbagProvider: 'local council',
    },

    units: { depth: 'cm', temperature: 'C', distance: 'km', speed: 'km/h' },
    sourceAttribution: 'UK Government emergency guidelines, WHO, and international best practices',
  },

  /* United States */
  us: {
    id: 'us',
    name: 'United States',
    flag: codeToFlag('US'),
    language: 'en',
    currency: 'USD',

    emergencyNumber: '911',
    healthHotline: '1-800-222-1222',
    gasEmergency: '911',
    floodHotline: '1-800-621-3362',

    mentalHealthLine: { name: '988 Suicide & Crisis Lifeline', number: '988' },
    crisisText: { name: 'Crisis Text Line', shortcode: '741741', keyword: 'HELLO' },
    childLine: { name: 'Childhelp National Hotline', number: '1-800-422-4453' },
    abuseHotline: { name: 'National Domestic Violence Hotline', number: '1-800-799-7233' },

    organizations: {
      redCross: { name: 'American Red Cross', number: '1-800-733-2767' },
      disasterRelief: [
        { name: 'FEMA Helpline', number: '1-800-621-3362' },
        { name: 'Salvation Army', number: '1-800-725-2769' },
      ],
      animalWelfare: [
        { name: 'ASPCA', number: '1-888-426-4435' },
        { name: 'Humane Society', number: '1-866-720-2676' },
      ],
      shelterCharity: [
        { name: 'National Alliance to End Homelessness' },
        { name: '211 (local shelter info)', number: '211' },
      ],
      mentalHealthOrgs: [
        { name: 'NAMI Helpline', number: '1-800-950-6264' },
        { name: 'SAMHSA Helpline', number: '1-800-662-4357' },
      ],
      bereavementSupport: { name: 'GriefShare', number: '1-800-395-5755' },
      victimSupport: { name: 'National Center for Victims of Crime', number: '1-855-484-2846' },
    },

    healthcare: {
      emergencyDept: 'Emergency Room (ER)',
      primaryCare: 'primary care doctor',
      healthSystem: 'public health department',
      mentalHealthReferral: 'therapy referral from your doctor or through your insurance',
      poisonControl: '1-800-222-1222',
    },

    government: {
      floodAuthority: 'FEMA / USGS',
      weatherService: 'National Weather Service (NWS)',
      emergencyBroadcast: 'NOAA Weather Radio (NWR)',
      localAuthority: 'city/county government',
      disasterAgency: 'FEMA',
      financialAssistance: 'FEMA Individual Assistance',
    },

    insurance: {
      floodScheme: 'NFIP (National Flood Insurance Program)',
      floodSchemeDescription: 'Standard homeowners insurance does NOT cover flooding. You need a separate **NFIP flood policy** through your insurer or FloodSmart.gov.',
      uninsuredHelp: [
        { name: 'FEMA', detail: '1-800-621-3362 (disaster assistance)' },
        { name: '211', detail: 'dial 211 for local emergency resources' },
        { name: 'SBA Disaster Loans', detail: 'sba.gov/disaster (low-interest loans)' },
      ],
    },

    infrastructure: {
      waterUtility: 'local water district',
      electricUtility: 'power company',
      sandbagProvider: 'county emergency management',
    },

    units: { depth: 'inches', temperature: 'F', distance: 'miles', speed: 'mph' },
    sourceAttribution: 'FEMA, CDC, NWS, and WHO guidelines',
  },

  /* India */
  india: {
    id: 'india',
    name: 'India',
    flag: codeToFlag('IN'),
    language: 'en',
    currency: 'INR',

    emergencyNumber: '112',
    policeNonEmergency: '100',
    healthHotline: '1075',
    gasEmergency: '1906',
    powerCuts: '1912',
    floodHotline: '011-26107953',

    mentalHealthLine: { name: 'Vandrevala Foundation', number: '1860-2662-345' },
    crisisText: { name: 'iCall', shortcode: '9152987821', keyword: 'HELP' },
    childLine: { name: 'Childline India', number: '1098' },
    abuseHotline: { name: 'Women Helpline', number: '1091' },

    organizations: {
      redCross: { name: 'Indian Red Cross Society', number: '011-2371-6441' },
      disasterRelief: [
        { name: 'NDRF', number: '011-26107953' },
        { name: 'SDRF (State Disaster Response Force)' },
      ],
      animalWelfare: [
        { name: 'Animal Welfare Board of India', number: '044-22542121' },
      ],
      shelterCharity: [
        { name: 'District Administration relief camps' },
      ],
      mentalHealthOrgs: [
        { name: 'NIMHANS', number: '080-46110007' },
        { name: 'AASRA', number: '91-22-27546669' },
      ],
    },

    healthcare: {
      emergencyDept: 'Emergency Ward',
      primaryCare: 'doctor',
      healthSystem: 'public health system',
      mentalHealthReferral: 'counselling referral',
    },

    government: {
      floodAuthority: 'Central Water Commission (CWC)',
      weatherService: 'India Meteorological Department (IMD)',
      emergencyBroadcast: 'All India Radio / DD News',
      localAuthority: 'district administration',
      disasterAgency: 'NDMA (National Disaster Management Authority)',
      financialAssistance: 'State Disaster Response Fund (SDRF)',
    },

    insurance: {
      uninsuredHelp: [
        { name: 'District administration', detail: 'relief and compensation' },
        { name: 'PM Relief Fund', detail: 'Prime Minister\'s National Relief Fund' },
      ],
    },

    infrastructure: {
      waterUtility: 'state water board',
      electricUtility: 'state electricity board',
      sandbagProvider: 'district administration',
    },

    units: { depth: 'cm', temperature: 'C', distance: 'km', speed: 'km/h' },
    sourceAttribution: 'NDMA, IMD, WHO, and Indian Government guidelines',
  },

  /* UAE */
  uae: {
    id: 'uae',
    name: 'United Arab Emirates',
    flag: codeToFlag('AE'),
    language: 'ar',
    currency: 'AED',

    emergencyNumber: '999',
    policeNonEmergency: '901',
    healthHotline: '800 11 111',
    gasEmergency: '997',

    mentalHealthLine: { name: 'Hope Helpline', number: '800 4673' },
    childLine: { name: 'Child Protection Centre', number: '800 988' },
    abuseHotline: { name: 'Aman Service', number: '800 7283' },

    organizations: {
      redCross: { name: 'Emirates Red Crescent', number: '800-733' },
      disasterRelief: [
        { name: 'NCEMA (National Emergency Crisis Authority)' },
      ],
      animalWelfare: [],
      shelterCharity: [],
      mentalHealthOrgs: [
        { name: 'Befrienders Worldwide UAE' },
      ],
    },

    healthcare: {
      emergencyDept: 'Emergency Department',
      primaryCare: 'doctor',
      healthSystem: 'DHA / HAAD',
      mentalHealthReferral: 'mental health referral',
    },

    government: {
      floodAuthority: 'NCEMA',
      weatherService: 'National Centre of Meteorology (NCM)',
      emergencyBroadcast: 'WAM news agency / local radio',
      localAuthority: 'municipality',
      disasterAgency: 'NCEMA',
      financialAssistance: 'government compensation',
    },

    insurance: {
      uninsuredHelp: [
        { name: 'Municipality', detail: 'emergency housing assistance' },
      ],
    },

    infrastructure: {
      waterUtility: 'DEWA / local water authority',
      electricUtility: 'DEWA / local electricity authority',
      sandbagProvider: 'municipality',
    },

    units: { depth: 'cm', temperature: 'C', distance: 'km', speed: 'km/h' },
    sourceAttribution: 'NCEMA, NCM, WHO, and UAE Government guidelines',
  },
}

/*  AUTO-DETECTION & ACTIVE REGION                                    */

import {
  localeToCountryCode,
  lookupByCode,
  emergencyCard,
  worldwideEmergencyTable,
  type GlobalEmergencyEntry,
} from './globalEmergencyDB'

// Map ISO country codes to detailed REGIONS keys
const CODE_TO_REGION: Record<string, string> = {
  GB: 'uk', US: 'us', IN: 'india', AE: 'uae',
}

/**
 * Build a basic RegionConfig from the global emergency DB when no
 * detailed region profile exists. Provides correct emergency numbers,
 * mental health lines, and basic metadata for 60+ countries.
 */
function buildFromGlobalDB(entry: GlobalEmergencyEntry): RegionConfig {
  return {
    id: entry.code.toLowerCase(),
    name: entry.name,
    flag: entry.flag,
    language: entry.language,
    currency: entry.currency,
    emergencyNumber: entry.emergencyNumber,
    policeNonEmergency: entry.police !== entry.emergencyNumber ? entry.police : undefined,
    mentalHealthLine: entry.mentalHealth || { name: 'Crisis Line', number: entry.emergencyNumber },
    childLine: entry.childLine,
    abuseHotline: entry.abuseHotline,
    organizations: {
      redCross: { name: 'Red Cross / Red Crescent' },
      disasterRelief: [{ name: entry.disasterAgency }],
      animalWelfare: [],
      shelterCharity: [],
      mentalHealthOrgs: entry.mentalHealth ? [{ name: entry.mentalHealth.name, number: entry.mentalHealth.number }] : [],
    },
    healthcare: {
      emergencyDept: 'Emergency Department',
      primaryCare: 'doctor',
      healthSystem: 'public health system',
      mentalHealthReferral: 'mental health referral through your doctor',
      poisonControl: entry.poisonControl,
    },
    government: {
      floodAuthority: entry.disasterAgency,
      weatherService: entry.weatherService,
      emergencyBroadcast: 'national emergency broadcast system',
      localAuthority: 'local government',
      disasterAgency: entry.disasterAgency,
      financialAssistance: 'government disaster relief',
    },
    insurance: {
      uninsuredHelp: [
        { name: 'Local government', detail: 'disaster relief assistance' },
        { name: entry.disasterAgency, detail: 'national disaster fund' },
      ],
    },
    infrastructure: {
      waterUtility: 'local water authority',
      electricUtility: 'local power company',
      sandbagProvider: 'local government',
    },
    units: entry.units,
    sourceAttribution: `${entry.disasterAgency}, ${entry.weatherService}, WHO, and international best practices`,
  }
}

/**
 * Detect user's country from browser locale.
 * Returns a REGIONS key if a detailed profile exists,
 * otherwise returns the ISO country code for global DB lookup.
 */
function detectRegionFromLocale(): string {
  if (typeof navigator === 'undefined') return 'uk'
  const locale = navigator.language || 'en-GB'
  const code = localeToCountryCode(locale)
  if (!code) return 'uk'
  // Check for detailed region first
  const detailed = CODE_TO_REGION[code]
  if (detailed && REGIONS[detailed]) return detailed
  // Otherwise return lowercase code for global DB lookup
  return code.toLowerCase()
}

/**
 * Override region. Set to '' or 'auto' for auto-detection.
 * Set to a specific key ('uk', 'us', 'india', 'uae') for manual override.
 */
export const ACTIVE_REGION: string = 'auto'

// Resolved region key (auto-detected or manual)
const _resolvedRegion = ACTIVE_REGION === 'auto' || ACTIVE_REGION === ''
  ? detectRegionFromLocale()
  : ACTIVE_REGION

/*  EXPORTS                                                           */

export function getRegion(id?: string): RegionConfig {
  const key = id || _resolvedRegion
  // 1. Try detailed regions first
  if (REGIONS[key]) return REGIONS[key]
  // 2. Try global DB by country code
  const entry = lookupByCode(key)
  if (entry) return buildFromGlobalDB(entry)
  // 3. Fallback to UK
  return REGIONS.uk
}

export function getAllRegions(): RegionConfig[] {
  return Object.values(REGIONS)
}

export function getRegionIds(): string[] {
  return Object.keys(REGIONS)
}

/* Get the detected/active country code (uppercase ISO) */
export function getActiveCountryCode(): string {
  return _resolvedRegion.toUpperCase()
}

// Re-export global DB utilities for use in chatbotEngine etc.
export { lookupByCode, emergencyCard, worldwideEmergencyTable }

// Convenience: get the active region
export const region = getRegion()

// Template helper — replaces {{tokens}} in strings with region values
export function resolveTemplate(template: string, r?: RegionConfig): string {
  const cfg = r || region
  const map: Record<string, string> = {
    '{{EMERGENCY}}': cfg.emergencyNumber,
    '{{POLICE_NON_EMERGENCY}}': cfg.policeNonEmergency || cfg.emergencyNumber,
    '{{HEALTH_HOTLINE}}': cfg.healthHotline || cfg.emergencyNumber,
    '{{GAS_EMERGENCY}}': cfg.gasEmergency || cfg.emergencyNumber,
    '{{POWER_CUTS}}': cfg.powerCuts || cfg.emergencyNumber,
    '{{FLOOD_HOTLINE}}': cfg.floodHotline || cfg.emergencyNumber,
    '{{MENTAL_HEALTH_LINE}}': `${cfg.mentalHealthLine.name}: ${cfg.mentalHealthLine.number}`,
    '{{MENTAL_HEALTH_NAME}}': cfg.mentalHealthLine.name,
    '{{MENTAL_HEALTH_NUMBER}}': cfg.mentalHealthLine.number,
    '{{CRISIS_TEXT}}': cfg.crisisText ? `Text ${cfg.crisisText.keyword} to ${cfg.crisisText.shortcode}` : '',
    '{{CHILD_LINE}}': cfg.childLine ? `${cfg.childLine.name}: ${cfg.childLine.number}` : '',
    '{{ABUSE_HOTLINE}}': cfg.abuseHotline ? `${cfg.abuseHotline.name}: ${cfg.abuseHotline.number}` : '',
    '{{RED_CROSS}}': `${cfg.organizations.redCross.name}${cfg.organizations.redCross.number ? ': ' + cfg.organizations.redCross.number : ''}`,
    '{{EMERGENCY_DEPT}}': cfg.healthcare.emergencyDept,
    '{{PRIMARY_CARE}}': cfg.healthcare.primaryCare,
    '{{HEALTH_SYSTEM}}': cfg.healthcare.healthSystem,
    '{{FLOOD_AUTHORITY}}': cfg.government.floodAuthority,
    '{{WEATHER_SERVICE}}': cfg.government.weatherService,
    '{{EMERGENCY_BROADCAST}}': cfg.government.emergencyBroadcast,
    '{{LOCAL_AUTHORITY}}': cfg.government.localAuthority,
    '{{DISASTER_AGENCY}}': cfg.government.disasterAgency,
    '{{SANDBAG_PROVIDER}}': cfg.infrastructure.sandbagProvider,
    '{{ELECTRIC_UTILITY}}': cfg.infrastructure.electricUtility,
    '{{PRIORITY_REGISTER}}': cfg.infrastructure.priorityRegister || 'priority customer register',
    '{{SOURCE_ATTRIBUTION}}': cfg.sourceAttribution,
    '{{COUNTRY_NAME}}': cfg.name,
    '{{FLAG}}': cfg.flag,
    '{{FLOOD_SCHEME}}': cfg.insurance.floodScheme || '',
    '{{FLOOD_SCHEME_DESC}}': cfg.insurance.floodSchemeDescription || '',
    '{{MENTAL_HEALTH_REFERRAL}}': cfg.healthcare.mentalHealthReferral,
    '{{FINANCIAL_ASSISTANCE}}': cfg.government.financialAssistance,
    '{{MENTAL_HEALTH_CONTACTS}}': mentalHealthContacts(cfg),
    '{{SHELTER_CONTACTS}}': shelterContacts(cfg),
    '{{ANIMAL_CONTACTS}}': animalContacts(cfg),
    '{{INSURANCE_HELP}}': insuranceHelp(cfg),
    '{{SUPPORT_TABLE}}': supportTable(cfg),
    '{{GRIEF_SUPPORT_TABLE}}': griefSupportTable(cfg),
    '{{CHILD_SUPPORT_TABLE}}': childSupportTable(cfg),
    '{{DISASTER_CONTACTS}}': disasterContacts(cfg),
    '{{EMERGENCY_CONTACTS_TABLE}}': emergencyContactsTable(cfg),
    '{{WORLDWIDE_EMERGENCY_TABLE}}': worldwideEmergencyTable(),
    '{{UNINSURED_HELP}}': cfg.insurance.uninsuredHelp.map(h => `• **${h.name}:** ${h.detail || ''}`).join('\n'),
  }

  let result = template
  for (const [token, value] of Object.entries(map)) {
    result = result.split(token).join(value)
  }
  return result
}

// Generate emergency contacts table for any region
export function emergencyContactsTable(r?: RegionConfig): string {
  const cfg = r || region
  const rows: string[] = []
  rows.push(`| ${cfg.flag} **${cfg.name}** | **${cfg.emergencyNumber}** | ${cfg.healthHotline ? `Health: ${cfg.healthHotline}` : ''}${cfg.policeNonEmergency ? `, Police non-emergency: ${cfg.policeNonEmergency}` : ''}${cfg.floodHotline ? `, Flood: ${cfg.floodHotline}` : ''}${cfg.powerCuts ? `, Power: ${cfg.powerCuts}` : ''} |`)
  return rows.join('\n')
}

// Generate mental health contacts for any region
export function mentalHealthContacts(r?: RegionConfig): string {
  const cfg = r || region
  const lines: string[] = []
  lines.push(`• **${cfg.mentalHealthLine.name}:** ${cfg.mentalHealthLine.number} (24/7, free)`)
  if (cfg.crisisText) lines.push(`• **Crisis text:** Text ${cfg.crisisText.keyword} to ${cfg.crisisText.shortcode}`)
  for (const org of cfg.organizations.mentalHealthOrgs) {
    lines.push(`• **${org.name}:**${org.number ? ' ' + org.number : ''}`)
  }
  if (cfg.childLine) lines.push(`• **${cfg.childLine.name}:** ${cfg.childLine.number}`)
  if (cfg.abuseHotline) lines.push(`• **${cfg.abuseHotline.name}:** ${cfg.abuseHotline.number}`)
  return lines.join('\n')
}

// Generate shelter contacts for any region
export function shelterContacts(r?: RegionConfig): string {
  const cfg = r || region
  const lines: string[] = []
  lines.push(`| **${cfg.government.localAuthority}** | Contact your ${cfg.government.localAuthority} |`)
  lines.push(`| **${cfg.organizations.redCross.name}** | ${cfg.organizations.redCross.number || 'See website'} |`)
  for (const org of cfg.organizations.disasterRelief) {
    lines.push(`| **${org.name}** | ${org.number || 'See website'} |`)
  }
  for (const org of cfg.organizations.shelterCharity) {
    lines.push(`| **${org.name}** | ${org.number || 'See website'} |`)
  }
  return lines.join('\n')
}

// Generate animal welfare contacts for any region
export function animalContacts(r?: RegionConfig): string {
  const cfg = r || region
  return cfg.organizations.animalWelfare
    .map(org => `| **${org.name}** | ${org.number || 'See website'} |`)
    .join('\n')
}

// Generate insurance/uninsured help for any region
export function insuranceHelp(r?: RegionConfig): string {
  const cfg = r || region
  const lines: string[] = []
  if (cfg.insurance.floodSchemeDescription) {
    lines.push(`### ${cfg.insurance.floodScheme}`)
    lines.push(cfg.insurance.floodSchemeDescription)
  }
  if (cfg.insurance.uninsuredHelp.length > 0) {
    lines.push('\n### If Uninsured')
    for (const h of cfg.insurance.uninsuredHelp) {
      lines.push(`• **${h.name}:** ${h.detail || ''}`)
    }
  }
  return lines.join('\n')
}

// Generate support services table (table format — for TRAUMA, GRIEF, etc.)
export function supportTable(r?: RegionConfig): string {
  const cfg = r || region
  const rows: string[] = []
  rows.push(`| **${cfg.mentalHealthLine.name}** | ${cfg.mentalHealthLine.number} (24/7) |`)
  for (const org of cfg.organizations.mentalHealthOrgs) {
    rows.push(`| **${org.name}** | ${org.number || 'See website'} |`)
  }
  rows.push(`| **${cfg.healthcare.healthSystem} ${cfg.healthHotline || ''}** | ${cfg.healthcare.mentalHealthReferral} |`)
  rows.push(`| **${cfg.healthcare.primaryCare}** | Counselling/therapy referral |`)
  return rows.join('\n')
}

// Generate grief/bereavement support table
export function griefSupportTable(r?: RegionConfig): string {
  const cfg = r || region
  const rows: string[] = []
  rows.push(`| **${cfg.mentalHealthLine.name}** | ${cfg.mentalHealthLine.number} (24/7) |`)
  if (cfg.organizations.bereavementSupport) {
    rows.push(`| **${cfg.organizations.bereavementSupport.name}** | ${cfg.organizations.bereavementSupport.number || ''} |`)
  }
  rows.push(`| **${cfg.organizations.redCross.name}** | ${cfg.organizations.redCross.number || ''} |`)
  rows.push(`| **${cfg.healthcare.primaryCare}** | Counselling referral |`)
  if (cfg.organizations.victimSupport) {
    rows.push(`| **${cfg.organizations.victimSupport.name}** | ${cfg.organizations.victimSupport.number || ''} |`)
  }
  return rows.join('\n')
}

// Generate child support contacts table
export function childSupportTable(r?: RegionConfig): string {
  const cfg = r || region
  const rows: string[] = []
  if (cfg.childLine) rows.push(`| **${cfg.childLine.name}** | ${cfg.childLine.number} (free, confidential) |`)
  if (cfg.abuseHotline) rows.push(`| **${cfg.abuseHotline.name}** | ${cfg.abuseHotline.number} |`)
  if (cfg.crisisText) rows.push(`| **Crisis text** | Text ${cfg.crisisText.keyword} to ${cfg.crisisText.shortcode} |`)
  rows.push(`| **${cfg.healthcare.primaryCare}** | Specialist referral |`)
  return rows.join('\n')
}

// Generate disaster-specific contacts for CONTACTS response
export function disasterContacts(r?: RegionConfig): string {
  const cfg = r || region
  const lines: string[] = []
  lines.push(`• **${cfg.organizations.redCross.name}:** ${cfg.organizations.redCross.number || 'See website'}`)
  for (const org of cfg.organizations.disasterRelief) {
    lines.push(`• **${org.name}:** ${org.number || 'See website'}`)
  }
  return lines.join('\n')
}
