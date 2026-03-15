/**
 * i18n_replace_citizen.mjs — Replace hardcoded English strings in citizen components
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
// ShelterFinder.tsx
// ────────────────────────────────────────────────────────────
function fixShelterFinder() {
  const file = join(SRC, 'components/citizen/ShelterFinder.tsx')
  let code = readFileSync(file, 'utf8')
  const { result, count } = replaceAll(code, [
    [`>Safe Zones<`, `>{t('shelter.safeZones', lang)}<`],
    [`>Live<`, `>{t('common.live', lang)}<`],
    [`>Searching real locations via OpenStreetMap...<`, `>{t('shelter.searchingOSM', lang)}<`],
    [`>Source unavailable – retry to load<`, `>{t('shelter.sourceUnavailable', lang)}<`],
    [`>GPS<`, `>{t('common.gps', lang)}<`],
    [`>Refresh data<`, `>{t('common.refreshData', lang)}<`],
    [`"Search city, postcode, or address..."`, `t('shelter.searchPlaceholder', lang)`],
    [`>Find Zones<`, `>{t('shelter.findZones', lang)}<`],
    [`>Enable location to see local data<`, `>{t('shelter.enableLocation', lang)}<`],
    [`>Nearest Open Safe Zone<`, `>{t('shelter.nearestOpen', lang)}<`],
    [`>Open<`, `>{t('common.open', lang)}<`],
    [`>Directions<`, `>{t('shelter.directions', lang)}<`],
    [`>Total Zones<`, `>{t('shelter.totalZones', lang)}<`],
    [`>Open Now<`, `>{t('shelter.openNow', lang)}<`],
    [`>Nearest<`, `>{t('shelter.nearest', lang)}<`],
    [`>Avg Capacity<`, `>{t('shelter.avgCapacity', lang)}<`],
    [`>Zone Type Distribution<`, `>{t('shelter.typeDistribution', lang)}<`],
    [`>All Zones<`, `>{t('shelter.allZones', lang)}<`],
    [`>Open Only<`, `>{t('shelter.openOnly', lang)}<`],
    [`>Show All<`, `>{t('shelter.showAll', lang)}<`],
    [`>Searching OpenStreetMap...<`, `>{t('shelter.searchingOSM', lang)}<`],
    [`>Data source unavailable<`, `>{t('shelter.dataUnavailable', lang)}<`],
    [`>Retry<`, `>{t('common.retry', lang)}<`],
    [`>Set your location to discover safe zones<`, `>{t('shelter.setLocation', lang)}<`],
    [`>Use My Location<`, `>{t('shelter.useMyLocation', lang)}<`],
    [`>or search above<`, `>{t('shelter.orSearchAbove', lang)}<`],
    [`>No matching safe zones<`, `>{t('shelter.noMatching', lang)}<`],
    [`>OPEN<`, `>{t('common.open', lang)}<`],
    [`>CLOSED<`, `>{t('common.closed', lang)}<`],
  ])
  if (count > 0) { writeFileSync(file, result, 'utf8'); console.log(`✓ ShelterFinder: ${count} replacements`) }
  else console.log('SKIP ShelterFinder')
}

// ────────────────────────────────────────────────────────────
// SOSButton.tsx
// ────────────────────────────────────────────────────────────
function fixSOSButton() {
  const file = join(SRC, 'components/citizen/SOSButton.tsx')
  let code = readFileSync(file, 'utf8')
  const { result, count } = replaceAll(code, [
    [`>Emergency SOS<`, `>{t('sos.emergencySOS', lang)}<`],
    [`>Activating SOS...<`, `>{t('sos.activating', lang)}<`],
    [`>SOS ACTIVE<`, `>{t('sos.sosActive', lang)}<`],
    [`>HELP COMING<`, `>{t('sos.helpComing', lang)}<`],
    [`>RESOLVED<`, `>{t('sos.resolved', lang)}<`],
    [`>Cancelled<`, `>{t('sos.cancelled', lang)}<`],
    [`>Broadcasting location to emergency operators<`, `>{t('sos.broadcasting', lang)}<`],
    [`>Press SOS to activate<`, `>{t('sos.pressActivate', lang)}<`],
    [`>GPS signal acquired<`, `>{t('sos.gpsAcquired', lang)}<`],
    [`>Beacon transmitted<`, `>{t('sos.beaconTransmitted', lang)}<`],
    [`>Operator acknowledged<`, `>{t('sos.operatorAcknowledged', lang)}<`],
    [`>Situation resolved<`, `>{t('sos.situationResolved', lang)}<`],
    [`>Cancel<`, `>{t('common.cancel', lang)}<`],
    [`>Cancel SOS<`, `>{t('sos.cancelSOS', lang)}<`],
    [`>Triage:<`, `>{t('sos.triage', lang)}:<`],
  ])
  if (count > 0) { writeFileSync(file, result, 'utf8'); console.log(`✓ SOSButton: ${count} replacements`) }
  else console.log('SKIP SOSButton')
}

// ────────────────────────────────────────────────────────────
// SafetyCheckIn.tsx
// ────────────────────────────────────────────────────────────
function fixSafetyCheckIn() {
  const file = join(SRC, 'components/citizen/SafetyCheckIn.tsx')
  let code = readFileSync(file, 'utf8')
  const { result, count } = replaceAll(code, [
    [`>Are You Safe?<`, `>{t('safetyCheck.areYouSafe', lang)}<`],
    [`>I'm Safe<`, `>{t('safetyCheck.imSafe', lang)}<`],
    [`>Need Help<`, `>{t('safetyCheck.needHelp', lang)}<`],
    [`>Unsure<`, `>{t('safetyCheck.unsure', lang)}<`],
  ])
  if (count > 0) { writeFileSync(file, result, 'utf8'); console.log(`✓ SafetyCheckIn: ${count} replacements`) }
  else console.log('SKIP SafetyCheckIn')
}

// ────────────────────────────────────────────────────────────
// CrowdDensityHeatmap.tsx
// ────────────────────────────────────────────────────────────
function fixCrowdDensityHeatmap() {
  const file = join(SRC, 'components/citizen/CrowdDensityHeatmap.tsx')
  let code = readFileSync(file, 'utf8')
  const { result, count } = replaceAll(code, [
    [`>Crowd Density<`, `>{t('crowd.title', lang)}<`],
    [`>LIVE<`, `>{t('common.live', lang)}<`],
    [`>Zones<`, `>{t('resource.zones', lang)}<`],
    [`>People<`, `>{t('crowd.people', lang)}<`],
    [`>Density<`, `>{t('crowd.density', lang)}<`],
    [`>Alerts<`, `>{t('command.alerts', lang)}<`],
    [`>Rising<`, `>{t('crowd.rising', lang)}<`],
    [`>All<`, `>{t('common.all', lang)}<`],
    [`>Critical<`, `>{t('common.critical', lang)}<`],
    [`>High<`, `>{t('common.high', lang)}<`],
    [`>Moderate<`, `>{t('common.moderate', lang)}<`],
    [`>Low<`, `>{t('common.low', lang)}<`],
    [`>No zones match this filter<`, `>{t('crowd.noZonesMatch', lang)}<`],
  ])
  if (count > 0) { writeFileSync(file, result, 'utf8'); console.log(`✓ CrowdDensityHeatmap: ${count} replacements`) }
  else console.log('SKIP CrowdDensityHeatmap')
}

// ────────────────────────────────────────────────────────────
// LiveIncidentMapPanel.tsx
// ────────────────────────────────────────────────────────────
function fixLiveIncidentMapPanel() {
  const file = join(SRC, 'components/citizen/LiveIncidentMapPanel.tsx')
  let code = readFileSync(file, 'utf8')
  const { result, count } = replaceAll(code, [
    [`>Live Incident Map<`, `>{t('incident.liveMap', lang)}<`],
    [`>Connected<`, `>{t('common.connected', lang)}<`],
    [`>Activity<`, `>{t('incident.activity', lang)}<`],
  ])
  if (count > 0) { writeFileSync(file, result, 'utf8'); console.log(`✓ LiveIncidentMapPanel: ${count} replacements`) }
  else console.log('SKIP LiveIncidentMapPanel')
}

// ────────────────────────────────────────────────────────────
// CitizenMessaging.tsx
// ────────────────────────────────────────────────────────────
function fixCitizenMessaging() {
  const file = join(SRC, 'components/citizen/CitizenMessaging.tsx')
  let code = readFileSync(file, 'utf8')
  const { result, count } = replaceAll(code, [
    [`>My Messages<`, `>{t('citizenMsg.myMessages', lang)}<`],
    [`>Unread<`, `>{t('citizenMsg.unread', lang)}<`],
    [`>Open<`, `>{t('common.open', lang)}<`],
    [`>Active<`, `>{t('common.active', lang)}<`],
    [`"Search conversations..."`, `t('citizenMsg.searchConversations', lang)`],
    [`>Today<`, `>{t('time.today', lang)}<`],
    [`>Yesterday<`, `>{t('time.yesterday', lang)}<`],
    [`'Please select an image file'`, `t('citizenMsg.selectImageFile', lang)`],
    [`'Image must be less than 5MB'`, `t('citizenMsg.imageSizeLimit', lang)`],
    [`'Failed to upload image'`, `t('citizenMsg.uploadFailed', lang)`],
    [`'Failed to send message'`, `t('citizenMsg.sendFailed', lang)`],
  ])
  if (count > 0) { writeFileSync(file, result, 'utf8'); console.log(`✓ CitizenMessaging: ${count} replacements`) }
  else console.log('SKIP CitizenMessaging')
}

// ────────────────────────────────────────────────────────────
// AlertSubscribe.tsx
// ────────────────────────────────────────────────────────────
function fixAlertSubscribe() {
  const file = join(SRC, 'components/citizen/AlertSubscribe.tsx')
  let code = readFileSync(file, 'utf8')
  const { result, count } = replaceAll(code, [
    [`>Alert Channels<`, `>{t('alertSub.channels', lang)}<`],
    [`>Subscribe to Alerts<`, `>{t('alertSub.subscribe', lang)}<`],
    [`>Subscribed!<`, `>{t('alertSub.subscribed', lang)}<`],
    [`>Done<`, `>{t('common.done', lang)}<`],
    [`'Select at least one alert channel.'`, `t('alertSub.selectChannel', lang)`],
  ])
  if (count > 0) { writeFileSync(file, result, 'utf8'); console.log(`✓ AlertSubscribe: ${count} replacements`) }
  else console.log('SKIP AlertSubscribe')
}

// ────────────────────────────────────────────────────────────
// OnboardingTutorial.tsx
// ────────────────────────────────────────────────────────────
function fixOnboardingTutorial() {
  const file = join(SRC, 'components/citizen/OnboardingTutorial.tsx')
  let code = readFileSync(file, 'utf8')
  const { result, count } = replaceAll(code, [
    [`>Skip<`, `>{t('common.skip', lang)}<`],
    [`>Next<`, `>{t('common.next', lang)}<`],
    [`>Get Started<`, `>{t('common.getStarted', lang)}<`],
  ])
  if (count > 0) { writeFileSync(file, result, 'utf8'); console.log(`✓ OnboardingTutorial: ${count} replacements`) }
  else console.log('SKIP OnboardingTutorial')
}

// ────────────────────────────────────────────────────────────
// CommunityGuidelines.tsx
// ────────────────────────────────────────────────────────────
function fixCommunityGuidelines() {
  const file = join(SRC, 'components/citizen/CommunityGuidelines.tsx')
  let code = readFileSync(file, 'utf8')
  const { result, count } = replaceAll(code, [
    [`>Community Guidelines<`, `>{t('community.guidelines', lang)}<`],
    [`>Please review our guidelines before posting<`, `>{t('community.guidelinesSubtitle', lang)}<`],
    [`>Be Respectful & Kind<`, `>{t('community.beRespectful', lang)}<`],
    [`>Prohibited Content<`, `>{t('community.prohibitedContent', lang)}<`],
    [`>Post Accurate Information<`, `>{t('community.postAccurate', lang)}<`],
    [`>Protect Privacy & Security<`, `>{t('community.protectPrivacy', lang)}<`],
    [`>Our Community Values<`, `>{t('community.ourValues', lang)}<`],
    [`>Got It<`, `>{t('common.gotIt', lang)}<`],
  ])
  if (count > 0) { writeFileSync(file, result, 'utf8'); console.log(`✓ CommunityGuidelines: ${count} replacements`) }
  else console.log('SKIP CommunityGuidelines')
}

// ────────────────────────────────────────────────────────────
// Chatbot.tsx
// ────────────────────────────────────────────────────────────
function fixChatbot() {
  const file = join(SRC, 'components/citizen/Chatbot.tsx')
  let code = readFileSync(file, 'utf8')
  const { result, count } = replaceAll(code, [
    [`>Offline mode — local responses<`, `>{t('chat.offlineMode', lang)}<`],
  ])
  if (count > 0) { writeFileSync(file, result, 'utf8'); console.log(`✓ Chatbot: ${count} replacements`) }
  else console.log('SKIP Chatbot')
}

// ────────────────────────────────────────────────────────────
// OfflineEmergencyCard.tsx
// ────────────────────────────────────────────────────────────
function fixOfflineEmergencyCard() {
  const file = join(SRC, 'components/citizen/OfflineEmergencyCard.tsx')
  let code = readFileSync(file, 'utf8')
  const { result, count } = replaceAll(code, [
    [`>Emergency Services<`, `>{t('offline.emergencyServices', lang)}<`],
    [`>Retry<`, `>{t('common.retry', lang)}<`],
  ])
  if (count > 0) { writeFileSync(file, result, 'utf8'); console.log(`✓ OfflineEmergencyCard: ${count} replacements`) } 
  else console.log('SKIP OfflineEmergencyCard')
}

// Run all
fixShelterFinder()
fixSOSButton()
fixSafetyCheckIn()
fixCrowdDensityHeatmap()
fixLiveIncidentMapPanel()
fixCitizenMessaging()
fixAlertSubscribe()
fixOnboardingTutorial()
fixCommunityGuidelines()
fixChatbot()
fixOfflineEmergencyCard()

console.log('\nDone!')
