# 🚨 AEGIS Multi-Channel Notification System - Complete Setup Guide

This guide will walk you through setting up **all 5 notification channels** (Email, SMS, WhatsApp, Telegram, Web Push) for the AEGIS v6 emergency management system.

## 📋 Table of Contents

1. [Quick Start](#quick-start)
2. [Channel Setup](#channel-setup)
   - [Email (SMTP)](#1-email-smtp)
   - [SMS (Twilio)](#2-sms-twilio)
   - [WhatsApp (Twilio)](#3-whatsapp-twilio)
   - [Telegram Bot](#4-telegram-bot)
   - [Web Push (VAPID)](#5-web-push-vapid)
3. [Database Setup](#database-setup)
4. [Testing](#testing)
5. [Troubleshooting](#troubleshooting)

---

## Quick Start

1. **Copy environment template**

   ```bash
   cd server
   cp .env.example .env
   ```

2. **Generate VAPID keys for Web Push**

   ```bash
   npx tsx src/utils/generateVapidKeys.ts
   ```

3. **Run database migrations**

   ```bash
   # Using psql (ensure PostgreSQL is running)
   psql -U postgres -d aegis_v6 -f sql/migration_web_push.sql
   ```

4. **Configure at least one channel** (see sections below)

5. **Start the server**
   ```bash
   npm run start
   ```

---

## Channel Setup

### 1. Email (SMTP)

**Recommended Provider:** Gmail (free), SendGrid, AWS SES, or any SMTP server

#### Option A: Gmail (Easiest)

1. **Enable 2-Factor Authentication** on your Google account
2. **Generate App Password:**
   - Go to https://myaccount.google.com/apppasswords
   - Select "Mail" and your device
   - Copy the 16-character password

3. **Update `.env`:**
   ```env
   SMTP_HOST=smtp.gmail.com
   SMTP_PORT=587
   SMTP_SECURE=false
   SMTP_USER=your-email@gmail.com
   SMTP_PASS=your-16-char-app-password
   SMTP_FROM=alerts@aegis.gov.uk
   SMTP_FROM_NAME=AEGIS Alert System
   ```

#### Option B: SendGrid (Production)

1. Sign up at https://sendgrid.com/
2. Create an API key
3. Update `.env`:
   ```env
   SMTP_HOST=smtp.sendgrid.net
   SMTP_PORT=587
   SMTP_SECURE=false
   SMTP_USER=apikey
   SMTP_PASS=SG.your_actual_sendgrid_api_key
   ```

**Test Command:**

```bash
curl -X POST http://localhost:3001/api/subscriptions \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","channels":["email"]}'
```

---

### 2. SMS (Twilio)

**Cost:** ~$0.0075 per SMS (pay-as-you-go)

1. **Sign up** at https://www.twilio.com/try-twilio (free trial gives $15 credit)
2. **Get credentials:**
   - Account SID: Find on Twilio Console dashboard
   - Auth Token: Click "Show" next to Auth Token
   - Phone Number: Get a number from Phone Numbers → Buy a Number

3. **Update `.env`:**

   ```env
   TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   TWILIO_AUTH_TOKEN=your_auth_token_here
   TWILIO_PHONE_NUMBER=+441234567890
   ```

4. **Phone Number Format:**
   - Must use E.164 format: `+447700900123` (UK), `+14155552671` (US)
   - The system will validate and normalize numbers automatically

**Test Command:**

```bash
curl -X POST http://localhost:3001/api/subscriptions \
  -H "Content-Type: application/json" \
  -d '{"phone":"+447700900123","channels":["sms"]}'
```

---

### 3. WhatsApp (Twilio)

**Requirements:** Approved Twilio WhatsApp sender (or use sandbox for testing)

#### Testing (Sandbox - Free)

1. **Enable WhatsApp Sandbox:**
   - Go to Twilio Console → Messaging → Try it out → Try WhatsApp
   - Send "join [your-code]" to the Twilio WhatsApp number from your phone
   - Note the sandbox number (e.g., `whatsapp:+14155238886`)

2. **Update `.env`:**
   ```env
   TWILIO_WHATSAPP_NUMBER=whatsapp:+14155238886
   # (Use the number from Twilio Console)
   ```

#### Production

1. Apply for WhatsApp Business API approval through Twilio
2. Get your approved sender number
3. Update `.env` with your approved number

**Test Command:**

```bash
curl -X POST http://localhost:3001/api/subscriptions \
  -H "Content-Type: application/json" \
  -d '{"whatsapp":"+447700900123","channels":["whatsapp"]}'
```

---

### 4. Telegram Bot

**Cost:** Free!

1. **Create a bot:**
   - Open Telegram and search for `@BotFather`
   - Send `/newbot` and follow instructions
   - Choose a name: e.g., "AEGIS Alert Bot"
   - Choose a username: e.g., `aegis_alerts_bot`
   - Copy the API token (looks like `1234567890:ABCdefGHIjklMNOpqrsTUVwxyz`)

2. **Update `.env`:**

   ```env
   TELEGRAM_BOT_TOKEN=1234567890:ABCdefGHIjklMNOpqrsTUVwxyz
   ```

3. **Get Chat ID (for testing):**
   - Start a chat with your bot
   - Send any message
   - Visit: `https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getUpdates`
   - Find `"chat":{"id":123456789}` in the JSON response

**Test Command:**

```bash
curl -X POST http://localhost:3001/api/subscriptions \
  -H "Content-Type: application/json" \
  -d '{"telegram_id":"123456789","channels":["telegram"]}'
```

---

### 5. Web Push (VAPID)

**Cost:** Free! (uses browser Push API)

1. **Generate VAPID Keys:**

   ```bash
   cd server
   npx tsx src/utils/generateVapidKeys.ts
   ```

2. **Copy output to `.env`:**

   ```env
   VAPID_PUBLIC_KEY=BMlCX3... (your generated public key)
   VAPID_PRIVATE_KEY=OTQyMj... (your generated private key)
   VAPID_SUBJECT=mailto:admin@aegis.gov.uk
   ```

3. **Client-side setup:**
   - The public key is exposed via `/api/notification-status` endpoint
   - Citizens can subscribe via the "Alerts" button on Citizen Page
   - Browser will prompt for notification permission

4. **Testing:**
   - Open Citizen Page → Click "Alerts" button
   - Select "Web" channel
   - Browser should request notification permission
   - Send a test alert from Admin dashboard

**Supported Browsers:**

- ✅ Chrome/Edge 42+
- ✅ Firefox 44+
- ✅ Safari 16+ (macOS Ventura+)
- ❌ iOS Safari (not supported yet)

---

## Database Setup

Run the push subscriptions migration:

```bash
# Using psql
psql -U postgres -d aegis_v6 -f sql/migration_web_push.sql

# Or using your DB tool
# Execute the contents of server/sql/migration_web_push.sql
```

This creates:

- `push_subscriptions` table for storing Web Push subscriptions
- `push_subscription` column in `alert_subscriptions` for anonymous users
- Cleanup function for expired subscriptions

---

## Testing

### 1. Check Service Status

```bash
curl http://localhost:3001/api/notification-status
```

Expected output:

```json
{
  "email": { "enabled": true, "configured": true },
  "sms": { "enabled": true, "configured": true },
  "whatsapp": { "enabled": true, "configured": true },
  "telegram": { "enabled": true, "configured": true },
  "web": { "enabled": true, "configured": true, "publicKey": "BM..." }
}
```

### 2. Test Individual Channels

Create a subscription and send test alert from Admin dashboard:

1. **Start both servers:**

   ```bash
   # Terminal 1
   cd server
   npm run start

   # Terminal 2
   cd client
   npm run dev
   ```

2. **Open Citizen Page:** http://localhost:5173
3. **Subscribe to alerts:**
   - Click "Alerts" button
   - Select channels and enter contact info
   - Click "Subscribe"

4. **Send test alert:**
   - Login to Admin Page (admin@aegis.gov.uk / password)
   - Create or select a report
   - Click "Send Alert"
   - Select channels
   - Check delivery status in response

### 3. Multi-Channel Test

```bash
curl -X POST http://localhost:3001/api/subscriptions \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "phone": "+447700900123",
    "telegram_id": "123456789",
    "channels": ["email", "sms", "telegram", "web"]
  }'
```

---

## Troubleshooting

### Email Not Sending

- **"Auth failed"**: Check SMTP_USER and SMTP_PASS are correct
- **"Timeout"**: Check SMTP_HOST and SMTP_PORT
- **Gmail "Less secure app"**: Use App Password (see Gmail setup)

### SMS/WhatsApp Not Sending

- **"Phone number invalid"**: Must be E.164 format (e.g., `+447700900123`)
- **"Twilio auth failed"**: Check ACCOUNT_SID and AUTH_TOKEN
- **"From number not verified"**: Buy a Twilio number or verify test numbers

### Telegram Not Sending

- **"Bot token invalid"**: Check TELEGRAM_BOT_TOKEN is correct
- **"Chat not found"**: User must start chat with bot first (send any message)

### Web Push Not Working

- **"Subscription failed"**: Check VAPID keys are generated and in .env
- **"No notification"**: Check browser has notification permission
- **Safari**: Requires macOS Ventura+ and Safari 16+

### Phone Validation Errors

The system validates phone numbers in E.164 format:

- ✅ `+447700900123` (UK)
- ✅ `+14155552671` (US)
- ❌ `07700900123` (missing country code)
- ❌ `+44 (0) 7700 900123` (has spaces)

Use the auto-normalization by sending raw numbers - the system will attempt to convert them.

---

## Phone Number Examples

| Country   | Format           | Example       |
| --------- | ---------------- | ------------- |
| UK        | +44 XXXX XXXXXX  | +447700900123 |
| US/Canada | +1 XXX XXX XXXX  | +14155552671  |
| Australia | +61 XXX XXX XXX  | +61412345678  |
| Germany   | +49 XXX XXXXXXXX | +491234567890 |

---

## Environment Variables Reference

Copy this template to your `.env`:

```env
# Database
DATABASE_URL=postgresql://postgres:password@localhost:5432/aegis

# Server
PORT=3001
JWT_SECRET=your-secret-key

# Email (SMTP)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password
SMTP_FROM=alerts@aegis.gov.uk
SMTP_FROM_NAME=AEGIS Alert System

# Twilio (SMS + WhatsApp)
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=your_auth_token_here
TWILIO_PHONE_NUMBER=+441234567890
TWILIO_WHATSAPP_NUMBER=whatsapp:+14155238886

# Telegram Bot
TELEGRAM_BOT_TOKEN=1234567890:ABCdefGHIjklMNOpqrsTUVwxyz

# Web Push (VAPID)
VAPID_PUBLIC_KEY=your-public-key-here
VAPID_PRIVATE_KEY=your-private-key-here
VAPID_SUBJECT=mailto:admin@aegis.gov.uk
```

---

## Production Checklist

- [ ] All credentials in `.env` (not hardcoded)
- [ ] `.env` added to `.gitignore`
- [ ] VAPID keys generated and stored securely
- [ ] Database migrations run
- [ ] Test alert sent to each channel
- [ ] Error handling tested (invalid phones, unsubscribed users)
- [ ] Rate limiting configured (optional)
- [ ] Monitoring/logging set up
- [ ] Backup provider credentials stored securely

---

## Support

- **Email issues**: Check nodemailer docs: https://nodemailer.com/
- **SMS/WhatsApp**: Twilio docs: https://www.twilio.com/docs
- **Telegram**: Bot API: https://core.telegram.org/bots/api
- **Web Push**: MDN Guide: https://developer.mozilla.org/en-US/docs/Web/API/Push_API

---

**Need Help?** Check server logs when sending alerts - they show detailed delivery status for each channel.
