// IndexedDB-backed library: persists uploaded EPUB blobs + metadata so the
// bookshelf survives page reloads without re-uploading files.

const DB_NAME = 'anywhere-reader'
const DB_VERSION = 1
const STORE = 'books'

let dbPromise = null

function openDB() {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbPromise
}

// Run a single store request inside a transaction and resolve with its result.
async function request(mode, fn) {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, mode)
    const store = transaction.objectStore(STORE)
    const req = fn(store)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

// Stable, content-based id so the same book gets the same id across devices.
export async function hashBlob(blob) {
  const buf = await blob.arrayBuffer()
  const digest = await crypto.subtle.digest('SHA-256', buf)
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 16)
}

export function putBook(record) {
  return request('readwrite', (store) => store.put(record)).then(() => record)
}

export function getBook(id) {
  return request('readonly', (store) => store.get(id)).then((r) => r || null)
}

export function deleteBook(id) {
  return request('readwrite', (store) => store.delete(id))
}

// Returns metadata for every stored book (without the heavy blob field).
export async function listBooks() {
  const rows = (await request('readonly', (store) => store.getAll())) || []
  rows.sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0))
  // eslint-disable-next-line no-unused-vars
  return rows.map(({ blob, ...meta }) => meta)
}
