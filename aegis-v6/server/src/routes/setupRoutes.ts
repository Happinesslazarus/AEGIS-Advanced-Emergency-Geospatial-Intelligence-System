/**
 * First-run setup wizard for new AEGIS installations. Checks whether
 * the platform has been configured, guides admin through initial setup
 * (create first admin account, select region, configure features).
 *
 * - Mounted at /api/admin/setup in index.ts
 * - Reads/writes system_config table for setup state
 * - After setup, the wizard endpoints return "already configured"
 * */

import { Router, Request, Response } from 'express'
import pool from '../models/db.js'
import { authMiddleware, requireRole, AuthRequest } from '../middleware/auth.js'
import { AppError } from '../utils/AppError.js'

const router = Router()

//Helpers

/* Read a single system_config value by key. Returns null if missing. */
async function getConfigValue(key: string): Promise<unknown | null> {
  const { rows } = await pool.query(
    `SELECT config_value FROM system_config WHERE config_key = $1 LIMIT 1`,
    [key],
  )
  return rows.length > 0 ? rows[0].config_value : null
}

/* Upsert a system_config row. */
async function setConfigValue(key: string, value: unknown): Promise<void> {
  await pool.query(
    `INSERT INTO system_config (config_key, config_value)
     VALUES ($1, $2::jsonb)
     ON CONFLICT (config_key) DO UPDATE SET config_value = EXCLUDED.config_value, updated_at = now()`,
    [key, JSON.stringify(value)],
  )
}

//GET /api/admin/setup/status
//Publicly readable (used by frontend to decide whether to show setup wizard).
//Does NOT leak sensitive data.
router.get('/status', async (_req: Request, res: Response) => {
    //Check if system_config table exists (handles first migration not yet applied)
    const tableCheck = await pool.query(
      `SELECT to_regclass('public.system_config') AS t`,
    )
    if (!tableCheck.rows[0]?.t) {
      //Table doesn't exist yet -- definitely first run
      const adminCount = await pool.query(
        `SELECT COUNT(*)::int AS c FROM operators WHERE role = 'admin' AND deleted_at IS NULL`,
      )
      return res.json({
        isFirstRun: true,
        setupCompleted: false,
        hasAdmin: (adminCount.rows[0]?.c || 0) > 0,
        configuredRegion: null,
        notificationChannelsConfigured: false })
    }

    const setupCompleted = await getConfigValue('setup_completed')
    const configuredRegion = await getConfigValue('configured_region')
    const notifConfig = await getConfigValue('notification_channels_configured')

    const adminCount = await pool.query(
      `SELECT COUNT(*)::int AS c FROM operators WHERE role = 'admin' AND deleted_at IS NULL`,
    )
    const hasAdmin = (adminCount.rows[0]?.c || 0) > 0

    const isComplete = setupCompleted === true
    res.json({
      isFirstRun: !isComplete,
      setupCompleted: isComplete,
      hasAdmin,
      configuredRegion: configuredRegion ?? null,
      notificationChannelsConfigured: notifConfig === true })
})

//POST /api/admin/setup/region
router.post('/region', authMiddleware, requireRole('admin'), async (req: AuthRequest, res: Response) => {
    const { region } = req.body
    if (!region || typeof region !== 'string' || region.trim().length === 0) {
      throw AppError.badRequest('A valid region identifier is required.')
    }

    await setConfigValue('configured_region', region.trim())

    res.json({ success: true, configuredRegion: region.trim() })
})

//POST /api/admin/setup/notifications
//Saves which notification channels are configured (not the secrets themselves).
router.post('/notifications', authMiddleware, requireRole('admin'), async (req: AuthRequest, res: Response) => {
    const { channels } = req.body
    if (!channels || typeof channels !== 'object') {
      throw AppError.badRequest('channels object is required.')
    }

    //Store a summary of which channels were configured
    const summary: Record<string, boolean> = {}
    for (const key of ['smtp', 'telegram', 'twilio', 'webPush']) {
      summary[key] = !!channels[key]?.enabled
    }

    await setConfigValue('notification_channels', channels)
    await setConfigValue('notification_channels_configured', true)

    res.json({ success: true, configured: summary })
})

//POST /api/admin/setup/complete
//Marks first-run setup as finished. Stores who completed it and when.
router.post('/complete', authMiddleware, requireRole('admin'), async (req: AuthRequest, res: Response) => {
    const userId = req.user!.id

    //Verify an admin account exists
    const adminCheck = await pool.query(
      `SELECT COUNT(*)::int AS c FROM operators WHERE role = 'admin' AND deleted_at IS NULL`,
    )
    if ((adminCheck.rows[0]?.c || 0) === 0) {
      throw AppError.badRequest('Cannot complete setup -- no admin account exists.')
    }

    //Verify a region was configured
    const region = await getConfigValue('configured_region')
    if (!region) {
      throw AppError.badRequest('Cannot complete setup -- no region has been configured.')
    }

    await setConfigValue('setup_completed', true)
    await setConfigValue('setup_completed_at', new Date().toISOString())
    await setConfigValue('setup_completed_by', userId)

    //Log activity
    try {
      await pool.query(
        `INSERT INTO activity_log (action, action_type, operator_id, operator_name)
         VALUES ($1, $2, $3, $4)`,
        [
          'Platform first-run setup completed',
          'system_setup',
          userId,
          req.user!.displayName,
        ],
      )
    } catch {
      //activity_log not critical
    }

    res.json({ success: true, setupCompleted: true })
})

//POST /api/admin/setup/reset
//Resets setup state. Only for recovery / development.
router.post('/reset', authMiddleware, requireRole('admin'), async (req: AuthRequest, res: Response) => {
    const keysToReset = [
      'setup_completed',
      'setup_completed_at',
      'setup_completed_by',
      'configured_region',
      'notification_channels',
      'notification_channels_configured',
    ]
    await pool.query(
      `DELETE FROM system_config WHERE config_key = ANY($1)`,
      [keysToReset],
    )

    //Log this sensitive action
    try {
      await pool.query(
        `INSERT INTO activity_log (action, action_type, operator_id, operator_name)
         VALUES ($1, $2, $3, $4)`,
        [
          'Platform setup state was reset',
          'system_reset',
          req.user!.id,
          req.user!.displayName,
        ],
      )
    } catch {
      //non-critical
    }

    res.json({ success: true, message: 'Setup state has been reset.' })
})

export default router

