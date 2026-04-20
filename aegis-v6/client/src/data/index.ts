/**
  * Re-exports all static data tables from client/src/data/.
  * Allows components to import from one place:
  *   import { INCIDENT_CATEGORIES, PREPAREDNESS_TIPS } from "../data"
  *
  * - All data modules listed here; add new data files to this barrel
 */

export * from './allCountries'
export { ALL_COUNTRY_CODES, type CountryCode as AllCountryCode } from './allCountryCodes'
export { COUNTRY_CODES, codeToFlag, getCountryByCode, getCountryByDial, type CountryCode } from './countryCodes'
export * from './disasterTypes'
export * from './globalFloodData'
export * from './historical'
export * from './preparedness'
export * from './worldRegions'
