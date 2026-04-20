/**
 * useWebPush custom React hook (web push logic).
 *
 * How it connects:
 * - Used by React components that need this functionality */

import { useEffect, useState } from 'react'

export interface WebPushStatus {
  supported: boolean
  enabled: boolean
  subscribed: boolean
  publicKey?: string
}

export const useWebPush = () => {
  const [status, setStatus] = useState<WebPushStatus>({
    supported: false,
    enabled: false,
    subscribed: false,
  })
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  // Check browser support and get the VAPID public key.
  // VAPID (Voluntary Application Server Identification for Web Push) = a standard
  // that lets the browser verify the push message genuinely came from THIS app's
  // server and not an impersonator.  The server generates a VAPID key pair;
  // we send the public half to the browser when subscribing.
  useEffect(() => {
    const checkSupport = async () => {
      try {
        // Web Push requires three browser features:
        // serviceWorker: to receive push messages in the background when the tab is closed
        // PushManager:   the API that manages push subscriptions
        // Notification:  the permission+display API for showing alerts
        const isSupported =
          'serviceWorker' in navigator &&
          'PushManager' in window &&
          'Notification' in window

        setStatus(prev => ({ ...prev, supported: isSupported }))

        if (!isSupported) {
          console.warn('Browser does not support Web Push')
          return
        }

        // Fetch the VAPID public key from our server. Keep it in a local variable
        // so we can use it for silent auto-renewal later in this same function.
        let pubKey: string | undefined
        try {
          const response = await fetch('/api/notifications/status')
          const data = await response.json()
          if (data.web?.publicKey) {
            pubKey = data.web.publicKey
            setStatus(prev => ({ ...prev, enabled: true, publicKey: pubKey }))
          } else {
            console.warn('Web Push public key not available from server')
          }
        } catch {
          console.warn('Could not fetch notification status from server')
        }

        // Check if the user already has an active push subscription from a
        // previous session.  pushManager.getSubscription() returns null if not.
        // Also verify server-side that the endpoint is still active — FCM can
        // silently invalidate endpoints while the browser still holds a stale
        // PushSubscription object, causing broadcasts to find 0 active subs.
        try {
          // navigator.serviceWorker.ready waits until the service worker is
          // installed and activated (may be immediate if called after registration).
          const reg = await navigator.serviceWorker.ready
          const subscription = await reg.pushManager.getSubscription()
          if (subscription) {
            try {
              const verifyResp = await fetch(
                `/api/notifications/verify-subscription?endpoint=${encodeURIComponent(subscription.endpoint)}`
              )
              const verifyData = await verifyResp.json()

              if (verifyData.active === true) {
                // Subscription is healthy — nothing to do.
                setStatus(prev => ({ ...prev, subscribed: true }))
              } else if (Notification.permission === 'granted' && pubKey) {
                // Subscription is stale (FCM expired it) AND user already granted
                // notification permission → silently re-register in the background
                // without requiring any user interaction.
                try {
                  await subscription.unsubscribe()
                  const newSub = await reg.pushManager.subscribe({
                    userVisibleOnly: true,
                    applicationServerKey: urlBase64ToUint8Array(pubKey) as BufferSource,
                  })
                  const renewResp = await fetch('/api/notifications/subscribe', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ subscription: newSub.toJSON(), email: null, user_id: null }),
                  })
                  // Mark subscribed regardless of server response — new endpoint is live
                  setStatus(prev => ({ ...prev, subscribed: renewResp.ok }))
                } catch {
                  // Silent renewal failed — show Subscribe button so user can retry
                  setStatus(prev => ({ ...prev, subscribed: false }))
                }
              } else {
                // No permission or no VAPID key — can't auto-renew, show Subscribe button
                setStatus(prev => ({ ...prev, subscribed: false }))
              }
            } catch {
              // Network error verifying — optimistically trust the browser subscription
              setStatus(prev => ({ ...prev, subscribed: true }))
            }
          } else {
            setStatus(prev => ({ ...prev, subscribed: false }))
          }
        } catch {
          // Service worker not ready yet, that's okay
        }
      } catch (err) {
        console.error('Error checking Web Push support:', err)
      }
    }

    checkSupport()
  }, [])

  const subscribe = async (email?: string, userId?: string) => {
    setLoading(true)
    setError(null)

    try {
      // Check browser support
      if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
        throw new Error('Your browser does not support Web Push notifications')
      }

      // Request notification permission
      if (Notification.permission === 'default') {
        const permission = await Notification.requestPermission()
        if (permission !== 'granted') {
          throw new Error('Please allow notifications in your browser to use Web Push')
        }
      } else if (Notification.permission === 'denied') {
        throw new Error('Notifications are blocked. Please enable them in your browser settings')
      }

      // Register service worker and wait for it to be active
      let registration = await navigator.serviceWorker.getRegistration('/')
      if (!registration) {
        registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' })
      }

      // Wait for active service worker
      if (registration.installing || registration.waiting) {
        await new Promise<void>((resolve) => {
          const worker = registration!.installing || registration!.waiting
          if (!worker) { resolve(); return }
          worker.addEventListener('statechange', () => {
            if (worker.state === 'activated') resolve()
          })
          // Also resolve if already active
          if (registration!.active) resolve()
        })
      }
      // // console.log('[OK] Service Worker ready')

      // Always fetch fresh public key from server to avoid stale state
      let publicKey = status.publicKey
      if (!publicKey) {
        const resp = await fetch('/api/notifications/status')
        const data = await resp.json()
        publicKey = data.web?.publicKey
        if (publicKey) {
          setStatus(prev => ({ ...prev, enabled: true, publicKey }))
        }
      }

      if (!publicKey) {
        throw new Error('Web Push is not configured on the server. Please contact support.')
      }

      // Always create a fresh subscription to ensure it matches the current server VAPID key.
      // Stale subscriptions (created with old/ephemeral keys) cause silent delivery failures.
      const existingSub = await registration.pushManager.getSubscription()
      if (existingSub) {
        await existingSub.unsubscribe()
      }
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
      })

      if (!subscription) {
        throw new Error('Failed to create push subscription. Try reloading the page.')
      }

      // Send subscription to backend
      const response = await fetch('/api/notifications/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subscription: subscription.toJSON(),
          email: email || null,
          user_id: userId || null,
        }),
      })

      if (!response.ok) {
        throw new Error('Failed to save subscription on server')
      }

      // // console.log('[OK] Push subscription saved to server')
      setStatus(prev => ({ ...prev, subscribed: true }))
      return subscription
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error'
      console.error('Web Push subscription error:', errorMsg)
      setError(errorMsg)
      throw err
    } finally {
      setLoading(false)
    }
  }

  const unsubscribe = async () => {
    setLoading(true)
    setError(null)

    try {
      if ('serviceWorker' in navigator) {
        const registration = await navigator.serviceWorker.ready
        const subscription = await registration.pushManager.getSubscription()

        if (subscription) {
          // Notify backend
          await fetch('/api/notifications/unsubscribe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              endpoint: subscription.endpoint,
            }),
          })

          // Unsubscribe locally
          await subscription.unsubscribe()
          // // console.log('[OK] Push subscription removed')
          setStatus(prev => ({ ...prev, subscribed: false }))
        }
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error'
      console.error('Unsubscribe error:', errorMsg)
      setError(errorMsg)
      throw err
    } finally {
      setLoading(false)
    }
  }

  return {
    status,
    error,
    loading,
    subscribe,
    unsubscribe,
  }
}

// Helper function to convert VAPID key from base64 to Uint8Array
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding)
    .replace(/\-/g, '+')
    .replace(/_/g, '/')

  const rawData = window.atob(base64)
  const outputArray = new Uint8Array(rawData.length)

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i)
  }
  return outputArray
}
