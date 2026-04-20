/**
 * HTTP routes for AEGIS Adaptive MFA step-up authentication.
 * Implements NIST SP 800-63B Authenticator Assurance Levels (AAL1-AAL3).
 *
 * - Mounted at /api/auth/mfa in index.ts
 * - Uses adaptiveMFAService for all business logic
 * - Clients call /check before a sensitive operation, then /challenge + /verify
 *   to complete step-up and have their session AAL elevated
 *
 * Endpoints:
 * - POST /api/auth/mfa/check      -- is step-up required for this resource?
 * - POST /api/auth/mfa/challenge  -- issue a step-up challenge
 * - POST /api/auth/mfa/verify     -- verify the challenge response
 * - GET  /api/auth/mfa/history    -- user's step-up history
 * - GET  /api/auth/mfa/stats      -- admin: platform-wide stats
 * */

import { Router, Request, Response } from 'express'
import { authMiddleware, adminOnly, AuthRequest } from '../middleware/auth.js'
import {
  checkStepUpRequired,
  createStepUpChallenge,
  verifyStepUpChallenge,
  getStepUpHistory,
  getStepUpStats,
  AuthenticatorAssuranceLevel,
  AuthenticationContext,
  MFAMethod,
} from '../services/adaptiveMFAService.js'

const router = Router()

/**
 * Build AuthenticationContext from an incoming request.
 * Falls back gracefully when session / anomaly data are absent (JWT-only flows).
 */
function buildContext(req: AuthRequest): AuthenticationContext {
  const session = (req as any).session
  return {
    userId: req.user!.id,
    sessionId: session?.id || '',
    currentAAL: session?.aal ?? AuthenticatorAssuranceLevel.AAL1,
    ip: req.ip || req.socket.remoteAddress || '0.0.0.0',
    userAgent: req.headers['user-agent'] || '',
    deviceFingerprint: req.headers['x-device-fingerprint'] as string | undefined,
    geoLocation: (req as any).geoLocation,
    riskScore: (req as any).anomalyResult?.riskScore ?? 0,
    isNewDevice: (req as any).anomalyResult?.anomalyTypes?.includes('new_device') ?? false,
    isNewLocation: (req as any).anomalyResult?.anomalyTypes?.includes('new_location') ?? false,
    lastAuthentication: session?.lastAuth ? new Date(session.lastAuth) : null,
    sessionAge: session?.created
      ? (Date.now() - new Date(session.created).getTime()) / 60000
      : 0,
  }
}

/**
 * POST /api/auth/mfa/check
 * Check whether step-up authentication is required before accessing a resource.
 *
 * Body: { resourceId: string, transactionValue?: number }
 * Response: StepUpRequirement
 */
router.post('/check', authMiddleware, async (req: AuthRequest, res: Response): Promise<void> => {
  const { resourceId, transactionValue } = req.body
  if (!resourceId || typeof resourceId !== 'string') {
    res.status(400).json({ success: false, error: 'resourceId (string) is required' })
    return
  }

  const context = buildContext(req)
  const requirement = await checkStepUpRequired(context, resourceId, transactionValue)
  res.json({ success: true, ...requirement })
})

/**
 * POST /api/auth/mfa/challenge
 * Issue a step-up challenge for the requested method and assurance level.
 *
 * Body: { targetAAL: number, method: MFAMethod, resourceId?: string, transactionId?: string }
 * Response: { success, challenge } -- challengeData (OTP) is never returned
 */
router.post('/challenge', authMiddleware, async (req: AuthRequest, res: Response): Promise<void> => {
  const { targetAAL, method, resourceId, transactionId } = req.body

  if (!targetAAL || !method) {
    res.status(400).json({ success: false, error: 'targetAAL and method are required' })
    return
  }

  if (![1, 2, 3].includes(Number(targetAAL))) {
    res.status(400).json({ success: false, error: 'targetAAL must be 1, 2, or 3' })
    return
  }

  const validMethods: MFAMethod[] = [
    'password', 'totp', 'sms_otp', 'email_otp',
    'push_notification', 'passkey', 'hardware_key', 'biometric', 'security_question',
  ]
  if (!validMethods.includes(method as MFAMethod)) {
    res.status(400).json({ success: false, error: `Invalid method. Allowed: ${validMethods.join(', ')}` })
    return
  }

  try {
    const challenge = await createStepUpChallenge(
      req.user!.id,
      Number(targetAAL) as AuthenticatorAssuranceLevel,
      method as MFAMethod,
      resourceId,
      transactionId
    )

    //Strip challengeData (OTP codes must never be returned to the client)
    const { challengeData: _stripped, ...safeChallenge } = challenge
    res.json({ success: true, challenge: safeChallenge })
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message })
  }
})

/**
 * POST /api/auth/mfa/verify
 * Verify a step-up challenge response. On success, elevates session AAL.
 *
 * Body: { challengeId: string, response: string }
 * Response: { success, newAAL?, error? }
 */
router.post('/verify', authMiddleware, async (req: AuthRequest, res: Response): Promise<void> => {
  const { challengeId, response } = req.body

  if (!challengeId || response === undefined || response === null) {
    res.status(400).json({ success: false, error: 'challengeId and response are required' })
    return
  }

  const sessionId = (req as any).session?.id || ''
  const result = await verifyStepUpChallenge(String(challengeId), String(response), sessionId)

  if (result.success && result.newAAL !== undefined) {
    //Elevate the session's assurance level so subsequent requests pass
    const session = (req as any).session
    if (session) {
      session.aal = result.newAAL
      session.lastAuth = new Date().toISOString()
    }
  }

  const status = result.success ? 200 : 401
  res.status(status).json({
    success: result.success,
    ...(result.newAAL !== undefined && { newAAL: result.newAAL }),
    ...(result.error && { error: result.error }),
  })
})

/**
 * GET /api/auth/mfa/history
 * Retrieve the authenticated user's step-up history.
 * Query: ?limit=50 (max 100)
 */
router.get('/history', authMiddleware, async (req: AuthRequest, res: Response): Promise<void> => {
  const rawLimit = parseInt(String(req.query.limit || '50'), 10)
  const limit = Number.isNaN(rawLimit) ? 50 : Math.min(Math.max(rawLimit, 1), 100)
  const history = await getStepUpHistory(req.user!.id, limit)
  res.json({ success: true, history })
})

/**
 * GET /api/auth/mfa/stats
 * Admin: platform-wide step-up authentication statistics.
 */
router.get('/stats', authMiddleware, adminOnly, async (_req: Request, res: Response): Promise<void> => {
  const stats = await getStepUpStats()
  res.json({ success: true, stats })
})

export default router
