/**
 * Thin wrapper around i18next providing t(), setLanguage(), getLanguage(),
 * and isRtl() for programmatic language access outside React hooks.
 *
 * - Used across the whole client for translated text
 * - Language resources defined in client/src/i18n/config.ts
 * - Language preference stored in localStorage
 *
 * - client/src/i18n/config.ts       -- language bundles and i18next setup
 * - client/src/hooks/useLanguage.ts -- React hook for language switching
 */

import i18next from '../i18n/config'
import type { TranslationMap } from '../types'
import { getRegion } from '../config/regionConfig'

//ENGLISH (source of truth - every key MUST exist here)

const en = {
  // App
  'app.title': 'AEGIS', 'app.subtitle': 'Emergency Response System',
  // Nav
  'nav.reportEmergency': 'Report Emergency', 'nav.aiAssistant': 'AI Assistant',
  'nav.preparedness': 'Preparedness Guide',
  // Stats
  'stats.activeAlerts': 'Active Alerts',
  'stats.verified': 'Verified', 'stats.urgent': 'Urgent', 'stats.total': 'Total Reports',
  // Safety
  'safety.title': 'Are You Safe?',
  // Map
  'map.title': 'Disaster Map', 'map.legend': 'Legend',
  'map.floodZone': 'Flood risk zone',
  // Alerts
  'alerts.title': 'Active Alerts',
  // Weather
  'weather.title': 'Local Conditions', 'weather.rainfall': 'Rainfall',
  'weather.wind': 'Wind', 'weather.visibility': 'Visibility',
  // Reports
  'reports.title': 'Recent Reports', 'reports.all': 'All Reports',
  'reports.severity': 'Severity',
  'reports.search': 'Search...',
  // Report banner
  'report.title': 'Report Emergency',
  // Report form
  'form.title': 'Report Emergency',
  'form.submit': 'Submit Emergency Report',
  'form.back': 'Back', 'form.next': 'Next',
  // Community
  'community.title': 'Community Support',
  // Auth
  'auth.login': 'Login', 'auth.logout': 'Logout',
  // Consent
  'consent.accept': 'Accept & Continue',
  'consent.decline': 'Decline',
  // Subscribe
  'subscribe.title': 'Subscribe to Alerts', 'subscribe.telegram': 'Telegram',
  'subscribe.email': 'Email', 'subscribe.sms': 'SMS', 'subscribe.web': 'Web Push',
  'subscribe.placeholder.email': 'your@email.com',
  'subscribe.placeholder.phone': '+1 (555) 123-4567',
  'subscribe.placeholder.telegram': '@your_username',
  'subscribe.success': 'Subscribed successfully!',
  // History
  'history.title': 'Historical Analysis',
  'history.events': 'Past Events',
  // Footer
  'footer.cookiePreferences': 'Cookie Preferences',
  // Admin nav / labels
  'admin.sendAlert': 'Send Alert',
  'admin.dashboard': 'Dashboard', 'admin.allReports': 'All Reports',
  'admin.liveMap': 'Live Map',
  'admin.resources': 'Resources', 'admin.history': 'History',
  'admin.analytics': 'Analytics', 'admin.models': 'AI Models',
  'admin.users': 'User Management',
  'admin.community': 'Community', 'admin.audit': 'Audit Trail',
  'admin.systemHealth': 'System Health', 'admin.operatorDashboard': 'Operator Dashboard',
  'admin.portal.title': 'AEGIS Operator Portal',
  'admin.portal.signin': 'Sign in to manage emergency operations',
  'admin.online': 'Online',
  'admin.profileUpdated': 'Profile updated', 'admin.save': 'Save',
  'admin.editProfile': 'Edit Profile',
  'admin.severityDistribution': 'Severity Distribution',
  'admin.verificationRate': 'Verification Rate',
  'admin.mediaAttached': 'Media attached',
  'admin.csvExported': 'CSV exported', 'admin.jsonExported': 'JSON exported',
  'admin.print': 'Print', 'admin.reportsFound': 'reports found',
  // Admin Welcome Dashboard
  'admin.welcome.commandCentre': 'Welcome to your AEGIS Command Centre.',
  'admin.welcome.youHave': 'You have',
  'admin.welcome.unverifiedReports': 'unverified reports',
  'admin.welcome.and': 'and',
  'admin.welcome.urgentIncidents': 'urgent incidents',
  'admin.welcome.requiringAttention': 'requiring attention.',
  'admin.welcome.highSeverityActive': 'high-severity incident(s) active',
  'admin.welcome.view': 'View',
  'admin.welcome.viewReports': 'View Reports',
  'admin.welcome.pending': 'pending',
  'admin.welcome.broadcastNow': 'Broadcast now',
  'admin.welcome.viewTrends': 'View trends',
  'admin.welcome.realTimeView': 'Real-time view',
  'admin.welcome.manageUsers': 'Manage Users',
  'admin.welcome.teamCitizens': 'Team & citizens',
  'admin.welcome.monitorStatus': 'Monitor status',
  'admin.welcome.active': 'active',
  'admin.welcome.allClear': 'No active alerts. All clear.',
  'admin.welcome.alert': 'Alert',
  'admin.welcome.info': 'Info',
  'admin.welcome.allAreas': 'All areas',
  'admin.welcome.viewAll': 'View all',
  'admin.welcome.noReports': 'No reports yet',
  'admin.welcome.report': 'Report',
  'admin.welcome.unknownLocation': 'Unknown location',
  'admin.welcome.highSev': 'High Sev.',
  'admin.welcome.withMedia': 'With Media',
  'admin.welcome.trapped': 'Trapped',
  'admin.welcome.avgConf': 'Avg Conf.',
  'admin.welcome.systemStatus': 'System Status',
  'admin.welcome.statusApi': 'API',
  'admin.welcome.statusDatabase': 'Database',
  'admin.welcome.statusAiEngine': 'AI Engine',
  'admin.welcome.statusWebSocket': 'WebSocket',
  'admin.welcome.live': 'LIVE',
  'admin.welcome.severity': 'Severity',
  'admin.welcome.activeAlerts': 'Active Alerts',
  'admin.welcome.resolutionRate': 'Resolution',
  // Admin filters
  'admin.filters.severity.all': 'All Severity',
  'admin.filters.severity.high': 'High', 'admin.filters.severity.medium': 'Medium', 'admin.filters.severity.low': 'Low',
  'admin.filters.status.all': 'All Status',
  'admin.filters.status.urgent': 'Urgent', 'admin.filters.status.unverified': 'Unverified',
  'admin.filters.status.verified': 'Verified', 'admin.filters.status.flagged': 'Flagged',
  'admin.filters.status.resolved': 'Resolved',
  'admin.filters.type.all': 'All Types',
  'admin.filters.type.natural_disaster': 'Natural Disaster',
  'admin.filters.type.infrastructure': 'Infrastructure Accident',
  'admin.filters.type.public_safety': 'Public Safety',
  'admin.filters.type.community_safety': 'Community Safety',
  'admin.filters.type.environmental': 'Environmental Hazard',
  'admin.filters.type.medical': 'Medical Emergency',
  // Admin actions / analytics / badges
  'admin.actions.viewReportDetail': 'View report detail',
  'admin.actions.openMedia': 'Open media',
  'admin.actions.shareReport': 'Share report', 'admin.actions.printReport': 'Print report',
  'admin.analytics.activityLog': 'Activity Log',
  'admin.analytics.noActivity': 'No activity recorded yet.',
  'admin.badge.vulnerablePerson': 'Vulnerable Person',
  'admin.ai.title': 'AI Transparency & Model Analytics',
  // Admin dashboard stats
  'admin.stats.total': 'Total', 'admin.stats.urgent': 'Urgent',
  'admin.stats.unverified': 'Unverified', 'admin.stats.verified': 'Verified',
  'admin.stats.flagged': 'Flagged', 'admin.stats.resolved': 'Resolved',
  'admin.stats.avgAi': 'Avg AI', 'admin.stats.trapped': 'Trapped',
  // Admin confirmations
  'admin.confirm.verifyTitle': 'Verify Report',
  'admin.confirm.verifyMsg': 'Confirm this report as legitimate? This marks it as verified.',
  'admin.confirm.flagTitle': 'Flag Report',
  'admin.confirm.flagMsg': 'Flag this report for investigation?',
  'admin.confirm.urgentTitle': 'Escalate to URGENT',
  'admin.confirm.urgentMsg': 'Escalate this report to URGENT priority? All operators will be notified.',
  'admin.confirm.resolveTitle': 'Resolve Report',
  'admin.confirm.resolveMsg': 'Mark this report as resolved?',
  'admin.alert.title': 'Alert Title',
  // Landing
  'landing.hero.title': 'AEGIS',
  'landing.hero.subtitle': 'Advanced Emergency Geospatial Intelligence System',
  'landing.hero.description': 'Multi-modal AI-powered disaster response platform. Currently demonstrating flood management with modular architecture supporting all disaster types.',
  'landing.meta.projectCredit': 'BSc Computing Science Capstone Project -- Robert Gordon University 2026',
  'landing.footerSignature': 'AEGIS -- Advanced Emergency Geospatial Intelligence System -- © 2026 Happiness Ada Lazarus -- Robert Gordon University',
  // Citizen dashboard tabs / actions
  'citizen.tab.overview': 'Overview', 'citizen.tab.livemap': 'Live Map',
  'citizen.tab.reports': 'Reports', 'citizen.tab.messages': 'Messages',
  'citizen.tab.community': 'Community', 'citizen.tab.prepare': 'Preparedness',
  'citizen.tab.news': 'News', 'citizen.tab.safety': 'Safety',
  'citizen.tab.shelters': 'Shelters', 'citizen.tab.risk': 'Risk Assessment', 'citizen.tab.emergency': 'Emergency',
  'citizen.tab.profile': 'Profile', 'citizen.tab.security': 'Security',
  'citizen.tab.settings': 'Settings',
  'citizen.action.alerts': 'Alerts',
  // Citizen hero
  'citizen.hero.title': 'Real-Time Emergency Awareness',
  // Citizen auth
  'citizen.auth.guestContinue': 'Explore',
  'citizen.auth.alerts.title': 'Active Alerts',
  'citizen.auth.loginTitle': 'Citizen Login',
  'citizen.auth.registerTitle': 'Create Account',
  'citizen.auth.loginSubtitle': 'Sign in to your AEGIS citizen dashboard',
  'citizen.auth.registerSubtitle': 'Join AEGIS for personalised emergency alerts',
  'citizen.auth.register': 'Register',
  'citizen.auth.step.account': 'Account', 'citizen.auth.step.details': 'Details', 'citizen.auth.step.profile': 'Profile',
  'citizen.auth.emailAddress': 'Email Address', 'citizen.auth.displayName': 'Display Name',
  'citizen.auth.passwordLabel': 'Password', 'citizen.auth.confirmPassword': 'Confirm Password',
  'citizen.auth.passwordPlaceholder': 'Your password', 'citizen.auth.passwordMin': 'Min 12 characters',
  'citizen.auth.repeatPassword': 'Repeat password',
  'citizen.auth.signingIn': 'Signing in...', 'citizen.auth.signIn': 'Sign In',
  'citizen.auth.orContinueWith': 'or continue with',
  'citizen.auth.continue': 'Continue', 'citizen.auth.back': 'Back',
  'citizen.auth.phone': 'Phone', 'citizen.auth.optional': 'optional',
  'citizen.auth.country': 'Country', 'citizen.auth.city': 'City',
  'citizen.auth.region': 'Region',
  'citizen.auth.addressLine': 'Address Line', 'citizen.auth.dateOfBirth': 'Date of Birth',
  'citizen.auth.profilePhoto': 'Profile Photo', 'citizen.auth.clickUpload': 'Click to upload (max 2MB)',
  'citizen.auth.bio': 'Bio', 'citizen.auth.bioPlaceholder': 'Tell us about yourself...',
  'citizen.auth.statusTitle': 'Your Status',
  'citizen.auth.status.available': 'Available', 'citizen.auth.status.availableDesc': 'I am safe and available',
  'citizen.auth.status.caution': 'Caution', 'citizen.auth.status.cautionDesc': 'I may need help soon',
  'citizen.auth.status.needHelp': 'Need Help', 'citizen.auth.status.needHelpDesc': 'I need immediate assistance',
  'citizen.auth.vulnerabilityTitle': 'I may need priority assistance',
  'citizen.auth.vulnerabilityHint': 'Check this if you have a disability, chronic illness, mobility issues, are elderly, or have other circumstances that require priority response during emergencies.',
  'citizen.auth.vulnerabilityPlaceholder': 'Briefly describe your needs (e.g., wheelchair user, hearing impaired, elderly)...',
  'citizen.auth.creating': 'Creating...', 'citizen.auth.createAccount': 'Create Account',
  'citizen.auth.noAccount': "Don't have an account? ", 'citizen.auth.haveAccount': 'Already have an account? ',
  'citizen.auth.continueWithout': 'Continue without account',
  'citizen.auth.alreadySignedIn': 'Already Signed In',
  'citizen.auth.redirectingDashboard': 'Redirecting to your dashboard...',
  'citizen.auth.goDashboard': 'Go to Dashboard',
  'citizen.auth.password.weak': 'Weak', 'citizen.auth.password.fair': 'Fair',
  'citizen.auth.password.good': 'Good', 'citizen.auth.password.strong': 'Strong',
  'citizen.auth.password.veryStrong': 'Very Strong',
  'citizen.auth.error.photoSize': 'Profile photo must be under 2MB',
  'citizen.auth.error.displayNameRequired': 'Display name is required.',
  'citizen.auth.error.emailRequired': 'Email is required.',
  'citizen.auth.error.invalidEmail': 'Please enter a valid email address.',
  'citizen.auth.error.emailTaken': 'This email is already registered.',
  'citizen.auth.error.passwordMin12': 'Password must be at least 12 characters.',
  'citizen.auth.error.passwordComplexity': 'Password must contain uppercase, lowercase, digit, and special character.',
  'citizen.auth.error.passwordContainsEmail': 'Password must not contain your email address.',
  'citizen.auth.error.passwordsNoMatch': 'Passwords do not match.',
  'citizen.auth.error.tosRequired': 'You must accept the Terms of Service.',
  'citizen.auth.error.tosAccept': 'Please accept the Terms of Service to continue.',
  'citizen.auth.error.phoneTaken': 'This phone number is already registered.',
  'citizen.auth.error.phoneRequired': 'Phone number is required.',
  'citizen.auth.error.countryRequired': 'Country is required.',
  'citizen.auth.error.regionRequired': 'Region is required.',
  'citizen.auth.error.addressRequired': 'Address is required.',
  'citizen.auth.error.avatarUploadFailed': 'Profile photo could not be uploaded -- you can add it later.',
  'citizen.auth.error.registrationFailed': 'Registration failed.',
  'citizen.auth.error.loginFailed': 'Login failed.',
  'citizen.auth.error.generic': 'An error occurred.',
  'citizen.auth.pwReq.minLength': 'At least 12 characters',
  'citizen.auth.pwReq.uppercase': 'One uppercase letter',
  'citizen.auth.pwReq.lowercase': 'One lowercase letter',
  'citizen.auth.pwReq.digit': 'One number (0-9)',
  'citizen.auth.pwReq.special': 'One special character',
  'citizen.auth.pwReq.noEmail': 'Must not contain your email',
  'citizen.auth.success.accountCreated': 'Account created successfully! Redirecting...',
  'citizen.auth.success.login': 'Login successful! Redirecting...',
  // Citizen dashboard specific
  'citizen.stats.highSeverity': 'High Severity',
  'citizen.reports.newest': 'Newest', 'citizen.reports.aiConfidence': 'AI Confidence',
  'citizen.news.source': 'Source',
  'citizen.footer.platform': 'Platform', 'citizen.footer.contact': 'Contact',
  'citizen.sos.aria': 'Emergency SOS',
  'citizen.sos.sent': 'SOS SIGNAL SENT',
  // Citizen verify email
  'citizen.verifyEmail.banner': 'Please verify your email address to unlock all features.',
  'citizen.verifyEmail.resend': 'Resend Email',
  // NEW: Citizen dashboard overview / quick-actions / messages
  'citizen.loading': 'Loading your dashboard...',
  'citizen.welcome': 'Welcome back,',
  'citizen.dashboardDesc': 'Your personal AEGIS emergency dashboard',
  'citizen.prioritySupportDesc': 'Priority support is active on your account',
  'citizen.overview.activeReports': 'Active Reports',
  'citizen.overview.urgent': 'Urgent',
  'citizen.overview.highSeverity': 'High Severity',
  'citizen.overview.verified': 'Verified',
  'citizen.overview.activeAlerts': 'Active Alerts',
  'citizen.overview.unreadMessages': 'Unread Messages',
  'citizen.overview.activeThreads': 'Active Threads',
  'citizen.overview.safetyCheckins': 'Safety Check-ins',
  'citizen.overview.emergencyContacts': 'Emergency Contacts',
  'citizen.quickAction.reportEmergency': 'Report Emergency',
  'citizen.quickAction.reportEmergencyDesc': 'Submit an incident report',
  'citizen.quickAction.liveMap': 'Live Map',
  'citizen.quickAction.liveMapDesc': 'View disaster map',
  'citizen.quickAction.newMessage': 'New Message',
  'citizen.quickAction.newMessageDesc': 'Contact support',
  'citizen.quickAction.communityHelp': 'Community Help',
  'citizen.quickAction.communityHelpDesc': 'Volunteer or request aid',
  'citizen.quickAction.safetyCheckin': 'Safety Check-in',
  'citizen.quickAction.safetyCheckinDesc': 'Report your status',
  'citizen.quickAction.editProfile': 'Edit Profile',
  'citizen.quickAction.editProfileDesc': 'Update your details',
  'citizen.conversations.recent': 'Recent Conversations',
  'citizen.conversations.viewAll': 'View All',
  'citizen.messages.title': 'Messages',
  'citizen.messages.refresh': 'Refresh',
  'citizen.messages.newThread': 'New Thread',
  'citizen.messages.startConversation': 'Start a New Conversation',
  'citizen.messages.subject': 'Subject',
  'citizen.messages.category': 'Category',
  'citizen.messages.message': 'Message',
  'citizen.messages.send': 'Send',
  'citizen.messages.cancel': 'Cancel',
  'citizen.messages.noConversations': 'No conversations yet',
  'citizen.messages.startHelp': 'Start a new conversation to get help from our team',
  'citizen.messages.startButton': 'Start a Conversation',
  'citizen.messages.noMessages': 'No messages yet',
  'citizen.messages.typeMessage': 'Type a message...',
  'citizen.messages.resolved': 'Resolved',
  'citizen.messages.waitingOperator': 'Waiting for operator',
  'citizen.messages.assignedTo': 'Assigned to',
  'citizen.messages.conversationClosed': 'This conversation has been',
  'citizen.messages.translate': 'Translate',
  'citizen.messages.isTyping': 'is typing...',
  'citizen.thread.generalInquiry': 'General Inquiry',
  'citizen.thread.emergencyHelp': 'Emergency Help',
  'citizen.thread.reportIssue': 'Report an Issue',
  'citizen.thread.feedback': 'Feedback',
  'citizen.thread.accountSupport': 'Account Support',
  'citizen.thread.alertFollowup': 'Alert Follow-up',
  'citizen.map.operations': 'Live Operations Map',
  'citizen.map.myLocationBtn': 'My Location',
  'citizen.map.weather': 'Weather',
  'citizen.map.riverLevels': 'River Levels',
  'citizen.reportDetail.title': 'Report Details',
  'citizen.alertDetail.title': 'Alert Details',
  'citizen.alertDetail.safetyAdvice': 'Safety Advice',
  'citizen.alertDetail.safetyMsg': 'Follow local authority guidance. If in immediate danger, call {{EMERGENCY_NUMBER}}.',
  'citizen.alertDetail.reportIncident': 'Report Incident',
  'citizen.prep.emergencyPrep': 'Emergency Preparedness',
  'citizen.prep.emergencyPrepDesc': 'Learn how to prepare for, survive, and recover from natural disasters. Verified resources from national agencies.',
  'citizen.community.liveChat': 'Live Chat',
  'citizen.community.postsFeed': 'Posts Feed',
  'citizen.safety.title': 'Safety Check-in',
  'citizen.safety.safeButton': "I'm Safe",
  'citizen.safety.helpButton': 'Need Help',
  'citizen.safety.unsureButton': 'Unsure',
  'citizen.safety.recentCheckins': 'Recent Check-ins',
  'citizen.safety.submitCheckin': 'Submit Check-in',
  'citizen.safety.checkinSuccess': 'Check-in submitted successfully!',
  'citizen.settings.title': 'Notification Settings',
  'citizen.security.title': 'Change Password',
  'citizen.security.currentPassword': 'Current Password',
  'citizen.security.newPassword': 'New Password',
  'citizen.security.confirmNewPassword': 'Confirm New Password',
  'citizen.security.changePassword': 'Change Password',
  'citizen.profile.title': 'Edit Profile',
  // Common actions
  'common.close': 'Close', 'common.share': 'Share', 'common.print': 'Print',
  'common.source': 'Source', 'common.refresh': 'Refresh',
  'common.reports': 'reports', 'common.loadingReports': 'Loading reports...',
  'common.noReportsFound': 'No reports found',
  'common.list': 'List', 'common.page': 'Page', 'common.navigate': 'Navigate', 'common.kmh': 'km/h',
  'common.flood': 'Flood', 'common.storm': 'Storm', 'common.people': 'people',
  'common.local': 'Local', 'common.sync': 'Sync', 'common.table': 'Table', 'common.grid': 'Grid',
  'common.updated': 'Updated', 'common.showing': 'Showing', 'common.event': 'event', 'common.events': 'events',
  'common.saveChanges': 'Save Changes', 'common.reason': 'Reason', 'common.like': 'Like',
  'common.liked': 'Liked', 'common.comment': 'Comment', 'common.comments': 'Comments',
  'common.reply': 'Reply', 'common.conversation': 'conversation', 'common.conversations': 'conversations',
  'common.global': 'Global', 'common.reconnecting': 'Reconnecting...',
  // Chatbot
  'chat.title': 'AI Emergency Assistant', 'chat.subtitle': 'Multi-disaster guidance',
  'chat.disclaimer': 'AI assistant -- for emergencies call {{EMERGENCY_NUMBER}}',
  // General
  'general.close': 'Close', 'general.cancel': 'Cancel', 'general.confirm': 'Confirm',
  'general.loading': 'Loading...', 'general.noResults': 'No results found',
  // Preparedness Guide i18n (#39)
  'prep.title': 'Disaster Preparedness Training',
  'prep.tab.tips': 'Safety Tips', 'prep.tab.scenarios': 'Scenarios',
  'prep.tab.kit': 'Emergency Kit', 'prep.tab.quiz': 'Quiz',
  'prep.tab.plan': 'Family Plan', 'prep.tab.badges': 'Badges',
  'prep.phase.before': 'Before', 'prep.phase.during': 'During', 'prep.phase.after': 'After',
  'prep.kit.essential': 'Essential', 'prep.kit.important': 'Important', 'prep.kit.recommended': 'Recommended',
  'prep.emergencyActive': 'Live emergency active -- check your alerts first before training.',

  //ADMIN COMPONENTS -- comprehensive i18n keys

  // ActivityLog
  'admin.activityLog.title': 'Activity Log',

  // AdminAlertBroadcast
  'admin.alertBroadcast.title': 'Emergency Alert Broadcast',
  'admin.alertBroadcast.severity': 'Alert Severity',
  'admin.alertBroadcast.critical': 'Critical',
  'admin.alertBroadcast.criticalDesc': 'Immediate life-threatening danger',
  'admin.alertBroadcast.warning': 'Warning',
  'admin.alertBroadcast.warningDesc': 'Potential threat -- take precautions',
  'admin.alertBroadcast.advisory': 'Advisory',
  'admin.alertBroadcast.advisoryDesc': 'Situational awareness update',
  'admin.alertBroadcast.alertTitle': 'Alert Title',
  'admin.alertBroadcast.titlePlaceholder': 'e.g. Flood Warning -- Downtown River Area',
  'admin.alertBroadcast.message': 'Alert Message',
  'admin.alertBroadcast.messagePlaceholder': 'Describe the emergency situation, affected areas and recommended actions...',
  'admin.alertBroadcast.location': 'Location / Affected Area',
  'admin.alertBroadcast.locationPlaceholder': 'e.g. City Centre, Riverside District',
  'admin.alertBroadcast.channels': 'Broadcast Channels',
  'admin.alertBroadcast.webPush': 'Web Push',
  'admin.alertBroadcast.browserNotifications': 'Browser notifications',
  'admin.alertBroadcast.telegram': 'Telegram',
  'admin.alertBroadcast.telegramBot': 'Telegram bot message',
  'admin.alertBroadcast.email': 'Email',
  'admin.alertBroadcast.emailHtml': 'Email with HTML template',
  'admin.alertBroadcast.sms': 'SMS',
  'admin.alertBroadcast.smsDesc': 'Text message (160 char)',
  'admin.alertBroadcast.whatsapp': 'WhatsApp',
  'admin.alertBroadcast.whatsappMsg': 'WhatsApp message',
  'admin.alertBroadcast.preview': 'Live Preview',
  'admin.alertBroadcast.charCount': 'characters',
  'admin.alertBroadcast.smsSegments': 'SMS segments',
  'admin.alertBroadcast.confirmTitle': 'Confirm Broadcast',
  'admin.alertBroadcast.confirmMsg': 'This will send an alert to all subscribed users on the selected channels. Continue?',
  'admin.alertBroadcast.sending': 'Broadcasting...',
  'admin.alertBroadcast.send': 'Broadcast Alert',
  'admin.alertBroadcast.sent': 'Alert broadcast successfully',
  'admin.alertBroadcast.failed': 'Failed to broadcast alert',
  'admin.alertBroadcast.history': 'Recent Broadcasts',
  'admin.alertBroadcast.noHistory': 'No broadcasts yet',
  'admin.alertBroadcast.deliveryResults': 'Delivery Results',
  'admin.alertBroadcast.attempted': 'Attempted',
  'admin.alertBroadcast.delivered': 'Sent',
  'admin.alertBroadcast.failedCount': 'Failed',
  'admin.alertBroadcast.selectChannel': 'Select at least one channel',
  'admin.alertBroadcast.titleRequired': 'Alert title is required',
  'admin.alertBroadcast.messageRequired': 'Alert message is required',

  // AdminAuditTrail
  'admin.auditTrail.title': 'Compliance Audit Trail',
  'admin.auditTrail.search': 'Search audit logs...',

  // AdminCommunityHub
  'admin.community.title': 'Community Management Hub',

  // AdminHistoricalIntelligence
  'admin.historical.title': 'Historical Intelligence',
  'admin.historical.timeline': 'Timeline',

  // AdminMessaging
  'admin.messaging.title': 'Messaging Centre',
  'admin.messaging.open': 'Open',
  'admin.messaging.assign': 'Assign',
  'admin.messaging.resolve': 'Resolve',
  'admin.messaging.translate': 'Translate',
  'admin.messaging.translated': 'Translated',
  'admin.messaging.autoTranslate': 'Auto-translate',
  'admin.messaging.status': 'Status',
  'admin.messaging.isTyping': 'is typing...',

  // AITransparency (Console + Dashboard)
  //AITransparencyDashboard additional keys

  // AllReportsManager

  // AnalyticsCenter + AnalyticsDashboard
  'admin.analytics.title': 'Analytics Centre',

  // CommandCenter
  'admin.command.title': 'Command Centre',

  // DeliveryDashboard
  'admin.delivery.title': 'Alert Delivery Dashboard',

  // DistressPanel
  'admin.distress.title': 'Distress Signals',
  'admin.distress.noDistressDesc': 'SOS signals from citizens will appear here',

  // IncidentCommandConsole
  'admin.incident.title': 'Incident Command Console',

  // IncidentQueue
  'admin.queue.title': 'Incident Response Queue',
  'admin.queue.activeIncidents': 'active incidents',
  'admin.queue.unassigned': 'unassigned',
  'admin.queue.escalate': 'Escalate',
  'admin.queue.markInProgress': 'In Progress',
  'admin.queue.reassign': 'Reassign',
  'admin.queue.noIncidents': 'No incidents in this queue',
  'admin.queue.noIncidentsDesc': 'All incidents are handled or filtered out',
  'admin.queue.escalatedSenior': 'Incident escalated to senior coordinator',
  'admin.queue.incidentAssigned': 'Incident assigned to',
  'admin.queue.inProgress': 'Incident marked as in progress',
  'admin.queue.resolved': 'Incident resolved',
  'admin.queue.filterAll': 'All',
  'admin.queue.statusUnassigned': 'Unassigned',
  'admin.queue.statusAssigned': 'Assigned',
  'admin.queue.statusInProgress': 'In Progress',
  'admin.queue.statusEscalated': 'Escalated',
  'admin.queue.statusResolved': 'Resolved',
  'admin.queue.assign': 'Assign',
  'admin.queue.start': 'Start',
  'admin.queue.resolve': 'Resolve',
  'admin.queue.awaiting': 'awaiting',
  'admin.queue.updated': 'Updated',
  'admin.queue.justNow': 'Just now',
  'admin.queue.minsAgo': '{n}m ago',
  'admin.queue.hrsAgo': '{n}h ago',
  'admin.queue.daysAgo': '{n}d ago',
  'admin.queue.claimTitle': 'Claim this incident -- assigns it to you',
  'admin.queue.claim': 'Claim',
  'admin.queue.assignTitle': 'Assign to a specific team member',
  'admin.queue.assignToHeader': 'Assign to',
  'admin.queue.noTeamMembers': 'No team members found',
  'admin.queue.reassignTitle': 'Reassign to another team member',
  'admin.queue.reassignToHeader': 'Reassign to',

  // IncidentCommandConsole
  'icc.title': 'Incident Command Console',
  'icc.subtitle': '{types} incident types monitored -- {alerts} alerts -- {predictions} predictions',
  'icc.compoundEmergency': 'COMPOUND EMERGENCY: {count} simultaneous critical incidents',
  'icc.cascadeFloodPower': 'CASCADING: Flood + Power Outage -- critical infrastructure at risk',
  'icc.cascadeStormInfra': 'CASCADING: Storm + Infrastructure Damage -- transport disruption likely',
  'icc.criticalIncidents': 'Critical Incidents',
  'icc.activeAlerts': 'Active Alerts',
  'icc.aiPredictions': 'AI Predictions',
  'icc.builtInScheduler': 'Scheduler: Active',
  'icc.cronActive': 'Cron jobs: Running',
  'icc.aiIntegrated': 'AI engine integrated',
  'icc.severityHeatmap': 'Severity Heatmap',
  'icc.typesWithActivity': 'active',
  'icc.activeThreats': 'Active Threats',
  'icc.monitoring': 'Monitoring',
  'icc.alertsLabel': 'alerts',
  'icc.predsLabel': 'preds',
  'icc.activeTypes': 'Active Types',
  'icc.loadFailed': 'Failed to load incident data',
  'icc.retry': 'Retry',
  'icc.registryNotLoaded': 'Incident registry not loaded',
  'icc.checkConnection': 'Check the API connection and refresh.',
  'icc.statusOperational': 'Operational',
  'icc.statusPartial': 'Partial',
  'icc.statusConfigured': 'Configured',
  'icc.statusDisabled': 'Disabled',
  'icc.shortcuts': 'Shortcuts',
  'icc.toggleShortcuts': 'Toggle shortcuts',
  'icc.updated': 'Updated',

  // LiveOperationsMap
  'admin.liveMap.title': 'Live Operations Map',

  // ResourceDeploymentConsole
  'admin.resource.title': 'Resource Deployment Console',
  //Zone management
  'admin.resource.addZone': 'Add Zone',
  'admin.resource.zoneDetails': 'Zone Details',
  'admin.resource.editZone': 'Edit Zone',
  //Actions
  'admin.resource.cancel': 'Cancel',
  'admin.resource.confirmDraft': 'Confirm Draft',
  'admin.resource.deployNow': 'Deploy Now',
  //AI-related
  'admin.resource.aiDraft': 'AI DRAFT',
  'admin.resource.aiDraftsAwaitingReview': 'AI Drafts Awaiting Review',
  //Labels
  'admin.resource.priority': 'Priority',
  'admin.resource.hazardType': 'Hazard Type',
  'admin.resource.reports': 'Reports',
  'admin.resource.affected': 'Affected',
  'admin.resource.fire': 'Fire',
  'admin.resource.boats': 'Boats',
  'admin.resource.ambulances': 'Ambulances',
  //Mutual Aid
  'admin.resource.mutualAid': 'Mutual Aid',
  'admin.resource.activeRequest': 'ACTIVE REQUEST',
  //ICS (Incident Command System)
  'admin.resource.incidentCommander': 'Incident Commander',
  'admin.resource.icsOperationsLog': 'ICS Operations Log',
  'admin.resource.noLogEntries': 'No log entries yet.',
  'admin.resource.addLogEntryPlaceholder': 'Add log entry... (Enter to submit)',
  'admin.resource.log': 'Log',
  //Asset tracking
  'admin.resource.assetTracking': 'Asset Tracking',
  'admin.resource.onSite': 'on-site',
  'admin.resource.addAsset': 'Add Asset',
  'admin.resource.loadingAssets': 'Loading assets...',
  'admin.resource.noAssetsTracked': 'No assets tracked yet.',
  'admin.resource.crew': 'crew',
  'admin.resource.callSignPlaceholder': 'Call sign e.g. AMB-01',
  'admin.resource.crewPlaceholder': 'Crew',
  'admin.resource.add': 'Add',
  //Form fields
  'admin.resource.namePlaceholder': 'Name',
  'admin.resource.affectedPlaceholder': 'e.g. 200',
  //Commander
  //Radio
  //Weather conditions
  //Evacuation status
  //Operational details
  //Threat/Incident
  //Critical alert
  //Summary

  // SystemHealthPanel
  'admin.health.title': 'Architecture Status Board',
  'admin.health.updated': 'Updated',
  'admin.health.refresh': 'Refresh',
  'admin.health.loading': 'Loading system health...',
  'admin.health.failed': 'Failed to load system health',
  'admin.health.retry': 'Retry',
  'admin.health.database': 'Database',
  'admin.health.aiEngine': 'AI Engine',
  'admin.health.jobScheduler': 'Job Scheduler',
  'admin.health.errors1h': 'Errors (1h)',
  'admin.health.healthy': 'Healthy',
  'admin.health.down': 'Down',
  'admin.health.clean': 'Clean',
  'admin.health.errors': 'errors',
  'admin.health.n8nConnected': 'n8n Connected',
  'admin.health.fallbackActive': 'Fallback Active',
  'admin.health.active': 'Active',
  'admin.health.checking': 'Checking...',
  'admin.health.starting': 'Starting...',
  'admin.health.internalCron': 'Internal cron scheduler active',
  'admin.health.workflowsActive': 'workflows active',
  'admin.health.circuitBreakers': 'External API Circuit Breakers',
  'admin.health.open': 'OPEN',
  'admin.health.closed': 'Closed',
  'admin.health.failures': 'Failures',
  'admin.health.lastFailure': 'Last',
  'admin.health.frontend': 'Frontend',
  'admin.health.backend': 'Backend',
  'admin.health.externalApi': 'External API',
  'admin.health.recentJobs': 'Recent Cron Jobs',
  'admin.health.noJobs': 'No recent jobs',
  'admin.health.jobName': 'Job',
  'admin.health.duration': 'Duration',
  'admin.health.records': 'Records',
  'admin.health.completedAt': 'Completed',
  'admin.health.architecture': 'Data Flow Architecture',
  'admin.health.workflows': 'Workflow Definitions',
  'admin.health.dataSources': 'Gauges, Alerts',
  'admin.health.orchestrator': 'Orchestrator',
  'admin.health.cronFallback': 'Fallback',
  'admin.health.nodes': 'nodes',
  'admin.health.shortcutsLabel': 'Shortcuts',
  'admin.health.shortcutRefresh': 'Refresh',
  'admin.health.shortcutToggle': 'Toggle Shortcuts',
  'admin.health.shortcutClose': 'Close',
  'admin.health.allOperational': 'All Systems Operational',
  'admin.health.degraded': 'Degraded',
  'admin.health.critical': 'Critical',
  'admin.health.healthScore': 'Health Score',
  'admin.health.scoreExcellent': 'Excellent',
  'admin.health.scoreGood': 'Good',
  'admin.health.scoreFair': 'Fair',
  'admin.health.scorePoor': 'Poor',
  'admin.health.serverUptime': 'Server Uptime',
  'admin.health.uptimeDesc': 'Node.js process uptime',
  'admin.health.memoryUsage': 'Memory Usage',
  'admin.health.techStack': 'Technology Stack',

  // UserAccessManagement
  'admin.users.title': 'User & Access Management',
  'admin.users.name': 'Name',
  'admin.users.displayName': 'Display Name',

  // Admin LoginPage
  'admin.login.title': 'AEGIS Operator Portal',
  'admin.login.showPassword': 'Show password',
  'admin.login.hidePassword': 'Hide password',
  'admin.login.signingIn': 'Signing In...',
  'admin.login.invalidCredentials': 'Invalid credentials. Please try again.',
  'admin.login.secureConnection': 'Secure encrypted connection',
  'admin.login.protectedSystem': 'Protected system -- Authorised personnel only',

  // TwoFactorChallenge + TwoFactorSettings
  'twofa.title': 'Two-Factor Authentication',
  'twofa.enterCode': 'Please enter your authentication code',
  'twofa.invalidCode': 'Invalid code. Please try again.',
  'twofa.verifyFailed': 'Verification failed. Please try again.',
  'twofa.sessionExpired': 'Session expired. Please log in again.',
  'twofa.enterTotpDesc': 'Enter the 6-digit code from your authenticator app.',
  'twofa.enterBackupDesc': 'Enter one of your backup recovery codes.',
  'twofa.authenticator': 'Authenticator',
  'twofa.backupCode': 'Use Backup Code',
  'twofa.authCode': 'Authentication Code',
  'twofa.backupRecoveryCode': 'Backup Recovery Code',
  'twofa.rememberDevice': 'Remember this device for 30 days',
  'twofa.verifying': 'Verifying...',
  'twofa.verifySignIn': 'Verify & Sign In',
  'twofa.backToLogin': 'Back to Login',
  'twofa.loadFailed': 'Failed to load 2FA status',
  'twofa.setupFailed': 'Failed to start 2FA setup',
  'twofa.invalidSetupCode': 'Please enter a valid 6-digit code',
  'twofa.enabled': 'Two-factor authentication enabled successfully',
  'twofa.verifyFreshCode': 'Please use a fresh code from your authenticator',
  'twofa.passwordRequired': 'Password is required',
  'twofa.codeRequired': 'Authentication code is required',
  'twofa.disabled': 'Two-factor authentication disabled',
  'twofa.disableFailed': 'Failed to disable 2FA',
  'twofa.aria.totpCode': '6-digit authentication code',
  'twofa.aria.backupCode': 'Backup recovery code',
  'twofa.backupOnlyOnce': 'Each backup code can only be used once',
  //TwoFactorSettings-specific

  //CITIZEN COMPONENTS -- comprehensive i18n keys

  // CitizenMessaging (already partially covered above)
  'citizen.messaging.attachFile': 'Attach file',

  // CommunityChat
  'citizen.communityChat.title': 'Community Chat',
  'communityChat.shareWithCommunity': 'Share with the community',
  'communityChat.whatsHappening': "What's happening in your area? Report hazards, share updates, ask for help...",
  'communityChat.hazardUpdate': 'Hazard Update',
  'communityChat.markHazard': 'Mark as an emergency or hazard report',
  'communityChat.addLocation': 'Add location (optional)',
  'communityChat.addPhoto': 'Add photo',
  'communityChat.moreOptions': 'More options',
  'communityChat.posting': 'Posting...',
  'communityChat.post': 'Post',
  'communityChat.allPosts': 'All Posts',
  'communityChat.hazards': 'Hazards',
  'communityChat.reportedFilter': 'Reported',
  'communityChat.searchPosts': 'Search posts, names, locations...',
  'communityChat.noHazardUpdates': 'No hazard updates',
  'communityChat.noReportedPosts': 'No reported posts',
  'communityChat.noPostsYet': 'No posts yet',
  'communityChat.firstShare': 'Be the first to share something with the community!',
  'communityChat.nothingForFilter': 'Nothing to show for this filter.',
  'communityChat.reportReceived': 'reports received',
  'communityChat.reviewTakeAction': 'Review & take action',
  'communityChat.citizen': 'Citizen',
  'communityChat.hazard': 'HAZARD',
  'communityChat.editPost': 'Edit post',
  'communityChat.deletePost': 'Delete post',
  'communityChat.removeReported': 'Remove (reported)',
  'communityChat.reportPost': 'Report post',
  'communityChat.alreadyReported': 'Already reported',
  'communityChat.edited': 'edited',
  'communityChat.commentSingular': 'comment',
  'communityChat.commentPlural': 'comments',
  'communityChat.shareSingular': 'share',
  'communityChat.sharePlural': 'shares',
  'communityChat.noCommentsYet': 'No comments yet. Be the first!',
  'communityChat.writeComment': 'Write a comment...',
  'communityChat.reportPostTitle': 'Report Post',
  'communityChat.keepCommunitySafe': 'Help us keep the community safe',
  'communityChat.selectReason': 'Select a reason',
  'communityChat.addDetails': 'Add details (optional)...',
  'communityChat.editPostTitle': 'Edit Post',
  'communityChat.updatePostContent': 'Update your post content or location',
  'communityChat.content': 'Content',
  'communityChat.locationLabel': 'Location',
  'communityChat.deleteYourPost': 'Delete your post?',
  'communityChat.removeReportedPost': 'Remove reported post?',
  'communityChat.deletePostWarning': 'This action cannot be undone. Your post will be permanently removed.',
  'communityChat.removeReportedWarning': 'This post has been reported by community members. This action cannot be undone.',
  'communityChat.copied': 'Post copied to clipboard!',
  'communityChat.selectImageFile': 'Please select an image file',
  'communityChat.imageSizeLimit': 'Image must be less than 10MB',
  'communityChat.messageOrImageRequired': 'Please enter a message or select an image',
  'communityChat.postFailed': 'Failed to post message',
  'communityChat.postSharedSuccess': 'Post shared successfully!',
  'communityChat.postLikedSuccess': 'Post liked!',
  'communityChat.likeRemoved': 'Like removed',
  'communityChat.commentPosted': 'Comment posted!',
  'communityChat.commentFailed': 'Failed to post comment',
  'communityChat.reportFailed': 'Failed to report post',
  'communityChat.reportedSuccess': 'Post reported. Our team will review it.',
  'communityChat.deleteFailed': 'Failed to delete post',
  'communityChat.deletedSuccess': 'Post deleted successfully',
  'communityChat.editFailed': 'Failed to edit post',
  'communityChat.updatedSuccess': 'Post updated successfully!',
  'communityChat.reportAction': 'Report',
  'communityChat.adminRole': 'Admin',
  'communityChat.opsRole': 'Ops',
  'communityChat.postImageAlt': 'Post image',
  'communityChat.previewImageAlt': 'Image preview',
  'communityChat.zoomedImageAlt': 'Expanded image',
  'communityChat.reason.spam.label': 'Spam',
  'communityChat.reason.spam.desc': 'Repetitive or irrelevant content',
  'communityChat.reason.harassment.label': 'Harassment',
  'communityChat.reason.harassment.desc': 'Bullying or targeted attacks',
  'communityChat.reason.misinformation.label': 'Misinformation',
  'communityChat.reason.misinformation.desc': 'False or misleading information',
  'communityChat.reason.inappropriate.label': 'Inappropriate',
  'communityChat.reason.inappropriate.desc': 'Adult or offensive content',
  'communityChat.reason.violence.label': 'Violence',
  'communityChat.reason.violence.desc': 'Threats or graphic violence',
  'communityChat.reason.other.label': 'Other',
  'communityChat.reason.other.desc': 'Something else not listed',

  // CommunityGuidelines
  'citizen.guidelines.title': 'Community Guidelines',

  // CommunityHelp
  'citizen.communityHelp.title': 'Community Help',

  // CrowdDensityHeatmap
  'citizen.heatmap.title': 'Crowd Density Map',

  // LiveIncidentMapPanel
  'citizen.incidentMap.title': 'Live Incident Map',

  // OfflineEmergencyCard
  'citizen.offline.title': 'Offline Emergency Guide',

  // OnboardingTutorial

  // RiskAssessment
  'citizen.risk.title': 'Personal Risk Assessment',

  // ShelterFinder
  'citizen.shelter.title': 'Emergency Shelter Finder',

  // SOSButton
  'citizen.sos.title': 'Emergency SOS',

  // AlertSubscribe
  'citizen.alertSubscribe.title': 'Alert Subscriptions',

  // ReportForm (additional keys)

  //SHARED COMPONENTS -- comprehensive i18n keys

  // AccessibilityPanel

  // AlertCaptionOverlay

  // ClimateRiskDashboard

  // ConfirmDialog

  // ConsentDialog

  // ErrorBoundary
  'shared.error.title': 'Something went wrong',
  'shared.error.refresh': 'Refresh Page',

  // DisasterMap & Map Components

  // FloodPredictionTimeline

  // FloodLayerControl

  // IncidentFilterPanel

  // IncomingAlertsWidget

  // IntelligenceDashboard

  // ModernNotification

  //LAYOUT COMPONENTS

  // Sidebar / Nav
  'layout.sidebar.home': 'Home',
  'layout.sidebar.communitySupport': 'Community Support',
  'layout.sidebar.safetyCheckIn': 'Safety Check-In',
  'layout.sidebar.myProfile': 'My Profile',
  'layout.sidebar.navigation': 'Navigation',
  'layout.sidebar.expandSidebar': 'Expand Sidebar',
  'layout.sidebar.collapseSidebar': 'Collapse Sidebar',
  'layout.sidebar.myAccount': 'My Account',
  'layout.sidebar.unlockFullFeatures': 'Unlock full features',
  'layout.sidebar.openNavigation': 'Open Navigation',

  // Header
  'layout.header.notifications': 'Notifications',
  'layout.header.profile': 'Profile',
  'layout.header.settings': 'Settings',

  //LANDING PAGE

  'landing.nav.features': 'Features',
  'landing.nav.howItWorks': 'How It Works',
  'landing.nav.dataSources': 'Data Sources',
  'landing.monitoring': 'NOW MONITORING',
  'landing.monitoringRegions': 'REGIONS WORLDWIDE',
  'landing.hero.mainTitle': 'Protecting Communities\nBefore Disaster Strikes',
  'landing.hero.btnCitizen': 'Access Citizen Portal',
  'landing.hero.btnOperator': 'Operator Login',
  'landing.features.title': 'Features',
  'landing.howItWorks.title': 'How It Works',
  'landing.dataSources.title': 'Data Sources',
  'landing.cta.title': 'Ready to Protect Your Community?',
  'landing.cta.getStarted': 'Get Started -- Free',

  //GENERAL / TIME / COMMON additional
  'time.mAgo': 'm ago',
  'time.hAgo': 'h ago',
  'common.search': 'Search',
  'common.filter': 'Filter',
  'common.export': 'Export',
  'common.import': 'Import',
  'common.delete': 'Delete',
  'common.edit': 'Edit',
  'common.save': 'Save',
  'common.cancel': 'Cancel',
  'common.confirm': 'Confirm',
  'common.yes': 'Yes',
  'common.no': 'No',
  'common.back': 'Back',
  'common.next': 'Next',
  'common.previous': 'Previous',
  'common.loading': 'Loading...',
  'common.noData': 'No data available',
  'common.retry': 'Retry',
  'common.all': 'All',
  'common.none': 'None',
  'common.selected': 'selected',
  'common.actions': 'Actions',
  'common.details': 'Details',
  'common.viewAll': 'View All',
  'common.seeMore': 'See More',
  'common.seeLess': 'See Less',
  'common.sortBy': 'Sort by',
  'common.ascending': 'Ascending',
  'common.descending': 'Descending',
  'common.from': 'From',
  'common.to': 'To',
  'common.total': 'Total',
  'common.system': 'System',
  'severity.high': 'High',
  'severity.medium': 'Medium',
  'severity.low': 'Low',
  'common.status': 'Status',
  'common.type': 'Type',
  'common.date': 'Date',
  'common.time': 'Time',
  'common.name': 'Name',
  'common.description': 'Description',
  'common.submit': 'Submit',
  'common.reset': 'Reset',
  'common.apply': 'Apply',
  'common.clear': 'Clear',
  'common.download': 'Download',
  'common.upload': 'Upload',
  'common.copy': 'Copy',
  'common.copied': 'Copied!',
  'common.enabled': 'Enabled',
  'common.disabled': 'Disabled',
  'common.on': 'On',
  'common.off': 'Off',
  'common.high': 'High',
  'common.medium': 'Medium',
  'common.low': 'Low',
  'common.urgent': 'Urgent',
  'common.verified': 'Verified',
  'common.unverified': 'Unverified',
  'common.flagged': 'Flagged',
  'common.resolved': 'Resolved',
  'common.pending': 'Pending',
  'common.active': 'Active',
  'common.inactive': 'Inactive',
  'common.online': 'Online',
  'common.offline': 'Offline',
  'common.connecting': 'Connecting',
  'analytics.idle': 'Idle',
  'common.success': 'Success',
  'common.error': 'Error',
  'common.warning': 'Warning',
  'common.info': 'Info',
  'common.live': 'Live',
  'common.view': 'View',
  'common.add': 'Add',
  'common.remove': 'Remove',
  'common.send': 'Send',
  'common.clearAll': 'Clear All',
  'common.selectAll': 'Select All',
  'common.deselectAll': 'Deselect All',
  'common.critical': 'Critical',
  'common.elevated': 'Elevated',
  'common.normal': 'Normal',
  'common.unknown': 'Unknown',
  'common.never': 'Never',
  'common.today': 'Today',
  'common.yesterday': 'Yesterday',
  'common.thisWeek': 'This Week',
  'common.lastWeek': 'Last Week',
  'common.or': 'or',
  'common.of': 'of',
  'common.entries': 'entries',
  'common.results': 'results',
  'common.email': 'Email',
  'common.phone': 'Phone',
  'common.location': 'Location',
  'common.severity': 'Severity',
  'common.priority': 'Priority',
  'common.category': 'Category',
  'common.target': 'Target',
  'common.before': 'Before',
  'common.after': 'After',
  'common.operator': 'Operator',
  'common.user': 'User',
  'common.role': 'Role',
  'common.action': 'Action',
  'common.timestamp': 'Timestamp',
  'common.exportCsv': 'Export CSV',
  'common.exportJson': 'Export JSON',

  //Time strings

  //Community Hub
  'community.hubTitle': 'Community Hub',
  'community.hubSubtitle': 'Manage live chat, posts, and community moderation',
  'community.confirmDeletePost': 'Delete this reported post? This cannot be undone.',
  'community.moderationQueue': 'Moderation Queue',
  'community.reportedPostsPending': 'reported posts pending review',
  'community.searchReportedPosts': 'Search reported posts...',
  'community.allClear': 'All Clear',
  'community.noReportedPosts': 'No reported posts require attention',
  'community.hazard': 'HAZARD',
  'community.removePost': 'Remove Post',
  'community.viewFullPost': 'View Full Post',
  'community.totalMessages': 'Total Messages',
  'community.totalPosts': 'Total Posts',
  'community.members': 'Members',
  'community.onlineNow': 'Online Now',
  'community.reportedPosts': 'Reported Posts',
  'community.todaysActivity': "Today's Activity",
  'community.contentModeration': 'Content Moderation',
  'community.healthy': 'Healthy',
  'community.needsAttention': 'Needs Attention',
  'community.actionRequired': 'Action Required',
  'community.userEngagement': 'User Engagement',
  'community.quiet': 'Quiet',
  'community.realtimeStatus': 'Real-time Status',
  'community.connected': 'Connected',
  'community.noPendingReports': 'No pending reports',
  'community.liveChat': 'Live Chat',
  'community.monitorConversations': 'Monitor conversations',
  'community.postsFeed': 'Posts Feed',
  'community.reviewCommunityPosts': 'Review community posts',
  'community.moderation': 'Moderation',
  'community.pending': 'pending',
  'community.userMgmt': 'User Mgmt',
  'community.banMuteKick': 'Ban, mute, kick',
  'community.overview': 'Overview',

  //Audit Trail
  'audit.title': 'Compliance Audit Trail',
  'audit.subtitle': 'Immutable operator action log',
  'audit.tamperEvident': 'Tamper-evident',
  'audit.totalEntries': 'Total Entries',
  'audit.criticalActions': 'Critical Actions',
  'audit.operators': 'Operators',
  'audit.actionTypes': 'Action Types',
  'audit.sevenDayActivity': '7-Day Activity',
  'audit.entriesThisWeek': 'entries this week',
  'audit.topOperators': 'Top Operators',
  'audit.noOperatorData': 'No operator data',
  'audit.searchPlaceholder': 'Search actions, operators, targets, IP...',
  'audit.dateFrom': 'From date',
  'audit.dateTo': 'To date',
  'audit.allTypes': 'All Types',
  'audit.allOperators': 'All Operators',
  'audit.newestFirst': 'Newest First',
  'audit.oldestFirst': 'Oldest First',
  'audit.noEntriesFound': 'No audit entries found',
  'audit.tryAdjustingFilters': 'Try adjusting your filters',
  'audit.actionsWillBeRecorded': 'Actions will be recorded here as operators take actions',
  'audit.stateChange': 'State Change',

  //Alert Broadcast
  'broadcast.title': 'Alert Broadcast Centre',
  'broadcast.subtitle': 'Multi-channel emergency alert distribution',
  'broadcast.severityLevel': 'Severity Level',
  'broadcast.channels': 'Delivery Channels',
  'broadcast.webPush': 'Web Push',
  'broadcast.telegram': 'Telegram',
  'broadcast.email': 'Email',
  'broadcast.sms': 'SMS',
  'broadcast.sending': 'Broadcasting...',

  //Analytics
  'analytics.title': 'Analytics Dashboard',
  'analytics.reportsToday': 'Reports Today',
  'analytics.avgAiConfidence': 'Avg AI Confidence',
  'analytics.falseReportRate': 'False Report Rate',
  'analytics.statusDistribution': 'Status Distribution',
  'analytics.topIncidentTypes': 'Top Incident Types',
  'analytics.totalIncidents': 'Total Incidents',
  'analytics.lastHour': 'Last Hour',
  'analytics.last24h': 'Last 24h',
  'analytics.mediaAttached': 'Media Attached',

  //Delivery Dashboard
  'delivery.title': 'Alert Delivery Control Center',
  'delivery.subtitle': 'Multi-channel delivery tracking',
  'delivery.allChannels': 'All Channels',
  'delivery.allStatuses': 'All Statuses',
  'delivery.totalSent': 'Total Sent',
  'delivery.delivered': 'Delivered',
  'delivery.failed': 'Failed',
  'delivery.pending': 'Pending',
  'delivery.retrying': 'Retrying',
  'delivery.retryAll': 'Retry All Failed',
  'delivery.retrySingle': 'Retry',
  'delivery.noDeliveries': 'No delivery records found',
  'delivery.grouped': 'Grouped',
  'delivery.flat': 'Flat',
  'delivery.searchPlaceholder': 'Search alerts, recipients...',

  //Distress Panel
  'distress.title': 'Distress Beacon Management',
  'distress.acknowledge': 'Acknowledge',
  'distress.resolve': 'Resolve',
  'distress.noCalls': 'No active distress calls',
  'distress.triage.low': 'Low',
  'distress.triage.medium': 'Medium',
  'distress.triage.high': 'High',
  'distress.triage.critical': 'Critical',
  'distress.vulnerable': 'Vulnerable Person',
  'distress.lastSeen': 'Last Seen',
  'distress.audioAlarm': 'Audio Alarm',
  'distress.muteAlarm': 'Mute Alarm',
  'distress.socketOffline': 'Socket offline -- cannot connect at this time',
  'distress.ackFailed': 'Acknowledge failed -- please try again',
  'distress.resolveFailed': 'Resolve failed -- please try again',
  'distress.resolvedByOperator': 'Resolved by operator',

  //Command Center
  'command.normal': 'NORMAL',
  'command.elevated': 'ELEVATED',
  'command.high': 'HIGH',
  'command.severe': 'SEVERE',
  'command.critical': 'CRITICAL',

  //Historical Intelligence
  'historical.title': 'Historical Intelligence',
  'historical.totalEvents': 'Total Events',
  'historical.highSeverity': 'High Severity',
  'historical.peopleAffected': 'People Affected',
  'historical.totalDamage': 'Total Damage',
  'historical.eventTypes': 'Event Types',
  'historical.allRegions': 'All Regions',
  'historical.liveData': 'Live Data',
  'historical.sampleData': 'Sample Data',
  'historical.demoTooltip': 'No historical events in database yet. Showing sample data for demonstration purposes.',
  'historical.liveTooltip': 'Showing real events from the database',
  'historical.activeRegion': 'Active Region',
  'historical.avgRisk': 'Avg Risk',
  'historical.recorded': 'recorded',
  'historical.historicalEvents': 'historical events',
  'historical.floods': 'Floods',
  'historical.searchPlaceholder': 'Search events by location, type, description...',
  'historical.allSeverity': 'All Severity',
  'historical.allTypes': 'All Types',
  'historical.newestFirst': 'Newest First',
  'historical.oldestFirst': 'Oldest First',
  'historical.mostAffected': 'Most Affected',
  'historical.noEventsMatch': 'No events match your filters',
  'historical.tryAdjustingFilters': 'Try adjusting search or filter criteria',
  'historical.affected': 'affected',
  'historical.fullDescription': 'Full Description',
  'historical.pastEventsBoard': 'Past Events Board',
  'historical.event': 'event',

  //AI Transparency
  'ai.title': 'AI Transparency & Model Analytics',
  'ai.models': 'Models',
  'ai.driftHealth': 'Drift & Health',
  'ai.accuracy': 'Accuracy',
  'ai.precision': 'Precision',
  'ai.recall': 'Recall',
  'ai.f1Score': 'F1 Score',
  'ai.ingest': 'INGEST',
  'ai.classify': 'CLASSIFY',
  'ai.predict': 'PREDICT',
  'ai.verify': 'VERIFY',
  'ai.modelHealth': 'Model Health',
  'ai.confidence': 'Confidence',
  'ai.dataPoints': 'Data Points',

  //Resource Deployment
  'resource.subtitle': 'Coordinate and deploy emergency resources',
  'resource.available': 'Available',
  'resource.deployed': 'Deployed',
  'resource.deploy': 'Deploy',
  'resource.recall': 'Recall',
  'resource.aiDraftAwaiting': 'AI Draft -- awaiting operator review',
  'resource.aiDraftNeedsReview': 'AI Draft -- needs review',
  'resource.linkedReport': 'Linked report',
  'resource.prediction': 'Prediction',
  'resource.operatorConfirmRequired': 'Operator confirmation required before deployment',

  //User Access Management
  'users.title': 'User & Access Management',
  'users.subtitle': 'RBAC, audit trail, account lifecycle',
  'users.administrator': 'Administrator',
  'users.operator': 'Operator',
  'users.viewer': 'Viewer',
  'users.suspended': 'Suspended',
  'users.activate': 'Activate',
  'users.suspend': 'Suspend',
  'users.resetPassword': 'Reset Password',
  'users.searchPlaceholder': 'Search users...',
  'users.allRoles': 'All Roles',
  'users.allStatuses': 'All Statuses',
  'users.addUser': 'Add User',
  'users.editUser': 'Edit User',
  'users.deleteUser': 'Delete User',
  'users.noUsers': 'No users found',
  'users.sessions': 'Sessions',
  'users.departments': 'Departments',
  'users.lastActive': 'Last Active',
  'users.created': 'Created',

  //Maps
  'map.evacuationRoutes': 'Evacuation Routes',
  'map.dark': 'Dark',
  'map.satellite': 'Satellite',
  'map.terrain': 'Terrain',
  'map.zoomIn': 'Zoom In',
  'map.zoomOut': 'Zoom Out',
  'map.resetView': 'Reset View',
  'map.refreshData': 'Refresh Data',
  'map.toggleLayers': 'Toggle Layers',
  'map.distressBeacons': 'Distress Beacons',
  'map.3dMode': '3D Mode',
  'map.2dMode': '2D Mode',
  'map.fullscreen': 'Fullscreen',

  //Weather
  'weather.humidity': 'Humidity',
  'weather.resetLocation': 'Reset location',

  //River Levels
  'river.title': 'River Levels',
  'river.currentLevel': 'Current Level',
  'river.warningLevel': 'Warning',
  'river.alertLevel': 'Alert',
  'river.useGps': 'Use my GPS location',
  'river.rising': 'Rising',
  'river.falling': 'Falling',
  'river.stable': 'Stable',
  'river.noStations': 'No river stations found',

  //Flood

  //Safety / Public
  'safety.exitSafetyMode': 'Exit Safety Mode',
  'safety.refreshData': 'Refresh data',

  //SOS
  'sos.title': 'Emergency SOS',
  'sos.activating': 'Activating SOS...',
  'sos.helpComing': 'HELP COMING',
  'sos.resolved': 'RESOLVED',

  //Shelter Finder
  'shelter.title': 'Emergency Shelters',

  //Report Form

  //Citizen Messaging
  'citizenMsg.searchConversations': 'Search conversations...',
  'citizenMsg.subjectPlaceholder': 'Subject (e.g. Emergency help needed)',
  'citizenMsg.describePlaceholder': 'Describe your issue...',
  'citizenMsg.attachImage': 'Attach image',
  'citizenMsg.newConversation': 'New Conversation',
  'citizenMsg.noConversations': 'No conversations yet',

  //Chat
  'chat.leaveComm': 'Leave community',

  //Risk Assessment
  'risk.title': 'Risk Assessment',
  'risk.moderate': 'Moderate',

  //Crowd Density
  'crowd.title': 'Crowd Density',
  'crowd.list': 'List',
  'crowd.grid': 'Grid',
  'crowd.chart': 'Chart',
  'crowd.useGps': 'Use GPS',

  //Live Incident Map

  //Onboarding / Offline
  'offline.title': 'Offline Emergency Card',
  'offline.searchPlaceholder': 'Search city, postcode, or region...',
  'offline.copyNumber': 'Copy number',

  //Alert Subscribe

  //Guest / Pages
  'guest.refreshAll': 'Refresh all data',

  //About
  'about.title': 'About AEGIS',
  'about.institution': 'Institution',
  'about.module': 'Module',
  'about.location': 'Location',

  //Accessibility
  'a11y.title': 'Accessibility Statement',

  //Spatial Toolbar
  'spatial.distance': 'Distance',
  'spatial.area': 'Area',
  'spatial.bufferZone': 'Buffer Zone',
  'spatial.radiusSearch': 'Radius Search',
  'spatial.floodRisk': 'Flood Risk',
  'spatial.nearestShelter': 'Nearest Shelter',
  'spatial.elevation': 'Elevation',
  'spatial.coordinates': 'Coordinates',
  'spatial.bearing': 'Bearing',
  'spatial.fullAnalysis': 'Full Analysis',
  'spatial.density': 'Density',
  'spatial.exportView': 'Export View',

  //Intelligence Dashboard

  //Climate Risk

  //Admin Page specific

  //Safety Check In

  //Preparedness Guide

  //All Reports Manager
  'allReports.cardView': 'Card view',
  'allReports.tableView': 'Table view',

  //Live Operations Map
  'liveOps.title': 'Live Operations Map',
  'liveOps.cop': 'Common Operating Picture',
  'liveOps.markers': 'markers',
  'liveOps.intel': 'Intel',
  'liveOps.initializing3d': 'Initializing 3D Engine...',
  'liveOps.mapLegend': 'Map Legend',
  'liveOps.overlays': 'Overlays',
  'liveOps.riverStation': 'River Station',
  'liveOps.feed': 'FEED',
  'liveOps.incidents': 'INCIDENTS',
  'liveOps.media': 'MEDIA',
  'liveOps.mode': 'MODE',

  //Messaging templates

  //Admin Login
  'login.title': 'Operator Login',

  //TERMS & PRIVACY (using generic keys)
  'terms.pageTitle': 'Terms of Service',
  'terms.lastUpdate': 'Last updated: January 2026',
  'terms.importantNotice': 'Important Notice',
  'terms.importantNoticeDesc': 'AEGIS is an academic honours project developed at Robert Gordon University. It is not a replacement for official emergency services. Always call 999 in a genuine emergency.',
  'terms.section1': '1. Acceptance of Terms',
  'terms.section2': '2. Description of Service',
  'terms.section3': '3. User Conduct',
  'terms.section4': '4. Privacy',
  'terms.section5': '5. Intellectual Property',
  'terms.section6': '6. Limitation of Liability',
  'terms.section7': '7. Indemnification',
  'terms.section8': '8. Governing Law',
  'terms.section9': '9. Severability',
  'terms.section10': '10. Changes to Terms',

  'privacy.title': 'Privacy Policy',
  'privacy.pageTitle': 'Privacy Policy',
  'privacy.lastUpdate': 'Last updated: January 2026',
  'privacy.section1': '1. Who We Are',
  'privacy.section2': '2. Information We Collect',
  'privacy.section3': '3. How We Use Your Information',
  'privacy.section4': '4. Legal Basis',
  'privacy.section5': '5. Data Sharing',
  'privacy.section6': '6. Data Security',
  'privacy.section7': '7. Your Rights',
  'privacy.section8': '8. Cookies',
  'privacy.section9': '9. Contact Us',
  'privacy.section10': '10. Changes to This Policy',

  // AI Transparency Console
  'ai.commandGovernance': 'AI Command & Governance',
  'ai.pipeline': 'AI PIPELINE',
  'ai.dataCollection': 'Data Collection',
  'ai.aiClassification': 'AI Classification',
  'ai.riskScoring': 'Risk Scoring',
  'ai.humanReview': 'Human Review',
  'ai.alertStep': 'ALERT',
  'ai.notification': 'Notification',
  'ai.activePredictions': 'Active Predictions',
  'ai.highRiskAreas': 'High Risk Areas',
  'ai.avgConfidence': 'Avg Confidence',
  'ai.dataSources': 'Data Sources',
  'ai.heatmapPoints': 'Heatmap Points',
  'ai.engineStatus': 'Engine Status',
  'ai.activePrediction': 'active prediction',
  'ai.noActivePredictions': 'No active predictions. Model awaiting data from monitored rivers.',
  'ai.pattern': 'Pattern',
  'ai.nextAreas': 'Next Areas',
  'ai.sendPreAlert': 'Send Pre-Alert',
  'ai.runOnDemandAnalysis': 'Run On-Demand Analysis',
  'ai.targetArea': 'Target Area',
  'ai.model': 'Model',
  'ai.runAnalysis': 'Run Analysis',
  'ai.probability': 'Probability',
  'ai.peakTime': 'Peak Time',
  'ai.radius': 'Radius',
  'ai.contributingFactors': 'Contributing Factors',
  'ai.heatmapCoverage': 'Heatmap Coverage',
  'ai.pts': 'pts',
  'ai.predictionFailed': 'Prediction run failed',
  'ai.preAlertSent': 'Pre-alert sent',
  'ai.preAlertFailed': 'Failed to send pre-alert',
  'ai.runPrediction': 'Run Prediction',
  'ai.livePredictionFeed': 'Live Prediction Feed',
  'ai.confShort': 'Conf:',
  'ai.modelVersionManagement': 'Model Version Management',
  'ai.hazardType': 'Hazard Type',
  'ai.region': 'Region',
  'ai.removeOverride': 'Remove Override',
  'ai.revertAutoSelection': 'Revert to automatic model selection?',
  'ai.activeLabel': 'Active:',
  'ai.currentVersion': 'Current version',
  'ai.healthBadge': 'Health badge',
  'ai.driftScore': 'Drift score',
  'ai.confidenceTrend': 'Confidence trend',
  'ai.fallbackCount': 'Fallback count',
  'ai.lastSnapshot': 'Last snapshot',
  'ai.versionTrend': 'Version Trend',
  'ai.promotedVersion': 'Promoted version:',
  'ai.currentLiveVersion': 'Current live version:',
  'ai.previousCandidate': 'Previous candidate:',
  'ai.rollbackRecommendation': 'Rollback recommendation:',
  'ai.noVersionsFound': 'No versions found',
  'ai.noFile': 'NO FILE',
  'ai.validateIntegrity': 'Validate integrity',
  'ai.promoteModel': 'Promote Model',
  'ai.promoteAsActive': 'Promote as active',
  'ai.interactiveModelExplorer': 'Interactive Model Explorer',
  'ai.noModelsAvailable': 'No models available',
  'ai.featureImportance': 'Feature Importance',
  'ai.confusionMatrix': 'Confusion Matrix',
  'ai.actualVsPredicted': 'Actual \\ Predicted',
  'ai.confidenceDistribution': 'Confidence Distribution',
  'ai.modelDriftMonitoring': 'Model Drift Monitoring',
  'ai.allModelsStable': 'All models stable -- no drift detected',
  'ai.stable': 'Stable',
  'ai.significantDrift': 'Significant drift',
  'ai.minorDrift': 'Minor drift',
  'ai.minimal': 'Minimal',
  'ai.baseline': 'Baseline',
  'ai.current': 'Current',
  'ai.scheduleRetraining': 'Schedule Retraining',
  'ai.retrainingScheduled': 'Retraining scheduled. This may take several minutes.',
  'ai.driftMagnitude': 'Drift magnitude',
  'ai.enhancedAuditTrail': 'Enhanced Audit Trail',
  'ai.totalExecutions': 'Total Executions',
  'ai.avgLatency': 'Avg Latency',
  'ai.errors': 'Errors',
  'ai.errorRate': 'Error Rate',
  'ai.exportCsv': 'Export CSV',
  'ai.noAuditEntries': 'No audit entries match filters',
  'ai.thModel': 'Model',
  'ai.thAction': 'Action',
  'ai.thTarget': 'Target',
  'ai.thStatus': 'Status',
  'ai.thLatency': 'Latency',
  'ai.thTimestamp': 'Timestamp',
  'shortcuts.refresh': 'Refresh',
  'shortcuts.exportCsv': 'Export CSV',
  'shortcuts.toggleFullscreen': 'Toggle Fullscreen',
  'shortcuts.toggleOptempo': 'Toggle OPTEMPO',
  'shortcuts.close': 'Close',
  'shortcuts.toggleMap': 'Toggle Map',
  'shortcuts.listTimeline': 'List/Timeline',
  'shortcuts.toggleShortcuts': 'Toggle Shortcuts',
  'ai.filterAll': 'All',
  'ai.filterGovernance': 'Governance',
  'ai.filterAnalysis': 'Analysis',
  'ai.filterClassification': 'Classification',
  'ai.promotionFailed': 'Promotion failed',
  'ai.demotionFailed': 'Demotion failed',
  'ai.validationFailed': 'Validation failed',
  'ai.submittingRetrain': 'Submitting retrain job...',
  'ai.retrainQueued': 'Retrain job queued successfully',
  'ai.retrainFailed': 'Retrain failed',
  'ai.promoted': 'Promoted',
  'ai.overrideRemoved': 'Override removed',
  'ai.integrityOk': 'Integrity OK',
  'ai.validationIssues': 'Validation issues found',
  'ai.setActiveModel': 'Set as active model',

  // Resource Deployment
  'resource.request': 'Request',
  'resource.staging': 'Staging',
  'resource.transit': 'Transit',
  'resource.onSite': 'On-Site',
  'resource.deMob': 'De-Mob',
  'resource.deployment': 'Resource Deployment',
  'resource.zones': 'Zones',
  'resource.affected': 'Affected',
  'resource.utilization': 'Utilization',
  'resource.assetReadiness': 'Asset Readiness',
  'resource.logisticsPipeline': 'Logistics Pipeline',
  'resource.deploymentZones': 'Deployment Zones',
  'resource.searchZones': 'Search zones or AI recommendations...',
  'resource.allPriorities': 'All priorities',
  'resource.allStatus': 'All status',
  'resource.standby': 'Standby',
  'resource.zone': 'Zone',
  'resource.assets': 'Assets',
  'resource.aiRecommendation': 'AI Recommendation',
  'resource.noZonesMatch': 'No zones match filters',
  'resource.recentActivity': 'Recent Deployment Activity',
  'resource.noActivity': 'No deployment activity recorded',
  'resource.reasonRequired': 'Deployment reason is required',
  'resource.deployResources': 'Deploy Resources',
  'resource.recallResources': 'Recall Resources',
  'resource.assetLogistics': 'Asset logistics',
  'resource.zoneManagement': 'Zone management',
  'resource.keyboardShortcuts': 'Keyboard shortcuts',
  'resource.deploymentZonesMap': 'Deployment Zones Map',
  'resource.tableView': 'Table view',
  'resource.gridView': 'Grid view',
  'resource.zoneId': 'Zone ID',
  'resource.priorityScore': 'Priority Score',
  'resource.estimatedAffected': 'Estimated Affected',
  'resource.deploymentStatus': 'Deployment Status',
  'resource.resourcesDeployed': 'Resources deployed',
  'resource.awaitingDeployment': 'Awaiting deployment',
  'resource.zoneActivityLog': 'Zone Activity Log',
  'resource.noActivityRecorded': 'No activity recorded',
  'resource.noRecommendation': 'No recommendation',

  // User Access Management
  'users.identityAccessMgmt': 'Identity & Access Management',
  'users.userDirectory': 'User Directory',
  'users.auditTrail': 'Audit Trail',
  'users.rolesPermissions': 'Roles & Permissions',
  'users.accessOverview': 'Access Overview',
  'users.inactive': 'Inactive',
  'users.admins': 'Admins',
  'users.operators': 'Operators',
  'users.viewers': 'Viewers',
  'users.24hLogins': '24h Logins',
  'users.user': 'User',
  'users.role': 'Role',
  'users.department': 'Department',
  'users.lastLogin': 'Last Login',
  'users.admin': 'Admin',
  'users.allStatus': 'All Status',
  'users.allDepartments': 'All Departments',
  'users.unassigned': 'Unassigned',
  'users.bulkAction': 'Bulk action...',
  'users.permissions': 'Permissions',
  'users.auditCompliance': 'Audit compliance',
  'users.accountLifecycle': 'Account lifecycle',
  'users.accountId': 'Account ID',
  'users.accountCreated': 'Account Created',
  'users.suspendedUntil': 'Suspended until',
  'users.accountActivity': 'Account Activity',
  'users.noAccountActivity': 'No activity recorded for this account',
  'users.noUsersMatch': 'No users match your criteria',
  'users.tryDifferentSearch': 'Try a different search term',
  'users.noUsersRegistered': 'No users registered yet',
  'users.accounts': 'accounts',
  'users.immutableAuditLog': 'Immutable audit log - entries cannot be modified or deleted',
  'users.roleDistribution': 'Role Distribution',
  'users.rbacEnforcement': 'RBAC Enforcement',
  'users.rbacEnforcementPrefix': 'RBAC is enforced at both API (middleware) and UI levels. JWT tokens carry role claims verified on every request. Admin actions require',
  'users.rbacEnforcementSuffix': 'middleware. Session tokens expire after 8 hours with automatic silent refresh.',
  'users.departmentAccessMatrix': 'Department Access Matrix',
  'users.securityPosture': 'Security Posture',
  'users.recentAccountEvents': 'Recent Account Events',
  'users.noAccountEvents': 'No account events recorded',
  'users.roleAssignment': 'Role Assignment',
  'users.selectDepartment': 'Select Department',
  'users.suspendAccount': 'Suspend Account',
  'users.suspensionWarning': 'This will immediately lock the user out. Existing active sessions will be blocked at next token refresh.',
  'users.reasonPlaceholder': 'Provide justification for this suspension...',
  'users.suspendUntilOptional': 'Suspend Until (optional)',
  'users.leaveBlankIndefinite': 'Leave blank for indefinite suspension',
  'users.confirmSuspension': 'Confirm Suspension',
  'users.inviteOperator': 'Invite Operator',
  'users.activatedSuccess': 'User activated successfully',
  'users.deletedSuccess': 'User deleted successfully',
  'users.resetLinkGenerated': 'Password reset link generated',

  // Admin Alert Broadcast
  'broadcast.titlePlaceholder': 'e.g. Flash Flood Warning -- River District',
  'broadcast.messageShort': 'Message is very short',
  'broadcast.affectedArea': 'Affected Area',
  'broadcast.areaPlaceholder': 'e.g. City Centre, Bridge of Don, Coastal areas',
  'broadcast.deliveryChannels': 'Delivery Channels',
  'broadcast.whatsapp': 'WhatsApp',
  'broadcast.broadcastAlert': 'Broadcast Emergency Alert',
  'broadcast.fillTitleMsg': 'Fill in title and message to enable broadcast',
  'broadcast.confirmBroadcast': 'Confirm Broadcast',
  'broadcast.confirmMsg': 'This will send to all subscribed citizens',
  'broadcast.severity': 'Severity',
  'broadcast.titleLabel': 'Title',
  'broadcast.messageLabel': 'Message',
  'broadcast.channelsLabel': 'Channels',
  'broadcast.criticalAlert': 'CRITICAL ALERT',
  'broadcast.criticalWarning': 'This will trigger high-priority notifications on all selected channels.',
  'broadcast.deliverySummary': 'Delivery Summary',
  'broadcast.recentBroadcasts': 'Recent Broadcasts',
  'broadcast.alertType': 'Alert Type',
  'broadcast.typeGeneral': 'General',
  'broadcast.typeFlood': 'Flood',
  'broadcast.typeFire': 'Wildfire',
  'broadcast.typeStorm': 'Severe Storm',
  'broadcast.typeEarthquake': 'Earthquake',
  'broadcast.typeHeatwave': 'Heatwave',
  'broadcast.typeLandslide': 'Landslide',
  'broadcast.typeDrought': 'Drought',
  'broadcast.typePowerOutage': 'Power Outage',
  'broadcast.typeWaterSupply': 'Water Supply Emergency',
  'broadcast.typeInfrastructure': 'Infrastructure Damage',
  'broadcast.typePublicSafety': 'Public Safety',
  'broadcast.typeEnvironmental': 'Environmental Hazard',
  'broadcast.typeTsunami': 'Tsunami',
  'broadcast.typeVolcanic': 'Volcanic Eruption',
  'broadcast.typePandemic': 'Pandemic / Health Emergency',
  'broadcast.typeChemicalSpill': 'Chemical / HazMat Spill',
  'broadcast.typeNuclear': 'Nuclear / Radiological',
  'broadcast.expiresAt': 'Expiration (optional)',
  'broadcast.expiresAtHint': 'Leave blank for no expiration. Alert will be auto-deactivated after this time.',
  'broadcast.noSubscribers': 'Alert saved but no subscribers found. Citizens need to subscribe first.',
  'broadcast.partialDelivery': 'Broadcast complete -- some deliveries failed',
  'broadcast.successDelivery': 'Broadcast successful',
  'broadcast.shortcuts': 'Shortcuts',
  'broadcast.toggleHistory': 'Toggle History',
  'broadcast.toggleShortcuts': 'Toggle Shortcuts',
  'broadcast.closeKey': 'Close',
  'broadcast.alertSource': 'Alert Source',
  'broadcast.fromReport': 'From Report',
  'broadcast.customAlert': 'Custom Alert',
  'broadcast.searchReports': 'Search reports by ID, location, or type...',
  'broadcast.noMatchingReports': 'No reports match your search',
  'broadcast.noActiveReports': 'No active reports available',
  'broadcast.switchToCustom': 'Switch to custom alert instead',
  'broadcast.linked': 'Linked',
  'broadcast.unlinkReport': 'Unlink report',
  'broadcast.autoPopulated': 'Title, severity, area, type, and message auto-populated from report. You can edit any field.',
  'broadcast.customHint': 'Compose a custom alert manually. Fill in all fields below.',
  'broadcast.sourceReport': 'Source Report',
  'broadcast.liveCard': 'Live Card',
  'broadcast.cardPreviewHint': 'This is how citizens will see this alert',

  // Audit Trail
  'audit.complianceTitle': 'Compliance Audit Trail',
  'audit.today': 'Today',
  'audit.thisWeek': 'This Week',
  'audit.action': 'Action',
  'audit.operator': 'Operator',
  'audit.target': 'Target',
  'audit.timestamp': 'Timestamp',
  'audit.before': 'Before',
  'audit.after': 'After',
  'audit.ipAddress': 'IP Address',
  'audit.browser': 'Browser',
  'audit.operatorId': 'Operator ID',
  'audit.copyOperatorId': 'Copy full ID',
  'audit.copyTargetId': 'Copy full ID',
  'audit.fetchError': 'Failed to refresh audit log',

  // Historical Intelligence
  'historical.subtitle': 'Event archive, flood heatmap & seasonal analytics',
  'historical.avgAffected': 'Avg Affected',
  'historical.distribution': 'Distribution',
  'historical.floodRiskHeatmap': 'Flood Risk Heatmap',
  'historical.heatmapSubtitle': 'Historical intensity from past events',
  'historical.seasonalTrends': 'Seasonal Flood Trends',
  'historical.seasonalSubtitle': 'Monthly flood frequency, rainfall, and severity analysis',
  'historical.totalFloods': 'Total Floods',
  'historical.totalRainfall': 'Total Rainfall',
  'historical.peakMonth': 'Peak Month',
  'historical.avgSeverity': 'Avg Severity',
  'historical.noEvents': 'No events to display',
  'historical.coordinates': 'Coordinates',
  'historical.impact': 'Impact',
  'historical.damageCost': 'Damage Cost',

  // Messaging
  'messaging.citizenInbox': 'Citizen Inbox',
  'messaging.totalConversations': 'total conversations',
  'messaging.searchPlaceholder': 'Search by name, subject, or message...',
  'messaging.mine': 'Mine',
  'messaging.noConversations': 'No conversations',
  'messaging.matchingThreads': 'Matching threads will appear here',
  'messaging.supportInbox': 'Citizen Support Inbox',
  'messaging.selectConversation': 'Select a conversation from the inbox to view messages, respond to citizens, and manage support threads.',
  'messaging.quickReplies': 'Quick Replies',
  'messaging.translation': 'Translation',
  'messaging.emergencyThread': 'EMERGENCY THREAD',
  'messaging.autoEscalated': 'Auto-escalated due to emergency keywords',
  'messaging.prioritySupport': 'Priority Support',
  'messaging.vulnerableCitizen': 'Vulnerable citizen -- respond with care and urgency',
  'messaging.noMessages': 'No messages yet',
  'messaging.startConversation': 'Start the conversation by sending a message below',
  'messaging.citizen': 'Citizen',
  'messaging.operator': 'Operator',
  'messaging.replyPlaceholder': 'Type a professional reply...',

  // Delivery Dashboard
  'delivery.dashboard': 'Delivery Dashboard',
  'delivery.successRate': 'Success Rate',
  'delivery.channelPerformance': 'Channel Performance',
  'delivery.recentDeliveries': 'Recent Deliveries',
  'delivery.noRecords': 'No delivery records',
  'delivery.retry': 'Retry',

  // Distress Panel
  'distress.beaconMonitor': 'Distress Beacon Monitor',
  'distress.activeBeacons': 'Active Beacons',
  'distress.noActiveBeacons': 'No active distress beacons',
  'distress.resolutionNote': 'Resolution Note',
  'distress.resolutionPlaceholder': 'e.g., Citizen evacuated safely',

  // Live Operations
  'liveOps.threat': 'THREAT',
  'liveOps.local': 'LOCAL',
  'liveOps.quickActions': 'Quick Actions (Q)',
  'liveOps.screenshot': 'Screenshot',
  'liveOps.exportData': 'Export Data',
  'liveOps.hideThreat': 'Hide Threat',
  'liveOps.showThreat': 'Show Threat',
  'liveOps.copyCoords': 'Click to copy coordinates',
  'liveOps.newReport': 'New Report',
  'liveOps.threatCritical': 'CRITICAL',
  'liveOps.threatHigh': 'HIGH',
  'liveOps.threatElevated': 'ELEVATED',
  'liveOps.threatGuarded': 'GUARDED',
  'liveOps.threatNominal': 'NOMINAL',
  'liveOps.predictions': 'Predictions',
  'liveOps.evacuation': 'Evacuation',
  'liveOps.statusBar': 'Status Bar',
  'liveOps.toggleHelp': 'Toggle Help',

  // Location Dropdown
  'location.searchPlaceholder': 'Search countries & regions...',
  'location.active': 'Active:',
  'location.noResults': 'No countries or regions match your search',
  'location.detailedMonitoring': 'Detailed monitoring',
  'location.countryOverview': 'Country overview',

  // Command Console

  // Analytics Center

  // Common additions
  'common.operational': 'OPERATIONAL',
  'common.processing': 'Processing',
  'common.standby': 'Standby',
  'common.ready': 'Ready',
  'common.shortcuts': 'Shortcuts',
  'common.analyzing': 'Analyzing',
  'common.sent': 'Sent',
  'common.risk': 'Risk',
  'common.exportCSV': 'Export CSV',
  'common.exportAllCSV': 'Export All CSV',
  'common.emergency': 'Emergency',
  'common.open': 'Open',
  'common.done': 'Done',
  'common.resolve': 'Resolve',
  'common.incidents': 'Incidents',
  'common.resources': 'Resources',
  'common.created': 'Created',
  'common.dismiss': 'Dismiss',
  'common.toggleMap': 'Toggle map',
  'common.toggleShortcuts': 'Toggle Shortcuts',
  'common.clearFilters': 'Clear Filters',
  'common.newest': 'Newest',
  'common.oldest': 'Oldest',
  'common.switchTabs': 'Switch Tabs',
  'common.quickReplies': 'Quick Replies',
  'common.autoTranslate': 'Auto-Translate',
  'common.quickActions': 'Quick Actions',
  'common.home': 'Home',
  'common.esc': 'Esc',
  'common.copySitrep': 'Copy SitRep',
  'common.toggleSitrep': 'Toggle SitRep',
  'common.communityHealth': 'Community Health',
  'common.recentReports': 'Recent Reports',
  'common.moreInModerationTab': 'more in Moderation tab',
  'common.report': 'report',
  'common.vulnerable': 'Vulnerable',
  'common.quickNavigation': 'Quick Navigation',
  'common.returnToMain': 'Return to the main landing page',
  'common.systemOnline': 'SYSTEM ONLINE',
  'common.encrypted': 'ENCRYPTED',
  'common.citizenPortal': 'Citizen Portal',
  'common.publicSafetyDashboard': 'Public safety dashboard & services',
  'common.continueWith': 'or continue with',
  'common.signInWithGoogle': 'Sign in with Google',
  'common.sessionExpired': 'Your session has expired. Please sign in again.',

  // Time

  // Map
  'map.layers': 'Layers',

  // Analytics Center / Dashboard (batch 2)
  'analytics.situationAssessment': 'Situation Assessment - Data Intelligence - Performance Metrics',
  'analytics.optempo': 'OPTEMPO',
  'analytics.reportsPerHr': 'Reports/hr',
  'analytics.slaTargets': 'SLA Performance Targets',
  'analytics.slaSubtitle': 'Service level compliance indicators',
  'analytics.verificationRate': 'Verification Rate',
  'analytics.resolutionRate': 'Resolution Rate',
  'analytics.urgentResponse': 'Urgent Response',
  'analytics.aiCoverage': 'AI Coverage',
  'analytics.severityDistribution': 'Severity Distribution',
  'analytics.activitySubtitle': 'Operator actions, system events, and audit trail',
  'analytics.dataQualityScorecard': 'Data Quality Scorecard',
  'analytics.dataQualitySubtitle': 'Report completeness and coverage metrics',
  'analytics.aiAnalyzed': 'AI Analyzed',
  'analytics.hasMedia': 'Has Media',
  'analytics.hasLocation': 'Has Location',
  'analytics.last7days': 'Last 7 days',
  'analytics.last30days': 'Last 30 days',
  'analytics.allTime': 'All time',
  'analytics.liveStreamConnected': 'Live stream connected',
  'analytics.pollingFallback': 'Polling fallback active',
  'analytics.reportsThisWeek': 'Reports This Week',
  'analytics.totalReports': 'Total Reports',
  'analytics.avgAIConfidence': 'Avg AI Confidence',
  'analytics.aiAccuracyRate': 'AI Accuracy Rate',
  'analytics.avgResponseTime': 'Avg Response Time',
  'analytics.avgVerifyTime': 'Avg Verify Time',
  'analytics.avgResolution': 'Avg Resolution',
  'analytics.geoCoverage': 'Geographic Coverage',
  'analytics.threatLevelIndex': 'Threat Level Index',
  'analytics.systemHealth': 'System Health',
  'analytics.database': 'Database',
  'analytics.liveStream': 'Live Stream',
  'analytics.analyticsEngine': 'Analytics Engine',
  'analytics.lastDataSync': 'Last Data Sync',
  'analytics.reportVolume': 'Report Volume + Moving Average',
  'analytics.noReportsInRange': 'No reports in selected range',
  'analytics.submitToGenerate': 'Submit a report to generate analytics',
  'analytics.noSeverityData': 'No severity data available',
  'analytics.reportsAppearHere': 'Reports will appear here once submitted',
  'analytics.noCategories': 'No incident categories yet',
  'analytics.categoriesPopulate': 'Categories will populate as reports arrive',
  'analytics.noStatusData': 'No status data available',
  'analytics.statusesAppear': 'Report statuses will appear here',
  'analytics.categoryHeatmap': 'Category Heatmap (Severity)',
  'analytics.noHeatmapData': 'No heatmap data yet',
  'analytics.crossCategoryData': 'Cross-category severity data will appear here',
  'analytics.locationClusters': 'Location Clusters',
  'analytics.noClusters': 'No geospatial clusters detected',
  'analytics.clustersAppear': 'Location clusters will appear as reports arrive',
  'analytics.reportsPerOfficer': 'Reports per Officer',
  'analytics.noOfficerActivity': 'No officer activity yet',
  'analytics.officerPerformance': 'Officer performance will be tracked here',
  'analytics.performanceMetrics': 'Performance Metrics',
  'analytics.forecastIntel': 'Forecast & Anomaly Intelligence',
  'analytics.noForecastData': 'No forecast data yet',
  'analytics.predictionsAppear': 'Predictions will appear once time-series builds',
  'analytics.dataQualityCoverage': 'Data Quality & Coverage',
  'analytics.liveAsOf': 'Live as of',
  'analytics.liveData': 'Live data',
  'analytics.hybridTrend': 'Hybrid Trend (Live + Client Approximation)',
  'analytics.weekOverWeek': 'Week-over-week',
  'analytics.monthlyTrend': 'Monthly trend',
  'analytics.detectedSpikes': 'Detected spikes',
  'analytics.clientTrendEstimate': 'Client trend estimate',
  'analytics.noReportsPopulate': 'No reports in this time range - bars will populate as data arrives.',
  'analytics.spike': 'Spike',
  'analytics.movingAvg': 'Moving avg',
  'analytics.scale': 'Scale',
  'analytics.adminResponseTime': 'Admin response time',
  'analytics.investigationCompletion': 'Investigation completion',
  'analytics.movingAverageWindow': 'Moving average window',
  'analytics.clientSideBuckets': '3 buckets (client-side)',
  'analytics.nextBucketForecast': 'Next bucket forecast',
  'analytics.seriesDirection': 'Series direction',
  'analytics.noAnomalies': 'No anomalies currently above dynamic threshold.',
  'analytics.spikeAt': 'Spike at',
  'analytics.hybridAnalyticsFootnote': 'Hybrid analytics: live DB aggregates + client approximations, with auto-refresh via WebSocket events and 60s polling fallback.',
  'analytics.mediaCoverage': 'Media coverage',
  'analytics.verificationCoverage': 'Verification coverage',
  'analytics.rising': 'Rising',
  'analytics.falling': 'Falling',
  'analytics.stable': 'Stable',
  'analytics.polling': 'Polling',

  // AI Transparency Dashboard (batch 2)
  'ai.recommendations': 'AI Recommendations',

  // Command Center (batch 2)
  'command.workflows': 'Workflows',
  'command.exportCsv': 'Export as CSV',
  'command.exportJson': 'Export as JSON',
  'command.sortReports': 'Sort reports',
  'command.realTime': 'Real-time',
  'command.comms': 'Comms',
  'command.situationBrief': 'Situation Brief',
  'command.opBrief': 'OPBRIEF',
  'command.threatPosture': 'THREAT POSTURE',
  'command.threatMatrix': 'Threat Matrix',
  'command.incidentTypesSeverity': 'Incident types × severity',
  'command.noIncidentData': 'No incident data',
  'command.newest': 'Newest',
  'command.oldest': 'Oldest',
  'command.latestReports': 'Latest incident reports',
  'command.noReportsYet': 'No reports yet',
  'command.alerts': 'Alerts',
  'command.allSystemsNominal': 'All systems nominal',
  'command.quickActions': 'Quick Actions',
  'command.sendAlert': 'Send Alert',
  'command.allReports': 'All Reports',
  'command.analytics': 'Analytics',
  'command.liveMap': 'Live Map',
  'command.officerLeaderboard': 'Officer Leaderboard',
  'command.last7DaysPerf': 'Last 7 days performance',
  'command.noLeaderboardData': 'No leaderboard data yet',
  'command.operatorActionsAppear': 'Operator actions will appear here',
  'command.liveActivityStream': 'Live Activity Stream',
  'command.realTimeActions': 'Real-time operator actions',
  'command.noActivityYet': 'No activity yet',
  'command.actionsStreamHere': 'Operator actions will stream here in real-time',
  'command.threatLevel': 'Threat Level',
  'command.total': 'Total',
  'command.trapped': 'Trapped',
  'command.daily': 'Daily',
  'command.weekly': 'Weekly',
  'command.new': 'New',
  'command.today': 'Today',
  'command.yesterday': 'Yest.',
  'command.thisWeek': 'This wk',
  'command.lastWeek': 'Last wk',
  'command.type': 'Type',
  'command.highAbbr': 'HI',
  'command.mediumAbbr': 'MD',
  'command.lowAbbr': 'LO',
  'command.totalSymbol': 'Σ',
 'command.aiHighLow': 'AI High->Low',
 'command.aiLowHigh': 'AI Low->High',
  'command.percentAi': '% AI',
  'command.handled': 'handled',
  'command.actions': 'actions',
  'command.justNow': 'just now',
  'command.reportPipeline': 'Report Pipeline',
  'command.copySitrep': 'Copy SitRep to clipboard',
  'command.filterBy': 'Filter by {type}',
  'command.targetBenchmark': 'Target benchmark',
  'command.noActionsRequired': 'No actions required at this time',
  'command.excellent': 'Excellent',
  'command.needsAttention': 'Needs Attention',
  'command.ratingExcellent': 'Excellent',
  'command.ratingGood': 'Good',
  'command.ratingFair': 'Fair',
  'command.ratingSlow': 'Slow',
  'command.priorityCritical': 'Critical',
  'command.priorityHigh': 'High',
  'command.priorityMedium': 'Medium',

  // All Reports Manager (batch 2)
  'allReports.incidentReports': 'Incident Reports',
  'allReports.matchingFilters': 'matching current filters',
  'allReports.reportPipeline': 'Report Pipeline',
  'allReports.activityTimeline': '24h Activity Timeline',
  'allReports.aiSmartFilter': 'AI Smart Filter',

  // Login Page (batch 2)
  'login.realTimeMonitoring': 'Real-Time Monitoring',
  'login.liveIncidentTracking': 'Live incident tracking across all channels',
  'login.aiPoweredAnalysis': 'AI-Powered Analysis',
  'login.automatedSeverity': 'Automated severity assessment and prediction',
  'login.secureAccess': 'Secure Access',
  'login.endToEndEncrypted': 'End-to-end encrypted with role-based controls',
  'login.forgotPassword': 'Forgot Password?',
  'login.signIn': 'Sign In',
  'login.email': 'Email',
  'login.password': 'Password',

  // Common (batch 2)
  'common.csv': 'CSV',
  'common.json': 'JSON',
  'common.overview': 'Overview',
  'common.available': 'Available',
  'common.connected': 'Connected',
  'common.running': 'Running',
  'common.showLess': 'Show less',
  'common.showMore': 'Show more',

  // Citizen batch keys
  'common.gps': 'GPS',
  'common.refreshData': 'Refresh Data',
  'common.closed': 'Closed',
  'common.moderate': 'Moderate',
  'common.skip': 'Skip',
  'common.getStarted': 'Get Started',
  'common.gotIt': 'Got It',
  'common.cancelled': 'Cancelled',
  'common.submitting': 'Submitting...',
  'safetyCheck.areYouSafe': 'Are you safe?',
  'safetyCheck.imSafe': "I'm Safe",
  'safetyCheck.needHelp': 'Need Help',
  'safetyCheck.unsure': 'Unsure',
  'crowd.people': 'People',
  'crowd.density': 'Density',
  'crowd.rising': 'Rising',
  'crowd.noZonesMatch': 'No zones match your filter',
  'incident.liveMap': 'Live Incident Map',
  'incident.activity': 'Activity',
  'citizenMsg.myMessages': 'My Messages',
  'citizenMsg.unread': 'unread',
  'citizenMsg.selectImageFile': 'Select image file',
  'citizenMsg.imageSizeLimit': 'Image must be under 5MB',
  'citizenMsg.uploadFailed': 'Upload failed',
  'citizenMsg.sendFailed': 'Send failed',
  'citizenMsg.generalInquiry': 'General Inquiry',
  'citizenMsg.reportIssue': 'Report Issue',
  'citizenMsg.feedback': 'Feedback',
  'citizenMsg.tryDifferentSearch': 'Try a different search term',
  'citizenMsg.startNewConversation': 'Start a new conversation with our team',
  'citizenMsg.liveUpdatesActive': 'Live - Real-time updates active',
  'citizenMsg.emptyStateDescription': 'Select a conversation from the inbox to view messages and communicate with our emergency response team.',
  'citizenMsg.endToEndSecure': 'End-to-end secure',
  'citizenMsg.support247': '24/7 Support',
  'citizenMsg.emergencyThread': 'EMERGENCY THREAD',
  'citizenMsg.urgentFlagged': 'This conversation has been flagged as urgent',
  'citizenMsg.startConversation': 'Send a message to start the conversation',
  'citizenMsg.operatorLabel': 'Operator',
  'citizenMsg.operatorAssigned': 'Operator assigned',
  'citizenMsg.supportAgent': 'Support Agent',
  'citizenMsg.you': 'You',
  'citizenMsg.today': 'Today',
  'citizenMsg.yesterday': 'Yesterday',
  'citizenMsg.noConversationsFound': 'No conversations found',
  'alertSub.channels': 'Alert Channels',
  'alertSub.subscribed': 'Subscribed',
  'alertSub.selectChannel': 'Select a channel',
  'community.guidelines': 'Community Guidelines',
  'community.guidelinesSubtitle': 'Help keep our community safe and respectful',
  'community.beRespectful': 'Be respectful and considerate of others',
  'community.prohibitedContent': 'No hate speech, harassment, or bullying',
  'community.postAccurate': 'Post accurate and verified information only',
  'community.protectPrivacy': 'Protect the privacy of others',
  'community.ourValues': 'Our Values',

  // SOS keys
  'sos.emergencySOS': 'Emergency SOS',
  'sos.emergencySOSButton': 'Emergency SOS Button',
  'sos.sosActive': 'SOS ACTIVE',
  'sos.cancelSOS': 'Cancel SOS',
  'sos.sendingDistress': 'Sending distress in',
  'sos.broadcasting': 'Broadcasting location to emergency operators',
  'sos.isResponding': 'is responding',
  'sos.situationResolved': 'Situation resolved',
  'sos.pressToActivate': 'Press SOS to activate',
  'sos.accuracy': 'accuracy',
  'sos.triage': 'Triage',
  'sos.gpsAcquired': 'GPS signal acquired',
  'sos.beaconTransmitted': 'Beacon transmitted',
  'sos.operatorAcknowledged': 'Operator acknowledged',

  // Chat keys
  'chat.welcomeMessage': "Hello! I'm the AEGIS Emergency Assistant. I can help with safety guidance for **all disaster types** -- floods, storms, heatwaves, wildfires, landslides, power outages, water supply issues, infrastructure damage, public safety, and environmental hazards.\n\nI can also help you:\n- **Report incidents** and check active alerts\n- Find **evacuation routes** and shelters\n- Get **real-time predictions** from our AI models\n\nI understand multiple languages -- feel free to ask in yours.\n\nWhat do you need help with?",
  'chat.offlineMode': 'Offline mode -- local responses',
  'chat.typing': 'Thinking...',
  'chat.messageLabel': 'Message',
  'chat.sendLabel': 'Send',

  // Offline emergency card keys
  'offline.emergencySurvivalCard': 'Emergency Survival Card',
  'offline.searchOrGPS': 'Search or use GPS',
  'offline.searchSavePrintShare': 'Search or use GPS -- Save offline -- Print -- Share',
  'offline.offlineReady': 'Offline Ready',
  'offline.enableLocation': 'Enable location to see local data',
  'offline.locationUnavailable': 'Location unavailable',
  'offline.locationNotFound': 'Location not found. Try city, region, or postcode.',
  'offline.locate': 'Locate',
  'offline.contacts': 'Contacts',
  'offline.tips': 'Tips',
  'offline.countries': 'Countries',
  'offline.emergencyContacts': 'Emergency Contacts',
  'offline.primary': 'Primary',
  'offline.survivalTips': 'Survival Tips',
  'offline.regionSpecific': 'Region-specific',
  'offline.personalMedicalNotes': 'Personal Medical Info & Notes',
  'offline.medicalLabel': 'Medical Conditions / Allergies',
  'offline.medicalPlaceholder': 'e.g. diabetic, severe allergy, inhaler required',
  'offline.personalNotesLabel': 'Personal Notes',
  'offline.personalNotesPlaceholder': 'e.g. family meet point, support contacts',
  'offline.savedOffline': 'Saved Offline',
  'offline.saveOffline': 'Save Offline',
  'offline.print': 'Print',
  'offline.share': 'Share',
  'offline.aegisEmergencyData': 'AEGIS Emergency Data',
  'offline.countriesSupported': 'countries supported',

  // Community Help keys
  'communityHelp.title': 'Community Help',
  'communityHelp.subtitle': 'Safe, verified mutual aid for your area',
  'communityHelp.safetyFirst': 'Safety First',
  'communityHelp.safetyAnonymous': 'All interactions are anonymous by default',
  'communityHelp.safetyReviewed': 'Offers are reviewed before being shown publicly',
  'communityHelp.safetyLocation': 'Location sharing is optional -- only approximate area',
  'communityHelp.safetyNoAddress': 'Never share personal addresses publicly',
  'communityHelp.safetyMeetPublic': 'Always meet helpers in well-lit public places',
  'communityHelp.safetyReport': 'Report suspicious listings -- our team reviews them',
  'communityHelp.safetyCall999': 'For life emergencies always call {{EMERGENCY_NUMBER}} first',
  'communityHelp.understand': 'I Understand -- Continue Safely',
  'communityHelp.gpsActive': 'GPS Active',
  'communityHelp.resources': 'Resources',
  'communityHelp.offer': 'Offer',
  'communityHelp.needHelp': 'Need Help',
  'communityHelp.network': 'Network',
  'communityHelp.searchPlaceholder': 'Search...',
  'communityHelp.all': 'All',
  'communityHelp.offerHelpTitle': 'Offer Help to Your Community',
  'communityHelp.offerHelpDesc': 'Sign in to offer shelter, food, transport, medical aid, or supplies to people affected by emergencies in your area.',
  'communityHelp.offerBullet1': 'Post anonymous offers visible to your community',
  'communityHelp.offerBullet2': 'Choose safe public meeting locations',
  'communityHelp.offerBullet3': 'Get a Verified Helper badge for more trust',
  'communityHelp.offerBullet4': 'Remove or update your offers at any time',
  'communityHelp.offerBullet5': 'All listings are moderated for safety',
  'communityHelp.signInOffer': 'Sign In to Offer Help',
  'communityHelp.noAccount': "Don't have an account?",
  'communityHelp.registerFree': 'Register free',
  'communityHelp.requestTitle': 'Request Community Assistance',
  'communityHelp.requestDesc': 'Sign in to submit anonymous help requests. Nearby verified volunteers will be notified and can respond.',
  'communityHelp.requestBullet1': 'Request shelter, food, transport, medical aid, or supplies',
  'communityHelp.requestBullet2': 'Your identity stays completely anonymous',
  'communityHelp.requestBullet3': 'Mark requests as urgent for faster response',
  'communityHelp.requestBullet4': 'Only share approximate area -- never exact address',
  'communityHelp.requestBullet5': 'For life emergencies always call {{EMERGENCY_NUMBER}} first',
  'communityHelp.signInRequest': 'Sign In to Request Help',
  'communityHelp.joinNetworkTitle': 'Join the Community Network',
  'communityHelp.joinNetworkDesc': 'Sign in to connect with verified helpers, request secure anonymous contact, and apply for a Verified Helper badge.',
  'communityHelp.networkBullet1': 'Browse verified helpers with trust ratings',
  'communityHelp.networkBullet2': 'Request anonymous secure contact through our system',
  'communityHelp.networkBullet3': 'Apply for Verified Helper status (free)',
  'communityHelp.networkBullet4': 'Safe public meeting place coordination',
  'communityHelp.networkBullet5': 'Report suspicious listings to our moderation team',
  'communityHelp.signInNetwork': 'Sign In to Join Network',
  'communityHelp.resourcesNear': 'resources near',
  'communityHelp.noResourcesMatch': 'No resources match',
  'communityHelp.visitWebsite': 'Visit website',
  'communityHelp.offerAgreement': 'Offer Agreement',
  'communityHelp.agreeOffer1': 'Your offer is reviewed before being shown',
  'communityHelp.agreeOffer2': 'Never include personal address or phone publicly',
  'communityHelp.agreeOffer3': 'Specify a public safe meeting location',
  'communityHelp.agreeOffer4': 'Only meet helpers in well-lit public places',
  'communityHelp.agreeOffer5': 'You can remove your offer at any time',
  'communityHelp.agreeOffer6': 'False offerings may result in account action',
  'communityHelp.agreePostOffer': 'I Agree -- Post Offer',
  'communityHelp.privateNotice': 'Private: Contact details never shown publicly. All offers reviewed before going live.',
  'communityHelp.whatCanYouOffer': 'What can you offer?',
  'communityHelp.descriptionSublabel': '(be specific -- no personal info)',
  'communityHelp.descriptionPlaceholder': 'e.g. Spare room for up to 2 adults, warm and dry, local area only...',
  'communityHelp.charsCount': 'chars',
  'communityHelp.approximateArea': 'Approximate area',
  'communityHelp.notExactAddress': '(not exact address)',
  'communityHelp.areaPlaceholder': 'e.g. Downtown, North side of city...',
  'communityHelp.safeMeetingPlace': 'Safe public meeting place',
  'communityHelp.selectMeetingPlace': 'Select a public meeting place...',
  'communityHelp.otherTypeBelow': 'Other (type below)',
  'communityHelp.specifyLocation': 'Specify public location...',
  'communityHelp.requestVerifiedBadge': 'Request Verified Badge',
  'communityHelp.verifiedBadgeDesc': 'I confirm I am who I say I am. My listing will show a verified badge and may require ID check.',
  'communityHelp.postOfferBtn': 'Post Offer (Anonymous - Moderated)',
  'communityHelp.posting': 'Posting...',
  'communityHelp.communityOffers': 'Community Offers',
  'communityHelp.requestAgreement': 'Request Agreement',
  'communityHelp.agreeReq1': 'Your request is completely anonymous',
  'communityHelp.agreeReq2': 'Only share approximate area -- not exact address',
  'communityHelp.agreeReq3': 'Only meet helpers in well-lit public places',
  'communityHelp.agreeReq4': 'Call {{EMERGENCY_NUMBER}} for life-threatening emergencies',
  'communityHelp.agreeReq5': 'Do not disclose financial details to helpers',
  'communityHelp.agreeReq6': 'False requests may block future access',
  'communityHelp.agreeRequestHelp': 'I Agree -- Request Help',
  'communityHelp.emergencyCall': 'Emergency? Call {{EMERGENCY_NUMBER}} first. This is for non-emergency community assistance.',
  'communityHelp.whatDoYouNeed': 'What do you need?',
  'communityHelp.detailsSublabel': '(no personal info)',
  'communityHelp.detailsPlaceholder': 'Number of people, specific needs, accessibility requirements...',
  'communityHelp.numPeople': 'No. of people',
  'communityHelp.areaOrPostcode': 'Area or postcode',
  'communityHelp.markUrgent': 'Mark as Urgent',
  'communityHelp.urgentDesc': 'Immediately alerts nearest available verified volunteers',
  'communityHelp.sendUrgent': 'Send Urgent Request',
  'communityHelp.submitRequest': 'Submit Request (Anonymous)',
  'communityHelp.verifiedNetwork': 'Verified Community Network',
  'communityHelp.verifiedNetworkDesc': 'These helpers have been verified through official channels. Higher trust, always use public meeting places.',
  'communityHelp.verified': 'Verified',
  'communityHelp.reportListing': 'Report listing',
  'communityHelp.requestSecureContact': 'Request Secure Contact',
  'communityHelp.moreInfo': 'More Info',
  'communityHelp.noVerifiedHelpers': 'No verified helpers in this category yet',
  'communityHelp.checkBackSoon': 'Check back soon or view all community offers',
  'communityHelp.becomeVerified': 'Become a Verified Helper',
  'communityHelp.becomeVerifiedDesc': 'Verified helpers receive more requests. Requires identity confirmation through our local authority partner scheme.',
  'communityHelp.applyVerification': 'Apply for Verification',
  'communityHelp.applyVerifiedTitle': 'Apply for Verified Helper Status',
  'communityHelp.applicationReceived': 'Application Received!',
  'communityHelp.applicationReviewMsg': "We'll review your details within 2-3 working days and contact you at the email provided.",
  'communityHelp.verificationInfo': 'Verification is free and processed through our local authority partner scheme. You will receive a badge visible to people requesting help.',
  'communityHelp.fullName': 'Full Name',
  'communityHelp.fullNamePlaceholder': 'Your legal full name',
  'communityHelp.emailAddress': 'Email Address',
  'communityHelp.emailPlaceholder': 'your@email.com',
  'communityHelp.areaCity': 'Area / City',
  'communityHelp.areaCityPlaceholder': 'e.g. your city or area name...',
  'communityHelp.selectOffer': 'Select...',
  'communityHelp.offerShelter': 'Emergency shelter / spare room',
  'communityHelp.confirmAccuracy': 'I confirm all information is accurate and I consent to identity verification by our moderation team.',
  'communityHelp.submitApplication': 'Submit Application',
  'communityHelp.helperDetails': 'Helper Details',
  'communityHelp.verifiedHelper': 'Verified Helper',
  'communityHelp.locationLabel': 'Location',
  'communityHelp.postedLabel': 'Posted',
  'communityHelp.safeMeetingPlaceLabel': 'Safe Public Meeting Place',
  'communityHelp.contactRoutedNotice': 'Contact is routed through our anonymous secure system. The helper never sees your personal details until you choose to share them at the agreed public meeting point.',
  'communityHelp.secureRequestSent': 'Secure Request Sent',
  'communityHelp.requestForwarded': 'Your anonymous request has been forwarded to the helper.',
  'communityHelp.ifTheyAccept': "If they accept, you'll receive a notification to arrange a meeting at the agreed public location.",
  'communityHelp.done': 'Done',
  'communityHelp.identityAnonymous': 'Your identity is fully anonymous. The helper will only know your approximate area and what you need.',
  'communityHelp.yourMessage': 'Your message',
  'communityHelp.optional': '(optional)',
  'communityHelp.sendAnonymousRequest': 'Send Anonymous Request',
  'communityHelp.reportSuspicious': 'Report suspicious',

  // Shared: PublicSafetyMode
  'safety.aegisPublicSafety': 'AEGIS PUBLIC SAFETY',
  'safety.emergencyInfoDisplay': 'Emergency Information Display',
  'safety.activeAlerts': 'Active Alerts',
  'safety.otherWarnings': 'Other warnings',
  'safety.noActiveAlerts': 'No active alerts -- all clear',
  'safety.currentWeather': 'Current Weather',
  'safety.floodRiskForecast': 'Flood Risk Forecast',
  'safety.lowerRiskAreas': 'Lower-risk areas',
  'safety.emergencyShelters': 'Emergency Shelters',
  'safety.noShelters': 'No shelters nearby -- dial 999 for help',
  'safety.emergencyResources': 'Emergency Resources',
  'safety.lastUpdated': 'Last updated',
  'safety.aegisSystem': 'AEGIS Emergency Response System',

  // Shared: SpatialToolbar
  'spatial.displayTools': 'Display Tools',
  'spatial.closeTool': 'Close',
  'spatial.radius': 'Radius',
  'spatial.exportFormat': 'Export Format',
  'spatial.occupancy': 'Occupancy',
  'spatial.capacity': 'Capacity',
  'spatial.away': 'away',
  'spatial.elevationProfile': 'Elevation Profile',

  // Shared: WeatherPanel
  'weather.enableLocation': 'Enable location to see local weather',
  'weather.gpsNotAvailable': 'GPS not available',
  'weather.localConditions': 'Local Conditions',
  'weather.detecting': 'Detecting...',
  'weather.warning': 'warning',
  'weather.updated': 'Updated',

  // Shared: RiverGaugePanel
  'river.riverLevels': 'River Levels',
  'river.live': 'LIVE',
  'river.gpsNotSupported': 'GPS not supported',
  'river.locationDenied': 'Location access denied',
  'river.locationUnavailable': 'Location unavailable',
  'river.floodAlert': 'FLOOD ALERT',
  'river.warning': 'WARNING',
  'river.normal': 'NORMAL',
  'river.useMyGPS': 'Use my GPS',
  'river.noGaugeData': 'No gauge data available',
  'river.hoverDetails': 'Hover for details',
  'river.current': 'Current',
  'river.trend': 'Trend',
  'river.floodAlertMsg': 'Flood alert -- take precautions',
  'river.warningMsg': 'Water levels elevated',
  'river.liveMonitoring': 'LIVE monitoring',
  'river.refreshBtn': 'Refresh',
  'river.fetchingData': 'Fetching river data...',
  'river.flow': 'Flow',
  'river.source': 'Source',
  'river.thresholds': 'Thresholds',

  // Shared: FloodLayerControl
  'floodLayer.active': 'active',
  'floodLayer.showAll': 'Show All',
  'floodLayer.hideAll': 'Hide All',
  'floodLayer.fluvialHigh': 'Fluvial Flood (High)',
  'floodLayer.fluvialHighDesc': '1 in 10 year return period',
  'floodLayer.fluvialMedium': 'Fluvial Flood (Medium)',
  'floodLayer.fluvialMediumDesc': '1 in 200 year return period',
  'floodLayer.surfaceWater': 'Surface Water',
  'floodLayer.surfaceWaterDesc': 'Surface water flooding',
  'floodLayer.coastalFlood': 'Coastal Flood',
  'floodLayer.coastalFloodDesc': 'Coastal / tidal flooding',
  'floodLayer.prediction1h': 'Prediction: 1 Hour',
  'floodLayer.prediction1hDesc': 'Predicted flood extent in 1 hour',
  'floodLayer.prediction4h': 'Prediction: 4 Hours',
  'floodLayer.prediction4hDesc': 'Predicted flood extent in 4 hours',
  'floodLayer.prediction6h': 'Prediction: 6 Hours',
  'floodLayer.prediction6hDesc': 'Predicted flood extent in 6 hours',
  'floodLayer.evacuationRoutes': 'Evacuation Routes',
  'floodLayer.evacuationRoutesDesc': 'Pre-calculated evacuation corridors',
  'floodLayer.floodZonesWms': 'Flood Zones (WMS)',
  'floodLayer.predictions': 'Predictions',
  'floodLayer.evacuation': 'Evacuation',

  // Shared: FloodPredictionTimeline
  'floodPred.riversMonitored': 'rivers monitored',
  'floodPred.now': 'NOW',
  'floodPred.nowLabel': 'Now',
  'floodPred.atRisk': 'At Risk',
  'floodPred.properties': 'Properties',
  'floodPred.people': 'People',
  'floodPred.confidence': 'Confidence',

  // Shared: OfflineIndicator
  'offline.backOnline': 'Back online',
  'offline.syncing': 'syncing',
  'offline.queued': 'queued',
  'offline.youAreOffline': 'You are offline',
  'offline.trySync': 'Try to sync now',
  'offline.trySyncAria': 'Try to sync queued requests',

  // Shared: AccessibilityPanel
  'a11y.screenReader': 'Screen Reader',
  'a11y.screenReaderDesc': 'Read aloud focused elements & alerts',
  'a11y.highContrast': 'High Contrast',
  'a11y.highContrastDesc': 'Stronger borders for low vision',
  'a11y.largeText': 'Large Text',
  'a11y.largeTextDesc': 'Increase text size 25%',
  'a11y.dyslexiaFriendly': 'Dyslexia-Friendly',
  'a11y.dyslexiaFriendlyDesc': 'Wider spacing, heavier weight',
  'a11y.reducedMotion': 'Reduced Motion',
  'a11y.reducedMotionDesc': 'Disable animations',
  'a11y.focusHighlight': 'Focus Highlight',
  'a11y.focusHighlightDesc': 'Bold outlines for keyboard nav',
  'a11y.colourVision': 'Colour Vision',
  'a11y.default': 'Default',
  'a11y.protanopia': 'Protanopia',
  'a11y.deuteranopia': 'Deuteranopia',
  'a11y.tritanopia': 'Tritanopia',
  'a11y.resetAll': 'Reset All',

  // Shared: AlertCaptionOverlay
  'caption.critical': 'CRITICAL',
  'caption.warning': 'WARNING',
  'caption.info': 'INFO',
  'caption.readAloud': 'Read alert aloud',
  'caption.dismiss': 'Dismiss caption',

  // Shared: IncomingAlertsWidget
  'alerts.loading': 'Loading alerts...',
  'alerts.noActive': 'No active alerts at this time',
  'alerts.viewDetails': 'View Details',
  'alerts.backToAegis': 'Back to AEGIS',
  'alerts.pageTitle': 'Active Alerts',
  'alerts.subtitle': 'Emergency broadcasts for',
  'alerts.yourArea': 'your area',
  'alerts.refresh': 'Refresh',
  'alerts.allClear': 'All clear in your area',
  'alerts.searchPlaceholder': 'Search alerts by title, description, or area...',
  'alerts.filters': 'Filters',
  'alerts.sortNewest': 'Newest First',
  'alerts.sortSeverity': 'By Severity',
  'alerts.filterAll': 'All',
  'alerts.noMatchFilters': 'No alerts match your current filters. Try adjusting your search.',
  'alerts.noAlertsMessage': 'There are no active emergency alerts for your area at this time. Stay safe!',
  'alerts.source': 'Source',
  'alerts.type': 'Type',
  'alerts.issued': 'Issued',
  'alerts.broadcastChannels': 'Broadcast Channels',
  'alerts.expires': 'Expires',
  'alerts.badgeCritical': 'Critical',
  'alerts.badgeWarnings': 'Warnings',
  'alerts.badgeTotalActive': 'Total Active',
  'alerts.aboutTitle': 'About Emergency Alerts',
  'alerts.aboutDesc': 'Alerts are broadcast by AEGIS administrators through multiple channels including web, email, SMS, Telegram, and WhatsApp. All active alerts are displayed here regardless of your subscription status. For real-time push notifications, subscribe to alert channels on the',
  'alerts.citizenPortal': 'citizen portal',
  'alerts.severityCritical': 'CRITICAL',
  'alerts.severityHigh': 'HIGH',
  'alerts.severityWarning': 'WARNING',
  'alerts.severityInfo': 'INFO',
  'alerts.general': 'General',

  // Shared: ConsentDialog
  'consent.privacyTitle': 'Privacy & Consent',
  'consent.requiredWarning': 'This permission is required for the feature to work. Your data is processed locally and never shared.',
  'consent.optionalWarning': 'This is optional. The feature will work with limited functionality without this permission.',
  'consent.goBack': 'Go Back',

  // Shared: ConfirmDialog
  'confirm.confirm': 'Confirm',
  'confirm.cancel': 'Cancel',

  // Shared: CountrySearch
  'country.searchPlaceholder': 'Type country name or +code...',
  'country.noResults': 'No countries found',
  'country.countries': 'countries',

  // Shared: ErrorBoundary & Resilience Layer
  'error.unexpected': 'An unexpected error occurred.',
  'error.sectionCrashed': 'This section crashed. Other parts of the app should still work.',
  'error.tryAgain': 'Try Again',
  'error.pageTitle': 'Something went wrong',
  'error.pageMessage': 'An unexpected error occurred. Our team has been notified and is working to resolve it.',
  'error.reportIssue': 'Report issue',
  'error.correlationId': 'Reference',
  'error.retryCountExhausted': 'Multiple retries failed. Please refresh the page or contact support.',
  'error.retryIn': 'Retrying in {seconds}s...',
  'error.goHome': 'Go Home',

  // 404 Not Found
  'notFound.title': 'Page not found',
  'notFound.heading': '404',
  'notFound.message': "The page you're looking for doesn't exist or has been moved. Use the links below to navigate back to safety.",
  'notFound.home': 'Home',
  'notFound.citizenPortal': 'Citizen Portal',
  'notFound.admin': 'Admin',
  'notFound.guestDashboard': 'Guest Dashboard',
  'notFound.searchPlaceholder': 'Search AEGIS...',

  // Emergency banner
  'emergency.banner': 'If this is an emergency, call {number} immediately.',
  'emergency.contacts': 'Emergency Contacts',
  'emergency.services': 'Emergency Services',
  'emergency.floodHelpline': 'Flood Helpline',
  'emergency.nonEmergency': 'Non-Emergency',

  // Loading / skeleton
  'loading.content': 'Loading content...',
  'loading.table': 'Loading table...',
  'loading.map': 'Loading map...',
  'loading.chart': 'Loading chart...',

  // Empty states
  'empty.noData': 'No data available',
  'empty.noResults': 'No results found',
  'empty.adjustFilters': 'Try adjusting your search criteria.',
  'empty.noReports': 'No reports',
  'empty.noReportsDesc': "You haven't submitted any emergency reports yet.",
  'empty.noCommunityPosts': 'No community posts',
  'empty.noCommunityPostsDesc': 'Be the first to offer help or request assistance in your area.',
  'empty.noCheckIns': 'No check-ins',
  'empty.noCheckInsDesc': 'Use safety check-ins to let responders and contacts know your status.',
  'empty.noActiveAlerts': 'No active alerts',
  'empty.noActiveAlertsDesc': 'There are no active alerts for your area. Stay prepared by reviewing your emergency plan.',

  // Shared: ReportCard
  'report.possibleFake': 'Possible Fake',
  'report.vulnerablePerson': 'Vulnerable Person',
  'report.verify': 'Verify',
  'report.flag': 'Flag',

  // Shared: AlertCard
  'alertCard.dismiss': 'Dismiss',
  'alertCard.expired': 'Expired',

  // Shared: LanguagePreferenceDialog
  'langDialog.title': 'Choose Your Language',
  'langDialog.subtitle': 'Select your preferred language for AEGIS',
  'langDialog.changeLater': 'You can change this later in settings',
  'langDialog.confirm': 'Confirm',

  // Shared: GlobalLanguageBar
  'langBar.title': 'Language',
  'langBar.ariaLabel': 'Global language selector',

  // Shared: Common
  'common.na': 'N/A',

  // ClimateRiskDashboard
  'dashboard.title': 'Climate Risk Dashboard',
  'dashboard.updated': 'Updated',
  'dashboard.overallRisk': 'Overall Risk Assessment',
  'dashboard.riskCritical': 'Critical',
  'dashboard.riskHigh': 'High',
  'dashboard.riskModerate': 'Moderate',
  'dashboard.riskLow': 'Low',
  'dashboard.activePredictions': 'Active Predictions',
  'dashboard.highestSev': 'Highest severity',
  'dashboard.nonePredictions': 'None active',
  'dashboard.activeAlerts': 'Active Alerts',
  'dashboard.criticalHigh': 'Critical & high',
  'dashboard.noneAlerts': 'None',
  'dashboard.reports24h': 'Reports (24h)',
  'dashboard.highSeverity': 'High severity',
  'dashboard.weatherRisk': 'Weather Risk',
  'dashboard.naWeather': 'N/A',
  'dashboard.floodRiskPredictions': 'Flood Risk Predictions',
  'dashboard.keyFactors': 'Key Contributing Factors',
  'dashboard.importance': 'Importance',
  'dashboard.trendRising': 'Rising',
  'dashboard.trendFalling': 'Falling',
  'dashboard.trendStable': 'Stable',
  'dashboard.methodology': 'Data sourced from AI flood prediction models, weather APIs, river gauge stations and citizen reports. Risk scores are computed in real-time.',
  'dashboard.floodPredictions': 'Flood Predictions',
  'dashboard.weatherConditions': 'Weather Conditions',
  'dashboard.reportDensity': 'Report Density',
  'dashboard.noActivePredictions': 'No active flood predictions',
  'dashboard.fetchingPredictions': 'Fetching predictions from AI engine...',
  'dashboard.noPredictionsDesc': 'The AI prediction engine has no active flood risk forecasts for monitored areas. Predictions are generated automatically when river levels, rainfall data, or weather conditions indicate potential flood risk.',
  'dashboard.refreshPredictions': 'Refresh predictions',
  'dashboard.monitoredAreas': 'monitored areas',
  'dashboard.unknownArea': 'Unknown Area',
  'dashboard.noFloodExpected': 'No flood expected',

  // LiveMap
  'map.mapLayers': 'Map Layers',
  'map.hideAll': 'Hide All',
  'map.showAll': 'Show All',
  'map.layer.reports': 'Emergency Reports',
  'map.layer.evacuation': 'Evacuation Routes',
  'map.layer.heatmap': 'Density Heatmap',
  'map.live': 'LIVE',
  'map.reports': 'reports',
  'map.stations': 'stations',
  'map.predictions': 'predictions',
  'map.level': 'Level',
  'map.flow': 'Flow',
  'map.trend': 'Trend',
  'map.trendSteady': 'Steady',
  'map.floodRisk': 'Flood Risk',
  'map.ofTypicalHigh': 'of typical high',
  'map.noLevelReading': 'No level reading available',
  'map.risk': 'RISK',
  'map.aiPrediction': 'AI Prediction',
  'map.floodProbability': 'Flood Probability',
  'map.downstream': 'Downstream',
  'map.confidence': 'Confidence',
  'map.riskZone': 'Risk Zone',
  'map.reportDefault': 'Incident Report',
  'map.evacuationRoute': 'Evacuation Route',
  'map.distressBeacon': 'DISTRESS BEACON',
  'map.citizen': 'Citizen',
  'map.emergencyAssistance': 'Emergency assistance requested',
  'map.vulnerablePerson': 'Vulnerable person',
  'map.status': 'Status',

  // Map3D
  'map3d.requiresToken': 'Map3D requires a Mapbox token.',
  'map3d.setTokenEnv': 'Set VITE_MAPBOX_TOKEN in your .env file.',
  'map3d.switchTo2D': 'Switch to 2D',
  'map3d.switchTo3D': 'Switch to 3D',
  'map3d.streetMap': 'Street Map',

  // IntelligenceDashboard
  'intel.title': 'Multi-Hazard Intelligence',
  'intel.threatCritical': 'Severe multi-incident emergency -- immediate response required',
  'intel.threatRed': 'High-risk incidents active -- responders deployed',
  'intel.threatAmber': 'Elevated conditions -- monitoring in progress',
  'intel.threatGreen': 'All systems normal -- no significant incidents',
  'intel.compositeScore': 'Composite Threat Score',
  'intel.safe': 'Safe',
  'intel.elevated': 'Elevated',
  'intel.critical': 'Critical',
  'intel.active': 'Active',
  'intel.alerts': 'Alerts',
  'intel.rivers': 'Rivers',
  'intel.clusters': 'Clusters',
  'intel.cascades': 'Cascades',
  'intel.activeByType': 'Active Incidents by Type',
  'intel.whatChanged': 'What Changed (Last 15m)',
  'intel.new': 'New',
  'intel.escalated': 'Escalated',
  'intel.downgraded': 'Downgraded',
  'intel.resolved': 'Resolved',
  'intel.lifecycle.weak': 'Weak',
  'intel.lifecycle.possible': 'Possible',
  'intel.lifecycle.probable': 'Probable',
  'intel.lifecycle.high': 'High',
  'intel.lifecycle.confirmed': 'Confirmed',
  'intel.whyConfidence': 'Why This Confidence?',
  'intel.noDrivers': 'No drivers available',
  'intel.liveAlerts': 'Live Alerts',
  'intel.cascadingChains': 'Cascading Chains',
  'intel.riverGauges': 'River Gauges',
  'intel.typesMonitored': 'incident types monitored',
  'intel.refresh': 'Refresh',

  // DisasterMap
  'dmap.layers': 'Layers',
  'dmap.toggleOverlays': 'Toggle Map Overlays',
  'dmap.overlay.floodZones': 'Flood Zones',
  'dmap.overlay.floodMonitoring': 'Flood Monitoring',
  'dmap.overlay.aiPredictions': 'AI Predictions',
  'dmap.overlay.riskZones': 'Risk Zones',
  'dmap.overlay.shelters': 'Shelters',
  'dmap.overlay.evacuation': 'Evacuation Routes',
  'dmap.overlay.sosBeacons': 'SOS Beacons',
  'dmap.overlay.densityHeatmap': 'Density Heatmap',
  'dmap.overlay.confidenceHalos': 'Confidence Halos',
  'dmap.overlay.incidentClusters': 'Incident Clusters',
  'dmap.floodData': 'Flood Data',
  'dmap.noWmsLayers': 'No WMS layers configured for this region',
  'dmap.legend': 'Legend',
  'dmap.legend.high': 'High',
  'dmap.legend.medium': 'Medium',
  'dmap.legend.low': 'Low',
  'dmap.legend.floodZone': 'Flood zone',
  'dmap.legend.shelter': 'Shelter',
  'dmap.legend.warning': 'Warning',
  'dmap.legend.watch': 'Watch',
  'dmap.legend.station': 'Station',
  'dmap.legend.density': 'Density',
  'dmap.legend.aiPrediction': 'AI Prediction',
  'dmap.legend.confidenceLifecycle': 'Confidence lifecycle',
  'dmap.legend.confidenceHalo': 'Confidence halo',
  'dmap.legend.clusters': 'Clusters',
  'dmap.legend.riskZone': 'Risk Zone',
  'dmap.legend.evacuation': 'Evacuation',
  'dmap.legend.deployed': 'Deployed',
  'dmap.legend.awaiting': 'Awaiting',
  'dmap.loadingFloodData': 'Loading flood data...',
  'dmap.dataUnavailable': 'Data unavailable',
  'dmap.export': 'Export',
  'dmap.displayTools': 'Display Tools',
  'dmap.focus': 'Focus',
  'dmap.exit': 'Exit',
  'dmap.full': 'Full',
  'dmap.exitFocusMode': 'Exit Focus Mode',
  'dmap.initialisingMap': 'Initialising map...',
  'dmap.incident': 'Incident',
  'dmap.state': 'State',
  'dmap.confidence': 'Confidence',
  'dmap.evidence': 'Evidence',
  'dmap.window': 'Window',
  'dmap.cluster': 'Cluster',
  'dmap.reports': 'Reports',
  'dmap.radius': 'Radius',
  'dmap.timeWindow': 'Time Window',
  'dmap.capacity': 'Capacity',
  'dmap.type': 'Type',
  'dmap.amenities': 'Amenities',
  'dmap.distressBeacon': 'DISTRESS BEACON',
  'dmap.citizen': 'Citizen',
  'dmap.emergencyAssistance': 'Emergency assistance requested',
  'dmap.vulnerablePerson': 'Vulnerable person',
  'dmap.evacuationRoute': 'Evacuation Route',
  'dmap.floodProbability': 'Flood probability',
  'dmap.severity': 'Severity',
  'dmap.timeToFlood': 'Time to flood',
  'dmap.activeReports': 'Active Reports',
  'dmap.affected': 'Affected',
  'dmap.ai': 'AI',
  'dmap.cascadingInsights': 'Cascading Insights',
  'dmap.floodArea': 'Flood Area',
  'dmap.unknownStation': 'Unknown Station',
  'dmap.level': 'Level',
  'dmap.status': 'Status',
  'dmap.riskZone': 'Risk Zone',
  'dmap.risk': 'Risk',
  'dmap.recommendation': 'Recommendation',
  'dmap.etaConfidence': 'ETA confidence',
  'dmap.closureProximity': 'Closure proximity',
  'dmap.profile': 'Profile',
  'dmap.time': 'Time',
  'dmap.riskPenalty': 'Risk penalty',
  'dmap.blockedSegments': 'Blocked segments',
  'dmap.segmentsAffected': 'segment(s) affected -- closest',
  'dmap.topHazards': 'Top hazards',
  'dmap.uncertaintyBand': 'Uncertainty band',
  'dmap.deployed': 'DEPLOYED',
  'dmap.min': 'min',

  // CitizenDashboard (cdash.*)
  'cdash.citizenFallback': 'Citizen',
  'cdash.close': 'Close',
  'cdash.community.subtitle': 'Connect with others in your community',
  'cdash.contentRefreshed': 'Content refreshed',
  'cdash.copiedToClipboard': 'Copied to clipboard',
  'cdash.fakeRisk': 'Fake Risk',
  'cdash.loadingDashboard': 'Loading dashboard',
  'cdash.locationDenied': 'Location access denied',
  'cdash.locationDetected': 'Location detected',
  'cdash.openAiAssistant': 'Open AI Assistant',
  'cdash.panic': 'Panic',
  'cdash.print': 'Print',
  'cdash.print.aegisTitle': 'AEGIS Emergency Management',
  'cdash.print.description': 'Description',
  'cdash.print.generatedFrom': 'Generated from AEGIS Emergency Management Platform',
  'cdash.print.reportId': 'Report ID',
  'cdash.sentiment': 'Sentiment',
  'cdash.share': 'Share',
  'cdash.verificationFailed': 'Verification failed',
  'cdash.verificationSent': 'Verification email sent',
  'cdash.vulnerablePersonAlert': 'Vulnerable Person Alert',

  //cdash.sub.*

  //cdash.messages.*
  'cdash.messages.admin': 'Admin',
  'cdash.messages.attachImage': 'Attach image',
  'cdash.messages.auto': 'Auto',
  'cdash.messages.citizen': 'Citizen',
  'cdash.messages.connected': 'Connected',
  'cdash.messages.connecting': 'Connecting',
  'cdash.messages.connectingDesc': 'Please wait while we establish a secure connection...',
  'cdash.messages.connectingToServer': 'Connecting to server',
  'cdash.messages.emergency': 'Emergency',
  'cdash.messages.inProgress': 'In Progress',
  'cdash.messages.messagePlaceholder': 'Type your message...',
  'cdash.messages.open': 'Open',
  'cdash.messages.operator': 'Operator',
  'cdash.messages.removeTranslation': 'Remove translation',
  'cdash.messages.resolved': 'Resolved',
  'cdash.messages.retryConnection': 'Retry connection',
  'cdash.messages.subjectPlaceholder': 'Subject of your inquiry',
  'cdash.messages.supportTeam': 'Support Team',
  'cdash.messages.translate': 'Translate',
  'cdash.messages.translated': 'Translated',
  'cdash.messages.translateTo': 'Translate messages to',

  //cdash.news.*
  'cdash.news.alert': 'Alert',
  'cdash.news.community': 'Community',
  'cdash.news.info': 'Info',
  'cdash.news.tech': 'Tech',
  'cdash.news.warning': 'Warning',

  //cdash.overview.*
  'cdash.overview.areYouSafe': 'Are you safe?',
  'cdash.overview.assess': 'Assess',
  'cdash.overview.emergencyCard': 'Emergency Card',
  'cdash.overview.emergencyCardDesc': 'Your offline emergency reference card with key contacts and info',
  'cdash.overview.emergencyContacts': 'Emergency Contacts',
  'cdash.overview.goodAfternoon': 'Good afternoon',
  'cdash.overview.goodEvening': 'Good evening',
  'cdash.overview.goodMorning': 'Good morning',
  'cdash.overview.helpResponse': 'Help request sent -- support team notified',
  'cdash.overview.imSafe': "I'm Safe",
  'cdash.overview.journeyDesc': 'Complete these three steps to build your emergency preparedness',
  'cdash.overview.liveMap': 'Live Map',
  'cdash.overview.needHelp': 'Need Help',
  'cdash.overview.noConversations': 'No conversations yet',
  'cdash.overview.open': 'Open',
  'cdash.overview.prepare': 'Prepare',
  'cdash.overview.prepTraining': 'Preparedness Training',
  'cdash.overview.prepTrainingDesc': 'Learn safety procedures and emergency response skills',
  'cdash.overview.quickActions': 'Quick Actions',
  'cdash.overview.recommended': 'Recommended',
  'cdash.overview.report': 'Report Emergency',
  'cdash.overview.riskAssessment': 'Risk Assessment',
  'cdash.overview.riskAssessmentDesc': 'Assess your personal vulnerability and local risk level',
  'cdash.overview.safeResponse': "Glad you're safe! Stay alert.",
  'cdash.overview.safetyJourney': 'Safety Journey',
  'cdash.overview.train': 'Train',
  'cdash.overview.unsure': 'Not Sure',
  'cdash.overview.unsureResponse': 'Status noted -- please check in again when you can',
  'cdash.overview.update': 'Update',

  //cdash.prep.*
  'cdash.prep.article': 'Article',
  'cdash.prep.beforeFloodTitle': 'Before the Flood Strikes',
  'cdash.prep.britishRedCross': 'British Red Cross',
  'cdash.prep.emergencyKitTitle': 'Making an Emergency Kit',
  'cdash.prep.floodPrepTitle': 'Flood Preparation Guide',
  'cdash.prep.metOffice': 'Met Office',
  'cdash.prep.metOfficeTitle': 'Weather Warnings and Advice',
  'cdash.prep.scottishFloodForum': 'Scottish Flood Forum',
  'cdash.prep.scottishFloodTitle': 'Scottish Flood Resources',
  'cdash.prep.scottishGov': 'Scottish Government',
  'cdash.prep.sepaTitle': 'SEPA Flood Warnings',
  'cdash.prep.ukEnvAgency': 'UK Environment Agency',
  'cdash.prep.video': 'Video',

  //cdash.profile.*
  'cdash.profile.accountInfo': 'Account Information',
  'cdash.profile.avatarFailed': 'Failed to update avatar',
  'cdash.profile.avatarUpdated': 'Avatar updated successfully',
  'cdash.profile.bio': 'Bio',
  'cdash.profile.bioPlaceholder': 'Tell us about yourself...',
  'cdash.profile.cancel': 'Cancel',
  'cdash.profile.city': 'City',
  'cdash.profile.country': 'Country',
  'cdash.profile.dateOfBirth': 'Date of Birth',
  'cdash.profile.displayName': 'Display Name',
  'cdash.profile.editProfile': 'Edit Profile',
  'cdash.profile.email': 'Email',
  'cdash.profile.lastLogin': 'Last Login',
  'cdash.profile.loginCount': 'Login Count',
  'cdash.profile.mayNeedPriority': 'I may need priority assistance during emergencies',
  'cdash.profile.memberSince': 'Member Since',
  'cdash.profile.notYet': 'Not yet',
  'cdash.profile.personalInfo': 'Personal Information',
  'cdash.profile.phone': 'Phone',
  'cdash.profile.preferredRegion': 'Preferred Region',
  'cdash.profile.priorityActive': 'Priority support is active',
  'cdash.profile.priorityAssistance': 'Priority Assistance',
  'cdash.profile.priorityNotActive': 'Priority support not active',
  'cdash.profile.priorityRoutingDesc': 'Enable priority routing for faster emergency assistance',
  'cdash.profile.prioritySupport': 'Priority Support',
  'cdash.profile.profileFailed': 'Failed to update profile',
  'cdash.profile.profileUpdated': 'Profile updated successfully',
  'cdash.profile.regionPlaceholder': 'Select your region',
  'cdash.profile.role': 'Role',
  'cdash.profile.save': 'Save',
  'cdash.profile.verified': 'Verified',
  'cdash.profile.vulnerabilityPlaceholder': 'Describe any conditions or needs...',
  'cdash.profile.yes': 'Yes',
  'cdash.profile.yourCity': 'Your city',

  //cdash.reports.*
  'cdash.reports.ai': 'AI',
  'cdash.reports.aiAnalysed': 'AI analysed',
  'cdash.reports.all': 'All',
  'cdash.reports.clearFilters': 'Clear filters',
  'cdash.reports.clearingFilters': 'clearing all filters',
  'cdash.reports.critical': 'Critical',
  'cdash.reports.high': 'High',
  'cdash.reports.low': 'Low',
  'cdash.reports.medium': 'Medium',
  'cdash.reports.moderate': 'Moderate',
  'cdash.reports.new': 'New',
  'cdash.reports.newestFirst': 'Newest first',
  'cdash.reports.noMatching': 'No matching reports found',
  'cdash.reports.oldestFirst': 'Oldest first',
  'cdash.reports.printReport': 'Print report',
  'cdash.reports.realTime': 'Real-time',
  'cdash.reports.recentReports': 'Recent Reports',
  'cdash.reports.reports': 'reports',
  'cdash.reports.resolved': 'Resolved',
  'cdash.reports.severityDistribution': 'Severity Distribution',
  'cdash.reports.shareReport': 'Share report',
  'cdash.reports.tryAdjusting': 'Try adjusting your filters or',
  'cdash.reports.unverified': 'Unverified',
  'cdash.reports.urgent': 'Urgent',
  'cdash.reports.verified': 'Verified',
  'cdash.reports.verifiedStatus': 'Verified',
  'cdash.reports.withMedia': 'With media',

  //cdash.safety.*
  'cdash.safety.iAmSafe': 'I am safe',
  'cdash.safety.needHelp': 'I need help',
  'cdash.safety.notSure': "I'm not sure",
  'cdash.safety.optionalMessage': 'Optional message (e.g. at home, trapped, need medical help)',
  'cdash.safety.selectInstruction': 'Select your current safety status',
  'cdash.safety.subtitle': 'Let your community know you are safe',

  //cdash.security.*
  'cdash.security.desc': 'Change your account password',
  'cdash.security.failed': 'Failed to change password',
  'cdash.security.minChars': 'Minimum 8 characters',
  'cdash.security.minLength': 'Password must be at least 8 characters',
  'cdash.security.mismatch': 'Passwords do not match',
  'cdash.security.success': 'Password changed successfully',

  //cdash.settings.*
  'cdash.settings.accessibility': 'Accessibility',
  'cdash.settings.areYouSure': 'Are you sure you want to delete your account?',
  'cdash.settings.audioAlerts': 'Audio Alerts',
  'cdash.settings.autoPlayCritical': 'Auto-play critical alerts',
  'cdash.settings.autoPlayCriticalDesc': 'Automatically play audio for critical emergency alerts',
  'cdash.settings.cancel': 'Cancel',
  'cdash.settings.cancelDeleteInfo': 'You can cancel deletion within 30 days',
  'cdash.settings.cancelDeletion': 'Cancel Deletion',
  'cdash.settings.captionFontSize': 'Caption Font Size',
  'cdash.settings.captionOverlay': 'Caption Overlay',
  'cdash.settings.captionOverlayDesc': 'Display captions over audio and video content',
  'cdash.settings.compactView': 'Compact View',
  'cdash.settings.compactViewDesc': 'Reduce spacing and padding for a denser layout',
  'cdash.settings.confirmDeleteDesc': 'This action cannot be undone. All your data will be permanently removed.',
  'cdash.settings.darkMode': 'Dark Mode',
  'cdash.settings.darkModeDesc': 'Switch to a dark colour scheme',
  'cdash.settings.deleteAccount': 'Delete Account',
  'cdash.settings.deleteBullet1': 'All your reports and submissions will be anonymised',
  'cdash.settings.deleteBullet2': 'Your profile and personal data will be permanently deleted',
  'cdash.settings.deleteBullet3': 'Alert subscriptions and notification preferences will be removed',
  'cdash.settings.deleteBullet4': 'This action cannot be undone after the grace period',
  'cdash.settings.deleteDesc': 'Permanently delete your account and all associated data',
  'cdash.settings.deletionScheduled': 'Account deletion scheduled',
  'cdash.settings.display': 'Display',
  'cdash.settings.enableAudioAlerts': 'Enable Audio Alerts',
  'cdash.settings.enableAudioAlertsDesc': 'Play sounds for important notifications and alerts',
  'cdash.settings.extraLarge': 'Extra Large',
  'cdash.settings.language': 'Language',
  'cdash.settings.large': 'Large',
  'cdash.settings.medium': 'Medium',
  'cdash.settings.prefsFailed': 'Failed to save preferences',
  'cdash.settings.prefsSaved': 'Preferences saved',
  'cdash.settings.requestDeletion': 'Request Deletion',
  'cdash.settings.save': 'Save Preferences',
  'cdash.settings.small': 'Small',
  'cdash.settings.unsaved': 'You have unsaved changes',
  'cdash.settings.volume': 'Volume',
  'cdash.settings.yesDelete': 'Yes, Delete My Account',

  // CitizenPage (citizenPage.*)
  'citizenPage.aiAnalysis': 'AI Analysis',
  'citizenPage.aiConfidence': 'AI Confidence',
  'citizenPage.alertDetails': 'Alert Details',
  'citizenPage.chooseChannels': 'Choose your notification channels',
  'citizenPage.copiedToClipboard': 'Link copied to clipboard',
  'citizenPage.emergencyCard': 'Emergency Card',
  'citizenPage.footer.aberdeen': 'Aberdeen, Scotland',
  'citizenPage.footer.aboutAegis': 'About AEGIS',
  'citizenPage.footer.accessibility': 'Accessibility',
  'citizenPage.footer.aegisPlatform': 'AEGIS Emergency Management Platform',
  'citizenPage.footer.emergency': 'Emergency',
  'citizenPage.footer.emergencyServices': 'Emergency Services: 999',
  'citizenPage.footer.honours': 'Honours Project 2025/26',
  'citizenPage.footer.privacyPolicy': 'Privacy Policy',
  'citizenPage.footer.rgu': 'Robert Gordon University',
  'citizenPage.footer.termsOfUse': 'Terms of Use',
  'citizenPage.location': 'Location',
  'citizenPage.locationDenied': 'Location access denied',
  'citizenPage.locationDetected': 'Location detected',
  'citizenPage.noNewsAvailable': 'No news articles available',
  'citizenPage.officialInquiries': 'For official inquiries contact your local authority',
  'citizenPage.printPopupBlocked': 'Print popup was blocked',
  'citizenPage.recentReports': 'Recent Reports',
  'citizenPage.reportDetails': 'Report Details',
  'citizenPage.reported': 'Reported',
  'citizenPage.reportEmergency': 'Report Emergency',
  'citizenPage.reporter': 'Reporter',
  'citizenPage.reportRelated': 'Report Related Incident',
  'citizenPage.reportShared': 'Report shared successfully',
  'citizenPage.safetyAdvice': 'Safety Advice',
  'citizenPage.safetyAdviceText': 'Follow official guidance from local authorities. Do not approach affected areas unless directed by emergency services.',
  'citizenPage.settingUpWebPush': 'Setting up Web Push...',
  'citizenPage.shareCancelled': 'Share cancelled',
  'citizenPage.sosFailed': 'Failed to send SOS report',
  'citizenPage.sosSent': 'SOS report sent successfully',
  'citizenPage.subscribedTo': 'Subscribed to',
  'citizenPage.subscriptionFailed': 'Subscription failed',
  'citizenPage.tab.disasterMap': 'Disaster Map',
  'citizenPage.tab.recentReports': 'Recent Reports',
  'citizenPage.tab.safeZones': 'Safe Zones',
  'citizenPage.telegramHelp': 'Find your Telegram ID via @userinfobot',
  'citizenPage.telegramPlaceholder': 'Your Telegram user ID',
  'citizenPage.trappedPersons': 'Trapped Persons',
  'citizenPage.unableToShare': 'Unable to share report',
  'citizenPage.waterDepth': 'Water Depth',
  'citizenPage.webPushAlready': 'Web push already enabled',
  'citizenPage.webPushEnabled': 'Web push notifications enabled',
  'citizenPage.webPushFailed': 'Web push setup failed',
  'citizenPage.webPushLoading': 'Setting up...',
  'citizenPage.webPushNotSupported': 'Web push not supported in this browser',
  'citizenPage.webPushReady': 'Ready to enable',

  // Terms Page (terms.*)

  //terms.s1 - Acceptance
  'terms.s1.title': '1. Acceptance of Terms',
  'terms.s1.p1': 'By accessing or using the AEGIS Emergency Management Platform ("the Platform"), you agree to be bound by these Terms of Use. If you do not agree to these terms, please do not use the Platform.',
  'terms.s1.p2': 'AEGIS is developed as an honours project at Robert Gordon University (RGU) and is provided for educational, research, and demonstration purposes.',

  //terms.s2 - Platform Purpose
  'terms.s2.title': '2. Platform Purpose & Disclaimer',
  'terms.s2.intro': 'AEGIS is designed to:',
  'terms.s2.li1': 'Demonstrate AI-powered emergency management concepts',
  'terms.s2.li2': 'Aggregate publicly available hazard and weather data',
  'terms.s2.li3': 'Enable community incident reporting and awareness',
  'terms.s2.li4': 'Showcase multi-channel notification delivery',
  'terms.s2.disclaimer': '<strong>Disclaimer:</strong> AEGIS is NOT an official emergency service. Do not rely on this platform for life-threatening situations. Always call 999 (UK) or your local emergency number for immediate help.',

  //terms.s3 - User Conduct
  'terms.s3.title': '3. User Conduct',
  'terms.s3.intro': 'When using the Platform, you agree to:',
  'terms.s3.li1': 'Provide accurate information when submitting reports',
  'terms.s3.li2': 'Not submit false or misleading emergency reports',
  'terms.s3.li3': 'Respect other users and community members',
  'terms.s3.li4': 'Not attempt to disrupt or manipulate platform services',
  'terms.s3.li5': 'Not use the platform for unlawful purposes',
  'terms.s3.li6': 'Not upload malicious content, malware, or harmful files',
  'terms.s3.li7': 'Comply with all applicable UK and Scottish laws',
  'terms.s3.violations': 'Violations may result in account suspension or termination without notice.',

  //terms.s4 - Accounts
  'terms.s4.title': '4. Account Registration',
  'terms.s4.intro': 'To access certain features, you may need to create an account. You agree to:',
  'terms.s4.li1': 'Provide accurate and current registration information',
  'terms.s4.li2': 'Maintain the security of your password and account',
  'terms.s4.li3': 'Accept responsibility for all activity under your account',
  'terms.s4.li4': 'Notify us immediately of any unauthorised access',

  //terms.s5 - Content
  'terms.s5.title': '5. User-Generated Content',
  'terms.s5.p1': 'By submitting content (reports, images, messages) to AEGIS, you:',
  'terms.s5.li1': 'Grant AEGIS a non-exclusive licence to use, display, and analyse the content for platform purposes',
  'terms.s5.li2': 'Confirm you have the right to share such content',
  'terms.s5.li3': 'Understand content may be processed by AI systems for classification and analysis',
  'terms.s5.verify': 'AEGIS reserves the right to review, moderate, or remove any content that violates these terms.',

  //terms.s6 - AI
  'terms.s6.title': '6. AI & Automated Analysis',
  'terms.s6.p1': 'AEGIS uses artificial intelligence to classify reports, assess risk, and provide recommendations. AI outputs are for informational purposes only and should not replace professional judgement or official emergency guidance.',
  'terms.s6.p2': 'AI models may produce inaccurate results. Users should verify important information through official channels.',

  //terms.s7 - Liability
  'terms.s7.title': '7. Limitation of Liability',
  'terms.s7.intro': 'To the maximum extent permitted by law, AEGIS and its developers shall not be liable for:',
  'terms.s7.li1': 'Any direct, indirect, or consequential damages arising from use of the platform',
  'terms.s7.li2': 'Inaccurate or delayed information',
  'terms.s7.li3': 'Service interruptions or data loss',
  'terms.s7.li4': 'Actions taken based on AI-generated recommendations',
  'terms.s7.asIs': 'The platform is provided "as is" without warranties of any kind, express or implied.',

  //terms.s8 - Privacy
  'terms.s8.title': '8. Privacy & Data Protection',
  'terms.s8.p1': 'Your use of AEGIS is also governed by our Privacy Policy. We are committed to protecting your data in accordance with the UK General Data Protection Regulation (UK GDPR) and the Data Protection Act 2018.',

  //terms.s9 - Changes
  'terms.s9.title': '9. Changes to Terms',
  'terms.s9.p1': 'We may update these Terms of Use from time to time. Continued use of the platform after changes constitutes acceptance of the revised terms.',

  //terms.s10 - Governing Law
  'terms.s10.title': '10. Governing Law',
  'terms.s10.p1': 'These terms are governed by and construed in accordance with the laws of Scotland and the United Kingdom.',

  // Privacy Page (privacy.*)

  //privacy.s1 - Overview
  'privacy.s1.title': '1. Overview',
  'privacy.s1.p1': 'AEGIS ("the Platform") is committed to protecting your privacy and personal data. This Privacy Policy explains how we collect, use, store, and protect information when you use our emergency management platform.',
  'privacy.s1.p2': 'AEGIS is developed as an honours project at Robert Gordon University (RGU) and operates under the university\'s data protection framework.',

  //privacy.s2 - Data Collection
  'privacy.s2.title': '2. Information We Collect',
  'privacy.s2.voluntary': '<strong>Information you provide voluntarily:</strong>',
  'privacy.s2.vol1': 'Account registration details (name, email)',
  'privacy.s2.vol2': 'Incident reports including text descriptions and images',
  'privacy.s2.vol3': 'Safety status check-ins and messages',
  'privacy.s2.automatic': '<strong>Information collected automatically:</strong>',
  'privacy.s2.auto1': 'IP address and browser type for security purposes',
  'privacy.s2.auto2': 'Location data (only when you explicitly grant permission)',
  'privacy.s2.auto3': 'Usage analytics to improve the platform',
  'privacy.s2.local': '<strong>Information stored locally:</strong>',
  'privacy.s2.local1': 'Language and theme preferences',
  'privacy.s2.local2': 'Notification channel preferences',
  'privacy.s2.local3': 'Cached data for offline functionality',
  'privacy.s2.local4': 'Session tokens for authentication',

  //privacy.s3 - How We Use Data
  'privacy.s3.title': '3. How We Use Your Data',
  'privacy.s3.li1': 'To provide emergency notifications and alerts',
  'privacy.s3.li2': 'To display relevant hazard information for your area',
  'privacy.s3.li3': 'To classify and prioritise incident reports using AI',
  'privacy.s3.li4': 'To enable community safety features',
  'privacy.s3.li5': 'For academic research and platform improvement',

  //privacy.s4 - Legal Basis
  'privacy.s4.title': '4. Legal Basis for Processing',
  'privacy.s4.p1': 'We process your data under the following legal bases:',
  'privacy.s4.li1': '<strong>Consent:</strong> You provide explicit consent when creating an account and submitting reports',
  'privacy.s4.li2': '<strong>Legitimate interest:</strong> Processing necessary for platform operation and security',
  'privacy.s4.li3': '<strong>Vital interest:</strong> Emergency situations where processing may protect life',

  //privacy.s5 - Data Sharing
  'privacy.s5.title': '5. Data Sharing',
  'privacy.s5.p1': 'AEGIS does not sell your personal data. We may share information:',
  'privacy.s5.li1': '<strong>With emergency services</strong> when required by law or to protect life',
  'privacy.s5.li2': '<strong>With Robert Gordon University</strong> for academic assessment purposes',
  'privacy.s5.li3': '<strong>In anonymised form</strong> for research and analysis',

  //privacy.s6 - Data Security
  'privacy.s6.title': '6. Data Security',
  'privacy.s6.li1': 'All data transmitted using TLS/HTTPS encryption',
  'privacy.s6.li2': 'Passwords hashed using bcrypt with salt rounds',
  'privacy.s6.li3': 'Access controls and role-based permissions',

  //privacy.s7 - Your Rights
  'privacy.s7.title': '7. Your Rights',
  'privacy.s7.p1': 'Under UK GDPR, you have the following rights:',
  'privacy.s7.li1': '<strong>Right of access:</strong> Request a copy of your personal data',
  'privacy.s7.li2': '<strong>Right to rectification:</strong> Correct inaccurate personal data',
  'privacy.s7.li3': '<strong>Right to erasure:</strong> Request deletion of your data',
  'privacy.s7.li4': '<strong>Right to restrict processing:</strong> Limit how we use your data',
  'privacy.s7.li5': '<strong>Right to data portability:</strong> Receive your data in a machine-readable format',
  'privacy.s7.li6': '<strong>Right to object:</strong> Object to processing based on legitimate interest',
  'privacy.s7.contact': 'To exercise any of these rights, please contact us through the platform or email the project team.',

  //privacy.s8 - Cookies
  'privacy.s8.title': '8. Cookies & Local Storage',
  'privacy.s8.p1': 'AEGIS uses <strong>essential cookies and local storage only</strong>. We do not use tracking cookies or third-party advertising cookies.',
  'privacy.s8.p2': 'Local storage is used for authentication tokens, user preferences, and cached data to improve performance.',

  //privacy.s9 - Data Retention
  'privacy.s9.title': '9. Data Retention',
  'privacy.s9.p1': 'Account data is retained while your account is active. You may request account deletion at any time through your dashboard settings.',
  'privacy.s9.p2': 'Incident report data may be retained in anonymised form for research purposes after account deletion.',

  //privacy.s10 - Contact
  'privacy.s10.title': '10. Contact Us',
  'privacy.s10.p1': 'For privacy-related inquiries, please contact the AEGIS project team at Robert Gordon University, Aberdeen, Scotland.',

  // Accessibility Page (a11yPage.*)
  'a11yPage.pageTitle': 'Accessibility Statement',
  'a11yPage.tagline': 'Making AEGIS accessible and inclusive for everyone, regardless of ability.',

  //a11yPage.s1 - WCAG Compliance
  'a11yPage.s1.title': 'WCAG 2.1 Compliance',
  'a11yPage.s1.p1': 'AEGIS strives to conform to <strong>WCAG 2.1 Level AA</strong> standards. We regularly test with automated tools and manual review.',
  'a11yPage.s1.p2': 'Our compliance status across the <strong>four WCAG principles</strong>:',
  'a11yPage.s1.perceivable': 'Perceivable',
  'a11yPage.s1.operable': 'Operable',
  'a11yPage.s1.understandable': 'Understandable',
  'a11yPage.s1.robust': 'Robust',
  'a11yPage.s1.good': 'Good',
  'a11yPage.s1.partial': 'Partial',
  'a11yPage.s1.perceivableDetail': 'Alt text, colour contrast, resizable text',
  'a11yPage.s1.operableDetail': 'Keyboard navigable, skip links, focus visible',
  'a11yPage.s1.understandableDetail': 'Language support expanding, forms validated',
  'a11yPage.s1.robustDetail': 'Semantic HTML, ARIA roles, screen reader tested',

  //a11yPage.s2 - Languages
  'a11yPage.s2.title': 'Multi-Language Support',
  'a11yPage.s2.p1': 'AEGIS supports <strong>12 languages</strong> with full UI translation and culturally appropriate formatting:',
  'a11yPage.s2.english': 'English',
  'a11yPage.s2.gaelic': 'Gàidhlig',
  'a11yPage.s2.welsh': 'Cymraeg',
  'a11yPage.s2.french': 'Français',
  'a11yPage.s2.spanish': 'Español',
  'a11yPage.s2.arabic': 'العربية',
  'a11yPage.s2.chinese': '中文',
  'a11yPage.s2.hindi': 'हिन्दी',
  'a11yPage.s2.portuguese': 'Português',
  'a11yPage.s2.polish': 'Polski',
  'a11yPage.s2.urdu': 'اردو',
  'a11yPage.s2.moreComing': '+ more coming',
  'a11yPage.s2.rtl': 'Right-to-left (RTL) layout support is available for Arabic and Urdu.',

  //a11yPage.s3 - Visual
  'a11yPage.s3.title': 'Visual Accessibility',
  'a11yPage.s3.li1': '<strong>High contrast mode:</strong> Dark theme with enhanced contrast ratios',
  'a11yPage.s3.li2': '<strong>Resizable text:</strong> All text scales with browser zoom up to 200%',
  'a11yPage.s3.li3': '<strong>Colour-blind safe:</strong> Information conveyed by colour is also indicated by shape or text',
  'a11yPage.s3.li4': '<strong>Alt text:</strong> All images and icons include descriptive alternative text',
  'a11yPage.s3.li5': '<strong>Focus indicators:</strong> Clear visible focus outlines on all interactive elements',

  //a11yPage.s4 - Motor
  'a11yPage.s4.title': 'Motor & Input Accessibility',
  'a11yPage.s4.li1': '<strong>Large click targets:</strong> Buttons and links meet minimum 44×44px touch target size',
  'a11yPage.s4.li2': '<strong>No time limits:</strong> No time-based interactions that could disadvantage users',
  'a11yPage.s4.li3': '<strong>Reduced motion:</strong> Respects prefers-reduced-motion system setting',
  'a11yPage.s4.li4': '<strong>Voice control compatible:</strong> All interactive elements have visible labels',
  'a11yPage.s4.li5': '<strong>Single pointer operation:</strong> All functionality available without complex gestures',

  //a11yPage.s5 - Audio
  'a11yPage.s5.title': 'Audio & Communication',
  'a11yPage.s5.li1': 'Optional audio alerts for critical emergency notifications',
  'a11yPage.s5.li2': 'Visual notification indicators alongside audio alerts',
  'a11yPage.s5.li3': 'Caption overlay feature for audio and video content',
  'a11yPage.s5.li4': 'Adjustable alert volume controls',
  'a11yPage.s5.li5': 'Multi-channel notifications (email, SMS, Telegram, WhatsApp)',

  //a11yPage.s6 - Mobile
  'a11yPage.s6.title': 'Mobile & Responsive',
  'a11yPage.s6.li1': 'Fully responsive design from 320px to 4K displays',
  'a11yPage.s6.li2': 'Touch-optimised interface with appropriate spacing',
  'a11yPage.s6.li3': 'Offline-capable Progressive Web App (PWA) features',
  'a11yPage.s6.li4': 'Screen reader optimised for iOS VoiceOver and Android TalkBack',
  'a11yPage.s6.li5': 'Landscape and portrait orientation support',

  //a11yPage.s7 - Known Issues
  'a11yPage.s7.title': 'Known Limitations',
  'a11yPage.s7.li1': 'Some third-party map components may have limited screen reader support',
  'a11yPage.s7.li2': 'Real-time data visualisations may not be fully described for screen readers',
  'a11yPage.s7.li3': 'Some complex data tables may benefit from additional navigation aids',
  'a11yPage.s7.li4': 'Language coverage is expanding; some translations may be incomplete',

  //a11yPage.s8 - Contact & Feedback
  'a11yPage.s8.title': 'Feedback & Contact',
  'a11yPage.s8.p1': 'We welcome feedback on the accessibility of AEGIS. If you encounter barriers or have suggestions, please let us know.',
  'a11yPage.s8.p2': '<strong>Email:</strong> accessibility@aegis-platform.org',
  'a11yPage.s8.p3': '<strong>Phone:</strong> Contact through Robert Gordon University switchboard',
  'a11yPage.s8.p4': '<em>This accessibility statement was last reviewed in January 2026. We are continually working to improve accessibility across the platform.</em>',

  // About Page (about.*)
  'about.accessibility': 'Accessibility',
  'about.backToAegis': 'Back to AEGIS',
  'about.backToDashboard': 'Back to Dashboard',
  'about.contact': 'Contact',
  'about.contactDesc': 'For questions about this project, contact the development team at Robert Gordon University.',
  'about.contactInstitution': 'Robert Gordon University',
  'about.contactLocation': 'Aberdeen, Scotland',
  'about.contactModule': 'Honours Project -- Computing Science',
  'about.feat.aiAnalysis': 'AI-Powered Analysis',
  'about.feat.aiAnalysisDesc': 'Machine learning models analyse reports, detect misinformation, assess severity, and provide intelligent risk insights.',
  'about.feat.communityReporting': 'Community Reporting',
  'about.feat.communityReportingDesc': 'Citizens can submit geotagged incident reports with photos, enabling real-time crowdsourced situational awareness.',
  'about.feat.floodMonitoring': 'Flood Monitoring',
  'about.feat.floodMonitoringDesc': 'Real-time integration with SEPA and Environment Agency river-gauge data, plus AI-driven flood predictions.',
  'about.feat.languages': 'Multi-Language Support',
  'about.feat.languagesDesc': 'Full interface translation across 9+ languages including Gaelic, Welsh, Arabic, and Chinese.',
  'about.feat.liveAlerts': 'Live Alerts',
  'about.feat.liveAlertsDesc': 'Multi-channel notifications via email, SMS, WhatsApp, Telegram, and web push to keep you informed instantly.',
  'about.feat.preparedness': 'Emergency Preparedness',
  'about.feat.preparednessDesc': 'Guided training modules, risk assessments, and an offline emergency card to build personal resilience.',
  'about.fullName': 'Adaptive Emergency Geospatial Intelligence System',
  'about.heroDesc': 'A comprehensive AI-powered platform for real-time emergency management, flood monitoring, and community resilience across Scotland.',
  'about.institutionVal': 'Robert Gordon University',
  'about.keyFeatures': 'Key Features',
  'about.locationVal': 'Aberdeen, Scotland',
  'about.missionP1': 'AEGIS is dedicated to saving lives through intelligent emergency management. We combine machine learning, real-time environmental data, and community engagement to deliver timely flood monitoring, risk assessment, and multi-channel alerts.',
  'about.moduleVal': 'Honours Project 2025/26',
  'about.ourMission': 'Our Mission',
  'about.privacyPolicy': 'Privacy Policy',
  'about.researchBg': 'Research & Academic Background',
  'about.researchP1': 'AEGIS is developed as an honours-year project at Robert Gordon University, Aberdeen. It applies advanced computing techniques -- machine learning, geospatial analysis, real-time data streaming -- to the domain of emergency management.',
  'about.tech.aiEngine': 'Python - PyTorch - FastAPI',
  'about.tech.backend': 'Node.js - Express - PostgreSQL',
  'about.tech.frontend': 'React - TypeScript - Vite',
  'about.tech.liveData': 'SEPA - Environment Agency - Met Office',
  'about.techStack': 'Technology Stack',
  'about.termsOfUse': 'Terms of Use',

  // Admin Page additional keys (admin.*)
  'admin.action.archive': 'Archive',
  'admin.action.falseReport': 'False Report',
  'admin.action.flag': 'Flag',
  'admin.action.resolve': 'Resolve',
  'admin.action.urgent': 'Urgent',
  'admin.action.verify': 'Verify',
  'admin.bulk.archiveMsg': 'Archive these reports? They will be removed from active view.',
  'admin.bulk.archiveSuccess': 'Reports archived successfully',
  'admin.bulk.archiveTitle': 'Archive Reports',
  'admin.bulk.falseMsg': 'Mark selected reports as false reports?',
  'admin.bulk.falseSuccess': 'Reports marked as false',
  'admin.bulk.falseTitle': 'Mark as False Report',
  'admin.bulk.flagMsg': 'Flag selected reports for investigation?',
  'admin.bulk.flagSuccess': 'Reports flagged successfully',
  'admin.bulk.flagTitle': 'Flag Reports',
  'admin.bulk.resolveMsg': 'Resolve selected reports?',
  'admin.bulk.resolveSuccess': 'Reports resolved successfully',
  'admin.bulk.resolveTitle': 'Resolve Reports',
  'admin.bulk.urgentMsg': 'Escalate selected reports to URGENT priority?',
  'admin.bulk.urgentSuccess': 'Reports escalated to URGENT',
  'admin.bulk.urgentTitle': 'Escalate to URGENT',
  'admin.bulk.verifyMsg': 'Verify selected reports as legitimate?',
  'admin.bulk.verifySuccess': 'Reports verified successfully',
  'admin.bulk.verifyTitle': 'Verify Reports',
  'admin.bulkFailed': 'Bulk action failed',
  'admin.citizenMessages': 'Citizen Messages',
  'admin.confirm.archiveMsg': 'Archive this report? It will be removed from active view.',
  'admin.confirm.archiveSuccess': 'Report archived successfully',
  'admin.confirm.archiveTitle': 'Archive Report',
  'admin.confirm.falseMsg': 'Mark this report as a false report? This flags the submission as not a genuine emergency.',
  'admin.confirm.falseSuccess': 'Report marked as false',
  'admin.confirm.falseTitle': 'Mark as False Report',
  'admin.confirm.justification': 'Justification',
  'admin.crowdDensity': 'Crowd Density',
  'admin.crowdDensityAnalysis': 'Crowd Density Analysis',
  'admin.delivery': 'Delivery',
  'admin.deploy.reasonLabel': 'Reason for Deployment',
  'admin.deploy.reasonPlaceholder': 'Describe the reason for this deployment...',
  'admin.detail.aiAnalysis': 'AI Analysis',
  'admin.detail.aiConfidence': 'AI Confidence',
  'admin.detail.aiDepth': 'Water Depth',
  'admin.detail.aiFakeRisk': 'Fake Risk',
  'admin.detail.aiPanic': 'Panic Level',
  'admin.detail.aiPending': 'Pending',
  'admin.detail.aiPhoto': 'Photo Analysis',
  'admin.detail.aiReasoning': 'AI Reasoning',
  'admin.detail.aiSentiment': 'Sentiment',
  'admin.detail.aiSources': 'Sources',
  'admin.detail.aiVerified': 'Verified',
  'admin.detail.analyzed': 'Analyzed',
  'admin.detail.anonymousCitizen': 'Anonymous Citizen',
  'admin.detail.description': 'Description',
  'admin.detail.detected': 'Detected',
  'admin.detail.evidenceGallery': 'Evidence Gallery',
  'admin.detail.gps': 'GPS',
  'admin.detail.heuristicOnly': 'Heuristic Only',
  'admin.detail.location': 'Location',
  'admin.detail.mediaNotAvailable': 'Media not available',
  'admin.detail.mlPowered': 'ML Powered',
  'admin.detail.noDescription': 'No description provided',
  'admin.detail.noOperatorNotes': 'No operator notes',
  'admin.detail.notSpecified': 'Not specified',
  'admin.detail.operatorNotes': 'Operator Notes',
  'admin.detail.photo': 'Photo',
  'admin.detail.printReport': 'Print Report',
  'admin.detail.recommendedActions': 'Recommended Actions',
  'admin.detail.reporter': 'Reporter',
  'admin.detail.reportId': 'Report ID',
  'admin.detail.severity': 'Severity',
  'admin.detail.shareReport': 'Share Report',
  'admin.detail.statusLocked': 'Status locked -- super admin override required',
  'admin.detail.statusTimeline': 'Status Timeline',
  'admin.detail.submitted': 'Submitted',
  'admin.detail.superAdminOverride': 'Super Admin Override',
  'admin.detail.timelineAi': 'AI Analysis Complete',
  'admin.detail.timelineChanged': 'Status Changed',
  'admin.detail.timelineResolved': 'Report Resolved',
  'admin.detail.timelineSubmitted': 'Report Submitted',
  'admin.detail.timelineVerified': 'Report Verified',
  'admin.detail.trappedPersons': 'Trapped Persons',
  'admin.detail.viewFull': 'View Full',
  'admin.filters.status.archived': 'Archived',
  'admin.filters.status.falseReport': 'False Report',
  'admin.gallery.aiPhotoAnalysis': 'AI Photo Analysis',
  'admin.gallery.closeGallery': 'Close Gallery',
  'admin.gallery.evidencePhoto': 'Evidence Photo',
  'admin.gallery.of': 'of',
  'admin.gallery.openOriginal': 'Open Original',
  'admin.mapView.intel': 'Intel',
  'admin.mapView.layers': 'Layers',
  'admin.mapView.subtitle': 'Real-time tactical intelligence overlay',
  'admin.mapView.title': 'Live Operations Map',
  'admin.print.allowPopups': 'Please allow popups to print reports',
  'admin.print.allowPopupSingle': 'Please allow popups to print this report',
  'admin.profile.email': 'Email',
  'admin.profile.phone': 'Phone',
  'admin.profile.updateFailed': 'Failed to update profile',
  'admin.sensitiveData': 'Sensitive operational data -- authorised access only',
  'admin.share.dialogOpened': 'Share dialog opened',
  'admin.share.draftOpened': 'Email draft opened',
  'admin.share.linkCopied': 'Link copied to clipboard',
  'admin.share.unableToShare': 'Unable to share',
  'admin.suspend.1day': '1 Day',
  'admin.suspend.1month': '1 Month',
  'admin.suspend.1week': '1 Week',
  'admin.suspend.3days': '3 Days',
  'admin.suspend.durationLabel': 'Suspension Duration',
  'admin.suspend.indefinite': 'Indefinite',
  'admin.suspend.indefiniteBtn': 'Suspend Indefinitely',
  'admin.suspend.reasonLabel': 'Reason for Suspension',
  'admin.suspend.reasonPlaceholder': 'Describe the reason for this suspension...',
  'admin.suspend.suspendedUntil': 'Suspended until',

  // Citizen Auth Page additional keys (citizen.auth.*)
  'citizen.auth.citizenPortal': 'Citizen Portal',
  'citizen.auth.forgot.backToLogin': 'Back to Login',
  'citizen.auth.forgot.sending': 'Sending...',
  'citizen.auth.forgot.sendResetLink': 'Send Reset Link',
  'citizen.auth.forgot.sent': 'Reset Link Sent',
  'citizen.auth.forgot.sentDesc': 'Check your email for a password reset link. It may take a few minutes to arrive.',
  'citizen.auth.forgot.subtitle': 'Enter your email address and we will send you a password reset link.',
  'citizen.auth.forgot.title': 'Forgot Password',
  'citizen.auth.forgotPassword': 'Forgot password?',
  'citizen.auth.tos.and': 'and',
  'citizen.auth.tos.gdpr': 'We comply with UK GDPR and the Data Protection Act 2018.',
  'citizen.auth.tos.heading': 'Terms of Service',
  'citizen.auth.tos.iAgree': 'I agree to the',
  'citizen.auth.tos.privacyPolicy': 'Privacy Policy',
  'citizen.auth.tos.termsOfService': 'Terms of Service',
  'citizen.subscribe.alertTopics': 'Alert Topics',

  // Map component keys
  'map.highSeverity': 'High Severity',
  'map.layer.aiFlood': 'AI Flood Prediction',
  'map.layer.distressBeacons': 'Distress Beacons',
  'map.layer.riskZones': 'Risk Zones',
  'map.layer.riverGauges': 'River Gauges',
  'map.layer.sepaStations': 'SEPA Stations',
  'map.lowSeverity': 'Low Severity',
  'map.mediumSeverity': 'Medium Severity',
  'map.sosDistress': 'SOS Distress',

  // Safety component keys
  'safety.allClear': 'All Clear',
  'safety.autoRefreshes': 'Auto-refreshes every 30 seconds',
  'safety.dataFromSources': 'Data from official UK sources',
  'safety.emergencyNumbers': 'Emergency Numbers',
  'safety.lifeThreateningEmergency': 'In a life-threatening emergency, call 999',
  'safety.noHighRiskFlood': 'No high-risk flood warnings in your area',
  'safety.weatherDataLoading': 'Weather data loading...',

  // River gauge keys
  'river.alertLabel': 'Alert',
  'river.fetchingRiverData': 'Fetching river data...',
  'river.floodWarningMsg': 'Flood warning issued',
  'river.hoverForDetails': 'Hover for details',
  'river.noStationsConfigured': 'No stations configured',
  'river.warningLabel': 'Warning',

  // Spatial analysis keys
  'spatial.areaDesc': 'Calculate area',
  'spatial.bearingDesc': 'Calculate bearing',
  'spatial.bufferZoneDesc': 'Create buffer zone',
  'spatial.coordinatesDesc': 'Show coordinates',
  'spatial.densityDesc': 'Analyse density',
  'spatial.distanceDesc': 'Measure distance',
  'spatial.distanceLabel': 'Distance',
  'spatial.elevationDesc': 'Show elevation',
  'spatial.exportViewDesc': 'Export current view',
  'spatial.floodRiskDesc': 'Assess flood risk',
  'spatial.fullAnalysisDesc': 'Run full analysis',
  'spatial.nearestShelterDesc': 'Find nearest shelter',
  'spatial.radiusSearchDesc': 'Search within radius',
  'spatial.spatialAnalysisTools': 'Spatial Analysis Tools',

  // Weather, dashboard, flood, delivery, misc keys
  'weather.couldNotDetermineLocation': 'Could not determine your location',
  'weather.enableLocationToSee': 'Enable location to see local weather',
  'weather.loadingWeather': 'Loading weather...',
  'dashboard.confidence': 'Confidence',
  'dashboard.eta': 'ETA',
  'floodPred.floodPrediction': 'Flood Prediction',
  'floodPred.loadingPredictions': 'Loading predictions...',

  // HazardPredictionTimeline -- universal multi-hazard keys
  'hazardPred.prediction': 'Prediction',
  'hazardPred.monitored': 'monitored',
  'hazardPred.now': 'NOW',
  'hazardPred.atRisk': 'At Risk',
  'hazardPred.probability': 'Probability',
  'hazardPred.confidence': 'Confidence',
  'hazardPred.noPredictions': 'No predictions available',
  'hazardPred.runPrediction': 'Run a prediction to see results here',
  'hazardPred.loading': 'Loading predictions...',
  'hazardPred.updated': 'Updated',
  'hazardPred.flood': 'Flood',
  'hazardPred.drought': 'Drought',
  'hazardPred.heatwave': 'Heatwave',
  'hazardPred.severe_storm': 'Severe Storm',
  'hazardPred.wildfire': 'Wildfire',
  'hazardPred.landslide': 'Landslide',
  'hazardPred.power_outage': 'Power Outage',
  'hazardPred.water_supply_disruption': 'Water Supply',
  'hazardPred.infrastructure_damage': 'Infrastructure',
  'hazardPred.public_safety_incident': 'Public Safety',
  'hazardPred.environmental_hazard': 'Environmental',

  // ImageAnalysisResults -- photo intelligence keys
  'imgAnalysis.title': 'AI Image Analysis',
  'imgAnalysis.waterDetected': 'Water Detected',
  'imgAnalysis.disasterConfidence': 'Disaster Confidence',
  'imgAnalysis.classifications': 'Classifications',
  'imgAnalysis.detections': 'Object Detections',
  'imgAnalysis.exifVerification': 'EXIF Verification',
  'imgAnalysis.manipulationRisk': 'Manipulation Risk',
  'imgAnalysis.noAnalysis': 'No analysis available',
  'imgAnalysis.processing': 'Analysing image...',
  'imgAnalysis.damageAssessment': 'Damage Assessment',
  'imgAnalysis.sceneType': 'Scene Type',

  'delivery.attempted': 'Attempted',
  'delivery.channelResults': 'Channel Results',
  'floodLayer.floodLayers': 'Flood Layers',
  'subscribe.whatsapp': 'WhatsApp',
  'common.querying': 'Querying...',
  'community.active': 'Active',
  'severity': 'Severity',
  'common.justNow': 'Just now',
  'common.secondsShort': 's',
  'common.minutesShort': 'm',
  'common.hoursShort': 'h',
  'common.daysShort': 'd',
  'common.ago': 'ago',
  'common.up': 'up',
  'common.down': 'down',
  'common.notAvailable': 'N/A',
  'common.monitor': 'Monitor',
  'common.disperse': 'Disperse',

  'users.roleAdminDesc': 'Full platform access. Manage users, configure system, and access all data.',
  'users.roleAdminPermManageOperators': 'Manage operators',
  'users.roleAdminPermAccessAuditLogs': 'Access audit logs',
  'users.roleAdminPermConfigureRbac': 'Configure RBAC',
  'users.roleAdminPermDeployResources': 'Deploy resources',
  'users.roleAdminPermSendEmergencyAlerts': 'Send emergency alerts',
  'users.roleAdminPermManageSystemSettings': 'Manage system settings',
  'users.roleAdminPermBulkOperations': 'Bulk operations',
  'users.roleAdminPermDeleteAccounts': 'Delete accounts',
  'users.roleOperatorDesc': 'Operational access. Handle reports, manage incidents, and deploy resources.',
  'users.roleOperatorPermViewReports': 'View all reports',
  'users.roleOperatorPermVerifyEscalate': 'Verify, flag, and escalate reports',
  'users.roleOperatorPermDeployResources': 'Deploy resources',
  'users.roleOperatorPermSendAlerts': 'Send alerts',
  'users.roleOperatorPermViewAnalytics': 'View analytics',
  'users.roleOperatorPermAccessCommunityChat': 'Access community chat',
  'users.roleViewerDesc': 'Read-only access. View dashboards, reports, and analytics.',
  'users.roleViewerPermViewDashboard': 'View dashboard',
  'users.roleViewerPermViewReportsReadOnly': 'View reports (read-only)',
  'users.roleViewerPermViewAnalytics': 'View analytics',
  'users.roleViewerPermViewDeploymentMap': 'View deployment map',
  'users.departmentEmergencyOperations': 'Emergency Operations',
  'users.departmentFireRescue': 'Fire & Rescue',
  'users.departmentPolice': 'Police',
  'users.departmentHealthMedical': 'Health & Medical',
  'users.departmentInfrastructure': 'Infrastructure',
  'users.departmentEnvironmental': 'Environmental',
  'users.departmentCommunityLiaison': 'Community Liaison',
  'users.departmentItCommunications': 'IT & Communications',
  'users.departmentLogistics': 'Logistics',
  'users.departmentCommandControl': 'Command & Control',
  'users.auditTypeCreated': 'Created',
  'users.auditTypeUpdated': 'Updated',
  'users.auditTypeActivated': 'Activated',
  'users.auditTypeDeleted': 'Deleted',
  'users.auditTypePasswordReset': 'PW Reset',
  'users.auditTypeLogin': 'Login',
  'users.auditTypeLogout': 'Logout',
  'users.auditTypeRoleChange': 'Role Change',
  'users.directoryRefreshed': 'User directory refreshed',
  'users.refreshUsersFailed': 'Failed to refresh users',
  'users.bulkSelfBlocked': 'Cannot perform bulk action on yourself',
  'users.bulkSuspendTitle': 'Bulk Suspend',
  'users.bulkActivateTitle': 'Bulk Activate',
  'users.bulkDeleteTitle': 'Bulk Delete',
  'users.selectedUser': 'selected user',
  'users.selectedUsers': 'selected users',
  'users.bulkSuspendPrompt': 'Suspend',
  'users.bulkSuspendSuffix': 'They will be locked out immediately.',
  'users.bulkActivatePrompt': 'Activate',
  'users.bulkDeletePrompt': 'Permanently delete',
  'users.bulkDeleteSuffix': 'This cannot be undone.',
  'users.bulkSuspendedResult': 'users suspended',
  'users.bulkActivatedResult': 'users activated',
  'users.bulkDeletedResult': 'users deleted',
  'users.updateSuccess': 'User updated successfully',
  'users.updateFailed': 'Failed to update user',
  'users.suspensionReasonRequired': 'Suspension reason is required',
  'users.suspendSuccessSuffix': 'suspended',
  'users.suspendFailed': 'Failed to suspend user',
  'users.youBadge': 'YOU',
  'users.securityJwtTokenExpiryCheck': 'JWT token expiry',
  'users.securityJwtTokenExpiryStatus': '8 hours',
  'users.securityJwtTokenExpiryDetail': 'Access tokens expire and auto-refresh',
  'users.securityRefreshTokenRotationCheck': 'Refresh token rotation',
  'users.securityRefreshTokenRotationStatus': 'Enabled',
  'users.securityRefreshTokenRotationDetail': 'New refresh token issued on each use',
  'users.securityPasswordHashingCheck': 'Password hashing',
  'users.securityPasswordHashingStatus': 'bcrypt (12 rounds)',
  'users.securityPasswordHashingDetail': 'Industry-standard key derivation',
  'users.securityAuditLoggingCheck': 'Audit logging',
  'users.securityAuditLoggingStatus': 'Immutable',
  'users.securityAuditLoggingDetail': 'All changes recorded with state capture',
  'users.securityRateLimitingCheck': 'Rate limiting',
  'users.securityRateLimitingStatus': '50 req/hr login',
  'users.securityRateLimitingDetail': 'Brute-force protection on auth endpoints',
  'users.securitySuspendedAccountCheck': 'Suspended account check',
  'users.securitySuspendedAccountStatus': 'On refresh',
  'users.securitySuspendedAccountDetail': 'Suspended accounts blocked at token refresh',
  'users.securityRoleEnforcementCheck': 'Role enforcement',
  'users.securityRoleEnforcementStatus': 'API + UI',
  'users.securityRoleEnforcementDetail': 'Dual-layer RBAC at middleware and client',
  'users.securityPasswordResetTokensCheck': 'Password reset tokens',
  'users.securityPasswordResetTokensStatus': 'SHA-256 hashed',
  'users.securityPasswordResetTokensDetail': '30-minute expiry, single-use',

  'command.threatDescNormal': 'No significant threats - all systems nominal',
  'command.threatDescElevated': 'Increased monitoring recommended',
  'command.threatDescHigh': 'Active incidents require coordinated response',
  'command.threatDescSevere': 'Multiple critical incidents - elevated response posture',
  'command.threatDescCritical': 'Maximum response posture - immediate action required',
  'command.aiEngine': 'AI Engine',
  'command.database': 'Database',
  'command.dataLabel': 'DATA',
  'command.refreshLabel': 'REFRESH',
  'command.urgent': 'Urgent',
  'command.unverified': 'Unverified',
  'command.verified': 'Verified',
  'command.flagged': 'Flagged',
  'command.resolved': 'Resolved',

  'ai.activePredictionPlural': 'active predictions',
  'ai.preAlertConfirmTitle': 'Send Pre-Alert',
  'ai.preAlertConfirmPrefix': 'Send pre-alert for',
  'ai.preAlertConfirmSuffix': 'This will notify matched subscribers.',
  'ai.defaultModelVersion': 'Default flood model',

  'resource.readinessCritical': 'CRITICAL',
  'resource.readinessElevated': 'ELEVATED',
  'resource.readinessActive': 'ACTIVE',
  'resource.readinessStandby': 'STANDBY',
  'resource.ambulances': 'Ambulances',
  'resource.fireEngines': 'Fire Engines',
  'resource.rescueBoats': 'Rescue Boats',
  'resource.dataRefreshed': 'Deployment data refreshed',
  'resource.deployConfirmPrefix': 'Deploy resources to',
  'resource.deployConfirmSuffix': 'A mandatory reason is required and will be logged.',
  'resource.recallConfirmPrefix': 'Recall all resources from',
  'resource.recallConfirmSuffix': 'Reason required.',
  'resource.deploySuccess': 'Resources deployed',
  'resource.deployFailed': 'Deploy failed',
  'resource.recallSuccess': 'Resources recalled',
  'resource.recallFailed': 'Recall failed',
  'resource.recallReasonRequired': 'Reason required for recall',
  'resource.deployedToPrefix': 'Deployed resources to',
  'resource.recalledFromPrefix': 'Recalled resources from',
  'common.stateChangeCaptured': 'State change captured',

  'community.respectBullet1': 'Treat all community members with dignity and respect',
  'community.respectBullet2': 'Listen to different viewpoints without judgment',
  'community.respectBullet3': 'Disagree respectfully without personal attacks',
  'community.respectBullet4': "Don't use hurtful, offensive, or discriminatory language",
  'community.doNotPost': 'Do NOT post:',
  'community.prohibitedBullet1': 'Hate speech, harassment, bullying, or threats',
  'community.prohibitedBullet2': 'Violence, gore, or self-harm content',
  'community.prohibitedBullet3': 'Sexual, adult, or explicit material',
  'community.prohibitedBullet4': 'Spam, scams, or misleading information',
  'community.prohibitedBullet5': 'Personal information (doxxing) of others',
  'community.prohibitedBullet6': 'Misinformation about emergencies or health',
  'community.prohibitedBullet7': 'Illegal content or activities',
  'community.accurateBullet1': 'Verify facts before sharing about emergencies or hazards',
  'community.accurateBullet2': 'For hazard updates, include specific location details',
  'community.accurateBullet3': 'Cite credible sources when possible',
  'community.accurateBullet4': 'Distinguish between confirmed facts and opinions',
  'community.accurateBullet5': 'Report verified issues to authorities when needed',
  'community.privacyBullet1': "Don't share passwords, personal IDs, or financial info",
  'community.privacyBullet2': "Don't share others' private information without consent",
  'community.privacyBullet3': 'Be cautious with location data in emergency situations',
  'community.privacyBullet4': "Don't impersonate others or create fake accounts",
  'community.valueSafetyFirstTitle': 'Safety First',
  'community.valueSafetyFirstDesc': "Prioritize everyone's wellbeing",
  'community.valueTransparencyTitle': 'Transparency',
  'community.valueTransparencyDesc': 'Be honest and clear in communications',
  'community.valueInclusivityTitle': 'Inclusivity',
  'community.valueInclusivityDesc': 'Welcome diverse perspectives and backgrounds',
  'community.valueResponsibilityTitle': 'Responsibility',
  'community.valueResponsibilityDesc': 'Think about the impact of your posts',
  'community.valueSupportTitle': 'Support',
  'community.valueSupportDesc': 'Help others during emergencies and difficulties',
  'community.guidelineConsequencesTitle': 'Important:',
  'community.guidelineConsequencesBody': 'Violations of these guidelines may result in content removal, account restrictions, or permanent ban. Serious violations may be reported to authorities.',
  'community.guidelinesAcknowledge': 'I understand and agree to follow these guidelines',
  'community.gotIt': 'Got It',

  'crowd.live': 'LIVE',
  'crowd.searchOrUseGps': 'Search or use GPS',
  'crowd.detectingLocation': 'Detecting location...',
  'crowd.enableLocation': 'Enable location to see local data',
  'crowd.locationUnavailable': 'Location unavailable',
  'crowd.locationNotFound': 'Location not found. Try a city, postcode, or region.',
  'crowd.searchPlaceholder': 'Search city, postcode, or place...',
  'crowd.totalCapacityUtilisation': 'Total capacity utilisation',
  'crowd.current': 'Current',
  'crowd.nextPeakIn': 'Next peak in',
  'crowd.name': 'Name',
  'crowd.trend': 'Trend',
  'crowd.risk': 'Risk',
  'crowd.falling': 'Falling',
  'crowd.stable': 'Stable',
  'crowd.capacity': 'Capacity',
  'crowd.utilised': 'utilised',
  'crowd.updated': 'Updated',
  'crowd.action': 'Action',
  'crowd.history': 'History',
  'crowd.actionNormal': 'Normal',
  'crowd.zone': 'Zone',
  'crowd.quiet': 'Quiet',
  'crowd.waking': 'Waking',
  'crowd.building': 'Building',
  'crowd.rushHour': 'Rush hour',
  'crowd.peak': 'Peak',
  'crowd.peakLunch': 'Peak lunch',
  'crowd.settling': 'Settling',
  'crowd.searchToBegin': 'Search a location to begin',
  'crowd.enterLocationHint': 'Enter a city, postcode, or use GPS above',
  'crowd.scanningAreaDensity': 'Scanning area density...',
  'crowd.densityTrendLast8': 'Density trend (last 8 readings)',
  'crowd.criticalDensityAdvice': 'Critical density - consider crowd control measures immediately',
  'crowd.pointsShort': 'pts',
  'crowd.subtitle': 'Real-time incident density analysis & crowd monitoring',
  'crowd.realData': 'Real data',
  'crowd.syntheticData': 'Simulated data',
  'crowd.riskDistribution': 'Risk distribution',
  'crowd.peakForecast': 'Peak hour forecast',
  'crowd.searchZones': 'Search zones...',
  'crowd.analyzing': 'Analyzing density data...',
  'crowd.noZoneData': 'No density data available',
  'crowd.rptShort': ' rpt',
  'crowd.of': 'of',
  'crowd.coordinates': 'Coordinates',
  'crowd.incidents': 'Incidents',

  'delivery.statusSent': 'Sent',
  'delivery.statusDelivered': 'Delivered',
  'delivery.statusFailed': 'Failed',
  'delivery.statusPending': 'Pending',
  'delivery.noData': 'No data',
  'delivery.total': 'total',
  'delivery.noActivity24h': 'No activity in last 24h',
  'delivery.sentLower': 'sent',
  'delivery.retried': 'retried',
  'delivery.maxRetries': 'Max retries',
  'delivery.time': 'Time',
  'delivery.alert': 'Alert',
  'delivery.channel': 'Channel',
  'delivery.recipient': 'Recipient',
  'delivery.retries': 'Retries',
  'delivery.error': 'Error',
  'delivery.noRecordsMatchFilters': 'No delivery records match your filters.',
  'delivery.retrySucceeded': 'Retry succeeded',
  'delivery.retryFailedPrefix': 'Retry failed',
  'delivery.bulkRetrySummary': 'Bulk retry',
  'delivery.exportFailed': 'Export failed',
  'delivery.exportSuccess': 'CSV exported successfully',
  'delivery.allSeverities': 'All Severities',
  'delivery.alertSingular': 'alert',
  'delivery.alertPlural': 'alerts',
  'delivery.recordSingular': 'record',
  'delivery.recordPlural': 'records',
  'delivery.errorPatternsLast7Days': 'Error Patterns - last 7 days',
  'delivery.channelEmail': 'Email',
  'delivery.channelSms': 'SMS',
  'delivery.channelWhatsApp': 'WhatsApp',
  'delivery.channelTelegram': 'Telegram',
  'delivery.channelWebPush': 'Web Push',
  'delivery.shortcuts': 'Shortcuts',
  'delivery.exportCSV': 'Export CSV',
  'delivery.toggleView': 'Toggle View',
  'delivery.clearFilters': 'Clear Filters',
  'delivery.toggleShortcuts': 'Toggle shortcuts',

  'communityHelp.communityMember': 'Community Member',
  'communityHelp.anonymous': 'Anonymous',
  'communityHelp.anonymousHelper': 'Anonymous Helper',
  'communityHelp.verifiedHelperChecked': 'Verified Helper (ID Checked)',
  'communityHelp.emergencyBoardWarning': 'Emergency? Call 999 (UK) or 112 (EU) immediately. This community board is for non-emergency mutual aid.',
  'communityHelp.aboutLabel': 'About:',
  'communityHelp.messagePlaceholder': 'e.g. I need shelter for 2 adults and a child, dog-friendly if possible. I can travel to the meeting point.',
  'communityHelp.meetLabel': 'Meet:',
  'communityHelp.offerFoodMeals': 'Food / meals provision',
  'communityHelp.offerTransportEvacuation': 'Transport / evacuation',
  'communityHelp.offerMedicalSupport': 'Medical / first aid support',
  'communityHelp.offerClothingSupplies': 'Clothing / supplies',
  'communityHelp.offerMultipleTypes': 'Multiple types',
  'communityHelp.fillAllFields': 'Please fill in all fields',
  'communityHelp.applicationSubmitted': "Application submitted - we'll review within 2-3 working days",
  'communityHelp.secureContactSentToast': 'Secure contact request sent - the helper will respond if available',
  'communityHelp.noPostsMatchFilter': 'No posts match your filter',
  'communityHelp.reportReceived': 'Report received. Our team will review.',

  'communityChat.today': 'Today',
  'communityChat.yesterday': 'Yesterday',
  'communityChat.reportMessageTitle': 'Report Message',
  'communityChat.reportMessageSubtitle': 'Select a reason for reporting this message.',
  'communityChat.additionalDetails': 'Additional details (optional)...',
  'communityChat.submitReport': 'Submit Report',
  'communityChat.signInRequired': 'Sign in Required',
  'communityChat.bannedTitle': 'Banned from Community Chat',
  'communityChat.bannedDefault': 'You have been banned from the community chat. Contact an administrator for more information.',
  'communityChat.roomTitle': 'Community Chat',
  'communityChat.onlineDiscussion': 'members online - Open community discussion',
  'communityChat.translateMessagesTo': 'Translate messages to',
  'communityChat.searchMessages': 'Search messages',
  'communityChat.refreshChat': 'Refresh chat',
  'communityChat.searchMessagesPlaceholder': 'Search messages or usernames...',
  'communityChat.thisMessageWasDeleted': 'This message was deleted',
  'communityChat.thisMessageWasRemovedBy': 'This message was removed by',
  'communityChat.violatedPolicy': 'Violated community policy',
  'communityChat.byLabel': 'By:',
  'communityChat.imagePlaceholder': '(image)',
  'communityChat.translatedLabel': 'Translated',
  'communityChat.removeTranslation': 'Remove translation',
  'communityChat.read': 'Read',
  'communityChat.replyToPrefix': 'Reply to',
  'communityChat.emoji': 'Emoji',
  'communityChat.shareImage': 'Share image',
  'communityChat.deleteMessage': 'Delete Message',
  'communityChat.moderateMessage': 'Moderate Message',
  'communityChat.deleteAndNotify': 'Delete & Notify',
  'communityChat.deleteMessagePrompt': 'Delete message from',
  'communityChat.deleteOwnMessagePrompt': 'Delete your message?',
  'communityChat.deleteMessageSuffix': 'A notification will appear in the chat.',
  'communityChat.selectReasonPlaceholder': 'Select a reason...',
  'communityChat.customReasonPlaceholder': 'Or type a custom reason...',
  'communityChat.onlyImages': 'Only image files are supported',
  'communityChat.leaveConfirm': 'Are you sure you want to leave the community chat? You can rejoin anytime.',
  'communityChat.leaveBanned': 'You have been banned from community chat',
  'communityChat.unmuteSuccess': 'has been unmuted.',
  'communityChat.unbanSuccess': 'has been unbanned.',
  'communityChat.banFailed': 'Ban failed',
  'communityChat.muteFailed': 'Mute failed',
  'communityChat.reasonForBan': 'Reason for ban...',
  'communityChat.reasonForMuting': 'Reason for muting...',
  'communityChat.signInMessage': 'You must be signed in to access the community chat.',
  'communityChat.joinPrompt': 'Join the community to participate in discussions',
  'communityChat.previewUnavailable': 'No preview available',
  'communityChat.joinCommunityTitle': 'Join the Community',
  'communityChat.joinCommunityDesc': 'Become a member to send messages, share images, and connect with other community members.',
  'communityChat.joining': 'Joining...',
  'communityChat.joinCommunity': 'Join Community',
  'communityChat.autoLabel': 'Auto',
  'communityChat.result': 'result',
  'communityChat.youAreMuted': 'You are muted',
  'communityChat.contactAdmin': 'Contact an admin for more information.',
  'communityChat.onlineTitle': 'Online',
  'communityChat.noUsersOnline': 'No users online',
  'communityChat.staff': 'Staff',
  'communityChat.members': 'Members',
  'communityChat.chatFeatures': 'Chat Features',
  'communityChat.featureImages': 'Images',
  'communityChat.featureReply': 'Reply',
  'communityChat.featureEdit': 'Edit',
  'communityChat.featureReport': 'Report',
  'communityChat.guidelinesTitle': 'Guidelines',
  'communityChat.guidelineRespect': 'Be respectful',
  'communityChat.guidelineNoPersonalInfo': 'No personal info',
  'communityChat.guidelineEmergency': 'Emergencies: call 999',
  'communityChat.reasonForDeletionAudit': 'Reason for deletion (audit log)',
  'communityChat.emojiCategorySmileys': 'Smileys',
  'communityChat.emojiCategoryGestures': 'Gestures',
  'communityChat.emojiCategoryAlerts': 'Alerts',
  'communityChat.reason.deletePolicy.label': 'Violated community policy',
  'communityChat.reason.deleteSpam.label': 'Spam or advertising',
  'communityChat.reason.deletePersonalInfo.label': 'Personal information shared',
  'communityChat.reason.deleteOffTopic.label': 'Off-topic content',
  'communityChat.retryConnection': 'Retry Connection',
  'communityChat.noMessagesYet': 'No messages yet',
  'communityChat.startConversation': 'Be the first to start the conversation!',
  'communityChat.auditLabel': 'Audit',
  'communityChat.typingSingular': 'is typing...',
  'communityChat.typingPlural': 'are typing...',
  'communityChat.expiresLabel': 'Expires:',
  'communityChat.newLineHint': 'Shift+Enter for new line',
  'communityChat.profileBio': 'Bio',
  'communityChat.profileJoined': 'Joined',
  'communityChat.profileMessages': 'Messages',
  'communityChat.removeFromChat': 'Remove from Chat',
  'communityChat.removeFromChatPrompt': 'Remove from community chat',
  'communityChat.muteUser': 'Mute User',
  'communityChat.unmuteUser': 'Unmute User',
  'communityChat.banUser': 'Ban User',
  'communityChat.unbanUser': 'Unban User',
  'communityChat.unbanPrompt': 'Unban',
  'communityChat.banModalDesc': 'Select ban duration and reason.',
  'communityChat.muteModalDesc': 'Select mute duration.',
  'communityChat.durationLabel': 'Duration',
  'communityChat.duration1Hour': '1 Hour',
  'communityChat.duration24Hours': '24 Hours',
  'communityChat.duration7Days': '7 Days',
  'communityChat.duration2Weeks': '2 Weeks',
  'communityChat.duration1Month': '1 Month',
  'communityChat.duration3Months': '3 Months',
  'communityChat.durationPermanent': 'Permanent',
  'communityChat.bannedByAdmin': 'Banned by admin',
  'communityChat.mutedByAdmin': 'Muted by admin',
  'communityChat.banSuccess': 'has been banned',
  'communityChat.muteSuccess': 'has been muted',
  'communityChat.removedFromChat': 'You have been removed from the community chat.',
  'communityChat.socketDisconnected': 'Socket disconnected. Please refresh.',
  'communityChat.refreshFailed': 'Failed to refresh chat history',
  'communityChat.notConnectedYet': 'Not connected. Please wait and try again.',

} satisfies TranslationMap

//Registry + helpers

const ALL_TRANSLATIONS: Record<string, TranslationMap> = { en }
const SUPPORTED_CODES = Object.keys(ALL_TRANSLATIONS)
const I18NEXT_ONLY_CODES = ['es', 'fr', 'ar', 'zh', 'hi', 'pt', 'pl', 'ur', 'de', 'sw']

const LANGUAGE_ALIASES: Record<string, string> = {
  english: 'en', spanish: 'es', español: 'es', french: 'fr',
  arabic: 'ar', chinese: 'zh', hindi: 'hi', portuguese: 'pt',
  polish: 'pl', urdu: 'ur',
}

export function normalizeLanguageCode(value?: string): string {
  if (!value) return 'en'
  const normalized = String(value).trim().toLowerCase().replace('_', '-')
  const base = normalized.split('-')[0]
  if (SUPPORTED_CODES.includes(normalized)) return normalized
  if (SUPPORTED_CODES.includes(base)) return base
  if (I18NEXT_ONLY_CODES.includes(normalized)) return normalized
  if (I18NEXT_ONLY_CODES.includes(base)) return base
  const alias = LANGUAGE_ALIASES[normalized]
  if (alias && (SUPPORTED_CODES.includes(alias) || I18NEXT_ONLY_CODES.includes(alias))) return alias
  return 'en'
}

export type I18nKey = keyof typeof en

export function t(key: I18nKey, lang?: string): string
export function t(key: string, lang?: string): string
export function t(key: string, lang: string = 'en'): string {
  const normalizedLang = normalizeLanguageCode(lang)
  let value = ALL_TRANSLATIONS[normalizedLang]?.[key]

  if (!value) {
    const i18nextValue = i18next.t(key, { lng: normalizedLang, defaultValue: key })
    value = (i18nextValue && i18nextValue !== key) ? i18nextValue : (ALL_TRANSLATIONS.en[key] || key)
  }

  //Dynamic emergency number injection -- replaces {{EMERGENCY_NUMBER}} with
  //the active region's emergency number so i18n strings are never hardcoded
  if (value.includes('{{EMERGENCY_NUMBER}}')) {
    try {
      value = value.split('{{EMERGENCY_NUMBER}}').join(getRegion().emergencyNumber)
    } catch { value = value.split('{{EMERGENCY_NUMBER}}').join('999') }
  }

  return value
}

export function isRtl(lang?: string): boolean {
  return ['ar', 'ur'].includes(lang || currentLang)
}

export { ALL_TRANSLATIONS }

// Language state (persisted to localStorage)

function getInitialLanguage(): string {
  if (typeof window === 'undefined') return 'en'

  try {
    return normalizeLanguageCode(
      localStorage.getItem('aegis_lang')
      || localStorage.getItem('aegis-language')
      || 'en',
    )
  } catch {
    return 'en'
  }
}

let currentLang = getInitialLanguage()
const listeners: ((lang: string) => void)[] = []

export function getLanguage(): string { return currentLang }

export function setLanguage(lang: string): void {
  currentLang = normalizeLanguageCode(lang)
  if (typeof window !== 'undefined') {
    try {
      localStorage.setItem('aegis_lang', currentLang)
      localStorage.setItem('aegis-language', currentLang)
    } catch (err) {
      console.warn('[i18n] Could not persist language preference:', err)
    }
  }
  void i18next.changeLanguage(currentLang).catch(() => {
    //Keep the custom i18n store authoritative even if the react-i18next
    //instance is not ready yet.
  })
  listeners.forEach(fn => fn(currentLang))
}

export function onLanguageChange(fn: (lang: string) => void): () => void {
  listeners.push(fn)
  return () => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1) }
}

export function getChatLanguageName(): string {
  const names: Record<string, string> = {
    en: 'English', es: 'Spanish', fr: 'French', ar: 'Arabic',
    zh: 'Chinese', hi: 'Hindi', pt: 'Portuguese', pl: 'Polish', ur: 'Urdu',
  }
  return names[currentLang] || 'English'
}

export function getMissingTranslationKeys(lang: string): string[] {
  const normalizedLang = normalizeLanguageCode(lang)
  if (normalizedLang === 'en') return []
  const baseKeys = Object.keys(ALL_TRANSLATIONS.en)
  const langMap = ALL_TRANSLATIONS[normalizedLang] || {}
  return baseKeys.filter((key) => !(key in langMap))
}

//PLURALIZATION RULES (CLDR-compliant)

type PluralCategory = 'zero' | 'one' | 'two' | 'few' | 'many' | 'other'

interface PluralForms {
  zero?: string
  one?: string
  two?: string
  few?: string
  many?: string
  other: string
}

//CLDR plural rules per language
//https://www.unicode.org/cldr/charts/latest/supplemental/language_plural_rules.html
const PLURAL_RULES: Record<string, (n: number) => PluralCategory> = {
  //English: 1=one, else other
  en: (n) => n === 1 ? 'one' : 'other',
  
  //Spanish: 1=one, else other
  es: (n) => n === 1 ? 'one' : 'other',
  
  //French: 0,1=one, else other (treats 0 as singular)
  fr: (n) => (n === 0 || n === 1) ? 'one' : 'other',
  
  //Arabic: complex 6-form system
  ar: (n) => {
    if (n === 0) return 'zero'
    if (n === 1) return 'one'
    if (n === 2) return 'two'
    const mod100 = n % 100
    if (mod100 >= 3 && mod100 <= 10) return 'few'
    if (mod100 >= 11) return 'many'
    return 'other'
  },
  
  //Chinese: no plural forms (always 'other')
  zh: () => 'other',
  
  //Hindi: 0,1=one, else other
  hi: (n) => (n === 0 || n === 1) ? 'one' : 'other',
  
  //Portuguese: 1=one, else other
  pt: (n) => n === 1 ? 'one' : 'other',
  
  //Polish: complex 3-form system
  pl: (n) => {
    if (n === 1) return 'one'
    const mod10 = n % 10
    const mod100 = n % 100
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'few'
    return 'many'
  },
  
  //Urdu: 1=one, else other
  ur: (n) => n === 1 ? 'one' : 'other',
}

/**
 * Get the plural category for a number in the given language
 */
export function getPluralCategory(n: number, lang?: string): PluralCategory {
  const normalizedLang = normalizeLanguageCode(lang || currentLang)
  const rule = PLURAL_RULES[normalizedLang] || PLURAL_RULES.en
  return rule(Math.abs(n))
}

/**
 * Select the correct plural form for a number
 * 
 * @example
 * plural(5, { one: '1 alert', other: '{{count}} alerts' }, 'en')
 * // Returns: '5 alerts'
 */
export function plural(count: number, forms: PluralForms, lang?: string): string {
  const category = getPluralCategory(count, lang)
  const template = forms[category] ?? forms.other
  return template.replace(/\{\{count\}\}/g, String(count))
}

/**
 * Common plural patterns for emergency system
 */
export const PLURALS = {
  alerts: (count: number, lang?: string) => plural(count, {
    zero: t('alerts.none', lang),
    one: t('stats.activeAlerts', lang) + ': 1',
    other: `${t('stats.activeAlerts', lang)}: {{count}}`,
  }, lang),
  
  reports: (count: number, lang?: string) => plural(count, {
    one: '1 ' + t('reports.title', lang).toLowerCase().replace('recent ', ''),
    other: `{{count}} ${t('reports.title', lang).toLowerCase().replace('recent ', '')}`,
  }, lang),
  
  minutes: (count: number, lang?: string) => {
    const forms: Record<string, PluralForms> = {
      en: { one: '1 minute ago', other: '{{count}} minutes ago' },
      es: { one: 'hace 1 minuto', other: 'hace {{count}} minutos' },
      fr: { one: 'il y a 1 minute', other: 'il y a {{count}} minutes' },
      ar: { zero: 'الآن', one: 'منذ دقيقة', two: 'منذ دقيقتين', few: 'منذ {{count}} دقائق', many: 'منذ {{count}} دقيقة', other: 'منذ {{count}} دقيقة' },
      zh: { other: '{{count}}分钟前' },
      hi: { one: '1 मिनट पहले', other: '{{count}} मिनट पहले' },
      pt: { one: 'há 1 minuto', other: 'há {{count}} minutos' },
      pl: { one: '1 minutę temu', few: '{{count}} minuty temu', many: '{{count}} minut temu', other: '{{count}} minut temu' },
      ur: { one: '1 منٹ پہلے', other: '{{count}} منٹ پہلے' },
    }
    const normalizedLang = normalizeLanguageCode(lang || currentLang)
    return plural(count, forms[normalizedLang] || forms.en, lang)
  },
  
  hours: (count: number, lang?: string) => {
    const forms: Record<string, PluralForms> = {
      en: { one: '1 hour ago', other: '{{count}} hours ago' },
      es: { one: 'hace 1 hora', other: 'hace {{count}} horas' },
      fr: { one: 'il y a 1 heure', other: 'il y a {{count}} heures' },
      ar: { one: 'منذ ساعة', two: 'منذ ساعتين', few: 'منذ {{count}} ساعات', many: 'منذ {{count}} ساعة', other: 'منذ {{count}} ساعة' },
      zh: { other: '{{count}}小时前' },
      hi: { one: '1 घंटा पहले', other: '{{count}} घंटे पहले' },
      pt: { one: 'há 1 hora', other: 'há {{count}} horas' },
      pl: { one: '1 godzinę temu', few: '{{count}} godziny temu', many: '{{count}} godzin temu', other: '{{count}} godzin temu' },
      ur: { one: '1 گھنٹہ پہلے', other: '{{count}} گھنٹے پہلے' },
    }
    const normalizedLang = normalizeLanguageCode(lang || currentLang)
    return plural(count, forms[normalizedLang] || forms.en, lang)
  },
}

//LOCALE-SPECIFIC FORMATTING

//Locale codes for Intl APIs (BCP 47)
const LOCALE_CODES: Record<string, string> = {
  en: 'en-GB', // UK English for emergency services context
  es: 'es-ES',
  fr: 'fr-FR',
  ar: 'ar-SA',
  zh: 'zh-CN',
  hi: 'hi-IN',
  pt: 'pt-PT',
  pl: 'pl-PL',
  ur: 'ur-PK',
}

/**
 * Get BCP 47 locale code for Intl APIs
 */
export function getLocaleCode(lang?: string): string {
  const normalizedLang = normalizeLanguageCode(lang || currentLang)
  return LOCALE_CODES[normalizedLang] || 'en-GB'
}

/**
 * Format a number according to locale conventions
 * 
 * @example
 * formatNumber(1234567.89, 'de') // "1.234.567,89"
 * formatNumber(1234567.89, 'en') // "1,234,567.89"
 */
export function formatNumber(value: number, lang?: string, options?: Intl.NumberFormatOptions): string {
  try {
    return new Intl.NumberFormat(getLocaleCode(lang), options).format(value)
  } catch {
    return String(value)
  }
}

/**
 * Format a date according to locale conventions
 * 
 * @example
 * formatDate(new Date(), 'fr') // "6 avr. 2026"
 * formatDate(new Date(), 'ar') // "٦ أبريل ٢٠٢٦"
 */
export function formatDate(
  date: Date | number | string,
  lang?: string,
  options: Intl.DateTimeFormatOptions = { dateStyle: 'medium' }
): string {
  try {
    const d = typeof date === 'string' ? new Date(date) : date
    return new Intl.DateTimeFormat(getLocaleCode(lang), options).format(d)
  } catch {
    return String(date)
  }
}

/**
 * Format a time according to locale conventions
 */
export function formatTime(
  date: Date | number | string,
  lang?: string,
  options: Intl.DateTimeFormatOptions = { timeStyle: 'short' }
): string {
  try {
    const d = typeof date === 'string' ? new Date(date) : date
    return new Intl.DateTimeFormat(getLocaleCode(lang), options).format(d)
  } catch {
    return String(date)
  }
}

/**
 * Format date and time together
 */
export function formatDateTime(
  date: Date | number | string,
  lang?: string,
  options: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'short' }
): string {
  try {
    const d = typeof date === 'string' ? new Date(date) : date
    return new Intl.DateTimeFormat(getLocaleCode(lang), options).format(d)
  } catch {
    return String(date)
  }
}

/**
 * Format relative time (e.g., "2 hours ago", "in 3 days")
 */
export function formatRelativeTime(date: Date | number | string, lang?: string): string {
  try {
    const d = typeof date === 'string' ? new Date(date) : typeof date === 'number' ? new Date(date) : date
    const now = Date.now()
    const diff = d.getTime() - now
    const absDiff = Math.abs(diff)
    
    const rtf = new Intl.RelativeTimeFormat(getLocaleCode(lang), { numeric: 'auto' })
    
    if (absDiff < 60 * 1000) {
      return rtf.format(Math.round(diff / 1000), 'second')
    } else if (absDiff < 60 * 60 * 1000) {
      return rtf.format(Math.round(diff / (60 * 1000)), 'minute')
    } else if (absDiff < 24 * 60 * 60 * 1000) {
      return rtf.format(Math.round(diff / (60 * 60 * 1000)), 'hour')
    } else if (absDiff < 7 * 24 * 60 * 60 * 1000) {
      return rtf.format(Math.round(diff / (24 * 60 * 60 * 1000)), 'day')
    } else if (absDiff < 30 * 24 * 60 * 60 * 1000) {
      return rtf.format(Math.round(diff / (7 * 24 * 60 * 60 * 1000)), 'week')
    } else {
      return rtf.format(Math.round(diff / (30 * 24 * 60 * 60 * 1000)), 'month')
    }
  } catch {
    return String(date)
  }
}

/**
 * Format distance in user's preferred units
 */
export function formatDistance(meters: number, lang?: string): string {
  const normalizedLang = normalizeLanguageCode(lang || currentLang)
  
  //US uses miles, everyone else uses km
  const useImperial = normalizedLang === 'en' && typeof navigator !== 'undefined' && 
    (navigator.language?.includes('US') || navigator.language?.includes('us'))
  
  if (useImperial) {
    const miles = meters / 1609.344
    if (miles < 0.1) {
      const feet = meters * 3.28084
      return formatNumber(Math.round(feet), lang) + ' ft'
    }
    return formatNumber(Math.round(miles * 10) / 10, lang) + ' mi'
  } else {
    if (meters < 1000) {
      return formatNumber(Math.round(meters), lang) + ' m'
    }
    return formatNumber(Math.round(meters / 100) / 10, lang) + ' km'
  }
}

//RTL LAYOUT UTILITIES

/**
 * Check if current or specified language is RTL
 */
export function isRtlLanguage(lang?: string): boolean {
  return ['ar', 'ur'].includes(normalizeLanguageCode(lang || currentLang))
}

/**
 * Get text direction for current or specified language
 */
export function getTextDirection(lang?: string): 'ltr' | 'rtl' {
  return isRtlLanguage(lang) ? 'rtl' : 'ltr'
}

/**
 * Get CSS logical properties for directional layout
 * Converts physical directions to logical ones for RTL support
 */
export function getDirectionalStyles(lang?: string): {
  startAlign: 'left' | 'right'
  endAlign: 'left' | 'right'
  startMargin: 'marginLeft' | 'marginRight'
  endMargin: 'marginLeft' | 'marginRight'
  startPadding: 'paddingLeft' | 'paddingRight'
  endPadding: 'paddingLeft' | 'paddingRight'
} {
  const rtl = isRtlLanguage(lang)
  return {
    startAlign: rtl ? 'right' : 'left',
    endAlign: rtl ? 'left' : 'right',
    startMargin: rtl ? 'marginRight' : 'marginLeft',
    endMargin: rtl ? 'marginLeft' : 'marginRight',
    startPadding: rtl ? 'paddingRight' : 'paddingLeft',
    endPadding: rtl ? 'paddingLeft' : 'paddingRight',
  }
}

/**
 * Mirror a value for RTL (e.g., for icons that point in a direction)
 */
export function mirrorForRtl<T>(ltrValue: T, rtlValue: T, lang?: string): T {
  return isRtlLanguage(lang) ? rtlValue : ltrValue
}

/**
 * Get the correct chevron direction for navigation
 */
export function getChevronDirection(direction: 'back' | 'forward', lang?: string): 'left' | 'right' {
  const isRtl = isRtlLanguage(lang)
  if (direction === 'back') {
    return isRtl ? 'right' : 'left'
  }
  return isRtl ? 'left' : 'right'
}

/**
 * CSS class helper for RTL-aware Tailwind classes
 * Automatically converts directional classes for RTL
 * 
 * @example
 * rtlClass('ml-4 text-left') // RTL: 'mr-4 text-right'
 */
export function rtlClass(classes: string, lang?: string): string {
  if (!isRtlLanguage(lang)) return classes
  
  return classes
    .replace(/\bml-/g, '__mr-__')
    .replace(/\bmr-/g, 'ml-')
    .replace(/__mr-__/g, 'mr-')
    .replace(/\bpl-/g, '__pr-__')
    .replace(/\bpr-/g, 'pl-')
    .replace(/__pr-__/g, 'pr-')
    .replace(/\bleft-/g, '__right-__')
    .replace(/\bright-/g, 'left-')
    .replace(/__right-__/g, 'right-')
    .replace(/\btext-left\b/g, 'text-right')
    .replace(/\btext-right\b/g, 'text-left')
    .replace(/\brounded-l\b/g, '__rounded-r__')
    .replace(/\brounded-r\b/g, 'rounded-l')
    .replace(/__rounded-r__/g, 'rounded-r')
    .replace(/\bborder-l\b/g, '__border-r__')
    .replace(/\bborder-r\b/g, 'border-l')
    .replace(/__border-r__/g, 'border-r')
}

//TRANSLATION INTERPOLATION

/**
 * Interpolate variables into a translation string
 * 
 * @example
 * interpolate('Hello, {{name}}!', { name: 'World' })
 * // Returns: 'Hello, World!'
 */
export function interpolate(template: string, variables: Record<string, string | number>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    return key in variables ? String(variables[key]) : match
  })
}

/**
 * Translate with variable interpolation
 * 
 * @example
 * tVar('form.call999', { EMERGENCY_NUMBER: '999' })
 */
export function tVar(key: string, variables: Record<string, string | number>, lang?: string): string {
  const template = t(key, lang)
  return interpolate(template, variables)
}
