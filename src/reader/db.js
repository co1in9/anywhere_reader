// Keep lightweight library metadata independent of EPUB files and thumbnails.
const DB_NAME = 'anywhere-reader'
const DB_VERSION = 2
const STORES = ['metadata', 'files', 'covers', 'locations']
let dbPromise

function split(record) {
  const { blob, cover, ...meta } = record
  return { meta, blob, cover }
}
function openDB() {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      for (const name of STORES) {
        if (!db.objectStoreNames.contains(name))
          db.createObjectStore(name, { keyPath: 'id' })
      }
      // Migration is atomic: a failed transaction leaves the original DB intact.
      if (db.objectStoreNames.contains('books')) {
        const cursor = req.transaction.objectStore('books').openCursor()
        cursor.onsuccess = () => {
          const row = cursor.result
          if (!row) return
          const { meta, blob, cover } = split(row.value)
          req.transaction.objectStore('metadata').put(meta)
          if (blob)
            req.transaction.objectStore('files').put({ id: meta.id, blob })
          if (cover)
            req.transaction.objectStore('covers').put({ id: meta.id, cover })
          row.delete()
          row.continue()
        }
      }
    }
    req.onsuccess = () => {
      const db = req.result
      db.onversionchange = () => {
        db.close()
        dbPromise = null
      }
      resolve(db)
    }
    req.onerror = () => {
      dbPromise = null
      reject(req.error)
    }
    req.onblocked = () => {
      dbPromise = null
      reject(new Error('请关闭其它阅读器标签页后重试数据库升级。'))
    }
  })
  return dbPromise
}

async function transaction(names, mode, operation) {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(names, mode)
    let result
    tx.oncomplete = () =>
      resolve(typeof result === 'function' ? result() : result)
    tx.onerror = () => reject(tx.error || new Error('本地数据库读写失败'))
    tx.onabort = () => reject(tx.error || new Error('本地保存被中止，请重试'))
    try {
      result = operation(tx)
    } catch (e) {
      tx.abort()
      reject(e)
    }
  })
}
export async function hashBlob(blob) {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 16)
}
export async function putBook(record) {
  const { meta, blob, cover } = split(record)
  await transaction(['metadata', 'files', 'covers'], 'readwrite', (tx) => {
    tx.objectStore('metadata').put(meta)
    if (blob) tx.objectStore('files').put({ id: record.id, blob })
    if (cover) tx.objectStore('covers').put({ id: record.id, cover })
    else if (Object.hasOwn(record, 'cover'))
      tx.objectStore('covers').delete(record.id)
  })
  return record
}
export async function updateBookMeta(id, patch) {
  return transaction(['metadata'], 'readwrite', (tx) => {
    const store = tx.objectStore('metadata')
    const req = store.get(id)
    req.onsuccess = () => {
      if (req.result)
        store.put({
          ...req.result,
          ...(typeof patch === 'function' ? patch(req.result) : patch),
          id
        })
    }
  })
}
export async function getBook(id) {
  return transaction(['metadata', 'files', 'covers'], 'readonly', (tx) => {
    const meta = tx.objectStore('metadata').get(id)
    const file = tx.objectStore('files').get(id)
    const cover = tx.objectStore('covers').get(id)
    return () =>
      meta.result
        ? {
            ...meta.result,
            blob: file.result?.blob,
            cover: cover.result?.cover
          }
        : null
  })
}
export async function listBooks({ includeRemoved = false } = {}) {
  return transaction(['metadata', 'covers'], 'readonly', (tx) => {
    const metas = tx.objectStore('metadata').getAll()
    const covers = tx.objectStore('covers').getAll()
    return () => {
      const images = new Map(covers.result.map((r) => [r.id, r.cover]))
      return metas.result
        .filter((r) => includeRemoved || !r.removedAt)
        .sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0))
        .map((r) => ({ ...r, cover: images.get(r.id) }))
    }
  })
}
// Soft removal preserves a reliable restore path and suppresses cloud re-download.
export function removeBook(id, mode = 'local') {
  return updateBookMeta(id, (previous) => {
    const updatedAt = Math.max(
      Date.now(),
      (previous.deletionUpdatedAt || 0) + 1
    )
    return {
      removedAt: updatedAt,
      removalMode: mode,
      deletionUpdatedAt: updatedAt
    }
  })
}
export function restoreBook(id) {
  return updateBookMeta(id, (previous) => ({
    removedAt: 0,
    removalMode: '',
    deletionUpdatedAt: Math.max(
      Date.now(),
      (previous.deletionUpdatedAt || 0) + 1
    )
  }))
}
export function deleteBook(id) {
  return transaction(STORES, 'readwrite', (tx) => {
    for (const name of STORES) tx.objectStore(name).delete(id)
  })
}
export async function getLocations(id) {
  return transaction(['locations'], 'readonly', (tx) => {
    const req = tx.objectStore('locations').get(id)
    return () => req.result || null
  })
}
export function putLocations(id, data) {
  return transaction(['locations'], 'readwrite', (tx) =>
    tx.objectStore('locations').put({ id, ...data })
  )
}

// Keep a tiny removal marker so releasing space cannot cause cloud resurrection.
export function purgeBookFiles(id) {
  return transaction(STORES, 'readwrite', (tx) => {
    const store = tx.objectStore('metadata')
    const req = store.get(id)
    req.onsuccess = () => {
      if (req.result?.removedAt) {
        store.put({ ...req.result, purged: true })
        for (const name of ['files', 'covers', 'locations'])
          tx.objectStore(name).delete(id)
      }
    }
  })
}
