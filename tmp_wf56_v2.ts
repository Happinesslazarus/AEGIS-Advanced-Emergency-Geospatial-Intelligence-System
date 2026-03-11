
  // ─── WF5 Fallback: Air Quality Monitor — every 20 min ─────────────────────
  fallbackTasks.push(
    cron.schedule('*/20 * * * *', () =>
      runJob('fallback_air_quality', async () => {
        try {
          const { getIncidentModule } = await import('../incidents/index.js')
          const mod = getIncidentModule('environmental_hazard')
          if (\!mod) return 0
          const predictions = await mod.getPredictions(process.env.REGION_ID || 'aberdeen_scotland_uk')
          return predictions.length
        } catch (e: any) {
          console.warn(`[Fallback/WF5] ${e.message}`)
          return 0
        }
      }),
    ),
  )

  // ─── WF6 Fallback: Cross-incident Alert Evaluator — every 5 min ───────────
  fallbackTasks.push(
    cron.schedule('*/5 * * * *', () =>
      runJob('fallback_alert_evaluator', async () => {
        try {
          const { listModules } = await import('../incidents/index.js')
          const regionId = process.env.REGION_ID || 'aberdeen_scotland_uk'
          let totalAlerts = 0
          for (const mod of listModules()) {
            try {
              const alerts = await mod.getAlerts(regionId)
              totalAlerts += alerts.length
            } catch (_) { /* skip */ }
          }
          return totalAlerts
        } catch (e: any) {
          console.warn(`[Fallback/WF6] ${e.message}`)
          return 0
        }
      }),
    ),
  )
