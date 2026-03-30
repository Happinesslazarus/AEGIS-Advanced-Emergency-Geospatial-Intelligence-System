/**
 * AEGIS v6 — Comprehensive Seed Script
 * Creates: 20 citizens, 30 reports, community chat messages, message threads,
 *          10 admin/operator accounts, and alert subscriptions.
 *
 * Run: cd aegis-v6/server && npx tsx seed_data.ts
 */
import pg from 'pg'
import bcrypt from 'bcryptjs'
import crypto from 'crypto'

const pool = new pg.Pool({
  connectionString: 'postgresql://postgres:Happylove@!@localhost:5432/aegis',
})

// ─── CITIZEN ACCOUNTS ────────────────────────────────────────────────
const CITIZENS = [
  { email: 'sarah.mitchell@aegis-test.io',   displayName: 'Sarah Mitchell',   phone: '+353851001001', city: 'Dublin',      country: 'Ireland', bio: 'Community volunteer and first-aid trained resident.' },
  { email: 'james.oconnor@aegis-test.io',    displayName: "James O'Connor",   phone: '+353851001002', city: 'Cork',        country: 'Ireland', bio: 'Retired firefighter, active neighbourhood watch member.' },
  { email: 'priya.sharma@aegis-test.io',     displayName: 'Priya Sharma',     phone: '+353851001003', city: 'Galway',      country: 'Ireland', bio: 'Environmental science researcher at NUI Galway.' },
  { email: 'marcus.johnson@aegis-test.io',   displayName: 'Marcus Johnson',   phone: '+353851001004', city: 'Limerick',    country: 'Ireland', bio: 'Civil engineer concerned with infrastructure safety.' },
  { email: 'aisha.hassan@aegis-test.io',     displayName: 'Aisha Hassan',     phone: '+353851001005', city: 'Waterford',   country: 'Ireland', bio: 'Medical professional and disaster preparedness advocate.' },
  { email: 'thomas.burke@aegis-test.io',     displayName: 'Thomas Burke',     phone: '+353851001006', city: 'Kilkenny',    country: 'Ireland', bio: 'Farmer monitoring weather and river levels daily.' },
  { email: 'elena.volkov@aegis-test.io',     displayName: 'Elena Volkov',     phone: '+353851001007', city: 'Wexford',     country: 'Ireland', bio: 'Coastal resident, experienced with storm surges.' },
  { email: 'david.chen@aegis-test.io',       displayName: 'David Chen',       phone: '+353851001008', city: 'Drogheda',    country: 'Ireland', bio: 'IT professional and open-data advocate.' },
  { email: 'grace.okafor@aegis-test.io',     displayName: 'Grace Okafor',     phone: '+353851001009', city: 'Dundalk',     country: 'Ireland', bio: 'Social worker supporting vulnerable communities.' },
  { email: 'liam.fitzgerald@aegis-test.io',  displayName: 'Liam Fitzgerald',  phone: '+353851001010', city: 'Sligo',       country: 'Ireland', bio: 'Mountain rescue volunteer and outdoor enthusiast.' },
  { email: 'fatima.alrashid@aegis-test.io',  displayName: 'Fatima Al-Rashid', phone: '+353851001011', city: 'Athlone',     country: 'Ireland', bio: 'Public health nurse in midlands region.' },
  { email: 'ryan.mccarthy@aegis-test.io',    displayName: 'Ryan McCarthy',    phone: '+353851001012', city: 'Tralee',      country: 'Ireland', bio: 'Boat owner and amateur meteorologist.' },
  { email: 'sophie.muller@aegis-test.io',    displayName: 'Sophie Müller',    phone: '+353851001013', city: 'Ennis',       country: 'Ireland', bio: 'School teacher trained in emergency evacuation protocols.' },
  { email: 'benjamin.adeyemi@aegis-test.io', displayName: 'Benjamin Adeyemi', phone: '+353851001014', city: 'Carlow',      country: 'Ireland', bio: 'Construction foreman with structural assessment skills.' },
  { email: 'niamh.kelly@aegis-test.io',      displayName: 'Niamh Kelly',      phone: '+353851001015', city: 'Tullamore',   country: 'Ireland', bio: 'Veterinary surgeon, assists with animal rescue during floods.' },
  { email: 'omar.diallo@aegis-test.io',      displayName: 'Omar Diallo',      phone: '+353851001016', city: 'Letterkenny', country: 'Ireland', bio: 'Delivery driver covering rural Donegal routes.' },
  { email: 'charlotte.dubois@aegis-test.io', displayName: 'Charlotte Dubois', phone: '+353851001017', city: 'Navan',       country: 'Ireland', bio: 'Urban planning consultant and GIS specialist.' },
  { email: 'patrick.brennan@aegis-test.io',  displayName: 'Patrick Brennan',  phone: '+353851001018', city: 'Castlebar',   country: 'Ireland', bio: 'County councillor focused on disaster resilience.' },
  { email: 'yuki.tanaka@aegis-test.io',      displayName: 'Yuki Tanaka',      phone: '+353851001019', city: 'Maynooth',    country: 'Ireland', bio: 'Climate science PhD candidate at Maynooth University.' },
  { email: 'rachel.green@aegis-test.io',     displayName: 'Rachel Green',     phone: '+353851001020', city: 'Mullingar',   country: 'Ireland', bio: 'Red Cross volunteer with crisis communication training.' },
]

// ─── OPERATOR / ADMIN ACCOUNTS ───────────────────────────────────────
const OPERATORS = [
  { email: 'commander@aegis-ops.io',    displayName: 'Director Alex Morgan',       role: 'admin',    department: 'Command & Control',        phone: '+353861000001' },
  { email: 'ops.director@aegis-ops.io', displayName: 'Ops Director Karen Walsh',   role: 'operator', department: 'Emergency Operations',     phone: '+353861000002' },
  { email: 'intel@aegis-ops.io',        displayName: 'Analyst Brian Murphy',       role: 'operator', department: 'Intelligence & Analytics', phone: '+353861000003' },
  { email: 'comms@aegis-ops.io',        displayName: 'Comms Officer Lisa Duffy',   role: 'operator', department: 'Public Communications',   phone: '+353861000004' },
  { email: 'field@aegis-ops.io',        displayName: 'Field Lead Ronan Gallagher', role: 'operator', department: 'Field Operations',         phone: '+353861000005' },
  { email: 'logistics@aegis-ops.io',    displayName: 'Resource Mgr Sinead Byrne',  role: 'operator', department: 'Logistics & Resources',    phone: '+353861000006' },
  { email: 'medical@aegis-ops.io',      displayName: 'Dr. Conor Whelan',           role: 'operator', department: 'Health & Medical',          phone: '+353861000007' },
  { email: 'security@aegis-ops.io',     displayName: 'Security Sgt. Declan Foley', role: 'operator', department: 'Security & Enforcement',   phone: '+353861000008' },
  { email: 'training@aegis-ops.io',     displayName: 'QA Lead Marie Connolly',     role: 'viewer',   department: 'Training & Quality',       phone: '+353861000009' },
  { email: 'sysadmin@aegis-ops.io',     displayName: 'SysAdmin Eoin Doyle',        role: 'admin',    department: 'IT & Systems',             phone: '+353861000010' },
]

// ─── REPORT DATA ─────────────────────────────────────────────────────
// 30 reports across all 6 incident categories
// Coordinates are real locations across Ireland
const REPORTS: Array<{
  citizenIdx: number; category: string; subtype: string; displayType: string
  severity: 'high' | 'medium' | 'low'; description: string; locationText: string
  lat: number; lng: number; trapped: string
}> = [
  // ── NATURAL DISASTERS (13 reports) ──
  { citizenIdx: 0,  category: 'natural_disaster', subtype: 'flood',         displayType: 'River Flood',       severity: 'high',   description: 'River Liffey has breached its banks near Chapelizod. Water level rising rapidly — approximately 1.5m above normal. Multiple residential streets submerged. Several families on upper floors requesting rescue.',                                              locationText: 'Chapelizod, Dublin 20', lat: 53.3458, lng: -6.3412, trapped: 'yes' },
  { citizenIdx: 1,  category: 'natural_disaster', subtype: 'flood',         displayType: 'Coastal Flood',     severity: 'high',   description: 'Storm surge has overwhelmed coastal defences at Crosshaven. Seawater flooding main street and lower harbour area. Boats dislodged from moorings. Estimated 30+ properties affected.',                                                                        locationText: 'Crosshaven, Co. Cork',  lat: 51.8019, lng: -8.2925, trapped: 'no' },
  { citizenIdx: 2,  category: 'natural_disaster', subtype: 'severe_storm',  displayType: 'Severe Storm',      severity: 'high',   description: 'Category-strong winds measured at 130 km/h with sustained gusts. Multiple trees down across N6 highway. Power lines severed in Oranmore and Clarinbridge. Driving conditions extremely dangerous. Galway Bay waves reaching 8m.',                            locationText: 'Oranmore, Co. Galway',  lat: 53.2689, lng: -8.9167, trapped: 'no' },
  { citizenIdx: 5,  category: 'natural_disaster', subtype: 'severe_storm',  displayType: 'Thunderstorm',      severity: 'medium', description: 'Intense thunderstorm cell with frequent lightning strikes. Heavy hail reported — golf-ball sized hailstones damaging vehicles and greenhouses. Flash flooding on local roads near Bennettsbridge.',                                                      locationText: 'Bennettsbridge, Co. Kilkenny', lat: 52.6133, lng: -7.1775, trapped: 'no' },
  { citizenIdx: 9,  category: 'natural_disaster', subtype: 'landslide',     displayType: 'Mudslide',          severity: 'high',   description: 'Major landslide on Benbulben slopes following 72 hours of sustained rainfall. Approximately 500m³ of debris has blocked the R286 road completely. One car reported buried under the debris. Emergency excavation required immediately.',               locationText: 'Glencar, Co. Sligo',    lat: 54.3403, lng: -8.3694, trapped: 'yes' },
  { citizenIdx: 6,  category: 'natural_disaster', subtype: 'storm',         displayType: 'Coastal Storm',     severity: 'medium', description: 'Storm-force winds and heavy seas battering the coast. Wexford harbour closed to all traffic. Several sea walls showing signs of structural stress. Spray reaching 50m inland.',                                                                       locationText: 'Rosslare, Co. Wexford', lat: 52.2592, lng: -6.3853, trapped: 'no' },
  { citizenIdx: 18, category: 'natural_disaster', subtype: 'heatwave',      displayType: 'Extreme Heat',      severity: 'medium', description: 'Temperature reached 34°C for the third consecutive day. Met Éireann red warning in effect. Multiple elderly residents reporting heat exhaustion symptoms. Water pressure declining in Kildare supply zone. Livestock at risk.',             locationText: 'Maynooth, Co. Kildare', lat: 53.3815, lng: -6.5917, trapped: 'no' },
  { citizenIdx: 11, category: 'natural_disaster', subtype: 'wildfire',      displayType: 'Gorse Fire',        severity: 'high',   description: 'Rapidly spreading gorse fire on Slieve Mish mountains. Fire front estimated at 2km wide. Wind driving flames towards residential areas in Blennerville. Smoke reducing visibility to <100m on N86. Air quality hazardous.',                             locationText: 'Blennerville, Co. Kerry', lat: 52.2667, lng: -9.7500, trapped: 'no' },
  { citizenIdx: 15, category: 'natural_disaster', subtype: 'drought',       displayType: 'Water Shortage',    severity: 'medium', description: 'Prolonged dry spell — 42 days without significant rainfall. Local group water scheme reservoir at 15% capacity. Agricultural irrigation banned. Rivers at historic low levels. Fish kills reported in Finn River tributary.',                     locationText: 'Ballybofey, Co. Donegal', lat: 54.7989, lng: -7.7850, trapped: 'no' },
  { citizenIdx: 14, category: 'natural_disaster', subtype: 'earthquake',    displayType: 'Earthquake',        severity: 'low',    description: 'Minor seismic event detected — approximately 2.8 magnitude. Residents report brief tremor lasting 5 seconds and rattling of windows. No structural damage observed but some concern among residents unused to seismic activity.',                     locationText: 'Tullamore, Co. Offaly',  lat: 53.2738, lng: -7.4889, trapped: 'no' },
  { citizenIdx: 17, category: 'natural_disaster', subtype: 'tornado',       displayType: 'Tornado Warning',   severity: 'high',   description: 'Confirmed funnel cloud touched down near Westport. Estimated EF-1 intensity. Three farm buildings destroyed, roof torn from one dwelling. Flying debris field extends 400m. Power lines down across multiple townlands.',                               locationText: 'Westport, Co. Mayo',     lat: 53.8008, lng: -9.5181, trapped: 'yes' },
  { citizenIdx: 3,  category: 'natural_disaster', subtype: 'tsunami',       displayType: 'Tidal Surge',       severity: 'low',    description: 'Unusual tidal surge observed at Shannon Estuary — water level 0.8m above predicted high tide. Likely related to Atlantic pressure system. Monitoring situation. No immediate danger but precautionary warnings issued for low-lying areas.',              locationText: 'Foynes, Co. Limerick',   lat: 52.6139, lng: -9.1072, trapped: 'no' },
  { citizenIdx: 19, category: 'natural_disaster', subtype: 'avalanche',     displayType: 'Snow Avalanche',    severity: 'medium', description: 'Snow cornice collapse on Carrauntoohil east face following temperature rise. Debris field blocking Devil\'s Ladder route. Two hill-walkers sheltering at emergency bivvy — phone contact maintained. Mountain rescue team assembling.',          locationText: "Carrauntoohil, Co. Kerry", lat: 51.9991, lng: -9.7439, trapped: 'yes' },

  // ── INFRASTRUCTURE (6 reports) ──
  { citizenIdx: 3,  category: 'infrastructure', subtype: 'infrastructure_damage', displayType: 'Road Collapse',    severity: 'high',   description: 'Major sinkhole opened on the N20 bypass — approximately 6m diameter and 4m deep. Two lanes completely impassable. Traffic diverted via R527. Appears to be caused by collapsed culvert beneath the roadway. Structural engineer required.',                    locationText: 'Patrickswell, Co. Limerick', lat: 52.6092, lng: -8.7178, trapped: 'no' },
  { citizenIdx: 13, category: 'infrastructure', subtype: 'building_collapse',    displayType: 'Partial Collapse', severity: 'high',   description: 'Gable wall of derelict mill building has collapsed onto adjacent car park. Three vehicles crushed. Remaining structure appears highly unstable. Exclusion zone of 50m recommended. No casualties confirmed but access to check underneath vehicles needed.',  locationText: 'Carlow Town, Co. Carlow',    lat: 52.8409, lng: -6.9261, trapped: 'yes' },
  { citizenIdx: 7,  category: 'infrastructure', subtype: 'bridge_damage',        displayType: 'Bridge Damage',    severity: 'medium', description: 'Visible cracking on main span of pedestrian bridge over Boyne. Cracks widening — measured 12mm gap, was 3mm last month. Vibration noticeable when crossed. Bridge serves as primary school access route. Urgent structural assessment needed.',     locationText: 'Drogheda, Co. Louth',        lat: 53.7179, lng: -6.3489, trapped: 'no' },
  { citizenIdx: 16, category: 'infrastructure', subtype: 'gas_leak',             displayType: 'Gas Leak',         severity: 'high',   description: 'Strong odour of gas detected on Trimgate Street. Suspected fractured gas main following utility works. Residents of 8 adjacent houses being evacuated as a precaution. Gas Networks Ireland contacted. Fire service establishing safety perimeter.',       locationText: 'Navan, Co. Meath',           lat: 53.6528, lng: -6.6814, trapped: 'no' },
  { citizenIdx: 4,  category: 'infrastructure', subtype: 'sinkhole',             displayType: 'Sinkhole',         severity: 'medium', description: 'Ground subsidence developing in residential garden. Hole approximately 2m across, depth unknown. Adjacent garden wall tilting. Two houses showing new cracks in foundation walls. Geologist assessment urgent — possible mine workings below.',          locationText: 'Tramore, Co. Waterford', lat: 52.1601, lng: -7.1508, trapped: 'no' },
  { citizenIdx: 8,  category: 'infrastructure', subtype: 'structural',           displayType: 'Structural Risk',  severity: 'low',    description: 'Storm damage to telecommunications mast. Guy wire snapped and mast showing 5° lean. Adjacent to busy car park. Owner notified but no response after 48 hours. Risk of further deterioration in forecast winds.',                                             locationText: 'Dundalk, Co. Louth',     lat: 54.0054, lng: -6.4017, trapped: 'no' },

  // ── PUBLIC SAFETY (4 reports) ──
  { citizenIdx: 10, category: 'public_safety', subtype: 'public_safety_incident', displayType: 'Public Hazard',    severity: 'medium', description: 'Large section of river bank has collapsed into the Shannon at Athlone Lock. Steel fencing now hanging dangerously over the water. Popular walking route — several families with children in the area daily. Temporary barrier needed urgently.',          locationText: 'Athlone, Co. Westmeath', lat: 53.4233, lng: -7.9408, trapped: 'no' },
  { citizenIdx: 12, category: 'public_safety', subtype: 'person_trapped',         displayType: 'Person Trapped',   severity: 'high',   description: 'Elderly woman trapped in her home by rising flood waters. Water level reached ground-floor window sills. She is on the first floor but has limited mobility. No boat access currently. Address is 3 Bridge View, Ennis.',                                    locationText: 'Ennis, Co. Clare',       lat: 52.8431, lng: -8.9865, trapped: 'yes' },
  { citizenIdx: 9,  category: 'public_safety', subtype: 'missing_person',         displayType: 'Missing Person',   severity: 'high',   description: 'Hill-walker (male, 45) reported overdue. Last contact 14:00 yesterday — planned Ben Bulben summit via north face. Not equipped for overnight. Temperature dropped to 2°C overnight. Phone going straight to voicemail. Family extremely concerned.',      locationText: 'Drumcliff, Co. Sligo',   lat: 54.3294, lng: -8.4917, trapped: 'no' },
  { citizenIdx: 19, category: 'public_safety', subtype: 'hazardous_area',         displayType: 'Hazardous Area',   severity: 'low',    description: 'Quarry blasting operations creating significant vibration in nearby residential estate. Residents report cracks appearing in walls. Blasting schedule not communicated to community. Dust levels also elevated.',                                            locationText: 'Rochfortbridge, Co. Westmeath', lat: 53.4125, lng: -7.2939, trapped: 'no' },

  // ── COMMUNITY SAFETY (3 reports) ──
  { citizenIdx: 4,  category: 'community_safety', subtype: 'power_outage',            displayType: 'Power Outage',       severity: 'medium', description: 'Complete power failure affecting approximately 2,500 homes in Waterford city centre. Outage duration now exceeds 6 hours. Traffic lights out at 4 major intersections. Hospital running on backup generators. ESB Networks reports damaged transformer.',    locationText: 'Waterford City Centre',     lat: 52.2593, lng: -7.1101, trapped: 'no' },
  { citizenIdx: 15, category: 'community_safety', subtype: 'water_supply_disruption', displayType: 'Water Contamination', severity: 'high',   description: 'Boil-water notice issued for Letterkenny public supply. E. coli detected in routine sampling. Affects estimated 15,000 residents. Source suspected — agricultural runoff into Lough Salt intake. Irish Water deploying emergency tankers.',                 locationText: 'Letterkenny, Co. Donegal',  lat: 54.9558, lng: -7.7342, trapped: 'no' },
  { citizenIdx: 17, category: 'community_safety', subtype: 'evacuation',              displayType: 'Evacuation Required', severity: 'high',   description: 'Mandatory evacuation ordered for Westport Quay area. River Carrowbeg expected to exceed flood defence capacity within 3 hours based on upstream gauge readings. Evacuation centre set up at Westport Town Hall. Transport being coordinated for elderly.',   locationText: 'Westport Quay, Co. Mayo',   lat: 53.7997, lng: -9.5275, trapped: 'no' },

  // ── ENVIRONMENTAL HAZARD (2 reports) ──
  { citizenIdx: 2,  category: 'environmental', subtype: 'environmental_hazard', displayType: 'Oil Spill',           severity: 'medium', description: 'Significant oil sheen observed on Galway Bay near Mutton Island. Estimated 200m² coverage and expanding with tide. Source appears to be a grounded vessel. Wildlife rescue teams notified — oiled seabirds already observed. Beach closure recommended.',  locationText: 'Salthill, Co. Galway',    lat: 53.2572, lng: -9.0856, trapped: 'no' },
  { citizenIdx: 16, category: 'environmental', subtype: 'chemical',             displayType: 'Chemical Spill',      severity: 'high',   description: 'Overturned tanker on M3 motorway leaking unknown chemical. Strong acrid smell. HazMat team requested. Two lanes closed. Wind carrying fumes towards Dunshaughlin residential area. Residents advised to close windows and remain indoors.',                locationText: 'Dunshaughlin, Co. Meath', lat: 53.5128, lng: -6.5400, trapped: 'no' },

  // ── MEDICAL EMERGENCY (2 reports) ──
  { citizenIdx: 10, category: 'medical', subtype: 'mass_casualty',   displayType: 'Mass Casualty Event', severity: 'high',   description: 'Multi-vehicle collision on the M6 motorway involving 8 vehicles including a bus. Initial reports suggest 15+ casualties with various injuries. Two persons trapped in vehicles requiring hydraulic rescue. Traffic backed up 5km in both directions.', locationText: 'Ballinasloe, Co. Galway', lat: 53.3319, lng: -8.2328, trapped: 'yes' },
  { citizenIdx: 14, category: 'medical', subtype: 'contamination',   displayType: 'Water Contamination',  severity: 'medium', description: 'Multiple residents in housing estate reporting gastrointestinal symptoms. 12 cases in past 24 hours from same neighbourhood. Suspected contaminated private well serving estate. HSE environmental health team requested. Water samples being collected.',  locationText: 'Clara, Co. Offaly', lat: 53.3422, lng: -7.6136, trapped: 'no' },
]

// ─── COMMUNITY CHAT MESSAGES ─────────────────────────────────────────
const COMMUNITY_MESSAGES = [
  'Has anyone else noticed the water level rising near the bridge?',
  'Power has been out for 3 hours in our area. Any updates from ESB?',
  'Stay safe everyone. The storm is getting worse here on the coast.',
  'Can someone confirm if the evacuation centre is open at the town hall?',
  'I can see smoke from the hills — is there a fire reported?',
  'Road completely flooded on the N20 bypass. Do not attempt to drive through.',
  'Our well water has turned brown after the heavy rain. Is this normal?',
  'Offering spare rooms for anyone displaced by the flooding. DM me.',
  'The emergency services were brilliant today — rescued our neighbour within 20 minutes.',
  'Is there a volunteer coordination point set up? I have a 4x4 and want to help.',
  'Just heard thunder and saw lightning strike near the school. Everyone OK?',
  'The council has set up sand-bag collection points at three locations.',
  'Warning: fallen tree blocking the main road into Ennis from the south.',
  'Can any nurse help? Elderly gentleman at the shelter seems to be in distress.',
  'River gauge at Bandon just crossed the flood threshold. Be prepared.',
  'Thank you to AEGIS team for the early warning — we were able to move valuables upstairs.',
  'Is drinking water safe in Letterkenny? Just heard about the boil notice.',
  'Schools are closed tomorrow according to the county council website.',
  'Does anyone know if the coast guard has been called about the oil spill?',
  'The wind is absolutely howling. Tiles flying off roofs in our estate.',
]

// ─── ONE-TO-ONE MESSAGES TO ADMIN ────────────────────────────────────
const CITIZEN_TO_ADMIN_MESSAGES = [
  'Hello, I submitted a flood report for Chapelizod. Can you confirm it was received?',
  'The situation in Cork harbour is deteriorating rapidly. Do you need more details?',
  'I have photos of the storm damage in Galway — how do I upload them?',
  'Is there an update on the infrastructure repair timeline for the N20?',
  'My elderly mother is in the flood zone and needs medical supplies. Can you help?',
  'I am a trained first responder — how can I assist officially?',
  'The coastal defences in Wexford need urgent inspection after last night.',
  'I can provide real-time data feeds from my weather station in Drogheda.',
  'There are vulnerable families in the affected area who need assistance.',
  'The mountain rescue team needs helicopter support for Benbulben. Who to contact?',
  'Water pressure has dropped to nothing in our area. Is this related to the drought?',
  'I have a boat available for rescue operations if needed. Please advise.',
  'Students at the school are frightened — can you send a reassurance update?',
  'The building collapse in Carlow looks much worse than initially reported.',
  'We have found the missing hiker\'s rucksack on the north trail. Coordinates shared in report.',
  'Rural Donegal roads are impassable. We need emergency supplies delivered.',
  'The GIS data shows this sinkhole aligns with historic mine workings.',
  'Evacuation transport is needed for 12 elderly residents in Castlebar area.',
  'My climate sensors show unprecedented heat anomaly. Happy to share raw data.',
  'The Red Cross shelter is at capacity. We need additional facility opened.',
]

// ─── HELPER ──────────────────────────────────────────────────────────
function generateReportNumber(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let num = 'RPT-'
  for (let i = 0; i < 8; i++) num += chars[Math.floor(Math.random() * chars.length)]
  return num
}

// ─── MAIN ────────────────────────────────────────────────────────────
async function main() {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const password = 'AegisTest@2026!'
    const hash = await bcrypt.hash(password, 12)

    console.log('\n=== SEEDING AEGIS v6 DATABASE ===\n')

    // ── 1. CREATE 20 CITIZEN ACCOUNTS ──
    console.log('--- Creating 20 citizen accounts ---')
    const citizenIds: string[] = []
    for (const c of CITIZENS) {
      const existing = await client.query('SELECT id FROM citizens WHERE email = $1', [c.email])
      if (existing.rows.length > 0) {
        citizenIds.push(existing.rows[0].id)
        console.log(`  [EXISTS] ${c.displayName} (${c.email})`)
        continue
      }
      const res = await client.query(
        `INSERT INTO citizens (email, password_hash, display_name, phone, role, preferred_region, country, city, bio, email_verified, is_active, login_count)
         VALUES ($1, $2, $3, $4, 'citizen', 'ireland', $5, $6, $7, true, true, 1)
         RETURNING id`,
        [c.email, hash, c.displayName, c.phone, c.country, c.city, c.bio]
      )
      citizenIds.push(res.rows[0].id)
      console.log(`  [CREATED] ${c.displayName} (${c.email})`)
    }

    // ── 2. CREATE 10 OPERATOR ACCOUNTS ──
    console.log('\n--- Creating 10 operator accounts ---')
    const operatorIds: string[] = []
    for (const op of OPERATORS) {
      const existing = await client.query('SELECT id FROM operators WHERE email = $1', [op.email])
      if (existing.rows.length > 0) {
        operatorIds.push(existing.rows[0].id)
        console.log(`  [EXISTS] ${op.displayName} (${op.email})`)
        continue
      }
      const res = await client.query(
        `INSERT INTO operators (email, password_hash, display_name, role, department, phone, is_active)
         VALUES ($1, $2, $3, $4::operator_role, $5, $6, true)
         RETURNING id`,
        [op.email, hash, op.displayName, op.role, op.department, op.phone]
      )
      operatorIds.push(res.rows[0].id)
      console.log(`  [CREATED] ${op.displayName} (${op.email}) — Role: ${op.role}, Dept: ${op.department}`)
    }

    // ── 3. CREATE 30 REPORTS ──
    console.log('\n--- Creating 30 incident reports ---')
    let reportCount = 0
    for (const r of REPORTS) {
      const reportNumber = generateReportNumber()
      const reporterName = CITIZENS[r.citizenIdx].displayName
      const aiConfidence = Math.floor(Math.random() * 30) + 65 // 65-94
      const createdAt = new Date(Date.now() - Math.floor(Math.random() * 7 * 24 * 60 * 60000)).toISOString()
      try {
        await client.query(
          `INSERT INTO reports
            (report_number, incident_category, incident_subtype, display_type, description,
             severity, trapped_persons, location_text, coordinates, has_media,
             reporter_name, ai_confidence, status, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8,
                   ST_SetSRID(ST_MakePoint($9, $10), 4326),
                   false, $11, $12, 'unverified', $13)`,
          [reportNumber, r.category, r.subtype, r.displayType, r.description,
           r.severity, r.trapped, r.locationText, r.lng, r.lat,
           reporterName, aiConfidence, createdAt]
        )
        reportCount++
        console.log(`  [REPORT ${reportCount}] ${reportNumber} — ${r.displayType} @ ${r.locationText} (${r.severity}) by ${reporterName}`)
      } catch (err: any) {
        console.error(`  [ERROR] ${r.displayType}: ${err.message}`)
      }
    }

    // ── 4. ADD COMMUNITY CHAT MESSAGES ──
    console.log('\n--- Adding community chat messages ---')
    for (let i = 0; i < COMMUNITY_MESSAGES.length; i++) {
      const citizenId = citizenIds[i % citizenIds.length]
      const createdAt = new Date(Date.now() - Math.floor(Math.random() * 3 * 24 * 60 * 60000)).toISOString()
      try {
        await client.query(
          `INSERT INTO community_chat_messages (sender_id, sender_type, content, created_at)
           VALUES ($1, 'citizen', $2, $3)`,
          [citizenId, COMMUNITY_MESSAGES[i], createdAt]
        )
        console.log(`  [CHAT] ${CITIZENS[i % CITIZENS.length].displayName}: "${COMMUNITY_MESSAGES[i].slice(0, 50)}..."`)
      } catch (err: any) {
        console.error(`  [ERROR] community message: ${err.message}`)
      }
    }

    // ── 5. CREATE ONE-TO-ONE MESSAGE THREADS (citizen → admin) ──
    console.log('\n--- Creating citizen-to-admin message threads ---')
    const adminId = operatorIds[0] // Commander gets the messages
    for (let i = 0; i < 20; i++) {
      const citizenId = citizenIds[i]
      const citizenName = CITIZENS[i].displayName
      const subject = `Inquiry from ${citizenName}`
      const createdAt = new Date(Date.now() - Math.floor(Math.random() * 5 * 24 * 60 * 60000)).toISOString()
      try {
        // Create thread
        const threadRes = await client.query(
          `INSERT INTO message_threads (citizen_id, subject, status, priority, assigned_to, category, created_at)
           VALUES ($1, $2, 'open', 'normal', $3, 'inquiry', $4)
           RETURNING id`,
          [citizenId, subject, adminId, createdAt]
        )
        const threadId = threadRes.rows[0].id

        // Insert citizen's message
        await client.query(
          `INSERT INTO messages (thread_id, sender_type, sender_id, content, status, created_at)
           VALUES ($1, 'citizen', $2, $3, 'sent', $4)`,
          [threadId, citizenId, CITIZEN_TO_ADMIN_MESSAGES[i], createdAt]
        )
        console.log(`  [THREAD] ${citizenName} → Admin: "${CITIZEN_TO_ADMIN_MESSAGES[i].slice(0, 50)}..."`)
      } catch (err: any) {
        console.error(`  [ERROR] thread for ${citizenName}: ${err.message}`)
      }
    }

    // ── 6. CREATE ALERT SUBSCRIPTIONS (from citizens) ──
    console.log('\n--- Adding alert subscriptions ---')
    for (let i = 0; i < 20; i++) {
      const c = CITIZENS[i]
      const channels = i % 3 === 0 ? ['email', 'sms', 'whatsapp'] : i % 3 === 1 ? ['email', 'telegram'] : ['email', 'sms']
      const verificationToken = crypto.randomBytes(32).toString('hex')
      try {
        // Check if subscription already exists
        const existingSub = await client.query('SELECT id FROM alert_subscriptions WHERE email = $1', [c.email])
        if (existingSub.rows.length > 0) {
          console.log(`  [EXISTS] ${c.displayName}`)
          continue
        }
        await client.query(
          `INSERT INTO alert_subscriptions
            (email, phone, channels, location_lat, location_lng, radius_km,
             severity_filter, verified, consent_given, consent_timestamp,
             verification_token, subscriber_name)
           VALUES ($1, $2, $3, $4, $5, 50, $6, true, true, NOW(), $7, $8)`,
          [c.email, c.phone, channels,
            REPORTS[i % REPORTS.length]?.lat || 53.35, REPORTS[i % REPORTS.length]?.lng || -6.26,
            ['critical', 'warning', 'info'], verificationToken, c.displayName]
        )
        console.log(`  [SUB] ${c.displayName} — channels: ${channels.join(', ')}`)
      } catch (err: any) {
        console.error(`  [ERROR] subscription for ${c.displayName}: ${err.message}`)
      }
    }

    await client.query('COMMIT')

    // ── SUMMARY ──
    console.log('\n' + '='.repeat(72))
    console.log('  SEED COMPLETE — ALL ACCOUNTS + DATA CREATED')
    console.log('='.repeat(72))
    
    console.log('\n--- 20 CITIZEN ACCOUNTS ---')
    console.log('Password for ALL citizens: ' + password)
    console.log('─'.repeat(72))
    console.log(`${'Name'.padEnd(22)} ${'Email'.padEnd(36)} ${'City'.padEnd(14)} Phone`)
    console.log('─'.repeat(72))
    CITIZENS.forEach(c => {
      console.log(`${c.displayName.padEnd(22)} ${c.email.padEnd(36)} ${c.city.padEnd(14)} ${c.phone}`)
    })

    console.log('\n--- 10 OPERATOR / ADMIN ACCOUNTS ---')
    console.log('Password for ALL operators: ' + password)
    console.log('─'.repeat(92))
    console.log(`${'Name'.padEnd(32)} ${'Email'.padEnd(28)} ${'Role'.padEnd(10)} ${'Department'.padEnd(26)}`)
    console.log('─'.repeat(92))
    OPERATORS.forEach(op => {
      console.log(`${op.displayName.padEnd(32)} ${op.email.padEnd(28)} ${op.role.padEnd(10)} ${op.department}`)
    })

    console.log('\n--- REPORT SUMMARY ---')
    const cats: Record<string, number> = {}
    REPORTS.forEach(r => { cats[r.category] = (cats[r.category] || 0) + 1 })
    Object.entries(cats).forEach(([cat, count]) => console.log(`  ${cat}: ${count} reports`))
    console.log(`  TOTAL: ${REPORTS.length} reports`)

    console.log('\n--- DATA CREATED ---')
    console.log(`  Community chat messages: ${COMMUNITY_MESSAGES.length}`)
    console.log(`  One-to-one message threads: 20`)
    console.log(`  Alert subscriptions: 20`)
    console.log('')

  } catch (err) {
    await client.query('ROLLBACK')
    console.error('SEED FAILED:', err)
    throw err
  } finally {
    client.release()
    await pool.end()
  }
}

main().catch(err => { console.error(err); process.exit(1) })
