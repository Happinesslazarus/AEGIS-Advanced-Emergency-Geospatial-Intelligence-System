# 🎯 AEGIS v6 - Complete Multi-Channel Setup (All Working!)

## ✅ What's Been Fixed

### 1. **SEPA River Levels** 🌊
- ✅ Updated API endpoints to use working SEPA servers (`www2.sepa.org.uk`)
- ✅ Fixed station data fetching with proper error handling
- ✅ Now shows live river gauge data for Scotland

### 2. **Phone Number Validation with Country Codes** 📞
- ✅ Added country code selector (50+ countries)
- ✅ Auto-formats to E.164 format
- ✅ Shows country flag + example format
- ✅ Validates before sending to server

### 3. **Share & Print on Citizen Page** 📄
- ✅ Hover over any report to see Share & Print buttons
- ✅ Share opens native share dialog (or email fallback)
- ✅ Print generates professional formatted report

### 4. **Multi-Channel Notifications** 🔔
All 5 channels completely implemented and ready:
- ✅ Email (Gmail/SMTP)
- ✅ SMS (Twilio)
- ✅ WhatsApp (Twilio)
- ✅ Telegram Bot
- ✅ Web Push (Browser notifications)

---

## 🚀 Quick Start (15 Minutes to Full Setup)

### Step 1: Install Dependencies

```bash
# Server
cd server
npm install

# Client
cd ../client
npm install
```

### Step 2: Configure Environment

```bash
cd server
cp .env.quickstart .env
# Now edit .env with your credentials (see below)
```

### Step 3: Generate VAPID Keys

```bash
npx tsx src/utils/generateVapidKeys.ts
# Copy the output keys to .env
```

### Step 4: Setup Database

```bash
# Make sure PostgreSQL is running
psql -U postgres -d aegis_v6 -f sql/migration_web_push.sql
```

### Step 5: Start Servers

```bash
# Terminal 1 - Server
cd server
npm run start

# Terminal 2 - Client
cd client
npm run dev
```

### Step 6: Test

Open http://localhost:5173 and test:
- ✅ River levels should load (check CitizenPage)
- ✅ Create subscription with country code selector
- ✅ Hover over reports to see Share/Print buttons
- ✅ Send alert from Admin dashboard

---

## 📝 Provider Setup (Choose 1 or All)

### Option 1: Email (Gmail) - 2 Minutes ✉️

**Why Gmail?** Free, reliable, 500 emails/day limit

1. Enable 2FA: https://myaccount.google.com/security
2. Generate App Password: https://myaccount.google.com/apppasswords
3. Add to `.env`:

```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-email@gmail.com
SMTP_PASS=abcd efgh ijkl mnop    # Your 16-char app password
```

**Test:**
```bash
curl -X POST http://localhost:3001/api/subscriptions \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","channels":["email"]}'
```

---

### Option 2: SMS + WhatsApp (Twilio) - 5 Minutes 📱

**Why Twilio?** $15 free credit, easy setup, supports SMS + WhatsApp

1. Sign up: https://www.twilio.com/try-twilio
2. Verify your phone
3. Get free trial number
4. Copy credentials from Console Dashboard

Add to `.env`:
```env
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=your_auth_token
TWILIO_PHONE_NUMBER=+15017122661
TWILIO_WHATSAPP_NUMBER=whatsapp:+14155238886
```

**Trial Account Notes:**
- Can only send to verified numbers
- Verify at: Console > Phone Numbers > Verified Caller IDs
- Messages prefixed with "Sent from your Twilio trial account"
- Upgrade to remove restrictions ($1 minimum balance)

**Test SMS:**
```bash
curl -X POST http://localhost:3001/api/subscriptions \
  -H "Content-Type: application/json" \
  -d '{"phone":"+447700900123","channels":["sms"]}'
```

---

### Option 3: Telegram (Free Forever!) - 30 Seconds ✈️

**Why Telegram?** 100% free, no limits, no trial restrictions

1. Open Telegram
2. Search for `@BotFather`
3. Send: `/newbot`
4. Name: `AEGIS Alert Bot`
5. Username: `aegis_alerts_bot`
6. Copy token

Add to `.env`:
```env
TELEGRAM_BOT_TOKEN=1234567890:ABCdefGHIjklMNOpqrsTUVwxyz
```

**Get Your Chat ID (for testing):**
```bash
# 1. Start chat with your bot
# 2. Send any message
# 3. Visit this URL (replace <TOKEN>):
https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates

# 4. Find "chat":{"id":123456789}
# 5. Use that ID when subscribing
```

**Test:**
```bash
curl -X POST http://localhost:3001/api/subscriptions \
  -H "Content-Type: application/json" \
  -d '{"telegram_id":"123456789","channels":["telegram"]}'
```

---

### Option 4: Web Push (Free!) - 1 Minute 🔔

**Why Web Push?** Free, works in all modern browsers, no signup needed

1. Generate keys:
```bash
cd server
npx tsx src/utils/generateVapidKeys.ts
```

2. Copy output to `.env`:
```env
VAPID_PUBLIC_KEY=BMxxxxxxxxxxxxxxxxxx...
VAPID_PRIVATE_KEY=xxxxxxxxxxxxxxxxxx...
VAPID_SUBJECT=mailto:admin@aegis.gov.uk
```

**Test:**
- Open Citizen Page
- Click "Alerts" button
- Select "Web Push" channel
- Browser will request notification permission
- Send test alert from Admin dashboard

---

## 🌍 Phone Number Examples by Country

| Country | Code | Format | Example Input | Becomes |
|---------|------|---------|---------------|---------|
| 🇬🇧 UK | +44 | 7700 900123 | 7700900123 | +447700900123 |
| 🇺🇸 US | +1 | (415) 555-2671 | 4155552671 | +14155552671 |
| 🇳🇬 Nigeria | +234 | 802 123 4567 | 8021234567 | +2348021234567 |
| 🇮🇳 India | +91 | 81234 56789 | 8123456789 | +918123456789 |
| 🇦🇺 Australia | +61 | 412 345 678 | 412345678 | +61412345678 |
| 🇩🇪 Germany | +49 | 151 23456789 | 15123456789 | +4915123456789 |

**The system now auto-adds the country code when you select it!**

---

## 📊 Check Provider Status

```bash
# Check which providers are configured
curl http://localhost:3001/api/notification-status
```

Expected output when ALL configured:
```json
{
  "email": {"enabled": true, "configured": true},
  "sms": {"enabled": true, "configured": true},
  "whatsapp": {"enabled": true, "configured": true},  
  "telegram": {"enabled": true, "configured": true},
  "web": {"enabled": true, "configured": true, "publicKey": "BM..."}
}
```

If any show `"configured": false`, check those credentials in `.env`

---

## 🧪 Testing Multi-Channel Delivery

### Test 1: Single Channel
```bash
curl -X POST http://localhost:3001/api/subscriptions \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","channels":["email"]}'
```

### Test 2: Multiple Channels
```bash
curl -X POST http://localhost:3001/api/subscriptions \
  -H "Content-Type: application/json" \
  -d '{
    "email":"test@example.com",
    "phone":"+447700900123",
    "telegram_id":"123456789",
    "channels":["email","sms","telegram","web"]
  }'
```

### Test 3: Via Browser
1. Open http://localhost:5173
2. Click "Alerts" button
3. Select country (🇬🇧 UK, 🇺🇸 US, etc.)
4. Enter phone without country code (auto-added)
5. Select channels
6. Click "Subscribe to Alerts"
7. Go to Admin dashboard
8. Send test alert
9. Check delivery counts

---

## 🛠️ Troubleshooting

### SEPA River Levels Still Not Loading

**Check:**
1. Server is running on port 3001
2. Client can reach `/api/flood-data/stations`
3. Check browser console for errors

**Test endpoint directly:**
```bash
curl http://localhost:3001/api/flood-data/stations?region=scotland
```

Should return GeoJSON with station data.

**If still failing:**
- SEPA API might be temporarily down
- Check server logs for specific error
- Try restarting server

### Email Not Sending

**Gmail Issues:**
- ✅ Make sure 2FA is enabled
- ✅ Use App Password, not account password
- ✅ Check for security alert emails from Google
- ✅ Try logging into Gmail web to dismiss alerts

**Other SMTP:**
- Check SMTP_HOST and SMTP_PORT are correct
- Try sending test email via command line:
```bash
curl smtp://smtp.gmail.com:587 \
  --mail-from your-email@gmail.com \
  --mail-rcpt test@example.com \
  --user "your-email@gmail.com:your-app-password"
```

### SMS/WhatsApp Not Sending

**Twilio Trial Account:**
- ✅ Recipient number must be verified in Console
- ✅ Go to: Console > Phone Numbers > Verified Caller IDs
- ✅ Add recipient number before testing

**Phone Format:**
- ✅ Must be E.164: `+447700900123` (UK), `+14155552671` (US)
- ✅ Use country selector dropdown - it auto-formats
- ✅ Remove any spaces, dashes, parentheses

**Error: "Unverified number":**
- Verify the recipient number in Twilio Console
- Or upgrade account ($1 minimum) to remove restriction

### Telegram Not Sending

**Common Issues:**
- ✅ User must start conversation with bot first
- ✅ Send any message to bot before subscribing
- ✅ Check token has no spaces or line breaks

**Test bot token:**
```bash
curl https://api.telegram.org/bot<YOUR_TOKEN>/getMe
```

Should return bot details. If error, token is invalid.

### Web Push Not Working

**Check:**
- ✅ VAPID keys generated and in `.env`
- ✅ Browser has notification permission enabled
- ✅ Using HTTPS in production (localhost OK for dev)

**Safari Issues:**
- Requires macOS Ventura+ and Safari 16+
- May not work on older macOS versions

**Firefox:**
- Works on 44+
- Check about:config → dom.webnotifications.enabled = true

---

## 📋 Pre-Launch Checklist

- [ ] All 5 channels show `"configured": true`
- [ ] SEPA river levels loading on Citizen page
- [ ] Country code selector shows flags and formats
- [ ] Share button opens share dialog or email
- [ ] Print button opens formatted print preview
- [ ] Test alert sent successfully via Admin dashboard
- [ ] Delivery summary shows correct sent/failed counts
- [ ] Phone numbers validated (rejects invalid formats)
- [ ] Email verification sent when subscribing
- [ ] Database migration run (web push tables exist)
- [ ] `.env` file not committed to git
- [ ] Production secrets different from development

---

## 🎉 Success Criteria

You know it's working when:

1. **River Levels:** Live data appears on Citizen page with trend arrows
2. **Subscriptions:** Country selector auto-formats phone numbers
3. **Reports:** Hover shows Share + Print buttons
4. **Alerts:** Admin can send to multiple channels simultaneously
5. **Delivery:** Response shows exact count of sent/failed per channel
6. **Status:** All channels show "configured": true

---

## 📚 Additional Resources

- **Setup Guide:** `MULTICHANNEL_SETUP.md` - Detailed provider setup
- **Implementation:** `IMPLEMENTATION_SUMMARY.md` - Technical details
- **VAPID Keys:** Run `npx tsx src/utils/generateVapidKeys.ts`
- **Phone Validation:** `server/src/utils/phoneValidation.ts`
- **Country Codes:** `client/src/data/countryCodes.ts`

---

## 💡 Production Tips

1. **Email:** Use SendGrid (free 100/day) or AWS SES (cents per 1000)
2. **SMS:** Set daily limit in Twilio to prevent spam
3. **Telegram:** Can handle millions of messages for free
4. **Web Push:** Works offline, requires HTTPS
5. **Database:** Add indexes on phone and email columns
6. **Rate Limiting:** Add to subscription endpoint
7. **Monitoring:** Track delivery success rates
8. **Backups:** Export VAPID keys securely

---

## 🔒 Security

- ✅ Phone numbers validated client and server side
- ✅ VAPID private key never exposed to client
- ✅ E.164 format enforced (prevents invalid numbers)
- ✅ Channel normalization prevents bypass attacks
- ✅ Subscription requires valid contact per channel

**Production Recommendations:**
- Rate limit subscription endpoint (5 requests/minute)
- Add CAPTCHA on public subscription form
- Require email/phone verification before activating
- Monitor for spam patterns (multiple subs from same IP)
- Use environment variables (not .env file)

---

## 📞 Support

**Can't get it working?**
1. Check server logs (they show exactly what failed)
2. Test each channel individually first
3. Verify credentials in provider dashboards
4. Check firewall isn't blocking SMTP/API calls

**Still stuck?**
- Server logs show delivery status for each channel
- Check `/api/notification-status` endpoint
- All status checks return reasons for failures

---

**Everything is now configured and ready to run!** 🚀

Start both servers and test each feature. The multi-channel system will actually work with real provider integrations - no more fake "demo" messages!
