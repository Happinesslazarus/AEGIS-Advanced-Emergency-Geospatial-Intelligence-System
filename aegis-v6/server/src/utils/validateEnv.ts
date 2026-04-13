/**
 * File: validateEnv.ts
 *
 * What this file does:
 * Validates and logs environment variable configuration at startup.
 * Checks for required variables, warns about missing optional ones,
 * and provides a summary of the server's configuration state.
 *
 * How it connects:
 * - Called early in server startup (index.ts)
 * - Uses logger.ts for structured output
 *
 * Simple explanation:
 * Checks that all required settings are configured before the server starts.
 */

import { devLog, auditLog } from './logger.js'

/* Simple logger facade so validateAndLog callers can pass console or a custom logger */
interface LoggerLike {
  info(...args: unknown[]): void
  warn(...args: unknown[]): void
  error(...args: unknown[]): void
}

// Environment variable requirements
interface EnvRequirement {
  name: string
  required: boolean // true = required in production, false = optional
  pattern?: RegExp  // validation pattern
  hint?: string     // help text
}

const ENV_REQUIREMENTS: EnvRequirement[] = [
  // Database
  { name: 'DATABASE_URL', required: true, hint: 'PostgreSQL connection string' },

  // Security
  { name: 'JWT_SECRET', required: true, pattern: /^.{32,}$/, hint: 'Must be at least 32 characters' },
  { name: 'REFRESH_TOKEN_SECRET', required: true, pattern: /^.{32,}$/, hint: 'Must be at least 32 characters' },
  { name: 'INTERNAL_API_KEY', required: true, pattern: /^.{16,}$/, hint: 'Internal automation API key' },
  { name: 'N8N_WEBHOOK_SECRET', required: true, pattern: /^.{16,}$/, hint: 'n8n webhook HMAC secret' },

  // AI / LLM providers (at least one should be provided in production)
  { name: 'GEMINI_API_KEY', required: false, hint: 'Google Gemini API key' },
  { name: 'GROQ_API_KEY', required: false, hint: 'Groq LLM API key' },
  { name: 'OPENROUTER_API_KEY', required: false, hint: 'OpenRouter API key' },
  { name: 'HF_API_KEY', required: false, hint: 'HuggingFace API key' },
  { name: 'API_SECRET_KEY', required: true, pattern: /^.{16,}$/, hint: 'AI engine service secret (required in production)' },

  // Push notifications (required for production alerts)
  { name: 'VAPID_PUBLIC_KEY', required: true, hint: 'Web push VAPID public key' },
  { name: 'VAPID_PRIVATE_KEY', required: true, hint: 'Web push VAPID private key' },

  // Email notifications
  { name: 'SMTP_HOST', required: false, hint: 'SMTP server for email alerts' },
  { name: 'SMTP_USER', required: false, hint: 'SMTP authentication username' },
  { name: 'SMTP_PASS', required: false, hint: 'SMTP authentication password' },
  { name: 'SMTP_FROM', required: false, hint: 'From address for alert emails' },

  // Third-party integrations
  { name: 'TWILIO_ACCOUNT_SID', required: false, hint: 'Twilio account SID' },
  { name: 'TWILIO_AUTH_TOKEN', required: false, hint: 'Twilio auth token' },
  { name: 'TWILIO_PHONE_NUMBER', required: false, hint: 'Twilio sender phone number' },
  { name: 'TELEGRAM_BOT_TOKEN', required: false, hint: 'Telegram bot token' },

  // Weather / satellite / translation
  { name: 'WEATHER_API_KEY', required: false, hint: 'Weather API key (OpenWeather or alternative)' },
  { name: 'OPENWEATHER_API_KEY', required: false, hint: 'OpenWeatherMap API key' },
  { name: 'NASA_FIRMS_API_KEY', required: false, hint: 'NASA FIRMS API key' },
  { name: 'AZURE_TRANSLATOR_KEY', required: false, hint: 'Azure Translator key' },
  { name: 'AZURE_TRANSLATOR_REGION', required: false, hint: 'Azure Translator region' },
  { name: 'DEEPL_API_KEY', required: false, hint: 'DeepL API key' },
  { name: 'LIBRE_TRANSLATE_ENDPOINT', required: false, hint: 'LibreTranslate endpoint (optional)' },

  // Frontend / client
  { name: 'CLIENT_URL', required: true, hint: 'Frontend base URL (for reset links and CORS)' },
  { name: 'VITE_MAPBOX_TOKEN', required: false, hint: 'Public Mapbox token used by client' },

  // Misc / server
  { name: 'UPLOAD_DIR', required: false, hint: 'Uploads directory' },
  { name: 'AI_ENGINE_URL', required: false, hint: 'AI engine base URL' },
  { name: 'AI_ENGINE_TIMEOUT', required: false, hint: 'AI engine request timeout ms' },
  { name: 'RESET_PASSWORD_URL', required: false, hint: 'Password reset link base URL' },
  { name: 'MODEL_REGISTRY_PATH', required: false, hint: 'Local model registry path (AI engine)' },
  { name: 'S3_BUCKET', required: false, hint: 'Optional S3 bucket for artifacts' },
]

// Variables that should NEVER be exposed in logs
const SENSITIVE_PATTERNS = [
  /SECRET/i, /PASSWORD/i, /KEY/i, /TOKEN/i, /PASS/i, /AUTH/i
]

function isSensitive(name: string): boolean {
  return SENSITIVE_PATTERNS.some(p => p.test(name))
}

function maskValue(name: string, value: string): string {
  if (!value) return '(empty)'
  if (isSensitive(name)) {
    return value.length > 6 ? `${value.slice(0, 3)}***${value.slice(-3)}` : '***'
  }
  return value.length > 40 ? `${value.slice(0, 40)}...` : value
}

export interface ValidationResult {
  valid: boolean
  errors: string[]
  warnings: string[]
  aiProviderConfigured: boolean
}

/**
 * Validate environment configuration for production readiness
 */
export function validateEnvironment(): ValidationResult {
  const isProduction = process.env.NODE_ENV === 'production'
  const errors: string[] = []
  const warnings: string[] = []

  // Check required variables
  for (const req of ENV_REQUIREMENTS) {
    const value = process.env[req.name]
    
    if (req.required && isProduction) {
      if (!value || value.trim() === '') {
        errors.push(`Missing required variable: ${req.name}${req.hint ? ` (${req.hint})` : ''}`)
        continue
      }
    }
    
    if (value && req.pattern && !req.pattern.test(value)) {
      if (isProduction) {
        errors.push(`Invalid value for ${req.name}: ${req.hint || 'pattern mismatch'}`)
      } else {
        warnings.push(`${req.name} does not match expected pattern (${req.hint})`)
      }
    }
  }

  // Check for at least one AI provider
  const aiProviders = ['GROQ_API_KEY', 'GEMINI_API_KEY', 'OPENROUTER_API_KEY', 'HF_API_KEY']
  const hasAiProvider = aiProviders.some(k => process.env[k] && process.env[k]!.trim() !== '')
  
  if (!hasAiProvider) {
    if (isProduction) {
      warnings.push('No AI provider API key configured - AI features will be limited')
    }
  }

  // Security warnings
  if (process.env.JWT_SECRET === 'your-super-secret-jwt-key-change-in-production') {
    errors.push('JWT_SECRET is using default placeholder value - must change for production')
  }

  // Check for insecure default values
  const defaultChecks = [
    { name: 'DATABASE_URL', bad: 'postgres://localhost' },
    { name: 'CORS_ORIGIN', bad: '*' },
  ]
  
  for (const check of defaultChecks) {
    const val = process.env[check.name]
    if (isProduction && val && val.includes(check.bad as string)) {
      warnings.push(`${check.name} appears to use development value: ${maskValue(check.name, val)}`)
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    aiProviderConfigured: hasAiProvider,
  }
}

/**
 * Run validation and log results. Exit on fatal errors in production.
 */
export function validateAndLog(logger: LoggerLike): void {
  const result = validateEnvironment()
  const isProduction = process.env.NODE_ENV === 'production'

  logger.info('=== Environment Validation ===')
  logger.info(`Mode: ${isProduction ? 'PRODUCTION' : 'development'}`)

  // Log warnings
  for (const warn of result.warnings) {
    logger.warn(`[Env] ${warn}`)
  }

  // Log errors
  if (result.errors.length > 0) {
    for (const err of result.errors) {
      logger.error(`[Env] ${err}`)
    }

    const msg = `Missing or invalid environment variables:\n- ${result.errors.join('\n- ')}`
    logger.error(`[Env] ? ${result.errors.length} configuration error(s)`)

    if (isProduction) {
      logger.error('[Env] FATAL: Cannot start in production with invalid configuration')
      logger.error(msg)
      // Crash early with full error list
      throw new Error(msg)
    } else {
      logger.warn('[Env] Non-production mode: configuration issues detected (see above)')
    }
  } else {
    logger.info(`[Env] ? Configuration valid${result.aiProviderConfigured ? ' (AI enabled)' : ' (AI limited)'}`)
  }
}

/**
 * Get a safe environment report (for debugging, with sensitive values masked)
 */
export function getEnvReport(): Record<string, string> {
  const report: Record<string, string> = {}
  
  for (const req of ENV_REQUIREMENTS) {
    const value = process.env[req.name]
    report[req.name] = value 
      ? (isSensitive(req.name) ? '(set)' : maskValue(req.name, value))
      : '(not set)'
  }
  
  return report
}
