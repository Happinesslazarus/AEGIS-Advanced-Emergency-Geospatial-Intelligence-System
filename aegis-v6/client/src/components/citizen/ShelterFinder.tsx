/**
 * Shelter finder citizen component (public-facing UI element).
 *
 * - Rendered inside CitizenPage.tsx or CitizenDashboard.tsx */

/* ShelterFinder.tsx - AEGIS Safe-Zone Command Centre - Real Overpass API data, global coverage */

import { useState, useEffect, useMemo, useCallback, lazy, Suspense } from 'react'
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
  Layers,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  Route,
  Info,
  Target,
  Crosshair,
  BarChart2,
  Filter,
  Eye,
  Copy,
  Share2,
  LocateFixed,
  PersonStanding,
  Car,
  Stethoscope,
  UtensilsCrossed,
  BedDouble,
  CheckCircle2,
  Users } from 'lucide-react'
import { forwardGeocode, getDeviceLocation, haversineKm, reverseGeocode, type Coordinates} from '../../utils/locationUtils'
import { useLanguage } from '../../hooks/useLanguage'

const ShelterMap = lazy(() => import('./ShelterMap'))

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

//Keyed by ISO 3166-1 alpha-2 code (uppercase). Falls back to universal links.
const COUNTRY_RESOURCES: Record<string, { name: string; url: string; desc: string }[]> = {
  GB: [
    { name: 'UK GOV - Emergency Alerts', url: 'https://www.gov.uk/alerts', desc: 'Official UK government emergency guidance' },
    { name: 'Environment Agency Flood Maps', url: 'https://flood-map-for-planning.service.gov.uk/', desc: 'Check your flood risk & safe routes' },
    { name: 'Red Cross UK - Find Support', url: 'https://www.redcross.org.uk/get-help', desc: 'British Red Cross emergency support' },
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
    { name: 'DRK Hilfe', url: 'https://www.drk.de/hilfe-in-deutschland/', desc: 'Deutsches Rotes Kreuz - emergency aid' },
  ],
  FR: [
    { name: 'Gouvernement - Risques', url: 'https://www.gouvernement.fr/risques', desc: 'French government emergency risk info' },
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
    { name: 'OPM Uganda', url: 'https://www.opm.go.ug/', desc: 'Uganda Office of the Prime Minister - Disaster Preparedness' },
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
  //Universal fallback used for any country not explicitly listed
  '__DEFAULT__': [
    { name: 'IFRC - Find Your Red Cross', url: 'https://www.ifrc.org/national-societies-overview', desc: 'International Federation of Red Cross - find your national society' },
    { name: 'UNOCHA Relief Web', url: 'https://reliefweb.int/', desc: 'UN humanitarian aid & disaster resource hub' },
    { name: 'Google Maps - Shelters Near Me', url: 'https://www.google.com/maps/search/emergency+shelter', desc: 'Google Maps search for local emergency shelters' },
  ],
}

function getCountryResources(countryCode?: string): { name: string; url: string; desc: string }[] {
  if (!countryCode) return COUNTRY_RESOURCES['__DEFAULT__']
  return COUNTRY_RESOURCES[countryCode.toUpperCase()] || COUNTRY_RESOURCES['__DEFAULT__']
}

/*  Shelter data -- all fetched via server, browser NEVER calls Overpass      */

const API_BASE = import.meta.env.VITE_API_URL || ''

interface FetchSheltersOptions {
  lat: number
  lng: number
  bbox?: [number, number, number, number]
  isArea?: boolean
}

/**
 * Call the server's smart /shelters/near endpoint.
 * The server handles: PostgreSQL cache -> Overpass proxy -> stale cache -> PostGIS DB.
 * Returns normalised shelters ready for the component, or null on network error.
 */
async function queryServerNear(
  lat: number, lng: number, radius: number,
  bbox?: { south: number; north: number; west: number; east: number },
): Promise<{ items: Omit<Shelter, 'distance'>[]; source: string } | null> {
  try {
    const p = new URLSearchParams({ lat: String(lat), lng: String(lng), radius: String(radius) })
    if (bbox) {
      p.set('south', String(bbox.south)); p.set('north', String(bbox.north))
      p.set('west',  String(bbox.west));  p.set('east',  String(bbox.east))
    }
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 35_000)
    const res = await fetch(`${API_BASE}/api/config/shelters/near?${p}`, { signal: ctrl.signal })
    clearTimeout(timer)
    if (!res.ok) return null
    const data = await res.json()
    return { items: (data.shelters || []) as Omit<Shelter, 'distance'>[], source: data.source || 'server' }
  } catch {
    return null
  }
}

async function fetchRealShelters(opts: FetchSheltersOptions): Promise<{ items: Omit<Shelter, 'distance'>[]; sourceAvailable: boolean; radiusUsed: number }> {
  const { lat, lng, bbox, isArea } = opts

  if (isArea) {
 //Progressive bbox window: ~55 km -> ~165 km -> ~330 km
    const halfDegs = [0.5, 1.5, 3.0]
    for (const halfDeg of halfDegs) {
      const s = lat - halfDeg, n = lat + halfDeg, w = lng - halfDeg, e = lng + halfDeg
      const bboxObj = {
        south: bbox ? Math.max(s, bbox[0]) : s,
        north: bbox ? Math.min(n, bbox[1]) : n,
        west:  bbox ? Math.max(w, bbox[2]) : w,
        east:  bbox ? Math.min(e, bbox[3]) : e,
      }
      const radiusM = Math.round(halfDeg * 111000)
      const result = await queryServerNear(lat, lng, radiusM, bboxObj)
      if (!result) return { items: [], sourceAvailable: false, radiusUsed: radiusM }
      if (result.items.length >= 3 || halfDeg === halfDegs[halfDegs.length - 1]) {
        return { items: result.items, sourceAvailable: true, radiusUsed: radiusM }
      }
    }
    return { items: [], sourceAvailable: true, radiusUsed: 330000 }
  }

 //Point-level: progressive radius 20 km -> 50 km
  const radii = [20000, 50000]
  for (const radius of radii) {
    const result = await queryServerNear(lat, lng, radius)
    if (!result) return { items: [], sourceAvailable: false, radiusUsed: radius }
    if (result.items.length >= 3 || radius === radii[radii.length - 1]) {
      return { items: result.items, sourceAvailable: true, radiusUsed: radius }
    }
  }
  return { items: [], sourceAvailable: true, radiusUsed: 50000 }
}

/*  Component                                                                */

type SortMode = 'distance' | 'score' | 'capacity' | 'name'
type ViewMode = 'list' | 'map' | 'split'

function formatRadius(m: number): string {
  if (m >= 1000) return `${(m / 1000).toFixed(0)} km`
  return `${m} m`
}

function getThreatFromShelters(shelters: Omit<Shelter, 'distance'>[]): { level: 'LOW' | 'MODERATE' | 'HIGH'; desc: string } {
  const hospitals = shelters.filter(s => s.type === 'hospital').length
  const open = shelters.filter(s => s.isOpen).length
  const ratio = shelters.length ? open / shelters.length : 1
  if (shelters.length === 0) return { level: 'HIGH', desc: 'No verified safe zones detected' }
  if (ratio < 0.4 || hospitals === 0) return { level: 'HIGH', desc: 'Limited safe zone availability' }
  if (ratio < 0.7) return { level: 'MODERATE', desc: 'Moderate safe zone coverage' }
  return { level: 'LOW', desc: 'Good coverage - multiple verified zones' }
}

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
  const [viewMode, setViewMode] = useState<ViewMode>('split')
  const [sortMode, setSortMode] = useState<SortMode>('distance')
  const [showFilters, setShowFilters] = useState(false)
  const [resourcesExpanded, setResourcesExpanded] = useState(false)
  const [copied, setCopied] = useState(false)
  const [maxWalkKm, setMaxWalkKm] = useState<number>(50)
  const [routeTarget, setRouteTarget] = useState<Shelter | null>(null)

  const shelters = useMemo(() => {
    let list = sheltersDB.map((s) => ({
      ...s,
      distance: origin ? haversineKm(origin, { lat: s.lat, lng: s.lng }) : undefined,
    }))
    if (showOnlyOpen) list = list.filter((s) => s.isOpen)
    if (filterType !== 'all') list = list.filter((s) => s.type === filterType)
    if (maxWalkKm < 50) list = list.filter(s => s.distance == null || s.distance <= maxWalkKm)
    list.sort((a, b) => {
      if (sortMode === 'score') return safetyScore(b) - safetyScore(a)
      if (sortMode === 'capacity') return b.capacity - a.capacity
      if (sortMode === 'name') return a.name.localeCompare(b.name)
      return (a.distance ?? 999) - (b.distance ?? 999)
    })
    return list
  }, [origin, filterType, showOnlyOpen, sheltersDB, sortMode, maxWalkKm])

  /* Derived stats */
  const stats = useMemo(() => {
    const all = sheltersDB.map((s) => ({ ...s, distance: origin ? haversineKm(origin, { lat: s.lat, lng: s.lng }) : undefined }))
    const open = all.filter((s) => s.isOpen).length
    const nearest = all.filter(s => s.isOpen && s.distance != null).sort((a, b) => (a.distance ?? 999) - (b.distance ?? 999))[0]
    const totalCap = all.reduce((t, s) => t + s.capacity, 0)
    const totalOcc = all.reduce((t, s) => t + s.occupancy, 0)
    const typeCounts: Record<string, number> = {}
    for (const s of all) typeCounts[s.type] = (typeCounts[s.type] || 0) + 1
    const avgScore = all.length ? Math.round(all.reduce((t, s) => t + safetyScore(s), 0) / all.length) : 0
    return { total: all.length, open, nearest, totalCap, totalOcc, typeCounts, avgCap: all.length ? Math.round(totalCap / all.length) : 0, avgScore }
  }, [sheltersDB, origin])

  const threat = useMemo(() => getThreatFromShelters(sheltersDB), [sheltersDB])
  const threatColors = {
    LOW: { badge: 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300', dot: 'bg-emerald-500' },
    MODERATE: { badge: 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300', dot: 'bg-amber-500' },
    HIGH: { badge: 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300', dot: 'bg-red-500 animate-pulse' },
  }

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

  const copyCoords = () => {
    if (!origin) return
    navigator.clipboard.writeText(`${origin.lat.toFixed(5)}, ${origin.lng.toFixed(5)}`).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }).catch(() => {})
  }

  const shareLocation = () => {
    if (!origin) return
    const url = `https://www.google.com/maps?q=${origin.lat},${origin.lng}`
    if (navigator.share) {
      navigator.share({ title: 'My Safe Zone Search Location', url }).catch(() => {})
    } else {
      navigator.clipboard.writeText(url).catch(() => {})
    }
  }

  //Auto-trigger GPS on mount so safe zones load immediately for the user's current location
  useEffect(() => { requestGPS() }, [requestGPS])

  const nearest = shelters[0]
  const hasData = sheltersDB.length > 0
  const selectedShelter = shelters.find(s => s.id === selectedId) || null

  /* Render */
  return (
    <div className="animate-fade-in space-y-3">

      {/* â"€â"€â"€ COMMAND BAR â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€ */}
      <div className="glass-card rounded-2xl p-4 space-y-3">
        {/* Title row */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="relative">
              <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-700 flex items-center justify-center shadow-lg shadow-emerald-600/25">
                <Shield className="w-5 h-5 text-white" />
              </div>
              {fetchingReal ? (
                <span className="absolute -top-1 -right-1 w-4 h-4 flex items-center justify-center rounded-full bg-amber-500 border-2 border-white dark:border-gray-900">
                  <Loader2 className="w-2.5 h-2.5 text-white animate-spin" />
                </span>
              ) : (
                <span className="absolute -top-1 -right-1 flex h-4 w-4">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60" />
                  <span className={`relative inline-flex rounded-full h-4 w-4 border-2 border-white dark:border-gray-900 items-center justify-center ${threatColors[threat.level].dot}`}>
                    <span className="text-[7px] font-black text-white">{stats.total}</span>
                  </span>
                </span>
              )}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-extrabold text-gray-900 dark:text-white tracking-tight">Safe Zones</h2>
                <span className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider ${threatColors[threat.level].badge}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${threatColors[threat.level].dot}`} />
                  {threat.level}
                </span>
              </div>
              <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5 max-w-[260px] truncate">
                {fetchingReal ? 'Querying OpenStreetMap live data...' : threat.desc}
              </p>
            </div>
          </div>

          {/* Right controls */}
          <div className="flex items-center gap-1.5">
            {origin && (
              <button onClick={copyCoords} title="Copy coordinates" className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-all text-gray-400">
                {copied ? <CheckCircle className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            )}
            {origin && (
              <button onClick={shareLocation} title="Share location" className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-all text-gray-400">
                <Share2 className="w-3.5 h-3.5" />
              </button>
            )}
            <button onClick={requestGPS} disabled={gpsLoading} className="flex items-center gap-1.5 text-[10px] font-bold bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300 px-3 py-1.5 rounded-xl hover:bg-emerald-100 dark:hover:bg-emerald-900/40 transition-all border border-emerald-200/50 dark:border-emerald-800/50">
              {gpsLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <LocateFixed className="w-3.5 h-3.5" />}
              GPS
            </button>
            {hasData && (
              <button onClick={() => origin ? loadShelters(origin) : requestGPS()} className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 transition-all" title="Refresh">
                <RefreshCw className={`w-4 h-4 ${fetchingReal ? 'animate-spin' : ''}`} />
              </button>
            )}
          </div>
        </div>

        {/* Search bar */}
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              placeholder="Search any city, postcode, country..."
              className="w-full pl-9 pr-3 py-2.5 text-xs bg-gray-50 dark:bg-gray-800/60 rounded-xl border border-gray-200 dark:border-gray-700 focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-400 transition text-gray-900 dark:text-white placeholder-gray-400"
            />
          </div>
          <button onClick={handleSearch} disabled={searching || !searchQuery.trim()} className="px-4 py-2.5 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-white rounded-xl text-xs font-bold transition-all disabled:opacity-40 shadow-md shadow-emerald-500/20 flex-shrink-0">
            {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Find'}
          </button>
          <button onClick={() => setShowFilters(!showFilters)} className={`px-3 py-2.5 rounded-xl text-xs font-bold transition-all border flex-shrink-0 ${showFilters ? 'bg-emerald-500 text-white border-emerald-500' : 'bg-gray-50 dark:bg-gray-800/60 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-700'}`}>
            <Filter className="w-4 h-4" />
          </button>
        </div>
        {locationError && <p className="text-[10px] text-red-500 font-medium ml-1">{locationError}</p>}

        {/* Advanced filter panel */}
        {showFilters && (
          <div className="pt-2 border-t border-gray-100 dark:border-gray-800/50 grid grid-cols-2 gap-3">
            <div>
              <label className="text-[9px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1.5 block">Sort By</label>
              <div className="flex flex-wrap gap-1">
                {([['distance', 'Nearest'], ['score', 'Safety Score'], ['capacity', 'Capacity'], ['name', 'A-Z']] as [SortMode, string][]).map(([k, lbl]) => (
                  <button key={k} onClick={() => setSortMode(k)} className={`px-2 py-1 rounded-lg text-[9px] font-bold transition-all ${sortMode === k ? 'bg-emerald-500 text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300'}`}>{lbl}</button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-[9px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1.5 block">Max Walk Distance</label>
              <div className="flex flex-wrap gap-1">
                {([1, 3, 5, 10, 50] as const).map((km) => (
                  <button key={km} onClick={() => setMaxWalkKm(km)} className={`px-2 py-1 rounded-lg text-[9px] font-bold transition-all ${maxWalkKm === km ? 'bg-blue-500 text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300'}`}>{km < 50 ? `${km} km` : 'Any'}</button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Location info bar */}
        {origin && (
          <div className="flex items-center gap-2 pt-1 border-t border-gray-100/80 dark:border-gray-800/40">
            <Crosshair className="w-3 h-3 text-emerald-500 flex-shrink-0" />
            <span className="text-[10px] text-gray-600 dark:text-gray-400 truncate flex-1">{locationName}</span>
            <span className="text-[9px] font-mono text-gray-400 dark:text-gray-500 flex-shrink-0">{origin.lat.toFixed(4)}, {origin.lng.toFixed(4)}</span>
            {radiusUsed > 5000 && (
              <span className="text-[9px] font-bold text-amber-600 dark:text-amber-400 px-1.5 py-0.5 rounded bg-amber-50 dark:bg-amber-950/30 flex-shrink-0">
                {formatRadius(radiusUsed)} radius
              </span>
            )}
          </div>
        )}
      </div>

      {/* â"€â"€â"€ LIVE THREAT ASSESSMENT BANNER â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€ */}
      {hasData && (
        <div className={`rounded-2xl px-4 py-3 flex items-center gap-3 border ${
          threat.level === 'HIGH' ? 'bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-800/40' :
          threat.level === 'MODERATE' ? 'bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800/40' :
          'bg-emerald-50 dark:bg-emerald-950/15 border-emerald-200/60 dark:border-emerald-800/30'}`}>
          <div className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 ${
            threat.level === 'HIGH' ? 'bg-red-500' : threat.level === 'MODERATE' ? 'bg-amber-500' : 'bg-emerald-500'}`}>
            {threat.level === 'HIGH' ? <AlertTriangle className="w-4 h-4 text-white" /> :
             threat.level === 'MODERATE' ? <Info className="w-4 h-4 text-white" /> :
             <CheckCircle className="w-4 h-4 text-white" />}
          </div>
          <div className="flex-1 min-w-0">
            <p className={`text-xs font-bold ${
              threat.level === 'HIGH' ? 'text-red-700 dark:text-red-300' :
              threat.level === 'MODERATE' ? 'text-amber-700 dark:text-amber-300' : 'text-emerald-700 dark:text-emerald-300'}`}>
              Coverage Assessment: {threat.level}
            </p>
            <p className={`text-[10px] mt-0.5 ${
              threat.level === 'HIGH' ? 'text-red-600/80 dark:text-red-400/80' :
              threat.level === 'MODERATE' ? 'text-amber-600/80 dark:text-amber-400/80' : 'text-emerald-600/80 dark:text-emerald-400/80'}`}>
              {threat.desc} - {stats.open}/{stats.total} zones operational - Avg safety score {stats.avgScore}/100
            </p>
          </div>
          <div className="flex flex-col items-end gap-1 flex-shrink-0">
            <span className="text-[9px] font-bold text-gray-500 dark:text-gray-400 uppercase">Updated</span>
            <span className="text-[10px] font-mono text-gray-700 dark:text-gray-300">{lastRefreshed?.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) || '--:--'}</span>
          </div>
        </div>
      )}

      {/* â"€â"€â"€ NEAREST ZONE HERO â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€ */}
      {nearest && nearest.distance != null && (
        <div className="relative glass-card rounded-2xl overflow-hidden border border-emerald-200/60 dark:border-emerald-800/40">
          <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/5 via-transparent to-teal-500/5 pointer-events-none" />
          {/* Pulsing ring animation for urgency */}
          <div className="absolute top-3 right-3 flex items-center gap-1.5">
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
            </span>
            <span className="text-[9px] font-bold text-emerald-600 dark:text-emerald-400 uppercase">Live</span>
          </div>
          <div className="relative p-4">
            <div className="flex items-center gap-1.5 mb-2">
              <MapPinned className="w-3.5 h-3.5 text-emerald-500" />
              <span className="text-[9px] font-extrabold text-emerald-700 dark:text-emerald-300 uppercase tracking-widest">Nearest Open Zone</span>
            </div>
            <div className="flex items-start gap-3">
              <div className={`w-12 h-12 rounded-2xl bg-gradient-to-br ${TYPE_CONFIG[nearest.type].gradient} flex items-center justify-center shadow-lg flex-shrink-0`}>
                {(() => { const I = TYPE_CONFIG[nearest.type].icon; return <I className="w-6 h-6 text-white" /> })()}
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-base font-extrabold text-gray-900 dark:text-white truncate">{nearest.name}</h3>
                <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5 truncate">{nearest.address}</p>
                <div className="flex flex-wrap items-center gap-2 mt-2">
                  <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/30 px-2 py-0.5 rounded-lg">
                    <Navigation className="w-3 h-3" /> {nearest.distance.toFixed(2)} km
                  </span>
                  <span className="flex items-center gap-1 text-[10px] font-medium text-gray-600 dark:text-gray-400">
                    <Clock className="w-3 h-3" /> ~{estimateWalkMin(nearest.distance)} walk
                  </span>
                  <span className="flex items-center gap-1 text-[10px] font-bold text-amber-600 dark:text-amber-400">
                    <Star className="w-3 h-3" /> {safetyScore(nearest)}/100
                  </span>
                  <span className="text-[10px] font-bold text-green-600 dark:text-green-400 flex items-center gap-0.5">
                    <Activity className="w-3 h-3" /> Open
                  </span>
                </div>
                {/* Capacity gauge */}
                {nearest.capacity > 0 && (
                  <div className="mt-2.5">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[9px] font-medium text-gray-500 dark:text-gray-400">Capacity</span>
                      <span className="text-[9px] font-bold text-gray-700 dark:text-gray-300">{nearest.occupancy}/{nearest.capacity} ({Math.round((nearest.occupancy/nearest.capacity)*100)}%)</span>
                    </div>
                    <div className="w-full h-2 bg-gray-200/60 dark:bg-gray-700/40 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full transition-all duration-700 ${(nearest.occupancy/nearest.capacity) > 0.85 ? 'bg-red-500' : (nearest.occupancy/nearest.capacity) > 0.6 ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{ width: `${Math.max((nearest.occupancy/nearest.capacity)*100, 2)}%` }} />
                    </div>
                  </div>
                )}
              </div>
              <div className="flex flex-col gap-1.5 flex-shrink-0">
                <a href={`https://www.google.com/maps/dir/?api=1&destination=${nearest.lat},${nearest.lng}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-[10px] font-bold bg-emerald-500 hover:bg-emerald-400 text-white px-3 py-2 rounded-xl transition-all shadow-md shadow-emerald-500/20 hover:scale-[1.03]">
                  <Route className="w-3.5 h-3.5" /> Route
                </a>
                <button onClick={() => { setSelectedId(nearest.id); setRouteTarget(nearest) }} className="flex items-center gap-1.5 text-[10px] font-bold bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 px-3 py-2 rounded-xl transition-all">
                  <Eye className="w-3.5 h-3.5" /> Details
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* â"€â"€â"€ ANALYTICS STATS GRID â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€ */}
      {hasData && (
        <div className="grid grid-cols-4 sm:grid-cols-4 gap-2">
          {[
            { value: stats.total, label: 'Zones', color: 'text-gray-900 dark:text-white', icon: Target },
            { value: stats.open, label: 'Active', color: 'text-emerald-600 dark:text-emerald-400', icon: CheckCircle },
            { value: stats.nearest?.distance != null ? `${stats.nearest.distance.toFixed(1)}km` : '--', label: 'Nearest', color: 'text-blue-600 dark:text-blue-400', icon: Navigation },
            { value: `${stats.avgScore}`, label: 'Avg Score', color: 'text-amber-600 dark:text-amber-400', icon: BarChart2 },
          ].map(({ value, label, color, icon: Icon }) => (
            <div key={label} className="glass-card rounded-xl p-2.5 text-center">
              <div className="flex justify-center mb-1"><Icon className={`w-3.5 h-3.5 ${color}`} /></div>
              <div className={`text-xl font-black leading-none ${color}`}>{value}</div>
              <div className="text-[8px] font-bold text-gray-400 dark:text-gray-500 uppercase mt-1">{label}</div>
            </div>
          ))}
        </div>
      )}

      {/* â"€â"€â"€ TYPE DISTRIBUTION BAR â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€ */}
      {hasData && (
        <div className="glass-card rounded-xl px-3 py-2.5">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[9px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider flex items-center gap-1.5"><BarChart2 className="w-3 h-3" /> Zone Breakdown</span>
            <span className="text-[9px] text-gray-400 dark:text-gray-500">{stats.total} locations - search radius {formatRadius(radiusUsed)}</span>
          </div>
          <div className="flex h-3 rounded-full overflow-hidden bg-gray-200/60 dark:bg-gray-700/40">
            {(Object.entries(TYPE_CONFIG) as [string, typeof TYPE_CONFIG[keyof typeof TYPE_CONFIG]][]).map(([key, cfg]) => {
              const count = stats.typeCounts[key] || 0
              const pct = stats.total ? (count / stats.total) * 100 : 0
              if (pct === 0) return null
              return (
                <div key={key} className={`h-full bg-gradient-to-r ${cfg.gradient} transition-all duration-700 cursor-pointer hover:opacity-80 relative group`} style={{ width: `${pct}%` }} onClick={() => setFilterType(filterType === key ? 'all' : key)} title={`${cfg.label}: ${count}`}>
                  {pct > 12 && <span className="absolute inset-0 flex items-center justify-center text-[8px] font-bold text-white/90">{count}</span>}
                </div>
              )
            })}
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2">
            {(Object.entries(TYPE_CONFIG) as [string, typeof TYPE_CONFIG[keyof typeof TYPE_CONFIG]][]).map(([key, cfg]) => {
              const count = stats.typeCounts[key] || 0
              if (count === 0) return null
              return (
                <button key={key} onClick={() => setFilterType(filterType === key ? 'all' : key)} className={`flex items-center gap-1 text-[9px] font-medium rounded-md px-1.5 py-0.5 transition-all ${filterType === key ? `${cfg.bg} ${cfg.text} ring-1 ring-current` : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'}`}>
                  <span className={`w-2 h-2 rounded-full ${cfg.dot}`} />{cfg.short} <span className="font-bold">{count}</span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* â"€â"€â"€ VIEW / FILTER BAR â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€ */}
      <div className="flex items-center gap-2">
        {/* View toggle */}
        <div className="flex items-center bg-gray-100 dark:bg-gray-800/60 rounded-lg p-0.5 flex-shrink-0">
          {([['list', Layers], ['split', Route], ['map', MapPin]] as [ViewMode, any][]).map(([mode, Icon]) => (
            <button key={mode} onClick={() => setViewMode(mode)} className={`px-2.5 py-1.5 rounded-md flex items-center gap-1 text-[10px] font-bold transition-all ${viewMode === mode ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm' : 'text-gray-500 dark:text-gray-400'}`}>
              <Icon className="w-3 h-3" />
              <span className="hidden sm:inline capitalize">{mode}</span>
            </button>
          ))}
        </div>

        {/* Open toggle */}
        <button onClick={() => setShowOnlyOpen(!showOnlyOpen)} className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-bold whitespace-nowrap transition-all flex-shrink-0 ${showOnlyOpen ? 'bg-green-500 text-white shadow-sm' : 'bg-gray-100 dark:bg-gray-800/60 text-gray-600 dark:text-gray-300'}`}>
          {showOnlyOpen ? <CheckCircle className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
          {showOnlyOpen ? 'Open' : 'All'}
        </button>

        {/* Type chips */}
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
          {[{ key: 'all', label: 'All', count: stats.total }, ...Object.entries(TYPE_CONFIG).map(([k, v]) => ({ key: k, label: v.short, count: stats.typeCounts[k] || 0 }))].map((f) => (
            <button key={f.key} onClick={() => setFilterType(f.key)} className={`flex items-center gap-1 px-2 py-1.5 rounded-lg text-[9px] font-bold whitespace-nowrap transition-all flex-shrink-0 ${filterType === f.key ? 'bg-emerald-500 text-white shadow-sm shadow-emerald-500/20' : 'bg-gray-100 dark:bg-gray-800/60 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700/60'}`}>
              {f.label}{f.count > 0 && <span className={`px-1 rounded-full text-[7px] ${filterType === f.key ? 'bg-white/20' : 'bg-gray-200/60 dark:bg-gray-700/40'}`}>{f.count}</span>}
            </button>
          ))}
        </div>
      </div>

      {/* â"€â"€â"€ SPLIT / MAP PANEL â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€ */}
      {(viewMode === 'map' || viewMode === 'split') && origin && shelters.length > 0 && (
        <div className="glass-card rounded-2xl overflow-hidden shadow-xl border border-emerald-200/30 dark:border-emerald-800/20" style={{ height: viewMode === 'map' ? 480 : 300 }}>
          <Suspense fallback={<div className="h-full flex items-center justify-center bg-gray-100 dark:bg-gray-800"><Loader2 className="w-6 h-6 animate-spin text-emerald-500" /></div>}>
            <ShelterMap origin={origin} shelters={shelters} selectedId={selectedId} onSelect={setSelectedId} />
          </Suspense>
        </div>
      )}

      {/* â"€â"€â"€ SHELTER LIST â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€ */}
      {viewMode !== 'map' && (
        <div className="glass-card rounded-2xl overflow-hidden shadow-lg border border-gray-200/40 dark:border-gray-700/30">
          <div className="divide-y divide-gray-100/80 dark:divide-gray-800/60 max-h-[540px] overflow-y-auto custom-scrollbar">
            {fetchingReal ? (
              <div className="py-14 text-center">
                <div className="relative w-16 h-16 mx-auto mb-4">
                  <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-emerald-100 to-teal-100 dark:from-emerald-950/40 dark:to-teal-950/40" />
                  <Loader2 className="absolute inset-0 m-auto w-8 h-8 text-emerald-500 animate-spin" />
                </div>
                <p className="text-sm font-bold text-gray-700 dark:text-gray-200">Finding safe zones near you...</p>
                <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-1 max-w-[220px] mx-auto">Loading hospitals, shelters, fire stations and community centres</p>
                <div className="flex items-center justify-center gap-1.5 mt-3">
                  {[0, 1, 2, 3].map((i) => (
                    <div key={i} className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-bounce" style={{ animationDelay: `${i * 150}ms` }} />
                  ))}
                </div>
              </div>
            ) : apiUnavailable ? (
              <div className="py-12 text-center space-y-4 px-4">
                <div className="w-14 h-14 rounded-2xl bg-amber-50 dark:bg-amber-950/30 flex items-center justify-center mx-auto"><AlertTriangle className="w-7 h-7 text-amber-500" /></div>
                <div>
                  <p className="text-sm font-bold text-gray-700 dark:text-gray-200">Safe zone data temporarily unavailable</p>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Could not reach the data service. Check your connection and try again.</p>
                </div>
                <button onClick={() => origin ? loadShelters(origin) : requestGPS()} className="inline-flex items-center gap-1.5 text-xs font-bold bg-emerald-500 hover:bg-emerald-400 text-white px-5 py-2.5 rounded-xl transition-all shadow-md">
                  <RefreshCw className="w-3.5 h-3.5" /> Retry
                </button>
              </div>
            ) : !origin ? (
              <div className="py-14 text-center space-y-4">
                <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-emerald-100 to-teal-100 dark:from-emerald-950/40 dark:to-teal-950/40 flex items-center justify-center mx-auto"><Compass className="w-8 h-8 text-emerald-500" /></div>
                <div>
                  <p className="text-sm font-bold text-gray-700 dark:text-gray-200">Set your location</p>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Use GPS or search any city, country, or postcode</p>
                </div>
                <button onClick={requestGPS} disabled={gpsLoading} className="inline-flex items-center gap-1.5 text-xs font-bold bg-gradient-to-r from-emerald-500 to-teal-600 text-white px-5 py-2.5 rounded-xl transition-all shadow-md">
                  {gpsLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <LocateFixed className="w-4 h-4" />} Use My GPS Location
                </button>
              </div>
            ) : shelters.length === 0 ? (
              <div className="py-10 text-center px-4">
                <Home className="w-10 h-10 text-gray-300 dark:text-gray-600 mx-auto mb-2" />
                <p className="text-sm font-bold text-gray-700 dark:text-gray-200">No matching zones</p>
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-1"><button onClick={() => { setFilterType('all'); setShowOnlyOpen(false); setMaxWalkKm(50) }} className="text-emerald-600 dark:text-emerald-400 font-bold hover:underline">Clear all filters</button></p>
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
                  <button key={s.id} onClick={() => setSelectedId(isSelected ? null : s.id)}
                    className={`w-full text-left p-3.5 transition-all duration-200 hover:bg-gray-50/60 dark:hover:bg-gray-800/30 animate-fade-in ${isSelected ? `${cfg.bg} ring-2 ring-inset ${cfg.ring}` : ''}`}
                    style={{ animationDelay: `${idx * 40}ms`, animationFillMode: 'both' }}>
                    <div className="flex items-start gap-3">
                      {/* Icon + rank */}
                      <div className="flex flex-col items-center gap-1 flex-shrink-0 pt-0.5">
                        <div className={`w-9 h-9 rounded-xl bg-gradient-to-br ${cfg.gradient} flex items-center justify-center shadow-md`}>
                          <TypeIcon className="w-4.5 h-4.5 text-white" />
                        </div>
                        {idx < 3 && origin && (
                          <span className={`text-[8px] font-black ${idx === 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-400'}`}>#{idx + 1}</span>
                        )}
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="text-[13px] font-bold text-gray-900 dark:text-white truncate leading-tight">{s.name}</span>
                            <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded flex-shrink-0 ${s.isOpen ? 'bg-green-100 dark:bg-green-950/40 text-green-700 dark:text-green-300' : 'bg-red-100 dark:bg-red-950/40 text-red-600 dark:text-red-400'}`}>
                              {s.isOpen ? 'OPEN' : 'CLOSED'}
                            </span>
                          </div>
                          {s.distance != null && (
                            <span className={`text-xs font-black flex-shrink-0 ${cfg.text}`}>{s.distance.toFixed(1)} km</span>
                          )}
                        </div>
                        <p className="text-[10px] text-gray-500 dark:text-gray-400 truncate mt-0.5">{s.address}</p>

                        <div className="flex items-center flex-wrap gap-1.5 mt-1.5">
                          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${cfg.bg} ${cfg.text}`}>{cfg.short}</span>
                          {s.distance != null && <span className="text-[9px] text-gray-500 dark:text-gray-400 flex items-center gap-0.5"><Clock className="w-2.5 h-2.5" />{estimateWalkMin(s.distance)}</span>}
                          <span className={`text-[9px] font-bold flex items-center gap-0.5 ${scoreColor}`}><Star className="w-2.5 h-2.5" />{score}</span>
                          {s.amenities.map((a) => {
                            const am = AMENITY_META[a]
                            if (!am) return null
                            return <span key={a} className={`inline-flex items-center gap-0.5 px-1 py-0.5 rounded text-[7px] font-bold ${am.color}`}><am.icon className="w-2 h-2" />{am.label}</span>
                          })}
                        </div>

                        {/* Capacity bar */}
                        <div className="flex items-center gap-2 mt-2">
                          <div className="flex-1 h-1.5 bg-gray-200/60 dark:bg-gray-700/40 rounded-full overflow-hidden">
                            <div className={`h-full rounded-full transition-all duration-500 ${capColor}`} style={{ width: `${Math.max(occupancyPct, 2)}%` }} />
                          </div>
                          <span className="text-[8px] font-medium text-gray-400 flex-shrink-0">{occupancyPct}% full</span>
                        </div>

                        {/* Expanded details */}
                        {isSelected && (
                          <div className="mt-3 pt-3 border-t border-gray-200/50 dark:border-gray-700/30">
                            <div className="flex flex-wrap items-center gap-2 mb-2">
                              {s.phone && (
                                <a href={`tel:${s.phone}`} onClick={(e) => e.stopPropagation()} className="inline-flex items-center gap-1 text-[10px] font-bold text-blue-600 dark:text-blue-400 px-2 py-1 rounded-lg bg-blue-50 dark:bg-blue-950/30 hover:bg-blue-100 transition-all">
                                  <Phone className="w-3 h-3" /> {s.phone}
                                </a>
                              )}
                              <a href={`https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lng}`} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="inline-flex items-center gap-1 text-[10px] font-bold text-white bg-emerald-500 hover:bg-emerald-400 px-3 py-1.5 rounded-lg transition-all shadow-sm">
                                <Route className="w-3 h-3" /> Get Route
                              </a>
                              <a href={`https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lng}&travelmode=walking`} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700 dark:text-emerald-300 px-2 py-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 hover:bg-emerald-100 transition-all">
                                <PersonStanding className="w-3 h-3" /> Walk
                              </a>
                              <a href={`https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lng}&travelmode=driving`} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="inline-flex items-center gap-1 text-[10px] font-bold text-blue-700 dark:text-blue-300 px-2 py-1.5 rounded-lg bg-blue-50 dark:bg-blue-950/30 hover:bg-blue-100 transition-all">
                                <Car className="w-3 h-3" /> Drive
                              </a>
                              <a href={`https://www.openstreetmap.org/?mlat=${s.lat}&mlon=${s.lng}#map=17/${s.lat}/${s.lng}`} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="inline-flex items-center gap-1 text-[10px] font-bold text-gray-500 dark:text-gray-400 px-2 py-1.5 rounded-lg bg-gray-100 dark:bg-gray-800/60 hover:bg-gray-200 transition-all">
                                <ExternalLink className="w-3 h-3" /> OSM
                              </a>
                            </div>
                            {/* Safety breakdown */}
                            <div className="grid grid-cols-3 gap-1.5 mt-1.5">
                              {[
                                { label: 'Medical', val: s.amenities.includes('medical'), Icon: Stethoscope },
                                { label: 'Food/H₂O', val: s.amenities.includes('food'), Icon: UtensilsCrossed },
                                { label: 'Wi-Fi', val: s.amenities.includes('wifi'), Icon: Wifi },
                                { label: 'Beds', val: s.amenities.includes('beds'), Icon: BedDouble },
                                { label: 'Open', val: s.isOpen, Icon: CheckCircle2 },
                                { label: 'Capacity', val: occupancyPct < 80, Icon: Users },
                              ].map(({ label, val, Icon }) => (
                                <div key={label} className={`flex items-center gap-1 px-1.5 py-1 rounded-lg text-[9px] font-medium ${val ? 'bg-emerald-50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-300' : 'bg-gray-100 dark:bg-gray-800/50 text-gray-400 line-through'}`}>
                                  <Icon className="w-3 h-3" /> {label}
                                </div>
                              ))}
                            </div>
                            <p className="text-[9px] text-gray-400 dark:text-gray-500 mt-2 flex items-center gap-1">
                              <MapPin className="w-2.5 h-2.5" /> {s.lat.toFixed(5)}, {s.lng.toFixed(5)}
                            </p>
                          </div>
                        )}
                      </div>
                      <ChevronRight className={`w-4 h-4 text-gray-300 dark:text-gray-600 flex-shrink-0 mt-2 transition-transform duration-200 ${isSelected ? 'rotate-90' : ''}`} />
                    </div>
                  </button>
                )
              })
            )}
          </div>

          {/* List footer */}
          {hasData && (
            <div className="flex items-center justify-between px-4 py-2.5 border-t border-gray-100 dark:border-gray-800/50 bg-gray-50/50 dark:bg-gray-900/30">
              <div className="flex items-center gap-3 text-[9px] font-medium">
                <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" /> Live - OpenStreetMap</span>
                {radiusUsed > 5000 && <span className="text-amber-600 dark:text-amber-400 font-bold">Radius expanded to {formatRadius(radiusUsed)}</span>}
                {lastRefreshed && <span className="text-gray-400 dark:text-gray-500 hidden sm:inline">Updated {lastRefreshed.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>}
              </div>
              <span className="text-[9px] font-bold text-gray-400 dark:text-gray-500 px-2 py-0.5 rounded bg-gray-200/60 dark:bg-gray-700/40">{shelters.length}/{stats.total} shown</span>
            </div>
          )}
        </div>
      )}

      {/* â"€â"€â"€ OFFICIAL COUNTRY RESOURCES â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€ */}
      {(countryCode || origin) && (
        <div className="glass-card rounded-2xl overflow-hidden border border-gray-200/50 dark:border-gray-700/40">
          <button onClick={() => setResourcesExpanded(!resourcesExpanded)} className="w-full flex items-center gap-3 p-4 hover:bg-gray-50/60 dark:hover:bg-gray-800/30 transition-colors">
            <div className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 ${stats.total < 3 ? 'bg-amber-100 dark:bg-amber-950/40' : 'bg-blue-50 dark:bg-blue-950/30'}`}>
              <Globe className={`w-4 h-4 ${stats.total < 3 ? 'text-amber-600 dark:text-amber-400' : 'text-blue-500 dark:text-blue-400'}`} />
            </div>
            <div className="flex-1 text-left min-w-0">
              <p className="text-xs font-extrabold text-gray-800 dark:text-gray-100">
                {stats.total < 3 ? `Limited data${countryName ? ` for ${countryName}` : ''} - official resources` : `Official emergency resources${countryName ? ` - ${countryName}` : ''}`}
              </p>
              <p className="text-[9px] text-gray-400 dark:text-gray-500 mt-0.5">{getCountryResources(countryCode).length} verified government & Red Cross links</p>
            </div>
            {resourcesExpanded ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
          </button>
          {resourcesExpanded && (
            <div className="px-4 pb-4 space-y-2 border-t border-gray-100 dark:border-gray-800/50 pt-3">
              {getCountryResources(countryCode).map((r, i) => (
                <a key={i} href={r.url} target="_blank" rel="noopener noreferrer" className="flex items-start gap-2.5 p-2.5 rounded-xl bg-gray-50/80 dark:bg-gray-800/40 hover:bg-gray-100 dark:hover:bg-gray-700/50 border border-gray-200/50 dark:border-gray-700/40 transition-all group">
                  <BookOpen className="w-3.5 h-3.5 text-blue-500 dark:text-blue-400 mt-0.5 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] font-bold text-gray-800 dark:text-gray-100 group-hover:text-blue-600 dark:group-hover:text-blue-400 truncate">{r.name}</p>
                    <p className="text-[9px] text-gray-400 dark:text-gray-500 mt-0.5">{r.desc}</p>
                  </div>
                  <ArrowUpRight className="w-3 h-3 text-gray-400 dark:text-gray-500 flex-shrink-0 mt-0.5 group-hover:text-blue-500" />
                </a>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
