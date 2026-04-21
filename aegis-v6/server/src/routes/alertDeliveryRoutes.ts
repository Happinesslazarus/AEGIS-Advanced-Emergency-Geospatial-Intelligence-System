/**
 * Alert delivery log + analytics + retry endpoints.
 *
 * Powers the operator "Delivery Dashboard" — shows every push/email/sms/
 * telegram/whatsapp delivery attempt with filtering, aggregation, retry,
 * and CSV export. Also exposes subscriber-mix statistics.
 *
 * - Mounted at /api in index.ts
 * - All endpoints require admin or operator role
 * - Extracted from extendedRoutes.ts (C3)
 */
import { Router, Response } from 'express'
import { authMiddleware, AuthRequest } from '../middleware/auth.js'
import { asyncRoute } from '../utils/asyncRoute.js'
import { AppError } from '../utils/AppError.js'
import * as notificationService from '../services/notificationService.js'
import pool from '../models/db.js'

const router = Router()

function requireStaff(req: AuthRequest): void {
  if (!['admin', 'operator'].includes(req.user?.role || '')) {
    throw AppError.forbidden('Insufficient permissions.')
  }
}

function buildDeliveryWhere(q: Record<string, any>): { where: string; params: any[]; nextIdx: number } {
  const clauses: string[] = []
  const params: any[] = []
  let idx = 1
  const ch = q.channel ? (String(q.channel) === 'webpush' ? 'web' : String(q.channel)) : null
  if (ch)         { clauses.push(`adl.channel = $${idx++}`);            params.push(ch) }
  if (q.status)   { clauses.push(`adl.status = $${idx++}`);             params.push(String(q.status)) }
  if (q.alert_id) { clauses.push(`adl.alert_id = $${idx++}`);           params.push(String(q.alert_id)) }
  if (q.start)    { clauses.push(`adl.created_at >= $${idx++}`);        params.push(new Date(String(q.start))) }
  if (q.end)      { clauses.push(`adl.created_at <= $${idx++}`);        params.push(new Date(String(q.end))) }
  if (q.severity) { clauses.push(`a.severity = $${idx++}`);             params.push(String(q.severity)) }
  if (q.search)   { clauses.push(`(adl.recipient ILIKE $${idx} OR a.title ILIKE $${idx})`); params.push(`%${String(q.search)}%`); idx++ }
  return { where: clauses.length ? 'WHERE ' + clauses.join(' AND ') : '', params, nextIdx: idx }
}

//GET /api/alerts/delivery - paginated, filtered, joined with alert title
router.get('/alerts/delivery', authMiddleware, asyncRoute(async (req: AuthRequest, res: Response) => {
  requireStaff(req)
  const limit  = Math.min(parseInt(String(req.query.limit  || '100')), 1000)
  const offset = parseInt(String(req.query.offset || '0'))
  const { where, params, nextIdx } = buildDeliveryWhere(req.query as any)

  const [countRes, dataRes] = await Promise.all([
    pool.query(`SELECT COUNT(*) FROM alert_delivery_log adl LEFT JOIN alerts a ON a.id=adl.alert_id ${where}`, params),
    pool.query(`
      SELECT adl.id, adl.alert_id, adl.channel, adl.recipient, adl.provider_id,
             adl.status, adl.error_message, adl.sent_at, adl.delivered_at, adl.created_at,
             COALESCE(adl.retry_count,0) AS retry_count, adl.last_retry_at,
             a.title AS alert_title, a.severity AS alert_severity, a.alert_type
      FROM alert_delivery_log adl LEFT JOIN alerts a ON a.id=adl.alert_id
      ${where} ORDER BY adl.created_at DESC LIMIT $${nextIdx} OFFSET $${nextIdx+1}`,
      [...params, limit, offset]),
  ])
  res.json({ rows: dataRes.rows, total: parseInt(countRes.rows[0].count), limit, offset })
}))

//GET /api/alerts/delivery/stats - analytics dashboard data
router.get('/alerts/delivery/stats', authMiddleware, asyncRoute(async (req: AuthRequest, res: Response) => {
  requireStaff(req)
  const [overall, byChannel, hourly, topFailing, recentErrors, subscriberStats] = await Promise.all([
    pool.query(`SELECT COUNT(*) AS total,
      COUNT(*) FILTER (WHERE status IN ('sent','delivered')) AS sent,
      COUNT(*) FILTER (WHERE status='delivered') AS delivered,
      COUNT(*) FILTER (WHERE status='failed') AS failed,
      COUNT(*) FILTER (WHERE status='pending') AS pending,
      ROUND(100.0*COUNT(*) FILTER (WHERE status IN ('sent','delivered'))/NULLIF(COUNT(*),0),1) AS success_rate
      FROM alert_delivery_log`),
    pool.query(`SELECT channel,
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE status IN ('sent','delivered')) AS sent,
      COUNT(*) FILTER (WHERE status='failed') AS failed,
      COUNT(*) FILTER (WHERE status='pending') AS pending,
      ROUND(100.0*COUNT(*) FILTER (WHERE status IN ('sent','delivered'))/NULLIF(COUNT(*),0),1) AS success_rate
      FROM alert_delivery_log GROUP BY channel ORDER BY total DESC`),
    pool.query(`SELECT date_trunc('hour',created_at) AS hour,
      COUNT(*) AS total, COUNT(*) FILTER (WHERE status IN ('sent','delivered')) AS sent,
      COUNT(*) FILTER (WHERE status='failed') AS failed
      FROM alert_delivery_log WHERE created_at>=NOW()-INTERVAL '24 hours' GROUP BY 1 ORDER BY 1`),
    pool.query(`SELECT adl.alert_id, a.title AS alert_title, a.severity,
      COUNT(*) AS fail_count, MAX(adl.created_at) AS last_attempt
      FROM alert_delivery_log adl LEFT JOIN alerts a ON a.id=adl.alert_id
      WHERE adl.status='failed' GROUP BY adl.alert_id,a.title,a.severity ORDER BY fail_count DESC LIMIT 5`),
    pool.query(`SELECT channel, error_message, COUNT(*) AS count
      FROM alert_delivery_log WHERE status='failed' AND error_message IS NOT NULL
      AND created_at>=NOW()-INTERVAL '7 days'
      GROUP BY channel,error_message ORDER BY count DESC LIMIT 10`),
    pool.query(`SELECT
      COUNT(*) AS total_subscribers,
      COUNT(*) FILTER (WHERE verified = true) AS verified_subscribers,
      COUNT(*) FILTER (WHERE verified = false) AS unverified_subscribers,
      COUNT(*) FILTER (WHERE 'email' = ANY(channels)) AS email_subscribers,
      COUNT(*) FILTER (WHERE 'sms' = ANY(channels)) AS sms_subscribers,
      COUNT(*) FILTER (WHERE 'whatsapp' = ANY(channels)) AS whatsapp_subscribers,
      COUNT(*) FILTER (WHERE 'telegram' = ANY(channels)) AS telegram_subscribers,
      COUNT(*) FILTER (WHERE 'web' = ANY(channels) OR 'webpush' = ANY(channels)) AS webpush_subscribers
      FROM alert_subscriptions`),
  ])
  res.json({ overall: overall.rows[0], by_channel: byChannel.rows, hourly_trend: hourly.rows, top_failing: topFailing.rows, recent_errors: recentErrors.rows, subscribers: subscriberStats.rows[0] })
}))

//GET /api/alerts/delivery/grouped - per-alert summary with all channel deliveries
router.get('/alerts/delivery/grouped', authMiddleware, asyncRoute(async (req: AuthRequest, res: Response) => {
  requireStaff(req)
  const limit  = Math.min(parseInt(String(req.query.limit  || '50')), 200)
  const offset = parseInt(String(req.query.offset || '0'))
  const clauses: string[] = []
  const params: any[] = []
  let idx = 1
  if (req.query.search)   { clauses.push(`a.title ILIKE $${idx++}`);  params.push(`%${String(req.query.search)}%`) }
  if (req.query.severity) { clauses.push(`a.severity = $${idx++}`);   params.push(String(req.query.severity)) }
  const whereStr = clauses.length ? 'WHERE ' + clauses.join(' AND ') : ''

  const [dataRes, countRes] = await Promise.all([
    pool.query(`
      SELECT adl.alert_id, a.title AS alert_title, a.severity AS alert_severity, a.alert_type,
        MAX(adl.created_at) AS last_attempt,
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE adl.status IN ('sent','delivered')) AS sent,
        COUNT(*) FILTER (WHERE adl.status='failed') AS failed,
        COUNT(*) FILTER (WHERE adl.status='pending') AS pending,
        JSON_AGG(DISTINCT adl.channel) AS channels,
        JSON_AGG(JSON_BUILD_OBJECT(
          'id',adl.id,'channel',adl.channel,'status',adl.status,'recipient',adl.recipient,
          'error_message',adl.error_message,'sent_at',adl.sent_at,'retry_count',COALESCE(adl.retry_count,0)
        ) ORDER BY adl.channel) AS deliveries
      FROM alert_delivery_log adl LEFT JOIN alerts a ON a.id=adl.alert_id
      ${whereStr} GROUP BY adl.alert_id,a.title,a.severity,a.alert_type
      ORDER BY last_attempt DESC LIMIT $${idx} OFFSET $${idx+1}`,
      [...params, limit, offset]),
    pool.query(`SELECT COUNT(DISTINCT adl.alert_id) FROM alert_delivery_log adl LEFT JOIN alerts a ON a.id=adl.alert_id ${whereStr}`, params),
  ])
  res.json({ groups: dataRes.rows, total: parseInt(countRes.rows[0].count), limit, offset })
}))

//POST /api/alerts/delivery/:id/retry - retry a single failed delivery
router.post('/alerts/delivery/:id/retry', authMiddleware, asyncRoute(async (req: AuthRequest, res: Response) => {
  requireStaff(req)
  const { rows } = await pool.query(
    `SELECT adl.*, a.title, a.message, a.severity, a.alert_type
     FROM alert_delivery_log adl LEFT JOIN alerts a ON a.id=adl.alert_id WHERE adl.id=$1`, [req.params.id])
  if (!rows.length) throw AppError.notFound('Not found.')
  const e = rows[0]
  const ap: notificationService.Alert = { id: e.alert_id, type: e.alert_type||'general', severity: e.severity||'warning', title: e.title||'AEGIS Alert', message: e.message||'', area: 'AEGIS Coverage Area' }
  let r: any = { success: false, error: 'Unknown channel' }
  if (e.channel==='email')     r = await notificationService.sendEmailAlert(e.recipient, ap)
  else if (e.channel==='sms')      r = await notificationService.sendSMSAlert(e.recipient, ap)
  else if (e.channel==='telegram') r = await notificationService.sendTelegramAlert(e.recipient, ap)
  else if (e.channel==='whatsapp') r = await notificationService.sendWhatsAppAlert(e.recipient, ap)
  const newStatus = r.success ? 'sent' : 'failed'
  await pool.query(`UPDATE alert_delivery_log SET status=$1,error_message=$2,sent_at=$3,retry_count=COALESCE(retry_count,0)+1,last_retry_at=NOW() WHERE id=$4`,
    [newStatus, r.error||null, r.success?new Date():null, req.params.id])
  res.json({ success: r.success, status: newStatus, error: r.error||null })
}))

//POST /api/alerts/delivery/retry-failed - bulk retry failed deliveries
router.post('/alerts/delivery/retry-failed', authMiddleware, asyncRoute(async (req: AuthRequest, res: Response) => {
  requireStaff(req)
  const { alert_id, channel } = req.body
  const clauses = [`adl.status='failed'`, `COALESCE(adl.retry_count,0)<3`]
  const params: any[] = []
  let idx = 1
  if (alert_id) { clauses.push(`adl.alert_id=$${idx++}`); params.push(alert_id) }
  if (channel)  { clauses.push(`adl.channel=$${idx++}`);  params.push(channel) }
  const { rows: failed } = await pool.query(
    `SELECT adl.*,a.title,a.message,a.severity,a.alert_type FROM alert_delivery_log adl LEFT JOIN alerts a ON a.id=adl.alert_id WHERE ${clauses.join(' AND ')} LIMIT 50`, params)
  let succeeded=0, failedCount=0
  for (const e of failed) {
    const ap: notificationService.Alert = { id:e.alert_id,type:e.alert_type||'general',severity:e.severity||'warning',title:e.title||'AEGIS Alert',message:e.message||'',area:'AEGIS Coverage Area' }
    let r:any={success:false}
    try {
      if (e.channel==='email') r=await notificationService.sendEmailAlert(e.recipient,ap)
      else if(e.channel==='sms') r=await notificationService.sendSMSAlert(e.recipient,ap)
      else if(e.channel==='telegram') r=await notificationService.sendTelegramAlert(e.recipient,ap)
      else if(e.channel==='whatsapp') r=await notificationService.sendWhatsAppAlert(e.recipient,ap)
    } catch { r={success:false} }
    if(r.success) succeeded++; else failedCount++
    await pool.query(`UPDATE alert_delivery_log SET status=$1,error_message=$2,sent_at=$3,retry_count=COALESCE(retry_count,0)+1,last_retry_at=NOW() WHERE id=$4`,
      [r.success?'sent':'failed', r.error||null, r.success?new Date():null, e.id])
  }
  res.json({ attempted: failed.length, succeeded, failed: failedCount })
}))

//GET /api/alerts/delivery/export.csv - stream CSV download
router.get('/alerts/delivery/export.csv', authMiddleware, asyncRoute(async (req: AuthRequest, res: Response) => {
  requireStaff(req)
  const { where, params, nextIdx } = buildDeliveryWhere(req.query as any)
  const { rows } = await pool.query(`
    SELECT adl.id, adl.alert_id, a.title AS alert_title, a.severity AS alert_severity,
           adl.channel, adl.recipient, adl.status, adl.error_message, adl.provider_id,
           adl.sent_at, adl.delivered_at, adl.created_at, COALESCE(adl.retry_count,0) AS retry_count
    FROM alert_delivery_log adl LEFT JOIN alerts a ON a.id=adl.alert_id
    ${where} ORDER BY adl.created_at DESC LIMIT $${nextIdx}`, [...params, 10000])
  const esc = (v:any) => v==null?'':(`"${String(v).replace(/"/g,'""')}"`)
  const headers = ['id','alert_id','alert_title','alert_severity','channel','recipient','status','error_message','provider_id','sent_at','delivered_at','created_at','retry_count']
  const csv = [headers.join(','), ...rows.map((r:any)=>headers.map(h=>esc(r[h])).join(','))].join('\n')
  res.setHeader('Content-Type','text/csv')
  res.setHeader('Content-Disposition',`attachment; filename="delivery_log_${Date.now()}.csv"`)
  res.send(csv)
}))

export default router
