/**
  * Re-exports the i18next config from client/src/i18n/config.ts
  * so the init side-effect runs on import:
  *   import "client/src/i18n"  -- triggers language setup
  *
  * - Imported in client/src/main.tsx to initialise translations
  * - All translation access should go via utils/i18n.ts or useTranslation()
 */

export * from './config'
