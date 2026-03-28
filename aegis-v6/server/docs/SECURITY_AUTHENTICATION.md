# AEGIS Authentication & Security Architecture

## Overview

AEGIS implements enterprise-grade authentication security across all user types (Citizens and Operators). This document covers the security architecture, configuration, and operational procedures.


## 1. Password Security

### Policy
| Rule | Value |
|------|-------|
| Minimum length | **12 characters** |
| Uppercase required | ≥ 1 character |
| Lowercase required | ≥ 1 character |
| Digit required | ≥ 1 character |
| Special character required | ≥ 1 character |
| Common password rejection | Top 100 blacklisted |
| Email-based rejection | Cannot contain email prefix |
| History depth | Last **5 passwords** cannot be reused |

### Hashing
- **Algorithm:** bcrypt with 12 salt rounds
- **Password history:** Stored in `password_history` table (bcrypt hashes)
- **Comparison:** bcrypt constant-time comparison


## 2. Account Lockout

| Parameter | Value |
|-----------|-------|
| Max failed attempts | **5** |
| Lockout duration | **15 minutes** |
| Reset on success | Yes — counter resets to 0 |
| Notification | Email sent on lockout |

Lockout state is stored per-user in `failed_login_attempts` and `locked_until` columns on both `citizens` and `operators` tables.


## 3. Email Verification

### Flow
1. User registers → server generates 32-byte random token
2. Token is **SHA-256 hashed** before storage (`verification_token_hash` column)
3. Raw token is sent to user's email (or logged in dev mode)
4. User clicks link → server hashes submitted token and compares against DB
5. Token expires after **24 hours** (`verification_expires` column)

### Dev Mode
- **`EMAIL_MODE=dev`** (default): Emails are logged to console and stored in `dev_emails` table
- **`EMAIL_MODE=production`**: Emails sent via SMTP (nodemailer)

To view dev emails:
```sql
SELECT * FROM dev_emails ORDER BY created_at DESC LIMIT 20;
```

### Switching to Production
Set these environment variables:
```env
EMAIL_MODE=production
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password
SMTP_FROM=noreply@aegis.gov.uk
```


## 4. JWT Token Architecture

### Access Tokens
| Property | Value |
|----------|-------|
| Algorithm | HS256 (HMAC-SHA256) |
| Expiry | **15 minutes** |
| Storage | Client memory (never localStorage) |
| Contains | user id, email, role, displayName, department |

### Refresh Tokens
| Property | Citizens | Operators |
|----------|----------|-----------|
| Expiry | **7 days** | **30 days** |
| Storage | `httpOnly` cookie (`aegis_refresh`) |
| Path | `/api/citizen-auth` | `/api/auth` |
| Rotation | Yes — new token on each refresh |
| DB tracking | `user_sessions` table |

### Token Rotation
Each `/refresh` call:
1. Validates the old refresh token against `user_sessions`
2. Revokes the old session
3. Issues a new access token + new refresh token
4. Creates a new session record

This prevents token replay attacks — a stolen refresh token can only be used once.

### Session Revocation
On password change or reset, **all sessions are revoked** (`revokeAllSessions`), forcing re-login on all devices.


## 5. Session Management

Sessions are tracked in the `user_sessions` table:

| Column | Purpose |
|--------|---------|
| `refresh_token_hash` | SHA-256 hash of the refresh token |
| `ip_address` | Client IP at session creation |
| `user_agent` | Browser/client identifier |
| `created_at` | Session start time |
| `last_used_at` | Last token refresh time |
| `expires_at` | Absolute session expiry |
| `revoked` | Whether session has been revoked |
| `revoked_reason` | Why (logout, password_changed, rotated, etc.) |


## 6. CSRF Protection

Uses the **Double-Submit Cookie** pattern:

1. Server sets `aegis_csrf` cookie (readable by JavaScript, `httpOnly=false`, `sameSite=lax`)
2. Client reads the cookie and includes it in `X-CSRF-Token` header
3. Server compares cookie value with header value
4. Mismatch → 403 Forbidden (production only; dev mode warns but allows)

Exempt paths: `/api/internal/`, `/api/telegram/`, `/api/map-tiles/`


## 7. Rate Limiting

| Endpoint | Limit |
|----------|-------|
| Global | 600 req/min per IP |
| Login (citizen + operator) | 50 req/hr per IP |
| Registration | 10 req/hr per IP |
| Password reset | 5 req/hr per IP |
| Password change | 10 req/15min per IP |
| Resend verification | 3 req/hr per IP |


## 8. Security Event Logging

All authentication events are recorded in the `security_events` table:

| Event Type | Trigger |
|------------|---------|
| `login_success` | Successful authentication |
| `login_failed` | Wrong password or unknown email |
| `account_locked` | Lockout threshold reached |
| `register` | New account created |
| `email_verified` | Email verification completed |
| `email_verification_sent` | Verification email dispatched |
| `password_changed` | User changed their password |
| `password_reset_requested` | Reset link generated |
| `password_reset_completed` | Password reset via token |
| `session_created` | New refresh token issued |
| `session_revoked` | Individual session revoked |
| `session_revoked_all` | All sessions revoked |
| `logout` | User logged out |
| `suspicious_activity` | Anomalous pattern detected |

### Suspicious Activity Detection
Automatically flags:
- **5+ failed logins from different IPs** for the same account (1h window)
- **20+ failed logins from the same IP** across any accounts (1h window → credential stuffing)


## 9. Security Headers

Configured via Helmet:

| Header | Value |
|--------|-------|
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` |
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `DENY` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |


## 10. RBAC (Role-Based Access Control)

### Citizen Roles
- `citizen` — Standard citizen access

### Operator Roles
- `admin` — Full system access
- `operator` — Standard operator access
- `viewer` — Read-only dashboard access

### Middleware
- `authMiddleware` — Requires valid JWT
- `requireRole('admin', 'operator')` — Role whitelist
- `citizenOnly` — Only citizens
- `operatorOnly` — Only admin/operator/manager
- `requireVerifiedEmail` — Requires verified email (checks appropriate table by role)


## 11. Database Tables (Security)

| Table | Purpose |
|-------|---------|
| `password_history` | Stores last N password hashes per user |
| `user_sessions` | Tracks active refresh tokens |
| `security_events` | Immutable audit log |
| `dev_emails` | Development email capture |
| `password_reset_tokens` | Operator password reset tokens (SHA-256) |


## 12. Environment Variables

### Required in Production
```env
JWT_SECRET=<64+ char random string>
REFRESH_TOKEN_SECRET=<64+ char random string>
INTERNAL_API_KEY=<32+ char random string>
N8N_WEBHOOK_SECRET=<32+ char random string>
DATABASE_URL=postgresql://...
```

### Email Configuration
```env
EMAIL_MODE=dev|production
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password
SMTP_FROM=noreply@aegis.gov.uk
SMTP_FROM_NAME=AEGIS Platform
CLIENT_URL=http://localhost:5173
```


## 13. Migration

Run the security migration:
```sql
\i server/sql/migration_auth_security.sql
```

This adds:
- Lockout columns to `citizens` and `operators`
- Email verification columns to `operators`
- Hashed verification columns to `citizens`
- `password_history`, `user_sessions`, `security_events`, `dev_emails` tables


## 14. Maintenance

### Cleanup (recommended CRON or scheduled task)
```sql
-- Purge expired sessions (older than 30 days past expiry)
DELETE FROM user_sessions WHERE expires_at < NOW() - INTERVAL '30 days';

-- Purge old security events (older than 90 days)
DELETE FROM security_events WHERE created_at < NOW() - INTERVAL '90 days';

-- Purge dev emails (older than 7 days)
DELETE FROM dev_emails WHERE created_at < NOW() - INTERVAL '7 days';
```

