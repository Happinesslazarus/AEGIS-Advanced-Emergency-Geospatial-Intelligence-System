/**
 * i18n_replace_admin2.mjs — batch 2: AnalyticsCenter, AnalyticsDashboard, 
 * AITransparencyDashboard, CommandCenter (more strings), LoginPage, AllReportsManager
 */
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

const SRC = join(process.cwd(), 'src')

function replaceAll(code, pairs) {
  let result = code
  let count = 0
  for (const [from, to] of pairs) {
    if (result.includes(from)) {
      result = result.split(from).join(to)
      count++
    }
  }
  return { result, count }
}

// ────────────────────────────────────────────────────────────
// AnalyticsCenter.tsx
// ────────────────────────────────────────────────────────────
function fixAnalyticsCenter() {
  const file = join(SRC, 'components/admin/AnalyticsCenter.tsx')
  let code = readFileSync(file, 'utf8')
  const { result, count } = replaceAll(code, [
    // Time formatting
    [`return 'just now'`, `return t('time.justNow', lang)`],
    [`return \`\${mins}m ago\``, `return \`\${mins}\${t('time.mAgo', lang)}\``],
    [`return \`\${hours}h ago\``, `return \`\${hours}\${t('time.hAgo', lang)}\``],
    [`return \`\${days}d ago\``, `return \`\${days}\${t('time.dAgo', lang)}\``],
    // Header
    [`>Intelligence & Analytics<`, `>{t('analytics.intelligenceAnalytics', lang)}<`],
    [`>Situation Assessment`, `>{t('analytics.situationAssessment', lang)}`],
    [`>LIVE<`, `>{t('common.live', lang)}<`],
    [`>CSV<`, `>{t('common.csv', lang)}<`],
    [`>JSON<`, `>{t('common.json', lang)}<`],
    [`>OPTEMPO<`, `>{t('analytics.optempo', lang)}<`],
    // OPTEMPO metrics
    [` label: 'Total Incidents'`, ` label: t('analytics.totalIncidents', lang)`],
    [` label: 'Last Hour'`, ` label: t('analytics.lastHour', lang)`],
    [` label: 'Last 24h'`, ` label: t('analytics.last24h', lang)`],
    [` label: 'Reports/hr'`, ` label: t('analytics.reportsPerHr', lang)`],
    [` label: 'Urgent'`, ` label: t('common.urgent', lang)`],
    [` label: 'Unverified'`, ` label: t('common.unverified', lang)`],
    [` label: 'AI Confidence'`, ` label: t('ai.confidence', lang)`],
    [` label: 'Media Attached'`, ` label: t('analytics.mediaAttached', lang)`],
    // SLA
    [`>SLA Performance Targets<`, `>{t('analytics.slaTargets', lang)}<`],
    [`>Service level compliance indicators<`, `>{t('analytics.slaSubtitle', lang)}<`],
    [` label: 'Verification Rate'`, ` label: t('analytics.verificationRate', lang)`],
    [` label: 'Resolution Rate'`, ` label: t('analytics.resolutionRate', lang)`],
    [` label: 'Urgent Response'`, ` label: t('analytics.urgentResponse', lang)`],
    [` label: 'AI Coverage'`, ` label: t('analytics.aiCoverage', lang)`],
    [`>MEETING<`, `>{t('analytics.meeting', lang)}<`],
    [`>BELOW<`, `>{t('analytics.below', lang)}<`],
    // Severity Distribution
    [`>Severity Distribution<`, `>{t('analytics.severityDistribution', lang)}<`],
    // Activity log
    [`>Operator actions, system events, and audit trail<`, `>{t('analytics.activitySubtitle', lang)}<`],
    // Data Quality
    [`>Data Quality Scorecard<`, `>{t('analytics.dataQualityScorecard', lang)}<`],
    [`>Report completeness and coverage metrics<`, `>{t('analytics.dataQualitySubtitle', lang)}<`],
    [` label: 'AI Analyzed'`, ` label: t('analytics.aiAnalyzed', lang)`],
    [` label: 'Has Media'`, ` label: t('analytics.hasMedia', lang)`],
    [` label: 'Has Location'`, ` label: t('analytics.hasLocation', lang)`],
    [` label: 'Verified'`, ` label: t('common.verified', lang)`],
  ])
  if (count > 0) { writeFileSync(file, result, 'utf8'); console.log(`✓ AnalyticsCenter: ${count} replacements`) }
  else console.log('SKIP AnalyticsCenter')
}

// ────────────────────────────────────────────────────────────
// AnalyticsDashboard.tsx
// ────────────────────────────────────────────────────────────
function fixAnalyticsDashboard() {
  const file = join(SRC, 'components/admin/AnalyticsDashboard.tsx')
  let code = readFileSync(file, 'utf8')
  const { result, count } = replaceAll(code, [
    // Range selector
    [`'Last 24h'`, `t('analytics.last24h', lang)`],
    [`'Last 7 days'`, `t('analytics.last7days', lang)`],
    [`'Last 30 days'`, `t('analytics.last30days', lang)`],
    [`'All time'`, `t('analytics.allTime', lang)`],
    // Status labels
    [`>Live stream connected<`, `>{t('analytics.liveStreamConnected', lang)}<`],
    [`>Polling fallback active<`, `>{t('analytics.pollingFallback', lang)}<`],
    // KPI labels
    [` label: 'Reports Today'`, ` label: t('analytics.reportsToday', lang)`],
    [` label: 'Reports This Week'`, ` label: t('analytics.reportsThisWeek', lang)`],
    [` label: 'Total Reports'`, ` label: t('analytics.totalReports', lang)`],
    [` label: 'Avg AI Confidence'`, ` label: t('analytics.avgAIConfidence', lang)`],
    [` label: 'AI Accuracy Rate'`, ` label: t('analytics.aiAccuracyRate', lang)`],
    [` label: 'False Report Rate'`, ` label: t('analytics.falseReportRate', lang)`],
    [` label: 'Verification Rate'`, ` label: t('analytics.verificationRate', lang)`],
    [` label: 'Avg Response Time'`, ` label: t('analytics.avgResponseTime', lang)`],
    [` label: 'Avg Verify Time'`, ` label: t('analytics.avgVerifyTime', lang)`],
    [` label: 'Avg Resolution'`, ` label: t('analytics.avgResolution', lang)`],
    [` label: 'Geographic Coverage'`, ` label: t('analytics.geoCoverage', lang)`],
    [` label: 'Threat Level Index'`, ` label: t('analytics.threatLevelIndex', lang)`],
    // System health
    [`>System Health<`, `>{t('analytics.systemHealth', lang)}<`],
    [`>Database<`, `>{t('analytics.database', lang)}<`],
    [`>Live Stream<`, `>{t('analytics.liveStream', lang)}<`],
    [`>Analytics Engine<`, `>{t('analytics.analyticsEngine', lang)}<`],
    [`>Last Data Sync<`, `>{t('analytics.lastDataSync', lang)}<`],
    [`>Connected<`, `>{t('common.connected', lang)}<`],
    [`>Running<`, `>{t('common.running', lang)}<`],
    // Report volume
    [`>Report Volume + Moving Average<`, `>{t('analytics.reportVolume', lang)}<`],
    [`>No reports in selected range<`, `>{t('analytics.noReportsInRange', lang)}<`],
    [`>Submit a report to generate analytics<`, `>{t('analytics.submitToGenerate', lang)}<`],
    // Severity
    [`>No severity data available<`, `>{t('analytics.noSeverityData', lang)}<`],
    [`>Reports will appear here once submitted<`, `>{t('analytics.reportsAppearHere', lang)}<`],
    // Top incident types
    [`>Top Incident Types<`, `>{t('analytics.topIncidentTypes', lang)}<`],
    [`>No incident categories yet<`, `>{t('analytics.noCategories', lang)}<`],
    [`>Categories will populate as reports arrive<`, `>{t('analytics.categoriesPopulate', lang)}<`],
    // Status distribution
    [`>Status Distribution<`, `>{t('analytics.statusDistribution', lang)}<`],
    [`>No status data available<`, `>{t('analytics.noStatusData', lang)}<`],
    [`>Report statuses will appear here<`, `>{t('analytics.statusesAppear', lang)}<`],
    // Heatmap
    [`>Category Heatmap (Severity)<`, `>{t('analytics.categoryHeatmap', lang)}<`],
    [`>No heatmap data yet<`, `>{t('analytics.noHeatmapData', lang)}<`],
    [`>Cross-category severity data will appear here<`, `>{t('analytics.crossCategoryData', lang)}<`],
    // Location clusters
    [`>Location Clusters<`, `>{t('analytics.locationClusters', lang)}<`],
    [`>No geospatial clusters detected<`, `>{t('analytics.noClusters', lang)}<`],
    [`>Location clusters will appear as reports arrive<`, `>{t('analytics.clustersAppear', lang)}<`],
    // Reports per officer
    [`>Reports per Officer<`, `>{t('analytics.reportsPerOfficer', lang)}<`],
    [`>No officer activity yet<`, `>{t('analytics.noOfficerActivity', lang)}<`],
    [`>Officer performance will be tracked here<`, `>{t('analytics.officerPerformance', lang)}<`],
    // Performance
    [`>Performance Metrics<`, `>{t('analytics.performanceMetrics', lang)}<`],
    // Forecast
    [`>Forecast & Anomaly Intelligence<`, `>{t('analytics.forecastIntel', lang)}<`],
    [`>No forecast data yet<`, `>{t('analytics.noForecastData', lang)}<`],
    [`>Predictions will appear once time-series builds<`, `>{t('analytics.predictionsAppear', lang)}<`],
    // Data quality
    [`>Data Quality & Coverage<`, `>{t('analytics.dataQualityCoverage', lang)}<`],
    // Show more/less
    [`>Show less ▲<`, `>{t('common.showLess', lang)} ▲<`],
  ])
  if (count > 0) { writeFileSync(file, result, 'utf8'); console.log(`✓ AnalyticsDashboard: ${count} replacements`) }
  else console.log('SKIP AnalyticsDashboard')
}

// ────────────────────────────────────────────────────────────
// AITransparencyDashboard.tsx
// ────────────────────────────────────────────────────────────
function fixAITransparencyDashboard() {
  const file = join(SRC, 'components/admin/AITransparencyDashboard.tsx')
  let code = readFileSync(file, 'utf8')
  const { result, count } = replaceAll(code, [
    [`>Dashboard Error<`, `>{t('ai.dashboardError', lang)}<`],
    [`>Retry<`, `>{t('common.retry', lang)}<`],
    [`>No Active Models<`, `>{t('ai.noActiveModels', lang)}<`],
    [`>Models appear after training data`, `>{t('ai.modelsAppear', lang)}`],
    [`>Prediction Performance (Last 24h)<`, `>{t('ai.predictionPerformance', lang)}<`],
    [` label: 'Total Predictions'`, ` label: t('ai.totalPredictions', lang)`],
    [` label: 'Correct'`, ` label: t('ai.correct', lang)`],
    [` label: 'Avg Confidence'`, ` label: t('ai.avgConfidence', lang)`],
    [` label: 'Processing Time'`, ` label: t('ai.processingTime', lang)`],
    // Tabs
    [`>Overview<`, `>{t('common.overview', lang)}<`],
    [`>Models<`, `>{t('ai.models', lang)}<`],
    [`>Drift & Health<`, `>{t('ai.driftHealth', lang)}<`],
    [`>Audit Trail<`, `>{t('audit.title', lang)}<`],
    [`>LLM Providers<`, `>{t('ai.llmProviders', lang)}<`],
    // Quick stats
    [` label: 'Active Models'`, ` label: t('ai.activeModels', lang)`],
    [` label: 'Avg Accuracy'`, ` label: t('ai.avgAccuracy', lang)`],
    [` label: 'Avg F1 Score'`, ` label: t('ai.avgF1Score', lang)`],
    [` label: 'Training Samples'`, ` label: t('ai.trainingSamples', lang)`],
    [` label: 'Drift Alerts'`, ` label: t('ai.driftAlerts', lang)`],
    // Model comparison
    [`>Model Comparison<`, `>{t('ai.modelComparison', lang)}<`],
    [`>Close<`, `>{t('common.close', lang)}<`],
    // Table headers for models
    [`>Model<`, `>{t('ai.model', lang)}<`],
    [`>Version<`, `>{t('ai.version', lang)}<`],
    [`>Accuracy<`, `>{t('ai.accuracy', lang)}<`],
    [`>Precision<`, `>{t('ai.precision', lang)}<`],
    [`>Recall<`, `>{t('ai.recall', lang)}<`],
    [`>F1 Score<`, `>{t('ai.f1Score', lang)}<`],
    [`>Samples<`, `>{t('ai.samples', lang)}<`],
    [`>Trained<`, `>{t('ai.trained', lang)}<`],
    [`>BEST<`, `>{t('ai.best', lang)}<`],
    // Confidence distribution
    [`>Confidence Distribution<`, `>{t('ai.confidenceDistribution', lang)}<`],
    // Detailed metrics
    [`>Detailed Metrics<`, `>{t('ai.detailedMetrics', lang)}<`],
    [`>Confusion Matrix<`, `>{t('ai.confusionMatrix', lang)}<`],
    [`>Actual / Predicted<`, `>{t('ai.actualPredicted', lang)}<`],
    // XAI
    [`>eXplainable AI (XAI) — Feature Importance<`, `>{t('ai.xaiFeatureImportance', lang)}<`],
    // Model drift
    [`>Model Drift Detection<`, `>{t('ai.modelDriftDetection', lang)}<`],
    [`>Check Now<`, `>{t('ai.checkNow', lang)}<`],
    [`>DRIFT DETECTED<`, `>{t('ai.driftDetected', lang)}<`],
    [`>STABLE<`, `>{t('ai.stable', lang)}<`],
    [`>Baseline:<`, `>{t('ai.baseline', lang)}:<`],
    [`>Current:<`, `>{t('ai.current', lang)}:<`],
    [`>All Models Stable<`, `>{t('ai.allModelsStable', lang)}<`],
    // AI Engine Status
    [`>AI Engine Status<`, `>{t('ai.engineStatusTitle', lang)}<`],
    [`>Engine<`, `>{t('ai.engine', lang)}<`],
    [`>Models Loaded<`, `>{t('ai.modelsLoaded', lang)}<`],
    [`>Uptime<`, `>{t('ai.uptime', lang)}<`],
    [`>GPU<`, `>{t('ai.gpu', lang)}<`],
    [`>Available<`, `>{t('common.available', lang)}<`],
    [`>CPU Mode<`, `>{t('ai.cpuMode', lang)}<`],
    // Training status
    [`>Training Status<`, `>{t('ai.trainingStatus', lang)}<`],
    [`>Last Trained<`, `>{t('ai.lastTrained', lang)}<`],
    [`>Submitting...<`, `>{t('ai.submitting', lang)}<`],
    [`>Queued!<`, `>{t('ai.queued', lang)}<`],
    [`>Failed — Retry<`, `>{t('ai.failedRetry', lang)}<`],
    [`>Retrain<`, `>{t('ai.retrain', lang)}<`],
    // Audit trail
    [`>AI Execution Audit Trail<`, `>{t('ai.executionAuditTrail', lang)}<`],
    [`>Time (ms)<`, `>{t('ai.timeMs', lang)}<`],
    [`>Timestamp<`, `>{t('audit.timestamp', lang)}<`],
    [`>Action<`, `>{t('audit.action', lang)}<`],
    [`>Target<`, `>{t('audit.target', lang)}<`],
    [`>Status<`, `>{t('common.status', lang)}<`],
    // LLM Provider Status
    [`>LLM Provider Status<`, `>{t('ai.llmProviderStatus', lang)}<`],
    [`>Refresh<`, `>{t('common.refresh', lang)}<`],
    [`>Online<`, `>{t('common.online', lang)}<`],
    [`>Rate Limited<`, `>{t('ai.rateLimited', lang)}<`],
    [`>Backed Off<`, `>{t('ai.backedOff', lang)}<`],
    [`>Requests<`, `>{t('ai.requests', lang)}<`],
    [`>Errors<`, `>{t('ai.errors', lang)}<`],
    [`>No Providers Configured<`, `>{t('ai.noProviders', lang)}<`],
    [`>LLM Service Unavailable<`, `>{t('ai.llmUnavailable', lang)}<`],
    // Governance
    [`>AI Governance Framework<`, `>{t('ai.governanceFramework', lang)}<`],
    [`>Human-in-the-Loop<`, `>{t('ai.humanInTheLoop', lang)}<`],
    [`>Model Version Control<`, `>{t('ai.modelVersionControl', lang)}<`],
    [`>Audit Logging<`, `>{t('ai.auditLogging', lang)}<`],
  ])
  if (count > 0) { writeFileSync(file, result, 'utf8'); console.log(`✓ AITransparencyDashboard: ${count} replacements`) }
  else console.log('SKIP AITransparencyDashboard')
}

// ────────────────────────────────────────────────────────────
// CommandCenter.tsx (additional strings)
// ────────────────────────────────────────────────────────────
function fixCommandCenter() {
  const file = join(SRC, 'components/admin/CommandCenter.tsx')
  let code = readFileSync(file, 'utf8')
  const { result, count } = replaceAll(code, [
    [`>Live<`, `>{t('common.live', lang)}<`],
    // Systems
    [`>AI Engine<`, `>{t('ai.engine', lang)}<`],
    [`>Workflows<`, `>{t('command.workflows', lang)}<`],
    [`>Database<`, `>{t('analytics.database', lang)}<`],
    [`>Real-time<`, `>{t('command.realTime', lang)}<`],
    [`>Comms<`, `>{t('command.comms', lang)}<`],
    // SitRep
    [`>Situation Brief<`, `>{t('command.situationBrief', lang)}<`],
    [`>Auto-generated from live data<`, `>{t('command.autoGenerated', lang)}<`],
    [`>OPBRIEF<`, `>{t('command.opBrief', lang)}<`],
    [`>THREAT POSTURE:<`, `>{t('command.threatPosture', lang)}:<`],
    [`>Threat Matrix<`, `>{t('command.threatMatrix', lang)}<`],
    [`>Incident types × severity<`, `>{t('command.incidentTypesSeverity', lang)}<`],
    [`>No incident data<`, `>{t('command.noIncidentData', lang)}<`],
    // Severity
    [`>Severity Distribution<`, `>{t('analytics.severityDistribution', lang)}<`],
    [`>Verification Rate<`, `>{t('analytics.verificationRate', lang)}<`],
    [`>Media attached<`, `>{t('analytics.mediaAttached', lang)}<`],
    [`>Resolution rate<`, `>{t('analytics.resolutionRate', lang)}<`],
    // Sort options
    [`>Newest<`, `>{t('command.newest', lang)}<`],
    [`>Oldest<`, `>{t('command.oldest', lang)}<`],
    [`>Severity<`, `>{t('common.severity', lang)}<`],
    // Reports
    [`>Latest incident reports<`, `>{t('command.latestReports', lang)}<`],
    [`>No reports yet<`, `>{t('command.noReportsYet', lang)}<`],
    // Alerts
    [`>Alerts<`, `>{t('command.alerts', lang)}<`],
    // AI Recommendations
    [`>AI Recommendations<`, `>{t('ai.recommendations', lang)}<`],
    [`>All systems nominal<`, `>{t('command.allSystemsNominal', lang)}<`],
    // Quick Actions
    [`>Quick Actions<`, `>{t('command.quickActions', lang)}<`],
    [`>Send Alert<`, `>{t('command.sendAlert', lang)}<`],
    [`>All Reports<`, `>{t('command.allReports', lang)}<`],
    [`>Analytics<`, `>{t('command.analytics', lang)}<`],
    [`>Live Map<`, `>{t('command.liveMap', lang)}<`],
    // Officer Leaderboard
    [`>Officer Leaderboard<`, `>{t('command.officerLeaderboard', lang)}<`],
    [`>Last 7 days performance<`, `>{t('command.last7DaysPerf', lang)}<`],
    [`>avg resp.<`, `>{t('command.avgResp', lang)}<`],
    [`>No leaderboard data yet<`, `>{t('command.noLeaderboardData', lang)}<`],
    [`>Operator actions will appear here<`, `>{t('command.operatorActionsAppear', lang)}<`],
    // Live Activity
    [`>Live Activity Stream<`, `>{t('command.liveActivityStream', lang)}<`],
    [`>Real-time operator actions<`, `>{t('command.realTimeActions', lang)}<`],
    [`>LIVE<`, `>{t('common.live', lang)}<`],
    [`>No activity yet<`, `>{t('command.noActivityYet', lang)}<`],
    [`>Operator actions will stream here in real-time<`, `>{t('command.actionsStreamHere', lang)}<`],
    // Pipeline
    [`>Urgent<`, `>{t('common.urgent', lang)}<`],
    [`>Unverified<`, `>{t('common.unverified', lang)}<`],
    [`>Verified<`, `>{t('common.verified', lang)}<`],
    [`>Flagged<`, `>{t('common.flagged', lang)}<`],
    [`>Resolved<`, `>{t('common.resolved', lang)}<`],
  ])
  if (count > 0) { writeFileSync(file, result, 'utf8'); console.log(`✓ CommandCenter: ${count} replacements`) }
  else console.log('SKIP CommandCenter')
}

// ────────────────────────────────────────────────────────────
// AllReportsManager.tsx (additional strings)
// ────────────────────────────────────────────────────────────
function fixAllReportsManager() {
  const file = join(SRC, 'components/admin/AllReportsManager.tsx')
  let code = readFileSync(file, 'utf8')
  const { result, count } = replaceAll(code, [
    [`>Incident Reports<`, `>{t('allReports.incidentReports', lang)}<`],
    [`>matching current filters<`, `>{t('allReports.matchingFilters', lang)}<`],
    [`>Card view<`, `>{t('allReports.cardView', lang)}<`],
    [`>Table view<`, `>{t('allReports.tableView', lang)}<`],
    [`>Shortcuts:<`, `>{t('common.shortcuts', lang)}:<`],
    [`>Report Pipeline<`, `>{t('allReports.reportPipeline', lang)}<`],
    [`>All<`, `>{t('common.all', lang)}<`],
    [`>Verify<`, `>{t('allReports.verify', lang)}<`],
    [`>Flag<`, `>{t('allReports.flag', lang)}<`],
    [`>Urgent<`, `>{t('common.urgent', lang)}<`],
    [`>Resolve<`, `>{t('common.resolve', lang)}<`],
    [`>24h Activity Timeline<`, `>{t('allReports.activityTimeline', lang)}<`],
    [`>AI Smart Filter<`, `>{t('allReports.aiSmartFilter', lang)}<`],
    [`>Unverified<`, `>{t('common.unverified', lang)}<`],
    [`>Verified<`, `>{t('common.verified', lang)}<`],
    [`>Flagged<`, `>{t('common.flagged', lang)}<`],
    [`>Resolved<`, `>{t('common.resolved', lang)}<`],
  ])
  if (count > 0) { writeFileSync(file, result, 'utf8'); console.log(`✓ AllReportsManager: ${count} replacements`) }
  else console.log('SKIP AllReportsManager')
}

// ────────────────────────────────────────────────────────────
// LoginPage.tsx
// ────────────────────────────────────────────────────────────
function fixLoginPage() {
  const file = join(SRC, 'components/admin/LoginPage.tsx')
  let code = readFileSync(file, 'utf8')
  const { result, count } = replaceAll(code, [
    [`>Real-Time Monitoring<`, `>{t('login.realTimeMonitoring', lang)}<`],
    [`>Live incident tracking across all channels<`, `>{t('login.liveIncidentTracking', lang)}<`],
    [`>AI-Powered Analysis<`, `>{t('login.aiPoweredAnalysis', lang)}<`],
    [`>Automated severity assessment and prediction<`, `>{t('login.automatedSeverity', lang)}<`],
    [`>Secure Access<`, `>{t('login.secureAccess', lang)}<`],
    [`>End-to-end encrypted with role-based controls<`, `>{t('login.endToEndEncrypted', lang)}<`],
    [`>Forgot Password?<`, `>{t('login.forgotPassword', lang)}<`],
    [`>Sign In<`, `>{t('login.signIn', lang)}<`],
    [`>Register<`, `>{t('login.register', lang)}<`],
    [`>Full Name *<`, `>{t('login.fullName', lang)} *<`],
    [`>Email<`, `>{t('login.email', lang)}<`],
    [`>Password<`, `>{t('login.password', lang)}<`],
    [`>Create Password<`, `>{t('login.createPassword', lang)}<`],
    [`>Confirm Password<`, `>{t('login.confirmPassword', lang)}<`],
    [`>Passwords do not match<`, `>{t('login.passwordsMismatch', lang)}<`],
    [`>Passwords match<`, `>{t('login.passwordsMatch', lang)}<`],
    [`'Full name is required.'`, `t('login.nameRequired', lang)`],
    [`'Password does not meet all requirements.'`, `t('login.passwordRequirements', lang)`],
    [`'Passwords do not match.'`, `t('login.passwordsMismatchError', lang)`],
    [`'Account created successfully! Please sign in with your credentials.'`, `t('login.accountCreated', lang)`],
  ])
  if (count > 0) { writeFileSync(file, result, 'utf8'); console.log(`✓ LoginPage: ${count} replacements`) }
  else console.log('SKIP LoginPage')
}

// Run all
fixAnalyticsCenter()
fixAnalyticsDashboard()
fixAITransparencyDashboard()
fixCommandCenter()
fixAllReportsManager()
fixLoginPage()

console.log('\nDone!')
