import { ref } from 'vue'

// Set once the browser offers an install prompt (Chromium only; Safari and
// Firefox install through their own menus, so no button is shown there).
export const canInstall = ref(false)
let deferredPrompt = null

export const updateReady = ref(false)

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault()
  deferredPrompt = e
  canInstall.value = true
})

window.addEventListener('appinstalled', () => {
  deferredPrompt = null
  canInstall.value = false
})

export async function promptInstall() {
  if (!deferredPrompt) return
  const prompt = deferredPrompt
  deferredPrompt = null
  canInstall.value = false
  await prompt.prompt()
}

// The service worker lives in `public/` so its scope is the app root, which
// keeps working when the site is served from a sub-path.
export function registerServiceWorker() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register(
        new URL('sw.js', document.baseURI),
        { scope: './' }
      )
      reg.addEventListener('updatefound', () => {
        const sw = reg.installing
        if (!sw) return
        sw.addEventListener('statechange', () => {
          if (sw.state === 'installed' && navigator.serviceWorker.controller) {
            updateReady.value = true
          }
        })
      })
    } catch (e) {
      console.warn('service worker registration failed', e)
    }
  })
}

export function applyUpdate() {
  updateReady.value = false
  navigator.serviceWorker?.getRegistration().then((reg) => {
    reg?.waiting?.postMessage('skip-waiting')
    window.location.reload()
  })
}

// Files opened through the OS ("open with" / file_handlers in the manifest).
export function onLaunchFiles(handler) {
  if (!('launchQueue' in window)) return
  window.launchQueue.setConsumer(async (params) => {
    for (const fileHandle of params?.files || []) {
      try {
        handler(await fileHandle.getFile())
      } catch (e) {
        console.warn('failed to open launched file', e)
      }
    }
  })
}
