 /*
 * AEGIS v6 Production Service Worker
 * Strategies:
 * App shell: cache-first (HTML, CSS, JS, fonts)
 * API data:  network-first with cache fallback
 * Images:    stale-while-revalidate
 * Push:      notifications with severity-based priority
 * Sync:      offline report queue with background sync
  */

const CACHE_VERSION = 'aegis-v6.9.1'
const STATIC_CACHE = `${CACHE_VERSION}-static`
const DATA_CACHE = `${CACHE_VERSION}-data`
const IMAGE_CACHE = `${CACHE_VERSION}-images`

// App shell files to pre-cache on install
const APP_SHELL = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png',
]

// INSTALL — Pre-cache app shell

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => {
      console.log('[SW] Pre-caching app shell')
      return cache.addAll(APP_SHELL)
    }).then(() => self.skipWaiting())
  )
})

// ACTIVATE — Clean old caches

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== STATIC_CACHE && k !== DATA_CACHE && k !== IMAGE_CACHE)
          .map((k) => {
            console.log('[SW] Deleting old cache:', k)
            return caches.delete(k)
          })
      )
    ).then(() => self.clients.claim())
  )
})

// FETCH — Routing strategies

self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)

  // Skip non-GET requests (POST/PUT/DELETE go straight to network)
  if (request.method !== 'GET') return

  // Skip cross-origin requests except tile servers
  if (url.origin !== self.location.origin && !isTileRequest(url)) return

  // API requests: network-first (but never cache authenticated responses)
  if (url.pathname.startsWith('/api/')) {
    if (request.headers.get('Authorization')) {
      // Authenticated request — pass through to network without caching
      event.respondWith(
        fetch(request).catch(() =>
          new Response(JSON.stringify({ error: 'Offline', cached: false }), {
            status: 503,
            headers: { 'Content-Type': 'application/json' },
          })
        )
      )
    } else {
      event.respondWith(networkFirst(request, DATA_CACHE, 5000))
    }
    return
  }

  // Tile / WMS requests: stale-while-revalidate with longer TTL
  if (isTileRequest(url)) {
    event.respondWith(staleWhileRevalidate(request, IMAGE_CACHE))
    return
  }

  // Images: stale-while-revalidate
  if (request.destination === 'image' || /\.(png|jpg|jpeg|gif|svg|ico|webp)$/i.test(url.pathname)) {
    event.respondWith(staleWhileRevalidate(request, IMAGE_CACHE))
    return
  }

  // App shell (HTML, CSS, JS): cache-first
  event.respondWith(cacheFirst(request, STATIC_CACHE))
})

function isTileRequest(url) {
  return (
    url.hostname.includes('tile.openstreetmap.org') ||
    url.hostname.includes('tiles.stadiamaps.com') ||
    url.hostname.includes('basemap.nationalmap.gov') ||
    url.hostname.includes('map.sepa.org.uk') ||
    url.hostname.includes('cartodb')
  )
}

/* Cache-first: serve from cache if available, else network */
async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request)
  if (cached) return cached

  try {
    const response = await fetch(request)
    if (response.ok) {
      const cache = await caches.open(cacheName)
      cache.put(request, response.clone())
    }
    return response
  } catch {
    // Offline — return cached index.html for navigation requests (SPA)
    if (request.mode === 'navigate') {
      return caches.match('/index.html')
    }
    return new Response('Offline', { status: 503, statusText: 'Service Unavailable' })
  }
}

/* Network-first with timeout: try network, fall back to cache */
async function networkFirst(request, cacheName, timeoutMs = 5000) {
  const cache = await caches.open(cacheName)

  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

    const response = await fetch(request, { signal: controller.signal })
    clearTimeout(timeoutId)

    if (response.ok) {
      cache.put(request, response.clone())
    }
    return response
  } catch {
    const cached = await cache.match(request)
    if (cached) return cached
    return new Response(JSON.stringify({ error: 'Offline', cached: false }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}

/* Stale-while-revalidate: return cache immediately, update in background */
async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName)
  const cached = await cache.match(request)

  const networkPromise = fetch(request)
    .then((response) => {
      if (response.ok) cache.put(request, response.clone())
      return response
    })
    .catch(() => null)

  return cached || (await networkPromise) || new Response('', { status: 503 })
}

// OFFLINE QUEUE — Store failed POST/PUT requests for background sync

const QUEUE_STORE = 'aegis-offline-queue'

async function getOfflineQueue() {
  try {
    const db = await openDB()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(QUEUE_STORE, 'readonly')
      const store = tx.objectStore(QUEUE_STORE)
      const req = store.getAll()
      req.onsuccess = () => resolve(req.result || [])
      req.onerror = () => reject(req.error)
    })
  } catch {
    return []
  }
}

async function addToQueue(entry) {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(QUEUE_STORE, 'readwrite')
    const store = tx.objectStore(QUEUE_STORE)
    const req = store.add(entry)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function removeFromQueue(id) {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(QUEUE_STORE, 'readwrite')
    const store = tx.objectStore(QUEUE_STORE)
    const req = store.delete(id)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
  })
}

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('aegis-sw', 1)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(QUEUE_STORE)) {
        db.createObjectStore(QUEUE_STORE, { keyPath: 'id', autoIncrement: true })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

// Listen for messages from the client to queue offline requests
self.addEventListener('message', (event) => {
  if (event.data?.type === 'QUEUE_REQUEST') {
    const { url, method, body, headers } = event.data
    addToQueue({ url, method, body, headers, timestamp: Date.now() })
      .then(() => {
        event.source?.postMessage({ type: 'QUEUED', url })
        // Try to register background sync
        if (self.registration.sync) {
          self.registration.sync.register('aegis-sync')
        }
      })
      .catch((err) => console.error('[SW] Failed to queue request:', err))
  }

  if (event.data?.type === 'GET_QUEUE_STATUS') {
    getOfflineQueue().then((queue) => {
      event.source?.postMessage({ type: 'QUEUE_STATUS', count: queue.length, items: queue })
    })
  }

  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting()
  }
})

// BACKGROUND SYNC — Replay offline queue when back online

self.addEventListener('sync', (event) => {
  if (event.tag === 'aegis-sync') {
    event.waitUntil(replayQueue())
  }
})

async function replayQueue() {
  const queue = await getOfflineQueue()
  console.log(`[SW] Replaying ${queue.length} queued requests`)

  for (const entry of queue) {
    try {
      const response = await fetch(entry.url, {
        method: entry.method,
        headers: entry.headers,
        body: entry.body,
      })

      if (response.ok) {
        await removeFromQueue(entry.id)
        // Notify clients
        const allClients = await self.clients.matchAll()
        allClients.forEach((client) =>
          client.postMessage({ type: 'SYNC_SUCCESS', url: entry.url, id: entry.id })
        )
      }
    } catch (err) {
      console.warn(`[SW] Replay failed for ${entry.url}:`, err.message)
      // Leave in queue for next sync attempt
    }
  }
}

// PUSH NOTIFICATIONS

self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = { title: 'AEGIS Alert', message: event.data?.text() || 'New alert received' }
  }

  const severity = data.severity || data.data?.severity || 'info'
  const title = data.title || 'AEGIS Emergency Alert'
  const alertUrl = data.data?.url || data.url || '/'

  const options = {
    body: data.body || data.message || 'Check AEGIS for details.',
    icon: '/icons/icon-192x192.png',
    badge: '/icons/badge-72x72.png',
    tag: data.tag || data.id || `aegis-${severity}-${Date.now()}`,
    renotify: severity === 'critical',
    requireInteraction: severity === 'critical' || severity === 'warning',
    silent: false,
    vibrate: severity === 'critical' ? [300, 100, 300, 100, 300] : [200, 100, 200],
    data: {
      url: alertUrl,
      alertId: data.data?.alert_id || data.id,
      severity,
      type: data.data?.type || data.type,
      timestamp: Date.now(),
    },
    actions: [
      { action: 'open', title: 'View Details' },
      { action: 'dismiss', title: 'Dismiss' },
    ],
  }

  event.waitUntil(self.registration.showNotification(title, options))
})

// NOTIFICATION CLICK

self.addEventListener('notificationclick', (event) => {
  event.notification.close()

  if (event.action === 'dismiss') return

  const relativePath = event.notification.data?.url || '/'
  // openWindow() requires an absolute URL in all browsers
  const targetUrl = relativePath.startsWith('http')
    ? relativePath
    : self.location.origin + relativePath

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Focus an existing window that is already on the same path
      for (const client of clientList) {
        try {
          const clientPath = new URL(client.url).pathname + new URL(client.url).search
          if ((clientPath === relativePath || client.url === targetUrl) && 'focus' in client) {
            client.navigate(targetUrl)
            return client.focus()
          }
        } catch { /* ignore malformed URLs */ }
      }
      // Nothing matched — focus any open AEGIS tab and navigate it, or open a new one
      if (clientList.length > 0 && 'navigate' in clientList[0]) {
        clientList[0].navigate(targetUrl)
        return clientList[0].focus()
      }
      return self.clients.openWindow(targetUrl)
    })
  )
})

// PERIODIC CACHE CLEANUP

// Clean image cache if it gets too large (max 200 entries)
async function trimCache(cacheName, maxItems = 200) {
  const cache = await caches.open(cacheName)
  const keys = await cache.keys()
  if (keys.length > maxItems) {
    for (let i = 0; i < keys.length - maxItems; i++) {
      await cache.delete(keys[i])
    }
  }
}

// Run cleanup periodically via message
self.addEventListener('message', (event) => {
  if (event.data?.type === 'TRIM_CACHES') {
    trimCache(IMAGE_CACHE, 200)
    trimCache(DATA_CACHE, 100)
  }
})

