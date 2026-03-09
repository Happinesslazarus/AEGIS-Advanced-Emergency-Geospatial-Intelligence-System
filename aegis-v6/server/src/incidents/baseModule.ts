/**
 * incidents/baseModule.ts — Abstract base for all incident modules
 *
 * Provides shared functionality so each incident plugin only needs to
 * implement incident-specific logic. Includes rule-based prediction
 * fallback, common alert evaluation, and standard route scaffolding.
 */

import { Router, Request, Response } from 'express'
import pool from '../models/db.js'
import type {
  IncidentModule,
  IncidentRegistryEntry,
  IncidentPrediction,
  IncidentAlert,
  IncidentMapData,
  IncidentMapMarker,
  AlertRuleContext,
  AlertRuleResult,
} from './types.js'

export abstract class BaseIncidentModule implements IncidentModule {
  abstract id: string
  abstract registry: IncidentRegistryEntry
  router: Router

  constructor() {
    this.router = Router()
    this.setupRoutes()
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Standard routes — automatically mounted for every incident
  // ═══════════════════════════════════════════════════════════════════════════

  protected setupRoutes(): void {
    // GET /active — active incidents of this type
    this.router.get('/active', async (req: Request, res: Response) => {
      try {
        const region = String(req.query.region || process.env.REGION_ID || 'aberdeen_scotland_uk')
        const reports = await this.getActiveReports(region)
        res.json({ incidentType: this.id, reports, count: reports.length })
      } catch (err: any) {
        res.status(500).json({ error: `Failed to get active ${this.id} incidents`, details: err.message })
      }
    })

    // GET /predictions — predictions for this incident type
    this.router.get('/predictions', async (req: Request, res: Response) => {
      try {
        const region = String(req.query.region || process.env.REGION_ID || 'aberdeen_scotland_uk')
        const predictions = await this.getPredictions(region)
        res.json({ incidentType: this.id, predictions, count: predictions.length })
      } catch (err: any) {
        res.status(500).json({ error: `Failed to get ${this.id} predictions`, details: err.message })
      }
    })

    // POST /report — submit a report for this incident type
    this.router.post('/report', async (req: Request, res: Response) => {
      try {
        const report = await this.submitReport(req.body)
        res.status(201).json({ incidentType: this.id, report, success: true })
      } catch (err: any) {
        res.status(500).json({ error: `Failed to submit ${this.id} report`, details: err.message })
      }
    })

    // GET /history — historical data
    this.router.get('/history', async (req: Request, res: Response) => {
      try {
        const region = String(req.query.region || process.env.REGION_ID || 'aberdeen_scotland_uk')
        const days = parseInt(String(req.query.days || '30'))
        const history = await this.getHistory(region, days)
        res.json({ incidentType: this.id, history, count: history.length })
      } catch (err: any) {
        res.status(500).json({ error: `Failed to get ${this.id} history`, details: err.message })
      }
    })

    // GET /alerts — current alerts
    this.router.get('/alerts', async (req: Request, res: Response) => {
      try {
        const region = String(req.query.region || process.env.REGION_ID || 'aberdeen_scotland_uk')
        const alerts = await this.getAlerts(region)
        res.json({ incidentType: this.id, alerts, count: alerts.length })
      } catch (err: any) {
        res.status(500).json({ error: `Failed to get ${this.id} alerts`, details: err.message })
      }
    })

    // GET /map-data — map visualization data
    this.router.get('/map-data', async (req: Request, res: Response) => {
      try {
        const region = String(req.query.region || process.env.REGION_ID || 'aberdeen_scotland_uk')
        const mapData = await this.getMapData(region)
        res.json({ incidentType: this.id, ...mapData })
      } catch (err: any) {
        res.status(500).json({ error: `Failed to get ${this.id} map data`, details: err.message })
      }
    })

    // Allow subclasses to add custom routes
    this.setupCustomRoutes()
  }

  /** Override in subclass to add incident-specific routes */
  protected setupCustomRoutes(): void {}

  // ═══════════════════════════════════════════════════════════════════════════
  // Default implementations — override in subclass for specific behavior
  // ═══════════════════════════════════════════════════════════════════════════

  async getPredictions(region: string): Promise<IncidentPrediction[]> {
    // Default: rule-based prediction from recent report density
    return this.ruleBasedPrediction(region)
  }

  async getAlerts(region: string): Promise<IncidentAlert[]> {
    try {
      const result = await pool.query(
        `SELECT * FROM alerts
         WHERE (incident_type = $1 OR category = $1)
           AND (expires_at IS NULL OR expires_at > NOW())
         ORDER BY created_at DESC
         LIMIT 50`,
        [this.id]
      )
      return result.rows.map(row => ({
        id: row.id,
        incidentType: this.id,
        severity: row.severity || 'advisory',
        title: row.title || row.message || `${this.registry.name} Alert`,
        description: row.description || row.message || '',
        location: row.latitude && row.longitude ? { lat: row.latitude, lng: row.longitude } : undefined,
        region,
        issuedAt: row.created_at?.toISOString() || new Date().toISOString(),
        expiresAt: row.expires_at?.toISOString(),
        source: row.source || 'aegis',
        acknowledged: row.acknowledged || false,
      }))
    } catch {
      // Table may not exist or have different schema — return empty
      return []
    }
  }

  async getMapData(region: string): Promise<IncidentMapData> {
    const reports = await this.getActiveReports(region)
    const markers: IncidentMapMarker[] = reports
      .filter(r => r.latitude && r.longitude)
      .map(r => ({
        id: r.id,
        incidentType: this.id,
        lat: parseFloat(r.latitude),
        lng: parseFloat(r.longitude),
        severity: r.severity || 'Low',
        title: r.title || `${this.registry.name} Report`,
        description: r.description,
        timestamp: r.created_at?.toISOString() || new Date().toISOString(),
        icon: this.registry.icon,
        color: this.registry.color,
      }))

    return { markers }
  }

  async evaluateAlertRules(context: AlertRuleContext): Promise<AlertRuleResult[]> {
    const results: AlertRuleResult[] = []
    const recentCount = context.recentReports.length
    const { advisory, warning, critical } = this.registry.alertThresholds

    // Simple density-based alert rules (applicable to all incident types)
    if (recentCount >= critical) {
      results.push({
        shouldAlert: true,
        severity: 'critical',
        title: `Critical ${this.registry.name} Alert`,
        description: `${recentCount} ${this.registry.name.toLowerCase()} reports received recently. Critical threshold exceeded.`,
      })
    } else if (recentCount >= warning) {
      results.push({
        shouldAlert: true,
        severity: 'warning',
        title: `${this.registry.name} Warning`,
        description: `${recentCount} ${this.registry.name.toLowerCase()} reports received. Warning threshold reached.`,
      })
    } else if (recentCount >= advisory) {
      results.push({
        shouldAlert: true,
        severity: 'advisory',
        title: `${this.registry.name} Advisory`,
        description: `${recentCount} ${this.registry.name.toLowerCase()} reports. Monitoring situation.`,
      })
    }

    return results
  }

  async ingestData(_region: string): Promise<{ recordsIngested: number; source: string }> {
    // Default: no external data ingestion
    return { recordsIngested: 0, source: 'none' }
  }

  async getHistory(region: string, days = 30): Promise<any[]> {
    try {
      const result = await pool.query(
        `SELECT * FROM reports
         WHERE (incident_type = $1 OR category = $1)
           AND created_at >= NOW() - ($2 || ' days')::interval
         ORDER BY created_at DESC
         LIMIT 200`,
        [this.id, days]
      )
      return result.rows
    } catch {
      return []
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Shared helpers
  // ═══════════════════════════════════════════════════════════════════════════

  protected async getActiveReports(region: string): Promise<any[]> {
    try {
      const result = await pool.query(
        `SELECT * FROM reports
         WHERE (incident_type = $1 OR category = $1)
           AND status NOT IN ('resolved', 'closed', 'rejected', 'archived')
         ORDER BY created_at DESC
         LIMIT 100`,
        [this.id]
      )
      return result.rows
    } catch {
      return []
    }
  }

  protected async submitReport(body: any): Promise<any> {
    const {
      title, description, severity, latitude, longitude,
      reporter_name, reporter_phone, customFields, photos,
    } = body

    try {
      const result = await pool.query(
        `INSERT INTO reports (title, description, severity, latitude, longitude,
         reporter_name, reporter_phone, incident_type, category, custom_fields, status, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pending', NOW())
         RETURNING *`,
        [
          title || `${this.registry.name} Report`,
          description || '',
          severity || 'Medium',
          latitude || null,
          longitude || null,
          reporter_name || 'Anonymous',
          reporter_phone || null,
          this.id,
          this.registry.category,
          JSON.stringify(customFields || {}),
        ]
      )
      return result.rows[0]
    } catch (err: any) {
      throw new Error(`Failed to create report: ${err.message}`)
    }
  }

  protected async ruleBasedPrediction(region: string): Promise<IncidentPrediction[]> {
    // Rule-based prediction: analyze recent report patterns
    try {
      const result = await pool.query(
        `SELECT severity, COUNT(*) as cnt,
                AVG(EXTRACT(EPOCH FROM (NOW() - created_at))) as avg_age_seconds
         FROM reports
         WHERE (incident_type = $1 OR category = $1)
           AND created_at >= NOW() - interval '48 hours'
           AND status NOT IN ('resolved', 'closed', 'rejected', 'archived')
         GROUP BY severity`,
        [this.id]
      )

      if (result.rows.length === 0) {
        return [{
          incidentType: this.id,
          severity: 'Low',
          probability: 0.1,
          confidence: 0.3,
          confidenceSource: 'rule_based',
          region,
          description: `No recent ${this.registry.name.toLowerCase()} activity detected.`,
          advisoryText: `Current ${this.registry.name.toLowerCase()} risk is minimal based on available data.`,
          generatedAt: new Date().toISOString(),
          dataSourcesUsed: ['citizen_reports'],
        }]
      }

      const totalReports = result.rows.reduce((sum: number, r: any) => sum + parseInt(r.cnt), 0)
      const criticalCount = result.rows.find((r: any) => r.severity === 'Critical')?.cnt || 0
      const highCount = result.rows.find((r: any) => r.severity === 'High')?.cnt || 0

      // Calculate probability based on report density and severity distribution
      const baseProbability = Math.min(0.95, totalReports / 20)
      const severityBoost = (parseInt(criticalCount) * 0.15) + (parseInt(highCount) * 0.08)
      const probability = Math.min(0.95, baseProbability + severityBoost)

      let severity = 'Low'
      if (probability > 0.7) severity = 'Critical'
      else if (probability > 0.5) severity = 'High'
      else if (probability > 0.3) severity = 'Medium'

      return [{
        incidentType: this.id,
        severity,
        probability: Math.round(probability * 100) / 100,
        confidence: 0.4, // Rule-based = lower confidence
        confidenceSource: 'rule_based',
        region,
        description: `${totalReports} ${this.registry.name.toLowerCase()} reports in last 48h. ${parseInt(criticalCount)} critical, ${parseInt(highCount)} high severity.`,
        advisoryText: this.getAdvisoryText(severity),
        generatedAt: new Date().toISOString(),
        dataSourcesUsed: ['citizen_reports', 'report_density_analysis'],
      }]
    } catch {
      return []
    }
  }

  protected getAdvisoryText(severity: string): string {
    switch (severity) {
      case 'Critical':
        return `CRITICAL: Take immediate protective action for ${this.registry.name.toLowerCase()}. Follow official guidance.`
      case 'High':
        return `HIGH RISK: ${this.registry.name} conditions are significant. Prepare to take action.`
      case 'Medium':
        return `MODERATE RISK: ${this.registry.name} conditions detected. Stay alert and monitor updates.`
      default:
        return `LOW RISK: ${this.registry.name} risk is minimal. Continue normal activities.`
    }
  }
}
