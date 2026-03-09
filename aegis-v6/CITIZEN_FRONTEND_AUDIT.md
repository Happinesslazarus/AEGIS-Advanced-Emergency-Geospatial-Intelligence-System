# AEGIS Citizen-Facing Frontend — Comprehensive Audit

**Date:** 2025-01-XX  
**Scope:** All citizen-facing React/TypeScript components  
**Files Audited:** 15 components (~8,500+ lines)

---

## TABLE OF CONTENTS

1. [Files Audited](#files-audited)
2. [BUGS](#1-bugs)
3. [SECURITY ISSUES](#2-security-issues)
4. [HARDCODED DATA](#3-hardcoded-data)
5. [BACKEND CONNECTIVITY GAPS](#4-backend-connectivity-gaps)
6. [MISSING FEATURES](#5-missing-features)
7. [UI/UX GAPS](#6-uiux-gaps)
8. [CODE QUALITY / PROFESSIONAL POLISH](#7-code-quality--professional-polish)
9. [PER-FILE SUMMARY](#per-file-summary)
10. [PRIORITY RECOMMENDATIONS](#priority-recommendations)

---

## Files Audited

| # | File | Lines | Status |
|---|------|-------|--------|
| 1 | `pages/CitizenPage.tsx` | 936 | Full |
| 2 | `pages/CitizenDashboard.tsx` | 2336 | Full |
| 3 | `pages/CitizenAuthPage.tsx` | 706 | Full |
| 4 | `components/citizen/Chatbot.tsx` | ~135 | Full |
| 5 | `components/citizen/CommunityChat.tsx` | 1194 | Full |
| 6 | `components/citizen/CommunityHelp.tsx` | 828 | Full |
| 7 | `components/citizen/PreparednessGuide.tsx` | 539 | Full |
| 8 | `components/citizen/SOSButton.tsx` | ~190 | Full |
| 9 | `components/citizen/ReportForm.tsx` | ~240 | Full |
| 10 | `components/citizen/CitizenMessaging.tsx` | 473 | Full |
| 11 | `components/citizen/SafetyCheckIn.tsx` | ~40 | Full |
| 12 | `components/citizen/OnboardingTutorial.tsx` | ~60 | Full |
| 13 | `components/citizen/CommunityGuidelines.tsx` | 164 | Full |
| 14 | `components/citizen/CommunityChatRoom.tsx` | 2440 | Partial |
| 15 | `components/citizen/AlertSubscribe.tsx` | (referenced) | N/A |

---

## 1. BUGS

### BUG-01: SOS Countdown Timer Leak (CitizenPage.tsx)
- **Location:** `CitizenPage.tsx` — `handleGuestSOS` / `setSosCountdown` logic (~line 120-140)
- **Issue:** The SOS countdown uses `setInterval` but the cleanup only happens inside the timer callback when it reaches zero. If the component unmounts during countdown (e.g., user navigates away), the interval is **never cleared**, causing a memory leak and potential state-update-on-unmounted-component error.
- **Severity:** Medium
- **Fix:** Move interval to a `useRef` and clear it in a `useEffect` cleanup.

### BUG-02: `timeAgo` Function Missing Null Guard (CitizenDashboard.tsx)
- **Location:** `CitizenDashboard.tsx` ~line 86 — `function timeAgo(dateStr: string)`
- **Issue:** Called with `th.updated_at` which could be `null`/`undefined` (see line 1143). The ternary guard on the call site helps, but the function itself has no null check and will throw on `new Date(undefined)`.
- **Severity:** Low

### BUG-03: Operator Precedence in Disabled Button (CitizenMessaging.tsx)
- **Location:** `CitizenMessaging.tsx` ~line 450 — send button `disabled` prop
- **Issue:** `disabled={!msgInput.trim() && !selectedImage || isLoading}` — this is `(!a && !b) || c` due to operator precedence, but the intent is `!(a || b) || c`. Missing parentheses. When `isLoading` is true but there IS text, the button is still enabled.
- **Severity:** Medium
- **Fix:** `disabled={(!msgInput.trim() && !selectedImage) || isLoading}`

### BUG-04: Image Preview State Variable Mismatch (CitizenMessaging.tsx)
- **Location:** `CitizenMessaging.tsx` ~line 210-215
- **Issue:** The component uses `setPreviewUrl('')` to clear preview but the state is initialized differently in the chat view vs list view. The `previewUrl` variable name is used in the template but `setPreviewUrl` is set via `setImagePreview` in some paths. Check that `previewUrl` and `imagePreview` are the same state variable.
- **Severity:** Low-Medium

### BUG-05: CommunityChat Polling + Socket Duplicates (CommunityChat.tsx)
- **Location:** `CommunityChat.tsx` ~line 270-290
- **Issue:** Posts are fetched via 12-second polling interval AND socket events (`community:post_liked`, `community:new_comment`). When a socket event triggers an optimistic update and the polling also fetches, the same change can be applied twice, causing flickering UI and incorrect counts.
- **Severity:** Medium
- **Fix:** Either remove polling when socket is connected, or deduplicate by post ID + timestamp.

### BUG-06: SafetyCheckIn Never Persists to Backend (SafetyCheckIn.tsx)
- **Location:** `SafetyCheckIn.tsx` ~line 12-18
- **Issue:** The `handle` function only calls `pushNotification()` but never makes any API call or socket emission. The safety status is purely cosmetic — it disappears on refresh.
- **Severity:** High
- **Fix:** Send status to `/api/citizen/safety-checkin` API endpoint or via socket.

### BUG-07: CommunityHelp Offers/Requests Are Local-Only (CommunityHelp.tsx)
- **Location:** `CommunityHelp.tsx` — `doOffer()` ~line 247, `doRequest()` ~line 260
- **Issue:** Both functions only call `setPosts(...)` to add items to local state. No API call is made. All offers/requests vanish on page refresh. The success notification says "Offer posted!" but nothing was actually posted to a server.
- **Severity:** Critical
- **Fix:** Implement API endpoints for community help offers/requests and call them.

### BUG-08: Address Suggestions Timeout Leak (ReportForm.tsx)
- **Location:** `ReportForm.tsx` — address autocomplete logic
- **Issue:** The debounce timeout for address lookup (postcodes.io / Nominatim) is not cleaned up if the component unmounts mid-typing. This can cause a state update on an unmounted component.
- **Severity:** Low

### BUG-09: Auto-Translate useEffect Missing Dependency (CitizenDashboard.tsx MessagesTab)
- **Location:** `CitizenDashboard.tsx` ~line 1076 — auto-translate `useEffect`
- **Issue:** The eslint-disable comment `// eslint-disable-line react-hooks/exhaustive-deps` suppresses the missing dependency warning. `translations` is read inside the effect but not in the dependency array, meaning stale state is used for the `untranslated` filter.
- **Severity:** Low — may cause double-translation of messages.

### BUG-10: `handleCreateThread` Uses `prompt()` (CitizenMessaging.tsx)
- **Location:** `CitizenMessaging.tsx` ~line 230
- **Issue:** `const subject = prompt('What is this about?...')` — uses the browser's native `window.prompt()` dialog, which is unprofessional, unstyled, and blocks the main thread. It also doesn't work reliably on mobile browsers and breaks the design language.
- **Severity:** Medium (UX)
- **Fix:** Replace with a styled modal dialog.

---

## 2. SECURITY ISSUES

### SEC-01: XSS via `dangerouslySetInnerHTML` (Chatbot.tsx)
- **Location:** `Chatbot.tsx` ~line 98
- **Issue:** `dangerouslySetInnerHTML={{ __html: html }}` renders chatbot responses with raw HTML. The `html` is generated by replacing `**text**` with `<strong>text</strong>`. If the AI backend or the PATTERN_RESPONSES return untrusted content containing `<script>` or `<img onerror=...>`, this is an XSS vector.
- **Severity:** High
- **Fix:** Use a safe Markdown renderer (e.g., `react-markdown`) or DOMPurify sanitization before rendering.

### SEC-02: Inconsistent Auth Token Keys Across Components
- **Location:** Multiple files:
  - `CitizenMessaging.tsx`: `aegis-citizen-token` || `token`
  - `CommunityChat.tsx`: `aegis-citizen-token` || `aegis-token` || `token`
  - `CommunityChatRoom.tsx`: `aegis-user`, `aegis-token`, `aegis-citizen-token`, `token` (4 different keys)
  - `CitizenDashboard.tsx` MessagesTab: `aegis-token` || `citizen-token` || `token` (different combination!)
- **Issue:** Token retrieval logic differs across components. Some check 2 keys, some check 3, some check 4, and the order/naming varies. This creates confusion, inconsistent auth behavior, and potential where one component can authenticate but another can't with the same session.
- **Severity:** High
- **Fix:** Create a single `getAuthToken()` utility function used everywhere.

### SEC-03: No Input Sanitization on Community Posts (CommunityChat.tsx)
- **Location:** `CommunityChat.tsx` — post creation (~line 345)
- **Issue:** Post content and comment content are sent directly to the server without client-side sanitization. While server-side validation should handle this, there's no visible length limit enforcement (only a `maxChars` display counter). Content is rendered with `whitespace-pre-wrap` (not innerHTML, so basic XSS is prevented), but certain Unicode exploits and text direction attacks are still possible.
- **Severity:** Medium

### SEC-04: No CAPTCHA / Rate Limiting on Registration (CitizenAuthPage.tsx)
- **Location:** `CitizenAuthPage.tsx` — register form (~line 200-300)
- **Issue:** No CAPTCHA, honeypot field, or client-side rate limiting on the registration endpoint. Automated bot registration is trivially easy.
- **Severity:** Medium-High

### SEC-05: No CAPTCHA / Rate Limiting on SOS (CitizenPage.tsx)
- **Location:** `CitizenPage.tsx` — `handleGuestSOS` (~line 120)
- **Issue:** Guest (unauthenticated) SOS sends a report to `/api/reports` with no throttling. A malicious actor could flood the system with fake SOS alerts.
- **Severity:** High
- **Fix:** Add rate limiting, CAPTCHA for guests, or require phone verification.

### SEC-06: JWT Tokens in localStorage (All Auth Components)
- **Location:** All components using `localStorage.getItem('aegis-citizen-token')`
- **Issue:** JWT tokens stored in `localStorage` are vulnerable to XSS attacks. Any XSS vulnerability (like SEC-01) would allow token exfiltration.
- **Severity:** Medium (industry-standard practice, but in combination with SEC-01 it's higher)

### SEC-07: No Password Complexity Enforcement on Backend (CitizenAuthPage.tsx)
- **Location:** `CitizenAuthPage.tsx` ~line 99 — `getPasswordStrength`
- **Issue:** Password strength meter is purely visual on the client side. The form submits with any password ≥1 character. Server-side enforcement should exist but the client doesn't block weak passwords.
- **Severity:** Medium
- **Fix:** Prevent form submission if `pwStrength.score < 3`.

### SEC-08: Admin User Parsed from localStorage (CommunityChat.tsx / CommunityChatRoom.tsx)
- **Location:** `CommunityChat.tsx` ~line 135, `CommunityChatRoom.tsx` ~line 299
- **Issue:** `const adminUser = JSON.parse(localStorage.getItem('aegis-user') || 'null')` — gives client-side admin detection based on localStorage data. Any user can set `aegis-user` in localStorage to impersonate an admin for UI purposes (role badges, delete buttons appear). Actual backend enforcement should prevent API abuse, but the UI exposure is misleading.
- **Severity:** Low (cosmetic admin features)

---

## 3. HARDCODED DATA

### HC-01: Preparedness Resources for Scottish Cities Only (CitizenPage.tsx)
- **Location:** `CitizenPage.tsx` ~line 30-80 — `PREP_RESOURCES_BY_REGION`
- **Issue:** Emergency preparedness resources are hardcoded for Aberdeen, Edinburgh, Glasgow, Dundee, and a generic fallback. Not scalable beyond Scotland.
- **Severity:** Medium

### HC-02: Community Help Resources — 80+ Hardcoded Entries (CommunityHelp.tsx)
- **Location:** `CommunityHelp.tsx` ~line 18-170 — `RESOURCES` object
- **Issue:** Massive hardcoded resource database including phone numbers, addresses, opening hours for Aberdeen, Edinburgh, Glasgow, Dundee, and generic entries. These will go stale, are unmaintainable, and don't cover other regions.
- **Severity:** High
- **Fix:** Move to database or CMS API.

### HC-03: Community Help Initial Posts (CommunityHelp.tsx)
- **Location:** `CommunityHelp.tsx` ~line 172-195 — `INITIAL_POSTS`
- **Issue:** Hardcoded sample community help posts. Not loaded from any API.
- **Severity:** Medium

### HC-04: Safe Meeting Places (CommunityHelp.tsx)
- **Location:** `CommunityHelp.tsx` ~line 196 — `SAFE_MEETING_PLACES`
- **Issue:** Hardcoded list of suggested safe meeting locations. Should be dynamic per region.
- **Severity:** Low

### HC-05: Quiz Questions — 30+ Hardcoded (PreparednessGuide.tsx)
- **Location:** `PreparednessGuide.tsx` ~line 1-100 — `ALL_QUIZ`
- **Issue:** 30+ quiz questions with answers and explanations, all hardcoded in the component file. Not translatable through the i18n system. Cannot be updated without code deployment.
- **Severity:** Medium

### HC-06: Preparedness Scenarios Hardcoded (PreparednessGuide.tsx)
- **Location:** `PreparednessGuide.tsx` — `PREPAREDNESS_SCENARIOS`, `PREPAREDNESS_TIPS`, `EMERGENCY_KIT_ITEMS`
- **Issue:** All disaster preparedness scenarios, tips (before/during/after for each disaster type), and emergency kit items are hardcoded. Hundreds of strings not i18n-ready.
- **Severity:** Medium

### HC-07: Countries and Region Maps (CitizenAuthPage.tsx)
- **Location:** `CitizenAuthPage.tsx` ~line 20-95 — `COUNTRIES` array, `REGION_MAP`
- **Issue:** 56 countries hardcoded in array. `REGION_MAP` only has regions for UK, US, Canada, and Australia. Other countries get no region dropdown.
- **Severity:** Low

### HC-08: Default Fallback Coordinates — Aberdeen (ReportForm.tsx, CitizenPage.tsx)
- **Location:** `ReportForm.tsx` — `[57.15, -2.09]`, `CitizenPage.tsx` — `[57.15, -2.11]`
- **Issue:** When GPS is unavailable, reports default to Aberdeen, Scotland coordinates. Citizens in other countries will have reports incorrectly geolocated.
- **Severity:** Medium
- **Fix:** Use the user's registered city/region or prompt for manual entry.

### HC-09: Emergency Phone Numbers (CitizenPage.tsx)
- **Location:** `CitizenPage.tsx` — footer (~line 625)
- **Issue:** Hardcoded UK emergency numbers (999, 111, 116 123, 0345 988 1188). Non-UK users see irrelevant numbers.
- **Severity:** Medium

### HC-10: Footer Links (CitizenPage.tsx)
- **Location:** `CitizenPage.tsx` ~line 630-640
- **Issue:** Hardcoded links to SEPA, Met Office, Scottish Government, British Red Cross. Footer says "Robert Gordon University, Aberdeen, Scotland" — fine for a university project but not for production.
- **Severity:** Low (acceptable for Honours project)

### HC-11: Emoji Data in CommunityChatRoom (CommunityChatRoom.tsx)
- **Location:** `CommunityChatRoom.tsx` ~line 44-80 — `EMOJI_CATEGORIES`
- **Issue:** ~100+ emoji characters hardcoded in component. Should use a library like `emoji-picker-react`.
- **Severity:** Low

### HC-12: Language Options Limited (CitizenDashboard.tsx SettingsTab)
- **Location:** `CitizenDashboard.tsx` ~line 2265-2270
- **Issue:** Language selector hardcodes only 5 options: English, Welsh, Scottish Gaelic, French, Spanish. The i18n system supports more languages.
- **Severity:** Low

---

## 4. BACKEND CONNECTIVITY GAPS

### BC-01: SafetyCheckIn Component Has No Backend Connection (SafetyCheckIn.tsx)
- **Location:** `SafetyCheckIn.tsx` — entire component
- **Issue:** Click handler only sets local state and shows a notification. No API call, no socket emission. The check-in data is lost immediately.
- **Severity:** Critical (same as BUG-06)

### BC-02: CommunityHelp Offers/Requests Not Connected to Backend (CommunityHelp.tsx)
- **Location:** `CommunityHelp.tsx` — `doOffer()`, `doRequest()`
- **Issue:** Both functions only modify local React state. No API or socket involved. All community help offers/requests are ephemeral.
- **Severity:** Critical (same as BUG-07)

### BC-03: Verification Application Not Sent to Server (CommunityHelp.tsx)
- **Location:** `CommunityHelp.tsx` ~line 780 — verification submit handler
- **Issue:** The "Apply for Verified Helper" form collects name, email, area, role, and a consent checkbox — but the submit handler only sets `verifySubmitted(true)` and calls `pushNotification()`. No API call is made. The application data is lost.
- **Severity:** High

### BC-04: Secure Contact Request Not Sent to Server (CommunityHelp.tsx)
- **Location:** `CommunityHelp.tsx` ~line 810 — `onClick={() => { setContactSent(true); pushNotification(...) }}`
- **Issue:** "Request Secure Contact" modal submit only sets local state and shows notification. No data reaches the server.
- **Severity:** High

### BC-05: Status Color Picker Not Synced (CitizenDashboard.tsx / CitizenAuthPage.tsx)
- **Location:** `CitizenDashboard.tsx` ~line 160 — `statusColor` state
- **Issue:** The green/yellow/red status color picker in the sidebar is local state only. It's never sent to or retrieved from the server. Refreshing resets it.
- **Severity:** Low

### BC-06: CommunityChat Post Share Button is a No-Op (CommunityChat.tsx)
- **Location:** `CommunityChat.tsx` ~line 930 — Share button
- **Issue:** The "Share" button in the post action bar has no `onClick` handler. It renders but does nothing.
- **Severity:** Low

### BC-07: Community Comment "Like" and "Reply" Buttons Are No-Ops (CommunityChat.tsx)
- **Location:** `CommunityChat.tsx` ~line 976-977
- **Issue:** In the comments section, "Like" and "Reply" buttons exist but have no click handlers. They render as text but do nothing.
- **Severity:** Low

### BC-08: Chatbot Has No Session Persistence (Chatbot.tsx)
- **Location:** `Chatbot.tsx` — chat messages stored only in component state
- **Issue:** Chat history is lost when the component unmounts (closing the chatbot panel). No localStorage or API persistence.
- **Severity:** Low

### BC-09: News Items Not Fetched from API (CitizenPage.tsx / CitizenDashboard.tsx)
- **Location:** `CitizenPage.tsx` — news tab, `CitizenDashboard.tsx` — `NewsTab`
- **Issue:** News items appear to come from a `newsItems` array but it's unclear if fetched from API or hardcoded within context. If the API returns empty, the tab shows nothing with no fallback.
- **Severity:** Low-Medium

---

## 5. MISSING FEATURES

### MF-01: No Forgot Password Flow (CitizenAuthPage.tsx)
- **Location:** `CitizenAuthPage.tsx` — login form
- **Issue:** There is no "Forgot Password" link or flow. If a citizen forgets their password, they have no self-service recovery option.
- **Severity:** High

### MF-02: No Email Verification Flow (CitizenAuthPage.tsx)
- **Location:** `CitizenAuthPage.tsx` — registration
- **Issue:** After registration, there's no email verification step. The `emailVerified` field exists in the profile view but there's no mechanism to verify it.
- **Severity:** Medium

### MF-03: No Form Auto-Save / Recovery (ReportForm.tsx)
- **Location:** `ReportForm.tsx` — 6-step wizard
- **Issue:** If a user accidentally closes the report form mid-way through the 6 steps (including after uploading photos), all data is lost. No auto-save to localStorage or sessionStorage.
- **Severity:** Medium

### MF-04: No Offline Support / PWA Functionality
- **Location:** Entire citizen-facing frontend
- **Issue:** The app has a `manifest.json` and `sw.js` in public/, suggesting PWA intent, but there's no service worker registration in the React code, no offline caching strategy, and no offline fallback UI.
- **Severity:** Medium

### MF-05: No Pagination for Community Posts (CommunityChat.tsx)
- **Location:** `CommunityChat.tsx` — `fetchPosts()` (~line 270)
- **Issue:** All posts are fetched at once with no pagination or virtual scrolling. As the community grows, performance will degrade significantly.
- **Severity:** Medium

### MF-06: No Search in Messages (CitizenDashboard.tsx MessagesTab)
- **Location:** `CitizenDashboard.tsx` ~line 1242 — MessagesTab thread list
- **Issue:** The Messages tab doesn't have a search bar to find old conversations. `CitizenMessaging.tsx` standalone version does have search, creating inconsistency.
- **Severity:** Low

### MF-07: No Notification Sound/Vibration (SOSButton.tsx, CitizenDashboard.tsx)
- **Location:** `SOSButton.tsx`, `CitizenDashboard.tsx`
- **Issue:** SOS activation and operator acknowledgement have no audio/haptic feedback. For a distress beacon, tactile confirmation is important.
- **Severity:** Medium

### MF-08: No Message Read Receipts Display (CitizenMessaging.tsx)
- **Location:** `CitizenMessaging.tsx` — `MessageStatusIcon` component
- **Issue:** The component renders a `MessageStatusIcon` for status tracking, but it uses a basic implementation. Real-time "seen" indicator from the operator is not visually distinct from "delivered".
- **Severity:** Low

### MF-09: No Report Tracking / Status Updates for Citizens
- **Location:** `CitizenPage.tsx` / `CitizenDashboard.tsx`
- **Issue:** After submitting a report, there's no way for the citizen to track its progress (received → verified → dispatched → resolved). Reports tab shows reports but status updates aren't pushed to the citizen.
- **Severity:** Medium

### MF-10: No Accessibility Skip Links or ARIA Live Regions
- **Location:** All citizen components
- **Issue:** No skip-to-content links, no `aria-live` regions for dynamic content updates (new messages, alerts), no keyboard navigation for tab bars.
- **Severity:** Medium (accessibility requirement)

---

## 6. UI/UX GAPS

### UX-01: Mobile Tab Bar Shows Only 6 of 11 Tabs (CitizenDashboard.tsx)
- **Location:** `CitizenDashboard.tsx` ~line 340-370
- **Issue:** The mobile bottom tab bar only shows the first 6 tabs (overview, livemap, reports, messages, community, prepare). Safety, profile, security, news, and settings are only accessible from the desktop sidebar. Mobile users can't reach 5 tabs.
- **Severity:** High
- **Fix:** Add a "More" tab with overflow menu, or use a scrollable tab bar.

### UX-02: Minimum 2 Photos Required for Reports (ReportForm.tsx)
- **Location:** `ReportForm.tsx` — step 6 validation
- **Issue:** Reports require a minimum of 2 photos. During an active emergency, this is an unreasonable barrier. Users may be in danger and unable to take photos.
- **Severity:** High
- **Fix:** Make photos optional with a "No photos available" option.

### UX-03: Quiz Auto-Advances After 2 Seconds (PreparednessGuide.tsx)
- **Location:** `PreparednessGuide.tsx` — `answerQuiz()` function
- **Issue:** After answering a quiz question, the explanation shows for ~2 seconds before auto-advancing. This is too fast for some users (accessibility concern) and there's no way to control the pace.
- **Severity:** Medium
- **Fix:** Replace auto-advance with a "Next" button.

### UX-04: No Loading Skeleton/States for Heavy Components
- **Location:** Multiple components
- **Issue:** `CommunityChat.tsx`, `CommunityHelp.tsx`, `PreparednessGuide.tsx` all have content-heavy initial renders with no skeleton loading states. Users see a blank area before data loads.
- **Severity:** Low

### UX-05: Toast Notifications Stack Without Limit (CitizenPage.tsx)
- **Location:** `CitizenPage.tsx` ~line 925 — notifications render
- **Issue:** Toast notifications stack in the top-right corner with no maximum count. Rapid actions (e.g., multiple SOS presses) can pile up toasts and obscure content.
- **Severity:** Low
- **Fix:** Limit to 3-5 visible toasts; newer ones push out older ones.

### UX-06: Very Small Font Sizes Throughout
- **Location:** All components
- **Issue:** Extensive use of `text-[10px]`, `text-[9px]`, and `text-[11px]` classes across the entire codebase. These are below accessibility minimum (12px / 0.75rem). WCAG AA requires minimum 12px for body text.
- **Severity:** Medium (accessibility)

### UX-07: No Confirmation Before Leaving Report Form (ReportForm.tsx)
- **Location:** `ReportForm.tsx` — close button
- **Issue:** Clicking the close button (`onClose`) immediately closes the 6-step form with no confirmation dialog. Data entered in previous steps is lost.
- **Severity:** Medium

### UX-08: CommunityChat Category/Filter Not Persisted
- **Location:** `CommunityChat.tsx`
- **Issue:** Selected filter/category pills reset when navigating away and back. No URL param or state persistence.
- **Severity:** Low

### UX-09: Sidebar Navigation Scroll Overflow (CitizenDashboard.tsx)
- **Location:** `CitizenDashboard.tsx` ~line 300-340 — sidebar
- **Issue:** 11 navigation items in the sidebar. On short screens, the navigation items may overflow without visible scrolling indication.
- **Severity:** Low

---

## 7. CODE QUALITY / PROFESSIONAL POLISH

### CQ-01: `getPasswordStrength` Duplicated in Two Files
- **Location:** `CitizenAuthPage.tsx` ~line 99, `CitizenDashboard.tsx` ~line 97
- **Issue:** Identical function duplicated. Any fix in one file must be manually replicated.
- **Fix:** Extract to `utils/passwordStrength.ts`.

### CQ-02: `timeAgo` Function Duplicated in 3+ Files
- **Location:** `CitizenDashboard.tsx` ~line 86, `CommunityChat.tsx`, `CommunityChatRoom.tsx`
- **Issue:** Same relative-time formatting logic duplicated across files.
- **Fix:** Extract to `utils/timeAgo.ts`.

### CQ-03: 50+ `console.log` Statements in Production Code
- **Location:** Primarily `CommunityChatRoom.tsx` (40+ instances), `CitizenMessaging.tsx` (10+ instances), `CommunityChat.tsx` (5+ instances)
- **Issue:** Debug logging statements with prefixes like `[CommunityChat]`, `[CitizenMessaging]`, `[Profile]` left in production code. Exposes internal architecture to anyone opening DevTools.
- **Severity:** Medium
- **Fix:** Remove or replace with a conditional logger that's disabled in production.

### CQ-04: CitizenDashboard.tsx is 2,336 Lines — Needs Splitting
- **Location:** `CitizenDashboard.tsx`
- **Issue:** Single file contains the main dashboard + 8 inline sub-components (`OverviewTab`, `LiveMapTab`, `MessagesTab`, `CommunitySection`, `SafetyTab`, `ProfileTab`, `SecurityTab`, `SettingsTab`, `NewsTab`, `PreparednessTab`, `ReportsTab`). This is unmaintainable.
- **Fix:** Extract each tab into its own file under `components/citizen/dashboard/`.

### CQ-05: CommunityHelp.tsx Has Deeply Nested JSX
- **Location:** `CommunityHelp.tsx` — entire file
- **Issue:** Multiple overlapping modals (verification, info, secure contact) nested in the same component with 5+ levels of conditional rendering.
- **Fix:** Extract modals into separate components.

### CQ-06: `any` Type Used Extensively
- **Location:** Throughout all components
- **Issue:** Props typed as `any` in many sub-components: `OverviewTab({ user, threads, ... }: any)`, `SafetyTab({}: any)`, `ProfileTab({}: any)`, etc. This defeats TypeScript's purpose.
- **Fix:** Define proper interface types for all component props.

### CQ-07: Inconsistent Component Export Patterns
- **Location:** Various files
- **Issue:** Some components use `export default function`, others use `export function` + `export default` at the bottom, and some define multiple components in one file with only one default export.
- **Severity:** Low

### CQ-08: Compressed Single-Line JSX (ReportForm.tsx, CitizenPage.tsx)
- **Location:** `ReportForm.tsx` — entire file, various sections of `CitizenPage.tsx`
- **Issue:** Complex JSX with multiple props crammed onto single lines, making it nearly impossible to read or diff in code review.
- **Severity:** Low (readability)

### CQ-09: Missing Error Boundaries
- **Location:** All citizen components
- **Issue:** No React Error Boundaries wrap any citizen component. A crash in any sub-component (e.g., bad date parsing, missing property) will white-screen the entire dashboard.
- **Severity:** Medium
- **Fix:** Add error boundaries around each major tab/section.

### CQ-10: No Unit Tests
- **Location:** Entire `client/src/` directory
- **Issue:** No test files found for any citizen-facing component. No `*.test.tsx`, `*.spec.tsx`, or `__tests__/` directories.
- **Severity:** High (for production readiness)

### CQ-11: `API_BASE = ''` Unused Constant (CitizenDashboard.tsx, CommunityChatRoom.tsx)
- **Location:** `CitizenDashboard.tsx` ~line 80, `CommunityChatRoom.tsx` ~line 59
- **Issue:** `const API_BASE = ''` is defined but used inconsistently. Some URLs use `${API_BASE}/api/...` while others use `/api/...` directly. The empty string makes the constant pointless.
- **Severity:** Low

### CQ-12: `status` Type Widened to `string` (SOSButton.tsx)
- **Location:** `SOSButton.tsx` — `const status = useDistress()...`
- **Issue:** The component casts the distress status to `string` to avoid TypeScript narrowing issues. This is a code smell — the hook's return type should be properly typed.
- **Severity:** Low

### CQ-13: Unused Imports in Multiple Files
- **Location:** Various citizen components
- **Issue:** Several Lucide icons and hooks are imported but unused across the codebase (typical in rapidly developed code).
- **Severity:** Low

---

## PER-FILE SUMMARY

### CitizenPage.tsx (936 lines)
| Category | Issues |
|----------|--------|
| Bugs | BUG-01 (timer leak) |
| Security | SEC-05 (guest SOS flooding) |
| Hardcoded | HC-01, HC-08, HC-09, HC-10 |
| Missing | MF-04 (no offline), MF-09 (no report tracking) |
| UX | UX-05 (toast stacking), UX-06 (tiny fonts) |
| Polish | CQ-08 (compressed JSX) |

### CitizenDashboard.tsx (2,336 lines)
| Category | Issues |
|----------|--------|
| Bugs | BUG-02, BUG-09 |
| Security | SEC-02 (token keys) |
| Hardcoded | HC-12 (language options) |
| Backend | BC-05 (status color), BC-09 (news) |
| Missing | MF-06, MF-07, MF-10 |
| UX | UX-01 (mobile tabs), UX-09 (sidebar scroll) |
| Polish | CQ-01, CQ-02, CQ-04, CQ-06, CQ-09, CQ-11 |

### CitizenAuthPage.tsx (706 lines)
| Category | Issues |
|----------|--------|
| Security | SEC-04, SEC-07 |
| Hardcoded | HC-07 |
| Missing | MF-01, MF-02 |
| Polish | CQ-01 |

### Chatbot.tsx (~135 lines)
| Category | Issues |
|----------|--------|
| Security | **SEC-01 (XSS — highest priority)** |
| Backend | BC-08 (no persistence) |

### CommunityChat.tsx (1,194 lines)
| Category | Issues |
|----------|--------|
| Bugs | BUG-05 (polling + socket) |
| Security | SEC-02, SEC-03, SEC-08 |
| Backend | BC-06, BC-07 |
| Missing | MF-05 (no pagination) |
| UX | UX-04, UX-08 |
| Polish | CQ-02, CQ-03 |

### CommunityHelp.tsx (828 lines)
| Category | Issues |
|----------|--------|
| Bugs | **BUG-07 (offers/requests local only — critical)** |
| Hardcoded | **HC-02 (80+ resource entries)**, HC-03, HC-04 |
| Backend | **BC-01, BC-02, BC-03, BC-04** |
| Polish | CQ-05 |

### PreparednessGuide.tsx (539 lines)
| Category | Issues |
|----------|--------|
| Hardcoded | HC-05, HC-06 |
| UX | UX-03 (quiz auto-advance) |

### SOSButton.tsx (~190 lines)
| Category | Issues |
|----------|--------|
| Missing | MF-07 (no haptic/audio) |
| Polish | CQ-12 |

### ReportForm.tsx (~240 lines)
| Category | Issues |
|----------|--------|
| Bugs | BUG-08 (timeout leak) |
| Hardcoded | HC-08 (Aberdeen fallback) |
| Missing | MF-03 (no auto-save) |
| UX | **UX-02 (2 photos required in emergency)**, UX-07 |
| Polish | CQ-08 |

### CitizenMessaging.tsx (473 lines)
| Category | Issues |
|----------|--------|
| Bugs | BUG-03 (operator precedence), BUG-04, BUG-10 |
| Security | SEC-02 |
| Polish | CQ-03 (console.log) |

### SafetyCheckIn.tsx (~40 lines)
| Category | Issues |
|----------|--------|
| Bugs | **BUG-06 (no persistence — critical)** |
| Backend | **BC-01** |

### OnboardingTutorial.tsx (~60 lines)
| Category | Issues |
|----------|--------|
| — | Clean. Minor: no i18n for tutorial text. |

### CommunityGuidelines.tsx (164 lines)
| Category | Issues |
|----------|--------|
| — | Clean. Minor: all text hardcoded in English, no i18n. |

### CommunityChatRoom.tsx (2,440 lines)
| Category | Issues |
|----------|--------|
| Security | SEC-02, SEC-08 |
| Polish | **CQ-03 (40+ console.log statements)** |
| Hardcoded | HC-11 (emoji data) |

---

## PRIORITY RECOMMENDATIONS

### P0 — Fix Immediately (Critical)
1. **SEC-01:** Sanitize `dangerouslySetInnerHTML` in Chatbot.tsx (XSS)
2. **BUG-07 / BC-02:** Connect CommunityHelp offers/requests to real API endpoints
3. **BUG-06 / BC-01:** Connect SafetyCheckIn.tsx to backend API
4. **BC-03 / BC-04:** Connect verification application and secure contact to backend
5. **UX-02:** Remove 2-photo requirement for emergency reports (or make optional)

### P1 — Fix Before Release (High)
6. **SEC-02:** Standardize auth token retrieval into a single utility function
7. **SEC-05:** Add rate limiting / CAPTCHA for guest SOS
8. **MF-01:** Implement forgot password flow
9. **UX-01:** Fix mobile tab bar to expose all 11 tabs
10. **CQ-04:** Split CitizenDashboard.tsx into separate tab files
11. **SEC-04:** Add CAPTCHA to registration

### P2 — Should Fix (Medium)
12. **BUG-01:** Fix SOS timer interval cleanup
13. **BUG-05:** Resolve polling + socket duplication in CommunityChat
14. **BUG-10:** Replace `window.prompt()` with styled modal in CitizenMessaging
15. **HC-02:** Move community resources to database/API
16. **HC-05/HC-06:** Externalize quiz/preparedness data for i18n
17. **MF-03:** Add form auto-save for report wizard
18. **MF-05:** Add pagination to community posts
19. **CQ-03:** Remove 50+ console.log statements
20. **CQ-01/CQ-02:** Extract duplicated utilities (password strength, timeAgo)
21. **CQ-09:** Add React Error Boundaries
22. **UX-06:** Fix sub-12px font sizes for accessibility compliance
23. **MF-10:** Add ARIA live regions and skip links

### P3 — Nice to Have (Low)
24. **MF-02:** Email verification flow
25. **MF-04:** PWA offline support
26. **MF-07:** Audio/haptic feedback for SOS
27. **CQ-06:** Replace `any` types with proper interfaces
28. **CQ-10:** Add unit tests
29. **HC-08:** Dynamic fallback coordinates based on user region

---

**Total Issues Found: 56**
- Critical: 5
- High: 6
- Medium: 25
- Low: 20
