/*
 * index.ts - AEGIS Express server entry point
 * This is the main server file that:
 * 1. Loads environment configuration from .env
 * 2. Sets up security middleware (CORS, Helmet, rate limiting)
 * [reloaded: resource deployment CREATE/DELETE routes added]
 * 3. Mounts all API route handlers
 * 4. Serves uploaded files statically
 * 5. Starts the HTTP server
 * The server provides a REST API consumed by the React frontend.
 * All routes are prefixed with /api/ and return JSON responses.
 * In production, the built React app would be served from the same
 * Express server. During development, Vite runs separately on port 5173
 * and proxies API calls to this server on port 3001.
  */

import express from 'express'
import 'express-async-errors' // Must be imported before routes — patches Express to catch async errors
import { createServer } from 'http'
import cors from 'cors'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import cookieParser from 'cookie-parser'
import path from 'path'
import fs from 'fs'
import dotenv from 'dotenv'
import * as Sentry from '@sentry/node'

// Load environment variables — try multiple .env locations for robustness
const envCandidates = [
  path.resolve('.env'), // CWD (when run from server/)
  path.resolve('server', '.env'), // CWD is project root
  path.resolve('aegis-v6', 'server', '.env'), // CWD is workspace root
]
for (const envFile of envCandidates) {
  if (fs.existsSync(envFile)) {
    dotenv.config({ path: envFile })
    break
  }
}
if (!process.env.DATABASE_URL) {
  // Last resort: try default dotenv.config()
  dotenv.config()
}

// STRICT STARTUP VALIDATION — refuse to boot if critical config missing
function validateStartupConfig(): void {
  const errors: string[] = []
  const warnings: string[] = []
  const isProduction = process.env.NODE_ENV === 'production'

  console.log(`\n Environment: ${isProduction ? 'PRODUCTION' : 'development'}`)

  // DATABASE_URL is mandatory
  if (!process.env.DATABASE_URL) {
    errors.push('DATABASE_URL is not set. PostgreSQL connection required.')
  }

  // PRODUCTION-ONLY: Security-critical variables
  if (isProduction) {
    // JWT secrets must be set and strong
    if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
      errors.push('JWT_SECRET must be set to a strong value (32+ chars) in production')
    }
    if (process.env.JWT_SECRET === 'your-super-secret-jwt-key-change-in-production') {
      errors.push('JWT_SECRET is using the placeholder value - must change for production')
    }
    if (!process.env.REFRESH_TOKEN_SECRET || process.env.REFRESH_TOKEN_SECRET.length < 32) {
      errors.push('REFRESH_TOKEN_SECRET must be set to a strong value (32+ chars) in production')
    }

    // Internal API authentication
    if (!process.env.INTERNAL_API_KEY || process.env.INTERNAL_API_KEY.length < 16) {
      errors.push('INTERNAL_API_KEY must be set (16+ chars) to protect internal endpoints')
    }
    if (!process.env.N8N_WEBHOOK_SECRET || process.env.N8N_WEBHOOK_SECRET.length < 16) {
      errors.push('N8N_WEBHOOK_SECRET must be set (16+ chars) to protect webhook endpoints')
    }

    // VAPID for push notifications
    if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
      warnings.push('VAPID keys not set - push notifications will not work')
    }

    // CORS should not be wildcard in production
    if (process.env.CORS_ORIGIN === '*') {
      warnings.push('CORS_ORIGIN is set to * (wildcard) - consider restricting to specific origins')
    }
  } else {
    // Development warnings
    if (!process.env.JWT_SECRET) {
      warnings.push('JWT_SECRET not set - using random dev secret (sessions reset on restart)')
    }
    if (!process.env.INTERNAL_API_KEY) {
      warnings.push('INTERNAL_API_KEY not set - internal endpoints allow localhost bypass')
    }
  }

  // At least one LLM provider key required for AI features
  const llmKeys = [
    process.env.GEMINI_API_KEY,
    process.env.GROQ_API_KEY,
    process.env.OPENROUTER_API_KEY,
    process.env.HF_API_KEY,
  ].filter(Boolean)

  // Email mode check
  const emailMode = (process.env.EMAIL_MODE || 'dev').toLowerCase()
  if (emailMode === 'production') {
    if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
      warnings.push('EMAIL_MODE=production but SMTP credentials missing — emails will fail')
    } else {
      console.log(' [OK] Email: PRODUCTION mode (SMTP)')
    }
  } else {
    console.log(' [OK] Email: DEV mode (console + dev_emails table)')
  }

  if (llmKeys.length === 0) {
    warnings.push('No LLM API keys configured - Chat and AI analysis features will NOT work')
    console.warn(' [WARN] Set at least one: GEMINI_API_KEY, GROQ_API_KEY, OPENROUTER_API_KEY, or HF_API_KEY')
    console.warn(' Get free keys at: https://aistudio.google.com/apikey (Gemini) or https://console.groq.com (Groq)')
  } else {
    const providers = []
    if (process.env.GEMINI_API_KEY) providers.push('Gemini')
    if (process.env.GROQ_API_KEY) providers.push('Groq')
    if (process.env.OPENROUTER_API_KEY) providers.push('OpenRouter')
    if (process.env.HF_API_KEY) providers.push('HuggingFace')
    console.log(` [OK] LLM providers configured: ${providers.join(', ')}`)
  }

  // Embedding provider check
  const embKeys = [process.env.HF_API_KEY, process.env.GEMINI_API_KEY].filter(Boolean)
  if (embKeys.length === 0) {
    warnings.push('No embedding API keys - Vector search will use text-only fallback')
  } else {
    console.log(` [OK] Embedding providers ready (${embKeys.length} key(s))`)
  }

  // Weather API
  if (!process.env.WEATHER_API_KEY) {
    console.log(' ℹ️ WEATHER_API_KEY not set - Using Open-Meteo (free, no key required)')
  }

  // 2FA Encryption Key
  if (!process.env.TWO_FACTOR_ENCRYPTION_KEY) {
    if (isProduction) {
      errors.push('TWO_FACTOR_ENCRYPTION_KEY must be set (64 hex chars). Generate with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"')
    } else {
      console.warn(' [WARN] TWO_FACTOR_ENCRYPTION_KEY not set - 2FA secrets will use dev fallback key')
    }
  } else if (process.env.TWO_FACTOR_ENCRYPTION_KEY.length !== 64) {
    errors.push('TWO_FACTOR_ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes)')
  }

  // AI Engine
  if (!process.env.AI_ENGINE_URL) {
    console.log(' ℹ️ AI_ENGINE_URL not set - Defaulting to http://localhost:8000')
  }

  // Print warnings
  if (warnings.length > 0) {
    console.log('')
    warnings.forEach(w => console.warn(` [WARN] ${w}`))
  }

  // Print errors and exit in production
  if (errors.length > 0) {
    console.error('\n [ERR] FATAL CONFIGURATION ERRORS:')
    errors.forEach(e => console.error(` • ${e}`))
    console.error('')
    if (isProduction) {
      console.error(' Cannot start in production with invalid configuration.')
      console.error(' Fix the above errors and restart.\n')
      process.exit(1)
    } else {
      console.warn(' [WARN] Would fail in production - continuing in development mode\n')
    }
  } else {
    console.log(` [OK] Configuration validated${isProduction ? ' (production ready)' : ''}\n`)
  }
}

validateStartupConfig()

// Sentry Error Tracking (initializes only when DSN is configured)
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || 'development',
    release: `aegis-server@6.9.0`,
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
    initialScope: { tags: { service: 'server' } },
  })
  console.log(' [OK] Sentry: error tracking enabled')
} else {
  console.log(' ℹ️ Sentry: DSN not configured — error tracking disabled')
}

import { initRegionRegistry } from './adapters/regions/RegionRegistry.js'

// Region Adapter Registry — must init before route/service imports
try {
  initRegionRegistry()
} catch (err: any) {
  console.error(`\n [ERR] ${err.message}\n`)
  process.exit(1)
}

import authRoutes from './routes/authRoutes.js'
import citizenAuthRoutes from './routes/citizenAuthRoutes.js'
import telegramRoutes from './routes/telegramRoutes.js'
import citizenRoutes from './routes/citizenRoutes.js'
import reportRoutes from './routes/reportRoutes.js'
import dataRoutes from './routes/dataRoutes.js'
import extendedRoutes from './routes/extendedRoutes.js'
import aiRoutes from './routes/aiRoutes.js'
import userRoutes from './routes/userRoutes.js'
import chatRoutes from './routes/chatRoutes.js'
import configRoutes from './routes/configRoutes.js'
import docsRoutes from './routes/docsRoutes.js'
import communityRoutes from './routes/communityRoutes.js'
import uploadRoutes from './routes/uploadRoutes.js'
import riverRoutes from './routes/riverRoutes.js'
import floodRoutes from './routes/floodRoutes.js'
import distressRoutes from './routes/distressRoutes.js'
import internalRoutes from './routes/internalRoutes.js'
import adminCommunityRoutes from './routes/adminCommunityRoutes.js'
import adminMessagingRoutes from './routes/adminMessagingRoutes.js'
import adminCacheRoutes from './routes/adminCacheRoutes.js'
import adminAiRoutes from './routes/adminAiRoutes.js'
import translationRoutes from './routes/translationRoutes.js'
import spatialRoutes from './routes/spatialRoutes.js'
import oauthRoutes from './routes/oauthRoutes.js'
import twoFactorRoutes from './routes/twoFactorRoutes.js'
import citizenTwoFactorRoutes from './routes/citizenTwoFactorRoutes.js'
import securityRoutes from './routes/securityRoutes.js'
import incidentRoutes from './routes/incidentRoutes.js'
import setupRoutes from './routes/setupRoutes.js'
import mapTileRoutes from './routes/mapTileRoutes.js'
import { errorHandler } from './middleware/errorHandler.js'
import { requestIdMiddleware } from './middleware/requestId.js'
import pool from './models/db.js'
import { initSocketServer } from './services/socket.js'
import { requestLogger } from './services/logger.js'
import { startCronJobs } from './services/cronJobs.js'
import { setIOInstance as setRiverIO } from './services/riverLevelService.js'
import { setThreatIO } from './services/threatLevelService.js'
import { setCommunityRealtimeIo } from './services/communityRealtime.js'
import { startN8nHealthMonitor } from './services/n8nHealthCheck.js'
import { startModelWarmup } from './services/llmRouter.js'
import { metricsMiddleware, metricsHandler, collectDBPoolMetrics, activeWebsocketConnections } from './services/metrics.js'
import { authMiddleware, requireRole, AuthRequest } from './middleware/auth.js'

const app = express()
const httpServer = createServer(app)
const PORT = parseInt(process.env.PORT || '3001')

// Initialize Socket.IO for real-time citizen ↔ admin chat
const io = initSocketServer(httpServer)

// Share io instance with route handlers (used for real-time post notifications)
app.set('io', io)

// Share io instance with river level service for real-time broadcasts
setRiverIO(io)

// Share io instance with threat level service for level-change broadcasts
setThreatIO(io)

// Share io instance with community realtime service for moderation events
setCommunityRealtimeIo(io)

/* Security middleware */
// Helmet sets various HTTP security headers (#80 MIME sniff prevention)
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "blob:", "https://*.tile.openstreetmap.org", "https://cartodb-basemaps-*.global.ssl.fastly.net", "https://server.arcgisonline.com", "https://*.opentopomap.org"],
      connectSrc: ["'self'", "ws:", "wss:", "https://api-inference.huggingface.co", "https://generativelanguage.googleapis.com", "https://api.groq.com", "https://openrouter.ai"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      upgradeInsecureRequests: [],
    },
  },
  hsts: { maxAge: 31536000, includeSubDomains: true },
  noSniff: true, // X-Content-Type-Options: nosniff — prevents MIME sniffing
  xFrameOptions: { action: 'deny' }, // X-Frame-Options: DENY
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
}))

// CORS allows the React dev server to make API calls
app.use(cors({
  origin: (origin, callback) => {
    const allowed = [
      'http://localhost:5173', 'http://localhost:5174', 'http://localhost:5175',
      'http://localhost:3000', 'http://127.0.0.1:5173', 'http://127.0.0.1:5174',
      process.env.CLIENT_URL,
    ].filter(Boolean)
    if (!origin || allowed.includes(origin)) {
      callback(null, true)
    } else if (process.env.NODE_ENV !== 'production') {
      callback(null, true) // Allow all origins in dev
    } else {
      callback(new Error(`CORS: origin '${origin}' not allowed`))
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}))

// Global rate limiting: max 600 requests per minute per IP (increased for dashboard with many panels)
app.use(rateLimit({
  windowMs: 60 * 1000,
  max: 600,
  message: { error: 'Too many requests. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path === '/metrics' || req.path.startsWith('/api/map-tiles/'),
}))

// Stricter rate limiting for LOGIN ONLY (brute-force protection against wrong passwords)
const loginLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 50, // 50 login attempts per hour
  message: { error: 'Too many login attempts. Please try again in 1 hour.' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    // Skip rate limiting for register/signup endpoints
    return req.path === '/register' || req.path === '/signup'
  }
})

// Parse JSON request bodies (up to 10MB for large report descriptions)
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true }))
app.use(cookieParser())

// X-Request-ID — generates or forwards a correlation ID for every request
// Must be registered before the request logger so log lines include the ID
app.use(requestIdMiddleware)

// Prometheus metrics middleware — records request duration/count for all routes
app.use(metricsMiddleware)

// CSRF Double-Submit Cookie Protection
// Sets an aegis_csrf cookie on every response; state-changing requests must
// include the same value in the X-CSRF-Token header. Since JavaScript on other
// origins cannot read httpOnly=false same-site cookies, this prevents CSRF.
import crypto from 'crypto'
app.use((req, res, next) => {
  // Set CSRF token cookie if not present
  if (!req.cookies?.aegis_csrf) {
    const csrfToken = crypto.randomBytes(32).toString('hex')
    res.cookie('aegis_csrf', csrfToken, {
      httpOnly: false, // JS must read it to send in header
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
      path: '/',
    })
  }

  // Skip CSRF check for safe methods and specific paths
  const safeMethods = ['GET', 'HEAD', 'OPTIONS']
  const csrfExemptPaths = ['/api/internal/', '/api/telegram/', '/api/map-tiles/']

  if (safeMethods.includes(req.method) || csrfExemptPaths.some(p => req.path.startsWith(p))) {
    return next()
  }

  // For state-changing requests, verify the CSRF token
  const cookieToken = req.cookies?.aegis_csrf
  const headerToken = req.headers['x-csrf-token']

  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    if (process.env.NODE_ENV === 'production') {
      res.status(403).json({ error: 'CSRF token missing or invalid.' })
      return
    }
    // Development: warn loudly so frontend devs notice and fix the integration
    console.warn(`[CSRF] Token mismatch on ${req.method} ${req.path} — would be blocked in production. Ensure frontend sends X-CSRF-Token header.`)
  }

  next()
})

// Initialize Passport (session-less — used only for OAuth redirect flow)
import passport from 'passport'
app.use(passport.initialize())

// Structured request logging (pino)
app.use(requestLogger())

// Serve uploaded files with basic access control
// Public evidence images are accessible, but add cache headers and prevent directory listing
app.use('/uploads', (req, res, next) => {
  // Block directory traversal attempts
  if (req.path.includes('..') || req.path.includes('\0')) {
    return res.status(400).json({ error: 'Invalid path' })
  }
  // Set security headers for served files
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Content-Disposition', 'inline')
  res.setHeader('Cache-Control', 'public, max-age=86400')
  next()
}, express.static(path.join(process.cwd(), 'uploads'), {
  dotfiles: 'deny',
  index: false, // Prevent directory listing
}))

/* API Routes */
// Prometheus metrics endpoint (not behind auth — scraped by Prometheus internally)
app.get('/metrics', metricsHandler)

app.use('/api/auth/login', loginLimiter) // Brute-force protection for login
app.use('/api/citizen-auth/login', loginLimiter) // Brute-force protection for citizen login
app.use('/api/auth', authRoutes) // Authentication
app.use('/api/auth/2fa', twoFactorRoutes) // TOTP Two-Factor Authentication
app.use('/api/security', securityRoutes) // Device Trust, Security Dashboard, Alert Preferences
app.use('/api/auth', oauthRoutes) // OAuth social login (Google etc.)
app.use('/api/citizen-auth', citizenAuthRoutes) // Citizen auth
app.use('/api/citizen-auth/2fa', citizenTwoFactorRoutes) // Citizen TOTP Two-Factor Authentication
app.use('/api/citizen', citizenRoutes) // Citizen safety, messaging, dashboard
app.use('/api/reports', reportRoutes) // Emergency report CRUD
app.use('/api/users', userRoutes) // User management (Super Admin only)
app.use('/api', dataRoutes) // Alerts, activity, AI metrics, weather
app.use('/api', extendedRoutes) // Subscriptions, audit, community, departments
app.use('/api/ai', aiRoutes) // AI prediction engine integration
app.use('/api/chat', chatRoutes) // LLM chatbot with RAG
app.use('/api/community', communityRoutes) // Community posts, comments, likes
app.use('/api/admin/setup', setupRoutes) // First-run onboarding wizard
app.use('/api/admin/community', adminCommunityRoutes)
app.use('/api/admin/messages', adminMessagingRoutes)
app.use('/api/admin/cache', adminCacheRoutes) // Cache management (Admin only)
app.use('/api/admin/ai', adminAiRoutes) // AI system management (Admin only)
app.use('/api/rivers', riverRoutes) // Live river level monitoring
app.use('/api', floodRoutes) // Flood prediction, evacuation, threat
app.use('/api/distress', distressRoutes) // SOS / distress beacon
app.use('/api', uploadRoutes) // Image/file uploads
app.use('/api/config', configRoutes) // Region, hazard, shelter config
app.use('/api/docs', docsRoutes) // Swagger API documentation
app.use('/api/internal', internalRoutes) // n8n ws-bridge, error log, system health
app.use('/api/translate', translationRoutes) // Translation service (Azure / DeepL / LibreTranslate)
app.use('/api/spatial', spatialRoutes) // PostGIS spatial analysis tools
app.use('/api/v1/incidents', incidentRoutes) // Multi-incident plugin system (v1 API)
app.use('/api/map-tiles', mapTileRoutes) // Same-origin map tile proxy (adblock/network resilient)
app.use('/api/telegram', telegramRoutes) // Telegram bot webhook & chat-id capture

// Sentry error handler — must be after all routes and before other error handlers
if (process.env.SENTRY_DSN) {
  Sentry.setupExpressErrorHandler(app)
}

// Centralised error handler — formats ALL errors into { success, error: { code, message } }
app.use(errorHandler)

// Deep health check endpoint
// Checks all critical dependencies — used by Kubernetes readiness/liveness probes.
app.get('/api/health', async (_req, res) => {
  const checks: Record<string, string> = {}
  let overallOk = true

  // 1. Database
  try {
    await pool.query('SELECT 1')
    checks.database = 'ok'
  } catch (err: any) {
    checks.database = `error: ${err.message}`
    overallOk = false
  }

  // 2. AI engine (non-blocking — degraded, not down, if unreachable)
  const aiEngineUrl = process.env.AI_ENGINE_URL || 'http://localhost:8000'
  try {
    const aiRes = await fetch(`${aiEngineUrl}/health`, {
      signal: AbortSignal.timeout(3000),
    })
    checks.aiEngine = aiRes.ok ? 'ok' : `degraded (${aiRes.status})`
  } catch {
    checks.aiEngine = 'unreachable'
    // AI engine being down does not make the Node server unhealthy
  }

  // 3. Connection pool stats
  checks.dbPoolTotal = String((pool as any).totalCount ?? '?')
  checks.dbPoolIdle = String((pool as any).idleCount ?? '?')
  checks.dbPoolWaiting = String((pool as any).waitingCount ?? '?')

  const status = overallOk ? 200 : 503
  res.status(status).json({
    status: overallOk ? 'ok' : 'error',
    checks,
    uptime: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
    version: '6.9.0',
  })
})

// Detailed Health Endpoint (authenticated, admin/operator only)
// Exposes operational diagnostics — never expose secrets or raw credentials.
app.get('/api/health/detailed', authMiddleware as any, requireRole('admin', 'operator') as any, async (req: any, res) => {
  const mem = process.memoryUsage()

  const dbPoolStats = {
    total: (pool as any).totalCount ?? 0,
    idle: (pool as any).idleCount ?? 0,
    waiting: (pool as any).waitingCount ?? 0,
    max: parseInt(process.env.DB_POOL_MAX || '20'),
  }

  let dbLatencyMs: number | null = null
  try {
    const start = Date.now()
    await pool.query('SELECT 1')
    dbLatencyMs = Date.now() - start
  } catch { /* covered by basic health */ }

  res.json({
    status: 'ok',
    uptime: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
    version: '6.9.0',
    nodeVersion: process.version,
    memory: {
      rss: mem.rss,
      heapUsed: mem.heapUsed,
      heapTotal: mem.heapTotal,
      external: mem.external,
    },
    db: {
      pool: dbPoolStats,
      latencyMs: dbLatencyMs,
    },
    websockets: {
      connections: io.engine.clientsCount,
    },
    environment: process.env.NODE_ENV || 'development',
  })
})

/* Start server */
httpServer.listen(PORT, () => {
  console.log(`\n AEGIS Server v6.9 running on http://localhost:${PORT}`)
  console.log(` API endpoints: http://localhost:${PORT}/api/`)
  console.log(` Socket.IO: ws://localhost:${PORT}`)
  console.log(` Health check: http://localhost:${PORT}/api/health`)
  console.log(` Uploads: http://localhost:${PORT}/uploads/`)
  console.log(` Chat API: http://localhost:${PORT}/api/chat`)
  console.log(` Config API: http://localhost:${PORT}/api/config\n`)

  // Start background cron jobs (SEPA ingestion, cache cleanup, etc.)
  startCronJobs()

  // Start n8n health monitoring (activates fallback cron if n8n is unreachable)
  startN8nHealthMonitor()

  // Pre-warm primary Ollama model into GPU (eliminates 30-60s cold start)
  startModelWarmup().catch(() => {})

  // Sync DB pool & WebSocket metrics to Prometheus every 5 seconds
  setInterval(() => {
    collectDBPoolMetrics(pool)
    activeWebsocketConnections.set(io.engine.clientsCount)
  }, 5000)
})

// Graceful shutdown
// Allows in-flight requests to complete, drains the DB pool, then exits cleanly.
// Required for zero-downtime Kubernetes rolling restarts and Docker stop signals.
let isShuttingDown = false

async function gracefulShutdown(signal: string): Promise<void> {
  if (isShuttingDown) return
  isShuttingDown = true
  console.log(`\n[Server] ${signal} received — shutting down gracefully...`)

  // Stop accepting new connections (allow 10s for in-flight requests to drain)
  httpServer.close(async () => {
    console.log('[Server] HTTP server closed.')
    try {
      await pool.end()
      console.log('[Server] DB pool drained.')
    } catch (err) {
      console.error('[Server] Error draining DB pool:', err)
    }
    console.log('[Server] Shutdown complete.')
    process.exit(0)
  })

  // Force-kill if graceful shutdown takes longer than 15 seconds
  setTimeout(() => {
    console.error('[Server] Graceful shutdown timed out — force exiting.')
    process.exit(1)
  }, 15_000)
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'))
process.on('SIGINT', () => gracefulShutdown('SIGINT'))
