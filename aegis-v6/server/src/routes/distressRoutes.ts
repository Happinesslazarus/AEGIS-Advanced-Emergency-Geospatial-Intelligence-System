/**
 * SOS distress beacon system. Citizens can activate an emergency beacon
 * with their GPS location, push live location updates, and cancel when
 * safe. Operators receive real-time alerts and can acknowledge/resolve calls.
 * Vulnerable citizens are flagged so operators prioritise appropriately.
 *
 * - Mounted at /api/distress in server/src/index.ts
 * - One active distress call per citizen enforced (409 if already active)
 * - Real-time location updates broadcast via Socket.IO
 *   (server/src/services/socket.ts emits to the 'admin' room)
 * - Vulnerability status pulled from the citizens table in PostgreSQL
 * - Client activation UI: client/src/pages/CitizenDashboard.tsx -> distress button
 * - Operator view: client/src/pages/AdminPage.tsx -> distress panel
 *
 * POST /api/distress/activate             -- Citizen activates SOS
 * POST /api/distress/location             -- Push a GPS coordinate update
 * POST /api/distress/cancel               -- Citizen cancels their SOS
 * GET  /api/distress/active               -- List all active beacons (operator)
 * POST /api/distress/:id/acknowledge      -- Operator acknowledges a call
 * POST /api/distress/:id/resolve          -- Operator marks call as resolved
 * GET  /api/distress/history              -- Resolved/archived calls (operator)
 *
 * - server/src/services/socket.ts          -- how real-time updates are pushed
 * - server/src/middleware/auth.ts          -- citizenOnly / operatorOnly guards used here
 * */

import { Router, Request, Response } from 'express'
import pool from '../models/db.js'
import { authMiddleware, citizenOnly, operatorOnly, AuthRequest } from '../middleware/auth.js'
import { AppError } from '../utils/AppError.js'

const router = Router()
const operatorRoles = new Set(['admin', 'operator', 'manager'])

//All distress endpoints require authentication
router.use(authMiddleware)

//Citizen: Activate SOS

router.post('/activate', citizenOnly, async (req: AuthRequest, res: Response) => {
    const { latitude, longitude, message, contactNumber } = req.body
    const citizenId = req.user!.id
    const citizenName = req.user!.displayName

    if (latitude == null || longitude == null) {
      throw AppError.badRequest('latitude and longitude are required')
    }

    //Check for existing active distress call from this citizen
    const existing = await pool.query(
      `SELECT id FROM distress_calls WHERE citizen_id = $1 AND status IN ('active', 'acknowledged')`,
      [citizenId]
    )
    if (existing.rows.length > 0) {
      res.status(409).json({
        error: 'You already have an active distress call',
        distressId: existing.rows[0].id })
      return
    }

    //Look up citizen's vulnerability status and phone
    let isVulnerable = false
    let phone = contactNumber || null
    try {
      const citizenInfo = await pool.query(
        'SELECT is_vulnerable, phone FROM citizens WHERE id = $1',
        [citizenId]
      )
      if (citizenInfo.rows[0]) {
        isVulnerable = citizenInfo.rows[0].is_vulnerable || false
        phone = phone || citizenInfo.rows[0].phone
      }
    } catch {}

    const result = await pool.query(
      `INSERT INTO distress_calls (citizen_id, citizen_name, latitude, longitude, message, contact_number, is_vulnerable, status, last_gps_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'active', NOW())
       RETURNING *`,
      [citizenId, citizenName || 'Unknown Citizen', latitude, longitude, message || null, phone, isVulnerable]
    )

    const distressCall = result.rows[0]

    //The Socket.IO broadcast is handled by the socket handler -- the client
    //emits distress:activate which triggers the broadcast to operators
    res.status(201).json({ distress: distressCall })
})

//Citizen: Push GPS Location Update

router.post('/location', citizenOnly, async (req: AuthRequest, res: Response) => {
    const { distressId, latitude, longitude, accuracy, heading, speed } = req.body

    if (!distressId || latitude == null || longitude == null) {
      throw AppError.badRequest('distressId, latitude, and longitude required')
    }

    const updateResult = await pool.query(
      `UPDATE distress_calls
       SET latitude = $3, longitude = $4, accuracy = $5, heading = $6, speed = $7, last_gps_at = NOW()
       WHERE id = $1 AND citizen_id = $2 AND status IN ('active', 'acknowledged')
       RETURNING id`,
      [distressId, req.user!.id, latitude, longitude, accuracy || null, heading || null, speed || null]
    )

    if (updateResult.rows.length === 0) {
      throw AppError.notFound('Active distress call not found')
    }

    //Insert into location history
    await pool.query(
      `INSERT INTO distress_location_history (distress_id, latitude, longitude, accuracy, heading, speed)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [distressId, latitude, longitude, accuracy || null, heading || null, speed || null]
    ).catch(() => {}) // Location history table might not exist yet, that's ok

    res.json({ success: true })
})

//Citizen: Cancel SOS

router.post('/cancel', citizenOnly, async (req: AuthRequest, res: Response) => {
    const { distressId } = req.body

    if (!distressId) {
      throw AppError.badRequest('distressId required')
    }

    const result = await pool.query(
      `UPDATE distress_calls SET status = 'cancelled', resolved_at = NOW()
       WHERE id = $1 AND citizen_id = $2 AND status IN ('active', 'acknowledged')
       RETURNING *`,
      [distressId, req.user!.id]
    )

    if (result.rows.length === 0) {
      throw AppError.notFound('Active distress call not found')
    }

    res.json({ success: true, distress: result.rows[0] })
})

//Operator: List Active Distress Calls

router.get('/active', operatorOnly, async (_req: Request, res: Response) => {
    const result = await pool.query(
      `SELECT dc.*, c.phone, c.email, c.avatar_url, c.is_vulnerable
       FROM distress_calls dc
       LEFT JOIN citizens c ON dc.citizen_id = c.id
       WHERE dc.status IN ('active', 'acknowledged')
       ORDER BY dc.is_vulnerable DESC, dc.created_at ASC`
    )
    res.json({ distressCalls: result.rows, count: result.rows.length })
})

//Historical Distress Calls

router.get('/history', operatorOnly, async (req: Request, res: Response) => {
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200)
    const result = await pool.query(
      `SELECT dc.*, c.display_name, c.is_vulnerable
       FROM distress_calls dc
       LEFT JOIN citizens c ON dc.citizen_id = c.id
       ORDER BY dc.created_at DESC
       LIMIT $1`,
      [limit]
    )
    res.json({ distressCalls: result.rows })
})

//Operator: Get Single Distress Call

router.get('/:id', async (req: AuthRequest, res: Response) => {
    const userRole = req.user?.role || ''
    const citizenScope = userRole === 'citizen'
    if (!citizenScope && !operatorRoles.has(userRole)) {
      throw AppError.forbidden('Insufficient permissions for this action.')
    }

    const params = citizenScope ? [req.params.id, req.user!.id] : [req.params.id]
    const result = await pool.query(
      `SELECT dc.*, c.phone, c.email, c.avatar_url, c.is_vulnerable, c.display_name as citizen_display_name
       FROM distress_calls dc
       LEFT JOIN citizens c ON dc.citizen_id = c.id
       WHERE dc.id = $1${citizenScope ? ' AND dc.citizen_id = $2' : ''}`,
      params
    )
    if (result.rows.length === 0) {
      throw AppError.notFound('Distress call not found')
    }
    res.json({ distress: result.rows[0] })
})

//Operator: Acknowledge

router.post('/:id/acknowledge', operatorOnly, async (req: AuthRequest, res: Response) => {
    const { triageLevel } = req.body

    const result = await pool.query(
      `UPDATE distress_calls
       SET status = 'acknowledged', acknowledged_by = $2, acknowledged_at = NOW(), triage_level = $3
       WHERE id = $1 AND status = 'active'
       RETURNING *`,
      [req.params.id, req.user!.id, triageLevel || 'medium']
    )

    if (result.rows.length === 0) {
      throw AppError.notFound('Active distress call not found')
    }

    res.json({ success: true, distress: result.rows[0] })
})

//Operator: Resolve

router.post('/:id/resolve', operatorOnly, async (req: AuthRequest, res: Response) => {
    const { resolution } = req.body

    const result = await pool.query(
      `UPDATE distress_calls
       SET status = 'resolved', resolved_at = NOW(), resolved_by = $2, resolution = $3
       WHERE id = $1 AND status IN ('active', 'acknowledged')
       RETURNING *`,
      [req.params.id, req.user!.id, resolution || 'Resolved by operator']
    )

    if (result.rows.length === 0) {
      throw AppError.notFound('Active distress call not found')
    }

    res.json({ success: true, distress: result.rows[0] })
})

export default router
