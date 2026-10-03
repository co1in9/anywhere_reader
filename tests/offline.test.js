import { test, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

function worker({ failInstall = false, offline = false } = {}) {
  const listeners = {}
  let skips = 0
  const removed = []
  const stored = []
  const cached = new Response('offline shell')
  const code = readFileSync('public/sw.js', 'utf8')
    .replace('__BUILD_VERSION__', 'test')
    .replace('__PRECACHE_ASSETS__', '["index.html","reader.js"]')
  runInNewContext(code, {
    URL,
    Request,
    self: {
      registration: { scope: 'https://reader.test/app/' },
      location: { origin: 'https://reader.test' },
      clients: { claim: async () => {} },
      skipWaiting: () => skips++,
      addEventListener: (name, listener) => (listeners[name] = listener)
    },
    fetch: async () => {
      if (offline) throw new Error('offline')
      return new Response('network shell')
    },
    caches: {
      open: async () => ({
        addAll: async (requests) => {
          if (failInstall) throw new Error('download failed')
          stored.push(...requests.map((r) => r.url))
        },
        put: async () => {}
      }),
      keys: async () => [
        'anywhere-reader-shell-old',
        'anywhere-reader-shell-test',
        'other-app'
      ],
      delete: async (name) => removed.push(name),
      match: async () => cached
    }
  })
  return { listeners, removed, stored, skips: () => skips }
}
test('offline installation precaches complete shell and waits for user update', async () => {
  const w = worker()
  let work
  w.listeners.install({ waitUntil: (p) => (work = p) })
  await work
  expect(w.stored).toEqual([
    'https://reader.test/app/index.html',
    'https://reader.test/app/reader.js'
  ])
  expect(w.skips()).toBe(0)
  w.listeners.message({ data: 'skip-waiting' })
  expect(w.skips()).toBe(1)
})
test('failed precache does not activate a partial new version', async () => {
  const w = worker({ failInstall: true })
  let work
  w.listeners.install({ waitUntil: (p) => (work = p) })
  await expect(work).rejects.toThrow('download failed')
  expect(w.skips()).toBe(0)
})
test('activation removes only old reader caches', async () => {
  const w = worker()
  let work
  w.listeners.activate({ waitUntil: (p) => (work = p) })
  await work
  expect(w.removed).toEqual(['anywhere-reader-shell-old'])
})
test('offline navigation returns build-paired precached shell', async () => {
  const w = worker({ offline: true })
  let work
  w.listeners.fetch({
    request: {
      method: 'GET',
      url: 'https://reader.test/app/',
      mode: 'navigate'
    },
    respondWith: (p) => (work = p)
  })
  expect(await (await work).text()).toBe('offline shell')
})
