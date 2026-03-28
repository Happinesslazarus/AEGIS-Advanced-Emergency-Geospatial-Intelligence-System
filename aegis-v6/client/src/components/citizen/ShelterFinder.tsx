/* ShelterFinder.tsx — Professional Safe-Zone Finder — Real Overpass API data, global coverage */

import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Home,
  MapPin,
  Navigation,
  Phone,
  Shield,
  Loader2,
  ChevronRight,
  AlertTriangle,
  Wifi,
  Droplets,
  Zap,
  Search,
  RefreshCw,
  Clock,
  ExternalLink,
  Activity,
  Building2,
  GraduationCap,
  Heart,
  MapPinned,
  Compass,
  Star,
  ArrowUpRight,
  Globe,
  BookOpen,
} from 'lucide-react'
import { forwardGeocode, getDeviceLocation, haversineKm, reverseGeocode, type Coordinates, type ForwardGeocodeResult } from '../../utils/locationUtils'
import { t } from '../../utils/i18n'
import { useLanguage } from '../../hooks/useLanguage'

/*  Types & constants                                                        */

interface Shelter {
  id: string
  name: string
  type: 'shelter' | 'hospital' | 'fire_station' | 'community_centre' | 'school'
  lat: number
  lng: number
  address: string
  phone?: string
  capacity: number
  occupancy: number
  amenities: string[]
  isOpen: boolean
  distance?: number
}

const TYPE_CONFIG = {
  shelter:          { icon: Home,          label: 'Emergency Shelter', short: 'Shelter',    gradient: 'from-emerald-500 to-teal-600',   ring: 'ring-emerald-500/40', dot: 'bg-emerald-500', text: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-50 dark:bg-emerald-950/20' },
  hospital:         { icon: Heart,         label: 'Hospital',          short: 'Hospital',   gradient: 'from-red-500 to-rose-600',       ring: 'ring-red-500/40',     dot: 'bg-red-500',     text: 'text-red-600 dark:text-red-400',         bg: 'bg-red-50 dark:bg-red-950/20' },
  fire_station:     { icon: Zap,           label: 'Fire Station',      short: 'Fire Stn',   gradient: 'from-amber-500 to-orange-600',   ring: 'ring-amber-500/40',   dot: 'bg-amber-500',   text: 'text-amber-600 dark:text-amber-400',     bg: 'bg-amber-50 dark:bg-amber-950/20' },
  community_centre: { icon: Building2,     label: 'Community Centre',  short: 'Community',  gradient: 'from-blue-500 to-indigo-600',    ring: 'ring-blue-500/40',    dot: 'bg-blue-500',    text: 'text-blue-600 dark:text-blue-400',       bg: 'bg-blue-50 dark:bg-blue-950/20' },
  school:           { icon: GraduationCap, label: 'School',            short: 'School',     gradient: 'from-violet-500 to-purple-600',  ring: 'ring-violet-500/40',  dot: 'bg-violet-500',  text: 'text-violet-600 dark:text-violet-400',   bg: 'bg-violet-50 dark:bg-violet-950/20' },
} as const

const AMENITY_META: Record<string, { icon: typeof Wifi; label: string; color: string }> = {
  wifi:    { icon: Wifi,     label: 'Wi-Fi',      color: 'text-blue-500  bg-blue-50 dark:bg-blue-950/30' },
  beds:    { icon: Home,     label: 'Beds',       color: 'text-indigo-500 bg-indigo-50 dark:bg-indigo-950/30' },
  food:    { icon: Droplets, label: 'Food/Water', color: 'text-teal-500 bg-teal-50 dark:bg-teal-950/30' },
  medical: { icon: Shield,   label: 'Medical',    color: 'text-red-500 bg-red-50 dark:bg-red-950/30' },
}

function estimateWalkMin(km: number | undefined): string {
  if (km == null) return '--'
  const mins = Math.round(km / 0.08)  // ~4.8 km/h walking speed
  if (mins < 60) return `${mins} min`
  const h = Math.floor(mins / 60)
  return `${h}h ${mins % 60}m`
}

function safetyScore(s: Shelter): number {
  let score = 50
  if (s.isOpen) score += 15
  if (s.amenities.includes('medical')) score += 15
  if (s.amenities.includes('food')) score += 10
  if (s.amenities.includes('wifi')) score += 5
  if (s.amenities.includes('beds')) score += 5
  const occPct = s.capacity ? (s.occupancy / s.capacity) * 100 : 0
  if (occPct < 50) score += 10
  else if (occPct < 80) score += 5
  return Math.min(score, 100)
}

// Keyed by ISO 3166-1 alpha-2 code (uppercase). Falls back to universal links.
const COUNTRY_RESOURCES: Record<string, { name: string; url: string; desc: string }[]> = {
  GB: [
    { name: 'UK GOV — Emergency Alerts', url: 'https://www.gov.uk/alerts', desc: 'Official UK government emergency guidance' },
    { name: 'Environment Agency Flood Maps', url: 'https://flood-map-for-planning.service.gov.uk/', desc: 'Check your flood risk & safe routes' },
    { name: 'Red Cross UK — Find Support', url: 'https://www.redcross.org.uk/get-help', desc: 'British Red Cross emergency support' },
  ],
  US: [
    { name: 'FEMA Disaster Resources', url: 'https://www.disasterassistance.gov/', desc: 'Federal emergency assistance & shelter finder' },
    { name: 'FEMA Shelter Finder', url: 'https://www.fema.gov/disasters/shelters', desc: 'Real-time FEMA shelter locator' },
    { name: 'Red Cross Shelter Finder', url: 'https://www.redcross.org/get-help/disaster-relief-and-recovery-services/find-an-open-shelter.html', desc: 'American Red Cross open shelters' },
  ],
  CA: [
    { name: 'Public Safety Canada', url: 'https://www.publicsafety.gc.ca/cnt/mrgnc-mngmnt/index-en.aspx', desc: 'Canadian emergency management resources' },
    { name: 'Canadian Red Cross', url: 'https://www.redcross.ca/how-we-help/emergencies-and-disasters', desc: 'Red Cross emergency shelter in Canada' },
  ],
  AU: [
    { name: 'Australian Disaster Resilience', url: 'https://www.aidr.org.au/', desc: 'Australian disaster info & shelters' },
    { name: 'Red Cross Australia', url: 'https://www.redcross.org.au/emergencies', desc: 'Australian Red Cross emergency services' },
    { name: 'Australia Emergency Alerts', url: 'https://www.emergency.vic.gov.au/', desc: 'Victorian Emergency alerts and evacuation centres' },
  ],
  NZ: [
    { name: 'NZ MCDEM', url: 'https://www.civildefence.govt.nz/', desc: 'New Zealand Civil Defence & emergency management' },
    { name: 'GetReady NZ', url: 'https://getready.govt.nz/', desc: 'NZ emergency preparation and evacuations' },
  ],
  DE: [
    { name: 'BBK Germany', url: 'https://www.bbk.bund.de/', desc: 'Bundesamt für Bevölkerungsschutz und Katastrophenhilfe' },
    { name: 'DRK Hilfe', url: 'https://www.drk.de/hilfe-in-deutschland/', desc: 'Deutsches Rotes Kreuz — emergency aid' },
  ],
  FR: [
    { name: 'Gouvernement — Risques', url: 'https://www.gouvernement.fr/risques', desc: 'French government emergency risk info' },
    { name: 'Croix-Rouge France', url: 'https://www.croix-rouge.fr/nos-actions/action-sociale/aide-en-cas-de-catastrophe', desc: 'French Red Cross disaster shelters' },
  ],
  ES: [
    { name: 'Protección Civil España', url: 'https://www.proteccioncivil.es/', desc: 'Spanish Civil Protection emergency info' },
    { name: 'Cruz Roja España', url: 'https://www.cruzroja.es/principal/web/cruz-roja/emergencias', desc: 'Spanish Red Cross emergency services' },
  ],
  IT: [
    { name: 'Protezione Civile Italia', url: 'https://www.protezionecivile.gov.it/', desc: 'Italian Civil Protection Department' },
    { name: 'CRI Emergenze', url: 'https://www.cri.it/cosa-facciamo/emergenza', desc: 'Croce Rossa Italiana emergency response' },
  ],
  JP: [
    { name: 'Cabinet Office Disaster Japan', url: 'https://www.bousai.go.jp/en/', desc: 'Japan Cabinet Office disaster prevention' },
    { name: 'Safety Tips Japan', url: 'https://www.jnto.go.jp/safety-tips/eng/index.html', desc: 'Japan Tourism disaster safety for visitors' },
    { name: 'Yahoo Japan Hazard Map', url: 'https://map.yahoo.co.jp/route/walk', desc: 'Japanese hazard & evacuation map' },
  ],
  CN: [
    { name: 'MEM China', url: 'https://www.mem.gov.cn/', desc: 'Ministry of Emergency Management China' },
    { name: 'China Red Cross', url: 'http://www.redcross.org.cn/', desc: 'Chinese Red Cross emergency response' },
  ],
  IN: [
    { name: 'NDMA India', url: 'https://ndma.gov.in/', desc: 'National Disaster Management Authority' },
    { name: 'SDMA State Resources', url: 'https://ndma.gov.in/Resources/sdma', desc: 'State disaster management authorities' },
    { name: 'Indian Red Cross', url: 'https://www.indianredcross.org/', desc: 'Indian Red Cross emergency relief' },
  ],
  BR: [
    { name: 'Defesa Civil Brasil', url: 'https://www.gov.br/mdr/pt-br/assuntos/protecao-e-defesa-civil', desc: 'Brazilian Civil Defence' },
    { name: 'Cruz Vermelha Brasileira', url: 'https://www.cruzvermelha.org.br/', desc: 'Brazilian Red Cross emergency services' },
  ],
  MX: [
    { name: 'Protección Civil México', url: 'https://www.proteccioncivil.gob.mx/', desc: 'Mexican Civil Protection' },
    { name: 'Cruz Roja Mexicana', url: 'https://www.cruzrojamexicana.org.mx/', desc: 'Mexican Red Cross' },
  ],
  PH: [
    { name: 'NDRRMC Philippines', url: 'https://www.ndrrmc.gov.ph/', desc: 'National Disaster Risk Reduction Council' },
    { name: 'PAGASA Warnings', url: 'https://bagong.pagasa.dost.gov.ph/', desc: 'Philippine weather & typhoon warnings' },
  ],
  ID: [
    { name: 'BNPB Indonesia', url: 'https://bnpb.go.id/', desc: 'Badan Nasional Penanggulangan Bencana' },
    { name: 'PMI Indonesia', url: 'https://www.pmi.or.id/', desc: 'Palang Merah Indonesia (Red Cross)' },
  ],
  PK: [
    { name: 'NDMA Pakistan', url: 'https://ndma.gov.pk/', desc: 'National Disaster Management Authority' },
    { name: 'Pakistan Red Crescent', url: 'https://www.prcs.org.pk/', desc: 'Pakistan Red Crescent emergency services' },
  ],
  BD: [
    { name: 'DDM Bangladesh', url: 'https://ddm.gov.bd/', desc: 'Department of Disaster Management Bangladesh' },
    { name: 'BDRCS', url: 'https://bdrcs.org/', desc: 'Bangladesh Red Crescent Society' },
  ],
  NG: [
    { name: 'NEMA Nigeria', url: 'https://nema.gov.ng/', desc: 'National Emergency Management Agency Nigeria' },
    { name: 'Nigerian Red Cross', url: 'https://redcrossnigeria.org/', desc: 'Nigerian Red Cross Society' },
  ],
  ZA: [
    { name: 'NDMC South Africa', url: 'https://www.ndmc.gov.za/', desc: 'National Disaster Management Centre' },
    { name: 'SA Red Cross', url: 'https://www.redcross.org.za/', desc: 'South African Red Cross emergency services' },
  ],
  KE: [
    { name: 'Kenya Red Cross', url: 'https://www.redcross.or.ke/', desc: 'Kenya Red Cross emergency response' },
    { name: 'NDOC Kenya', url: 'https://www.interior.go.ke/', desc: 'National Disaster Operations Centre Kenya' },
  ],
  EG: [
    { name: 'NCCM Egypt', url: 'https://www.nccm.org.eg/', desc: 'National Committee for Civil Defence' },
    { name: 'Egypt Red Crescent', url: 'https://www.egyptianrc.org/', desc: 'Egyptian Red Crescent emergency services' },
  ],
  TR: [
    { name: 'AFAD Turkey', url: 'https://www.afad.gov.tr/', desc: 'Disaster and Emergency Management Presidency' },
    { name: 'Türk Kızılay', url: 'https://www.kizilay.org.tr/', desc: 'Turkish Red Crescent emergency services' },
  ],
  UA: [
    { name: 'DSNS Ukraine', url: 'https://www.dsns.gov.ua/', desc: 'State Emergency Service of Ukraine' },
    { name: 'Ukraine Red Cross', url: 'https://redcross.org.ua/', desc: 'Ukrainian Red Cross emergency shelters' },
  ],
  RU: [
    { name: 'EMERCOM Russia', url: 'https://mchs.gov.ru/', desc: 'Ministry of Emergency Situations Russia' },
    { name: 'Russian Red Cross', url: 'https://www.redcross.ru/', desc: 'Russian Red Cross emergency relief' },
  ],
  SA: [
    { name: 'SRCA Saudi Arabia', url: 'https://www.srca.org.sa/', desc: 'Saudi Red Crescent Authority' },
    { name: 'NCEMA', url: 'https://ncema.gov.sa/', desc: 'National Centre for Emergency Management' },
  ],
  AE: [
    { name: 'NCEMA UAE', url: 'https://ncema.gov.ae/', desc: 'National Emergency Crisis & Disaster Management Authority' },
    { name: 'UAE Red Crescent', url: 'https://www.rcuae.ae/', desc: 'UAE Red Crescent Authority' },
  ],
  TH: [
    { name: 'DDPM Thailand', url: 'https://www.disaster.go.th/', desc: 'Department of Disaster Prevention & Mitigation' },
    { name: 'Thai Red Cross', url: 'https://www.redcross.or.th/', desc: 'Thai Red Cross Society' },
  ],
  VN: [
    { name: 'VNDMA', url: 'https://phongchongthientai.vn/', desc: 'Vietnam Disaster Management Authority' },
    { name: 'Vietnam Red Cross', url: 'https://www.redcross.org.vn/', desc: 'Vietnam Red Cross emergency services' },
  ],
  MY: [
    { name: 'NADMA Malaysia', url: 'https://www.nadma.gov.my/', desc: 'National Disaster Management Agency' },
    { name: 'Malaysian Red Crescent', url: 'https://www.redcrescent.org.my/', desc: 'Malaysian Red Crescent emergency services' },
  ],
  SG: [
    { name: 'Singapore SCDF', url: 'https://www.scdf.gov.sg/', desc: 'Singapore Civil Defence Force' },
    { name: 'Singapore Red Cross', url: 'https://www.redcross.sg/', desc: 'Singapore Red Cross emergency aid' },
  ],
  PL: [
    { name: 'RCB Poland', url: 'https://www.gov.pl/web/rcb', desc: 'Government Security Centre Poland' },
    { name: 'PCK Poland', url: 'https://www.pck.pl/', desc: 'Polish Red Cross emergency services' },
  ],
  NL: [
    { name: 'Rijksoverheid Noodgeval', url: 'https://www.rijksoverheid.nl/onderwerpen/crisisbeheersing-en-rampenbestrijding', desc: 'Dutch government emergency management' },
    { name: 'Rode Kruis Nederland', url: 'https://www.rodekruis.nl/', desc: 'Dutch Red Cross emergency aid' },
  ],
  BE: [
    { name: 'Belgium Crisis Centre', url: 'https://crisiscentrum.be/', desc: 'Belgian national crisis centre' },
    { name: 'Belgian Red Cross', url: 'https://www.rodekruis.be/', desc: 'Belgian Red Cross emergency services' },
  ],
  CH: [
    { name: 'BABS Switzerland', url: 'https://www.babs.admin.ch/', desc: 'Federal Office for Civil Protection' },
    { name: 'Swiss Red Cross', url: 'https://www.redcross.ch/', desc: 'Swiss Red Cross emergency aid' },
  ],
  SE: [
    { name: 'MSB Sweden', url: 'https://www.msb.se/', desc: 'Swedish Civil Contingencies Agency' },
    { name: 'Swedish Red Cross', url: 'https://www.redcross.se/', desc: 'Swedish Red Cross emergency services' },
  ],
  NO: [
    { name: 'DSB Norway', url: 'https://www.dsb.no/', desc: 'Norwegian Directorate for Civil Protection' },
    { name: 'Norwegian Red Cross', url: 'https://www.rodekors.no/', desc: 'Norwegian Red Cross emergency aid' },
  ],
  DK: [
    { name: 'BEREDSKABSSTYRELSEN Denmark', url: 'https://brs.dk/', desc: 'Danish Emergency Management Agency' },
    { name: 'Danish Red Cross', url: 'https://www.rodekors.dk/', desc: 'Danish Red Cross emergency services' },
  ],
  FI: [
    { name: 'Pelastusopisto Finland', url: 'https://www.pelastusopisto.fi/', desc: 'Finnish Emergency Services Academy' },
    { name: 'Finnish Red Cross', url: 'https://www.punainenristi.fi/', desc: 'Finnish Red Cross emergency services' },
  ],
  PT: [
    { name: 'ANEPC Portugal', url: 'https://www.prociv.pt/', desc: 'Portuguese National Emergency Planning Authority' },
    { name: 'Cruz Vermelha Portuguesa', url: 'https://www.cruzvermelha.pt/', desc: 'Portuguese Red Cross emergency aid' },
  ],
  GR: [
    { name: 'GSCP Greece', url: 'http://www.civilprotection.gr/', desc: 'Greek General Secretariat for Civil Protection' },
    { name: 'Hellenic Red Cross', url: 'https://www.redcross.gr/', desc: 'Hellenic Red Cross emergency services' },
  ],
  IL: [
    { name: 'Magen David Adom', url: 'https://www.mdais.org/', desc: 'Israeli Red Cross equivalent & emergency services' },
    { name: 'Home Front Command', url: 'https://www.oref.org.il/', desc: 'Israeli Home Front Command emergency guidance' },
  ],
  KR: [
    { name: 'MOIS Korea', url: 'https://www.mois.go.kr/', desc: 'Ministry of the Interior and Safety Korea' },
    { name: 'Korean Red Cross', url: 'https://www.redcross.or.kr/', desc: 'Korean Red Cross emergency services' },
  ],
  AR: [
    { name: 'SIFEM Argentina', url: 'https://www.argentina.gob.ar/sifem', desc: 'Argentine emergency management system' },
    { name: 'Cruz Roja Argentina', url: 'https://cruzroja.org.ar/', desc: 'Argentine Red Cross emergency services' },
  ],
  CL: [
    { name: 'SENAPRED Chile', url: 'https://senapred.cl/', desc: 'Servicio Nacional de Prevención y Respuesta ante Desastres' },
    { name: 'Cruz Roja Chilena', url: 'https://cruzroja.cl/', desc: 'Chilean Red Cross emergency services' },
  ],
  CO: [
    { name: 'UNGRD Colombia', url: 'https://portal.gestiondelriesgo.gov.co/', desc: 'Colombian National Disaster Risk Unit' },
    { name: 'Cruz Roja Colombiana', url: 'https://www.cruzrojacolombiana.org/', desc: 'Colombian Red Cross emergency services' },
  ],
  PE: [
    { name: 'INDECI Peru', url: 'https://www.indeci.gob.pe/', desc: 'Peruvian Civil Defence Institute' },
    { name: 'Cruz Roja Peruana', url: 'https://www.cruzroja.org.pe/', desc: 'Peruvian Red Cross emergency services' },
  ],
  IR: [
    { name: 'NEMA Iran', url: 'https://www.nema.gov.ir/', desc: 'National Emergency Management Organisation Iran' },
    { name: 'IRCS Iran', url: 'https://www.rcs.ir/', desc: 'Iranian Red Crescent Society' },
  ],
  IQ: [
    { name: 'Iraq NCCMD', url: 'https://moenv.gov.iq/', desc: 'Iraq Civil Defence' },
    { name: 'Iraqi Red Crescent', url: 'https://www.irc.iq/', desc: 'Iraqi Red Crescent emergency aid' },
  ],
  ET: [
    { name: 'NDRMC Ethiopia', url: 'https://www.ndrmc.gov.et/', desc: 'National Disaster Risk Management Commission' },
    { name: 'Ethiopian Red Cross', url: 'https://www.ercs.org.et/', desc: 'Ethiopian Red Cross emergency services' },
  ],
  GH: [
    { name: 'NADMO Ghana', url: 'https://nadmo.gov.gh/', desc: 'National Disaster Management Organisation Ghana' },
    { name: 'Ghana Red Cross', url: 'https://www.ghanarc.org/', desc: 'Ghana Red Cross emergency assistance' },
  ],
  TZ: [
    { name: 'Tanzania DPP', url: 'https://www.dpp.go.tz/', desc: 'Tanzania Disaster Prevention & Preparedness Division' },
    { name: 'Tanzania Red Cross', url: 'https://www.trcs.or.tz/', desc: 'Tanzania Red Cross emergency services' },
  ],
  UG: [
    { name: 'OPM Uganda', url: 'https://www.opm.go.ug/', desc: 'Uganda Office of the Prime Minister — Disaster Preparedness' },
    { name: 'Uganda Red Cross', url: 'https://www.redcrossug.org/', desc: 'Uganda Red Cross emergency services' },
  ],
  RW: [
    { name: 'Rwanda MIDMAR', url: 'https://www.midimar.gov.rw/', desc: 'Rwandan Ministry of Disaster Management' },
    { name: 'Rwanda Red Cross', url: 'https://www.redcross.org.rw/', desc: 'Rwanda Red Cross emergency relief' },
  ],
  MZ: [
    { name: 'INGC Mozambique', url: 'https://www.ingc.gov.mz/', desc: 'Instituto Nacional de Gestão de Calamidades' },
    { name: 'Cruz Vermelha Moçambique', url: 'https://www.cvm.org.mz/', desc: 'Mozambique Red Cross emergency services' },
  ],
  MW: [
    { name: 'DoDMA Malawi', url: 'https://www.dodma.gov.mw/', desc: 'Malawi Department of Disaster Management' },
    { name: 'Malawi Red Cross', url: 'https://www.malawirc.org/', desc: 'Malawi Red Cross emergency services' },
  ],
  ZW: [
    { name: 'Zimbabwe CP', url: 'https://www.civilprotection.gov.zw/', desc: 'Zimbabwe Civil Protection Unit' },
    { name: 'Zimbabwe Red Cross', url: 'https://www.zrcs.org.zw/', desc: 'Zimbabwe Red Cross emergency services' },
  ],
  LA: [
    { name: 'NDMO Laos', url: 'http://ndmo.gov.la/', desc: 'National Disaster Management Organisation Laos' },
    { name: 'Lao Red Cross', url: 'https://www.laorc.org/', desc: 'Lao Red Cross emergency relief' },
  ],
  KH: [
    { name: 'NCDM Cambodia', url: 'https://www.ncdm.gov.kh/', desc: 'National Committee for Disaster Management Cambodia' },
    { name: 'Cambodia Red Cross', url: 'https://www.redcross.org.kh/', desc: 'Cambodian Red Cross Society' },
  ],
  MM: [
    { name: 'NDRRMC Myanmar', url: 'https://www.moha.gov.mm/', desc: 'Myanmar Disaster Risk Reduction portal' },
    { name: 'Myanmar Red Cross', url: 'https://www.mrcs.org.mm/', desc: 'Myanmar Red Cross emergency services' },
  ],
  NP: [
    { name: 'NDRRMA Nepal', url: 'https://ndrrma.gov.np/', desc: 'Nepal Disaster Risk Reduction & Management Authority' },
    { name: 'Nepal Red Cross', url: 'https://nrcs.org/', desc: 'Nepal Red Cross emergency services' },
  ],
  LK: [
    { name: 'DMC Sri Lanka', url: 'https://www.dmc.gov.lk/', desc: 'Disaster Management Centre Sri Lanka' },
    { name: 'Sri Lanka Red Cross', url: 'https://www.redcross.lk/', desc: 'Sri Lanka Red Cross emergency services' },
  ],
  AF: [
    { name: 'ANDMA Afghanistan', url: 'https://andma.gov.af/', desc: 'Afghanistan National Disaster Management Authority' },
    { name: 'Afghanistan Red Crescent', url: 'https://www.arcs.org.af/', desc: 'Afghan Red Crescent emergency relief' },
  ],
  HT: [
    { name: 'CNIGS Haiti', url: 'https://cnigs.ht/', desc: 'National Centre for Geospatial Information Haiti' },
    { name: 'Haiti Red Cross', url: 'https://www.croixrouge.ht/', desc: 'Haitian Red Cross emergency relief' },
  ],
  CU: [
    { name: 'Defensa Civil Cuba', url: 'https://www.granma.cu/cuba', desc: 'Cuban Civil Defence' },
    { name: 'Cruz Roja Cubana', url: 'https://www.cruzroja.cu/', desc: 'Cuban Red Cross emergency services' },
  ],
  SD: [
    { name: 'HAC Sudan', url: 'https://www.hac.gov.sd/', desc: 'Humanitarian Aid Commission Sudan' },
    { name: 'Sudanese Red Crescent', url: 'https://www.snrcs.org/', desc: 'Sudanese Red Crescent emergency services' },
  ],
  SS: [
    { name: 'NRCS South Sudan', url: 'https://southsudanredcross.org/', desc: 'South Sudan Red Cross emergency services' },
  ],
  SO: [
    { name: 'SODMA Somalia', url: 'https://nema.gov.so/', desc: 'Somalia Disaster Management Agency' },
    { name: 'Somali Red Crescent', url: 'https://www.sorc.so/', desc: 'Somali Red Crescent emergency aid' },
  ],
  YE: [
    { name: 'Yemen Red Crescent', url: 'https://www.yemenredcrescent.net/', desc: 'Yemeni Red Crescent emergency services' },
  ],
  SY: [
    { name: 'SARC Syria', url: 'https://www.sarc.org.sy/', desc: 'Syrian Arab Red Crescent emergency services' },
  ],
  LB: [
    { name: 'Lebanese Red Cross', url: 'https://www.redcross.org.lb/', desc: 'Lebanese Red Cross emergency services' },
  ],
  JO: [
    { name: 'Jordan NCSCM', url: 'https://pmo.gov.jo/', desc: 'Jordanian National Committee for Civil Defence' },
    { name: 'Jordan Red Crescent', url: 'https://www.jrcs.org/', desc: 'Jordan Red Crescent emergency aid' },
  ],
  PS: [
    { name: 'Palestine Red Crescent', url: 'https://www.palestinercs.org/', desc: 'Palestine Red Crescent emergency services' },
  ],
  VE: [
    { name: 'FUNVISIS Venezuela', url: 'http://www.funvisis.gob.ve/', desc: 'Fund for Seismic Investigation Venezuela' },
    { name: 'Cruz Roja Venezolana', url: 'https://www.cruzrojavenezolana.org/', desc: 'Venezuelan Red Cross' },
  ],
  EC: [
    { name: 'SNGRE Ecuador', url: 'https://www.gestionderiesgos.gob.ec/', desc: 'Servicio Nacional de Gestión de Riesgos y Emergencias' },
    { name: 'Cruz Roja Ecuatoriana', url: 'https://www.cruzroja.org.ec/', desc: 'Ecuadorian Red Cross' },
  ],
  BO: [
    { name: 'VIDECI Bolivia', url: 'https://www.videci.gob.bo/', desc: 'Bolivian Vice-Ministry of Civil Defence' },
    { name: 'Cruz Roja Boliviana', url: 'https://www.cruzrojaboliviana.org/', desc: 'Bolivian Red Cross' },
  ],
  PY: [
    { name: 'SEN Paraguay', url: 'https://www.stp.gov.py/', desc: 'Emergency National Secretariat Paraguay' },
    { name: 'Cruz Roja Paraguaya', url: 'https://www.cruzroja.org.py/', desc: 'Paraguayan Red Cross' },
  ],
  UY: [
    { name: 'SINAE Uruguay', url: 'https://www.gub.uy/sistema-nacional-emergencias/', desc: 'Sistema Nacional de Emergencias Uruguay' },
  ],
  HN: [
    { name: 'COPECO Honduras', url: 'https://copeco.gob.hn/', desc: 'Honduran Permanent Commission for Civil Protection' },
    { name: 'Cruz Roja Hondureña', url: 'https://www.cruzrojahonduras.org/', desc: 'Honduran Red Cross' },
  ],
  GT: [
    { name: 'CONRED Guatemala', url: 'https://conred.gob.gt/', desc: 'Guatemalan National Coordinator for Disaster Reduction' },
    { name: 'Cruz Roja Guatemalteca', url: 'https://www.cruzroja.org.gt/', desc: 'Guatemalan Red Cross' },
  ],
  NI: [
    { name: 'SINAPRED Nicaragua', url: 'https://sinapred.gob.ni/', desc: 'Nicaraguan National System for Disaster Prevention' },
    { name: 'Cruz Roja Nicaragüense', url: 'https://cruzroja.org.ni/', desc: 'Nicaraguan Red Cross' },
  ],
  CR: [
    { name: 'CNE Costa Rica', url: 'https://www.cne.go.cr/', desc: 'Commission for Emergency Prevention Costa Rica' },
    { name: 'Cruz Roja Costarricense', url: 'https://www.cruzroja.or.cr/', desc: 'Costa Rican Red Cross' },
  ],
  PA: [
    { name: 'SINAPROC Panama', url: 'https://www.sinaproc.gob.pa/', desc: 'Panama Civil Protection National System' },
    { name: 'Cruz Roja Panameña', url: 'https://www.cruzroja.org.pa/', desc: 'Panamanian Red Cross' },
  ],
  DO: [
    { name: 'COE Dominican Republic', url: 'https://coe.gob.do/', desc: 'Emergency Operations Centre Dominican Republic' },
    { name: 'Cruz Roja Dominicana', url: 'https://www.cruzrojadominicana.org/', desc: 'Dominican Red Cross' },
  ],
  JM: [
    { name: 'ODPEM Jamaica', url: 'https://www.odpem.org.jm/', desc: 'Jamaican Office of Disaster Preparedness and Emergency Management' },
    { name: 'Jamaica Red Cross', url: 'https://www.jamaicaredcross.org/', desc: 'Jamaica Red Cross emergency services' },
  ],
  TT: [
    { name: 'ODM Trinidad', url: 'https://www.odpm.gov.tt/', desc: 'Office of Disaster Preparedness and Management Trinidad' },
  ],
  CZ: [
    { name: 'GFŘ Czech Republic', url: 'https://www.hzscr.cz/', desc: 'Czech Fire & Rescue Service / Emergency Management' },
    { name: 'Czech Red Cross', url: 'https://www.cervenykriz.eu/', desc: 'Czech Red Cross emergency services' },
  ],
  SK: [
    { name: 'HaZZ Slovakia', url: 'https://www.minv.sk/?hazz', desc: 'Slovak Fire and Rescue Corps' },
    { name: 'Slovak Red Cross', url: 'https://www.redcross.sk/', desc: 'Slovak Red Cross emergency services' },
  ],
  HU: [
    { name: 'BM OKF Hungary', url: 'https://www.katasztrofavedelem.hu/', desc: 'Hungarian National Directorate for Civil Protection' },
    { name: 'Hungarian Red Cross', url: 'https://www.voroskereszt.hu/', desc: 'Hungarian Red Cross emergency services' },
  ],
  RO: [
    { name: 'IGSU Romania', url: 'https://www.igsu.ro/', desc: 'Romanian General Inspectorate for Emergency Situations' },
    { name: 'Romanian Red Cross', url: 'https://www.crucearosie.ro/', desc: 'Romanian Red Cross emergency services' },
  ],
  BG: [
    { name: 'DGPBZN Bulgaria', url: 'https://www.mvr.bg/gdpbzn/', desc: 'Bulgarian General Directorate of Civil Protection' },
    { name: 'Bulgarian Red Cross', url: 'https://www.redcross.bg/', desc: 'Bulgarian Red Cross emergency services' },
  ],
  HR: [
    { name: 'DUZS Croatia', url: 'https://civilna-zastita.gov.hr/', desc: 'Croatian Civil Protection Directorate' },
    { name: 'Hrvatski Crveni Križ', url: 'https://www.hck.hr/', desc: 'Croatian Red Cross emergency services' },
  ],
  RS: [
    { name: 'Serbia Emergency', url: 'https://www.srbija.gov.rs/', desc: 'Serbia Emergency Management Sector' },
    { name: 'Red Cross Serbia', url: 'https://www.redcross.org.rs/', desc: 'Red Cross Serbia emergency services' },
  ],
  BA: [
    { name: 'BiH Civil Protection', url: 'https://www.moi.gov.ba/', desc: 'Bosnia and Herzegovina Civil Protection' },
    { name: 'Red Cross BiH', url: 'https://www.redcross.ba/', desc: 'Red Cross Bosnia and Herzegovina' },
  ],
  PG: [
    { name: 'PNG NDMO', url: 'http://www.ndmo.gov.pg/', desc: 'Papua New Guinea National Disaster Management Office' },
    { name: 'PNG Red Cross', url: 'https://www.pngredcross.org.pg/', desc: 'Papua New Guinea Red Cross' },
  ],
  FJ: [
    { name: 'NDMO Fiji', url: 'https://www.ndmo.gov.fj/', desc: 'Fiji National Disaster Management Organisation' },
    { name: 'Fiji Red Cross', url: 'https://www.fijiredcross.org/', desc: 'Fiji Red Cross emergency services' },
  ],
  SB: [
    { name: 'NDMO Solomon Islands', url: 'https://www.ndmo.gov.sb/', desc: 'Solomon Islands NDMO' },
    { name: 'SIRCS', url: 'https://www.redcross.org.sb/', desc: 'Solomon Islands Red Cross' },
  ],
  VU: [
    { name: 'NDMO Vanuatu', url: 'http://www.ndmo.gov.vu/', desc: 'Vanuatu National Disaster Management Office' },
    { name: 'Vanuatu Red Cross', url: 'https://www.vanuaturedcross.org/', desc: 'Vanuatu Red Cross emergency services' },
  ],
  KZ: [
    { name: 'Kazakhstan Emergency Ministry', url: 'https://www.gov.kz/memleket/entities/mes/', desc: 'Kazakhstan Ministry of Emergency Situations' },
    { name: 'Kazakhstan Red Crescent', url: 'https://redcrescent.kz/', desc: 'Kazakhstan Red Crescent emergency services' },
  ],
  UZ: [
    { name: 'Uzbekistan Emergency', url: 'https://www.fvv.uz/', desc: 'Uzbekistan Ministry of Emergency Situations' },
    { name: 'Uzbekistan Red Crescent', url: 'https://www.redcrescent.uz/', desc: 'Uzbekistan Red Crescent emergency services' },
  ],
  AZ: [
    { name: 'FHNM Azerbaijan', url: 'https://fhn.gov.az/', desc: 'Ministry of Emergency Situations Azerbaijan' },
    { name: 'Azerbaijan Red Crescent', url: 'https://redcrescent.az/', desc: 'Azerbaijan Red Crescent emergency services' },
  ],
  GE: [
    { name: 'ESMA Georgia', url: 'https://esma.gov.ge/', desc: 'Emergency Situations Management Agency Georgia' },
    { name: 'Georgian Red Cross', url: 'https://redcross.ge/', desc: 'Georgian Red Cross emergency services' },
  ],
  AM: [
    { name: 'Armenia Emergency', url: 'https://moes.am/', desc: 'Armenia Ministry of Territorial Administration and Emergency Situations' },
    { name: 'Armenian Red Cross', url: 'https://redcross.am/', desc: 'Armenian Red Cross emergency services' },
  ],
  MN: [
    { name: 'NEMA Mongolia', url: 'http://www.nema.gov.mn/', desc: 'National Emergency Management Agency Mongolia' },
    { name: 'Mongolian Red Cross', url: 'https://www.redcross.mn/', desc: 'Mongolian Red Cross emergency services' },
  ],
  // Universal fallback used for any country not explicitly listed
  '__DEFAULT__': [
    { name: 'IFRC — Find Your Red Cross', url: 'https://www.ifrc.org/national-societies-overview', desc: 'International Federation of Red Cross — find your national society' },
    { name: 'UNOCHA Relief Web', url: 'https://reliefweb.int/', desc: 'UN humanitarian aid & disaster resource hub' },
    { name: 'Google Maps — Shelters Near Me', url: 'https://www.google.com/maps/search/emergency+shelter', desc: 'Google Maps search for local emergency shelters' },
  ],
}

function getCountryResources(countryCode?: string): { name: string; url: string; desc: string }[] {
  if (!countryCode) return COUNTRY_RESOURCES['__DEFAULT__']
  return COUNTRY_RESOURCES[countryCode.toUpperCase()] || COUNTRY_RESOURCES['__DEFAULT__']
}

/*  Overpass API fetch — parallel mirror racing + smart area queries          */

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.openstreetmap.ru/api/interpreter',
]

/** Race all mirrors in parallel — first successful response wins */
async function queryOverpass(query: string): Promise<any | null> {
  const controllers: AbortController[] = []

  const racePromises = OVERPASS_ENDPOINTS.map(async (endpoint) => {
    const controller = new AbortController()
    controllers.push(controller)
    const timeoutId = setTimeout(() => controller.abort(), 15000)
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        body: `data=${encodeURIComponent(query)}`,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        signal: controller.signal,
      })
      clearTimeout(timeoutId)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      // Cancel other in-flight requests
      controllers.forEach((c) => { try { c.abort() } catch {} })
      return data
    } catch (err) {
      clearTimeout(timeoutId)
      throw err
    }
  })

  try {
    return await Promise.any(racePromises)
  } catch {
    return null
  }
}

function buildRadiusQuery(lat: number, lng: number, radius: number): string {
  return `[out:json][timeout:15];(
    node["amenity"="hospital"](around:${radius},${lat},${lng});
    node["amenity"="fire_station"](around:${radius},${lat},${lng});
    node["amenity"="community_centre"](around:${radius},${lat},${lng});
    node["amenity"="shelter"](around:${radius},${lat},${lng});
    node["social_facility"="shelter"](around:${radius},${lat},${lng});
    node["amenity"="school"](around:${radius},${lat},${lng});
    way["amenity"="hospital"](around:${radius},${lat},${lng});
    way["amenity"="fire_station"](around:${radius},${lat},${lng});
    way["amenity"="community_centre"](around:${radius},${lat},${lng});
  );out center body 40;`
}

/**
 * For country-level searches we restrict the Overpass query to the geocoded
 * bounding box returned by Nominatim (clamped to prevent enormous queries),
 * with no secondary Nominatim lookups that can return wrong places.
 */
function buildBboxFromNominatim(
  lat: number,
  lng: number,
  bbox: [number, number, number, number] | undefined,
  halfDeg: number,
): string {
  // If Nominatim gave us a bounding box, shrink it to the halfDeg window centred
  // on the returned lat/lng so we stay within the right country.
  const s = lat - halfDeg
  const n = lat + halfDeg
  const w = lng - halfDeg
  const e = lng + halfDeg
  // Clamp to the Nominatim bbox when available so we never spill outside the country
  const south = bbox ? Math.max(s, bbox[0]) : s
  const north = bbox ? Math.min(n, bbox[1]) : n
  const west  = bbox ? Math.max(w, bbox[2]) : w
  const east  = bbox ? Math.min(e, bbox[3]) : e
  return `[out:json][timeout:15];(
    node["amenity"="hospital"](${south},${west},${north},${east});
    node["amenity"="fire_station"](${south},${west},${north},${east});
    node["amenity"="community_centre"](${south},${west},${north},${east});
    node["amenity"="shelter"](${south},${west},${north},${east});
    node["social_facility"="shelter"](${south},${west},${north},${east});
    node["amenity"="school"](${south},${west},${north},${east});
    way["amenity"="hospital"](${south},${west},${north},${east});
    way["amenity"="fire_station"](${south},${west},${north},${east});
    way["amenity"="community_centre"](${south},${west},${north},${east});
  );out center body 40;`
}

interface FetchSheltersOptions {
  lat: number
  lng: number
  bbox?: [number, number, number, number]
  isArea?: boolean
}

async function fetchRealShelters(opts: FetchSheltersOptions): Promise<{ items: Omit<Shelter, 'distance'>[]; sourceAvailable: boolean; radiusUsed: number }> {
  const { lat, lng, bbox, isArea } = opts

  // Area-level (country/region): use Nominatim bbox clamping, no secondary geocoding
  if (isArea) {
    // Progressive window sizes: ~55km → ~165km → ~330km
    const halfDegs = [0.5, 1.5, 3.0]
    for (const halfDeg of halfDegs) {
      const query = buildBboxFromNominatim(lat, lng, bbox, halfDeg)
      const data = await queryOverpass(query)
      if (!data) return { items: [], sourceAvailable: false, radiusUsed: Math.round(halfDeg * 111000) }
      const items = parseOverpassElements(data.elements || [])
      if (items.length >= 3 || halfDeg === halfDegs[halfDegs.length - 1]) {
        return { items, sourceAvailable: true, radiusUsed: Math.round(halfDeg * 111000) }
      }
    }
    return { items: [], sourceAvailable: true, radiusUsed: 330000 }
  }

  // Point-level: progressive radius 5km → 15km → 50km
  const radii = [5000, 15000, 50000]
  for (const radius of radii) {
    const query = buildRadiusQuery(lat, lng, radius)
    const data = await queryOverpass(query)
    if (!data) return { items: [], sourceAvailable: false, radiusUsed: radius }
    const items = parseOverpassElements(data.elements || [])
    if (items.length >= 3 || radius === radii[radii.length - 1]) {
      return { items, sourceAvailable: true, radiusUsed: radius }
    }
  }
  return { items: [], sourceAvailable: true, radiusUsed: 50000 }
}

function parseOverpassElements(elements: any[]): Omit<Shelter, 'distance'>[] {
  return elements
    .slice(0, 40)
    .map((el, i) => {
      const elLat = Number(el.lat ?? el.center?.lat)
      const elLng = Number(el.lon ?? el.center?.lon)
      if (!Number.isFinite(elLat) || !Number.isFinite(elLng)) return null

      const tags = el.tags || {}
      const amenity = tags.amenity || tags.social_facility || ''

      let type: Shelter['type'] = 'shelter'
      if (amenity === 'hospital') type = 'hospital'
      else if (amenity === 'fire_station') type = 'fire_station'
      else if (amenity === 'community_centre') type = 'community_centre'
      else if (amenity === 'school') type = 'school'

      const name = tags.name || tags['name:en'] || TYPE_CONFIG[type].label || 'Safe Zone'
      const street = tags['addr:street'] || ''
      const houseNumber = tags['addr:housenumber'] || ''
      const city = tags['addr:city'] || tags['addr:town'] || tags['addr:village'] || ''
      const address = [houseNumber, street, city].filter(Boolean).join(', ') || `${elLat.toFixed(4)}, ${elLng.toFixed(4)}`

      return {
        id: `osm-${el.id || i}`,
        name,
        type,
        lat: elLat,
        lng: elLng,
        address,
        phone: tags.phone || tags['contact:phone'] || undefined,
        capacity: parseInt(tags.capacity || '0', 10) || (type === 'hospital' ? 200 : 100),
        occupancy: 0,
        amenities: [
          ...(type === 'hospital' ? ['medical', 'food'] : []),
          ...(tags.internet_access === 'wlan' || tags.internet_access === 'yes' ? ['wifi'] : []),
          ...(type === 'shelter' || type === 'community_centre' ? ['beds', 'food'] : []),
        ],
        isOpen: tags.opening_hours !== 'closed',
      }
    })
    .filter(Boolean) as Omit<Shelter, 'distance'>[]
}

/*  Component                                                                */

export default function ShelterFinder(): JSX.Element {
  const lang = useLanguage()
  const [origin, setOrigin] = useState<Coordinates | null>(null)
  const [locationName, setLocationName] = useState('Search or use GPS')
  const [locationError, setLocationError] = useState('')
  const [gpsLoading, setGpsLoading] = useState(false)
  const [filterType, setFilterType] = useState<string>('all')
  const [showOnlyOpen, setShowOnlyOpen] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [sheltersDB, setSheltersDB] = useState<Omit<Shelter, 'distance'>[]>([])
  const [fetchingReal, setFetchingReal] = useState(false)
  const [apiUnavailable, setApiUnavailable] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null)
  const [countryCode, setCountryCode] = useState<string | undefined>(undefined)
  const [countryName, setCountryName] = useState<string | undefined>(undefined)
  const [radiusUsed, setRadiusUsed] = useState(5000)

  const shelters = useMemo(() => {
    let list = sheltersDB.map((s) => ({
      ...s,
      distance: origin ? haversineKm(origin, { lat: s.lat, lng: s.lng }) : undefined,
    }))
    if (showOnlyOpen) list = list.filter((s) => s.isOpen)
    if (filterType !== 'all') list = list.filter((s) => s.type === filterType)
    if (origin) list.sort((a, b) => (a.distance ?? 999) - (b.distance ?? 999))
    return list
  }, [origin, filterType, showOnlyOpen, sheltersDB])

  /* Derived stats */
  const stats = useMemo(() => {
    const all = sheltersDB.map((s) => ({ ...s, distance: origin ? haversineKm(origin, { lat: s.lat, lng: s.lng }) : undefined }))
    const open = all.filter((s) => s.isOpen).length
    const nearest = all.filter(s => s.isOpen && s.distance != null).sort((a, b) => (a.distance ?? 999) - (b.distance ?? 999))[0]
    const totalCap = all.reduce((t, s) => t + s.capacity, 0)
    const totalOcc = all.reduce((t, s) => t + s.occupancy, 0)
    const typeCounts: Record<string, number> = {}
    for (const s of all) typeCounts[s.type] = (typeCounts[s.type] || 0) + 1
    return { total: all.length, open, nearest, totalCap, totalOcc, typeCounts, avgCap: all.length ? Math.round(totalCap / all.length) : 0 }
  }, [sheltersDB, origin])

  const loadShelters = useCallback(async (coords: Coordinates, bbox?: [number, number, number, number], isArea?: boolean) => {
    setFetchingReal(true)
    setApiUnavailable(false)
    const result = await fetchRealShelters({ lat: coords.lat, lng: coords.lng, bbox, isArea })
    setSheltersDB(result.items)
    setApiUnavailable(!result.sourceAvailable)
    setRadiusUsed(result.radiusUsed)
    setFetchingReal(false)
    setLastRefreshed(new Date())
  }, [])

  const requestGPS = useCallback(async () => {
    setLocationError('')
    setLocationName('Detecting location...')
    setGpsLoading(true)
    try {
      const coords = await getDeviceLocation({ enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 })
      setOrigin(coords)
      const place = await reverseGeocode(coords, 11)
      setLocationName(place.displayName)
      if (place.countryCode) setCountryCode(place.countryCode)
      if (place.country) setCountryName(place.country)
      await loadShelters(coords)
    } catch {
      setLocationError('Enable location to see local data')
      setLocationName('Location unavailable')
    }
    setGpsLoading(false)
  }, [loadShelters])

  const handleSearch = async () => {
    if (!searchQuery.trim()) return
    setSearching(true)
    const result = await forwardGeocode(searchQuery.trim())
    if (result) {
      const coords = { lat: result.lat, lng: result.lng }
      setOrigin(coords)
      setLocationName(result.label)
      setLocationError('')
      // Get country from reverse geocode so resources update on search too
      reverseGeocode(coords, 5).then(place => {
        if (place.countryCode) setCountryCode(place.countryCode)
        if (place.country) setCountryName(place.country)
      }).catch(() => {})
      await loadShelters(coords, result.boundingbox, result.isArea)
    } else {
      setLocationError('Location not found. Try a city, postcode, or region.')
    }
    setSearching(false)
  }

  // Auto-trigger GPS on mount so safe zones load immediately for the user's current location
  useEffect(() => { requestGPS() }, [])

  const nearest = shelters[0]
  const hasData = sheltersDB.length > 0

  /* Render */
  return (
    <div className="animate-fade-in space-y-4">

      {/* HEADER*/}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="relative">
            <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-700 flex items-center justify-center shadow-lg shadow-emerald-600/25">
              <Shield className="w-5.5 h-5.5 text-white" />
            </div>
            <span className="absolute -top-1 -right-1 flex h-4 w-4">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60" />
              <span className="relative inline-flex rounded-full h-4 w-4 bg-emerald-500 border-2 border-white dark:border-gray-900 items-center justify-center">
                <span className="text-micro font-black text-white">{stats.total}</span>
              </span>
            </span>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-extrabold text-gray-900 dark:text-white tracking-tight">{t('shelter.safeZones', lang)}</h2>
              <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-[9px] font-bold text-emerald-700 dark:text-emerald-300 uppercase tracking-wider">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                Live
              </span>
            </div>
            <p className="text-[10px] text-gray-500 dark:text-gray-300 font-medium mt-0.5">
              {fetchingReal ? 'Searching real locations via OpenStreetMap...' : apiUnavailable ? 'Source unavailable — retry to load' : locationName}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={requestGPS}
            disabled={gpsLoading}
            className="flex items-center gap-1.5 text-[10px] font-bold bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300 px-3 py-2 rounded-xl hover:bg-emerald-100 dark:hover:bg-emerald-900/40 transition-all border border-emerald-200/50 dark:border-emerald-800/50"
          >
            {gpsLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Compass className="w-3.5 h-3.5" />}
            GPS
          </button>
          {hasData && (
            <button
              onClick={() => origin ? loadShelters(origin) : requestGPS()}
              className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 transition-all text-gray-400 dark:text-gray-300 hover:text-gray-600 dark:hover:text-gray-300 dark:text-gray-300"
              title="Refresh data"
            >
              <RefreshCw className={`w-4 h-4 ${fetchingReal ? 'animate-spin' : ''}`} />
            </button>
          )}
        </div>
      </div>

      {/* SEARCH BAR*/}
      <div className="glass-card rounded-2xl p-3">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-300" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              placeholder={t('shelter.searchPlaceholder', lang)}
              className="w-full pl-9 pr-3 py-2.5 text-xs bg-gray-50 dark:bg-gray-800/60 rounded-xl border border-gray-200 dark:border-gray-700 focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-400 transition text-gray-900 dark:text-white placeholder-gray-400"
            />
          </div>
          <button onClick={handleSearch} disabled={searching || !searchQuery.trim()} className="px-4 py-2.5 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-white rounded-xl text-xs font-bold transition-all disabled:opacity-40 shadow-md shadow-emerald-500/20 hover:shadow-lg hover:shadow-emerald-500/30">
            {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Find Zones'}
          </button>
        </div>
        {locationError && <p className="text-[10px] text-red-500 font-medium mt-1.5 ml-1">{locationError}</p>}
      </div>

      {/* NEAREST SHELTER HERO*/}
      {nearest && nearest.distance != null && (
        <div className="relative glass-card rounded-2xl overflow-hidden border border-emerald-200/50 dark:border-emerald-800/40">
          <div className="absolute inset-0 bg-gradient-to-r from-emerald-500/5 to-teal-500/5" />
          <div className="relative p-4">
            <div className="flex items-center gap-1.5 mb-2">
              <MapPinned className="w-3.5 h-3.5 text-emerald-500" />
              <span className="text-[9px] font-extrabold text-emerald-700 dark:text-emerald-300 uppercase tracking-widest">{t('shelter.nearestOpen', lang)}</span>
            </div>
            <div className="flex items-start justify-between">
              <div className="flex-1 min-w-0">
                <h3 className="text-base font-extrabold text-gray-900 dark:text-white truncate">{nearest.name}</h3>
                <p className="text-[11px] text-gray-500 dark:text-gray-300 mt-0.5">{nearest.address}</p>
                <div className="flex items-center gap-3 mt-2">
                  <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-600 dark:text-emerald-400">
                    <Navigation className="w-3 h-3" /> {nearest.distance.toFixed(1)} km
                  </span>
                  <span className="flex items-center gap-1 text-[10px] font-bold text-gray-500 dark:text-gray-300">
                    <Clock className="w-3 h-3" /> ~{estimateWalkMin(nearest.distance)} walk
                  </span>
                  <span className="flex items-center gap-1 text-[10px] font-bold text-green-600 dark:text-green-400">
                    <Activity className="w-3 h-3" /> Open
                  </span>
                </div>
              </div>
              <a
                href={`https://www.google.com/maps/dir/?api=1&destination=${nearest.lat},${nearest.lng}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-[10px] font-bold bg-emerald-500 hover:bg-emerald-400 text-white px-3 py-2 rounded-xl transition-all shadow-md shadow-emerald-500/20 hover:scale-[1.02] flex-shrink-0 ml-3"
              >
                <Navigation className="w-3.5 h-3.5" /> Directions
              </a>
            </div>
          </div>
        </div>
      )}

      {/* QUICK STATS ROW*/}
      {hasData && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <div className="glass-card rounded-xl p-3 text-center">
            <div className="text-2xl font-black text-gray-900 dark:text-white leading-none">{stats.total}</div>
            <div className="text-[9px] font-bold text-gray-400 dark:text-gray-300 uppercase mt-1">{t('shelter.totalZones', lang)}</div>
          </div>
          <div className="glass-card rounded-xl p-3 text-center">
            <div className="text-2xl font-black text-emerald-600 dark:text-emerald-400 leading-none">{stats.open}</div>
            <div className="text-[9px] font-bold text-gray-400 dark:text-gray-300 uppercase mt-1">{t('shelter.openNow', lang)}</div>
          </div>
          <div className="glass-card rounded-xl p-3 text-center">
            <div className="text-2xl font-black text-blue-600 dark:text-blue-400 leading-none">{stats.nearest?.distance != null ? `${stats.nearest.distance.toFixed(1)}` : '--'}<span className="text-sm font-bold ml-0.5">km</span></div>
            <div className="text-[9px] font-bold text-gray-400 dark:text-gray-300 uppercase mt-1">{t('shelter.nearest', lang)}</div>
          </div>
          <div className="glass-card rounded-xl p-3 text-center">
            <div className="text-2xl font-black text-amber-600 dark:text-amber-400 leading-none">{stats.avgCap}</div>
            <div className="text-[9px] font-bold text-gray-400 dark:text-gray-300 uppercase mt-1">{t('shelter.avgCapacity', lang)}</div>
          </div>
        </div>
      )}

      {/* ZONE TYPE DISTRIBUTION BAR*/}
      {hasData && (
        <div className="glass-card rounded-xl px-3 py-2.5">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[9px] font-bold text-gray-500 dark:text-gray-300 uppercase tracking-wider">{t('shelter.typeDistribution', lang)}</span>
            <span className="text-[9px] font-medium text-gray-400 dark:text-gray-300">{stats.total} locations</span>
          </div>
          <div className="flex h-2.5 rounded-full overflow-hidden bg-gray-200/60 dark:bg-gray-700/40">
            {(Object.entries(TYPE_CONFIG) as [string, typeof TYPE_CONFIG[keyof typeof TYPE_CONFIG]][]).map(([key, cfg]) => {
              const count = stats.typeCounts[key] || 0
              const pct = stats.total ? (count / stats.total) * 100 : 0
              if (pct === 0) return null
              return (
                <div
                  key={key}
                  className={`h-full bg-gradient-to-r ${cfg.gradient} transition-all duration-700 cursor-pointer hover:opacity-80`}
                  style={{ width: `${pct}%` }}
                  onClick={() => setFilterType(filterType === key ? 'all' : key)}
                  title={`${cfg.label}: ${count}`}
                />
              )
            })}
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1.5">
            {(Object.entries(TYPE_CONFIG) as [string, typeof TYPE_CONFIG[keyof typeof TYPE_CONFIG]][]).map(([key, cfg]) => {
              const count = stats.typeCounts[key] || 0
              if (count === 0) return null
              return (
                <span key={key} className="flex items-center gap-1 text-[9px] font-medium text-gray-600 dark:text-gray-300">
                  <span className={`w-2 h-2 rounded-full ${cfg.dot}`} />{cfg.short} {count}
                </span>
              )
            })}
          </div>
        </div>
      )}

      {/* FILTER PILLS*/}
      <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
        {[
          { key: 'all', label: 'All Zones', count: stats.total },
          ...Object.entries(TYPE_CONFIG).map(([k, v]) => ({ key: k, label: v.short, count: stats.typeCounts[k] || 0 })),
        ].map((f) => (
          <button
            key={f.key}
            onClick={() => setFilterType(f.key)}
            className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-bold whitespace-nowrap transition-all flex-shrink-0 ${
              filterType === f.key
                ? 'bg-emerald-500 text-white shadow-sm shadow-emerald-500/20'
                : 'bg-gray-100 dark:bg-gray-800/60 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700/60'
            }`}
          >
            {f.label}
            {f.count > 0 && (
              <span className={`px-1.5 rounded-full text-[8px] ${filterType === f.key ? 'bg-white/20' : 'bg-gray-200/60 dark:bg-gray-700/40'}`}>
                {f.count}
              </span>
            )}
          </button>
        ))}
        <button
          onClick={() => setShowOnlyOpen(!showOnlyOpen)}
          className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-bold whitespace-nowrap transition-all flex-shrink-0 ${
            showOnlyOpen ? 'bg-green-500 text-white shadow-sm' : 'bg-gray-100 dark:bg-gray-800/60 text-gray-600 dark:text-gray-300'
          }`}
        >
          {showOnlyOpen ? 'Open Only' : 'Show All'}
        </button>
      </div>

      {/* SHELTERS LIST*/}
      <div className="glass-card rounded-2xl overflow-hidden shadow-lg">
        <div className="divide-y divide-gray-100/80 dark:divide-gray-800/60 max-h-[520px] overflow-y-auto custom-scrollbar">
          {fetchingReal ? (
            <div className="py-12 text-center">
              <Loader2 className="w-8 h-8 text-emerald-500 mx-auto mb-3 animate-spin" />
              <p className="text-sm font-bold text-gray-700 dark:text-gray-200">{t('shelter.searchingOSM', lang)}</p>
              <p className="text-[10px] text-gray-400 dark:text-gray-300 mt-1">Querying OpenStreetMap for hospitals, shelters, fire stations &amp; more</p>
            </div>
          ) : apiUnavailable ? (
            <div className="py-10 text-center space-y-3">
              <AlertTriangle className="w-10 h-10 text-amber-400 mx-auto" />
              <p className="text-sm font-bold text-gray-700 dark:text-gray-200">{t('shelter.dataUnavailable', lang)}</p>
              <p className="text-xs text-gray-400 dark:text-gray-300">Overpass API could not be reached. Retry to load nearby facilities.</p>
              <button
                onClick={() => origin ? loadShelters(origin) : requestGPS()}
                className="inline-flex items-center gap-1.5 text-xs font-bold bg-emerald-500 hover:bg-emerald-400 text-white px-4 py-2 rounded-xl transition-all"
              >
                <RefreshCw className="w-3.5 h-3.5" /> Retry
              </button>
            </div>
          ) : !origin && shelters.length === 0 ? (
            <div className="py-12 text-center space-y-4">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-emerald-100 to-teal-100 dark:from-emerald-950/40 dark:to-teal-950/40 flex items-center justify-center mx-auto">
                <Compass className="w-8 h-8 text-emerald-500" />
              </div>
              <div>
                <p className="text-sm font-bold text-gray-700 dark:text-gray-200">{t('shelter.setLocation', lang)}</p>
                <p className="text-xs text-gray-400 dark:text-gray-300 mt-1">Use GPS or search any city, postcode, or country to find nearby safe zones</p>
              </div>
              <div className="flex flex-col items-center gap-2">
                <button onClick={requestGPS} disabled={gpsLoading} className="inline-flex items-center gap-1.5 text-xs font-bold bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-white px-5 py-2.5 rounded-xl transition-all shadow-md shadow-emerald-500/20">
                  {gpsLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Compass className="w-4 h-4" />} Use My Location
                </button>
                <span className="text-[9px] text-gray-400 dark:text-gray-300">{t('shelter.orSearchAbove', lang)}</span>
              </div>
            </div>
          ) : shelters.length === 0 ? (
            <div className="py-10 text-center">
              <Home className="w-10 h-10 text-gray-300 dark:text-gray-600 mx-auto mb-2" />
              <p className="text-sm font-bold text-gray-700 dark:text-gray-200">{t('shelter.noMatching', lang)}</p>
              <p className="text-xs text-gray-400 dark:text-gray-300 mt-1">
                Try adjusting filters or{' '}
                <button onClick={() => { setFilterType('all'); setShowOnlyOpen(false) }} className="text-emerald-600 dark:text-emerald-400 font-bold hover:underline">clear all filters</button>
              </p>
            </div>
          ) : (
            shelters.map((s, idx) => {
              const cfg = TYPE_CONFIG[s.type]
              const TypeIcon = cfg.icon
              const occupancyPct = s.capacity ? Math.round((s.occupancy / s.capacity) * 100) : 0
              const score = safetyScore(s)
              const isSelected = selectedId === s.id
              const capColor = occupancyPct > 85 ? 'bg-red-500' : occupancyPct > 60 ? 'bg-amber-500' : 'bg-emerald-500'
              const scoreColor = score >= 80 ? 'text-emerald-600 dark:text-emerald-400' : score >= 60 ? 'text-amber-600 dark:text-amber-400' : 'text-red-600 dark:text-red-400'

              return (
                <button
                  key={s.id}
                  onClick={() => setSelectedId(isSelected ? null : s.id)}
                  className={`w-full text-left p-4 transition-all duration-200 hover:bg-gray-50/60 dark:hover:bg-gray-800/30 ${isSelected ? `${cfg.bg} ${cfg.ring} ring-2 ring-inset` : ''}`}
                >
                  <div className="flex items-start gap-3">
                    {/* Icon + rank */}
                    <div className="flex flex-col items-center gap-1 flex-shrink-0">
                      <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${cfg.gradient} flex items-center justify-center shadow-md`}>
                        <TypeIcon className="w-5 h-5 text-white" />
                      </div>
                      {idx < 3 && s.distance != null && (
                        <span className="text-micro font-black text-gray-400 dark:text-gray-300">#{idx + 1}</span>
                      )}
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      {/* Row 1: Name + distance */}
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="text-sm font-bold text-gray-900 dark:text-white truncate">{s.name}</span>
                          <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded ${s.isOpen ? 'bg-green-100 dark:bg-green-950/40 text-green-700 dark:text-green-300' : 'bg-red-100 dark:bg-red-950/40 text-red-600 dark:text-red-400'}`}>
                            {s.isOpen ? 'OPEN' : 'CLOSED'}
                          </span>
                        </div>
                        {s.distance != null && (
                          <div className="flex items-center gap-1 flex-shrink-0">
                            <span className={`text-xs font-black ${cfg.text}`}>{s.distance.toFixed(1)} km</span>
                          </div>
                        )}
                      </div>

                      {/* Row 2: Address */}
                      <p className="text-[10px] text-gray-500 dark:text-gray-300 truncate mt-0.5">{s.address}</p>

                      {/* Row 3: Meta chips */}
                      <div className="flex items-center flex-wrap gap-1.5 mt-2">
                        <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${cfg.bg} ${cfg.text}`}>
                          {cfg.short}
                        </span>
                        {s.distance != null && (
                          <span className="text-[9px] font-medium text-gray-500 dark:text-gray-300 flex items-center gap-0.5">
                            <Clock className="w-2.5 h-2.5" /> ~{estimateWalkMin(s.distance)}
                          </span>
                        )}
                        <span className={`text-[9px] font-bold flex items-center gap-0.5 ${scoreColor}`}>
                          <Star className="w-2.5 h-2.5" /> {score}
                        </span>
                      </div>

                      {/* Row 4: Capacity bar */}
                      <div className="flex items-center gap-2 mt-2">
                        <div className="flex-1 h-2 bg-gray-200/60 dark:bg-gray-700/40 rounded-full overflow-hidden">
                          <div className={`h-full rounded-full transition-all duration-500 ${capColor}`} style={{ width: `${Math.max(occupancyPct, 2)}%` }} />
                        </div>
                        <span className="text-[9px] font-bold text-gray-500 dark:text-gray-300 flex-shrink-0">
                          {s.occupancy}/{s.capacity} <span className="text-[8px] text-gray-400 dark:text-gray-300">({occupancyPct}%)</span>
                        </span>
                      </div>

                      {/* Row 5: Amenity badges */}
                      {s.amenities.length > 0 && (
                        <div className="flex items-center gap-1.5 mt-2">
                          {s.amenities.map((a) => {
                            const am = AMENITY_META[a]
                            if (!am) return null
                            return (
                              <span key={a} className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[8px] font-bold ${am.color}`}>
                                <am.icon className="w-2.5 h-2.5" /> {am.label}
                              </span>
                            )
                          })}
                        </div>
                      )}

                      {/* Expand: contact + directions */}
                      {isSelected && (
                        <div className="mt-3 pt-3 border-t border-gray-200/50 dark:border-gray-700/30 space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            {s.phone && (
                              <a
                                href={`tel:${s.phone}`}
                                onClick={(e) => e.stopPropagation()}
                                className="inline-flex items-center gap-1 text-[10px] font-bold text-blue-600 dark:text-blue-400 px-2 py-1 rounded-lg bg-blue-50 dark:bg-blue-950/30 hover:bg-blue-100 dark:hover:bg-blue-900/40 transition-all"
                              >
                                <Phone className="w-3 h-3" /> {s.phone}
                              </a>
                            )}
                            <a
                              href={`https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lng}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-600 dark:text-emerald-400 px-2 py-1 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 hover:bg-emerald-100 dark:hover:bg-emerald-900/40 transition-all"
                            >
                              <Navigation className="w-3 h-3" /> Get Directions <ArrowUpRight className="w-2.5 h-2.5" />
                            </a>
                            <a
                              href={`https://www.openstreetmap.org/?mlat=${s.lat}&mlon=${s.lng}#map=17/${s.lat}/${s.lng}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="inline-flex items-center gap-1 text-[10px] font-bold text-gray-500 dark:text-gray-300 px-2 py-1 rounded-lg bg-gray-100 dark:bg-gray-800/60 hover:bg-gray-200 dark:hover:bg-gray-700/60 transition-all"
                            >
                              <ExternalLink className="w-3 h-3" /> View on Map
                            </a>
                          </div>
                          <p className="text-[9px] text-gray-400 dark:text-gray-300 flex items-center gap-1">
                            <MapPin className="w-3 h-3" /> {s.lat.toFixed(5)}, {s.lng.toFixed(5)}
                          </p>
                        </div>
                      )}
                    </div>

                    {/* Arrow */}
                    <ChevronRight className={`w-4 h-4 text-gray-300 dark:text-gray-600 flex-shrink-0 mt-2 transition-transform ${isSelected ? 'rotate-90' : ''}`} />
                  </div>
                </button>
              )
            })
          )}
        </div>

        {/* Footer */}
        {hasData && (
          <div className="flex items-center justify-between px-4 py-2.5 border-t border-gray-100 dark:border-gray-800/50 bg-gray-50/50 dark:bg-gray-900/30">
            <div className="flex items-center gap-3 text-[9px] font-medium">
              <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Real-time · OpenStreetMap
              </span>
              {radiusUsed > 5000 && (
                <span className="text-amber-600 dark:text-amber-400 font-bold">
                  Expanded to {radiusUsed >= 50000 ? '50 km' : '15 km'} radius
                </span>
              )}
              {lastRefreshed && (
                <span className="text-gray-400 dark:text-gray-300">Updated {lastRefreshed.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
              )}
            </div>
            <span className="text-[9px] font-bold text-gray-400 dark:text-gray-300 px-2 py-0.5 rounded bg-gray-200/60 dark:bg-gray-700/40">
              {shelters.length} of {stats.total} zones
            </span>
          </div>
        )}
      </div>

      {/* COUNTRY RESOURCES — always shown once a location is set */}
      {(countryCode || origin) && (
        <div className={`glass-card rounded-2xl p-4 space-y-3 ${stats.total < 3 ? 'border border-amber-200/60 dark:border-amber-800/40' : 'border border-gray-200/50 dark:border-gray-700/40'}`}>
          <div className="flex items-center gap-2">
            <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${stats.total < 3 ? 'bg-amber-100 dark:bg-amber-950/40' : 'bg-blue-50 dark:bg-blue-950/30'}`}>
              <Globe className={`w-3.5 h-3.5 ${stats.total < 3 ? 'text-amber-600 dark:text-amber-400' : 'text-blue-500 dark:text-blue-400'}`} />
            </div>
            <div>
              <p className={`text-[11px] font-extrabold ${stats.total < 3 ? 'text-amber-700 dark:text-amber-300' : 'text-gray-800 dark:text-gray-100'}`}>
                {stats.total < 3
                  ? `Limited local data${countryName ? ` for ${countryName}` : ''} — official resources below`
                  : `Official emergency resources${countryName ? ` — ${countryName}` : ''}`}
              </p>
              <p className="text-[9px] text-gray-400 dark:text-gray-500">Government & Red Cross safe zone registries</p>
            </div>
          </div>
          <div className="space-y-2">
            {getCountryResources(countryCode).map((r, i) => (
              <a
                key={i}
                href={r.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-start gap-2.5 p-2.5 rounded-xl bg-gray-50/80 dark:bg-gray-800/40 hover:bg-gray-100 dark:hover:bg-gray-700/50 border border-gray-200/50 dark:border-gray-700/40 transition-all group"
              >
                <BookOpen className="w-3.5 h-3.5 text-blue-500 dark:text-blue-400 mt-0.5 flex-shrink-0 group-hover:text-blue-600" />
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] font-bold text-gray-800 dark:text-gray-100 group-hover:text-blue-600 dark:group-hover:text-blue-400 truncate">{r.name}</p>
                  <p className="text-[9px] text-gray-400 dark:text-gray-500 mt-0.5">{r.desc}</p>
                </div>
                <ArrowUpRight className="w-3 h-3 text-gray-400 dark:text-gray-500 flex-shrink-0 mt-0.5 group-hover:text-blue-500" />
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
