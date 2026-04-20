/**
 * Global emergency d b frontend module.
 *
 * How it connects:
 * - Imported by services and components that need this configuration */

import { codeToFlag } from '../data/countryCodes'

export interface GlobalEmergencyEntry {
  code: string            // ISO 3166-1 alpha-2
  name: string
  flag: string
  emergencyNumber: string // Primary all-purpose emergency number
  police?: string
  fire?: string
  ambulance?: string
  mentalHealth?: { name: string; number: string }
  childLine?: { name: string; number: string }
  abuseHotline?: { name: string; number: string }
  poisonControl?: string
  disasterAgency: string
  weatherService: string
  language: string
  currency: string
  units: { depth: 'cm' | 'inches'; temperature: 'C' | 'F'; distance: 'km' | 'miles'; speed: 'km/h' | 'mph' }
}

//60+ Countries - Americas, Europe, Asia, Africa, Oceania, Middle East

export const GLOBAL_EMERGENCY_DB: GlobalEmergencyEntry[] = [

  //AMERICAS

  { code: 'US', name: 'United States', flag: codeToFlag('US'), emergencyNumber: '911', police: '911', fire: '911', ambulance: '911',
    mentalHealth: { name: '988 Suicide & Crisis Lifeline', number: '988' },
    childLine: { name: 'Childhelp', number: '1-800-422-4453' },
    abuseHotline: { name: 'National DV Hotline', number: '1-800-799-7233' },
    poisonControl: '1-800-222-1222',
    disasterAgency: 'FEMA', weatherService: 'NWS', language: 'en', currency: 'USD',
    units: { depth: 'inches', temperature: 'F', distance: 'miles', speed: 'mph' } },

  { code: 'CA', name: 'Canada', flag: codeToFlag('CA'), emergencyNumber: '911', police: '911', fire: '911', ambulance: '911',
    mentalHealth: { name: 'Crisis Services Canada', number: '988' },
    childLine: { name: 'Kids Help Phone', number: '1-800-668-6868' },
    poisonControl: '1-844-764-7669',
    disasterAgency: 'Public Safety Canada', weatherService: 'ECCC', language: 'en', currency: 'CAD',
    units: { depth: 'cm', temperature: 'C', distance: 'km', speed: 'km/h' } },

  { code: 'MX', name: 'Mexico', flag: codeToFlag('MX'), emergencyNumber: '911', police: '911', fire: '911', ambulance: '911',
    mentalHealth: { name: 'SAPTEL', number: '55 5259-8121' },
    disasterAgency: 'CENAPRED', weatherService: 'SMN', language: 'es', currency: 'MXN',
    units: { depth: 'cm', temperature: 'C', distance: 'km', speed: 'km/h' } },

  { code: 'BR', name: 'Brazil', flag: codeToFlag('BR'), emergencyNumber: '190', police: '190', fire: '193', ambulance: '192',
    mentalHealth: { name: 'CVV', number: '188' },
    disasterAgency: 'CEMADEN', weatherService: 'INMET', language: 'pt', currency: 'BRL',
    units: { depth: 'cm', temperature: 'C', distance: 'km', speed: 'km/h' } },

  { code: 'AR', name: 'Argentina', flag: codeToFlag('AR'), emergencyNumber: '911', police: '911', fire: '100', ambulance: '107',
    mentalHealth: { name: 'Centro de Asistencia al Suicida', number: '135' },
    disasterAgency: 'SINAGIR', weatherService: 'SMN', language: 'es', currency: 'ARS',
    units: { depth: 'cm', temperature: 'C', distance: 'km', speed: 'km/h' } },

  { code: 'CO', name: 'Colombia', flag: codeToFlag('CO'), emergencyNumber: '123', police: '123', fire: '119', ambulance: '125',
    mentalHealth: { name: 'Línea 106', number: '106' },
    disasterAgency: 'UNGRD', weatherService: 'IDEAM', language: 'es', currency: 'COP',
    units: { depth: 'cm', temperature: 'C', distance: 'km', speed: 'km/h' } },

  { code: 'CL', name: 'Chile', flag: codeToFlag('CL'), emergencyNumber: '131', police: '133', fire: '132', ambulance: '131',
    mentalHealth: { name: 'Salud Responde', number: '600 360 7777' },
    disasterAgency: 'SENAPRED', weatherService: 'DMC', language: 'es', currency: 'CLP',
    units: { depth: 'cm', temperature: 'C', distance: 'km', speed: 'km/h' } },

  { code: 'PE', name: 'Peru', flag: codeToFlag('PE'), emergencyNumber: '105', police: '105', fire: '116', ambulance: '106',
    mentalHealth: { name: 'Línea 113', number: '113' },
    disasterAgency: 'INDECI', weatherService: 'SENAMHI', language: 'es', currency: 'PEN',
    units: { depth: 'cm', temperature: 'C', distance: 'km', speed: 'km/h' } },

  { code: 'JM', name: 'Jamaica', flag: codeToFlag('JM'), emergencyNumber: '119', police: '119', fire: '110', ambulance: '110',
    disasterAgency: 'ODPEM', weatherService: 'Meteorological Service', language: 'en', currency: 'JMD',
    units: { depth: 'cm', temperature: 'C', distance: 'km', speed: 'km/h' } },

  { code: 'TT', name: 'Trinidad and Tobago', flag: codeToFlag('TT'), emergencyNumber: '990', police: '999', fire: '990', ambulance: '990',
    disasterAgency: 'ODPM', weatherService: 'Trinidad Met Service', language: 'en', currency: 'TTD',
    units: { depth: 'cm', temperature: 'C', distance: 'km', speed: 'km/h' } },

  //EUROPE

  { code: 'GB', name: 'United Kingdom', flag: codeToFlag('GB'), emergencyNumber: '999', police: '999', fire: '999', ambulance: '999',
    mentalHealth: { name: 'Samaritans', number: '116 123' },
    childLine: { name: 'Childline', number: '0800 1111' },
    abuseHotline: { name: 'National DA Helpline', number: '0808 2000 247' },
    poisonControl: '111',
    disasterAgency: 'COBR / Environment Agency', weatherService: 'Met Office', language: 'en', currency: 'GBP',
    units: { depth: 'cm', temperature: 'C', distance: 'km', speed: 'km/h' } },

  { code: 'IE', name: 'Ireland', flag: codeToFlag('IE'), emergencyNumber: '112', police: '112', fire: '112', ambulance: '112',
    mentalHealth: { name: 'Samaritans Ireland', number: '116 123' },
    childLine: { name: 'Childline Ireland', number: '1800 66 66 66' },
    disasterAgency: 'OPW', weatherService: 'Met Éireann', language: 'en', currency: 'EUR',
    units: { depth: 'cm', temperature: 'C', distance: 'km', speed: 'km/h' } },

  { code: 'DE', name: 'Germany', flag: codeToFlag('DE'), emergencyNumber: '112', police: '110', fire: '112', ambulance: '112',
    mentalHealth: { name: 'Telefonseelsorge', number: '0800 111 0 111' },
    childLine: { name: 'Nummer gegen Kummer', number: '116 111' },
    poisonControl: '030 19240',
    disasterAgency: 'BBK', weatherService: 'DWD', language: 'de', currency: 'EUR',
    units: { depth: 'cm', temperature: 'C', distance: 'km', speed: 'km/h' } },

  { code: 'FR', name: 'France', flag: codeToFlag('FR'), emergencyNumber: '112', police: '17', fire: '18', ambulance: '15',
    mentalHealth: { name: 'SOS Amitié', number: '09 72 39 40 50' },
    childLine: { name: 'Enfance en Danger', number: '119' },
    poisonControl: '01 40 05 48 48',
    disasterAgency: 'Sécurité Civile', weatherService: 'Météo-France', language: 'fr', currency: 'EUR',
    units: { depth: 'cm', temperature: 'C', distance: 'km', speed: 'km/h' } },

  { code: 'ES', name: 'Spain', flag: codeToFlag('ES'), emergencyNumber: '112', police: '091', fire: '112', ambulance: '112',
    mentalHealth: { name: 'Teléfono de la Esperanza', number: '717 003 717' },
    childLine: { name: 'ANAR Foundation', number: '900 20 20 10' },
    disasterAgency: 'Protección Civil', weatherService: 'AEMET', language: 'es', currency: 'EUR',
    units: { depth: 'cm', temperature: 'C', distance: 'km', speed: 'km/h' } },

  { code: 'IT', name: 'Italy', flag: codeToFlag('IT'), emergencyNumber: '112', police: '113', fire: '115', ambulance: '118',
    mentalHealth: { name: 'Telefono Amico', number: '02 2327 2327' },
    childLine: { name: 'Telefono Azzurro', number: '19696' },
    disasterAgency: 'Protezione Civile', weatherService: 'Servizio Meteorologico', language: 'it', currency: 'EUR',
    units: { depth: 'cm', temperature: 'C', distance: 'km', speed: 'km/h' } },

  { code: 'PT', name: 'Portugal', flag: codeToFlag('PT'), emergencyNumber: '112', police: '112', fire: '112', ambulance: '112',
    mentalHealth: { name: 'SOS Voz Amiga', number: '213 544 545' },
    disasterAgency: 'ANEPC', weatherService: 'IPMA', language: 'pt', currency: 'EUR',
    units: { depth: 'cm', temperature: 'C', distance: 'km', speed: 'km/h' } },

  { code: 'NL', name: 'Netherlands', flag: codeToFlag('NL'), emergencyNumber: '112', police: '112', fire: '112', ambulance: '112',
    mentalHealth: { name: '113 Zelfmoordpreventie', number: '113' },
    disasterAgency: 'Rijkswaterstaat', weatherService: 'KNMI', language: 'nl', currency: 'EUR',
    units: { depth: 'cm', temperature: 'C', distance: 'km', speed: 'km/h' } },

  { code: 'BE', name: 'Belgium', flag: codeToFlag('BE'), emergencyNumber: '112', police: '101', fire: '112', ambulance: '112',
    mentalHealth: { name: 'Centre de Prévention du Suicide', number: '0800 32 123' },
    disasterAgency: 'National Crisis Centre', weatherService: 'IRM/KMI', language: 'fr', currency: 'EUR',
    units: { depth: 'cm', temperature: 'C', distance: 'km', speed: 'km/h' } },

  { code: 'CH', name: 'Switzerland', flag: codeToFlag('CH'), emergencyNumber: '112', police: '117', fire: '118', ambulance: '144',
    mentalHealth: { name: 'Die Dargebotene Hand', number: '143' },
    poisonControl: '145',
    disasterAgency: 'BABS', weatherService: 'MeteoSwiss', language: 'de', currency: 'CHF',
    units: { depth: 'cm', temperature: 'C', distance: 'km', speed: 'km/h' } },

  { code: 'AT', name: 'Austria', flag: codeToFlag('AT'), emergencyNumber: '112', police: '133', fire: '122', ambulance: '144',
    mentalHealth: { name: 'Telefonseelsorge', number: '142' },
    disasterAgency: 'ZAMG', weatherService: 'GeoSphere Austria', language: 'de', currency: 'EUR',
    units: { depth: 'cm', temperature: 'C', distance: 'km', speed: 'km/h' } },

  { code: 'SE', name: 'Sweden', flag: codeToFlag('SE'), emergencyNumber: '112', police: '114 14', fire: '112', ambulance: '112',
    mentalHealth: { name: 'Mind Självmordslinjen', number: '90101' },
    disasterAgency: 'MSB', weatherService: 'SMHI', language: 'sv', currency: 'SEK',
    units: { depth: 'cm', temperature: 'C', distance: 'km', speed: 'km/h' } },

  { code: 'NO', name: 'Norway', flag: codeToFlag('NO'), emergencyNumber: '112', police: '112', fire: '110', ambulance: '113',
    mentalHealth: { name: 'Mental Helse', number: '116 123' },
    disasterAgency: 'DSB', weatherService: 'MET Norway', language: 'no', currency: 'NOK',
    units: { depth: 'cm', temperature: 'C', distance: 'km', speed: 'km/h' } },

  { code: 'DK', name: 'Denmark', flag: codeToFlag('DK'), emergencyNumber: '112', police: '114', fire: '112', ambulance: '112',
    mentalHealth: { name: 'Livslinien', number: '70 201 201' },
    disasterAgency: 'DEMA', weatherService: 'DMI', language: 'da', currency: 'DKK',
    units: { depth: 'cm', temperature: 'C', distance: 'km', speed: 'km/h' } },

  { code: 'FI', name: 'Finland', flag: codeToFlag('FI'), emergencyNumber: '112', police: '112', fire: '112', ambulance: '112',
    mentalHealth: { name: 'MIELI Mental Health Finland', number: '09 2525 0111' },
    disasterAgency: 'Pelastustoimi', weatherService: 'FMI', language: 'fi', currency: 'EUR',
    units: { depth: 'cm', temperature: 'C', distance: 'km', speed: 'km/h' } },

  { code: 'PL', name: 'Poland', flag: codeToFlag('PL'), emergencyNumber: '112', police: '997', fire: '998', ambulance: '999',
    mentalHealth: { name: 'Telefon Zaufania', number: '116 123' },
    disasterAgency: 'RCB', weatherService: 'IMGW', language: 'pl', currency: 'PLN',
    units: { depth: 'cm', temperature: 'C', distance: 'km', speed: 'km/h' } },

  { code: 'CZ', name: 'Czech Republic', flag: codeToFlag('CZ'), emergencyNumber: '112', police: '158', fire: '150', ambulance: '155',
    mentalHealth: { name: 'Linka bezpečí', number: '116 111' },
    disasterAgency: 'HZS', weatherService: 'ČHMÚ', language: 'cs', currency: 'CZK',
    units: { depth: 'cm', temperature: 'C', distance: 'km', speed: 'km/h' } },

  { code: 'GR', name: 'Greece', flag: codeToFlag('GR'), emergencyNumber: '112', police: '100', fire: '199', ambulance: '166',
    mentalHealth: { name: 'Suicide Prevention Line', number: '1018' },
    disasterAgency: 'GSCP', weatherService: 'HNMS', language: 'el', currency: 'EUR',
    units: { depth: 'cm', temperature: 'C', distance: 'km', speed: 'km/h' } },

  { code: 'RO', name: 'Romania', flag: codeToFlag('RO'), emergencyNumber: '112', police: '112', fire: '112', ambulance: '112',
    mentalHealth: { name: 'Telefonul Sufletului', number: '0800 801 200' },
    disasterAgency: 'IGSU', weatherService: 'ANM', language: 'ro', currency: 'RON',
    units: { depth: 'cm', temperature: 'C', distance: 'km', speed: 'km/h' } },

  { code: 'UA', name: 'Ukraine', flag: codeToFlag('UA'), emergencyNumber: '112', police: '102', fire: '101', ambulance: '103',
    mentalHealth: { name: 'Lifeline Ukraine', number: '7333' },
    disasterAgency: 'SES Ukraine', weatherService: 'UkrHMC', language: 'uk', currency: 'UAH',
    units: { depth: 'cm', temperature: 'C', distance: 'km', speed: 'km/h' } },

  { code: 'RU', name: 'Russia', flag: codeToFlag('RU'), emergencyNumber: '112', police: '102', fire: '101', ambulance: '103',
    mentalHealth: { name: 'Telefon Doveriya', number: '8-800-2000-122' },
    disasterAgency: 'EMERCOM', weatherService: 'Roshydromet', language: 'ru', currency: 'RUB',
    units: { depth: 'cm', temperature: 'C', distance: 'km', speed: 'km/h' } },

  { code: 'TR', name: 'Turkey', flag: codeToFlag('TR'), emergencyNumber: '112', police: '155', fire: '110', ambulance: '112',
    mentalHealth: { name: 'Yasam Hatti', number: '182' },
    disasterAgency: 'AFAD', weatherService: 'MGM', language: 'tr', currency: 'TRY',
    units: { depth: 'cm', temperature: 'C', distance: 'km', speed: 'km/h' } },

  //ASIA

  { code: 'IN', name: 'India', flag: codeToFlag('IN'), emergencyNumber: '112', police: '100', fire: '101', ambulance: '102',
    mentalHealth: { name: 'Vandrevala Foundation', number: '1860-2662-345' },
    childLine: { name: 'Childline India', number: '1098' },
    abuseHotline: { name: 'Women Helpline', number: '1091' },
    disasterAgency: 'NDMA', weatherService: 'IMD', language: 'hi', currency: 'INR',
    units: { depth: 'cm', temperature: 'C', distance: 'km', speed: 'km/h' } },

  { code: 'CN', name: 'China', flag: codeToFlag('CN'), emergencyNumber: '110', police: '110', fire: '119', ambulance: '120',
    mentalHealth: { name: 'Beijing Crisis Line', number: '010-82951332' },
    disasterAgency: 'MEM', weatherService: 'CMA', language: 'zh', currency: 'CNY',
    units: { depth: 'cm', temperature: 'C', distance: 'km', speed: 'km/h' } },

  { code: 'JP', name: 'Japan', flag: codeToFlag('JP'), emergencyNumber: '110', police: '110', fire: '119', ambulance: '119',
    mentalHealth: { name: 'TELL Lifeline', number: '03-5774-0992' },
    disasterAgency: 'Cabinet Office (Bousai)', weatherService: 'JMA', language: 'ja', currency: 'JPY',
    units: { depth: 'cm', temperature: 'C', distance: 'km', speed: 'km/h' } },

  { code: 'KR', name: 'South Korea', flag: codeToFlag('KR'), emergencyNumber: '119', police: '112', fire: '119', ambulance: '119',
    mentalHealth: { name: 'Korea Suicide Prevention Centre', number: '1393' },
    disasterAgency: 'MOIS', weatherService: 'KMA', language: 'ko', currency: 'KRW',
    units: { depth: 'cm', temperature: 'C', distance: 'km', speed: 'km/h' } },

  { code: 'PH', name: 'Philippines', flag: codeToFlag('PH'), emergencyNumber: '911', police: '911', fire: '911', ambulance: '911',
    mentalHealth: { name: 'NCMH Crisis Hotline', number: '0917-899-8727' },
    disasterAgency: 'NDRRMC', weatherService: 'PAGASA', language: 'en', currency: 'PHP',
    units: { depth: 'cm', temperature: 'C', distance: 'km', speed: 'km/h' } },

  { code: 'ID', name: 'Indonesia', flag: codeToFlag('ID'), emergencyNumber: '112', police: '110', fire: '113', ambulance: '118',
    mentalHealth: { name: 'Into The Light', number: '119 ext 8' },
    disasterAgency: 'BNPB', weatherService: 'BMKG', language: 'id', currency: 'IDR',
    units: { depth: 'cm', temperature: 'C', distance: 'km', speed: 'km/h' } },

  { code: 'MY', name: 'Malaysia', flag: codeToFlag('MY'), emergencyNumber: '999', police: '999', fire: '994', ambulance: '999',
    mentalHealth: { name: 'Befrienders KL', number: '03-7956 8145' },
    disasterAgency: 'NADMA', weatherService: 'MetMalaysia', language: 'ms', currency: 'MYR',
    units: { depth: 'cm', temperature: 'C', distance: 'km', speed: 'km/h' } },

  { code: 'SG', name: 'Singapore', flag: codeToFlag('SG'), emergencyNumber: '995', police: '999', fire: '995', ambulance: '995',
    mentalHealth: { name: 'Samaritans of Singapore', number: '1-767' },
    disasterAgency: 'SCDF', weatherService: 'MSS', language: 'en', currency: 'SGD',
    units: { depth: 'cm', temperature: 'C', distance: 'km', speed: 'km/h' } },

  { code: 'TH', name: 'Thailand', flag: codeToFlag('TH'), emergencyNumber: '191', police: '191', fire: '199', ambulance: '1669',
    mentalHealth: { name: 'Samaritans of Thailand', number: '02-713-6793' },
    disasterAgency: 'DDPM', weatherService: 'TMD', language: 'th', currency: 'THB',
    units: { depth: 'cm', temperature: 'C', distance: 'km', speed: 'km/h' } },

  { code: 'VN', name: 'Vietnam', flag: codeToFlag('VN'), emergencyNumber: '113', police: '113', fire: '114', ambulance: '115',
    mentalHealth: { name: 'Tâm Vi?t Hotline', number: '1800 599 920' },
    disasterAgency: 'VNDMA', weatherService: 'VNMHA', language: 'vi', currency: 'VND',
    units: { depth: 'cm', temperature: 'C', distance: 'km', speed: 'km/h' } },

  { code: 'PK', name: 'Pakistan', flag: codeToFlag('PK'), emergencyNumber: '1122', police: '15', fire: '16', ambulance: '1122',
    mentalHealth: { name: 'Umang Helpline', number: '0311-7786264' },
    disasterAgency: 'NDMA Pakistan', weatherService: 'PMD', language: 'ur', currency: 'PKR',
    units: { depth: 'cm', temperature: 'C', distance: 'km', speed: 'km/h' } },

  { code: 'BD', name: 'Bangladesh', flag: codeToFlag('BD'), emergencyNumber: '999', police: '999', fire: '199', ambulance: '199',
    mentalHealth: { name: 'Kaan Pete Roi', number: '01779-554391' },
    disasterAgency: 'DDM', weatherService: 'BMD', language: 'bn', currency: 'BDT',
    units: { depth: 'cm', temperature: 'C', distance: 'km', speed: 'km/h' } },

  { code: 'LK', name: 'Sri Lanka', flag: codeToFlag('LK'), emergencyNumber: '119', police: '119', fire: '110', ambulance: '1990',
    mentalHealth: { name: 'Sumithrayo', number: '011-2682535' },
    disasterAgency: 'DMC Sri Lanka', weatherService: 'DoM', language: 'si', currency: 'LKR',
    units: { depth: 'cm', temperature: 'C', distance: 'km', speed: 'km/h' } },

  { code: 'NP', name: 'Nepal', flag: codeToFlag('NP'), emergencyNumber: '100', police: '100', fire: '101', ambulance: '102',
    mentalHealth: { name: 'CMC Nepal', number: '1166' },
    disasterAgency: 'NDRRMA', weatherService: 'DHM Nepal', language: 'ne', currency: 'NPR',
    units: { depth: 'cm', temperature: 'C', distance: 'km', speed: 'km/h' } },

  //MIDDLE EAST

  { code: 'AE', name: 'United Arab Emirates', flag: codeToFlag('AE'), emergencyNumber: '999', police: '999', fire: '997', ambulance: '998',
    mentalHealth: { name: 'Hope Helpline', number: '800 4673' },
    childLine: { name: 'Child Protection Centre', number: '800 988' },
    disasterAgency: 'NCEMA', weatherService: 'NCM', language: 'ar', currency: 'AED',
    units: { depth: 'cm', temperature: 'C', distance: 'km', speed: 'km/h' } },

  { code: 'SA', name: 'Saudi Arabia', flag: codeToFlag('SA'), emergencyNumber: '911', police: '911', fire: '998', ambulance: '997',
    mentalHealth: { name: 'Irada', number: '920033360' },
    disasterAgency: 'GDCD', weatherService: 'NCM Saudi', language: 'ar', currency: 'SAR',
    units: { depth: 'cm', temperature: 'C', distance: 'km', speed: 'km/h' } },

  { code: 'QA', name: 'Qatar', flag: codeToFlag('QA'), emergencyNumber: '999', police: '999', fire: '999', ambulance: '999',
    disasterAgency: 'NCCM', weatherService: 'Qatar Met Dept', language: 'ar', currency: 'QAR',
    units: { depth: 'cm', temperature: 'C', distance: 'km', speed: 'km/h' } },

  { code: 'KW', name: 'Kuwait', flag: codeToFlag('KW'), emergencyNumber: '112', police: '112', fire: '112', ambulance: '112',
    disasterAgency: 'Kuwait Fire Force', weatherService: 'Kuwait Met Dept', language: 'ar', currency: 'KWD',
    units: { depth: 'cm', temperature: 'C', distance: 'km', speed: 'km/h' } },

  { code: 'BH', name: 'Bahrain', flag: codeToFlag('BH'), emergencyNumber: '999', police: '999', fire: '999', ambulance: '999',
    disasterAgency: 'NHRA', weatherService: 'Bahrain Met', language: 'ar', currency: 'BHD',
    units: { depth: 'cm', temperature: 'C', distance: 'km', speed: 'km/h' } },

  { code: 'OM', name: 'Oman', flag: codeToFlag('OM'), emergencyNumber: '9999', police: '9999', fire: '9999', ambulance: '9999',
    disasterAgency: 'NCCD', weatherService: 'Oman Met', language: 'ar', currency: 'OMR',
    units: { depth: 'cm', temperature: 'C', distance: 'km', speed: 'km/h' } },

  { code: 'JO', name: 'Jordan', flag: codeToFlag('JO'), emergencyNumber: '911', police: '911', fire: '911', ambulance: '911',
    disasterAgency: 'NCSCM', weatherService: 'JMD', language: 'ar', currency: 'JOD',
    units: { depth: 'cm', temperature: 'C', distance: 'km', speed: 'km/h' } },

  { code: 'LB', name: 'Lebanon', flag: codeToFlag('LB'), emergencyNumber: '112', police: '112', fire: '175', ambulance: '140',
    mentalHealth: { name: 'Embrace', number: '1564' },
    disasterAgency: 'LCRP', weatherService: 'Lebanon Met', language: 'ar', currency: 'LBP',
    units: { depth: 'cm', temperature: 'C', distance: 'km', speed: 'km/h' } },

  { code: 'IQ', name: 'Iraq', flag: codeToFlag('IQ'), emergencyNumber: '104', police: '104', fire: '115', ambulance: '122',
    disasterAgency: 'Iraq CMC', weatherService: 'Iraqi Met Org', language: 'ar', currency: 'IQD',
    units: { depth: 'cm', temperature: 'C', distance: 'km', speed: 'km/h' } },

  { code: 'EG', name: 'Egypt', flag: codeToFlag('EG'), emergencyNumber: '122', police: '122', fire: '180', ambulance: '123',
    mentalHealth: { name: 'Befrienders Cairo', number: '762 2381' },
    disasterAgency: 'IDSC', weatherService: 'EMA', language: 'ar', currency: 'EGP',
    units: { depth: 'cm', temperature: 'C', distance: 'km', speed: 'km/h' } },

  { code: 'IL', name: 'Israel', flag: codeToFlag('IL'), emergencyNumber: '100', police: '100', fire: '102', ambulance: '101',
    mentalHealth: { name: 'ERAN', number: '1201' },
    disasterAgency: 'Home Front Command', weatherService: 'IMS', language: 'he', currency: 'ILS',
    units: { depth: 'cm', temperature: 'C', distance: 'km', speed: 'km/h' } },

  //AFRICA

  { code: 'ZA', name: 'South Africa', flag: codeToFlag('ZA'), emergencyNumber: '10111', police: '10111', fire: '10177', ambulance: '10177',
    mentalHealth: { name: 'SADAG', number: '0800 567 567' },
    childLine: { name: 'Childline SA', number: '116' },
    disasterAgency: 'NDMC', weatherService: 'SAWS', language: 'en', currency: 'ZAR',
    units: { depth: 'cm', temperature: 'C', distance: 'km', speed: 'km/h' } },

  { code: 'NG', name: 'Nigeria', flag: codeToFlag('NG'), emergencyNumber: '112', police: '112', fire: '112', ambulance: '112',
    mentalHealth: { name: 'MHIN', number: '0806 210 6493' },
    disasterAgency: 'NEMA Nigeria', weatherService: 'NiMet', language: 'en', currency: 'NGN',
    units: { depth: 'cm', temperature: 'C', distance: 'km', speed: 'km/h' } },

  { code: 'KE', name: 'Kenya', flag: codeToFlag('KE'), emergencyNumber: '999', police: '999', fire: '999', ambulance: '999',
    mentalHealth: { name: 'Befrienders Kenya', number: '0722 178 177' },
    disasterAgency: 'NDMA Kenya', weatherService: 'KMD', language: 'en', currency: 'KES',
    units: { depth: 'cm', temperature: 'C', distance: 'km', speed: 'km/h' } },

  { code: 'GH', name: 'Ghana', flag: codeToFlag('GH'), emergencyNumber: '999', police: '191', fire: '192', ambulance: '193',
    disasterAgency: 'NADMO', weatherService: 'Ghana Met Agency', language: 'en', currency: 'GHS',
    units: { depth: 'cm', temperature: 'C', distance: 'km', speed: 'km/h' } },

  { code: 'ET', name: 'Ethiopia', flag: codeToFlag('ET'), emergencyNumber: '911', police: '911', fire: '939', ambulance: '907',
    disasterAgency: 'EDRMC', weatherService: 'NMA Ethiopia', language: 'am', currency: 'ETB',
    units: { depth: 'cm', temperature: 'C', distance: 'km', speed: 'km/h' } },

  { code: 'TZ', name: 'Tanzania', flag: codeToFlag('TZ'), emergencyNumber: '112', police: '112', fire: '114', ambulance: '114',
    disasterAgency: 'DMD Tanzania', weatherService: 'TMA', language: 'sw', currency: 'TZS',
    units: { depth: 'cm', temperature: 'C', distance: 'km', speed: 'km/h' } },

  { code: 'UG', name: 'Uganda', flag: codeToFlag('UG'), emergencyNumber: '999', police: '999', fire: '999', ambulance: '999',
    disasterAgency: 'OPM Uganda', weatherService: 'UNMA', language: 'en', currency: 'UGX',
    units: { depth: 'cm', temperature: 'C', distance: 'km', speed: 'km/h' } },

  { code: 'MA', name: 'Morocco', flag: codeToFlag('MA'), emergencyNumber: '15', police: '19', fire: '15', ambulance: '15',
    disasterAgency: 'DRRS', weatherService: 'DMN Morocco', language: 'ar', currency: 'MAD',
    units: { depth: 'cm', temperature: 'C', distance: 'km', speed: 'km/h' } },

  { code: 'SN', name: 'Senegal', flag: codeToFlag('SN'), emergencyNumber: '17', police: '17', fire: '18', ambulance: '1515',
    disasterAgency: 'ANPC Senegal', weatherService: 'ANACIM', language: 'fr', currency: 'XOF',
    units: { depth: 'cm', temperature: 'C', distance: 'km', speed: 'km/h' } },

  { code: 'CM', name: 'Cameroon', flag: codeToFlag('CM'), emergencyNumber: '117', police: '117', fire: '118', ambulance: '119',
    disasterAgency: 'DPC Cameroon', weatherService: 'Cameroon Met Dept', language: 'fr', currency: 'XAF',
    units: { depth: 'cm', temperature: 'C', distance: 'km', speed: 'km/h' } },

  { code: 'MZ', name: 'Mozambique', flag: codeToFlag('MZ'), emergencyNumber: '119', police: '119', fire: '198', ambulance: '117',
    disasterAgency: 'INGD', weatherService: 'INAM', language: 'pt', currency: 'MZN',
    units: { depth: 'cm', temperature: 'C', distance: 'km', speed: 'km/h' } },

  //OCEANIA

  { code: 'AU', name: 'Australia', flag: codeToFlag('AU'), emergencyNumber: '000', police: '000', fire: '000', ambulance: '000',
    mentalHealth: { name: 'Lifeline Australia', number: '13 11 14' },
    childLine: { name: 'Kids Helpline', number: '1800 55 1800' },
    poisonControl: '13 11 26',
    disasterAgency: 'NEMA Australia', weatherService: 'BoM', language: 'en', currency: 'AUD',
    units: { depth: 'cm', temperature: 'C', distance: 'km', speed: 'km/h' } },

  { code: 'NZ', name: 'New Zealand', flag: codeToFlag('NZ'), emergencyNumber: '111', police: '111', fire: '111', ambulance: '111',
    mentalHealth: { name: 'Lifeline NZ', number: '0800 543 354' },
    childLine: { name: 'Youthline', number: '0800 376 633' },
    poisonControl: '0800 764 766',
    disasterAgency: 'NEMA NZ', weatherService: 'MetService', language: 'en', currency: 'NZD',
    units: { depth: 'cm', temperature: 'C', distance: 'km', speed: 'km/h' } },

  { code: 'FJ', name: 'Fiji', flag: codeToFlag('FJ'), emergencyNumber: '911', police: '917', fire: '910', ambulance: '911',
    disasterAgency: 'NDMO Fiji', weatherService: 'FMS', language: 'en', currency: 'FJD',
    units: { depth: 'cm', temperature: 'C', distance: 'km', speed: 'km/h' } },

  { code: 'PG', name: 'Papua New Guinea', flag: codeToFlag('PG'), emergencyNumber: '000', police: '000', fire: '110', ambulance: '111',
    disasterAgency: 'NDC PNG', weatherService: 'NWS PNG', language: 'en', currency: 'PGK',
    units: { depth: 'cm', temperature: 'C', distance: 'km', speed: 'km/h' } },
]

// ???????????????????????????????????????????????????????????????
// LOOKUP HELPERS
// ???????????????????????????????????????????????????????????????

const _byCode = new Map<string, GlobalEmergencyEntry>()
for (const e of GLOBAL_EMERGENCY_DB) _byCode.set(e.code.toUpperCase(), e)

/* Look up by ISO country code (case-insensitive) */
export function lookupByCode(code: string): GlobalEmergencyEntry | undefined {
  return _byCode.get(code.toUpperCase())
}

/* Look up by country name (fuzzy -- case-insensitive substring match) */
export function lookupByName(name: string): GlobalEmergencyEntry | undefined {
  const q = name.toLowerCase()
  return GLOBAL_EMERGENCY_DB.find(e => e.name.toLowerCase().includes(q))
}

/* Map navigator.language locale to ISO country code */
export function localeToCountryCode(locale: string): string {
  //navigator.language can be: "en", "en-US", "en-GB", "zh-CN", "ar-SA", etc.
  const parts = locale.split('-')
  if (parts.length >= 2) {
    return parts[parts.length - 1].toUpperCase()
  }
  //Language-only fallback: map common languages to their primary country
  const langMap: Record<string, string> = {
    en: 'GB', es: 'ES', fr: 'FR', de: 'DE', it: 'IT', pt: 'PT',
    ar: 'SA', zh: 'CN', ja: 'JP', ko: 'KR', hi: 'IN', ur: 'PK',
    bn: 'BD', th: 'TH', vi: 'VN', ms: 'MY', id: 'ID', pl: 'PL',
    nl: 'NL', sv: 'SE', no: 'NO', da: 'DK', fi: 'FI', el: 'GR',
    ro: 'RO', cs: 'CZ', tr: 'TR', he: 'IL', ru: 'RU', uk: 'UA',
    sw: 'TZ', am: 'ET', ne: 'NP', si: 'LK',
  }
  return langMap[parts[0].toLowerCase()] || ''
}

/* Get worldwide emergency contacts table (markdown) for any subset */
export function worldwideEmergencyTable(codes?: string[]): string {
  const entries = codes
    ? codes.map(c => lookupByCode(c)).filter(Boolean) as GlobalEmergencyEntry[]
    : GLOBAL_EMERGENCY_DB

  const rows = entries.map(e =>
    `| ${e.flag} ${e.name} | **${e.emergencyNumber}** | ${e.police || e.emergencyNumber} | ${e.ambulance || e.emergencyNumber} | ${e.fire || e.emergencyNumber} |`,
  )

  return [
    '| Country | Emergency | Police | Ambulance | Fire |',
    '|---------|-----------|--------|-----------|------|',
    ...rows,
  ].join('\n')
}

/* Generate a compact emergency card for a single country */
export function emergencyCard(code: string): string {
  const e = lookupByCode(code)
  if (!e) return `Emergency number for most countries: **112** (international standard)`

  const lines = [
    `## ${e.flag} ${e.name} Emergency Numbers`,
    `- **Emergency:** ${e.emergencyNumber}`,
  ]
  if (e.police && e.police !== e.emergencyNumber) lines.push(`- **Police:** ${e.police}`)
  if (e.fire && e.fire !== e.emergencyNumber) lines.push(`- **Fire:** ${e.fire}`)
  if (e.ambulance && e.ambulance !== e.emergencyNumber) lines.push(`- **Ambulance:** ${e.ambulance}`)
  if (e.mentalHealth) lines.push(`- **${e.mentalHealth.name}:** ${e.mentalHealth.number}`)
  if (e.childLine) lines.push(`- **${e.childLine.name}:** ${e.childLine.number}`)
  if (e.poisonControl) lines.push(`- **Poison Control:** ${e.poisonControl}`)
  lines.push(`- **Disaster Agency:** ${e.disasterAgency}`)
  lines.push(`- **Weather Service:** ${e.weatherService}`)

  return lines.join('\n')
}

