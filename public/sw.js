/* Build injects a content-derived version and the complete offline app shell. */
const VERSION = '__BUILD_VERSION__'
const PRECACHE = __PRECACHE_ASSETS__
const SHELL_CACHE = `anywhere-reader-shell-${VERSION}`
const ASSET_CACHE = `anywhere-reader-assets-${VERSION}`
const SHELL_URL = new URL('./index.html', self.registration.scope).pathname
self.addEventListener('install', (event) => {
  // A failed download fails installation, leaving the previous working version.
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) =>
        cache.addAll(
          PRECACHE.map(
            (path) =>
              new Request(new URL(path, self.registration.scope), {
                cache: 'reload'
              })
          )
        )
      )
  )
})
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter(
              (k) =>
                k.startsWith('anywhere-reader-') &&
                k !== SHELL_CACHE &&
                k !== ASSET_CACHE
            )
            .map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  )
})
self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting()
})
async function handleNavigation(request) {
  try {
    const response = await fetch(request)
    if (!response.ok) throw new Error('navigation failed')
    // Keep the precached shell paired with its build's assets for offline use.
    return response
  } catch {
    const cached = await caches.match(SHELL_URL)
    if (cached) return cached
    throw new Error('offline and no cached shell')
  }
}
async function handleAsset(request) {
  const cached = await caches.match(request)
  if (cached) return cached
  const response = await fetch(request)
  if (response.ok && response.status === 200 && response.type !== 'opaque') {
    const cache = await caches.open(ASSET_CACHE)
    await cache.put(request, response.clone())
  }
  return response
}
self.addEventListener('fetch', (event) => {
  const { request } = event
  if (
    request.method !== 'GET' ||
    new URL(request.url).origin !== self.location.origin
  )
    return
  event.respondWith(
    request.mode === 'navigate'
      ? handleNavigation(request)
      : handleAsset(request)
  )
})
