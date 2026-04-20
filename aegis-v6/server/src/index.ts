/**
 * The main entry point for the AEGIS Express server. It validates startup
 * configuration, wires up the entire middleware pipeline (security, rate
 * limiting, CSRF, authentication, tracing, QoS), mounts all API routes,
 * initialises Socket.IO for real-time communication, starts background cron
 * jobs, and registers graceful shutdown hooks.
 *
 * - All API routes in server/src/routes/ are mounted here under /api/
 * - Socket.IO is initialised here and its instance is shared with services
 *   that broadcast live data (river levels, threat levels, community events)
 * - Middleware is declared here but implemented in server/src/middleware/
 * - Infrastructure services (circuit breakers, self-healing, event sourcing,
 *   bulkheads, secrets manager, feature flags) are initialised before routes
 * - The React frontend (client/) communicates exclusively through the /api/
 * routes mounted here; in dev, Vite proxies API calls on port 5173 -> 3001
 * - In production, the built React app can optionally be served statically here
 *
 * Key actions / endpoints / exports:
 * - GET  /api/health          -- public health check (DB + AI engine status)
 * - GET  /api/health/detailed -- admin/operator health with pool stats & memory
 * - GET  /metrics             -- Prometheus scrape endpoint
 * - GET  /healthz /readyz /startupz -- Kubernetes liveness/readiness/startup probes
 * - GET  /api/internal/*      -- admin-only introspection (circuits, QoS, chaos, etc.)
 * - All other /api/* routes are mounted from server/src/routes/
 *
 * - server/src/middleware/auth.ts        -- JWT verification & role-based gating
 * - server/src/middleware/errorHandler.ts -- central error shaping for all routes
 * - server/src/models/db.ts              -- PostgreSQL pool (used by all services)
 * - server/src/services/socket.ts        -- Socket.IO server setup & event handlers
 * - server/src/services/cronJobs.ts      -- background scheduled tasks
 * - server/src/services/zeroDowntime.ts  -- graceful shutdown & K8s probes
 * - server/src/services/circuitBreaker.ts -- protecting external dependency calls
 * - server/src/services/llmRouter.ts     -- LLM provider routing + model warm-up
 * - server/src/routes/                   -- all individual API route handlers
 * */

import express from 'express'
import 'express-async-errors'
import { createServer } from 'http'
import * as cryptoNode from 'crypto'
import cors from 'cors'
import helmet from 'helmet'
import compression from 'compression'
import rateLimit from 'express-rate-limit'
import slowDown from 'express-slow-down'
import hpp from 'hpp'
import cookieParser from 'cookie-parser'
import passport from 'passport'
import path from 'path'
import fs from 'fs'
import dotenv from 'dotenv'
import * as Sentry from '@sentry/node'

//Load environment variables - try multiple .env locations for robustness
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
  //Last resort: try default dotenv.config()
  dotenv.config()
}

//Refuse to boot if critical config is missing
function validateStartupConfig(): void {
  const errors: string[] = []
  const warnings: string[] = []
  const isProduction = process.env.NODE_ENV === 'production'

  console.log(`\n Environment: ${isProduction ? 'PRODUCTION' : 'development'}`)

  //DATABASE_URL is mandatory
  if (!process.env.DATABASE_URL) {
    errors.push('DATABASE_URL is not set. PostgreSQL connection required.')
  }

  //PRODUCTION-ONLY: Security-critical variables
  if (isProduction) {
    //JWT secrets must be set and strong
    if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
      errors.push('JWT_SECRET must be set to a strong value (32+ chars) in production')
    }
    if (process.env.JWT_SECRET === 'your-super-secret-jwt-key-change-in-production') {
      errors.push('JWT_SECRET is using the placeholder value - must change for production')
    }
    if (!process.env.REFRESH_TOKEN_SECRET || process.env.REFRESH_TOKEN_SECRET.length < 32) {
      errors.push('REFRESH_TOKEN_SECRET must be set to a strong value (32+ chars) in production')
    }

    //Internal API authentication
    if (!process.env.INTERNAL_API_KEY || process.env.INTERNAL_API_KEY.length < 16) {
      errors.push('INTERNAL_API_KEY must be set (16+ chars) to protect internal endpoints')
    }
    if (!process.env.N8N_WEBHOOK_SECRET || process.env.N8N_WEBHOOK_SECRET.length < 16) {
      errors.push('N8N_WEBHOOK_SECRET must be set (16+ chars) to protect webhook endpoints')
    }

    //VAPID for push notifications
    if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
      warnings.push('VAPID keys not set - push notifications will not work')
    }

    //CORS should not be wildcard in production
    if (process.env.CORS_ORIGIN === '*') {
      warnings.push('CORS_ORIGIN is set to * (wildcard) - consider restricting to specific origins')
    }
  } else {
    //Development warnings
    if (!process.env.JWT_SECRET) {
      warnings.push('JWT_SECRET not set - using random dev secret (sessions reset on restart)')
    }
    if (!process.env.INTERNAL_API_KEY) {
      warnings.push('INTERNAL_API_KEY not set - internal endpoints allow localhost bypass')
    }
  }

  //At least one LLM provider key required for AI features
  const llmKeys = [
    process.env.GEMINI_API_KEY,
    process.env.GROQ_API_KEY,
    process.env.OPENROUTER_API_KEY,
    process.env.HF_API_KEY,
  ].filter(Boolean)

  //Email mode check
  const emailMode = (process.env.EMAIL_MODE || 'dev').toLowerCase()
  if (emailMode === 'production') {
    if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
      warnings.push('EMAIL_MODE=production but SMTP credentials missing - emails will fail')
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

  //Embedding provider check
  const embKeys = [process.env.HF_API_KEY, process.env.GEMINI_API_KEY].filter(Boolean)
  if (embKeys.length === 0) {
    warnings.push('No embedding API keys - Vector search will use text-only fallback')
  } else {
    console.log(` [OK] Embedding providers ready (${embKeys.length} key(s))`)
  }

  //Weather API
  if (!process.env.WEATHER_API_KEY) {
    console.log(' ?? WEATHER_API_KEY not set - Using Open-Meteo (free, no key required)')
  }

  //2FA Encryption Key
  if (!process.env.TWO_FACTOR_ENCRYPTION_KEY) {
    if (isProduction) {
      errors.push('TWO_FACTOR_ENCRYPTION_KEY must be set (64 hex chars). Generate with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"')
    } else {
      console.warn(' [WARN] TWO_FACTOR_ENCRYPTION_KEY not set - 2FA secrets will use dev fallback key')
    }
  } else if (process.env.TWO_FACTOR_ENCRYPTION_KEY.length !== 64) {
    errors.push('TWO_FACTOR_ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes)')
  }

  //AI Engine
  if (!process.env.AI_ENGINE_URL) {
    console.log(' ?? AI_ENGINE_URL not set - Defaulting to http://localhost:8000')
  }

  //Print warnings
  if (warnings.length > 0) {
    console.log('')
    warnings.forEach(w => console.warn(` [WARN] ${w}`))
  }

  //Print errors and exit in production
  if (errors.length > 0) {
    console.error('\n [ERR] FATAL CONFIGURATION ERRORS:')
    errors.forEach(e => console.error(` - ${e}`))
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

//Sentry Error Tracking (initializes only when DSN is configured)
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
  console.log(' ?? Sentry: DSN not configured - error tracking disabled')
}

import { initRegionRegistry } from './adapters/regions/RegionRegistry.js'

//Region Adapter Registry - must init before route/service imports
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
import magicLinkRoutes from './routes/magicLinkRoutes.js'
import githubOAuthRoutes from './routes/githubOAuthRoutes.js'
import emergencyQRAuthRoutes from './routes/emergencyQRAuthRoutes.js'
import incidentRoutes from './routes/incidentRoutes.js'
import setupRoutes from './routes/setupRoutes.js'
import mapTileRoutes from './routes/mapTileRoutes.js'
import adaptiveMFARoutes from './routes/adaptiveMFARoutes.js'
import { initAdaptiveMFA } from './services/adaptiveMFAService.js'
import helplinesRoutes from './routes/helplinesRoutes.js'
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
import { metricsMiddleware, metricsHandler, collectDBPoolMetrics, activeWebsocketConnections, trustedDevicesGauge } from './services/metrics.js'
import { authMiddleware, requireRole, AuthRequest } from './middleware/auth.js'
import { idempotencyMiddleware, getIdempotencyStats } from './middleware/idempotency.js'
import { requestTimeoutMiddleware } from './middleware/requestTimeout.js'
import { updatePoolMetrics } from './services/queryLogger.js'

//Infrastructure services
import { initFlags, isFeatureEnabled, featureFlagMiddleware, getFlagStats } from './services/featureFlags.js'
import { adaptiveRateLimitMiddleware, getRateLimitStats } from './services/adaptiveRateLimiting.js'
import { startSelfHealing, getHealthStatus } from './services/selfHealing.js'
import { qosMiddleware, getQosStats, Priority } from './services/requestPrioritization.js'
import { initCircuits, Circuits, getAllStatus as getCircuitStatus } from './services/circuitBreaker.js'
import { initZeroDowntime, livenessHandler, readinessHandler, startupHandler, healthHandler, registerShutdownHook, trackConnectionStart, trackConnectionEnd } from './services/zeroDowntime.js'

//Resilience and operations services
import { initBulkheads, getAllStatus as getBulkheadStatus, Bulkheads } from './services/bulkhead.js'
import { getGatewayStats, apiKeyMiddleware, versioningMiddleware } from './services/apiGateway.js'
import { coalesce, getCoalescingStats, createUserLoader, createReportLoader } from './services/requestCoalescing.js'

//Data layer and API services
import eventStreaming from './services/eventStreaming.js'
import openApiGenerator from './services/openApiGenerator.js'

const app = express()
const httpServer = createServer(app)  // Wrap Express in raw http.Server so Socket.IO can share the same port
const PORT = parseInt(process.env.PORT || '3001')

//Infrastructure Initialization
//These must come before any route imports that use them.
//Circuits + self-healing protect outbound calls (to DB, AI engine, external APIs).
//Event sourcing creates the immutable audit trail needed by admin routes.
//Feature flags lets us toggle behaviour without a redeploy.
initCircuits()
initZeroDowntime({ server: httpServer, dbPool: pool })
startSelfHealing()

initFlags().catch((err: Error) => {
  console.warn(' [WARN] Feature flags failed to initialize:', err.message)
})

console.log(' [OK] Infrastructure initialized')
console.log('      - Circuit breakers: protecting external dependencies')
console.log('      - Self-healing: autonomous failure recovery')
console.log('      - Feature flags: gradual rollout support')

//Resilience services
initBulkheads()
console.log(' [OK] Resilience services initialized')
console.log('      - Bulkheads: resource isolation per service')
console.log('      - API Gateway: key management & versioning')
console.log('      - Request Coalescing: thundering herd prevention')
console.log('')

eventStreaming.initEventStreaming().catch((err: Error) => {
  console.warn(' [WARN] Event streaming failed to initialize:', err.message)
})

initAdaptiveMFA().catch((err: Error) => {
  console.warn(' [WARN] Adaptive MFA failed to initialize:', err.message)
})

console.log(' [OK] Data layer services initialized')
console.log('      - Event Streaming: async messaging')
console.log('      - OpenAPI 3.1: auto-generated API documentation')
console.log('')

//Trust exactly one proxy hop (nginx/Docker gateway). This tells Express to
//derive req.ip from the first X-Forwarded-For value only (not the raw socket IP),
//which is required for rate limiting and IP logging to work correctly behind a
//reverse proxy. '1' = exactly one hop; prevents clients from spoofing their IP
//by injecting extra values into the header.
app.set('trust proxy', 1)

//Initialize Socket.IO -- must happen before any route that calls getIO()
//We share the httpServer so Socket.IO and HTTP traffic use the same port.
const io = initSocketServer(httpServer)

//Make the io instance available inside route handlers via req.app.get('io').
//This lets POST /api/community/posts broadcast a live notification without
//directly importing socket.ts into the route file.
app.set('io', io)

//Share io with domain services that push real-time data to connected browsers.
//Each service keeps its own reference so it can emit without going through a route.
setRiverIO(io)        // river level service broadcasts flood alerts
setThreatIO(io)       // threat level service broadcasts amber/red escalations
setCommunityRealtimeIo(io)  // community moderation broadcasts live updates

/* --- Middleware stack --------------------------------------------------------
 * ORDER MATTERS here. Each layer sees the request before ones below it.
 * The general rule: security first, parsing second, auth/session third, routes last.
 *
 * 1. helmet        -- sets secure HTTP response headers (CSP, HSTS, X-Frame, etc.)
 * 2. compression   -- gzip/brotli response bodies (must come before routes)
 * 3. cache-control -- sets Cache-Control headers for /api/* responses
 * 4. tracing       -- injects trace-id for distributed request tracking
 * 5. service mesh  -- B3/Envoy-compatible header propagation
 * 6. QoS           -- prioritises emergency requests over background traffic
 * 7. adaptive rate  -- throttles when the system is under load
 * 8. feature flags  -- injects flag evaluations into req context
 * 9. chaos          -- fault injection (dev/test only, gated by env var)
 * 10. connection tracking -- graceful shutdown: counts active connections
 * 11. request timeout     -- drops requests that take too long
 * 12. CORS         -- controls which origins may call the API
 * 13. body parsing  -- parses JSON and URL-encoded bodies
 * 14. cookie-parser -- parses cookies (needed for CSRF)
 * 15. hpp           -- strips duplicate HTTP query parameters (param pollution)
 * 16. global rate limit -- hard 600 req/min ceiling per IP
 * 17. slow-down     -- adds delay after 300 req/min to discourage scrapers
 * 18. requestId     -- generates/forwards X-Request-ID correlation header
 * 19. metrics       -- Prometheus request counter/duration middleware
 * 20. idempotency   -- deduplicates retried POST/PUT requests via Idempotency-Key
 * 21. CSRF          -- double-submit cookie pattern for state-changing requests
 * 22. passport      -- initialises OAuth strategy (not session-based)
 * 23. request logger -- structured HTTP access log via pino
 * --------------------------------------------------------------------------- */

//Helmet sets a comprehensive set of security headers.
//The CSP here is deliberately specific: only allow scripts from self and jsdelivr,
//allow websocket connections to known AI provider URLs, block iframes entirely.
//Learn more about each directive: https://helmetjs.github.io/
/* Security middleware */
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  crossOriginEmbedderPolicy: false,
  crossOriginOpenerPolicy: { policy: 'same-origin' },
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "https://cdn.jsdelivr.net"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "blob:", "https://*.tile.openstreetmap.org", "https://cartodb-basemaps-*.global.ssl.fastly.net", "https://server.arcgisonline.com", "https://*.opentopomap.org"],
      connectSrc: ["'self'", "ws:", "wss:", "https://api-inference.huggingface.co", "https://generativelanguage.googleapis.com", "https://api.groq.com", "https://openrouter.ai"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      upgradeInsecureRequests: [],
      workerSrc: ["'self'", "blob:"],
    },
  },
  hsts: { maxAge: 63072000, includeSubDomains: true, preload: true },
  noSniff: true,
  xFrameOptions: { action: 'deny' },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  permittedCrossDomainPolicies: { permittedPolicies: 'none' },
  dnsPrefetchControl: { allow: false },
  hidePoweredBy: true,
}))

app.use((_req, res, next) => {
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(self), payment=(), usb=(), magnetometer=(), accelerometer=()')
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none')
  next()
})

//HTTP Compression (gzip/brotli) - reduces bandwidth by 70-90% for JSON responses.
//SSE streams are excluded because compressing a live event stream breaks the clients.
app.use(compression({
  filter: (req, res) => {
    //Don't compress SSE streams or already-compressed responses
    if (req.headers['accept']?.includes('text/event-stream')) return false
    return compression.filter(req, res)
  },
  level: 6, // Balanced compression (1-9, higher = more CPU)
  threshold: 1024, // Only compress responses > 1KB
}))

//HTTP Cache-Control headers for API responses
//Cacheable read-only endpoints get short-lived caches; mutating routes stay private
app.use('/api', (req, res, next) => {
  if (req.method !== 'GET') {
    res.setHeader('Cache-Control', 'no-store')
    return next()
  }
  //Short-lived cache for semi-static config/reference data (5 min public, 10 min stale)
  const cacheablePrefixes = ['/api/config', '/api/docs', '/api/openapi']
  if (cacheablePrefixes.some(p => req.originalUrl.startsWith(p))) {
    res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=600')
  } else if (req.originalUrl.startsWith('/api/health')) {
    res.setHeader('Cache-Control', 'no-cache')
  } else {
    //Private, short TTL for authenticated data (revalidate every 30s)
    res.setHeader('Cache-Control', 'private, no-cache, max-age=0, must-revalidate')
  }
  next()
})

//Request prioritization (QoS) - emergency/distress requests get priority
app.use(qosMiddleware)

//Adaptive rate limiting - adjusts limits based on system load (CPU, memory, DB pool)
app.use(adaptiveRateLimitMiddleware)

//Feature flags - injects feature evaluation into request context
app.use(featureFlagMiddleware)

//Connection tracking for graceful shutdown
app.use((req, res, next) => {
  trackConnectionStart()
  res.on('finish', trackConnectionEnd)
  res.on('close', trackConnectionEnd)
  next()
})

//Request timeout protection - prevents hanging requests from exhausting resources
app.use(requestTimeoutMiddleware)

app.use(cors({
  origin: (origin, callback) => {
    const extraOrigins = process.env.CORS_ORIGINS
      ? process.env.CORS_ORIGINS.split(',').map(o => o.trim()).filter(Boolean)
      : []
    const allowed = [
      'http://localhost:5173', 'http://localhost:5174', 'http://localhost:5175',
      'http://localhost:3000', 'http://localhost:3010', 'http://localhost:3011',
      'http://127.0.0.1:5173', 'http://127.0.0.1:5174', 'http://127.0.0.1:3010',
      process.env.CLIENT_URL,
      ...extraOrigins,
    ].filter(Boolean)
    if (!origin || allowed.includes(origin)) {
      callback(null, true)
    } else if (process.env.NODE_ENV !== 'production') {
      callback(null, true)
    } else {
      callback(new Error(`CORS: origin '${origin}' not allowed`))
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token'],
}))

app.use(express.json({ limit: '500kb' }))
app.use(express.urlencoded({ extended: true, limit: '100kb' }))
app.use(cookieParser())

app.use(hpp({
  whitelist: ['type', 'status', 'severity', 'category'],
}))

app.use(rateLimit({
  windowMs: 60 * 1000,
  max: 2000,
  message: { error: 'Too many requests. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path === '/metrics' || req.path.startsWith('/api/map-tiles/'),
}))

app.use(slowDown({
  windowMs: 60 * 1000,
  delayAfter: 1000,
  delayMs: (hits) => (hits - 1000) * 50,
  skip: (req) => req.path === '/metrics' || req.path.startsWith('/api/map-tiles/'),
}))

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: 'Too many login attempts. Please try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
})

//X-Request-ID - generates or forwards a correlation ID for every request.
//Must be registered BEFORE the request logger so log lines include the ID.
//Must also be before route handlers so they can read req.id for tracing.
app.use(requestIdMiddleware)

//Prometheus metrics middleware - records request duration/count for all routes.
//Must come after requestIdMiddleware so per-request labels are available.
app.use(metricsMiddleware)

//Idempotency key support - prevents duplicate operations on retried POST/PUT requests.
//Clients include `Idempotency-Key: <uuid>` header; the server caches the first response
//for that key and replays it on retries instead of re-executing the handler.
//Critical for payment-like flows (distress beacon creation, report submission).
app.use(idempotencyMiddleware())

//CSRF protection: double-submit cookie pattern.
//On first request, we plant a random token in a readable cookie (aegis_csrf).
//For any state-changing request (POST/PUT/DELETE/PATCH) the client must echo
//that same value back in the X-CSRF-Token header.
//If the values don't match, the request is rejected with 403.
//Exempt paths: internal webhooks (n8n, Telegram) that use signed payloads instead.
//Learn more: https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html
app.use((req, res, next) => {
  if (!req.cookies?.aegis_csrf) {
    const csrfToken = cryptoNode.randomBytes(32).toString('hex')
    res.cookie('aegis_csrf', csrfToken, {
      httpOnly: false,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 24 * 60 * 60 * 1000,
      path: '/',
    })
  }

  const safeMethods = ['GET', 'HEAD', 'OPTIONS']
  //Auth endpoints are exempt: login/register have no session to protect, refresh/logout
  //use httpOnly cookies which prevent CSRF by design (JS cannot read them to forge requests).
  // /api/security/passkeys/ is exempt because WebAuthn uses its own cryptographic challenge
  //binding (clientDataJSON origin check) which provides equivalent CSRF protection.
  const csrfExemptPaths = ['/api/internal/', '/api/telegram/', '/api/map-tiles/', '/api/auth/', '/api/citizen-auth/', '/api/spatial/', '/api/chat', '/api/notifications/', '/api/voice/', '/api/translate', '/api/security/']

  if (safeMethods.includes(req.method) || csrfExemptPaths.some(p => req.path.startsWith(p))) {
    return next()
  }

  //For state-changing requests, verify the CSRF token
  const cookieToken = req.cookies?.aegis_csrf
  const headerToken = req.headers['x-csrf-token']

  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    res.status(403).json({
      error: 'Security token mismatch. Your session may have expired -- please refresh the page and try again. If the problem persists, clear your browser cookies.',
      code: 'CSRF_INVALID',
    })
    return
  }

  next()
})

app.use(passport.initialize())

app.use(requestLogger())

//Serve uploaded files with basic access control
//Public evidence images are accessible, but add cache headers and prevent directory listing
app.use('/uploads', (req, res, next) => {
  //Block directory traversal attempts
  if (req.path.includes('..') || req.path.includes('\0')) {
    return res.status(400).json({ error: 'Invalid path' })
  }
  //Set security headers for served files
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Content-Disposition', 'inline')
  next()
}, express.static(path.join(process.cwd(), 'uploads'), {
  dotfiles: 'deny',
  index: false, // Prevent directory listing
  maxAge: '1d', // Cache successful responses only
}), express.static(path.join(process.cwd(), 'uploads', 'evidence'), {
  //Fallback: serve evidence/ files for legacy URLs that omit the /evidence/ path segment
  dotfiles: 'deny',
  index: false,
  maxAge: '1d',
}))

/* --- API Routes -------------------------------------------------------------
 * Each route module is a self-contained Express Router.
 * The route file handles HTTP wiring; actual business logic lives in services/.
 * --------------------------------------------------------------------------- */

//Prometheus metrics endpoint (not behind auth - scraped by Prometheus internally)
app.get('/metrics', metricsHandler)
//Kubernetes health probes
app.get('/healthz', livenessHandler)         // Liveness probe - is process alive?
app.get('/readyz', readinessHandler)         // Readiness probe - ready for traffic?
app.get('/startupz', startupHandler)         // Startup probe - initialization complete?
app.get('/api/health/full', healthHandler)   // Full health with component details

//Internal introspection endpoints (admin only)
app.get('/api/internal/circuits', authMiddleware as any, requireRole('admin') as any, async (_req, res) => {
  res.json({ success: true, circuits: getCircuitStatus() })
})

app.get('/api/internal/qos', authMiddleware as any, requireRole('admin') as any, async (_req, res) => {
  res.json({ success: true, qos: getQosStats() })
})

app.get('/api/internal/rate-limits', authMiddleware as any, requireRole('admin') as any, async (_req, res) => {
  res.json({ success: true, rateLimits: getRateLimitStats() })
})

app.get('/api/internal/self-healing', authMiddleware as any, requireRole('admin') as any, async (_req, res) => {
  res.json({ success: true, selfHealing: getHealthStatus() })
})

app.get('/api/internal/feature-flags', authMiddleware as any, requireRole('admin') as any, async (_req, res) => {
  res.json({ success: true, featureFlags: getFlagStats() })
})

app.get('/api/internal/idempotency', authMiddleware as any, requireRole('admin') as any, async (_req, res) => {
  res.json({ success: true, idempotency: getIdempotencyStats() })
})

app.get('/api/internal/bulkheads', authMiddleware as any, requireRole('admin') as any, async (_req, res) => {
  res.json({ success: true, bulkheads: getBulkheadStatus() })
})

app.get('/api/internal/api-gateway', authMiddleware as any, requireRole('admin') as any, async (_req, res) => {
  res.json({ success: true, apiGateway: getGatewayStats() })
})

app.get('/api/internal/coalescing', authMiddleware as any, requireRole('admin') as any, async (_req, res) => {
  res.json({ success: true, coalescing: getCoalescingStats() })
})

app.get('/api/internal/streaming', authMiddleware as any, requireRole('admin') as any, async (_req, res) => {
  res.json({ success: true, streaming: eventStreaming.getEventStreamingStats() })
})

app.get('/api/internal/openapi-stats', authMiddleware as any, requireRole('admin') as any, async (_req, res) => {
  res.json({ success: true, openapi: openApiGenerator.getOpenAPIStats() })
})

//OpenAPI 3.1 Documentation (public access)
app.use('/api/openapi', openApiGenerator.createOpenAPIRouter())

app.use('/api/auth/login', loginLimiter) // Brute-force protection for login
app.use('/api/citizen-auth/login', loginLimiter) // Brute-force protection for citizen login
app.use('/api/auth', authRoutes) // Authentication
app.use('/api/auth/2fa', twoFactorRoutes) // TOTP Two-Factor Authentication
app.use('/api/auth/mfa', adaptiveMFARoutes) // Adaptive MFA step-up (NIST SP 800-63B)
app.use('/api/security', securityRoutes) // Device Trust, Security Dashboard, Alert Preferences
app.use('/api/auth', oauthRoutes) // OAuth social login (Google etc.)
app.use('/api/auth', githubOAuthRoutes) // GitHub OAuth social login
app.use('/api/auth/magic-link', magicLinkRoutes) // Magic Link passwordless email login
app.use('/api/auth/qr', emergencyQRAuthRoutes) // Emergency QR code quick-auth
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
app.use('/api/helplines', helplinesRoutes) // Mental health & crisis helpline directory (findahelpline.com)

//Sentry error handler - must be after all routes and before other error handlers
if (process.env.SENTRY_DSN) {
  Sentry.setupExpressErrorHandler(app)
}

//Centralised error handler - formats all errors into { success, error: { code, message } }
app.use(errorHandler)

//Deep health check endpoint
//Checks all critical dependencies - used by Kubernetes readiness/liveness probes.
app.get('/api/health', async (_req, res) => {
  const checks: Record<string, string> = {}
  let overallOk = true

  //1. Database
  try {
    await pool.query('SELECT 1')
    checks.database = 'ok'
  } catch (err: any) {
    checks.database = `error: ${err.message}`
    overallOk = false
  }

  //2. AI engine (non-blocking - degraded, not down, if unreachable)
  const aiEngineUrl = process.env.AI_ENGINE_URL || 'http://localhost:8000'
  try {
    const aiRes = await fetch(`${aiEngineUrl}/health`, {
      signal: AbortSignal.timeout(3000),
    })
    checks.aiEngine = aiRes.ok ? 'ok' : `degraded (${aiRes.status})`
  } catch {
    checks.aiEngine = 'unreachable'
    //AI engine being down does not make the Node server unhealthy
  }

  //3. Connection pool stats
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

//Detailed Health Endpoint (authenticated, admin/operator only)
//Exposes operational diagnostics - never expose secrets or raw credentials.
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

  //One-time fix: avatar URLs were incorrectly saved as /uploads/<file> instead
  //of /uploads/avatars/<file>. This corrects any existing rows in the database.
  ;(async () => {
    try {
      const res = await pool.query(`
        UPDATE citizens
           SET avatar_url = '/uploads/avatars/' || regexp_replace(avatar_url, '^/uploads/', '')
         WHERE avatar_url IS NOT NULL
           AND avatar_url LIKE '/uploads/%'
           AND avatar_url NOT LIKE '/uploads/avatars/%'
      `)
      const opRes = await pool.query(`
        UPDATE operators
           SET avatar_url = '/uploads/avatars/' || regexp_replace(avatar_url, '^/uploads/', '')
         WHERE avatar_url IS NOT NULL
           AND avatar_url LIKE '/uploads/%'
           AND avatar_url NOT LIKE '/uploads/avatars/%'
      `)
      if ((res.rowCount ?? 0) + (opRes.rowCount ?? 0) > 0) {
        console.log(` [startup] Repaired ${(res.rowCount ?? 0) + (opRes.rowCount ?? 0)} broken avatar URL(s)`)
      }
    } catch { /* non-fatal -- operators table may not have avatar_url */ }
  })()

  //Start background cron jobs (SEPA river ingestion, cleanup, scheduled reports, etc.)
  //See server/src/services/cronJobs.ts for what runs and on what schedule.
  startCronJobs()

  //Start n8n health monitoring. If n8n is unreachable, falls back to built-in cron logic.
  startN8nHealthMonitor()

  //Pre-warm the primary Ollama/LLM model so the first real chat request isn't slow.
  //Errors here are non-fatal; chat still works, just with a cold-start delay.
  startModelWarmup().catch(() => {})

  //Sync DB pool & WebSocket metrics to Prometheus every 5 seconds.
  //5s is a good balance: coarse enough not to hammer the pool stats, fine enough
  //to catch sudden connection spikes before the next Prometheus scrape window.
  setInterval(() => {
    collectDBPoolMetrics(pool)
    updatePoolMetrics(pool)
    activeWebsocketConnections.set(io.engine.clientsCount)
    //Refresh trusted device count -- cheap aggregation query on the shared pool interval
    pool.query('SELECT COUNT(*) AS cnt FROM trusted_devices WHERE revoked = false AND expires_at > NOW()')
      .then((r: any) => trustedDevicesGauge.set(parseInt(r.rows[0]?.cnt || '0')))
      .catch(() => {})
  }, 5000)
})

//Graceful shutdown is handled by the zeroDowntime service (connection draining,
//shutdown hooks, health transitions). Signal handlers are registered by initZeroDowntime().
//Learn more: server/src/services/zeroDowntime.ts

//Register custom shutdown hooks in priority order (highest number = runs first).
//Each hook gets a chance to clean up its own resources before the process exits.
registerShutdownHook('cron-jobs', async () => {
  console.log('[Shutdown] Stopping cron jobs...')
}, 100)  // priority 100 -- stop cron before sockets so no new work starts

registerShutdownHook('socket-connections', async () => {
  console.log('[Shutdown] Closing WebSocket connections...')
  io.close()
}, 90)  // priority 90 -- drain WebSocket clients before the HTTP server stops

registerShutdownHook('llm-warmup', async () => {
  console.log('[Shutdown] LLM warmup cleanup...')
  //Note: LLM cleanup would go here if needed
}, 50)
