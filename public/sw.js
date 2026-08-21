/* Anywhere Reader service worker.
 *
 * Hand-written instead of generated so it works with Vite's relative `base`
 * (the app is served from a GitHub Pages sub-path). Build output file names are
 * content-hashed and therefore unknown here, so assets are cached lazily as
 * they are requested; only the app shell is pre-cached.
 */
const VERSION = 'v1'
const SHELL_CACHE = `anywhere-reader-shell-${VERSION}`
const ASSET_CACHE = `anywhere-reader-assets-${VERSION}`
const SHELL_URL = new URL('./index.html', self.registration.scope).pathname

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.add(new Request(SHELL_URL, { cache: 'reload' })))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith('anywhere-reader-') && k !== SHELL_CACHE && k !== ASSET_CACHE)
            .map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  )
})

self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting()
})

// Navigations: network first so a newly deployed shell is picked up, falling
// back to the cached shell when offline.
async function handleNavigation(request) {
  try {
    const response = await fetch(request)
    const cache = await caches.open(SHELL_CACHE)
    cache.put(SHELL_URL, response.clone())
    return response
  } catch {
    const cached = await caches.match(SHELL_URL)
    if (cached) return cached
    throw new Error('offline and no cached shell')
  }
}

// Hashed build assets and fonts: cache first, populated on first use.
async function handleAsset(request) {
  const cached = await caches.match(request)
  if (cached) return cached
  const response = await fetch(request)
  if (response.ok && response.status === 200 && response.type !== 'opaque') {
    const cache = await caches.open(ASSET_CACHE)
    cache.put(request, response.clone())
  }
  return response
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  if (request.mode === 'navigate') {
    event.respondWith(handleNavigation(request))
    return
  }

  event.respondWith(handleAsset(request))
})
