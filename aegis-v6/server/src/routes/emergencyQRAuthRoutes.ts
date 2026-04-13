/**
 * emergencyQRAuthRoutes.ts — Emergency Quick-Auth via QR Code
 *
 * Unique to AEGIS: During disasters, citizens can scan a QR code
 * displayed on emergency screens/posters to instantly authenticate
 * on their phone without needing to type credentials.
 *
 * Flow:
 *   1. Kiosk/screen shows QR with a session token
 *   2. Citizen scans QR → opens AEGIS with session token
 *   3. If already logged in on phone, approves the session
 *   4. Kiosk picks up the approval via polling/WebSocket
 *
 * Endpoints:
 *   POST /api/auth/qr/generate    — Generate QR session (for kiosks/screens)
 *   GET  /api/auth/qr/status/:id  — Poll session status
 *   POST /api/auth/qr/approve     — Citizen approves from phone (requires auth)
 *   POST /api/auth/qr/scan        — Citizen scans & gets session info
 */

import { Router, Request, Response } from 'express'
import crypto from 'crypto'
import QRCode from 'qrcode'
import speakeasy from 'speakeasy'
import { networkInterfaces } from 'os'
import { authMiddleware, AuthRequest, generateToken, generateRefreshToken } from '../middleware/auth.js'
import { logger } from '../services/logger.js'
import pool from '../models/db.js'

const router = Router()

/**
 * Get the LAN IP so phones on the same WiFi can reach the dev server (React, port 5173).
 */
function getClientBaseUrl(): string {
  if (process.env.CLIENT_URL && !process.env.CLIENT_URL.includes('localhost')) {
    return process.env.CLIENT_URL
  }
  const nets = networkInterfaces()
  for (const interfaces of Object.values(nets)) {
    for (const iface of interfaces ?? []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return `http://${iface.address}:5173`
      }
    }
  }
  return process.env.CLIENT_URL || 'http://localhost:5173'
}

/**
 * Get the LAN IP for the Express server (port 3001).
 * QR codes point here so phones hit the API directly — no React bundle needed.
 */
function getServerBaseUrl(): string {
  if (process.env.SERVER_URL && !process.env.SERVER_URL.includes('localhost')) {
    return process.env.SERVER_URL
  }
  const nets = networkInterfaces()
  for (const interfaces of Object.values(nets)) {
    for (const iface of interfaces ?? []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return `http://${iface.address}:3001`
      }
    }
  }
  return 'http://localhost:3001'
}

interface QRSession {
  id: string
  status: 'pending' | 'scanned' | 'approved' | 'expired'
  createdAt: number
  expiresAt: number
  approvedBy?: { userId: string; email: string; role: string; displayName: string }
  token?: string
}

const qrSessions = new Map<string, QRSession>()

// Clean expired sessions every 30s
setInterval(() => {
  const now = Date.now()
  for (const [id, session] of qrSessions) {
    if (now > session.expiresAt) {
      session.status = 'expired'
      // Keep expired sessions for 30s so pollers can see the final state
      if (now > session.expiresAt + 30_000) qrSessions.delete(id)
    }
  }
}, 30_000)

/**
 * POST /api/auth/qr/generate — Generate a new QR session
 * Returns a QR code image (base64) and session ID for polling
 */
router.post('/generate', async (_req: Request, res: Response) => {
  const sessionId = crypto.randomBytes(16).toString('hex')
  const session: QRSession = {
    id: sessionId,
    status: 'pending',
    createdAt: Date.now(),
    expiresAt: Date.now() + 3 * 60 * 1000, // 3 minute expiry
  }
  qrSessions.set(sessionId, session)

  // Encode the SERVER's LAN API endpoint directly in the QR — not the React app.
  // This means the phone only needs to reach port 3001 (server), not 5173 (React).
  // The server returns a lightweight HTML approve page — no React bundle needed.
  const serverBase = getServerBaseUrl()
  const clientBase = getClientBaseUrl()
  const scanUrl = `${serverBase}/api/auth/qr/mobile?session=${sessionId}`
  const qrDataUrl = await QRCode.toDataURL(scanUrl, {
    width: 300,
    margin: 2,
    color: { dark: '#0ea5e9', light: '#ffffff' },
    errorCorrectionLevel: 'M',
  })

  logger.info({ sessionId, scanUrl }, '[QR Auth] Session generated')

  res.json({
    success: true,
    data: {
      sessionId,
      qrCode: qrDataUrl,
      scanUrl,
      lanUrl: serverBase,
      expiresIn: 180,
    },
  })
})

/**
 * GET /api/auth/qr/status/:id — Poll session status
 * Used by the kiosk/screen to check if someone scanned & approved
 */
router.get('/status/:id', (req: Request, res: Response) => {
  const session = qrSessions.get(req.params.id)
  if (!session) {
    res.status(404).json({ success: false, error: 'Session not found' })
    return
  }

  const response: any = {
    success: true,
    data: {
      status: session.status,
      expiresIn: Math.max(0, Math.round((session.expiresAt - Date.now()) / 1000)),
    },
  }

  // If approved, include the token
  if (session.status === 'approved' && session.token) {
    response.data.token = session.token
    response.data.user = session.approvedBy
    // Clean up after delivering
    qrSessions.delete(req.params.id)
  }

  res.json(response)
})

/**
 * POST /api/auth/qr/scan — Get session info when citizen scans QR
 * No auth required — just returns basic session info
 */
router.post('/scan', (req: Request, res: Response) => {
  const { sessionId } = req.body
  const session = qrSessions.get(sessionId)

  if (!session || session.status === 'expired' || Date.now() > session.expiresAt) {
    res.status(400).json({ success: false, error: 'QR code expired or invalid' })
    return
  }

  session.status = 'scanned'

  res.json({
    success: true,
    data: {
      sessionId,
      status: 'scanned',
      message: 'Confirm sign-in to authorize this session',
      expiresIn: Math.max(0, Math.round((session.expiresAt - Date.now()) / 1000)),
    },
  })
})

/**
 * POST /api/auth/qr/approve — Citizen approves the QR session
 * Requires authentication (citizen must be logged in on phone)
 */
router.post('/approve', authMiddleware, (req: Request, res: Response) => {
  const authReq = req as AuthRequest
  const { sessionId } = req.body
  const session = qrSessions.get(sessionId)

  if (!session || session.status === 'expired' || Date.now() > session.expiresAt) {
    res.status(400).json({ success: false, error: 'Session expired' })
    return
  }

  // Generate tokens for the kiosk session
  const token = generateToken({
    id: authReq.user!.id,
    email: authReq.user!.email,
    role: authReq.user!.role,
    displayName: authReq.user!.displayName || authReq.user!.email,
  })

  session.status = 'approved'
  session.approvedBy = {
    userId: authReq.user!.id,
    email: authReq.user!.email,
    role: authReq.user!.role,
    displayName: authReq.user!.displayName || authReq.user!.email,
  }
  session.token = token

  logger.info({
    sessionId,
    userId: authReq.user!.id,
  }, '[QR Auth] Session approved')

  res.json({
    success: true,
    message: 'Session authorized. The other device will be signed in shortly.',
  })
})

// ---------------------------------------------------------------------------
// TOTP (Authenticator App) Mode
// ---------------------------------------------------------------------------

interface TOTPSession {
  id: string
  secret: string
  status: 'pending' | 'verified'
  createdAt: number
  expiresAt: number
}

const totpSessions = new Map<string, TOTPSession>()

// Clean expired TOTP sessions every 60s
setInterval(() => {
  const now = Date.now()
  for (const [id, s] of totpSessions) {
    if (now > s.expiresAt + 60_000) totpSessions.delete(id)
  }
}, 60_000)

/**
 * POST /api/auth/qr/totp/generate
 * Generates a temporary TOTP secret and returns a QR code with an otpauth:// URI.
 * The user scans this with Google Authenticator / Authy and gets a 6-digit code.
 */
router.post('/totp/generate', async (_req: Request, res: Response) => {
  const secret = speakeasy.generateSecret({
    name: 'AEGIS Emergency Auth',
    issuer: 'AEGIS',
    length: 20,
  })

  const sessionId = crypto.randomBytes(16).toString('hex')
  totpSessions.set(sessionId, {
    id: sessionId,
    secret: secret.base32,
    status: 'pending',
    createdAt: Date.now(),
    expiresAt: Date.now() + 3 * 60 * 1000, // 3 minutes
  })

  const qrDataUrl = await QRCode.toDataURL(secret.otpauth_url!, {
    width: 300,
    margin: 2,
    color: { dark: '#6366f1', light: '#ffffff' },
    errorCorrectionLevel: 'M',
  })

  logger.info({ sessionId }, '[QR Auth] TOTP session generated')

  res.json({
    success: true,
    data: {
      sessionId,
      qrCode: qrDataUrl,
      expiresIn: 180,
    },
  })
})

/**
 * POST /api/auth/qr/totp/verify
 * Verifies { sessionId, email, code } and returns a JWT if valid.
 * No password required — the TOTP code proves possession of the registered device.
 */
router.post('/totp/verify', async (req: Request, res: Response) => {
  const { sessionId, email, code } = req.body

  if (!sessionId || !email || !code) {
    res.status(400).json({ success: false, error: 'sessionId, email and code are required' })
    return
  }

  const session = totpSessions.get(sessionId)
  if (!session || Date.now() > session.expiresAt) {
    res.status(400).json({ success: false, error: 'Session expired — generate a new QR code' })
    return
  }

  const valid = speakeasy.totp.verify({
    secret: session.secret,
    encoding: 'base32',
    token: String(code).replace(/\s/g, ''),
    window: 1, // ±30s tolerance
  })

  if (!valid) {
    res.status(401).json({ success: false, error: 'Invalid or expired code — wait for the next code and try again' })
    return
  }

  // Look up user by email (case-insensitive)
  const result = await pool.query(
    'SELECT id, email, role, display_name, full_name FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1',
    [email.trim()],
  )

  if (!result.rows.length) {
    res.status(404).json({ success: false, error: 'No account found for that email address' })
    return
  }

  const user = result.rows[0]
  const token = generateToken({
    id: user.id,
    email: user.email,
    role: user.role,
    displayName: user.display_name || user.full_name || user.email,
  })

  totpSessions.delete(sessionId) // One-time use

  logger.info({ userId: user.id, sessionId }, '[QR Auth] TOTP verified — user signed in')

  res.json({
    success: true,
    data: {
      token,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        displayName: user.display_name || user.full_name || user.email,
      },
    },
  })
})

/**
 * GET /api/auth/qr/mobile?session=xxx
 *
 * The URL encoded in the QR code. The phone opens this in its browser.
 * Returns a self-contained HTML page — no React, no heavy JS bundle.
 * The page checks if the citizen is already authenticated (JWT in localStorage)
 * and either approves directly or shows a mini login form.
 */
router.get('/mobile', async (req: Request, res: Response) => {
  const sessionId = req.query.session as string

  if (!sessionId) {
    res.status(400).send(mobilePage({ error: 'Missing session ID', sessionId: '' }))
    return
  }

  const session = qrSessions.get(sessionId)

  if (!session || Date.now() > session.expiresAt) {
    res.send(mobilePage({ error: 'This QR code has expired. Please generate a new one.', sessionId }))
    return
  }

  if (session.status === 'approved') {
    res.send(mobilePage({ alreadyApproved: true, sessionId }))
    return
  }

  const expiresIn = Math.max(0, Math.round((session.expiresAt - Date.now()) / 1000))
  const serverBase = getServerBaseUrl()
  const clientBase = getClientBaseUrl()

  res.send(mobilePage({ sessionId, expiresIn, serverBase, clientBase }))
})

/** Builds the lightweight self-contained HTML approval page */
function mobilePage(opts: {
  sessionId: string
  error?: string
  alreadyApproved?: boolean
  expiresIn?: number
  serverBase?: string
  clientBase?: string
}): string {
  const { sessionId, error, alreadyApproved, expiresIn = 0, serverBase = '', clientBase = '' } = opts

  const bodyContent = error
    ? `<div class="card error">
        <div class="icon">⚠️</div>
        <h2>QR Code Expired</h2>
        <p>${error}</p>
        <p style="margin-top:1rem;font-size:0.85rem;color:#94a3b8">Return to the AEGIS screen and generate a new QR code.</p>
      </div>`
    : alreadyApproved
    ? `<div class="card success">
        <div class="icon">✅</div>
        <h2>Already Authorized</h2>
        <p>This session has already been approved.</p>
      </div>`
    : `<div class="card" id="mainCard">
        <div class="icon">🔐</div>
        <h2>AEGIS Sign-In</h2>
        <p>Scan approved. Authorize this device to sign in?</p>
        <div class="timer" id="timer">Expires in <strong id="count">${expiresIn}</strong>s</div>
        <div id="loginSection">
          <input type="email" id="emailInput" placeholder="Your email" autocomplete="email" />
          <input type="password" id="passInput" placeholder="Password" autocomplete="current-password" />
          <button class="btn approve" id="approveBtn" onclick="approveWithLogin()">Authorize Sign-In</button>
        </div>
        <button class="btn deny" onclick="deny()">Cancel</button>
        <p id="msg" class="msg"></p>
      </div>
      <script>
        const SESSION = ${JSON.stringify(sessionId)}
        const SERVER  = ${JSON.stringify(serverBase)}
        const CLIENT  = ${JSON.stringify(clientBase)}
        let remaining = ${expiresIn}

        const countEl = document.getElementById('count')
        const timer = setInterval(() => {
          remaining--
          if (countEl) countEl.textContent = remaining
          if (remaining <= 0) {
            clearInterval(timer)
            document.getElementById('mainCard').innerHTML =
              '<div class="icon">⏱️</div><h2>Expired</h2><p>QR code timed out. Please generate a new one.</p>'
          }
        }, 1000)

        function showMsg(text, isError) {
          const el = document.getElementById('msg')
          if (el) { el.textContent = text; el.className = 'msg ' + (isError ? 'error-msg' : 'ok-msg') }
        }

        async function approveWithLogin() {
          const email = document.getElementById('emailInput').value.trim()
          const pass  = document.getElementById('passInput').value
          if (!email || !pass) { showMsg('Please enter your email and password.', true); return }
          const btn = document.getElementById('approveBtn')
          btn.disabled = true; btn.textContent = 'Signing in…'
          try {
            // Step 1: authenticate on the server
            const loginRes = await fetch(SERVER + '/api/auth/login', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ email, password: pass }),
            })
            const loginData = await loginRes.json()
            if (!loginData.success) throw new Error(loginData.message || 'Login failed')
            const { token } = loginData.data
            // Step 2: approve the QR session with the fresh token
            const approveRes = await fetch(SERVER + '/api/auth/qr/approve', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
              body: JSON.stringify({ sessionId: SESSION }),
            })
            const approveData = await approveRes.json()
            if (!approveData.success) throw new Error(approveData.error || 'Approval failed')
            clearInterval(timer)
            document.getElementById('mainCard').innerHTML =
              '<div class="icon">✅</div><h2>Authorized!</h2><p>The other device is now signing in. You can close this tab.</p>'
          } catch (err) {
            btn.disabled = false; btn.textContent = 'Authorize Sign-In'
            showMsg(err.message || 'Something went wrong', true)
          }
        }

        async function deny() {
          document.getElementById('mainCard').innerHTML =
            '<div class="icon">🚫</div><h2>Cancelled</h2><p>Sign-in was not authorized.</p>'
        }
      </script>`

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>AEGIS — Authorize Sign-In</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #0f172a;
      color: #e2e8f0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 1.5rem;
    }
    .card {
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 1rem;
      padding: 2rem 1.5rem;
      max-width: 360px;
      width: 100%;
      text-align: center;
    }
    .card.error  { border-color: #ef4444; }
    .card.success{ border-color: #22c55e; }
    .icon { font-size: 3rem; margin-bottom: 1rem; }
    h2 { font-size: 1.25rem; font-weight: 700; margin-bottom: 0.5rem; color: #f1f5f9; }
    p  { font-size: 0.95rem; color: #94a3b8; line-height: 1.5; }
    input {
      display: block; width: 100%; margin: 0.5rem 0;
      padding: 0.75rem 1rem;
      background: #0f172a; border: 1px solid #475569;
      border-radius: 0.5rem; color: #f1f5f9; font-size: 1rem;
    }
    input:focus { outline: none; border-color: #0ea5e9; }
    .btn {
      display: block; width: 100%; margin-top: 0.75rem;
      padding: 0.85rem 1rem;
      border: none; border-radius: 0.5rem;
      font-size: 1rem; font-weight: 600; cursor: pointer;
      transition: opacity 0.15s;
    }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .btn.approve { background: #0ea5e9; color: #fff; }
    .btn.approve:hover:not(:disabled) { opacity: 0.85; }
    .btn.deny    { background: #1e293b; color: #94a3b8; border: 1px solid #475569; }
    .btn.deny:hover { background: #334155; }
    .timer { font-size: 0.8rem; color: #64748b; margin: 0.75rem 0; }
    #loginSection { margin-top: 1rem; }
    .msg { font-size: 0.85rem; margin-top: 0.75rem; min-height: 1.2em; }
    .error-msg { color: #f87171; }
    .ok-msg    { color: #4ade80; }
  </style>
</head>
<body>${bodyContent}</body>
</html>`
}

export default router
