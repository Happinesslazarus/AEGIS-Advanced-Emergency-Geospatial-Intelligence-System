/**
 * routes/distressRoutes.ts — Personal Distress Beacon / SOS REST API
 *
 *   POST /api/distress/activate          — Citizen activates SOS beacon
 *   POST /api/distress/location          — Push GPS location update
 *   POST /api/distress/cancel            — Citizen cancels SOS
 *   GET  /api/distress/active            — List all active distress calls (operator)
 *   GET  /api/distress/:id               — Get single distress call details
 *   POST /api/distress/:id/acknowledge   — Operator acknowledges
 *   POST /api/distress/:id/resolve       — Operator marks resolved
 *   GET  /api/distress/history           — Historical distress calls
 */

import { Router, Request, Response } from 'express'
import pool from '../models/db.js'

const router = Router()

// ═══════════════════════════════════════════════════════════════════════════════
// Citizen: Activate SOS
// ═══════════════════════════════════════════════════════════════════════════════

router.post('/activate', async (req: Request, res: Response) => {
  try {
    const { citizenId, citizenName, latitude, longitude, message, contactNumber } = req.body

    if (!citizenId || latitude == null || longitude == null) {
      res.status(400).json({ error: 'citizenId, latitude, and longitude are required' })
      return
    }

    // Check for existing active distress call from this citizen
    const existing = await pool.query(
      `SELECT id FROM distress_calls WHERE citizen_id = $1 AND status IN ('active', 'acknowledged')`,
      [citizenId]
    )
    if (existing.rows.length > 0) {
      res.status(409).json({
        error: 'You already have an active distress call',
        distressId: existing.rows[0].id,
      })
      return
    }

    // Look up citizen's vulnerability status and phone
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

    // The Socket.IO broadcast is handled by the socket handler — the client
    // emits distress:activate which triggers the broadcast to operators
    res.status(201).json({ distress: distressCall })
  } catch (err: any) {
    console.error('[Distress] Activation failed:', err.message)
    res.status(500).json({ error: 'Failed to activate distress beacon', details: err.message })
  }
})

// ═══════════════════════════════════════════════════════════════════════════════
// Citizen: Push GPS Location Update
// ═══════════════════════════════════════════════════════════════════════════════

router.post('/location', async (req: Request, res: Response) => {
  try {
    const { distressId, latitude, longitude, accuracy, heading, speed } = req.body

    if (!distressId || latitude == null || longitude == null) {
      res.status(400).json({ error: 'distressId, latitude, and longitude required' })
      return
    }

    await pool.query(
      `UPDATE distress_calls 
       SET latitude = $2, longitude = $3, accuracy = $4, heading = $5, speed = $6, last_gps_at = NOW()
       WHERE id = $1 AND status IN ('active', 'acknowledged')`,
      [distressId, latitude, longitude, accuracy || null, heading || null, speed || null]
    )

    // Insert into location history
    await pool.query(
      `INSERT INTO distress_location_history (distress_id, latitude, longitude, accuracy, heading, speed)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [distressId, latitude, longitude, accuracy || null, heading || null, speed || null]
    ).catch(() => {}) // Location history table might not exist yet, that's ok

    res.json({ success: true })
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to update location', details: err.message })
  }
})

// ═══════════════════════════════════════════════════════════════════════════════
// Citizen: Cancel SOS
// ═══════════════════════════════════════════════════════════════════════════════

router.post('/cancel', async (req: Request, res: Response) => {
  try {
    const { distressId, citizenId } = req.body

    if (!distressId) {
      res.status(400).json({ error: 'distressId required' })
      return
    }

    const result = await pool.query(
      `UPDATE distress_calls SET status = 'cancelled', resolved_at = NOW()
       WHERE id = $1 AND citizen_id = $2 AND status IN ('active', 'acknowledged')
       RETURNING *`,
      [distressId, citizenId]
    )

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Active distress call not found' })
      return
    }

    res.json({ success: true, distress: result.rows[0] })
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to cancel distress', details: err.message })
  }
})

// ═══════════════════════════════════════════════════════════════════════════════
// Operator: List Active Distress Calls
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/active', async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT dc.*, c.phone, c.email, c.avatar_url, c.is_vulnerable
       FROM distress_calls dc
       LEFT JOIN citizens c ON dc.citizen_id = c.id
       WHERE dc.status IN ('active', 'acknowledged')
       ORDER BY dc.is_vulnerable DESC, dc.created_at ASC`
    )
    res.json({ distressCalls: result.rows, count: result.rows.length })
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch active distress calls', details: err.message })
  }
})

// ═══════════════════════════════════════════════════════════════════════════════
// Operator: Get Single Distress Call
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/:id', async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT dc.*, c.phone, c.email, c.avatar_url, c.is_vulnerable, c.display_name as citizen_display_name
       FROM distress_calls dc
       LEFT JOIN citizens c ON dc.citizen_id = c.id
       WHERE dc.id = $1`,
      [req.params.id]
    )
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Distress call not found' })
      return
    }
    res.json({ distress: result.rows[0] })
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch distress call', details: err.message })
  }
})

// ═══════════════════════════════════════════════════════════════════════════════
// Operator: Acknowledge
// ═══════════════════════════════════════════════════════════════════════════════

router.post('/:id/acknowledge', async (req: Request, res: Response) => {
  try {
    const { operatorId, operatorName, triageLevel } = req.body

    const result = await pool.query(
      `UPDATE distress_calls 
       SET status = 'acknowledged', acknowledged_by = $2, acknowledged_at = NOW(), triage_level = $3
       WHERE id = $1 AND status = 'active'
       RETURNING *`,
      [req.params.id, operatorId, triageLevel || 'medium']
    )

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Active distress call not found' })
      return
    }

    res.json({ success: true, distress: result.rows[0] })
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to acknowledge distress', details: err.message })
  }
})

// ═══════════════════════════════════════════════════════════════════════════════
// Operator: Resolve
// ═══════════════════════════════════════════════════════════════════════════════

router.post('/:id/resolve', async (req: Request, res: Response) => {
  try {
    const { operatorId, resolution } = req.body

    const result = await pool.query(
      `UPDATE distress_calls 
       SET status = 'resolved', resolved_at = NOW(), resolved_by = $2, resolution = $3
       WHERE id = $1 AND status IN ('active', 'acknowledged')
       RETURNING *`,
      [req.params.id, operatorId, resolution || 'Resolved by operator']
    )

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Active distress call not found' })
      return
    }

    res.json({ success: true, distress: result.rows[0] })
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to resolve distress', details: err.message })
  }
})

// ═══════════════════════════════════════════════════════════════════════════════
// Historical Distress Calls
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/history', async (req: Request, res: Response) => {
  try {
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
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch distress history', details: err.message })
  }
})

export default router
