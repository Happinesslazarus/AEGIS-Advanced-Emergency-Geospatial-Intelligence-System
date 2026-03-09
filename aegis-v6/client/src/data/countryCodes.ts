/**
 * Country codes for international phone numbers
 * Supports major countries with E.164 format
 */

export interface CountryCode {
  code: string // Country code (e.g., 'GB', 'US')
  name: string // Country name
  dial: string // Dial code (e.g., '+44', '+1')
  flag: string // Emoji flag
  format: string // Example format
}

export const COUNTRY_CODES: CountryCode[] = [
  { code: 'GB', name: 'United Kingdom', dial: '+44', flag: '🇬🇧', format: '7700 900123' },
  { code: 'US', name: 'United States', dial: '+1', flag: '🇺🇸', format: '(415) 555-2671' },
  { code: 'CA', name: 'Canada', dial: '+1', flag: '🇨🇦', format: '(416) 555-1234' },
  { code: 'AU', name: 'Australia', dial: '+61', flag: '🇦🇺', format: '412 345 678' },
  { code: 'NZ', name: 'New Zealand', dial: '+64', flag: '🇳🇿', format: '21 123 4567' },
  { code: 'IE', name: 'Ireland', dial: '+353', flag: '🇮🇪', format: '85 123 4567' },
  { code: 'DE', name: 'Germany', dial: '+49', flag: '🇩🇪', format: '151 23456789' },
  { code: 'FR', name: 'France', dial: '+33', flag: '🇫🇷', format: '6 12 34 56 78' },
  { code: 'ES', name: 'Spain', dial: '+34', flag: '🇪🇸', format: '612 34 56 78' },
  { code: 'IT', name: 'Italy', dial: '+39', flag: '🇮🇹', format: '312 345 6789' },
  { code: 'NL', name: 'Netherlands', dial: '+31', flag: '🇳🇱', format: '6 12345678' },
  { code: 'BE', name: 'Belgium', dial: '+32', flag: '🇧🇪', format: '470 12 34 56' },
  { code: 'CH', name: 'Switzerland', dial: '+41', flag: '🇨🇭', format: '78 123 45 67' },
  { code: 'AT', name: 'Austria', dial: '+43', flag: '🇦🇹', format: '664 123456' },
  { code: 'SE', name: 'Sweden', dial: '+46', flag: '🇸🇪', format: '70 123 45 67' },
  { code: 'NO', name: 'Norway', dial: '+47', flag: '🇳🇴', format: '406 12 345' },
  { code: 'DK', name: 'Denmark', dial: '+45', flag: '🇩🇰', format: '32 12 34 56' },
  { code: 'FI', name: 'Finland', dial: '+358', flag: '🇫🇮', format: '40 123 4567' },
  { code: 'PL', name: 'Poland', dial: '+48', flag: '🇵🇱', format: '512 345 678' },
  { code: 'CZ', name: 'Czech Republic', dial: '+420', flag: '🇨🇿', format: '601 123 456' },
  { code: 'PT', name: 'Portugal', dial: '+351', flag: '🇵🇹', format: '912 345 678' },
  { code: 'GR', name: 'Greece', dial: '+30', flag: '🇬🇷', format: '691 234 5678' },
  { code: 'IN', name: 'India', dial: '+91', flag: '🇮🇳', format: '81234 56789' },
  { code: 'PK', name: 'Pakistan', dial: '+92', flag: '🇵🇰', format: '300 1234567' },
  { code: 'BD', name: 'Bangladesh', dial: '+880', flag: '🇧🇩', format: '1712 345678' },
  { code: 'NG', name: 'Nigeria', dial: '+234', flag: '🇳🇬', format: '802 123 4567' },
  { code: 'ZA', name: 'South Africa', dial: '+27', flag: '🇿🇦', format: '71 123 4567' },
  { code: 'KE', name: 'Kenya', dial: '+254', flag: '🇰🇪', format: '712 345678' },
  { code: 'EG', name: 'Egypt', dial: '+20', flag: '🇪🇬', format: '100 123 4567' },
  { code: 'CN', name: 'China', dial: '+86', flag: '🇨🇳', format: '131 2345 6789' },
  { code: 'JP', name: 'Japan', dial: '+81', flag: '🇯🇵', format: '90 1234 5678' },
  { code: 'KR', name: 'South Korea', dial: '+82', flag: '🇰🇷', format: '10 1234 5678' },
  { code: 'SG', name: 'Singapore', dial: '+65', flag: '🇸🇬', format: '8123 4567' },
  { code: 'MY', name: 'Malaysia', dial: '+60', flag: '🇲🇾', format: '12 345 6789' },
  { code: 'PH', name: 'Philippines', dial: '+63', flag: '🇵🇭', format: '905 123 4567' },
  { code: 'TH', name: 'Thailand', dial: '+66', flag: '🇹🇭', format: '81 234 5678' },
  { code: 'VN', name: 'Vietnam', dial: '+84', flag: '🇻🇳', format: '91 234 5678' },
  { code: 'ID', name: 'Indonesia', dial: '+62', flag: '🇮🇩', format: '812 3456 7890' },
  { code: 'BR', name: 'Brazil', dial: '+55', flag: '🇧🇷', format: '11 91234-5678' },
  { code: 'MX', name: 'Mexico', dial: '+52', flag: '🇲🇽', format: '55 1234 5678' },
  { code: 'AR', name: 'Argentina', dial: '+54', flag: '🇦🇷', format: '11 2345-6789' },
  { code: 'CL', name: 'Chile', dial: '+56', flag: '🇨🇱', format: '9 1234 5678' },
  { code: 'CO', name: 'Colombia', dial: '+57', flag: '🇨🇴', format: '312 3456789' },
  { code: 'AE', name: 'UAE', dial: '+971', flag: '🇦🇪', format: '50 123 4567' },
  { code: 'SA', name: 'Saudi Arabia', dial: '+966', flag: '🇸🇦', format: '50 123 4567' },
  { code: 'IL', name: 'Israel', dial: '+972', flag: '🇮🇱', format: '50 123 4567' },
  { code: 'TR', name: 'Turkey', dial: '+90', flag: '🇹🇷', format: '501 234 5678' },
  { code: 'RU', name: 'Russia', dial: '+7', flag: '🇷🇺', format: '912 345-67-89' },
  { code: 'UA', name: 'Ukraine', dial: '+380', flag: '🇺🇦', format: '50 123 4567' },
]

export function getCountryByCode(code: string): CountryCode | undefined {
  return COUNTRY_CODES.find(c => c.code === code)
}

export function getCountryByDial(dial: string): CountryCode | undefined {
  return COUNTRY_CODES.find(c => c.dial === dial)
}

export function formatPhoneWithCountry(country: CountryCode, number: string): string {
  // Remove any existing country code or +
  const cleaned = number.replace(/^\+?\d{1,4}\s*/, '').replace(/\D/g, '')
  return `${country.dial}${cleaned}`
}
