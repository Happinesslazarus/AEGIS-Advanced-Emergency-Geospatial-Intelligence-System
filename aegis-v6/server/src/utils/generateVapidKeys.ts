 /*
 * generateVapidKeys.ts - Generate VAPID keys for Web Push
 * Run this once to generate keys, then add them to your .env file:
 * npx tsx src/utils/generateVapidKeys.ts
  */

import webPush from 'web-push'

console.log('\n')
console.log(' Generating VAPID Keys for Web Push Notifications')
console.log('\n')

const vapidKeys = webPush.generateVAPIDKeys()

console.log('[OK] VAPID keys generated successfully!\n')
console.log('Add these to your .env file:\n')
console.log(`VAPID_PUBLIC_KEY=${vapidKeys.publicKey}`)
console.log(`VAPID_PRIVATE_KEY=${vapidKeys.privateKey}`)
console.log(`VAPID_SUBJECT=mailto:admin@aegis.gov.uk\n`)

console.log('\n')
console.log('[WARN] Keep the PRIVATE KEY secret - never commit it to git!')
console.log(' Store it securely in your .env file only.\n')
