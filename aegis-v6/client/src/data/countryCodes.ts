/**
  * Curated subset of country dial codes plus helper functions:
  * codeToFlag() converts a 2-letter ISO code to its flag emoji using
  * Unicode regional indicator symbols; getCountryByCode() looks up
  * a country by ISO code; getCountryByDial() looks up by dial prefix.
  *
  * - Used by allCountries.ts and allCountryCodes.ts for flag emojis
  * - Used by phone-number inputs throughout the client
 */

//Converts a 2-letter ISO country code to its flag emoji
//using Unicode regional indicator symbols (U+1F1E6 to U+1F1FF)
export function codeToFlag(code: string): string {
  return [...code.toUpperCase()].map(c => String.fromCodePoint(0x1F1E6 + c.charCodeAt(0) - 65)).join('')
}

export interface CountryCode {
  code: string
  name: string
  dial: string
  flag: string
  format: string
}

export const COUNTRY_CODES: CountryCode[] = [
  { code: 'GB', name: 'United Kingdom', dial: '+44', flag: codeToFlag('GB'), format: '7700 900123' },
  { code: 'US', name: 'United States', dial: '+1', flag: codeToFlag('US'), format: '(415) 555-2671' },
  { code: 'CA', name: 'Canada', dial: '+1', flag: codeToFlag('CA'), format: '(416) 555-1234' },
  { code: 'AU', name: 'Australia', dial: '+61', flag: codeToFlag('AU'), format: '412 345 678' },
  { code: 'NZ', name: 'New Zealand', dial: '+64', flag: codeToFlag('NZ'), format: '21 123 4567' },
  { code: 'IE', name: 'Ireland', dial: '+353', flag: codeToFlag('IE'), format: '85 123 4567' },
  { code: 'DE', name: 'Germany', dial: '+49', flag: codeToFlag('DE'), format: '151 23456789' },
  { code: 'FR', name: 'France', dial: '+33', flag: codeToFlag('FR'), format: '6 12 34 56 78' },
  { code: 'ES', name: 'Spain', dial: '+34', flag: codeToFlag('ES'), format: '612 34 56 78' },
  { code: 'IT', name: 'Italy', dial: '+39', flag: codeToFlag('IT'), format: '312 345 6789' },
  { code: 'NL', name: 'Netherlands', dial: '+31', flag: codeToFlag('NL'), format: '6 12345678' },
  { code: 'BE', name: 'Belgium', dial: '+32', flag: codeToFlag('BE'), format: '470 12 34 56' },
  { code: 'CH', name: 'Switzerland', dial: '+41', flag: codeToFlag('CH'), format: '78 123 45 67' },
  { code: 'AT', name: 'Austria', dial: '+43', flag: codeToFlag('AT'), format: '664 123456' },
  { code: 'SE', name: 'Sweden', dial: '+46', flag: codeToFlag('SE'), format: '70 123 45 67' },
  { code: 'NO', name: 'Norway', dial: '+47', flag: codeToFlag('NO'), format: '406 12 345' },
  { code: 'DK', name: 'Denmark', dial: '+45', flag: codeToFlag('DK'), format: '32 12 34 56' },
  { code: 'FI', name: 'Finland', dial: '+358', flag: codeToFlag('FI'), format: '40 123 4567' },
  { code: 'PL', name: 'Poland', dial: '+48', flag: codeToFlag('PL'), format: '512 345 678' },
  { code: 'CZ', name: 'Czech Republic', dial: '+420', flag: codeToFlag('CZ'), format: '601 123 456' },
  { code: 'PT', name: 'Portugal', dial: '+351', flag: codeToFlag('PT'), format: '912 345 678' },
  { code: 'GR', name: 'Greece', dial: '+30', flag: codeToFlag('GR'), format: '691 234 5678' },
  { code: 'IN', name: 'India', dial: '+91', flag: codeToFlag('IN'), format: '81234 56789' },
  { code: 'PK', name: 'Pakistan', dial: '+92', flag: codeToFlag('PK'), format: '300 1234567' },
  { code: 'BD', name: 'Bangladesh', dial: '+880', flag: codeToFlag('BD'), format: '1712 345678' },
  { code: 'NG', name: 'Nigeria', dial: '+234', flag: codeToFlag('NG'), format: '802 123 4567' },
  { code: 'ZA', name: 'South Africa', dial: '+27', flag: codeToFlag('ZA'), format: '71 123 4567' },
  { code: 'KE', name: 'Kenya', dial: '+254', flag: codeToFlag('KE'), format: '712 345678' },
  { code: 'EG', name: 'Egypt', dial: '+20', flag: codeToFlag('EG'), format: '100 123 4567' },
  { code: 'CN', name: 'China', dial: '+86', flag: codeToFlag('CN'), format: '131 2345 6789' },
  { code: 'JP', name: 'Japan', dial: '+81', flag: codeToFlag('JP'), format: '90 1234 5678' },
  { code: 'KR', name: 'South Korea', dial: '+82', flag: codeToFlag('KR'), format: '10 1234 5678' },
  { code: 'SG', name: 'Singapore', dial: '+65', flag: codeToFlag('SG'), format: '8123 4567' },
  { code: 'MY', name: 'Malaysia', dial: '+60', flag: codeToFlag('MY'), format: '12 345 6789' },
  { code: 'PH', name: 'Philippines', dial: '+63', flag: codeToFlag('PH'), format: '905 123 4567' },
  { code: 'TH', name: 'Thailand', dial: '+66', flag: codeToFlag('TH'), format: '81 234 5678' },
  { code: 'VN', name: 'Vietnam', dial: '+84', flag: codeToFlag('VN'), format: '91 234 5678' },
  { code: 'ID', name: 'Indonesia', dial: '+62', flag: codeToFlag('ID'), format: '812 3456 7890' },
  { code: 'BR', name: 'Brazil', dial: '+55', flag: codeToFlag('BR'), format: '11 91234-5678' },
  { code: 'MX', name: 'Mexico', dial: '+52', flag: codeToFlag('MX'), format: '55 1234 5678' },
  { code: 'AR', name: 'Argentina', dial: '+54', flag: codeToFlag('AR'), format: '11 2345-6789' },
  { code: 'CL', name: 'Chile', dial: '+56', flag: codeToFlag('CL'), format: '9 1234 5678' },
  { code: 'CO', name: 'Colombia', dial: '+57', flag: codeToFlag('CO'), format: '312 3456789' },
  { code: 'AE', name: 'UAE', dial: '+971', flag: codeToFlag('AE'), format: '50 123 4567' },
  { code: 'SA', name: 'Saudi Arabia', dial: '+966', flag: codeToFlag('SA'), format: '50 123 4567' },
  { code: 'IL', name: 'Israel', dial: '+972', flag: codeToFlag('IL'), format: '50 123 4567' },
  { code: 'TR', name: 'Turkey', dial: '+90', flag: codeToFlag('TR'), format: '501 234 5678' },
  { code: 'RU', name: 'Russia', dial: '+7', flag: codeToFlag('RU'), format: '912 345-67-89' },
  { code: 'UA', name: 'Ukraine', dial: '+380', flag: codeToFlag('UA'), format: '50 123 4567' },
]

export function getCountryByCode(code: string): CountryCode | undefined {
  return COUNTRY_CODES.find(c => c.code === code)
}

export function getCountryByDial(dial: string): CountryCode | undefined {
  return COUNTRY_CODES.find(c => c.dial === dial)
}

export function formatPhoneWithCountry(country: CountryCode, number: string): string {
  //Remove any existing country code or +
  const cleaned = number.replace(/^\+?\d{1,4}\s*/, '').replace(/\D/g, '')
  return `${country.dial}${cleaned}`
}

