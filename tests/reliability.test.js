import { test, expect, beforeAll, beforeEach, afterEach } from 'bun:test'
import { indexedDB, IDBDatabase } from 'fake-indexeddb'
import {
  putBook,
  getBook,
  listBooks,
  removeBook,
  restoreBook,
  updateBookMeta,
  getLocations,
  putLocations,
  hashBlob,
  purgeBookFiles
} from '../src/reader/db.js'
import {
  saveProgress,
  loadProgress,
  saveAllProgress,
  loadAllProgress,
  saveWebDAVConfig,
  saveBookmarks
} from '../src/reader/storage.js'
import { notice } from '../src/reader/feedback.js'
import { syncProgress } from '../src/reader/sync.js'
import { exportBackup, importBackup } from '../src/reader/backup.js'
import JSZip from 'jszip'

const originalFetch = globalThis.fetch
const values = new Map()
globalThis.indexedDB = indexedDB
globalThis.navigator = {}
globalThis.localStorage = {
  getItem: (key) => values.get(key) || null,
  setItem: (key, value) => values.set(key, value)
}
let failStorage = false
const setItem = localStorage.setItem
localStorage.setItem = (key, value) => {
  if (failStorage) throw new DOMException('full', 'QuotaExceededError')
  setItem(key, value)
}
const oldBlob = new Blob(['legacy-book'])

beforeAll(async () => {
  await new Promise((resolve, reject) => {
    const req = indexedDB.open('anywhere-reader', 1)
    req.onupgradeneeded = () =>
      req.result.createObjectStore('books', { keyPath: 'id' })
    req.onerror = () => reject(req.error)
    req.onsuccess = () => {
      const db = req.result
      const tx = db.transaction('books', 'readwrite')
      tx.objectStore('books').put({
        id: 'old',
        title: '原书',
        blob: oldBlob,
        cover: new Blob(['cover'])
      })
      tx.oncomplete = () => {
        db.close()
        resolve()
      }
    }
  })
})
beforeEach(() => {
  values.clear()
  notice.value = null
  failStorage = false
})
afterEach(() => {
  globalThis.fetch = originalFetch
})

test('v1 migration preserves original EPUB and cover; metadata listing excludes files', async () => {
  const record = await getBook('old')
  expect(await record.blob.text()).toBe('legacy-book')
  expect(await record.cover.text()).toBe('cover')
  expect((await listBooks()).find((b) => b.id === 'old')).not.toHaveProperty(
    'blob'
  )
})
test('soft removal and restoration preserve bytes and advance deletion revision', async () => {
  await removeBook('old', 'sync')
  const removed = await getBook('old')
  expect((await listBooks()).some((b) => b.id === 'old')).toBe(false)
  await restoreBook('old')
  const restored = await getBook('old')
  expect(restored.deletionUpdatedAt).toBeGreaterThan(removed.deletionUpdatedAt)
  expect(await restored.blob.text()).toBe('legacy-book')
})
test('metadata patch does not rewrite or lose EPUB', async () => {
  await updateBookMeta('old', { title: '新书名' })
  const r = await getBook('old')
  expect(r.title).toBe('新书名')
  expect(await r.blob.text()).toBe('legacy-book')
})
test('a successful request in an aborted transaction is not reported as saved', async () => {
  const original = IDBDatabase.prototype.transaction
  IDBDatabase.prototype.transaction = function (names, mode, ...args) {
    const tx = original.call(this, names, mode, ...args)
    if (mode === 'readwrite') {
      const objectStore = tx.objectStore.bind(tx)
      tx.objectStore = (name) => {
        const store = objectStore(name)
        const put = store.put.bind(store)
        store.put = (...params) => {
          const req = put(...params)
          req.addEventListener('success', () => tx.abort(), { once: true })
          return req
        }
        return store
      }
    }
    return tx
  }
  try {
    await expect(
      putBook({ id: 'aborted', title: '应回滚', blob: oldBlob })
    ).rejects.toThrow()
  } finally {
    IDBDatabase.prototype.transaction = original
  }
  expect(await getBook('aborted')).toBe(null)
})
test('index cache survives metadata updates', async () => {
  await putLocations('old', { version: 'v1', data: '["cfi"]' })
  await updateBookMeta('old', { title: 'cache' })
  expect((await getLocations('old')).data).toBe('["cfi"]')
})
test('quota failures are visible and progress is not reported as saved', () => {
  failStorage = true
  expect(saveProgress('a', { cfi: 'epubcfi(test)', percentage: 10 })).toBe(null)
  expect(notice.value.message).toContain('存储空间不足')
  expect(loadProgress('a')).toBe(null)
})
test('same-millisecond page turns have increasing revisions', () => {
  const a = saveProgress('a', { cfi: 'first', percentage: 10 })
  const b = saveProgress('a', { cfi: 'next', percentage: 11 })
  expect(b.updatedAt).toBeGreaterThan(a.updatedAt)
})
test('page turns during both GET and PUT survive sync', async () => {
  saveAllProgress({ a: { cfi: 'before', updatedAt: 1 } })
  let uploaded
  globalThis.fetch = async (url, options) => {
    if (options.method === 'GET') {
      saveAllProgress({ a: { cfi: 'during-get', updatedAt: 3 } })
      return Response.json(
        { a: { cfi: 'remote', updatedAt: 2 } },
        { headers: { ETag: '"one"' } }
      )
    }
    expect(options.headers['If-Match']).toBe('"one"')
    uploaded = JSON.parse(options.body)
    saveAllProgress({ a: { cfi: 'during-put', updatedAt: 4 } })
    return new Response(null, { status: 204 })
  }
  await syncProgress({ url: 'https://dav.test', baseDir: '/reader' })
  expect(uploaded.a.cfi).toBe('during-get')
  expect(loadProgress('a').cfi).toBe('during-put')
})
test('412 conflict retries with newest remote data', async () => {
  let gets = 0,
    puts = 0,
    uploaded
  globalThis.fetch = async (url, options) => {
    if (options.method === 'GET') {
      gets++
      return Response.json(
        gets === 1 ? {} : { remote: { cfi: 'new', updatedAt: 5 } },
        { headers: { ETag: `"${gets}"` } }
      )
    }
    puts++
    uploaded = JSON.parse(options.body)
    return new Response(null, { status: puts === 1 ? 412 : 204 })
  }
  await syncProgress({ url: 'https://dav.test' })
  expect(gets).toBe(2)
  expect(uploaded.remote.cfi).toBe('new')
})
test('missing ETag fails clearly instead of unsafe overwrite', async () => {
  globalThis.fetch = async () => Response.json({})
  await expect(syncProgress({ url: 'https://dav.test' })).rejects.toThrow(
    'ETag'
  )
})
test('backup round-trip preserves progress/bookmarks and excludes credentials', async () => {
  // Hide the migration fixture, whose artificial ID intentionally is not a hash.
  await removeBook('old')
  await purgeBookFiles('old')
  const blob = new Blob(['backup-book'])
  const id = await hashBlob(blob)
  await putBook({ id, title: '备份', name: '备份.epub', blob })
  saveProgress(id, { cfi: 'position', percentage: 35 })
  saveBookmarks(id, [{ cfi: 'bookmark', label: '第一章' }])
  saveWebDAVConfig({ url: 'https://dav.test', password: 'do-not-export' })
  const output = await exportBackup()
  const zip = await JSZip.loadAsync(await output.arrayBuffer())
  const raw = await zip.file('manifest.json').async('text')
  expect(raw).not.toContain('do-not-export')
  await removeBook(id)
  values.clear()
  await importBackup(await output.arrayBuffer())
  expect(await (await getBook(id)).blob.text()).toBe('backup-book')
  expect(loadProgress(id).percentage).toBe(35)
})
test('corrupt backup is rejected before library mutation', async () => {
  const zip = new JSZip()
  zip.file(
    'manifest.json',
    JSON.stringify({
      format: 'anywhere-reader-backup',
      version: 1,
      books: [{ id: 'aaaaaaaaaaaaaaaa' }]
    })
  )
  zip.file('books/aaaaaaaaaaaaaaaa.epub', 'wrong data')
  await expect(
    importBackup(await zip.generateAsync({ type: 'arraybuffer' }))
  ).rejects.toThrow('校验失败')
  expect(await getBook('aaaaaaaaaaaaaaaa')).toBe(null)
})

function davFixture() {
  const data = new Map()
  const requests = []
  let revision = 0
  globalThis.fetch = async (url, options) => {
    const path = new URL(url).pathname
    requests.push({ path, method: options.method })
    if (options.method === 'MKCOL') return new Response(null, { status: 201 })
    if (options.method === 'PROPFIND') {
      const prefix = path.replace(/\/$/, '') + '/'
      const children = [...data.keys()].filter(
        (k) => k.startsWith(prefix) && !k.slice(prefix.length).includes('/')
      )
      const xml = `<d:multistatus xmlns:d="DAV:">${[path, ...children].map((p) => `<d:response><d:href>${p}</d:href></d:response>`).join('')}</d:multistatus>`
      return new Response(xml, { status: 207 })
    }
    if (options.method === 'GET') {
      const row = data.get(path)
      return row
        ? new Response(row.body, { headers: { ETag: row.etag } })
        : new Response(null, { status: 404 })
    }
    if (options.method === 'PUT') {
      const row = data.get(path)
      if (
        options.headers['If-Match'] &&
        row?.etag !== options.headers['If-Match']
      )
        return new Response(null, { status: 412 })
      if (options.headers['If-None-Match'] && row)
        return new Response(null, { status: 412 })
      data.set(path, {
        body:
          options.body instanceof Blob
            ? await options.body.arrayBuffer()
            : options.body,
        etag: `"${++revision}"`
      })
      return new Response(null, { status: 204 })
    }
    throw new Error('unexpected request')
  }
  return { data, requests }
}
test('local-only removal suppresses re-download; sync removal and undo propagate', async () => {
  const { DOMParser } = await import('@xmldom/xmldom')
  globalThis.DOMParser = DOMParser
  const { syncAll } = await import('../src/reader/sync.js')
  const { data, requests } = davFixture()
  const blob = new Blob(['sync deletion fixture'])
  const id = await hashBlob(blob)
  const cfg = { url: 'https://dav.test', baseDir: '/r' }
  await putBook({ id, title: '删除测试', blob, addedAt: 10 })
  await syncAll(cfg)
  expect(data.has(`/r/books/${id}.epub`)).toBe(true)
  await removeBook(id, 'local')
  requests.length = 0
  await syncAll(cfg)
  expect(
    requests.some((r) => r.method === 'GET' && r.path === `/r/books/${id}.epub`)
  ).toBe(false)
  expect((await getBook(id)).removalMode).toBe('local')
  await restoreBook(id)
  await removeBook(id, 'sync')
  await syncAll(cfg)
  expect(JSON.parse(data.get(`/r/deletions/${id}.json`).body).deleted).toBe(
    true
  )
  await restoreBook(id)
  await syncAll(cfg)
  expect(JSON.parse(data.get(`/r/deletions/${id}.json`).body).deleted).toBe(
    false
  )
  expect((await getBook(id)).removedAt).toBe(0)
})
test('cloud deletion received by a second device hides book without losing restore bytes', async () => {
  const { syncAll } = await import('../src/reader/sync.js')
  const { data } = davFixture()
  const blob = new Blob(['remote deletion fixture'])
  const id = await hashBlob(blob)
  await putBook({ id, title: '远程删除', blob, addedAt: 10 })
  data.set(`/r/deletions/${id}.json`, {
    body: JSON.stringify({ deleted: true, updatedAt: Date.now() + 100 }),
    etag: '"remote"'
  })
  await syncAll({ url: 'https://dav.test', baseDir: '/r' })
  expect((await listBooks()).some((b) => b.id === id)).toBe(false)
  expect(await (await getBook(id)).blob.text()).toBe('remote deletion fixture')
})
test('listBooks never opens the EPUB file store', async () => {
  const original = IDBDatabase.prototype.transaction
  const stores = []
  IDBDatabase.prototype.transaction = function (names, ...args) {
    stores.push(names)
    return original.call(this, names, ...args)
  }
  try {
    await listBooks()
  } finally {
    IDBDatabase.prototype.transaction = original
  }
  expect(stores.flat()).not.toContain('files')
})

test('purging releases files but retains the removal marker for sync', async () => {
  const blob = new Blob(['purge fixture'])
  const id = await hashBlob(blob)
  await putBook({ id, title: '清理', blob })
  await removeBook(id, 'local')
  await purgeBookFiles(id)
  const record = await getBook(id)
  expect(record.blob).toBeUndefined()
  expect(record.purged).toBe(true)
  expect(record.removedAt).toBeGreaterThan(0)
  expect(
    (await listBooks({ includeRemoved: true })).some((b) => b.id === id)
  ).toBe(true)
})

test('import rejects corrupt input and deduplicates valid EPUB content', async () => {
  const { importBook } = await import('../src/reader/import.js')
  const zip = new JSZip()
  zip.file('META-INF/container.xml', '<container/>')
  const file = new File(
    [await zip.generateAsync({ type: 'arraybuffer' })],
    '导入测试.epub'
  )
  const id = await importBook(file)
  expect(await importBook(file)).toBe(id)
  expect((await listBooks()).filter((b) => b.id === id)).toHaveLength(1)
  await removeBook(id)
  await purgeBookFiles(id)
  await importBook(file)
  expect((await getBook(id)).purged).toBe(false)
  expect(await (await getBook(id)).blob.arrayBuffer()).toEqual(
    await file.arrayBuffer()
  )
  await expect(
    importBook(new File(['broken'], 'broken.epub'))
  ).rejects.toThrow()
})

test('invalid saved preferences fall back to usable reading settings', async () => {
  const { loadPrefs } = await import('../src/reader/storage.js')
  localStorage.setItem('anywhere-reader:prefs', JSON.stringify({ theme: 'unknown', fontSize: 'broken', lineHeight: null }))
  const prefs = loadPrefs()
  expect(prefs.theme).toBe('light')
  expect(prefs.fontSize).toBe(100)
  expect(prefs.lineHeight).toBe(1.7)
})

test('damaged cloud book is rejected before insertion', async () => {
  const { syncAll } = await import('../src/reader/sync.js')
  const { data } = davFixture()
  const id = 'ffffffffffffffff'
  data.set(`/r/books/${id}.epub`, { body: 'wrong bytes', etag: '"bad"' })
  await expect(syncAll({ url: 'https://dav.test', baseDir: '/r' })).rejects.toThrow('校验失败')
  expect(await getBook(id)).toBe(null)
})
