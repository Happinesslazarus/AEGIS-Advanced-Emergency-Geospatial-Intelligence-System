/*
 * index.ts - AEGIS Express server entry point
 *
 * This is the main server file that:
 *   1. Loads environment configuration from .env
 *   2. Sets up security middleware (CORS, Helmet, rate limiting)
 *   3. Mounts all API route handlers
 *   4. Serves uploaded files statically
 *   5. Starts the HTTP server
 *
 * The server provides a REST API consumed by the React frontend.
 * All routes are prefixed with /api/ and return JSON responses.
 *
 * In production, the built React app would be served from the same
 * Express server. During development, Vite runs separately on port 5173
 * and proxies API calls to this server on port 3001.
 */

import express from 'express'
import { createServer } from 'http'
import cors from 'cors'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import cookieParser from 'cookie-parser'
import path from 'path'
import fs from 'fs'
import dotenv from 'dotenv'

// Load environment variables — try multiple .env locations for robustness
const envCandidates = [
  path.resolve('.env'),                          // CWD (when run from server/)
  path.resolve('server', '.env'),                // CWD is project root
  path.resolve('aegis-v6', 'server', '.env'),    // CWD is workspace root
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

// ═══════════════════════════════════════════════════════════════
// STRICT STARTUP VALIDATION — refuse to boot if critical config missing
// ═══════════════════════════════════════════════════════════════
function validateStartupConfig(): void {
  const errors: string[] = []

  // DATABASE_URL is mandatory
  if (!process.env.DATABASE_URL) {
    errors.push('DATABASE_URL is not set. PostgreSQL connection required.')
  }

  // At least one LLM provider key required for AI features
  const llmKeys = [
    process.env.GEMINI_API_KEY,
    process.env.GROQ_API_KEY,
    process.env.OPENROUTER_API_KEY,
    process.env.HF_API_KEY,
  ].filter(Boolean)

  if (llmKeys.length === 0) {
    console.warn('\n  ⚠️  WARNING: No LLM API keys configured.')
    console.warn('  Chat and AI analysis features will NOT work.')
    console.warn('  Set at least one: GEMINI_API_KEY, GROQ_API_KEY, OPENROUTER_API_KEY, or HF_API_KEY')
    console.warn('  Get free keys at: https://aistudio.google.com/apikey (Gemini) or https://console.groq.com (Groq)\n')
  } else {
    const providers = []
    if (process.env.GEMINI_API_KEY) providers.push('Gemini')
    if (process.env.GROQ_API_KEY) providers.push('Groq')
    if (process.env.OPENROUTER_API_KEY) providers.push('OpenRouter')
    if (process.env.HF_API_KEY) providers.push('HuggingFace')
    console.log(`\n  ✅ LLM providers configured: ${providers.join(', ')}`)
  }

  // Embedding provider check
  const embKeys = [process.env.HF_API_KEY, process.env.GEMINI_API_KEY].filter(Boolean)
  if (embKeys.length === 0) {
    console.warn('  ⚠️  No embedding API keys. Vector search will use text-only fallback.')
  } else {
    console.log(`  ✅ Embedding providers ready (${embKeys.length} key(s))`)
  }

  // Weather API
  if (!process.env.WEATHER_API_KEY) {
    console.warn('  ⚠️  WEATHER_API_KEY not set. OpenWeatherMap features will use Open-Meteo (free, no key).')
  }

  // AI Engine
  if (!process.env.AI_ENGINE_URL) {
    console.warn('  ⚠️  AI_ENGINE_URL not set. Defaulting to http://localhost:8000')
  }

  if (errors.length > 0) {
    console.error('\n  ❌ FATAL CONFIGURATION ERRORS:')
    errors.forEach(e => console.error(`     • ${e}`))
    console.error('')
    process.exit(1)
  }
}

validateStartupConfig()

import authRoutes from './routes/authRoutes.js'
import citizenAuthRoutes from './routes/citizenAuthRoutes.js'
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
import translationRoutes from './routes/translationRoutes.js'
import spatialRoutes from './routes/spatialRoutes.js'
import oauthRoutes from './routes/oauthRoutes.js'
import incidentRoutes from './routes/incidentRoutes.js'
import pool from './models/db.js'
import { initSocketServer } from './services/socket.js'
import { requestLogger } from './services/logger.js'
import { startCronJobs } from './services/cronJobs.js'
import { setIOInstance as setRiverIO } from './services/riverLevelService.js'
import { setThreatIO } from './services/threatLevelService.js'
import { startN8nHealthMonitor } from './services/n8nHealthCheck.js'

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

/* Security middleware */
// Helmet sets various HTTP security headers (#80 MIME sniff prevention)
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  contentSecurityPolicy: false, // CSP handled by frontend
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
    } else {
      callback(null, true) // Allow all origins in dev
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

// Initialize Passport (session-less — used only for OAuth redirect flow)
import passport from 'passport'
app.use(passport.initialize())

// Structured request logging (pino)
app.use(requestLogger())

// Serve uploaded files (photos, avatars) as static assets
app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')))

/* API Routes */
app.use('/api/auth/login', loginLimiter)  // Brute-force protection for login
app.use('/api/citizen-auth/login', loginLimiter)  // Brute-force protection for citizen login
app.use('/api/auth', authRoutes)       // Authentication
app.use('/api/auth', oauthRoutes)      // OAuth social login (Google etc.)
app.use('/api/citizen-auth', citizenAuthRoutes)  // Citizen auth
app.use('/api/citizen', citizenRoutes)               // Citizen safety, messaging, dashboard
app.use('/api/reports', reportRoutes)                // Emergency report CRUD
app.use('/api/users', userRoutes)                    // User management (Super Admin only)
app.use('/api', dataRoutes)                          // Alerts, activity, AI metrics, weather
app.use('/api', extendedRoutes)                      // Subscriptions, audit, community, departments
app.use('/api/ai', aiRoutes)                         // AI prediction engine integration
app.use('/api/chat', chatRoutes)                     // LLM chatbot with RAG
app.use('/api/community', communityRoutes)            // Community posts, comments, likes
app.use('/api/admin/community', adminCommunityRoutes)
app.use('/api/rivers', riverRoutes)                   // Live river level monitoring
app.use('/api', floodRoutes)                              // Flood prediction, evacuation, threat
app.use('/api/distress', distressRoutes)                   // SOS / distress beacon
app.use('/api', uploadRoutes)                         // Image/file uploads
app.use('/api/config', configRoutes)                  // Region, hazard, shelter config
app.use('/api/docs', docsRoutes)                      // Swagger API documentation
app.use('/api/internal', internalRoutes)              // n8n ws-bridge, error log, system health
app.use('/api/translate', translationRoutes)           // Translation service (MyMemory / LibreTranslate)
app.use('/api/spatial', spatialRoutes)                  // PostGIS spatial analysis tools
app.use('/api/v1/incidents', incidentRoutes)            // Multi-incident plugin system (v1 API)

// Health check endpoint for monitoring
app.get('/api/health', async (_req, res) => {
  try {
    const dbResult = await pool.query('SELECT 1 as ok')
    res.json({ status: 'ok', database: 'connected', timestamp: new Date().toISOString(), version: '6.9.0' })
  } catch (err: any) {
    res.status(503).json({
      status: 'error',
      database: 'disconnected',
      error: err.message,
      hint: 'Check your DATABASE_URL in server/.env. Make sure PostgreSQL is running and the aegis database exists.',
    })
  }
})

/* Start server */
httpServer.listen(PORT, () => {
  console.log(`\n  AEGIS Server v6.9 running on http://localhost:${PORT}`)
  console.log(`  API endpoints: http://localhost:${PORT}/api/`)
  console.log(`  Socket.IO:     ws://localhost:${PORT}`)
  console.log(`  Health check:  http://localhost:${PORT}/api/health`)
  console.log(`  Uploads:       http://localhost:${PORT}/uploads/`)
  console.log(`  Chat API:      http://localhost:${PORT}/api/chat`)
  console.log(`  Config API:    http://localhost:${PORT}/api/config\n`)

  // Start background cron jobs (SEPA ingestion, cache cleanup, etc.)
  startCronJobs()

  // Start n8n health monitoring (activates fallback cron if n8n is unreachable)
  startN8nHealthMonitor()
})
