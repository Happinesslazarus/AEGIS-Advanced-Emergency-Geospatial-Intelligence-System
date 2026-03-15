/**
 * i18n_replace_admin.mjs — Replace hardcoded English strings with t() calls
 * in admin component files. Uses exact string matching for safety.
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
// AITransparencyConsole.tsx
// ────────────────────────────────────────────────────────────
function fixAITransparencyConsole() {
  const file = join(SRC, 'components/admin/AITransparencyConsole.tsx')
  let code = readFileSync(file, 'utf8')
  const { result, count } = replaceAll(code, [
    // Header
    [`AI Command & Governance`, `{t('ai.commandGovernance', lang)}`],
    [`>OPERATIONAL<`, `>{t('common.operational', lang)}<`],
    [`>Model Transparency • Drift Monitoring • Explainability • Audit<`, `>{t('ai.transparencySubtitle', lang)}<`],
    // Pipeline
    [`>AI PIPELINE<`, `>{t('ai.pipeline', lang)}<`],
    [`>ACTIVE<`, `>{t('common.active', lang)}<`],
    [` label: 'INGEST', desc: 'Data Collection'`, ` label: t('ai.ingest', lang), desc: t('ai.dataCollection', lang)`],
    [` label: 'CLASSIFY', desc: 'AI Classification'`, ` label: t('ai.classify', lang), desc: t('ai.aiClassification', lang)`],
    [` label: 'PREDICT', desc: 'Risk Scoring'`, ` label: t('ai.predict', lang), desc: t('ai.riskScoring', lang)`],
    [` label: 'VERIFY', desc: 'Human Review'`, ` label: t('ai.verify', lang), desc: t('ai.humanReview', lang)`],
    [` label: 'ALERT', desc: 'Notification'`, ` label: t('ai.alertStep', lang), desc: t('ai.notification', lang)`],
    // Metrics
    [` label: 'Active Predictions',`, ` label: t('ai.activePredictions', lang),`],
    [` label: 'High Risk Areas',`, ` label: t('ai.highRiskAreas', lang),`],
    [` label: 'Avg Confidence',`, ` label: t('ai.avgConfidence', lang),`],
    [` label: 'Data Sources',`, ` label: t('ai.dataSources', lang),`],
    [` label: 'Heatmap Points',`, ` label: t('ai.heatmapPoints', lang),`],
    [` label: 'Engine Status', value: predictionRunning ? 'Processing' : 'Ready'`, ` label: t('ai.engineStatus', lang), value: predictionRunning ? t('common.processing', lang) : t('common.ready', lang)`],
    // Shortcuts
    [`>Shortcuts:<`, `>{t('common.shortcuts', lang)}:<`],
    [` Refresh</span>`, ` {t('common.refresh', lang)}</span>`],
    [` Run Prediction</span>`, ` {t('ai.runPrediction', lang)}</span>`],
    [` Export</span>`, ` {t('common.export', lang)}</span>`],
    // Flood Engine Header
    [`>AI Flood Intelligence Engine<`, `>{t('ai.floodIntelligenceEngine', lang)}<`],
    [`>Multi-source predictive analytics`, `>{t('ai.multiSourceAnalytics', lang)}`],
    [`> active prediction`, `> {t('ai.activePrediction', lang)}`],
    [`>Processing...<`, `>{t('common.processing', lang)}...<`],
    [`>Online<`, `>{t('common.online', lang)}<`],
    // Empty state
    [`>No active predictions. Model awaiting data from monitored rivers.<`, `>{t('ai.noActivePredictions', lang)}<`],
    // Labels in cards
    [`<span className="font-semibold">Pattern:</span>`, `<span className="font-semibold">{t('ai.pattern', lang)}:</span>`],
    [`<span className="font-semibold">Next Areas:</span>`, `<span className="font-semibold">{t('ai.nextAreas', lang)}:</span>`],
    [`>Send Pre-Alert<`, `>{t('ai.sendPreAlert', lang)}<`],
    [`>Sent<`, `>{t('common.sent', lang)}<`],
    // On-demand
    [`> Run On-Demand Analysis<`, `> {t('ai.runOnDemandAnalysis', lang)}<`],
    [`>Target Area<`, `>{t('ai.targetArea', lang)}<`],
    [`>Model<`, `>{t('ai.model', lang)}<`],
    [`>Analyzing...<`, `>{t('common.analyzing', lang)}...<`],
    [`>Run Analysis<`, `>{t('ai.runAnalysis', lang)}<`],
    // Result labels
    [` label: 'Risk',`, ` label: t('common.risk', lang),`],
    [` label: 'Probability',`, ` label: t('ai.probability', lang),`],
    [` label: 'Confidence',`, ` label: t('ai.confidence', lang),`],
    [` label: 'Peak Time',`, ` label: t('ai.peakTime', lang),`],
    [` label: 'Radius',`, ` label: t('ai.radius', lang),`],
    // Contributing factors
    [`>Contributing Factors<`, `>{t('ai.contributingFactors', lang)}<`],
    // Heatmap
    [`>Heatmap Coverage<`, `>{t('ai.heatmapCoverage', lang)}<`],
    [`> pts<`, `> {t('ai.pts', lang)}<`],
    // Error
    [`'Prediction run failed'`, `t('ai.predictionFailed', lang)`],
    [`'Pre-alert sent'`, `t('ai.preAlertSent', lang)`],
    [`'Failed to send pre-alert'`, `t('ai.preAlertFailed', lang)`],
  ])
  if (count > 0) { writeFileSync(file, result, 'utf8'); console.log(`✓ AITransparencyConsole: ${count} replacements`) }
  else console.log('SKIP AITransparencyConsole')
}

// ────────────────────────────────────────────────────────────
// ResourceDeploymentConsole.tsx
// ────────────────────────────────────────────────────────────
function fixResourceDeploymentConsole() {
  const file = join(SRC, 'components/admin/ResourceDeploymentConsole.tsx')
  let code = readFileSync(file, 'utf8')
  const { result, count } = replaceAll(code, [
    // Status labels
    [` label: 'Request'`, ` label: t('resource.request', lang)`],
    [` label: 'Staging'`, ` label: t('resource.staging', lang)`],
    [` label: 'Transit'`, ` label: t('resource.transit', lang)`],
    [` label: 'On-Site'`, ` label: t('resource.onSite', lang)`],
    [` label: 'De-Mob'`, ` label: t('resource.deMob', lang)`],
    // Header
    [`>Resource Deployment<`, `>{t('resource.deployment', lang)}<`],
    [`>AI-recommended allocation`, `>{t('resource.subtitle', lang)}`],
    // Tabs & KPIs
    [` label: 'Zones'`, ` label: t('resource.zones', lang)`],
    [` label: 'Active'`, ` label: t('common.active', lang)`],
    [` label: 'Critical'`, ` label: t('common.critical', lang)`],
    [` label: 'Reports'`, ` label: t('common.reports', lang)`],
    [` label: 'Affected'`, ` label: t('resource.affected', lang)`],
    [` label: 'Utilization'`, ` label: t('resource.utilization', lang)`],
    // Shortcuts
    [`>Shortcuts<`, `>{t('common.shortcuts', lang)}<`],
    [` Toggle map<`, ` {t('common.toggleMap', lang)}<`],
    [` Search<`, ` {t('common.search', lang)}<`],
    // Asset readiness
    [`>Asset Readiness<`, `>{t('resource.assetReadiness', lang)}<`],
    [`>READINESS<`, `>{t('resource.readiness', lang)}<`],
    // Logistics
    [`>Logistics Pipeline<`, `>{t('resource.logisticsPipeline', lang)}<`],
    // Deployment zones
    [`>Deployment Zones<`, `>{t('resource.deploymentZones', lang)}<`],
    // Placeholders
    [`"Search zones or AI recommendations..."`, `t('resource.searchZones', lang)`],
    [`>All priorities<`, `>{t('resource.allPriorities', lang)}<`],
    [`>All status<`, `>{t('resource.allStatus', lang)}<`],
    [`>Critical<`, `>{t('common.critical', lang)}<`],
    [`>High<`, `>{t('common.high', lang)}<`],
    [`>Medium<`, `>{t('common.medium', lang)}<`],
    [`>Low<`, `>{t('common.low', lang)}<`],
    [`>Deployed<`, `>{t('resource.deployed', lang)}<`],
    [`>Standby<`, `>{t('resource.standby', lang)}<`],
    // Table headers
    [`>Zone<`, `>{t('resource.zone', lang)}<`],
    [`>Priority<`, `>{t('common.priority', lang)}<`],
    [`>Status<`, `>{t('common.status', lang)}<`],
    [`>Reports<`, `>{t('common.reports', lang)}<`],
    [`>Affected<`, `>{t('resource.affected', lang)}<`],
    [`>Assets<`, `>{t('resource.assets', lang)}<`],
    [`>AI Recommendation<`, `>{t('resource.aiRecommendation', lang)}<`],
    [`>Actions<`, `>{t('common.actions', lang)}<`],
    // Buttons
    [`>Deploy<`, `>{t('resource.deploy', lang)}<`],
    [`>Recall<`, `>{t('resource.recall', lang)}<`],
    // Empty state
    [`>No zones match filters<`, `>{t('resource.noZonesMatch', lang)}<`],
    // Activity
    [`>Recent Deployment Activity<`, `>{t('resource.recentActivity', lang)}<`],
    [`>No deployment activity recorded<`, `>{t('resource.noActivity', lang)}<`],
    // Deployment reason
    [`'Deployment reason is required'`, `t('resource.reasonRequired', lang)`],
    // Deploy/Recall Resources buttons
    [`>Deploy Resources<`, `>{t('resource.deployResources', lang)}<`],
    [`>Recall Resources<`, `>{t('resource.recallResources', lang)}<`],
  ])
  if (count > 0) { writeFileSync(file, result, 'utf8'); console.log(`✓ ResourceDeploymentConsole: ${count} replacements`) }
  else console.log('SKIP ResourceDeploymentConsole')
}

// ────────────────────────────────────────────────────────────
// UserAccessManagement.tsx
// ────────────────────────────────────────────────────────────
function fixUserAccessManagement() {
  const file = join(SRC, 'components/admin/UserAccessManagement.tsx')
  let code = readFileSync(file, 'utf8')
  const { result, count } = replaceAll(code, [
    // Header
    [`>Identity & Access Management<`, `>{t('users.identityAccessMgmt', lang)}<`],
    [`>Role-based access control`, `>{t('users.subtitle', lang)}`],
    // Tabs
    [`>User Directory<`, `>{t('users.userDirectory', lang)}<`],
    [`>Audit Trail<`, `>{t('audit.title', lang)}<`],
    [`>Roles & Permissions<`, `>{t('users.rolesPermissions', lang)}<`],
    [`>Access Overview<`, `>{t('users.accessOverview', lang)}<`],
    // KPIs
    [` label: 'Total'`, ` label: t('common.total', lang)`],
    [` label: 'Active'`, ` label: t('common.active', lang)`],
    [` label: 'Suspended'`, ` label: t('users.suspended', lang)`],
    [` label: 'Inactive'`, ` label: t('users.inactive', lang)`],
    [` label: 'Admins'`, ` label: t('users.admins', lang)`],
    [` label: 'Operators'`, ` label: t('users.operators', lang)`],
    [` label: 'Viewers'`, ` label: t('users.viewers', lang)`],
    [` label: '24h Logins'`, ` label: t('users.24hLogins', lang)`],
    // Table headers
    [`>User<`, `>{t('users.user', lang)}<`],
    [`>Role<`, `>{t('users.role', lang)}<`],
    [`>Department<`, `>{t('users.department', lang)}<`],
    [`>Status<`, `>{t('common.status', lang)}<`],
    [`>Last Login<`, `>{t('users.lastLogin', lang)}<`],
    [`>Created<`, `>{t('common.created', lang)}<`],
    [`>Actions<`, `>{t('common.actions', lang)}<`],
    // Filters
    [`"Search by name, email, department, or ID..."`, `t('users.searchPlaceholder', lang)`],
    [`>All Roles<`, `>{t('users.allRoles', lang)}<`],
    [`>Admin<`, `>{t('users.admin', lang)}<`],
    [`>Operator<`, `>{t('users.operator', lang)}<`],
    [`>Viewer<`, `>{t('users.viewer', lang)}<`],
    [`>All Status<`, `>{t('users.allStatus', lang)}<`],
    [`>Active<`, `>{t('common.active', lang)}<`],
    [`>Suspended<`, `>{t('users.suspended', lang)}<`],
    [`>Inactive<`, `>{t('users.inactive', lang)}<`],
    [`>All Departments<`, `>{t('users.allDepartments', lang)}<`],
    [`>Unassigned<`, `>{t('users.unassigned', lang)}<`],
    // Bulk actions
    [`>Bulk action...<`, `>{t('users.bulkAction', lang)}<`],
    [`>Suspend<`, `>{t('users.suspend', lang)}<`],
    [`>Activate<`, `>{t('users.activate', lang)}<`],
    [`>Delete<`, `>{t('common.delete', lang)}<`],
  ])
  if (count > 0) { writeFileSync(file, result, 'utf8'); console.log(`✓ UserAccessManagement: ${count} replacements`) }
  else console.log('SKIP UserAccessManagement')
}

// ────────────────────────────────────────────────────────────
// AdminAlertBroadcast.tsx 
// ────────────────────────────────────────────────────────────
function fixAdminAlertBroadcast() {
  const file = join(SRC, 'components/admin/AdminAlertBroadcast.tsx')
  let code = readFileSync(file, 'utf8')
  const { result, count } = replaceAll(code, [
    // Header
    [`>Emergency Alert Broadcast<`, `>{t('broadcast.title', lang)}<`],
    [`>Multi-channel emergency alerting system<`, `>{t('broadcast.subtitle', lang)}<`],
    // Severity
    [`>Severity Level<`, `>{t('broadcast.severityLevel', lang)}<`],
    [`>Critical<`, `>{t('common.critical', lang)}<`],
    [`>Warning<`, `>{t('common.warning', lang)}<`],
    [`>Advisory<`, `>{t('broadcast.advisory', lang)}<`],
    // Form
    [`>Alert Title<`, `>{t('broadcast.alertTitle', lang)}<`],
    [`"e.g. Flash Flood Warning — River Don"`, `t('broadcast.titlePlaceholder', lang)`],
    [`>Alert Message<`, `>{t('broadcast.alertMessage', lang)}<`],
    [`>Message is very short<`, `>{t('broadcast.messageShort', lang)}<`],
    [`>Affected Area<`, `>{t('broadcast.affectedArea', lang)}<`],
    [`"e.g. City Centre, Bridge of Don, Coastal areas"`, `t('broadcast.areaPlaceholder', lang)`],
    // Channels
    [`>Delivery Channels<`, `>{t('broadcast.deliveryChannels', lang)}<`],
    [`>Select All<`, `>{t('common.selectAll', lang)}<`],
    // Channel names
    [`'Web Push'`, `t('broadcast.webPush', lang)`],
    [`'Telegram'`, `t('broadcast.telegram', lang)`],
    [`'Email'`, `t('broadcast.email', lang)`],
    [`'SMS'`, `t('broadcast.sms', lang)`],
    [`'WhatsApp'`, `t('broadcast.whatsapp', lang)`],
    // Actions
    [`>Broadcast Emergency Alert<`, `>{t('broadcast.broadcastAlert', lang)}<`],
    [`>Fill in title and message to enable broadcast<`, `>{t('broadcast.fillTitleMsg', lang)}<`],
    // Confirm modal
    [`>Confirm Broadcast<`, `>{t('broadcast.confirmBroadcast', lang)}<`],
    [`>This will send to all subscribed citizens<`, `>{t('broadcast.confirmMsg', lang)}<`],
    [`>Severity<`, `>{t('broadcast.severity', lang)}<`],
    [`>Title<`, `>{t('broadcast.titleLabel', lang)}<`],
    [`>Message<`, `>{t('broadcast.messageLabel', lang)}<`],
    [`>Channels:<`, `>{t('broadcast.channelsLabel', lang)}:<`],
    [`>CRITICAL ALERT:<`, `>{t('broadcast.criticalAlert', lang)}:<`],
    [`>This will trigger high-priority notifications on all selected channels.<`, `>{t('broadcast.criticalWarning', lang)}<`],
    // Summary
    [`>Delivery Summary<`, `>{t('broadcast.deliverySummary', lang)}<`],
    [`>Attempted<`, `>{t('delivery.attempted', lang)}<`],
    [`>Delivered<`, `>{t('delivery.delivered', lang)}<`],
    [`>Failed<`, `>{t('delivery.failed', lang)}<`],
    [`>Channel Results<`, `>{t('delivery.channelResults', lang)}<`],
    [`>Recent Broadcasts<`, `>{t('broadcast.recentBroadcasts', lang)}<`],
  ])
  if (count > 0) { writeFileSync(file, result, 'utf8'); console.log(`✓ AdminAlertBroadcast: ${count} replacements`) }
  else console.log('SKIP AdminAlertBroadcast')
}

// ────────────────────────────────────────────────────────────
// AdminAuditTrail.tsx
// ────────────────────────────────────────────────────────────
function fixAdminAuditTrail() {
  const file = join(SRC, 'components/admin/AdminAuditTrail.tsx')
  let code = readFileSync(file, 'utf8')
  const { result, count } = replaceAll(code, [
    [`>Compliance Audit Trail<`, `>{t('audit.complianceTitle', lang)}<`],
    [`>Immutable operator action log`, `>{t('audit.subtitle', lang)}`],
    [`>Export CSV<`, `>{t('common.exportCSV', lang)}<`],
    [`>Refresh<`, `>{t('common.refresh', lang)}<`],
    [` label: 'Total Entries'`, ` label: t('audit.totalEntries', lang)`],
    [` label: 'Today'`, ` label: t('audit.today', lang)`],
    [` label: 'This Week'`, ` label: t('audit.thisWeek', lang)`],
    [` label: 'Critical Actions'`, ` label: t('audit.criticalActions', lang)`],
    [` label: 'Operators'`, ` label: t('audit.operators', lang)`],
    [` label: 'Action Types'`, ` label: t('audit.actionTypes', lang)`],
    [`>7-Day Activity<`, `>{t('audit.sevenDayActivity', lang)}<`],
    [`>entries this week<`, `>{t('audit.entriesThisWeek', lang)}<`],
    [`>Top Operators<`, `>{t('audit.topOperators', lang)}<`],
    [`>Action Types<`, `>{t('audit.actionTypes', lang)}<`],
    // Table headers
    [`>Type<`, `>{t('common.type', lang)}<`],
    [`>Action<`, `>{t('audit.action', lang)}<`],
    [`>Operator<`, `>{t('audit.operator', lang)}<`],
    [`>Target<`, `>{t('audit.target', lang)}<`],
    [`>Details<`, `>{t('common.details', lang)}<`],
    [`>Timestamp<`, `>{t('audit.timestamp', lang)}<`],
    [`>Before<`, `>{t('audit.before', lang)}<`],
    [`>After<`, `>{t('audit.after', lang)}<`],
    [`>State Change<`, `>{t('audit.stateChange', lang)}<`],
    [`>IP Address<`, `>{t('audit.ipAddress', lang)}<`],
    [`>Browser<`, `>{t('audit.browser', lang)}<`],
    [`>Operator ID<`, `>{t('audit.operatorId', lang)}<`],
    [`>Previous<`, `>{t('common.previous', lang)}<`],
    [`>Next<`, `>{t('common.next', lang)}<`],
  ])
  if (count > 0) { writeFileSync(file, result, 'utf8'); console.log(`✓ AdminAuditTrail: ${count} replacements`) }
  else console.log('SKIP AdminAuditTrail')
}

// ────────────────────────────────────────────────────────────
// AdminHistoricalIntelligence.tsx
// ────────────────────────────────────────────────────────────
function fixAdminHistoricalIntelligence() {
  const file = join(SRC, 'components/admin/AdminHistoricalIntelligence.tsx')
  let code = readFileSync(file, 'utf8')
  const { result, count } = replaceAll(code, [
    [`>Historical Intelligence<`, `>{t('historical.title', lang)}<`],
    [`>Event archive, flood heatmap`, `>{t('historical.subtitle', lang)}`],
    [`>Export All CSV<`, `>{t('common.exportAllCSV', lang)}<`],
    [` label: 'Total Events'`, ` label: t('historical.totalEvents', lang)`],
    [` label: 'High Severity'`, ` label: t('historical.highSeverity', lang)`],
    [` label: 'People Affected'`, ` label: t('historical.peopleAffected', lang)`],
    [` label: 'Total Damage'`, ` label: t('historical.totalDamage', lang)`],
    [` label: 'Avg Affected'`, ` label: t('historical.avgAffected', lang)`],
    [` label: 'Event Types'`, ` label: t('historical.eventTypes', lang)`],
    [`>Distribution:<`, `>{t('historical.distribution', lang)}:<`],
    [`>Flood Risk Heatmap<`, `>{t('historical.floodRiskHeatmap', lang)}<`],
    [`>Historical intensity from past events<`, `>{t('historical.heatmapSubtitle', lang)}<`],
    [`>High<`, `>{t('common.high', lang)}<`],
    [`>Medium<`, `>{t('common.medium', lang)}<`],
    [`>Low<`, `>{t('common.low', lang)}<`],
    [`>Expand map<`, `>{t('map.expand', lang)}<`],
    [`>Collapse map<`, `>{t('map.collapse', lang)}<`],
    [`>Seasonal Flood Trends<`, `>{t('historical.seasonalTrends', lang)}<`],
    [`>Monthly flood frequency, rainfall, and severity analysis<`, `>{t('historical.seasonalSubtitle', lang)}<`],
    [` label: 'Floods'`, ` label: t('flood.floods', lang)`],
    [` label: 'Rainfall'`, ` label: t('weather.rainfall', lang)`],
    [` label: 'Severity'`, ` label: t('common.severity', lang)`],
    [`>Total Floods:<`, `>{t('historical.totalFloods', lang)}:<`],
    [`>Total Rainfall:<`, `>{t('historical.totalRainfall', lang)}:<`],
    [`>Peak Month:<`, `>{t('historical.peakMonth', lang)}:<`],
    [`>Avg Severity:<`, `>{t('historical.avgSeverity', lang)}:<`],
    [`>No events to display<`, `>{t('historical.noEvents', lang)}<`],
    [`>Coordinates<`, `>{t('historical.coordinates', lang)}<`],
    [`>Impact<`, `>{t('historical.impact', lang)}<`],
    [`>Damage Cost<`, `>{t('historical.damageCost', lang)}<`],
  ])
  if (count > 0) { writeFileSync(file, result, 'utf8'); console.log(`✓ AdminHistoricalIntelligence: ${count} replacements`) }
  else console.log('SKIP AdminHistoricalIntelligence')
}

// ────────────────────────────────────────────────────────────
// AdminMessaging.tsx
// ────────────────────────────────────────────────────────────
function fixAdminMessaging() {
  const file = join(SRC, 'components/admin/AdminMessaging.tsx')
  let code = readFileSync(file, 'utf8')
  const { result, count } = replaceAll(code, [
    // Quick reply templates - keep English text as they're messages
    // Header
    [`>Citizen Inbox<`, `>{t('messaging.citizenInbox', lang)}<`],
    [`>total conversations<`, `>{t('messaging.totalConversations', lang)}<`],
    [`>Emergency<`, `>{t('common.emergency', lang)}<`],
    [`>Open<`, `>{t('common.open', lang)}<`],
    [`>Active<`, `>{t('common.active', lang)}<`],
    [`>Done<`, `>{t('common.done', lang)}<`],
    // Search
    [`"Search by name, subject, or message..."`, `t('messaging.searchPlaceholder', lang)`],
    // Tabs
    [`>All<`, `>{t('common.all', lang)}<`],
    [`>SOS<`, `>{t('sos.title', lang)}<`],
    [`>Mine<`, `>{t('messaging.mine', lang)}<`],
    // Empty states
    [`>No conversations<`, `>{t('messaging.noConversations', lang)}<`],
    [`>Matching threads will appear here<`, `>{t('messaging.matchingThreads', lang)}<`],
    // Main panel
    [`>Citizen Support Inbox<`, `>{t('messaging.supportInbox', lang)}<`],
    [`>Select a conversation from the inbox to view messages, respond to citizens, and manage support threads.<`, `>{t('messaging.selectConversation', lang)}<`],
    // Toolbar
    [`>Quick Replies<`, `>{t('messaging.quickReplies', lang)}<`],
    [`>Translation<`, `>{t('messaging.translation', lang)}<`],
    [`>Priority<`, `>{t('common.priority', lang)}<`],
    [`>Assign<`, `>{t('messaging.assign', lang)}<`],
    [`>Resolve<`, `>{t('messaging.resolve', lang)}<`],
    // Thread labels
    [`>EMERGENCY THREAD<`, `>{t('messaging.emergencyThread', lang)}<`],
    [`>Auto-escalated due to emergency keywords<`, `>{t('messaging.autoEscalated', lang)}<`],
    [`>Priority Support<`, `>{t('messaging.prioritySupport', lang)}<`],
    [`>Vulnerable citizen — respond with care and urgency<`, `>{t('messaging.vulnerableCitizen', lang)}<`],
    [`>No messages yet<`, `>{t('messaging.noMessages', lang)}<`],
    [`>Start the conversation by sending a message below<`, `>{t('messaging.startConversation', lang)}<`],
    [`>Today<`, `>{t('time.today', lang)}<`],
    [`>Yesterday<`, `>{t('time.yesterday', lang)}<`],
    [`>Citizen<`, `>{t('messaging.citizen', lang)}<`],
    [`>Operator<`, `>{t('messaging.operator', lang)}<`],
    [`> is typing...<`, `> {t('messaging.isTyping', lang)}<`],
    [`"Type a professional reply..."`, `t('messaging.replyPlaceholder', lang)`],
  ])
  if (count > 0) { writeFileSync(file, result, 'utf8'); console.log(`✓ AdminMessaging: ${count} replacements`) }
  else console.log('SKIP AdminMessaging')
}

// ────────────────────────────────────────────────────────────
// AnalyticsCenter.tsx
// ────────────────────────────────────────────────────────────
function fixAnalyticsCenter() {
  const file = join(SRC, 'components/admin/AnalyticsCenter.tsx')
  let code = readFileSync(file, 'utf8')
  const { result, count } = replaceAll(code, [
    [`>Analytics Center<`, `>{t('analytics.center', lang)}<`],
    [`>Operational intelligence`, `>{t('analytics.subtitle', lang)}`],
    [`>OPERATIONAL<`, `>{t('common.operational', lang)}<`],
    // Tabs and KPIs will be done per file reading
  ])
  if (count > 0) { writeFileSync(file, result, 'utf8'); console.log(`✓ AnalyticsCenter: ${count} replacements`) }
  else console.log('SKIP AnalyticsCenter')
}

// ────────────────────────────────────────────────────────────
// DistressPanel.tsx
// ────────────────────────────────────────────────────────────
function fixDistressPanel() {
  const file = join(SRC, 'components/admin/DistressPanel.tsx')
  let code = readFileSync(file, 'utf8')
  const { result, count } = replaceAll(code, [
    [`>Distress Beacon Monitor<`, `>{t('distress.beaconMonitor', lang)}<`],
    [`>Active Beacons<`, `>{t('distress.activeBeacons', lang)}<`],
    [`>Critical<`, `>{t('common.critical', lang)}<`],
    [`>Avg Response<`, `>{t('distress.avgResponse', lang)}<`],
    [`>No active distress beacons<`, `>{t('distress.noActiveBeacons', lang)}<`],
    [`>Respond<`, `>{t('distress.respond', lang)}<`],
    [`>Dismiss<`, `>{t('common.dismiss', lang)}<`],
  ])
  if (count > 0) { writeFileSync(file, result, 'utf8'); console.log(`✓ DistressPanel: ${count} replacements`) }
  else console.log('SKIP DistressPanel')
}

// ────────────────────────────────────────────────────────────
// LiveOperationsMap.tsx
// ────────────────────────────────────────────────────────────
function fixLiveOperationsMap() {
  const file = join(SRC, 'components/admin/LiveOperationsMap.tsx')
  let code = readFileSync(file, 'utf8')
  const { result, count } = replaceAll(code, [
    [`>Live Operations Map<`, `>{t('liveOps.title', lang)}<`],
    [`>Real-time operational`, `>{t('liveOps.subtitle', lang)}`],
    [`>Layers<`, `>{t('map.layers', lang)}<`],
    [`>Incidents<`, `>{t('common.incidents', lang)}<`],
    [`>Resources<`, `>{t('common.resources', lang)}<`],
    [`>Flood Zones<`, `>{t('flood.zones', lang)}<`],
    [`>Heatmap<`, `>{t('map.heatmap', lang)}<`],
    [`>No incidents to display<`, `>{t('liveOps.noIncidents', lang)}<`],
  ])
  if (count > 0) { writeFileSync(file, result, 'utf8'); console.log(`✓ LiveOperationsMap: ${count} replacements`) }
  else console.log('SKIP LiveOperationsMap')
}

// ────────────────────────────────────────────────────────────
// DeliveryDashboard.tsx
// ────────────────────────────────────────────────────────────
function fixDeliveryDashboard() {
  const file = join(SRC, 'components/admin/DeliveryDashboard.tsx')
  let code = readFileSync(file, 'utf8')
  const { result, count } = replaceAll(code, [
    [`>Delivery Dashboard<`, `>{t('delivery.dashboard', lang)}<`],
    [`>Multi-channel delivery`, `>{t('delivery.subtitle', lang)}`],
    [`>Total Sent<`, `>{t('delivery.totalSent', lang)}<`],
    [`>Delivered<`, `>{t('delivery.delivered', lang)}<`],
    [`>Failed<`, `>{t('delivery.failed', lang)}<`],
    [`>Pending<`, `>{t('delivery.pending', lang)}<`],
    [`>Success Rate<`, `>{t('delivery.successRate', lang)}<`],
    [`>Channel Performance<`, `>{t('delivery.channelPerformance', lang)}<`],
    [`>Recent Deliveries<`, `>{t('delivery.recentDeliveries', lang)}<`],
    [`>No delivery records<`, `>{t('delivery.noRecords', lang)}<`],
    [`>Retry<`, `>{t('delivery.retry', lang)}<`],
  ])
  if (count > 0) { writeFileSync(file, result, 'utf8'); console.log(`✓ DeliveryDashboard: ${count} replacements`) }
  else console.log('SKIP DeliveryDashboard')
}

// ────────────────────────────────────────────────────────────
// IncidentCommandConsole.tsx
// ────────────────────────────────────────────────────────────
function fixIncidentCommandConsole() {
  const file = join(SRC, 'components/admin/IncidentCommandConsole.tsx')
  let code = readFileSync(file, 'utf8')
  const { result, count } = replaceAll(code, [
    [`>Incident Command<`, `>{t('command.title', lang)}<`],
    [`>Tactical incident management`, `>{t('command.subtitle', lang)}`],
    [`>Active Incidents<`, `>{t('command.activeIncidents', lang)}<`],
    [`>Resolved<`, `>{t('common.resolved', lang)}<`],
    [`>No incidents<`, `>{t('command.noIncidents', lang)}<`],
    [`>Select an incident to view details<`, `>{t('command.selectIncident', lang)}<`],
    [`>Escalate<`, `>{t('command.escalate', lang)}<`],
    [`>Resolve<`, `>{t('common.resolve', lang)}<`],
    [`>Timeline<`, `>{t('command.timeline', lang)}<`],
    [`>Responders<`, `>{t('command.responders', lang)}<`],
  ])
  if (count > 0) { writeFileSync(file, result, 'utf8'); console.log(`✓ IncidentCommandConsole: ${count} replacements`) }
  else console.log('SKIP IncidentCommandConsole')
}

// Run all
fixAITransparencyConsole()
fixResourceDeploymentConsole()
fixUserAccessManagement()
fixAdminAlertBroadcast()
fixAdminAuditTrail()
fixAdminHistoricalIntelligence()
fixAdminMessaging()
fixAnalyticsCenter()
fixDistressPanel()
fixLiveOperationsMap()
fixDeliveryDashboard()
fixIncidentCommandConsole()

console.log('\nDone!')
